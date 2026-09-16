-- NX974 — A form that answers 503 has already lost the lead.
--
-- Measured 16 Sep 2026, on the live site, from the owner's own browser:
--   POST https://nexus-for-autodealers.vercel.app/api/lead
--     -> 503 {"error":"not_delivered","detail":"notify_secret_not_configured",
--             "stored_for_replay":false}
--   Vercel project nexus-for-autodealers: "No Environment Variables Added".
-- So every enquiry the marketing site has ever received has been answered
-- "that did not send", and nothing anywhere kept it. Paid advertising is
-- about to point at that form.
--
-- The receiver's durability depended on three environment variables, one of
-- which is a service_role key. A public marketing page is the last place that
-- key belongs: it can read every dealership's customers. So durability is
-- rebuilt here instead, as the narrowest possible door:
--
--   anon may call exactly one function. That function may insert exactly one
--   row into exactly one table, which holds NEXUS's OWN vendor pipeline and
--   has no column, key or view reaching a dealership's data. anon may not
--   select from it, and the function returns only what the caller just sent.
--
-- This keeps the boundary the product is built to hold: a person asking for a
-- dealer audit is a prospect for NEXUS the vendor, NOT a car buyer belonging
-- to a dealership, and must never land in `leads`, `lead_event` or any tenant
-- table. That is why this is a separate table and not a fifth lead source.

begin;

create table if not exists public.nexus_sales_lead (
  id             uuid primary key default gen_random_uuid(),
  -- Minted once per page load by the browser and re-sent on every retry, so a
  -- visitor who submits twice is one prospect, not two. Absent is recorded as
  -- absent: a server-side substitute is unique per REQUEST and only looks
  -- idempotent.
  submission_id  text,
  full_name      text not null,
  phone_e164     text,
  email          text,
  dealership     text,
  stock_size     text,
  message        text,
  -- Which ad produced this. Without it the ad spend cannot be judged.
  attribution    jsonb not null default '{}'::jsonb,
  ip_country     text,
  received_at    timestamptz not null default now(),
  -- The vendor pipeline, moved by hand. No automation writes past NEW.
  status         text not null default 'NEW',
  contacted_at   timestamptz,
  notes          text,
  constraint nexus_sales_lead_has_a_name
    check (length(btrim(full_name)) between 1 and 120),
  constraint nexus_sales_lead_can_be_answered
    check (phone_e164 is not null or email is not null),
  constraint nexus_sales_lead_phone_is_e164
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint nexus_sales_lead_status_is_a_known_label
    check (status in ('NEW','CONTACTED','DEMO_BOOKED','PILOT','PAYING','LOST'))
);

comment on table public.nexus_sales_lead is
  'NEXUS''s own sales pipeline: dealerships enquiring about buying NEXUS. '
  'Deliberately outside the tenant model. A row here is a prospect for the '
  'vendor and is never a dealership''s customer, so it must not be counted, '
  'scored or displayed anywhere a dealer''s own leads are.';

create unique index if not exists nexus_sales_lead_one_row_per_submission
  on public.nexus_sales_lead (submission_id) where submission_id is not null;
create index if not exists nexus_sales_lead_newest_first
  on public.nexus_sales_lead (received_at desc);

alter table public.nexus_sales_lead enable row level security;
revoke all on public.nexus_sales_lead from public, anon, authenticated;
grant all on public.nexus_sales_lead to service_role;

create policy nexus_sales_lead_service_only on public.nexus_sales_lead
  for all to service_role using (true) with check (true);
-- Restrictive, so no later permissive policy can re-open it by accident.
create policy nexus_sales_lead_never_end_users on public.nexus_sales_lead
  as restrictive for all to anon, authenticated using (false) with check (false);

-- The one door anon may knock on. SECURITY DEFINER, so the caller's inability
-- to touch the table is exactly the point: it can put a row in and learn
-- nothing else.
create or replace function public.nexus_sales_lead_submit(
  p_submission_id text,
  p_full_name     text,
  p_phone_e164    text default null,
  p_email         text default null,
  p_dealership    text default null,
  p_stock_size    text default null,
  p_message       text default null,
  p_attribution   jsonb default '{}'::jsonb,
  p_ip_country    text default null
) returns table (submission_id text, was_duplicate boolean, received_at timestamptz)
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_name   text := left(btrim(coalesce(p_full_name,'')), 120);
  v_phone  text := nullif(btrim(coalesce(p_phone_e164,'')), '');
  v_email  text := nullif(lower(btrim(coalesce(p_email,''))), '');
  v_sub    text := nullif(btrim(coalesce(p_submission_id,'')), '');
  v_recent int;
  v_row    public.nexus_sales_lead%rowtype;
begin
  if v_name = '' then
    raise exception using errcode = 'P0001',
      message = 'NX974 REFUSED: a prospect with no name is not a prospect.';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    -- Dropped rather than coerced. A mangled number is a prospect nobody can
    -- call, and it looks like a reachable one.
    v_phone := null;
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    v_email := null;
  end if;
  if v_phone is null and v_email is null then
    raise exception using errcode = 'P0001',
      message = 'NX974 REFUSED: neither a reachable phone number nor an email, so nobody could answer this.';
  end if;

  -- Flood guard. anon can reach this function, so the table itself states its
  -- limit rather than trusting a per-instance counter in a serverless function
  -- that runs in as many instances as the platform feels like.
  select count(*) into v_recent from public.nexus_sales_lead
   where received_at > now() - interval '1 minute';
  if v_recent >= 30 then
    raise exception using errcode = 'P0001',
      message = 'NX974 REFUSED: more than thirty submissions in the last minute. Refusing rather than filling the pipeline with whatever this is.';
  end if;

  if v_sub is not null then
    select * into v_row from public.nexus_sales_lead s where s.submission_id = v_sub;
    if found then
      -- A retry after a failed response is the same person, not a second one.
      submission_id := v_row.submission_id;
      was_duplicate := true;
      received_at   := v_row.received_at;
      return next;
      return;
    end if;
  end if;

  insert into public.nexus_sales_lead
    (submission_id, full_name, phone_e164, email, dealership, stock_size,
     message, attribution, ip_country)
  values
    (v_sub, v_name, v_phone, v_email,
     left(btrim(coalesce(p_dealership,'')), 160),
     left(btrim(coalesce(p_stock_size,'')), 40),
     left(btrim(coalesce(p_message,'')), 1500),
     coalesce(p_attribution, '{}'::jsonb),
     left(btrim(coalesce(p_ip_country,'')), 8))
  returning * into v_row;

  submission_id := v_row.submission_id;
  was_duplicate := false;
  received_at   := v_row.received_at;
  return next;
end
$fn$;

comment on function public.nexus_sales_lead_submit(text,text,text,text,text,text,text,jsonb,text) is
  'The only thing anon may do in this database. Inserts one NEXUS sales '
  'prospect and returns nothing it was not given. It cannot read the table, '
  'cannot reach a tenant, and cannot be used to enumerate anything.';

revoke all on function public.nexus_sales_lead_submit(text,text,text,text,text,text,text,jsonb,text)
  from public;
grant execute on function public.nexus_sales_lead_submit(text,text,text,text,text,text,text,jsonb,text)
  to anon, authenticated, service_role;

commit;