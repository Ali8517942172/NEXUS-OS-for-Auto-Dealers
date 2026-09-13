# Failure modes — what breaks, how it is detected, and whether it fails closed

The question this file exists to answer is not "what can go wrong". It is
**"when this goes wrong, does anybody find out?"** A failure that is refused with
a reason code costs an afternoon. A failure that is silent costs a dealership's
Facebook leads for a month behind a green CONNECTED pill, and that is the defect
class this project is trying to remove.

**Verdict vocabulary:** **CLOSED** — the path stops and says why, in a place
somebody reads. **SILENT** — the path stops or diverges and nothing says so;
discovery depends on a human noticing an absence. **UNKNOWN** — cannot be graded
from this repository, which is itself a finding.

---

## F1 · The `leadgen_id` Graph fetch returns 400

**What happens.** Hop one has already written `lead_event` at `RECEIVED`. Hop two
calls `GET /v25.0/<leadgen_id>` and Meta answers 400 — bad id, a lead outside the
retention window, or lead access not granted on the Page.

**Fails: CLOSED, but only half.** The design is right: an unfetchable lead
terminates at `EXPIRED` with a stated `disposition_reason` and produces **no
`leads` row** (`ops/n8n-meta-lead-ads/GO-LIVE.md:200-206`). No fabricated
customer, no half-lead. `nexus_hydrate_lead_event` also refuses to re-fetch an
event not awaiting hydration (`LEAD_EVENT_NOT_AWAITING_HYDRATION`) so a retry
cannot overwrite what a salesperson is already reading.

**The half that is silent.** Nothing **pages anyone**. The row sits at `RECEIVED`
or `EXPIRED` and the dashboard shows a source that is still `CONNECTED`. Detection
is entirely a human running the stuck-phase query:
```sql
select phase, count(*), min(received_at) as oldest
  from public.lead_event where source_key like 'meta_lead_ads_%'
 group by phase order by phase;
```
**Nobody runs that on a schedule.** Make it a standing check or accept that F1 is
discovered when a dealership asks where their leads went.

**Untested.** The `EXPIRED` branch cannot be reached with the Testing Tool — it
cannot age a lead. A bogus id tests *not found*, a different branch
(`GO-LIVE.md:406-415`).

---

## F2 · The Page access token expires

**Why this is the top risk.** A short-lived Page token expires within hours, a
long-lived one within about two months. **This is not a one-off failure: it is a
dealership's Facebook leads going quiet weeks after go-live with a green
"Connected" pill still on the screen** (`GO-LIVE.md:240-243`). A System User token
is the real answer, and even that is asserted by the README rather than measured.

**Fails: SILENT.** Every event stops at `RECEIVED`. Hop one keeps answering 200 to
Meta, so Meta never retries and never marks the subscription unhealthy. No audit
row is written — the audit row is written by the **promoter**
(`GO-LIVE.md:492-496`), and the promoter is never reached. So the system's own
audit trail contains **no record that anything failed**. The only artefact is a
growing pile of `RECEIVED` rows nobody is looking at.

**The worse variant, and it is indistinguishable.** The token set under a name no
node reads produces the **identical symptom** to no token at all
(`GO-LIVE.md:234-235`). And the name itself is UNKNOWN in this repo — `grep -c
META_PAGE_ACCESS_TOKEN ops/n8n-meta-lead-ads/*.js` = 0 (`GO-LIVE.md:213-215`).

**Detection today:** the same stuck-phase query as F1, run by hand.
**What would make it CLOSED:** an alert on any `lead_event` sitting at `RECEIVED`
for more than N minutes. That does not exist. Until it does, grade F2 SILENT and
say so to any dealership being onboarded.

---

## F3 · Duplicate delivery (Meta retries)

