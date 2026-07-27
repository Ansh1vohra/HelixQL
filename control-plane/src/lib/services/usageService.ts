import { connectToDatabase } from "@/lib/db/connect";
import { UserModel } from "@/lib/db/models/User";
import { UserSubscriptionModel } from "@/lib/db/models/UserSubscription";
import { SubscriptionPlanModel } from "@/lib/db/models/SubscriptionPlan";
import { computeApiTokenLookupHash } from "@/lib/auth/tokens";
import { ServiceError } from "@/lib/services/errors";

export interface VerifiedToken {
  userId: string;
}

/**
 * Called by the FastAPI gateway (via /api/internal/tokens/verify) on every
 * translation request. This — not raw Mongo access from the gateway — is
 * the boundary the gateway crosses to authenticate a request. See the
 * architecture review: keeping this in one service avoids a second
 * implementation of token validation logic in Python.
 */
export async function verifyApiToken(rawToken: string): Promise<VerifiedToken> {
  await connectToDatabase();

  const lookupHash = computeApiTokenLookupHash(rawToken);
  const user = await UserModel.findOne({ apiTokenLookupHash: lookupHash }).lean();

  if (!user || user.status !== "active") {
    throw new ServiceError("INVALID_CREDENTIALS", "Invalid or inactive api_token.");
  }

  return { userId: user._id.toString() };
}

export interface UsageIncrementResult {
  allowed: true;
  remaining: number;
  monthlyQueryLimit: number;
}

/**
 * Atomically rolls the billing period over if it has elapsed, then
 * atomically increments usage only if the user is still under their plan
 * limit. Both steps use a conditional findOneAndUpdate so concurrent
 * requests from the same user can never race past the monthly cap
 * (FR-3.2).
 */
export async function incrementUsage(userId: string): Promise<UsageIncrementResult> {
  await connectToDatabase();

  let subscription = await UserSubscriptionModel.findOne({ userId });
  if (!subscription) {
    throw new ServiceError("SUBSCRIPTION_NOT_FOUND", "No active subscription found for this user.");
  }

  const now = new Date();
  if (subscription.currentPeriodEnd.getTime() <= now.getTime()) {
    const newPeriodEnd = new Date(now);
    newPeriodEnd.setUTCMonth(newPeriodEnd.getUTCMonth() + 1);

    const rolledOver = await UserSubscriptionModel.findOneAndUpdate(
      { userId, currentPeriodEnd: subscription.currentPeriodEnd },
      { $set: { currentPeriodStart: now, currentPeriodEnd: newPeriodEnd, queriesUsedThisPeriod: 0 } },
      { new: true },
    );
    // If another concurrent request already rolled it over, re-read rather
    // than trust our stale local copy.
    subscription = rolledOver ?? (await UserSubscriptionModel.findOne({ userId }))!;
  }

  const plan = await SubscriptionPlanModel.findById(subscription.planId).lean();
  if (!plan) {
    throw new ServiceError("SUBSCRIPTION_NOT_FOUND", "The plan attached to this subscription no longer exists.");
  }

  const updated = await UserSubscriptionModel.findOneAndUpdate(
    { userId, queriesUsedThisPeriod: { $lt: plan.monthlyQueryLimit } },
    { $inc: { queriesUsedThisPeriod: 1 } },
    { new: true },
  );

  if (!updated) {
    throw new ServiceError("QUERY_LIMIT_EXCEEDED", "Monthly query allowance exceeded for this plan.");
  }

  return {
    allowed: true,
    remaining: plan.monthlyQueryLimit - updated.queriesUsedThisPeriod,
    monthlyQueryLimit: plan.monthlyQueryLimit,
  };
}
