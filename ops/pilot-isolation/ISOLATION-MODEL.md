# How tenancy is actually enforced today — measured, not described

**Measured 9 September 2026** against production `dsvuoovivysszdoiorch` through the
read-only SQL channel. **No row was written, no migration applied, no n8n workflow
called, no staging write.** Every claim below carries the query that produced it.

**The reading caveat.** The SQL channel connects as a privileged role, not as a
signed-in dealership session, and production has exactly one dealership. So this
file measures **what the enforcement mechanisms ARE**, from the catalogue. It does
not measure **what a second dealership would see** — that is `BREAK-TESTS.md`, and
every test in it is `NOT RUN`. Structure is not behaviour. A policy that exists is
not a policy that was exercised.

Prior work this file extends rather than repeats: `ops/pilot-readiness/BLOCKERS.md`
(8 Sep) and `two-tenant-proof-2026-09-06.md` (6 Sep, staging). Two of their
statements are **corrected** here — §9.6 and §9.7.

---

## 0 · Where the tenants are

```sql
select id, slug, name, status, is_unattributed_default, is_quarantine, created_at
  from public.tenants order by created_at;
```

| id | slug | status | quarantine | created |
|---|---|---|---|---|
| `fff6a2b5-cfd5-4460-8383-875bc5826de0` | `alba-cars` | active | no | 2026-09-02 |
| `02c86264-6653-4522-b055-1c3f359a82fe` | `__unattributed__` | quarantine | **yes**, `is_unattributed_default` | 2026-09-05 |

**Two rows. The demo tenant `dddddddd-dddd-4ddd-8ddd-dddddddddddd` referenced by
`ops/demo/seed_demo_tenant.sql` does NOT exist on production** — as that file's own
two-part guard intends. Production has **one dealership and one quarantine bucket**,
and every count in this file is therefore a one-tenant count.

Live volumes, same pass:

```sql
select (select count(*) from leads), (select count(*) from communication_logs),
       (select count(*) from audit_log), (select count(*) from inventory),
       (select count(*) from users), (select count(*) from tenant_members),
       (select count(*) from whatsapp_opt_in_event), (select count(*) from channel_registry),
       (select count(*) from lead_ingest_endpoint), (select count(*) from rag_documents),
       (select count(*) from kyc_documents);
-- leads 5 · communication_logs 142 · audit_log 898 · inventory 12 · users 1
-- tenant_members 1 · whatsapp_opt_in_event 0 · channel_registry 2
-- lead_ingest_endpoint 5 · rag_documents 15 · kyc_documents 3
```

`users 1` and `tenant_members 1` matter for onboarding: **there is exactly one staff
row and one membership on the whole platform today.** Nothing about staff isolation
has ever been exercised on this project with real rows.

---

## 1 · There are five enforcement classes, not one

This is the whole point of the document. "Tenant isolation" on this system is five
different mechanisms with five different threat models, and they do not cover the
same callers.

| # | mechanism | what it constrains | holds against `service_role` / `postgres`? | holds against a signed-in dealership user? |
|---|---|---|---|---|
| **A** | **RLS policy** | rows visible/writable to `authenticated` and `anon` over PostgREST | **No** — both have `rolbypassrls = true` | **Yes** |
| **B** | **GRANT** (table- and column-level) | which verbs exist at all for a role | No | Yes — refuses with `42501` *before* RLS is consulted |
| **C** | **Constraint** — composite FK, CHECK, UNIQUE, NOT NULL | what any writer may state | **Yes** — the only class that does | Yes |
| **D** | **Hand-written `where tenant_id = …` inside a `SECURITY DEFINER` function** | rows a *function* touches | n/a — this IS the backend path | Yes, **only where the author wrote the predicate**. RLS is off inside these. |
| **E** | **Nothing** | — | — | — |

Measured, the thing that makes class D dangerous:

```sql
select rolname, rolsuper, rolbypassrls from pg_roles
 where rolname in ('postgres','authenticated','anon','service_role');
-- anon           false false
-- authenticated  false false
-- postgres       false TRUE
-- service_role   false TRUE
```

**`postgres` has `BYPASSRLS`, and every `SECURITY DEFINER` function in `public` is
owned by `postgres`.** Inside those 45 functions (§5), RLS is not evaluated. The
tenant boundary there is whatever predicate the author typed, and nothing in the
database checks that they typed one.

