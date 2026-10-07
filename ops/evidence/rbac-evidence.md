# STAGE 1.7 — a role model for `inventory` and `leads`

5 September 2026. Branch `wip/platform-truth-2026-09-01`. Nothing here was committed;
no git command was run. The n8n box was not touched.

- staging   `wwspuxrbiyagnrnzgate`  (2 synthetic tenants — where every control was built and broken first)
- production `dsvuoovivysszdoiorch` (Tenant A — live)

---

## 1. What was measured before anything was changed

### Who actually uses this system

This is the fact that governed every decision below, and it was not what the brief assumed.

```
auth.users            -> 1 row   aliasgher892@gmail.com, last sign-in 2026-09-03 16:53 UTC
public.tenant_members -> 1 row   tenant fff6a2b5 (alba-cars), role = 'owner',
                                 staff_user_id -> public.users 9941a4db (Ali Asgher)
public.users          -> 1 row   Ali Asgher, role = 'senior_rep', status online
```

**There is no junior sales rep. There is one login and it belongs to the owner.**

So the defect — "a junior rep can change cost price and delete a vehicle" — is real in the
privileges and **unreachable by anybody today**. That does not make it not worth fixing; it
makes it worth fixing *before the second login exists*, and it means the cost of breaking
Ali's screens while fixing it would have been paid immediately and the benefit not at all.
That trade decided §4.

### The privileges, before

```
inventory  relacl  authenticated=arwd     policy inventory_authenticated_all  ALL  tenant-scoped only
leads      relacl  authenticated=rw       policy leads_authenticated_all      ALL  tenant-scoped only
```

No column-level grants on either table. `polcmd = '*'`. The only qualifier anywhere is the
dealership, so every tenant member held every verb the grant allowed.

### Where authority already lives, and it was not invented here

`supabase/migrations/20260902181312_action_02_approval_authority.sql` had already settled
this question for the Action Center, and this lane follows it rather than inventing a
parallel model:

- **`public.tenant_members.role`** — ACCOUNT AUTHORITY. Already existed, already
  constrained to `owner | admin | manager | member`, default `member`.
- **`public.users.role`** — JOB TITLE. Free text (`senior_rep`), and deliberately grants
  nothing. `inventory_action_policy.approver_staff_roles` starts empty for exactly this
  reason.

So the mechanism was extension of an existing column, not a new one.

### The defect, executed rather than inferred (staging, rolled back)

As role `authenticated` with a real JWT `sub`, in a transaction ending in `RAISE`:

```
sales      UPDATE inventory.cost_aed                 NO ERROR, 1 row
sales      UPDATE inventory.price_aed                NO ERROR, 1 row
sales      DELETE inventory (unit with no dependents) NO ERROR, 1 row
sales      reassign ANOTHER rep's lead               NO ERROR, 1 row
technician UPDATE inventory cost AND price           NO ERROR, 1 row
technician UPDATE leads.status AND leads.ai_score    NO ERROR, 1 row
```

One correction to the audit's wording. A DELETE of a unit that *did* carry an
`inventory_actions` row failed `23503` on `inventory_actions_unit_fkey`. That is an
**incidental lock, not a control** — it protects only units somebody has already proposed an
action against. A unit with no action history deleted cleanly, which is why a second staging
unit (`ALPHA-002`) had to be created to measure the verb honestly.

`technician UPDATE leads.ai_score` is worth naming on its own: `ai_score` is the router's and
`response_time_minutes` is written by `nexus_mark_first_response` and is the **only** input to
`within_sla`/`breached_sla` on Team Performance. Any signed-in user could type over both —
one figure, two derivations, arriving through a privilege nobody meant to grant.

---

## 2. The model

Vocabulary extended on `tenant_members.role`: `owner | admin | manager | sales | technician | member`.

| | inventory: add | inventory: edit (incl. asking price) | inventory: **cost price** | inventory: delete | leads: edit | leads: **reassign** |
|---|---|---|---|---|---|---|
| owner / admin | yes | yes | **yes** | **yes** | any lead | yes |
| manager | no | yes | no | no | any lead | yes |
| sales | no | no | no | no | **only their own** | no |
| technician | no | no | no | no | no | no |
| member (default) | no | no | no | no | only their own | no |

`member` was the *ceiling* and is now the *floor*. Nobody in production holds it, so this
takes nothing from a live user — but a member added later without an explicit role now lands
on the floor, which is the direction a default should fail in.

