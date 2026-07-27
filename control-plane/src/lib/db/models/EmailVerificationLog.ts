import { Schema, model, models, Types, type InferSchemaType, type Model } from "mongoose";

const emailVerificationLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // SHA-256 of the raw verification token. The raw token only ever exists
    // in the outgoing email and the incoming verify request — never at rest.
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false, required: true },
  },
  { timestamps: true },
);

// TTL index: MongoDB automatically deletes expired, unused verification
// records so the collection doesn't grow unbounded with abandoned signups.
emailVerificationLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type EmailVerificationLogDocument = InferSchemaType<typeof emailVerificationLogSchema> & {
  userId: Types.ObjectId;
};

export const EmailVerificationLogModel: Model<EmailVerificationLogDocument> =
  models.EmailVerificationLog ||
  model<EmailVerificationLogDocument>("EmailVerificationLog", emailVerificationLogSchema);
