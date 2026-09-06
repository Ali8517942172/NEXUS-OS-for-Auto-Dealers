-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_id NOT NULL on five of the six remaining nullable tenant-scoped tables.
--
-- WHY A NULL MATTERS
--   Every tenant-scoped RLS policy compares tenant_id against the caller's
--   tenant. NULL never equals anything, so a null-tenant row is invisible to
--   every signed-in user of every dealership. It fails closed rather than
--   leaking — the safe direction — but it is still a row nobody can see, and on
--   a table whose uniqueness is UNIQUE(tenant_id, key) a NULL also silently
--   defeats that uniqueness, because NULLs do not collide.
--
-- WHY IT IS SAFE ON THESE FIVE, AND MEASURED RATHER THAN ASSUMED
--   All six columns default to nexus_default_tenant_id(), which is non-null
--   while any active tenant carries is_unattributed_default. A default only
--   fires when the column is OMITTED from the INSERT; a caller that NAMES the
--   column and sends null writes a null.
--
--   So the question is not "does a null exist" (none does — audit_log 602 rows,
--   communication_logs 108, competitors 11, finance_quotes 0, kyc_documents 3,
--   rag_documents 15, all with zero nulls) but "can a live writer still name
--   the column and send null". That was read from pg_stat_statements, whose
--   statistics have not been reset since 2026-07-11, so the record is complete:
--
--     audit_log       664 PostgREST inserts across 6 statement shapes, the
--                     newest first seen 2026-09-02 08:44. NOT ONE names
--                     tenant_id.
--     competitors      10 PostgREST inserts across 3 shapes. None names it.
--     finance_quotes    7 PostgREST inserts across 2 shapes. None names it.
--     kyc_documents    29 PostgREST inserts across 8 shapes, newest
--                     2026-09-02 07:25. None names it.
--     rag_documents     no PostgREST writer at all; seeded by hand.
--
--   No database function or trigger inserts into any of the five either
--   (checked against pg_proc.prosrc across the whole public schema).
--
--   Therefore on these five the default is the only thing that has ever
--   supplied tenant_id, and the default cannot produce NULL while ALBA CARS is
--   active and flagged. NOT NULL rejects nothing that exists and nothing the
--   live path sends.
--
-- WHAT THIS GUARD IS ACTUALLY FOR
--   It is not protecting against today. Today a null is unreachable on these
--   tables. It is protecting against the moment n8n is taught to send tenant_id
--   here the way it was already taught to send it on communication_logs,
--   processed_messages and whatsapp_contacts: from that moment the column IS
--   named, and an expression that resolves to empty writes an invisible row.
--   This turns that into a loud rejection instead.
--
-- communication_logs IS DELIBERATELY NOT INCLUDED — see the next comment.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.audit_log      alter column tenant_id set not null;
alter table public.competitors    alter column tenant_id set not null;
alter table public.finance_quotes alter column tenant_id set not null;
alter table public.kyc_documents  alter column tenant_id set not null;
alter table public.rag_documents  alter column tenant_id set not null;

comment on column public.communication_logs.tenant_id is
  'NULLABLE ON PURPOSE, as of 2026-09-02, and it is the last of the original 15 tenant-scoped tables still to be pinned. Unlike audit_log, competitors, finance_quotes, kyc_documents and rag_documents — where no writer has ever named this column, so the non-null default is the only source and NOT NULL was applied — communication_logs acquired a live PostgREST writer that DOES name it: a shape carrying ("channel","direction","lead_email","message","sent_by","tenant_id") first executed 2026-09-02 10:27:36 UTC, alongside the matching tenant-aware shapes on processed_messages and whatsapp_contacts. That writer is an n8n workflow. Whether its tenant_id expression can resolve to empty on any branch cannot be established from the database, and this session was not permitted to read the n8n instance. If it can, SET NOT NULL converts a silently invisible message log into a failed insert on the live WhatsApp path — a customer-visible outage on the one journey that is demoable today. WHAT MUST CHANGE FIRST: confirm in the PUBLISHED workflow that every branch reaching this insert supplies a non-empty tenant_id (no optional expression, no branch that omits it), then apply: alter table public.communication_logs alter column tenant_id set not null;';