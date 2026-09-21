import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTurn, PipelineResult } from "../src/shared/types";

vi.mock("../src/main/db/connection", () => ({
  requireActive: vi.fn(() => ({ driver: {}, config: { dialect: "mysql" } })),
  getBlueprint: vi.fn(() => ({ dialect: "mysql", database: "shop", tables: [], capturedAt: "" })),
}));

vi.mock("../src/main/gateway", () => ({ clarify: vi.fn() }));

vi.mock("../src/main/pipeline", () => ({
  selectSchema: vi.fn(async () => ({
    schemaDdl: ["CREATE TABLE orders (id INT, total DECIMAL);"],
    tables: ["orders"],
    ranking: "model-selected",
    usedFallback: false,
  })),
  runPipeline: vi.fn(async ({ question }: { question: string }) => ({ question }) as PipelineResult),
}));

const gateway = await import("../src/main/gateway");
const pipeline = await import("../src/main/pipeline");
const { fallbackQuestion, runAgentTurn } = await import("../src/main/agent");

const clarify = vi.mocked(gateway.clarify);
const runPipeline = vi.mocked(pipeline.runPipeline);
const selectSchema = vi.mocked(pipeline.selectSchema);
const emit = vi.fn();

type ClarifyReply = Awaited<ReturnType<typeof gateway.clarify>>;

function reply(overrides: Partial<ClarifyReply>): ClarifyReply {
  return { status: "ready", message: "", options: [], resolved_question: null, assumptions: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runAgentTurn", () => {
  it("relays a clarifying question without running anything", async () => {
    clarify.mockResolvedValue(reply({ status: "ask", message: "Best by what?", options: ["Orders", "Spend"] }));

    const result = await runAgentTurn({ question: "best customer", history: [] }, emit);

    expect(result).toEqual({ kind: "ask", message: "Best by what?", options: ["Orders", "Spend"] });
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("grounds the clarifier in the pruned schema", async () => {
    clarify.mockResolvedValue(reply({ status: "ask", message: "?" }));

    await runAgentTurn({ question: "best customer", history: [] }, emit);

    expect(clarify).toHaveBeenCalledWith("best customer", ["CREATE TABLE orders (id INT, total DECIMAL);"], []);
  });

  it("selects tables using the user's replies as well as the question", async () => {
    clarify.mockResolvedValue(reply({ status: "ask", message: "?" }));
    const history: ChatTurn[] = [
      { role: "assistant", content: "Best by what?" },
      { role: "user", content: "spend by region" },
    ];

    await runAgentTurn({ question: "best customer", history }, emit);

    expect(selectSchema).toHaveBeenCalledWith(expect.anything(), "best customer. spend by region");
  });

  it("runs the resolved question once the conversation settles", async () => {
    clarify.mockResolvedValue(reply({ resolved_question: "Top 10 customers by total spend", assumptions: ["All time"] }));

    const result = await runAgentTurn({ question: "best customer", history: [] }, emit);

    expect(runPipeline).toHaveBeenCalledWith({ question: "Top 10 customers by total spend" }, emit);
    expect(result).toMatchObject({
      kind: "answer",
      resolvedQuestion: "Top 10 customers by total spend",
      assumptions: ["All time"],
    });
  });

  it("reports an unanswerable question without running it", async () => {
    clarify.mockResolvedValue(reply({ status: "unanswerable", message: "No ratings data." }));

    const result = await runAgentTurn({ question: "happiest customer", history: [] }, emit);

    expect(result).toEqual({ kind: "unanswerable", message: "No ratings data." });
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("falls back to an ordinary run when the clarifier is unavailable", async () => {
    clarify.mockRejectedValue(new Error("404"));
    const history: ChatTurn[] = [
      { role: "assistant", content: "Best by what?" },
      { role: "user", content: "spend" },
    ];

    const result = await runAgentTurn({ question: "best customer", history }, emit);

    expect(runPipeline).toHaveBeenCalledWith({ question: "best customer (spend)" }, emit);
    expect(result.kind).toBe("answer");
  });

  it("skips clarification entirely when asked to", async () => {
    await runAgentTurn({ question: "best customer", history: [], skip: true }, emit);

    expect(clarify).not.toHaveBeenCalled();
    expect(selectSchema).not.toHaveBeenCalled();
    expect(runPipeline).toHaveBeenCalledWith({ question: "best customer" }, emit);
  });

  it("rejects an empty question", async () => {
    await expect(runAgentTurn({ question: "  ", history: [] }, emit)).rejects.toMatchObject({
      code: "EMPTY_QUESTION",
    });
  });
});

describe("fallbackQuestion", () => {
  it("appends only the user's replies", () => {
    const history: ChatTurn[] = [
      { role: "assistant", content: "Best by what?" },
      { role: "user", content: "spend" },
      { role: "assistant", content: "Which period?" },
      { role: "user", content: "this year" },
    ];
    expect(fallbackQuestion("best customer", history)).toBe("best customer (spend; this year)");
  });

  it("is the bare question when nothing was answered", () => {
    expect(fallbackQuestion(" best customer ", [])).toBe("best customer");
  });
});
