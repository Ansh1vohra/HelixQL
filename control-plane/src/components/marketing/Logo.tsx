export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="40" height="40" rx="10" fill="#0f172a" />
      <path
        d="M9 15c3.5-4 7-4 10 0s6.5 4 10 0"
        stroke="url(#helix-a)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M9 25c3.5 4 7 4 10 0s6.5-4 10 0"
        stroke="url(#helix-b)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <defs>
        <linearGradient id="helix-a" x1="9" y1="15" x2="29" y2="15" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0d9488" />
        </linearGradient>
        <linearGradient id="helix-b" x1="9" y1="25" x2="29" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0d9488" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Logo({ className, textClassName }: { className?: string; textClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark className="h-8 w-8" />
      <span className={`text-lg font-bold tracking-tight ${textClassName ?? "text-slate-900"}`}>HelixQL</span>
    </span>
  );
}
