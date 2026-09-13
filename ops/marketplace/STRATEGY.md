# Marketplace enquiries: what NEXUS can honestly capture

**A strategy, 8 September 2026. Nothing here is applied and nothing here is a
build order.** Every measurement below is a read-only query against production
`dsvuoovivysszdoiorch`, run today, printed with the query that produced it.

**The decision this document records.** Engineering time on a direct Dubizzle
Motors integration stops. Not because it is hard, and not because it is later in
a queue — because there is nothing on the other side to integrate with, and the
repository has already measured that. What replaces it is a claim the
architecture genuinely supports:

> **NEXUS captures marketplace enquiries when they reach your WhatsApp.**

And a claim that is retired, permanently:

> ~~NEXUS integrates with Dubizzle.~~

The rest of this document is the evidence for the first sentence, the reason the
second one cannot be rescued, and the four routes a marketplace enquiry can
genuinely take into the system.

---

## 1. What is actually true today, measured

### 1.1 The repository's own finding, and it is a measurement of an absence

`lead_source_catalogue` is the platform-owned vocabulary of where a lead can come
from, seeded by
`supabase/migrations/20260907023137_leadingest_01_provenance_and_source_vocabulary.sql`.
Its `marketplace_dubizzle` row carries the finding verbatim in `evidence_note`:

> *Searched 6 Sep 2026: no developer portal, no public leads-out API or webhook,
> no Zapier integration, and the only public API surface is third-party scrapers,
> which breach their terms. What a UAE dealer actually receives is a WhatsApp
> message from the listing, a phone call, a seller-dashboard entry or a
> notification email. So the real capture path is the WhatsApp channel NEXUS
> already runs, with an email parser as fallback; this row exists to be simulated
> and to be attributed, not to be integrated.*

