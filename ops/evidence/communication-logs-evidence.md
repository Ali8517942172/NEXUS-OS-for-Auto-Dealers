# STAGE 1.4 — `communication_logs`: the inert idempotency index

**Date:** 5 September 2026
**Projects:** production `dsvuoovivysszdoiorch`, staging `wwspuxrbiyagnrnzgate`
**Migrations applied:** `20260905204047_communication_logs_external_identity_is_the_providers_id`,
`20260905204353_correct_the_communication_logs_writer_census` — both projects,
identical `md5(statements[1])` on both.

**Headline: the database half is done and proved. The defect is NOT closed,**
because the writers are n8n nodes on a box this pass was told not to touch, and
they still send nothing. See
`/home/claude/out/communication-logs-writer-change-NOT-DEPLOYED.md`.

---

## 1. Measured before-state (production, before any change)

### The table

| column | type | null | default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `lead_email` | text | null | — |
| `channel` | text | null | — |
| `direction` | text | null | — |
| `message` | text | null | — |
| `created_at` | timestamptz | null | `now()` |
| `sent_by` | text | null | — |
| `tenant_id` | uuid | NOT NULL | `nexus_default_tenant_id()` |
| `external_message_id` | text | null | — |

**There is no `provider` column and no `integration_id` column.** That is the
single fact that shapes the whole decision below.

### The index that was supposed to be the guard

```
CREATE UNIQUE INDEX communication_logs_tenant_direction_extmsg_key
  ON public.communication_logs USING btree (tenant_id, direction, external_message_id)
```

Non-partial, no `NULLS NOT DISTINCT`. Added 3 Sep 2026 by
`20260903193716_messaging_idempotency_communication_logs_external_message_id`,
whose own header says it "is deliberately inert until a writer supplies the
column". Two days later no writer does.

### The rows

```
total 114 | with external_message_id 0 | null 114 | tenants 1
first row 2026-08-25 05:04:15Z | last row 2026-09-05 17:36:45Z
```

(The audit recorded 108; it is 114 now. The table is still taking live traffic.)

| channel | direction | sent_by | rows | could it carry a provider id? |
|---|---|---|---|---|
| whatsapp | inbound | — | 89 | **yes** — every one is a real WhatsApp message with a WAHA `payload.id` |
| whatsapp | outbound | bot | 18 | only if the WAHA `sendText` response carries an id — **not observed in this pass** |
| whatsapp | outbound | — | 5 | same |
| system | outbound | — | 2 | **no** — internal notes, no provider leg at all |

So: 2 rows certainly cannot have one, 89 certainly could, 23 depend on a
response shape nobody has measured. **0 do.** The historical ids are not
recoverable from the database and **no backfill was attempted** — inventing them
was the one thing that would have made the numbers look better and the record
worse.

### RLS and grants (unchanged by this work)

```
relrowsecurity = true, relforcerowsecurity = false
relacl: postgres=arwdDxtm/postgres
        service_role=arwdDxtm/postgres
        authenticated=r/postgres
column ACLs (pg_attribute.attacl): none
policies: communication_logs_authenticated_read  SELECT  authenticated
            USING (tenant_id IN (SELECT nexus_current_tenant_ids()))
          communication_logs_deny_anon           ALL     anon   RESTRICTIVE  false/false
          communication_logs_service_role_all    ALL     service_role  true/true
```

`authenticated` is read-only here, so the dashboard cannot be the duplicate
writer even in principle.

### Who actually writes it

- **The dashboard does not.** `grep` over `apps/executive-dashboard/lib` and
  `screens` finds reads and prose only; every mention of the table in a screen
  is a caption or a query. No `INSERT`, no `dbWrite`.
- **No database function writes it.** The three functions whose source mentions
  the table are `nexus_mark_first_response()` (an AFTER INSERT trigger that
  *reads* the new row), `nexus_quarantine_census()` and
  `nexus_tenancy_readiness()`. None inserts.
- **n8n is the only writer**, as `service_role`, `BYPASSRLS`.

Counted from `n8n-workflows/*.json` (top level only, excluding `backup/` and
`_pre_sync_backup/`): **11 HTTP POST nodes to `/rest/v1/communication_logs`
across 5 workflows.** All eleven carry `retryOnFail: true`,
`onError: continueRegularOutput` and `Prefer: return=minimal`. **None sends
`external_message_id`. None sends `on_conflict`.**

