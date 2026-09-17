# Meta Lead Ads — what exists, what is wired, what has ever run

**Written 16 September 2026.** Three columns, kept apart on purpose, because
this directory has previously read as further along than it was.

> **Registered ≠ Connected ≠ Received.** A Meta subscription that verifies is
> not a delivery. A delivery is not a customer. An endpoint marked `active` is
> not a lead. Every row below says which of the three it is.

---

## 1 · The three columns

| piece | code exists | wired (importable / installed / reachable) | ever received a real payload |
|---|---|---|---|
| `verify-and-extract.node.js` (hop 1, HMAC) | **yes** | running on the box inside workflow `JDqy54w2HUH7pHgW` | **handshakes only** — 5 GET executions, 0 POST deliveries |
| `fetch-lead-from-graph.node.js` (hop 2, Graph) | **yes, new today** | **NOT on the box.** It exists only in this repo and in the workflow JSON beside it | **never run against Meta** |
| `normalize-and-redact.node.js` (hop 3) | **yes** | unknown whether the box's copy matches this one | **never** — it has never been handed a Graph response |
| `meta-lead-ads.workflow.json` | **yes, new today** | importable; **not imported** | — |
| `receiver.test.js` | yes | — | 49 assertions, **49 pass** (run 16 Sep 2026) |
| `fetch-lead-from-graph.test.js` | **yes, new today** | — | 46 assertions, **46 pass** (run 16 Sep 2026) |
| `OWNER-RUNBOOK.md` | **yes, new today** | — | **no step in it has been performed** |

**No lead has ever reached this system from Meta.** Not one, from any Page, at
any time.

---

## 2 · Production, measured read-only 16 September 2026

Measured against `dsvuoovivysszdoiorch` with `SELECT` only.

| fact | value |
|---|---|
| `lead_event` where `source_key like 'meta%'` | **0 rows**, ever |
| `lead_ingest_provider_identity` | **0 rows** — no Facebook Page is registered to any dealership |
| `meta_lead_ads_facebook` (`alba-prod-meta-leadads-facebook`) | **`disabled`** |
| `meta_lead_ads_instagram` (`alba-prod-meta-leadads-instagram`) | **`disabled`** |
| both endpoints' `ingest_address` | `https://35.224.126.225.nip.io/webhook/meta-lead-ads` |
| `public.nexus_lead_ingest_secret` | **does not exist yet** (`to_regclass` → null) |
| `nexus_lead_ingest_secret_put` / `_reveal` | **do not exist yet** |

### What that last pair means for the code written today

`fetch-lead-from-graph.node.js` calls `nexus_lead_ingest_secret_reveal` against
the NX980 contract the orchestrator is applying. **At the moment of writing,
that function is not in production.** Until the migration lands, every call to
it returns nothing, `rpc()` catches the failure and returns `null`, and the node
refuses with `NO_PAGE_TOKEN_FOR_THIS_PAGE` — unless
`NEXUS_REQUIRE_PER_DEALER_SECRETS` is unset *and* `META_PAGE_ACCESS_TOKEN` is
set on the box, in which case it falls back. This is fail-closed and readable,
but it is **written against a contract, not against a measured function.** The
argument names, and the four returned columns (`tenant_id`, `endpoint_id`,
`source_key`, `secret`), are **asserted from the brief and not verified against
a live signature.** First thing to check after NX980 lands.

---

## 3 · What cannot be verified from this repository at all

Stated plainly rather than implied by silence:

1. **The GET handshake branch of the new workflow JSON is unverified.**
   `GO-LIVE.md` records a `403 HUB_VERIFY_TOKEN_MISMATCH` measured on the box on
   8 September — but that measured **the box's workflow `JDqy54w2HUH7pHgW`**,
   which is a different artifact from `meta-lead-ads.workflow.json`. Whether
   *this* JSON's webhook node accepts `GET` at all, and whether
   `Respond Without Writing` returns the bare `hub.challenge` as `text/plain`
   the way Meta requires, has **not been executed anywhere**. It is `NOT RUN`,
   not `PASS`.

