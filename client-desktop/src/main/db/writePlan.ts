import type { ColumnInfo, Dialect, SchemaBlueprint, TableInfo, WriteOperation } from "../../shared/types";

/**
 * Beta write mode: turns the model's structured plan into a statement this
 * app is willing to run.
 *
 * The model never writes the SQL. It names a table, columns, values, and
 * conditions; everything below is deterministic and local:
 *
 *   - every table and column is resolved against the live schema, so a
 *     hallucinated name fails here rather than at the database;
 *   - every value is checked against its column's type and coerced, so
 *     "five" never reaches an INT column and a date is a real date;
 *   - required columns are worked out from the catalog (NOT NULL, no
 *     default, not generated), not from the model's opinion;
 *   - values travel as bound parameters and identifiers are quoted, so
 *     nothing the user or the model typed can change the statement's shape;
 *   - updates and deletes must have a condition.
 *
 * The caller previews the affected rows and asks the user to confirm. This
 * module never touches the database.
 */

export type PlanValue = string | number | boolean | null;
export type Operator = "=" | "!=" | "<" | "<=" | ">" | ">=" | "like" | "in" | "is null" | "is not null";

export interface PlanCondition {
  column: string;
  op: Operator;
  value?: PlanValue | Array<string | number>;
}

/** The gateway's plan, as received. Nothing in it is trusted yet. */
export interface WritePlan {
  operation: WriteOperation;
  table: string;
  values: Record<string, PlanValue>;
  where: PlanCondition[];
}

/** Most rows an update or delete may touch in beta. Wider changes belong in
 * a tool with an undo button. */
export const MAX_WRITE_ROWS = 100;

/** Rows of an update/delete shown before confirming. */
export const PREVIEW_ROWS = 20;

const OPERATORS = new Set<Operator>(["=", "!=", "<", "<=", ">", ">=", "like", "in", "is null", "is not null"]);

export interface BuiltWrite {
  operation: WriteOperation;
  table: TableInfo;
  /** The statement that runs, parameterized. */
  sql: string;
  params: unknown[];
  /** Same statement with values inlined, for the user to read. Never run. */
  displaySql: string;
  /** Update/delete: counts and samples the rows the condition matches. */
  countSql: string | null;
  previewSql: string | null;
  whereParams: unknown[];
  /** Coerced values: the inserted row, or the new values of an update. */
  assignments: Array<{ column: string; value: unknown }>;
  summary: string;
  notes: string[];
}

export type CheckResult =
  | { ok: true; write: BuiltWrite }
  | {
      ok: false;
      /** Things the user has to fix, in plain words. */
      problems: string[];
      /** Required columns with no value yet (insert only). */
      missing: ColumnInfo[];
    };

// --- Identifiers ---------------------------------------------------------

export function quoteIdentifier(name: string, dialect: Dialect): string {
  const quote = dialect === "mysql" ? "`" : '"';
  return quote + name.split(quote).join(quote + quote) + quote;
}

function findTable(blueprint: SchemaBlueprint, name: string): TableInfo | undefined {
  const wanted = name.trim().toLowerCase();
  return blueprint.tables.find((table) => table.name.toLowerCase() === wanted);
}

function findColumn(table: TableInfo, name: string): ColumnInfo | undefined {
  const wanted = name.trim().toLowerCase();
  return table.columns.find((column) => column.name.toLowerCase() === wanted);
}

/** Column names read better as words in messages: `first_name` → "first name". */
export function label(column: ColumnInfo | string): string {
  const name = typeof column === "string" ? column : column.name;
  return name.replace(/_/g, " ");
}

// --- Types and coercion --------------------------------------------------

type Coerced = { ok: true; value: unknown } | { ok: false; error: string };

function baseType(dataType: string): string {
  return dataType
    .replace(/\s+COLLATE\s+\S+$/i, "")
    .trim()
    .toUpperCase();
}

const INTEGER_RANGES: Record<string, [bigint, bigint]> = {
  TINYINT: [-128n, 127n],
  SMALLINT: [-32768n, 32767n],
  MEDIUMINT: [-8388608n, 8388607n],
  INT: [-2147483648n, 2147483647n],
  INTEGER: [-2147483648n, 2147483647n],
  BIGINT: [-9223372036854775808n, 9223372036854775807n],
};

