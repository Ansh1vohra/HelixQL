import mysql from "mysql2/promise";
import { Pool as PgPool, type PoolClient } from "pg";
import type { ConnectionConfig, ResultGrid, TableInfo } from "../../shared/types";
import { QUERY_TIMEOUT_MS } from "../config";

/**
 * The local database socket layer (Step 4.3 / FR-4.2).
 *
 * Everything here runs inside the customer's firewall, in the Electron main
 * process. The renderer has no Node access and therefore no way to reach a
 * database except through the IPC handlers that call into this file.
 */

export interface Driver {
  introspect(): Promise<TableInfo[]>;
  explain(sql: string): Promise<ResultGrid>;
  execute(sql: string): Promise<ResultGrid>;
  close(): Promise<void>;
}

function toGrid(rows: Record<string, unknown>[]): ResultGrid {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows };
}

/**
 * Driver values (Dates, Buffers, BigInts, Postgres numerics) have to cross
 * the IPC bridge, which uses structured clone and rejects some of them
 * outright. Normalize to JSON-safe primitives at the boundary rather than
 * letting a `bigint` blow up an otherwise successful query on its way to
 * the UI.
 */
function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (typeof value === "object") return JSON.parse(JSON.stringify(value));
  return value;
}

function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeValue(value);
    }
    return normalized;
  });
}

// --- MySQL ---------------------------------------------------------------

class MySqlDriver implements Driver {
  private constructor(
    private readonly pool: mysql.Pool,
    private readonly database: string,
  ) {}

