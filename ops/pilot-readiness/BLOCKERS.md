# Pilot readiness — blockers, the test-data decision, and what a first case study may claim

All measurements taken **8 September 2026** against production
`dsvuoovivysszdoiorch` and, where stated, staging `wwspuxrbiyagnrnzgate`, through
the read-only SQL channel. **No row was written. No migration was applied. No n8n
workflow was called.** Every claim below carries the query that produced it.

**Reading caveat that applies to the whole file.** The SQL channel connects as a
privileged role, not as a signed-in dealership session, and Tenant A is the only
active dealership on this project. Every count is therefore a one-tenant count
taken by a role that RLS does not constrain. Where a check could only run at one
dealership it is recorded as NOT RUN for the multi-tenant case, not as a PASS.

This file answers one question: **what has to be true before a real dealership's
customers touch this system, and what may honestly be said afterwards.**

---

## 0. Which pilot is being planned — the fork that changes half this document

The 30-day plan says "one dealership, 7–14 days of real traffic". That is two
different projects and they have different blocker lists:

- **Pilot A — Tenant A, tenant #1.** No new tenant is activated. The tenancy
  blockers in §2 stay dormant. The test-data, WhatsApp-number, correlation-id and
  data-protection blockers all still fire.
- **Pilot B — a dealership that is not Tenant A.** Activating them makes
  `count(*) from tenants where status='active'` equal 2, and §2.2 through §2.4
  fire on the first day. This is the more likely reading of "a real dealership
  pilot" and it is the harder one.

Nothing below assumes which. Each blocker states which pilot it applies to.

---

## 1. The test-marker gap — measured, and the verdict is worse than "absent"

### 1.1 The search

```sql
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and (column_name ilike any (array[
         '%test%','%demo%','%sandbox%','%synthetic%','%simulat%',
         '%journey%','%correlation%','%trace%','%run_id%','%fixture%',
         '%seed%','%environment%','%env%']))
 order by table_name, column_name;
```

Run on production. Of 67 base tables and 42 views in `public`, the only columns
that could mark a row as non-real are:

| object | column | kind |
|---|---|---|
| `lead_event` | `environment` | base table, `CHECK (environment in ('production','simulation'))` |
| `lead_ingest_endpoint` | `environment` | base table, same CHECK |
| `v_lead_origin` | `is_test_traffic` | **derived**: `e.environment = 'simulation'` |

The same query on staging returns the same three and nothing else. There is no
marker anywhere else on either project.

**On `leads`, `communication_logs` and `audit_log` — the three tables every
pilot figure is computed from — there is nothing.** Full column lists:

```sql
select table_name, string_agg(column_name||':'||data_type, ', ' order by ordinal_position)
  from information_schema.columns
 where table_schema='public'
   and table_name in ('leads','communication_logs','audit_log')
 group by table_name;
```

- `leads` — id, name, email, phone, source, vehicle_interest, budget_aed, status,
  ai_score, assigned_to, response_time_minutes, created_at, assigned_to_id,
  escalated_at, bitrix_lead_id, crm_synced_at, tenant_id
- `communication_logs` — id, lead_email, channel, direction, message, created_at,
  sent_by, tenant_id, external_message_id, channel_key, direction_key,
  evidence_state
- `audit_log` — id, workflow, status, lead_name, lead_email, lead_score, intent,
  summary, logged_at, tenant_id

No `is_test`, no `test_run_id`, no `journey_id`, no `environment`, no
correlation id of any kind.

### 1.2 So the gap is real. It is also narrower and sharper than stated.

**Something does exist that was missed, and it does not rescue the position — it
proves the problem was already understood and then bypassed.**

`public.nexus_promote_lead_event(p_event_id uuid)` refuses to promote a
non-production event into `leads`, and says why in its own error text:

> `PROMOTION_REQUIRES_PRODUCTION_ENVIRONMENT` — *"This event is <env> traffic and
> public.leads has no way to say so. A simulation event may be recorded,
> hydrated, read and reported on through v_lead_origin, which carries
> is_test_traffic. It may not become a leads row: that table has no simulation
> marker, so the row would be counted as a real customer by pipeline value,
> response-time reporting and every recovered-revenue figure."*

That is a one-way valve, and it is the correct design. **It guards one path and
the pilot will not use that path.** Measured:

```sql
select (select count(*) from leads) leads,
       (select count(*) from lead_event) lead_events,
       (select count(*) from lead_event where lead_id is not null) linked;
-- leads 5 · lead_events 1 · linked 1
```

Four of the five leads on production never passed through `lead_event` at all.
They were written by the WhatsApp router as `service_role`, which the valve does
not sit in front of.

**And the fifth is the proof.** The one `lead_event` row is:

```sql
select event_id, source_key, phase, environment, lead_id, origin_verified
  from lead_event;
-- walk_in · PROMOTED · environment='production' · lead_id=121 · operator_recorded
```

Lead 121 is `Preflight Walk-In`, email
`walkin-preflight-01@nexus-preflight.invalid`. **It is Ali's own preflight test,
and it is on file as production traffic.** The valve did not catch it because the
environment is decided by the *endpoint*, and:

```sql
select source_key, environment, status from lead_ingest_endpoint order by source_key;
-- google_ads_lead_form   production  disabled
-- meta_lead_ads_facebook production  disabled
-- meta_lead_ads_instagram production disabled
-- phone_call             production  active
-- walk_in                production  active
```

**All five endpoints are `production`. There is no simulation endpoint on this
project.** `v_lead_origin.is_test_traffic` can therefore only ever return false
here. The marker exists, is unreachable, and the one row it could have described
is mislabelled.

### 1.3 The consequence, stated as the number it produces

`purchase_history` holds exactly one row:

```sql
select customer_name, email, phone, vehicle, purchase_date, amount_aed, lead_id from purchase_history;
-- Ali · shabbir53ujjainwala@gmail.com · +918517942172 · Lexus LX 600 2024
-- 2026-09-02 · 585000 · lead_id 38
```

`commercial/PILOT-ONBOARDING.md` line 372 already records what that row is:
*"one `purchase_history` row appeared at 09:59:53 on 2 Sep from a repair test
against the owner's own lead — not a sale."*

The database cannot say that. `select * from v_lead_recovery` returns, for lead
38:

| field | value |
|---|---|
| `state` | `RECOVERED` |
| `confirmed_outcome_state` | `CONFIRMED_SALE` |
| `confirmed_revenue_aed` | **585000** |
| `confidence` | `HIGH` |
| `confirmed_outcome_basis` | *"1 sale row(s) in purchase_history carry lead_id = 38. CONFIRMED revenue — a recorded business outcome, not an estimate and not attribution."* |

