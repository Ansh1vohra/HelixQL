import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SchemaBlueprint, WritePreview } from "../src/shared/types";

const driver = {
  query: vi.fn(),
  write: vi.fn(),
};

const blueprint: SchemaBlueprint = {
  dialect: "mysql",
  database: "shop",
  capturedAt: "",
  tables: [
    {
      name: "customers",
      columns: [
        { name: "id", dataType: "INT", nullable: false, isPrimaryKey: true, generated: true },
        { name: "email", dataType: "VARCHAR(100)", nullable: false, isPrimaryKey: false },
      ],
      foreignKeys: [],
    },
  ],
};

vi.mock("../src/main/db/connection", () => ({
  requireActive: vi.fn(() => ({ driver, config: { dialect: "mysql" } })),
  getBlueprint: vi.fn(() => blueprint),
}));
vi.mock("../src/main/gateway", () => ({ writePlan: vi.fn() }));
vi.mock("../src/main/agent", () => ({
  runAgentTurn: vi.fn(async () => ({ kind: "unanswerable", message: "read path" })),
}));
vi.mock("../src/main/pipeline", () => ({
  selectSchema: vi.fn(async () => ({ schemaDdl: [], tables: ["customers"], ranking: "", usedFallback: false })),
}));

const gateway = await import("../src/main/gateway");
const agent = await import("../src/main/agent");
const { RowCountMismatchError } = await import("../src/main/db/driver");
const { cancelWrite, confirmWrite, mightWrite, runBetaTurn } = await import("../src/main/beta");

const writePlan = vi.mocked(gateway.writePlan);
const emit = vi.fn();

type PlanReply = Awaited<ReturnType<typeof gateway.writePlan>>;

function ready(plan: object): PlanReply {
  return { status: "ready", message: "", options: [], plan: plan as never };
}

const deleteByEmail = ready({ operation: "delete", table: "customers", values: {}, where: [{ column: "email", op: "=", value: "a@b.c" }] });

async function previewOf(reply: PlanReply): Promise<WritePreview> {
  writePlan.mockResolvedValue(reply);
  const result = await runBetaTurn({ question: "delete that customer", history: [] }, emit);
  if (result.kind !== "confirm") throw new Error(`expected confirm, got ${result.kind}`);
  return result.preview;
}

beforeEach(() => {
  vi.clearAllMocks();
  driver.query.mockReset();
  driver.write.mockReset();
});

describe("runBetaTurn", () => {
  it("sends a question with no writing verb straight to agent talk", async () => {
    const result = await runBetaTurn({ question: "how many customers are in Punjab?", history: [] }, emit);

    expect(writePlan).not.toHaveBeenCalled();
    expect(agent.runAgentTurn).toHaveBeenCalledWith(
      { question: "how many customers are in Punjab?", history: [], context: [], skip: undefined },
      emit,
    );
    expect(result).toMatchObject({ track: "read", message: "read path" });
  });

  it("hands a read to agent talk when the planner says so", async () => {
    writePlan.mockResolvedValue({ status: "read", message: "", options: [], plan: null });

    const result = await runBetaTurn({ question: "show the price change by month", history: [] }, emit);

    expect(writePlan).toHaveBeenCalled();
    expect(result).toMatchObject({ track: "read", message: "read path" });
  });

  it("keeps a read exchange on the read track without asking the planner", async () => {
    await runBetaTurn({ question: "q", history: [], track: "read" }, emit);
    expect(writePlan).not.toHaveBeenCalled();
    expect(agent.runAgentTurn).toHaveBeenCalled();
  });

  it("asks for missing required fields locally instead of previewing", async () => {
    writePlan.mockResolvedValue(ready({ operation: "insert", table: "customers", values: {}, where: [] }));

    const result = await runBetaTurn({ question: "add a customer", history: [] }, emit);

    expect(result).toMatchObject({ kind: "ask", track: "write" });
    expect(driver.write).not.toHaveBeenCalled();
  });

  it("previews a delete with the rows it would remove, and changes nothing", async () => {
    driver.query
      .mockResolvedValueOnce({ columns: ["affected"], rows: [{ affected: 1 }] })
      .mockResolvedValueOnce({ columns: ["id", "email"], rows: [{ id: 3, email: "a@b.c" }] });

    const preview = await previewOf(deleteByEmail);

    expect(preview.affectedRows).toBe(1);
    expect(preview.preview.rows).toEqual([{ id: 3, email: "a@b.c" }]);
    expect(preview.confirmWord).toBe("delete");
    expect(driver.write).not.toHaveBeenCalled();
  });

  it("does not offer a change that matches no rows", async () => {
    driver.query.mockResolvedValueOnce({ columns: ["affected"], rows: [{ affected: 0 }] });
    writePlan.mockResolvedValue(deleteByEmail);

    expect(await runBetaTurn({ question: "delete that customer", history: [] }, emit)).toMatchObject({ kind: "ask" });
  });

  it("refuses a change wider than the beta limit", async () => {
    driver.query.mockResolvedValueOnce({ columns: ["affected"], rows: [{ affected: 5000 }] });
    writePlan.mockResolvedValue(deleteByEmail);

    const result = await runBetaTurn({ question: "delete that customer", history: [] }, emit);
    expect(result).toMatchObject({ kind: "ask", message: expect.stringContaining("5,000") });
  });
});

describe("mightWrite", () => {
  it.each(["add a customer", "Delete the order 5", "change Priya's phone", "mark order 9 as shipped"])(
    "treats %s as a possible write",
    (question) => expect(mightWrite(question)).toBe(true),
  );

  it.each(["how many customers", "show cancelled orders", "new customers this month", "list updates"])(
    "treats %s as a read",
    (question) => expect(mightWrite(question)).toBe(false),
  );
});

describe("confirmWrite", () => {
  beforeEach(() => {
    driver.query
      .mockResolvedValueOnce({ columns: ["affected"], rows: [{ affected: 1 }] })
      .mockResolvedValueOnce({ columns: [], rows: [] });
  });

  it("requires the typed word for a delete", async () => {
    const preview = await previewOf(deleteByEmail);

    await expect(confirmWrite({ planId: preview.planId })).rejects.toMatchObject({ code: "WRITE_NOT_CONFIRMED" });
    expect(driver.write).not.toHaveBeenCalled();
  });

  it("runs exactly the previewed statement, once", async () => {
    driver.write.mockResolvedValue({ affectedRows: 1, insertId: null });
    const preview = await previewOf(deleteByEmail);

    const outcome = await confirmWrite({ planId: preview.planId, typed: " Delete " });

    expect(driver.write).toHaveBeenCalledWith("DELETE FROM `customers` WHERE `email` = ?", ["a@b.c"], 1);
    expect(outcome).toEqual({ operation: "delete", table: "customers", affectedRows: 1, insertId: null });
    await expect(confirmWrite({ planId: preview.planId, typed: "delete" })).rejects.toMatchObject({
      code: "WRITE_EXPIRED",
    });
  });

  it("reports a row-count change as a refused write", async () => {
    driver.write.mockRejectedValue(new RowCountMismatchError(1, 3));
    const preview = await previewOf(deleteByEmail);

    await expect(confirmWrite({ planId: preview.planId, typed: "delete" })).rejects.toMatchObject({
      code: "WRITE_ROWS_CHANGED",
    });
  });

  it("cannot confirm a cancelled change", async () => {
    const preview = await previewOf(deleteByEmail);
    cancelWrite({ planId: preview.planId });

    await expect(confirmWrite({ planId: preview.planId, typed: "delete" })).rejects.toMatchObject({
      code: "WRITE_EXPIRED",
    });
  });
});
