import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupTestDb, teardownTestDb, clearTestDb } from "./dbTestUtils";
import { registerUser, verifyEmailToken } from "@/lib/services/authService";
import { verifyApiToken, incrementUsage } from "@/lib/services/usageService";
import { ServiceError } from "@/lib/services/errors";
import { UserModel } from "@/lib/db/models/User";
import { UserSubscriptionModel } from "@/lib/db/models/UserSubscription";
import { decryptApiToken } from "@/lib/auth/tokens";

async function createActivatedUser(email: string): Promise<{ userId: string; apiToken: string }> {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await registerUser({ name: "Ada Lovelace", email, password: "Sup3rSecret1" });
  const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
  logSpy.mockRestore();
  const token = output.match(/token=([\w-]+)/)?.[1];
  if (!token) throw new Error("Verification token not found");

  const { userId } = await verifyEmailToken(token);
  const user = await UserModel.findById(userId).select("+apiTokenEncrypted");
  const apiToken = decryptApiToken(user!.apiTokenEncrypted!);
  return { userId, apiToken };
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

describe("verifyApiToken", () => {
  it("resolves the correct userId for a valid, active token", async () => {
    const { userId, apiToken } = await createActivatedUser("ada@example.com");
    const result = await verifyApiToken(apiToken);
    expect(result.userId).toBe(userId);
  });

  it("rejects an unknown token", async () => {
    await expect(verifyApiToken("hql_live_not-a-real-token")).rejects.toThrow(ServiceError);
  });

  it("rejects a token belonging to a disabled account", async () => {
    const { userId, apiToken } = await createActivatedUser("ada@example.com");
    await UserModel.findByIdAndUpdate(userId, { status: "disabled" });
    await expect(verifyApiToken(apiToken)).rejects.toThrow(ServiceError);
  });
});

describe("incrementUsage", () => {
  it("increments usage and reports remaining allowance", async () => {
    const { userId } = await createActivatedUser("ada@example.com");
    const result = await incrementUsage(userId);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(result.monthlyQueryLimit - 1);
  });

  it("blocks further requests once the monthly limit is reached", async () => {
    const { userId } = await createActivatedUser("ada@example.com");
    const subscription = await UserSubscriptionModel.findOne({ userId });
    const limit = 100; // matches FREE_PLAN_MONTHLY_QUERY_LIMIT

    subscription!.queriesUsedThisPeriod = limit - 1;
    await subscription!.save();

    const last = await incrementUsage(userId);
    expect(last.remaining).toBe(0);

    await expect(incrementUsage(userId)).rejects.toMatchObject({ code: "QUERY_LIMIT_EXCEEDED" });
  });

  it("rolls the billing period over and resets usage once it has elapsed", async () => {
    const { userId } = await createActivatedUser("ada@example.com");
    const subscription = await UserSubscriptionModel.findOne({ userId });

    subscription!.queriesUsedThisPeriod = 42;
    subscription!.currentPeriodEnd = new Date(Date.now() - 1000);
    await subscription!.save();

    const result = await incrementUsage(userId);
    expect(result.remaining).toBe(result.monthlyQueryLimit - 1);

    const rolled = await UserSubscriptionModel.findOne({ userId });
    expect(rolled!.queriesUsedThisPeriod).toBe(1);
    expect(rolled!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
  });
});