**A document in this repository knows the row is a test. The product reports it as
AED 585,000 of confirmed revenue with HIGH confidence.** That is the gap, and it
is not theoretical: it is the only revenue figure the system currently holds.

The same shape appears in response time:

```sql
select * from v_team_performance;
-- Ali Asgher · leads_assigned 1 · avg_response_minutes 1.0 · within_sla 1 · breached_sla 0
```

The single assigned lead is 34, whose `vehicle_interest` records it as a wrong
number asking about *"30 mm end clamps (solar mounting hardware)"*. **"Average
first response: 1 minute, 100% within SLA" is today computed over one wrong
number.**

### 1.4 Verdict

**The gap is proven.** A pilot dealership's leads, messages and audit rows would
land in the same three tables as the five rows above — of which four are
demonstrably not car enquiries and one is an explicit preflight test — with no
column able to separate them, and no marker on the two tables that carry the
conversation and the audit trail at all.

It changes the task in one way only: the fix does not have to be argued from
first principles, because `nexus_promote_lead_event` already argues it, names the
hazard, and names the guard interaction the migration would have to handle. §4 is
therefore a decision about *which* mechanism, not about whether one is needed.

---

## 2. Every pilot blocker

Ranked. **BLOCKS** = a real dealership's customers must not touch the system
until this is closed. **LIMITS** = the pilot can run, but a claim must be
withheld from the case study.

### 2.1 No test marker on the three tables the case study reads — **BLOCKS (both pilots)**

Measured in §1. Cheapest honest fix: §4.

### 2.2 The WhatsApp channel is Ali's personal handset, and it already holds other people's private messages — **BLOCKS (both pilots)**

```sql
select * from channel_registry;
-- whatsapp_waha_session          external_identifier='default'          active
-- whatsapp_cloud_phone_number_id external_identifier='1306545252542419' active
```

