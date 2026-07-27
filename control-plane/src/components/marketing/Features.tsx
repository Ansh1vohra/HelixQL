import { Reveal, RevealStagger, RevealStaggerItem } from "./Reveal";

const FEATURES = [
  {
    title: "Natural language to SQL",
    description:
      "Ask a business question in plain English. HelixQL translates it into dialect-correct SQL using a deterministic, zero-temperature model.",
    icon: ChatIcon,
  },
  {
    title: "AST safety guardrail",
    description:
      "Every generated query is parsed into an abstract syntax tree and checked against a strict allow-list. Anything but a read-only SELECT is rejected before it ever reaches your database.",
    icon: ShieldIcon,
  },
  {
    title: "Zero-impact cost estimation",
    description:
      "Queries run through EXPLAIN first, giving you the optimizer's cost and row estimate in under a millisecond — with zero rows read.",
    icon: GaugeIcon,
  },
  {
    title: "Local-only execution",
    description:
      "Your database credentials and every row of real data stay on the desktop app inside your network. Only table/column schema — never data — ever reaches the cloud.",
    icon: LockIcon,
  },
  {
    title: "Self-healing queries",
    description:
      "If the generated SQL references a column that doesn't exist, HelixQL feeds the exact driver error back to the model and retries automatically, up to three times.",
    icon: RefreshIcon,
  },
  {
    title: "Usage-aware plans",
    description:
      "Built-in, race-safe query metering per billing period, so you always know exactly where your team stands against its plan.",
    icon: ChartIcon,
  },
];

export function Features() {
  return (
    <section id="features" className="bg-white py-20">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="max-w-2xl">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-600">Why HelixQL</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Built for teams whose data can&apos;t leave the building.
          </p>
        </Reveal>

        <RevealStagger className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <RevealStaggerItem key={feature.title}>
              <div className="h-full rounded-2xl border border-slate-200 p-6 transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg hover:shadow-slate-200/50">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-slate-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{feature.description}</p>
              </div>
            </RevealStaggerItem>
          ))}
        </RevealStagger>
      </div>
    </section>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H9l-4 4v-4H4a1 1 0 01-1-1V6a1 1 0 011-1z"
      />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
    </svg>
  );
}

function GaugeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 15a8 8 0 1116 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15l4-5" />
      <path strokeLinecap="round" d="M12 15h.01" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 10a8 8 0 0114-4.9M20 14a8 8 0 01-14 4.9"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  );
}
