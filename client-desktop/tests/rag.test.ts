import { describe, expect, it } from "vitest";
import { MAX_FALLBACK_TABLES, pruneSchema, tokenize } from "../src/main/db/rag";
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
