/**
 * Types shared across all three Electron processes (main, preload,
 * renderer). Kept in one place so the IPC contract can't drift between the
 * side that sends and the side that receives.
 */

export type Dialect = "mysql" | "postgres";

/**
 * Database credentials. These live in main-process memory only, for the
 * lifetime of the app run — never written to disk, never sent over IPC to
 * the renderer, and never included in any gateway request (FR-2.4).
 */
export interface ConnectionConfig {
  dialect: Dialect;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ForeignKeyInfo {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

/**
 * The local schema blueprint from Step 1: structure only, zero rows. This
 * is the *only* database-derived thing that ever leaves the machine, and
 * only after being pruned to the tables a given question needs.
 */
export interface SchemaBlueprint {
  dialect: Dialect;
  database: string;
  tables: TableInfo[];
  capturedAt: string;
}

export interface SessionInfo {
  name: string;
  email: string;
}

export interface ConnectionStatus {
  connected: boolean;
  dialect?: Dialect;
  database?: string;
  host?: string;
  port?: number;
  user?: string;
  tableCount?: number;
  capturedAt?: string;
}

export interface EndpointConfig {
  controlPlaneUrl: string;
  gatewayUrl: string;
}

export interface ResultGrid {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface RepairRecord {
  attempt: number;
  sql: string;
  error: string;
}

export interface PipelineResult {
  question: string;
  sql: string;
  dialect: Dialect;
  /** 1 when the first translation worked; 2+ after self-healing (FR-4.5). */
  attempts: number;
  tables: string[];
  limitApplied: number | null;
  schemaTablesSent: string[];
  result: ResultGrid;
  rowCount: number;
  /** Raw optimizer output for the diagnostics panel (FR-2.6). */
  plan: ResultGrid;
  timings: {
    schemaMs: number;
    /** Time in the gateway — translation, or guardrail validation for
     * hand-written SQL. */
    translateMs: number;
    explainMs: number;
    executeMs: number;
    totalMs: number;
  };
  usage: { remaining: number; monthlyQueryLimit: number } | null;
  repairs: RepairRecord[];
}

export type PipelineStep =
  | "pruning"
  | "translating"
  | "validating"
  | "explaining"
  | "executing"
  | "repairing"
  | "done";

/** Progress pushed from main to the renderer so the UI can narrate the run. */
export interface PipelineEvent {
  step: PipelineStep;
  message: string;
  detail?: string;
}

export interface PipelineRequest {
  question: string;
}

export interface SqlRequest {
  sql: string;
}

export interface IpcError {
  message: string;
  code: string;
}

/**
 * Every IPC handler resolves with this instead of rejecting. Electron
 * flattens a thrown Error into an opaque string across the bridge, which
 * would lose the gateway's machine-readable `code` — and the code is what
 * the UI branches on to show a quota prompt versus a guardrail banner.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

/**
 * The complete API the preload bridge exposes on `window.api` — the entire
 * set of capabilities the renderer has.
 *
 * Declared here rather than inferred from the preload implementation
 * because `preload/index.d.ts` cannot import from `preload/index.ts`
 * (TypeScript resolves `./index` to the declaration file itself). Writing
 * it out also makes the bridge a contract both sides are checked against,
 * instead of whatever the implementation happens to return.
 */
export interface HelixApi {
  auth: {
    login(credentials: { email: string; password: string }): Promise<IpcResult<SessionInfo>>;
    logout(): Promise<IpcResult<null>>;
    session(): Promise<IpcResult<SessionInfo | null>>;
  };
  endpoints: {
    get(): Promise<IpcResult<EndpointConfig>>;
    set(next: Partial<EndpointConfig>): Promise<IpcResult<EndpointConfig>>;
  };
  db: {
    connect(config: ConnectionConfig): Promise<IpcResult<ConnectionStatus>>;
    disconnect(): Promise<IpcResult<ConnectionStatus>>;
    status(): Promise<IpcResult<ConnectionStatus>>;
    schema(): Promise<IpcResult<SchemaBlueprint>>;
    refreshSchema(): Promise<IpcResult<ConnectionStatus>>;
  };
  pipeline: {
    run(request: PipelineRequest): Promise<IpcResult<PipelineResult>>;
    /** Runs hand-written SQL through the same guardrail. Not metered. */
    runSql(request: SqlRequest): Promise<IpcResult<PipelineResult>>;
    /** Returns an unsubscribe function. */
    onEvent(callback: (event: PipelineEvent) => void): () => void;
  };
}
