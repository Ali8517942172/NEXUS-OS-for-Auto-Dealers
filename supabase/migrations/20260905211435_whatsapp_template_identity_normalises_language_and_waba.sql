-- whatsapp_templates identity duplicated through case. wat_name_shape already
-- forces name = lower(btrim(name)), so the name half was safe; language was not.
-- wat_language_shape permits '^[a-z]{2,3}(_[A-Za-z]{2,4})?$', so en_US and en_us
-- are two different strings for one Meta template and the identity key admitted
-- both. Two rows for one template is two nexus_state values for one thing, and
-- the send path picks whichever it reads first.
--
-- Normalisation belongs in the KEY; the provider's verbatim string stays in the
-- column as the evidence. Same construction as whatsapp_delivery_events.status_key.
-- waba_key also folds NULL to '' so that the identity no longer depends on a
-- COALESCE written inside the index expression.
alter table public.whatsapp_templates
  add column language_key text generated always as (lower(btrim(language))) stored,
  add column waba_key     text generated always as (lower(btrim(coalesce(waba_ref, '')))) stored;

drop index if exists public.whatsapp_templates_identity_key;

create unique index whatsapp_templates_identity_key
  on public.whatsapp_templates (tenant_id, provider, waba_key, name, language_key);

comment on column public.whatsapp_templates.language_key is
  'Generated, unwritable, case-folded language for the identity key. language keeps the provider''s verbatim string.';
comment on column public.whatsapp_templates.waba_key is
  'Generated, unwritable, case-folded waba_ref with NULL folded to the empty string, so one template cannot be minted twice by omitting the WABA.';