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
  /** Has a server-side default, so an insert may leave it out. */
  hasDefault?: boolean;
  /** Filled by the database (auto-increment, identity, computed) — never
   * written by an insert or update. */
  generated?: boolean;
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
  /** Views are listed for reading but refused as write targets. */
  isView?: boolean;
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
  /** `table.column` names the gateway matched case-insensitively. */
  caseInsensitiveColumns: string[];
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
  | "clarifying"
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

/** One message of an agent-talk conversation. Prose only — the model's
 * clarifying question or the user's reply. Never row data. */
export interface ChatTurn {
  role: "assistant" | "user";
  content: string;
}

/** An earlier, already-answered question in the same agent-talk thread:
 * what was asked and the self-contained form it was run as. Never its
 * result — rows stay on this machine, so a follow-up is resolved from the
 * questions alone. */
export interface PriorExchange {
  question: string;
  resolvedQuestion: string;
}

export interface AgentTurnRequest {
  /** The question that opened this exchange. */
  question: string;
  /** Every turn since, oldest first. */
  history: ChatTurn[];
  /** Earlier questions in the thread this one may follow up on, oldest
   * first — so "do we have email for all?" knows "all" means customers. */
  context?: PriorExchange[];
  /** Stop asking and run with what has been said so far. */
  skip?: boolean;
}

/**
 * One agent turn: either a clarifying question for the user, a finished
 * run on the question the conversation settled on, or a report that the
 * connected schema cannot answer it.
 */
export type AgentTurnResult =
  | { kind: "ask"; message: string; options: string[] }
  | { kind: "answer"; resolvedQuestion: string; assumptions: string[]; result: PipelineResult }
  | { kind: "unanswerable"; message: string };

// --- Beta: write mode -----------------------------------------------------

export type WriteOperation = "insert" | "update" | "delete";

/** One turn of Beta mode. Like `AgentTurnRequest`, plus which track an
 * open exchange is on: a read continues as agent talk, a write continues
 * planning. Unset for a new question — the planner decides. */
export interface BetaTurnRequest {
  question: string;
  history: ChatTurn[];
  context?: PriorExchange[];
  track?: "read" | "write";
  skip?: boolean;
}

/**
 * A write ready for the user's go-ahead. Everything shown is computed
 * locally: the statement the app built, and the rows it would touch read
 * from the user's own database. The statement itself stays in the main
 * process under `planId`, so what the user confirms is exactly what runs.
 */
export interface WritePreview {
  planId: string;
  operation: WriteOperation;
  table: string;
  /** Plain-language description of the change. */
  summary: string;
  /** The statement with values inlined, for reading only — the real one is
   * parameterized. */
  sql: string;
  /** Rows an update/delete will change, counted just now; 1 for an insert. */
  affectedRows: number;
  /** The new row (insert) or the rows that would change (update/delete). */
  preview: ResultGrid;
  notes: string[];
  /** Delete only: the word the user must type to enable the button. */
  confirmWord: string | null;
}

export type BetaTurnResult =
  | (AgentTurnResult & { track: "read" })
  | { kind: "ask"; track: "write"; message: string; options: string[] }
  | { kind: "unanswerable"; track: "write"; message: string }
  /** `result` carries the preview for the shared Results and Diagnostics
   * panels: the rows that would change and the statement. */
  | { kind: "confirm"; track: "write"; preview: WritePreview; result: PipelineResult };

export interface WriteOutcome {
  operation: WriteOperation;
  table: string;
  affectedRows: number;
  /** Auto-generated key of an inserted row, when the database reports one. */
  insertId: string | null;
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
    /** One turn of agent talk. Clarification is free; a final run is
     * metered like any English question. */
    agentTurn(request: AgentTurnRequest): Promise<IpcResult<AgentTurnResult>>;
    /** Returns an unsubscribe function. */
    onEvent(callback: (event: PipelineEvent) => void): () => void;
  };
  beta: {
    /** One turn of Beta mode: a read runs as agent talk; a write is planned
     * and previewed, never run. */
    turn(request: BetaTurnRequest): Promise<IpcResult<BetaTurnResult>>;
    /** Runs a previewed write. `typed` must match `confirmWord` for a delete. */
    confirm(request: { planId: string; typed?: string }): Promise<IpcResult<WriteOutcome>>;
    /** Discards a previewed write. */
    cancel(request: { planId: string }): Promise<IpcResult<null>>;
  };
}
