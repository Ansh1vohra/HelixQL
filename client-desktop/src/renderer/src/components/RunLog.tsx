import type { PipelineEvent } from "../../../shared/types";

/**
 * Every progress event of the current run, oldest first.
 *
 * The status line beside the Run button only ever shows the latest event,
 * and during self-correction that is replaced within a second — so without
 * this, a query the model had to repair looks identical to one that worked
 * first time, and a run that exhausted its repairs shows only the final
 * error. Here each rejected attempt stays on screen: the SQL that failed
 * and the database error that sent it back.
 */
export function RunLog({ events, running }: { events: PipelineEvent[]; running: boolean }): JSX.Element {
  return (
    <ol className="space-y-1.5">
      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        const next = events[index + 1];
        // An optimizer check followed by a repair is the attempt that was
        // rejected; its detail is the SQL the database refused.
        const rejected = event.step === "explaining" && next?.step === "repairing";
        const active = running && isLast;

        return (
          <li key={index} className="flex gap-2">
            <StepIcon event={event} rejected={rejected} active={active} />
            <div className="min-w-0 flex-1">
              <p
                className={`text-xs ${
                  event.step === "repairing" ? "font-medium text-amber-700" : rejected ? "text-slate-500" : "text-slate-700"
                } ${active ? "animate-pulse" : ""}`}
              >
                {event.message}
              </p>

              {rejected && event.detail && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-2xs text-slate-400 hover:text-slate-600">
                    SQL that was rejected
                  </summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 font-mono text-2xs text-slate-500">
                    {event.detail}
                  </pre>
                </details>
              )}

              {event.step === "repairing" && event.detail && (
                <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-2xs text-red-600">
                  {event.detail}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({
  event,
  rejected,
  active,
}: {
  event: PipelineEvent;
  rejected: boolean;
  active: boolean;
}): JSX.Element {
  const [glyph, tone] = active
    ? ["●", "animate-pulse text-brand-500"]
    : event.step === "repairing"
      ? ["↻", "text-amber-600"]
      : rejected
        ? ["✕", "text-red-500"]
        : ["✓", "text-brand-600"];

  return <span className={`mt-px w-4 shrink-0 text-center text-xs ${tone}`}>{glyph}</span>;
}
