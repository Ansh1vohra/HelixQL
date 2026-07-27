import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";

/**
 * Fixed-window rate limiter backed by MongoDB. Every process/instance reads
 * and writes the same collection, so this is correct across Vercel's
 * multi-instance serverless deployment (unlike an in-memory counter, which
 * would only apply per-instance). A TTL index reclaims expired windows
 * automatically.
 *
 * If usage grows enough that Mongo round-trips become a bottleneck for
 * login/register traffic, swap this for Upstash Redis behind the same
 * `checkRateLimit` signature — nothing above this module needs to change.
 */
const rateLimitEventSchema = new Schema({
  key: { type: String, required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, required: true, default: 0 },
});

rateLimitEventSchema.index({ key: 1, windowStart: 1 }, { unique: true });
rateLimitEventSchema.index({ windowStart: 1 }, { expireAfterSeconds: 60 * 60 });

type RateLimitEventDocument = InferSchemaType<typeof rateLimitEventSchema>;

const RateLimitEventModel: Model<RateLimitEventDocument> =
  models.RateLimitEvent || model<RateLimitEventDocument>("RateLimitEvent", rateLimitEventSchema);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Atomically increments the counter for `key` in the current fixed window
 * and reports whether the caller is still within `limit`. Uses an atomic
 * upsert ($inc) so concurrent requests can't race past the limit.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  await connectToDatabase();
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * (windowSeconds * 1000));

  const doc = await RateLimitEventModel.findOneAndUpdate(
    { key, windowStart },
    { $inc: { count: 1 } },
    { upsert: true, new: true },
  ).lean();

  const count = doc?.count ?? 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
