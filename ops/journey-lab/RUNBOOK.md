# NEXUS JOURNEY LAB — RUNBOOK

**How to run L1 and L2 today, by hand.** Written 6 September 2026. Read
`README.md` and `TEST-MATRIX.md` first.

This runbook has been **executed zero times**. It is a procedure, not a record.
Nothing in it has been verified by running it, and the first person to run it
should expect Step 0 to change several of the later steps.

---

## Scope, and the three things this Lab must never do

**In scope today:** L1 (fixtures against the writers, no network) and L2 (the
staging database, transport simulated by us).

**Out of scope in this runbook:** L3 needs a Meta app and a Google Ads lead form
asset pointed at a reachable staging endpoint — both free, neither set up.
`TEST-MATRIX.md` T02 and T04 say how to drive them when they are. L4 needs a
dealership.

**Never, on any run:**

1. **Never against production.** `dsvuoovivysszdoiorch` holds ALBA CARS, the one
   real dealership, and its counts are what every claim in
   `commercial/WHAT-WE-CLAIM.md` rests on. Lab rows in that database poison all
   of them. Every script in this Lab must carry the same two guards
   `ops/demo/*.sql` already carry, and must refuse rather than warn:
   - raise if any tenant's slug or name contains `alba`;
   - raise unless the tenants this Lab expects on staging are present.
   A guard that has never gone red is decoration — fire each one deliberately
   once, inside a rolled-back probe, before trusting either.
2. **Never send anything.** No WhatsApp, no email, no Slack. `Guard Reply`
   filters message *content* and never the *recipient*, so an invented UAE
   number is how a dealership's price list reaches a stranger. Every journey's
   assertions are database reads. If a journey appears to need a send leg, it is
   `BLOCKED`, not adapted.
3. **Never touch the n8n box.** There is no n8n behind staging anyway, which is
   itself a limit to record (see "What an L2 run does not exercise").

---

## Step 0 — Reconcile the schema. Mandatory, and it is not a formality.

The ingestion layer is being built in parts and the repo is mid-way through
catching up. As of 6 September 2026 the working tree holds **parts 1, 2 and 5**
(untracked): the provenance ladder, the source catalogue, `lead_ingest_endpoint`
with its resolver, and `lead_event`'s dealer read path plus `v_lead_origin`.
**Parts 3 and 4 — `lead_event`'s own DDL and the writer/hydrator — are not on
disk.**

So three things in `TEST-MATRIX.md` are still unverified names rather than read
definitions, and each blocks journeys until Step 0 settles it:

| unknown | blocks |
|---|---|
| the **phase vocabulary** — are `RECEIVED / HYDRATED / PROMOTED / DUPLICATE / REJECTED / QUARANTINED / EXPIRED` the actual CHECK values? | every journey |
| the **`disposition_reason` vocabulary** | T03, T06, T09, T14, T16 |
| **`nexus_lead_ingest_invariants()`** — signature, result shape, and which branches it has | T19 entirely, and the last assertion of most others |

Read the live staging catalogue and write the answers into the run manifest:

```sql
-- what actually exists
select table_name, table_type from information_schema.tables
 where table_schema='public' and (table_name like 'lead\_%' or table_name like 'v\_lead%')
 order by 1;

-- lead_event's real definition, since the repo only has its grant list
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema='public' and table_name='lead_event' order by ordinal_position;

-- the phase and disposition vocabularies, from the constraints themselves
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.lead_event'::regclass order by conname;

-- the gate
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result, p.prosecdef, r.rolname as owner
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname like '%lead_ingest%';

-- and the source contract every journey's dedup assertion reads
select source_key, delivery_shape, required_provenance, dedup_field, integration_status
  from public.lead_source_catalogue order by 1;
```

**Four questions the migrations already answer** — confirm them against the
live database rather than against the file, since the migrations are untracked
and may not be applied:

| question | what the migrations say |
|---|---|
| what is the delivery identity a duplicate is detected on? | `lead_source_catalogue.dedup_field`, per source — `leadgen_id`, `lead_id`, `submission_id`, `wa_message_id`, `rfc_message_id`, `simulator_scenario_id`, `operator_reference` |
| where does `environment` come from? | `lead_ingest_endpoint.environment`, CHECKed to `production` / `simulation`, **not** the payload |
| is `public_key` unique across all dealerships? | yes — `lead_ingest_endpoint_public_key_key`, plus a shape CHECK of `^[A-Za-z0-9_-]{24,128}$` |
| is `public_key` an authenticator? | **no.** It identifies. The authenticator is `declared_provenance` + `secret_ref` |

