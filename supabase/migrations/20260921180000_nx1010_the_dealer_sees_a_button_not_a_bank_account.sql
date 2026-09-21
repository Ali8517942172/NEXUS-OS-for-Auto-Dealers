-- NEXUS OS -- NX1010: the dealer sees a button, not a bank account
--
-- ORIGINAL DEFECT (owner decision, 21 Sep 2026). NX1008 gave the founder
-- console a form for NEXUS's own bank account -- holder, bank name, IBAN,
-- SWIFT -- and gave every dealer a "How to pay" panel that rendered all
-- four back out. Two things changed the plan since:
--
--   1. The owner decided a dealer must NEVER see a bank name, an account
--      holder name or an IBAN at all. What a dealer should see is one
--      button: "NEXUS by Adqonic -- AED 399/month -- Pay now", which opens
--      a Ziina hosted payment link the founder pastes into the console
--      himself. No card processor integration, no API keys held by this
--      app -- the link IS the integration.
--   2. The founder console's payment form never worked in the first place:
--      nexus_founder_set_payment_details() made SWIFT mandatory, and the
--      real-world account behind this platform has no SWIFT code. Every
--      attempt to save refused with NX_PAYMENT_SWIFT_REQUIRED. The bank
--      form was not a working feature with the wrong UI; it was a feature
--      that had never once saved.
--
-- This migration is the database half of both changes. It does not drop
-- platform_payment_details or its bank columns -- confirmed empty by SELECT
-- COUNT(*) before writing this migration (0 rows, 21 Sep 2026) -- because a
-- column with no reader and no writer costs nothing to leave in place, and
-- dropping a column is the one schema change this codebase cannot undo by
-- shipping a follow-up migration. The bank columns become dead: nothing in
-- this migration, the RPCs it installs, or the frontend that follows it
-- ever reads or writes account_holder, bank_name, iban or swift_bic again.
--
-- WHAT THIS MIGRATION DOES
-- -------------------------
--   1. Adds payment_link_url and display_name to platform_payment_details.
--      display_name defaults to 'Adqonic' -- the only name a dealer will
--      ever see next to "NEXUS by ___".
--   2. Installs nexus_founder_set_payment_link(p_payment_link_url,
--      p_display_name) -- platform-admin gated exactly like every
--      nexus_founder_* function, validates the URL is `https://` on a host
--      that is exactly ziina.com, pay.ziina.com, or a subdomain of
--      ziina.com (rejects everything else outright: this link is shown,
--      unauthenticated, to every dealer on the platform, so it must not be
--      able to point at a phishing page wearing NEXUS's name), validates
--      display_name is 1-60 characters, upserts the row, writes an
--      audit_log row.
--   3. Drops the old nexus_founder_set_payment_details(text,text,text,
--      text,text,text,text) signature outright -- it never saved a row in
--      production (SWIFT was mandatory, the owner has no SWIFT code), so
--      there is no working caller and no data-loss risk in removing it.
--   4. Replaces nexus_payment_instructions() to return ONLY display_name,
--      a fixed amount_aed of 399, currency, payment_link_url and the
--      caller's own tenant reference -- never a bank field, by
--      construction: the new return table does not have a column for one.
--      Still returns a row (payment_link_url null, the rest filled in)
--      once the founder has never touched the row at all, so the
--      frontend gets "no link yet" as data, not as an RPC that returns
--      nothing -- distinguishing "you have no membership" (zero rows) from
--      "online payment isn't set up yet" (one row, null link) is now the
--      RPC's job, not a guess the frontend makes from an empty response.
--
-- WHY REVOKE-THEN-GRANT, NAMING public EXPLICITLY, ON EVERY FUNCTION
-- --------------------------------------------------------------------
-- ops/ci/function-grants.mjs (see its own header) exists because a bare
-- `revoke ... from anon, authenticated` does not touch the separate PUBLIC
-- grant a function is born with, and Supabase's default privileges hand
-- anon a grant of its own that a revoke naming only `public` does not
-- reach either. Every function below revokes all three names in one
-- statement before granting anything back.
-- ===========================================================================

-- ===========================================================================
-- 1. platform_payment_details -- add the link and the display name
-- ===========================================================================
alter table public.platform_payment_details
  add column if not exists payment_link_url text,
  add column if not exists display_name text not null default 'Adqonic';

comment on table public.platform_payment_details is
  'NEXUS''s own payment configuration -- what a dealer sees on its Subscription '
  'screen and what its Pay now button opens. Exactly one row (id=1, enforced '
  'by a CHECK). RLS is enabled with no policies for anon or authenticated -- '
  'like platform_admin in NX1003, a table with RLS on and no permissive '
  'policy denies both roles by default, and every read or write goes through '
  'a SECURITY DEFINER RPC (nexus_payment_instructions for dealers, '
  'nexus_founder_set_payment_link for the founder) instead of direct '
  'PostgREST access to this table. account_holder, bank_name, iban and '
  'swift_bic are NX1008 leftovers: the owner decided (21 Sep 2026, NX1010) '
  'that a dealer must never see a bank name, an account holder name or an '
  'IBAN, and every payment now runs through payment_link_url (a Ziina '
  'hosted payment link) instead. Those four columns are kept, unused, '
  'rather than dropped, because the table holds zero rows and a column with '
  'no reader and no writer costs nothing to leave in place -- but nothing '
  'in this schema reads or writes them any more. Never queried directly by '
  'the frontend either way.';

comment on column public.platform_payment_details.payment_link_url is
  'The founder''s hosted Ziina payment link, opened by every dealer''s Pay '
  'now button in a new tab. Validated by nexus_founder_set_payment_link(): '
  'must be https:// on a host that is exactly ziina.com, pay.ziina.com, or '
  'a subdomain of ziina.com -- this value is shown, unauthenticated in '
  'effect (any signed-in dealer, none of them NEXUS staff), to every '
  'dealership on the platform, so it must never be able to point at a '
  'phishing page. Null until the founder sets it, which nexus_payment_'
  'instructions() and the Subscription screen both treat as "online '
  'payment is being set up", never as an error.';

comment on column public.platform_payment_details.display_name is
  'The name shown next to "NEXUS by ___" on every dealer''s Subscription '
  'screen. Defaults to ''Adqonic''. 1-60 characters, enforced by '
  'nexus_founder_set_payment_link().';

comment on column public.platform_payment_details.account_holder is
  'NX1010: unused. The owner decided a dealer must never see an account '
  'holder name -- payment now runs through payment_link_url. Kept, not '
  'dropped, because the table holds zero rows and nothing reads this '
  'column any more.';

comment on column public.platform_payment_details.bank_name is
  'NX1010: unused. The owner decided a dealer must never see a bank name -- '
  'payment now runs through payment_link_url. Kept, not dropped, because '
  'the table holds zero rows and nothing reads this column any more.';

comment on column public.platform_payment_details.iban is
  'NX1010: unused. The owner decided a dealer must never see an IBAN -- '
  'payment now runs through payment_link_url. Kept, not dropped, because '
  'the table holds zero rows and nothing reads this column any more. '
  'nexus_validate_iban() still exists and still works; nothing calls it '
  'from this migration onward.';

comment on column public.platform_payment_details.swift_bic is
  'NX1010: unused, and the reason this migration exists. '
  'nexus_founder_set_payment_details() made this column mandatory to set, '
  'and the real account behind this platform has no SWIFT code -- the '
  'founder console''s payment form never saved a single row in production '
  'because of it. Kept, not dropped, because the table holds zero rows and '
  'nothing reads this column any more.';

-- No new grants needed on the table itself: RLS already denies anon and
-- authenticated with no policies (NX1008), and the two new columns are
-- exposed only through the SECURITY DEFINER RPCs below, same as every
-- other column on this table.

-- ===========================================================================
-- 2. nexus_founder_set_payment_link(...) -- the founder-only write
-- ===========================================================================
create or replace function public.nexus_founder_set_payment_link(
  p_payment_link_url text,
  p_display_name      text default 'Adqonic'
)
returns public.platform_payment_details
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_row     public.platform_payment_details;
  v_url     text := btrim(coalesce(p_payment_link_url, ''));
  v_name    text := btrim(coalesce(p_display_name, ''));
  v_host    text;
begin
  if not public.nexus_is_platform_admin() then
    raise exception using errcode = 'NX001',
      message = 'Only the NEXUS founder console may set the platform''s payment link.',
      detail  = 'NX_FOUNDER_ONLY',
      hint    = 'Sign in as the platform admin account, or ask them to run this for you.';
  end if;

  if v_url = '' then
    raise exception using errcode = 'NX001',
      message = 'A payment link is required.',
      detail  = 'NX_PAYMENT_LINK_REQUIRED';
  end if;

  if v_name = '' then
    v_name := 'Adqonic';
  end if;
  if length(v_name) > 60 then
    raise exception using errcode = 'NX001',
      message = 'The display name must be 60 characters or fewer.',
      detail  = 'NX_PAYMENT_DISPLAY_NAME_LENGTH';
  end if;

  -- The link is shown to every dealer on the platform, signed in but none of
  -- them NEXUS staff, so it must never be able to point anywhere but Ziina's
  -- own hosted payment pages. https:// only, and the host is extracted with
  -- an anchored character class ([a-zA-Z0-9.-]) that cannot contain an '@',
  -- a space, or any other character that would let a URL like
  -- 'https://ziina.com@evil.example/' or 'https://evil.example/ziina.com'
  -- smuggle a different real host past a naive "contains ziina.com" check.
  if v_url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$' then
    raise exception using errcode = 'NX001',
      message = 'The payment link must be an https:// URL with nothing unusual in the host (no @, no spaces, no credentials).',
      detail  = 'NX_PAYMENT_LINK_SHAPE';
  end if;

  v_host := lower((regexp_match(v_url, '^https://([a-zA-Z0-9.-]+)'))[1]);

  if not (
    v_host = 'ziina.com'
    or v_host = 'pay.ziina.com'
    or right(v_host, 10) = '.ziina.com'
    or v_host = 'ziina.me'
    or right(v_host, 9) = '.ziina.me'
  ) then
    raise exception using errcode = 'NX001',
      message = 'The payment link must be a ziina.com / *.ziina.com or ziina.me / *.ziina.me URL. This link is shown to every dealer, so it can only ever point at Ziina''s own hosted payment pages.',
      detail  = 'NX_PAYMENT_LINK_HOST';
  end if;

  insert into public.platform_payment_details
    (id, payment_link_url, display_name, updated_at, updated_by)
  values
    (1, v_url, v_name, now(), auth.uid())
  on conflict (id) do update set
    payment_link_url = excluded.payment_link_url,
    display_name     = excluded.display_name,
    updated_at        = excluded.updated_at,
    updated_by        = excluded.updated_by
  returning * into v_row;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Founder Console', 'SUCCESS',
          format('Founder set the platform payment link (display name %s)', v_name),
          public.nexus_default_tenant_id());

  return v_row;
