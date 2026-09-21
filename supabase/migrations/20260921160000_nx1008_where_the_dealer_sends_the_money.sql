-- NEXUS OS — NX1008: where the dealer sends the money
--
-- ORIGINAL DEFECT. apps/executive-dashboard/screens/subscription.js shipped
-- with `BANK_DETAILS`, a hard-coded object holding four literal strings --
-- '[ALI — FILL IN: bank name]', '[ALI — FILL IN: account / IBAN number]',
-- and so on -- with a comment telling Ali to edit them directly in the file
-- and redeploy. Two things are wrong with that, not one:
--
--   1. The moment Ali actually filled those placeholders in with NEXUS's
--      real bank account, they would ship inside apps/executive-dashboard's
--      public JS bundle -- readable by anyone who opens the browser's
--      network tab on the login screen, signed in or not, because a static
--      literal in a frontend file is not access-controlled by anything.
--   2. The instruction to "edit BANK_DETAILS ... and redeploy" makes every
--      correction to the account number a code change and a deploy, for
--      four lines of data that change only when NEXUS switches banks.
--
-- This migration is the database half of the fix: one single-row table,
-- guarded by RLS with no policies (the same shape platform_admin uses in
-- NX1003 -- a table that answers neither anon nor authenticated directly),
-- and two RPCs. Nothing in this migration, in the frontend change that
-- follows it, or in this report carries a real account number, IBAN or
-- account holder name -- Ali types those into the founder console himself,
-- once this ships, over an authenticated session the anon key never sees.
--
-- WHAT THIS MIGRATION DOES
-- -------------------------
--   1. public.platform_payment_details -- a single row (id=1, enforced by a
--      CHECK, the same pin-to-one-row trick this codebase already uses for
--      "there is exactly one of these" tables). RLS on, no policies: read
--      and write both go through SECURITY DEFINER RPCs, never direct
--      PostgREST access to the table.
--   2. public.nexus_validate_iban(text) -- server-side IBAN shape and
--      checksum validation (ISO 13616 mod-97), so a founder-console typo
--      is caught before it becomes the string a dealer wires money against.
--      STRICT on AE (UAE) IBANs: exactly 23 characters, because that is the
--      one country this dealership actually banks in and a wrong-length AE
--      IBAN is a wrong account, not a formatting quirk.
--   3. public.nexus_founder_set_payment_details(...) -- gated on
--      nexus_is_platform_admin() exactly like every nexus_founder_* function
--      in NX1004, upserts the single row, and writes an audit_log row that
--      records THAT the details changed and the last 4 characters of the
--      IBAN only -- never the full number, in the audit trail or anywhere
--      else this migration writes to.
--   4. public.nexus_payment_instructions() -- an authenticated read for any
--      dealer member (scoped by nexus_current_tenant_id(), same accessor
--      NX1003's nexus_my_subscription() and the rest of this codebase use
--      for "the caller's own dealership"), returning the holder, bank,
--      IBAN, SWIFT, currency and the caller's OWN dealership's reference,
--      built from reference_format with {tenant_slug} and {YYYYMM}
--      substituted server-side. Returns zero rows if nobody has filled the
--      details in yet or if the caller has no active dealership membership
--      -- the frontend's job, not this function's, to turn that into
--      "contact NEXUS".
--
-- WHY REVOKE-THEN-GRANT, NAMING public EXPLICITLY, ON EVERY FUNCTION
-- --------------------------------------------------------------------
-- ops/ci/function-grants.mjs (see its own header) exists because a bare
-- `revoke ... from anon, authenticated` does not touch the separate PUBLIC
-- grant a function is born with, and Supabase's default privileges hand
-- anon a grant of its own that a revoke naming only `public` does not
-- reach either. Every function below revokes all three names in one
-- statement before granting anything back, so this migration cannot repeat
-- either half of that history.
-- ===========================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. platform_payment_details — the single row, nobody's default read
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.platform_payment_details (
  id               smallint primary key default 1,
  account_holder   text,
  bank_name        text,
  iban             text,
  swift_bic        text,
  currency         text not null default 'AED',
  reference_format text not null default 'NEXUS-{tenant_slug}-{YYYYMM}',
  notes            text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint platform_payment_details_single_row check (id = 1)
);

