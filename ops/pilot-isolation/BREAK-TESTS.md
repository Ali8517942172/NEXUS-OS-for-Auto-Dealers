# Break tests — how to disprove isolation, not confirm it

**Written 9 September 2026. Every test below is `NOT RUN`.** This file is a design.
Nothing in it has been executed against production, staging, or anywhere else by this
pass. A test that has not run is not a PASS and must never be reported as one.

These tests exist to make the claims in `ISOLATION-MODEL.md` falsifiable. That file
measures the *mechanisms*; this one tries to get past them.

---

## 0 · Rules for whoever runs these

1. **Staging only.** `wwspuxrbiyagnrnzgate`. Production `dsvuoovivysszdoiorch` holds
   one real dealership's customers and is read-only for this purpose. A test that
   writes is a test that must not touch production.
2. **Wrap every probe in an aborting transaction.** The 6 September pass's idiom —
   `DO $$ … RAISE EXCEPTION 'RESULT: %', … $$` — returns the answer in the error and
   leaves nothing behind. Reuse it. Note that sequences still advance
   (`two-tenant-proof` §9); record that rather than reading the gap as deleted rows.
3. **Control first, always.** A probe that returns 0 rows against a row that does not
   exist proves nothing. Every cross-tenant probe below has a same-tenant control on
   the same row in the same transaction. **A test without a live positive control is
   not evidence and must be recorded as INCONCLUSIVE, not PASS.**
4. **Name the lock, not the outcome.** Three refusals mean three different things and
   they are not interchangeable:
   - `rows = 0` — the verb was allowed and **RLS filtered**. The tenant lock worked.
   - `42501` — refused by **GRANT**, before RLS was consulted. Says nothing about
     tenancy.
   - `23503 / 23505 / 23514 / 23502` — refused by a **constraint**. This is the only
     class that also holds against `service_role`.
   A `42501` recorded as "isolation PASS" is the single most likely way this exercise
   produces a false green.
5. **Two dealerships must be genuinely active.** Several controls (`H7`, `E3`, `F1`)
   only fire when `count(*) from tenants where status='active' and not is_quarantine`
   is ≥ 2. Running them against a one-tenant database produces the *safe* answer for
   the wrong reason.

**Fixture assumed:** staging tenants `staging-alpha`
(`11111111-1111-4111-8111-111111111111`, owner auth uid `aaaaaaaa-…-a001`) and
`staging-bravo` (`22222222-2222-4222-8222-222222222222`, owner `bbbbbbbb-…-b001`),
per `two-tenant-proof-2026-09-06.md` §1. Each must own a freshly created lead, unit,
purchase, conversation and action inside the test transaction — the whole journey,
not just a lead.

**How to be a signed-in dealership user in SQL** (the same approximation the 6 Sep
pass used, and the same caveat — this is how PostgREST *presents* a JWT, it is not a
signed JWT travelling through PostgREST; see `X1`):

```sql
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001','role','authenticated')::text,
  true);
```

---

## A · The anon key

The public key ships in the browser bundle. Assume the attacker has it.

### A1 — read every table as `anon`
```sql
set local role anon;
select count(*) from public.leads;
```
**Expected safe:** `42501 permission denied for schema public`. The schema door
answers, not the row filter — measured 9 Sep on production:
`has_schema_privilege('anon','public','USAGE') = false`.
**Failure looks like:** any row count, including 0. A `0` here means USAGE was
re-granted and only RLS is holding, which is one migration away from a leak.
**Sweep, not a spot check:** loop all 67 tables + 42 views and assert 109/109 refuse.
**Status: NOT RUN.**

### A2 — `anon` over HTTP, which is the real attacker's channel
```
curl -s -o /dev/null -w '%{http_code} ' \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  "https://<project>.supabase.co/rest/v1/leads?select=id,name,email,phone&limit=5"
```
**Expected safe:** `401` or `404`, and an empty body. **Failure:** `200` with any
array, empty or not — a `200 []` proves the door is open and only the filter is
holding. Repeat for `communication_logs`, `purchase_history`, `kyc_documents`,
`v_customer_360`, `rag_documents`, and `rpc/nexus_workflow_catalogue`.
**Status: NOT RUN.**