2. **The raw-body setting is unverifiable from here.** The webhook node in this
   JSON carries `options.rawBody: true`, but whether n8n at the version on that
   box hands the Code node the bytes as `binary.data` or as a `body` string —
   and whether `multipleMethods` with `["GET","POST"]` is accepted by its
   webhook node at `typeVersion 2.1` — can only be learned by importing it. If
   raw body does not arrive, hop 1 answers `500 RAW_BODY_NOT_AVAILABLE` on every
   delivery. That is the correct failure, but it is a failure.

3. **This repository has never held the box's workflow.** There is no export of
   `JDqy54w2HUH7pHgW` anywhere in the tree. So the claim "hop 1 and hop 3 in
   this directory are what the box runs" is an assertion in those files' own
   headers and has never been diffed against the live workflow.

4. **Importing `meta-lead-ads.workflow.json` creates a SECOND workflow.** The
   box already has `JDqy54w2HUH7pHgW` **active** on the path `meta-lead-ads`.
   n8n refuses two active workflows on one webhook path. Whoever imports this
   must decide, deliberately, which one owns the path — and the old one's five
   handshake executions are the only evidence this system has ever spoken to
   Meta at all.

---

## 4 · Things this JSON does that the brief did not name, and why

- **`Resolve Dealership From Page`** sits between `Verify Or Refuse` and
  `Record Lead Event`. It was not in the brief's node list, and without it the
  workflow cannot run at all: `nexus_record_lead_event` takes `p_public_key`,
  Meta's delivery carries no public key and never will, and the only way from
  `page_id` to a public key is
  `nexus_lead_endpoint_for_provider_identity('meta','facebook_page_id',…)`. The
  alternative was hard-coding `alba-prod-meta-leadads-facebook` into the
  workflow, which is a one-dealership system with a multi-tenant label on it.

- **`Signature Verified And Usable?`** routes `CHALLENGE`, `REFUSE`,
  `ACCEPT_UNUSABLE` and `ACCEPT_NO_LEAD` to one respond node. Hop 1 emits four
  non-`ACCEPT` verdicts and all four must not reach `Record Lead Event`.

- **`Respond Without Writing` responds with `text`, not `json`.** Meta's
  handshake wants the bare challenge value; a JSON-quoted `"31337"` fails
  verification. This is the single most likely thing to be wrong in this file
  and it is untested — see section 3.1.

---

## 5 · Defects and doubts in the pre-existing files (not modified)

Reported here rather than fixed, per instruction.

1. **`normalize-and-redact.node.js` uses `$('…').item` while returning an array**
   — the `runOnceForAllItems` shape. In that mode n8n resolves `.item` through
   paired-item tracking and **throws when the pairing is ambiguous**. A Meta
   delivery carrying two leads in one `entry.changes` array (hop 1 explicitly
   emits two items for that case, and `receiver.test.js` tests it) is exactly
   the ambiguous case. The two-lead path is tested at hop 1 and **untested end
   to end**; it is the most likely runtime failure after the ones in section 3.
   `fetch-lead-from-graph.node.js` inherits the same pattern deliberately, for
   consistency — fixing one without the other would be worse.

2. **`verify-and-extract.node.js` reads a single `$env.META_APP_SECRET`,** while
   the WhatsApp Cloud receiver was moved to per-dealer secrets on 14 September
   (ADR-004, NX930). Meta Lead Ads is therefore still single-tenant at hop 1
   even after hop 2 becomes per-dealer today. Dealership number two's
   deliveries will fail `SIGNATURE_MISMATCH`. Hop 2's per-dealer token store is
   necessary but **not sufficient** for a second dealership.

3. **`created_time` is passed to `p_occurred_at` as an ISO string** built by hop
   1 from Meta's epoch seconds. Not verified against what
   `nexus_record_lead_event` expects in that argument.

---

## 6 · The single most likely thing to fail in production

**Lead Access Manager (OWNER-RUNBOOK step 3).** It is a grant in a different
screen from the token, Meta gives no warning when it is missing, and its failure
mode is indistinguishable from success everywhere a human looks: the webhook
arrives, the HMAC verifies, Meta is answered `200`, Meta's own dashboard shows
the lead delivered, and `lead_event` fills with `RECEIVED` rows while no
customer ever reaches a salesperson. `GRAPH_LEAD_ACCESS_NOT_GRANTED` exists as
its own named reason, separate from `code 10` and `code 190`, for exactly this.