comment on table public.platform_payment_details is
  'NEXUS''s own bank account, where a dealer sends its AED 399/month by '
  'transfer. Exactly one row (id=1, enforced by a CHECK). RLS is enabled '
  'with no policies for anon or authenticated -- like platform_admin in '
  'NX1003, a table with RLS on and no permissive policy denies both roles '
  'by default, and every read or write goes through a SECURITY DEFINER RPC '
  '(nexus_payment_instructions for dealers, nexus_founder_set_payment_'
  'details for the founder) instead of direct PostgREST access to this '
  'table. Never queried directly by the frontend -- if you find code doing '
  'that, it is a bug: this table holds the one thing in this schema that '
  'must never reach an unauthenticated bundle.';

comment on column public.platform_payment_details.iban is
  'Stored stripped of spaces and upper-cased, exactly as '
  'nexus_founder_set_payment_details() writes it after validating it with '
  'nexus_validate_iban(). Never selected by anon or authenticated directly '
  '-- nexus_payment_instructions() is the only reader available to a '
  'dealer, and it is SECURITY DEFINER, not a grant on this table.';

comment on column public.platform_payment_details.reference_format is
  'A template nexus_payment_instructions() fills in per caller: {tenant_slug} '
  'becomes the caller''s own dealership slug, {YYYYMM} becomes the current '
  'year and month. Default matches this migration''s own example: '
  '''NEXUS-alba-cars-202610''.';

alter table public.platform_payment_details enable row level security;
-- Deliberately no policies for anon/authenticated -- see the table comment.
-- Only service_role (bypasses RLS) and the two SECURITY DEFINER functions
-- below (which run as the table owner) can ever touch this table.

revoke all on public.platform_payment_details from public, anon, authenticated;
grant all on public.platform_payment_details to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. nexus_validate_iban(text) — ISO 13616 mod-97, server-side
-- ═══════════════════════════════════════════════════════════════════════════
-- Returns the normalised (stripped-of-spaces, upper-cased) IBAN on success
-- and RAISES on anything invalid, rather than returning a boolean, so every
-- caller gets the same clear message instead of independently re-deriving
-- "that is not valid" prose from a false.
create or replace function public.nexus_validate_iban(p_iban text)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_clean   text;
  v_country text;
  v_rearr   text;
  v_digits  text;
  v_ch      text;
  v_rem     numeric := 0;
  v_i       int;
begin
  if p_iban is null or btrim(p_iban) = '' then
    raise exception using errcode = 'NX001',
      message = 'An IBAN is required.',
      detail  = 'NX_IBAN_EMPTY';
  end if;

  -- Strip every space, then upper-case. A dealer's bank prints IBANs with
  -- spaces every four characters; the stored and validated form never has
  -- them, so a copy-pasted "AE07 0331 ..." and a typed "AE070331..." are
  -- the same input to this function.
  v_clean := upper(regexp_replace(p_iban, '\s+', '', 'g'));

  if length(v_clean) < 15 or length(v_clean) > 34 then
    raise exception using errcode = 'NX001',
      message = format('An IBAN is 15 to 34 characters; this one is %s.', length(v_clean)),
      detail  = 'NX_IBAN_LENGTH';
  end if;

  if v_clean !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]+$' then
    raise exception using errcode = 'NX001',
      message = 'That does not have the shape of an IBAN: two letters, two check digits, then the account.',
      detail  = 'NX_IBAN_SHAPE';
  end if;

  v_country := left(v_clean, 2);

  -- The one country this dealership actually banks in gets an exact-length
  -- rule on top of the generic 15-34 range: a UAE IBAN is always 23
  -- characters, and a 21- or 25-character "AE..." string is not a shorter
  -- or longer valid account, it is a mistyped one.
  if v_country = 'AE' and length(v_clean) <> 23 then
    raise exception using errcode = 'NX001',
      message = format('A UAE IBAN is exactly 23 characters; this one is %s.', length(v_clean)),
      detail  = 'NX_IBAN_AE_LENGTH';
  end if;

  -- ISO 13616 mod-97: move the first four characters to the end, convert
  -- every letter to two digits (A=10 .. Z=35), then take the whole numeric
  -- string mod 97. Valid IFF the remainder is 1. Done digit-by-digit with
  -- Horner's rule so this never builds a numeric literal longer than
  -- Postgres's own numeric type can hold (a 34-character IBAN with every
  -- character a letter expands to 68 decimal digits).
  v_rearr := substr(v_clean, 5) || substr(v_clean, 1, 4);
  v_digits := '';
  for v_i in 1 .. length(v_rearr) loop
    v_ch := substr(v_rearr, v_i, 1);
    if v_ch ~ '[0-9]' then
      v_digits := v_digits || v_ch;
    else
      v_digits := v_digits || (ascii(v_ch) - ascii('A') + 10)::text;
    end if;
  end loop;

  v_rem := 0;
  for v_i in 1 .. length(v_digits) loop
    v_rem := (v_rem * 10 + substr(v_digits, v_i, 1)::numeric) % 97;
  end loop;

  if v_rem <> 1 then
    raise exception using errcode = 'NX001',
      message = 'That IBAN fails its own checksum -- it is not a valid IBAN as typed. Check it against the bank statement, character by character.',
      detail  = 'NX_IBAN_CHECKSUM';
  end if;

  return v_clean;
end;
$fn$;

comment on function public.nexus_validate_iban(text) is
  'Strips spaces, upper-cases, checks length (15-34, exactly 23 for AE) and '
  'the ISO 13616 mod-97 checksum. Returns the normalised IBAN on success, '
  'raises NX_IBAN_* on failure. Used by nexus_founder_set_payment_details() '
  'so an invalid IBAN never reaches platform_payment_details; also callable '
  'directly to mirror the same rule in the browser before submit.';

revoke all on function public.nexus_validate_iban(text) from public, anon, authenticated;
grant execute on function public.nexus_validate_iban(text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. nexus_founder_set_payment_details(...) — the founder-only write
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.nexus_founder_set_payment_details(
  p_account_holder   text,
  p_bank_name        text,
  p_iban             text,
  p_swift_bic        text,
  p_currency         text default 'AED',
  p_reference_format text default 'NEXUS-{tenant_slug}-{YYYYMM}',
  p_notes            text default null
)
returns public.platform_payment_details
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_row       public.platform_payment_details;
  v_iban_norm text;
  v_holder    text := btrim(coalesce(p_account_holder, ''));
  v_bank      text := btrim(coalesce(p_bank_name, ''));
  v_swift     text := upper(btrim(coalesce(p_swift_bic, '')));
  v_currency  text := upper(btrim(coalesce(p_currency, 'AED')));
  v_ref_fmt   text := btrim(coalesce(p_reference_format, 'NEXUS-{tenant_slug}-{YYYYMM}'));
begin
  if not public.nexus_is_platform_admin() then
    raise exception using errcode = 'NX001',
      message = 'Only the NEXUS founder console may set the platform''s payment details.',
      detail  = 'NX_FOUNDER_ONLY',
      hint    = 'Sign in as the platform admin account, or ask them to run this for you.';
  end if;

  if v_holder = '' then
    raise exception using errcode = 'NX001',
      message = 'An account holder name is required.',
      detail  = 'NX_PAYMENT_HOLDER_REQUIRED';
  end if;
  if v_bank = '' then
    raise exception using errcode = 'NX001',
      message = 'A bank name is required.',
      detail  = 'NX_PAYMENT_BANK_REQUIRED';
  end if;
  if v_swift = '' then
    raise exception using errcode = 'NX001',
      message = 'A SWIFT/BIC code is required.',
      detail  = 'NX_PAYMENT_SWIFT_REQUIRED';
  end if;
  if v_ref_fmt = '' or v_ref_fmt !~ '\{tenant_slug\}' then
    raise exception using errcode = 'NX001',
      message = 'The reference format must contain {tenant_slug}, so every dealership gets a reference that identifies it.',
      detail  = 'NX_PAYMENT_REFERENCE_FORMAT';
  end if;

  -- Raises NX_IBAN_* on anything invalid; nothing below this line runs
  -- with an unvalidated IBAN.
  v_iban_norm := public.nexus_validate_iban(p_iban);

  insert into public.platform_payment_details
    (id, account_holder, bank_name, iban, swift_bic, currency, reference_format, notes, updated_at, updated_by)
  values
    (1, v_holder, v_bank, v_iban_norm, v_swift, v_currency, v_ref_fmt, nullif(btrim(coalesce(p_notes, '')), ''), now(), auth.uid())
  on conflict (id) do update set
    account_holder   = excluded.account_holder,
    bank_name        = excluded.bank_name,
    iban             = excluded.iban,
    swift_bic        = excluded.swift_bic,
    currency         = excluded.currency,
    reference_format = excluded.reference_format,
    notes            = excluded.notes,
    updated_at       = excluded.updated_at,
    updated_by       = excluded.updated_by
  returning * into v_row;

  -- The audit trail records THAT the details changed and the last 4
  -- characters of the IBAN only -- never the full number, here or anywhere
  -- else in this schema. That is enough to confirm a change happened and
  -- to eyeball-match it against a bank statement's last four digits without
  -- ever putting the full account number in a table more roles can read
  -- than can read platform_payment_details itself.
  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Founder Console', 'SUCCESS',
          format('Founder set the platform payment details (bank %s, IBAN ending %s)',
                 v_bank, right(v_iban_norm, 4)),
          public.nexus_default_tenant_id());

  return v_row;
end;
$fn$;

comment on function public.nexus_founder_set_payment_details(text, text, text, text, text, text, text) is
  'Founder-only upsert of the single platform_payment_details row. Validates '
  'the IBAN with nexus_validate_iban() before writing it -- an invalid IBAN '
  'never reaches the table. Writes an audit_log row recording that the '
  'details changed and the IBAN''s last 4 characters only, never the full '
  'number. Gated on nexus_is_platform_admin().';

revoke all on function public.nexus_founder_set_payment_details(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.nexus_founder_set_payment_details(text, text, text, text, text, text, text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. nexus_payment_instructions() — the dealer-facing read
-- ═══════════════════════════════════════════════════════════════════════════
-- Scoped by nexus_current_tenant_id() -- the same single-tenant accessor
-- NX1003's nexus_founder_mark_paid() reasons about and this codebase uses
-- everywhere a dealer-facing screen needs "the caller's own dealership".
-- Returns zero rows, not an error, for a caller with no active membership
-- or when nobody has filled the details in yet -- both are ordinary "not
-- ready" states the frontend already distinguishes with a plain message,
-- not authorisation failures worth raising over.
create or replace function public.nexus_payment_instructions()
returns table (
  account_holder text,
  bank_name      text,
  iban           text,
  swift_bic      text,
  currency       text,
  reference      text
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
  if not found or v_row.iban is null or btrim(v_row.iban) = '' then
    -- Nobody has filled the details in yet. Zero rows, not an error -- the
    -- frontend shows "Payment details are being set up -- contact NEXUS"
    -- for exactly this shape.
    return;
  end if;

  return query
  select
    v_row.account_holder,
    v_row.bank_name,
    v_row.iban,
    v_row.swift_bic,
    v_row.currency,
    replace(replace(v_row.reference_format, '{tenant_slug}', v_slug),
            '{YYYYMM}', to_char(now(), 'YYYYMM'));
end;
$fn$;

comment on function public.nexus_payment_instructions() is
  'What the caller''s own dealership sends its AED 399/month to: holder, '
  'bank, IBAN, SWIFT and a reference built from platform_payment_details.'
  'reference_format with {tenant_slug} and {YYYYMM} filled in for the '
  'caller''s own tenant. Returns zero rows for a caller with no active '
  'membership, or before the founder has ever filled the details in -- both '
  'read the same as "nothing yet" to the frontend, never as an error.';

revoke all on function public.nexus_payment_instructions() from public, anon, authenticated;
grant execute on function public.nexus_payment_instructions() to authenticated, service_role;
