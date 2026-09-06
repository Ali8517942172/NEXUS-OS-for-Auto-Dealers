-- Five views ran as their OWNER (postgres), not as the caller, so Row-Level
-- Security on their base tables was evaluated as a BYPASSRLS superuser-ish role
-- and never actually applied. Measured before this migration, with the anon role:
-- v_needs_attention 13, v_workflow_health 18, v_customer_360 2, v_conversations 12,
-- v_lead_messages 47 rows were all readable by an UNAUTHENTICATED caller holding
-- only the public anon key. Three of those views carry customer PII (names,
-- phones, e-mail addresses and message bodies). That is a live data leak, not a
-- theoretical one, and Supabase's linter reports all five at ERROR severity.
--
-- BUSINESS RULE: every view in public is security_invoker. A view is a lens over
-- the base tables, never a way around their RLS. The dashboard authenticates with
-- signInWithPassword and sends the user's JWT on every PostgREST request
-- (apps/executive-dashboard/lib/data.js), so real traffic arrives as
-- `authenticated`, and every base table here grants SELECT to `authenticated`
-- with qual = true. Verified by rehearsal in a rolled-back transaction: with
-- security_invoker on, `authenticated` still returns 13/18/2/12/47 — unchanged.
-- The same rehearsal as `anon` returns 0/0/0/0/0, which is the leak being closed.
--
-- This is the THIRD time the option has been lost. Migration 20260820022441 set it
-- on v_workflow_health; 20260824195539 restored it on v_needs_attention and its
-- comment already names the cause. `create or replace view` WITHOUT a `with
-- (security_invoker = true)` clause silently RESETS reloptions to NULL — verified
-- here on a scratch view. Later bodies were replaced by 20260824201652,
-- 20260901042726, 20260901210749 and 20260901211102, each dropping it again.
-- Any future `create or replace view` on these MUST carry the clause inline.
--
-- Only reloptions change below. No SELECT body is touched.

alter view public.v_conversations   set (security_invoker = true);
alter view public.v_customer_360    set (security_invoker = true);
alter view public.v_lead_messages   set (security_invoker = true);
alter view public.v_needs_attention set (security_invoker = true);
alter view public.v_workflow_health set (security_invoker = true);

-- Restate the requirement where the next person to edit these will actually see
-- it. A comment survives `create or replace view`; the reloption does not.
comment on view public.v_conversations is
$c$One row per person per conversation thread, keyed on person_key, over communication_logs with leads and whatsapp_contacts resolved.

SECURITY: this view MUST be security_invoker = true. It reads communication_logs, leads and whatsapp_contacts, all of which rely on RLS to keep customer PII away from the anon role. Recreating it with `create or replace view` silently drops that option and re-opens the leak, so any replacement MUST spell out `with (security_invoker = true)` inline.$c$;

comment on view public.v_customer_360 is
$c$One row per customer email. message_count and last_contact_at expand the person into every communication_logs key shape they are filed under and exclude [SILENCE-*] markers, which are written because nobody was in touch. lifetime_value_aed is NULL, not 0, when there are no purchases. A lead whose email column is empty is still absent from this view - see the Customers screen, which shows such a person as an unlinked WhatsApp contact.

SECURITY: this view MUST be security_invoker = true. It reads leads, purchase_history, communication_logs, customer_360_profiles and whatsapp_contacts, all of which rely on RLS to keep customer PII away from the anon role. Recreating it with `create or replace view` silently drops that option and re-opens the leak, so any replacement MUST spell out `with (security_invoker = true)` inline.$c$;

comment on view public.v_lead_messages is
$c$communication_logs with the lead resolved. Filter on lead_id instead of guessing key shapes. The phone rule refuses a nine-digit suffix claimed by more than one distinct PERSON - two lead rows under one email address are one person and are not refused. Email matching is case-insensitive and trimmed on every arm. Includes [SILENCE-*] markers; a caller wanting only real messages excludes them itself. A row resolving to no lead is absent, so this view cannot measure how many rows failed to resolve. Mirrors lib/identity.js; a divergence between them is a defect in one of the two.

SECURITY: this view MUST be security_invoker = true. It reads communication_logs, leads and whatsapp_contacts, all of which rely on RLS to keep customer PII away from the anon role. Recreating it with `create or replace view` silently drops that option and re-opens the leak, so any replacement MUST spell out `with (security_invoker = true)` inline.$c$;

comment on view public.v_needs_attention is
$c$The single work queue behind the "Needs attention" surface: unassigned HOT leads, SLA breaches, critical aging inventory, competitor undercuts, workflow failures, KYC archive gaps and unanswered chats.

SECURITY: this view MUST be security_invoker = true. It reads leads, inventory, competitors, audit_log, kyc_documents, workflow_registry and v_conversations. Note the chain - v_conversations must be security_invoker too, or the unanswered_chat branch still reads as the owner. Recreating either with `create or replace view` silently drops that option and re-opens the leak, so any replacement MUST spell out `with (security_invoker = true)` inline.$c$;

comment on view public.v_workflow_health is
$c$Workflow health on canonical outcome semantics (see nexus_outcome_class). DEGRADED on failures OR partials. PRODUCING_NOTHING when over half of qualifying runs yielded no result - this is what an 87% scrape miss rate looks like when it is not hidden behind a rejection label.

SECURITY: this view MUST be security_invoker = true. It reads workflow_registry and audit_log, which rely on RLS to keep internal operational data away from the anon role. Recreating it with `create or replace view` silently drops that option, so any replacement MUST spell out `with (security_invoker = true)` inline.$c$;