  static async connect(config: ConnectionConfig): Promise<MySqlDriver> {
    const pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? {} : undefined,
      connectionLimit: 4,
      connectTimeout: 10_000,
      // Defense in depth behind the gateway's AST guardrail: even if a
      // stacked statement somehow reached the driver, the server would
      // refuse to run the second one.
      multipleStatements: false,
      dateStrings: false,
    });

    // Fail fast on bad credentials rather than at first query.
    const connection = await pool.getConnection();
    connection.release();

    return new MySqlDriver(pool, config.database);
  }

  /**
   * Runs `fn` inside a read-only transaction, then always rolls back.
   *
   * The AST guardrail is the primary control, but it runs in the cloud and
   * trusts that the string it validated is the string that executes. This
   * is the local backstop: the *server* refuses any write, so a bug or a
   * tampered client still cannot mutate customer data.
   */
  private async inReadOnlyTransaction<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query(`SET SESSION MAX_EXECUTION_TIME = ${QUERY_TIMEOUT_MS}`);
      await connection.query("START TRANSACTION READ ONLY");
      try {
        return await fn(connection);
      } finally {
        await connection.query("ROLLBACK").catch(() => undefined);
      }
    } finally {
      connection.release();
    }
  }

  async introspect(): Promise<TableInfo[]> {
    return this.inReadOnlyTransaction(async (connection) => {
      const [columnRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT c.TABLE_NAME   AS table_name,
                c.COLUMN_NAME  AS column_name,
                c.COLUMN_TYPE  AS data_type,
                c.IS_NULLABLE  AS is_nullable,
                c.COLUMN_KEY   AS column_key
           FROM information_schema.COLUMNS c
           JOIN information_schema.TABLES t
             ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = ?
            AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
          ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
        [this.database],
      );

      const [fkRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME             AS table_name,
                COLUMN_NAME            AS column_name,
                REFERENCED_TABLE_NAME  AS referenced_table,
                REFERENCED_COLUMN_NAME AS referenced_column
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [this.database],
      );

      return assembleTables(columnRows, fkRows, (row) => String(row.column_key) === "PRI");
    });
  }

  async explain(sql: string): Promise<ResultGrid> {
    return this.inReadOnlyTransaction(async (connection) => {
      // No ANALYZE: the optimizer reads its own statistics rather than the
      // table, which is what makes this effectively free (FR-4.2).
      const [rows] = await connection.query<mysql.RowDataPacket[]>(`EXPLAIN ${sql}`);
      return toGrid(normalizeRows(rows as unknown as Record<string, unknown>[]));
    });
  }

  async execute(sql: string): Promise<ResultGrid> {
    return this.inReadOnlyTransaction(async (connection) => {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(sql);
      return toGrid(normalizeRows((rows ?? []) as unknown as Record<string, unknown>[]));
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// --- PostgreSQL ----------------------------------------------------------

class PostgresDriver implements Driver {
  private constructor(private readonly pool: PgPool) {}

  static async connect(config: ConnectionConfig): Promise<PostgresDriver> {
    const pool = new PgPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 10_000,
      statement_timeout: QUERY_TIMEOUT_MS,
    });

    const client = await pool.connect();
    client.release();

    return new PostgresDriver(pool);
  }

  /**
   * Same backstop as MySQL, and it matters more here: node-postgres uses
   * the simple query protocol for parameterless queries, which *does*
   * accept multiple statements. `BEGIN READ ONLY` means the server rejects
   * a write regardless of what reached it.
   */
  private async inReadOnlyTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      try {
        return await fn(client);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  async introspect(): Promise<TableInfo[]> {
    return this.inReadOnlyTransaction(async (client) => {
      const columns = await client.query(
        `SELECT c.table_name,
                c.column_name,
                c.data_type,
                c.character_maximum_length,
                c.numeric_precision,
                c.numeric_scale,
                c.is_nullable
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = current_schema()
            AND t.table_type IN ('BASE TABLE', 'VIEW')
          ORDER BY c.table_name, c.ordinal_position`,
      );

      const primaryKeys = await client.query(
        `SELECT tc.table_name, kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
          WHERE tc.table_schema = current_schema()
            AND tc.constraint_type = 'PRIMARY KEY'`,
      );

      const foreignKeys = await client.query(
        `SELECT tc.table_name,
                kcu.column_name,
                ccu.table_name  AS referenced_table,
                ccu.column_name AS referenced_column
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.table_schema = current_schema()
            AND tc.constraint_type = 'FOREIGN KEY'`,
      );

      const pkSet = new Set(
        primaryKeys.rows.map((row: Record<string, unknown>) => `${row.table_name}.${row.column_name}`),
      );

      const withTypes = columns.rows.map((row: Record<string, unknown>) => ({
        ...row,
        data_type: formatPostgresType(row),
      }));

      return assembleTables(withTypes, foreignKeys.rows, (row) => pkSet.has(`${row.table_name}.${row.column_name}`));
    });
  }

  async explain(sql: string): Promise<ResultGrid> {
    return this.inReadOnlyTransaction(async (client) => {
      const result = await client.query(`EXPLAIN ${sql}`);
      return toGrid(normalizeRows(result.rows));
    });
  }

  async execute(sql: string): Promise<ResultGrid> {
    return this.inReadOnlyTransaction(async (client) => {
      const result = await client.query(sql);
      return toGrid(normalizeRows(result.rows ?? []));
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Rebuilds `varchar(100)` / `numeric(10,2)` from the catalog's split-out
 * type metadata, so the blueprint reads like real DDL. */
function formatPostgresType(row: Record<string, unknown>): string {
  const base = String(row.data_type);
  if (row.character_maximum_length) return `${base}(${row.character_maximum_length})`;
  if (base === "numeric" && row.numeric_precision) {
    return `${base}(${row.numeric_precision},${row.numeric_scale ?? 0})`;
  }
  return base;
}

/** Folds flat catalog rows into per-table structures, shared by both
 * dialects because the catalog queries are shaped to match. */
function assembleTables(
  columnRows: Record<string, unknown>[],
  fkRows: Record<string, unknown>[],
  isPrimaryKey: (row: Record<string, unknown>) => boolean,
): TableInfo[] {
  const tables = new Map<string, TableInfo>();

  for (const row of columnRows) {
    const tableName = String(row.table_name);
    if (!tables.has(tableName)) {
      tables.set(tableName, { name: tableName, columns: [], foreignKeys: [] });
    }
    tables.get(tableName)!.columns.push({
      name: String(row.column_name),
      dataType: String(row.data_type).toUpperCase(),
      nullable: String(row.is_nullable).toUpperCase() === "YES",
      isPrimaryKey: isPrimaryKey(row),
    });
  }

  for (const row of fkRows) {
    const table = tables.get(String(row.table_name));
    if (!table) continue;
    table.foreignKeys.push({
      column: String(row.column_name),
      referencesTable: String(row.referenced_table),
      referencesColumn: String(row.referenced_column),
    });
  }

  return Array.from(tables.values());
}

export async function createDriver(config: ConnectionConfig): Promise<Driver> {
  return config.dialect === "mysql" ? MySqlDriver.connect(config) : PostgresDriver.connect(config);
}