Nine tables would still constrain the owner if they were `FORCE`d. Only two are:

```sql
select relname, relrowsecurity, relforcerowsecurity from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relforcerowsecurity;
-- channel_message_events · whatsapp_customer_message_seen
```

**2 of 67 base tables have `FORCE ROW LEVEL SECURITY`.** For the other 65, a
`SECURITY DEFINER` function owned by `postgres` sees every dealership.

---

## 2 · Table census — who carries a tenant, who does not

```sql
select c.relname, c.relrowsecurity, exists(select 1 from information_schema.columns col
  where col.table_schema='public' and col.table_name=c.relname and col.column_name='tenant_id') as has_tenant_id
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r';
```

**67 base tables. RLS is enabled on all 67 — zero exceptions.**
**42 carry `tenant_id`. 25 do not.**

### 2.1 The 42 that carry `tenant_id`

`tenant_id` is `NOT NULL` on 40 of them. The two nullable ones are deliberate and
documented (`nexus_tenancy_readiness()` reports them as by-design WARNs):

```sql
select table_name, is_nullable, column_default from information_schema.columns
 where table_schema='public' and column_name='tenant_id' and is_nullable='YES';
-- policy_rule       YES  (no default)
-- policy_rule_event YES  (no default)
```

NULL there means *"a rule that binds every dealership"* — and the read policy is
`(tenant_id is null or tenant_id in (select nexus_current_tenant_ids()))`, so a
platform rule is readable by everyone by design. **The hazard is not the NULL; it is
that a house rule written with a NULL `tenant_id` becomes globally readable with no
constraint refusing it.** See H4.

### 2.2 The 25 without `tenant_id` — and which of them hold tenant data

This is the dangerous list the brief asked for. I classified all 25 by reading their
columns, their FKs and their row counts.

**Platform reference vocabularies — 21 tables, no tenant data, correctly global.**
`attribution_edge_type`, `attribution_event_type`, `attribution_link_basis`,
`channel_provider_capability`, `channel_provider_rank`, `channel_send_form`,
`deal_rescue_evidence_sources`, `deal_rescue_prerequisites`, `deal_rescue_states`,
`inventory_action_reason_codes`, `lead_provenance_kind`, `lead_recovery_reason_codes`,
`lead_recovery_states`, `lead_source_catalogue`, `policy_jurisdiction`,
`policy_rule_type`, `policy_unit`, `tenant_capability_catalogue`,
`tenant_configuration_default`, `whatsapp_message_intent`, `tenants` itself.
`tenants` is the registry and is correctly keyed by `id`, with
`tenants_member_read` scoping `authenticated` to `id in (select nexus_current_tenant_ids())`.

**Four that hold, or will hold, tenant data with no tenant column:**

| table | rows today | why it is tenant data | who can read it |
|---|---|---|---|
| **`workflow_registry`** | **18** | the vendor's register of which automations exist. No `tenant_id`, so it cannot ever say "this workflow runs for dealership X". | `authenticated` has **no permissive policy** (only `workflow_registry_deny_anon` + `service_role_all`), so the *table* returns zero rows to a dealership. But `nexus_workflow_catalogue()` — `SECURITY DEFINER`, `EXECUTE` granted to `authenticated` — returns **all 18 rows to any member of any active dealership** (§5.2). **H1.** |
| **`lead_ingest_provider_identity`** | **0** | maps a provider identity (a Meta page id, a Google form id) to an endpoint. The tenant is reachable only through `endpoint_id → lead_ingest_endpoint.tenant_id`. | `deny_end_users` (`anon,authenticated` → `false`) + `service_role_all`. Refused to dealerships. Unique index is **global**: `(provider, identity_kind, identity_value)` — so two dealerships cannot claim the same ad account, which is the right answer, and the loser gets a `23505` with no explanation. **H2.** |
| **`policy_platform_attestation`** | **0** | attestations about a `policy_rule`; a `TENANT_HOUSE` rule's attestation would be a dealership's own evidence filed in a table that cannot name it. | `deny_anon` + `service_role_all`; no `authenticated` policy → zero rows to dealerships. Empty today, so the hazard is latent, not live. **H3.** |
| **`policy_unmigrated_constant`** | (vendor survey) | code locations, snippets and current values from NEXUS's own source. Not a *dealership's* data — it is the **vendor's**. | `SELECT true` to `authenticated`: **every dealership user on the platform can read the vendor's internal constants survey**, including `location` and `snippet`. Not a cross-tenant leak; a vendor-disclosure one. **H8.** |