### A3 — `anon` executes anything
```sql
set local role anon;
select public.nexus_workflow_catalogue();
select public.nexus_current_tenant_ids();
```
**Expected safe:** `42501` on both — measured 9 Sep, `anon` has EXECUTE on **zero** of
the 45 `SECURITY DEFINER` functions. **Failure:** any result set.
**Regression value:** this is exactly what H9 (the ACL guard revokes new functions
from `anon` but not `authenticated`) will eventually break. Run it after every
migration.
**Status: NOT RUN.**

---

## B · Cross-tenant read and write as a signed-in dealership user

Run each as Alpha's owner against Bravo's rows, then **mirrored** as Bravo against
Alpha's. One direction is half a test.

### B1 — read the other dealership's lead
```sql
-- control (must return 1)
select count(*) from public.leads where id = <alpha_lead_id>;
-- probe (must return 0)
select count(*) from public.leads where id = <bravo_lead_id>;
```
**Expected safe:** control 1, probe 0. **Failure:** probe ≥ 1, or control 0 (which
makes the probe meaningless — INCONCLUSIVE, fix the fixture).
Repeat across `communication_logs`, `purchase_history`, `inventory`, `kyc_documents`,
`audit_log`, `customer_360_profiles`, `finance_quotes`, `whatsapp_contacts`,
`rag_documents`, `deals_embeddings`, `tenant_configuration`, `tenant_capability`.
**Status: NOT RUN.**

### B2 — write into the other dealership
```sql
update public.leads set status='COLD' where id = <bravo_lead_id>;   -- expect 0 rows
update public.inventory set price_aed = 1 where tenant_id = <bravo>; -- expect 0 rows
insert into public.inventory (id, model, vin, status, price_aed, cost_aed, tenant_id)
values ('B-STEAL','x','x','available',1,1, '<bravo_tenant_id>');     -- expect 42501
```
**Expected safe:** the two UPDATEs report `UPDATE 0`; the INSERT is refused by the
`inventory_role_insert` WITH CHECK
(`tenant_id in (select nexus_tenant_ids_for_roles(array['owner','admin']))`).
**Failure:** `UPDATE 1`, or an INSERT that succeeds — the row would then be Bravo's
data written by Alpha with a correct-looking `tenant_id`, and nothing downstream
could tell.
**Control:** the same INSERT with Alpha's tenant_id must succeed, or the probe proves
nothing.
**Status: NOT RUN.**

### B3 — move a row between dealerships
```sql
update public.inventory set tenant_id = '<bravo>' where id = '<alpha_unit>';
```
**Expected safe:** `42501` — `tenant_id` is **not** in the 8-column UPDATE grant on
`inventory` (measured 9 Sep: `acquired_at, ai_recommendation, cost_aed, id, model,
price_aed, status, vin`). **Failure:** success, or `UPDATE 0` *without* an error —
`UPDATE 0` here would mean the grant exists and RLS merely filtered, which is a
weaker control than it looks and must be recorded as such.
**Status: NOT RUN.**

### B4 — delete
```sql
delete from public.leads where id = <bravo_lead_id>;            -- expect 42501 (no grant)
delete from public.purchase_history where id = '<bravo_sale>';  -- expect 42501
delete from public.inventory where tenant_id = '<bravo>';       -- expect 0 rows (grant exists, RLS filters)
delete from public.inventory where id = '<alpha_unit>';         -- CONTROL: must reach the row
```
The control matters more than the probe: on 6 Sep the own-tenant delete returned
`23503` (an FK from `inventory_actions` stopped it), which **proves the DELETE verb
reaches the owner's own row** and therefore that the cross-tenant `0` is a filter and
not an absence of capability. Without that, `0` and `0` are indistinguishable.
**Status: NOT RUN.**

### B5 — read another dealership's staff and memberships
```sql
select count(*) from public.users where tenant_id = '<bravo>';           -- expect 0
select count(*) from public.tenant_members where tenant_id = '<bravo>';  -- expect 0
select count(*) from public.tenants where id = '<bravo>';                -- expect 0
insert into public.tenant_members (tenant_id, auth_user_id, role)
values ('<bravo>','<alpha_owner_uid>','owner');                          -- expect 42501
```
**Failure:** any non-zero, or an INSERT that succeeds — self-granted membership is
total compromise, because membership *is* the authority (`nexus_current_tenant_ids()`).
**Status: NOT RUN.**

---

## C · Spoofing the tenant

