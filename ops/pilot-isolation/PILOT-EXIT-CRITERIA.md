# Pilot exit criteria — measurable checks, with today's value beside each

**Written 9 September 2026.** Every criterion below is a query or a command with a
threshold, and every one carries **the value it returns today** so the distance is
visible rather than asserted. Nothing here is an adjective. "Isolation is solid",
"the system is stable" and "we are production-ready" are not criteria and do not
appear.

Three gates, in order:

- **Gate E — Entry.** Must be true **before a real dealership's customers' data
  enters the database.** Failing any E criterion means the pilot does not start.
- **Gate R — Running.** Must be true **on every day of the pilot.** A failing R
  criterion is an incident, and the response is to stop, not to note it.
- **Gate X — Exit.** Must be true **before any claim is made about the pilot** in a
  case study, a sales conversation or a second customer's contract.

**Status vocabulary, used strictly.** `PASS` = the check ran and met its threshold.
`FAIL` = the check ran and did not. `NOT RUN` = the check has not been executed —
**not a pass**. `UNKNOWN` = the check cannot currently be executed at all —
**not a zero**.

---

## Gate E — before a customer's data arrives

### E1 · Isolation is proven adversarially, not structurally
**Check:** every test in `BREAK-TESTS.md` has been executed on staging with two live
dealerships, and each carries a recorded result and a live positive control.
**Threshold:** 33 of 33 executed. 0 FAIL. 0 INCONCLUSIVE. Cross-tenant row count = 0
on every read, write and delete probe, **both directions**.
**Today:** 0 of 33 executed. **NOT RUN.**
**Note:** the 6 September staging pass proved assertions 1–8 at the database in both
directions with positive controls (`two-tenant-proof` §11). That evidence stands and
should not be re-earned — but it covers the RLS layer only, and six of its eight
assertions do not apply to `service_role`, which is what n8n holds.

### E2 · The `SECURITY DEFINER` surface has been probed cross-tenant
**Check:** `BREAK-TESTS.md` E1 — 26 functions × 2 directions.
**Threshold:** 52 of 52 probes return a **named refusal**; 0 return another
dealership's data, in the result *or* in an error message; every probe has a
same-tenant control that succeeds.
**Today:** 0 of 52. **NOT RUN.** 45 `SECURITY DEFINER` functions are executable by
every signed-in dealership user, all owned by `postgres` (`BYPASSRLS`), so RLS is off
inside all of them. The only automated evidence today is that all 45 mention
`tenant` or `auth.uid` somewhere in their body — which is not scoping.

### E3 · No cross-tenant foreign key reference is possible, or every one that is has
a detector that fires
**Check:**
```sql
-- from ISOLATION-MODEL.md §8
-- unprotected FK edges = child and parent both carry tenant_id,
-- FK omits it, and no composite tenant FK covers the same pair
```
**Threshold:** either 0 unprotected edges, or **every one of the remaining edges is
covered by a detector that is queried daily and is currently 0.**
**Today: 35 unprotected edges**, including 4 into `leads(id)` and 2 into
`purchase_history(id)` — the revenue-attribution path. One detector exists
(`v_lead_recovery_coverage.actions_whose_lead_is_another_tenants`) and covers one of
the 35. **FAIL.**

### E4 · A backend write that omits the tenant cannot land on a dealership
**Check:**
```sql
select count(*) filter (where column_default='nexus_default_tenant_id()'),
       count(*) filter (where column_default is null)
  from information_schema.columns
 where table_schema='public' and column_name='tenant_id';
select * from public.nexus_quarantine_census();
```
**Threshold:** every tenant table either defaults to the quarantine tenant or is
`NOT NULL` with no default; and the quarantine census is **0 rows and not growing**.
**Today:** 16 defaulted + 26 `NOT NULL`-no-default = **42 of 42 covered — PASS on the
mechanism.** But the census is **not** empty: `audit_log` 20 rows, `communication_logs`
1 row. **FAIL on the census.**

