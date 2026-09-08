# V1 closure, item 2 — is the role model enforced by the database?

**6 September 2026.** Everything below was executed. No git command was run. The
production n8n box (`35.224.126.225`) was not contacted.

- staging **`wwspuxrbiyagnrnzgate`** — staging-alpha (7 logins, all six roles),
  staging-bravo (2), demo-northwind (3). Where the writes happened.
- production **`dsvuoovivysszdoiorch`** — ALBA CARS, one login. Touched **only**
  inside transactions ending in an unconditional `RAISE EXCEPTION`. Counts before
  and after are identical and are printed in §9.

Two transports were used and they are **not** treated as equal evidence:

| arm | what it is | strength |
|---|---|---|
| **REST** | a real GoTrue password sign-in, then PostgREST with `apikey` + `Authorization: Bearer` — the two headers the dashboard sends | the witness |
| **SQL** | `set local role authenticated` + `request.jwt.claims.sub` inside a transaction that always aborts | **the weaker witness**, and labelled as such at every cell |

The SQL arm exists because two things cannot be reached over REST — `TRUNCATE`,
which PostgREST exposes no verb for, and a positive control that is literally in
the same transaction as the negative it controls. Where both arms ran they agree,
cell for cell, with one exception that turned out to be my own ordering mistake
and is written up in §7 rather than hidden.

---

## 1 · The verdict, first

**PASS** — the role model is enforced by the database, on both projects, for all
six roles and for a member of the other dealership, on both tables, for every
destructive verb in the brief. 168 REST cells and 231 SQL cells; every negative
carries a positive control; no cell was marked PASS without a live result.

**Three things qualify that PASS and belong beside it:**

1. **Not every refusal is the same strength.** 42501 (a GRANT) is absolute and
   runs before any policy. `0 rows` (RESTRICTIVE RLS) is fail-closed but is a
   row filter, and CLAUDE.md's own rule is that it is evidence about RLS and
   never about a privilege. `NX001` (a trigger, or a function's authority check)
   is code and can be dropped or replaced. §4 says which one stops which cell.
2. **`service_role` is not gated by any of it** and n8n holds that key. §6.
3. **Two cells could not be run and are NOT RUN, not PASS.** §8.

---

## 2 · The corrected ACL query, run on both projects

CLAUDE.md's corrected write-grant sweep (all four verbs, table **and** column
level, sequences split out), run verbatim.

**Staging `wwspuxrbiyagnrnzgate` and production `dsvuoovivysszdoiorch` return the
same four rows and nothing else:**

| object | grantee | verb | at_table_level | at_column_level |
|---|---|---|---|---|
| `inventory` | `authenticated` | DELETE | **true** | n/a |
| `inventory` | `authenticated` | INSERT | false | **true** |
| `inventory` | `authenticated` | UPDATE | false | **true** |
| `leads` | `authenticated` | UPDATE | false | **true** |

`relacl` on both projects:

```
inventory  postgres=arwdDxtm/postgres | service_role=arwdDxtm/postgres | authenticated=rd/postgres
leads      postgres=arwdDxtm/postgres | service_role=arwdDxtm/postgres | authenticated=r/postgres
```

`pg_attribute.attacl`, both projects, byte-identical:

```
inventory  id, model, vin, status, price_aed, cost_aed, ai_recommendation, acquired_at = authenticated=aw
           tenant_id = authenticated=a        <- INSERT only; see D1/D3 below
           days_in_stock, gross_margin, vat_amount, holding_cost_accrued,
           net_margin, recommended_commission, aging_alert  = NO GRANT

leads      name, email, phone, vehicle_interest, budget_aed, status,
           assigned_to, assigned_to_id = authenticated=w
           id, source, ai_score, response_time_minutes, created_at,
           escalated_at, bitrix_lead_id, crm_synced_at, tenant_id = NO GRANT
```

**Confirmed, exactly as CLAUDE.md's default-grant section says.** The brief's
second premise is correct: `inventory` carries a real table-level
`authenticated=rd` — `d` is DELETE — plus column INSERT/UPDATE grants on nine and
eight columns respectively. Nine columns carry `a` and eight of those also carry
`w`; `tenant_id` carries `a` alone.