---

## 3 · RLS as it stands — 192 policies, six shapes

```sql
select qual, with_check, cmd, array_to_string(roles,',') roles, count(*)
  from pg_policies where schemaname='public' group by 1,2,3,4 order by 5 desc;
```

| shape | n | what it does |
|---|---|---|
| `ALL / service_role / true / true` | **66** | every table's backend door. **This is not a control** — it is the absence of one, restated as a policy. |
| `ALL / anon / false / false` | **55** | anon denied at the row layer |
| `SELECT / authenticated / tenant_id in (select nexus_current_tenant_ids())` | **26** | **the tenant read lock** |
| `SELECT / authenticated / true` | **14** | reference vocabularies, deliberately global |
| `ALL / anon,authenticated / false / false` | **13** | messaging + ingest tables: no end-user access at all |
| `ALL / authenticated / tenant_id in (…) / same` | **4** | `leads`, `inventory`, `competitors`, `inventory_profit_settings` |
| role-gated writes | 4 | `inventory_role_insert/update/delete` and `leads_role_update`, keyed on `nexus_tenant_ids_for_roles(...)` and, for sales/member, `nexus_my_staff_user_ids()` |
| `tenants_member_read`, `tenant_members_self_read` | 2 | `id in (…)`, `auth_user_id = auth.uid()` |
| `processed_messages_no_authenticated` | 1 | idempotency table closed to end users |

The resolvers the 26+4 policies stand on, read verbatim:

```sql
-- nexus_current_tenant_ids()  — the plural, used by every RLS policy
select m.tenant_id from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
 where auth.uid() is not null and m.auth_user_id = auth.uid();
```

**Membership is the authority; the JWT is never a source of tenancy.** The singular
form does consult a JWT claim, but only as a *filter* over membership:

```sql
-- nexus_current_tenant_id()
select coalesce(
  (select c.tid from (select public.nexus_jwt_tenant_id() as tid) c
     join public.tenant_members m on m.tenant_id = c.tid and m.auth_user_id = auth.uid()
     join public.tenants t on t.id = c.tid and t.status='active'),
  (select m.tenant_id from public.tenant_members m
     join public.tenants t on t.id=m.tenant_id and t.status='active'
    where auth.uid() is not null and m.auth_user_id=auth.uid()
    order by m.created_at, m.tenant_id limit 1));
```

A forged `tenant_id` claim naming a dealership you are not a member of falls through
to the second branch and yields your own. **That is correct** and it was probed
adversarially on staging on 6 Sep (probe S16, `two-tenant-proof` §6). It is **NOT RUN
on production.**

**But the fallback `limit 1` is a live hazard the moment one human belongs to two
dealerships** — which is exactly what the vendor's own account becomes on pilot day 1.
See H5.

### Storage

```sql
select tablename, policyname, cmd, roles, qual from pg_policies where schemaname='storage';
-- objects · kyc_objects_no_anon     · ALL    · {anon}          · false
-- objects · kyc_objects_staff_read  · SELECT · {authenticated} · bucket_id='kyc-documents' AND nexus_kyc_object_readable(name)

select id, public from storage.buckets;
-- kyc-documents · public = false
```

One bucket, not public, one scoped read policy. `nexus_kyc_object_readable()` is
`SECURITY DEFINER` and its predicate is `k.tenant_id in (select nexus_current_tenant_ids())`
— correctly scoped, read in full. There is **no INSERT/UPDATE/DELETE policy for
`authenticated` on `storage.objects`**, so those are denied by RLS default. Uploads
must therefore be happening as `service_role` from n8n; that path is unmeasured here.

---

## 4 · Views — 42, and the guard the brief asked about

```sql
select c.relname,
       (select option_value from pg_options_to_table(c.reloptions) where option_name='security_invoker') as si,
       pg_get_userbyid(c.relowner)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('v','m');
```

