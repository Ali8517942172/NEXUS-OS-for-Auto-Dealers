# NEXUS OS — Launch Control Room

**18 September 2026.** Every Evidence cell below came from a `SELECT` against production
`dsvuoovivysszdoiorch` today, or from a request this session watched happen. **Code existing
is not evidence.** A feature is LIVE only when a real row, event or HTTP response proves it.

Status words, and only these: **LIVE · PARTIAL · BLOCKED · NOT_TESTED · NOT_READY · NOT_BUILT**

---

## Rollback point, recorded before anything else

| | |
|---|---|
| `main` at | `e2f7c5fe4179ab40728b0fd8f83baa25be23650f` (`e2f7c5f`) |
| Latest applied migration | `20260917101500` — NX995, appointments |
| Last three migrations | NX990 subscriptions · NX991 multi-tenant fuse · NX995 appointments |
| Rollback method | `git revert` the merge commit and redeploy. **Migrations do not roll back**: NX990/NX991/NX995 are additive (new tables, new functions, two additive UNIQUE constraints on `customer` and `leads`). Nothing was dropped or rewritten, so reverting the app leaves the schema ahead of it harmlessly. |

---

## The board

| Feature | Status | Evidence (production, 18 Sep) | Blocker | Owner |
|---|---|---|---|---|
| Website form → storage | **LIVE** | `nexus_sales_lead` = 4 rows, newest `2026-09-17 04:23:23Z` | — | — |
| Website form → real public traffic | **NOT_TESTED** | all 4 rows are engineering probes (newest `submission_id` = `nx983-post-revoke-probe`) | no member of the public has ever submitted it | Ads |
| Website notification | **NOT_READY** | all 4 rows have `contacted_at IS NULL`; `/api/lead` returns `notified: false` | `NEXUS_NOTIFY_WEBHOOK_SECRET` unset in Vercel; n8n workflow `Oz2W6EWG6n6XW0HQ` exists but is **inactive with no header-auth credential attached** | Ali |
| Hourly lead pager (bridge) | **LIVE** | scheduled task `trig_01RLYf1VmM7MLjgsKFVSadqz`, hourly at :42 | latency up to 60 min; it is a bridge, not the product | — |
| WhatsApp Cloud inbound | **RECEIVING** | `channel_message_events` inbound = 2, newest `2026-09-14 20:14:42Z`, event `f2291be6-f2ea-4571-a680-1180af117b9a`, attested `hmac_sha256_x_hub` | **nothing inbound for 4 days** — proven once, not proven continuously | — |
| WhatsApp outbound / send | **NOT_READY** | send transport is not in n8n at all; every send path returns `DO_NOT_SEND` | no approved template, 24-hour window rule not attested | Ali |
| Facebook Lead Ads | **NOT_TESTED** | `lead_ingest_endpoint.meta_lead_ads_facebook = disabled`; `lead_ingest_secret` empty | Page ID + Page access token + endpoint enable | Ali |
| Instagram Lead Ads | **NOT_TESTED** | `lead_ingest_endpoint.meta_lead_ads_instagram = disabled` | same as Facebook, **plus** FB and IG Lead Ads collide on `UNIQUE(provider, identity_kind, identity_value)` | Ali + writer |
| Instagram DMs | **NOT_BUILT** | no `channel_registry` row for Instagram; no legal identity value for IG DMs in the CHECK constraints | schema gap + Meta messaging permissions | writer |
| Google Ads lead form | **NOT_TESTED** | `google_ads_lead_form = disabled` | per-dealer `google_key` not installed | Ali |
| Phone call — manual intake | **PARTIAL** | `nexus_lead_record_manual(...)` exists with EXECUTE to `authenticated` and an idempotency key; `lead_ingest_endpoint.phone_call = active` | **built and never used once** — `lead_event` holds exactly 1 row in its whole life, and that one is `walk_in`. No structured call direction, outcome, follow-up date or consent field. | writer |
| Phone call — automated capture | **NOT_BUILT** | — | no telephony provider connected | Ali |
| Walk-in intake | **PARTIAL** | `walk_in = active`, 1 `lead_event` on `2026-09-07 09:41:38Z` | used once, three months of nothing since | — |
| Lead assignment | **PARTIAL** | `nexus_lead_assign_owner(p_lead_id, p_to_staff_id, p_reason)`, EXECUTE to `authenticated` | exists; no evidence any lead was ever assigned through it | — |
| Appointment booking | **PARTIAL** | NX995 applied; 4 tables with RLS, 8 functions, double-booking exclusion constraint live. **`appointment` = 0 rows.** | nothing calls the write path; n8n `IsdF6LbuBnq0z3K7` is INACTIVE and has never executed; send transport missing so a customer cannot be told | writer + Ali |
| Audit trail | **LIVE** | `audit_log` = 1,462 rows, newest `2026-09-18 14:00:30Z` | — | — |
| Journeys | **LIVE** | `journey_step` = 16 rows | — | — |
| Dashboard — Channels screen | **LIVE** | shipped PR #26, renders `nexus_channel_status()` | — | — |
| Dashboard — Appointments screen | **LIVE (empty)** | shipped PR #33; production has 0 appointments so it renders its empty state | — | — |
| Meta Pixel | **LIVE** | dataset `859032680532628`; clean-browser test returned **200** on `facebook.com/tr/?id=859032680532628&ev=PageView` | Events Manager date range defaults to a window ending 16 Sep | Ali |
| Billing / subscriptions | **NOT_READY** | NX990 applied; `tenant_subscription` = **0 rows** | no payment processor, no trial sweep, no enforcement — an expired trial keeps working | writer |
| Multi-dealer onboarding | **BLOCKED — deliberately** | `tenants` active = 1 (`alba-cars`) | NX991 fixed the silent fuse, but per-dealer credentials have never been used once (`channel_secret` = 0 rows) | writer |

