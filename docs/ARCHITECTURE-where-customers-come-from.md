# Where the customer comes from — the real NEXUS OS map
**2026-08-30 · read from the live instance (21 workflows, 278 nodes) and from stored execution data**

Ali asked a fair question that the design documents had never actually answered: *customer kahan se aayega?*
This is the answer, drawn from what is deployed rather than from what was planned.

Interactive version: https://claude.ai/code/artifact/4e7b6812-083d-4ed1-8827-9c07cc62e9a3

## The short answer

**Every real customer enters through WhatsApp, and only WhatsApp.** They message the business number,
WAHA receives it and POSTs to `/webhook/whatsapp-inbound`, which starts the WhatsApp BDC AI Agent.

Twelve other doors exist, are wired, and work. Nothing is knocking on them. There is no website yet, and
Facebook, Instagram and TikTok are not connected to anything. The doors are finished; the road up to them
has not been laid.

This distinction matters. The system is not *missing* the ability to take a Facebook lead — the catch-all
`/webhook/nexus-inbound-lead` will accept, score and route one correctly today. What is missing is the
configuration that tells Facebook where to post. That is an afternoon, not a rebuild.

## The thirteen entry points

Base URL `https://35.224.126.225.nip.io`.

| Path | Who knocks | Workflow | State |
|---|---|---|---|
| `/webhook/whatsapp-inbound` | WAHA, every WhatsApp message | WhatsApp BDC AI Agent | **live traffic** |
| `/webhook/nexus-inbound-lead` | any external source (catch-all) | Master Lead Router | wired, no traffic |
| `/webhook/whatsapp-send` | rep replying from the dashboard | WhatsApp Send | live |
| `/webhook/ask-ai` | dashboard Ask-AI box | Ask-AI RAG Query Agent | live |
| `/webhook/finance-calc` | dashboard finance desk | Finance Calc | live |
| `/webhook/slack-command` | manager typing in Slack | Slack Command Center | wired |
| `/webhook/audit-kyc` | a document arriving | KYC/AML Auditor | live |
| `/webhook/lead-escalation` | manual escalation | Lead Escalation Agent | live |
| `/webhook/lead-trigger` | manual drip enrolment | 7-Day Warm Lead Drip | wired |
| `/webhook/erp-sync` | Bitrix24 sync | ERP Sync (Bitrix24) | wired |
| `/webhook/deals/closed-won` | deal marked won | Sync Closed-Won to pgvector | wired |
| `/webhook/infra-probe` | health monitoring | Infra Health Probe | live |
| `/webhook/nexus`, `/privacy`, `/terms` (GET) | Meta and Google app reviewers | NEXUS Public pages | live |

Those three public pages are not decoration — Meta and Google both refuse to approve an app without a
reachable privacy policy and terms page. They exist so the approvals could go through, which is exactly
the plumbing the Facebook connection depends on.

## What actually runs on an inbound message

Real node order from stored execution data, 30 Aug. ~27 nodes run; these are the ones that decide something.

1. **WAHA Webhook (POST)** — the event arrives.
2. **Prefilter → Is Real Inbound?** — drops status broadcasts, own outgoing messages, group noise. This
   cannot be switched off at the WhatsApp end: status posts *are* message events.
3. **Claim Message Id → Is New Message?** — writes the message id to `processed_messages`. Already there
   means this copy stops. WhatsApp delivers duplicates routinely; without this the customer gets two replies.
4. **Fetch All Leads → Resolve Lead Identity** — matches the sender's phone to a lead; unknown numbers get
   a placeholder identity so the conversation still proceeds.
5. **Fetch Thread History** — last 12 messages rebuilt into a transcript. This is the bot's memory, and it
   lives in the database; it used to live in server RAM, so a restart wiped every customer's context.
6. **Recent Outreach Check → Reply Eligibility → Should The Bot Reply?** — stays quiet if a human rep is
   already in the chat or the customer was messaged moments ago.
7. **Model Ladder → AI BDC Sales Agent** — runs with three tools: `search_inventory`, `search_policy`,
   `finance_calculator`. A failed model swaps to the next tier and retries invisibly.
