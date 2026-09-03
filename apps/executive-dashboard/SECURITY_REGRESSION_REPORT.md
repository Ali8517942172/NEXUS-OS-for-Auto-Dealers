# NEXUS OS — Security Regression Sweep

**Date:** 3 September 2026
**Database:** Supabase `dsvuoovivysszdoiorch` (live)
**Scope:** grants, cross-tenant reads, destructive verbs, the deployed dashboard
bundle, the `SECURITY DEFINER` surface, and roles.
**Method:** every probe run as a **real Postgres role** with **real JWT claims**
(`set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE`), inside
`BEGIN … ROLLBACK`. Rollback semantics were verified first (a table created and
rolled back was confirmed absent afterwards) before any destructive probe ran.
**Nothing in this sweep was left behind.** No live DELETE, no live TRUNCATE.

**Migrations applied by this sweep: none.** No P0 was found, and the
`secreg_` mandate was for P0 fixes only. Every finding below is reported with
the statement that fixes it, not applied.

---

## 0. Verdict first

**Is this system safe to put in front of a second dealership? Not yet — but the
reason has moved.**

The tenant boundary on *reads* is now genuinely closed. Two synthetic
dealerships, real roles, real JWTs, a forged `tenant_id` claim, and a
deliberate identity collision (same customer email **and** same phone in both
dealerships) produced **zero** cross-tenant rows on every view and every base
table tested — including as `service_role`, which bypasses RLS entirely and is
how the three view leaks repaired earlier today survived. That is the strongest
evidence this repo has held on this question, and it is evidence about the
right thing.

What blocks a second dealership is now three specific defects, none of which is
a read leak between signed-in staff:

1. **SEC-01** — 8 of the 11 objects in the private `kyc-documents` bucket are
   claimed by no dealership, and the storage policy's fallback branch hands
   unclaimed objects to whichever tenant holds `is_unattributed_default`. These
   are passports and Emirates IDs. Harmless with one dealership; it is
   customer-identity-document disclosure across dealerships with two.
2. **SEC-02** — `leads.assigned_to_id` has a **global** foreign key. Dealership A
   can assign its own lead to dealership B's staff member. Proven: 1 row
   updated.
3. **SEC-03** — `nexus_scoped_tenant_id()` returns NULL for `service_role` once
   a second tenant is active, and three read surfaces go **silent**, not wrong.
   Measured: `v_inventory_sales` 12 → 0 and `v_customer_directory` 2 → 0 the
   moment a second tenant row exists.

Plus the standing `NEXUS_TENANT_MAP` / `is_unattributed_default` blocker the
readiness gate already reports, which is operational and outside the database.

Fix SEC-01, SEC-02 and SEC-03 and the database side of onboarding is, on this
evidence, defensible. Until then the honest position remains a **single-dealership
controlled pilot**.

---

## 1. Findings

| ID | Grade | Finding | Fires today? |
|---|---|---|---|
| SEC-01 | **P1 RELEASE RISK** (P0 on the day a second dealership is onboarded) | Unclaimed KYC storage objects fall through to the default-flag tenant | No — one tenant |
| SEC-02 | **P1 RELEASE RISK** | `leads.assigned_to_id` FK is global; cross-tenant assignment succeeds | No — one tenant |
| SEC-03 | **P1 RELEASE RISK** | `service_role` reads go silent at two tenants (`v_inventory_sales`, `v_customer_directory`, Customer 360 batch) | No — one tenant |
| SEC-04 | **P2** | `authenticated` holds table-wide UPDATE on `leads`/`inventory` and can rewrite columns the UI never sends, including `response_time_minutes` and the derived margin columns | **Yes** |
| SEC-05 | **P2** | No authority model on the two direct write paths — any signed-in staff member can delete a vehicle or reassign any lead | **Yes** |
| SEC-06 | **P2** | `authenticated` holds `TRUNCATE` on `storage.objects`; the `REVOKE` that appears to fix it **silently does nothing** | Not reachable from the product |
| SEC-07 | **P2** | `policy_*` functions distinguish `WRONG_TENANT` from `NO_SUCH_RULE` — a cross-tenant existence oracle the `action_*` functions deliberately avoid | No — one tenant |
| SEC-08 | **P2** | PUBLIC `=X` grant on `public.inventory_actions_touch` | No — inert |
| SEC-09 | **P2** | Supabase auth leaked-password protection disabled; `vector` and `pg_trgm` installed in `public` | **Yes** |
| REC-01 | **Correction** | The readiness gate's WARN about `policy_rule` nullable `tenant_id` defeating uniqueness is **wrong** | — |
| REC-02 | **Correction** | `TRUNCATE` is not reachable through PostgREST at all — this changes how the whole `D`-grant class should be graded | — |

---

### SEC-01 — Unclaimed KYC documents fall through to the default-flag tenant · P1

**The attack.** Dealership B uploads a customer's passport. The storage object
lands; the matching `kyc_documents` row does not (the row is written separately
by n8n as `service_role`, and this repo has already voided, purged and deleted
such rows — see migrations `void_non_submission_kyc_rows_and_add_contacts`,
`kyc_documents_purged_at`, `kyc_document_archive`). With no row, the object is
claimed by nobody. A signed-in member of staff at whichever dealership holds
`tenants.is_unattributed_default` mints a 60-second signed URL and opens it.

**The evidence.** The live policy on `storage.objects`:

