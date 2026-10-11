import { useEffect, useState } from "react";
import type { ConnectionStatus, Dialect, PipelineEvent, PipelineResult, SessionInfo } from "../../../shared/types";
import { errorCode, errorMessage, unwrap } from "../lib/ipc";
import { AgentChat } from "./AgentChat";
import { BetaChat } from "./BetaChat";
import { ConnectionPanel } from "./ConnectionPanel";
import { DataGrid } from "./DataGrid";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { SchemaBrowser } from "./SchemaBrowser";
import { Banner, Button, Panel } from "./ui";

/** Codes that mean "the user has to do something", not "we broke". Shown as
 * an advisory rather than a red failure banner. */
const ADVISORY_CODES = new Set([
  "QUESTION_UNANSWERABLE",
  "QUERY_LIMIT_EXCEEDED",
  "SECURITY_VIOLATION",
  "WRITE_NOT_CONFIRMED",
  "WRITE_EXPIRED",
  "WRITE_ROWS_CHANGED",
]);

type Mode = "ask" | "agent" | "sql" | "beta";

const MODE_LABELS: Record<Mode, string> = { ask: "Ask in English", agent: "Agent talk", sql: "Write SQL", beta: "Beta" };

/** Modes driven by a chat component rather than the shared input box. */
const CHAT_MODES = new Set<Mode>(["agent", "beta"]);
type SidebarTab = "connection" | "schema";

function errorTitle(code: string): string {
  switch (code) {
    case "SECURITY_VIOLATION":
      return "Blocked by the SQL guardrail";
    case "QUESTION_UNANSWERABLE":
      return "Not answerable from this schema";
    case "QUERY_LIMIT_EXCEEDED":
      return "Monthly query limit reached";
    case "SELF_HEAL_EXHAUSTED":
      return "Self-correction couldn't fix the query";
    case "WRITE_NOT_CONFIRMED":
      return "Not confirmed";
    case "WRITE_EXPIRED":
    case "WRITE_ROWS_CHANGED":
      return "Change not made";
    case "WRITE_FAILED":
      return "The database refused the change";
    default:
      return "Query failed";
  }
}

/** Quotes a table name so reserved words and mixed case survive, escaping
 * the quote character itself by doubling it. */
function quoteIdentifier(name: string, dialect: Dialect): string {
  const quote = dialect === "mysql" ? "`" : '"';
  return quote + name.split(quote).join(quote + quote) + quote;
}

