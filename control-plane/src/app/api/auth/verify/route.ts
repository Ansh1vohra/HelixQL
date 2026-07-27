import { NextRequest, NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/services/authService";
import { ServiceError } from "@/lib/services/errors";
import { getEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { APP_BASE_URL } = getEnv();
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(`${APP_BASE_URL}/verify-result?status=error`);
  }

  try {
    await verifyEmailToken(token);
    return NextResponse.redirect(`${APP_BASE_URL}/verify-result?status=success`);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "INVALID_OR_EXPIRED_TOKEN") {
      return NextResponse.redirect(`${APP_BASE_URL}/verify-result?status=expired`);
    }
    return NextResponse.redirect(`${APP_BASE_URL}/verify-result?status=error`);
  }
}
