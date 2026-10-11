import { describe, expect, it } from "vitest";
import { matchSchemaQuestion, schemaAnswerGrid } from "../src/main/db/schemaQuestion";
import type { SchemaBlueprint, TableInfo } from "../src/shared/types";

function table(name: string, columns: string[], foreignKeys: TableInfo["foreignKeys"] = []): TableInfo {
  return {
    name,
    columns: columns.map((column) => ({
      name: column,
      dataType: "VARCHAR(100)",
      nullable: column !== "id",
      isPrimaryKey: column === "id",
    })),
    foreignKeys,
  };
}

const blueprint: SchemaBlueprint = {
  dialect: "postgres",
  database: "shop",
  capturedAt: "2026-01-01T00:00:00.000Z",
  tables: [
    table("users", ["id", "email", "name"]),
    table("orders", ["id", "user_id", "amount"], [
      { column: "user_id", referencesTable: "users", referencesColumn: "id" },
    ]),
    table("order_items", ["id", "order_id", "sku"]),
  ],
};

function matchedTables(question: string): string[] | null {
  const match = matchSchemaQuestion(question, blueprint);
  if (!match) return null;
  return match.kind === "columns" ? match.tables.map((t) => t.name) : ["<tables>"];
}

describe("matchSchemaQuestion", () => {
  it("answers column questions for a named table", () => {
    expect(matchedTables("show the columns of users")).toEqual(["users"]);
    expect(matchedTables("What fields does the user table have?")).toEqual(["users"]);
    expect(matchedTables("describe orders")).toEqual(["orders"]);
    expect(matchedTables("show order items columns")).toEqual(["order_items"]);
    expect(matchedTables("structure of order_items")).toEqual(["order_items"]);
  });

  it("lists every table's columns when no table is named", () => {
    expect(matchedTables("show table columns")).toEqual(["users", "orders", "order_items"]);
  });

  it("lists tables", () => {
    expect(matchedTables("list all tables")).toEqual(["<tables>"]);
    expect(matchedTables("what tables are there?")).toEqual(["<tables>"]);
  });

  it("leaves data questions to the model", () => {
    expect(matchedTables("how many users do we have")).toBeNull();
    expect(matchedTables("show the email and name columns from users")).toBeNull();
    expect(matchedTables("orders with missing fields")).toBeNull();
    expect(matchedTables("describe the sales trend")).toBeNull();
  });
});

describe("schemaAnswerGrid", () => {
  it("renders types, nullability and keys", () => {
    const grid = schemaAnswerGrid({ kind: "columns", tables: [blueprint.tables[1]] }, blueprint);
    expect(grid.columns).toEqual(["table", "column", "type", "nullable", "key"]);
    expect(grid.rows).toEqual([
      { table: "orders", column: "id", type: "VARCHAR(100)", nullable: "NO", key: "PK" },
      { table: "orders", column: "user_id", type: "VARCHAR(100)", nullable: "YES", key: "FK → users.id" },
      { table: "orders", column: "amount", type: "VARCHAR(100)", nullable: "YES", key: "" },
    ]);
  });

  it("lists tables with column counts", () => {
    const grid = schemaAnswerGrid({ kind: "tables" }, blueprint);
    expect(grid.rows).toEqual([
      { table: "users", columns: 3 },
      { table: "orders", columns: 3 },
      { table: "order_items", columns: 3 },
    ]);
  });
});
