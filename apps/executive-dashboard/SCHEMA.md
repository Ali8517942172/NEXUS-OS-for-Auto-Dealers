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

~~There is no WAHA "send message" webhook yet~~ — **superseded 24 Aug**:
`HOOK.whatsappSend` exists and Conversations sends through it. See ADDENDUM §3.
**There is still no KYC approve/reject webhook.** If your screen needs an action
with no hook, build the UI and disable the control with a `title=` explaining
what is missing — do not invent an endpoint and do not write to a service-role table
from the browser (RLS will reject it and the user will see a raw 401).

## KYC documents and Storage — important

Documents live in the private `kyc-documents` bucket. A row where
`purged_at IS NOT NULL` has had its file **deleted on schedule** — never offer to
open it. A row where `storage_path IS NULL AND purged_at IS NULL` is an
**archive failure**, which is a compliance gap worth surfacing. Files must be
read through a short-lived signed URL, never a public URL. ~~there is no browser
helper for that yet~~ — **superseded 24 Aug**: `signedUrl(path)` in
`lib/data.js` mints a 60-second URL against the private bucket, backed by the
two Storage RLS policies. Link-outs work; the only rows without one are those
where `storage_path` is null or `purged_at` is set.

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

~~Historic contacts have `phone = null`~~ — **superseded 24 Aug**: all 13
unresolved handles were backfilled through WAHA's per-LID lookup
(`/api/default/lids/{lid}` → `{lid, pn}`; the bulk `/lids` enumeration times out
because the account holds 6,176 of them). Every `whatsapp_contacts` row now
carries a number and no thread renders a handle as a name. Keep the
absence-rendering paths — a brand-new contact can still arrive without one —
but they are the exception now, not the normal case.

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
    daily_metrics        snapshot_date, open_leads, hot_leads, warm_leads,
                         cold_leads, avg_response_minutes, pipeline_aed,
                         units_at_risk, holding_cost_aed, workflow_runs,
                         workflow_failures, captured_at
      One row per day, written by a nightly snapshot. NO id and NO created_at —
      the timestamp is `captured_at`. This is the only table that can answer
      "compared to yesterday", because nothing else stores history.

    v_conversations      thread_key, chat_id, phone, push_name, lead_email,
                         lead_name, lead_status, display_name, identified,
                         message_count, inbound_count, outbound_count,
                         last_message_at, last_message, last_direction,
                         awaiting_reply

## Severity vocabulary

`v_needs_attention.severity` is `HOT` | `WARM` | `COLD`.

`inventory.aging_alert` is **`HEALTHY` | `WARNING` | `CRITICAL`** — counted live
on 24 Aug as 9 / 2 / 1. An earlier version of this section said `OK` instead of
`HEALTHY`, which was wrong and would have made `lib/unit-form.js` — which writes
`HEALTHY`, correctly — look like a bug. `TONE` in `lib/format.js` covers both
spellings, so nothing renders wrong either way, but `HEALTHY` is what the
database actually holds and what the nightly recompute writes.

`v_workflow_health.health` is `HEALTHY` | `DEGRADED` | `NEVER_RAN` |
`NOT_INSTRUMENTED`. `NOT_INSTRUMENTED` is the absence of evidence, not health:
it maps to `cold`, never to `ok`. Colouring an unmeasured workflow green is how a
dashboard lies without anyone writing a false sentence.

`tone()` in `lib/format.js` is the single source of truth for all of these and
maps anything it does not recognise to `cold`. A screen must not keep its own
severity→tone map; five had grown one and they disagreed with each other.

---

# ADDENDUM — 24 Aug 2026, evening. The database now holds ONE customer.

Everything that was not this dealership's real data was deleted tonight, after a
full export. Three statements earlier in this file are now stale; they are
corrected here, and this section wins.

## The customer

    name    ALI ASGHER UJJAIN WALA  /  Shabbir Ujjainwala
    email   shabbir53ujjainwala@gmail.com
    phone   +918517942172
    chat    158510264357112@lid        <- the WhatsApp address to reply on

He is to be treated as a real customer, not a test fixture.

## Row counts, live

    leads                 1     inventory            12     audit_log      289
    communication_logs   66     rag_documents        15     daily_metrics    6
    kyc_documents         9     finance_quotes        3     competitors      0
    whatsapp_contacts     1     purchase_history      1
    users                 1     deals_embeddings      1     customer_360_profiles 1

## Corrections to earlier sections

**ADDENDUM §1 said "Nine of the eighteen rows are voided".** No longer true —
the nine rows that were never submissions have been deleted. `kyc_documents`
holds nine rows, all genuine, all one customer's, and the `void_reason`
partition is **empty**. Keep every branch that handles it: the gate that
produced those rows is fixed, but the branch must stay correct, and an empty
voided section must render as nothing rather than as a titled empty card.

**`competitors` is empty.** All fifteen rows were deleted — twelve were seed
data whose `our_price_aed` contradicted the real inventory (a Land Cruiser
quoted at AED 290,000 against an actual list price of 385,000; the GLE, X5,
Cayenne and Macan were never in stock), which means every "undercut" alert this
system raised was fabricated. The other three were scrape failures the scraper
had stored as rival dealerships. The scraper runs daily at 05:00 UTC and will
refill it from the real lot.

## `v_conversations`: `thread_key` is NOT `chat_id`

The view was rebuilt tonight and this is the change most likely to bite.

    thread_key   the canonical identity of a PERSON.  Their lead email where the
                 rows can be traced to a lead, otherwise the handle.
    chat_id      the WhatsApp address to REPLY on. Always send here.

They used to be the same value. They are not any more, because
`communication_logs.lead_email` holds an email when a lead is known and a
WhatsApp handle when it is not — so one customer's messages sit under **several
different `lead_email` values**, and the old view grouped on the raw column and
showed him as two conversations (46 messages under his email, 20 under his LID).

Two consequences:

* **Never send to `thread_key`.** Sends go to `chat_id`.
* **Reading one person's history needs every key their rows are filed under**,
  not just the thread key. `lead_email=eq.<thread_key>` returns a partial
  conversation. Use an `in.()` over the keys the view resolved
  (`thread_key`, `chat_id`, `lead_email`), and compare what you got against
  `message_count` — if they disagree, say so rather than showing a short thread.

## `v_needs_attention.ref` — what it holds per kind

`ref` is one opaque text column carrying a different identifier per branch:

    lead_unassigned / sla_breach   leads.id
    inventory_aging                inventory.id, the stock number ("NX-1010")
    undercut                       competitors.id
    kyc_archive_gap                kyc_documents.id
    unanswered_chat                v_conversations.chat_id
    workflow_failure               the workflow NAME, not an id

A screen resolving a `workflow_failure` therefore has to match on the name, and
should fall back to `title` rather than assuming `ref` is a key.
