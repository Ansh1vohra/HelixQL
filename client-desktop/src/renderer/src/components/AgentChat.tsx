import { useEffect, useRef, useState } from "react";
import type {
  AgentTurnResult,
  ChatTurn,
  PipelineEvent,
  PipelineResult,
  PriorExchange,
} from "../../../shared/types";
import { unwrap } from "../lib/ipc";
import { Button } from "./ui";

type Outcome = Exclude<AgentTurnResult, { kind: "ask" }>;

/** One question in the thread: what was asked, any clarifying back-and-forth,
 * and how it ended. `outcome` is null while it is still being clarified. */
interface Exchange {
  question: string;
  turns: ChatTurn[];
  options: string[];
  outcome: Outcome | null;
}

/** Most columns a one-row answer is spelled out with in the chat bubble;
 * wider rows are left to the Results panel. */
const MAX_INLINE_COLUMNS = 4;

/**
 * Agent talk: ask a question, answer the model's clarifying questions, and
 * the run happens once the question is pinned down. Later questions join
 * the same thread and can follow up on earlier ones — "do we have email for
 * all?" after "how many customers do we have?".
 *
 * The thread lives here and is sent to the main process each turn — see
 * `main/agent.ts`. Earlier questions travel as the questions themselves,
 * never their results. Results go to the shared Results and Diagnostics
 * panels through `execute`, same as the other modes; the short answer shown
 * in the bubble is read from that same local result and never leaves the
 * renderer.
 */
