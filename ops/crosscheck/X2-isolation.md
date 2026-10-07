# X2 — cross-check of `ops/pilot-isolation/ISOLATION-MODEL.md`, by query

**Run 12 September 2026** against production `dsvuoovivysszdoiorch` through the
read-only SQL channel. **No row written, no DDL, no migration, no staging write, no
n8n call.** Two statements ran inside `begin read only; … commit;` with `set local
role authenticated` to observe a dealership session's own view; both rolled the role
back in the same transaction and neither wrote.

Scope: **H1, H5, H9, H10, H12 examined.** H2, H3, H4, H6, H7, H8, H11 **NOT REACHED**
— no verdict is offered on them here, and their absence is not agreement.

---

## H1 — CONFIRMED, and upgraded from "read the body" to **demonstrated**

The sibling read the body. I ran it.

```sql
select pg_get_functiondef(oid) from pg_proc … where proname='nexus_workflow_catalogue';
```
```sql
  select r.name, r.audit_name, r.audit_aliases, r.category, r.description,
         r.is_active, r.writes_audit_log
    from public.workflow_registry r
   where coalesce(pg_catalog.current_setting('role', true), 'none')
           not in ('authenticated', 'anon')
      or exists (select 1 from public.nexus_current_tenant_ids());
-- prosecdef = true · owner = postgres (BYPASSRLS) · authenticated EXECUTE = true · anon = false
```

Two executions, same session, same function:

```sql
begin read only; set local role authenticated;
select count(*) from public.nexus_workflow_catalogue();          -- 0   (no JWT, no membership)
commit;

begin read only;
select set_config('request.jwt.claims',
   (select json_build_object('sub', m.auth_user_id)::text
      from public.tenant_members m order by m.created_at limit 1), true);
set local role authenticated;
select count(*) from public.nexus_workflow_catalogue();          -- 18  (memberships = 1)
commit;
```

**0 rows without a membership, all 18 with one.** The gate is binary on *membership*,
and it cannot be anything else:

```sql
select (select count(*) from workflow_registry),
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='workflow_registry' and column_name='tenant_id');
-- 18 · 0
```

`workflow_registry` **has no `tenant_id` column at all**, so no predicate over it can
be tenant-scoped. The function is not a filter that was written wrongly; it is a
filter that cannot be written. Table-level RLS does refuse dealerships directly —

```sql
select policyname, roles, qual from pg_policies where tablename='workflow_registry';
-- workflow_registry_deny_anon   {anon}          false
-- workflow_registry_service_role_all {service_role} true
```

— which is exactly why the `SECURITY DEFINER` function is the whole hole: it is the
one path that reaches the table, and it checks the wrong thing. The role-GUC branch
does **not** fail open for `authenticated` (proved by the 0 above); the vendor's
comment claiming it "fails CLOSED for a dealership session" is true of that branch
and irrelevant to the defect, which is in the `or`.

**Verdict: CONFIRMED, and it is the only hole of the five for which a second
dealership adds nothing to the proof.** Dealership 2's first authenticated call reads
Tenant A's automation register. NOT RUN as a second dealership only because none exists.

---

## H10 — CONFIRMED on the arithmetic, CORRECTED on the grouping and **understated**

Recounted independently from `pg_constraint` (both endpoints in `public`, `contype='f'`):

```sql
-- classify every FK: does the child carry tenant_id? the parent? does the FK
-- itself include tenant_id on both sides (a composite tenant FK)? is there a
-- composite twin on the same child→parent pair?
```
| measure | count |
|---|---|
| FKs in `public` | **112** |
| both endpoints carry `tenant_id` | **55** |
| composite tenant FKs (`tenant_id` on both sides of the FK) | **10** |
| both carry tenant, FK not composite | 45 |
| …of those, a composite twin exists on the same pair | 10 |
| **net unprotected edges** | **35** ✅ matches the sibling exactly |
| FKs where **one endpoint has no `tenant_id` at all** | **57** |

**The 35, by parent (my count, not theirs):**