**Manager cannot INSERT a vehicle, and that is deliberate.** Adding a vehicle necessarily
states what it cost. Had a manager been able to INSERT, "a manager may not set cost price"
would have been true of UPDATE and false of the easier path.

### Three mechanisms, each doing the job it is actually good at

**Column-level GRANT** — *which columns any dashboard user may write at all.* A GRANT is per
database role and every signed-in user is `authenticated`, so it cannot tell an owner from a
rep; what it can do is set a ceiling nobody clears, and it fails `42501` before RLS is
consulted. Used for the machine-owned columns. This is the `channel_registry` /
`credential_ref` pattern.

**RESTRICTIVE RLS** — *who may write a row at all.* Reads `tenant_members.role` through a new
`nexus_tenant_ids_for_roles(text[])`, the same shape as `nexus_current_tenant_ids()`.
RESTRICTIVE, so it intersects with the existing tenant scoping — the dealership boundary
proven on 2 September is untouched and still has to pass.

**A BEFORE UPDATE trigger** — *whether a figure MOVED.* This is the one thing neither of the
others can ask, and §4 explains why it had to be asked.

### Final privilege state (identical on both projects)

```
inventory  relacl  authenticated=rd
           attacl  id, model, vin, status, acquired_at, price_aed, ai_recommendation = aw
                   cost_aed = aw   (see §4 — the trigger is the lock here, not the ACL)
                   tenant_id = a   (insert only; a row cannot be moved between dealerships)
                   days_in_stock, gross_margin, vat_amount, holding_cost_accrued,
                   net_margin, recommended_commission, aging_alert = NO GRANT

leads      relacl  authenticated=r
           attacl  name, email, phone, status, vehicle_interest, budget_aed,
                   assigned_to, assigned_to_id = w
                   id, source, ai_score, response_time_minutes, created_at,
                   escalated_at, bitrix_lead_id, crm_synced_at, tenant_id = NO GRANT
```

**`relacl` alone is now a misleading witness on these two tables, in both directions**, and
anyone re-running the ACL query in `CLAUDE.md` must read `pg_attribute.attacl` too. On
`leads` it reads `authenticated=r` — "read-only" — while eight columns are writable. On
`inventory` it reads `rd`, which understates the column grants and *overstates* what can
be done to `cost_aed`.

---

## 3. Proofs

Every probe ran inside a transaction that ended in `RAISE EXCEPTION`, so nothing persisted.
No fake production user was created; no production row was left changed.

### 3a. Staging, after the fix (real roles, real JWT subs)

```
S1  sales      UPDATE inventory.cost_aed              42501  permission denied for table inventory
S2  sales      UPDATE inventory.price_aed             0 rows (RLS filtered)
S3  sales      DELETE inventory                       42501  permission denied for table inventory
S4  sales      rpc inventory_delete_unit              NX001  You may not delete this vehicle.
S5  sales      rpc inventory_set_cost                 NX001  You may not change the cost price of this vehicle.
S6  sales      reassign ANOTHER rep's lead #9         0 rows (RLS USING filtered)
S7  sales      give away their OWN lead #8            42501  new row violates RLS policy "leads_role_update"
S8  sales      UPDATE leads.ai_score on own lead      42501  permission denied for table leads
S9  sales      DAY JOB own lead status + phone        1 row
S10 sales      DAY JOB SELECT inventory               2 rows visible
S11 sales      DAY JOB SELECT leads                   3 rows visible

T1  technician UPDATE inventory.cost_aed              42501
T2  technician UPDATE inventory.price_aed             0 rows (RLS filtered)
T3  technician UPDATE leads.status                    0 rows (RLS filtered)
T4  technician DAY JOB SELECT inventory               2 rows visible

M1  manager    DAY JOB UPDATE asking price            1 row
M2  manager    UPDATE inventory.cost_aed              42501
M3  manager    rpc inventory_set_cost                 NX001
M4  manager    rpc inventory_delete_unit              NX001
M5  manager    INSERT a vehicle                       42501  new row violates RLS policy "inventory_role_insert"
M6  manager    DAY JOB reassign any lead              1 row

O1  owner      DAY JOB UPDATE asking price            1 row
O2  owner      DAY JOB rpc set_cost                   cost_aed now 91234
O3  owner      DAY JOB INSERT a vehicle               ok
O4  owner      delete a unit WITH action history      NX001  ALPHA-001 has 1 recommendation(s) on file
O5  owner      DAY JOB delete a clean unit            ok, 0 rows left
O6  owner      DAY JOB reassign any lead              1 row
A1  admin      DAY JOB rpc set_cost                   ok

X1  bravo owner rpc set_cost on an ALPHA unit         NX001   (cross-tenant)
X2  bravo owner rpc delete an ALPHA unit              NX001   (cross-tenant)
X3  bravo owner reassign an ALPHA lead                0 rows  (tenant RLS held)

MB1 member     UPDATE inventory.price_aed             0 rows (RLS filtered)
MB2 member     UPDATE inventory.cost_aed              0 rows (RLS filtered)
MB3 member     UPDATE another rep's lead              0 rows (RLS filtered)
UL1 sales with staff_user_id = NULL, own lead         0 rows — fail closed

SR1 service_role UPDATE cost + price                  1 row   (n8n intact)
SR2 service_role UPDATE ai_score + response_time      1 row   (n8n intact)
SR3 service_role INSERT a lead                        ok      (the router intact)
SR4 service_role DELETE inventory                     1 row   (n8n intact)
AN1 anon SELECT inventory                             42501  permission denied for schema public
AU1 audit row after set_cost                          "cost_aed on ALPHA-001 changed from 95000 to 88888 by auth user aaaa…a001 -- audit trail probe"
```

