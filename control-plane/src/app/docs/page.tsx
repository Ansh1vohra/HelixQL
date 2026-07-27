import Link from "next/link";
import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";

const SECTIONS = [
  { id: "getting-started", label: "Getting started" },
  { id: "connecting-a-database", label: "Connecting a database" },
  { id: "how-it-works", label: "How HelixQL works" },
  { id: "query-safety", label: "Query safety & guardrails" },
  { id: "usage-limits", label: "Usage limits & plans" },
  { id: "faq", label: "FAQ & troubleshooting" },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-1 text-sm">
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block rounded-md px-3 py-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 max-w-2xl space-y-16">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-slate-900">Documentation</h1>
              <p className="mt-3 text-lg text-slate-500">
                Everything you need to connect HelixQL to a database and start asking questions in plain English.
              </p>
            </div>

            <Section id="getting-started" title="Getting started">
              <ol className="list-decimal space-y-3 pl-5">
                <li>
                  <Link href="/register" className="font-medium text-brand-600 hover:text-brand-700">
                    Create an account
                  </Link>{" "}
                  on the web dashboard and verify your email — this activates your free-tier subscription and
                  issues your account&apos;s API token automatically.
                </li>
                <li>
                  <Link href="/download" className="font-medium text-brand-600 hover:text-brand-700">
                    Download and install
                  </Link>{" "}
                  the HelixQL desktop app for your operating system.
                </li>
                <li>
                  Open the desktop app and log in with the same email and password you used on the web dashboard.
                  It fetches and caches your API token automatically — you never handle it directly.
                </li>
                <li>Connect a database (see below) and ask your first question.</li>
              </ol>
            </Section>

            <Section id="connecting-a-database" title="Connecting a database">
              <p>
                HelixQL currently supports <Code>MySQL</Code> and <Code>PostgreSQL</Code>. Oracle support is planned.
              </p>
              <p>
                In the desktop app, enter your database <Code>Host</Code>, <Code>Port</Code>, <Code>Database name</Code>
                , <Code>Username</Code>, and <Code>Password</Code>. These credentials are used to open a local
                connection pool and{" "}
                <span className="font-medium text-slate-900">are never sent anywhere</span> — they&apos;re held in
                the desktop app&apos;s memory only, for the lifetime of the session.
              </p>
              <p>
                On first connection, HelixQL sweeps your database&apos;s system catalog to build a local schema
                blueprint — table and column names only, as empty <Code>CREATE TABLE</Code> statements. No rows are
                read during this step.
              </p>
            </Section>

            <Section id="how-it-works" title="How HelixQL works">
              <p>Every question you ask goes through the same pipeline:</p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>Your question and the relevant table/column names (never data) are sent to the HelixQL gateway.</li>
                <li>The gateway asks the language model to translate your question into SQL.</li>
                <li>
                  The generated SQL is parsed into an abstract syntax tree and checked against a strict allow-list —
                  only a read-only <Code>SELECT</Code> is permitted.
                </li>
                <li>The validated SQL is sent back to your desktop app.</li>
                <li>
                  The desktop app runs <Code>EXPLAIN</Code> against your database first, to estimate cost with zero
                  rows read, then executes the real query locally.
                </li>
                <li>Results are shown in the dashboard alongside the optimizer&apos;s cost metrics.</li>
              </ol>
            </Section>

            <Section id="query-safety" title="Query safety & guardrails">
              <p>
                HelixQL is built around one rule: generated SQL is validated before it ever reaches your database,
                not after.
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  The parser rejects anything whose root operation isn&apos;t a <Code>SELECT</Code> — including{" "}
                  <Code>DROP</Code>, <Code>DELETE</Code>, <Code>TRUNCATE</Code>, <Code>ALTER</Code>,{" "}
                  <Code>UPDATE</Code>, and <Code>INSERT</Code>.
                </li>
                <li>Only a single SQL statement is permitted per request — stacked-query tricks are rejected.</li>
                <li>
                  If your database driver raises an error (for example, a hallucinated column name), the exact error
                  is fed back to the model, which retries automatically — capped at 3 attempts before surfacing the
                  failure to you.
                </li>
              </ul>
            </Section>

            <Section id="usage-limits" title="Usage limits & plans">
              <p>
                Every query you run counts against your plan&apos;s monthly allowance, tracked in your{" "}
                <Link href="/dashboard" className="font-medium text-brand-600 hover:text-brand-700">
                  account dashboard
                </Link>
                . See the <Link href="/pricing" className="font-medium text-brand-600 hover:text-brand-700">
                  pricing page
                </Link>{" "}
                for plan details and limits.
              </p>
            </Section>

            <Section id="faq" title="FAQ & troubleshooting">
              <div className="space-y-5">
                <div>
                  <p className="font-medium text-slate-900">The desktop app says my api_token is invalid.</p>
                  <p>Log out and back in from the desktop app to fetch a fresh token from your account.</p>
                </div>
                <div>
                  <p className="font-medium text-slate-900">My query failed after 3 retries.</p>
                  <p>
                    This usually means the question doesn&apos;t map cleanly onto your schema. Try rephrasing with
                    the exact table or column names you have in mind.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Can I connect more than one database?</p>
                  <p>
                    The Free tier supports one connection at a time. See{" "}
                    <Link href="/pricing" className="font-medium text-brand-600 hover:text-brand-700">
                      pricing
                    </Link>{" "}
                    for higher tiers.
                  </p>
                </div>
              </div>
            </Section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
      <div className="prose-p:mt-4 mt-4 space-y-4 text-sm leading-relaxed text-slate-600 [&_ol]:space-y-2 [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-800">{children}</code>;
}
