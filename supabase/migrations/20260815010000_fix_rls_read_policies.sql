-- Fix missing SELECT policies on review_history and review_checkpoints.
-- The original migration (20260613000000_memory_tables.sql) enabled RLS on
-- these tables but only added a SELECT policy for `memories`. The
-- search_past_reviews tool queries review_history as the authenticated role
-- and was getting "permission denied". Service role writes still bypass RLS.
create policy "authenticated can read review_history" on review_history for
select
  to authenticated using (true);

create policy "authenticated can read review_checkpoints" on review_checkpoints for
select
  to authenticated using (true);
