# The status code contract

Google Ads lead forms deliver **at-least-once** and **permanently discard a lead
on any 4XX**. A 5XX is held and redelivered.

So every number this receiver returns is a decision about a real customer, and
the rule is one sentence:

> **If it is our fault, answer 5XX. Only answer 4XX when the identical bytes,
> resent, would fail identically.**

A 4XX on our own bug does not fail loudly. It fails silently, permanently, and
looks from the outside exactly like a lead that was never submitted.

## The contract

| # | Case | NEXUS returns | Whose fault | Google does | Where it is decided |
|---|---|---|---|---|---|
| 1 | Valid new lead, contactable, not a test | **200** `ok` | — | done | `receiver.sdk.js:711-718` (`Respond 200 Lead Created`) |
| 2 | Valid new lead, **is_test: true** | **200** `ok` | — | done | recorded then QUARANTINED, never promoted; `receiver.sdk.js:720-727` |
| 3 | Valid new lead the form left uncontactable (no phone, no email) | **200** `ok` | the dealership's form | done | `verify-and-redact.node.js:266-270` sets `ACCEPT_UNPROMOTABLE`; row is REJECTED with a stated reason. **4XX here would throw away the evidence that the form is broken** |
| 4 | Valid **duplicate** (at-least-once redelivery) | **200** `ok` | — | done | `nexus_record_lead_event` returns `was_duplicate = true` without raising (`20260907190000_…:143-147, 176-181`); `Already Have This Lead?` → `receiver.sdk.js:700-708` |
| 5 | **Wrong or missing body secret** | **403** `GOOGLE_KEY_REJECTED` | caller | **discards** | `verify-and-redact.node.js:146`. The retry carries the same wrong key, so holding it helps nobody |
| 6 | **Missing `k`** in the URL | **404** `NO_ENDPOINT_KEY_IN_URL` | caller | **discards** | `extract-and-shape.node.js:59`. Measured live 7 Sep (README:11) |
| 7 | `k` present but malformed | **404** `ENDPOINT_KEY_MALFORMED` | caller | **discards** | `extract-and-shape.node.js:67`. Shape-checked before any database hit, so a probe costs nothing |
| 8 | **Unknown `k`** — unregistered, **disabled**, or suspended tenant | **403** `GOOGLE_KEY_REJECTED` | **ambiguous — see below** | **discards** | `receiver.sdk.js:730-741`. Byte-identical to case 5 so the key space cannot be enumerated |
| 9 | `k` resolves to a **non-Google** endpoint | **400** `ENDPOINT_IS_NOT_A_GOOGLE_ENDPOINT` | dealership pasted the wrong key | **discards** | `verify-and-redact.node.js:160` |
| 10 | **Malformed JSON** | **422**, from n8n, before our code runs | caller (usually) | **discards** | n8n parses the body first. Our `BODY_NOT_JSON` 400 (`extract-and-shape.node.js:91`) is unreachable on the live path |
| 11 | Body parses but is not an object (e.g. an array) | **400** `BODY_NOT_A_JSON_OBJECT` | caller | **discards** | `extract-and-shape.node.js:96`. Measured live (README:13) |
| 12 | No `lead_id` in the body | **400** `NO_LEAD_ID` | caller | **discards** | `extract-and-shape.node.js:106`. Without it there is no dedup key, so at-least-once cannot be made safe |
| 13 | Raw body not available to the node | **500** `RAW_BODY_NOT_AVAILABLE` | **ours** | retries | `extract-and-shape.node.js:83` |
| 14 | Endpoint active but names **no `secret_ref`** | **500** `ENDPOINT_HAS_NO_SECRET_REF` | **ours** | retries | `verify-and-redact.node.js:121` |
| 15 | **Secret not set on the VM** | **500** `ENDPOINT_SECRET_NOT_CONFIGURED` | **ours** | retries | `verify-and-redact.node.js:129`. Measured live 7 Sep (README:16). **This is the state the box is in today** |
| 16 | **Database down** / PostgREST refuses / RLS refuses | **5XX believed, NOT MEASURED** | **ours** | retries (if it really is 5XX) | All four HTTP nodes carry `retryOnFail: true, maxTries: 3` and `onError: null` (`receiver.sdk.js:563-566`); with `responseMode: 'responseNode'` the workflow errors before any respond node and n8n answers for us. **See the open defect below** |
| 17 | **Concurrent delivery that rolled back** | should be 5XX; reaches the wire as case 16 | **ours** (a race, ours to absorb) | retries | `nexus_record_lead_event` raises `CONCURRENT_RECORD_ROLLED_BACK` with the hint *"Answer 5XX … Answering 4XX here discards a real customer for a race that resolved itself"* (`20260907190000_…:183-190`) |
| 18 | Promotion or the audit insert fails | as case 16 | **ours** | retries; the redelivery finds the recorded event and becomes case 4 | `nexus_promote_lead_event` fails closed — if the audit insert raises the promotion goes with it (`20260907240000_…:29-33`) |

