import { useEffect, useRef, useState } from "react";
import type {
  AgentTurnResult,
  BetaTurnResult,
  ChatTurn,
  PipelineEvent,
  PipelineResult,
  PriorExchange,
  WriteOutcome,
  WritePreview,
} from "../../../shared/types";
import { unwrap } from "../lib/ipc";
import { AnswerBubble, Bubble } from "./AgentChat";
import { Button } from "./ui";

type ReadOutcome = Exclude<AgentTurnResult, { kind: "ask" }>;

/** How an exchange ended — or, for `confirm`, where it is waiting. */
type Settled =
  | { kind: "read"; outcome: ReadOutcome }
  | { kind: "refused"; message: string }
  | { kind: "confirm"; preview: WritePreview }
  | { kind: "written"; preview: WritePreview; outcome: WriteOutcome }
  | { kind: "cancelled"; preview: WritePreview };

interface Exchange {
  question: string;
  turns: ChatTurn[];
  options: string[];
  /** Unknown until the first reply says whether this is a read or a write. */
  track?: "read" | "write";
  settled: Settled | null;
}

const VERBS = {
  insert: { title: "Add a row to", done: "Added", button: "Insert row" },
  update: { title: "Change rows in", done: "Updated", button: "Update" },
  delete: { title: "Delete rows from", done: "Deleted", button: "Delete" },
} as const;

/**
 * Beta: agent talk that can also insert, update, and delete.
 *
 * Reads behave exactly as in Agent talk. A write is planned in conversation
 * — the assistant asks for any required field that's missing — then shown
 * as a preview with the rows it would touch. Nothing changes until the user
 * presses confirm (and, for a delete, types the word). See `main/beta.ts`
 * for what is checked on the way.
 */