### E5 · Every live writer that has quarantined a row is identified and fixed
**Check:**
```sql
select tenant_id, workflow, count(*), max(logged_at) from audit_log
 where tenant_id='02c86264-6653-4522-b055-1c3f359a82fe' group by 1,2;
select tenant_id, count(*), max(created_at) from communication_logs
 where message like '[SILENCE%' group by 1;
```
**Threshold:** 0 rows written to the quarantine tenant in the trailing 7 days by any
workflow.
**Today:** `audit_log` — 20 rows, 9 named n8n workflows, all in a 43-minute window on
**6 Sep**, none since (last 3 days: 122 audit rows, all ALBA). That one is
**identified and dormant**. `communication_logs` — the **silence detector wrote a
marker into quarantine on 8 Sep at 02:59:50** and another onto ALBA at 03:04:36. Two
write paths, one of which omits the tenant, **live yesterday**. **FAIL.**

### E6 · The inbound webhook authenticates the caller before an execution starts
**Check:** `BREAK-TESTS.md` G2 — POST a payload naming a dealership, with no secret
header, at the staging webhook.
**Threshold:** HTTP 401/403 and **0** new `channel_message_events` rows.
**Today: UNKNOWN.** `WAHA_WEBHOOK_SECRET` is recorded unset; the n8n box was not
contacted by this pass. `nexus_resolve_channel_tenant` will faithfully resolve
whichever session string it is handed — that is correct function behaviour and it is
also why this check is the one that matters. **NOT RUN.**

### E7 · The deployed workflows match the repository, and every write names a tenant
**Check:** export live n8n; diff against `n8n-workflows/`; grep the fresh export for
`nexus_resolve_channel_tenant`, `NEXUS_TENANT_MAP`, `tenant_id`.
**Threshold:** the diff is understood, and every Supabase write node either names a
tenant or calls a resolver.
**Today: UNKNOWN.** `n8n-workflows/_index.json` records `exported_at 2026-08-30`, four
days before `channel_registry` was created; `grep -l tenant_id n8n-workflows/*.json`
matches **0 of 21** files. Every statement about workflow tenancy — in either
direction — is unverified. **NOT RUN.**

### E8 · Test traffic is separable from real traffic on the three tables the pilot is
counted from
**Check:**
```sql
select table_name, column_name from information_schema.columns
 where table_schema='public' and table_name in ('leads','communication_logs','audit_log')
   and column_name ~* 'test|demo|sim|environment|journey|correlation|run_id|fixture';
select source_key, environment, status from lead_ingest_endpoint;
```
**Threshold:** a marker exists on all three, **or** every pilot endpoint is
`environment='simulation'` during rehearsal and `production` only from the stated
start date, with that date recorded.
**Today:** **0 marker columns on all three tables.** 5 endpoints, **all
`production`, none `simulation`** — so `v_lead_origin.is_test_traffic` can only ever
return false, and the one preflight test on file
(`walkin-preflight-01@nexus-preflight.invalid`) is recorded as production traffic.
**FAIL.** (`BLOCKERS.md` §1, unchanged.)

### E9 · The database holds no data the dealership did not consent to
**Check:**
```sql
select count(*) from communication_logs c
 where not exists (select 1 from leads l where l.email = c.lead_email);
select count(*) from whatsapp_opt_in_event;
select count(*) from whatsapp_contacts;
```
**Threshold:** 0 messages from correspondents who are not leads; at least one opt-in
event per customer NEXUS sends to.
**Today:** **107 of 142 messages** are from 14 correspondents matching no lead, most
recent inbound **8 Sep**; `whatsapp_opt_in_event` = **0 rows**. **FAIL.**
(`BLOCKERS.md` §2.2 / §2.3 — the deletion procedure exists and has not been run.)

### E10 · The written terms exist
**Check:** a document names controller and processor, the retention window, the
deletion-on-request procedure, and where the data physically sits (Supabase project
region; the n8n VM `35.224.126.225`).
**Threshold:** it exists, is signed, and the retention purge has **run at least once
and left an audit row**.
**Today:** `select count(*) from audit_log where workflow ilike '%retention%' or workflow ilike '%purge%'` = **0**.
The purge workflow is registered, marked active, and has never run. **FAIL.**

