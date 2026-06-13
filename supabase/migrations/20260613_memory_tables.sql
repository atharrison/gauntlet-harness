-- Memory tables for gauntlet-harness
-- Run against your existing Supabase project.

-- Enable pgvector (required for v2 code search; harmless in v1)
CREATE EXTENSION IF NOT EXISTS vector;

-- Memories: user-defined review criteria and team coding standards.
-- These are injected into the system prompt at run start.
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  context TEXT NOT NULL DEFAULT '',  -- empty = global; set to repo name to scope
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_context_idx ON memories (context);

-- Review history: full output of every submitted PR review.
-- Searched by the context agent via search_past_reviews().
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

-- Checkpoint records: pass/fail state for each review stage.
-- Used by resumeFromCheckpoint() to skip already-completed stages.
CREATE TABLE IF NOT EXISTS review_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  message TEXT,
  payload JSONB,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, stage)
);

CREATE INDEX IF NOT EXISTS review_checkpoints_review_idx ON review_checkpoints (review_id);

-- Row-level security: service role key bypasses RLS.
-- Anon key is read-only for memories; review_history is service-role-only.
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_checkpoints ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read memories
CREATE POLICY "authenticated can read memories"
  ON memories FOR SELECT
  TO authenticated
  USING (true);

-- Service role writes everything (no policy needed — service role bypasses RLS)
