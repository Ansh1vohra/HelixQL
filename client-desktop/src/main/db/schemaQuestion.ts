import type { ResultGrid, SchemaBlueprint, TableInfo } from "../../shared/types";

/**
 * Questions about the schema itself — "what columns does users have?",
 * "list all tables" — answered from the local blueprint.
 *
 * The translator cannot answer these: it is told to use only the tables in
 * the blueprint, and the blueprint describes the user's tables, not the
 * catalog views (`information_schema`) that would list them. So it reports
 * the question unanswerable, and so does the clarifier. The blueprint
 * already holds every name and type the answer needs, so the honest fix is
 * to read it here: no model call, no query against the database, nothing
 * leaves this machine and nothing is metered.
 *
 * Detection is deliberately conservative. A miss costs nothing — the
 * question goes to the model exactly as before — while a false hit would
 * answer a data question with a column list. Anything that looks like it
 * filters or names a specific column is left to the model.
 */

export type SchemaQuestion = { kind: "columns"; tables: TableInfo[] } | { kind: "tables" };

/** Words that ask about a table's structure regardless of which table. */
const STRUCTURE_WORDS = new Set(["columns", "fields", "attributes", "schema", "structure", "structures"]);

/** Only count as a structure question when a table is named alongside them —
 * "describe the sales trend" is a data question. */
const DESCRIBE_WORDS = new Set(["describe", "desc"]);

/** Words that turn "fields" into a filter: "orders with missing fields". */
const FILTER_WORDS = new Set(["where", "with", "without", "missing", "null", "empty", "having", "contain", "contains"]);

function tokens(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

/** Singular/plural forms, so "users" finds `user` and "order" finds `orders`. */
function forms(name: string): string[] {
  const lower = name.toLowerCase();
  const out = new Set([lower, `${lower}s`]);
  if (lower.endsWith("s") && lower.length > 3) out.add(lower.slice(0, -1));
  if (lower.endsWith("ies") && lower.length > 4) out.add(`${lower.slice(0, -3)}y`);
  return Array.from(out);
}

/** Tables the question names, either as written (`order_items`) or as
 * words ("order items"). A name inside a longer match is not its own
 * mention: "order items" names `order_items`, not also `orders`. */
function namedTables(blueprint: SchemaBlueprint, words: string[]): TableInfo[] {
  const text = ` ${words.join(" ").replace(/_/g, " ")} `;

  const matches = blueprint.tables.flatMap((table) => {
    const phrase = forms(table.name)
      .map((form) => form.replace(/_/g, " "))
      .find((form) => text.includes(` ${form} `));
    return phrase ? [{ table, phrase }] : [];
  });

  return matches
    .filter(
      ({ phrase }) =>
        !matches.some((other) => other.phrase.length > phrase.length && ` ${other.phrase} `.includes(` ${phrase} `)),
    )
    .map(({ table }) => table);
}

export function matchSchemaQuestion(question: string, blueprint: SchemaBlueprint): SchemaQuestion | null {
  const words = tokens(question);
  if (words.length === 0 || words.some((word) => FILTER_WORDS.has(word))) return null;

  const asksStructure = words.some((word) => STRUCTURE_WORDS.has(word));
  const asksDescribe = words.some((word) => DESCRIBE_WORDS.has(word));
  const tables = namedTables(blueprint, words);

  if (asksStructure || (asksDescribe && tables.length > 0)) {
    // Naming a real column ("show the email and name columns from users")
    // asks for those columns' data, not for the list of columns.
    const columnNames = new Set(tables.flatMap((table) => table.columns.map((column) => column.name.toLowerCase())));
    const tableWords = new Set(tables.flatMap((table) => forms(table.name).flatMap((form) => form.split("_"))));
    if (words.some((word) => columnNames.has(word) && !tableWords.has(word))) return null;

    return { kind: "columns", tables: tables.length > 0 ? tables : blueprint.tables };
  }

  if (words.includes("tables") && tables.length === 0) {
    return { kind: "tables" };
  }

  return null;
}

function keyLabel(table: TableInfo, column: string, isPrimaryKey: boolean): string {
  const references = table.foreignKeys
    .filter((fk) => fk.column === column)
    .map((fk) => `FK → ${fk.referencesTable}.${fk.referencesColumn}`);
  return [isPrimaryKey ? "PK" : "", ...references].filter(Boolean).join(", ");
}

export function schemaAnswerGrid(match: SchemaQuestion, blueprint: SchemaBlueprint): ResultGrid {
  if (match.kind === "tables") {
    return {
      columns: ["table", "columns"],
      rows: blueprint.tables.map((table) => ({ table: table.name, columns: table.columns.length })),
    };
  }

  return {
    columns: ["table", "column", "type", "nullable", "key"],
    rows: match.tables.flatMap((table) =>
      table.columns.map((column) => ({
        table: table.name,
        column: column.name,
        type: column.dataType,
        nullable: column.nullable ? "YES" : "NO",
        key: keyLabel(table, column.name, column.isPrimaryKey),
      })),
    ),
  };
}
