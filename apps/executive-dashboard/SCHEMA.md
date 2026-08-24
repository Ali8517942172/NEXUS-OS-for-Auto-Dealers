# Data available to the dashboard (Supabase, PostgREST)

RLS: everything is readable by `authenticated`. Writes are limited — `leads`,
`inventory` and `finance_quotes` are writable from the browser; the rest are
service-role only (n8n writes them).

## Tables

* **leads** — id, name, email, phone, status, ai_score, lead_score,
  vehicle_interest, budget_aed, source, assigned_to_id, created_at, updated_at
* **inventory** — id, stock_id, make, model, year, vin, colour, cost_price_aed,
  list_price_aed, status, acquired_at, sold_at, days_in_stock,
  holding_cost_accrued, net_margin, aging_alert   *(the last four are stored and
  recomputed nightly; the UI recomputes them live via `deriveUnit()` in
  `lib/unit-form.js`)*
* **communication_logs** — id, lead_email, direction ('inbound'|'outbound'),
  message, channel, created_at
* **kyc_documents** — id, lead_email, lead_name, chat_id, document_type,
  full_name, date_of_birth, expiry_date, is_valid, tampering, confidence_score,
  remarks, attempt_number, max_attempts, verdict
  ('APPROVED'|'REJECTED'|'ESCALATED'), reviewed_by, reviewed_at, created_at,
  **storage_path**, **retain_until** (date), **purged_at** (timestamptz)
* **finance_quotes** — lead_email, lead_name, and the quote fields
* **competitors** — competitor rows with prices
* **rag_documents** — the Ask-AI knowledge base
* **audit_log** — workflow, status ('SUCCESS'|'FAILED'|'REJECTED'|'ESCALATED'),
  lead_name, lead_email, lead_score, intent, summary, logged_at
* **users** — id, name, email, role, status (includes 'pending_invite')
* **customer_360_profiles** — customer_id, name, email, phone, total_emails,
  total_slack_messages, last_synced_at
* **purchase_history**, **deals_embeddings** — closed-deal memory
* **workflow_registry** — id, name, audit_name, audit_aliases[], category,
  trigger_type, trigger_detail, description, is_active, writes_audit_log
* **processed_messages** — WAHA idempotency guard (service-role only)

## Views

* **v_workflow_health** — id, name, category, trigger_type, trigger_detail,
  description, is_active, writes_audit_log, runs, failures, escalations,
  success_rate, last_run, **runs_30d**, **failures_30d**, **last_failure**,
  health ('HEALTHY'|'DEGRADED'|'NEVER_RAN'|'NOT_INSTRUMENTED').
  `health` uses a 30-day window; `runs`/`failures` are all-time.
* **v_team_performance**, **v_needs_attention**, **v_customer_360**

## n8n webhooks reachable via `n8n(path, payload)` — see `HOOK` in lib/data.js

`ask-ai`, `finance-calc`, `lead-trigger` (drip), `deals/closed-won`,
`audit-kyc`, `erp-sync`, `lead-escalation`. All verify the caller's Supabase
JWT, which `n8n()` attaches automatically.

**There is no WAHA "send message" webhook yet**, so Conversations cannot send.
**There is no KYC approve/reject webhook yet.** If your screen needs one of
these, build the UI and disable the control with a `title=` explaining what is
missing — do not invent an endpoint and do not write to a service-role table
from the browser (RLS will reject it and the user will see a raw 401).

## KYC documents and Storage — important

Documents live in the private `kyc-documents` bucket. A row where
`purged_at IS NOT NULL` has had its file **deleted on schedule** — never offer to
open it. A row where `storage_path IS NULL AND purged_at IS NULL` is an
**archive failure**, which is a compliance gap worth surfacing. Files must be
read through a short-lived signed URL, never a public URL; there is no browser
helper for that yet, so link-outs stay disabled for now.

---

# ADDENDUM — 24 Aug 2026. Read this before touching conversations or compliance.

Three real production faults were found today and fixed on the backend. The
frontend has to catch up with them.

## 1. The KYC table contains things that were never KYC submissions

Any uncaptioned WhatsApp image was auto-routed to the KYC/AML auditor. Real
people — not customers — sent greeting cards and religious images and received
`[KYC-APPROVED] Document verified for <name>` on WhatsApp. The vision model
described the picture into `document_type`, so the compliance table literally
holds `"Religious Banner"` APPROVED confidence 100 and
`"Good Morning Have a Great Day"` REJECTED confidence 2.

The workflow gate is fixed (KYC now requires a matched lead). The rows are kept
as evidence, not deleted, and marked:

    kyc_documents.void_reason  text         -- non-null = NOT a real submission
    kyc_documents.voided_at    timestamptz

**Every count, rate, verdict list and retention claim on the compliance screen
must exclude `void_reason is not null`.** Nine of the eighteen rows are voided.
Show them, if at all, in a clearly separated "voided — not a submission" section
that explains what happened, and never with Approve / Reject / Re-ask controls:
there is nobody to approve.

## 2. `163188003877036@lid` is not a name

A LID chat id is an opaque WhatsApp handle containing **no phone digits at all**.
The real number (`Info.SenderAlt`) and the contact's own profile name
(`Info.PushName`) are now captured.

    whatsapp_contacts(chat_id PK, phone, push_name, lead_email,
                      first_seen, last_seen, message_count)

and, for the conversations screen, one view that does the resolution for you:

    v_conversations(thread_key, chat_id, phone, push_name, lead_email, lead_name,
                    lead_status, display_name, identified,
                    message_count, inbound_count, outbound_count,
                    last_message_at, last_message, last_direction, awaiting_reply)

`display_name` falls back lead name → WhatsApp profile name → phone → chat id.
`identified` tells you which one you got: `lead` | `whatsapp_profile` |
`phone_only` | `unidentified`.

**Never render `thread_key` or `chat_id` as a person's name.** Use
`display_name`, and use `identified` to be honest — an `unidentified` thread
should look different from one where we know who it is. Show `phone` when there
is one.

Historic contacts have `phone = null` because it was never stored; new inbound
messages fill it in. Render the absence, do not invent one.

## 3. Replying from the dashboard now works

    HOOK.whatsappSend  ->  POST /webhook/whatsapp-send
    body: { chat_id, text }

Guarded by the signed-in user's JWT like every other hook, and it is **not**
fire-and-forget: it answers

    { status: 'sent',  chat_id, sent_at }
    { status: 'error', error: '<why>' }

so the composer can tell the operator whether the message actually left. Send to
`chat_id` from `v_conversations` — that is the address WAHA needs. The outbound
is written to `communication_logs` by the workflow, so refresh the thread after a
successful send rather than optimistically appending.

Failure modes worth handling: no `chat_id` on the thread (older rows keyed on an
email have none — disable the composer and say why), WAHA down (`status:'error'`),
and an expired session (`db()`/`n8n()` already route that to the login screen).

## 4. `v_needs_attention` gained a branch

`unanswered_chat` — a thread whose newest message is inbound, within 7 days.
`ref` is the chat_id, `screen` is `conversations`. This is the item an operator
can act on right now, and it is what the nav badge should be counting.