function parseBoolean(raw: PlanValue): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (raw === 1 || raw === 0) return raw === 1;
  if (typeof raw === "string") {
    const text = raw.trim().toLowerCase();
    if (["true", "yes", "y", "1", "on"].includes(text)) return true;
    if (["false", "no", "n", "0", "off"].includes(text)) return false;
  }
  return null;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseDate(text: string): string | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isRealDate(year, month, day)) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseTime(text: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function parseDateTime(text: string): string | null {
  const [datePart, timePart] = text.trim().split(/[ T]/, 2);
  const date = parseDate(datePart ?? "");
  if (!date) return null;
  if (!timePart) return `${date} 00:00:00`;
  const time = parseTime(timePart.replace(/(Z|[+-]\d{2}:?\d{2})$/, "").replace(/\.\d+$/, ""));
  return time ? `${date} ${time}` : null;
}

function enumValues(type: string): string[] | null {
  const match = /^ENUM\((.*)\)$/i.exec(type);
  if (!match) return null;
  return Array.from(match[1].matchAll(/'((?:[^']|'')*)'/g), (part) => part[1].replace(/''/g, "'"));
}

/**
 * Checks one value against one column and returns it in the form the
 * driver should bind. Errors are phrased for the person who typed the value.
 */
export function coerceValue(raw: PlanValue, column: ColumnInfo, dialect: Dialect): Coerced {
  const name = label(column);

  if (raw === null || (typeof raw === "string" && raw.trim() === "" && !/CHAR|TEXT/.test(baseType(column.dataType)))) {
    return column.nullable ? { ok: true, value: null } : { ok: false, error: `${name} can't be left empty.` };
  }

  // The original dataType keeps ENUM's value list case-intact; only the
  // collation is stripped.
  const original = column.dataType.replace(/\s+COLLATE\s+\S+$/i, "").trim();
  const type = baseType(column.dataType);

  if (/^(TINYINT\(1\)|BOOLEAN|BOOL|BIT\(1\))/.test(type)) {
    const value = parseBoolean(raw);
    if (value === null) return { ok: false, error: `${name} must be yes or no (got "${raw}").` };
    return { ok: true, value: dialect === "mysql" ? (value ? 1 : 0) : value };
  }

  const integer = /^(TINYINT|SMALLINT|MEDIUMINT|INTEGER|INT|BIGINT|SMALLSERIAL|SERIAL|BIGSERIAL)\b/.exec(type);
  if (integer) {
    const text = String(raw).trim();
    if (!/^[+-]?\d+$/.test(text)) return { ok: false, error: `${name} must be a whole number (got "${raw}").` };
    const value = BigInt(text);
    const unsigned = type.includes("UNSIGNED");
    if (unsigned && value < 0n) return { ok: false, error: `${name} can't be negative.` };
    const serials: Record<string, string> = { SMALLSERIAL: "SMALLINT", SERIAL: "INT", BIGSERIAL: "BIGINT" };
    const range = INTEGER_RANGES[serials[integer[1]] ?? integer[1]];
    if (range && !unsigned && (value < range[0] || value > range[1])) {
      return { ok: false, error: `${name} is out of range for this column.` };
    }
    return { ok: true, value: Number.isSafeInteger(Number(value)) ? Number(value) : text };
  }

  const decimal = /^(DECIMAL|NUMERIC|DEC|FIXED)(?:\((\d+)(?:,\s*(\d+))?\))?/.exec(type);
  if (decimal) {
    const text = String(raw).trim();
    const match = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(text);
    if (!match || (match[2] === "" && !match[3])) return { ok: false, error: `${name} must be a number (got "${raw}").` };
    if (type.includes("UNSIGNED") && match[1] === "-") return { ok: false, error: `${name} can't be negative.` };
    const precision = decimal[2] ? Number(decimal[2]) : null;
    const scale = decimal[3] ? Number(decimal[3]) : 0;
    const whole = match[2].replace(/^0+(?=\d)/, "");
    const fraction = match[3] ?? "";
    if (precision !== null && fraction.length > scale) {
      return { ok: false, error: `${name} allows at most ${scale} decimal place${scale === 1 ? "" : "s"}.` };
    }
    if (precision !== null && whole.length > precision - scale) {
      return { ok: false, error: `${name} is too large for this column.` };
    }
    // Bound as a string: exact decimals must not pass through a float.
    return { ok: true, value: text };
  }

  if (/^(FLOAT|DOUBLE|REAL)/.test(type)) {
    const value = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(value) || String(raw).trim() === "") {
      return { ok: false, error: `${name} must be a number (got "${raw}").` };
    }
    return { ok: true, value };
  }

  if (type === "DATE") {
    const value = parseDate(String(raw));
    return value ? { ok: true, value } : { ok: false, error: `${name} must be a date like 2026-03-31 (got "${raw}").` };
  }

  if (/^(DATETIME|TIMESTAMP)/.test(type)) {
    const value = parseDateTime(String(raw));
    return value
      ? { ok: true, value }
      : { ok: false, error: `${name} must be a date and time like 2026-03-31 14:30 (got "${raw}").` };
  }

  if (/^TIME\b/.test(type)) {
    const value = parseTime(String(raw));
    return value ? { ok: true, value } : { ok: false, error: `${name} must be a time like 14:30 (got "${raw}").` };
  }

  if (/^YEAR/.test(type)) {
    const text = String(raw).trim();
    return /^\d{4}$/.test(text) ? { ok: true, value: Number(text) } : { ok: false, error: `${name} must be a year.` };
  }

  const options = enumValues(original);
  if (options) {
    const text = String(raw).trim().toLowerCase();
    const match = options.find((option) => option.toLowerCase() === text);
    return match !== undefined
      ? { ok: true, value: match }
      : { ok: false, error: `${name} must be one of: ${options.join(", ")} (got "${raw}").` };
  }

  if (/^JSON/.test(type)) {
    const text = String(raw);
    try {
      JSON.parse(text);
      return { ok: true, value: text };
    } catch {
      return { ok: false, error: `${name} must be valid JSON.` };
    }
  }

  if (type === "UUID") {
    const text = String(raw).trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
      ? { ok: true, value: text }
      : { ok: false, error: `${name} must be a UUID.` };
  }

  // Text and anything unrecognized: bound as a string, length-checked when
  // the type declares one.
  const text = String(raw);
  const length = /^(?:VARCHAR|CHAR|CHARACTER VARYING|CHARACTER|NVARCHAR|NCHAR|VARBINARY|BINARY)\((\d+)\)/.exec(type);
  if (length && text.length > Number(length[1])) {
    return { ok: false, error: `${name} can be at most ${length[1]} characters (got ${text.length}).` };
  }
  return { ok: true, value: text };
}