### E11 · No single human is a member of two dealerships
**Check:**
```sql
select auth_user_id, count(*) from tenant_members group by 1 having count(*) > 1;
```
**Threshold:** 0 rows — **or** `nexus_current_tenant_id()` refuses ambiguity the way
`nexus_lead_record_manual` already does (`NX001 / DEALERSHIP_AMBIGUOUS`) and the six
singular-resolver consumers have been re-pointed.
**Today:** 0 rows, because there is only 1 membership on the entire platform. **PASS
today, and it is the criterion most likely to be broken by the act of onboarding** —
see `ONBOARD-TENANT-2.md` §5.

---

## Gate R — every day the pilot runs

Each of these is a one-line query. Run all six every morning; a failure stops the
pilot rather than being logged.

| # | check | threshold | today |
|---|---|---|---|
| **R1** | `select * from public.nexus_quarantine_census();` | 0 rows, and no growth vs yesterday | 2 tables non-empty — **FAIL** |
| **R2** | `select tenant_id, count(*) from audit_log where logged_at > now()-interval '1 day' group by 1;` | every row on an **active dealership**, none on quarantine | last 24h all ALBA — PASS |
| **R3** | `select tenant_id, actions_whose_lead_is_another_tenants from v_lead_recovery_coverage;` | 0 for every dealership | 0 (one dealership) — PASS, **untested at two** |
| **R4** | `select * from public.nexus_tenancy_readiness();` | zero `BLOCKER` rows | zero BLOCKERs at one dealership; F2 (6 Sep) shows it stays green at two while `nexus_scoped_tenant_id()` is NULL — **the gate is known not to measure the thing it is named for** |
| **R5** | as **each** dealership's owner: `select count(*) from nexus_workflow_catalogue();` | only that dealership's workflows | predicted 18 for both — **H1, NOT RUN** |
| **R6** | `select count(*) from search_rag_documents('warranty policy', 5);` as each dealership | > 0 for both | at 2 active dealerships, predicted **0 for both** — **H7, NOT RUN** |

**R7 · No screen shows a blended figure.** As any user, on `v_team_performance`,
`v_needs_attention` and `v_workflow_health`, every row must be attributable to one
dealership. **Today: 8 views expose tenant-derived data with no `tenant_id` column
(H6). NOT RUN against a browser.**

---

## Gate X — before anything is claimed

### X1 · The funnel can be counted
**Check:**
```sql
select (select count(*) from communication_logs c
         where exists (select 1 from leads l where l.email=c.lead_email))::numeric
       / nullif((select count(*) from communication_logs),0) as comm_joinable_pct,
       (select count(*) from leads where email like '%@whatsapp.lead' or email is null)::numeric
       / nullif((select count(*) from leads),0) as leads_with_no_real_email_pct;
```
**Threshold:** ≥ 90% of the pilot period's messages resolve to a lead.
**Today:** 24.6% of messages joinable; 8.4% of audit rows joinable; **60% of leads
carry no real email address**, only a phone-derived placeholder. The join is a string
match on `lead_email` because neither table carries `lead_id`. **FAIL.**
(`BLOCKERS.md` §2.7.)

### X2 · Recovered revenue is a measured chain, not a coincidence
**Check:**
```sql
select count(*) from lead_recovery_actions;
select lead_id, state, recovery_attribution_state, recovered_value_aed from v_lead_recovery;
```
**Threshold:** at least one lead where a recovery action was **raised, decided,
executed**, and a **recorded sale followed**, with `recovery_attribution_state =
ATTRIBUTED` and a non-null `recovered_value_aed`.
**Today:** `lead_recovery_actions` **0 rows**; `lead_owner_events` **0 rows**;
`recovered_value_aed` **null on all 5 leads**; the one sale carries the engine's own
verdict `SALE_WITHOUT_RECOVERY_ACTION` — *"This lead converted and NEXUS recovered
nothing… The sale is the dealership's, not the product's."* **FAIL, and no migration
can fix it — the pilot has to produce this chain.**