**Fails: CLOSED, and this one is genuinely well built.** `nexus_record_lead_event`
finds the existing row by `(tenant_id, source_key, external_event_id)` and returns
`was_duplicate = true` **without raising** (`GO-LIVE.md:552-558`). Promoting the
same event twice returns `was_already_promoted = true` with the lead count
unchanged — measured on production for the walk-in preflight, 7 September. The
uniqueness is a real constraint, `lead_event_identity_key UNIQUE (tenant_id,
source_key, external_event_id)`, not application politeness.

**Detection:** zero rows from
```sql
select external_event_id, count(*) from public.lead_event
 where source_key like 'meta_lead_ads_%' group by 1 having count(*) > 1;
```

**Two ways this protection is destroyed, both silent:**

1. **Changing `source_key` after the fact.** Moving an event to the Instagram
   endpoint once `ad_platform` is known changes one leg of the unique key, so
   Meta's redelivery of the same `leadgen_id` looks **new** and the dealership
   gets **two customers for one person** (`GO-LIVE.md:687-698`). This is why the
   held migration enables Facebook only.
2. **Recording before verifying.** A forged delivery that claims the identity
   first makes Meta's genuine delivery return `was_duplicate = true` and be
   **silently dropped** — the customer never exists (`GO-LIVE.md:672-680`). The
   receiver's order (verify → resolve → record) is the defence and must not be
   reordered for convenience.

**Untested for Meta.** Idempotency has been exercised on a walk-in, never on a
`meta_lead_ads_%` row. The test plan's redelivery step is its first execution.

---

## F4 · A lead from a Page that is not this tenant's

**Fails: CLOSED, with a three-way lock.** `page_id` is public, so on its own it is
a string an attacker chose. What makes routing on it safe is that it arrived in a
body whose HMAC verified **and** that it is registered in
`lead_ingest_provider_identity` — both, in that order, or neither
(`GO-LIVE.md:53-58`).

`nexus_lead_endpoint_for_provider_identity` requires an **active identity**, an
**active endpoint** and an **active dealership**. Measured on staging with a
positive control: each of the three disabled independently resolves to **zero
rows**, the all-active case to one (`GO-LIVE.md:361-364`). An unregistered Page
therefore resolves to nothing and `nexus_record_lead_event` raises
`NX001 / LEAD_ENDPOINT_UNRESOLVED`. **This is exactly the state production is in
today** — which is why the door is currently shut on real Facebook leads, and
correctly so.

Cross-tenant theft is refused at a second layer: the composite FK
`(endpoint_id, source_key) → lead_ingest_endpoint` means a Page cannot be attached
to another dealership's endpoint, and
`lead_ingest_provider_identity_key UNIQUE (provider, identity_kind,
identity_value)` means **two dealerships cannot register the same Page at all**
(`supabase/migrations/20260907095640_leadingest_08_the_page_decides_the_dealership.sql:32-41`).
An invariant also checks that no promoted event points at a lead belonging to
another dealership (`GO-LIVE.md:518`).

**Where it is quiet rather than closed.** The refusal is `NX001` in an n8n
execution. No alert, no audit row. On day one of a real campaign — before the
owner has supplied the Page ID — **every genuine lead is refused and looks
identical to no leads at all**. The mitigation is ordering, not tooling: register
the Page *before* the campaign runs, and check that the resolver returns one row.

---

## F5 · The form has a field the normalizer does not know

**Fails: CLOSED for identity fields, and DESIGNED-FOR for everything else — with
two real edges.**

The normalizer maps identity by a fixed pick-list: `full_name`/`name`, then
`first_name`+`last_name`; `email`; `phone_number`/`phone`/`mobile_number`/`mobile`;
vehicle from `vehicle_of_interest`/`vehicle`/`car_model`/
`which_model_are_you_interested_in`/`model`/`what_are_you_looking_for`
(`normalize-and-redact.node.js:124-148`). **Anything not in the identity `KNOWN`
set is not dropped** — it is joined into `normalized.message` as
`question text: answer`, so a dealership sees the answers it paid to collect
(`:150-159`). That is the right default and it is the reason this mode is mostly
benign.

