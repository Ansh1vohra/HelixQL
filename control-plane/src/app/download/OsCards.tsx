"use client";

import { useEffect, useState } from "react";
import { formatSize, type Availability, type Platform } from "@/lib/downloads";

type Os = "mac" | "windows" | "linux";

/**
 * Each card offers one primary download plus, where a platform ships more
 * than one artifact, a secondary link. macOS is split by CPU rather than
 * shipped as a universal binary — a universal build doubles the download for
 * every user to save one click for some of them.
 */
const PLATFORMS: {
  id: Os;
  name: string;
  requirement: string;
  primary: { platform: Platform; label: string };
  secondary?: { platform: Platform; label: string };
}[] = [
  {
    id: "mac",
    name: "macOS",
    requirement: "macOS 12 Monterey or later, Apple Silicon & Intel",
    primary: { platform: "mac-arm64", label: "Download for Apple Silicon" },
    secondary: { platform: "mac-x64", label: "Intel Mac" },
  },
  {
    id: "windows",
    name: "Windows",
    requirement: "Windows 10 or later, 64-bit",
    primary: { platform: "windows", label: "Download for Windows" },
  },
  {
    id: "linux",
    name: "Linux",
    requirement: "Ubuntu 20.04+, Debian, Fedora (AppImage & .deb)",
    primary: { platform: "linux-appimage", label: "Download AppImage" },
    secondary: { platform: "linux-deb", label: ".deb package" },
  },
];

function detectOs(): Os | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return null;
}

export function OsCards({ availability }: { availability: Availability }) {
  const [detected, setDetected] = useState<Os | null>(null);

  // Detection runs after mount because the server has no user agent to read;
  // rendering it during SSR would mismatch and get discarded anyway.
  useEffect(() => {
    setDetected(detectOs());
  }, []);

  return (
    <div className="grid gap-6 sm:grid-cols-3">
      {PLATFORMS.map((platform) => {
        const primary = availability[platform.primary.platform];
        const secondary = platform.secondary ? availability[platform.secondary.platform] : undefined;

        return (
          <div
            key={platform.id}
            className={`relative rounded-2xl border p-6 text-center ${
              detected === platform.id ? "border-brand-500 shadow-md shadow-brand-500/10" : "border-slate-200"
            }`}
          >
            {detected === platform.id && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                Recommended for you
              </span>
            )}
            <PlatformIcon id={platform.id} className="mx-auto h-10 w-10 text-slate-700" />
            <h3 className="mt-4 text-base font-semibold text-slate-900">{platform.name}</h3>
            <p className="mt-1 text-xs text-slate-500">{platform.requirement}</p>

            {primary ? (
              <>
                <a
                  href={`/api/download/${platform.primary.platform}`}
                  className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500"
                >
                  {platform.primary.label}
                </a>
                <p className="mt-2 text-xs text-slate-400">
                  {primary.version} · {formatSize(primary.size)}
                </p>
                {secondary && (
                  <a
                    href={`/api/download/${platform.secondary!.platform}`}
                    className="mt-1 inline-block text-xs font-medium text-brand-600 underline-offset-2 hover:underline"
                  >
                    {platform.secondary!.label} ({formatSize(secondary.size)})
                  </a>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled
                className="mt-5 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-400"
              >
                Coming soon
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlatformIcon({ id, className }: { id: Os; className?: string }) {
  if (id === "mac") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M16.4 12.3c0-2.5 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9-.7 0-1.9-.9-3.1-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.4-.9-2.3-3.5zM14 4.7c.6-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.1 1.9-1 2.9 1 .1 2.1-.5 2.8-1.3z" />
      </svg>
    );
  }
  if (id === "windows") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M3 5.5L10.3 4.5V11.4H3V5.5ZM11.2 4.4L21 3V11.3H11.2V4.4ZM3 12.4H10.3V19.4L3 18.4V12.4ZM11.2 12.4H21V20.9L11.2 19.6V12.4Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C9 2 8 5 8 7c0 1.3.4 2.2.4 3.3 0 .6-.4 1-1 1.7-1 1.1-2.4 2.7-2.4 4.6 0 1.7 1.3 2.9 3 2.9.6 0 1-.2 1.5-.5.4.6 1.3 1 2.5 1s2.1-.4 2.5-1c.5.3.9.5 1.5.5 1.7 0 3-1.2 3-2.9 0-1.9-1.4-3.5-2.4-4.6-.6-.7-1-1.1-1-1.7 0-1.1.4-2 .4-3.3 0-2-1-5-4-5z" />
    </svg>
  );
}