export function BetaChat({
  connected,
  running,
  progress,
  execute,
}: {
  connected: boolean;
  running: boolean;
  progress?: PipelineEvent;
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
  const awaitingReply = current !== undefined && current.settled === null;
  const pendingPreview = current?.settled?.kind === "confirm" ? current.settled.preview : null;

  /** Drops a preview the user walked away from, so it can't be confirmed
   * later from a stale card. */
  function abandonPending(list: Exchange[]): Exchange[] {
    const last = list[list.length - 1];
    if (last?.settled?.kind !== "confirm") return list;
    void window.api.beta.cancel({ planId: last.settled.preview.planId });
    return [...list.slice(0, -1), { ...last, settled: { kind: "cancelled", preview: last.settled.preview } }];
  }

  function reset(): void {
    abandonPending(exchanges);
    setExchanges([]);
    setShowEarlier(false);
    setDraft("");
  }

  async function sendTurn(
    opening: string,
    history: ChatTurn[],
    skip: boolean,
    restoreDraft: string,
    startsExchange: boolean,
  ): Promise<void> {
    const base = abandonPending(exchanges);
    const earlier = startsExchange ? base : base.slice(0, -1);
    const track = startsExchange ? undefined : current?.track;
    const context: PriorExchange[] = earlier.flatMap((exchange) => {
      if (exchange.settled?.kind === "read" && exchange.settled.outcome.kind === "answer") {
        return [{ question: exchange.question, resolvedQuestion: exchange.settled.outcome.resolvedQuestion }];
      }
      if (exchange.settled?.kind === "written") {
        return [{ question: exchange.question, resolvedQuestion: exchange.settled.preview.summary }];
      }
      return [];
    });

    const pending: Exchange = { question: opening, turns: history, options: [], track, settled: null };
    setExchanges([...earlier, pending]);
    setDraft("");

    const ok = await execute(async () => {
      const reply: BetaTurnResult = await unwrap(
        window.api.beta.turn({ question: opening, history, context, track, skip }),
      );
      const next: Exchange = { ...pending, track: reply.track };

      if (reply.kind === "ask") {
        setExchanges([
          ...earlier,
          { ...next, turns: [...history, { role: "assistant", content: reply.message }], options: reply.options },
        ]);
        return null;
      }
      if (reply.kind === "confirm") {
        setExchanges([...earlier, { ...next, settled: { kind: "confirm", preview: reply.preview } }]);
        return reply.result;
      }
      if (reply.track === "write") {
        setExchanges([...earlier, { ...next, settled: { kind: "refused", message: reply.message } }]);
        return null;
      }
      setExchanges([...earlier, { ...next, settled: { kind: "read", outcome: reply } }]);
      return reply.kind === "answer" ? reply.result : null;
    });

    if (!ok) {
      // Back to before this turn — except a preview abandoned above stays
      // cancelled, since its plan is already gone in the main process.
      setExchanges(base);
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

  async function confirm(preview: WritePreview, typed: string): Promise<void> {
    await execute(async () => {
      const outcome = await unwrap(window.api.beta.confirm({ planId: preview.planId, typed }));
      setExchanges((list) =>
        list.map((exchange) =>
          exchange.settled?.kind === "confirm" && exchange.settled.preview.planId === preview.planId
            ? { ...exchange, settled: { kind: "written", preview, outcome } }
            : exchange,
        ),
      );
      return null;
    });
  }

  function cancel(preview: WritePreview): void {
    void window.api.beta.cancel({ planId: preview.planId });
    setExchanges((list) =>
      list.map((exchange) =>
        exchange.settled?.kind === "confirm" && exchange.settled.preview.planId === preview.planId
          ? { ...exchange, settled: { kind: "cancelled", preview } }
          : exchange,
      ),
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(draft);
    }
  }

  const lastTurn = current?.turns[current.turns.length - 1];
  const showOptions = awaitingReply && !running && lastTurn?.role === "assistant" && current.options.length > 0;
  const earlierCount = exchanges.length - 1;
  const visible = showEarlier ? exchanges : exchanges.slice(-1);

  return (
    <div className="space-y-1.5">
      {exchanges.length > 0 && (
        <div
          ref={threadRef}
          className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          {earlierCount > 0 && (
            <button
              type="button"
              onClick={() => setShowEarlier((value) => !value)}
              className="text-2xs font-medium text-brand-600 hover:text-brand-700"
            >
              {showEarlier
                ? "Hide earlier requests"
                : `Show ${earlierCount} earlier request${earlierCount === 1 ? "" : "s"}`}
            </button>
          )}

          {visible.map((exchange) => {
            const isCurrent = exchange === current;
            const settled = exchange.settled;
            return (
              <div key={exchanges.indexOf(exchange)} className={`space-y-1.5 ${isCurrent ? "" : "opacity-75"}`}>
                <Bubble role="user">{exchange.question}</Bubble>
                {(isCurrent || !settled) &&
                  exchange.turns.map((turn, turnIndex) => (
                    <Bubble key={turnIndex} role={turn.role}>
                      {turn.content}
                    </Bubble>
                  ))}

                {settled?.kind === "read" && settled.outcome.kind === "answer" && (
                  <AnswerBubble outcome={settled.outcome} />
                )}
                {settled?.kind === "read" && settled.outcome.kind === "unanswerable" && (
                  <Bubble role="assistant" tone="warning">
                    {settled.outcome.message}
                  </Bubble>
                )}
                {settled?.kind === "refused" && (
                  <Bubble role="assistant" tone="warning">
                    {settled.message}
                  </Bubble>
                )}
                {settled?.kind === "confirm" && (
                  <ConfirmCard
                    preview={settled.preview}
                    disabled={running}
                    onConfirm={(typed) => void confirm(settled.preview, typed)}
                    onCancel={() => cancel(settled.preview)}
                  />
                )}
                {settled?.kind === "written" && (
                  <Bubble role="assistant">
                    <span className="font-medium text-brand-700">
                      ✓ {VERBS[settled.outcome.operation].done} {settled.outcome.affectedRows} row
                      {settled.outcome.affectedRows === 1 ? "" : "s"}{" "}
                      {settled.outcome.operation === "insert" ? "to" : "in"} {settled.outcome.table}
                      {settled.outcome.insertId ? ` (new id ${settled.outcome.insertId})` : ""}.
                    </span>
                    <span className="mt-0.5 block text-2xs text-slate-500">{settled.preview.summary}</span>
                  </Bubble>
                )}
                {settled?.kind === "cancelled" && (
                  <Bubble role="assistant">
                    <span className="text-slate-500">Cancelled — nothing was changed.</span>
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
                : pendingPreview
                  ? "Confirm or cancel the change above — or ask something else"
                  : "Ask, or change data — e.g. Add a customer named Asha Rao, email asha@example.com"
          }
          className="min-w-0 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
        />
        {awaitingReply && current.track !== "write" && (
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
          <span className="mr-1 rounded bg-amber-100 px-1 py-px font-semibold text-amber-700">BETA</span>
          Can insert, update and delete · every change is previewed and runs only after you confirm
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

/** The last step before a write: what will change, how many rows, and the
 * buttons. A delete also needs the confirm word typed. */
function ConfirmCard({
  preview,
  disabled,
  onConfirm,
  onCancel,
}: {
  preview: WritePreview;
  disabled: boolean;
  onConfirm: (typed: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [typed, setTyped] = useState("");
  const verbs = VERBS[preview.operation];
  const isDelete = preview.operation === "delete";
  const ready = !preview.confirmWord || typed.trim().toLowerCase() === preview.confirmWord;
  const rows = `${preview.affectedRows.toLocaleString()} row${preview.affectedRows === 1 ? "" : "s"}`;

  return (
    <div
      className={`w-full max-w-[85%] space-y-2 rounded-lg border-2 bg-white px-3 py-2 text-sm ${
        isDelete ? "border-red-300" : "border-amber-300"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-slate-900">
          {verbs.title} {preview.table}
        </span>
        <span className="text-2xs font-medium text-amber-700">Nothing has changed yet</span>
      </div>

      <p className="text-slate-700">{preview.summary}</p>

      <p className={`font-semibold ${isDelete ? "text-red-700" : "text-slate-900"}`}>
        {preview.operation === "insert"
          ? "1 new row will be added."
          : `${rows} will be ${isDelete ? "permanently deleted" : "changed"} — shown in Results.`}
      </p>

      {preview.notes.map((note) => (
        <p key={note} className="text-2xs text-amber-700">
          {note}
        </p>
      ))}

      <details>
        <summary className="cursor-pointer text-2xs text-slate-400 hover:text-slate-600">Show SQL</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 font-mono text-2xs text-brand-700">
          {preview.sql}
        </pre>
      </details>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {preview.confirmWord && (
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={disabled}
            placeholder={`Type "${preview.confirmWord}" to confirm`}
            className="min-w-0 flex-1 rounded-md border border-red-200 px-2 py-1.5 text-xs outline-none focus:border-red-400"
          />
        )}
        <Button variant="ghost" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
        <Button variant={isDelete ? "danger" : "primary"} onClick={() => onConfirm(typed)} disabled={disabled || !ready}>
          {verbs.button}
        </Button>
      </div>
    </div>
  );
}
