import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalRequest } from "@/lib/auth/internalAuth";
import { internalTokenVerifySchema } from "@/lib/validation/schemas";
import { verifyApiToken } from "@/lib/services/usageService";
import { ServiceError } from "@/lib/services/errors";

/**
 * Called by the FastAPI gateway on every incoming translation request
 * (FR-3.1). Kept in the control plane so token-validation logic has exactly
 * one implementation — see the Phase 1 architecture note on why the gateway
 * calls this instead of querying MongoDB directly.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = internalTokenVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const result = await verifyApiToken(parsed.data.apiToken);
    return NextResponse.json({ valid: true, userId: result.userId });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ valid: false }, { status: 403 });
    }
    throw err;
  }
}
