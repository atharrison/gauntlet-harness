-- Memory tables for gauntlet-harness
-- Run against your existing Supabase project.
-- Enable pgvector (required for v2 code search; harmless in v1)
create extension IF not exists vector;

-- Memories: user-defined review criteria and team coding standards.
-- These are injected into the system prompt at run start.
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  tags text[] not null default '{}',
  context text not null default '', -- empty = global; set to repo name to scope
  created_at timestamptz not null default now()
);

create index IF not exists memories_context_idx on memories (context);

-- Review history: full output of every submitted PR review.
-- Searched by the context agent via search_past_reviews().
create table if not exists review_history (
  id uuid primary key default gen_random_uuid(),
  pr_url text not null,
  repo_name text not null,
  pr_title text not null,
  author text not null,
  reviewed_at timestamptz not null default now(),
  finding_count integer not null default 0,
  summary text not null default '',
  raw_json jsonb not null default '{}'
);

create index IF not exists review_history_repo_idx on review_history (repo_name);

create index IF not exists review_history_author_idx on review_history (author);

-- Checkpoint records: pass/fail state for each review stage.
-- Used by resumeFromCheckpoint() to skip already-completed stages.
-- agent_name is nullable: single-agent stages (INPUT, OUTPUT, FINALIZE) leave it null;
-- parallel domain agents (correctness, security) set it so they don't collide on DOMAIN.
create table if not exists review_checkpoints (
  id uuid primary key default gen_random_uuid(),
  review_id text not null,
  stage text not null,
  agent_name text,
  passed boolean not null,
  message text,
  payload jsonb,
  recorded_at timestamptz not null default now(),
  unique NULLS not distinct (review_id, stage, agent_name)
);

create index IF not exists review_checkpoints_review_idx on review_checkpoints (review_id);

-- Row-level security: service role key bypasses RLS.
-- Anon key is read-only for memories; review_history is service-role-only.
alter table memories ENABLE row LEVEL SECURITY;

alter table review_history ENABLE row LEVEL SECURITY;

alter table review_checkpoints ENABLE row LEVEL SECURITY;

-- Allow authenticated users to read memories
create policy "authenticated can read memories" on memories for
select
  to authenticated using (true);

-- Service role writes everything (no policy needed — service role bypasses RLS)