**42 views. 0 materialized views. All 42 owned by `postgres`. All 42 carry
`security_invoker` set truthy** — 41 spelled `true`, one (`v_competitor_latest`)
spelled `on`.

**The brief's hypothesis — a view created before the trigger existed escaping the
guard — is FALSE here, and I checked the guard rather than assuming.**
`nexus_require_security_invoker_views()` reads:

```
v_val := lower(btrim(coalesce(split_part(v_opt,'=',2),'')));
IF v_val NOT IN ('on','true','yes','1') ... RAISE
```

It accepts every truthy boolean spelling, so `v_competitor_latest`'s `on` is not an
escape. **No `security_definer` view exists in `public`. Zero found.**

Two limits of that guard, stated because "no view escapes it today" is not "no view
can":
1. It has an explicit bypass — `set nexus.allow_insecure_view = on` makes it return
   without checking. Anyone who can run a migration can use it.
2. It fires on `object_type = 'view'` in `schema_name = 'public'` only. A view in
   another schema exposed to PostgREST, or a materialized view (which has no
   `security_invoker` and to which **RLS never applies at all**), is outside it.
   There are 0 matviews today. That is a fact about today, not a control.

### 4.1 Ten views have no `tenant_id` column; eight of them read tenant data

```sql
-- views with no tenant_id, cross-referenced against every table carrying one
```

| view | tenant-scoped sources it reads |
|---|---|
| `v_team_performance` | `leads`, `users` |
| `v_needs_attention` | `audit_log`, `competitors`, `inventory`, `inventory_profit_settings`, `kyc_documents`, `leads`, `v_conversations` |
| `v_workflow_health` | `audit_log` |
| `v_competitor_latest` | `competitors` |
| `v_fin_gate_quote_evidence` | `finance_quotes` |
| `v_deal_rescue_readiness` | `finance_quotes`, `leads`, `purchase_history`, `v_lead_recovery` |
| `v_deal_rescue_state_model` | `v_deal_rescue` |
| `v_lead_recovery_state_model` | `v_lead_recovery` |
| `v_policy_unmigrated_constant` | `policy_rule`, `v_policy_authoritative` (vendor data — §2.2) |
| `v_channel_provider_capability` | none — genuinely global, and `42501` to end users anyway |

**These are not leaks.** All ten are `security_invoker`, so RLS on the base tables
still filters them per caller. What they cannot do is **attribute**: a caller who is
a member of two dealerships sees both dealerships' rows added together with no column
that says which is which. `v_team_performance` blends two sales teams into one
league table; `v_needs_attention` blends two alert queues. Measured on staging 6 Sep:
Alpha 7 + Bravo 2 = `service_role` 9 for `v_team_performance`. **H6.**

---

## 5 · The `SECURITY DEFINER` surface — the class-D boundary

```sql
select p.proname, p.prosecdef, pg_get_userbyid(p.proowner),
       has_function_privilege('authenticated',p.oid,'EXECUTE'),
       has_function_privilege('anon',p.oid,'EXECUTE')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef;
```

**45 `SECURITY DEFINER` functions in `public` are `EXECUTE`-able by `authenticated`.
All 45 are owned by `postgres` (`BYPASSRLS`). `anon` can execute none of them.**
All 45 pin `search_path` to `public` or `public, pg_catalog`.

Every one of the 45 mentions `tenant` or `auth.uid` somewhere in its body:

```sql
-- functions with NO tenant and NO auth.uid reference anywhere in the body
select ... where not (body ilike '%tenant%' or body ilike '%auth.uid%');
-- 0 rows
```

**That is the *only* automated assurance that exists.** "Mentions `tenant_id`" is not
"scopes every statement by `tenant_id`". `action_decide` alone is 10,582 characters
with 23 `tenant_id` references; nothing in the database asserts that the 24th
statement needed one. **The correctness of class D is unverified by construction and
can only be established by execution** — that is `BREAK-TESTS.md` §B.

### 5.1 Two resolver dialects, and they disagree

