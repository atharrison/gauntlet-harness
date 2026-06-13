import {
  runCheckpoint,
  resumeFromCheckpoint,
  InMemoryCheckpointStore,
  CheckpointFailedError,
} from "../src/harness/checkpoints";

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("runCheckpoint — PASS", () => {
  it("persists a PASS record and returns the payload", async () => {
    const store = new InMemoryCheckpointStore();
    const result = await runCheckpoint({
      reviewId: "rev-1",
      stage: "INPUT",
      store,
      check: async () => ({ pass: true, payload: { prUrl: "https://github.com/x/y/pull/1" } }),
    });
    expect(result).toEqual({ prUrl: "https://github.com/x/y/pull/1" });
    const saved = await store.load("rev-1", "INPUT");
    expect(saved?.status).toBe("PASS");
  });
});

describe("runCheckpoint — FAIL", () => {
  it("persists a FAIL record, fires alarm, and throws CheckpointFailedError", async () => {
    const store = new InMemoryCheckpointStore();
    await expect(
      runCheckpoint({
        reviewId: "rev-2",
        stage: "OUTPUT",
        store,
        check: async () => ({ pass: false, payload: null, error: "Schema invalid" }),
      }),
    ).rejects.toThrow(CheckpointFailedError);

    const saved = await store.load("rev-2", "OUTPUT");
    expect(saved?.status).toBe("FAIL");
  });
});

describe("resumeFromCheckpoint", () => {
  it("returns null when no checkpoint exists", async () => {
    const store = new InMemoryCheckpointStore();
    const result = await resumeFromCheckpoint("rev-3", "CONTEXT", store);
    expect(result).toBeNull();
  });

  it("returns the persisted payload after a PASS", async () => {
    const store = new InMemoryCheckpointStore();
    await runCheckpoint({
      reviewId: "rev-4",
      stage: "CONTEXT",
      store,
      check: async () => ({ pass: true, payload: { diff: "abc" } }),
    });
    const result = await resumeFromCheckpoint<{ diff: string }>("rev-4", "CONTEXT", store);
    expect(result?.diff).toBe("abc");
  });
});