### C1 — forged JWT `tenant_id` claim
```sql
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
  'role','authenticated',
  'tenant_id','22222222-2222-4222-8222-222222222222')::text, true);
select public.nexus_current_tenant_ids();   -- expect Alpha only
select public.nexus_current_tenant_id();    -- expect Alpha
select count(*) from public.leads where tenant_id='<bravo>';  -- expect 0
```
**Expected safe:** the claim is a *filter over membership*, never a source of it —
`nexus_current_tenant_id()`'s inner branch joins `tenant_members` on `auth.uid()` and
falls through to the caller's own membership when the join fails.
**Failure:** Bravo appears in either resolver, or any Bravo row is readable.
**Variant C1b:** forge the claim naming the **quarantine** tenant. Expect Alpha only.
**Status: NOT RUN.**

### C2 — forged `role` claim (privilege escalation, not tenancy)
```sql
select set_config('request.jwt.claims', json_build_object(
  'sub','<alpha_member_uid>','role','service_role')::text, true);
select current_setting('role'), count(*) from public.leads;
```
**Expected safe:** the GUC claim does not change the Postgres role — `set local role`
does, and PostgREST sets the role from the *signed* JWT, not from a claim the caller
invents. Expect Alpha's rows only.
**Failure:** rows from both dealerships. This is the test that decides whether
`current_setting('role')` — which `nexus_resolve_channel_tenant`,
`nexus_default_tenant_id`, `nexus_scoped_tenant_id` and `nexus_workflow_catalogue`
all use as a guard — can be influenced by a request. If it can, four guards fall at
once.
**Status: NOT RUN. This is the highest-value test in the file.**

### C3 — `tenant_id` in a webhook body
The ingest path takes the tenant from the endpoint key, never the body
(`ISOLATION-MODEL.md` §7). Prove it:
```
curl -X POST "https://<project>.supabase.co/rest/v1/rpc/nexus_record_lead_event" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" -d '{
   "p_public_key":"<ALPHA endpoint public key>",
   "p_external_event_id":"break-C3-001",
   "p_origin_verified":"operator_recorded",
   "p_payload_raw":{"tenant_id":"<BRAVO tenant id>","tenant":"staging-bravo",
                    "tenant_slug":"staging-bravo","source":"break-test"},
   "p_normalized":{"full_name":"C3 Probe","phone_e164":"+971500000099"}}'
```
**Expected safe:** the event is created **under Alpha**, because the tenant comes
from `nexus_lead_endpoint_for_public_key(p_public_key)`. The `tenant_id` in
`p_payload_raw` is inert stored JSON.
**Verify, do not assume:** `select tenant_id from lead_event where external_event_id='break-C3-001'`
must equal Alpha.
**Failure:** Bravo, or NULL, or the row is filed in quarantine.
**C3b:** repeat with `p_public_key` omitted → expect
`NX001 / LEAD_ENDPOINT_UNRESOLVED`. **C3c:** repeat with a *revoked* key → same.
**Status: NOT RUN.**

### C4 — WhatsApp inbound: choose the dealership by naming the session
```sql
select * from public.nexus_resolve_channel_tenant('whatsapp_waha_session','staging-bravo');
select * from public.nexus_resolve_channel_tenant('whatsapp_waha_session','default');
```
**Expected:** the first resolves to Bravo; the second returns **zero rows** —
unregistered is empty, never a fallback.
**This test is designed to FAIL in the direction that matters, and the failure is the
finding.** Whoever controls the session string chooses which dealership is written,
and the only thing authenticating that string lives on the n8n box
(`WAHA_WEBHOOK_SECRET`, recorded unset). **Run the HTTP half too:** POST a WAHA-shaped
payload naming `staging-bravo` at the deployed webhook *without* the secret header and
record whether an execution starts. If it does, the database's correctness is
irrelevant.
**Status: NOT RUN. The n8n half must not be run against production.**

### C5 — `service_role` names another dealership and nothing objects
```sql
set local role service_role;
insert into public.leads (name, email, phone, source, status, tenant_id)
values ('W3 probe','w3@x.invalid','+971500000098','walk_in','new','<bravo>');
```
**Expected: this SUCCEEDS.** That is the measured, known state (probe W3, 6 Sep:
*"succeeded with no check whatsoever"*). Record it as **the boundary that does not
exist**, not as a defect discovered. The test's purpose is to keep the claim honest:
n8n can write any dealership's data, and only class-C constraints stand in its way.
**Status: NOT RUN.**