```
kyc_objects_staff_read  SELECT  {authenticated}
  bucket_id = 'kyc-documents'
  AND ( nexus_kyc_object_tenant(name) IN (SELECT nexus_current_tenant_ids())
        OR ( nexus_kyc_object_tenant(name) IS NULL          -- ← the fallback
             AND EXISTS (SELECT 1 FROM tenants t
                          WHERE t.is_unattributed_default
                            AND t.status = 'active'
                            AND t.id IN (SELECT nexus_current_tenant_ids())) ) )
```

`nexus_kyc_object_tenant(name)` resolves the owner by looking the path up in
`kyc_documents`. No row ⇒ NULL ⇒ the fallback branch fires.

Measured on the live bucket:

```
total objects        11
unclaimed (NULL)      8
claimed               3
kyc_documents rows    3   (all 3 point at a real object)
orphan objects        8
```

The 8 unclaimed objects were uploaded 18–24 Aug 2026, under WhatsApp `@lid`
paths (`kyc/61207646060562@lid/2026/08/…jpg`), i.e. before the 24 Aug row
cleanup. They are real customer identity documents that the application no
longer has any record of.

**What stops it today.** Only that there is exactly one dealership, and it holds
the flag, so the fallback grants it its own objects. Nothing else.

**What does not stop it.** RLS is the only lock here and the fallback is *inside*
the policy — this is not a case of a missing predicate, it is a predicate that
deliberately opens.

**The fix.** Fail closed. Unclaimed is not "everyone's", it is "nobody's":

```sql
-- secreg_kyc_unclaimed_object_belongs_to_nobody
drop policy kyc_objects_staff_read on storage.objects;
create policy kyc_objects_staff_read on storage.objects
  for select to authenticated
  using ( bucket_id = 'kyc-documents'
          and public.nexus_kyc_object_tenant(name)
              in (select public.nexus_current_tenant_ids()) );
```

**Blast radius of that fix: none in the UI.** The compliance screen reads
`kyc_documents` rows and signs `storage_path` from them; it never enumerates the
bucket. All 3 rows point at claimed objects, so all 3 links keep working. The 8
objects the fix hides are already invisible to every screen. They should also be
deleted — retaining a customer's passport that the system cannot account for is
a retention problem independently of tenancy.

I did not apply this. It is a P1, not a P0, and it rewrites a live storage
policy; that belongs to whoever owns the onboarding change, alongside the
orphan deletion.

---

### SEC-02 — `leads.assigned_to_id` carries its tenant only transitively · P1

**The attack.** A signed-in user at dealership A issues the dashboard's own lead
PATCH with another dealership's staff uuid:

```
PATCH /rest/v1/leads?id=eq.38
{ "assigned_to_id": "<a users.id belonging to dealership B>",
  "assigned_to":    "B SECRET STAFF NAME" }
```

**The evidence.** Run as tenant A's real owner with real claims, tenant B seeded
in the same rolled-back transaction:

```
XTENANT.assign_lead_to_B_staff   sqlstate 00000   rows 1
```

It succeeded. The RLS `WITH CHECK` on `leads` pins `leads.tenant_id` and nothing
else; the foreign key `leads.assigned_to_id → users(id)` is global, so any uuid
that exists as a staff member **anywhere on the platform** is accepted.

This is precisely the shape `CLAUDE.md` records for the six definer functions —
"carrying their tenant only transitively … writing on an id alone, safe only
because that id happened to be globally unique" — except here it is a table
constraint rather than a function body, which is why the earlier sweep of the
functions did not catch it.

**What it does and does not do.** It is a cross-tenant *write reference*, not a
read leak. I tested the leak path explicitly:

```
embed_join.owner_name_visible      (null — RLS hid it)
v_lead_recovery.owner_name         (null) / state=ASSIGNED
```

The PostgREST embed `leads?select=*,users(id,name)` returns null because RLS on
`users` still hides B's row. So **no data of dealership B reaches dealership A.**
What it produces instead is a lead that the Lead Recovery engine calls
`ASSIGNED` with no owner name — a screen asserting an owner it cannot name, which
is the failure mode this codebase has already had to repair six times.

It is also a weak existence oracle: a wrong uuid returns `23503`, a real one
succeeds. UUIDs are not guessable, so this is secondary.

**The fix.** Make the reference carry its own tenant:

```sql
-- secreg_leads_owner_must_be_this_dealerships_staff
alter table public.users
  add constraint users_id_tenant_uq unique (id, tenant_id);
alter table public.leads drop constraint leads_assigned_to_id_fkey;
alter table public.leads
  add constraint leads_assigned_to_id_fkey
  foreign key (assigned_to_id, tenant_id)
  references public.users (id, tenant_id) on delete set null;
```

Re-prove after applying: the probe above must return `23503`, and the unit form
and lead drawer must both still save.

---

### SEC-03 — `service_role` reads go silent at two dealerships · P1

**The evidence.** Same query, two states of the world, run as `service_role`:

| | one tenant (live now) | two tenants (in a rolled-back txn) |
|---|---|---|
| `nexus_scoped_tenant_id()` | `fff6a2b5-…` | **NULL** |
| `v_inventory_sales` rows | 12 | **0** |
| `v_customer_directory` rows | 2 | **0** |

`nexus_scoped_tenant_id()` deliberately returns the default tenant only when
`(select count(*) from tenants where status='active') = 1`. That is a **correct
fail-closed choice** — it is why nothing leaked — but three surfaces are built
on it and they answer "nothing" rather than "I cannot tell you", which this
repo's own house rule forbids ("a missing row is not proof the event did not
happen").

`CLAUDE.md` records this for the Customer 360 nightly batch. This sweep adds two
more surfaces to that list: `v_inventory_sales` and `v_customer_directory`.

