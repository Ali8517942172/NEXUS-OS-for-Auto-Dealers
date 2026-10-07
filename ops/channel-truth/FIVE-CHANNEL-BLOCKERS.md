# Six channels — what is actually missing, per source

**Written 17 September 2026 by agent CHANNEL-TRUTH.** Production
`dsvuoovivysszdoiorch` read with `SELECT` only. The n8n box was not touched;
every claim about the box is cited to a repo document or inferred from a
database row that could only exist if the box behaved a certain way.

> **Registered ≠ Connected ≠ Received.** A source with code and no delivery is
> `NOT RUN`. It is never "partially passing". One row below says `LIVE`. One.

---

## The table

| # | Source | 1 · Code exists (tests) | 2 · Trusted tenant mapping — is there a legal place to put it? | 3 · What only Ali can supply (in order) | 4 · Cost | 5 · Status |
|---|---|---|---|---|---|---|
| 1 | **Facebook Lead Ads** | `ops/n8n-meta-lead-ads/verify-and-extract.node.js` (hop 1), `fetch-lead-from-graph.node.js` (hop 2), `normalize-and-redact.node.js` (hop 3), `meta-lead-ads.workflow.json`. Tests: `receiver.test.js` **49 assertions, 49 pass**; `fetch-lead-from-graph.test.js` **46 assertions, 46 pass** (both run 16 Sep 2026, per `ops/n8n-meta-lead-ads/STATUS.md`). Hop 1 is on the box in workflow `JDqy54w2HUH7pHgW`; **hop 2 is not on the box** and `meta-lead-ads.workflow.json` is **not imported**. | `page_id` from the signed webhook body → `lead_ingest_provider_identity(provider='meta', identity_kind='facebook_page_id', identity_value=<page id>)`. **This value is legal today.** Endpoint row exists: `4d4f5cf2…`, public key `alba-prod-meta-leadads-facebook`, `ingest_address` set, `status='disabled'`. `lead_ingest_provider_identity` has **0 rows** — no Page is registered to any dealership. | 1. Name the Facebook Page Tenant A admins and give me its **numeric Page ID**. 2. Generate a **Page access token** with the **`leads_retrieval`** permission for that Page (admin-owned Page + app `1406045581736122` in Development mode needs no App Review). 3. Set `META_PAGE_ACCESS_TOKEN` on the box. 4. Add himself/NEXUS in **Lead Access Manager** on the Page (a token alone is refused without it). 5. Only if the app later leaves Development mode: **Meta Business Verification** + **App Review for `leads_retrieval`**. | **Free** — if and only if the app stays in Development mode and the lead is generated with Meta's **Lead Ads Testing Tool**. A *customer* lead needs paid ad spend. Business Verification itself is free but slow. | `BLOCKED_ON_CREDENTIAL` |
| 2 | **Instagram Lead Ads** | Same three files as row 1. No Instagram-specific code exists; `verify-and-extract.node.js` keys only on `page_id`/`entry.id` (lines 194–207). No Instagram-specific test. | Catalogue says the truth: *"Arrives on the connected Facebook Page's leadgen subscription. There is no separate Instagram webhook."* So the identity is **the same `page_id` as row 1**. But `lead_ingest_provider_identity` has `UNIQUE (provider, identity_kind, identity_value)` and an FK to `(endpoint_id, source_key)` — **one Page ID can point at exactly one endpoint, therefore exactly one `source_key`.** FB and IG are two separate endpoints (`4d4f5cf2…` and `ccb32d53…`, both `disabled`, both on the same `ingest_address`). **A single Page cannot be registered for both `meta_lead_ads_facebook` and `meta_lead_ads_instagram` today.** The escape hatch is `identity_kind='lead_form_id'` (legal) — one row per Instagram lead form — but no code reads `form_id` for routing. | 1. Everything in row 1 first. 2. Decide with me whether IG routes by `lead_form_id` (needs a code change + a row per form) or whether IG leads are simply attributed to `meta_lead_ads_facebook` and the distinction is dropped. 3. The **numeric form ID** of each Instagram lead form. | Free under the same Development-mode condition as row 1. | `BLOCKED_ON_SCHEMA` |
| 3 | **Instagram DMs** | **None.** Zero files. `grep -ril "instagram_manage_messages\|ig_dm\|instagram_dm"` across the repo returns nothing. | **No legal home anywhere.** `channel_registry.channel_type` CHECK allows only `whatsapp_waha_session`, `whatsapp_cloud_phone_number_id`. `channel_message_events.provider` CHECK allows only `waha`, `whatsapp_cloud`, and `channel_message_events_provider_matches_channel_type` welds provider to channel type. `lead_source_catalogue` has **no `instagram_dm` row**. Three separate CHECK constraints must be widened before an Instagram DM can be stored at all. | 1. Confirm this is wanted before I spend a migration on it. 2. **Meta Business Verification** (mandatory — `instagram_manage_messages` is not available in Development mode for non-owned accounts). 3. **App Review for `instagram_manage_messages`** *and* `pages_manage_metadata`. 4. Link the Instagram Professional account to the Page. 5. An IG account that is **Business/Professional**, not Personal. | Free in fees, but **App Review + Business Verification require a real trade licence and a working privacy-policy URL**. Weeks, not hours. | `NOT_BUILT` |
| 4 | **Website — a dealership's own site** | **None for a dealership.** `website_form` exists in `lead_source_catalogue` (provenance `origin_and_form_key`, dedup `submission_id`) but **no endpoint row exists for any tenant**. The only code is simulator scenarios: `ops/lead-simulator/scenarios/f-website-form-clean.js`, `g-website-form-honeypot-bot.js`, `i-malformed-hostile.js`. `ops/site-enquiry/` and `apps/marketing-site/api/lead.js` are **NEXUS's own vendor form on `nexusforautodealers.com`** — not a dealership capture path, and its endpoint migration is still **held** (`ops/site-enquiry/held/20260913T120000Z_…`). | **Schema is ready; nothing is registered.** `origin_and_form_key` is a real provenance kind (`counts_as_real = true`), and `lead_ingest_endpoint_website_needs_origin` already forces `cardinality(origin_allowlist) > 0`. Identity = per-tenant unguessable form key + `Origin` header. No CHECK constraint blocks this. It is a build + register gap, not a schema gap. | 1. The **exact domain** of Tenant A' own website (this becomes the `origin_allowlist` — the constraint refuses an empty one). 2. Someone who can **paste a script tag or a form action into that site** (him, or whoever runs the site). 3. Nothing else — NEXUS owns both ends of this contract. | **Free.** No third party, no review, no licence, no token from anyone. | `NOT_BUILT` |
| 5 | **Phone calls** | **No telephony code anywhere.** The only matches for `twilio\|telephony\|call.track` are a spelling list (`apps/executive-dashboard/lib/vocabulary.js:59`), a settings regex (`screens/settings.js:355`) and a migration comment. Capture surface is a human typing: `apps/executive-dashboard/lib/manual-lead-form.js`. | Endpoint `dcd6ee79…` is **`status='active'`**, `declared_provenance='operator_recorded'`, `ingest_address='dashboard://lead-drawer'`, public key `alba-prod-phonecall-front-desk`. That is honest — it says a person typed it. **But `lead_event` has 0 `phone_call` rows** (the only `lead_event` row in production, ever, is one `walk_in`). For *automatic* capture there is **no legal identity at all**: `lead_ingest_provider_identity.provider` CHECK allows only `meta` and `google`, and `identity_kind` allows only `facebook_page_id`, `lead_form_id`, `google_webhook_id` — **a tracking phone number has nowhere to live.** `channel_registry.channel_type` has no telephony value either. | 1. Decide whether phone stays manual (works today, free) or becomes tracked. 2. If tracked: a **call-tracking / telephony contract** (Twilio, Exotel, or a UAE carrier) with a **UAE number**, which in the UAE requires a TDRA-compliant provider and a trade licence. 3. A per-number → dealership mapping, which needs a schema change first. | **Cannot be free.** Every tracking number is a recurring per-number + per-minute charge, and UAE numbering is licence-gated. Manual entry stays free. | `BLOCKED_ON_SCHEMA` (for tracked capture) — manual entry is `LIVE` but has never been used |
| 6 | **WhatsApp Cloud** | `ops/n8n-whatsapp-cloud/verify-or-refuse.node.js`, `hmac-pure.js`, `receiver.sdk.js`; `ops/whatsapp-cloud/verify-signature.mjs` + `verify-signature.test.mjs` — **26 tests** (`ops/whatsapp-cloud/README.md`). Receiver `J8MXprxVw1yhjBpp` published on the box. | **The correct template, and the only one proven.** `channel_registry` row: `channel_type='whatsapp_cloud_phone_number_id'`, `external_identifier='1306545252542419'`, `status='active'`, tenant `fff6a2b5…`, `credential_ref` present. Resolved via `nexus_resolve_channel_tenant`. **Measured: `channel_message_events` holds 2 inbound rows, provider `whatsapp_cloud`, `origin_verified='hmac_sha256_x_hub'`, 14 Sep 2026 05:26 and 20:14 UTC.** The CHECK `channel_message_events_cloud_requires_signature` makes it impossible to record a `whatsapp_cloud` event any other way, so those two rows are proof Meta signed them. | Nothing to unblock inbound. To move off the **test number** `+1 555 672-4466` onto a dealership's own number: 1. **Meta Business Verification** for Tenant A. 2. A phone number **not already on WhatsApp** (or migrated off). 3. **Display-name approval**. 4. Template approval before any business-initiated message. | Inbound and the first 1,000 service conversations/month are **free**. Business-initiated marketing templates are **paid per conversation** and Business Verification needs a **trade licence**. | `LIVE` |