## Cross-check against the function's own hints

`nexus_record_lead_event` states the policy inside its own error hints. I checked
each against the table above.

* **`CONCURRENT_RECORD_ROLLED_BACK`** — hint says "Answer 5XX". Row 17. **Agrees**
  in policy; unproven on the wire, because it can only reach the caller through
  the unmeasured path in row 16.
* **`LEAD_ENDPOINT_UNRESOLVED`** — hint names no status, only "there is no
  fallback tenant on purpose". Row 8 answers 403. **No disagreement**, but see
  the flag below: this is the one place where the right security answer and the
  right lead-preservation answer point in opposite directions.
* **`PROVENANCE_KIND_UNKNOWN`**, **`OCCURRED_AT_IN_THE_FUTURE`**, the normalized
  contract defect — the receiver never sends these: it hardcodes
  `origin_verified: 'shared_secret_in_body'`, sends `p_occurred_at: null`, and
  sends `p_normalized` **only when it has no defect**
  (`receiver.sdk.js:575`). That last one is deliberate and load-bearing: sending
  a defective normalized object would make the function raise, the workflow
  answer 5XX, and Google retry forever a delivery that can never succeed —
  because the dealership's form simply did not ask for a phone number.
* **`PROVENANCE_WEAKER_THAN_ENDPOINT_DECLARES`** — **one disagreement, and it is
  deliberate.** The comment at `verify-and-redact.node.js:156-160` notes that
  this case "nexus_record_lead_event refuses in production anyway, as a 500",
  and then answers **400** ahead of it. 400 is correct: a key pasted from the
  wrong endpoint is the same bytes on every retry. But it means the 400 is held
  in place by a five-line guard in a JavaScript node, and the database underneath
  it would answer the opposite. **If that guard is ever removed, this case
  silently becomes an infinite retry loop against a delivery that can never
  succeed.** It is the only place in this receiver where deleting a check makes
  the system worse than never having had it.

## Two open defects in this contract

**1. Row 16 is not measured, and it is the most important row.**
Every "our fault" case that is not a hardcoded `refuse(500, …)` — the database
being down, a rolled-back race, a failed promotion, a failed audit insert —
reaches Google through n8n's own error answer, not through any respond node we
wrote. That answer is *believed* to be 500. It has never been measured, because
reaching `Record Lead Event` over HTTP needs a registered endpoint **and** a
secret on the box, and neither exists yet (README, "What we do not control").
If n8n answers 4XX there, every one of those cases destroys a real enquiry.
**Measure it during the test-lead run** — TEST-PLAN.md step 7 does exactly this.

**2. Row 8 is our fault and Google cannot tell.**
An unknown key is answered 403 and discarded, which is right when the key is a
forgery. It is catastrophic when the key is unknown because *we* disabled the
endpoint, deleted the row, or suspended the tenant — the dealership's real
enquiries are then destroyed, permanently, at a rate nobody sees, and the log
looks identical to someone probing for keys. The receiver cannot distinguish the
two without leaking which keys exist, so it does not try. The mitigation is not
in the code, it is in the order of operations: **enable the endpoint first,
verify with a test lead, and paste the URL into Google Ads last.** The held
migration says so in its header. Any future "temporarily disable this endpoint"
must be understood as "permanently destroy every enquiry submitted while it is
off", not as a pause.