8. **Guard Reply** — strips markdown to WhatsApp formatting, replaces an empty answer rather than sending
   silence.
9. **Send via WAHA → Log Conversation → Delivery Report → Audit Log** — Delivery Report verifies each
   claimed write actually landed; a silent failure marks the run PARTIAL, not green.
10. **New Lead Worth Scoring? → Master Lead Router** — an unknown sender is handed to the Router for triage.

## The Router decides who gets woken

Everything converges on the Master Lead Router — WhatsApp today, a Facebook form tomorrow. A model reads
the lead and assigns a score and a temperature.

- **HOT** — ready to buy: specific model, budget stated, urgency in the language. **Slack fires
  immediately** with the rep tagged by name, the lead is assigned, a WhatsApp reply goes out in seconds.
- **WARM** — interested, undecided. Written to Supabase and enrolled in the 7-Day Drip. No human interrupted.
- **COLD** — early, vague, sometimes a wrong number. Recorded and left alone. The value here is negative
  work: a cold lead that never reaches a salesperson is a salesperson left free for a hot one.

So: **Slack only fires for hot leads and escalations.** That restraint is deliberate — a channel that pings
for every lead gets muted within a week, and then the one message that mattered is missed too.
**Supabase** is written on every message; it is the memory and the dashboard's source of truth.
**Gmail** sends drip emails and escalation notices, not chat. **Bitrix24** keeps the CRM in step.

## The clockwork (no customer involved)

| When | What |
|---|---|
| 00:15 | **Inventory Ageing Recompute** — days-in-stock per car; feeds the discount logic |
| 02:00 | **Customer 360** — pulls Bitrix24 into Supabase so CRM and dashboard agree |
| 03:00 | **Retention Purge** — deletes data past its retention window (legal, not housekeeping) |
| 05:00 | **Competitor Price Scraping** — rival listings into Supabase, so stale stock can be repriced |
| hourly | **12-Hour Silence Detector** — finds conversations that went quiet and hands them to Lead Escalation, which briefs a human in Slack. The safety net for everything else's misses. |

## To open the other doors — in value order

No new workflows needed; the catch-all router already accepts and scores whatever arrives.

1. **Facebook & Instagram Lead Ads** → post to `/webhook/nexus-inbound-lead`. Biggest source of car leads
   in the UAE market, and the privacy/terms pages Meta requires are already live. Do this first.
2. **"WhatsApp us" click-to-chat links everywhere** — Dubizzle listings, ad creative, email signature.
   Lands in the one channel that already works end to end. Costs nothing, needs no development.
3. **Website enquiry form** → same catch-all, one line of configuration, once the site exists.
4. **TikTok Lead Generation** → same pattern. After the first two have proven the funnel.

The outside world only ever needs to know one address. Everything behind it is already built and does not
change when a source is added.

## Why the system is shaped this way

- **Leads rot in minutes.** A buyer enquiring at three dealers buys from whoever answers *first*, not best.
  Hence seconds-not-minutes replies and hot leads bypassing the queue.
- **Every day on the lot costs money** — depreciation, financing, floor space. Hence days-in-stock feeding
  the discount logic: an aging car should be discounted harder than a fresh one.
- **The margin is not in the metal.** It is in finance, insurance, trade-in spread and service. Hence a
  finance calculator living inside a sales chat.
- **Silence is the biggest leak.** Most lost deals are lost to nobody following up, not to a competitor's
  price. The drip and the silence detector exist solely to close that gap.

## Open business decision

**Does Tenant A earn commission from the bank on arranged finance?** If yes, a financed sale is worth more
than a cash sale and the bot should steer that way — but CBUAE 5.2.3.3 requires that arrangement to be
disclosed to the customer, with controls against conflict of interest. The number is in the bank
agreements. This is a business decision, not a technical one, and it changes how the bot should negotiate.

**Note added 8 September 2026.** Tenant A is tenant #1 and the pilot, not the dealership NEXUS was built
for. Every dealership on the product has its own bank agreements and its own answer here, so this is a
**per-tenant configuration** question rather than a one-time decision — the answer belongs in tenant data
and in the policy engine. Nothing measured above changes.
