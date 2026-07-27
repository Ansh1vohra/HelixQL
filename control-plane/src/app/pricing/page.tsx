import Link from "next/link";
import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";

interface Tier {
  name: string;
  price: string;
  cadence?: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
  badge?: string;
}

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "/month",
    description: "For individuals and small teams trying HelixQL against a single database.",
    features: [
      "100 queries / month",
      "1 database connection",
      "MySQL & PostgreSQL",
      "AST safety guardrail + EXPLAIN cost estimation",
      "Community support",
    ],
    cta: { label: "Get started free", href: "/register" },
  },
  {
    name: "Pro",
    price: "$49",
    cadence: "/month",
    description: "For teams running HelixQL against production databases day-to-day.",
    features: [
      "2,000 queries / month",
      "Unlimited database connections",
      "MySQL, PostgreSQL, and Oracle",
      "Query history & CSV export",
      "Priority email support",
    ],
    cta: { label: "Contact sales", href: "mailto:sales@helixql.dev?subject=HelixQL%20Pro" },
    highlighted: true,
    badge: "Coming soon",
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For organizations with dedicated compliance, SSO, or deployment requirements.",
    features: [
      "Custom monthly query allowance",
      "SSO / SAML",
      "Private VPC gateway deployment",
      "Audit logs & admin controls",
      "Dedicated support & SLA",
    ],
    cta: { label: "Contact sales", href: "mailto:sales@helixql.dev?subject=HelixQL%20Enterprise" },
  },
];

const FAQS = [
  {
    q: "Does HelixQL ever see our actual data?",
    a: "No. Only table and column names (an empty schema blueprint) ever leave your network. Real rows are read and displayed entirely inside the desktop app, on your machine.",
  },
  {
    q: "What counts as a query?",
    a: "Every natural-language question you ask counts as one query against your monthly allowance, whether or not it returns rows. Retries from the self-healing loop reuse the same query — they don't count again.",
  },
  {
    q: "What happens if we go over our plan's limit?",
    a: "HelixQL blocks further translations until your billing period rolls over, or you upgrade. Your database connection and cached results are unaffected.",
  },
  {
    q: "Can we self-host the gateway?",
    a: "Enterprise plans support deploying the translation gateway inside your own VPC. Contact sales for details.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Simple, usage-based pricing</h1>
          <p className="mt-4 text-lg text-slate-500">
            Start free. Upgrade when your team needs more queries, more connections, or enterprise controls.
          </p>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border p-8 ${
                tier.highlighted ? "border-brand-500 shadow-lg shadow-brand-500/10" : "border-slate-200"
              }`}
            >
              {tier.badge && (
                <span className="absolute -top-3 left-8 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                  {tier.badge}
                </span>
              )}
              <h2 className="text-lg font-semibold text-slate-900">{tier.name}</h2>
              <p className="mt-2 text-sm text-slate-500">{tier.description}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight text-slate-900">{tier.price}</span>
                {tier.cadence && <span className="text-sm text-slate-500">{tier.cadence}</span>}
              </div>

              <Link
                href={tier.cta.href}
                className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition ${
                  tier.highlighted
                    ? "bg-brand-600 text-white hover:bg-brand-500"
                    : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tier.cta.label}
              </Link>

              <ul className="mt-8 space-y-3 text-sm text-slate-600">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Pro and Enterprise billing are launching soon — reach out and we&apos;ll get your team set up manually in
          the meantime.
        </p>

        <div className="mx-auto mt-24 max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Frequently asked questions</h2>
          <dl className="mt-8 space-y-8">
            {FAQS.map((faq) => (
              <div key={faq.q}>
                <dt className="text-base font-semibold text-slate-900">{faq.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-slate-500">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </main>
      <Footer />
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