---

## Environment variables — name and state only, never the value

| Variable | State | How determined |
|---|---|---|
| `META_APP_SECRET` | **SET** | Inferred, box not touched: two `channel_message_events` rows exist with `provider='whatsapp_cloud'`, and the CHECK `channel_message_events_cloud_requires_signature` forbids recording one unless `origin_verified='hmac_sha256_x_hub'`. The receiver answers `500 APP_SECRET_NOT_CONFIGURED` when it is unset (`ops/whatsapp-cloud/README.md`). Signed deliveries landed, therefore it is set. |
| `META_WEBHOOK_VERIFY_TOKEN` | **SET** | Same app (`1406045581736122`). The subscription could not have been created without a passing `hub.challenge`, and `ops/n8n-meta-lead-ads/STATUS.md` records **5 successful GET handshakes** on the Lead Ads webhook. |
| `META_PAGE_ACCESS_TOKEN` | **NOT SET** | `ops/n8n-meta-lead-ads/STATUS.md:50`. |
| `GOOGLE_LEAD_KEY_ALBA` | **NOT SET** | `ops/n8n-google-lead-form/STATUS.md:27`. |
| `NEXUS_REQUIRE_PER_DEALER_SECRETS` | **unset** | `ops/n8n-meta-lead-ads/STATUS.md:50`. |

