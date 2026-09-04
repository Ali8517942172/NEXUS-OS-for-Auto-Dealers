-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- "The column is empty" and "the column has a value that resolves to nobody"
-- are different failures and need different answers from a human. The first is
-- a missing write; the second is an identity the dealership has never told us
-- about. Collapsing them would hide 55 of the 108 rows in communication_logs
-- behind a word that does not describe them.
--
-- Ranks are the strength ORDER used to pick between two competing bases for one
-- edge. Inserting UNRESOLVED_KEY between MODEL_TEXT_ONLY and LINK_FIELD_EMPTY
-- shifts the three weakest refusals down by one. Safe: this table was created
-- minutes ago in attr_01 and has no consumer outside this migration set.

update public.attribution_link_basis set rank = 9 where basis = 'NO_SOURCE_TABLE';
update public.attribution_link_basis set rank = 8 where basis = 'NO_LINK_FIELD';
update public.attribution_link_basis set rank = 7 where basis = 'LINK_FIELD_EMPTY';

insert into public.attribution_link_basis
  (basis, rank, is_evidence, default_confidence, label, description) values
 ('UNRESOLVED_KEY', 6, false, 'NONE', 'Key present, resolves to nobody - REFUSED',
  'The record carries a key for the other end of the edge, but the identity rule (INV-002) resolves it to nobody: either no lead matches it, or more than one does and the rule refuses to choose. UNKNOWN, not none. A WhatsApp @lid handle with no whatsapp_contacts bridge is the common case here - 55 of 108 communication_logs rows on 3 Sep 2026.')
on conflict (basis) do nothing;