**S7 is the case that would have been missed.** The USING half alone stops a rep *taking*
someone else's lead. It does not stop a rep *giving away* their own — to a colleague, or to
nobody. The predicate is in WITH CHECK as well, which is the difference between "may not
take" and "may not give".

### 3b. Production, after applying (all rolled back)

The live user's day job, using Ali's real `auth.uid()`:

```
P1 owner  VEHICLE FORM SAVE, cost unchanged   1 row
P2 owner  FORM SAVE moving BOTH prices        1 row, audit row written
P3 owner  DELETE a vehicle (shipped button)   1 row
P4 owner  ADD a vehicle                       ok
P5 owner  LEAD DRAWER assign owner            1 row
P6 owner  rpc inventory_set_cost              ok
P7 owner  SELECT inventory                    12 rows
P8 owner  SELECT leads                        3 rows
```

**Nothing Ali can do today has been taken away.**

The controls are live on production and not only on staging. A signed-in account with no
`tenant_members` row — what a new login looks like before anyone gives it a role. **No user
was created:**

```
Q1 no-role UPDATE price_aed             0 rows (RLS filtered)
Q2 no-role UPDATE cost_aed              0 rows (RLS filtered)
Q3 no-role rpc set_cost                 NX001
Q4 no-role rpc delete_unit              NX001
Q5 no-role unassign Ali's lead #34      0 rows (RLS filtered)
Q6 owner   UPDATE leads.ai_score        42501  permission denied for table leads
Q7 owner   UPDATE inventory.gross_margin 42501 permission denied for table inventory
```

And the gradation itself, exercised on the real database by temporarily relabelling the ONE
existing membership row inside the aborted transaction (no user created, nothing persisted):

```
R1  as sales      FORM SAVE moving cost       0 rows, cost_aed still 342000 (RLS filtered first)
R2  as sales      UPDATE asking price         0 rows (RLS filtered)
R3  as sales      DELETE a vehicle            0 rows (RLS filtered)
R4  as sales      give away OWN lead #34      42501  new row violates RLS policy "leads_role_update"
R5  as sales      DAY JOB own lead status     1 row
R6  as manager    FORM SAVE, cost unchanged   1 row
R7  as manager    FORM SAVE moving cost       NX001  You may not change the cost price of a vehicle.
R8  as manager    DAY JOB reassign a lead     1 row
R9  as technician FORM SAVE                   0 rows (RLS filtered)
R10 as technician UPDATE any lead             0 rows (RLS filtered)
R11 as technician SELECT inventory            12 rows — day job intact
```

R1 was first recorded as "NO ERROR" because that probe did not capture `row_count`. Re-run
with the count: **0 rows, cost unchanged.** RLS filtered the row before the trigger could
see it. Recorded because "NO ERROR" without a row count is not a result.