// --- Building ------------------------------------------------------------

/** Values become placeholders in the statement that runs and literals in
 * the one that is displayed; the same builder produces both. */
type Bind = (value: unknown) => string;

function placeholders(dialect: Dialect): { bind: Bind; params: unknown[] } {
  const params: unknown[] = [];
  return {
    params,
    bind: (value): string => {
      params.push(value);
      return dialect === "mysql" ? "?" : `$${params.length}`;
    },
  };
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

interface ResolvedCondition {
  column: ColumnInfo;
  op: Operator;
  value: unknown;
}

function whereClause(conditions: ResolvedCondition[], dialect: Dialect, bind: Bind): string {
  return conditions
    .map(({ column, op, value }) => {
      const name = quoteIdentifier(column.name, dialect);
      if (op === "is null") return `${name} IS NULL`;
      if (op === "is not null") return `${name} IS NOT NULL`;
      if (op === "in") return `${name} IN (${(value as unknown[]).map(bind).join(", ")})`;
      if (op === "like") return `${name} LIKE ${bind(value)}`;
      return `${name} ${op === "!=" ? "<>" : op} ${bind(value)}`;
    })
    .join(" AND ");
}

function describeCondition({ column, op, value }: ResolvedCondition): string {
  const name = label(column);
  if (op === "is null") return `${name} is empty`;
  if (op === "is not null") return `${name} is not empty`;
  if (op === "in") return `${name} is one of ${(value as unknown[]).map(String).join(", ")}`;
  if (op === "like") return `${name} matches "${value}"`;
  const words: Record<string, string> = { "=": "is", "!=": "is not", "<": "<", "<=": "≤", ">": ">", ">=": "≥" };
  return `${name} ${words[op]} ${String(value)}`;
}

function resolveConditions(
  table: TableInfo,
  where: PlanCondition[],
  dialect: Dialect,
  problems: string[],
): ResolvedCondition[] {
  const resolved: ResolvedCondition[] = [];

  for (const condition of where) {
    const column = findColumn(table, condition.column);
    if (!column) {
      problems.push(`There's no "${condition.column}" field in ${table.name} to pick rows by.`);
      continue;
    }
    let op = String(condition.op).toLowerCase() as Operator;
    if (!OPERATORS.has(op)) {
      problems.push(`I can't filter ${label(column)} with "${condition.op}".`);
      continue;
    }
    // `= null` never matches anything in SQL; the user meant "is empty".
    if ((op === "=" || op === "!=") && (condition.value === null || condition.value === undefined)) {
      op = op === "=" ? "is null" : "is not null";
    }

    if (op === "is null" || op === "is not null") {
      resolved.push({ column, op, value: null });
      continue;
    }
    if (op === "like") {
      resolved.push({ column, op, value: String(condition.value ?? "") });
      continue;
    }
    if (op === "in") {
      const list = Array.isArray(condition.value) ? condition.value : [condition.value as PlanValue];
      const values: unknown[] = [];
      for (const item of list) {
        const coerced = coerceValue(item as PlanValue, column, dialect);
        if (coerced.ok) values.push(coerced.value);
        else problems.push(coerced.error);
      }
      if (values.length === 0) problems.push(`I need at least one ${label(column)} to match.`);
      resolved.push({ column, op, value: values });
      continue;
    }

    const coerced = coerceValue(condition.value as PlanValue, column, dialect);
    if (coerced.ok) resolved.push({ column, op, value: coerced.value });
    else problems.push(coerced.error);
  }

  return resolved;
}

/**
 * Validates a plan against the schema and, if it holds up, builds the
 * statement. Never throws for a bad plan — every fault comes back as a
 * problem the user can answer.
 */
export function checkPlan(plan: WritePlan, blueprint: SchemaBlueprint): CheckResult {
  const dialect = blueprint.dialect;
  const problems: string[] = [];
  const notes: string[] = [];

  const table = findTable(blueprint, plan.table);
  if (!table) {
    return { ok: false, problems: [`There's no table called "${plan.table}" in this database.`], missing: [] };
  }
  if (table.isView) {
    return { ok: false, problems: [`${table.name} is a view, so it can't be changed directly.`], missing: [] };
  }

  const tableName = quoteIdentifier(table.name, dialect);

  // --- Values (insert row / update assignments) ---------------------------
  const assignments: Array<{ column: ColumnInfo; value: unknown }> = [];
  for (const [name, raw] of Object.entries(plan.values ?? {})) {
    const column = findColumn(table, name);
    if (!column) {
      problems.push(`There's no "${name}" field in ${table.name}.`);
      continue;
    }
    if (column.generated) {
      if (plan.operation === "update") {
        problems.push(`${label(column)} is set automatically by the database and can't be changed.`);
      } else {
        notes.push(`${label(column)} is set automatically, so the value given for it was left out.`);
      }
      continue;
    }
    const coerced = coerceValue(raw, column, dialect);
    if (coerced.ok) assignments.push({ column, value: coerced.value });
    else problems.push(coerced.error);
  }

  if (plan.operation === "insert") {
    const given = new Set(assignments.map(({ column }) => column.name));
    // Missing means: the user gave nothing for it, not that what they gave
    // was invalid — an invalid value is already a problem above.
    const attempted = new Set(Object.keys(plan.values ?? {}).map((name) => name.toLowerCase()));
    const missing = table.columns.filter(
      (column) =>
        !column.nullable &&
        !column.hasDefault &&
        !column.generated &&
        !given.has(column.name) &&
        !attempted.has(column.name.toLowerCase()),
    );

    if (problems.length > 0 || missing.length > 0) return { ok: false, problems, missing };
    if (assignments.length === 0) {
      return { ok: false, problems: [`What should the new ${table.name} row contain?`], missing: [] };
    }

    const statement = (bind: Bind): string => {
      const columns = assignments.map(({ column }) => quoteIdentifier(column.name, dialect)).join(", ");
      const values = assignments.map(({ value }) => bind(value)).join(", ");
      // Postgres reports no insert id on its own; ask for the key back.
      const key = table.columns.filter((column) => column.isPrimaryKey);
      const returning = dialect === "postgres" && key.length === 1 ? ` RETURNING ${quoteIdentifier(key[0].name, dialect)}` : "";
      return `INSERT INTO ${tableName} (${columns}) VALUES (${values})${returning}`;
    };
    const { bind, params } = placeholders(dialect);

    return {
      ok: true,
      write: {
        operation: "insert",
        table,
        sql: statement(bind),
        params,
        displaySql: statement(literal),
        countSql: null,
        previewSql: null,
        whereParams: [],
        assignments: assignments.map(({ column, value }) => ({ column: column.name, value })),
        summary: `Add a row to ${table.name}: ${assignments
          .map(({ column, value }) => `${label(column)} = ${value === null ? "empty" : String(value)}`)
          .join(", ")}.`,
        notes,
      },
    };
  }

  // --- Update / delete ----------------------------------------------------
  if (plan.operation === "update" && assignments.length === 0 && problems.length === 0) {
    problems.push(`What should change in ${table.name}?`);
  }

  if (!plan.where || plan.where.length === 0) {
    problems.push(`Which ${table.name} rows should this ${plan.operation} apply to?`);
  }
  const conditions = resolveConditions(table, plan.where ?? [], dialect, problems);

  if (problems.length > 0) return { ok: false, problems, missing: [] };

  for (const { column } of assignments) {
    if (column.isPrimaryKey) notes.push(`This changes ${label(column)}, which identifies the row.`);
  }

  const where = (bind: Bind): string => whereClause(conditions, dialect, bind);
  const statement = (bind: Bind): string =>
    plan.operation === "update"
      ? `UPDATE ${tableName} SET ${assignments
          .map(({ column, value }) => `${quoteIdentifier(column.name, dialect)} = ${bind(value)}`)
          .join(", ")} WHERE ${where(bind)}`
      : `DELETE FROM ${tableName} WHERE ${where(bind)}`;

  const run = placeholders(dialect);
  const sql = statement(run.bind);
  const probe = placeholders(dialect);
  const condition = where(probe.bind);
  const rowsWhere = conditions.map(describeCondition).join(" and ");

  return {
    ok: true,
    write: {
      operation: plan.operation,
      table,
      sql,
      params: run.params,
      displaySql: statement(literal),
      countSql: `SELECT COUNT(*) AS affected FROM ${tableName} WHERE ${condition}`,
      previewSql: `SELECT * FROM ${tableName} WHERE ${condition} LIMIT ${PREVIEW_ROWS}`,
      whereParams: probe.params,
      assignments: assignments.map(({ column, value }) => ({ column: column.name, value })),
      summary:
        plan.operation === "update"
          ? `In ${table.name}, set ${assignments
              .map(({ column, value }) => `${label(column)} to ${value === null ? "empty" : String(value)}`)
              .join(", ")} where ${rowsWhere}.`
          : `Delete rows from ${table.name} where ${rowsWhere}.`,
      notes,
    },
  };
}

/** What to ask when a plan does not hold up yet. */
export function followUpMessage(problems: string[], missing: ColumnInfo[]): string {
  const parts = [...problems];
  if (missing.length > 0) {
    const fields = missing.map((column) => `${label(column)} (${describeType(column)})`).join(", ");
    parts.push(`I still need: ${fields}.`);
  }
  return parts.join(" ");
}

/** A column's type in words, to tell the user what format is expected. */
export function describeType(column: ColumnInfo): string {
  const type = baseType(column.dataType);
  if (/^(TINYINT\(1\)|BOOLEAN|BOOL|BIT\(1\))/.test(type)) return "yes/no";
  if (/^(TINYINT|SMALLINT|MEDIUMINT|INTEGER|INT|BIGINT)/.test(type)) return "whole number";
  if (/^(DECIMAL|NUMERIC|DEC|FIXED|FLOAT|DOUBLE|REAL)/.test(type)) return "number";
  if (type === "DATE") return "date, YYYY-MM-DD";
  if (/^(DATETIME|TIMESTAMP)/.test(type)) return "date and time";
  if (/^TIME\b/.test(type)) return "time, HH:MM";
  const options = enumValues(column.dataType.replace(/\s+COLLATE\s+\S+$/i, "").trim());
  if (options) return `one of ${options.join(", ")}`;
  return "text";
}

/**
 * The blueprint the write planner reads: the usual empty CREATE TABLE, plus
 * which columns the database fills in itself. Kept separate from
 * `blueprintFor` so the read pipeline's prompt is unchanged.
 */
export function writeBlueprintFor(tables: TableInfo[]): string[] {
  return tables.map((table) => {
    const lines = table.columns.map((column) => {
      const flags = [
        column.nullable ? "" : "NOT NULL",
        column.generated ? "GENERATED" : "",
        column.hasDefault && !column.generated ? "DEFAULT" : "",
      ].filter(Boolean);
      return `  ${column.name} ${column.dataType}${flags.length ? ` ${flags.join(" ")}` : ""}`;
    });
    const key = table.columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
    if (key.length > 0) lines.push(`  PRIMARY KEY (${key.join(", ")})`);
    for (const fk of table.foreignKeys) {
      lines.push(`  FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencesTable}(${fk.referencesColumn})`);
    }
    return `CREATE ${table.isView ? "VIEW" : "TABLE"} ${table.name} (\n${lines.join(",\n")}\n);`;
  });
}
