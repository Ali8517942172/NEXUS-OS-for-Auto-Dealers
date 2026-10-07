# WhatsApp enquiries do not become attributed leads

**A specification, 8 September 2026. Nothing here is applied.** Every SQL block
below is a proposal to run later, deliberately, with someone watching. The
measurements are read-only queries against production `dsvuoovivysszdoiorch`,
run today, and each one is printed with the query that produced it.

This is the largest commercially-valuable gap still open in NEXUS. In the UAE a
very large share of dealership enquiries arrive as WhatsApp messages — including
every Dubizzle, YallaMotor and CarSwitch enquiry, because those marketplaces
publish no lead API and their listings produce a WhatsApp message or a phone
call. "Your WhatsApp enquiries become attributed leads automatically" is close to
the whole sellable promise. Today it does not happen.

---

## 0. Three corrections to the brief, before anything else

The framing this work started from was **mostly right and wrong in one place that
changes the design**. Stating the corrections first, because the wrong one is the
more interesting.

**Correction 1 — WhatsApp messages DO become `leads` rows. Four of them have.**
The claim "WhatsApp messages arrive and never become leads" is not what the
database says. What it says is that they never become *attributed* leads, and
never become *lead events*.

```sql
select id, name, email, phone, source, status, ai_score, created_at
  from public.leads order by id;
```

| id | name | email | phone | source | status | ai_score |
|---|---|---|---|---|---|---|
| 34 | Siva Thangavelu | `+971547484167@whatsapp.lead` | +971547484167 | `nexus-master-router` | **DISQUALIFIED** | 30 |
| 35 | Effco Contracting llc | *(empty string)* | +971505433953 | `nexus-master-router` | **DISQUALIFIED** | 10 |
| 38 | Ali | shabbir53ujjainwala@gmail.com | +918517942172 | `nexus-master-router` | WARM | 65 |
| 121 | Preflight Walk-In | `…@nexus-preflight.invalid` | +971500000001 | `walk_in` | new | — |
| 122 | Hussain | `+971556382721@whatsapp.lead` | +971556382721 | `nexus-master-router` | COLD | 30 |

All four `nexus-master-router` rows are WhatsApp arrivals. Two carry a synthetic
`+<digits>@whatsapp.lead` address minted because the customer had no email. So
the path from a WhatsApp message to a CRM card exists and runs; it produces a row
whose `source` column names the workflow that wrote it. The gap is not capture.
**The gap is that capture produces an unattributable, unauditable row and no
`lead_event` at all.**

**Correction 2 — `whatsapp_inbound` is already in `lead_source_catalogue`.** The
brief said there is no WhatsApp row "in `lead_ingest_endpoint`", which is exactly
right, but the catalogue is a different table and it already has the source.

```sql
select source_key, display_name, channel_family, integration_status,
       delivery_shape, required_provenance, dedup_field
  from public.lead_source_catalogue where source_key = 'whatsapp_inbound';
```

    whatsapp_inbound | WhatsApp enquiry | messaging | AVAILABLE
                     | INBOUND_MESSAGE | shared_secret_header | wa_message_id

That row is load-bearing for section 4: it fixes, by foreign key, what provenance
a production WhatsApp endpoint is allowed to declare.

**Correction 3 — the lead-ingest layer is on production, not staging-only.**
`LEAD-INGESTION.md` still opens with *"Applied to **staging only**"*. All ten
`leadingest_*` migrations are on production:

```sql
select version, name from supabase_migrations.schema_migrations
 where name ilike '%leadingest%' order by version;
```

Ten rows, `leadingest_01` … `leadingest_10`. One version-string divergence worth
recording rather than glossing: the repo file is
`20260907124500_leadingest_10_…` and production holds version `20260907121650`
for the same name. Same migration, different version key. That is a parity
question for whoever owns `ops/PARITY-*`, not for this document, but it should
not be discovered later as a surprise.

**Everything else in the brief is confirmed.** Zero `lead_event` rows for any
WhatsApp source. Zero `lead_ingest_endpoint` rows for `whatsapp_inbound`. Roughly
30 inbound WhatsApp messages in seven days — 31, measured.

---

## 1. The measurement

### 1.1 What arrives

```sql
select source, count(*) as n, count(distinct chat_id) as distinct_chats,
       min(processed_at) as first, max(processed_at) as last
  from public.processed_messages
 where processed_at >= now() - interval '7 days'
 group by 1;
```

    waha | 36 | 9 | 2026-09-02 06:07:09Z | 2026-09-08 17:24:34Z

```sql
select channel_key, direction_key, count(*) as n,
       count(distinct lead_email) as distinct_identities
  from public.communication_logs
 where created_at >= now() - interval '7 days'
 group by 1,2 order by 3 desc;
```

| channel_key | direction_key | n | distinct identities |
|---|---|---|---|
| whatsapp | inbound | **31** | 9 |
| whatsapp | outbound | 9 | 4 |
| system | internal | 2 | 2 |
| system | outbound | 1 | 1 |

Nine distinct people, 31 inbound messages, 36 message-id claims, in seven days.

**The gap between 36 and 31 is a defect, and it is not the one this document is
about.** Claims per chat against logged inbound messages per identity:

```sql
select chat_id, count(*) as claims from public.processed_messages
 where processed_at >= now() - interval '7 days' group by 1 order by 2 desc;
```

| chat | claims | inbound rows in `communication_logs` | gap |
|---|---|---|---|
| `150345548320909@lid` | 9 | 5 + 4 (see below) | 0 |
| `76703921635478@lid` | 7 | 7 | 0 |
| `158510264357112@lid` | 6 | 3 | **3** |
| `42795289079828@lid` | 4 | 4 | 0 |
| `204479249027311@lid` | 3 | 2 | **1** |
| `261852009332755@lid` | 3 | 3 | 0 |
| `115105257808001@lid` | 2 | 2 | 0 |
| `56375908552955@lid` | 1 | 1 | 0 |
| `184984711217354@lid` | 1 | 0 | **1** |

**Five messages were claimed and never logged.** The claim is permanent, so a
WAHA redelivery of any of those five is now suppressed for ever and the
customer's words exist nowhere. This is not caused by anything in this design and
is not fixed by it; it is recorded here because it is visible from the same
query, and because it means `processed_messages` is the honest count of arrivals
and `communication_logs` is not.

**And the first row shows the identity problem directly.** Hussain's nine
messages are split across **two** `lead_email` values in one week —
`150345548320909@lid` for the five before his lead was created and
`+971556382721@whatsapp.lead` for the four after. One person, one conversation,
one week, two keys, because the key changed the moment a `leads` row appeared.

**Every one of those nine chat ids is an `@lid` identifier**, WhatsApp's
privacy-preserving linked id. Not one is a `@c.us` phone-bearing jid. This
matters in section 5: **the chat id contains no phone digits at all**, and the
real number only exists because `Extract Message & Sender` pulls it out of
`Info.SenderAlt` and `Upsert WhatsApp Contact` files it in
`whatsapp_contacts.phone`.

### 1.2 What is written

Four tables see a WhatsApp message today.

| table | rows, 7 days | what it holds |
|---|---|---|
| `processed_messages` | 36 | the idempotency claim: `message_id`, `source='waha'`, `chat_id` |
| `communication_logs` | 40 (31 in, 9 out) | the message text, keyed on `lead_email` |
| `whatsapp_contacts` | 14 total, 8 touched in the window | `chat_id → phone, push_name, lead_email` |
| `leads` | 1 created in the window (id 122) | one CRM card, `source = 'nexus-master-router'` |

### 1.3 What is not written

```sql
select count(*) from public.lead_event;                     -- 1
select source_key, phase, count(*) from public.lead_event group by 1,2;
```

    walk_in | PROMOTED | 1     (event of 7 Sep 09:41, the preflight walk-in, lead 121)

