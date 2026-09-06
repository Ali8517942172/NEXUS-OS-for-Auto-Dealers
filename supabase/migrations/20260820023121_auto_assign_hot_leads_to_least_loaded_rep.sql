-- The Master Router scores a lead HOT and hands it to the escalation and ERP
-- workflows, but it never wrote assigned_to_id back, so every HOT lead landed
-- in the dashboard unowned and the team screen showed nobody carrying anything.
--
-- Doing the assignment in the workflow means teaching an LLM tool call to pick a
-- rep, which is both fragile and racy. Doing it in Postgres makes it
-- deterministic and, more importantly, correct no matter which workflow writes
-- the lead -- the router, the ERP sync, or a human editing the row.
--
-- Rule: a HOT lead with no owner goes to the active rep carrying the fewest open
-- HOT leads, senior reps first. Reps that are still `pending_invite` are not real
-- users yet and are skipped. If there is nobody to assign to, the lead is left
-- unowned rather than silently pointed at a placeholder.
create or replace function public.assign_hot_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pick record;
begin
  if coalesce(new.status, '') <> 'HOT' or new.assigned_to_id is not null then
    return new;
  end if;

  select u.id, u.name into pick
  from public.users u
  left join public.leads l
    on l.assigned_to_id = u.id
   and l.status = 'HOT'
   and (new.id is null or l.id <> new.id)
  where coalesce(u.status, '') <> 'pending_invite'
    and coalesce(u.role, '') in ('senior_rep', 'sales_rep', 'manager')
  group by u.id, u.name, u.role
  order by count(l.id) asc,
           case u.role when 'senior_rep' then 0 when 'manager' then 1 else 2 end,
           u.name
  limit 1;

  if found then
    new.assigned_to_id := pick.id;
    if new.assigned_to is null or new.assigned_to = '' then
      new.assigned_to := pick.name;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.assign_hot_lead() from anon, authenticated;

drop trigger if exists trg_assign_hot_lead on public.leads;
create trigger trg_assign_hot_lead
  before insert or update of status, assigned_to_id on public.leads
  for each row execute function public.assign_hot_lead();