**Edge 1 — a differently-named vehicle question, and it is SILENT.** A form asking
*"Which car are you after?"* (`which_car_are_you_after`) matches no vehicle
spelling. The answer still reaches `message`, so nothing is lost — but
`leads.vehicle_interest` is **NULL**, and `nexus_lead_normalized_defect()` never
mentions a vehicle, so **nothing complains** (`GO-LIVE.md:614-626`). The lead looks
complete and the single most commercially useful field is empty. Detection is a
human reading `message` and noticing the car is in there.

**Edge 2 — no email and no phone: CLOSED.** `NORMALIZED_NEEDS_EMAIL_OR_PHONE` (or
`NORMALIZED_FULL_NAME_REQUIRED`) is decided in the node rather than left to a 500
from the promoter (`:161-165`). The event does not promote and the reason is
stated.

**Edge 3 — the constraint-word trap, now CLOSED but it shipped wrong.**
`lead_event_payload_carries_no_shared_secret` is a case-insensitive **whole-word**
match over the serialised payloads and does not distinguish a key from a value.
A customer whose entire answer was `authorization` would have failed the insert
`23514` and **been thrown away** (`GO-LIVE.md:596-612`). Proven both ways on the
box: execution `10879` (old body) refused by Postgres, `10880` (new body)
`annotated_answers: 2` and would insert (`README.md:90-94`). The repair appends a
stated note rather than deleting the answer. **Residual risk:** `GO-LIVE.md`
Unknown 4 — nothing has re-verified that the box actually carries the corrected
body today.

**Edge 4 — a future Meta field: CLOSED by construction.** `hydrated_payload` is an
allowlist we build, not a filtered copy, so a field Meta adds next year does not
arrive by default, credentials included (`normalize-and-redact.node.js:13-28`).
The one wholesale branch is `field_data`, guarded by `scrub()`.

---

## The two failure modes that are already live, silent, and downstream

These are not hypotheticals about a future Meta lead. They are broken on
production **now**, and a successful Meta ingest will flow straight into them.

**F6 · Bitrix24 has not succeeded since 19 August — SILENT.** 7 SUCCESS audit rows
naming returned CRM ids, last `2026-08-19 11:04 UTC`; **10 FAILED** since, last
6 Sep (`ops/evidence-standard/STATUS-LADDER.md:106`). Worse, the link-back PATCHes
`leads?email=eq.…`, so **a phone-only lead never gets its Bitrix id written back
and nothing is logged**. A Meta form collecting a phone and no email hits this by
design, every time.

**F7 · Slack delivery has never been observed — SILENT.** 5 SUCCESS rows whose
summary is the literal string `"Completed"`, last `2026-08-19 11:21 UTC`; 7 FAILED
since (`STATUS-LADDER.md:107`). `STATUS-LADDER.md:171-173` states it plainly: no
system has ever observed a Slack message arriving in a channel. **Do not quote the
five as proof of delivery.** Detection is opening the channel and looking.

---

## Summary

| # | failure | verdict | detected by |
|---|---|---|---|
| F1 | `leadgen_id` fetch 400s | CLOSED, unalerted | manual stuck-phase query |
| F2 | Page token expires / wrong name | **SILENT** | manual stuck-phase query only |
| F3 | Duplicate delivery | **CLOSED** | unique key; zero-dupe query |
| F4 | Page not this tenant's | **CLOSED** | `NX001 LEAD_ENDPOINT_UNRESOLVED` |
| F5 | Unknown form field | CLOSED for identity; **SILENT** for a renamed vehicle question | reading `normalized.message` |
| F6 | Bitrix24 sync | **SILENT**, already broken | audit row naming a CRM id — absent |
| F7 | Slack alert | **SILENT**, never observed | opening the channel |

**Three of seven fail silently, and the two worst (F2, F6) are the ones that show
a dealership a healthy screen over a dead path.** Nothing in this system currently
alerts on a `lead_event` stuck at `RECEIVED`. That single missing alarm is what
separates F1 and F2 from being genuinely closed.
