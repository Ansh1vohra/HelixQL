import { randomUUID } from "crypto";
import type {
  BetaTurnRequest,
  BetaTurnResult,
  ChatTurn,
  PipelineResult,
  PriorExchange,
  ResultGrid,
  WriteOutcome,
  WritePreview,
} from "../shared/types";
import { runAgentTurn } from "./agent";
import { getBlueprint, requireActive } from "./db/connection";
import { type Driver, RowCountMismatchError } from "./db/driver";
import {
  type BuiltWrite,
  checkPlan,
  followUpMessage,
  MAX_WRITE_ROWS,
  PREVIEW_ROWS,
  writeBlueprintFor,
} from "./db/writePlan";
import { AppError } from "./errors";
import * as gateway from "./gateway";
import { type Emit, selectSchema } from "./pipeline";

/**
 * Beta mode: agent talk that can also insert, update, and delete.
 *
 * Reads are not handled here — they run through `runAgentTurn` exactly as
 * in Agent talk. Only a request the planner classifies as a write takes the
 * path below, and that path has three gates before anything changes:
 *
 *   1. The model returns a plan, not SQL. `checkPlan` validates every name
 *      and value against the live schema and builds a parameterized
 *      statement; anything missing or malformed goes back to the user as a
 *      question.
 *   2. The rows an update or delete would touch are counted and sampled
 *      locally, and shown. Nothing matches → nothing to confirm. Too many →
 *      refused.
 *   3. The statement waits here, under an id, until the user confirms. It
 *      then runs in a transaction that commits only if it touched exactly
 *      the previewed number of rows.
 *
 * The renderer never holds the statement — it can only confirm or cancel an
 * id — so what runs is exactly what was previewed.
 */

/** A previewed write expires if not confirmed in this time; the preview's
 * row count is a snapshot and goes stale. */
const PLAN_TTL_MS = 10 * 60_000;

/** Delete only: typed to enable the confirm button. */
const DELETE_CONFIRM_WORD = "delete";

/** Earlier exchanges passed to the planner, same as agent talk. */
const CONTEXT_WINDOW = 3;

/**
 * Verbs that can mean changing data. Matched as whole words, so "cancelled
 * orders" or "new customers" (both reads) do not count.
 */
const WRITE_VERBS = new Set([
  "add", "insert", "create", "register", "enter", "save", "put",
  "update", "change", "set", "edit", "modify", "rename", "correct", "replace", "mark", "assign",
  "increase", "decrease", "raise", "reduce", "deactivate", "activate", "enable", "disable",
  "delete", "remove", "drop", "erase", "purge", "cancel", "clear",
]);

/**
 * Whether a question could be a write. A question with none of these verbs
 * is a read and goes straight to agent talk — no planner call, so a small
 * model can never mistake "how many customers in Punjab?" for a change.
 * A question with one still goes to the planner, which can still say read
 * ("show the price change by month").
 */
export function mightWrite(question: string): boolean {
  return question
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => WRITE_VERBS.has(word));
}

interface PendingWrite {
  write: BuiltWrite;
  expectedRows: number;
  /** The connection the preview was read from. A reconnect in between
   * means the preview describes a different database. */
  driver: Driver;
  confirmWord: string | null;
  createdAt: number;
}

const pending = new Map<string, PendingWrite>();

function dropExpired(now = Date.now()): void {
  for (const [id, entry] of pending) {
    if (now - entry.createdAt > PLAN_TTL_MS) pending.delete(id);
  }
}

function selectionText(question: string, history: ChatTurn[], context: PriorExchange[]): string {
  const previous = context[context.length - 1];
  return [
    ...(previous ? [previous.resolvedQuestion] : []),
    question,
    ...history.filter((turn) => turn.role === "user").map((turn) => turn.content),
  ].join(". ");
}

function insertedRow(write: BuiltWrite): ResultGrid {
  const row: Record<string, unknown> = {};
  for (const { column, value } of write.assignments) row[column] = value;
  return { columns: write.assignments.map(({ column }) => column), rows: [row] };
}

/** Shapes a preview for the shared Results/Diagnostics panels, which expect
 * a pipeline result: the rows that would change, and the statement. */
function previewResult(
  write: BuiltWrite,
  preview: ResultGrid,
  dialect: PipelineResult["dialect"],
  tablesSent: string[],
  totalMs: number,
): PipelineResult {
  return {
    question: write.summary,
    sql: write.displaySql,
    dialect,
    attempts: 1,
    tables: [write.table.name],
    limitApplied: null,
    caseInsensitiveColumns: [],
    schemaTablesSent: tablesSent,
    result: preview,
    rowCount: preview.rows.length,
    plan: { columns: [], rows: [] },
    timings: { schemaMs: 0, translateMs: 0, explainMs: 0, executeMs: 0, totalMs },
    usage: null,
    repairs: [],
  };
}

