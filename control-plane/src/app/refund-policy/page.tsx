import Link from "next/link";
import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Cancellation &amp; Refund Policy</h1>
        <p className="mt-3 text-sm text-slate-400">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

        <div className="prose-p:mt-4 mt-10 space-y-8 text-sm leading-relaxed text-slate-600">
          <section>
            <h2 className="text-lg font-semibold text-slate-900">Cancelling your subscription</h2>
            <p className="mt-3">
              You can cancel a paid HelixQL subscription at any time from your account dashboard, or by{" "}
              <Link href="/contact" className="font-medium text-brand-600 hover:text-brand-700">
                contacting us
              </Link>
              . When you cancel, your plan remains active until the end of the billing period you&apos;ve already
              paid for, and will not renew afterward. Your account then reverts to the Free tier rather than being
              deleted.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Refunds</h2>
            <p className="mt-3">
              Subscription fees are billed in advance for the period they cover and are{" "}
              <strong className="font-semibold text-slate-900">non-refundable</strong>, including for partial
              billing periods, unused query allowance, or early cancellation. By subscribing to a paid plan, you
              acknowledge and agree to this policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Exceptions</h2>
            <p className="mt-3">
              We may, at our sole discretion, issue a full or partial refund in special circumstances, including
              (but not limited to):
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>A duplicate or erroneous charge caused by a billing error on our part.</li>
              <li>An extended service outage that materially prevented you from using HelixQL during the billing period.</li>
              <li>Circumstances required by applicable consumer protection law in your jurisdiction.</li>
            </ul>
            <p className="mt-3">
              To request an exception, contact us within 14 days of the charge with your account email and a
              description of the issue. We review every request individually — approval is not guaranteed outside
              the circumstances above.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Questions</h2>
            <p className="mt-3">
              If anything here is unclear, or you believe your situation warrants an exception,{" "}
              <Link href="/contact" className="font-medium text-brand-600 hover:text-brand-700">
                contact us
              </Link>{" "}
              and we&apos;ll help.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
