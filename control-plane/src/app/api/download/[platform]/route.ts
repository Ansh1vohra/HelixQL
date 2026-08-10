import { NextRequest, NextResponse } from "next/server";
import { isPlatform, resolveAsset } from "@/lib/downloads";

/**
 * Redirects to the installer for the requested platform.
 *
 * A redirect rather than a proxy: streaming ~80MB through a serverless
 * function would burn bandwidth and execution time on every download for no
 * benefit, and would hit the platform's response limits. GitHub's CDN serves
 * the bytes; this route only resolves which file is current.
 *
 * Stable URLs (/api/download/windows) are what the site and any external
 * link point at, so publishing a new release changes what users get without
 * updating a single link.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;

  if (!isPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform." }, { status: 404 });
  }

  const asset = await resolveAsset(platform);
  if (!asset) {
    // The expected state before the first release is published, so it is
    // reported as a clear 404 rather than a server error.
    return NextResponse.json(
      { error: "No published build for this platform yet.", platform },
      { status: 404 },
    );
  }

  // 302, not 308: the target changes with every release, and a permanently
  // cached redirect would pin browsers to whichever version they first saw.
  return NextResponse.redirect(asset.url, 302);
}
