/**
 * Resolves desktop-client installers from the project's GitHub Releases.
 *
 * The binaries are ~80MB each and there is one per platform per release.
 * They deliberately do not live in this repository: git history is
 * permanent, so committing them would add ~80MB per release to every clone
 * forever, and GitHub hard-blocks files over 100MB. Releases are built for
 * exactly this, cost nothing, and carry better download reputation with
 * Chrome's Safe Browsing than a freshly registered domain.
 *
 * Asset names are produced by electron-builder (see electron-builder.yml in
 * client-desktop) and carry the version, so they cannot be hard-coded here.
 * The latest release is queried instead and matched by pattern, which means
 * publishing a new release changes the download with no deploy here.
 */

/** Platforms the download route accepts, mapped to the asset that serves them. */
export const PLATFORM_ASSETS = {
  windows: { label: "Windows", match: /-setup\.exe$/i },
  "mac-arm64": { label: "macOS (Apple Silicon)", match: /-arm64\.dmg$/i },
  "mac-x64": { label: "macOS (Intel)", match: /-x64\.dmg$/i },
  "linux-appimage": { label: "Linux (AppImage)", match: /\.AppImage$/i },
  "linux-deb": { label: "Linux (.deb)", match: /\.deb$/i },
} as const;

export type Platform = keyof typeof PLATFORM_ASSETS;

export function isPlatform(value: string): value is Platform {
  return Object.prototype.hasOwnProperty.call(PLATFORM_ASSETS, value);
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface ResolvedAsset {
  url: string;
  name: string;
  /** Bytes, so the UI can show the download weight before a user commits. */
  size: number;
  version: string;
}

const REPO = process.env.GITHUB_RELEASES_REPO || "Ansh1vohra/HelixQL";

/**
 * Fetches the newest published release.
 *
 * Cached for ten minutes: the unauthenticated GitHub API allows 60 requests
 * per hour per IP, and on serverless that IP is shared with every other
 * tenant on the instance. Without caching a burst of download-page views
 * could exhaust it and make the buttons vanish.
 *
 * Returns null rather than throwing on any failure — including the 404 that
 * GitHub returns when a repository has no releases yet, which is the normal
 * state before the first build is published. A download page is not worth
 * failing a page render over.
 */
export async function getLatestRelease(): Promise<Release | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Optional: raises the rate limit from 60/hr to 5000/hr. Not required.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers,
      next: { revalidate: 600 },
    });
    if (!response.ok) return null;
    return (await response.json()) as Release;
  } catch {
    return null;
  }
}

export async function resolveAsset(platform: Platform): Promise<ResolvedAsset | null> {
  const release = await getLatestRelease();
  if (!release?.assets?.length) return null;

  const asset = release.assets.find((candidate) => PLATFORM_ASSETS[platform].match.test(candidate.name));
  if (!asset) return null;

  return {
    url: asset.browser_download_url,
    name: asset.name,
    size: asset.size,
    version: release.tag_name,
  };
}

export type Availability = Partial<Record<Platform, ResolvedAsset>>;

/**
 * Resolves every platform in one release lookup, so the download page can
 * render each card in its real state rather than showing enabled buttons
 * that turn out to 404.
 */
export async function getAvailability(): Promise<Availability> {
  const release = await getLatestRelease();
  if (!release?.assets?.length) return {};

  const available: Availability = {};
  for (const platform of Object.keys(PLATFORM_ASSETS) as Platform[]) {
    const asset = release.assets.find((candidate) => PLATFORM_ASSETS[platform].match.test(candidate.name));
    if (asset) {
      available[platform] = {
        url: asset.browser_download_url,
        name: asset.name,
        size: asset.size,
        version: release.tag_name,
      };
    }
  }
  return available;
}

export function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}