**That the WAHA session `default` is Ali's personal handset is asserted, not
measured here** — `CLAUDE.md` states it (*"All 51 were `@g.us` groups,
`status@broadcast` or `@newsletter` on Ali's personal handset"*) and
`commercial/PILOT-ONBOARDING.md` builds its three-number rule on it. What the
database can measure is what that session has captured, and it corroborates the
assertion:

```sql
select lead_email, count(*) n, max(created_at) l,
       exists(select 1 from leads x where x.email = c.lead_email) as is_known_lead
  from communication_logs c group by 1, c.lead_email order by 2 desc;
```

| measured | value |
|---|---|
| `communication_logs` rows | **142** |
| distinct correspondents | **18** |
| correspondents matching no lead | **14** (all `…@lid` WhatsApp identifiers) |
| messages from those 14 | **107 of 142 — 75%** |
| inbound share | **109 of 142** |
| most recent inbound | **2026-09-08 17:24 UTC — today** |
| `whatsapp_contacts` rows | **14** |
| rows with a message body stored | **142 of 142** |
| `whatsapp_opt_in_event` rows | **0** |

Two of the five leads exist only because this traffic tripped a keyword: lead 34
(solar mounting clamps) and lead 35 (a web-design contact), both auto-created
26 Aug and both `DISQUALIFIED`. A third, lead 122, has `vehicle_interest` = *"I
have been driving for 6-7 hours. Can you please adjust for a while?"*

`commercial/PILOT-ONBOARDING.md` already sets out the three-number rule and the
deletion procedure. It is not done: the traffic is still arriving today.

**Cheapest honest fix:** the dealership's own number on the dealership's own Meta
Business account, and the personal number disconnected before the pilot, per
`PILOT-ONBOARDING.md`. There is no cheaper version. A pilot dealership cannot be
asked to accept a system whose message table holds what
`commercial/PILOT-ONBOARDING.md` itself describes as *"a contracting company, a
perfumer, family members, and discussions about cheques and payments"* — and no
consent exists for any of it (`whatsapp_opt_in_event` = 0).

### 2.3 The private data already on file, and what a UAE dealership's data would join it — **BLOCKS (both pilots)**

What production holds today, all of it under the one active dealership:

| table | rows | content |
|---|---|---|
| `communication_logs` | 142 | message bodies, 107 of them from people who are not leads |
| `whatsapp_contacts` | 14 | phone numbers and push names |
| `leads` | 5 | names, phones, emails |
| `customer_360_profiles` | 4 | aggregated customer profiles |
| `kyc_documents` | 3 | identity documents |
| `purchase_history` | 1 | a name, an email, a phone and AED 585,000 |
| `audit_log` | 881 | 807 of them with no `lead_email` |

Retention: `select count(*) from audit_log where workflow ilike '%retention%' or
workflow ilike '%purge%'` returns **0**. The retention purge workflow is
registered and marked active and **has never run**, which
`commercial/PILOT-OFFER.md` and `PILOT-ONBOARDING.md` both already state.

What NEXUS would owe a UAE dealership the moment their customers' data arrives,
stated as obligations rather than as legal advice:

1. **A named controller/processor split in writing.** The dealership is the
   controller of its customers' data; NEXUS is the processor. Nothing in this
   repository is that agreement. `PILOT-OFFER.md` is a commercial offer, not a
   data-processing term.
2. **A lawful basis for messaging.** WhatsApp outbound to a customer needs
   consent or an existing business relationship. `whatsapp_opt_in_event` holds
   **0** rows, so NEXUS can evidence neither today.
3. **Deletion on request, and a retention window that is enforced rather than
   configured.** Today deletion is manual and there is no evidence any purge has
   ever run.
4. **Separation from anyone else's data, including the vendor's own.** §2.4.
5. **A disclosure of where the data sits.** Supabase project region and the n8n
   VM (`35.224.126.225`) are both outside the dealership's control and neither is
   named to a buyer anywhere in `commercial/`.

**Cheapest honest fix:** delete the non-dealership data per
`PILOT-ONBOARDING.md` before any pilot data arrives, record the counts before and
after, and put controller/processor, retention, deletion-on-request and hosting
location in the pilot agreement as plain sentences. This is drafting and one
deletion pass; it is not engineering.

### 2.4 A second active dealership silences five consumers — **BLOCKS Pilot B; dormant for Pilot A**

Re-verified today rather than carried forward. The consumers that genuinely call
`nexus_scoped_tenant_id()` in executable code (comment mentions stripped):

```sql
with f as (
  select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' fn,
         (select string_agg(l, E'\n') from unnest(string_to_array(p.prosrc, E'\n')) l
           where btrim(l) not like '--%') body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prosrc ilike '%nexus_scoped_tenant_id%')
select fn, body ilike '%nexus_scoped_tenant_id%' as really_calls_it from f;
```

| object | still a consumer |
|---|---|
| `nexus_comm_keys_for_lead(email, phone)` | **yes** |
| `nexus_lead_for_comm_key(key)` | **yes** |
| `search_rag_documents(q, limit)` | **yes** |
| `v_customer_directory` | **yes** (view definition) |
| `v_inventory_sales` | **yes** (view definition) |
| `nexus_tenancy_readiness()` | yes — deliberately, to measure the resolver |
| `nexus_active_dealership_ids()`, `nexus_workflow_catalogue()`, `nexus_resolve_channel_tenant()` | **no** — comment only |

**Nothing has changed since the 6 September measurement. It is still exactly
five, and none has been driven over `nexus_active_dealership_ids()`.**

One correction worth recording, because it removes a metric from the danger list:
the first-response trigger is **not** among them.
`public.nexus_mark_first_response()` calls the **tenant-explicit** form —
`nexus_lead_for_comm_key(new.lead_email, new.tenant_id)`, with the comment *"not
a session default: the row itself says whose it is"* — so response-time stamping
survives a second dealership. `v_lead_recovery` and the dashboard read the
stored column, not the silenced helper.

`select * from public.nexus_tenancy_readiness();` today returns **zero
BLOCKERs** (one active dealership), two by-design WARNs on `policy_rule` /
`policy_rule_event`, and one WARN that matters — §2.5.

**Cheapest honest fix for Pilot B:** drive the five over
`nexus_active_dealership_ids()` and re-run the two-dealership rehearsal on
staging before, not after, the second tenant is activated on production.

### 2.5 A live write path still omits `tenant_id` — **BLOCKS Pilot B; LIMITS Pilot A**

From `nexus_tenancy_readiness()`, verbatim:

> WARN — *rows are sitting in the quarantine tenant* … `audit_log 20`,
> `communication_logs 1`.

Confirmed directly:

```sql
select (select count(*) from audit_log where tenant_id='02c86264-6653-4522-b055-1c3f359a82fe'),
       (select count(*) from communication_logs where tenant_id='02c86264-6653-4522-b055-1c3f359a82fe');
-- 20 · 1
```

The quarantine tenant is doing its job — these rows are visible and recoverable
rather than silently filed under Tenant A. But **an unidentified live writer is still
producing them**, and at two dealerships that writer's output is a row that
belongs to somebody and is filed under nobody.

**Cheapest honest fix:** run `select * from public.nexus_quarantine_census();` as
`service_role` daily until it stops growing, and identify the writer from the 21
rows already there before the pilot starts.

### 2.6 `NEXUS_TENANT_MAP` unset, and the resolvers fall through — **BLOCKS Pilot B; dormant for Pilot A**

`grep -rl "NEXUS_TENANT_MAP"` across the repository returns **25 files: 24
Markdown and one SQL migration**. Zero `.js`, `.ts`, `.py`, and zero
`n8n-workflows/*.json`.

**The one SQL hit changes the picture and is worth reading.**
`20260903193511_chanreg_01_channel_registry_table.sql` says in its own header:

> *"Tenant resolution for inbound WhatsApp is currently done in an n8n Code node
> against `NEXUS_TENANT_MAP`, a JSON environment variable on the VM. Onboarding a
> second dealership therefore means editing an env var and restarting n8n: a
> production restart per customer, and a mapping nothing in the database can see,
> audit or scope. This table moves that mapping into the database."*

So `channel_registry` exists **to replace `NEXUS_TENANT_MAP` for that path**, it
is populated on production with two rows, and
`public.nexus_resolve_channel_tenant(channel_type, external_identifier)` is the
accessor — verified today to resolve only an active channel on an active tenant,
and to return nothing to `authenticated` or `anon`.

**What is still unknown, and it is the whole blocker: whether the deployed n8n
workflows call it.** `n8n-workflows/_index.json` records
`"exported_at": "2026-08-30T18:01:07"`; the folder holds **21 workflow files and
`grep -l tenant_id n8n-workflows/*.json` matches zero of them**. That export
predates `channel_registry` (created 2026-09-03) by four days, so it could not
mention the accessor even if the running workflows now do.
The claim "roughly fifteen resolvers fall through to a built-in single-tenant
map" is **asserted in `CLAUDE.md`, not measurable from this repository**, and
this pass did not touch the box.

**Cheapest honest fix:** export the live n8n workflows into the repository and
diff them against `n8n-workflows/`, then grep the fresh export for
`nexus_resolve_channel_tenant` and for `NEXUS_TENANT_MAP` and see which one the
running system uses. Until that export exists, treat every statement about
workflow tenancy — in either direction — as unverified.

### 2.7 No correlation id — `communication_logs` and `audit_log` join to `leads` by an email string — **BLOCKS the funnel; LIMITS everything else**

Neither table carries `lead_id`. The join is `lead_email`. Measured:

```sql
select
 (select count(*) from communication_logs c
   where exists (select 1 from leads l where l.email = c.lead_email))                    as comm_joinable,
 (select count(*) from communication_logs)                                               as comm_total,
 (select count(*) from audit_log a
   where exists (select 1 from leads l where l.email = a.lead_email))                    as audit_joinable,
 (select count(*) from audit_log)                                                        as audit_total,
 (select count(*) from audit_log where lead_email is null or btrim(lead_email)='')       as audit_no_email,
 (select count(*) from leads where email is null or btrim(email)='')                     as leads_blank_email,
 (select count(*) from leads where email like '%@whatsapp.lead')                         as leads_synthetic_email;
```

| measured | value |
|---|---|
| `communication_logs` rows joinable to a lead | **35 / 142 — 24.6%** |
| `audit_log` rows joinable to a lead | **74 / 881 — 8.4%** |
| `audit_log` rows with no `lead_email` at all | **807 / 881 — 91.6%** |
| leads with a blank email | **1 / 5** |
| leads whose email is a phone-derived placeholder `…@whatsapp.lead` | **2 / 5** |
| **leads with no real email address** | **3 / 5 — 60%** |

The brief's "25% of leads have no email" is close to the *message-side* figure —
75% of messages do not resolve to a lead — and understates the lead side: 60% of
leads carry no real email address, only a placeholder minted from a phone number.

The system does not pretend otherwise. `v_lead_recovery` reports lead 121 as
`state='NEW_RISK'` with the basis *"No message resolves to this lead under the
INV-002 identity rule. NEXUS knows a lead exists and nothing else about the
conversation."* That is honest, and it is also the shape of a funnel that cannot
be counted.

**Cheapest honest fix:** a nullable `lead_id integer references leads(id)` on
`communication_logs`, backfilled through `nexus_lead_for_comm_key(email,
tenant_id)` so the identity rule stays in one place, and written by the same
trigger that already resolves the lead for `nexus_mark_first_response`. Note that
this is an `ALTER TABLE` on `communication_logs`, which is **not** one of the two
tables carrying dashboard write grants, so §2.11 does not apply to it.

### 2.8 No appointment, test-drive or deal record exists anywhere — **BLOCKS four of the nine funnel stages**

```sql
select count(*) from information_schema.columns
 where table_schema='public'
   and (column_name ilike any (array['%appoint%','%test_drive%','%testdrive%','%booking%','%visit%']));
-- 0
```

Zero columns, and no table with such a name among the 67 in `public`. The owner's
funnel is *inbound → captured → qualified → responded → assigned → appointment →
test drive → deal → revenue*. **Appointment and test drive have no storage at
all.** Deal and revenue have exactly one storage row, `purchase_history`, whose
only row is a test (§1.3).

`CLAUDE.md` already states this as the sequencing rule — *"there is no service
table, no appointment table and no recon-cost column"*. It has not changed.

**Cheapest honest fix:** either build the two smallest possible tables
(`lead_appointment`, and a `test_drive` flag on it) before week 3, or **cut those
two stages from the pilot's stated funnel and say so in the case study.** Cutting
is cheaper and more honest than a table nobody fills in.

### 2.9 Bitrix24 has not succeeded since 19 August — **LIMITS**

```sql
select workflow, status, count(*) n, max(logged_at) last_at
  from audit_log group by 1,2 order by max(logged_at) desc;
```

| workflow | status | n | last |
|---|---|---|---|
| `wf_108 ERP Sync - Bitrix24` | SUCCESS | 7 | **2026-08-19 11:04:08** |
| `wf_108 ERP Sync - Bitrix24` | FAILED | 1 | 2026-08-26 02:40:47 |
| `wf_108 ERP Sync - Bitrix24 CRM` | FAILED | 10 | 2026-09-06 15:02:34 |
| `Customer 360 - Data Aggregation (Bitrix24)` | FAILED | 2 | 2026-08-23 06:33:49 |

**Confirmed: 20 days with no success, and every attempt since has failed.**
Corroborated on the lead rows themselves — `bitrix_lead_id` and `crm_synced_at`
are **null on all 5 leads**. No lead has ever reached the CRM.

**Cheapest honest fix:** none required for the pilot — but the CRM-sync claim
comes out of the case study, and out of any demo script, until a success is on
file.

### 2.10 Slack delivery to a channel has never been proven — **LIMITS**

Five `Slack Command Center` rows carry `status='SUCCESS'`, the last on
**2026-08-19 11:21:37**. Their `summary` is the string **`Completed`** — no
channel, no message timestamp, no Slack `ts`, no permalink. A success row that
names no channel is not evidence a message was delivered to one.

Every attempt since the workflow was renamed `Slack Command Center - AI Agent`
has failed, seven times, the last on 2026-09-06 15:02:53, all with:

> *"unauthorized. A valid Supabase session token is required in the Authorization
> header. (Slack itself cannot send one — see the comment in this node.)"* ·
> Failed at node: `Auth Gate`

**Confirmed: delivery to a Slack channel is unproven, and the current workflow
cannot succeed by construction — Slack cannot supply the token its own auth gate
demands.**

**Cheapest honest fix:** either post to Slack from a workflow that does not sit
behind that gate and capture the returned `ts` into `audit_log.summary`, or drop
Slack from the pilot's stated channel list. Do not describe Slack alerting as
working.

### 2.11 `ALTER TABLE` on `leads` or `inventory` silently strips the dashboard's write grants — **RISK, not a blocker, but it governs the §4 decision**

The event trigger is live:

```sql
select evtname, evtevent, evtenabled from pg_event_trigger;
-- nexus_guard_born_open_grants · ddl_command_end · O (enabled)
```

Its body fires on **any** table DDL in `public` and runs
`revoke insert, update, delete, truncate on <table> from authenticated`
unconditionally. In PostgreSQL a table-level `REVOKE` also removes the
corresponding **column-level** grants, which is what the two live write paths are
made of. Measured today:

```sql
select table_name, grantee, privilege_type, count(*) n_cols
  from information_schema.column_privileges
 where table_schema='public' and table_name in ('leads','inventory')
   and grantee='authenticated' group by 1,2,3;
```

| table | privilege | columns |
|---|---|---|
| `leads` | UPDATE | **8** — assigned_to, assigned_to_id, budget_aed, email, name, phone, status, vehicle_interest |
| `inventory` | INSERT | **9** |
| `inventory` | UPDATE | **8** |
| `inventory` | DELETE | table-level |

**These are intact today.** They were stripped once already, on 6 September, by
two `ALTER TABLE`s in migration `20260906065739`, and restored by
`20260906071310_restore_inventory_write_grants_the_acl_guard_stripped_on_alter`,
whose header states the hazard plainly: *"since the guard was installed on 4 Sep
2026, EVERY future ALTER TABLE against public.inventory or public.leads silently
deletes the dashboard's write grants, with no grant-shaped diff to review."*

This is a **known, documented, one-file-long repair**, not a reason not to alter
`leads`. It means any migration that touches `leads` must re-apply the eight
column UPDATE grants in the same file and assert them, exactly as that migration
does for `inventory`.

### 2.12 `leads.assigned_to_id` has a global foreign key — **BLOCKS Pilot B**

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.leads'::regclass and contype='f';
-- leads_assigned_to_id_fkey FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL
```

No tenant in the key. A lead can be assigned to another dealership's
salesperson. Still open, as `commercial/WHAT-WE-CLAIM.md` records.

**Cheapest honest fix:** a composite FK to `users(id, tenant_id)` — but that is
an `ALTER TABLE public.leads`, so §2.11 applies and the grants must be re-applied
in the same migration.

### 2.13 `daily_metrics` has already baked test data into 20 historical snapshots — **LIMITS, and it is irreversible**

```sql
select count(*) from daily_metrics;  -- 20
-- columns: snapshot_date, open_leads, hot_leads, warm_leads, cold_leads,
--          avg_response_minutes, pipeline_aed, units_at_risk, holding_cost_aed,
--          workflow_runs, workflow_failures, …
```

Twenty daily snapshots computed over a `leads` table whose contents are four
non-enquiries and a preflight test. **A marker column added in week 3 cannot
retroactively clean a snapshot taken in week 1.** Whatever §4 decides, the
existing 20 rows are permanently mixed.

**Cheapest honest fix:** do not quote any `daily_metrics` row predating the
pilot's start date in the case study, and record that start date explicitly.

### 2.14 `leads.status` has two vocabularies — **LIMITS the "qualified" count**

```sql
select status, count(*) from leads group by 1;
-- DISQUALIFIED 2 · COLD 1 · WARM 1 · new 1
```

`new` (lowercase) is written by `nexus_promote_lead_event`; `COLD`/`WARM`/
`DISQUALIFIED` by the router. Any "qualified" count in the case study has to
declare which values it treats as qualified, and the two writers do not agree on
a vocabulary.

**Cheapest honest fix:** state the mapping in the case study's method note. A
CHECK constraint would be better and is an `ALTER TABLE` on `leads` (§2.11).

### 2.15 Recovered revenue is 0 proven — **LIMITS, and it is the most important one**

```sql
select lead_id, state, confirmed_outcome_state, confirmed_revenue_aed,
       recovery_attribution_state, recovered_value_aed, opportunity_value_state
  from v_lead_recovery order by lead_id;
```

| lead | state | confirmed revenue | recovery attribution | recovered |
|---|---|---|---|---|
| 34 | CLOSED_NO_OUTCOME | null | NO_RECOVERY_ACTION | null |
| 35 | CLOSED_NO_OUTCOME | null | NO_RECOVERY_ACTION | null |
| 38 | RECOVERED | 585000 | **SALE_WITHOUT_RECOVERY_ACTION** | **null** |
| 121 | NEW_RISK | null | NO_RECOVERY_ACTION | null |
| 122 | ENGAGED | null | NO_RECOVERY_ACTION | null |

`recovered_value_aed` is **null on every row**. The one sale carries the engine's
own words: *"This lead converted and NEXUS recovered nothing: no recovery action
was ever raised against it. The sale is the dealership's, not the product's."*

Supporting measurements: `lead_recovery_actions` **0 rows**; `lead_owner_events`
**0 rows**; `automation_state = NO_AUTOMATED_EXECUTOR` on all five, with the
note *"No NEXUS workflow executes a lead recovery action… NEXUS records that they
acted; it does not act."*

And the value side is unavailable regardless:
`opportunity_value_state = UNKNOWN_NO_LINK` on all five, basis *"leads.budget_aed
is null on every lead on file and nothing links a lead to a unit, so this engine
cannot size what is at stake."*

**Cheapest honest fix:** none available in code. Recovered revenue requires a
recovery action to be raised, executed, and followed by a recorded sale. The
pilot must *generate* that chain; no migration produces it. This is the single
most important thing the pilot exists to produce, and today it has produced zero.

---

## 3. Blocker summary, ranked

| # | blocker | Pilot A (Tenant A) | Pilot B (new dealership) |
|---|---|---|---|
| 2.2 | WhatsApp on a personal handset; strangers' messages on file | **BLOCKS** | **BLOCKS** |
| 2.3 | Private data on file; no consent; no retention ever run; no DPA | **BLOCKS** | **BLOCKS** |
| 2.1 | No test marker on `leads` / `communication_logs` / `audit_log` | **BLOCKS** | **BLOCKS** |
| 2.7 | No correlation id — 24.6% of messages, 8.4% of audit rows join | **BLOCKS** the funnel | **BLOCKS** the funnel |
| 2.8 | No appointment / test-drive storage at all | **BLOCKS** 2 of 9 stages | **BLOCKS** 2 of 9 stages |
| 2.4 | Second dealership silences five consumers | dormant | **BLOCKS** |
| 2.5 | A live writer still omits `tenant_id` (21 quarantined rows) | LIMITS | **BLOCKS** |
| 2.6 | `NEXUS_TENANT_MAP` — unverifiable from this repository | dormant | **BLOCKS** |
| 2.12 | `leads.assigned_to_id` global FK | dormant | **BLOCKS** |
| 2.15 | Recovered revenue 0 proven | LIMITS | LIMITS |
| 2.9 | Bitrix24 — no success in 20 days | LIMITS | LIMITS |
| 2.10 | Slack channel delivery unproven, gate unsatisfiable | LIMITS | LIMITS |
| 2.13 | 20 `daily_metrics` snapshots already mixed | LIMITS | LIMITS |
| 2.14 | Two `leads.status` vocabularies | LIMITS | LIMITS |
| 2.11 | ACL guard strips write grants on `ALTER TABLE` | RISK | RISK |

---

## 4. The test-data decision

Three options were put. A fourth exists and is worth naming.

### (a) Add a marker column to `leads` (and to `communication_logs` and `audit_log`)

**What it costs.** Three `ALTER TABLE`s. The one on `leads` fires
`nexus_guard_born_open_grants()` and strips the eight column UPDATE grants
`authenticated` holds (§2.11), so the same migration must re-apply and assert
them — a known repair with a worked precedent in
`20260906071310_…`. Then every reader must learn to filter. Measured, rather
than guessed:

```sql
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relkind='v'
   and (pg_get_viewdef(c.oid,true) ~* '\mleads\M'
     or pg_get_viewdef(c.oid,true) ~* '\mcommunication_logs\M'
     or pg_get_viewdef(c.oid,true) ~* '\maudit_log\M');
-- 24
```

**24 views** read at least one of the three tables — `v_lead_recovery`,
`v_team_performance`, `v_customer_360`, `v_needs_attention`, `v_conversations`,
the five attribution views, the four deal-rescue views and the rest — plus the
`daily_metrics` capture job and every dashboard screen that counts leads. A
default of `false` makes the column invisible to a reader who forgets it — which is the failure mode `CLAUDE.md` calls *"a predicate that filters
nothing while reading like a scope"*.

**What it risks.** A partially-applied filter is worse than no marker, because
the screens then disagree with each other and each looks authoritative. And the
column does not defend itself: any writer that omits it produces a real-looking
row.

**Reversibility.** High for the column; **low for the readers**. Dropping the
column later means editing every view that learned to filter on it.

**Effect on existing queries and screens.** Every count changes on the day the
filter is added, with no migration-shaped diff on the screens. `daily_metrics`
rows already taken stay mixed (§2.13).

### (b) A separate tenant for all non-real traffic

**What it costs.** One `INSERT` into `tenants`. Nothing else — the machinery
already exists and is already proven: the quarantine tenant
(`__unattributed__`, `status='quarantine'`, `is_quarantine=true`) demonstrates
that a non-dealership tenant is **excluded from all 29 tenant-carrying views in
their own definitions**, is unreadable by any dealership session (0
`tenant_members` rows, and `nexus_current_tenant_ids()` requires
`status='active'`), and is findable by `service_role` through
`nexus_quarantine_census()`. Every one of those locks is measured live by
`nexus_tenancy_readiness()` today.

**What it risks.** Two things, and both are real:

1. **A test tenant with `status='active'` makes `count(*) from tenants where
   status='active'` equal 2 — which fires §2.4 immediately.** The five consumers
   go quiet the moment the test tenant is activated, on the *pilot's* data, not
   the test tenant's. A test tenant at `status='quarantine'` avoids that but is
   then invisible to every view, so nothing about the test run is observable
   through the product — which defeats using it to rehearse the product.
2. It separates rows but does not separate **channels**. Both tenants' WhatsApp
   traffic still arrives through the same registered session unless a second
   `channel_registry` row exists for the test tenant.

**Reversibility.** Very high. Delete the tenant's rows, delete the tenant. No
schema change, no reader change, no grant to restore.

**Effect on existing queries and screens.** **None.** Every view already excludes
non-active and quarantined tenants in its own definition. That is the whole
argument for this option.

### (c) A second Supabase project for the pilot

**What it costs.** The most, and it is not the money. The migration set is
`supabase/migrations/*` and could be replayed — the baseline is gate-checked
(`L12`) to reproduce the database it claims to. But the pilot would then run on a
project that has never carried real traffic, against an n8n box configured for
one Supabase URL, with `channel_registry`, `lead_ingest_endpoint`,
`policy_rule` and `tenant_configuration` all needing re-seeding, and every
credential re-pointed. And **the case study would then be about a system the
buyer's own dealership is not on.**

**What it risks.** Two databases drift. The one that gets the fixes is not
necessarily the one the pilot runs on. This is the option most likely to produce
a beautiful case study about a system that no longer exists.

**Reversibility.** Low in practice — data written on the second project has to be
migrated back or abandoned.

### (d) — not offered, and it is the cheapest of all: stop generating test traffic on production

`ops/lead-simulator/` and `ops/journey-lab/` exist. Staging
(`wwspuxrbiyagnrnzgate`) exists, has the same schema, and already carries two
synthetic dealerships. **The reason production holds test data is not that it
lacks a marker; it is that tests were run against production.** Lead 121 is a
preflight run; the AED 585,000 row is a repair test.

### Recommendation

**Take (b) and (d) together, and defer (a) until after the pilot.**

The reasoning, in order:

1. **(d) is free and removes the cause rather than labelling the symptom.** A
   marker column that nobody has to rely on is better than one everybody must
   remember. Certification runs, journey-lab runs and simulator runs go to
   staging. If a rehearsal must touch production, it goes to the test tenant.

2. **(b) costs one INSERT and changes no query, because the mechanism is already
   built and already proven.** The quarantine tenant is the existence proof: a
   non-dealership tenant that 29 views exclude *in their own definitions*, which
   is precisely the property (a) would have to add by hand to 24 views and hope
   nobody forgets. Use `status='quarantine'`, `is_quarantine=true`, slug
   `__pilot_test__`, and read it with `nexus_quarantine_census()` — accepting
   that its rows are invisible to the product's screens, which for a test tenant
   is correct rather than a limitation. **Do not set it `active`**: that fires
   §2.4 against the pilot dealership's own data.

3. **(a) is the right long-term answer and the wrong week-3 answer.** It is the
   fix `nexus_promote_lead_event` itself asks for, and it is what finally lets a
   simulation event become a lead so the funnel can be exercised end to end. But
   it touches 24 measured view readers plus the screens, and doing it in the
   week before a dealership's
   customers arrive is how a screen starts disagreeing with another screen in
   front of a buyer. Do it after the pilot, as a deliberate pass, with the grant
   re-application and assertion in the same migration.

4. **(c) is refused** for the pilot. It buys cleanliness at the cost of the one
   thing the case study needs: that the pilot ran on the system being sold.

**One thing (b) does not fix, and must be said plainly:** the 5 leads, 142
messages, 881 audit rows and 20 metric snapshots **already on production** are
not separated by any of these options. They are separated only by deletion
(§2.3) or by a start-date cutoff in the case study's method note. Do both.

---

## 5. Pilot entry criteria

All-green before a real dealership's customers touch this system. Each item has
its probe. An item that cannot be probed is not green.

### Channel and consent

| # | criterion | probe | today |
|---|---|---|---|
| E1 | The personal WhatsApp number is disconnected from NEXUS | `select * from channel_registry where channel_type='whatsapp_waha_session';` returns no row for the personal session, **and** `select max(created_at) from communication_logs where channel='whatsapp'` stops advancing | **RED** — session `default` active; last inbound 2026-09-08 17:24 |
| E2 | The pilot dealership's own number is registered to the pilot tenant | `select tenant_id, channel_type, external_identifier, status from channel_registry;` shows the dealership's number under the dealership's tenant | **RED** |
| E3 | Every non-dealership contact and message is deleted, with counts recorded before and after | `select count(*) from whatsapp_contacts;` and `select lead_email, count(*) from communication_logs group by 1;` — no `…@lid` correspondent that is not a lead | **RED** — 14 contacts, 107 messages from 14 non-leads |
| E4 | An opt-in or existing-relationship basis exists for every customer NEXUS will message | `select count(*) from whatsapp_opt_in_event;` > 0 and covers the contacts on file | **RED** — 0 |
| E5 | `POST /webhook/whatsapp-inbound` refuses an unauthenticated caller | `WAHA_WEBHOOK_SECRET` fingerprint check **in the consuming container**: `docker compose exec -T n8n-worker sh -c 'printf %s "$WAHA_WEBHOOK_SECRET" \| sha256sum'` compared against the sender's | **NOT RUN** — this pass did not touch the box |

### Data separation

| # | criterion | probe | today |
|---|---|---|---|
| E6 | Zero rows in the quarantine tenant, or every one accounted for and its writer named | `select * from public.nexus_quarantine_census();` as `service_role` | **RED** — audit_log 20, communication_logs 1 |
| E7 | The tenancy gate returns zero BLOCKERs **at the tenant count the pilot will run at** | `select * from public.nexus_tenancy_readiness();` | **GREEN at 1 tenant**, **NOT RUN at 2** |
| E8 | For Pilot B: the five `nexus_scoped_tenant_id()` consumers are driven over `nexus_active_dealership_ids()` | the comment-stripped `pg_proc` query in §2.4 returns zero real consumers other than the readiness gate | **RED** — five |
| E9 | For Pilot B: the two-dealership rehearsal has been run on staging and recorded | an evidence file under `ops/evidence/` dated after the change, showing the five consumers non-zero at two active tenants | **RED** |
| E10 | A test tenant exists and all non-real traffic goes to it | `select id, slug, status, is_quarantine from tenants;` shows `__pilot_test__` at `status='quarantine'` | **RED** — does not exist |
| E11 | No test traffic has been run against production since the pilot start date | `select min(created_at) from leads where tenant_id = <pilot tenant>;` equals or postdates the recorded start date | n/a until a start date exists |

### Measurability

| # | criterion | probe | today |
|---|---|---|---|
| E12 | `communication_logs` carries `lead_id`, and ≥ 90% of pilot-window messages resolve | `select count(*) filter (where lead_id is not null)::numeric / count(*) from communication_logs where created_at >= <start>;` | **RED** — column does not exist; email join resolves 24.6% |
| E13 | Every lead in the pilot window has a measured or explicitly-unmeasured first response | `select response_time_state, count(*) from v_lead_recovery group by 1;` — no state other than `MEASURED` / `UNKNOWN_NOT_MEASURED`, and the UNKNOWN count is understood | **AMBER** — 3 MEASURED, 2 UNKNOWN of 5 |
| E14 | Appointment and test drive either have storage, or are struck from the stated funnel | the §2.8 `information_schema` probe returns > 0, **or** the pilot brief no longer names those two stages | **RED** — 0 columns, both stages still named |
| E15 | The `leads.status` vocabulary used for "qualified" is written down | a method note naming the exact values | **RED** |

### Delivery paths

| # | criterion | probe | today |
|---|---|---|---|
| E16 | Every workflow the pilot depends on has a SUCCESS inside the last 7 days | `select workflow, max(logged_at) from audit_log where status='SUCCESS' group by 1;` | **AMBER** — WhatsApp BDC yes; Bitrix24 no since 19 Aug; Slack no since 19 Aug |
| E17 | Slack is either proven with a channel and `ts` on file, or struck from the stated channels | an `audit_log` row for a Slack workflow whose `summary` names a channel and a message id | **RED** — 5 SUCCESS rows all read `Completed` |
| E18 | Bitrix24 is either proven or struck | `select count(*) from leads where crm_synced_at is not null;` > 0 | **RED** — 0 of 5 |

### Governance

| # | criterion | probe | today |
|---|---|---|---|
| E19 | A written controller/processor, retention, deletion and hosting term is signed | the document exists and the dealership has signed it | **RED** |
| E20 | Manual deletion on request has been exercised once and the counts recorded | an evidence file showing a before/after count | **RED** |
| E21 | The pilot's start timestamp is recorded, and no pre-pilot row is quoted | the timestamp is written into the case-study method note | n/a |

**Nothing in this list is green today except E7 at one tenant.**

---

## 6. The measurement plan, and which metrics are not computable

For each metric the owner named: the query, and whether it can be computed today.

| # | metric | query | computable today |
|---|---|---|---|
| M1 | **Inbound enquiries** | `select count(*) from lead_event where tenant_id=$1 and received_at >= $2;` | **NO.** `lead_event` holds 1 row on production and four of five leads never touched it. The WhatsApp path — the only live inbound path — writes straight to `leads`. There is no table that counts an enquiry that did not become a lead. |
| M2 | **Captured** | `select count(*) from leads where tenant_id=$1 and created_at >= $2;` | **YES**, and it equals M1 by construction, which is the problem: capture rate cannot be measured when the denominator does not exist. |
| M3 | **Qualified** | `select status, count(*) from leads where tenant_id=$1 and created_at >= $2 group by 1;` | **YES, with a caveat** — two vocabularies (§2.14). The mapping must be declared. |
| M4 | **Responded** | `select count(*) from leads where tenant_id=$1 and created_at >= $2 and response_time_minutes is not null;` | **YES.** The single writer is the trigger `trg_comm_logs_first_response`, verified today to use the tenant-explicit resolver. |
| M5 | **Response time** | `select avg(response_time_minutes), percentile_cont(0.5) within group (order by response_time_minutes) from leads where tenant_id=$1 and created_at >= $2 and response_time_minutes is not null;` | **YES for the leads it resolves; NO as a population figure.** Coverage today is 3 of 5, and the stamp depends on `nexus_lead_for_comm_key` matching an email or phone — which fails for 60% of leads that carry a placeholder email. The number that comes out is a survivor figure and must be published with its denominator. Today it is **1.0 minute over one wrong-number lead** (§1.3). |
| M6 | **Assigned** | `select count(*) from leads where tenant_id=$1 and created_at >= $2 and assigned_to_id is not null;` | **YES**, but 1 of 5 today, and `lead_owner_events` holds **0** rows, so *when* and *by whom* is not recoverable for anything assigned before that table started being written. |
| M7 | **Appointment** | — | **NO. No storage exists.** §2.8. |
| M8 | **Test drive** | — | **NO. No storage exists.** §2.8. |
| M9 | **Deal** | `select count(*) from purchase_history where tenant_id=$1 and purchase_date >= $2;` | **YES mechanically, NO as evidence** — the writer is not identified, the one existing row is a repair test, and `deal_id` is a synthetic string `auto:<email>\|<date>`. |
| M10 | **Revenue** | `select sum(amount_aed) from purchase_history where tenant_id=$1 and purchase_date >= $2;` | **YES mechanically.** Same caveat. |
| M11 | **AI false positives** | — | **NO.** `leads.ai_score` holds the model's number; nothing holds a human's verdict on that number. `DISQUALIFIED` is a status a person can set, but it is not versioned and no row records that it *contradicted* the AI. No ground-truth column exists. |
| M12 | **AI false negatives** | — | **NO, and structurally so.** A false negative is an enquiry the AI did not score as worth pursuing that turned out to be. With M1 uncountable and no outcome linked to a score, the denominator does not exist. |
| M13 | **Human overrides** | `select event, count(*) from lead_owner_events where tenant_id=$1 and at >= $2 group by 1;` | **PARTIALLY.** The table exists with the right shape (`event, actor_authority, from_staff_id, to_staff_id, reason`) and holds **0 rows** — so owner reassignment will be countable from the pilot onwards. Overrides of *AI score* or *status* are not covered by it and remain uncountable. |
| M14 | **Missed leads** | `select count(*) from v_lead_recovery where tenant_id=$1 and silence_state='SILENT_PAST_STALE_THRESHOLD';` | **PARTIALLY, and it is weaker than it looks.** `v_lead_recovery` computes silence from messages that resolve to the lead. A lead whose messages do not resolve reports `state='NEW_RISK'` with the basis *"No message resolves to this lead"* — indistinguishable, in a count, from a lead nobody answered. **A missed lead and an unlinkable lead are the same row today.** That is exactly what §2.7 fixes. |
| M15 | **Recovered leads / recovered revenue** | `select count(*), sum(recovered_value_aed) from v_lead_recovery where tenant_id=$1 and recovery_attribution_state not in ('NO_RECOVERY_ACTION','SALE_WITHOUT_RECOVERY_ACTION');` | **NO — 0 proven, and no code change produces one.** Requires a recovery action raised, executed and followed by a recorded sale. `lead_recovery_actions` = 0. `automation_state = NO_AUTOMATED_EXECUTOR` on every lead. |

### The work that must happen before week 3, in priority order

1. **`communication_logs.lead_id`** (§2.7). Without it M5 and M14 are survivor
   statistics and M14 conflates "missed" with "unlinkable". This is the single
   highest-value change in the list.
2. **Decide M7/M8** — build two small tables or strike two stages from the
   funnel. Striking is honest; a table nobody fills in is not.
3. **A count of inbound that did not become a lead** (M1). Without it, capture
   rate — arguably the headline metric of the whole product — has no denominator.
4. **A ground-truth column for the AI verdict** (M11/M12), or accept that AI
   accuracy is not a pilot output and say so.
5. **Raise at least one real recovery action** (M15), or the case study has no
   recovered figure at all.

---

## 7. What a first case study may honestly claim

Using the repo's vocabulary. `commercial/WHAT-WE-CLAIM.md` outranks this section
for anything said to a buyer.

### May be claimed, if the pilot runs and the entry criteria are met

- **Detected.** *"NEXUS detected N enquiries falling silent past the
  dealership's own 12-hour threshold, during a 14-day pilot at one dealership."*
  This is `v_lead_recovery.silence_state`, computed from message timestamps, and
  it is the strongest thing the product can currently say — **provided §2.7 is
  fixed first**, or the claim carries its resolution rate on its face.
- **Detected (inventory).** *"NEXUS detected N units carrying AED X of gross
  margin that had not sold in more than 120 days."* `v_inventory_profit_sentinel`
  computes this from cost and price present on all 12 units. It is exposure, not
  expected loss.
- **Measured (response time), with its denominator.** *"First response was
  measured on N of M leads; median X minutes."* Never *"our average response time
  is X"* without N and M.
- **Confirmed (sale).** Only for a `purchase_history` row the dealership itself
  confirms is a real sale, dated inside the pilot window, and only after the
  pre-pilot row is excluded by date.

### May not be claimed

- **Recovered.** Nothing. `recovered_value_aed` is null on every row on file and
  the engine says so in its own words. A recovered figure requires the pilot to
  produce a recovery action → execution → sale chain that does not exist today.
- **Attributed.** No revenue may be attributed to NEXUS. The one sale on file is
  `SALE_WITHOUT_RECOVERY_ACTION` — *"The sale is the dealership's, not the
  product's."*
- **Influenced.** Not available. Nothing links a lead to a unit
  (`opportunity_value_state = UNKNOWN_NO_LINK` on all five) and
  `leads.budget_aed` is null on every lead, so no pipeline value can be sized,
  let alone influenced.
- **Estimated (pipeline).** `v_team_performance.pipeline_aed` is **null**. Any
  estimated pipeline figure would be invented.
- **Any figure computed over data predating the pilot start date.** Four of five
  leads on file are not car enquiries; the fifth is a preflight test; the only
  revenue row is a repair test; 20 `daily_metrics` snapshots already mix them.
- **"CRM-integrated."** Bitrix24: no success in 20 days, 0 of 5 leads ever
  synced.
- **"Slack alerts to the sales channel."** Delivery to a channel has never been
  evidenced and the current workflow's auth gate cannot be satisfied by Slack.
- **"AI accuracy of X%."** No ground truth exists (M11/M12).
- **"Multi-tenant" / "we can add your second branch."** Unchanged from
  `commercial/WHAT-WE-CLAIM.md`. Five consumers still go silent at two active
  dealerships and the workflow-side tenancy is unverifiable from this repository.
- **"Automatic data retention / purging."** The purge workflow has never run
  (0 audit rows, ever).
- **Anything about the pilot dealership stated as a product claim.** One
  dealership's pilot is one dealership's figure.

### The one sentence the case study can lead with, if the pilot runs clean

> *"Over 14 days at one dealership, NEXUS detected N enquiries going silent past
> the dealership's own threshold and measured first response on M of P leads.
> Every figure below is one dealership's, over a stated window, and no revenue is
> attributed to the product."*

That is smaller than the plan wants and it is defensible. Every larger sentence
available today is defensible only until someone asks for the query.

---

## Open questions for Ali

Decisions only the owner can make. Each one changes the work.

1. **Which pilot is it — Tenant A again, or a dealership that is not Tenant A?**
   Everything in §2.4, §2.5, §2.6 and §2.12 is dormant for one answer and a hard
   blocker for the other. Nothing else in this plan can be sequenced until this
   is settled.

2. **Are appointment and test drive in the pilot funnel, or out?** They have no
   storage anywhere in the database. Building two tables is a week's work that
   nobody will fill in unless the dealership's staff are asked to; striking them
   costs a sentence. Both are honest. Guessing is not.

3. **Is the pilot dealership told that the system has been running on a personal
   number, and that their customers' messages will sit in a database that still
   holds unrelated private conversations — 107 messages from 14 people who are
   not leads, the most recent arriving today?** The deletion in
   `PILOT-ONBOARDING.md` is the right act; whether it is disclosed as well as
   done is a commercial judgement, and it is the kind a buyer remembers either
   way.

4. **Who is the controller and who is the processor, in writing, before a
   customer record arrives?** There is no such document in `commercial/`. This
   is not an engineering task and no migration produces it.

5. **What is the pilot's retention window, and who may delete?** The purge
   workflow has never run. Whatever is promised must be a number a person can
   execute by hand and evidence.

6. **Is a case study without a recovered-revenue figure worth publishing?**
   Today the answer the data supports is *detected*, not *recovered*. If the
   answer is no, then the pilot's design has to change — it must deliberately
   raise, execute and record recovery actions, which means a person acting on
   NEXUS's prompts every day for 14 days, because `automation_state` is
   `NO_AUTOMATED_EXECUTOR` on every lead and NEXUS will not act on its own.

7. **May test traffic run against production at all after the pilot begins?**
   The recommendation in §4 is no — staging and a quarantine-status test tenant.
   That costs the ability to rehearse on the real box. If the answer is that it
   must, then option (a) becomes urgent rather than deferred, and the 24-view
   filter pass has to happen before week 3 rather than after.

8. **Which date is "day zero"?** Every honest figure in the case study is scoped
   to a window. The 5 leads, 142 messages, 881 audit rows and 20 metric snapshots
   already on file are outside it, and no option in §4 changes that.