> The first migration's header says "seven … across four". That was wrong. It is
> corrected in migration `20260905204353` and in the table comment rather than
> left standing.

> **That export is 30 August and is stale.** It holds zero occurrences of
> `tenant_id` while the live box demonstrably resolves and stamps one. Treat 11/5
> as a floor measured on the export, not a live census. One of the five,
> `phase_6_12_hour_silence_detector`, was read from the box on 4 Sep with
> `activeVersionId: null` — never published, so its writer has never run, which
> is corroborated by production holding **zero** rows with `direction='internal'`,
> the only shape that node writes.

### The harm, stated as precisely as the data allows

`Prefer: return=minimal` + `retryOnFail: true` + no idempotency key is the classic
lost-response shape: the POST commits server-side, the response is lost, n8n
retries, a second row lands.

Ten groups of rows share `(tenant_id, channel, direction, lead_email, message)`
— 29 rows, 19 of them excess if every repeat is a duplicate. Sub-second gaps
appear (0.33 s, 0.43 s), which is retry-shaped and not human-shaped.

**But this cannot be resolved into a number, and that is the point.** Six of
those rows are `[Customer sent a document image]`, a placeholder the workflow
substitutes for any image — so several genuinely different photos produce
byte-identical rows. With `external_message_id` NULL on all 114, **the table
cannot distinguish a redelivery from a customer who really did send the same
thing twice.** Any duplicate count taken from it today is a guess. That
ambiguity is the defect, more than any particular pair of rows.

---

## 2. The identity chosen, and the argument for it

**Chosen key:** `(tenant_id, channel, direction, external_message_id)`,
as a **non-partial UNIQUE index** over **`external_message_id` left NULLABLE**,
with `channel` and `direction` entering the key through **generated, unwritable**
normalised columns.

### Why the column stays nullable

The prompt's own caution is the right one and the data supports it: 2 of 114
rows are internal notes with no provider leg, and the silence detector's writer
is *designed* to produce more of them. `NOT NULL` would force those writers to
invent an identifier. This codebase already shows what that produces —
`whatsapp_bdc_ai_agent.json:713` mints `'nokey:' + $now.toMillis()` when a
message id is absent, a per-delivery value that changes on every retry and so
**defeats the very index it appears to satisfy** while making the row look
identified. NULL is the honest value; NULLs are distinct in a btree, so those
rows stay unconstrained, exactly as today. **No existing row was touched.**

### Why NOT a partial index — measured, not assumed

A partial unique index `WHERE external_message_id IS NOT NULL` was the obvious
choice and was rejected on a measurement. PostgREST's `on_conflict=` emits
`ON CONFLICT (col, …)` with **no index predicate**, and arbiter inference cannot
match a partial index without one. Proved on staging in a rolled-back
transaction, with the pre-existing non-partial index dropped first so it could
not absorb the inference:

```
partial index only, ON CONFLICT (tenant_id, direction, external_message_id)
  -> 42P10  there is no unique or exclusion constraint matching
            the ON CONFLICT specification
```

(The first attempt at this probe returned ACCEPTED and was **confounded** — the
old non-partial index was still present and satisfied the inference. Recorded
because it is exactly the kind of false pass this repo keeps finding.)

The writers are n8n HTTP nodes; `Prefer: resolution=ignore-duplicates` plus
`on_conflict=` is the only way they can dedupe quietly. Against a partial index
that call fails outright — trading a duplicate row for a **silently missing**
one. A non-partial unique index over a nullable column has identical row-level
semantics (present ids collide, absent ids do not) and *is* inferable.

### Why `channel`, and what that does not buy — stated as open

