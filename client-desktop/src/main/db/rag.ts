import type { SchemaBlueprint, TableInfo } from "../../shared/types";

/**
 * Isolated metadata RAG (Step 3 / FR-2.5).
 *
 * Hybrid ranking: deterministic lexical matching against local schema
 * names, optionally reinforced by semantic similarity from an embedding
 * model.
 *
 * The lexical half runs first and runs always. It is exact, offline, and
 * predictable — an admin can read `scoreTable` and know which tables a
 * question will expose. That property is worth keeping, so it remains the
 * floor: embeddings only ever *add* to a table's score, never subtract, so
 * a table the lexical pass would have selected is still selected.
 *
 * The semantic half exists because lexical matching has one failure it
 * cannot be patched out of: a table whose name shares no words with how
 * people talk about it. A `signup` table holding user records loses "how
 * many users?" to any table with the literal substring `user` in its name.
 * Stemming does not help — the words are lexically unrelated and mean the
 * same thing. Embeddings put them near each other in vector space.
 *
 * Semantic scoring is strictly optional. When `semantic` is omitted (no
 * HF_TOKEN configured, the embed call failed, the machine is offline) this
 * degrades to exactly the lexical behaviour that shipped before.
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

/**
 * Cosine similarity below this contributes nothing.
 *
 * BGE embeddings are not centered on zero — two unrelated short strings
 * still score around 0.3-0.5, so treating raw cosine as a score would give
 * every table in the schema a participation trophy and flatten the ranking.
 * The floor is what makes a semantic hit mean something.
 */
export const SEMANTIC_FLOOR = 0.45;

/**
 * Points a perfect semantic match is worth.
 *
 * Deliberately below the 10 an exact whole-table-name match scores, which
 * fixes the invariant that makes this hybrid safe to reason about: **no
 * embedding score can ever outrank a table the user named outright.** The
 * model reorders tables the keywords were ambiguous about; it never
 * overrules an unambiguous one.
 *
 * It still comfortably clears a partial name hit — one word in three of
 * `ai_user_events` scores 3.3, while `signup` at cosine 0.8 scores 6.0 —
 * which is the case this whole mechanism exists to fix.
 */
export const SEMANTIC_WEIGHT = 9;

/** Table name → cosine similarity against the question, keyed lowercase. */
export type SemanticScores = Map<string, number>;

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

