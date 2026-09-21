import { useEffect, useRef, useState } from "react";
import type { AgentTurnResult, ChatTurn, PipelineResult } from "../../../shared/types";
import { unwrap } from "../lib/ipc";
import { Button } from "./ui";

type Outcome = Exclude<AgentTurnResult, { kind: "ask" }>;

/**
 * Agent talk: ask a question, answer the model's clarifying questions, and
 * the run happens once the question is pinned down.
 *
 * The whole conversation lives here and is sent to the main process each
 * turn — see `main/agent.ts`. Results go to the shared Results and
 * Diagnostics panels through `execute`, same as the other modes.
 */
export function AgentChat({
  connected,
  running,
  progress,
  execute,
}: {
  connected: boolean;
  running: boolean;
  /** Latest pipeline progress line, shown while a turn is in flight. */
  progress?: string;
  /** Runs a turn through the dashboard; resolves false if it failed (the
   * dashboard shows the error). A null result means nothing to show yet. */
  execute: (call: () => Promise<PipelineResult | null>) => Promise<boolean>;
}): JSX.Element {
  const [question, setQuestion] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [question, turns, outcome, running]);

  const awaitingReply = question !== null && outcome === null;

  function reset(): void {
    setQuestion(null);
    setTurns([]);
    setOptions([]);
    setOutcome(null);
    setDraft("");
  }

  async function sendTurn(opening: string, history: ChatTurn[], skip: boolean, restoreDraft: string): Promise<void> {
    // Shown straight away so the thread doesn't sit frozen while the
    // schema is read; rolled back if the turn fails, so a retry resends it.
    const opensConversation = history.length === 0 && !skip;
    const previous = opensConversation ? { question: null, turns: [], options: [] } : { question, turns, options };
    setQuestion(opening);
    setTurns(history);
    setOptions([]);
    setDraft("");

    const ok = await execute(async () => {
      const reply = await unwrap(window.api.pipeline.agentTurn({ question: opening, history, skip }));
      if (reply.kind === "ask") {
        setTurns([...history, { role: "assistant", content: reply.message }]);
        setOptions(reply.options);
        return null;
      }
      setOutcome(reply);
      return reply.kind === "answer" ? reply.result : null;
    });

    if (!ok) {
      setQuestion(previous.question);
      setTurns(previous.turns);
      setOptions(previous.options);
      setDraft(restoreDraft);
    }
  }

  function send(text: string): void {
    const content = text.trim();
    if (!content || running || !connected) return;

    if (!awaitingReply) {
      // A finished conversation is replaced by the next question.
      setOutcome(null);
      void sendTurn(content, [], false, content);
      return;
    }
    void sendTurn(question!, [...turns, { role: "user", content }], false, content);
  }

  function skip(): void {
    if (!awaitingReply || running) return;
    void sendTurn(question!, turns, true, draft);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(draft);
    }
  }

  const lastTurn = turns[turns.length - 1];
  const showOptions = awaitingReply && !running && lastTurn?.role === "assistant" && options.length > 0;

  return (
    <div className="space-y-2">
      {question !== null && (
        <div
          ref={threadRef}
          className="max-h-60 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          <Bubble role="user">{question}</Bubble>
          {turns.map((turn, index) => (
            <Bubble key={index} role={turn.role}>
              {turn.content}
            </Bubble>
          ))}

          {showOptions && (
            <div className="flex flex-wrap gap-1.5 pl-1">
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => send(option)}
                  className="rounded-full border border-brand-200 bg-white px-3 py-1 text-xs text-brand-700 transition hover:border-brand-400 hover:bg-brand-50"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {outcome?.kind === "answer" && (
            <Bubble role="assistant">
              <span className="block">
                Ran: <span className="font-medium">{outcome.resolvedQuestion}</span>
              </span>
              {outcome.assumptions.length > 0 && (
                <span className="mt-1 block text-[11px] text-slate-500">
                  Assumed: {outcome.assumptions.join(" · ")}
                </span>
              )}
            </Bubble>
          )}

          {outcome?.kind === "unanswerable" && (
            <Bubble role="assistant" tone="warning">
              {outcome.message}
            </Bubble>
          )}

          {running && progress && (
            <p className="animate-pulse pl-1 text-[11px] text-brand-600">{progress}</p>
          )}
        </div>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!connected || running}
        rows={2}
        placeholder={
          !connected
            ? "Connect to a database to begin"
            : awaitingReply
              ? "Reply, or pick an option above…"
              : "Ask a question — e.g. Who is our best customer?"
        }
        className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
      />

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">
          Enter to send · questions are free, only the final run counts against your plan
        </span>
        <div className="flex items-center gap-2">
          {question !== null && (
            <Button variant="ghost" onClick={reset} disabled={running}>
              New conversation
            </Button>
          )}
          {awaitingReply && (
            <Button variant="ghost" onClick={skip} disabled={running}>
              Just run it
            </Button>
          )}
          <Button onClick={() => send(draft)} disabled={!connected || running || !draft.trim()}>
            {running ? "Working…" : awaitingReply ? "Reply" : "Ask"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Bubble({
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

  return <div className={`w-fit max-w-[85%] rounded-lg px-3 py-2 text-sm ${styles}`}>{children}</div>;
}
