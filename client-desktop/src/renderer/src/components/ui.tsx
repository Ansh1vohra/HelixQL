import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
      />
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <select
        {...props}
        className="w-full rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
      >
        {children}
      </select>
    </label>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: { variant?: "primary" | "ghost" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const styles = {
    primary: "bg-brand-600 text-white hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500",
    ghost: "border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white",
    danger: "border border-red-900/60 text-red-300 hover:border-red-700 hover:text-red-200",
  }[variant];

  return (
    <button
      {...props}
      className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles}`}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`flex min-h-0 flex-col rounded-lg border border-slate-800 bg-slate-900/40 ${className}`}>
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export function Banner({
  tone,
  title,
  children,
}: {
  tone: "error" | "warning" | "info" | "success";
  title: string;
  children?: ReactNode;
}): JSX.Element {
  const styles = {
    error: "border-red-900/60 bg-red-950/40 text-red-200",
    warning: "border-amber-900/60 bg-amber-950/30 text-amber-200",
    info: "border-slate-700 bg-slate-900/60 text-slate-300",
    success: "border-brand-800 bg-brand-950/40 text-brand-200",
  }[tone];

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-xs opacity-90">{children}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-600">{children}</div>;
}
