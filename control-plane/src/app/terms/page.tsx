import Link from "next/link";
import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Terms &amp; Conditions</h1>
        <p className="mt-3 text-sm text-slate-400">
          Last updated:{" "}
          {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>

        <div className="prose-p:mt-4 mt-10 space-y-8 text-sm leading-relaxed text-slate-600">
          <section>
            <p>
              These Terms &amp; Conditions (&quot;Terms&quot;) govern your access to and use of HelixQL, including
              the web dashboard, the desktop application, and the translation gateway (together, the
              &quot;Service&quot;). By creating an account or using the Service, you agree to these Terms. If you
              don&apos;t agree, please don&apos;t use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">1. The Service</h2>
            <p className="mt-3">
              HelixQL translates natural-language questions into SQL. The desktop application connects directly to
              a database you control and executes queries locally; the web dashboard and gateway handle account
              management, authentication, and query translation. Generated SQL is validated against a read-only
              guardrail before it can run, but{" "}
              <strong className="font-semibold text-slate-900">
                you remain responsible for reviewing query results before relying on them
              </strong>{" "}
              for any business, financial, or operational decision.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">2. Accounts</h2>
            <p className="mt-3">
              You must provide accurate information when registering and are responsible for keeping your
              credentials and API token confidential. You&apos;re responsible for all activity that occurs under
              your account. Notify us immediately at{" "}
              <Link href="/contact" className="font-medium text-brand-600 hover:text-brand-700">
                our contact page
              </Link>{" "}
              if you suspect unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">3. Acceptable use</h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Use the Service to connect to a database you do not own or are not authorized to access.</li>
              <li>Attempt to bypass, disable, or circumvent the query safety guardrail or usage limits.</li>
              <li>Reverse engineer, decompile, or attempt to extract the source code of the Service, except where applicable law expressly permits it.</li>
              <li>Use the Service for any unlawful purpose, or in a way that infringes on the rights of others.</li>
              <li>Resell or provide the Service to third parties without our prior written consent.</li>
            </ul>
            <p className="mt-3">We may suspend or terminate accounts that violate this section.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">4. Your data and database</h2>
            <p className="mt-3">
              You retain all ownership rights to your data, your database, and its schema. As described in our{" "}
              <Link href="/privacy" className="font-medium text-brand-600 hover:text-brand-700">
                Privacy Policy
              </Link>
              , database credentials and row-level data are processed entirely within the desktop application on
              infrastructure you control — we do not have access to them. You are solely responsible for ensuring
              you have the necessary rights and authorization to connect the Service to any database you use it
              with, and for complying with any laws or contractual obligations that apply to that data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">5. Subscriptions, billing &amp; cancellation</h2>
            <p className="mt-3">
              Paid plans are billed in advance on a recurring basis until cancelled. You can cancel at any time; see
              our{" "}
              <Link href="/refund-policy" className="font-medium text-brand-600 hover:text-brand-700">
                Cancellation &amp; Refund Policy
              </Link>{" "}
              for full details, including when refunds may be issued.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">6. Intellectual property</h2>
            <p className="mt-3">
              HelixQL and its software, branding, and documentation are our property or that of our licensors. These
              Terms don&apos;t grant you any rights to our trademarks or branding. You keep all rights to your own
              data, schema, and the natural-language questions you submit.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">7. Disclaimers</h2>
            <p className="mt-3">
              The Service is provided &quot;as is&quot; and &quot;as available.&quot; Generated SQL and its results
              are produced by an automated language model and, while passed through our safety guardrail, may
              still be incorrect, incomplete, or fail to capture the intent of your question. We do not warrant
              that the Service will be uninterrupted, error-free, or that generated queries will always be
              accurate.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">8. Limitation of liability</h2>
            <p className="mt-3">
              To the maximum extent permitted by law, HelixQL will not be liable for any indirect, incidental,
              special, or consequential damages, or for any loss of data, profits, or business arising from your
              use of the Service. Our total liability for any claim relating to the Service is limited to the
              amount you paid us in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">9. Termination</h2>
            <p className="mt-3">
              You may stop using the Service and cancel your account at any time. We may suspend or terminate your
              access if you violate these Terms, or if we discontinue the Service, with notice where reasonably
              possible.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">10. Changes to these Terms</h2>
            <p className="mt-3">
              We may update these Terms from time to time. If we make material changes, we&apos;ll update the date
              at the top of this page. Continued use of the Service after changes take effect constitutes
              acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">11. Governing law</h2>
            <p className="mt-3">
              These Terms are governed by the laws of the jurisdiction in which HelixQL is established, without
              regard to conflict-of-law principles, except where applicable local consumer protection law requires
              otherwise.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">12. Contact</h2>
            <p className="mt-3">
              Questions about these Terms?{" "}
              <Link href="/contact" className="font-medium text-brand-600 hover:text-brand-700">
                Reach out to us
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