**Consequence at onboarding.** The Customer 360 batch syncs nobody and writes no
audit row; inventory-sales and customer-directory reads by n8n return empty. All
silent.

**The fix.** These are per-tenant surfaces read by a tenant-less role. They must
iterate tenants rather than resolve one. Either give the views a `tenant_id`
parameterisation the caller supplies, or have the batch loop
`nexus_current_tenant_ids()`-equivalent over `tenants where status='active'`. No
migration is offered here because the right shape depends on the n8n side, which
this sweep was told not to touch.

---

### SEC-04 — The two write paths hold table-wide UPDATE · P2

**The attack.** The dashboard sends a fixed column set. The grant does not
constrain columns, so a crafted request can set any of them. Run as tenant A's
real user:

| statement | sqlstate | rows |
|---|---|---|
| `update leads set response_time_minutes = 0 where id = 38` | `00000` | 1 |
| `update leads set ai_score = 100 where id = 38` | `00000` | 1 |
| `update leads set email = 'rebound@attacker.test' where id = 38` | `00000` | 1 |
| `update leads set escalated_at = null, status='closed' where id = 38` | `00000` | 1 |
| `update inventory set cost_aed = 1 where tenant_id = <A>` | `00000` | 12 |
| `update inventory set days_in_stock = 0, gross_margin = 999999 where tenant_id = <A>` | `00000` | 12 |

**Why it matters.** `response_time_minutes` has a declared single authoritative
writer (migration `response_time_single_authoritative_writer`, and
`repair_poisoned_response_times` exists because it has already been poisoned
once). `inventory.cost_aed`, `days_in_stock`, `gross_margin`, `net_margin` and
`holding_cost_accrued` are the inputs Profit Sentinel turns into money on the
screen. `leads.email` is the identity key the whole conversation-resolution
chain hangs off — rewriting it re-points a customer's message history.

The invariant is currently enforced **by the browser not sending those fields**.
That is not a lock. `CLAUDE.md`'s own standard applies: an incidental lock is not
a designed lock.

**Scope.** Same-tenant only — every cross-tenant variant was refused (see §3).
The actor is a signed-in member of the dealership's own staff with devtools open.

**The fix.** Column-level privileges keep the two live screens working and close
the rest:

```sql
-- secreg_narrow_browser_writes_to_the_columns_the_browser_sends
revoke update on public.leads     from authenticated;
grant  update (assigned_to_id, assigned_to) on public.leads to authenticated;

revoke update on public.inventory from authenticated;
grant  update (model, vin, status, acquired_at, price_aed, cost_aed,
               ai_recommendation) on public.inventory to authenticated;
```

Verify afterwards that `unit-form.js` save and `lead-drawer.js` assign both still
succeed, that a `response_time_minutes` PATCH returns `42501`, and that
`service_role` is untouched. Note `cost_aed` must stay writable — the unit form
sends it — so cost poisoning is not closed by this and needs an authority model
(SEC-05) instead.

---

### SEC-05 — No authority model on the direct write paths · P2

`inventory_authenticated_all` and `leads_authenticated_all` are `FOR ALL` to
`authenticated` with a tenant predicate and **no role predicate**. Proven:

```
NOROLE.delete_own_inventory   sqlstate 00000   rows 1
```

Any signed-in staff member can delete a vehicle record, change its price and
cost, and reassign any lead in the dealership. Neither the database nor the UI
gates this — `grep` for role checks in `lib/unit-form.js` and `lib/lead-drawer.js`
finds none — so this is **not** a hidden-button mismatch. It is a stated design
("all staff are equal on these two screens") that has simply never been stated.

It sits oddly beside the Action Centre, which has a full authority model
(`inventory_action_policy.approver_tenant_roles`, `action_approver_context`) and
which I confirmed refuses a non-approver:

```
A_junior.approver_context  may_decide=false  NOT_AN_APPROVER
  "This account may not approve inventory actions. Its account role is member…"
```

So NEXUS gates *approving a recommendation to reprice a car* but not *deleting
the car*. That inconsistency is the finding. At one dealership with one user it
is theoretical; at a dealership with twenty salespeople it is the first thing a
buyer's IT will ask about.

**The fix** is a product decision, not a migration: either state that all staff
may edit inventory and leads, or put those two paths behind the same
`inventory_action_policy` authority the Action Centre already uses.

---

### SEC-06 — `storage.objects` TRUNCATE, and a REVOKE that lies · P2

`storage.objects` and `storage.buckets` carry `authenticated=arwdDxtm` and
`anon=arwdDxtm` — Supabase platform defaults, not this project's grants. The `D`
is live:

```
auth.select_storage_objects     SELECT OK n=11
auth.DELETE_storage_objects     42501  Direct deletion from storage tables is not allowed…
auth.TRUNCATE_storage_objects   TRUNCATE EXECUTED        ← 11 rows → 0
auth.MAKE_KYC_BUCKET_PUBLIC     UPDATE EXECUTED rows=0   (grant present, RLS filtered)
```

DELETE is blocked by a Supabase row trigger. **TRUNCATE fires no row triggers, so
it walks straight past that guard**, exactly as it walks past RLS.

**The part that matters most for the record.** I attempted the obvious fix:

```sql
revoke truncate on storage.objects from authenticated, anon, public;
```

It **returned success and changed nothing**:

```
after:  auth_trunc = true
        acl = … | authenticated=arwdDxtm/supabase_storage_admin | anon=arwdDxtm/… 
```