The same finding is recorded in four other places, and they agree:
`LEAD-INGESTION.md` (*"Dubizzle cannot be integrated. It can only be simulated,
intercepted or negotiated"*, evidence column: *absence of evidence, searched
6 Sep*), `PRODUCT.md` (*"it must be sold as roadmap and never as capability.
YallaMotor and CarSwitch are the same shape"*), `CLAUDE.md` (*"simulated,
intercepted or negotiated — never integrated"*), and `ROADMAP.md`, which lists
the Dubizzle partner conversation as a prerequisite with **no engineering task
attached to it**.

**The evidence grade matters and is stated in the source.** This is an absence of
evidence — a search that found no portal — not a document from Dubizzle saying
there is no API. It is the strongest form the claim can take, and it is why the
catalogue records it as a commercial status rather than as a build status.

### 1.2 What the catalogue row says on production, read today

```sql
select source_key, display_name, channel_family, integration_status,
       delivery_shape, required_provenance, dedup_field
  from public.lead_source_catalogue
 where channel_family in ('marketplace','messaging');
```

| source_key | integration_status | delivery_shape | required_provenance | dedup_field |
|---|---|---|---|---|
| `marketplace_dubizzle` | **COMMERCIAL_CONVERSATION_REQUIRED** | `INBOUND_MESSAGE` | **`simulated`** | `simulator_scenario_id` |
| `marketplace_email_notification` | AVAILABLE | `INBOUND_EMAIL_METADATA_THEN_FETCH` | `hmac_sha256_svix` | `rfc_message_id` |
| `whatsapp_inbound` | AVAILABLE | `INBOUND_MESSAGE` | `shared_secret_header` | `wa_message_id` |

`COMMERCIAL_CONVERSATION_REQUIRED` is the catalogue's own word for *no public
route exists and engineering time spent on it is wasted until somebody signs
something*. That definition is in the table comment, not invented here.

### 1.3 The consequence of `required_provenance = 'simulated'`

This is the part worth reading slowly, because it is the difference between a
policy somebody has to remember and a rule the database enforces.

```sql
select kind, is_cryptographic, strength_rank, counts_as_real
  from public.lead_provenance_kind where kind = 'simulated';
```

    simulated | false | 0 | counts_as_real = FALSE

Two CHECK constraints on `lead_ingest_endpoint` then close the door from both
sides:

- **`lead_ingest_endpoint_production_matches_source`** — a production endpoint
  must declare exactly the provenance its source requires. For
  `marketplace_dubizzle` that is `simulated`.
- **`lead_ingest_endpoint_production_needs_real_provenance`** — a production
  endpoint cannot rest on a provenance whose `counts_as_real` is false. And
  `simulated` is false.

**So a production Dubizzle endpoint is a row Postgres will refuse to write.** Not
a lint, not a convention, not a flag a nightly job checks: the two constraints
contradict each other for this one source, deliberately, and the only way to
create such an endpoint is to change the catalogue row — which is a decision
somebody has to make on purpose and defend.

`lead_event` carries the same floor
(`lead_event_production_needs_real_provenance`), so even a hand-written event
claiming production Dubizzle traffic is refused.

**What that buys commercially.** It means "we do not fake Dubizzle leads" is not
a promise about our discipline. It is a property of the schema, and it survives
staff turnover, a rushed demo and a salesperson under pressure.

### 1.4 What is registered today, and what is not

```sql
select source_key, environment, status, declared_provenance
  from public.lead_ingest_endpoint order by source_key;
```

| source_key | environment | status |
|---|---|---|
| `google_ads_lead_form` | production | **disabled** |
| `meta_lead_ads_facebook` | production | **disabled** |
| `meta_lead_ads_instagram` | production | **disabled** |
| `phone_call` | production | active |
| `walk_in` | production | active |

Five rows. **Zero for `whatsapp_inbound`. Zero for either marketplace source.**
Two active, and both of them are a person typing.

```sql
select count(*) from public.lead_event;                          -- 1
select count(*) from public.lead_event
 where source_key like 'marketplace%';                           -- 0
```

**One `lead_event` row exists on production. It is the preflight walk-in. No
marketplace event has ever existed, and neither has a WhatsApp one.**

`nexus_lead_source_readiness()` computes `NOT_CONNECTABLE` for
`marketplace_dubizzle` before it looks at anything else, precisely because
`integration_status = 'COMMERCIAL_CONVERSATION_REQUIRED'` is true regardless of
what any dealership does. Its output is not quoted here: the function is
`SECURITY DEFINER` and scoped by `nexus_current_tenant_ids()`, and a service-role
connection returns zero rows for every source including ones that demonstrably
have an active endpoint. Anyone re-measuring readiness must do it as a signed-in
dealership session. That caution is already recorded in
`ops/whatsapp-lead-capture/SPEC.md` §1.3 and is repeated because it is easy to
misread the empty result as a finding.

---

## 2. The four routes a marketplace enquiry can genuinely take

These are the four the repository records — *a WhatsApp message from the listing,
a phone call, a seller-dashboard entry, or a notification email*. Each is
assessed on three questions: is it capturable today, what would it take, and what
could honestly be claimed about attribution.

### Route 1 — WhatsApp message from the listing

**Capturable today: partly, and less than the phrase suggests.** The channel
exists and carries real traffic — 31 inbound WhatsApp messages in the last seven
days, measured. Messages reach `communication_logs` and four have become `leads`
rows over the system's lifetime. What does **not** happen is any of the
following: no `lead_ingest_endpoint` row exists for `whatsapp_inbound`, no
`lead_event` has ever been written for a WhatsApp message, `channel_message_events`
holds zero rows, and every `leads` row written by this path carries
`source = 'nexus-master-router'` — the name of the workflow that wrote it, not
the origin.

**What it would take.** It is specified in full in
`ops/whatsapp-lead-capture/SPEC.md`, which is unapplied. Five migrations, two
endpoint rows, nine n8n nodes, and one decision that has to be made before any of
it: **when does a WhatsApp message become a lead.** That decision is not a
detail. The measured precision of the eager path already in production is zero —
four WhatsApp-derived CRM cards in the system's lifetime, none of them a real
vehicle enquiry, two requiring manual disqualification.

**What could honestly be claimed about attribution.** That the enquiry was
captured, and that it arrived over WhatsApp. **Not** that it came from Dubizzle.
The transport is attested by a shared secret header; the marketplace is attested
by nothing at all. A listing reference inside a message body is a string the
sender typed, and anyone can type it.

### Route 2 — Phone call

**Capturable today: only as a person typing.** `phone_call` is in the catalogue
with `delivery_shape = MANUAL_ENTRY` and `required_provenance =
operator_recorded`, and it has an active production endpoint. Its own
`evidence_note` says it plainly: *"Typed by a person today. Call-tracking
integration is roadmap, not capability."*

**What it would take.** A call-tracking provider with a per-listing or
per-campaign number, and a webhook from that provider. That is a real, buyable
integration — but it is an integration with the call-tracking vendor, not with
the marketplace, and it costs money per number. Nothing in this repository has
started it.

**What could honestly be claimed about attribution.** Today: nothing beyond
"a salesperson recorded a phone enquiry." With per-listing numbers later, the
number dialled would be genuine evidence of which listing produced the call —
the strongest marketplace attribution available on any of these four routes,
because the buyer cannot fake which number they rang. That is worth knowing and
it is not worth claiming yet.

### Route 3 — Seller-dashboard entry

**Capturable today: no, and it is the route to be most careful about.** The
enquiry sits inside Dubizzle's own seller interface. There is no export, no feed
and no API. The only mechanisms that reach it are a human reading the dashboard
and re-typing the lead, or an automated scraper.

**Scraping is not an option and should not be discussed as one.** The catalogue
row records that the only public API surface is third-party scrapers *which
breach their terms*. A dealership that bought NEXUS and later discovered its
lead feed was a terms-of-service breach of the marketplace it depends on for
stock movement has been sold a liability. This route is closed on purpose.

**What could honestly be claimed about attribution.** If a salesperson re-types
it, exactly what `walk_in` and `phone_call` already claim: a person vouches for
it, and nothing external attests it. `operator_recorded` carries
`counts_as_real = true` and `strength_rank = 10` for exactly this reason — it is
real business, and it is the weakest attestation in the vocabulary.

### Route 4 — Notification email to the dealership

**Capturable today: no, and the pieces are further along than the other three.**
`marketplace_email_notification` is `AVAILABLE`, with a defined delivery shape
and a required provenance of `hmac_sha256_svix`. What is missing is an ingest
subdomain, DNS, and a receiver. Section 4 assesses this route properly, because
it is the one most likely to be over-sold.

### The four routes, side by side

| Route | Capturable today | What it needs | Honest attribution ceiling |
|---|---|---|---|
| WhatsApp from listing | Channel live; capture-to-`lead_event` **not built** | `ops/whatsapp-lead-capture/SPEC.md`, unapplied, plus the eager-vs-cautious decision | "Arrived by WhatsApp." Marketplace is a hint, never a source |
| Phone call | Only as manual entry | A call-tracking vendor and per-listing numbers | Today: a person's word. Later: the number dialled, which is strong |
| Seller dashboard | No | Manual re-typing. Scraping is refused | A person's word, same as a walk-in |
| Notification email | No | Ingest subdomain, DNS, receiver, parser | "A notification arrived at an address only this dealership's marketplace account was given" |

---

## 3. The additive evidence design

The owner's proposal: keep the marketplace evidence when it exists, as **hints**,
alongside the lead rather than inside its identity. This section specifies that,
and then states the one rule that makes it safe.

### 3.1 The three fields

| Field | Where it lives | Type | What it holds |
|---|---|---|---|
| `listing_referrer_hint` | `lead_event.normalized -> 'attribution'` | text | A marketplace name recognised in the message, e.g. `dubizzle`. Free text from a short recognised set, never a `source_key` |
| `listing_url` | `lead_event.normalized -> 'attribution'` | text | The listing link exactly as the customer sent it. Stored verbatim, never rewritten or followed |
| `campaign_hint` | `lead_event.normalized -> 'attribution'` | text | Any campaign or reference token carried in the message |

All three go in `normalized`, beside the `attribution_confidence` and
`attribution_note` that the simulator's scenario A already models. `payload_raw`
keeps the customer's message verbatim regardless, which is what settles a dispute
later.

**None of them goes in `source_key`, and the reason is mechanical rather than
stylistic.** `source_key` is half of `lead_event_identity_key
(tenant_id, source_key, external_event_id)`. `leadingest_08` already records what
moving attribution into an identity key costs: the same arrival redelivered no
longer matches the stored row, so it inserts again, promotes again, and the
dealership gets two leads for one customer. **Attribution is additive. Identity
is not.**

### 3.2 How they would actually be populated — and what is genuinely observable

This is where the design has to be honest, because the tempting assumption is
wrong in this repository.

The assumption is that a WhatsApp message originating from a Dubizzle listing
carries a recognisable preamble or a link. The simulator models exactly that
shape in `ops/lead-simulator/scenarios/a-dubizzle-whatsapp-clean.js` — and that
file **labels its own message text as a reconstruction**:

> *the INNER message text — the listing preamble the marketplace prepends — is
> OUR RECONSTRUCTION of what a dealer sees. It is not a published contract and
> the marketplace is free to change it without telling anyone.*

And production has never seen one:

```sql
select count(*) as inbound_wa_all,
       count(*) filter (where message ~* 'dubizzle|yallamotor|carswitch|dubicars')
         as marketplace_named,
       count(*) filter (where message ~* 'https?://') as contains_a_url
  from public.communication_logs
 where channel_key = 'whatsapp' and direction_key = 'inbound';
```

    109 | 0 | 0

**Across every inbound WhatsApp message NEXUS has ever recorded, not one names a
marketplace and not one contains a URL of any kind.** So the preamble is not a
measured fact, it is a hypothesis, and the design has to hold whether or not it
turns out to be true. That is a different design from one that assumes it.

Three consequences follow, and they are the whole of the specification:

1. **Extraction is a pure function of the message text, run after the lead
   already exists.** It reads `payload_raw`, looks for a recognised marketplace
   domain or name, and writes hints or writes nothing. It never gates capture,
   never delays a reply, and never decides whether something becomes a lead.
2. **It fails soft, always.** Scenario A already states the rule: *if the
   preamble does not match, the message is still a real customer message and must
   still become a lead, just without the vehicle attribution.* A parser that
   drops an enquiry because it could not recognise a listing format has inverted
   the product.
3. **The hit rate must be measured before the field is shown to anybody.** On
   today's 109 messages the hit rate is zero. If it stays near zero once real
   marketplace traffic arrives, the fields stay in the database and stay off the
   screen — an attribution field that is empty on 98% of leads teaches a
   dealership to ignore the column, and then to ignore the ones that are
   populated.

The other two routes populate the same fields differently, and both are stronger
than a string in a message body: a call-tracking number identifies a listing
because the buyer dialled it, and a notification email arrives at an address only
one dealership's marketplace account was ever given. Neither exists yet.

### 3.3 The rule: a HINT is never promoted to an ATTRIBUTION

**A hint says where the customer says they came from. An attribution says where
the system can prove they came from. NEXUS never converts the first into the
second, in the database, in a report, or in a sentence.**

Concretely, and these are the properties to test against:

- `source_key` for a marketplace enquiry arriving on WhatsApp is
  `whatsapp_inbound`. It is never `marketplace_dubizzle`. The database refuses
  the alternative anyway (§1.3), so the rule and the schema agree.
- No report groups, filters, totals or ranks by a hint. There is no "leads by
  marketplace" figure, no marketplace conversion rate and no marketplace ROI,
  because every one of those is a number computed from an unverified string and
  every one of them would be quoted back at us.
- A hint has no strength rank and never appears next to `origin_strength`.
  `lead_provenance_kind.strength_rank` exists so that a body secret is never
  rendered as equal to an HMAC; putting a self-reported string on that scale
  would undo the reason the scale exists.
- If the hint is ever surfaced, it is surfaced with its own wording attached, not
  as a field label a screen invents.

### 3.4 What a dealership would actually see

On the lead, one line, under the customer's message and visibly not part of the
lead's own identity:

> **Customer mentioned:** dubizzle · `<the link they sent>`
> *Read from the customer's message. Not verified with the marketplace.*

And where the lead's source is shown, it says **WhatsApp enquiry** — the
`display_name` from the catalogue — with no marketplace anywhere near it.

**What a dealership would not see, and must not:** a Dubizzle logo, a source
reading "Dubizzle", a "marketplace leads" count, a leaderboard of listing sites,
or any figure at all derived from a hint. If a dealership asks for marketplace
ROI reporting, the answer is that nobody can give them one honestly, and the
reason is section 1.

---

## 4. The email route, assessed properly

Marketplace notification emails are a real signal and the most complete one
available without a commercial agreement. They are also the route where it is
easiest to claim more than has happened, so this section is deliberately
unflattering.

### 4.1 What building it would involve

Four things, and none is a weekend.

**An ingest subdomain NEXUS controls, with DNS.** A distinct unguessable
local-part per dealership on a dedicated subdomain — explicitly **not**
plus-addressing, which forwarders strip or mangle. The dealership then points its
marketplace notification address at it, or forwards to it.

**Routing on the envelope recipient, never on `To:`.** A dealer forwarding
marketplace mail from their own inbox produces a message whose `To:` still points
at themselves. Route on `To:` and every forwarded lead lands in the wrong
dealership or in none. The envelope recipient is the only field that says where
the mail was actually delivered. This is recorded in the catalogue row, in the
endpoint column comment on `ingest_address`, and in scenario B, three times,
because it is the defect that would be found last.

**Accepting that DMARC cannot be the authenticity gate.** SPF fails across a
forward by design — that is what forwarding does to SPF, not a sign of forgery —
so requiring a DMARC pass rejects precisely the forwarded mail this route exists
to catch. The authenticity claim is that the sender knew a secret, unguessable,
per-dealership ingest address. Auth results are recorded as a signal and are not
a gate.

**A parser that is a permanent maintenance liability.** There is no published
contract for a marketplace notification email. The template can change without
notice and will. Scenario B states the operational rule: an unparseable
notification must **fail loudly** and raise an operator task, never be silently
dropped. A silent parser failure loses leads a dealership is paying the
marketplace for, and neither party finds out.

And one operational property that decides where this route belongs: **it is
slower than WhatsApp.** Delivery, provider processing, a second fetch for the
body, and parsing all add latency to a channel where response time is the
product. It is a fallback, not a plan.

### 4.2 What it would prove

That an email arrived at an address which only this dealership's marketplace
account was ever given, at a stated time, signed by the inbound-email provider's
webhook over raw bytes (`hmac_sha256_svix`, `strength_rank` 85 — the second
strongest kind in the vocabulary).

That is a genuinely strong claim about **delivery**, and it is stronger than the
WhatsApp route's shared-secret header. It is enough to say: *a marketplace
notification reached this dealership at this time, and here it is.*

### 4.3 What it would NOT prove, and this is the part that gets skipped

**It does not prove the marketplace sent it.** The signature is the
inbound-email provider attesting that an email arrived. It attests nothing about
the sender. Anyone who learns the ingest address can post a convincing
notification into it, and the DMARC gate that would normally catch that has been
deliberately given up in order to accept forwarded mail. The secret address is
the whole of the authenticity claim.

**It does not prove who the customer is.** Marketplace notification emails
routinely carry a **masked relay address** rather than the buyer's own, and a
partial or withheld phone number. Scenario B models the relay honestly and flags
it for exactly this reason: a dealership that believes it holds a direct address
will mail a relay that expires and conclude the customer ignored them.

**It does not prove intent.** A notification says an enquiry was made. It does
not say the buyer is serious, funded, in the country, or still looking — and
because it arrives after marketplace processing and forwarding, it does not even
prove they are still available to talk. Nothing about an email licenses a lead
score.

**It does not prove which listing produced the enquiry unless the email names
it** — and if it does, that is parsed text from an unpublished template, which is
a hint under §3.3 like any other, not an attribution.

**And it does not prove there was exactly one enquiry.** Dedup is on
`rfc_message_id`. A dealer whose inbox forwards, and who also points the
marketplace address directly at the ingest subdomain, delivers the same enquiry
twice under two message ids. The identity key does not catch that, and no design
in this repository catches it yet.

**So the honest summary of the email route:** it proves a notification was
delivered. It proves nothing about the person named inside it.

---

## 5. What would have to change for a real integration to exist

**A commercial agreement with the marketplace.**

Dubizzle Motors would have to agree to send enquiries to NEXUS, and publish or
provide a contract for doing so. That is the only thing that turns
`COMMERCIAL_CONVERSATION_REQUIRED` into `AVAILABLE`, and it is not an engineering
task. It is not blocked on a design, a library, a credential, or a queue
position. YallaMotor and CarSwitch are the same shape.

No process is described here and no timeline is offered, because none exists.
This document does not predict whether such an agreement is achievable, who would
open it, or what it would cost. It records only that nothing else in this
repository can substitute for it, and that until it happens, engineering time
spent on Dubizzle produces nothing.

---

## What this document does not authorise

- It does not authorise building the WhatsApp capture path. That is
  `ops/whatsapp-lead-capture/SPEC.md`, it is unapplied, and it opens with a
  design decision that has not been made.
- It does not authorise adding the three hint fields. They are specified here,
  not scheduled.
- It does not change any claim in `commercial/`. Those are changed in those
  files, and they are.
