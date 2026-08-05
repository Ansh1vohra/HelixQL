import type {
  PipelineEvent,
  PipelineRequest,
  PipelineResult,
  RepairRecord,
  ResultGrid,
} from "../shared/types";
import { MAX_REPAIR_ATTEMPTS } from "./config";
import { getBlueprint, requireActive } from "./db/connection";
import { blueprintFor } from "./db/ddl";
import { pruneSchema } from "./db/rag";
import { AppError } from "./errors";
import * as gateway from "./gateway";

/**
 * Decentralized data flow routing (Step 4.4) plus the stateful feedback
 * loop (Step 7 / FR-4.5).
 *
 * The whole sequence runs in the main process. The renderer only sends a
 * question and receives progress events plus a final result — it never
 * holds credentials, a token, or a database handle.
 *
 * Result rows never leave this machine. They are read from the local
 * database into local memory and rendered locally; no step in this file
 * sends them anywhere. The spec's Step 8 (sending rows back to the model for
 * a written summary) is deliberately not implemented — the isolation
 * guarantee is worth more than the prose.
 */

type Emit = (event: PipelineEvent) => void;

export async function runPipeline(request: PipelineRequest, emit: Emit): Promise<PipelineResult> {
  const question = request.question.trim();
  if (!question) {
    throw new AppError("EMPTY_QUESTION", "Type a question first.");
  }

  const started = Date.now();
  const { driver, config } = requireActive();
  const blueprint = getBlueprint();

  // --- Step 3: local metadata RAG -------------------------------------
  const schemaStart = Date.now();
  emit({ step: "pruning", message: "Matching your question against the local schema…" });

  const pruned = pruneSchema(blueprint, question);
  const schemaDdl = blueprintFor(pruned.tables);
  const schemaTablesSent = pruned.tables.map((table) => table.name);

  if (schemaDdl.length === 0) {
    throw new AppError(
      "EMPTY_SCHEMA",
      "No tables were found in this database, so there is nothing to query.",
    );
  }

  emit({
    step: "pruning",
    message: `Sending ${schemaDdl.length} of ${blueprint.tables.length} table structures`,
    detail: pruned.usedFallback
      ? `No table name matched the question, so the first ${schemaDdl.length} were used: ${schemaTablesSent.join(", ")}`
      : schemaTablesSent.join(", "),
  });
  const schemaMs = Date.now() - schemaStart;

  // --- Steps 4-6: translate, then verify against the live optimizer ----
  let translateMs = 0;
  let explainMs = 0;
  const repairs: RepairRecord[] = [];

  let translateStart = Date.now();
  emit({ step: "translating", message: "Translating your question into SQL…" });

  let translation = await gateway.translate({ question, schemaDdl, dialect: config.dialect });
  translateMs += Date.now() - translateStart;

  // Only the first translation is metered, so only it carries the usage
  // counters. Capture them here or a self-healed run would report no usage
  // at all and the UI's remaining-queries badge would blank out.
  const usage = translation.usage;

  let plan: ResultGrid = { columns: [], rows: [] };

  // Branch A/B of the Helix feedback loop. EXPLAIN is the probe: it asks
  // the optimizer to validate every identifier and join in the query
  // without reading a single row, so a hallucinated column surfaces here
  // rather than after an expensive scan.
  for (let attempt = 0; ; attempt += 1) {
    emit({
      step: "explaining",
      message: "Checking the query against the database optimizer…",
      detail: translation.sql,
    });

    const explainStart = Date.now();
    try {
      plan = await driver.explain(translation.sql);
      explainMs += Date.now() - explainStart;
      break;
    } catch (error) {
      explainMs += Date.now() - explainStart;
      const driverError = error instanceof Error ? error.message : String(error);

      if (attempt >= MAX_REPAIR_ATTEMPTS - 1) {
        throw new AppError(
          "SELF_HEAL_EXHAUSTED",
          `The query still failed after ${MAX_REPAIR_ATTEMPTS} attempts. Last database error: ${driverError}`,
        );
      }

      repairs.push({ attempt: attempt + 1, sql: translation.sql, error: driverError });
      emit({
        step: "repairing",
        message: `The database rejected the query — self-correcting (attempt ${attempt + 1} of ${MAX_REPAIR_ATTEMPTS})…`,
        detail: driverError,
      });

      // Hand the model back its own broken SQL together with the driver's
      // raw error text; that error names the exact fault far more reliably
      // than any retry heuristic we could write here.
      translateStart = Date.now();
      translation = await gateway.translate({
        question,
        schemaDdl,
        dialect: config.dialect,
        repair: { sql: translation.sql, error: driverError, attempt: attempt + 1 },
      });
      translateMs += Date.now() - translateStart;
    }
  }

  // --- Step 7 Branch A: run the verified query ------------------------
  emit({ step: "executing", message: "Running the verified query…" });
  const executeStart = Date.now();
  let result: ResultGrid;
  try {
    result = await driver.execute(translation.sql);
  } catch (error) {
    // Rare: EXPLAIN passed but execution failed (a permissions issue or a
    // runtime cast). Surfaced rather than re-entering the repair loop,
    // which is scoped to the optimizer check by design.
    throw new AppError(
      "QUERY_EXECUTION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
  const executeMs = Date.now() - executeStart;

  // The rows stop here, in local memory, on their way to the local UI.
  emit({ step: "done", message: `Returned ${result.rows.length} rows` });

  return {
    question,
    sql: translation.sql,
    dialect: config.dialect,
    attempts: translation.attempt,
    tables: translation.tables,
    limitApplied: translation.limit_applied,
    schemaTablesSent,
    result,
    rowCount: result.rows.length,
    plan,
    timings: {
      schemaMs,
      translateMs,
      explainMs,
      executeMs,
      totalMs: Date.now() - started,
    },
    usage: usage ? { remaining: usage.remaining, monthlyQueryLimit: usage.monthly_query_limit } : null,
    repairs,
  };
}

/**
 * Runs hand-written SQL from the manual editor.
 *
 * Routed through the gateway's `/v1/validate` so the same AST guardrail vets
 * it — an operator typing SQL directly gets no more privilege than the model
 * does, and the read-only transaction still applies underneath. No model
 * call, so this consumes no query allowance.
 */
export async function runSql(sql: string, emit: Emit): Promise<PipelineResult> {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new AppError("EMPTY_SQL", "Type a query first.");
  }

  const started = Date.now();
  const { driver, config } = requireActive();

  emit({ step: "validating", message: "Checking the query against the safety guardrail…" });
  const validateStart = Date.now();
  const checked = await gateway.validate(trimmed, config.dialect);
  const translateMs = Date.now() - validateStart;

  emit({ step: "explaining", message: "Collecting the optimizer plan…", detail: checked.sql });
  const explainStart = Date.now();
  let plan: ResultGrid;
  try {
    plan = await driver.explain(checked.sql);
  } catch (error) {
    // No self-heal here: the operator wrote this query, so the honest move
    // is to hand back the database's own error rather than quietly
    // rewriting what they asked for.
    throw new AppError("QUERY_EXPLAIN_FAILED", error instanceof Error ? error.message : String(error));
  }
  const explainMs = Date.now() - explainStart;

  emit({ step: "executing", message: "Running the query…" });
  const executeStart = Date.now();
  let result: ResultGrid;
  try {
    result = await driver.execute(checked.sql);
  } catch (error) {
    throw new AppError("QUERY_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
  }
  const executeMs = Date.now() - executeStart;

  emit({ step: "done", message: `Returned ${result.rows.length} rows` });

  return {
    question: "",
    sql: checked.sql,
    dialect: config.dialect,
    attempts: 1,
    tables: checked.tables,
    limitApplied: checked.limit_applied,
    schemaTablesSent: [],
    result,
    rowCount: result.rows.length,
    plan,
    timings: { schemaMs: 0, translateMs, explainMs, executeMs, totalMs: Date.now() - started },
    usage: null,
    repairs: [],
  };
}
