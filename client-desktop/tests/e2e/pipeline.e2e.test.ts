import { beforeAll, describe, expect, it, vi } from "vitest";
import { setEndpoints } from "../../src/main/config";
import * as connection from "../../src/main/db/connection";
import * as gateway from "../../src/main/gateway";
import { runPipeline, runSql } from "../../src/main/pipeline";
import * as session from "../../src/main/session";
import type { ConnectionConfig, PipelineEvent, PipelineResult } from "../../src/shared/types";

/**
 * End-to-end verification of the data plane against real infrastructure:
 * a live PostgreSQL, the real FastAPI gateway, and the real Gemini API.
 *
 * Everything here is genuine except the control plane, which is stubbed —
 * see `stub-control-plane.mjs` for why. Nothing is mocked on the path that
 * actually matters: introspection, pruning, translation, the AST guardrail,
 * EXPLAIN, and execution all run for real.
 *
 * Skipped unless HELIXQL_E2E=1, so `npm test` stays hermetic and fast. See
 * the README for the four commands that bring the dependencies up.
 */

const ENABLED = process.env.HELIXQL_E2E === "1";

const DB: ConnectionConfig = {
  dialect: "postgres",
  host: process.env.E2E_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.E2E_DB_PORT ?? 55432),
  database: process.env.E2E_DB_NAME ?? "shopdb",
  user: process.env.E2E_DB_USER ?? "helix",
  password: process.env.E2E_DB_PASSWORD ?? "helix",
  ssl: false,
};

function run(question: string): Promise<{ result: PipelineResult; events: PipelineEvent[] }> {
  const events: PipelineEvent[] = [];
  return runPipeline({ question }, (event) => events.push(event)).then((result) => ({ result, events }));
}

describe.skipIf(!ENABLED)("data plane end to end", () => {
  beforeAll(async () => {
    setEndpoints({
      controlPlaneUrl: process.env.E2E_CONTROL_PLANE ?? "http://127.0.0.1:3999",
      gatewayUrl: process.env.E2E_GATEWAY ?? "http://127.0.0.1:8099",
    });
    // Defaults match the stub. Override to point the same suite at a real
    // control plane instance instead.
    await session.login(
      process.env.E2E_EMAIL ?? "e2e@example.com",
      process.env.E2E_PASSWORD ?? "e2e-password",
    );
    await connection.connect(DB);
  }, 60_000);

  it("maps the schema from the system catalog", () => {
    const blueprint = connection.getBlueprint();
    const names = blueprint.tables.map((t) => t.name).sort();
    expect(names).toEqual(["orders", "payroll", "products", "users"]);

    const orders = blueprint.tables.find((t) => t.name === "orders")!;
    expect(orders.columns.map((c) => c.name)).toContain("user_id");
    expect(orders.columns.find((c) => c.name === "id")?.isPrimaryKey).toBe(true);
    // The FK is what lets the model join to users without seeing a row.
    expect(orders.foreignKeys).toContainEqual({
      column: "user_id",
      referencesTable: "users",
      referencesColumn: "id",
    });
  });

  it(
    "answers a business question end to end",
    async () => {
      const { result, events } = await run("Who made the most orders from Gujarat?");

      expect(result.sql.toUpperCase()).toMatch(/^\s*(SELECT|WITH)/);
      expect(result.rowCount).toBeGreaterThan(0);
      // Asha has 14 orders, Raj 9, Vikram 3 — Priya's 20 are Maharashtra,
      // so a correct query must exclude her.
      expect(JSON.stringify(result.result.rows)).toContain("Asha");
      expect(JSON.stringify(result.result.rows)).not.toContain("Priya");

      // EXPLAIN ran and produced optimizer output for the diagnostics pane.
      expect(result.plan.rows.length).toBeGreaterThan(0);
      expect(result.timings.explainMs).toBeGreaterThanOrEqual(0);
      expect(result.usage?.monthlyQueryLimit).toBe(100);

      expect(events.map((e) => e.step)).toContain("pruning");
      expect(events.map((e) => e.step)).toContain("done");
    },
    120_000,
  );

  it(
    "sends only the tables the question needs",
    async () => {
      const { result } = await run("How many products do we have?");
      // payroll is unrelated and must never have been shipped upstream.
      expect(result.schemaTablesSent).not.toContain("payroll");
      expect(result.schemaTablesSent).toContain("products");
    },
    120_000,
  );

  it(
    "reports a question the schema cannot answer instead of inventing tables",
    async () => {
      await expect(run("What was our Facebook ad spend by campaign last quarter?")).rejects.toMatchObject({
        code: "QUESTION_UNANSWERABLE",
      });
    },
    120_000,
  );


  it(
    "self-heals when the database rejects the generated SQL",
    async () => {
      // Gemini usually gets this right first try, so the failure has to be
      // staged: intercept only the *initial* translation and hand back SQL
      // with a column that does not exist. Everything after that is real —
      // Postgres produces the actual error, and the repair round trip goes
      // to the live gateway and model.
      const real = gateway.translate;
      const spy = vi.spyOn(gateway, "translate").mockImplementation(async (options) => {
        if (!options.repair) {
          return {
            sql: "SELECT u.customer_name FROM users u JOIN orders o ON o.user_id = u.id LIMIT 5",
            dialect: "postgres",
            attempt: 1,
            tables: ["users", "orders"],
            limit_applied: null,
            usage: { remaining: 99, monthly_query_limit: 100 },
          };
        }
        return real(options);
      });

      try {
        const { result, events } = await run("Which customers placed orders?");

        expect(result.repairs.length).toBeGreaterThan(0);
        expect(result.repairs[0].error).toMatch(/customer_name/);
        expect(events.map((e) => e.step)).toContain("repairing");

        // The corrected query actually ran and returned rows.
        expect(result.sql).not.toContain("customer_name");
        expect(result.rowCount).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
    },
    120_000,
  );

  it("runs hand-written SQL without spending query allowance", async () => {
    const events: PipelineEvent[] = [];
    const result = await runSql("SELECT name, state FROM users ORDER BY name", (e) => events.push(e));

    expect(result.rowCount).toBe(4);
    expect(result.result.columns).toEqual(["name", "state"]);
    expect(result.plan.rows.length).toBeGreaterThan(0);
    // No model call means no metering — the badge keeps its previous value.
    expect(result.usage).toBeNull();
    expect(events.map((e) => e.step)).toContain("validating");
  });

  it("applies the row cap to hand-written SQL that has no LIMIT", async () => {
    const result = await runSql("SELECT * FROM orders", () => undefined);
    expect(result.limitApplied).toBe(1000);
  });

  it("puts hand-written SQL through the same guardrail as generated SQL", async () => {
    // The manual editor must not be a way around the security layer.
    await expect(runSql("DELETE FROM payroll", () => undefined)).rejects.toMatchObject({
      code: "SECURITY_VIOLATION",
    });
    await expect(runSql("SELECT 1; DROP TABLE users", () => undefined)).rejects.toMatchObject({
      code: "SECURITY_VIOLATION",
    });
  });

  it("refuses to execute a mutating query even if one reaches the driver", async () => {
    // The gateway's guardrail is the primary control, but the local
    // read-only transaction is what makes a bypass harmless. Prove the
    // database itself rejects the write.
    const { driver } = connection.requireActive();
    await expect(driver.execute("DELETE FROM payroll")).rejects.toThrow(/read-only/i);

    const survivors = await driver.execute("SELECT count(*) AS c FROM payroll");
    expect(Number(survivors.rows[0].c)).toBe(1);
  });
});
