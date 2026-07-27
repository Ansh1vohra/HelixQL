import Link from "next/link";
import { Logo } from "./Logo";

const FOOTER_LINKS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/download", label: "Download" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs#connecting-a-database", label: "Connecting a database" },
      { href: "/docs#query-safety", label: "Query safety" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact us" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/register", label: "Create account" },
      { href: "/login", label: "Log in" },
    ],
  },
];

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund-policy", label: "Cancellation & Refund Policy" },
];

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-slate-500">
              Natural-language business intelligence for your database — without your data ever leaving your
              firewall.
            </p>
          </div>

          {FOOTER_LINKS.map((section) => (
            <div key={section.heading}>
              <h3 className="text-sm font-semibold text-slate-900">{section.heading}</h3>
              <ul className="mt-3 space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-slate-500 hover:text-slate-900">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-slate-100 pt-6 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} HelixQL. All rights reserved.</span>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-slate-700">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
