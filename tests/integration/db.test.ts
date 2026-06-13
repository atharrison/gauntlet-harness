/**
 * Integration tests against a real Postgres database.
 *
 * Run with: TEST_POSTGRES_URL=postgresql://... npm test -- --testPathPattern=integration
 * In CI this URL is provided by the GitHub Actions postgres service.
 *
 * These tests apply the same schema our production migration creates, then
 * exercise the data operations our adapters rely on — catching type mismatches,
 * constraint behavior, and JSONB semantics before they bite us on Railway.
 *
 * Supabase-specific DDL (pgvector extension, RLS, `authenticated` role policies)
 * is excluded here since it requires a full Supabase stack. Those are validated
 * by a manual smoke test against the real Supabase instance before deployment.
 */

import { Client } from "pg";
import { randomUUID } from "crypto";

const POSTGRES_URL =
  process.env.TEST_POSTGRES_URL ??
  "postgresql://harness:harness@localhost:5432/harness_test";

// Schema matching the migration but without Supabase-specific DDL
// (pgvector extension, RLS, `authenticated` role policies).
const SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    context TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS memories_context_idx ON memories (context);

  CREATE TABLE IF NOT EXISTS review_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pr_url TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    pr_title TEXT NOT NULL,
    author TEXT NOT NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finding_count INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    raw_json JSONB NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS review_history_repo_idx ON review_history (repo_name);
  CREATE INDEX IF NOT EXISTS review_history_author_idx ON review_history (author);

  CREATE TABLE IF NOT EXISTS review_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    agent_name TEXT,
    passed BOOLEAN NOT NULL,
    message TEXT,
    payload JSONB,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (review_id, stage, agent_name)
  );

  CREATE INDEX IF NOT EXISTS review_checkpoints_review_idx ON review_checkpoints (review_id);
`;

const TEARDOWN_SQL = `
  DROP TABLE IF EXISTS review_checkpoints;
  DROP TABLE IF EXISTS review_history;
  DROP TABLE IF EXISTS memories;
`;

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: POSTGRES_URL });
  await client.connect();
  await client.query(TEARDOWN_SQL);
  await client.query(SCHEMA_SQL);
});

afterAll(async () => {
  await client.query(TEARDOWN_SQL);
  await client.end();
});

// ── memories table ────────────────────────────────────────────────────────────

describe("memories table", () => {
  it("inserts and retrieves a memory with TEXT[] tags", async () => {
    await client.query(
      `INSERT INTO memories (content, tags, context)
       VALUES ($1, $2, $3)`,
      ["Always require type hints", ["python", "style"], "org/repo"]
    );

    const { rows } = await client.query(
      `SELECT content, tags, context FROM memories WHERE context = $1`,
      ["org/repo"]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("Always require type hints");
    expect(rows[0].tags).toEqual(["python", "style"]); // Postgres returns TEXT[] as JS array
    expect(rows[0].context).toBe("org/repo");
  });

  it("retrieves global memories (empty context) regardless of filter", async () => {
    await client.query(
      `INSERT INTO memories (content, tags, context) VALUES ($1, $2, '')`,
      ["Global rule", ["general"]]
    );

    const { rows } = await client.query(
      `SELECT content FROM memories WHERE context = '' OR context = $1`,
      ["any-repo"]
    );

    expect(rows.some((r) => r.content === "Global rule")).toBe(true);
  });
});

// ── review_history table ──────────────────────────────────────────────────────

describe("review_history table", () => {
  it("stores and retrieves JSONB raw_json as an object (not a string)", async () => {
    const reviewPayload = { summary: "Looks good", findings: [{ file: "main.py" }] };

    await client.query(
      `INSERT INTO review_history (pr_url, repo_name, pr_title, author, finding_count, summary, raw_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        "https://github.com/org/repo/pull/1",
        "org/repo",
        "Add auth middleware",
        "alice",
        1,
        reviewPayload.summary,
        JSON.stringify(reviewPayload), // stored as string, Postgres parses to JSONB
      ]
    );

    const { rows } = await client.query(
      `SELECT raw_json, raw_json->>'summary' AS summary FROM review_history WHERE repo_name = $1`,
      ["org/repo"]
    );

    expect(rows).toHaveLength(1);
    // Postgres returns JSONB as a parsed JS object — NOT a string.
    // Callers must NOT JSON.parse() it again.
    expect(typeof rows[0].raw_json).toBe("object");
    expect(rows[0].raw_json.summary).toBe("Looks good");
    expect(rows[0].summary).toBe("Looks good"); // operator ->> extracts as text
  });

  it("ILIKE search on summary and pr_title", async () => {
    const { rows } = await client.query(
      `SELECT pr_title FROM review_history
       WHERE summary ILIKE $1 OR pr_title ILIKE $1`,
      ["%auth%"]
    );
    expect(rows.some((r) => r.pr_title === "Add auth middleware")).toBe(true);
  });
});

// ── review_checkpoints table ──────────────────────────────────────────────────

describe("review_checkpoints table", () => {
  const reviewId = `review-${randomUUID()}`;

  it("inserts a PASS checkpoint", async () => {
    await client.query(
      `INSERT INTO review_checkpoints (review_id, stage, agent_name, passed, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [reviewId, "DOMAIN", "correctness-agent", true, JSON.stringify({ ok: true })]
    );

    const { rows } = await client.query(
      `SELECT passed, payload FROM review_checkpoints WHERE review_id = $1 AND stage = $2 AND agent_name = $3`,
      [reviewId, "DOMAIN", "correctness-agent"]
    );

    expect(rows[0].passed).toBe(true);
    expect(rows[0].payload).toEqual({ ok: true }); // JSONB returned as object
  });

  it("parallel domain agents can both write DOMAIN stage (different agent_name)", async () => {
    // correctness already written above; security should succeed too
    await expect(
      client.query(
        `INSERT INTO review_checkpoints (review_id, stage, agent_name, passed, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [reviewId, "DOMAIN", "security-agent", true, JSON.stringify({ ok: true })]
      )
    ).resolves.toBeDefined();

    const { rows } = await client.query(
      `SELECT agent_name FROM review_checkpoints WHERE review_id = $1 AND stage = $2`,
      [reviewId, "DOMAIN"]
    );
    expect(rows).toHaveLength(2);
  });

  it("duplicate (review_id, stage, agent_name) is rejected by unique constraint", async () => {
    await expect(
      client.query(
        `INSERT INTO review_checkpoints (review_id, stage, agent_name, passed)
         VALUES ($1, $2, $3, $4)`,
        [reviewId, "DOMAIN", "correctness-agent", false] // already inserted above
      )
    ).rejects.toThrow(/unique/i);
  });

  it("single-agent stage (null agent_name) can be written once", async () => {
    await client.query(
      `INSERT INTO review_checkpoints (review_id, stage, agent_name, passed)
       VALUES ($1, 'INPUT', NULL, TRUE)`,
      [reviewId]
    );

    await expect(
      client.query(
        `INSERT INTO review_checkpoints (review_id, stage, agent_name, passed)
         VALUES ($1, 'INPUT', NULL, TRUE)`,
        [reviewId]
      )
    ).rejects.toThrow(/unique/i);
  });
});