Production afterwards: 12 units, 3 leads, 0 RBAC audit rows, membership still
`owner=aliasgher892@gmail.com`, `NX-1001.cost_aed` still 342000, lead #34 still Ali's.

### 3c. Which lock stopped what — stated exactly

| refusal | the lock | evidence shape |
|---|---|---|
| any role writing a derived/machine column | **GRANT** | `42501` |
| sales/technician writing `leads.ai_score`, `response_time_minutes` | **GRANT** | `42501` |
| sales/technician/member touching an inventory row | **RLS** | 0 rows |
| sales touching another rep's lead | **RLS USING** | 0 rows |
| sales giving away their own lead | **RLS WITH CHECK** | `42501` |
| manager INSERTing a vehicle | **RLS WITH CHECK** | `42501` |
| manager/owner-less caller MOVING cost price | **trigger** | `NX001` |
| any non-owner/admin via the RPCs | **function authority check** | `NX001` |

0 rows is evidence about RLS and never about a privilege. That distinction is kept
throughout and no 0-row result is described as "refused by grant".

---

## 4. The one place the strongest lock was NOT shipped, and why

`rbac_02` withheld `UPDATE(cost_aed)` and `DELETE` from `authenticated` outright. It works —
staging proved `42501` on both. **It would also have taken the vehicle form away from the
only person who uses this product.**

`lib/unit-form.js` builds one object and PATCHes all of it, and `unitRow()` always included
`cost_aed`. Confirmed in the **deployed** bundle `dist/assets/main-DSw77Uwd.js`, not just in
source. PostgREST names every column in the body, so with no UPDATE privilege on `cost_aed`
**every "Save changes" returns 42501** — and the fixed bundle reaches production by a deploy
this session cannot perform.

Closing a hole that no one can currently reach (there is no second login) at the price of a
screen the one real user needs today is a bad trade, and `CLAUDE.md` says so: *a defect that
cannot reach a customer is not urgent.*

`rbac_05` restores the two grants and moves the rule to a trigger, which sees OLD and NEW and
can ask the question a GRANT cannot: not "may you name this column" but **"are you changing
this figure"**. An unchanged cost is not a cost change and passes. A moved cost is refused
unless the caller is owner/admin.

The trade, stated plainly:

- **Lost** — a privilege check is absolute and runs before any policy. A trigger is code and
  can be dropped, replaced, or wrong. `authenticated` again holds `UPDATE` on `cost_aed`.
- **Kept** — the rule is still in the database, on every path, for every client. PostgREST
  with a raw JWT hits the same trigger the dashboard does. Hiding a button is still not the
  control.
- **Gained** — an audit row on **every** cost change by a person, naming the old figure, the
  new figure and the auth user. The column grant bought none of that, and the direct UPDATE
  it replaced left no trace at all. **Until today nothing in this database recorded that a
  cost price had ever moved.**

`DELETE` likewise keeps its grant and is left to the RESTRICTIVE policy, so the owner's
existing delete button still works. A rep's DELETE is filtered to 0 rows, not `42501` — the
dashboard's delete path is moved to `inventory_delete_unit()`, which refuses by name.

**When the stronger lock can come back:** once a dashboard build that omits `cost_aed` from
the PATCH body is *deployed*, re-run `rbac_02`'s two narrowing statements. Nothing in
`rbac_05` has to be undone first. The build in this working tree is that build.

### service_role is deliberately not gated by the trigger

n8n holds `service_role`, which is `BYPASSRLS` and writes these tables directly; a check
there would be theatre. Measured clean (`N1`): `role=service_role`, no JWT claims,
`UPDATE cost_aed` → 1 row.

One property found while measuring and recorded rather than hidden: **a caller presenting
`service_role` AND a user JWT carrying a `sub` is treated as that user.** It surfaced as a
false alarm in one probe whose leftover claims came from an earlier case. n8n presents no
`sub`, so this is not reachable today — but it is the behaviour, and a future service caller
that forwards an end-user JWT would be judged by that user's role.

---

## 5. What was assigned to real production members

**Exactly one row exists, and nothing about it was changed:**

| auth user | tenant | role before | role after | basis |
|---|---|---|---|---|
| `aliasgher892@gmail.com` (`21460dfd…`) | `alba-cars` | `owner` | **`owner`** — unchanged | It was already `owner`, set 2026-09-02, and it is the account that owns the Supabase project and the only one that has ever signed in. |

