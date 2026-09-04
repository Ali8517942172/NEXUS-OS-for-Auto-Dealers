-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- An attribution edge is a claim that two records are about the same piece of
-- business. NEXUS may only make that claim when it can say HOW it knows. This
-- table is the closed list of ways an edge may be established, and it is the
-- only place the product is allowed to decide whether a given way counts as
-- evidence.
--
-- The rule that decides this design: A MISSING LINK IS UNKNOWN, NEVER GUESSED.
-- `is_evidence = false` bases exist so that a refusal is recorded and countable,
-- not silently dropped. A refused edge must still be visible - the dealership
-- has to be able to see that the link is missing, and why, or they will never
-- pay for the integration that would supply it.
--
-- Global, not tenant-scoped, for the same reason as
-- inventory_action_reason_codes: this is product vocabulary, identical at every
-- dealership, and it is what makes refusals countable across them. It holds no
-- dealership data. anon is denied by RLS and holds no grant.
--
-- MODEL_TEXT_ONLY and HUMAN_CONFIRMED_LINK are NOT new words. They are already
-- in use by public.action_outcome_candidates() and
-- public.inventory_actions.attribution_basis. This table adopts them rather
-- than inventing a second vocabulary for the same idea.

create table if not exists public.attribution_link_basis (
  basis              text primary key,
  rank               integer not null,
  is_evidence        boolean not null,
  default_confidence text    not null,
  label              text    not null,
  description        text    not null,
  constraint attribution_link_basis_confidence_check
    check (default_confidence in ('HIGH','MEDIUM','LOW','NONE')),
  constraint attribution_link_basis_refusal_has_no_confidence
    check ((is_evidence and default_confidence <> 'NONE')
        or ((not is_evidence) and default_confidence = 'NONE'))
);

comment on table public.attribution_link_basis is
  'Closed list of how an attribution edge was established. is_evidence separates a link NEXUS may reason from (a key, a person''s confirmation) from one it may only display as a refusal (a text coincidence, an empty column, a column that does not exist). A basis with is_evidence = false carries confidence NONE by constraint: nothing is asserted, so no strength can be attached to it.';

comment on column public.attribution_link_basis.rank is
  'Strength order, 1 = strongest. Used to pick between two competing bases for the same edge, never to average them.';
comment on column public.attribution_link_basis.default_confidence is
  'The confidence an edge on this basis carries unless the edge itself records a documented reason to lower it in its own confidence_basis. One figure, one derivation.';

insert into public.attribution_link_basis
  (basis, rank, is_evidence, default_confidence, label, description) values
 ('FOREIGN_KEY', 1, true, 'HIGH', 'Declared foreign key',
  'A FOREIGN KEY constraint enforced by Postgres. The strongest link this database can hold: the value cannot point at a row that is not there. Example: purchase_history.lead_id -> leads(id).'),
 ('HUMAN_CONFIRMED_LINK', 2, true, 'HIGH', 'Confirmed by a named person',
  'A named member of staff at this dealership was shown two records and confirmed they are the same piece of business, and the confirmation is stored against their identity. Strong, but it is a statement of belief by a person and not a fact about the schema. Already in use by inventory_actions.attribution_basis.'),
 ('NATURAL_KEY_MATCH', 3, true, 'HIGH', 'Exact match on a tenant-scoped natural key',
  'Two rows carry byte-identical values in a column pair that this database treats as a business key and scopes per dealership, with no FOREIGN KEY behind it. Example: purchase_history.deal_id = deals_embeddings.deal_id. Strong but unenforced: nothing stops a writer breaking it.'),
 ('RESOLVED_IDENTITY', 4, true, 'MEDIUM', 'Resolved by the identity rule, ambiguity refused',
  'Established by the one identity rule this system owns - v_lead_messages and nexus_lead_for_comm_key in Postgres, lib/identity.js in the browser (INV-002). Exact email, else the last nine digits of a phone but ONLY when that tail belongs to exactly one person, else a bridge through whatsapp_contacts for an @lid handle. A shared tail matches nobody. MEDIUM rather than HIGH because it is a rule applied to text, not a key: it is designed to refuse rather than to be certain.'),
 ('MODEL_TEXT_ONLY', 5, false, 'NONE', 'Text coincidence - REFUSED',
  'Free-text vehicle words on one record overlap free-text vehicle words on another. This is a prompt for a person, never evidence. The live proof is in this database: the one real sale reads "Lexus LX 600 2024" at AED 585,000, which is character-for-character the model of unit NX-1011 and exactly its list price - and NX-1011 is still marked Available. The text matches perfectly and proves nothing. Same word as public.action_outcome_candidates() uses.'),
 ('LINK_FIELD_EMPTY', 6, false, 'NONE', 'The column exists and is empty here',
  'A column that could carry this edge exists on the row and is NULL. UNKNOWN, not none: a NULL lead_id on a sale means nobody recorded which lead it came from, NOT that the sale came from no lead. Nothing downstream may read it as zero.'),
 ('NO_LINK_FIELD', 7, false, 'NONE', 'No column anywhere could carry this edge',
  'The schema has no column on either side that could hold this relationship, so no row-level evidence can exist for it at all. This is a finding about the integration backlog, not about the row.'),
 ('NO_SOURCE_TABLE', 8, false, 'NONE', 'Neither end of this edge exists as data',
  'One or both of the things being linked has no table in this database. Nothing can be linked, counted, or displayed. Sell as roadmap, never as capability.')
on conflict (basis) do nothing;

alter table public.attribution_link_basis enable row level security;

drop policy if exists attribution_link_basis_read on public.attribution_link_basis;
create policy attribution_link_basis_read on public.attribution_link_basis
  for select to authenticated using (true);

drop policy if exists attribution_link_basis_deny_anon on public.attribution_link_basis;
create policy attribution_link_basis_deny_anon on public.attribution_link_basis
  as restrictive for all to anon using (false);

drop policy if exists attribution_link_basis_service_role_all on public.attribution_link_basis;
create policy attribution_link_basis_service_role_all on public.attribution_link_basis
  for all to service_role using (true) with check (true);

-- Supabase default privileges grant arwdDxtm DIRECTLY to anon on every new
-- table in public. REVOKE FROM PUBLIC does not remove a direct grant, so both
-- are revoked. RLS is one lock; the grant is the other.
revoke all on public.attribution_link_basis from anon, public;
revoke all on public.attribution_link_basis from authenticated;
grant select on public.attribution_link_basis to authenticated, service_role;
