# Meta Lead Ads receiver — LIVE, and refusing every request

n8n workflow `JDqy54w2HUH7pHgW`, published 7 September 2026.
`GET/POST https://35.224.126.225.nip.io/webhook/meta-lead-ads`

    POST  (no signature, or forged)  ->  500 APP_SECRET_NOT_CONFIGURED
    GET   ?hub.mode=subscribe…       ->  500 VERIFY_TOKEN_NOT_CONFIGURED

That is the design, not a fault. `WAHA Auth Gate` had one defect and it was the
opposite: an unset env var made it *pass everything through*.

**No lead has ever arrived here.** No Facebook Page is registered, ALBA has no
Page, and neither `META_APP_SECRET` nor `META_PAGE_ACCESS_TOKEN` is set.

## The shape, and why it has two hops

Meta's leadgen webhook carries **no customer data at all** — six identifiers
(`leadgen_id`, `page_id`, `form_id`, `ad_id`, `adgroup_id`, `created_time`) and
nothing else. The name, phone and email arrive only from a second call,
`GET /v25.0/<leadgen_id>`, which needs `leads_retrieval` and expires. That is
why `lead_event` has phases, and why the gate's job ends at `RECEIVED`.

    webhook → verify HMAC over raw bytes
            → page_id → lead_ingest_provider_identity → dealership
            → nexus_record_lead_event            (RECEIVED, no customer data)
            → Graph API GET /<leadgen_id>
            → normalize + allowlist
            → nexus_hydrate_lead_event → nexus_promote_lead_event → lead

## Four things worth knowing before changing anything here

**The tenant comes from `page_id`, and `page_id` is public.** On its own it is a
string an attacker chose. What makes it safe to route on is that it arrived
inside a body whose signature verified **and** that it was registered in
`lead_ingest_provider_identity`. Both, in that order, or neither.

**`hydrated_payload` is an allowlist, not a filtered copy.** It is our own object
with only the named fields put in — so nothing Meta adds to that endpoint next
year arrives by default, credentials included. This was written the other way
round first, as a scrub over the whole response, and the test proving the scrub
worked also proved the scrub was never reached. One branch is copied wholesale
and cannot be allowlisted: `field_data`, the customer's own answers. That is the
only door `scrub()` guards.

**A bare credential word anywhere in the customer's answers would have destroyed
the lead — and the first fix here was wrong in both directions.**
`lead_event_payload_carries_no_shared_secret` is a text match over the whole
serialised JSON and does not distinguish a key from a value, so a failed insert
here is a customer who filled in the form and was thrown away. Re-measured
against Postgres on 7 September 2026, and the second measurement corrected the
first:

| shape | constraint |
|---|---|
| a question label of exactly `api_key` | **REFUSES** |
| `API_KEY` in any case | **REFUSES** — the match ignores case |
| a label of `my_api_key` | accepts — a substring never trips it |
| an **answer** of exactly `authorization` | **REFUSES** |
| an answer reading `my api_key is broken` | accepts |
| an answer with the word in escaped quotes | accepts — jsonb escapes them |
| an answer of `api_key` plus one space | accepts |
| the word four levels deep | **REFUSES** |

The fourth row is a defect this receiver shipped with. The first pass guarded
question LABELS only, and guarded them with a SUBSTRING regex — so a real
customer whose whole answer was `authorization` would have been thrown away,
while a harmless label like `my_api_key`, which never trips the constraint, was
renamed for nothing. One wrong rule, wrong in both directions: an embedded word
had been measured and the result generalised to every word.

What actually trips it is a string — key or value, at any depth — that is
**exactly** one of the six words. The rule is now exact-match and lives inside
`scrub()`, which already walks this branch. The repair is the smallest thing
that clears it: the string keeps the word and gains a stated note, because one
trailing character is all the constraint needs and deleting a customer's answer
to satisfy a regex is not a repair. `normalized` — the text a salesperson reads
— is a different column the constraint does not cover and is untouched.

There is deliberately no key-rename branch: all six words are already in
`SECRET_KEYS`, so a key equal to one of them is dropped as a credential before
any repair could run, and a rename branch would be unreachable code pretending
to be a defence. Meta carries the question label as a *value* of `name`, so the
value path is the one that fires.

**And it was proven on the box, both ways, rather than argued.** `test_workflow`
pins the upstream nodes and lets a Code node run for real, so `Normalize And
Redact` could be fed a lead whose answer was exactly `authorization` while
`META_APP_SECRET` is still unset:

| n8n execution | what the node produced | what Postgres does with it |
|---|---|---|
| `10879`, the body deployed before today | the bare word, `annotated_answers` absent | **REFUSED `23514`** — the customer is thrown away |
| `10880`, the body deployed now | the word plus the stated note, `annotated_answers: 2` | **would INSERT** — the lead survives |

