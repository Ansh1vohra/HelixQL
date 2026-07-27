import Link from "next/link";
import { Reveal } from "./Reveal";

const FAQS = [
  {
    q: "Does HelixQL ever see our actual data?",
    a: "No. Only table and column names — an empty schema blueprint — ever leave your network. Real rows are read and displayed entirely inside the desktop app, on your machine.",
  },
  {
    q: "What stops the model from generating a destructive query?",
    a: "Every generated query is parsed into an abstract syntax tree and checked against a strict allow-list. Anything that isn't a single, read-only SELECT — including DROP, DELETE, UPDATE, and INSERT — is rejected before it ever reaches your database.",
  },
  {
    q: "Which databases are supported?",
    a: "MySQL and PostgreSQL today, with Oracle support planned. See the docs for connection details.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes — 100 queries a month, one database connection, no credit card required. See pricing for the full breakdown.",
  },
];

export function HomeFaq() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Common questions</h2>
        </Reveal>
        <dl className="mt-10 space-y-8">
          {FAQS.map((faq, i) => (
            <Reveal key={faq.q} delay={i * 0.05}>
              <dt className="text-base font-semibold text-slate-900">{faq.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-slate-500">{faq.a}</dd>
            </Reveal>
          ))}
        </dl>
        <Reveal delay={0.2} className="mt-10 text-sm text-slate-500">
          More questions?{" "}
          <Link href="/docs" className="font-medium text-brand-600 hover:text-brand-700">
            Read the docs
          </Link>{" "}
          or{" "}
          <Link href="/contact" className="font-medium text-brand-600 hover:text-brand-700">
            contact us
          </Link>
          .
        </Reveal>
      </div>
    </section>
  );
}
