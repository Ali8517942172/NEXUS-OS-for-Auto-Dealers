# Gmail inbound lead receiver — owner setup

What this builds: a dedicated Gmail inbox that a marketplace (or a dealer's own
enquiry address) forwards lead notification emails into, polled once a minute by
n8n, parsed, and recorded through the same three functions every other lead
source uses — `nexus_record_lead_event` → `nexus_promote_lead_event` /
`nexus_reject_lead_event`.

Nothing here costs money. Gmail, the Gmail API and the n8n box you already run
are all within the free tier at this volume.

---

## Why polling a mailbox and not something cleverer

Three ways to get email into this system were on the table.

| | How it fails |
|---|---|
| **n8n Gmail Trigger, polling** (chosen) | **Delay.** If the n8n box is down, the mail sits unread in the inbox and is picked up when the box comes back. Nothing is lost. |
| Google Apps Script posting to a webhook | A second runtime, with its own quota, its own editor, its own deploy step and no access to the Supabase credential. More moving parts to run one workflow. |
| Gmail push via Cloud Pub/Sub | Real-time, and it **loses mail**: the push has a delivery window, and a receiver that is down when the push fires does not get a second chance the way an unread inbox does. It also needs a Google Cloud project with Pub/Sub configured — more setup for a worse failure mode. |

Polling was chosen because its worst case is *late*, and the other two have a
worst case of *gone*. n8n already holds the Supabase credential, so the whole
thing lives in one runtime.

---

## Step 1 — Create the dedicated inbox

Create a **new Gmail account** that does nothing else. Not the owner's personal
mail, not the outbound sender, not `sales@`.

Suggested: `leads-ingest-<random>@gmail.com`.

Two reasons this has to be its own account:

1. The workflow polls `is:unread` and **marks messages read**. Pointed at a
   mailbox a human uses, it eats their unread flags.
2. The address is the only thing standing between this pipeline and a stranger
   posting a fake customer into a dealership's funnel (see *Security*, below).
   An address that appears on a business card is not a secret.

Do **not** put this address in any signature, website, or anything public.

---

## Step 2 — Google Cloud project and OAuth consent screen

n8n's Gmail node uses OAuth. Follow n8n's own "Gmail credentials" doc for the
client id/secret; the step below is the one that doc does not shout about and
that will otherwise take this integration down a week after you launch it.

1. Google Cloud console → new project (free).
2. **APIs & Services → Library → Gmail API → Enable.**
3. **APIs & Services → OAuth consent screen:**
   - User type: **External**.
   - Fill in app name, support email, developer email.
   - Add the scopes the Gmail node asks for (`gmail.modify` covers read,
     label and mark-read; do not grant `gmail.send` to this credential).
   - Add the ingest Gmail account as a **Test user**.
   - **→ then press PUBLISH APP and move the status from "Testing" to
     "In production".**

> ### **The seven-day trap — read this one**
>
> **While the consent screen is in "Testing", Google expires the OAuth refresh
> token after 7 days.** The credential works perfectly for a week, then stops.
> When it stops, the Gmail Trigger simply fails on its next poll —
> **no lead is created, no error reaches anybody, and emails keep arriving in an
> inbox nobody is looking at.** The dealership's first sign of trouble is a
> customer phoning to ask why nobody called them back.
>
> **Publishing the consent screen is what prevents this.** An unverified
> published app still shows an "unverified" warning when you first authorise it,
> which is fine — click through it. What matters is that the refresh token stops
> expiring.
>
> An External + published app using only Gmail scopes will eventually be asked
> to complete Google verification. Until then it keeps working for the small
> number of users you have added. If you ever see leads stop dead exactly seven
> days after you last touched the credential, this is why.

4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorised redirect URI: the one n8n shows you on the credential screen.

---

## Step 3 — Bind the credential in n8n

1. n8n → **Credentials → New → Gmail OAuth2 API**.
2. Name it exactly **`Gmail Inbound Leads OAuth2`** so it is obvious in a node
   list which direction it points.
