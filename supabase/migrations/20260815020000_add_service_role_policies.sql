-- Add explicit ALL policies for service_role on every server-managed table.
--
-- With the new sb_secret_ key format in Supabase CLI v2, the local stack does
-- not always map the service-role key to the service_role PostgreSQL role's
-- BYPASSRLS attribute correctly. Explicit policies are belt-and-suspenders:
-- even if BYPASSRLS is not set, the service_role role has an explicit grant.
create policy "service_role can manage reviews" on reviews for all to service_role using (true)
with
  check (true);

create policy "service_role can manage tracked_prs" on tracked_prs for all to service_role using (true)
with
  check (true);

create policy "service_role can manage configured_repos" on configured_repos for all to service_role using (true)
with
  check (true);

create policy "service_role can manage settings" on settings for all to service_role using (true)
with
  check (true);

-- Also cover the memory tables added in 20260613000000_memory_tables.sql
-- (service_role writes to these when storing review history)
create policy "service_role can manage memories" on memories for all to service_role using (true)
with
  check (true);

create policy "service_role can manage review_history" on review_history for all to service_role using (true)
with
  check (true);

create policy "service_role can manage review_checkpoints" on review_checkpoints for all to service_role using (true)
with
  check (true);
