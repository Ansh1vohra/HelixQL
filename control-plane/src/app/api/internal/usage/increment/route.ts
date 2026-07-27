import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalRequest } from "@/lib/auth/internalAuth";
import { internalUsageIncrementSchema } from "@/lib/validation/schemas";
import { incrementUsage } from "@/lib/services/usageService";
import { TelemetryLogModel } from "@/lib/db/models/TelemetryLog";
import { ServiceError } from "@/lib/services/errors";

/**
 * Called by the FastAPI gateway before invoking the LLM pipeline (FR-3.2).
 * Only usage counters and action names are recorded here — never the NL
 * prompt or generated SQL, per the data-minimization note on TelemetryLog.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = internalUsageIncrementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const result = await incrementUsage(parsed.data.userId);
    await TelemetryLogModel.create({ userId: parsed.data.userId, action: "query.translate" });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "QUERY_LIMIT_EXCEEDED") {
      return NextResponse.json({ allowed: false, error: err.message }, { status: 429 });
    }
    if (err instanceof ServiceError) {
      return NextResponse.json({ allowed: false, error: err.message }, { status: 404 });
    }
    throw err;
  }
}
