# CRM synchronisation — three silent corruptions, and what replaces them

Scope: `wf_108 ERP Sync - Bitrix24 CRM` (`bxNBzBrcOtcFpMPn`, 14 nodes) and
`Customer 360 - Data Aggregation (Bitrix24)` (`AZkGM5M4c1uzSH7S`, 11 nodes).

All three defects share one shape: **the system writes an assertion it never
earned.** A lead it never looked up. A comment field it never read. A count it
never measured. None of them throw, so none of them appear in `audit_log` as
anything other than SUCCESS. The fixes are all the same rule applied three
times — *do not write what you could not read* — plus one decision about who
owns which field.

Apply order: `migration.sql` → `OPERATIONS_erpsync.json` →
`OPERATIONS_customer360.json`.

---

## Defect 1 — a duplicate Bitrix lead per phone-only customer, per run

### What is actually happening

`Find Existing Lead` posts to `crm.lead.list` with

```
filter: { EMAIL: $json._lead_email || '__none__' }
```

Three separate failure modes ride on that one line.

1. **The email is synthetic.** The Master Router mints
   `'+' + phone.replace(/[^0-9]/g,'') + '@whatsapp.lead'` for every customer who
   arrives on WhatsApp without an address (`nexus_master_lead_router_ai_agent.json`,
   three call sites). That string is a routing key. It is not in Bitrix, because
   no human ever typed it there. So the filter misses, `existing_id` is null,
   `Already in Bitrix24?` takes the false branch, and `crm.lead.add` mints a new
   record. In a Dubai dealership that is not an edge case; it is most of the book.
2. **The email is absent entirely** → the literal `'__none__'` → same miss, same
   create.
3. **The lookup fails.** The node runs `onError: continueRegularOutput`, so a
   Bitrix 403 (the portal currently answers `403 FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN`
   — see RISKS §1) or a timeout arrives as *data*, `result` is undefined,
   `found` is null, and the code cannot tell "no such lead" from "I never
   asked". It creates.

`Fetch HOT Leads from Supabase` then multiplies it: `returnAll: true` filtered
only on `status = HOT`, with no watermark, so **every hot lead ever recorded**
is re-pushed on every invocation. N runs over M phone-only hot leads produce
N×M Bitrix leads. The `Delivery Report` even documents the hazard in a comment —
and then marks the lookup `critical: false`, so the audit row still says SUCCESS.

### The identity key: phone first, and why

**A UAE dealership's customers are identified by phone.** Email is optional,
frequently absent, frequently a throwaway, and — in this system — frequently
fabricated. Phone is how the customer contacted us, how the rep calls back, and
what is already typed into Bitrix. The sync now resolves identity in this order:

| # | Key | Source | Why it ranks here |
|---|-----|--------|-------------------|
| 1 | `leads.bitrix_lead_id` | our own crosswalk, written after a **confirmed** write | An id we verified ourselves beats any search. Uniquely, it still matches after the customer changes number — no lookup can do that. |
| 2 | **Phone** | `crm.duplicate.findbycomm` `type=PHONE` | The real-world identity of a UAE car buyer. |
| 3 | **Email** | `crm.duplicate.findbycomm` `type=EMAIL` | Only ever a fallback, and **only for a real address**. The synthetic `@whatsapp.lead` form is replaced by a sentinel that matches nothing — asking Bitrix about an address no human typed is the original bug. |

### Why `crm.duplicate.findbycomm` and not `crm.lead.list`

`crm.lead.list` filters on the literal stored string. `crm.duplicate.findbycomm`
queries **Bitrix's own duplicate-control index**, which is built over normalised
communication values — the same index the Bitrix UI uses when it warns a rep
"this lead may already exist". Using it means we agree with Bitrix about who is
a duplicate instead of inventing a second, weaker opinion.

### Differently-formatted numbers

Normalisation is not left to trust. `Map Lead to Bitrix24 Lead` offers
`findbycomm` **every spelling of the same number a human might have typed**, and
Bitrix matches on any of them:

```
+971 50 123 4567 → ["+971501234567","971501234567","0501234567","501234567"]
0501234567       → ["0501234567","+971501234567","971501234567","501234567"]
+9714 3212345    → ["+97143212345","97143212345","043212345","43212345"]
```

Two deliberate restraints, both verified against the generator:

* **We never fabricate a country code.** `+918517942172` (a real number in the
  J1 runbook) yields only `["+918517942172","918517942172"]`. Manufacturing a
  `+971918517942172` variant would be asking Bitrix about *somebody else's*
  number, and a false-positive match is worse than a duplicate: it welds two
  customers into one record.
