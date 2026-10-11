import { describe, expect, it } from "vitest";
import { checkPlan, coerceValue, followUpMessage, type WritePlan, writeBlueprintFor } from "../src/main/db/writePlan";
import type { ColumnInfo, SchemaBlueprint, TableInfo } from "../src/shared/types";

function column(name: string, dataType: string, extra: Partial<ColumnInfo> = {}): ColumnInfo {
  return { name, dataType, nullable: false, isPrimaryKey: false, ...extra };
}

const customers: TableInfo = {
  name: "customers",
  columns: [
    column("id", "INT", { isPrimaryKey: true, generated: true }),
    column("first_name", "VARCHAR(10)"),
    column("email", "VARCHAR(100)"),
    column("phone", "VARCHAR(20)", { nullable: true }),
    column("is_active", "TINYINT(1)", { hasDefault: true }),
    column("credit", "DECIMAL(8,2)", { nullable: true }),
    column("tier", "ENUM('gold','silver')", { nullable: true }),
    column("joined_on", "DATE", { hasDefault: true }),
  ],
  foreignKeys: [],
};

const blueprint = (dialect: "mysql" | "postgres" = "mysql"): SchemaBlueprint => ({
  dialect,
  database: "shop",
  capturedAt: "",
  tables: [customers, { name: "active_customers", columns: [column("id", "INT")], foreignKeys: [], isView: true }],
});

function plan(overrides: Partial<WritePlan>): WritePlan {
  return { operation: "insert", table: "customers", values: {}, where: [], ...overrides };
}

describe("coerceValue", () => {
  const mysql = "mysql" as const;

  it("accepts and normalizes valid values per type", () => {
    expect(coerceValue("42", column("n", "INT"), mysql)).toEqual({ ok: true, value: 42 });
    expect(coerceValue("yes", column("b", "TINYINT(1)"), mysql)).toEqual({ ok: true, value: 1 });
    expect(coerceValue("no", column("b", "BOOLEAN"), "postgres")).toEqual({ ok: true, value: false });
    expect(coerceValue("12.50", column("d", "DECIMAL(8,2)"), mysql)).toEqual({ ok: true, value: "12.50" });
    expect(coerceValue("2026-3-5", column("d", "DATE"), mysql)).toEqual({ ok: true, value: "2026-03-05" });
    expect(coerceValue("2026-03-05", column("t", "DATETIME"), mysql)).toEqual({ ok: true, value: "2026-03-05 00:00:00" });
    expect(coerceValue("GOLD", column("e", "ENUM('gold','silver')"), mysql)).toEqual({ ok: true, value: "gold" });
  });

  it("rejects values that don't fit the column, with a readable reason", () => {
    expect(coerceValue("five", column("rating", "INT"), mysql)).toMatchObject({ ok: false, error: expect.stringContaining("whole number") });
    expect(coerceValue("1.5", column("qty", "INT"), mysql)).toMatchObject({ ok: false });
    expect(coerceValue("-1", column("qty", "INT UNSIGNED"), mysql)).toMatchObject({ ok: false });
    expect(coerceValue("300", column("t", "TINYINT"), mysql)).toMatchObject({ ok: false });
    expect(coerceValue("1.234", column("d", "DECIMAL(8,2)"), mysql)).toMatchObject({ ok: false, error: expect.stringContaining("2 decimal") });
    expect(coerceValue("1234567", column("d", "DECIMAL(8,2)"), mysql)).toMatchObject({ ok: false });
    expect(coerceValue("2026-02-30", column("d", "DATE"), mysql)).toMatchObject({ ok: false });
    expect(coerceValue("platinum", column("e", "ENUM('gold','silver')"), mysql)).toMatchObject({ ok: false, error: expect.stringContaining("gold, silver") });
    expect(coerceValue("x".repeat(11), column("s", "VARCHAR(10)"), mysql)).toMatchObject({ ok: false, error: expect.stringContaining("10 characters") });
    expect(coerceValue(null, column("s", "VARCHAR(10)"), mysql)).toMatchObject({ ok: false, error: expect.stringContaining("empty") });
  });

  it("ignores a collation suffix on the type", () => {
    expect(coerceValue("abc", column("s", "VARCHAR(5) COLLATE utf8mb4_bin"), mysql)).toEqual({ ok: true, value: "abc" });
  });
});

