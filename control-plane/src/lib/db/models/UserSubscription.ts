import { Schema, model, models, Types, type InferSchemaType, type Model } from "mongoose";

const userSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    planId: { type: Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    queriesUsedThisPeriod: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

export type UserSubscriptionDocument = InferSchemaType<typeof userSubscriptionSchema> & {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
};

export const UserSubscriptionModel: Model<UserSubscriptionDocument> =
  models.UserSubscription || model<UserSubscriptionDocument>("UserSubscription", userSubscriptionSchema);
