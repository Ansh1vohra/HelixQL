import Link from "next/link";
import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Privacy Policy</h1>
        <p className="mt-3 text-sm text-slate-400">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

        <div className="prose-p:mt-4 mt-10 space-y-8 text-sm leading-relaxed text-slate-600">
          <section>
            <p>
              This policy describes what HelixQL collects, why, and — just as importantly — what it is
              architecturally designed to never see. If you&apos;re evaluating HelixQL for a security or compliance
              review, the short version is: your database credentials and the actual rows in your database never
              reach us. Only table and column names (schema metadata) do, for the purpose of generating SQL.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Information we collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="font-medium text-slate-900">Account information:</strong> name, email address, and a securely hashed password (we never store or can recover your plaintext password).</li>
              <li><strong className="font-medium text-slate-900">Subscription &amp; usage data:</strong> your plan, and a count of queries run per billing period, used to enforce plan limits.</li>
              <li><strong className="font-medium text-slate-900">Schema metadata:</strong> table and column names from your connected database, sent from the desktop app to our translation gateway solely to generate SQL for your question.</li>
              <li><strong className="font-medium text-slate-900">Your questions:</strong> the natural-language text you type is sent to our translation gateway and to our language model provider to produce SQL. It is not stored permanently by HelixQL.</li>
              <li><strong className="font-medium text-slate-900">Basic usage logs:</strong> action names and timestamps (for example, that a login or a query translation occurred) for security and reliability purposes — never the content of your questions or the SQL generated from them.</li>
              <li><strong className="font-medium text-slate-900">Contact form submissions:</strong> if you email us via the contact form, we receive your name, email, and message to respond to you. These are relayed directly to our support inbox and are not otherwise stored in our systems.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Information we never collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Your database host, port, username, or password — these are held only in the desktop app&apos;s local memory and are never transmitted to us.</li>
              <li>The actual rows or contents of your database. Queries execute locally in the desktop app, inside your network.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Third parties we share data with</h2>
            <p className="mt-3">To operate HelixQL, limited data is processed by:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="font-medium text-slate-900">Google (Gemini API):</strong> receives your natural-language question and schema metadata to generate SQL. It does not receive database rows.</li>
              <li><strong className="font-medium text-slate-900">MongoDB Atlas:</strong> hosts our account, subscription, and usage database.</li>
              <li><strong className="font-medium text-slate-900">Our email provider:</strong> sends account verification emails and delivers contact form messages.</li>
            </ul>
            <p className="mt-3">We do not sell your data, and we do not use it for advertising.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Cookies</h2>
            <p className="mt-3">
              We use a single, essential, httpOnly session cookie to keep you signed in to the web dashboard. We do
              not use third-party advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Data retention</h2>
            <p className="mt-3">
              We retain account data for as long as your account is active. If you&apos;d like your account and
              associated data deleted,{" "}
              <Link href="/contact" className="font-medium text-brand-600 hover:text-brand-700">
                contact us
              </Link>{" "}
              and we&apos;ll process the request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Your rights</h2>
            <p className="mt-3">
              You can request access to, correction of, or deletion of your account data at any time by{" "}
              <Link href="/contact" className="font-medium text-brand-600 hover:text-brand-700">
                contacting us
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Children&apos;s privacy</h2>
            <p className="mt-3">HelixQL is a business tool not directed at, or intended for use by, children.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Changes to this policy</h2>
            <p className="mt-3">
              If we make material changes to this policy, we&apos;ll update the date at the top of this page.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Contact</h2>
            <p className="mt-3">
              Questions about this policy? <Link href="/contact" className="font-medium text-brand-600 hover:text-brand-700">Reach out to us</Link>.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