### X3 · No figure quoted in a claim is computed over test data
**Check:** the pilot's start date is recorded; no `daily_metrics` row predating it is
quoted; every lead, message and audit row in the numerator is separable from
pre-pilot rows.
**Threshold:** stated in the method note, with the start date.
**Today:** `daily_metrics` holds **20 snapshots** computed over a `leads` table whose
five rows are four non-enquiries and one preflight test. A marker added later cannot
clean a snapshot taken earlier. **Those 20 rows are permanently mixed** and must be
excluded by date. **FAIL until the date is recorded.**

### X4 · The one confirmed revenue figure is either real or excluded
**Check:** `select customer_name, email, amount_aed, lead_id from purchase_history;`
**Threshold:** every `purchase_history` row is a sale that happened.
**Today:** one row, AED 585,000, `lead_id 38`, reported by `v_lead_recovery` as
`CONFIRMED_SALE` with `HIGH` confidence — and
`commercial/PILOT-ONBOARDING.md:372` already records it as *"a repair test against
the owner's own lead — not a sale."* **The product reports a test as the only revenue
it has ever confirmed. FAIL.**

### X5 · Response-time and SLA claims rest on more than one row
**Check:** `select * from v_team_performance;`
**Threshold:** the denominator is stated wherever the figure is quoted.
**Today:** "average first response 1 minute, 100% within SLA" is computed over
**one assigned lead**, which is a wrong number asking about *"30 mm end clamps (solar
mounting hardware)"*. **FAIL.**

### X6 · Every channel named in a claim has delivery evidence
**Check:** for each channel claimed, an artefact proving delivery — a Slack `ts` or
permalink, a WhatsApp `wamid` with a delivery status, a message-id.
**Threshold:** one per channel, on file.
**Today:** Slack — 5 `SUCCESS` rows whose `summary` is the bare string `Completed`,
no channel, no `ts`, last **19 Aug**; every attempt since has failed 7 times with
*"unauthorized. A valid Supabase session token is required"*, and the workflow
**cannot succeed by construction** because Slack cannot supply that token.
Bitrix — **20 days with no success**, `bitrix_lead_id` and `crm_synced_at` null on all
5 leads. **FAIL for Slack and CRM. Both come out of any claim.**

### X7 · The isolation claim is stated at the width it was tested
**Threshold:** the written claim distinguishes, in its own words, between the
database layer and everything above it.
**What may be said today, and it is already earned** (`two-tenant-proof` §11):
> *"Isolation between two dealerships is proven adversarially at the database, in
> both directions, across a full customer journey, under real signed-in dealership
> roles. Every probe returned zero cross-tenant rows, with a live positive control on
> each one."*

**What may not be said, in any form:** *runtime*, *operational*, *production-proven*,
*ready for a second dealership*, *safe to onboard*, or *isolation is complete*. The
workflow layer writes as `service_role` (`BYPASSRLS`); six of the eight proven
assertions do not apply to it; 45 `SECURITY DEFINER` functions have never been probed
cross-tenant; and the inbound webhook still lets the caller name the dealership.

**The honest sentence is unchanged since 6 September:**
> *multi-tenant architecture implemented and adversarially proven at the database;
> second-dealer runtime proof pending.*

---

## Scoreboard as of 9 September 2026

| gate | criteria | PASS | FAIL | NOT RUN / UNKNOWN |
|---|---|---|---|---|
| **E — entry** | 11 | 2 (E4 mechanism, E11 trivially) | 6 | 4 |
| **R — running** | 7 | 2 | 1 | 4 |
| **X — exit** | 7 | 1 (X7, at the stated width) | 5 | 1 |

**No gate is met.** The two closest to closing are E5 (one live writer to fix — the
silence detector's second path) and E11 (a policy decision at onboarding, not
engineering). The furthest are X2 — which the pilot exists to produce and which no
amount of code will supply — and E2, 52 probes on the largest untested surface in the
system.
