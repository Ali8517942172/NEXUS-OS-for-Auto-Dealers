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

**A Meta form question named `api_key` would have destroyed the lead.**
`lead_event_payload_carries_no_shared_secret` is a text match over the whole
serialised JSON and does not distinguish a key from a value, so that question
name fails the insert — and a failed insert here is a customer who filled in the
form and was thrown away. Measured against Postgres, not reasoned about:

| shape | constraint |
|---|---|
| `{"name":"api_key"}` | **REFUSES** |
| `{"name":"q__api_key"}` | accepts |
| an *answer* containing the word in quotes | accepts anyway — jsonb escapes the inner quotes |

That last row killed a defence already written: a pass rewriting the word inside
string values guarded a case Postgres proves cannot occur, at the cost of editing
a customer's own words. It is gone. Only the question **label** is renamed, only
on a real collision, and the rename is recorded.

**Attribution never touches the identity.** Meta delivers Instagram lead ads on
the connected Facebook Page's leadgen subscription, so at `RECEIVED` time nobody
can know which platform it was. The Graph response often says. It is recorded as
`ad_platform`, additive, and must never become `source_key` —
`lead_event_identity_key` is `UNIQUE (tenant_id, source_key, external_event_id)`,
so changing it would make Meta's redelivery of the same `leadgen_id` look new and
hand the dealership two leads for one customer. Absent platform is `UNKNOWN`, not
guessed from the ad name.

## Tests: 44, all passing

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
a token-shaped answer; and both promoter refusals.

The harness also **throws if a node body references an upstream node the workflow
does not have**. That caught a real defect: `Normalize And Redact` read
`event_id` from `Verify Or Refuse`, which never has one — it comes from
`Record Lead Event`. It would have hydrated `undefined` on the first real lead.

Measured on the box, execution `10848`:
`hmac_selftest: {vectors: 3, failed: 0, negative_control_rejects: true, ok: true}`,
and `previousNodeOutput: 1` — the POST output is connected. On the Cloud receiver
that connection was missed and every real delivery ran no nodes at all while
returning a healthy-looking `200`.

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