---

## Two things the board turned up that were not on anyone's list

**1. WAHA is still switched on in production.** `channel_registry` carries two active rows:
`whatsapp_cloud_phone_number_id = active` **and** `whatsapp_waha_session = active`. The binding
architecture decision for this product is ❌ WAHA in production, ✅ Meta WhatsApp Cloud. Either
that row should be `disabled`, or the architecture note is out of date. It is one or the other
and right now the database and the decision disagree.

**2. The lead-ingest plane has carried one event in its entire life.** `lead_event` = 1 row,
`walk_in`, 7 September. Every paid-ads lead — Facebook, Instagram, Google — is designed to land
on that plane, and **no ad lead has ever landed on it**. The WhatsApp traffic that exists arrived
on the *messaging* plane instead. So "our ad pipeline works" is not a claim this database can
support today, for anybody.

---

## Ad-readiness decision

**Website + WhatsApp + Pixel are launchable. The ad-lead path is not proven.**

Running Meta ads to the landing page is safe today: the form durably stores, the Pixel provably
fires, and the hourly pager means a human hears about it within the hour. Running **Facebook or
Instagram Lead Ads** is not safe today, because their endpoints are disabled and nothing has ever
arrived through them — a lead-form ad would collect people Meta holds and NEXUS never receives.

**Send traffic to the landing page, not to a lead form, until the ingest endpoints are enabled and one real test lead has been observed end to end.**

---

## Claims that must not appear in any ad, and why

| Claim | Why not |
|---|---|
| "powers car dealerships" (plural) | 1 active tenant, 0 paying customers |
| "books appointments automatically" | `appointment` = 0 rows; no workflow calls the write path |
| "every lead answered in 60 seconds" | outbound send returns `DO_NOT_SEND`; the pager is hourly |
| "recovered AED X" | no attributed sale exists |
| "all channels live" | 4 of 7 ingest endpoints are `disabled`, Instagram DMs are NOT_BUILT |
| "proven ROI" / "used by hundreds of dealerships" | nothing in this database supports either |

---

*Rule for whoever edits this file next: do not change a status word without pasting the query and
its result underneath. A status without evidence is how this product would start lying to itself.*