3. Paste the client id and secret, **Connect**, and sign in **as the dedicated
   ingest account** — not as yourself.

> The existing credential `1Cgivoyjt7psAirH` ("Gmail OAuth2 API") is the
> **outbound sender**. Do not reuse it here and do not add read scopes to it.
> One credential per direction: if the inbound one is ever compromised or
> revoked, outbound notifications should not go down with it.

---

## Step 4 — Create the label

In Gmail, create a label: **`nexus-ingested`**.

Get its id: n8n → a scratch Gmail node → resource *Label* → *Get Many*, run it
once, read the `id` (it looks like `Label_1234567890123456789`). Delete the
scratch node afterwards.

---

## Step 5 — Environment variables on the n8n box

The workflow reads two values from the environment. Neither is written into the
workflow JSON, because that file is committed to git and copied around.

| Variable | What it is | Where it comes from |
|---|---|---|
| `NEXUS_EMAIL_ENDPOINT_PUBLIC_KEY` | The `public_key` of the `marketplace_email_notification` row in `lead_ingest_endpoint`. Tells the database which dealership and which source this mail belongs to. | The orchestrator creates that row. Shape: `^[A-Za-z0-9_-]{24,128}$`. |
| `NEXUS_EMAIL_INGESTED_LABEL_ID` | The Gmail label id from Step 4. | Step 4. |

Also confirm `N8N_BLOCK_ENV_ACCESS_IN_NODE` is **not** set to `true` on the box.
If it is, `$env` returns empty, `p_public_key` is sent as null, and every
ingestion is refused by the database. That is the correct direction to fail —
loudly and completely — but it will look like a Supabase problem when it is an
n8n setting.

Restart n8n after setting them. n8n reads env vars at start.

---

## Step 6 — Import the workflow

1. n8n → **Workflows → Import from File** → `gmail-inbound.workflow.json`.
2. Open **Gmail Inbound Poll**, **Label As Ingested** and **Mark Read** and
   select the `Gmail Inbound Leads OAuth2` credential in each. The file ships
   with a placeholder credential id (`PENDING-INBOUND-GMAIL-OAUTH2`) that
   deliberately does not resolve, so an import cannot accidentally bind the
   outbound credential.
3. Confirm the **Record Lead Event**, **Promote To Lead** and **Hold Without
   Promoting** nodes picked up the existing `Supabase account` credential
   (`dv4OeARarErZLHCj`).
4. Leave it **inactive**. Send yourself a test email shaped like Step 7, then
   use **Execute Workflow** once and read the output of every node before you
   ever switch it on.

---

## Step 7 — Point mail at it

### A marketplace
In the marketplace's seller settings, change the notification email to the
ingest address. Most will only send to one address, so decide first whether the
dealer still needs a human copy — if so, add a Gmail forwarding rule *out* of the
ingest inbox to the dealer, rather than sending to both from the marketplace.

### A dealer's own enquiry address
In the dealer's Google Workspace / mail host, add a **forwarding rule** from
`sales@dealer.com` to the ingest address. The dealer keeps their copy; we get
ours.

Note what forwarding costs you: **SPF for the original sender fails after a
forward, by design.** That is expected and the workflow does not care, because
it never used SPF as a gate. It is also exactly why `origin_verified` is
`mailbox_read_oauth` and not something that sounds like sender authentication.

### The body the parser can actually read
The parser takes fields only from **labelled lines**, in plain text or in a
two-cell table row:

```
Name: Khalid Al Marri
Phone: +971 50 123 4567
Email: khalid@example.ae
Vehicle: 2021 Nissan Patrol Platinum
Message: Is it still available?
```

It does **not** scan loose text for anything that looks like a phone number. A
marketplace notification is full of stock numbers, prices, mileages and listing
ids, and the first nine-digit run in one of those would otherwise be handed to a
salesperson as a customer's mobile.