---

## Schema blockers — the constraints that make a source impossible, not merely unconfigured

These are not config problems. No token, no account and no Ali action fixes any
of them; each needs a migration.

1. **`channel_registry_channel_type_check`** — `CHECK (channel_type IN ('whatsapp_waha_session','whatsapp_cloud_phone_number_id'))`. An Instagram business account ID has no legal value. A tracked phone number has no legal value.
2. **`channel_message_events_provider_check`** — `CHECK (provider IN ('waha','whatsapp_cloud'))`, welded to channel type by `channel_message_events_provider_matches_channel_type`. An Instagram DM cannot be recorded even if one were received.
3. **`lead_source_catalogue` has no `instagram_dm` row** — so an Instagram DM has no `source_key` to be attributed to, and `lead_event.source_key` is FK-bound to that catalogue.
4. **`lead_ingest_provider_identity_key` — `UNIQUE (provider, identity_kind, identity_value)`**, combined with the FK to `(endpoint_id, source_key)`. One Facebook Page ID resolves to exactly one endpoint and therefore one source. **Facebook Lead Ads and Instagram Lead Ads arrive on the same Page subscription and cannot both be registered against that Page.**
5. **`lead_ingest_provider_identity_provider`** — `CHECK (provider IN ('meta','google'))` and **`lead_ingest_provider_identity_kind`** — `CHECK (identity_kind IN ('facebook_page_id','lead_form_id','google_webhook_id'))`. There is no `provider='telephony'` and no `identity_kind='tracking_number'`, so automatic phone capture cannot be routed to a dealership at all.