**One `lead_event` row exists on production. It is a walk-in. There has never
been a WhatsApp one.**

```sql
select count(*) as endpoints_total,
       count(*) filter (where source_key='whatsapp_inbound') as whatsapp_endpoints,
       count(*) filter (where status='active') as active
  from public.lead_ingest_endpoint;
```

    5 | 0 | 2

Five registered endpoints — `walk_in` and `phone_call` active, both Meta rows and
the Google row `disabled` — and **zero for WhatsApp**.

```sql
select count(*) as total,
       count(*) filter (where received_at >= now() - interval '7 days') as last7
  from public.channel_message_events;
```

    0 | 0

`channel_message_events` is the messaging layer's own per-message table. It has
`external_message_id NOT NULL`, `origin_verified`, `customer_phone`,
`conversation_id`, `media_sha256` — exactly the right shape — and it is
**completely empty**. `nexus_record_channel_event` exists and nothing calls it.
Two built layers, neither carrying a message. That is not a second problem to
solve here, but section 5 puts it to work rather than duplicating it.

And the ingest gate is green on nothing:

```sql
select * from public.nexus_lead_ingest_invariants();
```

Eight PASS, two INFO. `"Share of arrivals that nothing external attested"` reads
**"1 of 1 production arrival(s) rest on a person's word, not a signature"**. A
gate that passes because the table is empty is telling the truth and saying
nothing.

> `nexus_lead_source_readiness()` was also run and its output is **not quoted
> here**. It is `SECURITY DEFINER` and scoped by `nexus_current_tenant_ids()`;
> called over the service-role MCP connection that returns nothing, so every row
> came back `active_endpoints = 0` — including `walk_in`, which demonstrably has
> an active production endpoint. The function is correct; the caller was wrong.
> Anyone re-measuring readiness must do it as a signed-in dealership session.

### 1.4 The noise question, and what the database can and cannot answer

The repo already records that a large share of inbound WhatsApp is not customer
conversation, and any design that treats all inbound as a lead will manufacture
rubbish. That is right, and the measurement is more specific than "a large
share".

**What the database cannot answer.** `processed_messages` only holds messages
that already passed `Is Real Inbound?` — group chats (`@g.us`), `status@…`
broadcasts and `@newsletter` posts never reach `Claim Message Id`, so they leave
no row anywhere. **The denominator is not in Postgres.** Consistent with that,
all nine claimed chat ids are 1:1:

```sql
select case when chat_id like '%@g.us' then 'group'
            when chat_id like 'status@%' then 'status_broadcast'
            when chat_id like '%@newsletter' then 'newsletter_channel'
            else 'one_to_one_or_lid' end as kind, count(*)
  from public.processed_messages where processed_at >= now() - interval '7 days'
 group by 1;
```

    one_to_one_or_lid | 36        (group: 0, status: 0, newsletter: 0)

**The only measured denominator in this repo** is
`ops/n8n-bundle-NOT-DEPLOYED/README.md`: 102 executions over 8h56m on 5–6
September, **51 distinct messages, 0 of them genuine customer conversation** —
all groups, status or newsletter. That is a nine-hour slice, not a base rate, and
it does not describe the seven-day window measured above, in which 36 messages
did pass the prefilter. Both numbers are true. Neither is a ratio anyone should
quote as "the noise level".

### 1.5 The number that actually decides section 2

Of the 31 genuine 1:1 inbound messages in seven days, how many are vehicle
enquiries?

```sql
select count(*) as inbound,
       count(*) filter (where message ~* '(car|vehicle|suv|sedan|price|aed|dirham|finance|installment|emi|test drive|mileage|model|toyota|nissan|bmw|mercedes|lexus|kia|hyundai|land ?cruiser|patrol|available|سيار|سعر)') as vehicle_keyword_hits
  from public.communication_logs
 where channel_key='whatsapp' and direction_key='inbound'
   and created_at >= now() - interval '7 days';
```

    31 | 1

**One.** And reading the 31 messages directly rather than trusting a regex
confirms it and is worse than the regex suggests. The single hit is
*"Hi i m interested in the fortuner whats the price"*, sent 2 September from
`+918517942172` — **Ali's own Indian number, lead 38**. It is a test.

The other thirty, characterised rather than reproduced:

