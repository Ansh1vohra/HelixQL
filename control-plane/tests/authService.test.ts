import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupTestDb, teardownTestDb, clearTestDb } from "./dbTestUtils";
import { registerUser, verifyEmailToken, loginUser, getAccountOverview } from "@/lib/services/authService";
import { ServiceError } from "@/lib/services/errors";

async function registerAndCaptureToken(email: string, name = "Ada Lovelace", password = "Sup3rSecret1"): Promise<string> {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await registerUser({ name, email, password });
  const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
  logSpy.mockRestore();

  const match = output.match(/token=([\w-]+)/);
  if (!match) throw new Error("Verification token not found in mailer output");
  return match[1]!;
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

describe("registerUser", () => {
  it("creates a pending user and emails a verification link", async () => {
    const token = await registerAndCaptureToken("ada@example.com");
    expect(token).toBeTruthy();
  });

  it("rejects a second registration with the same email", async () => {
    await registerAndCaptureToken("ada@example.com");
    await expect(registerUser({ name: "Ada", email: "ada@example.com", password: "Sup3rSecret1" })).rejects.toThrow(
      ServiceError,
    );
  });
});

describe("verifyEmailToken", () => {
  it("activates the user, mints an api_token, and attaches the free plan", async () => {
    const token = await registerAndCaptureToken("ada@example.com");
    const { userId } = await verifyEmailToken(token);

    const overview = await getAccountOverview(userId);
    expect(overview.status).toBe("active");
    expect(overview.plan?.name).toBe("Free Tier");
    expect(overview.usage?.queriesUsedThisPeriod).toBe(0);
  });

  it("rejects reuse of an already-used token", async () => {
    const token = await registerAndCaptureToken("ada@example.com");
    await verifyEmailToken(token);
    await expect(verifyEmailToken(token)).rejects.toThrow(ServiceError);
  });

  it("rejects an unknown token", async () => {
    await expect(verifyEmailToken("not-a-real-token")).rejects.toThrow(ServiceError);
  });
});

describe("loginUser", () => {
  it("logs in an activated user and returns a usable api_token", async () => {
    const token = await registerAndCaptureToken("ada@example.com", "Ada Lovelace", "Sup3rSecret1");
    await verifyEmailToken(token);

    const result = await loginUser({ email: "ada@example.com", password: "Sup3rSecret1" });
    expect(result.apiToken).toMatch(/^hql_live_/);
    expect(result.email).toBe("ada@example.com");
  });

  it("rejects login before email verification", async () => {
    await registerAndCaptureToken("ada@example.com", "Ada Lovelace", "Sup3rSecret1");
    await expect(loginUser({ email: "ada@example.com", password: "Sup3rSecret1" })).rejects.toMatchObject({
      code: "ACCOUNT_NOT_VERIFIED",
    });
  });

  it("rejects an incorrect password", async () => {
    const token = await registerAndCaptureToken("ada@example.com", "Ada Lovelace", "Sup3rSecret1");
    await verifyEmailToken(token);
    await expect(loginUser({ email: "ada@example.com", password: "WrongPassword1" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("rejects an unknown email without revealing whether the account exists", async () => {
    await expect(loginUser({ email: "nobody@example.com", password: "Sup3rSecret1" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });
});
