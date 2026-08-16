-- Grant table-level privileges to standard Supabase roles.
--
-- Supabase normally sets up ALTER DEFAULT PRIVILEGES so new tables get grants
-- automatically, but our local instance is missing that setup for these tables.
-- RLS policies are a second layer — they don't help if the role has no base
-- table privilege at all. Explicit GRANTs fix the root cause.
-- reviews: service_role manages (all ops), authenticated reads
grant all on public.reviews to service_role;

grant
select
  on public.reviews to authenticated;

-- tracked_prs: service_role manages, authenticated reads
grant all on public.tracked_prs to service_role;

grant
select
  on public.tracked_prs to authenticated;

-- configured_repos: service_role manages, authenticated does admin CRUD
grant all on public.configured_repos to service_role;

grant all on public.configured_repos to authenticated;

-- settings: service_role manages, authenticated does admin CRUD
grant all on public.settings to service_role;

grant all on public.settings to authenticated;

-- Memory tables (from 20260613000000_memory_tables.sql) — same issue
grant all on public.memories to service_role;

grant
select
  on public.memories to authenticated;

grant all on public.review_history to service_role;

grant
select
  on public.review_history to authenticated;

grant all on public.review_checkpoints to service_role;

grant
select
  on public.review_checkpoints to authenticated;
