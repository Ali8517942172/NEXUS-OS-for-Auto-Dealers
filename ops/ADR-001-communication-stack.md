# ADR-001 — Gmail and Meta WhatsApp Cloud are the communication stack

Decided by the owner, 13 September 2026. Binding until explicitly reversed here.

```
❌ Resend          ❌ WAHA in production
✅ Gmail           ✅ Meta WhatsApp Cloud API
```

## What is decided

**Email is Gmail.** No Resend, no `RESEND_API_KEY`, no `NEXUS_NOTIFY_FROM`, and no
second email provider. Gmail is not merely a notification sink — it is a channel
adapter, and the inbound direction (a prospect replying by email landing in the
same conversation) is a later phase of the same decision, not a different one.

**WhatsApp is Meta Cloud.** WAHA is not the production provider and is not a
fallback. No new WAHA functionality, no new production lead logic on it.
Historical WAHA rows and the gate's audit trail are preserved; history is never
rewritten to make the new architecture look cleaner than it was.

**Provenance does not merge.** Meta Cloud proves origin by HMAC
(`hmac_sha256_x_hub`, rank 90); WAHA proves it by a shared secret header
(`shared_secret_header`, rank 50). Cloud keeps its own source key and its own
endpoint row. Downgrading Cloud to the WAHA model to save an endpoint would throw
away the strongest origin proof in the system.

**Customer → Conversation → Opportunity is paused.** Not cancelled. It is the
riskiest schema change against a `leads`-centric system, and the measurement that
justified it turned out to be different from the one assumed — leads are already
1:1 with humans; the real problem is capture, where 110 of 218 messages attach to
nothing. Prove real traffic first, then change the schema that carries it.

## Why, in one paragraph each

**Resend out.** Measured 8 September: exactly one call site in the whole system —
`apps/marketing-site/api/lead.js` — and zero across twenty-odd n8n workflows, all
of which already send with a `gmailOAuth2` credential working since August. An
entire external account, a verified sending domain and two environment variables
existed to serve one file. That file now posts to a guarded n8n webhook which
sends from the same Gmail credential. Two secrets and a vendor become one secret
we mint ourselves.

**WAHA out.** It is an unofficial client on a personal number, against WhatsApp's
terms, bannable without warning. Every onboarding conversation has to begin by
explaining it. The Cloud receiver's signature gate is the one part of the WhatsApp
stack with real test evidence — 47 tests passing across three suites today.

## What this decision does NOT yet have

**There is no Cloud sender.** `grep -rl graph.facebook.com` over the repo returns
only two Lead Ads simulator fixtures. WAHA is the only thing that has ever sent a
WhatsApp message. `channel_send_directive` holds 0 rows; `nexus_request_send()`
and `nexus_route_message()` exist and nothing calls them.

So the decommission has a hard precondition, and it is the most important line in
this document: **Cloud send must be proven before a single WAHA send site is
removed.** Remove them first and the system loses its ability to reply at all —
to a real customer, mid-conversation, with no fallback.

**`META_PAGE_ACCESS_TOKEN` is the wrong token for sending.** In this repo that
name holds the Meta **Lead Ads** Page token, scoped `leads_retrieval`, and
`ops/n8n-meta-lead-ads/GO-LIVE.md:219` already records it as asserted rather than
measured. Cloud messaging needs a **System User token scoped
`whatsapp_business_messaging`** — a different token, from a different place, with
a different lifetime. They are named separately in `ops/v1-certification/OWNER-STEPS.md`.

## The mode this puts us in

FAST V1 CERTIFICATION. No V2/V3 features, no speculative integrations, no schema
redesign. The goal is one complete real-source journey, evidenced at every hop,
then expand source by source.

Order: Website/Gmail → WhatsApp Cloud → Facebook Lead Ads → Instagram → Google →
Walk-in/Phone → Bitrix24/Slack cross-check → Journey Lab.

Not all at once, deliberately. Six sources switched on together turn one failure
into a diagnosis problem across n8n, the database, the UI and the CRM at the same
time.

**Dubizzle is out of scope.** There is no public lead API or webhook. Marketplace
enquiries arrive by WhatsApp, call or email, so NEXUS captures the WhatsApp
enquiry and never claims a Dubizzle integration it does not have.

## The rule that outranks the schedule

`NOT RUN` is not `PASS`. `UNKNOWN` is not `ZERO`. Estimated, attributed, confirmed
and recovered are four different words. A green n8n execution is not proof of any
downstream hop. `leads.source` records the workflow that wrote the row, not where
the customer came from, and until that is fixed no channel attribution claim is
safe. The certification matrix currently holds 35 cells and **zero PASS** — which
is the correct answer today, and the reason it is worth filling in honestly.