**Two questions the migrations do not answer, and both change a journey:**

- **Does `lead_event` keep phase history, or only the current phase?** If only
  current, "it passed through `HYDRATED`" is unobservable and must be recorded
  as such rather than inferred. (T01, T02, T16.)
- **Does Meta routing use one app per dealership, or a registered
  `page_id → tenant` map?** "The tenant is decided by the endpoint, never by the
  payload" is literally true only in the first. `lead_ingest_endpoint` carries
  `ingest_address` for email but nothing page-shaped, which *suggests* the
  first — confirm it, do not infer it. (T18, T14c.)

**And one finding to settle before T10 runs.** `operator_recorded` has
`counts_as_real = false`, and
`lead_ingest_endpoint_production_needs_real_provenance` forbids a production
endpoint carrying such a provenance — so **a production `walk_in` or
`phone_call` endpoint cannot exist as a row.** Either manual entry bypasses the
endpoint layer and is typed into the dashboard, which should be written down, or
the largest source in a UAE showroom cannot be registered in production, which
is a defect. Do not resolve it by registering a simulation endpoint and calling
T10 passed.

**After reading any of these objects, read their ACLs** — table level *and*
column level, `anon` *and* `authenticated`, all four write verbs. `relacl` is
one of two ACLs and this project has been blinded by `pg_attribute.attacl`
three times. `lead_event` deliberately carries a **column-level** `SELECT`
grant on fifteen columns with `payload_raw`, `hydrated_payload`, `normalized`
and `endpoint_id` withheld, which is exactly the shape a `relacl`-only check
misreports. The query is in `CLAUDE.md` under "The default-grant check"; run
it, do not reason about it.

**If a witness named in `TEST-MATRIX.md` does not exist under that name, the
journey is `BLOCKED` and the missing object is named.** Do not re-point the
assertion at the nearest similar column. That substitution is how a check ends
up measuring something nobody chose.

## Step 1 — The Lab dealerships

Two fictional tenants on **staging** (`wwspuxrbiyagnrnzgate`), created for this
purpose and labelled on the face of every row:

| | name | slug |
|---|---|---|
| Branch A | `Nexus Auto Test Showroom (Branch A) — DEMONSTRATION TEST ENVIRONMENT` | `nexus-lab-a` |
| Branch B | `Nexus Auto Test Showroom (Branch B) — DEMONSTRATION TEST ENVIRONMENT` | `nexus-lab-b` |

Both `status = 'active'` (T17 suspends B temporarily and restores it). Neither
holds `is_unattributed_default` — a CHECK constraint makes pointing that flag at
a non-quarantine tenant impossible anyway, and if it ever succeeds, stop and
report it.

**Do not reuse `staging-alpha`, `staging-bravo` or `demo-northwind`.** Their row
counts are the control in the two-dealership tenancy proof and in
`ops/DEMO.md`'s teardown check; Lab traffic inside them destroys that control
silently.

**Identities.** Every person the Lab invents:

| field | value |
|---|---|
| email | `t<nn>.<run_id>@journey-lab.invalid` — RFC 2606, can never resolve |
| name | `T<nn> Example (DEMONSTRATION TEST ENVIRONMENT)` |
| phone | a number the Lab never sends to, because the Lab never sends |

No real dealership's name, branding, trade licence, web address or phone number
appears in any payload, fixture or screenshot — not as a "realistic" example.

---

## Step 2 — Register a simulation endpoint on staging

One endpoint per source per branch. `public_key` is an **identifier**, not a
secret — but an unguessable one, and the only thing standing in front of a
website form endpoint — so generate it properly, record it in the run manifest,
and do not paste it into a journey result, a screenshot, a commit, or this
repository. Where a source has a real secret it goes **somewhere else** and the
endpoint stores only `secret_ref`.