Accepted labels include: `name / full name / customer name / buyer name`,
`phone / mobile / tel / contact number / whatsapp`, `email / e-mail`,
`vehicle / car / model / listing`, `message / enquiry / comments`.

If a marketplace uses different wording, add it to `LABELS` in
`parse-lead-email.node.js`, add a test for it, re-run the tests, rebuild the
workflow and re-import. Do not edit the Code node in the n8n UI — then the
tested body and the running body are different programs.

---

## Gmail API quota — this is not a constraint at this volume

Google's published Gmail API limits (verify against Google's current docs before
quoting them to anyone):

- **1,000,000,000 quota units per day** per Cloud project.
- **250 quota units per user per second**, as a moving average, with short
  bursts allowed.
- Per-method cost: `messages.list` **5**, `messages.get` **5**,
  `messages.modify` **5** (that is the label and the mark-read),
  `labels.list` **1**.

What this workflow actually spends:

| | Calls/day | Units/day |
|---|---|---|
| Polling once a minute (list) | 1,440 | 7,200 |
| Per lead: get + addLabels + markAsRead | 3 | 15 |
| **200 leads/day** | | **~10,200** |

That is about **0.001%** of the daily project quota. Polling every minute is
free in every sense that matters here. The per-second limit is nowhere near
reachable by one poller.

The real Gmail limits you could hit are on the *sending* side and do not apply
to this workflow.

---

## Security: the honest statement

`origin_verified = 'mailbox_read_oauth'` attests **the fetch, not the message**.
It means: these bytes were genuinely read out of a mailbox we hold an OAuth
token for. It does **not** mean the sender is who the `From` header says.

- SPF does not survive a forward — and forwarding is how this is set up.
- DKIM is not verified. This workflow reads Gmail's already-parsed headers; it
  never sees the raw signed message. `Authentication-Results` is recorded as
  evidence and used as a gate by nothing.
- **The secrecy of the ingest address is the only gate.** Anyone who learns it
  can email a fake customer into a dealership's pipeline.

Mitigations available today, none of which change the above: keep the address
unpublished; keep `provenance_counts_as_real` under review with the orchestrator;
and treat a lead whose `payload_raw.from` is an unexpected domain as suspect.

---

## The four failure modes, and what each one looks like

| # | Failure | What you see | What to do |
|---|---|---|---|
| **1** | **OAuth refresh token expired** (consent screen left in Testing — see Step 2) | Leads stop entirely, roughly 7 days after the credential was last authorised. n8n executions for the trigger fail or stop appearing. The inbox fills with unread mail. **Nothing alerts you.** | Publish the consent screen, then re-authorise the credential. The unread mail is still there and gets picked up on the next poll — delayed, not lost. |
| **2** | **The marketplace changed its email template** | Leads keep arriving in `lead_event`, but land as `REJECTED` with `normalized_defect` = `NORMALIZED_FULL_NAME_REQUIRED` or `NORMALIZED_NEEDS_EMAIL_OR_PHONE`. No new rows in `leads`. Loud in the database, silent to the dealer. | Read `payload_raw.body_excerpt` on a rejected event, add the new labels to `LABELS`, add a test, re-run, rebuild, re-import. |
| **3** | **Label or mark-read failed** (Gmail hiccup, label id wrong) | The same message is polled again every minute. `nexus_record_lead_event` answers `was_duplicate` on the Message-ID, so **no duplicate lead is created** — but the inbox never drains and executions pile up. | Check `NEXUS_EMAIL_INGESTED_LABEL_ID` is the real label id. Mark the stuck messages read by hand. |
| **4** | **n8n or Supabase unreachable** | Mail queues unread in the inbox. Execution errors on the box. **Delay, not loss** — this is the failure mode this design was chosen for. | Bring the box back. The backlog drains at one poll per minute; nothing needs replaying by hand. |

A fifth thing that is not a failure but will look like one: a message with **no
`Message-ID` header** is refused on purpose and left unread. That is a message
we cannot safely deduplicate, and a re-poll of it would be indistinguishable
from a second customer. Handle it by hand.
