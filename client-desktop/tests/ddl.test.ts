import { describe, expect, it } from "vitest";
import { blueprintFor, tableToCreateStatement } from "../src/main/db/ddl";
import type { TableInfo } from "../src/shared/types";

const users: TableInfo = {
  name: "users",
  columns: [
    { name: "id", dataType: "INT", nullable: false, isPrimaryKey: true },
    { name: "name", dataType: "VARCHAR(100)", nullable: true, isPrimaryKey: false },
    { name: "state", dataType: "VARCHAR(50)", nullable: true, isPrimaryKey: false },
  ],
  foreignKeys: [],
};

const orders: TableInfo = {
  name: "orders",
  columns: [
    { name: "id", dataType: "INT", nullable: false, isPrimaryKey: true },
    { name: "user_id", dataType: "INT", nullable: false, isPrimaryKey: false },
    { name: "total", dataType: "NUMERIC(10,2)", nullable: true, isPrimaryKey: false },
  ],
  foreignKeys: [{ column: "user_id", referencesTable: "users", referencesColumn: "id" }],
};

describe("tableToCreateStatement", () => {
  it("renders columns with types and nullability", () => {
    const ddl = tableToCreateStatement(users);
    expect(ddl).toContain("CREATE TABLE users (");
    expect(ddl).toContain("id INT NOT NULL");
    expect(ddl).toContain("name VARCHAR(100)");
    expect(ddl).not.toContain("name VARCHAR(100) NOT NULL");
  });

  it("declares the primary key", () => {
    expect(tableToCreateStatement(users)).toContain("PRIMARY KEY (id)");
  });

  it("declares foreign keys so the model can infer joins without seeing rows", () => {
    expect(tableToCreateStatement(orders)).toContain("FOREIGN KEY (user_id) REFERENCES users(id)");
  });

  it("emits structure only — never a row, a count, or a sample value", () => {
    const ddl = blueprintFor([users, orders]).join("\n");
    // The entire privacy claim rests on this: what leaves the machine is a
    // shape, not data.
    expect(ddl).not.toMatch(/INSERT|VALUES|SELECT/i);
    expect(ddl.split("\n").every((line) => !/\d{4}-\d{2}-\d{2}/.test(line))).toBe(true);
  });

  it("handles a composite primary key", () => {
    const ddl = tableToCreateStatement({
      name: "order_items",
      columns: [
        { name: "order_id", dataType: "INT", nullable: false, isPrimaryKey: true },
        { name: "sku", dataType: "VARCHAR(40)", nullable: false, isPrimaryKey: true },
      ],
      foreignKeys: [],
    });
    expect(ddl).toContain("PRIMARY KEY (order_id, sku)");
  });
});