The grants were made by `supabase_storage_admin`; PostgreSQL ignores a REVOKE
issued by anyone who is not the grantor, and warns rather than errors. A future
agent running that statement would record this as closed. It is not, and it
**cannot be closed from this project** — the same wall `CLAUDE.md` documents for
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`.

**Reachability, stated honestly:** low. `authenticated` is `NOLOGIN`; it is only
assumed via `SET ROLE` by `authenticator`, and PostgREST has no verb that emits
TRUNCATE. Exploiting this needs the `authenticator` database credential, at
which point everything is lost anyway. Recorded as residual platform risk, not
as an exposure of this product.

---

### SEC-07 — Cross-tenant existence oracle in the policy functions · P2

`policy_verify_rule`, `policy_supersede_rule` and `policy_withdraw_rule` read the
rule with no tenant predicate, then refuse:

```
A_owner->B.policy_verify_rule      WRONG_TENANT   "That rule belongs to another dealership."
A_owner->B.policy_supersede_rule   WRONG_TENANT   "That rule belongs to another dealership."
A_owner->B.policy_withdraw_rule    WRONG_TENANT   "This rule is not this dealership's to withdraw."
```

`WRONG_TENANT` vs `NO_SUCH_RULE` confirms that a given uuid exists at another
dealership. `action_decide` deliberately does the opposite and says so in its own
comment: *"Same answer for 'no such action' and 'belongs to another dealership'.
Distinguishing them would confirm the existence of another dealership's row."*
The policy functions should adopt the `action_*` wording. UUIDs are not
enumerable, so this is low severity — but it is an inconsistency in a rule the
codebase has already decided.

The *writes* in all three are correctly scoped — each carries
`and tenant_id = ctx.tenant_id` on the statement itself, and tenant B's rows were
verified untouched afterwards.

---

### SEC-08 / SEC-09 — hygiene · P2

- `public.inventory_actions_touch()` carries a PUBLIC `=X/postgres` ACL entry —
  the only PUBLIC grant left anywhere in `public`. It is inert: it returns
  `trigger`, so PostgREST will not expose it and a direct call as `anon` returns
  `0A000 trigger functions can only be called as triggers`. Close it anyway:
  `revoke all on function public.inventory_actions_touch() from anon, authenticated, public;`
- Supabase **leaked-password protection is disabled**. For a product about to
  hold two dealerships' customer data behind staff passwords, turn it on.
- `vector` and `pg_trgm` are installed in `public`. Per `CLAUDE.md`, objects
  created there by `supabase_admin` are born with an `anon` grant nothing will
  revoke — so the per-object ACL check must be re-run after any extension change
  or platform upgrade.

---

### REC-01 / REC-02 — two corrections to the record

**REC-01.** `nexus_tenancy_readiness()` currently emits:

> WARN — tenant_id is still nullable on some tenant-scoped tables … `policy_rule`,
> `policy_rule_event` … on a table whose uniqueness is UNIQUE(tenant_id, key) a
> NULL also silently defeats that uniqueness

For `policy_rule` this is **false**. A NULL `tenant_id` there means *global rule*,
which is deliberate, and uniqueness is carried by two partial indexes that
between them cover both cases:

```
policy_rule_tenant_version_uq  (tenant_id, jurisdiction, rule_type, rule_name, version) WHERE tenant_id IS NOT NULL
policy_rule_global_version_uq  (jurisdiction, rule_type, rule_name, version)            WHERE tenant_id IS NULL
```

A global rule also cannot be created or verified by a dealership:
`policy_propose_rule` stamps `ctx.tenant_id` (never caller-supplied), direct
INSERT is `42501`, and both `policy_verify_rule` and `policy_supersede_rule`
refuse with `GLOBAL_RULE_NOT_TENANT_VERIFIABLE`. The gate should exempt
`policy_rule` / `policy_rule_event` and say why, or a future reader will
"fix" a designed nullable into a NOT NULL and break global rules.

**REC-02.** `CLAUDE.md` grades the `D` grant as the most dangerous letter because
"RLS does not apply to TRUNCATE". That is true of the *database*. It is worth
adding that **PostgREST has no verb that emits TRUNCATE**, so no holder of a user
JWT can reach it over HTTP; the class is reachable only from a direct Postgres
session as `authenticated`, which requires the `authenticator` credential. This
does not make the grant acceptable — it was right to close it across `public` —
but it means the `competitors` TRUNCATE measured on 3 Sep was a *grant* defect,
not a live exposure, and future gradings should say which.

---

## 2. The full matrix

### 2.1 Grants — `public` schema (§ sweep item 1 and 4)

The load-bearing ACL query from `CLAUDE.md` returns exactly two rows:

```
r  inventory  postgres=arwdDxtm | service_role=arwdDxtm | authenticated=arwd
r  leads      postgres=arwdDxtm | service_role=arwdDxtm | authenticated=rw
```

Both are the named, live dashboard write paths. Everything else is closed.

| Check | Result | Grade |
|---|---|---|
| `anon` — SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES on all 42 tables, 33 views, 3 sequences | **nothing, on every object** | PASS |
| `anon` — EXECUTE on any non-extension function | 1 (`inventory_actions_touch`, PUBLIC, inert) | SEC-08 |
| `anon` — EXECUTE on any `SECURITY DEFINER` function | **0** | PASS |
| `authenticated` — `TRUNCATE` on any object in `public` | **0 objects** | PASS |
| `authenticated` — `TRIGGER` on any object in `public` | **0 objects** | PASS |
| `authenticated` — `REFERENCES` on any object in `public` | **0 objects** | PASS |
| `authenticated` — INSERT, per table, empirically | `42501` on every table except `inventory` (which reached `23502` NOT NULL — grant present by design) | PASS |
| `authenticated` — DELETE, per table, empirically | `42501` on every table except `inventory` (reached `23503` FK) | PASS |
| `authenticated` — UPDATE, per table, empirically | `42501` on every table except `inventory` (12 rows) and `leads` (3 rows) | PASS |
| `authenticated` — TRUNCATE, per table, empirically | `42501` on **every** table including `inventory` and `leads` | PASS |
| Sequences (`leads_id_seq`, `competitors_id_seq`, `rag_documents_id_seq`) | `postgres` + `service_role` only; `anon` and `authenticated` hold nothing — `setval()` unreachable | PASS |
| PUBLIC (`=…`) ACL entries anywhere in `public` | 1, on `inventory_actions_touch` only | SEC-08 |
| Objects created today (`v_lead_recovery*`, `v_deal_rescue*`, `v_attribution_*`, `v_policy_*`, `lead_recovery_*`, `policy_*`, `deal_rescue_*` tables) | all `authenticated=r`, `anon` nothing — **no object was born `arwdDxtm`** | PASS |
| `security_invoker` on all 33 public views | 33 / 33 set | PASS |
| Other schemas reachable by `anon`/`authenticated` with a write verb | `storage.objects`, `storage.buckets`, `storage.buckets_analytics`, `realtime.messages`, `cron.job_run_details` — all platform defaults | SEC-06 |
| `get_advisors` (security) | no RLS lints, no grant lints; 25 definer-executable WARNs (all reviewed, §4), `extension_in_public` ×2, leaked-password WARN | PASS / SEC-09 |

Empirical `anon` probe, real role, real claims — every one refused **by GRANT**,
not by a row filter:

```
anon.select_leads                     42501 permission denied for table leads
anon.select_v_lead_recovery           42501 permission denied for view v_lead_recovery
anon.select_v_policy_authoritative    42501 permission denied for view v_policy_authoritative
anon.select_v_attribution_events      42501 permission denied for view v_attribution_events
anon.select_v_deal_rescue             42501 permission denied for view v_deal_rescue
anon.nexus_current_tenant_id          42501 permission denied for function nexus_current_tenant_id
anon.inventory_actions_touch          0A000 trigger functions can only be called as triggers
```

This is the distinction `CLAUDE.md` insists on: `42501` is *blocked by GRANT*.
Not one of these returned "0 rows".

### 2.2 Cross-tenant reads (§ sweep item 2)

Two dealerships, seeded in a rolled-back transaction: tenant B with its own
leads, communication logs, WhatsApp contact, Customer 360 profile, inventory
unit, purchase, policy rule, inventory action and lead-recovery action.

**As tenant A's real user (honest claims) — rows of tenant B visible:**

| Surface | B rows seen |
|---|---|
| `v_lead_messages` | 0 |
| `v_conversations` | 0 |
| `v_customer_360` | 0 |
| `v_lead_recovery` | 0 |
| `v_lead_recovery_queue` | 0 |
| `v_lead_recovery_coverage` | 0 |
| `v_lead_recovery_health` | 0 |
| `v_deal_rescue` | 0 |
| `v_deal_rescue_candidates` | 0 |
| `v_attribution_events` | 0 |
| `v_attribution_edges` | 0 |
| `v_attribution_link_map` | 0 |
| `v_attribution_sale_chain` | 0 |
| `v_attribution_lead_chain` | 0 |
| `v_policy_rule` | 0 |
| `v_policy_authoritative` | 0 |
| `v_policy_rule_history` | 0 |
| `v_inventory_profit_sentinel` | 0 |
| `v_inventory_action_queue` | 0 |
| `v_inventory_action_timeline` | 0 |
| `v_action_center_health` | 0 |
| `v_inventory_sales` | 0 |
| `v_customer_directory` | 0 |

Free-text canary sweeps (a `tenant_id = B` filter cannot catch a leak that arrives
as *text*): `%bsecret%` in `v_conversations` display name / email / phone → **0**;
`%B SECRET%` in `v_lead_messages` message / email → **0**; `%secret%` in
`v_customer_360` name / email → **0**.

**Views with no `tenant_id` column** (`v_deal_rescue_readiness`,
`v_deal_rescue_state_model`, `v_lead_recovery_state_model`,
`v_policy_unmigrated_constant`) cannot be filtered, so they were fingerprinted
with a content hash before and after tenant B was seeded, read as tenant A:

| View | hash before B | hash after B |
|---|---|---|
| `v_deal_rescue_readiness` | 1009229994 | **1009229994** |
| `v_deal_rescue_state_model` | 2804729110 | **2804729110** |
| `v_lead_recovery_state_model` | 3667292686 | **3667292686** |
| `v_policy_unmigrated_constant` | 3954425282 | **3954425282** |

Byte-identical. Their embedded counts (`deals_in_state_now`, `leads_in_state_now`,
`measured_now`) do not move when another dealership's data appears. Read as
tenant B's own user the same hashes differ (2465752520, 2954403790) — correct
per-tenant behaviour, not a constant.

**Forged `tenant_id` claim** — tenant A's user presenting
`"tenant_id":"<tenant B>"`:

```
tenant_resolved_is_A   1
tenant_resolved_is_B   0
```

and 0 rows of B on `v_lead_messages`, `v_conversations`, `v_customer_360`,
`v_lead_recovery`, `v_deal_rescue`, `v_attribution_events`, `v_policy_rule`,
`v_inventory_profit_sentinel`, `v_inventory_action_queue`, `leads`, `inventory`,
`purchase_history`. The defence is structural, not a filter:
`nexus_current_tenant_id()` honours a JWT `tenant_id` claim **only after joining
`tenant_members` on `auth.uid()`**, so a claim for a tenant you are not a member
of is discarded and the membership fallback applies.

**Reverse direction** — tenant B's real user reading tenant A: 0 rows on all 22
views above **and** on `leads`, `inventory`, `purchase_history`, `audit_log`,
`users`, `communication_logs`, `finance_quotes`, `customer_360_profiles`,
`whatsapp_contacts`, `kyc_documents`, `deals_embeddings`, `rag_documents`.
`tenants` and `tenant_members` each returned **1** — its own, correctly.

### 2.3 `service_role` and the identity collision — the test that matters

`service_role` has `rolbypassrls = true`. RLS is not a lock here at all, so the
question is whether the **views themselves** join across tenants. Tested with a
deliberate collision: tenant B given a lead with the **same email and the same
phone** as tenant A's live lead 38, plus WhatsApp contact, Customer 360 profile
and purchase on the same identity, and two canary messages.

| Probe (as `service_role`) | Result | Verdict |
|---|---|---|
| Canary messages attributed to tenant A's lead 38 | **0** | PASS |
| Where did the canary land? | `lead=119 tenant=<B>` | PASS |
| `v_lead_messages` rows whose lead belongs to a different tenant than the row | **0** | PASS |
| `v_conversations` — message count for the shared phone | `<B>=2 ; <A>=23` — two separate threads, no merge | PASS |
| `v_conversations` rows carrying B's push name under tenant A | **0** | PASS |
| `v_customer_360` for the shared email | two rows: `<B> ltv=999999 msgs=2` and `<A> ltv=585000 msgs=34` — no merge | PASS |
| `v_attribution_sale_chain` rows crossing tenant | **0** | PASS |
| `v_attribution_lead_chain` rows crossing tenant | **0** | PASS |
| `v_lead_recovery` rows crossing tenant | **0** | PASS |
| `v_deal_rescue` rows crossing tenant | **0** | PASS |
| `v_inventory_sales`, `v_customer_directory` at two tenants | **0 rows — silent** | **SEC-03** |

The same collision read as tenant A's `authenticated` user: canary rows 0,
B push name 0, `v_customer_360` shows only A's figures (`ltv=585000 msgs=34`),
the 999999 purchase invisible. Two independent locks, both holding.

### 2.4 Destructive verbs and write forgery (§ sweep item 1)

| Attack, as tenant A's real user | Result | Stopped by |
|---|---|---|
| `TRUNCATE public.audit_log` | `42501` | **GRANT** |
| `TRUNCATE` every other table in `public` | `42501` on all | **GRANT** |
| `INSERT` into `audit_log` stamped for tenant B | `42501 permission denied for table audit_log` | **GRANT** |
| `INSERT` into `tenant_members` granting self membership of B | `42501 permission denied for table tenant_members` | **GRANT** |
| `UPDATE users SET role='admin'` (self-escalation) | `42501 permission denied for table users` | **GRANT** |
| `UPDATE inventory` — tenant B's unit | `00000`, **0 rows** | RLS only (grant is deliberate) |
| `UPDATE leads` — tenant B's lead | `00000`, **0 rows** | RLS only (grant is deliberate) |
| `UPDATE inventory SET tenant_id = <B>` (donate own rows) | `42501 new row violates row-level security policy` | RLS `WITH CHECK` |
| `UPDATE leads SET tenant_id = <B>` | `42501 new row violates row-level security policy` | RLS `WITH CHECK` |
| `INSERT inventory` stamped `tenant_id = <B>` | `42501 new row violates row-level security policy` | RLS `WITH CHECK` |
| `INSERT inventory` for own tenant (consumer check) | `00000`, 1 row | — consumer intact |
| Read tenant B's `users` rows (id oracle) | 0 rows | RLS |

Recorded honestly: on `inventory` and `leads` the cross-tenant UPDATE **parsed
and executed** and was stopped only by the row filter. That is one lock. It is
the deliberate consequence of keeping those two write paths working, and the
`WITH CHECK` on the same policies is what stops the row being moved or forged
into another tenant. But `CLAUDE.md`'s standard should be applied to it plainly:
for these two tables, RLS is the only thing between dealership A and dealership
B's rows.

### 2.5 The `SECURITY DEFINER` surface (§ sweep item 5)

25 `SECURITY DEFINER` functions are reachable by `authenticated`; **0** by `anon`.
All are owned by `postgres` and all pin `search_path`.

Every write statement in all 25 was read. Every `UPDATE` and every `INSERT`
carries `tenant_id = <context tenant>` **on the statement itself**, not merely on
a lock taken earlier — the specific defect `CLAUDE.md` records from the prior
sweep. Notable:

- `action_propose` reads `v_inventory_profit_sentinel` with an explicit
  `v.tenant_id = v_ctx.tenant_id`, and carries a comment explaining that the
  predicate is load-bearing because a `security_invoker` view read from inside a
  definer function evaluates as the owner and bypasses RLS. Correct.
- `action_decide` / `lead_recovery_decide` validate `p_assign_staff_id` with
  `u.tenant_id = v_ctx.tenant_id` before assigning — the check `leads`' own FK is
  missing (SEC-02).
- `recompute_inventory_derived` resolves `v_scope` from the caller
  (`nexus_current_tenant_id()` when the caller is `authenticated`/`anon` or has an
  `auth.uid()`), applies `inv.tenant_id = v_scope` in the source subquery **and**
  `i.tenant_id = v_scope` on the UPDATE, and joins settings on `tenant_id`. A
  signed-in account belonging to no dealership returns 0. Correct.
- `policy_propose_rule` stamps `ctx.tenant_id`; the jurisdiction/rule_type/unit
  arguments are FK-checked against closed vocabularies.

**Empirical proof, not code reading.** Tenant A's owner called every one of them
against tenant B's ids:

```
A_owner->B.action_decide            ok=false  NOT_FOUND      "No such action on this dealership."
A_owner->B.action_cancel            ok=false  NOT_FOUND      "No such action on this dealership."
A_owner->B.action_propose_B_unit    ok=false  UNIT_NOT_FOUND "No unit with that id on this dealership's lot."
A_owner->B.lead_recovery_decide     ok=false  NOT_FOUND      "No such action on this dealership."
A_owner->B.lead_recovery_propose    ok=false  LEAD_NOT_FOUND "No lead with that id at this dealership."
A_owner->B.policy_verify_rule       ok=false  WRONG_TENANT
A_owner->B.policy_withdraw_rule     ok=false  WRONG_TENANT
A_owner->B.policy_supersede_rule    ok=false  WRONG_TENANT
```

And tenant B's rows afterwards — the check that matters, because a refusal
message is not proof nothing was written:

```
AFTER.B_inventory_action.status       PROPOSED            (unchanged)
AFTER.B_lead_recovery_action.status   PROPOSED            (unchanged)
AFTER.B_policy_rule.status            DRAFT/NOT_VERIFIED  (unchanged, verified_by null)
AFTER.B_policy_rule_versions          1                   (no version was inserted)
```

### 2.6 Roles (§ sweep item 6)

Roles live in the database today: `tenant_members.role` = `owner` (1);
`users.role` = `senior_rep` (1); `inventory_action_policy.approver_tenant_roles`
= `{owner, admin, manager}`; `approver_staff_roles` = `{}` (empty).

| Question | Answer |
|---|---|
| Is approval authority enforced in the database? | **Yes.** `action_approver_context()` is `SECURITY DEFINER` and every decide/cancel/execute path calls it before writing. A synthetic `member` of tenant A was refused: `may_decide=false, NOT_AN_APPROVER`. |
| Is it enforced by a hidden button? | No — the refusal is generated in the database and the screen renders the database's reason. |
| Can a non-approver create a policy rule? | Yes — `policy_propose_rule` returned `ok=true` for a `member`. **This is correct by design:** the row lands `DRAFT` / `NOT_VERIFIED`, and `v_policy_authoritative` selects only `authority = 'AUTHORITATIVE'`. Becoming authoritative requires `policy_verify_rule`, which is approver-gated and additionally refuses global rules outright. Propose is open, believe is not. |
| Can a signed-in user grant themselves membership of another dealership? | No — `INSERT tenant_members` is `42501` by grant. |
| Can a signed-in user escalate their own `users.role`? | No — `UPDATE users` is `42501` by grant. |
| Is there any role check on inventory/lead editing? | **No** — SEC-05. |
| `anon` / `authenticated` / `service_role` login capability | `anon`, `authenticated`, `service_role` are all `NOLOGIN`; only `authenticator` has `LOGIN`. |

---

## 3. The deployed-bundle write inventory (§ sweep item 3)

Traced in `dist/assets/main-iuJGczAF.js` (1,224,492 bytes, built 2 Sep 19:35) —
the deployed artefact, not the source. In the minified bundle `Xe` is `db()` and
`Hi` is `dbWrite()`; there are exactly **6** `Hi(` sites, one of which is the
definition.

Also checked, and clean: **no** `supabase-js` `.insert()`, `.upsert()`,
`.update()` or `.rpc()` call sites (the `.delete()` and `.storage` hits are
library internals — phoenix socket, GoTrue storage keys); the only
`method:"POST"` outside the vendored libraries is the n8n webhook; the only
`/rest/v1/` templates in the whole bundle are the two inside `db()` and
`dbWrite()`. There is no second write channel.

### Direct table writes — the complete list

| # | Statement in the deployed bundle | Source | What authorises it | Same call against another tenant's row? |
|---|---|---|---|---|
| 1 | `PATCH leads?id=eq.<id>` body `{assigned_to_id, assigned_to}` | `lib/lead-drawer.js:475` | grant `authenticated=rw` on `leads` + RLS `leads_authenticated_all` (tenant predicate, USING **and** WITH CHECK) | **No — 0 rows.** Proven against a seeded tenant B row. The row also cannot be moved to another tenant (`42501` on WITH CHECK). **But** `assigned_to_id` may point at another tenant's staff — **SEC-02.** And the column set is unconstrained — **SEC-04.** |
| 2 | `POST inventory` body `{id, model, vin, status, acquired_at, price_aed, cost_aed, ai_recommendation}` | `lib/unit-form.js:583` | grant `authenticated=arwd` on `inventory` + RLS WITH CHECK | **No.** An INSERT stamped `tenant_id = <B>` is refused `42501 new row violates row-level security policy`. |
| 3 | `PATCH inventory?id=eq.<id>` same body | `lib/unit-form.js:584` | as above | **No — 0 rows** against tenant B's unit. Column set unconstrained — **SEC-04.** |
| 4 | `DELETE inventory?id=eq.<id>` | `lib/unit-form.js:605` | grant `authenticated=arwd` | **No — 0 rows** against tenant B's unit. No role check within the tenant — **SEC-05.** |

### RPC writes — all `SECURITY DEFINER`, owned by `postgres`

| Call | Site | Authority |
|---|---|---|
| `POST rpc/action_propose` | `screens/actions.js` via `dbWrite` | `action_approver_context()` — tenant + `UNIT_NOT_FOUND` for another tenant's unit |
| `POST rpc/action_decide` | " | tenant + approver role; refuses `NOT_FOUND` cross-tenant |
| `POST rpc/action_mark_executed` | " | " |
| `POST rpc/action_cancel` | " | " |

Because these are `SECURITY DEFINER` owned by `postgres`, they touch their
tables as `postgres` and are unaffected by the caller's table grants — which is
what makes the narrow `authenticated` grants safe. `prosecdef` and `proowner`
were read, not assumed.

### RPC reads

`GET rpc/action_approver_context` (definer, tenant-scoped) and
`GET rpc/sentinel_inventory_actions` — the latter is **`SECURITY INVOKER`**, so it
reads as the caller and RLS applies. That distinction is load-bearing and was
checked, not assumed.

### Other outbound writes

`POST ${VITE_N8N_BASE_URL}/webhook/<path>` for `ask-ai`, `finance-calc`,
`lead-trigger`, `deals/closed-won`, `audit-kyc`, `erp-sync`, `lead-escalation`,
`whatsapp-send`, carrying the user's Supabase JWT as a bearer token. **Not
tested — see §4.**

### Source-vs-deployed drift

`grep` of `lib/` and `screens/` finds the same four `dbWrite` table calls and the
same `rpc/` wrapper. No write exists in source that is missing from `dist`, and
none in `dist` that is missing from source. Two sibling agents are building
screens concurrently; **this inventory is true of the bundle as of 2 Sep 19:35
and must be re-run before release** if either agent adds a write.

---

## 4. NOT RUN — and why

A NOT RUN is not a PASS. These are open.

| Item | Why not run | Residual risk |
|---|---|---|
| **n8n webhook authentication** — whether all 8 `HOOK` endpoints actually reject a request with no/invalid Supabase JWT, and whether they resolve a tenant from the token rather than trusting the payload | The brief forbids touching the n8n box, and one agent at a time is a standing house rule | **High and unquantified.** The n8n base URL ships in a public bundle. `CLAUDE.md` records the check verified live on `whatsapp-send` **only**; the other seven are believed, not proven. n8n also writes as `service_role`, which bypasses RLS entirely — it is the largest untested tenancy surface in the product |
| **Live HTTP probes through PostgREST** (real Supabase URL + a real user access token) | No live session credentials available in this environment | Low. Every probe was run at the SQL layer as the real role with real JWT claims, which is exactly what PostgREST establishes per request. PostgREST adds URL→SQL translation and the embed syntax; the embed was simulated directly (`leads LEFT JOIN users`) and RLS held |
| **Storage API behaviour** for `createSignedUrl` on an unclaimed object | Would require minting a real signed URL against live customer KYC images | Medium — this is SEC-01's exploit step. The policy text and the 8/11 count are proven; the signed-URL round trip is inferred from them |
| **Frontend screens under construction** by the two sibling agents | Not written yet at the time of this sweep | The bundle write inventory (§3) must be re-run before release |
| **`QUALITY_GATE.mjs`** | Being rebuilt concurrently by another agent | Out of scope |
| **Row-level correctness of the new engines** (Lead Recovery, Deal Rescue, Attribution, Policy) — do they compute the right numbers | This sweep is about who can see and change what, not whether the figures are right | Separate concern |
| **`realtime.messages` / `cron.job_run_details`** write grants to `anon`/`authenticated` | Supabase platform tables outside this project's control; no NEXUS data flows through them today | Low, but re-check if realtime is ever enabled on a NEXUS table |

---

## 5. What to do, in order

1. **SEC-01** — drop the unclaimed-object fallback from `kyc_objects_staff_read`,
   then delete the 8 orphan objects. Blocker for onboarding dealership two, and
   the retention issue stands regardless.
2. **SEC-02** — composite FK on `(assigned_to_id, tenant_id)`. Cheap, and it
   closes a cross-tenant write.
3. **SEC-03** — make the three `service_role` surfaces iterate tenants. Rehearse
   on a staging box, as `CLAUDE.md` already instructs for `NEXUS_TENANT_MAP`.
4. **Prove the seven unverified n8n webhooks reject an unauthenticated call**,
   one agent, on the box. This is the largest NOT RUN in this report.
5. **SEC-04** — column-level grants on `leads` and `inventory`.
6. **SEC-05** — decide and state the authority model for the two direct write
   paths.
7. **SEC-09** — enable leaked-password protection.
8. **SEC-07 / SEC-08 / REC-01 / REC-02** — wording and hygiene.

---

## 6. What this sweep did to the database

Nothing. Every probe ran inside `BEGIN … ROLLBACK`, rollback semantics were
verified before any destructive probe, and the synthetic tenant, its
`auth.users` row, its staff, leads, messages, inventory, purchases and policy
rules existed only inside transactions that were rolled back. The only DDL was
scratch result tables inside those same transactions. No migration was applied.

Verified after the sweep, on the live database:

```
tenants 1 | tenant_members 1 | users 1 | auth.users 1
leads 3 | inventory 12 | policy_rule 7 | inventory_actions 3 | lead_recovery_actions 0
storage kyc-documents objects 11
```

and every scratch table gone (`_secreg_res`, `_secreg_verb`, `_secreg_c`,
`_secreg_d`, `_secreg_e`, `_secreg_f`, `_secreg_s`, `_secreg_rollback_probe`
all resolve to NULL). No synthetic tenant, staff, lead, message, unit, purchase
or policy rule survived. `leads` is 3 and `inventory` 12 — the same figures the
baseline read returned before tenant B was ever seeded.