### C6 — the omitted tenant lands in quarantine, not on a dealership
```sql
set local role service_role;
insert into public.audit_log (workflow, status, summary) values ('BREAK-C6','SUCCESS','probe');
select tenant_id from public.audit_log where workflow='BREAK-C6';
```
**Expected safe:** the quarantine tenant, via
`default nexus_default_tenant_id()`. **Failure:** an active dealership's id — that
would mean an unattributable write was silently filed as a real customer's.
**C6b — the 26 tables with no default:**
```sql
insert into public.channel_registry (channel_type, external_identifier, status) values ('x','y','active');
```
Expect `23502 not-null violation`. **Failure:** a row.
**Status: NOT RUN.**

---

## D · Views that forget their tenant predicate

### D1 — sweep all 42 views, both directions
For each view carrying `tenant_id` (32 of 42):
```sql
select '<view>' v, count(*) from <view> where tenant_id = '<the other dealership>';
```
**Expected safe:** 0, in all cases, both directions, with a per-view same-tenant
control that is non-zero for at least the views the fixture populates.
**Failure:** any non-zero. Record `42501` cells as **refusals, not passes** — six
views (`v_channel_provider_capability`, `v_channel_send_health`,
`v_whatsapp_conversation_window`, `v_lead_timeline_admissible`, …) are closed to end
users by grant and prove nothing about tenancy.
**Status: NOT RUN.**

### D2 — the ten views with no `tenant_id` column
They cannot be probed by predicate. Probe by **partition**:
```sql
-- as Alpha, as Bravo, and as service_role
select count(*) from public.v_team_performance;
select count(*) from public.v_needs_attention;
select count(*) from public.v_workflow_health;
select count(*) from public.v_competitor_latest;
select count(*) from public.v_fin_gate_quote_evidence;
select count(*) from public.v_deal_rescue_readiness;
select count(*) from public.v_deal_rescue_state_model;
select count(*) from public.v_lead_recovery_state_model;
```
**Expected safe:** `alpha + bravo = service_role` exactly, for each view — disjoint
and exhaustive. **Failure:** `alpha + bravo > service_role` (double-counting, i.e.
each sees some of the other's) or `alpha = service_role` (no filtering at all).
**D2b — the H6 test.** Add Alpha's owner to Bravo as a member, then re-read
`v_team_performance` as that user. **Expected:** rows from both, **with no column
saying which dealership each row belongs to.** That is the finding, and it is a
product defect rather than a breach — record it as such.
**Status: NOT RUN.**

### D3 — `security_definer` view bypassing RLS
The direct search returned **nothing to attack**: all 42 views carry
`security_invoker` truthy and the guard accepts every truthy spelling
(`ISOLATION-MODEL.md` §4). So test the **guard**, not the views:
```sql
-- (staging) must be REFUSED
create view public.v_break_d3 as select * from public.leads;
-- expect: 42501 'NEXUS SECURITY GATE: view(s) public.v_break_d3 ... lack security_invoker'

-- must also be refused after a CREATE OR REPLACE that drops reloptions
create view public.v_break_d3b with (security_invoker = on) as select * from public.leads;
create or replace view public.v_break_d3b as select * from public.leads;   -- reloptions reset
-- expect: refused

-- the documented bypass — prove it still works, so nobody is surprised by it later
set local nexus.allow_insecure_view = on;
create view public.v_break_d3c as select * from public.leads;   -- expect: CREATED
```
**Expected safe:** first two refused, third created (and immediately dropped). The
third is not a defect; it is a deliberate escape hatch, and a test that documents it
is better than one that pretends it is not there.
**D3b — the gap the guard does not cover:**
```sql
create materialized view public.mv_break_d3 as select * from public.leads;
```
Materialized views have no `security_invoker` and **RLS never applies to them**. The
guard filters on `object_type = 'view'`. **Expected:** it is created and, if a
`SELECT` grant reaches `authenticated`, it exposes every dealership's leads. There
are 0 matviews today; this test proves whether that is luck or a control.
**Status: NOT RUN.**

---

## E · `SECURITY DEFINER` functions — the class-D boundary

45 functions, owned by `BYPASSRLS` `postgres`, executable by every signed-in
dealership user. RLS is off inside all of them.

### E1 — hand another dealership's object id to every function that takes one
As **Alpha's owner**, against **Bravo's** rows:
```sql
select public.action_propose('<bravo_unit_id>');
select public.action_decide('<bravo_action_id>','APPROVE',null,'probe',null,null);
select public.action_cancel('<bravo_action_id>','probe');
select public.action_mark_executed('<bravo_action_id>','probe',false,null);
select public.action_outcome_candidates('<bravo_action_id>');
select public.action_record_outcome('<bravo_action_id>','<bravo_purchase_id>','probe');
select public.action_mark_not_attributable('<bravo_action_id>','probe');
select public.lead_recovery_propose(<bravo_lead_id>);
select public.lead_recovery_decide('<bravo_action_id>','APPROVE',null,'probe',null,null);
select public.lead_recovery_cancel('<bravo_action_id>','probe');
select public.lead_recovery_mark_executed('<bravo_action_id>','probe',false,null);
select public.lead_recovery_outcome_candidates('<bravo_action_id>');
select public.lead_recovery_record_outcome('<bravo_action_id>','<bravo_purchase_id>','probe');
select public.lead_recovery_mark_not_attributable('<bravo_action_id>','probe');
select public.inventory_set_cost('<bravo_unit_id>', 1, 'probe');
select public.inventory_delete_unit('<bravo_unit_id>');
select public.nexus_lead_trace(<bravo_lead_id>);
select public.nexus_kyc_object_readable('<bravo_kyc_storage_path>');
select public.nexus_team_set_role('<bravo_owner_uid>','member');
select public.nexus_team_revoke_access('<bravo_owner_uid>');
select public.nexus_team_link_staff('<bravo_owner_uid>','<bravo_staff_id>');
select public.nexus_team_invite('someone@bravo.invalid','owner','<bravo_staff_id>');
select public.nexus_team_cancel_invite('<a pending bravo invite email>');
select public.policy_verify_rule('<bravo_house_rule_id>', 'probe', null, null, null, 'HIGH', null);
select public.policy_supersede_rule('<bravo_house_rule_id>', current_date, 'probe', 1, null, null, null, null);
select public.policy_withdraw_rule('<bravo_house_rule_id>','probe');
```
**Expected safe:** a **named refusal** for each — `NX001` with a reason, or "not
found", or an empty result. `nexus_kyc_object_readable` must return `false`.
**Failure, in descending severity:**
1. it **succeeds** — Alpha just decided Bravo's action, changed Bravo's cost, revoked
   Bravo's owner, or withdrew Bravo's policy rule;
2. it returns Bravo's **data** in the refusal message (`nexus_lead_trace`,
   `action_outcome_candidates`, `nexus_team_roster` are the likely ones) — an
   information leak dressed as an error;