**`D` (TRUNCATE) appears nowhere.** No object in `public` on either project
grants TRUNCATE to `anon` or `authenticated`, at any level. That is not inferred
from the ACL alone — §5 executes it.

**The read-side query** (CLAUDE.md's second query) returns **exactly one row on
each project**, identically:

```
channel_registry / authenticated / integration_id, tenant_id, channel_type,
                                   external_identifier, status, created_at, updated_at
```

`credential_ref` withheld — the deliberate design. `policy_platform_attestation`
does not appear on either project.

I ran only the **corrected** query. I did not re-run the old one; CLAUDE.md's
record that it returned zero rows over these four is inherited, not re-measured
here.

---

## 3 · The matrix

Target rows. **Staging alpha:** `ALPHA-002` (a vehicle with no dependent
`inventory_actions` row); leads `8` (assigned to the `sales1` staff record),
`9` (assigned to `sales2`), `1` (unassigned, temporarily assigned to the
`member` staff record for the member/technician cells). **Production:** `NX-1002`;
leads `34` (assigned to Ali's staff record) and `38` (unassigned).

Legend: `n` = rows affected. `42501/G` = refused by **GRANT**. `42501/RLS` =
refused by a RESTRICTIVE policy's **WITH CHECK** (PostgREST returns 42501 with
"new row violates row-level security policy"). `0 rows` = filtered by a
RESTRICTIVE policy's **USING**. `NX001` = the cost trigger or an RPC's authority
check.

### 3a · `inventory`

| cell | owner | admin | manager | sales | technician | member | bravo owner (other dealership) |
|---|---|---|---|---|---|---|---|
| SELECT (day job) | **all** | **all** | **all** | **all** | **all** | **all** | **1** (its own) |
| control: target row visible | 1 | 1 | 1 | 1 | 1 | 1 | **0** |
| UPDATE ordinary (`price_aed`) | 1 | 1 | 1 | **0 rows** | **0 rows** | **0 rows** | **0 rows** |
| UPDATE `cost_aed`, figure MOVED | 1 | 1 | **NX001** | **0 rows** | **0 rows** | **0 rows** | **0 rows** |
| UPDATE `cost_aed`, named but UNCHANGED | 1 | 1 | **1** | 0 rows | 0 rows | 0 rows | 0 rows |
| UPDATE machine (`days_in_stock`) | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** |
| UPDATE machine (`gross_margin`) | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** |
| UPDATE `ai_recommendation` (granted) | 1 | 1 | 1 | 0 rows | 0 rows | 0 rows | 0 rows |
| INSERT | 1 | 1 | **42501/RLS** | **42501/RLS** | **42501/RLS** | **42501/RLS** | **42501/RLS** |
| DELETE | 1 | 1 | **0 rows** | **0 rows** | **0 rows** | **0 rows** | **0 rows** |
| **TRUNCATE** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** |
| move row to another dealership (`UPDATE tenant_id`) | **42501/G** | — | — | — | — | — | — |
| INSERT under another dealership's `tenant_id` | **42501/RLS** | — | — | — | — | — | — |

**"all" is stated rather than a number because the two arms saw different totals
and the difference is the harness, not the product.** staging-alpha held **5**
vehicles when the SQL arm ran and **12** when the REST arm ran — the REST arm
needed seven disposable `RBACDEL-<role>` units so that each actor's DELETE had its
own target, and those seven were removed afterwards (§11). Every role saw the same
number as every other role in the same arm, and the bravo owner saw **1** in both.
Production returned **12** for every role, which is ALBA's true count.

REST and SQL arms agree on every cell above. The bravo-owner column's zeros are
**not** an empty table: in the same session, `GET inventory?tenant_id=eq.<bravo>`
returned **1** and `PATCH BRAVO-001` returned **1 row** — the withheld rows are
withheld, not absent.

### 3b · `leads`

Ownership matters here, so the row headings say whose lead it is.

| cell | owner | admin | manager | sales | technician | member | bravo owner |
|---|---|---|---|---|---|---|---|
| SELECT (day job) | **3** | **3** | **3** | **3** | **3** | **3** | **1** (its own) |
| control: leads 8 and 9 visible | 2 | 2 | 2 | 2 | 2 | 2 | **0** |
| UPDATE ordinary, lead is **theirs** | 1 | 1 | 1 | **1** | **0 rows** | **1** | 0 rows |
| UPDATE ordinary, lead is **not theirs** | 1 | 1 | 1 | **0 rows** | **0 rows** | **0 rows** | 0 rows |
| UPDATE sensitive (`budget_aed`), theirs | 1 | 1 | 1 | **1** | **0 rows** | **1** | 0 rows |
| UPDATE machine (`ai_score`) | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** |
| UPDATE machine (`response_time_minutes`) | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** |
| INSERT | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** |
| DELETE | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** |
| **TRUNCATE** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** | **42501/G** |
| **reassign a lead that IS theirs** | 1 | 1 | 1 | **42501/RLS** | **0 rows** | **42501/RLS** | 0 rows |
| **reassign a lead that is NOT theirs** | 1 | 1 | 1 | **0 rows** | **0 rows** | **0 rows** | 0 rows |
| unassign their own lead (→ NULL) | 1 | 1 | 1 | **42501/RLS** | — | **42501/RLS** | — |
| move row to another dealership (`UPDATE tenant_id`) | **42501/G** | — | — | — | — | — | — |

The `technician` row is the one worth reading twice. A technician **can see** the
lead assigned to them — the control returns 1 row — and **can write nothing on
it**: 0 rows on status, on `budget_aed`, and on reassignment. `technician` appears
in neither branch of `leads_role_update`, so it is a floor even below `member`
for leads. That is the model as designed, and it is measured, not assumed.

**`sales` giving away its own lead is the cell that would have been missed.** The
USING half alone stops a rep *taking* someone else's lead (0 rows). It does not
stop a rep *giving away* their own — that is stopped by WITH CHECK, and it
returns **42501**, over the real signed-in HTTPS path:

```
S1 PATCH lead8 status         (THEIRS)              HTTP 200 rows=1
S2 PATCH lead9 status         (NOT theirs)          HTTP 200 rows=0
S3 PATCH lead8 budget_aed     (THEIRS, sensitive)   HTTP 200 rows=1
S4 PATCH lead8 assigned_to_id -> sales2             HTTP 403 42501
                              new row violates row-level security policy "leads_role_update"
S5 PATCH lead9 assigned_to_id -> self               HTTP 200 rows=0
S6 PATCH lead8 assigned_to_id -> null               HTTP 403 42501  (same policy)
S7 control, after: lead8 still theirs               HTTP 200 rows=1
```

### 3c · Production, same matrix, same answers

Run on `dsvuoovivysszdoiorch` in one transaction ending in `RAISE EXCEPTION`, by
temporarily relabelling the **one** existing membership row inside that
transaction — **no user was created, no row persisted** (§9). This is the SQL arm
and therefore the **weaker witness**; it is recorded as such.

Production returned the **same verdict in every cell** as staging:
owner/admin full; manager `NX001` on a moved cost, `42501/RLS` on INSERT, 0 rows
on DELETE; sales/member own-lead-only with `42501/RLS` on giving their own lead
away; technician 0 rows on every lead write; machine columns `42501` for all;
`leads` INSERT and DELETE `42501` for all; **TRUNCATE `42501` for all on both
tables**.

One extra production row the brief did not ask for and which is worth having: a
signed-in account with **no `tenant_members` row** — what a new colleague's login
looks like before anyone gives it a role — sees **0 inventory, 0 leads** and
writes nothing. Fail-closed.

---

## 4 · Which mechanism stops what — per cell, not a blanket "denied"

This is the brief's first question, and the answer is that **three different
locks are doing the work and they are not equally strong.**

| what is refused | the lock | the witness | how strong |
|---|---|---|---|
| any role writing `days_in_stock`, `gross_margin`, `vat_amount`, `holding_cost_accrued`, `net_margin`, `recommended_commission`, `aging_alert` | **column GRANT (absent)** | `42501 permission denied for table inventory` | strongest — runs before any policy |
| any role writing `leads.ai_score`, `response_time_minutes`, `source`, `created_at`, `escalated_at`, `bitrix_lead_id`, `crm_synced_at`, `id` | **column GRANT (absent)** | `42501 permission denied for table leads` | strongest |
| any role INSERTing or DELETing a **lead** | **table GRANT (absent)** | `42501` | strongest |
| any role **TRUNCATE** on either table | **table GRANT (absent)** | `42501` | strongest — and RLS could not have helped here |
| moving a vehicle or a lead **between dealerships** by UPDATE | **column GRANT** (`tenant_id` is `a`, not `aw`) | `42501` | strongest |
| **manager MOVING `cost_aed`** | **BEFORE UPDATE trigger** `inventory_guard_cost_change` | `NX001` + a sentence | **code** — droppable, replaceable |
| non-owner/admin via `inventory_set_cost` / `inventory_delete_unit` | **function authority check** | `NX001` + a sentence | code |
| **manager DELETing a vehicle** | **RESTRICTIVE RLS `inventory_role_delete` USING** | **0 rows** | fail-closed, but a row filter |
| **sales / technician / member / other-dealership writing any `inventory` row** | **RESTRICTIVE RLS `inventory_role_update` USING** | **0 rows** | fail-closed, but a row filter |
| **sales / member touching a lead that is not theirs** | **RESTRICTIVE RLS `leads_role_update` USING** | **0 rows** | fail-closed, but a row filter |
| **technician touching any lead, including their own** | **RESTRICTIVE RLS `leads_role_update` USING** | **0 rows** | fail-closed, but a row filter |
| **sales / member giving away their OWN lead** | **RESTRICTIVE RLS `leads_role_update` WITH CHECK** | **42501** | RLS, but it *does* raise |
| manager / sales / technician / member **INSERTing a vehicle** | **RESTRICTIVE RLS `inventory_role_insert` WITH CHECK** | **42501** | RLS, but it *does* raise |
| INSERTing a vehicle under another dealership's `tenant_id` | **PERMISSIVE tenant policy WITH CHECK** | **42501** | RLS |
| `anon`, everything | **schema USAGE revoked** | `42501 permission denied for schema public`, over live HTTPS | strongest |

**So the brief's first premise is confirmed and can now be stated precisely.**
`manager` moving `cost_aed` is `NX001` from the trigger. `manager` deleting a
vehicle, and every `sales`/`technician`/`member` write to `inventory`, are
**0 rows from RESTRICTIVE RLS** — no error, no 42501. That is fail-closed and
safe, and it is the weaker witness of the two. Every one of those zeros in this
document is paired with a control showing the row **was visible to that same
session** in the same transaction or the same signed-in call, so none of them is
a green result that is really an absent one.

**Why the strongest lock is not used for the cost price**, restated because it is
load-bearing: `rbac_02` withheld `UPDATE(cost_aed)` and `DELETE` outright and
`rbac_05` gave them back, because the *deployed* dashboard bundle PATCHes
`cost_aed` on every vehicle save. The rebuilt bundle that omits it exists in the
working tree and is **not deployed**. Until it is, `authenticated` holds
`UPDATE(cost_aed)` and table-level `DELETE` on `inventory`, and the only things
between a manager and a cost price, or between a manager and a vehicle deletion,
are a trigger and a policy. **That is still open** — item 1 of
`rbac-evidence.md` §8 — and this pass did not close it.

---

## 5 · TRUNCATE, executed rather than reasoned about

RLS does not apply to TRUNCATE, so on any object carrying `D` the sentence "RLS is
the remaining lock" is false. Both tables were TRUNCATEd for real, by every role,
in aborted transactions, on **both** projects:

```
staging   owner/admin/manager/sales/technician/member/bravo-owner
          truncate public.inventory cascade   -> 42501 permission denied for table inventory
          truncate public.leads cascade       -> 42501 permission denied for table leads
production  same seven role labels, same two statements  -> 42501, 42501
anon        -> 42501 permission denied for schema public
service_role, staging  truncate public.inventory cascade -> SUCCEEDED, rows left = 0
```

The positive control is the last line: the statement is well-formed and the table
is truncatable — it is the privilege that is missing for `authenticated`, not the
verb that is broken.

---

## 6 · The same matrix as `service_role` — and what it means

Measured on staging, one aborted transaction, no JWT claims:

```
SR0  current_user = service_role      pg_roles.rolbypassrls = TRUE
SR1  SELECT inventory                 35 rows   -- all three dealerships
SR2  SELECT leads                     28 rows   -- all three dealerships
SR3  UPDATE alpha cost_aed             1 row    -- no NX001
SR3b audit rows written by that move   0        -- see below
SR4  UPDATE another dealership's unit BRAVO-001          1 row
SR5  UPDATE every NORTHWIND unit's cost_aed             29 rows
SR6  INSERT a lead under ANOTHER dealership              1 row
SR7  DELETE a lead                                       1 row
SR8  UPDATE leads.ai_score                               1 row
SR9  TRUNCATE public.inventory CASCADE   SUCCEEDED, rows left = 0
```

**Plainly: `service_role` is subject to none of this, and n8n holds that key.**
It is `BYPASSRLS`, so no policy in this database filters a row of it; it holds
`arwdDxtm` on both tables, so no grant refuses a verb; and the cost trigger
**exempts it by design** (`if not v_person then return new`). Every control proved
in §3 and §4 is a control on a person coming through a browser. The workflow
layer has none of them, and the open WhatsApp webhook documented in CLAUDE.md sits
in front of that key.

**One measured consequence worth naming.** `rbac-evidence.md` §4 claims the
trigger buys "an audit row on **every** cost change **by a person**" — that
qualifier is correct and I confirmed the other half of it: a `service_role` cost
change writes **no audit row at all** (SR3b, 0 new rows against a live control of
the 4 rows the person-callers wrote in §7). So on the current design, if n8n or a
nightly job ever moves a cost price, **nothing in this database records that it
happened.** Reported, not fixed.

---

## 7 · The person-caller audit trail, and a methodology correction

**The audit trail works, over the real path.** Four `audit_log` rows were written
by the REST arm, each naming the old figure, the new figure and the auth user:

```
cost_aed on ALPHA-002 changed from 70000 to 70001 by auth user aaaaaaaa-…-a001   (owner)
cost_aed on ALPHA-002 changed from 70001 to 70000 by auth user aaaaaaaa-…-a001
cost_aed on ALPHA-002 changed from 70000 to 70001 by auth user aaaaaaaa-…-a007   (admin)
cost_aed on ALPHA-002 changed from 70001 to 70000 by auth user aaaaaaaa-…-a007
```

They are left in place deliberately — an audit row is a record, and deleting it to
tidy up would be the wrong instinct.

**A gap in it, found by looking:** the manager's *refused* cost change wrote
**nothing**. The trigger raises before it reaches the audit insert, so an attempt
to move a cost price that the database refused leaves no trace anywhere. A
dealership auditing "who has tried to change our cost prices" cannot answer it.
Reported as a defect; not fixed in this pass.

**The methodology correction, recorded because it nearly produced a wrong cell.**
The first REST pass ran the seven actors in sequence against shared rows, and
`owner` reassigned lead 8 to `sales2` and lead 9 to `sales1` — over HTTP there is
no rollback, so those writes persisted into the later actors' runs. `sales`
therefore appeared to be unable to write lead 8 and able to write lead 9, the
exact inverse of the model. It was **not** a defect: ownership had genuinely
swapped, and the rule tracked it. The rows were restored from a snapshot taken
before the run and the `sales`, `member` and `technician` lead cells were re-run
in isolation (§3b, S1–S7 and the member/technician block). This is the shape of
error the brief warns about — a result that looks like a finding and is an
artefact of the harness — so it is written down rather than quietly corrected.

---

## 8 · The Team screen's own controls, re-proved after the migrations since

Both projects, aborted transactions.

**Staging (`nexus_team_*`, real fixture identities):**

```
T1   sales   set_role(SELF -> owner)          NX001  You may not change this person's role.
T1b  sales   set_role(SELF -> manager)        NX001  (same)
T1c  sales   set_role(sales2 -> admin)        NX001  (same)
T1d  sales   revoke_access(owner)             NX001  You may not remove this person's access.
T1e  control sales reads the roster           7 rows   -- reading is deliberately not gated
T2   admin   set_role(SELF -> owner)          NX001  Only an account owner may grant or remove the owner role.
T2b  admin   set_role(manager -> owner)       NX001  (same)
T2c  admin   invite(x, 'owner')               NX001  Only an account owner may add another owner.
T2d  admin   revoke_access(owner)             NX001  Only an account owner may remove another owner's access.
T2e  control admin demotes a manager to sales ACCEPTED   -- admin is not merely broken
T3   sole owner (bravo) revoke_access(SELF)   NX001  This is the only owner … access cannot be removed.
T3b  sole owner (bravo) set_role(SELF)        NX001  This is the only owner … role cannot be changed.
T4   bravo owner set_role(alpha sales)        NX001  You may not change this person's role.   (cross-tenant)
T4b  bravo owner revoke_access(alpha sales)   NX001  You may not remove this person's access. (cross-tenant)
T4c  control bravo owner reads its own roster 2 rows   -- so T4/T4b are refusals, not emptiness
```

**Production (one membership row, relabelled inside the aborted transaction):**

```
Q1   sole owner set_role(SELF -> admin)       NX001  only owner … role cannot be changed
Q2   sole owner revoke_access(SELF)           NX001  only owner … access cannot be removed
Q3   control roster                           1 row
Q3b  control owner may invite an owner        ACCEPTED (legitimate)
Q4   as sales, set_role(SELF -> owner)        NX001  You may not change this person's role.
Q5   as sales, invite(x,'manager')            NX001  You may not add somebody to this dealership.
Q6   as sales, rpc inventory_set_cost         NX001  You may not change the cost price of this vehicle.
Q7   as sales, rpc inventory_delete_unit      NX001  You may not delete this vehicle.
Q8   as admin, set_role(SELF -> owner)        NX001  Only an account owner may grant or remove the owner role.
Q9   as admin, invite(x,'owner')              NX001  Only an account owner may add another owner.
Q10  control, as admin, rpc inventory_set_cost ACCEPTED (legitimate)
```

**All four controls the brief named still hold**, on both projects, after the
migrations that landed since they were first proved. Each refusal is `NX001` from
the function's own authority check — **code, not a grant** — and each sits beside
a legitimate act by the same actor that was accepted, so none of them is a
function that refuses everything.

### Revocation actually revokes

One staging transaction, one JWT switched mid-flight, three measurements:

```
BEFORE   sales1 sees   leads 3   inventory 5   roster 7   tenants 1
         owner revokes sales1 ->
             {"removed_role":"sales","leads_still_assigned":1,"auth_account_deleted":false}
AFTER    sales1 sees   leads 0   inventory 0   roster 0   tenants 0
CONTROL  owner still sees leads 3   -- in the same transaction, so the zeros are the revocation
```

Deleting the `tenant_members` row empties `nexus_current_tenant_ids()`, and every
tenant-scoped policy in the database then filters that session to nothing. It does
**not** delete the Supabase Auth login and does **not** reassign the departed
person's leads — the function returns `leads_still_assigned` so a screen can say
so rather than implying a clean hand-over.

---

## 9 · Everything that could not be tested, and why

| cell | verdict | why |
|---|---|---|
| a member of the **other dealership**, against **production** | **BLOCKED** | production has one active dealership (`alba-cars`) plus the `__unattributed__` quarantine tenant, which has no members and cannot have one. A second dealership member cannot exist there without creating a tenant and a login on the live project. **Covered on staging**, both directions, real signed-in sessions. |
| the **production** matrix through a **real signed-in session** | **NOT RUN** | production's single login is Ali's and this pass did not have, ask for, or use his password. The production matrix is the **SQL arm only** — `set_config` inside an aborted transaction — and is labelled the weaker witness everywhere it appears. |
| **TRUNCATE over the REST path** | **NOT APPLICABLE** | PostgREST exposes no TRUNCATE verb. Measured in SQL on both projects (§5). It is not a gap in coverage; there is no HTTP request that could express it. |
| the **frontend's** own gating (disabled buttons, hidden Delete) | **NOT RUN — out of scope here** | this item is "is it enforced by the database". The database refuses regardless of what the UI shows, which is the point; the shipped-vs-working-tree bundle question is `rbac-evidence.md` §8 item 2 and is still open. |
| `recompute_inventory_derived()` reachable by every role | **NOT RUN** | inherited open item (`rbac-evidence.md` §8 item 6). It recomputes derived values only, so it is not an escalation, but it was not exercised in this pass. |

---

## 10 · Defects found

1. **A refused cost-price change is not recorded anywhere.** `NX001` raises before
   the audit insert, so the database keeps a perfect record of cost changes that
   *succeeded* and no record at all of ones it *refused*. Measured (§7). A
   dealership cannot answer "who has been trying to change our cost prices".
   Low severity, trivially fixable, **not fixed here** — the brief asks that the
   fix and the proof not be the same hand.

2. **A `service_role` cost-price change writes no audit row either.** Measured
   (SR3b, §6). n8n holds `service_role`. Combined with (1), the audit trail on
   cost prices covers exactly one caller class: a signed-in person whose change
   was accepted. Reported, not fixed.

3. **The strongest available lock on `cost_aed` and on `inventory` DELETE is
   still not shipped.** Not new — `rbac-evidence.md` §8 item 1 — but it is the
   thing that makes two rows of §4 read `NX001` and `0 rows` instead of `42501`,
   and it is now re-measured as still true on both projects. The blocker is a
   dashboard deploy, not a migration.

Nothing in this pass weakened a check, and no check was converted from NOT RUN to
PASS by lowering a bar.

---

## 11 · What was left on each project

**Production `dsvuoovivysszdoiorch` — nothing.** Before and after, identical:

```
inventory 12   leads 3   tenant_members 1   audit_log 770
Ali's role  owner (unchanged)
NX-1002     312000 / 278000 (unchanged)
leads       34:DISQUALIFIED:9941a4db…  35:DISQUALIFIED:null  38:WARM:null
rows named RBACPROD%   0
```

Every production statement ran inside a transaction ending in an unconditional
`RAISE EXCEPTION`. No user, membership, vehicle, lead or audit row was created,
changed or deleted.

**Staging `wwspuxrbiyagnrnzgate` — restored, with two deliberate exceptions.**

```
inventory 35 (= baseline)   leads 28 (= baseline)   tenant_members 12 (= baseline)
ALPHA-002  80000 / 70000 (= baseline)
leads 1/8/9 status, assignee and budget all = baseline
rows named RBAC%   0    (probe and delete-target units all removed)
audit_log  29 -> 33
```

1. **Four `audit_log` rows kept** — the real cost-change records the REST arm
   produced (§7). Deleting an audit row to tidy up would be worse than keeping it.
2. **Four staging logins gained a password**, so the six-role matrix could be run
   through real sign-ins rather than only through `set_config`. This extends
   §2.1 of `B1-B4-evidence-2026-09-06.md` and uses **the same password** it
   recorded, `GatePw-ADIAZ3yf8bCwHxNj`, on `.invalid` accounts that exist on no
   other project:

   | account | dealership | role |
   |---|---|---|
   | `admin@alpha.staging.invalid` | Alpha | admin |
   | `sales1@alpha.staging.invalid` | Alpha | sales |
   | `sales2@alpha.staging.invalid` | Alpha | sales |
   | `tech@alpha.staging.invalid` | Alpha | technician |

   No production credential and no password belonging to Ali was read, used or
   created. To undo:

   ```sql
   delete from auth.identities
    where email in ('admin@alpha.staging.invalid','sales1@alpha.staging.invalid',
                    'sales2@alpha.staging.invalid','tech@alpha.staging.invalid');
   update auth.users set encrypted_password = null
    where email in ('admin@alpha.staging.invalid','sales1@alpha.staging.invalid',
                    'sales2@alpha.staging.invalid','tech@alpha.staging.invalid');
   ```

3. A helper function `public.zz_rbac_probe(text[][])` was created on staging to
   carry the SQL arm, granted to nobody (`postgres=X | service_role=X`, `anon`,
   `authenticated` and PUBLIC revoked immediately per CLAUDE.md's rule), and
   **dropped**. Verified gone: 0 rows in `pg_proc`. It was never created on
   production.

No git command was run. The n8n box was not contacted.
