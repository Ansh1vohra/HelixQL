import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const subscriptionPlanSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true },
    monthlyQueryLimit: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

export type SubscriptionPlanDocument = InferSchemaType<typeof subscriptionPlanSchema>;

export const SubscriptionPlanModel: Model<SubscriptionPlanDocument> =
  models.SubscriptionPlan || model<SubscriptionPlanDocument>("SubscriptionPlan", subscriptionPlanSchema);

export const FREE_PLAN_KEY = "free";
export const FREE_PLAN_MONTHLY_QUERY_LIMIT = 100;

/**
 * Idempotently ensures the default free-tier plan document exists. Called
 * on-demand (e.g. when a new user is activated) rather than via a separate
 * seed script, so a fresh serverless deployment never depends on a manual
 * migration step having been run first.
 */
export async function ensureFreePlan(): Promise<SubscriptionPlanDocument & { _id: unknown }> {
  const plan = await SubscriptionPlanModel.findOneAndUpdate(
    { key: FREE_PLAN_KEY },
    {
      $setOnInsert: {
        key: FREE_PLAN_KEY,
        name: "Free Tier",
        monthlyQueryLimit: FREE_PLAN_MONTHLY_QUERY_LIMIT,
      },
    },
    { upsert: true, new: true },
  ).lean();
  return plan as SubscriptionPlanDocument & { _id: unknown };
}
