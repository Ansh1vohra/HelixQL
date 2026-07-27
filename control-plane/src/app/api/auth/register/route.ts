import { NextRequest, NextResponse } from "next/server";
import { registerSchema } from "@/lib/validation/schemas";
import { registerUser } from "@/lib/services/authService";
import { ServiceError } from "@/lib/services/errors";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";

const REGISTER_LIMIT_PER_HOUR = 10;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(`register:${ip}`, REGISTER_LIMIT_PER_HOUR, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many registration attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    await registerUser(parsed.data);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "EMAIL_TAKEN") {
      // Same response shape/timing regardless of whether the email exists,
      // to avoid leaking account existence via this endpoint.
      return NextResponse.json(
        { message: "If this email isn't already registered, a verification link has been sent." },
        { status: 202 },
      );
    }
    throw err;
  }

  return NextResponse.json(
    { message: "If this email isn't already registered, a verification link has been sent." },
    { status: 202 },
  );
}
