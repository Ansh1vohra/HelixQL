import type { SchemaBlueprint } from "../../shared/types";
import * as gateway from "../gateway";
import { cosineSimilarity, describeTable, type SemanticScores } from "./rag";

/**
 * Semantic half of the metadata RAG step (see `rag.ts` for why it exists).
 *
 * This module's job is to turn a question plus a schema into a per-table
 * similarity map, and — just as importantly — to fail quietly. Embeddings
 * make table ranking better; they are never allowed to make a question
 * unanswerable. Every failure path here returns `undefined`, which
 * `pruneSchema` reads as "rank lexically", exactly as it did before this
 * existed.
 *
 * Schema vectors are cached per schema fingerprint. One `CREATE TABLE`
 * layout is embedded once, not once per question — that is what keeps the
 * recurring upstream traffic down to the question text.
 */

interface SchemaVectors {
  fingerprint: string;
  /** Lowercased table name → its embedding. */
  byTable: Map<string, number[]>;
}

let cache: SchemaVectors | null = null;

/**
 * Identifies a schema *shape*, so the cache survives a reconnect to the
 * same database but is dropped the moment a column appears or disappears.
 *
 * Built from the same text that gets embedded rather than from
 * `capturedAt`: a schema refresh that changed nothing should not throw away
 * vectors we already paid for, and one that added a column must.
 */
function fingerprint(blueprint: SchemaBlueprint): string {
  return `${blueprint.database}::${blueprint.tables.map(describeTable).join("|")}`;
}

/** Discards cached vectors. Called on disconnect so a new connection never
 * scores against the previous database's schema. */
export function clearEmbeddingCache(): void {
  cache = null;
}

async function schemaVectors(blueprint: SchemaBlueprint): Promise<SchemaVectors | null> {
  const current = fingerprint(blueprint);
  if (cache && cache.fingerprint === current) return cache;

  const tables = blueprint.tables;
  if (tables.length === 0) return null;

  const { vectors } = await gateway.embed(tables.map(describeTable), false);
  if (vectors.length !== tables.length) return null;

  cache = {
    fingerprint: current,
    byTable: new Map(tables.map((table, index) => [table.name.toLowerCase(), vectors[index]])),
  };
  return cache;
}

export interface SemanticResult {
  scores: SemanticScores;
  /** Set when the schema had to be embedded on this call rather than served
   * from cache — the slow path, worth showing in diagnostics. */
  embeddedSchema: boolean;
}

/**
 * Scores every table against the question by cosine similarity.
 *
 * Returns `undefined` when semantic ranking is unavailable for any reason
 * — no HF_TOKEN on the gateway, an upstream outage, an offline machine.
 * Callers must treat that as "use lexical ranking", not as an error.
 */
export async function semanticScores(
  blueprint: SchemaBlueprint,
  question: string,
): Promise<SemanticResult | undefined> {
  try {
    const hadCache = cache !== null && cache.fingerprint === fingerprint(blueprint);

    // Question first: if embeddings are unavailable this fails on one small
    // request, before spending a whole-schema batch to find that out.
    const { vectors } = await gateway.embed([question], true);
    const questionVector = vectors[0];
    if (!questionVector) return undefined;

    const schema = await schemaVectors(blueprint);
    if (!schema) return undefined;

    const scores: SemanticScores = new Map();
    for (const [name, vector] of schema.byTable) {
      scores.set(name, cosineSimilarity(questionVector, vector));
    }

    return { scores, embeddedSchema: !hadCache };
  } catch {
    // Deliberately swallowed. The gateway reports EMBEDDINGS_UNAVAILABLE
    // when HF_TOKEN is unset or the API is down, and neither is a reason to
    // refuse the user an answer — lexical pruning still works.
    return undefined;
  }
}
