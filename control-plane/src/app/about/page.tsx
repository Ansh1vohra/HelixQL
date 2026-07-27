import Link from "next/link";
import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";

const PRINCIPLES = [
  {
    title: "Your data is not our product",
    description:
      "We built HelixQL around a hard constraint: real rows and database credentials never leave your network. Not as a policy we promise to follow, but as something the architecture makes true.",
  },
  {
    title: "Safety before speed",
    description:
      "Every generated query passes through an abstract-syntax-tree guardrail before it can touch your database. If we can't validate it's a safe, read-only SELECT, it doesn't run — no exceptions.",
  },
  {
    title: "Transparent about limits",
    description:
      "We'd rather tell you a feature isn't ready yet than ship something that quietly does the wrong thing with your data.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main>
        <section className="bg-slate-900 py-20">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">Why we built HelixQL</h1>
            <p className="mt-5 text-lg text-slate-400">
              Most natural-language-to-SQL tools ask you to send your database to the cloud. We didn&apos;t think
              that trade-off should be necessary — so we built the alternative: a system where only your schema
              travels, never your data.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">The problem</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Business teams need answers from the database faster than most companies can write SQL for them. The
            obvious fix — a cloud AI tool that connects directly to your production database — asks security and
            compliance teams to accept a trade-off they often can&apos;t: sending real customer data to a
            third-party model.
          </p>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            HelixQL is built for teams who need both: natural-language answers, and a hard guarantee that their
            data never leaves their own infrastructure to get them.
          </p>

          <h2 className="mt-14 text-2xl font-bold tracking-tight text-slate-900">Our principles</h2>
          <div className="mt-6 space-y-8">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title}>
                <h3 className="text-base font-semibold text-slate-900">{principle.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{principle.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm text-slate-600">Have a question about how HelixQL works, or want to talk to us directly?</p>
            <Link
              href="/contact"
              className="mt-4 inline-flex rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              Get in touch
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
