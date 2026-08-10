import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
      />
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
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
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select
        {...props}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
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
    primary: "bg-brand-600 text-white hover:bg-brand-500 disabled:bg-slate-200 disabled:text-slate-400",
    ghost: "border border-slate-300 text-slate-600 hover:border-slate-400 hover:text-slate-900",
    danger: "border border-red-200 text-red-600 hover:border-red-400 hover:text-red-700",
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
    <section className={`flex min-h-0 flex-col rounded-lg border border-slate-200 bg-slate-50 ${className}`}>
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
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
    error: "border-red-200 bg-red-50 text-red-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    info: "border-slate-300 bg-slate-100 text-slate-600",
    success: "border-brand-200 bg-brand-50 text-brand-700",
  }[tone];

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-xs opacity-90">{children}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-400">{children}</div>;
}
