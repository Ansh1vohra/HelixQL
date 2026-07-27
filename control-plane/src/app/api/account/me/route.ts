import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { getAccountOverview } from "@/lib/services/authService";
import { ServiceError } from "@/lib/services/errors";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const overview = await getAccountOverview(session.userId);
    return NextResponse.json(overview);
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