function lexicalScore(table: TableInfo, tokens: string[]): number {
  const tableParts = new Set(identifierParts(table.name));
  const columnParts = new Set(table.columns.flatMap((column) => identifierParts(column.name)));

  let score = 0;

  for (const token of tokens) {
    const forms = variants(token);

    // A table-name hit is the strongest signal available — but scaled by how
    // much of the name it actually accounts for. Matching "user" against
    // `users` is the whole name; matching it against `ai_user_events` is one
    // word in three, and mostly says the table is about *events*. Scoring
    // both at 10 is what let an unrelated `ai_user_*` table outrank the real
    // user table on "how many users do we have".
    if (forms.some((form) => tableParts.has(form))) {
      score += 10 / Math.max(tableParts.size, 1);
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
 * Rescales cosine similarity into the lexical point scale.
 *
 * Linear from the floor upward: a similarity that only just clears
 * SEMANTIC_FLOOR is worth almost nothing, and the points climb from there.
 * That shape matters — a soft threshold would let a schema's worth of
 * mediocre matches accumulate past one genuine hit.
 */
export function semanticPoints(similarity: number): number {
  if (!Number.isFinite(similarity) || similarity < SEMANTIC_FLOOR) return 0;
  return ((similarity - SEMANTIC_FLOOR) / (1 - SEMANTIC_FLOOR)) * SEMANTIC_WEIGHT;
}

function scoreTable(table: TableInfo, tokens: string[], semantic?: SemanticScores): number {
  const lexical = lexicalScore(table, tokens);
  if (!semantic) return lexical;

  return lexical + semanticPoints(semantic.get(table.name.toLowerCase()) ?? 0);
}

/**
 * Renders a table as the sentence an embedding model is asked to match
 * against.
 *
 * Identifiers are split on their separators (`full_name` → "full name",
 * `signupDate` → "signup date") because the model was trained on prose, not
 * on snake_case. Embedding the raw identifier wastes most of what the model
 * knows: `user_signup_log` tokenizes poorly, "user signup log" does not.
 *
 * Columns are included, not just the table name. They are often the only
 * place the real subject appears — a `signup` table gives itself away
 * through `email`, `password_hash`, `full_name`, and that is exactly the
 * signal that rescues "how many users do we have?".
 */
export function describeTable(table: TableInfo): string {
  const name = identifierParts(table.name).join(" ") || table.name;
  const columns = table.columns
    .map((column) => identifierParts(column.name).join(" ") || column.name)
    .join(", ");

  return columns ? `Table ${name}. Columns: ${columns}.` : `Table ${name}.`;
}

/** Dot product of two L2-normalized vectors, i.e. their cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
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

/**
 * Renders a table as one compact catalog line for the schema linker:
 * `name(col, col, ...)`.
 *
 * Identifiers keep their exact spelling here, unlike `describeTable` —
 * these names come back from the model and are looked up directly, so
 * splitting them into words would break the round trip. Types and keys are
 * omitted: they cost tokens on every table and say nothing about which
 * table a question is *about*.
 */
export function catalogLine(table: TableInfo): string {
  return `${table.name}(${table.columns.map((column) => column.name).join(", ")})`;
}

/**
 * Builds the blueprint for an explicit set of table names, expanding over
 * foreign keys the same way `pruneSchema` does.
 *
 * Used for the schema linker's selection. The FK expansion still applies
 * because a model asked for "the tables needed" reliably names the ones the
 * question is about and less reliably names the one it has to join through.
 *
 * Unknown names are ignored rather than trusted — the gateway already
 * filters them, and this is the second place that check has to hold.
 */
export function selectTablesByName(blueprint: SchemaBlueprint, names: string[]): TableInfo[] {
  const byName = new Map(blueprint.tables.map((table) => [table.name.toLowerCase(), table]));
  const selected = new Map<string, TableInfo>();

  for (const name of names) {
    const table = byName.get(name.trim().toLowerCase());
    if (table) selected.set(table.name.toLowerCase(), table);
  }

  if (selected.size === 0) return [];

  expandOverForeignKeys(selected, byName, MAX_TABLES_SENT);
  return Array.from(selected.values());
}

export interface PrunedSchema {
  tables: TableInfo[];
  /** True when nothing matched and a bounded fallback slice was used. */
  usedFallback: boolean;
  /** True when embedding scores contributed to the ranking. Surfaced so the
   * diagnostics panel can show whether a run was ranked semantically or fell
   * back to lexical matching. */
  usedSemantic: boolean;
}

/**
 * Prune the full local schema down to the tables a question actually needs.
 *
 * `semantic` is optional by design — see the module header. Pass it to rank
 * by meaning as well as spelling; omit it for pure lexical pruning.
 */
export function pruneSchema(
  blueprint: SchemaBlueprint,
  question: string,
  semantic?: SemanticScores,
): PrunedSchema {
  const tokens = tokenize(question);
  const byName = new Map(blueprint.tables.map((table) => [table.name.toLowerCase(), table]));

  const scored = blueprint.tables
    .map((table) => ({ table, score: scoreTable(table, tokens, semantic) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.table.name.localeCompare(b.table.name));

  const usedSemantic = semantic !== undefined && semantic.size > 0;

  if (scored.length === 0) {
    return {
      tables: blueprint.tables.slice(0, MAX_FALLBACK_TABLES),
      usedFallback: true,
      usedSemantic,
    };
  }

  const selected = new Map<string, TableInfo>();
  for (const entry of scored.slice(0, MAX_TABLES_SENT)) {
    selected.set(entry.table.name.toLowerCase(), entry.table);
  }

  expandOverForeignKeys(selected, byName, MAX_TABLES_SENT);

  return { tables: Array.from(selected.values()), usedFallback: false, usedSemantic };
}