* **We never emit `+0…`.** A leading zero is a national trunk prefix, not a
  country code.

The UAE variants are generated only for shapes that are recognisably UAE:
`971` + 8 or 9 digits, `05xxxxxxxx`, `0xxxxxxxx`, or a bare `5xxxxxxxx`.

### A failed lookup is no longer a licence to create

`Decide Update or Create` now distinguishes **failed** from **not found**. A
probe is "failed" when its item carries `error`, when the node did not run, *or*
when the response has no `result` key at all (a Bitrix REST error can arrive with
HTTP 200). If either probe failed and no id was resolved, `write_mode` becomes
`create_blocked`, the new `Safe to Create?` gate routes past both Bitrix writes,
and the run audits **FAILED** with the reason. `crm_synced_at` is not stamped,
so the next invocation retries. **Not writing is recoverable; a duplicate is not.**

The same gate refuses to create a lead that carries *neither* a usable phone nor
a real email. Such a record can never be matched again, so creating it
guarantees a duplicate for that human on the next run. We would rather have a
FAILED audit row naming the problem than a CRM record nobody can ever
de-duplicate.

### The backlog

`Fetch HOT Leads from Supabase` becomes a PostgREST read:

```
status=eq.HOT
or=(crm_synced_at.is.null,crm_synced_at.lt."<now-6h>")
order=created_at.desc
limit=100
```

`returnAll: true` on a growing table is a real memory problem on a 958 MB
e2-micro with production concurrency 2. But the binding constraint is actually
**Bitrix's rate limit**, roughly 2 req/s per webhook: at up to three REST calls
per lead, 100 leads is ~150 s, inside the 300 s `executionTimeout`. That is
where the limit of 100 comes from. It is written as an HTTP node because the
Supabase node ANDs its `keyName/condition` filters and cannot express `or=()`.

Note what the watermark is *not* doing: it is no longer load-bearing for
correctness. Once identity resolution works, a repeat sync is an **update**, and
updates are now idempotent no-ops (below). The watermark is a cost control.

### Closing the loop

New `Link Back to Supabase` PATCHes `leads` on a **SUCCESS** verdict only,
setting `bitrix_lead_id` and `crm_synced_at`. When there is nothing to stamp it
targets `email=eq.__nexus_noop__`, which matches zero rows and returns 204 —
a no-op without a branch, and therefore without a node that
`$('…')` could throw on downstream.

---

## Defect 2 — the sync destroys reps' handwritten Bitrix notes

`Update Bitrix24 Lead` calls `crm.lead.update` with `TITLE`, `OPPORTUNITY` and
`COMMENTS` built entirely from the Supabase row. Bitrix replaces those fields
wholesale. A rep types "customer wants black interior, call after 6pm, brother
is buying too" into COMMENTS; the next sync run overwrites it with
`AI score: 91 / Source: whatsapp / Synced automatically from NEXUS OS`. There is
no timestamp comparison, so NEXUS wins even when its data is a week older.

### The rule

**A field a human is expected to author is not a field an automated push may
overwrite.** Automation may own fields humans do not write, may *fill* a field
humans left blank, and may *append* to a field humans share. It may not replace.

| Field | On create | On update | Reasoning |
|---|---|---|---|
| `COMMENTS` | set | **append-only** | This is the field reps type into. Our content lives inside a delimited `[NEXUS-SYNC:BEGIN] … [NEXUS-SYNC:END]` block; everything outside it is copied through byte for byte. Our own block is replaced *in place*, so the field cannot grow without bound and re-syncing is idempotent. |
| `OPPORTUNITY`, `CURRENCY_ID` | set | **fill-if-empty** | A rep's negotiated figure is observed reality; `budget_aed` is a number an LLM parsed out of a WhatsApp message. Writing into a blank adds information. Writing over a number adds noise. |
| `TITLE` | set | **never** | The record's human label. Reps rename leads to their own conventions and to whatever the sales floor calls the deal. |
| `NAME` | set | **never** | Reps correct spellings and transliterations that a WhatsApp profile got wrong. Our source is the *worse* one. |
| `PHONE`, `EMAIL` | set | **never** | Already true in the current code, for a different reason: Bitrix *appends* to multi-value fields, so re-sending stacks duplicates. The reason is now also "a rep may have corrected it". |
| `SOURCE_DESCRIPTION` | set | **never** | First-touch provenance is history. History does not get restated. |
| `STATUS_ID`, `ASSIGNED_BY_ID` | never | **never** | Pipeline stage and ownership are human decisions. This workflow has no opinion and should not acquire one by accident. |
| `UF_CRM_*` | untouched | untouched | Out of scope; explicitly not enumerated, so never sent. |

