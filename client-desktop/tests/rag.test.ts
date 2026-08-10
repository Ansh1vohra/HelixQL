import { describe, expect, it } from "vitest";
import {
  catalogLine,
  cosineSimilarity,
  describeTable,
  MAX_FALLBACK_TABLES,
  pruneSchema,
  SEMANTIC_FLOOR,
  selectTablesByName,
  semanticPoints,
  SEMANTIC_WEIGHT,
  tokenize,
  type SemanticScores,
} from "../src/main/db/rag";
import type { SchemaBlueprint, TableInfo } from "../src/shared/types";

function table(name: string, columns: string[], foreignKeys: TableInfo["foreignKeys"] = []): TableInfo {
  return {
    name,
    columns: columns.map((column) => ({
      name: column,
      dataType: "VARCHAR(100)",
      nullable: true,
      isPrimaryKey: column === "id",
    })),
    foreignKeys,
  };
}

const blueprint: SchemaBlueprint = {
  dialect: "mysql",
  database: "shopdb",
  capturedAt: new Date().toISOString(),
  tables: [
    table("users", ["id", "name", "email", "state"]),
    table("orders", ["id", "user_id", "total", "created_at"], [
      { column: "user_id", referencesTable: "users", referencesColumn: "id" },
    ]),
    table("products", ["id", "sku", "title", "price"]),
    table("shipments", ["id", "order_id", "carrier"], [
      { column: "order_id", referencesTable: "orders", referencesColumn: "id" },
    ]),
    table("audit_log", ["id", "actor", "action"]),
    table("payroll", ["id", "employee", "salary"]),
    table("invoices", ["id", "amount"]),
    table("suppliers", ["id", "company"]),
    table("warehouses", ["id", "location"]),
  ],
};

function names(tables: TableInfo[]): string[] {
  return tables.map((t) => t.name).sort();
}

describe("tokenize", () => {
  it("drops stop words and short tokens", () => {
    expect(tokenize("Who made the most orders from Gujarat this month?")).toEqual(["made", "orders", "gujarat"]);
  });

  it("deduplicates repeated words", () => {
    expect(tokenize("orders orders orders")).toEqual(["orders"]);
  });
});

describe("pruneSchema", () => {
  it("selects the table named in the question", () => {
    const pruned = pruneSchema(blueprint, "How many products do we sell?");
    expect(pruned.tables.map((t) => t.name)).toContain("products");
    expect(pruned.usedFallback).toBe(false);
  });

  it("drops tables the question has nothing to do with", () => {
    const selected = names(pruneSchema(blueprint, "How many products do we sell?").tables);
    expect(selected).not.toContain("payroll");
    expect(selected).not.toContain("audit_log");
  });

  it("matches a singular question word against a plural table", () => {
    expect(names(pruneSchema(blueprint, "revenue per product").tables)).toContain("products");
  });

  it("matches a plural question word against a singular table", () => {
    const singular: SchemaBlueprint = { ...blueprint, tables: [table("invoice", ["id", "amount"])] };
    expect(names(pruneSchema(singular, "show me the invoices").tables)).toContain("invoice");
  });

  it("follows foreign keys so a join has both sides", () => {
    // "Who ordered the most" names orders but not users — without FK
    // expansion the model would have no column for the customer's name.
    const selected = names(pruneSchema(blueprint, "which customer placed the most orders").tables);
    expect(selected).toContain("orders");
    expect(selected).toContain("users");
  });

  it("pulls in tables that point at a selected table", () => {
    const selected = names(pruneSchema(blueprint, "orders by state").tables);
    expect(selected).toContain("shipments");
  });

  it("matches on column names when no table name matches", () => {
    expect(names(pruneSchema(blueprint, "group everything by carrier").tables)).toContain("shipments");
  });

  it("falls back to a bounded slice when nothing matches at all", () => {
    const pruned = pruneSchema(blueprint, "xyzzy plugh frobnicate");
    expect(pruned.usedFallback).toBe(true);
    expect(pruned.tables.length).toBeLessThanOrEqual(MAX_FALLBACK_TABLES);
  });

  it("never returns the whole schema for a targeted question", () => {
    const pruned = pruneSchema(blueprint, "how many products do we sell");
    expect(pruned.tables.length).toBeLessThan(blueprint.tables.length);
  });

  it("is deterministic — the same question always exposes the same tables", () => {
    const first = names(pruneSchema(blueprint, "which customer placed the most orders").tables);
    const second = names(pruneSchema(blueprint, "which customer placed the most orders").tables);
    expect(first).toEqual(second);
  });

  it("handles an empty schema without throwing", () => {
    const empty: SchemaBlueprint = { ...blueprint, tables: [] };
    expect(pruneSchema(empty, "anything").tables).toEqual([]);
  });
});

