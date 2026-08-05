import type { TableInfo } from "../../shared/types";

/**
 * Renders a table's structure as an empty `CREATE TABLE` statement.
 *
 * This is the entire payload the cloud tier ever sees about a customer's
 * database: column names, types, keys. No rows, no counts, no sample
 * values, no comments. The model needs the shape to write a join; it does
 * not need the data, and never gets it.
 */
export function tableToCreateStatement(table: TableInfo): string {
  const lines: string[] = [];

  for (const column of table.columns) {
    const nullability = column.nullable ? "" : " NOT NULL";
    lines.push(`  ${column.name} ${column.dataType}${nullability}`);
  }

  const primaryKeys = table.columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
  if (primaryKeys.length > 0) {
    lines.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
  }

  // Foreign keys matter disproportionately here: they are how the model
  // infers which columns to join on without ever seeing a row.
  for (const fk of table.foreignKeys) {
    lines.push(`  FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencesTable}(${fk.referencesColumn})`);
  }

  return `CREATE TABLE ${table.name} (\n${lines.join(",\n")}\n);`;
}

export function blueprintFor(tables: TableInfo[]): string[] {
  return tables.map(tableToCreateStatement);
}
