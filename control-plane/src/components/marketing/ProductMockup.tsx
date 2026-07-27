const ROWS = [
  { name: "Priya Shah", city: "Ahmedabad", orders: 42 },
  { name: "Rohan Mehta", city: "Surat", orders: 37 },
  { name: "Ananya Patel", city: "Vadodara", orders: 31 },
];

export function ProductMockup() {
  return (
    <div className="relative">
      <div
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-500/20 via-brand-400/10 to-transparent blur-2xl"
        aria-hidden
      />
      <div className="overflow-hidden rounded-2xl border border-slate-200/10 bg-slate-900 shadow-2xl shadow-slate-900/40">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-white/5 bg-slate-950/60 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 text-xs font-medium text-slate-400">HelixQL Desktop — connected to prod-analytics</span>
        </div>

        <div className="p-5">
          {/* NL input bar */}
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
            <span className="text-brand-400">›</span>
            <span className="text-sm text-slate-200">Who made the most orders from Gujarat this month?</span>
            <span className="ml-auto rounded-md bg-brand-500 px-2.5 py-1 text-xs font-semibold text-slate-900">
              Run
            </span>
          </div>

          {/* Guardrail badge */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 font-medium text-emerald-300">
              <CheckIcon /> AST validated · SELECT only
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-400/10 px-2.5 py-1 font-medium text-brand-300">
              <BoltIcon /> EXPLAIN cost: 0.4ms
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 font-medium text-slate-400">
              Zero rows left the firewall until execution
            </span>
          </div>

          {/* Generated SQL */}
          <pre className="mt-4 overflow-x-auto rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-slate-300">
            <code>
              <span className="text-brand-400">SELECT</span> u.name, u.city,{" "}
              <span className="text-brand-400">COUNT</span>(o.id) <span className="text-brand-400">AS</span>{" "}
              order_count{"\n"}
              <span className="text-brand-400">FROM</span> users u{"\n"}
              <span className="text-brand-400">JOIN</span> orders o <span className="text-brand-400">ON</span>{" "}
              o.user_id = u.id{"\n"}
              <span className="text-brand-400">WHERE</span> u.state = &apos;Gujarat&apos;{"\n"}
              <span className="text-brand-400">  AND</span> o.created_at &gt;={" "}
              <span className="text-brand-400">date_trunc</span>(&apos;month&apos;, now()){"\n"}
              <span className="text-brand-400">GROUP BY</span> u.name, u.city{"\n"}
              <span className="text-brand-400">ORDER BY</span> order_count{" "}
              <span className="text-brand-400">DESC</span> <span className="text-brand-400">LIMIT</span> 3;
            </code>
          </pre>

          {/* Split panel: results + cost */}
          <div className="mt-4 grid grid-cols-5 gap-3">
            <div className="col-span-3 overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">City</th>
                    <th className="px-3 py-2 font-medium">Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {ROWS.map((row) => (
                    <tr key={row.name}>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 text-slate-400">{row.city}</td>
                      <td className="px-3 py-2 font-semibold text-brand-300">{row.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="col-span-2 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Optimizer</div>
              <dl className="mt-2 space-y-1.5 text-xs text-slate-300">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Plan</dt>
                  <dd>Index Scan</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Rows (est.)</dt>
                  <dd>128</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Cost</dt>
                  <dd className="text-brand-300">0.4ms</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7.4 7.4a1 1 0 01-1.4 0L3.3 9.5a1 1 0 111.4-1.4l3.6 3.6 6.7-6.7a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
      <path d="M11 2 3 12h6l-1 6 8-10h-6l1-6z" />
    </svg>
  );
}