Sources whose identity has **no legal value** in those constraints today:
**Instagram DMs** (blockers 1, 2, 3) and **tracked phone calls** (blockers 1, 5).
**Instagram Lead Ads** has a legal value but cannot coexist with Facebook Lead
Ads on the same Page (blocker 4).

---

## Cheapest path to a second proven channel

**Facebook Lead Ads.** Five lines of argument:

1. The hard part is already done and *measured*: `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` are live on app `1406045581736122`, proven by two HMAC-verified WhatsApp Cloud deliveries and 5 successful Lead Ads GET handshakes.
2. Hop 1 (`verify-and-extract.node.js`) is already running on the box in workflow `JDqy54w2HUH7pHgW`, and the endpoint row `4d4f5cf2…` already exists with its `ingest_address` populated — only `status='disabled'` stands between it and traffic.
3. `identity_kind='facebook_page_id'` is **already legal** in the CHECK constraint, so a single INSERT registers the dealership; no migration is needed, unlike Instagram DMs or tracked phone.
4. With the app in **Development mode** and the Page **admin-owned**, `leads_retrieval` works with **no App Review and no Business Verification** — and Meta's **Lead Ads Testing Tool generates a genuine signed `leadgen` webhook with zero ad spend**.
5. Everything else on the list needs either money (phone, WhatsApp templates, real ad spend), a migration (Instagram DMs, tracked phone), weeks of Meta review (Instagram DMs), or code that does not exist plus a website he may not control (dealership website form).

**Exact first step:** Ali opens the Facebook Page Tenant A already admins and
sends me **the numeric Page ID** (Page → About → Page transparency, or
`facebook.com/<page>/about_profile_transparency`). Nothing else can start,
because `page_id` is the only per-dealership fact hop 1 can key on, and
`lead_ingest_provider_identity` is empty. Second step, same sitting: generate a
Page access token with `leads_retrieval` in Graph API Explorer and set
`META_PAGE_ACCESS_TOKEN` on the box.

> Honest caveat, to be said out loud: a Lead Ads Testing Tool lead is a **real
> signed delivery from Meta**, and it proves the pipe. It is **not a customer**.
> "We have received a real Facebook lead" and "we have received a real customer
> from Facebook" are different sentences.

---

## What would be a lie to claim today

Each of these is a sentence the evidence does not support. None may reach ad
copy, a landing page, a deck or a sales call.

- ❌ *"We capture leads from Facebook and Instagram."* — `lead_event` contains **zero** rows with a `meta%` source key, ever. Both endpoints are `disabled`. `lead_ingest_provider_identity` has **0 rows**.
- ❌ *"Our Instagram integration is live."* — there is no Instagram code of any kind, and three CHECK constraints would refuse an Instagram DM if one arrived.
- ❌ *"We put a lead form on your website and the leads land in NEXUS."* — no `website_form` endpoint exists for any dealership, and the only website code in the repo is NEXUS's own vendor form, whose endpoint migration is still held.
- ❌ *"Every missed call becomes a lead."* — there is no telephony code, no telephony provider, and no schema column that could map a number to a dealership. Phone is a person typing into a drawer, and **not once has anyone done so**: zero `phone_call` rows in `lead_event`.
- ❌ *"Leads flow in from five channels."* — production has **one** `lead_event` row in its entire history: a single `walk_in`, typed by a person.
- ❌ *"Google Ads lead forms are connected."* — endpoint `disabled`, `ingest_address` NULL, `GOOGLE_LEAD_KEY_ALBA` NOT SET.
- ❌ *"WhatsApp is live for dealerships."* — WhatsApp Cloud is live **on a Meta test number** (`+1 555 672-4466`) for **one** tenant, with **two** inbound messages. True sentence: *"WhatsApp Cloud inbound is proven end to end on our test number; moving a dealership's own number onto it needs Business Verification."*
- ❌ *"Multi-channel lead capture."* — one channel has ever carried a signed inbound message. One.

**The sentence that is true today:** *"WhatsApp Cloud inbound is live and
signature-verified, and it resolves the dealership from the phone number ID.
Every other channel is written and tested but has never received anything."*