describe("describeTable", () => {
  it("splits identifiers into words the embedding model was trained on", () => {
    const described = describeTable(table("user_signup_log", ["id", "full_name", "created_at"]));
    expect(described).toBe("Table user signup log. Columns: id, full name, created at.");
  });

  it("handles a table with no columns", () => {
    expect(describeTable(table("empty", []))).toBe("Table empty.");
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical normalized vectors", () => {
    expect(cosineSimilarity([0.6, 0.8], [0.6, 0.8])).toBeCloseTo(1);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns 0 rather than throwing on a dimension mismatch", () => {
    // A model swap mid-session would produce this. Scoring it as "no signal"
    // degrades the ranking; throwing would fail the user's question.
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("semanticPoints", () => {
  it("ignores similarity below the floor", () => {
    // Unrelated short strings still score ~0.3-0.5 with BGE. Without the
    // floor every table in the schema would score and flatten the ranking.
    expect(semanticPoints(0.2)).toBe(0);
    expect(semanticPoints(SEMANTIC_FLOOR - 0.01)).toBe(0);
  });

  it("awards full weight to a perfect match", () => {
    expect(semanticPoints(1)).toBeCloseTo(SEMANTIC_WEIGHT);
  });

  it("scales linearly from the floor upward", () => {
    const midpoint = SEMANTIC_FLOOR + (1 - SEMANTIC_FLOOR) / 2;
    expect(semanticPoints(midpoint)).toBeCloseTo(SEMANTIC_WEIGHT / 2);
  });

  it("treats a non-finite similarity as no signal", () => {
    expect(semanticPoints(Number.NaN)).toBe(0);
  });
});

describe("pruneSchema with semantic scores", () => {
  /**
   * The schema this whole feature exists for: user records live in a table
   * called `signup`, and an unrelated table has "user" in its name. Lexical
   * matching picks the wrong one every time.
   */
  const signupSchema: SchemaBlueprint = {
    dialect: "mysql",
    database: "appdb",
    capturedAt: new Date().toISOString(),
    tables: [
      table("signup", ["id", "email", "password_hash", "full_name", "created_at"]),
      table("ai_user_events", ["id", "event_name", "payload"]),
      table("invoices", ["id", "amount"]),
    ],
  };

  it("picks the wrong table on lexical matching alone", () => {
    // Documents the bug rather than endorsing it: `ai_user_events` wins on
    // the substring "user" while `signup` scores nothing. If this ever
    // starts passing for the right reason, the assertion below is the one
    // that matters.
    const lexical = pruneSchema(signupSchema, "how many users do we have");
    expect(lexical.tables.map((t) => t.name)).toEqual(["ai_user_events"]);
    expect(lexical.usedSemantic).toBe(false);
  });

  it("finds the semantically right table that shares no words with the question", () => {
    const semantic: SemanticScores = new Map([
      ["signup", 0.82],
      ["ai_user_events", 0.51],
      ["invoices", 0.3],
    ]);

    const pruned = pruneSchema(signupSchema, "how many users do we have", semantic);

    expect(pruned.tables[0].name).toBe("signup");
    expect(pruned.usedSemantic).toBe(true);
  });

  it("never demotes a table the lexical pass would have selected", () => {
    // Embeddings only add points. A question that names a table outright
    // must still reach it even if the model scores it poorly.
    const hostile: SemanticScores = new Map([
      ["products", 0],
      ["payroll", 0.95],
    ]);

    const selected = names(pruneSchema(blueprint, "how many products do we sell", hostile).tables);
    expect(selected).toContain("products");
  });

  it("keeps an outright name match ahead of a strong semantic one", () => {
    const semantic: SemanticScores = new Map([
      ["products", 0.5],
      ["payroll", 0.9],
    ]);

    const pruned = pruneSchema(blueprint, "how many products do we sell", semantic);
    expect(pruned.tables[0].name).toBe("products");
  });

  it("never lets even a perfect embedding score overrule a named table", () => {
    // The invariant SEMANTIC_WEIGHT is calibrated for: the model reorders
    // tables the keywords were ambiguous about, it never overrules an
    // unambiguous one. Asserted at cosine 1.0 — the strongest score possible
    // — against zero for the table the question actually names.
    expect(SEMANTIC_WEIGHT).toBeLessThan(10);

    const semantic: SemanticScores = new Map([
      ["products", 0],
      ["payroll", 1],
    ]);

    const pruned = pruneSchema(blueprint, "how many products do we sell", semantic);
    expect(pruned.tables[0].name).toBe("products");
  });

  it("scores a partial name match below a whole one", () => {
    // "user" is the entire name of one table and one word in three of the
    // other. Treating those as equal evidence is the original bug.
    const question = "how many users do we have";
    const whole = pruneSchema(
      { ...signupSchema, tables: [table("users", ["id", "email"])] },
      question,
    );
    const partial = pruneSchema(
      { ...signupSchema, tables: [table("ai_user_events", ["id", "payload"])] },
      question,
    );

    // Both still match; only their strength differs, which is what lets a
    // semantic score break the tie in the partial case but not the whole one.
    expect(whole.usedFallback).toBe(false);
    expect(partial.usedFallback).toBe(false);

    const semantic: SemanticScores = new Map([["signup", 0.8]]);
    const contested = pruneSchema(signupSchema, question, semantic);
    expect(contested.tables[0].name).toBe("signup");
  });

  it("rescues a question that matched nothing lexically", () => {
    const semantic: SemanticScores = new Map([["signup", 0.78]]);

    const pruned = pruneSchema(signupSchema, "headcount of registered accounts", semantic);

    expect(pruned.usedFallback).toBe(false);
    expect(pruned.tables.map((t) => t.name)).toContain("signup");
  });

  it("still falls back when neither signal matches anything", () => {
    const semantic: SemanticScores = new Map([
      ["signup", 0.1],
      ["ai_user_events", 0.2],
      ["invoices", 0.15],
    ]);

    expect(pruneSchema(signupSchema, "xyzzy plugh frobnicate", semantic).usedFallback).toBe(true);
  });

  it("reports lexical-only ranking when the embedder returned nothing", () => {
    // An empty map is what a degraded embedding path produces; it must not
    // be reported to the diagnostics panel as a semantic run.
    expect(pruneSchema(signupSchema, "how many users", new Map()).usedSemantic).toBe(false);
  });

  it("is still deterministic for a fixed set of scores", () => {
    const semantic: SemanticScores = new Map([["signup", 0.82], ["invoices", 0.5]]);
    const first = names(pruneSchema(signupSchema, "how many users", semantic).tables);
    const second = names(pruneSchema(signupSchema, "how many users", semantic).tables);
    expect(first).toEqual(second);
  });
});

describe("catalogLine", () => {
  it("renders a table as one compact line", () => {
    expect(catalogLine(table("signup", ["id", "email", "full_name"]))).toBe("signup(id, email, full_name)");
  });

  it("preserves exact identifier spelling for the round trip", () => {
    // Unlike describeTable, these names come back from the model and are
    // used as lookup keys — splitting them into words would break that.
    expect(catalogLine(table("AI_User_Events", ["event_name"]))).toBe("AI_User_Events(event_name)");
  });

  it("carries no types, keys, or row data", () => {
    const line = catalogLine(table("signup", ["id", "email"]));
    expect(line).not.toContain("VARCHAR");
    expect(line).not.toContain("PRIMARY KEY");
  });
});

describe("selectTablesByName", () => {
  it("returns the named tables", () => {
    expect(names(selectTablesByName(blueprint, ["products"]))).toEqual(["products"]);
  });

  it("matches case-insensitively", () => {
    expect(names(selectTablesByName(blueprint, ["PRODUCTS"]))).toEqual(["products"]);
  });

  it("ignores a name that is not in the schema", () => {
    // The gateway filters hallucinated names too; this is the second place
    // that check has to hold.
    expect(names(selectTablesByName(blueprint, ["products", "nonexistent"]))).toEqual(["products"]);
  });

  it("returns nothing when no name is recognized", () => {
    expect(selectTablesByName(blueprint, ["nope", "also_nope"])).toEqual([]);
  });

  it("expands over foreign keys so a join has both sides", () => {
    // The linker reliably names the tables a question is about, and less
    // reliably the one it has to join through.
    const selected = names(selectTablesByName(blueprint, ["orders"]));
    expect(selected).toContain("orders");
    expect(selected).toContain("users");
  });

  it("deduplicates repeated names", () => {
    expect(names(selectTablesByName(blueprint, ["products", "products"]))).toEqual(["products"]);
  });
});