end;
$fn$;

comment on function public.nexus_founder_set_payment_link(text, text) is
  'Founder-only upsert of platform_payment_details.payment_link_url and '
  '.display_name. Rejects anything that is not an https:// URL whose host '
  'is exactly ziina.com, pay.ziina.com, or a *.ziina.com subdomain -- this '
  'link is opened by every dealer on the platform, so it must never be '
  'able to point at a phishing page. Writes an audit_log row. Gated on '
  'nexus_is_platform_admin(). Replaces nexus_founder_set_payment_details(), '
  'dropped below: that function made SWIFT mandatory and never saved a row '
  'in production.';

revoke all on function public.nexus_founder_set_payment_link(text, text) from public, anon, authenticated;
grant execute on function public.nexus_founder_set_payment_link(text, text) to authenticated, service_role;

-- ===========================================================================
-- 3. Drop the old founder write -- never saved a row, SWIFT was mandatory
-- ===========================================================================
drop function if exists public.nexus_founder_set_payment_details(text, text, text, text, text, text, text);

-- ===========================================================================
-- 4. nexus_payment_instructions() -- the dealer-facing read, no bank fields
-- ===========================================================================
-- Scoped by nexus_current_tenant_id(), same accessor NX1008 used. Returns
-- zero rows only for a caller with no active membership -- a dealer with a
-- membership always gets exactly one row back, payment_link_url null until
-- the founder sets it, so "no link yet" is data the frontend renders as
-- "being set up", never an error and never a guess drawn from an empty
-- response.
-- The return table changes shape (bank columns removed), which CREATE OR
-- REPLACE cannot do -- Postgres refuses to change a function's return type
-- in place. Drop the NX1008 version first.
drop function if exists public.nexus_payment_instructions();

