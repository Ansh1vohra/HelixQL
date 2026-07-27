import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { getAccountOverview } from "@/lib/services/authService";
import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";

export const dynamic = "force-dynamic";

const GETTING_STARTED_STEPS = [
  {
    title: "Download the app",
    description: "Get the HelixQL desktop client for macOS, Windows, or Linux.",
    href: "/download",
    linkLabel: "Download",
  },
  {
    title: "Log in",
    description: "Sign in with this email and your account password — your token is fetched automatically.",
  },
  {
    title: "Connect a database",
    description: "Enter your host, port, and credentials. They stay on your machine, never in the cloud.",
    href: "/docs#connecting-a-database",
    linkLabel: "See how",
  },
  {
    title: "Ask your first question",
    description: `Try something like "What were our top 5 customers last quarter?"`,
  },
];

export default async function DashboardPage() {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await verifySessionToken(sessionToken) : null;
  if (!session) {
    redirect("/login");
  }

  const account = await getAccountOverview(session.userId);
  const usagePercent = account.plan
    ? Math.min(100, Math.round(((account.usage?.queriesUsedThisPeriod ?? 0) / account.plan.monthlyQueryLimit) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Welcome back, {account.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{account.email}</p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-2 text-slate-400">
              <PlanIcon className="h-4 w-4" />
              <h2 className="text-sm font-medium">Plan</h2>
            </div>
            <p className="mt-2 text-xl font-semibold text-slate-900">{account.plan?.name ?? "No plan"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {account.plan ? `${account.plan.monthlyQueryLimit} queries / month` : "—"}
            </p>
            <Link href="/pricing" className="mt-3 inline-block text-xs font-medium text-brand-600 hover:text-brand-700">
              Compare plans
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-2 text-slate-400">
              <GaugeIcon className="h-4 w-4" />
              <h2 className="text-sm font-medium">Usage this period</h2>
            </div>
            <p className="mt-2 text-xl font-semibold text-slate-900">
              {account.usage?.queriesUsedThisPeriod ?? 0}
              {account.plan ? ` / ${account.plan.monthlyQueryLimit}` : ""}
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${usagePercent}%` }} />
            </div>
            {account.usage && (
              <p className="mt-2 text-xs text-slate-400">
                Resets {new Date(account.usage.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {/* Download app banner */}
        <div className="mt-6 flex flex-col items-start gap-5 rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
              <DesktopIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Get the HelixQL desktop app</h2>
              <p className="mt-1 max-w-md text-sm text-slate-600">
                The desktop client is what actually connects to your database — everything stays inside your
                network. Available for macOS, Windows, and Linux.
              </p>
            </div>
          </div>
          <Link
            href="/download"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500"
          >
            <DownloadIcon className="h-4 w-4" />
            Download
          </Link>
        </div>

        {/* Getting started steps */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">Getting started</h2>
          <p className="mt-1 text-sm text-slate-500">Four steps from install to your first answer.</p>

          <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {GETTING_STARTED_STEPS.map((step, index) => (
              <li key={step.title} className="relative pl-9">
                <span className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{step.description}</p>
                {step.href && (
                  <Link href={step.href} className="mt-2 inline-block text-xs font-medium text-brand-600 hover:text-brand-700">
                    {step.linkLabel} →
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </div>

        {/* Support + docs */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <ChatIcon className="h-4 w-4" />
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-900">Facing an issue?</h2>
            <p className="mt-1 text-sm text-slate-500">
              Connection problems, a query that won&apos;t validate, or anything else — we usually reply within a
              business day.
            </p>
            <Link
              href="/contact"
              className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Contact us
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <BookIcon className="h-4 w-4" />
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-900">Read the docs</h2>
            <p className="mt-1 text-sm text-slate-500">
              Installation, connecting a database, and exactly how the safety guardrails work.
            </p>
            <Link
              href="/docs"
              className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              View documentation
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 2a1 1 0 011 1v7.6l2.3-2.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4l2.3 2.3V3a1 1 0 011-1z" />
      <path d="M3 14a1 1 0 011 1v1a1 1 0 001 1h10a1 1 0 001-1v-1a1 1 0 112 0v1a3 3 0 01-3 3H5a3 3 0 01-3-3v-1a1 1 0 011-1z" />
    </svg>
  );
}

function DesktopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path strokeLinecap="round" d="M8 20h8M12 16v4" />
    </svg>
  );
}

function PlanIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
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

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H9l-4 4v-4H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 15.5v-10z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 15.5A2.5 2.5 0 016.5 18H20" />
    </svg>
  );
}