3. it errors with a bare `NULL`/division/`no_data_found`, which means the function
   reached the row and fell over rather than refusing it.
**Control, per call:** the same call against Alpha's own object must succeed.
**26 calls × 2 directions = 52 probes. This is the largest untested surface on the
platform and it is the one RLS does not cover.**
**Status: NOT RUN.**

### E2 — mixed-tenant arguments (the FK vector, driven through the front door)
```sql
-- as ALPHA's owner: Alpha's own action, Bravo's sale
select public.action_record_outcome('<alpha_action_id>','<bravo_purchase_id>','probe');
select public.lead_recovery_record_outcome('<alpha_action_id>','<bravo_purchase_id>','probe');
-- as ALPHA's owner: assign Alpha's lead to Bravo's salesperson
update public.leads set assigned_to_id = '<bravo_staff_user_id>' where id = <alpha_lead_id>;
```
**Expected safe:** refusal on all three. **Failure:** the first two write
**Bravo's revenue into Alpha's recovered-value figure** — the money claim the whole
product rests on. The third is the open `leads_assigned_to_id_fkey` hole
(`BLOCKERS.md` §2.12, `ISOLATION-MODEL.md` §8): the FK is to `users(id)` with no
tenant, `assigned_to_id` **is** in the 8-column UPDATE grant, and the RLS WITH CHECK
constrains `tenant_id` and `assigned_to_id ∈ nexus_my_staff_user_ids()` only for
sales/member roles — an **owner or manager** is not so constrained. **Predicted
result: the owner's UPDATE succeeds.** Run it and find out.
**Status: NOT RUN.**

