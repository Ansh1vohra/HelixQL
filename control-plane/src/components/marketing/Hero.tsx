"use client";

import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { ProductMockup } from "./ProductMockup";

const EASE = [0.21, 0.47, 0.32, 0.98] as const;

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-slate-900">
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(45,212,191,0.15),transparent)]"
        aria-hidden
        animate={{ opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative mx-auto grid max-w-6xl gap-14 px-6 pb-20 pt-16 lg:grid-cols-2 lg:items-center lg:pb-28 lg:pt-24">
        <motion.div variants={container} initial="hidden" animate="visible">
          <motion.span
            variants={item}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-400" />
            </span>
            Your data never leaves your firewall
          </motion.span>

          <motion.h1 variants={item} className="mt-6 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
            Ask your database a question.
            <br />
            Get safe, validated SQL <span className="text-brand-400">instantly</span>.
          </motion.h1>

          <motion.p variants={item} className="mt-5 max-w-lg text-lg text-slate-400">
            HelixQL turns plain-English questions into SQL your database can run — validated by a strict
            read-only guardrail and cost-checked before a single row is ever touched. Runs as a desktop
            app inside your network; only schema metadata ever reaches the cloud.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/register"
              className="rounded-lg bg-brand-500 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 hover:bg-brand-400 hover:shadow-lg hover:shadow-brand-500/20"
            >
              Get started free
            </Link>
            <Link
              href="/download"
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/5"
            >
              <DownloadIcon />
              Download desktop app
            </Link>
          </motion.div>

          <motion.p variants={item} className="mt-4 text-xs text-slate-500">
            Free tier included · No credit card required
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
        >
          <ProductMockup />
        </motion.div>
      </div>
    </section>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 2a1 1 0 011 1v7.6l2.3-2.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4l2.3 2.3V3a1 1 0 011-1z" />
      <path d="M3 14a1 1 0 011 1v1a1 1 0 001 1h10a1 1 0 001-1v-1a1 1 0 112 0v1a3 3 0 01-3 3H5a3 3 0 01-3-3v-1a1 1 0 011-1z" />
    </svg>
  );
}