**No role was invented, no membership row was created, updated or deleted in production.**
The conservative rule in the brief — "the account that is provably the owner gets owner;
everyone else gets the highest role that removes destructive and cost-price ability" — had no
"everyone else" to apply to.

**Ali must still review this**, and the thing to review is not the row, it is the *next* one:
the first colleague given a login inherits `member` from the column default, which after this
work means "your own leads only, read-only on vehicles". If that person is a sales manager,
their role has to be set explicitly or they will be unable to do their job; if they are a
junior rep, the default is already right. Changing an assignment is one statement:

```sql
update public.tenant_members set role = 'manager'
 where auth_user_id = '<auth.users.id>' and tenant_id = '<tenant>';
```

`public.users.role` (`senior_rep`) was **not** touched and still confers nothing.

---

## 6. Frontend

The database refuses correctly; a button that produces a 403 is still a bug. Role is read
from **the same source of truth the policies read** — `public.tenant_members` — not from
`users.role`.

- `lib/data.js` — `MEMBERSHIP` state plus `myRole()`, `myStaffId()` and the five predicates
  `canSetCost / canDeleteUnit / canAddUnit / canEditUnit / canReassignLead`. Each mirrors one
  migration and is named against it. `MEMBERSHIP` is cleared when the signed-in identity
  changes, on the documented re-auth-without-reload path.