create or replace function public.nexus_payment_instructions()
returns table (
  display_name     text,
  amount_aed       numeric,
  currency         text,
  payment_link_url text,
  reference        text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_tenant uuid;
  v_slug   text;
  v_row    public.platform_payment_details;
begin
  v_tenant := public.nexus_current_tenant_id();
  if v_tenant is null then
    return;
  end if;

  select t.slug into v_slug from public.tenants t where t.id = v_tenant;
  if v_slug is null then
    return;
  end if;

  select * into v_row from public.platform_payment_details d where d.id = 1;
  -- Not found leaves every field of v_row null (standard SELECT INTO
  -- behaviour on zero rows) -- the coalesce()s below give the same result
  -- whether nobody has ever touched this table or the founder has set a
  -- display name but no link yet.

  return query
  select
    coalesce(v_row.display_name, 'Adqonic'),
    399::numeric,
    coalesce(v_row.currency, 'AED'),
    v_row.payment_link_url,
    replace(replace(coalesce(v_row.reference_format, 'NEXUS-{tenant_slug}-{YYYYMM}'), '{tenant_slug}', v_slug),
            '{YYYYMM}', to_char(now(), 'YYYYMM'));
end;
$fn$;

comment on function public.nexus_payment_instructions() is
  'What the caller''s own dealership sees on its Subscription screen: '
  'display_name (''NEXUS by {display_name}''), a fixed amount_aed of 399, '
  'currency, payment_link_url (the founder''s Ziina hosted payment link, '
  'null until set) and a reference built from platform_payment_details.'
  'reference_format with {tenant_slug} and {YYYYMM} filled in for the '
  'caller''s own tenant. Never returns a bank field -- the return table has '
  'no column for one. Returns zero rows only for a caller with no active '
  'membership; a member always gets one row, with payment_link_url null '
  'read by the frontend as "online payment is being set up", never as an '
  'error. Replaces the NX1008 version, which returned account_holder, '
  'bank_name, iban and swift_bic -- the owner decided (21 Sep 2026, NX1010) '
  'that a dealer must never see any of those.';

revoke all on function public.nexus_payment_instructions() from public, anon, authenticated;
grant execute on function public.nexus_payment_instructions() to authenticated, service_role;