| function | resolver used | behaviour when the caller belongs to 2 dealerships |
|---|---|---|
| the 30 RLS policies | `nexus_current_tenant_ids()` (plural) | returns **both** — union, correct for reads |
| `nexus_lead_record_manual` | plural, then **refuses** | `NX001 / DEALERSHIP_AMBIGUOUS` — *"Refused rather than resolved. A resolver that picks one is how one dealership's traffic ends up written into another's data."* |
| `action_approver_context`, `lead_recovery_outcome_candidates`, `recompute_inventory_derived` (×2), `nexus_default_tenant_id`, `nexus_scoped_tenant_id` | `nexus_current_tenant_id()` (singular) | **silently picks the earliest membership by `created_at`** |

**Same database, same day, two opposite answers to the same question.** One refuses;
five pick. `recompute_inventory_derived()` is a **write** function granted to
`authenticated`. **H5.**

### 5.2 `nexus_workflow_catalogue()` — the measured hole

```sql
select r.name, r.audit_name, r.audit_aliases, r.category, r.description,
       r.is_active, r.writes_audit_log
  from public.workflow_registry r
 where coalesce(pg_catalog.current_setting('role',true),'none') not in ('authenticated','anon')
    or exists (select 1 from public.nexus_current_tenant_ids());
```

`exists (select 1 from …)` is a **membership test, not a filter**. Any member of any
active dealership gets **all 18 rows**. Today that is Tenant A's own view of the vendor's
register and harmless. On the day dealership 2 is activated, dealership 2's owner
reads Tenant A's automation register — every workflow name, category, description and
active flag. Gate `L2` in `two-tenant-proof` F6 is correctly red and **this is why**.
**H1.**

### 5.3 `search_rag_documents` — the knowledge base goes silent at two tenants

Two overloads exist. The deployed n8n Ask-AI workflow
(`n8n-workflows/ask_ai_rag_query_agent.json`, node *Supabase Knowledge Search*) posts
`{ q, match_limit }` — the **2-argument** form:

```sql
-- search_rag_documents(q text, match_limit integer)
select * from public.search_rag_documents(q, match_limit, public.nexus_scoped_tenant_id());
```

and `nexus_scoped_tenant_id()` returns NULL whenever
`(select count(*) from tenants where status='active' and not is_quarantine) <> 1`.
The 3-arg body then opens with:

```sql
if v_tenant is null and (select count(*) from public.tenants where status='active') > 1 then
  return;   -- cannot tell whose knowledge base this is: answer nothing
end if;
```

**The day a second dealership is activated, Ask AI returns nothing to everyone,
including Tenant A.** That is a refusal, not a leak — the safe direction — but it is a
feature outage on activation day and it is not in `BLOCKERS.md`. **H7.**

The same body carries the honest comment about its own class: *"SECURITY INVOKER on
purpose… service_role is BYPASSRLS, so for n8n this argument IS the whole boundary."*

---

## 6 · The `service_role` path — what actually protects a dealership from n8n

n8n holds `service_role`, which is `BYPASSRLS`. Classes A, B and D do not apply to
it. What does:

```sql
select count(*) filter (where column_default='nexus_default_tenant_id()'),
       count(*) filter (where column_default is null)
  from information_schema.columns
 where table_schema='public' and column_name='tenant_id' and <table is a base table>;
-- 16 with the quarantine default · 26 with no default
```

- **16 tenant tables** (`leads`, `communication_logs`, `audit_log`, `inventory`,
  `purchase_history`, `rag_documents`, `kyc_documents`, `daily_metrics`,
  `customer_360_profiles`, `whatsapp_contacts`, `competitors`, `finance_quotes`,
  `deals_embeddings`, …) default `tenant_id` to `nexus_default_tenant_id()`. For a
  `service_role` caller with no `auth.uid()` that resolves to the **quarantine
  tenant**. **A backend write that forgets the tenant is filed under nobody, not
  under the wrong dealership.** This is the single strongest property the platform
  has against the n8n path, and it is a class-C control (a column default plus
  `NOT NULL`), so `BYPASSRLS` does not touch it.
- **26 tenant tables have no default and `NOT NULL`.** A write that omits the tenant
  fails loudly with `23502`. Also correct.
