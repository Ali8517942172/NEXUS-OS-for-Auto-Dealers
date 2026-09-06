-- chanroute_02_provider_rank_capability_reader_template_seam
--
-- The multi-provider rule, as data, plus the two readers the router needs.

create table if not exists public.channel_provider_rank (
  provider   text primary key,
  rank       integer not null,
  is_official_platform boolean not null,
  rationale  text not null,
  set_by     text not null,
  created_at timestamptz not null default now(),
  constraint channel_provider_rank_provider_check
    check (provider = any (array['waha','whatsapp_cloud'])),
  constraint channel_provider_rank_rank_range check (rank between 1 and 999)
);

comment on table public.channel_provider_rank is
$c$THE MULTI-PROVIDER RULE. When a dealership has more than one active WhatsApp
integration that is capable of carrying a given message, the one with the LOWEST
rank carries it. Today that means: WhatsApp Cloud API before WAHA, always.

This table has no cost column, no price column and no rate column, and it must
never acquire one. The ordering is NOT an economic ordering - the Cloud API is
the provider that charges per conversation and WAHA is the one that does not, so
a cost-ranked table would produce exactly the opposite order to this one. The
ordering is by whether the transport is the one the platform sanctions for
business messaging: the Cloud API is the surface that carries template review,
delivery receipts, a signed webhook, and an opt-out the platform itself honours.
WAHA drives a WhatsApp client on the dealership own number. Routing business
traffic onto it to avoid the Cloud API charge is not an optimisation; it is a
policy bypass, and the cost of it is the dealership number being banned - which
takes the sales floor own line off the air, not a line NEXUS owns.

WAHA is therefore used only where it is the dealership ONLY active capable
integration - that is, before they are onboarded onto the Cloud API - or where
the customer own conversation is already on it (rule C1 in nexus_route_message).$c$;

insert into public.channel_provider_rank (provider,rank,is_official_platform,rationale,set_by) values
  ('whatsapp_cloud',10,true,
   'The official WhatsApp Business Platform. Template approval, signed webhooks, delivery receipts and platform-honoured opt-out all exist only here. It is also the provider that costs money, which is why it is ranked first and not last: this ordering is deliberately not an economic one.',
   'chanroute_02'),
  ('waha',90,false,
   'An unofficial transport driving a WhatsApp client on the dealership own number. Adequate for replying inside a conversation the customer started; never the right carrier for business-initiated traffic when an official integration exists, because that use is what gets a number banned.',
   'chanroute_02')
on conflict (provider) do nothing;

alter table public.channel_provider_rank enable row level security;
drop policy if exists channel_provider_rank_service_role on public.channel_provider_rank;
create policy channel_provider_rank_service_role on public.channel_provider_rank
  for all to service_role using (true) with check (true);
revoke all on public.channel_provider_rank from anon, authenticated, public;
grant select, insert, update, delete on public.channel_provider_rank to service_role;


-- ---------------------------------------------------------------------------
-- Capability reader. The whole point of this function is that it ALWAYS
-- returns exactly one row, including for a (provider, send_form) pair nobody
-- has ever recorded - and that row says NOT_SUPPORTED.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_channel_capability_state(
  p_provider  text,
  p_send_form text
) returns table (
  provider      text,
  send_form     text,
  support_state text,
  basis         text,
  evidence      text,
  verified_at   timestamptz
)
language sql
stable
set search_path to 'public','pg_catalog'
as $fn$
  select coalesce(c.provider,  lower(btrim(coalesce(p_provider,'')))),
         coalesce(c.send_form, upper(btrim(coalesce(p_send_form,'')))),
         coalesce(c.support_state, 'NOT_SUPPORTED'),
         coalesce(c.basis, 'CAPABILITY_NOT_ON_FILE'),
         coalesce(c.evidence,
           'No row in channel_provider_capability states that this provider can carry this send form. Absence is read as cannot-carry. It is never read as "try it and see": an untested send against a live customer number is how a dealership finds out it cannot, and it finds out by being rate-limited or banned.'),
         c.verified_at
    from (select 1) s
    left join public.channel_provider_capability c
      on c.provider  = lower(btrim(coalesce(p_provider,'')))
     and c.send_form = upper(btrim(coalesce(p_send_form,'')));
$fn$;

comment on function public.nexus_channel_capability_state(text,text) is
  'Single-row capability lookup that is total over its input domain. A missing row resolves to NOT_SUPPORTED with basis CAPABILITY_NOT_ON_FILE. Callers must treat anything other than support_state = SUPPORTED as cannot-carry.';


-- ---------------------------------------------------------------------------
-- Template-reference seam.
--
-- A sibling agent is building public.whatsapp_templates. This function is the
-- SINGLE point that has to be rewritten when it lands; nothing else in the
-- router touches a template registry. Until then it reports honestly that the
-- reference the caller supplied is unverified, and the router carries that
-- state through to n8n rather than implying the template is approved.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_verify_template_ref(
  p_tenant_id        uuid,
  p_provider         text,
  p_template_ref     text,
  p_required_category text
) returns table (
  verification text,
  detail       text
)
language plpgsql
stable
set search_path to 'public','pg_catalog'
as $fn$
begin
  if coalesce(btrim(coalesce(p_template_ref,'')),'') = '' then
    return query select
      'NO_TEMPLATE_REF'::text,
      'No template reference was supplied, so there is nothing to verify.'::text;
    return;
  end if;

  if to_regclass('public.whatsapp_templates') is null then
    return query select
      'UNVERIFIED_NO_TEMPLATE_REGISTRY'::text,
      format('public.whatsapp_templates does not exist on this deployment, so NEXUS cannot confirm that %L is an approved template of category %s on this dealership account. The reference is passed through to the sending workflow as the caller supplied it, and this row is the record that nobody checked it. Rewrite this function when the template registry lands; it is the only place that needs to change.',
             btrim(p_template_ref), coalesce(nullif(btrim(coalesce(p_required_category,'')),''),'(unspecified)'))::text;
    return;
  end if;

  return query select
    'UNVERIFIED_REGISTRY_PRESENT_NOT_WIRED'::text,
    format('public.whatsapp_templates now exists but nexus_verify_template_ref has not been wired to it, so %L is still unverified. This is a deliberate refusal to guess another component schema. Rewrite this function body against the real columns.',
           btrim(p_template_ref))::text;
end;
$fn$;

comment on function public.nexus_verify_template_ref(uuid,text,text,text) is
  'The one seam between the provider router and the WhatsApp template registry. Returns a verification state, never a boolean, so that "not verified" can never be read as "not approved" or as "approved". It resolves the registry with to_regclass at call time, so the absence of whatsapp_templates does not block the router and its arrival does not break it.';

revoke all on function public.nexus_channel_capability_state(text,text) from anon, authenticated, public;
revoke all on function public.nexus_verify_template_ref(uuid,text,text,text) from anon, authenticated, public;
grant execute on function public.nexus_channel_capability_state(text,text) to service_role;
grant execute on function public.nexus_verify_template_ref(uuid,text,text,text) to service_role;