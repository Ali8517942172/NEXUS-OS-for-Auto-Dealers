# The schema half is fixed. The other half is not ours.

**Written 18 September 2026 by agent CHANSCHEMA.** One migration:
`supabase/migrations/20260918161500_nx998_a_page_and_an_instagram_account_were_the_same_identity.sql`.
Applied and proved on **staging `wwspuxrbiyagnrnzgate`**. **Not applied to
production `dsvuoovivysszdoiorch`**, which was read with `SELECT` only.

`ops/channel-truth/FIVE-CHANNEL-BLOCKERS.md` listed five schema blockers and
said, correctly, that no token and no Ali action could move any of them. NX998
moves all five. It moves nothing else, and that distinction is the whole point
of this document: **a source that is now legal is not a source that is now
working.** Not one channel was enabled. Not one endpoint changed status.

---

## What became legal

| Blocker (FIVE-CHANNEL-BLOCKERS §"Schema blockers") | What NX998 did |
|---|---|
| 1 · `channel_registry_channel_type_check` refused an Instagram account | `channel_type` now admits `instagram_account_id`. Telephony deliberately **not** added — see below. |
| 2 · `channel_message_events_provider_check` refused an Instagram DM | `provider` admits `instagram_dm`, welded to `channel_type='instagram_account_id'`, and a new CHECK `channel_message_events_instagram_requires_signature` means an Instagram DM cannot be recorded unless `origin_verified='hmac_sha256_x_hub'` — the same discipline that makes the two WhatsApp Cloud rows evidence rather than assertion. |
| 3 · no `instagram_dm` row in `lead_source_catalogue` | Added, `integration_status='NOT_ESTABLISHED'`. A second row `phone_call_tracked` was added at `COMMERCIAL_CONVERSATION_REQUIRED`. Both are **names**, not doors: no endpoint exists for either, and the migration refuses to commit if one does. |
| 4 · `UNIQUE (provider, identity_kind, identity_value)` made FB and IG Lead Ads mutually exclusive on one Page | Replaced. See "the new key" below. |
| 5 · `provider` allowed only `meta`/`google`; `identity_kind` allowed only three Meta/Google values | `provider` admits `telephony`; `identity_kind` admits `instagram_account_id` and `tracking_number`. A tracked number finally has somewhere to live. |

`identity_value` did **not** need widening: it is digits-only
(`^[0-9]{5,32}$`), an Instagram Professional account id is a 17-digit number,
and a phone number is stored as **E.164 digits with no leading `+`** — exactly
the shape `channel_message_events.customer_phone` has always required. One
extra CHECK says a `tracking_number` must look dialable (`^[1-9][0-9]{7,19}$`).

---

## The new key, and why it is the right one

**Old:** `UNIQUE (provider, identity_kind, identity_value)`
**New:** `UNIQUE (provider, identity_kind, identity_value, source_key)`
plus `EXCLUDE (provider =, identity_kind =, identity_value =, tenant_id <>)`.

A `page_id` is the identity of a **Meta webhook subscription**, not of a lead
source. Facebook Lead Ads and Instagram Lead Ads arrive on the *same* Page
leadgen subscription, and the leadgen webhook carries no platform
discriminator at all — the surface is only knowable at **hop 2**, from the
Graph lead object's `platform` field (`fb` / `ig`). So the surface belongs in
the key. `source_key` was already a column, already foreign-keyed to the
endpoint and already CHECK-welded to the provider; it was simply missing from
the key.

Relaxing a UNIQUE cannot reject a row that the stricter one accepted, so this
half is additive by construction. But the old key protected something real
**by accident**: two dealerships could not claim the same Page. That is
restored **on purpose** as an exclusion constraint, which needs `tenant_id` on
the row — a new column, backfilled from the endpoint and held there by
`lead_ingest_provider_identity_tenant_fk` referencing the endpoint's own
`(endpoint_id, tenant_id)` unique key, so it cannot name a dealership the
endpoint does not belong to. NX995's tenant-carrying-FK pattern. It is a
constraint and not a trigger and not caller discipline because every receiver
runs as `service_role`, which carries `rolbypassrls`.

And a Page is still not an Instagram account. `identity_kind` gains
`instagram_account_id` — the numeric id that arrives as `entry.id` on the
Instagram messaging webhook, the Instagram-scoped id of the **business** side
of the conversation. A further CHECK says a `facebook_page_id` may claim
either lead-ads surface and **never** an Instagram DM, and an
`instagram_account_id` may claim an Instagram DM or Instagram Lead Ads and
never Facebook Lead Ads. The *customer's* IGSID is deliberately given no home:
this table maps an identity to a dealership, and the customer is not the
dealership.

A second accessor,
`nexus_lead_endpoint_for_provider_identity(provider, kind, value, source_key)`,
lets hop 2 ask the narrow question once it knows the surface. **The existing
three-argument accessor was not touched** — not its body, not its grants. For
a dual-registered Page it now returns one row per surface, which is the truth.

---

## Staging proof

Two dealerships (`zz-test-tenant-a`, `zz-test-tenant-b`), ten endpoints, eight
provider identities, five capture surfaces each. Everything below ran inside a
transaction that **rolled itself back**; staging carries no residue (verified:
0 provider identities, 4 endpoints, exactly as before).