- `app.js` — reads `tenant_members?select=tenant_id,role,staff_user_id` at boot (proven live:
  returns Ali's `owner` row). The header now shows job title **and** account role, because
  the account role is the one that explains a refused action.
- `lib/unit-form.js` — cost field disabled with a reason for non-owner/admin; Delete button
  hidden; Save disabled with a reason when the role cannot write; delete moved to
  `rpc/inventory_delete_unit`; **`cost_aed` omitted from the PATCH body** when the user may
  not set it.
- `screens/inventory.js` — "Add vehicle" hidden for non-owner/admin; drawer Edit disabled
  with a role-specific sentence, kept distinct from the existing `recErr` reason.
- `screens/competitors.js` — "Adjust our list price" disabled for non-managers.
- `lib/lead-drawer.js` — "Assign to…" disabled with a reason, and `assignDialog()` refuses on
  entry as a second lock.

**Unknown is not "no".** Every predicate returns **true** when the membership read failed, so
a failed read shows the action and lets the database answer. Hiding a control on a failed
read would tell an owner they are not one — the same distinction `ME_READ_FAILED` already
exists to preserve.

The gate is centralised in `unitForm()` rather than at each of the four call sites, because
gating four call sites separately is how one gets missed.

### Build

```
$ npm run build      (apps/executive-dashboard)
vite v5.4.21 building for production
✓ 87 modules transformed
dist/assets/main-BIOrAbIg.js   1,367.94 kB │ gzip: 402.00 kB
✓ built in 2.83s
```

(The quality-gate run below builds again, so the bundle in `dist/` is now
`main-13MVsCaD.js` — same source, rebuilt. Both were checked.)

**PASS.** Two warnings, both pre-existing and unrelated (a dynamic-import note on
`lib/data.js`, and the >500 kB chunk size). Verified in the built bundle (`main-13MVsCaD.js`, and in
`main-BIOrAbIg.js` before the gate rebuilt it): `unitRow` no longer carries `cost_aed`
unconditionally; `rpc/inventory_delete_unit` and the `tenant_members` boot read are both
present. The bundle this replaces, `main-DSw77Uwd.js`, is the one §4 measured.

```
$ node QUALITY_GATE.mjs
PASS 17   FAIL 0   WARN 2   NOT RUN 15
```

**No existing check was weakened and none newly fails.** S2 (helper-contract lint) and S4 (no
browser-side tenant scoping) still pass with these edits. The 15 NOT RUN are the live-database
lane, which needs `NEXUS_DB_URL` or a dumped catalogue; **they are NOT RUN, not PASS.**

`get_advisors(security)` on production: **no ERROR-level lint.** The three new functions
appear under `authenticated_security_definer_function_executable` at WARN, alongside the
twenty-odd existing `rpc/*` functions in the same class.

Read from the gate's own source rather than run: **L4** is the one live check these functions
could trip — it fails a SECURITY DEFINER function granted to `authenticated` that takes a
`p_tenant` argument or whose write statements carry no `tenant_id` predicate within 900
characters. Neither new function takes a tenant argument, and all four of their write
statements carry `tenant_id`. **That is analysis, not a measurement — L4 remains NOT RUN.**

---

## 7. Migrations — the file gate

Applied with `mcp__Supabase__apply_migration`, read back from PRODUCTION
`supabase_migrations.schema_migrations`, written byte-exactly with no trailing newline.

| version | name | md5 (db == file) | bytes |
|---|---|---|---|
| 20260905201401 | `rbac_01_staff_role_vocabulary_and_helpers` | `e37649fc125fecfd81659e8efa6d208a` | 6476 |
| 20260905201429 | `rbac_02_inventory_writes_by_role` | `8ec358a5bbd10f727dea21620b8795f7` | 5692 |
| 20260905201507 | `rbac_03_inventory_cost_and_deletion_are_named_acts` | `17705b1f78d8834ccd6e4b0cab914b70` | 8380 |
| 20260905201532 | `rbac_04_leads_writes_by_role` | `afcac5d62f0f6274e728298fc14532d6` | 5499 |
| 20260905201606 | `rbac_05_the_cost_lock_that_does_not_take_the_form_away` | `0b5706d4e9f4ecafd12cbeb40366a7d0` | 7183 |

All five verified: `md5sum` of the file equals the recorded `md5(statements[1])`, one
statement each, last byte `;`. **Gate passed.**

### Staging / production parity

A fingerprint over all 37 objects this lane touches — both `relacl`s, every `attacl`, every
policy including its full USING and WITH CHECK text, the trigger, the semantic hash of all
five function bodies, and both CHECK constraints:

```
staging     7f2c28393281013369e6136e557697ff  (37 rows)
production  7f2c28393281013369e6136e557697ff  (37 rows)
```

**Identical.** One cosmetic divergence in the ledger only: staging's stored `rbac_02` text is
5691 bytes to production's 5692 — the trailing `;` was dropped when it was pasted to staging.
Same statement, same effect, and the repo file matches **production**.

---

## 8. Still open

1. **The stronger cost lock is staged but not shipped.** `rbac_02`'s narrowing of
   `UPDATE(cost_aed)` and `DELETE` is proven on staging and then deliberately reversed by
   `rbac_05`. Re-apply those two statements **in the same release as the rebuilt dashboard**
   — not before, or Ali's vehicle form breaks. The build in this tree is the one that makes
   it safe.
2. **The frontend is in the working tree, not deployed.** No git command was run and the push
   cannot happen from this session. Until Ali deploys, the live dashboard still shows a
   Delete button and an editable cost field to whoever signs in — which is nobody but him,
   and the database refuses regardless.
3. **`tenant_members` has no product surface.** There is no screen to add a colleague or set
   their role; it is a manual `UPDATE`. That is the next thing that matters, because the
   whole model above is inert until a second person has a login.
4. **`staff_user_id` is nullable and unenforced.** A sales login not linked to a
   `public.users` row can edit no leads at all (proved, `UL1`). Fail-closed and correct, but
   it will present as "the product is broken" rather than "your account is not linked".
5. **`service_role` bypasses all of this**, by design and by necessity. n8n can still change
   any cost and delete any vehicle with no role check and no audit row. The disciplined door
   is the one a person comes through; the n8n key is not a person.
6. **`recompute_inventory_derived()` is callable by any signed-in user of any role**,
   including technician. It only recomputes derived values from data already present and
   introduces no new information, so it is not an escalation — recorded because it is a
   `SECURITY DEFINER` write path reachable by every role and nobody had noted that.
7. **15 quality-gate checks are NOT RUN**, including L2/L4/L5. Not converted to PASS.
8. **Staging carries synthetic fixtures created for this work** and left in place for
   regression: auth users `…a003`–`…a007` (manager/sales1/sales2/technician/admin at
   `staging-alpha`, all `@*.staging.invalid`), matching `public.users` `…a3`–`…a7`, their
   `tenant_members` rows, leads #8/#9, and inventory unit `ALPHA-002`. **Production received
   none of this.**
9. **Another session was writing to staging concurrently** during this work (a third tenant
   and a `QPROBE` lead appeared mid-run, and a production migration landed at 20260905201337
   from another lane). It did not touch `staging-alpha`/`staging-bravo` and none of the
   results above depend on it, but staging is not a quiet room right now.
