import Link from "next/link";
import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";
import { OsCards } from "./OsCards";

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Download HelixQL Desktop</h1>
          <p className="mt-4 text-lg text-slate-500">
            The desktop client is what actually talks to your database — your credentials and every row of real
            data stay on this machine, inside your network.
          </p>
        </div>

        <div className="mt-14">
          <OsCards />
        </div>

        <div className="mx-auto mt-14 max-w-xl rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
          <p className="text-sm text-slate-600">
            The desktop client is currently in active development and isn&apos;t released yet. Create your account
            now to reserve your free-tier access — we&apos;ll let you know the moment it&apos;s ready to install.
          </p>
          <Link
            href="/register"
            className="mt-4 inline-flex rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500"
          >
            Create your account
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