export function AgentChat({
  connected,
  running,
  progress,
  execute,
}: {
  connected: boolean;
  running: boolean;
  /** Latest pipeline progress event, shown while a turn is in flight. */
  progress?: PipelineEvent;
  /** Runs a turn through the dashboard; resolves false if it failed (the
   * dashboard shows the error). A null result means nothing to show yet. */
  execute: (call: () => Promise<PipelineResult | null>) => Promise<boolean>;
}): JSX.Element {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const [showEarlier, setShowEarlier] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [exchanges, running]);

  const current = exchanges[exchanges.length - 1];
  const awaitingReply = current !== undefined && current.outcome === null;

  function reset(): void {
    setExchanges([]);
    setShowEarlier(false);
    setDraft("");
  }

  /**
   * Sends one turn of the exchange `opening` starts. `startsExchange` is true
   * for a new question, false for a reply to (or skip of) the open one.
   */
  async function sendTurn(
    opening: string,
    history: ChatTurn[],
    skip: boolean,
    restoreDraft: string,
    startsExchange: boolean,
  ): Promise<void> {
    const previous = exchanges;
    const earlier = startsExchange ? exchanges : exchanges.slice(0, -1);
    const context: PriorExchange[] = earlier.flatMap((exchange) =>
      exchange.outcome?.kind === "answer"
        ? [{ question: exchange.question, resolvedQuestion: exchange.outcome.resolvedQuestion }]
        : [],
    );

    // Shown straight away so the thread doesn't sit frozen while the schema
    // is read; rolled back if the turn fails, so a retry resends it.
    const pending: Exchange = { question: opening, turns: history, options: [], outcome: null };
    setExchanges([...earlier, pending]);
    setDraft("");

    const ok = await execute(async () => {
      const reply = await unwrap(window.api.pipeline.agentTurn({ question: opening, history, skip, context }));
      if (reply.kind === "ask") {
        setExchanges([
          ...earlier,
          { ...pending, turns: [...history, { role: "assistant", content: reply.message }], options: reply.options },
        ]);
        return null;
      }
      setExchanges([...earlier, { ...pending, outcome: reply }]);
      return reply.kind === "answer" ? reply.result : null;
    });

    if (!ok) {
      setExchanges(previous);
      setDraft(restoreDraft);
    }
  }

  function send(text: string): void {
    const content = text.trim();
    if (!content || running || !connected) return;

    if (!awaitingReply) {
      void sendTurn(content, [], false, content, true);
      return;
    }
    void sendTurn(current.question, [...current.turns, { role: "user", content }], false, content, false);
  }

  function skip(): void {
    if (!awaitingReply || running) return;
    void sendTurn(current.question, current.turns, true, draft, false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(draft);
    }
  }

  const lastTurn = current?.turns[current.turns.length - 1];
  const showOptions = awaitingReply && !running && lastTurn?.role === "assistant" && current.options.length > 0;

  // Earlier exchanges are folded away by default: the thread sits above
  // the Results panel, and every line it takes is a row of data not shown.
  // They still travel as context either way.
  const earlierCount = exchanges.length - 1;
  const visible = showEarlier ? exchanges : exchanges.slice(-1);

  return (
    <div className="space-y-1.5">
      {exchanges.length > 0 && (
        <div
          ref={threadRef}
          className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          {earlierCount > 0 && (
            <button
              type="button"
              onClick={() => setShowEarlier((value) => !value)}
              className="text-2xs font-medium text-brand-600 hover:text-brand-700"
            >
              {showEarlier
                ? "Hide earlier questions"
                : `Show ${earlierCount} earlier question${earlierCount === 1 ? "" : "s"}`}
            </button>
          )}

          {visible.map((exchange) => {
            const isCurrent = exchange === current;
            return (
              <div key={exchanges.indexOf(exchange)} className={`space-y-1.5 ${isCurrent ? "" : "opacity-75"}`}>
                <Bubble role="user">{exchange.question}</Bubble>
                {/* A settled exchange's clarifying back-and-forth is folded
                    into its "Ran as" line; only the open one shows it. */}
                {(isCurrent || !exchange.outcome) &&
                  exchange.turns.map((turn, turnIndex) => (
                    <Bubble key={turnIndex} role={turn.role}>
                      {turn.content}
                    </Bubble>
                  ))}

                {exchange.outcome?.kind === "answer" && <AnswerBubble outcome={exchange.outcome} />}

                {exchange.outcome?.kind === "unanswerable" && (
                  <Bubble role="assistant" tone="warning">
                    {exchange.outcome.message}
                  </Bubble>
                )}
              </div>
            );
          })}

          {showOptions && (
            <div className="flex flex-wrap gap-1.5 pl-1">
              {current.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => send(option)}
                  className="rounded-full border border-brand-200 bg-white px-3 py-0.5 text-xs text-brand-700 transition hover:border-brand-400 hover:bg-brand-50"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {running && progress && (
            <p
              className={`animate-pulse pl-1 text-2xs ${
                progress.step === "repairing" ? "text-amber-600" : "text-brand-600"
              }`}
            >
              {progress.message}
            </p>
          )}
        </div>
      )}

      <div className="flex items-start gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!connected || running}
          rows={1}
          placeholder={
            !connected
              ? "Connect to a database to begin"
              : awaitingReply
                ? "Reply, or pick an option above…"
                : exchanges.length > 0
                  ? "Ask a follow-up — e.g. Do they all have an email address?"
                  : "Ask a question — e.g. Who is our best customer?"
          }
          className="min-w-0 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
        />
        {awaitingReply && (
          <Button variant="ghost" onClick={skip} disabled={running}>
            Just run it
          </Button>
        )}
        <Button onClick={() => send(draft)} disabled={!connected || running || !draft.trim()}>
          {running ? "Working…" : awaitingReply ? "Reply" : "Ask"}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-2xs text-slate-400">
          Enter to send · follow-ups remember earlier questions · only final runs count against your plan
        </span>
        {exchanges.length > 0 && (
          <button
            type="button"
            onClick={reset}
            disabled={running}
            className="text-2xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            New conversation
          </button>
        )}
      </div>
    </div>
  );
}

/** Column names that mark a yes/no flag rather than a quantity:
 * `any_reviews`, `has_email`, `is_active`, `review_exists`. */
const FLAG_COLUMN = /^(any|has|have|is|are|exists?)_|_exists?$|^exists?$/i;

/**
 * MySQL returns EXISTS and boolean expressions as 1/0, so a flag and a
 * count look identical — and "any reviews: 1" reads as "one review". The
 * column name is the only tell, so a 1/0 under a flag-like name is shown
 * as Yes/No.
 */
function formatValue(value: unknown, column: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if ((value === 1 || value === 0 || value === "1" || value === "0") && FLAG_COLUMN.test(column)) {
    return Number(value) === 1 ? "Yes" : "No";
  }
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The answer itself, read from the local result: the value for a single
 * figure, the fields for a single row, otherwise a pointer to Results. */
export function AnswerBubble({ outcome }: { outcome: Extract<Outcome, { kind: "answer" }> }): JSX.Element {
  const { result } = outcome;
  const { columns, rows } = result.result;
  const single = rows.length === 1 && columns.length <= MAX_INLINE_COLUMNS ? rows[0] : null;

  return (
    <Bubble role="assistant">
      {rows.length === 0 ? (
        <span className="block font-medium">No matching rows.</span>
      ) : single ? (
        <span className="block space-y-0.5">
          {columns.map((column) => (
            <span key={column} className="block">
              <span className="text-slate-500">{column.replace(/_/g, " ")}: </span>
              <span className="font-semibold text-slate-900">{formatValue(single[column], column)}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="block font-medium">
          {result.rowCount.toLocaleString()} row{result.rowCount === 1 ? "" : "s"}
          {result.limitApplied !== null ? ` (capped at ${result.limitApplied.toLocaleString()})` : ""} — shown in
          Results.
        </span>
      )}
      <span className="mt-1 block text-2xs text-slate-500">Ran as: {outcome.resolvedQuestion}</span>
      {outcome.assumptions.length > 0 && (
        <span className="mt-0.5 block text-2xs text-slate-500">Assumed: {outcome.assumptions.join(" · ")}</span>
      )}
      {result.repairs.length > 0 && (
        <span className="mt-0.5 block text-2xs text-amber-600">
          Self-corrected after {result.repairs.length + 1} attempts — see Diagnostics.
        </span>
      )}
    </Bubble>
  );
}

export function Bubble({
  role,
  tone,
  children,
}: {
  role: ChatTurn["role"];
  tone?: "warning";
  children: React.ReactNode;
}): JSX.Element {
  const styles =
    role === "user"
      ? "ml-auto bg-brand-600 text-white"
      : tone === "warning"
        ? "border border-amber-200 bg-amber-50 text-amber-800"
        : "border border-slate-200 bg-white text-slate-700";

  return <div className={`w-fit max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${styles}`}>{children}</div>;
}
