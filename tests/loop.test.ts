import { run, TurnLimitError, TokenBudgetError } from "../src/harness/loop";
import type { ModelClient, ModelReply, ToolDefinition, ToolCall, Message } from "../src/harness/models";

// Silence alarm stderr output in tests
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

function makeReply(overrides: Partial<ModelReply> = {}): ModelReply {
  return {
    text: "done",
    toolCalls: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-3-5-sonnet-20241022",
    cost: 0.001,
    ...overrides,
  };
}

function makeModel(replies: ModelReply[]): ModelClient {
  let i = 0;
  return {
    chat: jest.fn(async () => {
      if (i >= replies.length) throw new Error("Unexpected model call");
      return replies[i++];
    }),
  };
}

const noopDispatch = async (_call: ToolCall): Promise<Message> => ({
  role: "tool",
  content: JSON.stringify({ result: "ok" }),
  toolCallId: _call.id,
  toolName: _call.name,
});

describe("run — happy path", () => {
  it("returns final text when model produces no tool calls", async () => {
    const model = makeModel([makeReply({ text: "LGTM" })]);
    const result = await run("review this PR", model, [], noopDispatch);
    expect(result.text).toBe("LGTM");
    expect(result.turnsUsed).toBe(1);
  });

  it("dispatches tool calls and continues until final answer", async () => {
    const toolCall: ToolCall = { id: "tc1", name: "fetch_pr_diff", args: {} };
    const model = makeModel([
      makeReply({ text: "", toolCalls: [toolCall] }),
      makeReply({ text: "Analysis complete" }),
    ]);
    const result = await run("review this PR", model, [], noopDispatch);
    expect(result.text).toBe("Analysis complete");
    expect(result.turnsUsed).toBe(2);
  });
});

describe("run — hard stops", () => {
  it("throws TurnLimitError when maxTurns is exhausted", async () => {
    let callCount = 0;
    // Vary args each turn so repeated-call detection doesn't fire first
    const model: ModelClient = {
      chat: jest.fn(async () =>
        makeReply({ toolCalls: [{ id: `tc${callCount}`, name: "fetch", args: { n: callCount++ } }] }),
      ),
    };
    await expect(
      run("go", model, [], noopDispatch, { maxTurns: 3 }),
    ).rejects.toThrow(TurnLimitError);
  });

  it("throws TokenBudgetError when cumulative tokens exceed limit", async () => {
    // Each reply uses 1000 tokens; limit is 500
    const model = makeModel([
      makeReply({ usage: { inputTokens: 600, outputTokens: 600 }, toolCalls: [] }),
    ]);
    // First turn: tokens = 1200 > 500 → but check happens before the call on turn > 0
    // Set maxTokens very low so it trips after first call
    const toolCall: ToolCall = { id: "t1", name: "x", args: {} };
    const loopingModel: ModelClient = {
      chat: jest.fn(async () =>
        makeReply({ usage: { inputTokens: 400, outputTokens: 400 }, toolCalls: [toolCall] }),
      ),
    };
    await expect(
      run("go", loopingModel, [], noopDispatch, { maxTurns: 10, maxTokens: 500 }),
    ).rejects.toThrow(TokenBudgetError);
  });

  it("detects repeated tool calls and throws", async () => {
    const toolCall: ToolCall = { id: "t1", name: "search", args: { q: "same" } };
    const model: ModelClient = {
      chat: jest.fn(async () => makeReply({ toolCalls: [toolCall] })),
    };
    await expect(
      run("go", model, [], noopDispatch, { maxTurns: 10 }),
    ).rejects.toThrow("Repeated tool call detected");
  });
});