export function Dashboard({ session, onSignOut }: { session: SessionInfo; onSignOut: () => void }): JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false });
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("connection");
  const [mode, setMode] = useState<Mode>("ask");
  const [question, setQuestion] = useState("");
  const [sql, setSql] = useState("");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [usage, setUsage] = useState<PipelineResult["usage"]>(null);

  useEffect(() => {
    unwrap(window.api.db.status()).then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    // The unsubscribe returned by the bridge matters here: without it,
    // React's StrictMode double-mount would leave a duplicate listener and
    // every progress line would render twice.
    return window.api.pipeline.onEvent((event) => setEvents((current) => [...current, event]));
  }, []);

  function handleStatusChange(next: ConnectionStatus): void {
    setStatus(next);
    if (next.connected) setSidebarTab("schema");
  }

  /** Runs one call against the shared results panels. A null outcome is an
   * agent turn that asked a question instead of running. Resolves false if
   * the call failed, so the caller can roll back its own state. */
  async function execute(call: () => Promise<PipelineResult | null>): Promise<boolean> {
    setRunning(true);
    setError(null);
    setEvents([]);
    setResult(null);
    try {
      const outcome = await call();
      setResult(outcome);
      // Usage only comes back from a metered (English) run, so keep the last
      // known figure rather than blanking the badge on a manual query.
      if (outcome?.usage) setUsage(outcome.usage);
      return true;
    } catch (err) {
      setError({ message: errorMessage(err), code: errorCode(err) });
      return false;
    } finally {
      setRunning(false);
    }
  }

  const canRun = status.connected && !running && (mode === "ask" ? question.trim() : sql.trim());

  function handleRun(): void {
    if (!canRun) return;
    void execute(() =>
      mode === "ask"
        ? unwrap(window.api.pipeline.run({ question }))
        : unwrap(window.api.pipeline.runSql({ sql })),
    );
  }

  /** "View data" from the schema browser: shows the table's rows in the
   * Write SQL tab, so the query stays visible and editable and goes through
   * the same guardrail (and row cap) as anything typed there. */
  function handleViewData(table: string, dialect: Dialect): void {
    if (running) return;
    const query = `SELECT * FROM ${quoteIdentifier(table, dialect)}`;
    setMode("sql");
    setSql(query);
    void execute(() => unwrap(window.api.pipeline.runSql({ sql: query })));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Ctrl/Cmd+Enter runs in both modes. Plain Enter also runs in Ask mode,
    // where the input is one line of prose; in SQL mode it must insert a
    // newline, because queries are written across lines.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey || (mode === "ask" && !event.shiftKey))) {
      event.preventDefault();
      handleRun();
    }
  }

  async function handleSignOut(): Promise<void> {
    await unwrap(window.api.auth.logout()).catch(() => undefined);
    onSignOut();
  }

  const latestEvent = events[events.length - 1];
  const repairCount = events.filter((event) => event.step === "repairing").length;

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-bold tracking-tight text-brand-600">HelixQL</span>
          <span className="text-2xs text-slate-400">
            {status.connected ? `${status.dialect} · ${status.database}` : "not connected"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {usage && (
            <span className="text-2xs text-slate-500">
              {usage.remaining} of {usage.monthlyQueryLimit} queries left
            </span>
          )}
          <span className="text-2xs text-slate-500">{session.email}</span>
          <Button variant="ghost" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200">
          <div className="flex shrink-0 border-b border-slate-200">
            {(["connection", "schema"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSidebarTab(tab)}
                className={`flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition ${
                  sidebarTab === tab
                    ? "border-b-2 border-brand-500 text-brand-600"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {sidebarTab === "connection" ? (
              <ConnectionPanel status={status} onStatusChange={handleStatusChange} />
            ) : (
              <SchemaBrowser
                refreshKey={status.capturedAt ? Date.parse(status.capturedAt) : 0}
                onViewData={handleViewData}
              />
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <div className="shrink-0 space-y-2">
            <div className="flex gap-1">
              {(["ask", "agent", "sql", "beta"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  className={`rounded px-2.5 py-1 text-2xs font-medium transition ${
                    mode === option
                      ? option === "beta"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-brand-100 text-brand-700"
                      : option === "beta"
                        ? "text-amber-700 hover:bg-amber-50"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                >
                  {MODE_LABELS[option]}
                </button>
              ))}
            </div>

            {/* Kept mounted while hidden so switching modes doesn't drop a
                conversation halfway through. */}
            <div className={mode === "agent" ? undefined : "hidden"}>
              <AgentChat
                connected={status.connected}
                running={running}
                progress={latestEvent}
                execute={execute}
              />
            </div>

            <div className={mode === "beta" ? undefined : "hidden"}>
              <BetaChat connected={status.connected} running={running} progress={latestEvent} execute={execute} />
            </div>

            {CHAT_MODES.has(mode) ? null : mode === "ask" ? (
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!status.connected || running}
                rows={2}
                placeholder={
                  status.connected
                    ? "Ask a question — e.g. Who made the most orders from Gujarat this month?"
                    : "Connect to a database to begin"
                }
                className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
              />
            ) : (
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!status.connected || running}
                rows={5}
                spellCheck={false}
                placeholder={status.connected ? "SELECT * FROM users LIMIT 10" : "Connect to a database to begin"}
                className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-brand-700 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
              />
            )}

            {!CHAT_MODES.has(mode) && (
              <div className="flex items-center justify-between">
                <span className="text-2xs text-slate-400">
                  {mode === "ask"
                    ? "Enter to run · results stay on this machine"
                    : "Read-only SELECT queries only · ⌘/Ctrl+Enter to run · not counted against your plan"}
                </span>

                <div className="flex items-center gap-3">
                  {running && latestEvent && (
                    <span
                      className={`animate-pulse text-2xs ${repairCount > 0 ? "text-amber-600" : "text-brand-600"}`}
                    >
                      {latestEvent.message}
                    </span>
                  )}
                  <Button onClick={handleRun} disabled={!canRun}>
                    {running ? "Running…" : mode === "ask" ? "Run analysis" : "Run query"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <Banner tone={ADVISORY_CODES.has(error.code) ? "warning" : "error"} title={errorTitle(error.code)}>
              {error.message}
            </Banner>
          )}

          {/* The bifurcated workspace (FR-2.6): records on one side,
              optimizer diagnostics on the other. minmax(0, …) lets each
              column shrink below its content — a bare `3fr` has a
              min-content floor, so a wide SQL block or result row would
              widen the grid past the window and scroll the whole app
              sideways instead of scrolling inside its panel. */}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <Panel
              title="Results"
              actions={
                result && (
                  <span className="flex items-center gap-2">
                    {result.repairs.length > 0 && (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-medium text-amber-700"
                        title="The database rejected the first query and the model corrected it — see Diagnostics"
                      >
                        Self-corrected · {result.repairs.length + 1} attempts
                      </span>
                    )}
                    <span className="text-2xs text-slate-500">
                      {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
                    </span>
                  </span>
                )
              }
            >
              <DataGrid
                grid={result?.result ?? { columns: [], rows: [] }}
                emptyMessage={running ? "Running…" : "Run a question or a query to see records here."}
              />
            </Panel>

            <Panel title="Diagnostics">
              <DiagnosticsPanel result={result} events={events} running={running} />
            </Panel>
          </div>
        </main>
      </div>
    </div>
  );
}
