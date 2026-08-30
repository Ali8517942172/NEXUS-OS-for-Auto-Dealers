# Full-system audit, 30 August 2026 — 14 agents, 21 workflows, 14 screens
**Nothing in this report is inferred from design documents. Every finding was read out of live
workflow exports, the live Supabase catalogue, or stored execution data.**

## First, the good news — and a correction I owe you

Two agents reported CRITICAL security holes from the repo's SQL files: that any signed-in user could
rewrite the `users` table and promote themselves to admin, and that `inventory` was readable by
anonymous visitors. **I checked the live database directly. Neither is true.**

- RLS is **enabled on all 16 tables**.
- All 6 views carry `security_invoker = on`, so they respect the underlying table policies rather
  than bypassing them.
- `users` has exactly two policies: `authenticated` may **read only**; writes are service-role only.
  The dangerous INSERT/UPDATE policies in `supabase/2026-08-14_rls_and_inventory_ageing.sql` were
  **never applied**.
- There is **no anon policy anywhere**. The `GRANT SELECT TO public` on inventory is not live.

So the database is sound. **The repo is what is wrong** — and dangerously so, because
`architecture/supabase_schema.sql` is a stale generic template (`first_name`, `sku`, `quantity`, and
a status CHECK that would reject every value the router writes), and the go-live instructions tell
an operator to paste it into the SQL editor and RUN. Doing that on the live project would install
the anon grant that does not currently exist. **That file must not be run.** Fixing the instructions
is the action item, not fixing the database.

## Fixed and live today

| Fix | Why it mattered |
|---|---|
| **Router held both concurrency slots** | Four `executeWorkflow` calls defaulted to *wait*. One HOT lead made the Router hold its slot while ERP Sync, Lead Escalation and the WhatsApp outreach each ran to completion — parent + child = **both** of the box's two slots, for three chained AI workflows. Nothing downstream reads any of their output. **This is the mechanism behind both box lock-ups.** Now all four fire and forget. |
| **Router's Groq fallback was still dead** | My own miss. I fixed the model in the BDC agent this morning and did not fix the Router, so the two agents disagreed about which model exists. Both now on `openai/gpt-oss-120b`. |
| **Router scoring agent 8 → 3 iterations** | ~12s per model round-trip on this box; 8 iterations is a two-minute worst case for a one-shot classification. |
| **A closed sale could vanish entirely** | `Format Deal Text` fans out to the embedding (y=304) and to `Record Purchase` (y=504). v1 orders by y-position, so the **AI call ran first** — and it has no `onError`, while `Parse Embedding Response` deliberately throws. An OpenRouter rate-limit aborted the run before the sale was ever written to `purchase_history`. Record Purchase moved to y=160: the sale is recorded, *then* the embedding is attempted. |
| **`days_in_stock` was one day short, permanently** | The RPC used bare `current_date`, but the job fires 00:15 Dubai = 20:15 UTC *the previous day*. Every car was understated by a day and AED 50. The sales agent reads `days_in_stock` to decide how hard it may discount, so it has been **systematically under-discounting aging stock**. Now anchored to `(now() at time zone 'Asia/Dubai')::date`. |
| **Agent invented credit terms** | A customer said "main owner hoon, employee nahi" and the agent replied that banks "usually de-risk karke thodi better rates offer karte hain" to owners. Invented, and not how UAE lending works. New rule: never claim any category gets a better or worse rate; say what paperwork differs and hand the rate to the bank. |
| **Agent told a customer its tools were broken** | "Abhi finance calculator system mein dikkat aa rahi hai" — then answered the finance question from its own knowledge anyway. Both forbidden now. |
| **Agent forgot what it had been told** | It asked which car the customer wanted after he had named it, drawing "Tujhe already bata rakha hai mene". Thread window widened 12 → 24 messages. |

Also: `feat/inventory-crud` deleted (its work was already fully merged into `main`); the repo now has
one branch.

## The four that still need fixing, in order

**1 · The drip has no exit condition. None.** Between enrolment and the four sends there is not one
node that re-reads the lead, checks for a reply, or tests status. A customer scored COLD, enrolled,
who then replies, is upsold and **buys the car on day 2** still receives "Still looking at the Land
Cruiser?" on day 3, a WhatsApp on day 5, and an "exclusive 5% discount, valid 48 hours" on day 7 —
after paying full price. This is the one that can embarrass the business in front of a paying
customer.

**2 · Retention Purge marks rows purged that it did not purge.** It deletes customer ID and passport
scans, then stamps `purged_at`. The success check is per-item, but `Mark Rows Purged` PATCHes **all
500 ids** regardless of how many objects actually deleted, and the report counts requested rather
than returned. A run that deletes 3 of 500 logs `SUCCESS — deleted 500`. Those rows are then
invisible to every future run while the files sit in the bucket. Selection is sound (a null
`retain_until` cannot match), but the audit trail lies in exactly the direction that matters for
compliance. It runs 03:00 Dubai.

**3 · A rep's reply does not silence the bot.** The dashboard sends `{chat_id, text}`; the bot's
eligibility check never reads recent outbound, and `communication_logs` has no column recording
*who* sent an outbound message. So a rep types "78,000 final", the customer says "ok", and the bot
quotes its own number seconds later on the same line.

**4 · The Finance screen shows no rate at all.** My backend change this morning renamed the output
fields; `finance.js` still reads `finance_tier` and `indicative_apr_pct`. It renders "Indicative APR
—" for every live quote. Nothing prints `NaN` (the formatters are careful), but a rep looking at a
blank APR is the person most likely to invent one.

## Worth knowing, lower urgency

- **The 5-minute rule is not measured.** `leads.response_time_minutes` is read by four screens and by
  the SLA-breach alert — and **no workflow writes it**. The system's headline promise has no meter.
- **WhatsApp-only leads are exempt from the safety net.** The silence detector matches
  `communication_logs.lead_email` exactly, but WhatsApp rows are filed under the chat id while the
  lead row says `+971…@whatsapp.lead`. Those leads are never found, and the job runs green.
- **Every 12-hour silence escalation lands in the wrong Slack channel** — the caller sends `reason`,
  but the callee's trigger is `passthrough` and drops it, and the Slack node routes on that field.
- **`PARTIAL` renders green** on the Automation screen. A run where the customer's message was never
  delivered reads as a success.
- **Dashboard drip enrolments skip both WhatsApp steps** — the payload omits `phone`, which both
  WhatsApp gates test.
- **Emirates IDs and passports go to free-tier vision models** on OpenRouter, which may log and train
  on prompts, tagged with the dealership's own name in the request headers.
- **The KYC retry cap does not hold** for a customer with no email — the counter queries on
  `lead_email`, finds nothing, and re-asks forever.
- **A WON lead renders the same colour as a cold one**, and is reachable by no filter tab.
- **Nothing is pinned to Asia/Dubai in the browser.** Every timestamp on every screen renders in the
  viewer's zone, unlabelled.
- **The competitor scrape gets ~2 of 16 units** because the workflow's own 300s timeout kills it
  after roughly two Apify calls — not because of the filter. And its price-update branch is
  unreachable: the workflow has never updated a price.

## What I did not touch, and why

`leads` and `inventory` allow any authenticated user full read/write. For a dealership where every
dashboard login is staff, that is a defensible design rather than a hole, and narrowing it needs your
decision about roles first. Flagged, not changed.