### How append-only is implemented

Merging requires knowing what is there, so the update branch gains a
**read-before-write**: `Fetch Existing Bitrix Lead` (`crm.lead.get`) →
`Build Update Payload`. The merge strips only our delimited block, trims **only
the seam** left where it sat (a rep's own blank lines elsewhere are preserved),
and re-appends the current block at the end. Verified idempotent: applying the
same block twice produces a byte-identical field.

The markers are plain bracketed text rather than HTML comments, because Bitrix
lead `COMMENTS` may be stored as BB-code or as HTML depending on portal
settings, and a plain token survives both without being eaten by a sanitiser.

**If the read fails, nothing is written.** `Build Update Payload` sets a fatal
`_no_write_reason`, `Update Has Payload?` routes straight to the audit, and the
run reports FAILED. Blind-writing COMMENTS after a failed read would be this
same bug wearing a different hat.

### The timestamp comparison

`migration.sql` adds `leads.crm_synced_at`, stamped only on a confirmed write.
`Build Update Payload` compares it against Bitrix's `DATE_MODIFY`. If Bitrix is
newer, a human has touched this record since our last push, and the
fill-if-empty `OPPORTUNITY` write is suppressed as well — someone is actively
working the lead, so we restrict ourselves to appending our comment block.

Note that the comparison is a *refinement*, not the safety mechanism. The safety
mechanism is field ownership: because the sync no longer overwrites anything a
human authors, a stale NEXUS row cannot destroy newer Bitrix data even if the
timestamps are missing, skewed, or in different zones.

### No-op suppression

`Update Has Payload?` skips `crm.lead.update` entirely when nothing changed, and
updates now send `REGISTER_SONET_EVENT: 'N'` (creates keep `'Y'`). Between them,
a re-sync of an unchanged lead touches neither `DATE_MODIFY` nor any rep's
activity stream. This is what makes repeat syncing genuinely free, which is what
lets the watermark be a cost control rather than a correctness control.

### What is *not* fixed: the reverse path

Records that exist only in Bitrix are still never seen, and this remains true
after the fix. `wf_108` is a push. Making it bidirectional means deciding, per
field, which system wins on a genuine conflict — and doing that inside a
workflow whose failure mode is silent overwrites is how the current bug was
born. The honest design is a **separate pull workflow** (`crm.lead.list` with
`filter[>DATE_MODIFY]` = last pull, paged via `start`, writing into `leads` under
the same field-ownership table inverted), so that a pull bug cannot corrupt the
push. It is listed in RISKS §5 as knowingly outstanding rather than
half-implemented here.

---

## Defect 3 — Customer 360 overwrites a correct count with zero

### Three bugs in one path

**(a) A failed read becomes a zero.** Gmail and Slack run with
`onError: continueRegularOutput`, so a failure arrives as an item carrying
`error`. `Transform & Unify` filters items on `i.json.id` and
`i.json.ts || i.json.text`; an error item survives neither filter, so
`.length` is `0`. `Supabase - Upsert Profile` posts the whole object with
`resolution=merge-duplicates`, and PostgREST writes that `0` over a stored `47`.
The `Delivery Report` correctly refuses to *claim* the number — but it runs
*after* the write, so it is apologising for something already lost. In this
deployment that is not hypothetical: the Gmail and Slack credentials are
currently failing (P3, carried in the J1 runbook), so this path zeroes every
profile it touches, nightly at 02:00 Asia/Dubai.

**(b) An empty `sender:`.** A customer with a phone and no email sends
`filters.sender = ''` to Gmail — an unconstrained query returning up to 20
unrelated messages, all counted as theirs. The synthetic `@whatsapp.lead`
address has the same status: it is not a mailbox.

**(c) Two key spaces in one unique column.** `Normalise Customers` does
`String(r.id != null ? r.id : (r.email || ''))`, so `customer_360_profiles.customer_id`
holds either a `v_customer_directory` UUID or an email address, and
`on_conflict=customer_id` dedupes across both. The same human reachable under
both keys gets two rows that never converge. **And there is a third, worse
case the brief does not mention:** a row with neither `id` nor `email` yields the
**empty string**, so every such customer upserts onto one single shared profile
row, each one overwriting the last.

### The fix: decide before the write, not after

`Transform & Unify` now separates three states per source, where it previously
had one:

| State | How it is detected | What is written |
|---|---|---|
| **read failed** | any item carries `error`, or the node did not run | key **omitted** |
| **not applicable** | no real email (Gmail) / no email and no phone (Slack) — we never asked | key **omitted** |
| **measured** | node ran, no error item; count = items passing the shape filter | the count, including a real `0` |

`alwaysOutputData` is what makes the honest zero possible: a genuinely empty
result arrives as one item with empty `json`, which the shape filter discards,
giving `0` — while a failure arrives as an item with `error`, which is caught
first.

`Supabase - Upsert Profile` then builds its body from an **explicit column
allowlist** that drops `undefined` values, instead of `JSON.stringify($json)`:

```js
Object.fromEntries(Object.entries({ customer_id, name, email, phone,
  total_emails, total_slack_messages, last_synced_at })
  .filter(e => e[1] !== undefined))
```

PostgREST builds its `ON CONFLICT DO UPDATE SET` list from the keys actually
present in the body, so **an omitted column is left exactly as it was found.**
The allowlist does double duty: it also guarantees the diagnostic `_gmail_ok` /
`_slack_why` keys that `Transform & Unify` now carries can never reach PostgREST,
where an unknown column is a 400.

One gap remains that the workflow alone cannot close: on **INSERT**, an absent
column takes its `DEFAULT`, and the default was literally `0` — so a brand-new
profile whose Gmail read failed would still be born asserting zero.
`migration.sql` drops both defaults so the unknown case is `NULL`. That is why
the migration is a prerequisite and not a nicety.

### The Gmail and Slack queries

Gmail is queried on `mail_email` — the real address, never the synthetic one —
falling back to `nexus-unmatchable@invalid.example`, which matches nothing.
Slack falls back `mail_email → phone → sentinel`; a phone number is a
*meaningful* Slack search, because reps paste numbers into channels.

Both nodes stay unconditionally on the path rather than sitting behind an `IF`.
That is deliberate: `$('Gmail - Get Emails')` **throws** when the node did not
run on the taken branch, and neither `?.` nor `||` can rescue it. A sentinel
query costs one API call; a severed branch costs a thrown Code node in two
places downstream.

### The key space

`customer_id` is now exactly one thing: **the `v_customer_directory` UUID.**

* A row with no `id` is **not synced**. A profile keyed by something that is not
  an identity is worse than no profile: it accumulates other people's data.
* The live key format is left **byte-identical**. Namespacing the UUIDs
  (`dir:<uuid>`) would have been tidier, and would have orphaned every profile
  row already stored. Not worth it.
* The dormant legacy Bitrix branch is namespaced `bitrix:<ID>`, so reviving that
  source can never collide with the UUID space.

Rows already written under an email key, or under the empty string, are
pre-existing damage — cleanup SQL is in RISKS §4.

### One more honesty fix

Both source nodes fetch at most 20 items, so every count is really "up to 20".
`Delivery Report` now says `20+ (source capped at 20)` rather than letting a
bare `20` read as a total, and reports **NOT APPLICABLE** separately from
**UNKNOWN**.

---

## Design decisions, stated plainly

1. **Phone is the identity key in Dubai.** Email is a fallback and only when
   real. Anything named `@whatsapp.lead` is a routing key, never a mailbox and
   never a lookup term.
2. **Bitrix's duplicate index decides who is a duplicate**, not our own string
   matching — but we feed it every spelling of the number, and never a country
   code we cannot justify.
3. **"I could not check" never means "not found."** A failed probe blocks the
   create and audits FAILED, leaving the watermark unstamped so it retries.
4. **A lead with no matchable identity is refused, not created.** It could never
   be de-duplicated later.
5. **Fields a human authors are never overwritten by automation** — appended to,
   or filled when blank, or left alone. That, not a timestamp, is what protects
   reps' notes.
6. **Never write a value you could not read** — in the CRM (no blind COMMENTS
   write after a failed `crm.lead.get`) and in the warehouse (an unmeasured
   count is omitted, not zeroed).
7. **Do not lie in the audit row.** Both duplicate probes are now `critical`,
   so a swallowed lookup can no longer coexist with a SUCCESS verdict; and every
   run that sees more than one matching Bitrix lead writes
   `DUPLICATES IN BITRIX: lead ids …` into `audit_log`.