### E3 — `nexus_workflow_catalogue()` from the second dealership (H1)
```sql
-- as BRAVO's owner, on a database where ALPHA's 18 workflows are registered
select count(*) from public.nexus_workflow_catalogue();
```
**Expected safe:** 0, or only Bravo's own.
**Predicted actual: all 18** — the guard is `exists (select 1 from nexus_current_tenant_ids())`,
a membership test with no tenant filter. **This test is expected to fail. Run it so
the failure is on the record with a number attached.**
**Status: NOT RUN.**

### E4 — the singular resolver picks, and the plural one refuses (H5)
Make one auth user a member of **both** dealerships, then:
```sql
select public.nexus_current_tenant_ids();   -- expect BOTH
select public.nexus_current_tenant_id();    -- expect ONE — the earliest by created_at
select public.nexus_lead_record_manual('walk_in', gen_random_uuid(), 'H5 probe',
       '+971500000097', null, null, null, null, null);
-- expect NX001 / DEALERSHIP_AMBIGUOUS
select public.recompute_inventory_derived();  -- WRITE. which dealership did it touch?
```
**Expected safe:** `nexus_lead_record_manual` refuses.
**The finding is the contrast:** one write path refuses ambiguity and another
(`recompute_inventory_derived`, granted to `authenticated`) resolves it silently.
Measure which tenant's `inventory` rows changed. **Failure:** it recomputed the wrong
dealership's margins, or both.
**Status: NOT RUN.**

### E5 — H9, the born-open function
```sql
-- staging, as a migration
create function public.f_break_e5() returns bigint language sql
  security definer as $$ select count(*) from public.leads $$;
select has_function_privilege('authenticated','public.f_break_e5()','EXECUTE');  -- expect ?
select has_function_privilege('anon','public.f_break_e5()','EXECUTE');           -- expect false
set local role authenticated; select public.f_break_e5();
```
**Expected safe:** `authenticated` cannot execute it.
**Predicted actual: `true`, and the call returns EVERY dealership's lead count** —
`nexus_guard_born_open_grants` runs `revoke all on function … from anon` and says
nothing about `authenticated`, while PostgreSQL's default grants `EXECUTE` to
`PUBLIC`. **This is the mechanism by which H1 recurs.** Drop the function afterwards.
**Status: NOT RUN.**

---

## F · Constraints — the only class that survives `service_role`

Run all of these **as `service_role`**. That is the point: they are the only controls
that still exist on the n8n path.

### F1 — cross-tenant foreign key references (35 edges, H10)
```sql
set local role service_role;
-- revenue attribution: Bravo's sale hung off Alpha's lead
insert into public.purchase_history (customer_name,email,phone,vehicle,purchase_date,amount_aed,lead_id,tenant_id)
values ('F1 probe','f1@x.invalid','+971500000096','probe', current_date, 999999, <alpha_lead_id>, '<bravo>');
-- staff: Alpha's lead assigned to Bravo's salesperson
update public.leads set assigned_to_id = '<bravo_staff_id>' where id = <alpha_lead_id>;
-- policy: Alpha's rule supersedes Bravo's
insert into public.policy_rule (jurisdiction, rule_type, rule_name, tenant_id, supersedes_id, version, status)
values ('TENANT_HOUSE','<type>','F1_PROBE','<alpha>','<bravo_rule_id>',1,'PROPOSED');
-- membership pointing at a foreign staff row
insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
values ('<alpha>','<a fresh uid>','member','<bravo_staff_id>');
-- messaging: a message billed against another dealership's template
insert into public.whatsapp_message_usage (tenant_id, integration_id, template_id, ...)
values ('<alpha>','<alpha_integration>','<bravo_template_id>', ...);
```
**Expected safe:** `23503` on each.
**Predicted actual: all five SUCCEED** — the FKs are single-column to `leads(id)`,
`users(id)`, `policy_rule(id)`, `whatsapp_templates(template_id)`, and neither
`leads_pkey` nor `users_pkey` nor `purchase_history_pkey` is tenant-composite.
**These are the tests most likely to produce a real finding. Run all 35 edges, not
these five.** Enumerate them with the query in `ISOLATION-MODEL.md` §8 and script one
insert per edge.
**Detector cross-check:** afterwards read
`select actions_whose_lead_is_another_tenants from v_lead_recovery_coverage` — it is
supposed to notice. Does it?
**Status: NOT RUN.**

