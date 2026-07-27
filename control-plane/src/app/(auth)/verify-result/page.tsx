import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";

const COPY: Record<string, { title: string; body: string }> = {
  success: {
    title: "Email verified",
    body: "Your account is now active. You can log in from the web dashboard or your HelixQL desktop client.",
  },
  expired: {
    title: "Link expired",
    body: "This verification link has expired or was already used. Please register again to receive a new one.",
  },
  error: {
    title: "Verification failed",
    body: "We couldn't verify this link. Please check the URL or register again.",
  },
};

export default function VerifyResultPage({ searchParams }: { searchParams: { status?: string } }) {
  const copy = COPY[searchParams.status ?? "error"] ?? COPY.error!;

  return (
    <AuthCard title={copy.title}>
      <p className="text-sm text-slate-600">{copy.body}</p>
      <Link
        href="/login"
        className="mt-6 block w-full rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand-500"
      >
        Go to login
      </Link>
    </AuthCard>
  );
}