export async function runBetaTurn(
  request: BetaTurnRequest,
  emit: Emit,
): Promise<BetaTurnResult> {
  const question = request.question.trim();
  if (!question) throw new AppError("EMPTY_QUESTION", "Type a question first.");

  const history = request.history.filter((turn) => turn.content.trim());
  const context = (request.context ?? [])
    .filter((prior) => prior.question.trim() && prior.resolvedQuestion.trim())
    .slice(-CONTEXT_WINDOW);

  // An exchange already running as a read stays agent talk to the end, and
  // a new question with no writing verb never was a write.
  if (request.track === "read" || (request.track === undefined && !mightWrite(question))) {
    return { ...(await runAgentTurn({ question, history, context, skip: request.skip }, emit)), track: "read" };
  }

  const started = Date.now();
  const { driver } = requireActive();
  const blueprint = getBlueprint();
  dropExpired();

  emit({ step: "pruning", message: "Reading the schema for your request…" });
  const selection = await selectSchema(blueprint, selectionText(question, history, context));
  const tables = blueprint.tables.filter((table) => selection.tables.includes(table.name));

  emit({ step: "clarifying", message: "Working out what to change…", detail: selection.tables.join(", ") });
  const reply = await gateway.writePlan(question, writeBlueprintFor(tables), history, context);

  if (reply.status === "read") {
    // Not a write after all: hand the question to agent talk unchanged.
    // Any write-planning turns so far were about a change that isn't
    // happening, so they are not passed along.
    return { ...(await runAgentTurn({ question, history: [], context, skip: request.skip }, emit)), track: "read" };
  }
  if (reply.status === "ask") {
    return { kind: "ask", track: "write", message: reply.message, options: reply.options };
  }
  if (reply.status === "unanswerable" || !reply.plan) {
    return { kind: "unanswerable", track: "write", message: reply.message || "This change can't be made here." };
  }

  emit({ step: "validating", message: "Checking the change against the schema…" });
  const checked = checkPlan(reply.plan, blueprint);
  if (!checked.ok) {
    return { kind: "ask", track: "write", message: followUpMessage(checked.problems, checked.missing), options: [] };
  }
  const { write } = checked;

  let affectedRows = 1;
  let preview: ResultGrid;
  if (write.operation === "insert") {
    preview = insertedRow(write);
  } else {
    emit({ step: "explaining", message: "Finding the rows this would change…", detail: write.displaySql });
    const counted = await driver.query(write.countSql!, write.whereParams);
    affectedRows = Number(counted.rows[0]?.affected ?? 0);

    if (affectedRows === 0) {
      return {
        kind: "ask",
        track: "write",
        message: `No ${write.table.name} rows match that, so there's nothing to ${write.operation}. Which rows did you mean?`,
        options: [],
      };
    }
    if (affectedRows > MAX_WRITE_ROWS) {
      return {
        kind: "ask",
        track: "write",
        message:
          `That matches ${affectedRows.toLocaleString()} rows. Beta changes at most ${MAX_WRITE_ROWS} rows at a time — ` +
          "could you narrow down which ones?",
        options: [],
      };
    }
    preview = await driver.query(write.previewSql!, write.whereParams);
  }

  const notes = [...write.notes];
  if (write.operation !== "insert" && affectedRows > PREVIEW_ROWS) {
    notes.push(`Showing the first ${PREVIEW_ROWS} of ${affectedRows} rows.`);
  }

  const planId = randomUUID();
  const confirmWord = write.operation === "delete" ? DELETE_CONFIRM_WORD : null;
  pending.set(planId, { write, expectedRows: affectedRows, driver, confirmWord, createdAt: Date.now() });

  emit({ step: "done", message: "Waiting for your confirmation — nothing has changed yet" });

  const shown: WritePreview = {
    planId,
    operation: write.operation,
    table: write.table.name,
    summary: write.summary,
    sql: write.displaySql,
    affectedRows,
    preview,
    notes,
    confirmWord,
  };
  return {
    kind: "confirm",
    track: "write",
    preview: shown,
    result: previewResult(write, preview, blueprint.dialect, selection.tables, Date.now() - started),
  };
}

export async function confirmWrite(request: { planId: string; typed?: string }): Promise<WriteOutcome> {
  dropExpired();
  const entry = pending.get(request.planId);
  if (!entry) {
    throw new AppError("WRITE_EXPIRED", "This change expired or was already handled. Ask again to get a fresh preview.");
  }

  const { driver } = requireActive();
  if (driver !== entry.driver) {
    pending.delete(request.planId);
    throw new AppError("WRITE_EXPIRED", "The database connection changed since this preview. Ask again.");
  }
  if (entry.confirmWord && (request.typed ?? "").trim().toLowerCase() !== entry.confirmWord) {
    throw new AppError("WRITE_NOT_CONFIRMED", `Type "${entry.confirmWord}" to confirm.`);
  }

  // Single use, removed before running: a double click cannot run it twice.
  pending.delete(request.planId);
  const { write, expectedRows } = entry;

  try {
    const result = await driver.write(write.sql, write.params, expectedRows);
    return {
      operation: write.operation,
      table: write.table.name,
      affectedRows: result.affectedRows,
      insertId: write.operation === "insert" ? result.insertId : null,
    };
  } catch (error) {
    if (error instanceof RowCountMismatchError) {
      throw new AppError(
        "WRITE_ROWS_CHANGED",
        `The data changed since the preview: this would now affect ${error.actual} row(s), not ${error.expected}. ` +
          "Nothing was changed — ask again for a fresh preview.",
      );
    }
    throw new AppError("WRITE_FAILED", error instanceof Error ? error.message : String(error));
  }
}

export function cancelWrite(request: { planId: string }): null {
  pending.delete(request.planId);
  return null;
}
