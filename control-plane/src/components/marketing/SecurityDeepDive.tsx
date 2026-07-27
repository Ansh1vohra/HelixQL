import { Reveal } from "./Reveal";

const POINTS = [
  {
    title: "Credentials never transmitted",
    description: "Your database host, port, username, and password are held in the desktop app's memory only.",
  },
  {
    title: "Rows never transmitted",
    description: "Real data is read and displayed entirely inside the desktop app, on your machine.",
  },
  {
    title: "Every query is validated first",
    description: "An AST guardrail rejects anything but a read-only SELECT before it reaches your database.",
  },
];

export function SecurityDeepDive() {
  return (
    <section className="bg-slate-900 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="max-w-2xl">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-400">Security by architecture</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            The boundary isn&apos;t a policy. It&apos;s the network.
          </p>
          <p className="mt-4 text-slate-400">
            HelixQL is split into two tiers on purpose: a cloud gateway that only ever sees your schema, and a
            desktop app inside your firewall that&apos;s the only thing that ever touches your database.
          </p>
        </Reveal>

        <Reveal delay={0.15} className="mt-14">
          <div className="grid items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:p-8">
            <FlowBox label="Desktop app" sub="Inside your firewall" tone="safe" />
            <FlowArrow label="schema only" />
            <FlowBox label="HelixQL gateway" sub="Stateless, cloud" tone="neutral" />
            <FlowArrow label="prompt + schema" />
            <FlowBox label="Language model" sub="Translation only" tone="neutral" />
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">
            Real rows and database credentials never appear to the right of &quot;Desktop app.&quot;
          </p>
        </Reveal>

        <div className="mt-16 grid gap-8 sm:grid-cols-3">
          {POINTS.map((point, i) => (
            <Reveal key={point.title} delay={i * 0.1}>
              <div className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">{point.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">{point.description}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FlowBox({ label, sub, tone }: { label: string; sub: string; tone: "safe" | "neutral" }) {
  return (
    <div
      className={`rounded-xl border p-4 text-center ${
        tone === "safe" ? "border-brand-500/40 bg-brand-500/10" : "border-white/10 bg-white/5"
      }`}
    >
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
    </div>
  );
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 sm:py-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 rotate-90 text-slate-500 sm:rotate-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0l-5-5m5 5l-5 5" />
      </svg>
      <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7.4 7.4a1 1 0 01-1.4 0L3.3 9.5a1 1 0 111.4-1.4l3.6 3.6 6.7-6.7a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}
