# The Master Router had no caller

*Added 26 Aug 2026.*

## What was true

The blueprint calls the Master Router the core of the system: it scores every
inbound lead, then routes HOT to a closer, WARM to WhatsApp outreach, and COLD to
the 7-day drip. Its only door was `POST /webhook/nexus-inbound-lead`, and the only
thing that was ever meant to knock on it was a Make.com scenario.

Make.com and Zapier are empty. Every workflow was migrated into n8n. So nothing
called the Router at all, and **no lead in this system was being scored.**

Worse, that door was wide open. Every other public webhook checks the caller's
Supabase session token. This one never did — while it wrote to `leads` and could,
on a HOT verdict, make the dealership send a WhatsApp message to any number a
stranger supplied.

## What changed

**1. The Router is now reachable from inside n8n.**
A `Called Internally` Execute Workflow trigger connects straight to
`Validate & Enrich Input`. That is the correct replacement for "Make.com POSTs the
webhook" now that everything lives in one instance: in-process, no HTTP hop, no
token to manage, nothing on the public internet.

**2. The public door is gated.**
`Webhook Catch-All → Verify JWT → Auth Gate → Validate & Enrich Input`, matching
the pattern already used by Lead Escalation, KYC, ERP Sync and the rest. Verified
live: an unauthenticated POST now stops at `Auth Gate` with *"unauthorized. A
valid Supabase session token is required"*, `Validate & Enrich Input` never runs,
and no lead row is created. The trigger branch bypasses the gate, because it is
already inside the trust boundary.

**3. WhatsApp is wired in as the live lead source.**
WhatsApp is the only live inbound channel left. Until now a stranger who wrote in
got an AI reply and a `whatsapp_contacts` row, and that was the end of it — no
score, no Slack alert to a closer, no CRM record, no drip.

The BDC now hands genuinely new people to the Router:
`Audit Log → New Lead Worth Scoring? → Shape Lead For Router → Score New Lead`.

Three properties of that placement matter:

* It sits **downstream of the reply**, so only people the allowlist already
  approved ever reach it. A stranger the bot stayed silent on is never scored.
* It fires only when the person is inbound, has a resolvable phone number, and is
  **not already a row in `leads`**.
* It is **`waitForSubWorkflow: false`**. Scoring runs an LLM agent; this box has a
  single vCPU and the customer's reply has already gone out. The conversation must
  never wait on it.

**4. The recursion is closed by meaning, not by a counter.**
The Router routes WARM and HOT leads *to the BDC*, so BDC → Router → BDC would
loop. The lead now carries `origin`. When it is `whatsapp-bdc`, two IF nodes
(`HOT:` and `WARM: Already In A Live Chat?`) skip the outreach call.

This is not only a loop guard — it is the correct behaviour. Someone mid-conversation
who just received a real answer should not also receive a canned welcome message.
Everything else still applies: they are still scored, still alerted to a closer,
still written to the CRM. The audit summary says so explicitly:
*"Outreach deliberately skipped: the customer is already in a live WhatsApp thread."*

**5. The COLD branch can no longer pin the parent open.**
`Marketing Drip (COLD)` was called with `waitForSubWorkflow` defaulting to **true**,
under the Router's 300-second `executionTimeout`, against a child that waits seven
days. It is now `false`, and the Delivery Report claims only what is true of a
fire-and-forget call: *"lead handed to the 7-day drip (start only)"*.