```sql
-- column names read from 20260906201107_leadingest_02_tenant_bound_endpoints.sql;
-- confirm against the live catalogue first (Step 0), since it is untracked.
insert into public.lead_ingest_endpoint (
  tenant_id, source_key, required_provenance_for_source,
  declared_provenance, provenance_counts_as_real,
  environment, public_key, origin_allowlist, status, label)
select t.id,
       c.source_key,
       c.required_provenance,
       'simulated',                                   -- what the Lab actually proves
       false,                                         -- and simulated never counts as real
       'simulation',
       translate(encode(gen_random_bytes(24),'base64'), '+/=', '-_'),
       array['https://journey-lab.invalid'],
       'active',
       'JOURNEY LAB — DEMONSTRATION TEST ENVIRONMENT'
  from public.tenants t
  join public.lead_source_catalogue c on c.source_key = 'website_form'
 where t.slug = 'nexus-lab-a'
returning endpoint_id, public_key;
```

Four things about that statement are deliberate and should not be "tidied":

- `status` is **`'active'`**, not `'enabled'` — the CHECK allows
  `active` / `disabled` only.
- `environment` is **`'simulation'`**, and it lives on the endpoint, not on the
  payload. That is what makes the marker unforgeable by a caller.
- `declared_provenance` is **`'simulated'`** with `provenance_counts_as_real =
  false`. A Lab endpoint should say what it is. If a journey needs the real
  provenance exercised — T02's HMAC, T04's body secret — register it with that
  provenance and `environment = 'simulation'`, which the CHECKs permit; a
  *production* endpoint is the thing they forbid.
- the `public_key` is base64url-shaped because
  `lead_ingest_endpoint_public_key_shape` requires `^[A-Za-z0-9_-]{24,128}$`.
  Plain `encode(...,'base64')` produces `+`, `/` and `=` and **will be
  refused** — which is the constraint working.

**Then prove the registration rather than assuming it.** First the resolver:

```sql
select * from public.nexus_lead_endpoint_for_public_key('<key>');
```