- **10 composite FKs bind a child row's tenant to its parent's**, all in the
  messaging layer plus `inventory_actions → inventory` and
  `lead_event → lead_ingest_endpoint`:
  `FOREIGN KEY (integration_id, tenant_id) REFERENCES channel_registry(integration_id, tenant_id)`.
  Filing a message under dealership A through dealership B's carrier is a `23503`,
  against every role including `service_role`.

### 6.1 The quarantine tenant is doing its job, and it names its writers

```sql
select tenant_id, workflow, status, count(*), min(logged_at), max(logged_at)
  from audit_log where tenant_id='02c86264-6653-4522-b055-1c3f359a82fe' group by 1,2,3;
```

**20 rows, 9 distinct workflows, all written 2026-09-06 between 14:19 and 15:02:**
`Ask-AI RAG Query` (3), `wf_108 ERP Sync - Bitrix24 CRM` (3), and 2 each of
`Slack Command Center - AI Agent`, `NEXUS Master Lead Router - AI Agent`,
`7-Day Warm Lead Drip Campaign`, `Lead Escalation - AI Agent`, `Finance Calc`,
`Sync Closed-Won to pgvector`, `KYC/AML Document Auditor + Re-upload Loop (Phase 5)`.

The mechanism is visible in the workflow file: the Ask-AI *Audit Log* node POSTs to
`/rest/v1/audit_log` with a body of `{workflow, status, summary}` and **no
`tenant_id`**, so the column default files it in quarantine.

---

## 7 · What is enforced in the dashboard's JavaScript: **nothing**

Measured, not assumed. `apps/executive-dashboard/` was searched for any client-side
tenant predicate in a PostgREST query string:

```
grep -rn "tenant_id" apps/executive-dashboard/lib/*.js apps/executive-dashboard/app.js | grep "select=\|&tenant\|?tenant\|eq\."
```

Two hits, both **reading the caller's own memberships**, neither a filter on data:

- `lib/tenant.js:48` — `tenant_members?select=tenant_id,role,created_at&order=created_at.asc,tenant_id.asc`
- `app.js:212` — `tenant_members?select=tenant_id,role,staff_user_id`

**Zero `.eq('tenant_id', …)` anywhere in the dashboard.** `lib/tenant.js` says so in
its own header and is right to:

> *"It is not a permission check and nothing here decides what anybody may read.
> Every request this app makes is scoped by RLS at the database, per request, against
> the caller's own JWT — that is the security boundary and it is the only one.
> Deleting this file would not leak a row."*

**So for the browser, isolation is 100% class A (RLS) and 0% application-level.**
That is the good answer: there is no second, weaker copy of the rule to drift.

The file also documents the H5 hazard from the frontend side, correctly:

> *"Memberships beyond the first are real and this build cannot switch between them:
> `nexus_current_tenant_id()` picks one and every read on every screen is that one."*

The one server-side writer in the repo, `apps/marketing-site/api/lead.js`, holds
`SUPABASE_SERVICE_KEY` and calls `nexus_record_lead_event` with a `p_public_key`.
**The tenant is derived from the endpoint the key resolves to; it is never taken from
the request body.** `nexus_record_lead_event` refuses an unresolved key with
`NX001 / LEAD_ENDPOINT_UNRESOLVED` and says why: *"There is no fallback tenant on
purpose: a resolver that guesses is how one dealership's traffic writes another's
data."* That is the correct shape and the strongest ingest control on the platform.

---

## 8 · Foreign keys — 35 edges let one dealership's row point at another's

```sql
-- FKs where BOTH child and parent carry tenant_id, the FK does NOT include it,
-- and no composite tenant-carrying FK covers the same child→parent pair
-- => unprotected_edges 35 · covered_by_composite_twin 10
```

The 35, grouped:

| pattern | edges | what a cross-tenant value would mean |
|---|---|---|
| `… → users(id)` (`users_pkey` is `id` alone) | **15** — `leads.assigned_to_id`, `kyc_documents.reviewed_by`, `tenant_members.staff_user_id`, `tenant_member_invite.staff_user_id`, 5× on `inventory_actions`, 3× on `lead_recovery_actions`, `inventory_action_events.actor_staff_id`, `lead_recovery_action_events.actor_staff_id` | **a lead assigned to another dealership's salesperson**; an action decided by a foreign approver; a membership pointing at a foreign staff row |
| `… → leads(id)` (`leads_pkey` is `id` alone) | **4** — `purchase_history.lead_id`, `lead_event.lead_id`, `lead_owner_events.lead_id`, `lead_recovery_actions.lead_id` | **dealership B's sale attributed to dealership A's lead** — this is the revenue-attribution path |
| `… → purchase_history(id)` | **2** — `inventory_actions.outcome_purchase_id`, `lead_recovery_actions.outcome_purchase_id` | one dealership's recovery action credited with another's sale |
| `… → policy_rule(id)` | **3** — `policy_rule.supersedes_id`, `policy_rule_event.rule_id`, `channel_send_directive.policy_applied_rule_id`, `whatsapp_message_usage.policy_rule_id` | a house rule superseding another dealership's; a send citing a foreign rule |
| messaging internals | **5** — `whatsapp_delivery_events.event_id`, `whatsapp_message_usage.{event_id, template_id, latest_status_delivery_event_id, provider_pricing_delivery_event_id}` | a message billed against another dealership's template |
| other | `communication_log_evidence_event.comm_log_id`, `inventory_action_events.{action_id, audit_log_id}`, `lead_recovery_action_events.action_id` | evidence attached to a foreign conversation |

`lead_event.lead_id` is the one exception with a compensating control:
trigger `lead_event_guard_lead_tenant_trg` fires on `lead_event` and its body
references `tenant`. Its correctness is **NOT MEASURED** (I read that it mentions
tenant; I did not execute it).

**The system already knows about this class.** `v_lead_recovery_coverage` carries a
column literally named `actions_whose_lead_is_another_tenants`. A detector exists; a
constraint does not.

Note this is not reachable by a dealership user through RLS for most of these — RLS
would refuse the UPDATE that set the foreign id. **It is fully reachable by
`service_role`, i.e. by n8n, and by any bug in the 45 class-D functions.** That is
exactly the population the constraints are supposed to catch, and here they do not.

---

## 9 · Holes found

Ranked by what they do on the first day dealership 2 exists.

**H1 — `nexus_workflow_catalogue()` returns the whole vendor register to any member
of any dealership.** `SECURITY DEFINER`, owned by `BYPASSRLS` `postgres`, guarded by
an `exists(...)` membership test rather than a tenant filter. 18 rows today. **Cross-
tenant read, confirmed by reading the body; NOT RUN as a second dealership.**

**H2 — `lead_ingest_provider_identity` and `channel_registry` are globally unique on
the provider identity** (`(provider, identity_kind, identity_value)` and
`(channel_type, external_identifier)`). Correct as a control — two dealerships cannot
claim one WhatsApp number — but the second registrant gets a bare `23505` and the
onboarding runbook must expect it. Not a leak. **Design note, not a defect.**

**H3 — `policy_platform_attestation` has no `tenant_id`** and FKs to `policy_rule`,
whose `tenant_id` is nullable. An attestation on a dealership's house rule cannot be
scoped. **0 rows today — latent.**

**H4 — a `TENANT_HOUSE` rule written with `tenant_id = NULL` becomes globally
readable and nothing refuses it.** `policy_rule.tenant_id` is nullable with no CHECK
tying nullability to `jurisdiction`. Measured: all 13 `policy_rule` rows have
`tenant_id IS NULL` today, and all 13 are platform/regulator rules, so the hazard is
latent. **The constraint that would make it impossible does not exist.**

**H5 — one human in two dealerships gets a silent pick, not a refusal, on six code
paths.** `nexus_current_tenant_id()` resolves ties with `order by created_at limit 1`.
`nexus_lead_record_manual` refuses the same situation outright with
`DEALERSHIP_AMBIGUOUS`. Consumers of the singular form include
`recompute_inventory_derived()` — a **write** granted to `authenticated`. **The
vendor's own account will be a member of both dealerships during the pilot. This will
fire.**

**H6 — eight views expose tenant-derived data with no `tenant_id` column.** Not a
leak (all `security_invoker`), but a dual-member sees two dealerships' figures summed
with no way to attribute them. `v_team_performance` and `v_needs_attention` are on
the pilot's own screens.