### F2 — the composite FKs that DO exist (positive control for F1)
```sql
set local role service_role;
insert into public.channel_message_events (tenant_id, integration_id, ...)
values ('<alpha>','<BRAVO integration_id>', ...);
```
**Expected safe:** `23503` on `cme_carrier_belongs_to_the_tenant`.
Repeat for `channel_send_directive`, `whatsapp_conversation_state`,
`whatsapp_customer_message_seen`, `whatsapp_delivery_events`,
`whatsapp_message_usage`, `whatsapp_opt_in_event`, `whatsapp_templates`,
`inventory_actions → inventory`, `lead_event → lead_ingest_endpoint` — **10 edges**.
**This is the control that proves F1's successes are a gap and not a broken
harness.** If F2 also succeeds, the harness is wrong, not the database.
**Status: NOT RUN.**

### F3 — the quarantine flag
```sql
set local role service_role;
update public.tenants set is_unattributed_default = true where id = '<alpha>';  -- expect 23514
update public.tenants set is_quarantine = false where is_unattributed_default;  -- expect 23514
```
**Expected safe:** `23514` on `tenants_unattributed_default_must_be_quarantine` and
`tenants_quarantine_is_…`. These are CHECKs, so they hold against `service_role`.
**Failure:** either succeeds — a dealership becomes the destination for every
unattributable write on the platform.
**Status: NOT RUN.**

### F4 — idempotency keys are scoped per dealership
```sql
set local role service_role;
-- same message id under both dealerships: must be accepted twice
insert into public.processed_messages (tenant_id, message_id) values ('<alpha>','F4-SAME');
insert into public.processed_messages (tenant_id, message_id) values ('<bravo>','F4-SAME');
-- CONTROL: the same claim twice within one dealership must be refused
insert into public.processed_messages (tenant_id, message_id) values ('<alpha>','F4-SAME');  -- expect 23505
```
**Expected safe:** accept, accept, `23505`.
**Failure:** the second insert is refused — one dealership would swallow the other's
message as a duplicate, and the customer never gets an answer. Repeat for
`leads(tenant_id,email)`, `whatsapp_contacts(tenant_id,chat_id)`,
`users(tenant_id,email)`.
**Status: NOT RUN.**

### F5 — the globally-unique identifiers (H2)
```sql
set local role service_role;
-- Bravo tries to register the WhatsApp number Alpha already holds
insert into public.channel_registry (tenant_id, channel_type, external_identifier, status)
values ('<bravo>','whatsapp_cloud_phone_number_id','<alpha external identifier>','active');
```
**Expected:** `23505` on `channel_registry_type_identifier_key`. That is **correct
behaviour** — one phone number cannot belong to two dealerships — and the onboarding
runbook must expect it as a normal outcome, not an error to force past.
**Failure:** it succeeds, and `nexus_resolve_channel_tenant` then has two candidate
rows for one identifier with a `limit 1` deciding whose customer this is.
**Status: NOT RUN.**

---

## G · Backend and out-of-band paths

### G1 — the deployed n8n workflows, exported and diffed
Not a SQL test. `n8n-workflows/_index.json` records `exported_at 2026-08-30`, four
days before `channel_registry` existed, and `grep -l tenant_id n8n-workflows/*.json`
matches **zero** of 21 files. Export the **live** workflows, diff against the
repository, then grep the fresh export for `nexus_resolve_channel_tenant`,
`NEXUS_TENANT_MAP`, and `tenant_id`.
**Expected safe:** every Supabase write node either names a tenant or calls a
resolver. **Failure:** a node that POSTs to `/rest/v1/<table>` with no tenant — those
rows land in quarantine on the 16 defaulted tables and fail with `23502` on the other
26, and at two dealerships they are somebody's data filed under nobody.
**Known instance to look for first:** the `Audit Log` node in
`ask_ai_rag_query_agent.json` posts `{workflow, status, summary}` with no tenant. And
the **silence detector has two write paths that disagree** — four `[SILENCE-…]` rows
landed on ALBA, one landed in quarantine five minutes earlier on 8 Sep
(`ISOLATION-MODEL.md` H12). Find that second path.
**Status: NOT RUN. Do not run against production n8n.**

