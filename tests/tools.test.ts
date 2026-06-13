import { z } from "zod";
import { dispatch, toToolDefinitions, type ToolRegistry } from "../src/harness/tools";

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const registry: ToolRegistry = {
  echo: {
    description: "Echoes the input",
    schema: z.object({ message: z.string() }),
    fn: async ({ message }: { message: string }) => ({ echoed: message }),
  },
  fail: {
    description: "Always fails",
    schema: z.object({}),
    fn: async () => { throw new Error("tool error"); },
  },
};

describe("dispatch", () => {
  it("returns error-as-data for unknown tool", async () => {
    const result = await dispatch(
      { id: "c1", name: "nonexistent", args: {} },
      registry,
    );
    const parsed = JSON.parse(result.content);
    expect(parsed.error).toMatch(/Unknown tool/);
  });

  it("returns error-as-data when Zod validation fails", async () => {
    const result = await dispatch(
      { id: "c2", name: "echo", args: { message: 123 } }, // wrong type
      registry,
    );
    const parsed = JSON.parse(result.content);
    expect(parsed.error).toMatch(/Invalid arguments/);
  });

  it("executes known tool and returns result", async () => {
    const result = await dispatch(
      { id: "c3", name: "echo", args: { message: "hello" } },
      registry,
    );
    const parsed = JSON.parse(result.content);
    expect(parsed.echoed).toBe("hello");
    expect(result.toolName).toBe("echo");
    expect(result.toolCallId).toBe("c3");
  });

  it("returns error-as-data when tool throws (does not propagate)", async () => {
    const result = await dispatch(
      { id: "c4", name: "fail", args: {} },
      registry,
    );
    const parsed = JSON.parse(result.content);
    expect(parsed.error).toMatch(/tool error/);
  });
});

describe("toToolDefinitions", () => {
  it("produces a ToolDefinition for each registered tool", () => {
    const defs = toToolDefinitions(registry);
    expect(defs).toHaveLength(2);
    expect(defs.find((d) => d.name === "echo")).toBeDefined();
  });
});