describe("checkPlan — insert", () => {
  it("asks for every required field that has no value", () => {
    const checked = checkPlan(plan({ values: { first_name: "Asha" } }), blueprint());
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    // id is generated, is_active and joined_on have defaults, phone/credit/tier are nullable.
    expect(checked.missing.map((c) => c.name)).toEqual(["email"]);
    expect(followUpMessage(checked.problems, checked.missing)).toBe("I still need: email (text).");
  });

  it("builds a parameterized insert and leaves generated columns out", () => {
    const checked = checkPlan(plan({ values: { id: 99, first_name: "Asha", email: "a@b.c", is_active: "yes" } }), blueprint());
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.write.sql).toBe("INSERT INTO `customers` (`first_name`, `email`, `is_active`) VALUES (?, ?, ?)");
    expect(checked.write.params).toEqual(["Asha", "a@b.c", 1]);
    expect(checked.write.notes[0]).toContain("set automatically");
  });

  it("uses numbered placeholders and asks for the key back on postgres", () => {
    const checked = checkPlan(plan({ values: { first_name: "Asha", email: "a@b.c" } }), blueprint("postgres"));
    expect(checked.ok && checked.write.sql).toBe(
      'INSERT INTO "customers" ("first_name", "email") VALUES ($1, $2) RETURNING "id"',
    );
  });

  it("reports an invalid value as a problem, not as a missing field", () => {
    const checked = checkPlan(plan({ values: { first_name: "Asha", email: "a@b.c", credit: "lots" } }), blueprint());
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.problems[0]).toContain("credit must be a number");
    expect(checked.missing).toEqual([]);
  });

  it("refuses unknown tables, unknown columns, and views", () => {
    expect(checkPlan(plan({ table: "clients" }), blueprint())).toMatchObject({ ok: false });
    expect(checkPlan(plan({ values: { nickname: "x" } }), blueprint())).toMatchObject({
      ok: false,
      problems: [expect.stringContaining("nickname")],
    });
    expect(checkPlan(plan({ table: "active_customers", values: { id: 1 } }), blueprint())).toMatchObject({
      ok: false,
      problems: [expect.stringContaining("view")],
    });
  });

  it("binds a hostile value as data, never as SQL", () => {
    const checked = checkPlan(plan({ values: { first_name: "x'); DROP", email: "a@b.c" } }), blueprint());
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.write.sql).not.toContain("DROP");
    expect(checked.write.params).toContain("x'); DROP");
    // The display copy escapes it too.
    expect(checked.write.displaySql).toContain("'x''); DROP'");
  });
});

describe("checkPlan — update and delete", () => {
  it("builds an update with a count and a preview over the same condition", () => {
    const checked = checkPlan(
      plan({ operation: "update", values: { phone: "+91 98" }, where: [{ column: "email", op: "=", value: "a@b.c" }] }),
      blueprint(),
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.write.sql).toBe("UPDATE `customers` SET `phone` = ? WHERE `email` = ?");
    expect(checked.write.params).toEqual(["+91 98", "a@b.c"]);
    expect(checked.write.countSql).toBe("SELECT COUNT(*) AS affected FROM `customers` WHERE `email` = ?");
    expect(checked.write.whereParams).toEqual(["a@b.c"]);
    expect(checked.write.summary).toBe("In customers, set phone to +91 98 where email is a@b.c.");
  });

  it("numbers postgres placeholders across SET and WHERE", () => {
    const checked = checkPlan(
      plan({
        operation: "update",
        values: { phone: "1", first_name: "B" },
        where: [{ column: "id", op: "in", value: [1, 2] }],
      }),
      blueprint("postgres"),
    );
    expect(checked.ok && checked.write.sql).toBe(
      'UPDATE "customers" SET "phone" = $1, "first_name" = $2 WHERE "id" IN ($3, $4)',
    );
    expect(checked.ok && checked.write.countSql).toBe('SELECT COUNT(*) AS affected FROM "customers" WHERE "id" IN ($1, $2)');
  });

  it.each(["update", "delete"] as const)("refuses a %s with no condition", (operation) => {
    const checked = checkPlan(plan({ operation, values: { phone: "1" }, where: [] }), blueprint());
    expect(checked).toMatchObject({ ok: false, problems: [expect.stringContaining("Which customers rows")] });
  });

  it("refuses to change a generated column", () => {
    const checked = checkPlan(
      plan({ operation: "update", values: { id: 5 }, where: [{ column: "email", op: "=", value: "a" }] }),
      blueprint(),
    );
    expect(checked).toMatchObject({ ok: false, problems: [expect.stringContaining("set automatically")] });
  });

  it("type-checks condition values against their column", () => {
    const checked = checkPlan(plan({ operation: "delete", where: [{ column: "id", op: "=", value: "abc" }] }), blueprint());
    expect(checked).toMatchObject({ ok: false, problems: [expect.stringContaining("whole number")] });
  });

  it("rejects an operator outside the allowed set", () => {
    const checked = checkPlan(
      plan({ operation: "delete", where: [{ column: "id", op: "OR 1=1" as never, value: 1 }] }),
      blueprint(),
    );
    expect(checked.ok).toBe(false);
  });

  it("treats = null as 'is empty'", () => {
    const checked = checkPlan(plan({ operation: "delete", where: [{ column: "phone", op: "=", value: null }] }), blueprint());
    expect(checked.ok && checked.write.sql).toBe("DELETE FROM `customers` WHERE `phone` IS NULL");
  });
});

describe("writeBlueprintFor", () => {
  it("marks generated and defaulted columns for the planner", () => {
    const [ddl] = writeBlueprintFor([customers]);
    expect(ddl).toContain("id INT NOT NULL GENERATED");
    expect(ddl).toContain("is_active TINYINT(1) NOT NULL DEFAULT");
    expect(ddl).toContain("email VARCHAR(100) NOT NULL,");
  });
});
