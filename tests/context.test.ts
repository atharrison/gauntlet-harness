// Mock the github tools module — @octokit/rest is ESM-only and can't be loaded
// by Jest's CJS runtime. buildRegistry() lazy-requires it; we mock so it
// returns an empty object instead.
jest.mock("../src/tools/github", () => ({
  createGithubTools: () => ({}),
  createOctokit: () => ({}),
}))

import { createReviewContext, buildRegistry } from "../src/harness/context";
import { LocalMemoryStore } from "../src/memory/local";
import { InMemoryCheckpointStore } from "../src/harness/checkpoints";
import { createModelClient } from "../src/harness/models";
import os from "os";
import path from "path";
import fs from "fs";

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-test-"));
  return path.join(dir, "test.db");
}

describe("buildRegistry", () => {
  it("registers all expected tools", () => {
    const memory = new LocalMemoryStore(tempDb());
    const deps = {
      model: createModelClient({ provider: "anthropic", apiKey: "test-key" }),
      memory,
      checkpoints: new InMemoryCheckpointStore(),
    };
    const registry = buildRegistry(deps);
    const names = Object.keys(registry).sort();
    // GitHub tools (mocked), memory tools, ticket tools
    expect(names).toContain("search_past_reviews");
    expect(names).toContain("store_review");
    expect(names).toContain("create_memory");
    expect(names).toContain("fetch_ticket");
    expect(names).toContain("search_tickets");
  });
});

describe("createReviewContext", () => {
  let dbFile: string;
  let memory: LocalMemoryStore;

  beforeEach(() => {
    dbFile = tempDb();
    memory = new LocalMemoryStore(dbFile);
  });

  afterEach(() => {
    memory.close();
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  });

  it("assembles all deps with overrides", () => {
    const ctx = createReviewContext({
      model: createModelClient({ provider: "anthropic", apiKey: "test-key" }),
      memory,
      checkpoints: new InMemoryCheckpointStore(),
    });

    expect(ctx.deps.memory).toBe(memory);
    expect(ctx.deps.checkpoints).toBeInstanceOf(InMemoryCheckpointStore);
    expect(ctx.registry).toBeDefined();
    expect(typeof ctx.dispatcher).toBe("function");
  });

  it("dispatcher returns a ToolDispatcher bound to the registry", async () => {
    const ctx = createReviewContext({
      model: createModelClient({ provider: "anthropic", apiKey: "test-key" }),
      memory,
      checkpoints: new InMemoryCheckpointStore(),
    });

    const dispatch = ctx.dispatcher("review-123");
    // With an empty registry, any tool call returns error-as-data (not a throw)
    const result = await dispatch({ id: "c1", name: "nonexistent_tool", args: {} });
    expect(result.role).toBe("tool");
    expect(result.content).toContain("Unknown tool");
  });
});
