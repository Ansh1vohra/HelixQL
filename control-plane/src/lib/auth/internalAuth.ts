import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";

const INTERNAL_SECRET_HEADER = "x-internal-secret";

/**
 * Guards the /api/internal/* routes the FastAPI gateway calls. This is a
 * static shared secret rather than a user session: the gateway is a trusted
 * service, not an end user. For production, pair this with network-level
 * restrictions (e.g. only accept these routes from the gateway's egress IP
 * range / private network) in front of this application.
 */
export function isAuthorizedInternalRequest(request: NextRequest): boolean {
  const provided = request.headers.get(INTERNAL_SECRET_HEADER);
  if (!provided) return false;

  const expected = getEnv().GATEWAY_INTERNAL_SECRET;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
