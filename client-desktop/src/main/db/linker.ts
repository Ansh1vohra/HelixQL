import type { SchemaBlueprint, TableInfo } from "../../shared/types";
import * as gateway from "../gateway";
import { catalogLine, selectTablesByName, type SemanticScores } from "./rag";

/**
 * Schema linking — the primary table selector (see `rag.ts` for the two
 * rankers it sits above).
 *
 * Why a model call rather than more matching
 * ------------------------------------------
 * Neither keyword matching nor embeddings can tell that a `signup` table is
 * where users live while `ai_user_events` is an unrelated log. Measured
 * against bge-small, the decoy scored *higher* than the real table for
 * "how many users do we have" (0.517 vs 0.516) and for every rephrasing
 * tried — because for short identifier strings, embedding similarity is
 * itself largely driven by literal token overlap. A model that reads the
 * columns gets it right; `signup(id, email, password_hash, full_name)` is
 * obviously people, and `ai_user_events(id, event_name, payload)` is
 * obviously telemetry.
 *
 * Cost and containment
 * --------------------
 * One extra model call per question, on a prompt of table and column names
 * only. Two things keep it bounded:
 *
 *   - Large schemas are prefiltered locally first, so the catalog stays
 *     small no matter how big the database is. That prefilter is where the
 *     embedding ranker earns its place — it is much better at "which 40 of
 *     these 400 tables are plausible" than at the fine distinction above.
 *   - Every failure returns undefined, and the caller falls back to local
 *     pruning. A linker outage degrades table selection; it never fails a
 *     question.
 */

/**
 * Tables above which the catalog is prefiltered rather than sent whole.
 *
 * Sized so ordinary schemas are sent complete — the linker is most accurate
 * when it can see everything, and prefiltering reintroduces exactly the
 * ranking errors it exists to correct. Only schemas big enough to strain
 * the prompt get filtered.
 */
export const MAX_CATALOG_TABLES = 60;

export interface LinkedSchema {
  tables: TableInfo[];
  /** True when the catalog was prefiltered rather than sent whole — the
   * linker chose from a subset, so a miss may be the prefilter's fault. */
  prefiltered: boolean;
}

/**
 * Narrows a large schema to the tables worth showing the linker.
 *
 * Deliberately generous: this is a recall filter, not a decision. Anything
 * it drops is invisible to the linker, so it errs toward keeping tables.
 */
function prefilter(blueprint: SchemaBlueprint, semantic: SemanticScores | undefined): TableInfo[] {
  if (blueprint.tables.length <= MAX_CATALOG_TABLES) return blueprint.tables;
  if (!semantic || semantic.size === 0) return blueprint.tables.slice(0, MAX_CATALOG_TABLES);

  return [...blueprint.tables]
    .sort(
      (a, b) =>
        (semantic.get(b.name.toLowerCase()) ?? 0) - (semantic.get(a.name.toLowerCase()) ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_CATALOG_TABLES);
}

/**
 * Asks the gateway which tables the question needs.
 *
 * Returns `undefined` when linking is unavailable or produced nothing
 * usable. Callers must treat that as "fall back to local pruning", not as
 * an error — that is the whole reason this never throws.
 */
export async function linkSchema(
  blueprint: SchemaBlueprint,
  question: string,
  semantic?: SemanticScores,
): Promise<LinkedSchema | undefined> {
  if (blueprint.tables.length === 0) return undefined;

  const candidates = prefilter(blueprint, semantic);

  try {
    const { tables: names } = await gateway.linkSchema(question, candidates.map(catalogLine));

    // An empty selection is the model reporting that nothing in the catalog
    // fits. That is a real answer, but not an actionable one: the
    // translator produces a far better error message from a blueprint than
    // the client can from an empty list, so fall back and let it try.
    if (names.length === 0) return undefined;

    const tables = selectTablesByName(blueprint, names);
    if (tables.length === 0) return undefined;

    return { tables, prefiltered: candidates.length < blueprint.tables.length };
  } catch {
    // Swallowed by design — an unreachable gateway, a rate-limited
    // provider, or an unparseable reply all mean "rank it locally instead".
    return undefined;
  }
}