The prompt's identity is `tenant + provider + integration + external_message_id
(+ direction)`. This table has `tenant_id` and `direction`. It has no
`integration_id` and no `provider`, and **adding either would recreate the exact
defect being fixed** — a column no writer populates. `channel` is the nearest
real discriminator and it separates the id namespaces that actually differ
(`whatsapp` / `email` / `system`).

**Open, not solved:** `channel` is not `provider`. WAHA and the WhatsApp Cloud
API are both `channel='whatsapp'`. Two providers on one channel are separated
here only by the fact that their id *formats* do not overlap — a property of
those providers, not a guarantee this database makes. When `communication_logs`
gains an `integration_id` with a live writer behind it, this index should be
widened to include it, and `channel_registry`'s composite-FK pattern applied so
the tenant/integration pairing cannot be mismatched.

### Why generated columns

Two failure modes already paid for in this repo:

- **Nullable key columns.** A writer omitting `channel` produces NULL, NULLs are
  distinct, and that row escapes the constraint entirely — the same shape as the
  inert index being replaced.
- **Case.** `whatsapp_delivery_events` keys on unnormalised `status_raw`, so
  `delivered` and `DELIVERED` double-count.

`lower(btrim(coalesce(…, '')))` closes both, and `GENERATED ALWAYS … STORED`
makes it unforgeable — writing the key column directly is refused with `428C9`.

`external_message_id` itself is **not** normalised: a Cloud API `wamid` is
base64 and case-significant, so lowercasing it would collide two genuinely
different messages. Normalising our own vocabulary is right; normalising a
provider's opaque identifier is not.

### The CHECK constraint — the part that stops the fix being undone

`communication_logs_external_message_id_is_a_provider_id` refuses a value that
is not a provider id: whitespace anywhere, length outside 8–512, the prefixes
`nokey:` `outreach:` `exec-` `run-` `job-`, and a bare 10- or 13-digit epoch
(`Date.now()` / `$now.toMillis()`). `service_role` does not bypass a CHECK, and
n8n holds `service_role`, so **this bites the only writers there are** — it is a
door on every writer, not just on a disciplined one.

Cost stated honestly: a real provider id shorter than 8 characters would be
refused, and with `onError: continueRegularOutput` that means the log row is
dropped rather than duplicated. No provider on this channel list mints one that
short. If one ever does, widen the bound — do not remove the gate.

---

## 3. Proofs

All probes ran inside a `DO $$ … $$` block terminated by an unconditional
`RAISE EXCEPTION`, so **nothing could persist** even if a probe misbehaved.
Row counts before and after confirm it.

### Staging (`wwspuxrbiyagnrnzgate`), after the migration

```
T1 first inbound with provider id      -> INSERTED (ok)
T2 SAME message logged twice           -> REFUSED 23505
     (duplicate key value violates unique constraint
      "communication_logs_external_identity_key")
T3 same id, channel/direction re-cased -> REFUSED 23505     ("  WhatsApp ", "INBOUND")
T4 NULL channel then empty channel     -> second REFUSED 23505 (NULL does not escape)
T5 two rows with NO provider id        -> BOTH INSERTED (ok)
T6 tenant B, same provider id          -> INSERTED (ok, no cross-tenant collision)
T7 same id, opposite direction         -> INSERTED (by design)
```

```
CHECK [nokey:1757102345678]                  -> REFUSED 23514
CHECK [outreach:1757102345678-ab12cd34]      -> REFUSED 23514
CHECK [exec-99182]                           -> REFUSED 23514
CHECK [run-99182]                            -> REFUSED 23514
CHECK [job-99182]                            -> REFUSED 23514
CHECK [1757102345678]   (ms epoch)           -> REFUSED 23514
CHECK [1757102345]      (s epoch)            -> REFUSED 23514
CHECK [has space here]                       -> REFUSED 23514
CHECK [short7x]                              -> REFUSED 23514
CHECK []                                     -> REFUSED 23514
REAL  [false_971501234567@c.us_3EB0815E…]    -> ACCEPTED (ok)   WAHA
REAL  [wamid.HBgLOTcxNTAxMjM0NTY3FQIAEh…]    -> ACCEPTED (ok)   Cloud API
REAL  [199f2c3d4e5f6a7b]                     -> ACCEPTED (ok)   16-hex
writing channel_key directly                 -> REFUSED 428C9
```

The live traffic shape — two WAHA hosts posting the same `payload.id`, plus a
retrying node:

```
delivery 1 (WAHA host 35.224.126.225)     -> rows inserted = 1
delivery 2 (second WAHA host 2.50.10.149) -> rows inserted = 0
retryOnFail replay of the same POST       -> rows inserted = 0
rows on file for that one real message    -> 1
```

Staging after all probes: **0 rows** (unchanged — it was empty before).

### Production (`dsvuoovivysszdoiorch`), after the migration

```
rows before probes                          -> 114
delivery 1 of one real message              -> inserted 1
delivery 2, second WAHA host, same id       -> inserted 0 (deduplicated)
plain INSERT of the same id (no on_conflict)-> REFUSED 23505
same id, channel/direction re-cased         -> REFUSED 23505
two rows with NO external id                -> BOTH INSERTED (ok)
second tenant, same provider id             -> INSERTED (ok, no cross-tenant collision)
minted id [nokey:1757102345678]             -> REFUSED 23514
minted id [outreach:1757102345678-ab]       -> REFUSED 23514
minted id [exec-99182]                      -> REFUSED 23514
minted id [1757102345678]                   -> REFUSED 23514
minted id [has space]                       -> REFUSED 23514
minted id [short7x]                         -> REFUSED 23514
forging direction_key directly              -> REFUSED 428C9
rows inside the probe txn                   -> 118  (all rolled back)
```

The "second tenant" is the real `__unattributed__` quarantine tenant
(`02c86264-…`), used inside the rolled-back transaction because production has
only one dealership. No tenant was invented.

### Production after everything

```
rows 114 | with external_message_id 0 | rows with a null normalised key 0
indexes: communication_logs_external_identity_key
           (tenant_id, channel_key, direction_key, external_message_id)  [new]
         communication_logs_pkey, communication_logs_tenant_id_idx,
         idx_comm_logs_created_at, idx_comm_logs_lead_email
         communication_logs_tenant_direction_extmsg_key                  [dropped]
