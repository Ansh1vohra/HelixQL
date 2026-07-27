import { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation/schemas";
import { loginUser } from "@/lib/services/authService";
import { ServiceError } from "@/lib/services/errors";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth/session";

const LOGIN_LIMIT_PER_15_MIN = 10;

/**
 * Used by both the web dashboard (relies on the session cookie set here) and
 * the Electron desktop client (relies on the apiToken in the JSON body) per
 * Step 4.1 of the implementation doc — one credential check, two consumers.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(`login:${ip}`, LOGIN_LIMIT_PER_15_MIN, 15 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const result = await loginUser(parsed.data);
    const sessionToken = await createSessionToken(result.userId);

    const response = NextResponse.json({
      user: { name: result.name, email: result.email },
      apiToken: result.apiToken,
    });
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions);
    return response;
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "INVALID_CREDENTIALS" ? 401 : 403;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}
