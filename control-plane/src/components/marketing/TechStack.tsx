import { Reveal } from "./Reveal";

const STACK = [
  "Google Gemini 2.5 Flash",
  "SQLGlot",
  "FastAPI",
  "Electron",
  "MySQL",
  "PostgreSQL",
];

export function TechStack() {
  return (
    <section className="border-y border-slate-100 bg-white py-14">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Under the hood</p>
        </Reveal>
        <Reveal delay={0.1} className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {STACK.map((tech) => (
            <span
              key={tech}
              className="rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-sm font-medium text-slate-600"
            >
              {tech}
            </span>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
