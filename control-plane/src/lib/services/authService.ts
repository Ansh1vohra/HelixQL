import { connectToDatabase } from "@/lib/db/connect";
import { UserModel, type UserDocument } from "@/lib/db/models/User";
import { EmailVerificationLogModel } from "@/lib/db/models/EmailVerificationLog";
import { UserSubscriptionModel } from "@/lib/db/models/UserSubscription";
import { ensureFreePlan } from "@/lib/db/models/SubscriptionPlan";
import { TelemetryLogModel } from "@/lib/db/models/TelemetryLog";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  generateVerificationToken,
  hashVerificationToken,
  generateApiToken,
  computeApiTokenLookupHash,
  encryptApiToken,
  decryptApiToken,
} from "@/lib/auth/tokens";
import { getMailer } from "@/lib/mail/mailer";
import { verifyEmailTemplate } from "@/lib/mail/templates/verifyEmail";
import { getEnv } from "@/lib/env";
import { ServiceError } from "@/lib/services/errors";
import type { RegisterInput, LoginInput } from "@/lib/validation/schemas";
import type { Types } from "mongoose";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function registerUser(input: RegisterInput): Promise<{ userId: string }> {
  await connectToDatabase();

  const existing = await UserModel.findOne({ email: input.email }).lean();
  if (existing) {
    throw new ServiceError("EMAIL_TAKEN", "An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    name: input.name,
    email: input.email,
    passwordHash,
    status: "pending",
  });

  const { raw, tokenHash } = generateVerificationToken();
  await EmailVerificationLogModel.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    used: false,
  });

  const { APP_BASE_URL } = getEnv();
  const verifyUrl = `${APP_BASE_URL}/api/auth/verify?token=${raw}`;
  const email = verifyEmailTemplate({ name: user.name, verifyUrl });
  await getMailer().send({ to: user.email, ...email });

  return { userId: user._id.toString() };
}

export interface VerifyEmailResult {
  userId: string;
}

export async function verifyEmailToken(rawToken: string): Promise<VerifyEmailResult> {
  await connectToDatabase();

  const tokenHash = hashVerificationToken(rawToken);
  const log = await EmailVerificationLogModel.findOne({ tokenHash });

  if (!log || log.used || log.expiresAt.getTime() < Date.now()) {
    throw new ServiceError("INVALID_OR_EXPIRED_TOKEN", "This verification link is invalid or has expired.");
  }

  log.used = true;
  await log.save();

  const rawApiToken = generateApiToken();
  const user = await UserModel.findByIdAndUpdate(
    log.userId,
    {
      status: "active",
      apiTokenLookupHash: computeApiTokenLookupHash(rawApiToken),
      apiTokenEncrypted: encryptApiToken(rawApiToken),
      apiTokenCreatedAt: new Date(),
    },
    { new: true },
  );

  if (!user) {
    throw new ServiceError("USER_NOT_FOUND", "The account for this verification link no longer exists.");
  }

  const plan = await ensureFreePlan();
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  await UserSubscriptionModel.findOneAndUpdate(
    { userId: user._id },
    {
      $setOnInsert: {
        userId: user._id,
        planId: plan._id,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        queriesUsedThisPeriod: 0,
      },
    },
    { upsert: true },
  );

  return { userId: user._id.toString() };
}

export interface LoginResult {
  userId: string;
  name: string;
  email: string;
  apiToken: string;
}

export async function loginUser(input: LoginInput): Promise<LoginResult> {
  await connectToDatabase();

  const user = await UserModel.findOne({ email: input.email }).select(
    "+passwordHash +apiTokenEncrypted +apiTokenLookupHash",
  );
  if (!user) {
    throw new ServiceError("INVALID_CREDENTIALS", "Incorrect email or password.");
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk) {
    throw new ServiceError("INVALID_CREDENTIALS", "Incorrect email or password.");
  }

  if (user.status === "disabled") {
    throw new ServiceError("ACCOUNT_DISABLED", "This account has been disabled.");
  }
  if (user.status === "pending") {
    throw new ServiceError("ACCOUNT_NOT_VERIFIED", "Please verify your email before logging in.");
  }
  if (!user.apiTokenEncrypted) {
    // Defensive: an active account should always have a token minted at
    // verification time. Re-mint rather than leaving the user stuck.
    const rawApiToken = generateApiToken();
    user.apiTokenLookupHash = computeApiTokenLookupHash(rawApiToken);
    user.apiTokenEncrypted = encryptApiToken(rawApiToken);
    user.apiTokenCreatedAt = new Date();
    await user.save();
  }

  await TelemetryLogModel.create({ userId: user._id, action: "auth.login" });

  return {
    userId: (user._id as Types.ObjectId).toString(),
    name: user.name,
    email: user.email,
    apiToken: decryptApiToken(user.apiTokenEncrypted),
  };
}

export interface AccountOverview {
  name: string;
  email: string;
  status: UserDocument["status"];
  plan: { name: string; monthlyQueryLimit: number } | null;
  usage: { queriesUsedThisPeriod: number; currentPeriodEnd: Date } | null;
}

export async function getAccountOverview(userId: string): Promise<AccountOverview> {
  await connectToDatabase();

  const user = await UserModel.findById(userId).lean();
  if (!user) {
    throw new ServiceError("USER_NOT_FOUND", "Account not found.");
  }

  const subscription = await UserSubscriptionModel.findOne({ userId: user._id }).populate("planId").lean();

  const plan =
    subscription?.planId && typeof subscription.planId === "object" && "monthlyQueryLimit" in subscription.planId
      ? {
          name: (subscription.planId as unknown as { name: string }).name,
          monthlyQueryLimit: (subscription.planId as unknown as { monthlyQueryLimit: number }).monthlyQueryLimit,
        }
      : null;

  return {
    name: user.name,
    email: user.email,
    status: user.status,
    plan,
    usage: subscription
      ? { queriesUsedThisPeriod: subscription.queriesUsedThisPeriod, currentPeriodEnd: subscription.currentPeriodEnd }
      : null,
  };
}
