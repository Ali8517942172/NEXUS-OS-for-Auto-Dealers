-- ── 1. Void the KYC rows that were never KYC submissions ──────────────────
--
-- Any WhatsApp image with no caption was routed straight to the KYC/AML auditor.
-- Nine rows are the result: people on the owner's personal WhatsApp who sent a
-- greeting card, a religious banner or a prayer image, and got a compliance
-- verdict for it. The vision model described the picture into document_type, so
-- the compliance table literally contains
--
--     "Religious Banner"              APPROVED  confidence 100
--     "Sikh religious text / prayer"  APPROVED  confidence 100
--     "Good Morning Have a Great Day" REJECTED  confidence 2
--
-- These must not be counted as compliance decisions. They are also not deleted:
-- a compliance table that quietly loses rows is worse than one that carries an
-- explained void, and this is the evidence of what the system did to real people.
--
-- Every one of them has lead_email NULL, because the sender was never a lead —
-- nobody ever asked these people for a document. That is exactly the condition
-- the new gate on `Is Document?` now enforces upstream.
alter table public.kyc_documents
  add column if not exists void_reason text,
  add column if not exists voided_at   timestamptz;

comment on column public.kyc_documents.void_reason is
  'Set when a row is not a genuine KYC submission. Non-null means: exclude from every compliance count, verdict list and retention claim. The row is kept as evidence, never as a decision.';

update public.kyc_documents
set void_reason = 'Not a KYC submission: an uncaptioned WhatsApp image from a sender who was never a lead was auto-routed to the auditor. No document was ever requested from this person.',
    voided_at   = now()
where lead_email is null
  and void_reason is null;

create index if not exists idx_kyc_documents_void
  on public.kyc_documents (voided_at)
  where void_reason is not null;

-- ── 2. A real WhatsApp contact directory ──────────────────────────────────
--
-- The UI shows "163188003877036@lid" because that is all we store. A LID chat id
-- is an opaque handle: it contains no phone number at all. The real number
-- arrives separately in the webhook as _data.Info.SenderAlt, and the contact's
-- own WhatsApp profile name as _data.Info.PushName. Both were being extracted by
-- the BDC and then thrown away.
--
-- Keyed on chat_id because that is what every reply must be addressed to.
create table if not exists public.whatsapp_contacts (
  chat_id     text primary key,
  phone       text,
  push_name   text,
  lead_email  text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  message_count integer not null default 0
);

comment on table public.whatsapp_contacts is
  'One row per WhatsApp chat. chat_id is the address to reply to (often a @lid handle with no digits in it); phone is the real number from Info.SenderAlt and push_name is the contact''s own WhatsApp profile name from Info.PushName. The conversations screen shows phone and push_name, never the raw chat id.';

create index if not exists idx_whatsapp_contacts_phone on public.whatsapp_contacts (phone);
create index if not exists idx_whatsapp_contacts_lead  on public.whatsapp_contacts (lead_email);

alter table public.whatsapp_contacts enable row level security;

create policy whatsapp_contacts_authenticated_read
  on public.whatsapp_contacts for select to authenticated using (true);
create policy whatsapp_contacts_service_role_all
  on public.whatsapp_contacts for all to service_role using (true) with check (true);