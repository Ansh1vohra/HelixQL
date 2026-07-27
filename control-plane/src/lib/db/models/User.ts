import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const USER_STATUS = ["pending", "active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUS)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 320,
    },
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, enum: USER_STATUS, default: "pending", required: true },

    // Deterministic HMAC of the raw api_token, used as an O(1) validation
    // lookup key. Never sufficient on its own to reconstruct the token.
    apiTokenLookupHash: { type: String, select: false },
    // AES-256-GCM ciphertext of the raw api_token. Decryptable only by this
    // server (holds the key) so the plaintext can be handed back to the
    // legitimate user on login, per FR-2.2 / Step 4.1.
    apiTokenEncrypted: { type: String, select: false },
    apiTokenCreatedAt: { type: Date },
  },
  { timestamps: true },
);

// Sparse: most users have no token until email verification completes.
userSchema.index({ apiTokenLookupHash: 1 }, { unique: true, sparse: true });

export type UserDocument = InferSchemaType<typeof userSchema>;

export const UserModel: Model<UserDocument> = models.User || model<UserDocument>("User", userSchema);