### G2 — inbound webhook authentication
```
curl -X POST https://<n8n host>/webhook/<whatsapp path> \
  -H 'Content-Type: application/json' \
  -d '{"session":"staging-bravo","payload":{"from":"971500000095@c.us","body":"probe"}}'
```
with **no** secret header.
**Expected safe:** refused before an execution starts (HTTP 401/403, and **zero** new
rows in `channel_message_events`).
**Failure:** an execution starts. The database cannot help here —
`nexus_resolve_channel_tenant` is a pure function of the string it is handed, and it
will faithfully resolve `staging-bravo` for whoever says it.
**Status: NOT RUN. Staging n8n only.**

### G3 — the marketing site's service key
`apps/marketing-site/api/lead.js` holds `SUPABASE_SERVICE_KEY` in a Vercel
environment variable and calls one RPC with it. Confirm by inspection and by
`select proname from pg_proc where …` that this key can only reach
`nexus_record_lead_event`; it cannot — a `service_role` key reaches **everything**.
**The test is therefore a blast-radius statement, not a pass:** if that function or
that deployment is compromised, every dealership's data is readable. Record it.
**Mitigation to test instead:** does a scoped anon-key + RLS path exist for this
write? Today, no.
**Status: NOT RUN.**

---

## H · Storage

### H1 — read another dealership's KYC document
```
curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $ALPHA_USER_JWT" \
  "https://<project>.supabase.co/storage/v1/object/kyc-documents/<BRAVO object path>"
```
**Expected safe:** 400/403/404 — `kyc_objects_staff_read` calls
`nexus_kyc_object_readable(name)`, whose predicate is
`k.tenant_id in (select nexus_current_tenant_ids())`.
**Control:** the same request for Alpha's own object must return 200.
**Failure:** 200 on Bravo's — identity documents crossing dealerships.
**H1b:** an object with **no** `kyc_documents` row (unattributed): the function falls
through to `exists(... is_unattributed_default and status='active' ...)`, and the
quarantine tenant is `status='quarantine'`, so this should be `false` for everyone.
Verify — an orphaned object readable by all would be worse than a cross-tenant one.
**Status: NOT RUN.**

### H2 — write into the other dealership's storage prefix
```
curl -X POST -H "Authorization: Bearer $ALPHA_USER_JWT" \
  --data-binary @probe.pdf \
  "https://<project>.supabase.co/storage/v1/object/kyc-documents/<bravo prefix>/probe.pdf"
```
**Expected safe:** refused — there is **no INSERT policy for `authenticated`** on
`storage.objects` (measured: 2 policies total, one deny-anon and one SELECT).
**Failure:** 200. Also worth knowing: if uploads are happening today, they are
happening as `service_role`, and that path has no tenant check at all.
**Status: NOT RUN.**

---

## X · Tests this design cannot perform, and why

**X1 — a real signed JWT through PostgREST.** Everything above uses Postgres roles
with `request.jwt.claims` set as a GUC. That is how PostgREST *presents* a verified
JWT; it is not the verification. A forged-signature test, a `role` claim smuggled
past the verifier, an expired-token test and an `aud`-mismatch test are all **out of
scope for SQL** and must be run over HTTP against staging with a real key. Same
limitation `two-tenant-proof` §8.4 records as `B3`, still open.
**Status: NOT RUN, and not runnable as written.**

**X2 — the dashboard with two dealerships.** No frontend is exercised anywhere in
this file. D2b predicts what a dual-member sees; a browser must confirm it.

**X3 — anything on production.** Every write test here is staging-only. The
production statements in `ISOLATION-MODEL.md` are catalogue reads, and this file adds
no production behaviour to them.

---

## Summary

| group | tests | expected to pass | **expected to FIND something** |
|---|---|---|---|
| A anon | 3 | 3 | — |
| B cross-tenant CRUD | 5 | 5 | — |
| C spoofing | 6 | 5 | C4 (webhook auth lives off-database), C5 (documents an absent boundary) |
| D views | 4 | 3 | D2b (H6), D3b (matview gap) |
| E `SECURITY DEFINER` | 5 | ? — **52 probes, none ever run** | **E2 (assign to a foreign salesperson), E3 (H1), E4 (H5), E5 (H9)** |
| F constraints | 5 | F2–F5 | **F1 — 35 cross-tenant FK edges** |
| G backend | 3 | — | **G1 (the silence detector's second write path), G2** |
| H storage | 2 | 2 | H1b |

**Total: 33 named tests, 0 run.** Six are predicted to fail on the evidence already
in `ISOLATION-MODEL.md`. Predicted is not measured: run them and record the result,
including for the ones predicted to pass.
