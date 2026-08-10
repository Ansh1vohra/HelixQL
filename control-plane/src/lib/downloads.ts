/**
 * Resolves desktop-client installers from object storage.
 *
 * Why not the repository, and why not GitHub Releases
 * ---------------------------------------------------
 * The installers are ~80MB per platform per release. Committing them would
 * add that to every clone forever, since git history is permanent, and
 * GitHub hard-blocks files over 100MB. GitHub Releases would be the natural
 * home, but release assets on a *private* repository require authentication
 * to download — a redirect would send an anonymous browser to a URL it
 * cannot fetch. So the binaries live in public object storage instead.
 *
 * Storage-agnostic by design: anything that serves files over HTTPS from a
 * common base URL works — Cloudflare R2, S3, Vercel Blob. R2 is the cheapest
 * of those for this job because it charges no egress, and egress is the
 * entire cost of shipping an 80MB file.
 *
 * Publishing a release means uploading the installers plus a manifest. No
 * deploy of this app is involved, and no code here names a version.
 */

/** Platforms the download route accepts. Keys match the manifest's `files`. */
export const PLATFORM_LABELS = {
  windows: "Windows",
  "mac-arm64": "macOS (Apple Silicon)",
  "mac-x64": "macOS (Intel)",
  "linux-appimage": "Linux (AppImage)",
  "linux-deb": "Linux (.deb)",
} as const;

export type Platform = keyof typeof PLATFORM_LABELS;

export function isPlatform(value: string): value is Platform {
  return Object.prototype.hasOwnProperty.call(PLATFORM_LABELS, value);
}

/**
 * Shape of `latest.json`, written by the release workflow next to the
 * installers it describes. Keeping sizes in the manifest means the download
 * page can show the weight of a file without a HEAD request per card.
 */
interface Manifest {
  version: string;
  files: Partial<Record<Platform, { name: string; size: number; sha256?: string }>>;
}

export interface ResolvedAsset {
  url: string;
  name: string;
  /** Bytes, so the UI can show the download weight before a user commits. */
  size: number;
  version: string;
  /** Present when the workflow recorded one; lets a user verify the binary. */
  sha256?: string;
}

/**
 * Public base URL of the bucket, without a trailing slash. Unset in local
 * development, which is why every function here degrades to "no builds
 * available" rather than throwing.
 */
function baseUrl(): string | null {
  const raw = process.env.DOWNLOADS_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * Fetches the release manifest.
 *
 * Cached for ten minutes so a burst of download-page views does not become a
 * burst of storage requests. The trade is that a freshly published release
 * takes up to ten minutes to appear, which is the right way round: stale by
 * minutes is fine, hammering the bucket on every page view is not.
 *
 * Returns null on any failure — unset base URL, network error, malformed
 * JSON, or the 404 that is simply the normal state before the first release.
 * A download page is not worth failing a page render over.
 */
export async function getManifest(): Promise<Manifest | null> {
  const base = baseUrl();
  if (!base) return null;

  try {
    const response = await fetch(`${base}/latest.json`, { next: { revalidate: 600 } });
    if (!response.ok) return null;

    const manifest = (await response.json()) as Manifest;
    if (!manifest?.files || typeof manifest.version !== "string") return null;
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Per-platform direct URL, e.g. DOWNLOAD_URL_WINDOWS.
 *
 * An escape hatch for hosts that do not serve files from a shared base URL
 * with predictable names — a Google Drive or Dropbox share link, say. It
 * takes precedence over the manifest, so a single platform can be pointed
 * somewhere else without disturbing the rest.
 *
 * Size is unknown for these, so the UI simply omits it rather than guessing.
 */
function directUrl(platform: Platform): string | undefined {
  const key = `DOWNLOAD_URL_${platform.toUpperCase().replace(/-/g, "_")}`;
  return process.env[key]?.trim() || undefined;
}

function directAsset(platform: Platform): ResolvedAsset | null {
  const url = directUrl(platform);
  if (!url) return null;

  return {
    url,
    name: PLATFORM_LABELS[platform],
    size: 0,
    version: process.env.DOWNLOADS_VERSION?.trim() || "",
  };
}

export async function resolveAsset(platform: Platform): Promise<ResolvedAsset | null> {
  const direct = directAsset(platform);
  if (direct) return direct;

  const base = baseUrl();
  const manifest = await getManifest();
  const entry = manifest?.files?.[platform];
  if (!base || !manifest || !entry) return null;

  return {
    // encodeURIComponent, not raw interpolation: the file name comes from a
    // manifest rather than from this codebase, so it is not assumed safe to
    // splice into a URL.
    url: `${base}/${encodeURIComponent(entry.name)}`,
    name: entry.name,
    size: entry.size,
    version: manifest.version,
    sha256: entry.sha256,
  };
}

export type Availability = Partial<Record<Platform, ResolvedAsset>>;

/**
 * Resolves every platform from one manifest fetch, so the download page can
 * render each card in its real state rather than showing enabled buttons
 * that turn out to 404.
 */
export async function getAvailability(): Promise<Availability> {
  const base = baseUrl();
  const manifest = await getManifest();

  const available: Availability = {};
  for (const platform of Object.keys(PLATFORM_LABELS) as Platform[]) {
    // Direct URLs win, and work with no manifest at all — which is what
    // makes a share link usable as a stopgap before storage is set up.
    const direct = directAsset(platform);
    if (direct) {
      available[platform] = direct;
      continue;
    }

    if (!base || !manifest) continue;

    const entry = manifest.files[platform];
    if (entry) {
      available[platform] = {
        url: `${base}/${encodeURIComponent(entry.name)}`,
        name: entry.name,
        size: entry.size,
        version: manifest.version,
        sha256: entry.sha256,
      };
    }
  }
  return available;
}

export function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}
