import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupTestDb, teardownTestDb, clearTestDb } from "./dbTestUtils";
import { checkRateLimit } from "@/lib/rateLimit";

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit and blocks the next one", async () => {
    const key = "test:1.2.3.4";
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await checkRateLimit(key, 3, 60));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });

  it("tracks separate keys independently", async () => {
    const a = await checkRateLimit("test:a", 1, 60);
    const b = await checkRateLimit("test:b", 1, 60);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});
