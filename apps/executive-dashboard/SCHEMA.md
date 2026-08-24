# Data available to the dashboard (Supabase, PostgREST)

RLS: everything is readable by `authenticated`. Writes are limited — `leads`,
`inventory` and `finance_quotes` are writable from the browser; the rest are
service-role only (n8n writes them).

> **The column lists in this file were re-read off the live database on
> 24 Aug 2026.** They are in the CORRECTION section at the bottom, and that
> section is the authority. The narrative sections below describe what each
> table is *for*; when a column name here disagrees with the CORRECTION, the
> CORRECTION wins. This is not pedantry — PostgREST answers 42703 for an unknown
> column and **rejects the whole query**, so one wrong name blanks an entire
> screen while the render gate reports clean. That has already happened twice.

## Tables — what each one is for

* **leads** — every inbound enquiry. `ai_score` is the router's 1-100 score;
  `assigned_to_id` points at `users`. There is no last-modified timestamp, so
  "when was this lead last touched" has to come from `communication_logs` or
  `escalated_at`.
* **inventory** — the cars. `id` is the human stock number ("NX-1010"), not a
  surrogate key. Money is `price_aed` / `cost_aed`. The ageing figures are
  stored and recomputed nightly, and `lib/unit-form.js` `deriveUnit()` recomputes
  them live in the browser; the two can disagree and that disagreement is worth
  showing. **No sale date is recorded anywhere on this table.**
* **communication_logs** — every message in and out, keyed on `lead_email`.
  Carries no workflow id, so drip mail cannot be told apart from any other
  outbound mail.
* **kyc_documents** — see the KYC section below. `void_reason IS NOT NULL`
  means the row was never a real submission.
* **finance_quotes** — what the finance desk quoted. Stores no term, no monthly
  payment and no validity date; a monthly instalment on screen is modelled by
  the browser and must say so.
* **competitors** — scraped rival prices against ours.
* **rag_documents** — the Ask-AI knowledge base. Carries **no timestamp**, so
  its freshness is not knowable from the data.
* **audit_log** — one row per workflow run that completed. By construction it
  cannot record a run that hung, which is why "healthy" read off this table
  once hid a 26-hour stall.
* **users** — staff. No phone numbers are stored.
* **customer_360_profiles**, **purchase_history**, **deals_embeddings** —
  customer memory. `purchase_history` has no link to an inventory unit.
* **workflow_registry** — the catalogue behind `v_workflow_health`.
* **processed_messages** — the WAHA idempotency guard (service-role only).
* **whatsapp_contacts** — chat_id → real phone and profile name.

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

---

# CORRECTION — 24 Aug 2026, probed live against the database

**Everything in the "Tables" section above was written from memory and several
entries are wrong.** The lists below were read off the live database with
`select=*&limit=1` on the same afternoon. Where the two disagree, this section
is right. A column named here does not exist is not a soft failure: PostgREST
answers 42703 and **the entire query is rejected**, so one invented column name
blanks a whole screen. This is not hypothetical — `team.js` selecting
`leads.lead_score` did exactly that in production while the render gate reported
clean.

    leads                id, name, email, phone, status, ai_score, source,
                         vehicle_interest, budget_aed, assigned_to,
                         assigned_to_id, response_time_minutes, escalated_at,
                         created_at
      NO lead_score. NO updated_at. (`assigned_to` does exist, alongside the id.)

    inventory            id, model, vin, status, acquired_at,
                         cost_aed, price_aed,
                         days_in_stock, holding_cost_accrued,
                         gross_margin, net_margin, vat_amount,
                         aging_alert, ai_recommendation, recommended_commission
      NO stock_id, make, year, colour, sold_at, updated_at.
      NO cost_price_aed / list_price_aed — the real names are cost_aed / price_aed,
      so `lib/unit-form.js` was correct and the doc above was the stale half.
      `id` is the human stock number (e.g. "NX-1010"), which is what
      v_needs_attention puts in `ref`.
      There is no sold date anywhere on this table: "when did we sell it" is
      not answerable from `inventory`. Do not pretend otherwise.

    users                id, name, email, role, status, slack_user_id, created_at
      NO phone. Staff phone numbers are not recorded anywhere the dashboard reads.

    communication_logs   id, lead_email, direction, message, channel, created_at

    competitors          id, competitor, model, our_price_aed, price_aed,
                         price_diff_aed, scraped_at, ai_recommendation

    finance_quotes       id, lead_email, lead_name, vehicle_value_aed,
                         loan_payoff_aed, equity_aed, equity_status,
                         loan_to_value_pct, indicative_apr_pct, finance_tier,
                         credit_score, disclaimer, quoted_by, source, created_at
      NO term, NO monthly payment, NO validity/expiry column. A monthly
      instalment shown on this screen is modelled by the browser, never stored,
      and must say so.

    rag_documents        id, doc_title, source_file, section, page_number,
                         content, search_vector
      NO created_at and no timestamp of any kind — KB freshness is NOT knowable.
      Say that; do not infer it from id ordering.

    purchase_history     id, deal_id, customer_name, email, phone, vehicle,
                         amount_aed, purchase_date, created_at
      Carries its own `phone`, so deals do not need to join leads for it.
      NO inventory reference column — a purchase cannot be tied to a unit.

    deals_embeddings     id, deal_id, content, embedding, created_at
    audit_log            id, workflow, status, lead_name, lead_email,
                         lead_score, intent, summary, logged_at
    kyc_documents        id, lead_email, lead_name, chat_id, document_type,
                         full_name, date_of_birth, expiry_date, is_valid,
                         tampering, confidence_score, remarks, attempt_number,
                         max_attempts, verdict, reviewed_by, reviewed_at,
                         storage_path, retain_until, purged_at,
                         void_reason, voided_at, created_at
    customer_360_profiles id, customer_id, name, email, phone, total_emails,
                         total_slack_messages, last_synced_at
    workflow_registry    id, name, audit_name, audit_aliases, category,
                         trigger_type, trigger_detail, description,
                         is_active, writes_audit_log
    processed_messages   chat_id, message_id, source, processed_at
    whatsapp_contacts    chat_id, phone, push_name, lead_email,
                         first_seen, last_seen, message_count

## Views — full column lists

    v_needs_attention    kind, severity, ref, title, detail, at, screen
    v_workflow_health    id, name, category, trigger_type, trigger_detail,
                         description, is_active, writes_audit_log,
                         runs, failures, escalations, success_rate, last_run,
                         runs_30d, failures_30d, last_failure, health
    v_team_performance   id, name, email, role, status, leads_assigned,
                         hot_leads, pipeline_aed, avg_response_minutes,
                         within_sla, breached_sla
    v_customer_360       name, email, phone, lead_count, best_ai_score,
                         latest_status, is_vip, last_contact_at, message_count,
                         total_emails, total_slack_messages,
                         purchase_count, lifetime_value_aed, last_purchase_date
    v_customer_directory id, name, email, phone, source_records, last_seen_at
    v_conversations      thread_key, chat_id, phone, push_name, lead_email,
                         lead_name, lead_status, display_name, identified,
                         message_count, inbound_count, outbound_count,
                         last_message_at, last_message, last_direction,
                         awaiting_reply

## Severity vocabulary

`v_needs_attention.severity` is `HOT` | `WARM` | `COLD`, and `aging_alert` on
inventory is `CRITICAL` | `WARNING` | `OK`. `TONE` in `lib/format.js` now covers
all of them; a screen no longer needs its own severity→tone map.