| what it is | count |
|---|---|
| personal / family conversation in Gujarati, Urdu, Hindi and Punjabi — *"come home"*, *"pick up the phone"*, *"after prayers"*, samosas | ~22 |
| a tile and kitchen-worktop quotation — slabs, Italian crema, Kota, a sink, prices in AED | 2 |
| *"please update our payment status"* — an unrelated business | 2 |
| a request about design/banner work in progress | 2 |
| a **social-engineering attempt**: *"Assalamu alaikum, how are you? I know your router password, can you give me your router pa…"* | 1 |
| the genuine vehicle enquiry (Ali's test) | 1 |

**On the only WhatsApp line NEXUS has ever watched, the measured rate of genuine
customer vehicle enquiries is 1 in 31, and that one was planted.**

**The caveat is as important as the number.** This is Ali's *personal handset*,
not a dealership sales line. It is `me.jid 971526647253:12@s.whatsapp.net`, the
number his family and his other businesses message. On a real dealership number
the mix inverts. So this measurement does **not** establish a base rate for a
dealership. What it establishes is the *shape of the risk*, and it establishes it
on production, with real damage already done — see next.

### 1.6 What the eager path has already produced

The 1-in-31 rate is not hypothetical, because a path already exists that turns
unmatched senders into leads. Its measured precision is **zero**.

- **Lead 122, "Hussain", created 7 Sep 14:05 UTC, `status = COLD`,
  `ai_score = 30`.** The message that produced it was *"I have been driving for
  6-7 hours. Can you please adjust for a while?"* — a friend asking for a
  favour. `ops/n8n-waha-gate/README.md` cites this as *"Lead 122 — a real person,
  a real UAE phone number — entered production through this door"*, which is
  true, and it is also not a customer.
- **Leads 34 and 35 are marked `DISQUALIFIED`** — a cosmetics shop
  (`KAWKAB AL NUJOOM COSMETIC`) and a contracting company (`Effco Contracting
  llc`). A human had to go into the dashboard and take them back out.
- **Lead 38 is Ali's own test.**

Four WhatsApp-derived CRM cards in the system's lifetime. **Zero are a real
vehicle enquiry. Two required manual cleanup.** That is what "too eager" costs,
already measured, on production, at a volume of thirty messages a week. At a
dealership volume it is the reason the dealership stops opening the CRM.

Meanwhile, the same path *misses*: of the nine senders in the window, only two
have a lead row at all.

```sql
with wa as (select distinct right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),9) as tail9,
                   phone, push_name from public.whatsapp_contacts
             where chat_id in (select distinct chat_id from public.processed_messages
                                where processed_at >= now() - interval '7 days'))
select wa.phone, wa.push_name,
       (select l.id from public.leads l
         where right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),9)=wa.tail9 limit 1)
  from wa order by 1;
```

Two matched (38, 122), six unmatched, and one chat id
(`184984711217354@lid`, one message on 4 September) has **no `whatsapp_contacts`
row at all** — the contact upsert did not fire for it. So the path is both
imprecise and unreliable: it invents leads that are not customers and drops
senders it never records.

### 1.7 Where the "writer, not origin" defect actually lives

Read from `n8n-workflows/nexus_master_lead_router_ai_agent.json`, node
**`Persist Lead (deterministic)`**, `POST /rest/v1/leads?on_conflict=email`:

```js
source: 'nexus-master-router'
```

A hard-coded string literal. Two nodes upstream, `Shape Lead For Router` in the
WhatsApp BDC workflow sets `source: 'whatsapp'`, and `Validate & Enrich Input` on
the Router carries it forward as `lead.source` — and then the persist node
throws it away and writes its own name. **The origin is computed correctly, sent
correctly, and discarded at the last node.** Every `nexus-master-router` row in
`public.leads` is that one literal.

The same node also mints the synthetic address
`'+' + digits + '@whatsapp.lead'` when the customer has no email, purely so that
`on_conflict=email` has something to conflict on. That is why
`whatsapp_contacts.lead_email` holds three different shapes today — a real
address, a `@whatsapp.lead` address, and a bare `@lid` chat id — depending on
which writer got there first.

> **Provenance of everything in this section that is about n8n.**
> `n8n-workflows/*.json` is a **30 August 2026 export** (`_index.json`,
> `exported_at: 2026-08-30T18:01:07Z`) and the WhatsApp BDC workflow
> `BiyHk9ZXxJUVGbf6` has changed at least twice since — `ops/n8n-waha-gate/`
> exists because of it. **Treat the export as a hint, never as the live
> definition.** Before any of section 7 is built, the published definitions of
> `BiyHk9ZXxJUVGbf6` and `JnlZFAVmFAuNXVya` must be fetched from the box and
> read. The one node body in this document that *is* current is `Prefilter`,
> because `ops/n8n-waha-gate/prefilter.assignments.md` records it as read from
> the published definition on 7 September, version
> `5a594564-2e77-4deb-9306-3e544b542284`.

---

## 2. The design question: when does a WhatsApp message become a lead?

**This is the decision, and it must be made before a line is built.** Not every
message is an enquiry. Getting it wrong is expensive in both directions and the
two failures do not look alike: too eager fills the CRM with rubbish and the
dealership quietly stops trusting it; too cautious puts a human back in the loop
and the product stops being worth buying.

### The options

**A — every 1:1 inbound from an unknown number becomes a lead.**

- *For:* nothing is ever missed. Zero classification risk. Trivially cheap:
  the branch already exists.
- *Against:* **measured precision zero.** Section 1.6 is what this option
  produces, on production, today: a friend's message, a cosmetics shop and a
  contractor, two of them manually disqualified. And at a dealership the failure
  is worse than noise — a "lead" gets assigned to a salesperson, starts an SLA
  clock, enters pipeline value, and someone phones a stranger.
- *Commercially:* this is the option that ends with the sales manager saying
  "the AI thing puts junk in my pipeline". A dealership will forgive a system
  that misses one enquiry a month. It will not forgive one that makes it call
  its own family.

**B — only messages an AI classifies as a vehicle enquiry become leads.**

- *For:* matches the actual distribution. The classifier is already in the
  workflow — the BDC agent reads every message and has thread history. The
  marginal cost is one strict-JSON call, not a new subsystem.
- *Against:* the classifier will be wrong. On short openers especially: the most
  common first message in the UAE is *"Hi"* or *"السلام علیکم"*, which carries no
  intent at all. A classifier that answers on one word answers noise.
- *Commercially:* defensible to a dealership *if and only if* its mistakes are
  visible and recoverable. A silent classifier that drops a real enquiry is the
  single worst outcome in this product, because the dealership never learns it
  happened.

**C — only after a human confirms.**

- *For:* precision approaching 1. No fabricated customers, ever.
- *Against:* it is the labour NEXUS is sold to remove. It also does not work at
  the hour a UAE enquiry actually arrives — the measured traffic runs to 17:24
  and the Meta/Dubizzle window is evenings and weekends. A confirmation queue
  nobody clears is worse than no capture: the promise is broken *and* the data
  is stale.
- *Commercially:* this is a demo, not a product. "Your WhatsApp enquiries become
  leads automatically, once someone approves each one" is not a sentence anyone
  buys.

### The recommendation

**B, with the classification deciding the PHASE and never deciding whether the
arrival is recorded — plus C available as a recovery, not as the default.**

Concretely, and this shape falls out of the existing phase machine without
inventing anything:

1. **Every genuine 1:1 inbound records a `lead_event`** — one per person per
   dealership, see section 5. Recorded in phase `RECEIVED`, with no `normalized`
   object. Nothing is ever lost, and the funnel is auditable end to end.
   `RECEIVED` already means exactly this: *"accepted at the door, dedup key
   known, customer data not necessarily present"*.
2. **The classifier runs on the conversation so far, not on one message.** If it
   says *enquiry*, the receiver calls `nexus_hydrate_lead_event` (which requires
   phase `RECEIVED` — the contract is already the right shape) and then
   promotes. `leads.source` comes out as the origin, and the audit row door three
   writes says so in words.
3. **If it says *not an enquiry*, nothing terminal happens.** The event stays
   `RECEIVED`. When the same person's next message arrives, the receiver gets
   `was_duplicate = true` with the same `event_id`, re-runs the classifier on the
   longer thread, and hydrates the moment it qualifies. *"Hi"* today and
   *"how much for the Patrol"* tomorrow is one lead, created on the second
   message, with the first message already in the record.
4. **Terminalise only on a timer.** A sweep marks events still `RECEIVED` after N
   days `QUARANTINED` with reason `NOT_A_VEHICLE_ENQUIRY_WITHIN_WINDOW`. Not
   `REJECTED` — the catalogue's own definition of `QUARANTINED` is *"held for
   inspection"*, which is precisely the claim being made.
5. **The dealership sees the held list and can promote from it in one click.**
   That is where option C lives: **a human confirms the machine's refusals, not
   its acceptances.** The count of manual promotions is the classifier's measured
   false-negative rate, which is what lets the threshold be tuned with evidence
   instead of opinion.

**Why this is the commercially correct answer.** The expensive failure is not
"the classifier was wrong". It is "the classifier was wrong and nobody could
tell". This shape makes both error directions cheap: a false positive costs one
CRM card that a salesperson closes, a false negative costs one click from a list
the dealership can see, and both are counted. A dealership can be told the
truth — *"we capture every WhatsApp conversation, we open a lead when it looks
like an enquiry, and everything we did not open is in this list"* — and that
sentence survives being checked.

**One thing this must NOT be allowed to become.** Do not put the classification
into the provenance ladder. "Did something outside NEXUS attest this arrival?"
and "is this message an enquiry?" are two different questions, and `leadingest_06`
already exists because one flag answering two questions made a production walk-in
endpoint impossible to register. Provenance describes the *arrival*. The
classifier describes the *content*. They live in different columns.

---

## 3. Provenance: which existing kind fits, and no new one is needed

A WhatsApp message is not externally attested the way a signed Meta Lead Ads
webhook is, and it is not a person's word the way a walk-in is.

```sql
select kind, is_cryptographic, strength_rank, counts_as_real, is_externally_attested
  from public.lead_provenance_kind order by strength_rank desc;
```

| kind | crypto | rank | counts_as_real | externally_attested |
|---|---|---|---|---|
| `hmac_sha256_x_hub` | true | 90 | true | true |
| `hmac_sha256_svix` | true | 85 | true | true |
| `shared_secret_header` | false | **50** | **true** | **true** |
| `shared_secret_in_body` | false | 30 | true | true |
| `origin_and_form_key` | false | 20 | true | true |
| `operator_recorded` | false | 10 | true | **false** |
| `unverified` | false | 0 | false | false |
| `simulated` | false | 0 | false | false |

**The answer is `shared_secret_header` for WAHA, and `hmac_sha256_x_hub` for
WhatsApp Cloud. Do not invent a kind.**

**Both flags come out right, and that is checkable rather than asserted.**
`shared_secret_header` has `counts_as_real = true`, so
`lead_ingest_endpoint_production_needs_real_provenance` permits a production
endpoint. It has `is_externally_attested = true`, so `v_lead_origin` will not
render a WhatsApp enquiry as *"a person's word, not a signature"* — which would
be wrong, because nobody typed it. And it sits at rank 50 against Meta's 90, so
no screen can present the two as equal.

**Where `is_externally_attested = true` is doing more work than it looks like,
stated plainly.** For WAHA the header secret attests *our own container*, not
WhatsApp. We set `WAHA_WEBHOOK_SECRET`, our WAHA sends it, our n8n compares it.
It proves the request came from the WAHA we run — it does not prove the message
came from a customer, and it certainly does not prove the message is real in the
way Meta's HMAC over its own bytes does. **The 50-vs-90 rank gap is exactly where
that difference is recorded, and it is enough.** A screen that wants to say "how
sure are we" reads `origin_strength`; one that wants to say "did a machine
outside NEXUS vouch for this" reads `origin_externally_attested`; the two
questions already have two columns.

**The new kind that was considered and rejected.** A `transport_attested_self_hosted`
at rank 40, sitting between the body secret and the header secret, would describe
WAHA more precisely than `shared_secret_header` does. It is rejected because:

- every screen, every rank comparison and every invariant would learn a ninth
  value, and the distinction it draws is already drawn by the 40-point gap
  between 50 and 90;
- `lead_source_catalogue.whatsapp_inbound.required_provenance` is already
  `shared_secret_header`, and `lead_ingest_endpoint_production_matches_source`
  binds a production endpoint to exactly that value. Introducing a new kind means
  a second migration to move the catalogue row onto it, for no behaviour change;
- the repo's own rule: an existing kind that fits is used, and a new one is added
  only when an existing one would make a true thing unrepresentable. Nothing here
  is unrepresentable.

**And for the Cloud transport, `hmac_sha256_x_hub` is exactly right and already
implemented.** `ops/n8n-whatsapp-cloud/verify-or-refuse.node.js` verifies
`X-Hub-Signature-256` over raw bytes with a hand-rolled HMAC (the n8n Code
sandbox has no crypto at all — measured, and recorded in
`ops/whatsapp-cloud/README.md`). That is the same proof Meta Lead Ads gives, and
it deserves the same rank.

---

## 4. The endpoint row(s)

### 4.1 One `source_key` or two? The constraint decides it

The tempting answer is one — `whatsapp_inbound` for both transports, because a
dealership does not care which pipe carried the message. **That answer is refused
by the database, and the refusal is correct.**

`lead_ingest_endpoint_production_matches_source` requires
`declared_provenance = required_provenance_for_source` on every production
endpoint, and `required_provenance_for_source` is bound by foreign key to
`lead_source_catalogue.required_provenance`, which for `whatsapp_inbound` is
`shared_secret_header`. So:

- a **Cloud** endpoint on `whatsapp_inbound` would have to declare
  `shared_secret_header`, which is a lie — it downgrades a genuinely
  Meta-signed arrival from rank 90 to rank 50 in every report the dealership
  reads; and
- if it declared the truth, `nexus_record_lead_event` would refuse every event
  with `PROVENANCE_WEAKER_THAN_ENDPOINT_DECLARES`, because that check fires on
  *any* mismatch, stronger or weaker.

The third option — relaxing `..._production_matches_source` for the messaging
family — is not on the table. That constraint is what stops a Meta endpoint
quietly downgrading itself to a shared header.

**So: two source_keys, one per transport.** `whatsapp_inbound` for WAHA (exists),
a new `whatsapp_cloud_inbound` for the Cloud API. They carry the same
`channel_family = 'messaging'`, so the Attribution screen groups them into one
"WhatsApp" bar and the dealership never has to know; and `leads.source` keeps
meaning what is literally true, which is the `leadingest_08` rule — **attribution
never rides in the identity key**.

### 4.2 Proposed catalogue row for the Cloud transport (a migration)

```sql
-- ops/whatsapp-lead-capture: the Cloud transport proves origin differently
-- from WAHA, and lead_ingest_endpoint_production_matches_source will not let
-- one catalogue row express both proofs. Same channel_family, so the
-- dealership's Attribution screen still shows one WhatsApp figure.
insert into public.lead_source_catalogue
  (source_key, display_name, channel_family, integration_status, delivery_shape,
   required_provenance, dedup_field, evidence_note, manual_entry_surface)
values
  ('whatsapp_cloud_inbound',
   'WhatsApp enquiry (Cloud API)',
   'messaging',
   'AVAILABLE',
   'INBOUND_MESSAGE',
   'hmac_sha256_x_hub',
   'wa_message_id',
   'Meta WhatsApp Cloud API. Signed with X-Hub-Signature-256 over the raw bytes, '
   'verified by ops/n8n-whatsapp-cloud/verify-or-refuse.node.js. Separate from '
   'whatsapp_inbound because that row declares shared_secret_header and '
   'lead_ingest_endpoint_production_matches_source binds a production endpoint '
   'to exactly the provenance its source can prove. Same channel_family, so '
   'attribution reads as one WhatsApp figure. Registered 8 Sep 2026 as an '
   'endpoint that has carried zero messages.',
   null);
```

### 4.3 The endpoint INSERTs, every column

Both are proposed **`status = 'disabled'`**. That is deliberate: while an
endpoint is disabled, `nexus_lead_endpoint_for_public_key` returns zero rows and
`nexus_record_lead_event` raises `LEAD_ENDPOINT_UNRESOLVED`. One `UPDATE` arms
it, one `UPDATE` disarms it, and the kill switch needs no n8n change at all
(section 7).

```sql
-- WAHA. The live capture path today.
insert into public.lead_ingest_endpoint (
  tenant_id,
  source_key,
  required_provenance_for_source,
  declared_provenance,
  provenance_counts_as_real,
  environment,
  public_key,
  secret_ref,
  origin_allowlist,
  ingest_address,
  status,
  rate_limit_per_minute,
  label)
select t.id,
       'whatsapp_inbound',
       'shared_secret_header',          -- FK to lead_source_catalogue; must equal the catalogue's value
       'shared_secret_header',          -- production CHECK: must equal the line above
       true,                            -- FK to lead_provenance_kind(kind, counts_as_real)
       'production',
       'alba-prod-whatsapp-waha-default',
       'env:WAHA_WEBHOOK_SECRET',       -- required: shared_secret_header is in the secret_ref list
       '{}',                            -- no browser Origin; this is a server-to-server post
       'https://35.224.126.225.nip.io/webhook/whatsapp-inbound',
       'disabled',                      -- armed deliberately, see section 7
       120,
       'Tenant A - WhatsApp enquiries via WAHA session default'
  from public.tenants t where t.slug = 'alba-cars';

-- Cloud. Registered so the row exists before the traffic does; has carried nothing.
insert into public.lead_ingest_endpoint (
  tenant_id, source_key, required_provenance_for_source, declared_provenance,
  provenance_counts_as_real, environment, public_key, secret_ref,
  origin_allowlist, ingest_address, status, rate_limit_per_minute, label)
select t.id,
       'whatsapp_cloud_inbound',
       'hmac_sha256_x_hub',
       'hmac_sha256_x_hub',
       true,
       'production',
       'alba-prod-whatsapp-cloud-1306545252542419',
       'env:META_APP_SECRET',
       '{}',
       'https://35.224.126.225.nip.io/webhook/whatsapp-cloud-inbound',
       'disabled',
       600,
       'Tenant A - WhatsApp enquiries via Cloud API phone_number_id 1306545252542419'
  from public.tenants t where t.slug = 'alba-cars';
```

### 4.4 The constraints that would refuse a wrong value, named

Every one of these is a row that cannot exist, not a rule someone remembers.

| get this wrong | what refuses it |
|---|---|
| `declared_provenance = 'operator_recorded'` (pretending WhatsApp is typed in) | `lead_ingest_endpoint_production_needs_real_provenance` passes it, but `..._manual_entry_holds_no_secret` refuses it the moment `secret_ref` is set — and without a `secret_ref` there is nothing to verify |
| `declared_provenance = 'simulated'` or `'unverified'` on `environment='production'` | `lead_ingest_endpoint_production_needs_real_provenance` (`counts_as_real = false`) |
| Cloud endpoint declaring `shared_secret_header` on `whatsapp_inbound` | passes registration, then **every event** is refused `PROVENANCE_WEAKER_THAN_ENDPOINT_DECLARES` by `nexus_record_lead_event` |
| WAHA endpoint declaring `hmac_sha256_x_hub` on `whatsapp_inbound` | `lead_ingest_endpoint_production_matches_source` |
| `secret_ref` left null | `lead_ingest_endpoint_secret_ref_required` — both kinds are in its list |
| a short or punctuated `public_key` | `lead_ingest_endpoint_public_key_shape` — `^[A-Za-z0-9_-]{24,128}$` |
| a non-empty `origin_allowlist` | nothing refuses it, and nothing should read it: this is not a browser form. Leave it `'{}'` |
| a `source_key` not in the catalogue | `lead_ingest_endpoint_source_fk` |
| a second dealership reusing a `public_key` | `lead_ingest_endpoint_public_key_key` |

### 4.5 Per tenant, and what the receiver must actually do with the key

**One endpoint row per dealership per transport.** For the second tenant the same
two INSERTs run with a different `slug` and different `public_key` values. There
is no shared endpoint and no default.

**The receiver must put the `public_key` in its own URL and take the tenant from
the row it resolves — never from `body.session`.** This is the whole point of the
endpoint table and it is the open door NEXUS is currently living with:
`POST /webhook/whatsapp-inbound` keys its tenant off `body.session`, which the
caller supplies, and n8n writes as `service_role`, which is `BYPASSRLS`. One JSON
field chooses whose data is written.

Two ways to do it, and the second is better:

- **(a)** WAHA is reconfigured to post to `/webhook/whatsapp-inbound?k=<public_key>`.
  Clean, and it is exactly what the Google receiver does (`?k=` rather than a
  path parameter, because n8n registers a path-parameter webhook under an
  internal `webhookId` prefix and the clean URL 404s — measured, not assumed).
  Cost: a WAHA config change on the VM, i.e. Ali's hands.
- **(b) Recommended.** The workflow resolves the endpoint from
  `channel_registry` first — `nexus_resolve_channel_tenant('whatsapp_waha_session',
  body.session)` already exists and already returns the tenant — and then looks up
  the single active `whatsapp_inbound` endpoint for that tenant. **No, and this is
  the trap:** that still takes the tenant from `body.session`. It moves the
  lookup, not the trust.

So it is (a), and it must be (a). **The `public_key` is a URL fact the caller
cannot choose without being reconfigured, and `body.session` is a body fact the
caller chooses on every request.** The whole endpoint layer exists to make that
distinction; capturing WhatsApp through it while continuing to trust the body
would be building the layer and not using it.

For the Cloud transport the equivalent is already solved differently and
correctly: the tenant comes from `metadata.phone_number_id` **inside the body the
HMAC covers**, resolved through the registered `channel_registry` row. A signed
field is not a caller-chosen field. That is the same shape as `page_id` in
`leadingest_08`, and it needs no `?k=`.

---

## 5. Identity and duplicates

This is where a naive design repeats the worst defect the repo has recorded.

### 5.1 The failure this must not repeat

7 September 2026, staging: five concurrent callers promoting one `lead_event`
with **no email** produced **three `leads` rows — 41, 42, 43 — and every caller
got a success.** `lead_event.lead_id` holds one value, so 41 and 43 became
orphans that no event points at: in the funnel, counted by pipeline value,
carrying a real `source`, and `nexus_lead_trace` answering `arrival = NO_ROWS`,
which reads as *"this customer predates the ingestion layer"* rather than as a
fault. Three salespeople, three CRM cards, one person called three times.

The email case looked safe only because a unique index on `(tenant_id, email)`
refused the second insert — an *incidental* lock. **A unique index does not
constrain NULLs, and the no-email case is the ordinary UAE case: the walk-in, the
phone call, the WhatsApp enquiry.** `20260907190000` fixed it with `FOR UPDATE`
and `ON CONFLICT … DO NOTHING`.

That fix protects **one event promoted many times**. It does nothing about **many
events about one person**, which is exactly what a per-message
`external_event_id` would create.

### 5.2 The choice of `external_event_id`, argued

The obvious key is the WhatsApp message id — the same value `Prefilter` computes
as `message_id`. **It is the wrong key for `lead_event`, and picking it would
manufacture the three-customer defect in slow motion**: the same person messaging
three times in a week produces three distinct ids, three events, three
promotions, three leads. No constraint refuses it, because all three ids are
genuinely different.

Options considered:

| key | one person, three messages | race-safe? | cost |
|---|---|---|---|
| provider message id | **three leads** | yes at the door, no across events | fatal |
| conversation/chat id | one event | requires a "does an open event exist" lookup → read-then-write → race | fatal |
| `'wa:' || <E.164 phone>` | **one event, forever** | **yes, by construction** | a returning customer a year later lands on the existing card |
| `'wa:' || <E.164> || ':' || <month>` | one per calendar month | yes | a message on the 31st and one on the 1st make two leads |

**Recommendation: `external_event_id = 'wa:' || <E.164 phone>`.** One WhatsApp
`lead_event` per person per dealership per transport, for ever.

Why it is race-proof without any new lock: the string is *computed*, not looked
up. Two concurrent deliveries of two different messages from the same number
compute byte-identical keys, `nexus_record_lead_event`'s
`INSERT … ON CONFLICT ON CONSTRAINT lead_event_identity_key DO NOTHING` takes a
speculative-insertion lock, the loser waits for the winner and then re-reads the
row, and both callers get `was_duplicate = true` with the same `event_id`. **No
read-then-write window exists, so there is nothing to serialise.**

Why "for ever" rather than a window: a dealership does not want two CRM cards for
one person. The repo already ships `v_conversations_one_thread_per_person` for
exactly this preference. A re-enquiry twelve months later lands on the existing
card with its full history, and the new conversation is visible in
`communication_logs` and `v_lead_messages` regardless. If Ali wants a fresh card
per buying cycle instead, the monthly-bucket variant in the table above is the
change — one expression, same guarantees — and it is an open question, not a
decision to take here.

**It satisfies the identity CHECK.** `lead_event_external_id_is_not_per_attempt`
forbids `nokey:`, `outreach:`, `exec-`, `run-`, `job-`, `attempt-`, `tmp-`
prefixes and a bare 13-digit clock reading; `wa:+9715…` is none of those, is
stable across every redelivery, and is 3–512 characters.

**And it is honest about what it gives up.** `lead_event` stops being
"one row per arrival" for this source and becomes "one row per enquirer". The
per-message truth has a home already: **`channel_message_events`**, whose
`external_message_id` is the message id, which is `NOT NULL`, and which is empty
today. Populating it is the right place for message-level fidelity, and doing so
in the same change keeps the layering honest: **messages are message-shaped,
enquiries are enquiry-shaped, and neither table pretends to be the other.**

### 5.3 The E.164 the key is built from — and a measured trap

The key is only as good as the phone number. Two facts:

**The chat id contains no phone digits.** All nine chats in the window are `@lid`.
The real number comes from `Info.SenderAlt` via `Extract Message & Sender` and is
filed in `whatsapp_contacts.phone`.

**And that column already holds a value that would produce a wrong number, which
the contract would accept.**

```sql
select '+' || regexp_replace('971556456535:77','[^0-9]','','g') as naive_e164,
       ('+' || regexp_replace('971556456535:77','[^0-9]','','g')) ~ '^\+[1-9][0-9]{7,14}$' as passes_contract,
       public.nexus_lead_normalized_defect(
         jsonb_build_object('full_name','x','phone_e164','+97155645653577')) as verdict;
```

    +97155645653577 | true | (null)

`whatsapp_contacts` holds `phone = '971556456535:77'` for the sender "Syed" — a
WhatsApp **device index suffix**. `Shape Lead For Router`'s existing
`'+' + digits` produces `+97155645653577`, fourteen digits, which **passes
`nexus_lead_normalized_defect` cleanly** because E.164 permits up to fifteen. A
lead would be created on a number that does not exist, and the BDC agent would
message it.

**So the normaliser must split on `:` before stripping**, and must refuse rather
than guess when what is left is not a plausible number. It must also never add a
country code: `nexus_lead_normalized_defect`'s own comment says guessing `+971`
onto a number that was never local is how a dealership messages a stranger — and
the window contains `+918517942172`, an Indian number, which proves the point on
real data.

### 5.4 The three scenarios, answered

**The same person messages three times in a week.** First message: event created,
`RECEIVED`. Second and third: `was_duplicate = true`, same `event_id`, no second
event, no second lead. The classifier re-runs on the longer thread each time, and
the event hydrates and promotes on whichever message first reads as an enquiry.
**One lead. By construction, not by a lock.**

**A person who is already a lead messages again.** Two sub-cases.

- *They became a lead through this same path.* The event is already `PROMOTED`;
  `nexus_record_lead_event` returns `was_duplicate = true` with phase `PROMOTED`
  and the receiver stops. Nothing else happens, and nothing should.
- *They became a lead another way* — a walk-in typed in yesterday with the same
  phone, or a Meta lead. There is no WhatsApp event for them, so one is created,
  and promoting it would make a **second CRM card for one person**. This is
  identity resolution, which `nexus_lead_record_manual` explicitly declined to
  solve, and it must not be solved accidentally here either.

  **Proposal: a fourth door, `nexus_attach_lead_event`.** Before promoting, the
  receiver asks whether a lead with that phone already exists for the tenant. If
  it does, it attaches the event to it instead of creating a new one.

  ```sql
  -- PROPOSED, not applied. Sibling of door three; door three is untouched.
  create or replace function public.nexus_attach_lead_event(
    p_event_id uuid, p_lead_id integer)
  returns table (event_id uuid, lead_id integer, was_already_promoted boolean)
  language plpgsql security invoker set search_path = public as $$
  declare r record; v_tenant uuid;
  begin
    select * into r from public.lead_event
      where public.lead_event.event_id = p_event_id
      for update;                       -- same lock door three now takes
    if not found then raise exception using errcode='NX001',
      message='No lead event with that id.', detail='LEAD_EVENT_NOT_FOUND',
      hint='Record it first.'; end if;
    if r.phase = 'PROMOTED' then
      return query select p_event_id, r.lead_id, true; return; end if;
    if r.phase <> 'HYDRATED' then raise exception using errcode='NX001',
      message='This event is '||r.phase||' and only a HYDRATED event carries a customer.',
      detail='LEAD_EVENT_NOT_HYDRATED', hint='Classify and hydrate it first.'; end if;
    if r.origin_verified = 'unverified' then raise exception using errcode='NX001',
      message='This lead''s origin was never established.',
      detail='PROMOTION_REQUIRES_ESTABLISHED_ORIGIN', hint='Retain it for inspection.'; end if;
    if r.environment <> 'production' then raise exception using errcode='NX001',
      message='This event is '||r.environment||' traffic.',
      detail='PROMOTION_REQUIRES_PRODUCTION_ENVIRONMENT',
      hint='public.leads has no way to say a row is simulated. Same refusal as door three.'; end if;
    select l.tenant_id into v_tenant from public.leads l where l.id = p_lead_id;
    if v_tenant is null then raise exception using errcode='NX001',
      message='Lead '||p_lead_id||' does not exist.', detail='ATTACH_TARGET_LEAD_MISSING',
      hint='Attach only to a lead this dealership can already see.'; end if;
    if v_tenant <> r.tenant_id then raise exception using errcode='NX001',
      message='That lead belongs to another dealership.',
      detail='ATTACH_TARGET_LEAD_OTHER_DEALERSHIP',
      hint='lead_event_guard_lead_tenant_trg would refuse this anyway; refused here with words.'; end if;

    update public.lead_event
       set lead_id = p_lead_id, promoted_at = now(), phase = 'PROMOTED'
     where public.lead_event.event_id = p_event_id;

    -- the audit row, see the note below
    perform public.nexus_lead_ingest_audit(p_event_id, p_lead_id, 'attached');
    return query select p_event_id, p_lead_id, false;
  end $$;

  revoke all on function public.nexus_attach_lead_event(uuid, integer)
    from public, anon, authenticated;
  grant execute on function public.nexus_attach_lead_event(uuid, integer) to service_role;
  ```

  **The audit is the one thing this must not get wrong.** `20260907240000` put
  the audit row *inside door three* precisely so that no receiver could forget
  it, and it *removed* the one `nexus_lead_record_manual` was writing, because
  two writers for one fact is how a count ends up double. A fourth door that
  copies the INSERT re-creates that defect. **So the audit body must be factored
  out of `nexus_promote_lead_event` into `nexus_lead_ingest_audit(...)` and
  called from both.** One derivation, two callers — which is a different thing
  from two derivations, and it is the only shape that keeps
  `20260907240000`'s guarantee intact.

  The lookup that decides promote-vs-attach *is* a read-then-write. It is safe
  here and only here, because with a phone-keyed `external_event_id` there is
  exactly **one** event per person per source, so exactly one decision is ever
  made. The worst race is two deliveries both deciding "attach to lead 122",
  and `FOR UPDATE` plus the already-`PROMOTED` short-circuit makes the second one
  idempotent.

**Two people share a handset.** One phone, one `external_event_id`, one lead.
**This is not solvable from the data and must not be papered over.** Do not split
on `push_name` — it is a display name the sender controls and changes, and the
window already contains one contact whose `push_name` is `._`. State the limit,
surface it where a salesperson can act on it, and let a human split the record.
The alternative — guessing that two names on one number are two customers — is
the same class of mistake as a resolver that guesses a tenant.

### 5.5 How this sits with `processed_messages` and `whatsapp_contacts`

**`processed_messages` stays exactly as it is and stays first.** It is the
message-delivery claim, it is working (36 claims, zero duplicate processing in
seven days), and its ordering property is what makes everything downstream safe:
the lead-event call happens **only on the TRUE branch of `Is New Message?`**, so a
WAHA redelivery never even reaches it. Do not move it, do not merge it into
`lead_event`, and do not remove the deliberate fail-open on `error` — that
fail-open is a judgement already made and written down: losing a real customer's
message is worse than processing one twice.

**`whatsapp_contacts` becomes the phone source of record**, and needs two fixes
this design depends on:

- `message_count` is `0` on all fourteen rows — a counter nothing increments.
  Either increment it or drop it; a column that always reads zero is the
  "unknown rendered as none" defect this codebase has already found in seven
  places.
- one chat in the window has no contact row at all, so the upsert is not
  reliably firing. The lead-event call must not depend on the contact row
  existing; it should take the phone from the message item it already has.

**`channel_message_events` gets populated** by the same branch, via
`nexus_record_channel_event`, so the per-message record exists in the table built
for it rather than being lost when `lead_event` collapses to one row per person.

---

## 6. The marketplace consequence, stated plainly

`lead_source_catalogue.marketplace_dubizzle` records, as a measured fact of
6 September 2026: **no developer portal, no public leads-out API, no webhook, no
Zapier integration**, and the only public API surface is third-party scrapers,
which breach Dubizzle's terms. Its `integration_status` is
`COMMERCIAL_CONVERSATION_REQUIRED` — engineering time spent on it is wasted until
somebody signs something. YallaMotor and CarSwitch look the same.

What a UAE dealer actually receives from a Dubizzle listing is a WhatsApp
message, a phone call, a seller-dashboard entry, or a notification email.

**So once this capability exists, a marketplace enquiry that arrives by WhatsApp
becomes an attributed lead — and the attribution says WhatsApp, not Dubizzle.**

### What may be claimed

- "Enquiries that reach your WhatsApp number become leads in NEXUS
  automatically, whichever listing site the customer found you on."
- "We capture the enquiry the moment it lands, attribute it to WhatsApp, and
  keep the whole conversation on the customer's record."
- "Because Dubizzle and YallaMotor enquiries arrive on WhatsApp, they are
  captured too — as WhatsApp enquiries."

### What may not be claimed

- **"NEXUS integrates with Dubizzle."** There is nothing to integrate with. This
  would be a lie, and it is a checkable one: the first question a technical buyer
  asks is which API, and there is no answer.
- **"We attribute leads to Dubizzle."** We do not. We attribute them to WhatsApp,
  because that is what is true and what the schema will let us write.
- "Dubizzle ROI reporting", "marketplace attribution", "see which listing site is
  performing" — all of these describe a capability that does not exist and that
  no amount of engineering time produces.

### And the database already refuses the lie

This is worth knowing before somebody is tempted. `marketplace_dubizzle` carries
`required_provenance = 'simulated'`, and `simulated` has `counts_as_real = false`.
So `lead_ingest_endpoint_production_needs_real_provenance` makes **a production
Dubizzle endpoint a row that cannot exist**. A WhatsApp enquiry recorded as
`source_key = 'marketplace_dubizzle'` is not a policy violation somebody has to
notice — it is refused by a CHECK.

**Where the marketplace hint does belong.** If the customer's first message
carries a listing URL or a marketplace-generated preamble, that string is real
evidence and should be kept — in `payload_raw` and as an additive field in
`normalized` (e.g. `referrer_hint`). **Never in `source_key`.** `source_key` is
half of `lead_event_identity_key`, and `leadingest_08` already records why moving
attribution into the identity key means the same arrival redelivered no longer
matches the stored row: it inserts again, promotes again, and the dealership gets
two leads for one customer. Attribution is additive; identity is not.

### Honest wording a salesperson can use

> "Dubizzle doesn't give anyone a data feed — there's no API to plug into, and
> any vendor telling you they integrate with it is either scraping, which breaks
> Dubizzle's terms, or telling you a story. What actually happens is your
> Dubizzle enquiries arrive on your WhatsApp. NEXUS captures those the second
> they land, opens the lead, answers the customer, and keeps the whole thread on
> the record — so you stop losing the ones that come in at nine at night. We call
> that what it is: WhatsApp capture."

That sentence survives being checked, and the honesty is a selling point against
a competitor claiming an integration that cannot exist.

---

## 7. The build

**Order matters. Each step is independently reversible, and nothing writes to
`public.leads` directly.**

### 7.0 Before anything — read the live definitions

Fetch and read the published definitions of `BiyHk9ZXxJUVGbf6` (WhatsApp BDC AI
Agent) and `JnlZFAVmFAuNXVya` (Master Lead Router) from the box. **The repo's
`n8n-workflows/*.json` is a 30 August export and at least two nodes have changed
since.** Everything below assumes the live graph, not the export.

### 7.1 Migrations — new code

| # | migration | what it adds |
|---|---|---|
| M1 | `whatsapp_cloud_inbound` catalogue row | §4.2 |
| M2 | `nexus_lead_ingest_audit(...)` factored out of `nexus_promote_lead_event`, which then calls it | one derivation of the audit sentence, ready for a second caller |
| M3 | `nexus_attach_lead_event(uuid, integer)` | §5.4, calls M2 |
| M4 | `nexus_lead_for_phone(uuid, text)` — stable, `service_role`, returns 0 or 1 rows | the promote-vs-attach lookup, refusing an ambiguous tail match the way `v_lead_messages` already does |
| M5 | a sweep marking `RECEIVED` WhatsApp events older than N days `QUARANTINED` with `NOT_A_VEHICLE_ENQUIRY_WITHIN_WINDOW` | §2 step 4; `pg_cron`, and the repo already runs `pg_cron` jobs |

M2 is not optional and is not cosmetic: without it, M3 either duplicates the
audit INSERT (the defect `20260907240000` removed) or writes no audit at all (the
defect it added).

### 7.2 Data — config, one transaction, reversible by `UPDATE`

The two endpoint INSERTs of §4.3, both `status = 'disabled'`.

### 7.3 n8n — where the nodes go

Existing chain, on the live definition:

    WAHA Webhook → WAHA Auth Gate → Prefilter → Is Real Inbound? (TRUE)
      → Claim Message Id → Is New Message? (TRUE)
      → Upsert WhatsApp Contact → … → AI BDC Sales Agent → Send Reply …

New nodes, all on the TRUE branch of `Is New Message?`, running **beside** the
reply path so a database problem never delays the customer's answer:

| # | node | kind | writes |
|---|---|---|---|
| N1 | `Normalize Sender` | Code — **new code** | nothing. Splits `:` off the phone, refuses a non-plausible number, emits `phone_e164`, `wa_message_id`, `push_name` |
| N2 | `Record Channel Message` | HTTP → `rpc/nexus_record_channel_event` — **config** | `channel_message_events` |
| N3 | `Record Lead Event` | HTTP → `rpc/nexus_record_lead_event` — **config** | `lead_event` (`RECEIVED`), or returns `was_duplicate` |
| N4 | `Already Promoted?` | IF — **config** | nothing. Stops when the returned phase is `PROMOTED` |
| N5 | `Classify Enquiry` | LLM, strict JSON, thread-aware — **new code** | nothing |
| N6 | `Is A Vehicle Enquiry?` | IF — **config** | nothing. FALSE branch ends; the event stays `RECEIVED` |
| N7 | `Hydrate Lead Event` | HTTP → `rpc/nexus_hydrate_lead_event` — **config** | `lead_event` → `HYDRATED` |
| N8 | `Existing Lead For Phone?` | HTTP → `rpc/nexus_lead_for_phone` — **config** | nothing |
| N9a | `Promote To Lead` | HTTP → `rpc/nexus_promote_lead_event` — **config** | `leads` (+ audit, inside door three) |
| N9b | `Attach To Existing Lead` | HTTP → `rpc/nexus_attach_lead_event` — **config** | `lead_event.lead_id` (+ audit) |

**Then, and separately, the correction that is worth the most for the least:**

| # | change | kind |
|---|---|---|
| N10 | `Persist Lead (deterministic)` on `JnlZFAVmFAuNXVya`: replace the literal `source: 'nexus-master-router'` with `$json.lead.source` | **config, one field** |
| N11 | the WhatsApp branch stops routing through the Router's persist path — `Shape Lead For Router` runs *after* promotion and passes the known `lead_id`, so the Router scores, alerts and syncs but does not create | **config + small code** |

N10 alone stops the writer's name being written into `leads.source` for **every**
caller of the Router, not just WhatsApp. It changes no schema, no grants and no
graph. It should be the first thing done and it should not wait for any of the
rest of this document.

### 7.4 Arming order

1. Migrations M1–M5 on staging. Prove the classify → hydrate → promote path and
   the classify → hydrate → **attach** path with a positive control each, in a
   rolled-back transaction, the way the ingest layer's other passes were proven.
2. Migrations on production. `nexus_lead_ingest_invariants()` before and after.
3. N10 on the box. Verify with the next lead that `leads.source` is no longer the
   workflow name.
4. N1–N9 published with N3's endpoint still `disabled`. Every request refuses
   `LEAD_ENDPOINT_UNRESOLVED`, which proves the wiring reaches the door without
   creating anything. **The n8n error branch must swallow that specific refusal
   and continue**, or the reply path breaks while the endpoint is dark.
5. WAHA reconfigured to post `?k=alba-prod-whatsapp-waha-default`.
6. `UPDATE lead_ingest_endpoint SET status='active' WHERE public_key='alba-prod-whatsapp-waha-default';`
   and watch the first real conversation through `v_lead_origin`.

### 7.5 Rollback

Three levels, cheapest first:

- **`UPDATE … SET status = 'disabled'` on the endpoint.** Every record call
  refuses `LEAD_ENDPOINT_UNRESOLVED`; no lead events, no leads, no n8n change, no
  deploy. **This is the kill switch and it lives in the database on purpose.**
- **Disable N1–N9 in n8n.** They are additive nodes on a branch; the reply path,
  the claim and the logs are untouched.
- **Revert N10/N11.** One field and one connection.

Nothing here alters `public.leads`, and that is deliberate: an `ALTER TABLE` on
`leads` fires `nexus_guard_born_open_grants()` and strips the live dashboard's
write grants. The repo records that happening once already.

---

## 8. What must NOT be done

Every one of these is a trap this repo has already paid for. They are listed
because the next person building this will be tempted by at least three of them.

1. **Do not write the workflow's name into `leads.source`.** It is the defect
   that started the whole lead-ingest layer, it is still on production in four of
   five rows, and it lives in exactly one string literal (§1.7).
2. **Do not write to `public.leads` directly.** Door three writes the lead *and*
   the audit row in one transaction. A receiver that inserts its own lead creates
   a customer with no record of arriving — measured 7 Sep: **none** of the
   receivers built that week wrote an audit row.
3. **Do not write a second audit row.** If `nexus_attach_lead_event` copies the
   INSERT instead of calling a shared helper, the count doubles. Two writers for
   one fact is the defect `20260907240000` removed from `nexus_lead_record_manual`.
4. **Do not take the tenant from `body.session`.** That is the open door the
   endpoint layer exists to replace, and n8n writes as `service_role`, which is
   `BYPASSRLS`. Take it from the endpoint resolved by the `public_key` in the
   URL. Moving the lookup is not the same as moving the trust (§4.5).
5. **Do not key `lead_event` on the message id.** Three messages become three
   leads, and nothing refuses it (§5.2).
6. **Do not mint an identifier from the clock.** `nokey:`, `exec-`, `run-`,
   `job-`, `attempt-`, `tmp-` and a bare 13-digit reading are all refused by
   `lead_event_external_id_is_not_per_attempt`. The WhatsApp path has done this
   before: `Claim Message Id` minted `'nokey:' + $now.toMillis()`, the CHECK
   refused it, the error fired the fail-open branch, and the message ran the full
   chain **unclaimed** — including a WhatsApp send to a number the caller chose.
7. **Do not carry attribution in `source_key`.** It is half of
   `lead_event_identity_key`. Re-attributing an event by changing it means the
   same arrival redelivered no longer matches the stored row: it inserts again,
   promotes again, two leads for one customer (`leadingest_08`).
8. **Do not record a marketplace enquiry as `marketplace_dubizzle`.** The CHECK
   refuses it, and the claim would be false anyway (§6).
9. **Do not treat all inbound as real.** Groups (`@g.us`), `status@…` and
   `@newsletter` are noise; the 5–6 September sample was 51 messages of it and
   zero customers. `is_real_inbound` is the only gate.
10. **Do not read `$json.body` after `Prefilter`.** It is a Set node with
    `includeOtherFields` **off**, so its four fields are the *entire* item from
    there on. Anything not in `message_id`, `sender`, `direction`,
    `is_real_inbound` is already gone — which is why `_gate` never travels
    further, and why a new node expecting the raw WAHA body will read `undefined`
    and produce nothing.
11. **Do not answer 4XX on a processing failure.** Meta redelivers on 5XX. A 4XX
    is a decision about a real customer, not a formality — the rule Google's
    receiver was built around, and it applies to the Cloud transport identically.
12. **Do not arm `WAHA_WEBHOOK_ENFORCE`** while the gate reads
    `header_present true, ok false` on live traffic. The box is now the only
    sender of `message` events, so enforcing against a mismatching value drops
    **100% of a dealership's inbound WhatsApp**, silently, and the only symptom
    is that the bot stops replying. Verify the secret **in `n8n-worker`**, where
    it is consumed — the box is in `executionMode: queue` and the verification
    and the defect have already been found in different containers.
13. **Do not add a column to `public.leads`.** `ALTER TABLE` fires
    `nexus_guard_born_open_grants()` and strips the dashboard's write grants.
    Route around the guard — the worked example already in `CLAUDE.md`.
14. **Do not guess a country code, and do not trust `'+' + digits`.**
    `+97155645653577` passes `nexus_lead_normalized_defect` and is a wrong
    number (§5.3). Strip the device suffix; refuse what is left if it is not
    plausible; never prepend `+971`.
15. **Do not use the `@lid` chat id, or `push_name`, as identity.** The chat id
    has no phone digits; `push_name` is caller-controlled, and one contact in the
    window has `push_name = '._'`.
16. **Do not treat `n8n-workflows/*.json` as the live definition.** 30 August
    export. `ops/n8n-waha-gate/prefilter.assignments.md` exists precisely because
    the file drifted.
17. **Do not let the classifier decide provenance.** Content and origin are two
    questions; `leadingest_06` exists because one flag answered two.
18. **Do not remove the `error` fail-open on `Claim Message Id`.** It is a
    judgement already made and written down, and reversing it silently would
    trade a duplicate for a lost customer.

---

## Open questions for Ali

Only the owner can decide these.

1. **Is B the right answer?** Section 2 recommends: record every genuine 1:1
   inbound as a `lead_event`, let an AI classifier decide when it becomes a
   *lead*, and give the dealership a visible list of everything held back with a
   one-click promote. The measured alternative — capture everything — has a
   precision of zero on production right now. **Do you accept that some real
   enquiries will sit in a held list until someone clicks, in exchange for the
   CRM never filling with family messages?**

2. **One WhatsApp lead per person for ever, or one per buying cycle?** §5.2
   recommends `external_event_id = 'wa:' || <E.164>` — a returning customer a
   year later lands on their existing card with full history. The alternative is
   a monthly bucket, which makes a fresh card per enquiry cycle. This is a
   dealership-workflow preference, not a technical one.

3. **When a WhatsApp enquirer is already a lead by another route, attach or
   create?** §5.4 recommends attach, via a new `nexus_attach_lead_event`. That
   means a walk-in typed in yesterday and a WhatsApp message today land on one
   card. **Attaching is a write onto a record another salesperson may own** — is
   that acceptable, or should it raise a "possible duplicate" for a human?

4. **Register the Cloud endpoint now, or wait?** §4.2/§4.3 propose registering
   `whatsapp_cloud_inbound` today, `disabled`, even though the Cloud receiver has
   carried zero real messages and `META_APP_SECRET` is unset on the VM. The case
   for registering now is that the row is then reviewed alongside the WAHA one;
   the case against is that this repo has already had to correct "AVAILABLE"
   being read as "connected".

5. **Reconfiguring WAHA to post `?k=<public_key>` is your hands, not mine.** It
   is the step that moves the tenant decision out of the request body. Without
   it, this capability can be built but should not be armed. **Is that
   reconfiguration something you want to do before or after the classifier is
   proven?**

6. **How long is the held window before an unclassified conversation is
   quarantined?** §7.1 M5 needs a number. Seven days is a guess; a UAE buying
   cycle argues for longer, and a tidy funnel argues for shorter.

7. **N10 — the one-field fix — can it go first, on its own?** Changing
   `Persist Lead (deterministic)`'s hard-coded `source` to `$json.lead.source`
   corrects attribution for **every** Router caller and touches nothing else. It
   does not need any of the rest of this document. It also changes what existing
   dashboards render, which is why it is a question rather than a step.

8. **Should the measurement in §1.5 be repeated on a real dealership number
   before this is built?** The 1-in-31 figure comes from your personal handset.
   It establishes the risk; it does not establish a dealership's base rate. A
   week of a real Tenant A sales line would turn a strong argument into a
   measured one — and would be the number to put in front of the second customer.
