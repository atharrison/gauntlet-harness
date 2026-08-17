-- Automatically increment review_count and clear updated_since_review
-- whenever a tracked_pr transitions into REVIEWED status.
--
-- Using a BEFORE UPDATE trigger ensures the increment is atomic with the
-- status change — no separate RPC call or client-side read-modify-write needed.
-- The IS DISTINCT FROM guard prevents double-counting if REVIEWED is set again
-- while the row is already in that status.
create or replace function manage_tracked_pr_on_reviewed () returns trigger language plpgsql as $$
begin
  if new.status = 'REVIEWED' and old.status is distinct from 'REVIEWED' then
    new.review_count = old.review_count + 1;
    new.updated_since_review = false;
  end if;
  return new;
end;
$$;

create trigger tracked_prs_on_reviewed
before update on tracked_prs for each row
execute function manage_tracked_pr_on_reviewed ();