relacl: unchanged (postgres / service_role arwdDxtm, authenticated=r)
column ACLs: none
v_lead_messages 53, v_conversations 13, v_customer_360 2 — all still resolve
get_advisors (security): no new lint; the pre-existing ones are unchanged
```

**114 before, 114 after, 0 external ids before, 0 after.** No production
business data was altered, rewritten or backfilled.

### Migration file protocol

| version | md5 recorded on production | md5sum of the repo file | bytes | trailing newline |
|---|---|---|---|---|
| `20260905204047` | `bb46384d8944c7e0058d87be0ff570ec` | `bb46384d8944c7e0058d87be0ff570ec` | 9135 | none (last byte `;`) |
| `20260905204353` | `8dc174df784428e1a3bc1a2e5bd86f6f` | `8dc174df784428e1a3bc1a2e5bd86f6f` | 3393 | none (last byte `;`) |

Staging recorded the identical md5s for both.

---

## 4. What remains open

1. **THE WRITERS HAVE NOT CHANGED. The defect is not closed.** Every writer is
   an n8n node on the production box, out of scope for this pass. The required
   node-level change is written up in
   `/home/claude/out/communication-logs-writer-change-NOT-DEPLOYED.md`, marked
   NOT DEPLOYED. Until it is applied and republished, a retried or redelivered
   write still creates a second row. The number that will prove otherwise is
   `count(*) filter (where external_message_id is not null)` — currently **0**.
2. **A trap inside the fix.** `Resolve Lead Identity` builds a fresh object and
   **drops `message_id`**, so `Log Incoming Message` cannot read the id off
   `$json`. It must reach back to `$('Extract Message & Sender')`. A change that
   only adds `external_message_id: $json.message_id` will silently write NULL
   forever and look done.
3. **The WAHA `sendText` response shape is unobserved.** The outbound expression
   tries four known shapes and falls back to NULL. If it lands on NULL for every
   send, the outbound writer is honest but not fixed, and that must be said
   rather than counted as a pass.
4. **PostgREST `on_conflict` against generated columns is unproven.** The SQL
   form is proved on both projects; the REST translation is not, and could not be
   tested without a `service_role` key. If it fails, ship without `on_conflict`:
   the duplicate then raises `23505` → HTTP 409, so it is still refused, just
   noisily.
5. **`channel` is not `provider`, and there is still no `integration_id`.**
   Recorded above. Widen the index when a writer for `integration_id` exists —
   not before.
6. **Eight of the eleven writers will still send nothing**, seven of them for
   want of an observed response id (the three Gmail drip writers are the cheapest
   remaining win) and one — the silence detector's internal note — correctly and
   permanently.
7. **The 114 historical rows can never be deduplicated retrospectively.** Their
   provider ids are not recoverable, so the ~19 excess rows in the ten
   same-text groups can be neither confirmed as duplicates nor cleared as
   genuine repeats. Any historical message count off this table carries that
   unquantified error, and should be stated with it.
