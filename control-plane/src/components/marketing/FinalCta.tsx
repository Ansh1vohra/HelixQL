import Link from "next/link";

export function FinalCta() {
  return (
    <section className="bg-slate-900 py-16">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Start asking your database questions today.
        </h2>
        <p className="mt-3 text-slate-400">Free tier included. No credit card required.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/register"
            className="rounded-lg bg-brand-500 px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-brand-400"
          >
            Get started free
          </Link>
          <Link
            href="/download"
            className="rounded-lg border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
          >
            Download desktop app
          </Link>
        </div>
      </div>
    </section>
  );
}
