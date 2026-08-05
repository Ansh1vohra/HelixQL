import type { SchemaBlueprint, TableInfo } from "../../shared/types";

/**
 * Isolated metadata RAG (Step 3 / FR-2.5).
 *
 * Deliberately deterministic — keyword matching against local schema names,
 * no embeddings and no model call. Two reasons: the pruning step must run
 * before anything leaves the machine, and an admin has to be able to
 * predict exactly which tables a question will expose. A similarity model
 * would make that unauditable.
 */

/** Words that carry no schema signal. Matching on "the" would select every
 * table with a "theme" column and defeat the pruning entirely. */
const STOP_WORDS = new Set([
  "a", "about", "an", "and", "any", "are", "as", "at", "be", "been", "between", "but", "by", "can", "did", "do",
  "does", "each", "for", "from", "get", "give", "had", "has", "have", "how", "i", "in", "is", "it", "its",
  "just", "last", "list", "many", "me", "month", "most", "much", "my", "of", "on", "or", "our", "out", "over",
  "per", "please", "show", "since", "so", "some", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "to", "top", "total", "up", "us", "was", "we", "were", "what", "when", "where",
  "which", "who", "whom", "whose", "why", "will", "with", "year", "you", "your",
]);

const MIN_TOKEN_LENGTH = 3;

/** Cap on tables sent upstream. Large schemas would otherwise blow past the
 * model's context window and re-expose the whole layout we just pruned. */
export const MAX_TABLES_SENT = 12;

/** When nothing matches, sending a bounded slice beats sending nothing —
 * the model can still answer, and the gateway reports UNANSWERABLE if not. */
export const MAX_FALLBACK_TABLES = 8;

export function tokenize(question: string): string[] {
  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token));

  return Array.from(new Set(tokens));
}

/**
 * Crude singular/plural folding so "orders" in the question matches an
 * `order` table and vice versa. A stemmer would be more thorough, but this
 * covers the naming conventions real schemas actually use.
 */
function variants(token: string): string[] {
  const forms = new Set<string>([token]);
  if (token.endsWith("ies") && token.length > 4) forms.add(`${token.slice(0, -3)}y`);
  if (token.endsWith("es") && token.length > 3) forms.add(token.slice(0, -2));
  if (token.endsWith("s") && token.length > 3) forms.add(token.slice(0, -1));
  forms.add(`${token}s`);
  return Array.from(forms);
}

function identifierParts(identifier: string): string[] {
  return identifier
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreTable(table: TableInfo, tokens: string[]): number {
  const tableParts = new Set(identifierParts(table.name));
  const columnParts = new Set(table.columns.flatMap((column) => identifierParts(column.name)));

  let score = 0;

  for (const token of tokens) {
    const forms = variants(token);

    // A table-name hit is the strongest signal available.
    if (forms.some((form) => tableParts.has(form))) {
      score += 10;
      continue;
    }
    if (forms.some((form) => table.name.toLowerCase().includes(form))) {
      score += 5;
      continue;
    }
    if (forms.some((form) => columnParts.has(form))) {
      score += 3;
      continue;
    }
    if (forms.some((form) => form.length > 4 && [...columnParts].some((part) => part.includes(form)))) {
      score += 1;
    }
  }

  return score;
}

/**
 * Pulls in tables one foreign-key hop away from a match.
 *
 * "Who ordered the most?" names orders but not users, yet answering it
 * needs both. Without this expansion the model would have no way to reach
 * the customer's name and would hallucinate a column instead — which is
 * exactly the failure the self-heal loop then burns attempts on.
 */
function expandOverForeignKeys(
  selected: Map<string, TableInfo>,
  byName: Map<string, TableInfo>,
  limit: number,
): void {
  const seeds = Array.from(selected.values());

  for (const table of seeds) {
    for (const fk of table.foreignKeys) {
      if (selected.size >= limit) return;
      const referenced = byName.get(fk.referencesTable.toLowerCase());
      if (referenced && !selected.has(referenced.name.toLowerCase())) {
        selected.set(referenced.name.toLowerCase(), referenced);
      }
    }
  }

  // Also reach the other way: a table whose FK points *at* a selected table
  // (orders → users) is just as relevant as one pointed away from it.
  for (const table of byName.values()) {
    if (selected.size >= limit) return;
    if (selected.has(table.name.toLowerCase())) continue;

    const pointsAtSelection = table.foreignKeys.some((fk) => selected.has(fk.referencesTable.toLowerCase()));
    if (pointsAtSelection) {
      selected.set(table.name.toLowerCase(), table);
    }
  }
}

export interface PrunedSchema {
  tables: TableInfo[];
  /** True when nothing matched and a bounded fallback slice was used. */
  usedFallback: boolean;
}

/**
 * Prune the full local schema down to the tables a question actually needs.
 */
export function pruneSchema(blueprint: SchemaBlueprint, question: string): PrunedSchema {
  const tokens = tokenize(question);
  const byName = new Map(blueprint.tables.map((table) => [table.name.toLowerCase(), table]));

  const scored = blueprint.tables
    .map((table) => ({ table, score: scoreTable(table, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.table.name.localeCompare(b.table.name));

  if (scored.length === 0) {
    return {
      tables: blueprint.tables.slice(0, MAX_FALLBACK_TABLES),
      usedFallback: true,
    };
  }

  const selected = new Map<string, TableInfo>();
  for (const entry of scored.slice(0, MAX_TABLES_SENT)) {
    selected.set(entry.table.name.toLowerCase(), entry.table);
  }

  expandOverForeignKeys(selected, byName, MAX_TABLES_SENT);

  return { tables: Array.from(selected.values()), usedFallback: false };
}