| parent | edges | children |
|---|---|---|
| `users` | **16** (sibling said 15) | `leads.assigned_to_id`, `kyc_documents.reviewed_by`, `tenant_members.staff_user_id`, `tenant_member_invite.staff_user_id`, 5× `inventory_actions`, 5× `lead_recovery_actions` (sibling said 3), `inventory_action_events.actor_staff_id`, `lead_recovery_action_events.actor_staff_id` |
| `leads` | **4** ✅ | `lead_event`, `lead_owner_events`, `lead_recovery_actions`, `purchase_history` |
| `policy_rule` | **4** (sibling's prose said 3, their own list had 4) | `policy_rule.supersedes_id`, `policy_rule_event.rule_id`, `channel_send_directive.policy_applied_rule_id`, `whatsapp_message_usage.policy_rule_id` |
| `channel_message_events` | 2 | `whatsapp_delivery_events.event_id`, `whatsapp_message_usage.event_id` |
| `purchase_history` | **2** ✅ | `inventory_actions.outcome_purchase_id`, `lead_recovery_actions.outcome_purchase_id` |
| `whatsapp_delivery_events` | 2 | `whatsapp_message_usage.{provider_pricing,latest_status}_delivery_event_id` |
| `audit_log`, `communication_logs`, `inventory_actions`, `lead_recovery_actions`, `whatsapp_templates` | 1 each | evidence and event edges |

**The four `→ leads(id)` and two `→ purchase_history(id)` edges are confirmed
verbatim.** That is the revenue-attribution path and it is unconstrained.

**Where the sibling is wrong: the 10 composite FKs do not "cover only the messaging
layer", and more importantly they are not a defence of the 35.**

```sql
-- the 10 composite tenant FKs
channel_message_events → channel_registry   channel_send_directive → channel_registry
whatsapp_conversation_state → channel_registry   whatsapp_customer_message_seen → channel_registry
whatsapp_delivery_events → channel_registry      whatsapp_message_usage → channel_registry
whatsapp_opt_in_event → channel_registry         whatsapp_templates → channel_registry
inventory_actions → inventory                    lead_event → lead_ingest_endpoint
```

**8 of 10 are one pattern — "the carrier belongs to the tenant", child → `channel_registry`.**
The other two (`inventory_actions → inventory`, `lead_event → lead_ingest_endpoint`)
are not messaging. So: corrected, but in the direction that makes it worse. The
composite-FK technique is applied to **two parents that matter** (`channel_registry`,
`inventory`) and to **zero** of `users`, `leads`, `purchase_history`, `policy_rule` —
the four parents that carry, respectively, staff identity, the lead, the sale, and
the rule. The technique exists, is understood, is deployed, and was not extended to
the tables where a cross-tenant pointer would be a revenue or a compliance event.

**The understatement: 57 further FK edges cannot be composite-protected even in
principle**, because one endpoint has no `tenant_id` column. Those are outside the
sibling's 35 and outside any constraint story. `workflow_registry`, `policy_platform_attestation`
and friends live there.

**Reachability, unchanged and correctly stated by the sibling:** RLS refuses most of
these to a dealership user, so the exposed callers are `service_role` (n8n) and the
45 class-D functions — and `rolbypassrls` is `true` for `service_role` and `postgres`,
`false` for `anon` and `authenticated` (`pg_roles`). Constraints are the only class
that binds the two roles that bypass RLS, and for these 35 edges there is no constraint.

**Verdict: CONFIRMED (35 and 10 both exact), grouping CORRECTED, scope UNDERSTATED.**

---

## H9 — conclusion CONFIRMED, **mechanism CORRECTED**, and the real hole is larger

The sibling's conclusion — *every new function is born callable by every dealership
user* — is right. The stated reason — *"PostgreSQL's default is `GRANT EXECUTE … TO
PUBLIC`"* — is **not what is happening on this database.**

Guard body, verbatim, the function branch:

```sql
elsif r.object_type in ('function','procedure','aggregate') then
  execute format('revoke all on function %s from anon', r.object_identity);
end if;
```
Nothing for `authenticated`. ✅ as reported.

But `pg_default_acl` shows the default privileges were **explicitly rewritten**:

```sql
select defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl from pg_default_acl;
-- postgres | public | f | {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- postgres | public | r | {postgres=arwdDxtm/postgres, authenticated=r/postgres, service_role=arwdDxtm/postgres}
-- postgres | public | S | {postgres=rwU/postgres, service_role=rwU/postgres}
-- supabase_admin | public | f | {postgres=X, anon=X, authenticated=X, service_role=X}
```

Three consequences the sibling missed, all of them sharpening the finding:

1. **`authenticated` is granted EXECUTE by an explicit `ALTER DEFAULT PRIVILEGES`, not
   by the PUBLIC default.** A future fix that only revokes from `PUBLIC` will not
   close this. The default ACL itself has to change.
2. **The guard's `revoke … from anon` for functions is a no-op for every function the
   project creates.** `postgres`'s default ACL does not grant `anon` in the first
   place, and `anon` has no `USAGE` on `public` at all
   (`has_schema_privilege('anon','public','USAGE') = false`). The guard's function
   branch defends against `supabase_admin`-owned creations (whose default ACL *does*
   grant `anon=X`) — i.e. platform upgrades — and against nothing the team writes.
   It is pointed at the wrong role.
3. **The same is true of tables, and worse.** `postgres | public | r` grants
   `authenticated=r` on every new table. The guard revokes
   `insert, update, delete, truncate` from `authenticated` — **not `SELECT`** — and
   does not enable RLS. So a table created by an ordinary migration is born
   **SELECT-able by every signed-in dealership user with no RLS**, and the guard
   leaves it that way. Today 67/67 base tables have RLS enabled and 46 carry a
   `SELECT` grant to `authenticated`, so discipline has held so far; nothing enforces it.

Add the orchestrator's X1 finding — every branch wrapped in `exception when others
then null`, so a REVOKE that fails is silent — and the guard's honest description is:
*a best-effort tidy-up against the platform, not a control.*

**Verdict: CONFIRMED in effect, CORRECTED in mechanism, and extended: born-open
applies to `SELECT` on new tables, not only EXECUTE on new functions.**

Precision note on §5 while here: there are **86** `SECURITY DEFINER` functions in
`public`, not 45. 45 is the count `authenticated` may EXECUTE; `anon` may execute
**0**; all 86 are owned by `postgres`. The sibling's 45 is the right number for the
sentence they wrote and the wrong number for "the class-D surface".

---

## H5 — CONFIRMED, with one count corrected

Both resolvers read, verbatim:

```sql
-- nexus_current_tenant_id()  (singular)   STABLE SECURITY DEFINER, owner postgres
  select coalesce(
    (select c.tid from (select public.nexus_jwt_tenant_id() as tid) c
       join public.tenant_members m on m.tenant_id = c.tid and m.auth_user_id = auth.uid()
       join public.tenants t on t.id = c.tid and t.status = 'active'),
    (select m.tenant_id from public.tenant_members m
       join public.tenants t on t.id = m.tenant_id and t.status='active'
      where auth.uid() is not null and m.auth_user_id = auth.uid()
      order by m.created_at, m.tenant_id
      limit 1));          -- ← the silent pick

-- nexus_current_tenant_ids() (plural)
  select m.tenant_id from public.tenant_members m
    join public.tenants t on t.id=m.tenant_id and t.status='active'
   where auth.uid() is not null and m.auth_user_id = auth.uid();   -- no limit, no order
```

The singular form has a **JWT-claim fast path first** — which the sibling did not
mention and which matters: a session carrying a valid `tenant_id` claim resolves
correctly, and the `order by created_at limit 1` fallback fires **only when the claim
is absent or does not match an active membership**. That narrows the blast radius; it
does not close it, because nothing requires the claim to be present.

Consumers of the singular resolver, from `pg_proc.prosrc`:

```sql
select proname, provolatile, prosecdef, has_function_privilege('authenticated',oid,'EXECUTE')
  from pg_proc … where prosrc like '%nexus_current_tenant_id()%';
-- action_approver_context          s  true  true
-- lead_recovery_outcome_candidates s  true  true
-- nexus_default_tenant_id          s  true  true
-- nexus_scoped_tenant_id           s  true  true
-- recompute_inventory_derived      v  true  true   ← VOLATILE = the write
```

**Five functions, not six.** The sibling counted `recompute_inventory_derived` twice
(two call sites in one body, not two overloads). All five are `SECURITY DEFINER`,
owned by `postgres`, `EXECUTE` to `authenticated`. `recompute_inventory_derived` is
the only `VOLATILE` one — confirming the sibling's central point: **the silent pick is
on a write path any dealership user can call.**

And the disagreement is real:

```sql
-- nexus_lead_record_manual: prosrc like '%DEALERSHIP_AMBIGUOUS%' = true,
--                           uses plural = true, uses singular = false
-- recompute_inventory_derived / nexus_scoped_tenant_id: singular, no ambiguity refusal
```

One function refuses the exact condition the other five resolve by date order.

**Verdict: CONFIRMED. Corrected: five consumers, not six; and the JWT claim is tried
before the pick.** Whether the dashboard sets that claim is **NOT MEASURED** — that is
the question that decides whether H5 is latent or live, and it is a frontend question,
not a database one.

---

## H12 — CONFIRMED and **ESCALATED: it recurred today, and the sibling's framing was too narrow**

The sibling described one lost row on 8 Sep, "five minutes apart". Re-measured today:

```sql
select t.slug, count(*), min(cl.created_at), max(cl.created_at)
  from communication_logs cl join tenants t on t.id=cl.tenant_id
 where cl.message like '[SILENCE%' group by 1,2;
-- alba-cars        7 · 2026-08-26 19:03:18 → 2026-09-12 04:05:10
-- __unattributed__ 2 · 2026-09-08 02:59:50 → 2026-09-12 07:00:08
```

Not 4 and 1. **7 and 2 — and the newest quarantine row is 2026-09-12 07:00:08, today.**
It is also the **only** `communication_logs` row written to quarantine in the last 72
hours (1 quarantine vs 55 Tenant A). This is not a 8-Sep incident; it is a recurring
defect that has now fired twice, four days apart.

The discriminator the sibling did not find:

```sql
select t.slug, cl.created_at, cl.direction, cl.sent_by, cl.evidence_state, left(cl.message,90)
  from communication_logs cl join tenants t on t.id=cl.tenant_id
 where cl.message like '[SILENCE%' order by cl.created_at desc;
-- __unattributed__ 2026-09-12 07:00:08  outbound  +9715235056648@whatsapp.lead  "Silent for 12h since 2026-09-11T18:10:12"
-- alba-cars        2026-09-12 04:05:10  internal  +971556382721@whatsapp.lead   "Silent for 12h since 2026-09-11T16:00:07"
-- alba-cars        2026-09-09 21:01:34  internal
-- alba-cars        2026-09-09 06:03:18  internal
-- alba-cars        2026-09-08 03:04:36  internal
-- __unattributed__ 2026-09-08 02:59:50  outbound  +971556382721@whatsapp.lead
```

**`direction` separates the two writers perfectly: 2/2 quarantine rows are
`outbound`; 4/4 Tenant A rows since 8 Sep are `internal`.** The path that writes
`direction='outbound'` is the path that fails to resolve a tenant. (The two oldest
Tenant A rows, 26 and 31 Aug, are also `outbound` — so the outbound writer *used* to
attribute correctly and stopped. Something changed between 31 Aug and 8 Sep; finding
what is a code question I did not reach.) `sent_by` is NULL on all nine, so it
identifies nothing.

**The misfiling is now provable, not inferred.** The 12 Sep quarantine marker names
lead `+9715235056648@whatsapp.lead`:

```sql
select count(*) from leads l join tenants t on t.id=l.tenant_id
 where l.phone like '%5235056648%' and t.slug='alba-cars';      -- 1
select count(*) from leads l join tenants t on t.id=l.tenant_id where t.is_quarantine; -- 0
```

**That lead is Tenant A's. The quarantine tenant owns zero leads.** So the row is not an
unattributable orphan the quarantine bucket caught doing its job — it is a marker
about a known Tenant A customer, filed where Tenant A cannot see it, with
`evidence_state='ADMISSIBLE'` on a row no dealership can read. At one tenant that is
a silent undercount in `v_lead_recovery.silence_markers_on_file`. At two it is
dealership A's evidence in a bucket neither dealership can open.

Also confirmed, in the sibling's favour: **quarantine `audit_log` is still frozen** at
20 rows, `2026-09-06 14:19:00 → 15:02:53`, nothing since — so H11's correction of
`BLOCKERS.md` §2.5 holds six days on. The live writer is in `communication_logs`
only.

**Verdict: CONFIRMED, ESCALATED. Live today. The sibling called it a Pilot-B blocker;
on this evidence it is a Pilot-A blocker — it is losing a real Tenant A customer's
escalation evidence right now, with one tenant, no second dealership required.**

---

## The structural question: is five mechanisms an architecture or an accident?

**It is an accident with one deliberate part inside it.**

The deliberate part is real and should be said first. Someone thought hard about the
`anon` caller and closed it completely; someone invented the composite tenant FK and
named the constraints in English (`cme_carrier_belongs_to_the_tenant`); someone wrote
`DEALERSHIP_AMBIGUOUS` rather than picking. Those are architecture. What is missing is
the step that turns three good decisions into a system: **nobody ever wrote down which
mechanism is responsible for which caller, so each new object picks a mechanism by
habit.** That is the accident, and every one of H1, H5, H9, H10 and H12 is an instance
of it.

**Every caller that reaches this database, and what covers it today:**

| caller | how it connects | covered by | measured |
|---|---|---|---|
| **Browser, anon key** (public site, lead forms) | PostgREST as `anon` | **GRANT — and it is airtight.** `has_schema_privilege('anon','public','USAGE') = false`; 0 tables with `SELECT` to `anon`; 0 permissive `anon` policies; 0 of 86 `SECURITY DEFINER` functions executable. `anon` reaches **nothing** in `public`. | ✅ closed |
| **Browser, authenticated JWT** (dealership staff on the dashboard) | PostgREST as `authenticated`, `rolbypassrls=false` | **RLS + GRANT** on the 46 tables it can `SELECT`; **class D** the moment it calls one of the **45** `SECURITY DEFINER` functions — where RLS is off and the boundary is whatever the author typed. **H1 and H5 both live entirely here.** | ⚠️ split |
| **n8n, service_role** | PostgREST/direct as `service_role`, **`rolbypassrls=true`** | **Constraints only.** RLS does not apply; GRANTs are full. The 10 composite FKs bind it; the 35 unprotected edges do not; only 2 of 67 tables are `FORCE`d. **H10 and H12 live here.** | ❌ mostly uncovered |
| **The dashboard's own RPCs** | same connection as the authenticated browser, but the code path is the 45 class-D functions | **Hand-written predicates.** No automated check that a predicate exists — the only assurance on record is "every body mentions `tenant`", which `nexus_workflow_catalogue` satisfies while leaking. | ❌ unverifiable by construction |
| **Supabase platform roles** (`postgres`, `supabase_admin`, dashboard SQL editor, migrations, this session) | superuser-adjacent, `postgres` has `rolbypassrls=true` | **Nothing, by design** — plus `nexus_guard_born_open_grants`, which is not a boundary but a janitor, and a silent one (`exception when others then null`). | n/a |

Read down that column and the shape is plain: **the two callers that can bypass RLS —
`service_role` and the class-D functions — carry almost all the dealership's data
traffic, and they are the two covered by the weakest mechanisms.** RLS, the mechanism
with 192 policies and the most work in it, protects the one caller (`authenticated`
direct table access) that is already narrowed by GRANT. The effort and the risk are
pointed in different directions.

**The minimum coherent set.** Three mechanisms, each owning a caller outright:

1. **GRANT owns `anon`.** Already true, already complete. Keep the guard aimed here —
   its `anon` branch does defend against platform upgrades re-granting. Change
   nothing.
2. **Constraints own `service_role`.** This is the only class that binds a
   `BYPASSRLS` role, so it must carry n8n alone. Concretely: extend the composite
   tenant FK from the 10 edges it covers to the edges where a cross-tenant pointer is
   a business event — `→ leads(id)` (4), `→ purchase_history(id)` (2), `→ users(id)`
   (16), `→ policy_rule(id)` (4). That needs `tenant_id` added to four parent unique
   keys; it is a schema change, not a policy change, and it is the single highest-value
   piece of work on this list. `v_lead_recovery_coverage.actions_whose_lead_is_another_tenants`
   already proves the team knows the shape — it counts after the fact what a
   constraint should refuse before.
3. **RLS owns `authenticated`, and class D must stop existing as a category.** Every
   `SECURITY DEFINER` function is a hand-cut hole in mechanism 3. The coherent rule is:
   a function is `SECURITY DEFINER` only when it demonstrably must be, it is listed,
   and each listed one has a two-tenant test. 45 unreviewed ones is not a boundary.

And one mechanism to delete: **"nothing" is not a mechanism.** The 25 tables with no
`tenant_id` are the residue of never having asked, per table, *whose row is this?*
`workflow_registry` (the vendor's), `policy_unmigrated_constant` (the vendor's) and
`policy_platform_attestation` (a dealership's, filed where it cannot be named) give
three different answers, and only the first two are right by accident.

The concrete change that makes the set coherent is not code. It is a rule: **every new
table declares its owner-caller, and the migration that creates it applies that
caller's mechanism in the same migration.** Everything above is what happens when
that rule is absent for eighteen months and the people are good.

---

## What this pass did NOT measure

- **H2, H3, H4, H6, H7, H8, H11** — not examined. H11's `audit_log` half was
  re-confirmed only incidentally (§H12).
- **Any two-tenant behaviour.** Production still has one dealership and one quarantine
  bucket. H1 is the only hole of the five whose proof does not need a second tenant,
  and I supplied it. H5, H10 and the cross-tenant half of H12 remain **structural
  findings awaiting `BREAK-TESTS.md`, every test in which is still NOT RUN.**
- **Whether the dashboard sets a `tenant_id` JWT claim** — decides if H5 is live or
  latent. Frontend question, not asked here.
- **What changed between 31 Aug and 8 Sep** to make the silence detector's outbound
  path stop attributing. Code archaeology, not a query.
- **`lead_event_guard_lead_tenant_trg`** — still read, still not executed, same as the
  sibling. Its correctness remains NOT MEASURED.