| # | Assertion | Result |
|---|---|---|
| 1 | One `page_id` registered on **both** lead-ads surfaces | 2 rows — previously impossible |
| 2 | 4-arg accessor, facebook surface / instagram surface | 1 row / 1 row |
| 3 | 3-arg accessor, surface unknown | 2 rows, both the same dealership |
| 4 | Tenant B's page resolving to tenant A | 0 rows |
| 5 | Tenant B's tracked number | 1 row, tenant B |
| 6 | Tenant B claiming tenant A's page on the **other** surface | refused, `23P01` by `lead_ingest_provider_identity_one_dealership_per_identity` |
| 7 | An identity naming a tenant its endpoint does not belong to | refused, `23503` by `lead_ingest_provider_identity_tenant_fk` |
| 8 | Exact duplicate on one surface | refused, `23505` |
| 9 | `facebook_page_id` claiming `instagram_dm` | refused, `23514` |
| 10 | `tracking_number` written as `+971...` | refused, `23514` |
| 11 | **Registered identity, DISABLED endpoint** | **0 rows** — the same empty refusal as before, 3-arg and 4-arg alike |
| 12 | Unregistered page id / tracking number / Instagram account | 0 rows / 0 rows / 0 rows |
| 13 | `website_form` endpoints with a non-empty origin allowlist | 2 |

The migration's own verify block compares a census taken at the top of its
transaction against the state at commit: identity rows, endpoint rows, **a
per-row fingerprint of every endpoint's status**, channel rows and their
statuses, message-event rows. If any of them moved, it rolls back. **Enabling
a channel stays a deliberate `UPDATE` by a person holding the credential.**

---

## What is deliberately NOT in this migration

* **Telephony gets no seat in `channel_registry` or `channel_message_events`.**
  A call is not a message. Those tables are welded to message semantics —
  `message_kind`, `external_message_id`, a signature CHECK — and pushing calls
  through them would make "messages received" silently count ringing phones. A
  tracked number's only legal home is `lead_ingest_provider_identity`, a
  routing table, plus its own catalogue row.
* **Nothing was added to `channel_provider_capability` or
  `channel_provider_rank`.** Those describe what NEXUS can **send**. Nothing
  here can send an Instagram DM, so nothing here appears as a send option.
* **`source_key='phone_call'` is untouched.** Manual phone entry still works,
  still free, and still has never been used — zero `phone_call` rows in
  `lead_event`.
* **No endpoint was created, enabled or modified.** The two Meta Lead Ads
  endpoints on production are still `status='disabled'`.

---

## What is STILL blocked — and by whom, not by us

Nothing below is a schema problem any more. None of it is ours to fix.

### Blocked by Meta

| Source | What is missing | Who supplies it |
|---|---|---|
| **Facebook Lead Ads** | `META_PAGE_ACCESS_TOKEN` with `leads_retrieval`; the numeric Page ID; the NEXUS user added in the Page's **Lead Access Manager** (a token alone is refused without it); hop 2 `fetch-lead-from-graph.node.js` imported on the box | **Ali**, in one sitting. Free while the app stays in Development mode and leads come from Meta's Lead Ads Testing Tool. |
| **Instagram Lead Ads** | Everything above, plus the decision of whether IG leads route by the Page (now legal alongside Facebook) or by their own Instagram account id | **Ali** + **Meta** |
| **Instagram DMs** | `instagram_manage_messages` **and** `pages_manage_metadata` via **App Review**; **Meta Business Verification** (not available in Development mode for this); an Instagram **Professional** account linked to the Page; and Instagram receiver code, which does not exist in this repository at all | **Meta**, weeks not hours. Business Verification needs a real trade licence and a live privacy-policy URL. |
| **WhatsApp Cloud on a dealership's own number** | Business Verification, a number not already on WhatsApp, display-name approval, template approval | **Meta**. Inbound on the test number is already live and signature-verified. |

### Blocked by a telephony provider

**Tracked phone calls.** The schema can now map a dialled number to a
dealership; nobody can sell us the number from here. A UAE tracking number
requires a **TDRA-compliant carrier**, a **trade licence**, and a **recurring
per-number and per-minute bill**. There is also still **no telephony code
anywhere in the repository** — no receiver, no signature check, no normaliser.
`phone_call_tracked` is `COMMERCIAL_CONVERSATION_REQUIRED` because that is a
purchase decision, not an engineering task.

### Blocked by nobody — and therefore the cheapest thing left

**The dealership website form.** It was never a schema gap and still is not:
`website_form`, `origin_and_form_key` and the non-empty-origin constraint have
all been ready for weeks. What is missing is the **exact domain** of the
dealership's site and **somebody who can paste a form action into it**. No
third party, no review, no licence, no token. Staging proof row 13 shows two
dealerships' website endpoints standing up with real origin allowlists.

---

## Before this reaches production

1. Apply NX998 to `dsvuoovivysszdoiorch`. It is additive and its verify block
   will roll itself back rather than commit a surprise.
2. `lead_ingest_provider_identity` gains a `tenant_id` column, so
   `apps/executive-dashboard/QUALITY_GATE.mjs` needs its snapshot retaken with
   `--refresh-schema` against production afterwards. Do **not** hand-edit that
   block; the file says so itself and it is right.
3. The sentence that stays true until a Page ID and a token arrive: *"WhatsApp
   Cloud inbound is live and signature-verified. Every other channel is
   written, tested, and now legal in the database — and has still never
   received anything."*
