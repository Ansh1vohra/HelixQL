"use client";

import { useRef } from "react";
import { motion, useScroll } from "framer-motion";

const EASE = [0.21, 0.47, 0.32, 0.98] as const;

const STEPS = [
  {
    title: "Ask in plain English",
    description: `"Who made the most orders from Gujarat this month?" — typed straight into the desktop dashboard. No SQL required.`,
  },
  {
    title: "Only the schema goes to the cloud",
    description:
      "The desktop app matches your question against a local, empty schema blueprint — table and column names only. Zero rows ever leave your network at this step.",
  },
  {
    title: "Generate, then validate",
    description:
      "The gateway asks the model for SQL, then compiles it into an abstract syntax tree and rejects anything that isn't a plain, single-statement SELECT.",
  },
  {
    title: "Estimate cost, then execute",
    description:
      "An EXPLAIN pass checks the optimizer's cost and row estimate in under a millisecond before the real, read-only query ever runs.",
  },
  {
    title: "Get your answer",
    description:
      "Results and the optimizer's cost metrics land side-by-side in your dashboard — plain English in, a validated answer out.",
  },
];

export function HowItWorksJourney() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.85", "end 0.7"],
  });

  return (
    <section className="bg-slate-50 py-16">
      <div className="mx-auto max-w-3xl px-6">
        <div className="max-w-2xl">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-600">How it works</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Follow a question from your keyboard to a validated answer.
          </p>
        </div>

        <div ref={containerRef} className="relative mt-10">
          <div className="absolute left-5 top-1 bottom-1 w-px bg-slate-200" />
          <motion.div
            className="absolute left-5 top-1 w-px origin-top bg-gradient-to-b from-brand-500 via-brand-400 to-brand-300"
            style={{ scaleY: scrollYProgress, height: "calc(100% - 0.5rem)" }}
          />

          <div className="space-y-6">
            {STEPS.map((step, index) => (
              <StepRow key={step.title} index={index} step={step} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StepRow({ index, step }: { index: number; step: (typeof STEPS)[number] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE }}
      className="relative flex items-start gap-5"
    >
      <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
        {index + 1}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h3 className="text-base font-semibold text-slate-900">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{step.description}</p>
      </div>
    </motion.div>
  );
}