**H7 — Ask AI goes silent for everyone the moment a second dealership is activated.**
`nexus_scoped_tenant_id()` returns NULL at ≥2 active dealerships, and both
`search_rag_documents` overloads then return zero rows. Correct refusal, undocumented
outage. Same root cause as `two-tenant-proof` F2.

**H8 — every dealership user can read `policy_unmigrated_constant`** (`SELECT true`
to `authenticated`): the vendor's own `layer`, `location`, `snippet` and
`current_value` survey of NEXUS source code. Vendor disclosure, not cross-tenant.

**H9 — the ACL guard revokes new functions from `anon` but not from
`authenticated`.** `nexus_guard_born_open_grants` runs
`revoke all on function %s from anon` and nothing else for functions. PostgreSQL's
default is `GRANT EXECUTE … TO PUBLIC`, so **every function created from here on is
callable by every signed-in dealership user by default**, and if it is
`SECURITY DEFINER` (owned by `postgres`, `BYPASSRLS`) it is a class-D boundary that
nobody reviewed. This is the mechanism by which H1 would recur.

**H10 — 35 foreign keys permit a cross-tenant reference** (§8), including the four
`→ leads(id)` and two `→ purchase_history(id)` edges that carry revenue attribution.
No constraint refuses it; one view counts it after the fact.

### Corrections to prior work

**H11 — `BLOCKERS.md` §2.5 says "an unidentified live writer is still producing"
quarantine rows. Both halves are wrong.** The `audit_log` writers are identified:
nine named n8n workflows, all 20 rows written in a 43-minute window on 6 September,
and **nothing has been written to quarantine `audit_log` since**
(`max(logged_at) = 2026-09-06 15:02:53`, three days ago; 122 audit rows in the last
three days all carry Tenant A). That was a smoke-test run, not a leak.

**H12 — but the `communication_logs` quarantine row is a different and worse story,
and it is live.** The single row is:

```sql
select id, lead_email, channel, direction, created_at, left(message,60)
  from communication_logs where tenant_id='02c86264-6653-4522-b055-1c3f359a82fe';
-- +971556382721@whatsapp.lead · system · outbound · 2026-09-08 02:59:50
-- '[SILENCE-ESCALATED] Silent for 12h since 2026-09-07T14:08:45'
```

```sql
select tenant_id, count(*), min(created_at), max(created_at)
  from communication_logs where message like '[SILENCE%' group by 1;
-- Tenant A        4 · 2026-08-26 19:03 → 2026-09-08 03:04
-- quarantine  1 · 2026-09-08 02:59
```

**The silence detector has two write paths: one names the tenant and one does not,
and they ran five minutes apart on the same night.** Four markers landed on Tenant A, one
landed under nobody — so it is invisible to the dealership it describes, and
`v_lead_recovery.silence_markers_on_file` undercounts by one for a real customer.
At one dealership this is a lost row. At two, it is the exact shape that files
dealership A's evidence where neither dealership can see it. **This is live as of
yesterday and is a Pilot-B blocker in its own right.**

---

## 10 · What this pass did NOT measure

Stated plainly so nothing here is read as broader than it is.

- **Every cross-tenant probe is NOT RUN.** Production has one dealership; there is
  nothing to read across. `BREAK-TESTS.md` is the design; none of it has been
  executed anywhere by this pass.
- **No class-D function body was executed.** 45 functions, 100k+ characters of
  PL/pgSQL. "Mentions `tenant_id`" is the only automated evidence and it is weak.
- **No PostgREST request was made.** Everything is catalogue-level. A signed JWT
  travelling through PostgREST was not tested — the same limitation
  `two-tenant-proof` §8.4 records as `B3`.
- **The n8n box was not contacted** and no workflow was read except the repository's
  own export of `ask_ai_rag_query_agent.json`. Whether the *deployed* workflows match
  it is **UNKNOWN**, and `BLOCKERS.md` §2.6's open question about `NEXUS_TENANT_MAP`
  vs `nexus_resolve_channel_tenant` is untouched by this pass.
- **Function-body parity between staging and production** was not compared. NOT RUN,
  as on 6 Sep.
- **No frontend was exercised.** H6's blending is derived from view definitions and
  the 6 Sep staging partition counts, not from a rendered screen.
- **`nexus_tenancy_readiness()` was not executed** — it is `service_role`-only and
  this pass would not run an unread function against production.
