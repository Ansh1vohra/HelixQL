import type { PipelineResult } from "../../../shared/types";
import { DataGrid } from "./DataGrid";
import { EmptyState } from "./ui";

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-mono text-xs text-slate-800">{value}</div>
    </div>
  );
}

/**
 * The diagnostics half of the dashboard (FR-2.6): the optimizer's cost
 * estimate, the generated SQL, stage timings, and — when the model had to
 * correct itself — the full self-heal trail.
 */
export function DiagnosticsPanel({ result }: { result: PipelineResult | null }): JSX.Element {
  if (!result) {
    return <EmptyState>Optimizer cost metrics and the generated SQL appear here after a run.</EmptyState>;
  }

  const { timings } = result;

  return (
    <div className="space-y-4 p-3">
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Generated SQL</h3>
        <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-brand-700">
          {result.sql}
        </pre>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
          <span>tables: {result.tables.join(", ") || "—"}</span>
          {result.limitApplied !== null && <span>row cap applied: {result.limitApplied}</span>}
          {result.attempts > 1 && <span className="text-amber-600">self-healed after {result.attempts} attempts</span>}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Optimizer plan (EXPLAIN, no ANALYZE)
        </h3>
        <div className="max-h-64 overflow-auto rounded border border-slate-200">
          <DataGrid grid={result.plan} emptyMessage="The database returned no plan rows." />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Stage timings</h3>
        <div className="grid grid-cols-3 gap-1.5">
          <Metric label="Schema prune" value={timings.schemaMs ? `${timings.schemaMs} ms` : "—"} />
          <Metric label="Gateway" value={`${timings.translateMs} ms`} />
          <Metric label="Explain" value={`${timings.explainMs} ms`} />
          <Metric label="Execute" value={`${timings.executeMs} ms`} />
          <Metric label="Total" value={`${timings.totalMs} ms`} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Sent to gateway
        </h3>
        <p className="text-[11px] leading-relaxed text-slate-500">
          {result.schemaTablesSent.length > 0
            ? result.schemaTablesSent.join(", ")
            : "Query text only — no schema was sent."}
        </p>
        <p className="mt-1 text-[10px] text-slate-400">
          Empty CREATE TABLE structures only. No result row ever leaves this machine.
        </p>
      </div>

      {result.repairs.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-600">
            Self-correction trail
          </h3>
          <div className="space-y-2">
            {result.repairs.map((repair) => (
              <div key={repair.attempt} className="rounded border border-amber-200 bg-amber-50 p-2">
                <div className="mb-1 text-[10px] font-semibold text-amber-600">Attempt {repair.attempt} rejected</div>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-slate-500">
                  {repair.sql}
                </pre>
                <div className="mt-1 font-mono text-[10px] text-red-600">{repair.error}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
