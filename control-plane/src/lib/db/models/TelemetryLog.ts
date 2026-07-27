import { Schema, model, models, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * Aggregated usage/audit events only — action name, timestamp, small
 * metadata. Never store NL prompts, generated SQL, or row data here: those
 * never leave the gateway/desktop tiers by design, and this log must not
 * become a backdoor that re-introduces them into the control plane.
 */
const telemetryLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

telemetryLogSchema.index({ userId: 1, createdAt: -1 });

export type TelemetryLogDocument = InferSchemaType<typeof telemetryLogSchema> & { userId: Types.ObjectId };

export const TelemetryLogModel: Model<TelemetryLogDocument> =
  models.TelemetryLog || model<TelemetryLogDocument>("TelemetryLog", telemetryLogSchema);