It returns a **set**, so unresolved is **zero rows** — never a default. It also
joins `tenants` and requires `status = 'active'`, so a suspended dealership
resolves to nothing (that is T17's first assertion). Confirm exactly one row,
for the right tenant, with the right `delivery_shape` and `dedup_field`.

Then fire one arrival and read it back:

```sql
select phase, environment, tenant_id, source_key, origin_verified,
       provenance_counts_as_real, external_event_id, disposition_reason
  from public.lead_event
 where tenant_id = (select id from public.tenants where slug = 'nexus-lab-a')
 order by received_at desc limit 5;
```

Three things must hold before any journey runs:

1. `lead_event.tenant_id` equals the endpoint's `tenant_id`;
2. `lead_event.environment = 'simulation'`;
3. `v_lead_origin.is_test_traffic` is **true** for it.

**And fire the guard once, in a rolled-back transaction**, because a constraint
nobody has fired is decoration: attempt the same insert with
`environment = 'production'` and expect
`lead_ingest_endpoint_production_needs_real_provenance` to raise. If it does
not, stop — the structural separation between Lab traffic and real traffic is
not there, and everything downstream of it is unsafe to run.

## Step 3 — Snapshot before. `01_keys_before.json`

There is **no run-marker column anywhere in this database** — no `is_test`, no
`test_run_id`, no `journey_id`, on any table. That was measured across all 58
base tables and it has not changed. So Lab data is marked **structurally**, by
three things that already exist:

| layer | marker | strength |
|---|---|---|
| 1 | `tenant_id` — `NOT NULL` on every tenant-scoped table | **load-bearing.** Cannot be forgotten, cannot be null, already enforced by RLS. `tenant_id in (Branch A, Branch B)` is a complete machine-checkable answer to "is this row Lab data" |
| 2 | the `@journey-lab.invalid` email namespace — RFC 2606 | corroboration, and the thing that makes an accidental send fail at DNS rather than at a person |
| 3 | **`lead_event.environment = 'simulation'`** — new with the ingestion layer, and set from `lead_ingest_endpoint.environment` rather than from anything a caller sends | the first marker in this project that is *about the traffic* rather than about the tenant, and the only one a dealer-facing screen can filter on. A CHECK stops a production endpoint carrying a provenance that counts as fake, so the separation is structural rather than conventional. It is what T15 asserts |

Layer 3 is a real improvement on what `JOURNEYS.md` had. It is still not a run
marker: it says *this is simulated*, not *this belongs to run 01K4E7Q9*. Two Lab
runs are indistinguishable from each other by it, which is why the manifest
below still exists.

**Snapshot every `(table, primary key)` for the two Lab tenants**, all base
tables, into the manifest:

```
ops/journey-lab/runs/<run_id>/
  00_manifest.json              run id, tenants, endpoint ids, keys (local only), t0, Step 0 answers
  01_keys_before.json           (table, pk) for both Lab tenants, before
  02_keys_after_run.json        … after the journeys, before teardown
  03_keys_after_teardown.json   … after teardown
  04_created.json               02 − 01   what the run created
  05_residue.json               03 − 01   what teardown failed to remove
  06_collateral.json            01 − 03   what teardown destroyed but did not create
  07_control_counts.json        row counts for staging-alpha, staging-bravo, demo-northwind, quarantine
  1x_T<nn>_result.md            per-journey: each assertion, its witness, what was read, verdict
  99_RESULT.md                  the twenty verdicts, and the level each was run at
```

`runs/` is scratch and belongs in `.gitignore`. **The `public_key`s live only in
`00_manifest.json` on the operator's own machine.**

---

## Step 4 — L1: fixtures against the writers, no network

For each journey with an L1 slice, hand the stored payload straight to the
writer, inside a transaction that is rolled back.

```sql
begin;
  -- call the writer exactly as the endpoint would, with the fixture body
  -- assert phase, tenant, environment, terminal reason
rollback;
```

Or, where nothing may persist even on a misbehaving probe, wrap it so it cannot:

```sql
do $$
begin
  -- probe and RAISE NOTICE the readings
  raise exception 'JOURNEY LAB L1 probe — deliberate abort, nothing persists';
end $$;
```

**What L1 proves:** our reading of the payload specification. **What it does
not:** that the specification is what the provider sends. Record the fixture's
provenance in every L1 result — *"captured from Meta's Lead Ads Testing Tool on
<date>"* and *"transcribed from documentation"* are different levels of
evidence and must not be written the same way.

---

## Step 5 — L2: post at the real staging endpoint

```bash
RUN_ID=...                # ULID, one per run
KEY=...                   # from 00_manifest.json, never from this file
ENDPOINT=...              # the staging ingestion URL

curl -sS -o /tmp/resp.json -w '%{http_code}\n' \
  -X POST "$ENDPOINT" \
  -H 'content-type: application/json' \
  -H "x-nexus-ingest-key: $KEY" \
  -d @fixtures/T01_website_form.json
```

**Record the HTTP status on every journey, not just the failing ones.** For
`google_ads_lead_form` the status *is* an assertion: Google retries a 5XX and
**permanently discards the lead on a 4XX**, so a 4XX returned by a framework
default on an unexpected path deletes a real dealership's lead and nothing on
our side shows it.

Run the journeys in matrix order. T19 runs **first** for a clean baseline and
**last** as the gate.

### What an L2 run does not exercise, and must not be reported as covering

- **n8n.** There is no n8n box behind staging. Every L2 assertion is against the
  database writer, so the workflows' own gates, retries, tenant resolution and
  error handling are untested by this Lab entirely.
- **Provider authentication.** An L2 run signs its own request. It proves the
  verifier accepts a signature we generated, never that it accepts Meta's.
- **Retry behaviour.** We are the one retrying, so a "retry" at L2 is a replay.
- **Concurrency and volume.** Twenty sequential journeys at n=1. This box has
  been taken down twice by parallel writes, and nothing here reproduces that.

---

## Step 6 — How to read a verdict

One journey, one verdict, from five words:

| verdict | when | the trap |
|---|---|---|
| **NOT RUN** | the default. Also: the steps ran but an assertion was not read | a journey whose harness went green with unread assertions is `NOT RUN`, not `PASS`. This is the most common way a matrix turns into a lie |
| **PASS** | every assertion read, every one held, **and teardown clean** | a run with a non-empty `06_collateral.json` is not a `PASS` however green the assertions were — see Step 7 |
| **FAIL** | any assertion read and not held | a refusal the journey *expected* is not a `FAIL`. Expected refusals are assertions |
| **BLOCKED** | a precondition could not be met — a missing witness from Step 0, no n8n, no provider account | name the blocker in the result. "Blocked" with no named cause is `NOT RUN` |
| **BLOCKED BY MISSING CAPABILITY** | the thing under test does not exist yet | name the missing thing, and invert the test: assert NEXUS says UNKNOWN / NOT AVAILABLE rather than rendering `0` or a plausible number |

Two readings that are not verdicts and must be written out in full instead:

- **`0 rows` is not `42501`.** Zero rows is evidence about RLS. `42501` is
  evidence about the grant. Where a journey asserts a refusal, write down which
  one you got — this project has been wrong about that distinction three times.
- **A missing row is not proof the event did not happen.** Unknown ≠ none. This
  codebase has rendered that lie in six separate places.

Every journey result records the **level it was run at**. A journey run at L2
and reported without its level reads as proven, and it is not.

---

## Step 7 — Teardown, and the proof that it removed exactly what it created

Teardown is not "delete rows that look like tests". It is a **set difference on
primary keys, taken three times**.

1. `01_keys_before.json` — before anything ran.
2. `02_keys_after_run.json` — after the journeys, before teardown.
3. `03_keys_after_teardown.json` — after teardown.

Teardown passes only when **all five** hold:

| check | expression | must be |
|---|---|---|
| nothing left behind | `RESIDUE = 03 − 01` | empty except `audit_log` |
| **nothing destroyed that was not created** | `COLLATERAL = 01 − 03` | **empty** |
| teardown removed exactly the manifest | `CREATED − audit_log ⊆ (02 − 03)` | true |
| no other tenant moved | counts for `staging-alpha`, `staging-bravo`, `demo-northwind`, the quarantine tenant, before and after | identical |
| production untouched | production row counts, before and after | identical |

**`COLLATERAL` is the check that matters most and the one a naive teardown
fails.** A delete ordered wrongly that orphans a related row, or that catches a
shared fixture, shows up here and nowhere else.

> **A non-empty `COLLATERAL` fails the run even if every assertion in every
> journey passed.** A test that damages the database is a failed test. Record it
> as `FAIL` on the run, keep the twenty journey verdicts at whatever they
> honestly were, and do not net the two against each other.

**`audit_log` is deliberately retained** — the single documented exception to
`RESIDUE = ∅`. It is the run's own history; deleting it destroys the evidence
the Lab exists to produce, and it is already timestamped and tenant-stamped. The
manifest records the audit row ids, and teardown asserts they are **still
there**, which is the opposite of the usual direction and is the point.

**Delete children before parents**, and delete `lead_event` rows before the
`leads` rows they promoted into, for the same reason `JOURNEYS.md` deletes leads
last: a promoted lead deleted first leaves an ingestion event pointing at
nothing, and the next run's identity resolution silently matches nobody.

```
lead_event → lead_ingest_endpoint → communication_logs → processed_messages
→ whatsapp_contacts → leads
```

**Endpoints are deleted last among the ingestion objects**, because an event
whose endpoint is gone can no longer be checked against the tenant it should
have carried — and that check is T18's assertion 1.

**If teardown refuses a guard, do not edit the guard out.** It means staging no
longer looks like staging, and that is a finding.

---

## The standing hazards a Lab run must state in its result

Both are in `CLAUDE.md`; a result that omits them overstates what it proved.

- **The WhatsApp inbound webhook is unauthenticated** — `WAHA_WEBHOOK_SECRET`
  unset, gate DORMANT, n8n writing as `service_role` (`BYPASSRLS`). T07, T08 and
  T15 sit on it. **This Lab does not claim any surface is secure**, and it
  cannot: a `lead_event` row on that path means someone posted, not that a
  customer wrote.
- **`nexus_scoped_tenant_id()` returns NULL at more than one active
  dealership**, and five backend consumers go quiet together. The Lab runs two
  active dealerships by design, so a zero from anything reading its scope from
  that function means *the scope resolved to nothing*, not *there is no data*.
  Read `nexus_active_dealership_ids()` instead, and never record a zero from the
  singular resolver as an assertion result.

---

## What a completed Lab run is worth, said before anyone asks

Twenty green rows at L2 would mean: the ingestion layer handles the payloads we
can generate, against staging, with the tenancy rules we designed, at n=1,
sequentially, with no n8n, no provider authentication and no customer.

It would not mean the layer is production-proven, and it would not mean a
dealership's enquiries have ever passed through it — because on 6 September 2026
none have.

**implemented ≠ tested ≠ production-proven ≠ commercially validated.**