The same run also showed `my_api_key_question` left exactly alone, an answer of
`my api_key is broken` left exactly alone, and `050 444 5566` normalised to
`+971504445566`. Fixed body published 7 September 2026; the live URL still
answers `500 APP_SECRET_NOT_CONFIGURED`, so the gate is unchanged.

**Attribution never touches the identity.** Meta delivers Instagram lead ads on
the connected Facebook Page's leadgen subscription, so at `RECEIVED` time nobody
can know which platform it was. The Graph response often says. It is recorded as
`ad_platform`, additive, and must never become `source_key` —
`lead_event_identity_key` is `UNIQUE (tenant_id, source_key, external_event_id)`,
so changing it would make Meta's redelivery of the same `leadgen_id` look new and
hand the dealership two leads for one customer. Absent platform is `UNKNOWN`, not
guessed from the ad name.

## Tests: 49, all passing

`node ops/n8n-meta-lead-ads/receiver.test.js` runs the **deployed node bodies**
through a harness faking `$input` / `$env` / `$()`. It reaches every branch the
live box cannot, because the live box can only ever produce one refusal until a
secret exists.

Covered: the unconfigured refusal and its HMAC self-test with a negative control;
a wrong secret; a body tampered after signing; the subscription handshake and a
wrong verify token; a **WhatsApp delivery arriving on the leadgen URL** (the
likeliest configuration mistake, refused by name and pointed at the right
endpoint); missing `leadgen_id`; missing `page_id`; a non-leadgen Page change;
two leads in one delivery; an Arabic name; `first_name`+`last_name`; a UAE `05x`
number; an unparseable number reported rather than repaired; Instagram reported,
absent, and an unrecognised value; the allowlist against a top-level token, a
nested `client_secret` and an unknown future field; a credential-named question;
a token-shaped answer; an answer that is exactly a constraint word; a label that
merely contains one and must therefore be left alone; and both promoter refusals.

The harness also **throws if a node body references an upstream node the workflow
does not have**. That caught a real defect: `Normalize And Redact` read
`event_id` from `Verify Or Refuse`, which never has one — it comes from
`Record Lead Event`. It would have hydrated `undefined` on the first real lead.

Measured on the box, execution `10848`:
`hmac_selftest: {vectors: 3, failed: 0, negative_control_rejects: true, ok: true}`,
and `previousNodeOutput: 1` — the POST output is connected. On the Cloud receiver
that connection was missed and every real delivery ran no nodes at all while
returning a healthy-looking `200`.

## The audit row is written by door three, not by this workflow

Measured 7 September 2026: `grep -c audit_log` over this directory returned
**0**, and the workflow's own graph goes `Promote To Lead -> Respond 200
Promoted` and stops. A real customer would have arrived with no row in the table
a dealership reads to answer "what happened".

It is fixed in `nexus_promote_lead_event` rather than here, deliberately: a
receiver that audits itself audits one receiver, and there are four of them plus
manual entry. Nothing needs adding to this workflow — the row appears the moment
a lead is promoted, and it names the source and spells out whether the origin was
attested by the provider or rests on a person's word.

## Registered, verified and active are three separate refusals, and all three hold

Measured on staging with a positive control first, in a rolled-back transaction:

| state | resolves? |
|---|---|
| page identity active, endpoint active, dealership active | **1 row** — the control |
| page identity `disabled` | 0 rows |
| endpoint `disabled` (page still active) | 0 rows |
| dealership `suspended` | 0 rows |

So the `disabled` state the two Meta endpoints sit in today is a real lock, not a
label: re-enabling them is a deliberate act, and until it happens a delivery from
a registered Page still resolves to nothing.

## What Ali has to do before this can carry anything

1. A **Facebook Page** for the dealership, with a **lead form**.
2. On the VM: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, and
   `META_PAGE_ACCESS_TOKEN` (a Page token with `leads_retrieval`; the short-lived
   one expires, so a System User token is the real answer).
3. In the Meta app: subscribe the Page to the **`leadgen`** field with callback
   `https://35.224.126.225.nip.io/webhook/meta-lead-ads`. Keep it distinct from
   the WhatsApp callback — crossing them is refused, by name, but it wastes a
   day.
4. Register the Page against the dealership:

       select public.nexus_register_channel is NOT this one — use:
       insert into lead_ingest_provider_identity
         (endpoint_id, source_key, provider, identity_kind, identity_value, label)
       values ('4d4f5cf2-f966-4d4e-9d9e-605757c615b7', 'meta_lead_ads_facebook',
               'meta', 'facebook_page_id', '<the Page id>', 'ALBA CARS page');

   and re-enable that endpoint (`status='active'`), which is deliberately
   `disabled` today precisely so the dashboard cannot claim Facebook is connected
   while nothing can arrive.
5. Then fire Meta's **Lead Ads Testing Tool**, which sends a real webhook and
   costs nothing.
