# TEAM & ACCESS — a role model a dealership can actually use, and its own consent record

6 September 2026. Nothing was committed; **no git command was run.** The n8n box
(35.224.126.225) was not touched.

- staging    `wwspuxrbiyagnrnzgate`  (staging-alpha, 7 logins; staging-bravo, 2)
- production `dsvuoovivysszdoiorch`  (ALBA CARS — live, one login)

---

## 0. The gap this closes, in one line

Last night's pass built a real role model — `owner | admin | manager | sales |
technician | member`, enforced by column grants, RESTRICTIVE RLS and a trigger,
proved against 37 adversarial cases — and its own closing note was that
**`tenant_members` has no product surface**, so the model is inert until a second
person has a login. Today a dealership can add a colleague, see who has access,
change a role, link a login to a staff record, and **take access away**.

That last one is not a nicety. A dealership that cannot revoke a departed
employee's access does not pass its own procurement review, and it is the thing
that is now measured end to end (§3d).

---

## 1. What was measured before anything was changed

### It could not even LOOK

```
tenant_members   relacl  authenticated=r     attacl (none)
                 policy  tenant_members_self_read  SELECT  authenticated
                         USING (auth_user_id = auth.uid())
auth.users               not readable by `authenticated` at all
whatsapp_opt_in_event  relacl  postgres | service_role       -- no end-user grant
                 policy  whatsapp_opt_in_event_deny_end_users  RESTRICTIVE
                         ALL  authenticated, anon  USING (false) WITH CHECK (false)
```

So a signed-in **owner** reads exactly **one** `tenant_members` row — their own.
The roster of colleagues is not filtered down to something small; it is
structurally unreadable. And a dealership gets **42501** on its own consent
record (re-measured today, both projects).

### Live shape

| | staging-alpha | staging-bravo | production |
|---|---|---|---|
| members | 7 | 2 | **1** (`aliasgher892@gmail.com`, `owner`) |
| `auth.users` | 7 | 2 | 1 |
| `public.users` | 7 | 2 | 1 |
| `whatsapp_opt_in_event` | 0 | 0 | **0** |
| Edge Functions deployed | — | — | **0** |

### Where authority already lives — not invented here

`nexus_tenant_ids_for_roles(text[])` (rbac_01) and
`nexus_current_tenant_ids()` are the two keys every policy in this database
already uses. Every function below reads one of them and **none takes a tenant
argument**. `action_approver_context()` is unchanged and remains the authority on
the caller's own approval answer.

---

## 2. What was built

### Five migrations, applied to staging first, then production

| version | name | md5 (db == file) | bytes |
|---|---|---|---|
| 20260906061806 | `team_01_a_dealership_can_see_who_has_access` | `faeb9000e4c327b8816e9d939420edfd` | 6337 |
| 20260906061916 | `team_02_pending_membership_applied_at_first_sign_in` | `9c5bb5051466b4c0e58c50032d923b9f` | 19753 |
| 20260906062019 | `team_03_changing_and_revoking_access_are_named_acts` | `8d4baa85f8c6084591970c7ce9811ed2` | 16652 |
| 20260906062049 | `team_04_a_dealership_can_see_its_own_consent_state` | `bb05c132cba251a8dfb49f07b4506f92` | 6735 |
| 20260906062139 | `team_05_the_last_owner_guard_had_to_be_made_reachable` | `50596ed0fe78cf2bd2d6a4e5de17acbb` | 12647 |

All five read back from **production** `supabase_migrations.schema_migrations`,
written byte-exactly to `supabase/migrations/<version>_<name>.sql` with **no
trailing newline**; `md5sum` of each file equals the recorded `md5(statements[1])`
and the byte counts match. **Gate passed on all five.**

### Nine functions and one table

| object | kind | who may execute |
|---|---|---|
| `nexus_team_roster()` | SECURITY DEFINER, STABLE | `authenticated`, `service_role` |
| `nexus_team_pending()` | SECURITY DEFINER, STABLE | `authenticated`, `service_role` |
| `nexus_team_invite(text,text,uuid)` | SECURITY DEFINER | `authenticated`, `service_role` |
| `nexus_team_cancel_invite(text)` | SECURITY DEFINER | `authenticated`, `service_role` |
| `nexus_team_set_role(uuid,text)` | SECURITY DEFINER | `authenticated`, `service_role` |
| `nexus_team_link_staff(uuid,uuid)` | SECURITY DEFINER | `authenticated`, `service_role` |
| `nexus_team_revoke_access(uuid)` | SECURITY DEFINER | `authenticated`, `service_role` |
| `nexus_whatsapp_consent_events(int)` | SECURITY DEFINER, STABLE | `authenticated`, `service_role` |
| `nexus_whatsapp_consent_current()` | SECURITY DEFINER, STABLE | `authenticated`, `service_role` |
| `nexus_claim_pending_membership()` | SECURITY DEFINER trigger fn | **`service_role` only** (`anon`, `authenticated`, PUBLIC revoked) |
| `tenant_member_invite` | table | **no end-user grant at all** |

**Nothing was widened.** `tenant_members` still carries `authenticated=r` and
still has only the self-read policy; `whatsapp_opt_in_event` still refuses
`authenticated` by grant *and* by its RESTRICTIVE floor. The precedent followed
is `nexus_workflow_catalogue()` from this morning: when what a dealership is
entitled to is a **projection** of a table rather than the table, the projection
is the grant, and a column that is not in the function's result type is absent by
construction rather than by whichever grant nobody revoked.

### ACL check, per object, both projects (CLAUDE.md's rule)

```
tenant_member_invite   relacl  postgres=arwdDxtm | service_role=arwdDxtm
                       attacl  (no column-level ACL)
                       anon SELECT false | authenticated SELECT false
                       authenticated any-column SELECT false
                       authenticated INSERT/DELETE/TRUNCATE false
every new function     proacl  postgres=X | authenticated=X | service_role=X
nexus_claim_pending_membership  proacl  postgres=X | service_role=X
```

The corrected write-grant sweep from `CLAUDE.md` (all four verbs, table AND
column level, sequences split out) returns **exactly the four known deliberate
rows** on staging — `inventory` DELETE/INSERT/UPDATE and `leads` UPDATE — and
nothing new. `get_advisors(security)` on production: **no ERROR-level lint**; the
nine new functions appear under `authenticated_security_definer_function_executable`
at WARN alongside the ~25 existing `rpc/*` functions in the same class.

---

## 3. Adversarial proofs

Every probe below ran inside a transaction ending in `ROLLBACK`. **Nothing
persisted on either project.** Roles were assumed with
`set local role authenticated` plus a real `request.jwt.claims.sub`, which is
what a signed-in dashboard session is.

### 3a. Staging refusals, as each of the five test logins

| # | actor | act | result |
|---|---|---|---|
| **X1** | **sales (a004)** | **`set_role(SELF, 'owner')`** | **`NX001` / `NX_TEAM_ROLE_CHANGE_REFUSED`** |
| X2 | sales (a004) | `set_role(sales2, 'admin')` | `NX001` / `NX_TEAM_ROLE_CHANGE_REFUSED` |
| X3 | sales (a004) | `revoke_access(owner)` | `NX001` / `NX_TEAM_REVOKE_REFUSED` |
| X4 | sales (a004) | `invite('newrep@…','manager')` | `NX001` / `NX_TEAM_INVITE_REFUSED` |
| X5 | sales (a004) | `link_staff(sales2, null)` | `NX001` / `NX_TEAM_LINK_REFUSED` |
| X6 | technician (a006) | `set_role(sales1, 'manager')` | `NX001` / `NX_TEAM_ROLE_CHANGE_REFUSED` |
| X7 | member (a002) | `revoke_access(sales1)` | `NX001` / `NX_TEAM_REVOKE_REFUSED` |
| X8 | manager (a003) | `revoke_access(sales1)` | `NX001` / `NX_TEAM_REVOKE_REFUSED` |
| X9 | **admin (a007)** | **`set_role(SELF, 'owner')`** | **`NX001` / `NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY`** |
| X10 | admin (a007) | `revoke_access(owner)` | `NX001` / `NX_TEAM_OWNER_REVOKE_IS_OWNER_ONLY` |
| X11 | admin (a007) | `invite(x, 'owner')` | `NX001` / `NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY` |
| X12 | **bravo owner (b001)** | **`set_role(alpha sales1, 'member')`** | **`NX001` / `NX_TEAM_ROLE_CHANGE_REFUSED`** (cross-tenant) |
| X13 | alpha owner | `invite('SALES1@alpha…')` — already a member | `NX001` / `NX_TEAM_ALREADY_A_MEMBER` (case-insensitive) |
| X14 | alpha owner (sole) | `set_role(SELF, 'admin')` | `NX001` / `NX_TEAM_LAST_OWNER` |
| X15 | alpha owner (sole) | `revoke_access(SELF)` | `NX001` / `NX_TEAM_LAST_OWNER` |
| G1 | `authenticated` | `select count(*) from tenant_member_invite` | **`42501` permission denied for table** |
| G2 | `authenticated` | `select count(*) from whatsapp_opt_in_event` | **`42501` permission denied for table** (unchanged) |
| G3 | `anon` | `select … from nexus_team_roster()` | **`42501` permission denied for schema public** |

**X1 is the probe the brief asked for, and it is refused on the right ground.**
A `sales` login naming itself is refused by the AUTHORITY lookup —
`NX_TEAM_ROLE_CHANGE_REFUSED` — not by a "you cannot change your own role"
rule. §3c explains why that distinction cost a migration.

### 3b. Reads are scoped, and reading the roster is not privileged

| actor | `nexus_team_roster()` |
|---|---|
| alpha owner | 7 rows, all alpha, `is_self` true on their own |
| **bravo owner** | **2 rows, both bravo** — no alpha row of any kind |
| alpha **sales** | 7 rows (alpha) |
| a login with no membership | **0 rows** |

Seeing who your manager is is deliberately not gated; **only mutation is.**
`is_approver` came back `true`/`TENANT_ROLE` for owner/admin/manager on alpha
(their `inventory_action_policy` admits those roles) and `false` for
sales/technician/member — the same two predicates `action_approver_context()`
applies. Where a dealership has **no** policy row the function returns
**`is_approver = NULL` with `approver_basis = 'NO_POLICY'`**, and the screen says
"not stated", because nobody having decided is not the same as nobody being
allowed.

### 3c. A guard that could never fire, found by firing at it

team_03 shipped four guards. Probing them on staging produced this:

```
as the SOLE owner of staging-alpha, set my own role to 'admin'
  -> NX001 NX_TEAM_NO_SELF_ROLE_CHANGE   (line 32)
```

The **last-owner** guard sits at line 60 and was never reached — and no path
could reach it: it fires only when the TARGET is the only owner, only an owner
may change an owner, and the actor could not be the target, so an owner actor
implied a second owner and the count was never 1. The same argument held in
`nexus_team_revoke_access`. CLAUDE.md: *"a gate that cannot go red is
decoration"* — this file has now found three.

**team_05 removed the self-change refusal, not the last-owner guard**, and the
product is better for it:

- an owner stepping down after appointing a successor is a normal dealership act
  and was previously impossible;
- the self-refusal answered the **wrong question** for the case that matters —
  a `sales` login promoting itself was told "you cannot change your own role",
  which implies the act would be fine on somebody else. It is not;
- nothing is lost on escalation: `NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY` tests the
  **roles**, not the people, so it covers an admin naming itself (**X9**).

The guard now fires, on both projects, in both functions (**X14, X15, P4, P5**).

### 3d. Revocation is real — the procurement proof

One staging transaction, one JWT, three measurements:

```
BEFORE  sales1 sees   leads 3   inventory 3   roster 7   tenants 1
        owner revokes sales1  ->  removed_role sales, leads_still_assigned 1,
                                  auth_account_deleted false
AFTER   sales1 sees   leads 0   inventory 0   roster 0   tenants 0
```

Deleting the `tenant_members` row takes `nexus_current_tenant_ids()` to the empty
set, so **every** tenant-scoped policy in the database filters that session to
zero. It does **not** delete the Supabase Auth login, does not touch the staff
row, and does not reassign the leads — the function returns the count that stays
assigned so the screen can say so instead of implying a clean hand-over.

### 3e. The invite path, end to end on staging

```
S3  owner invites a NEW address        -> PENDING_FIRST_SIGN_IN
S4  it appears in nexus_team_pending() -> 1 row, has_login false
S5  owner cancels it ('NewRep@Alpha…') -> cancelled 1   (case-insensitive)
S6  pending after cancel               -> []
C1  owner records 'brandnew@alpha…' as manager
C2  a login is created for 'BrandNew@Alpha.Staging.Invalid'
C3  tenant_members row appears           role manager, by the trigger
C4  the invite row is marked claimed     claimed_at set, claimed_by = the new id
C5  the new colleague then sees          leads 3, inventory 3, roster 8
M1  owner invites 'owner@bravo…' (an address that ALREADY holds a login)
                                       -> MEMBER_ADDED, access live immediately
```

**C2 stands in for Supabase Auth creating the account; nothing about the trigger
depends on how the row got there.**

**The fail-safe was proved by breaking it deliberately.** With a temporary
`BEFORE INSERT` trigger on `tenant_members` that raises:

```
the ACCOUNT still exists                      true
no membership was granted                     true
the pending role is STILL OPEN and visible    true
```

A failure to grant access is one click to fix; an account that cannot be created
is not. The claim trigger swallows every error on purpose and logs a warning.

### 3f. Handover, proved rather than asserted (staging, rolled back)

```
H1 owner appoints a second owner            changed true   (admin -> owner)
H2 the first owner steps down to admin      changed true   (owner -> admin)
H3 owner holders, read AS POSTGRES          admin@… = owner   owner@… = admin
H5 that admin then demotes itself further   changed true   (admin -> manager)
H6 final shape                              exactly one owner throughout
```

**H3 was first measured wrong and the correction is worth keeping.** Read as
`authenticated`, `count(*) … where role='owner'` returned **0** — because
`tenant_members_self_read` shows the caller only their own row. That is the
file's own rule biting the person applying it: *0 rows is evidence about RLS and
never about the state.* Re-measured as `postgres`, one owner was there the whole
time.

### 3g. Consent, scoped and derived once (staging, rolled back)

Three real consent acts were written by the engine's own writer
(`whatsapp_record_opt_in_event`, as `service_role`) — alpha OPT_IN then OPT_OUT
for one customer, and one bravo OPT_IN:

| reader | `nexus_whatsapp_consent_events` | `nexus_whatsapp_consent_current` |
|---|---|---|
| alpha owner | 2 rows, both alpha, with mechanism + evidence kind + evidence ref | `971500000001` → **OPTED_OUT**, evidence `wamid.probe.stop.1` |
| **bravo owner** | **1 row, bravo's own only** | — |
| alpha technician | — | `971500000001` → OPTED_OUT |
| `authenticated` on the table itself | **42501** | **42501** |

The current state is **not** derived in the accessor: it calls the database's own
`whatsapp_opt_in_state()`, which carries the OPT_OUT-wins tie-break and the
future-dated filter. The 4 Sep consent pass deleted the last two hand-written
ORDER BYs precisely so this answer could not depend on which consumer asked, and
this pass did not add a third.

### 3h. Production, after applying — all rolled back, nothing left behind

```
P1 roster as Ali        1 row: owner, ALBA CARS, is_approver true / TENANT_ROLE,
                        staff Ali Asgher (senior_rep), last sign-in 06:23 today
P2 pending              []
P3 consent events       []          <- zero rows, and rendered as "nothing recorded"
P4 Ali set_role(SELF)   NX001 NX_TEAM_LAST_OWNER
P5 Ali revoke(SELF)     NX001 NX_TEAM_LAST_OWNER
P6 invite a colleague   PENDING_FIRST_SIGN_IN, appears in pending, roster still 1
P7 cancel it            cancelled 1, pending []
P8 day job untouched    leads 3, inventory 12, users 1
```

**Production afterwards:** `tenant_members` 1, `tenant_member_invite` **0**,
`whatsapp_opt_in_event` **0**, `audit_log` rows under `Team Access` **0**,
inventory 12, leads 3. **No user was created. No membership was created, changed
or deleted. No row in production was left changed.**

---

## 4. The invite flow — exactly what it can and cannot do

**This is the part to read before telling anybody the feature is finished.**

Adding a colleague is two acts and only one of them is NEXUS's:

**AUTHORISATION — built, live, proved.** Deciding that whoever proves they own
`x@dealer.ae` is a `manager` at THIS dealership. It needs no credential. It is
recorded immediately, and applied the moment a login for that address exists.

**AUTHENTICATION — not built, and it must not be built the easy way.** Creating a
login and giving that person a way to prove they own it necessarily involves a
credential: a password, a magic link, an invite token.

> **I do not handle passwords, invite tokens or any credential, and neither does
> the dashboard.** Nothing in this pass reads, stores, transmits or generates
> one. The design routes account creation through Supabase Auth's own mechanism
> so that neither the dashboard nor NEXUS's database ever holds it.

Why it cannot be reached from here, measured rather than assumed:

- the dashboard is a static bundle carrying the **anon** key;
- Supabase's own `auth.admin.inviteUserByEmail()` requires the **service_role**
  key, and a service_role key in a browser bundle is the whole database handed to
  anyone who opens devtools;
- **`list_edge_functions` on production returns `[]`** — there is no server-side
  place in this deployment where that key could live.

**So `nexus_team_invite()` never sends anything, and the screen says so where
somebody would look for it.** It returns one of two outcomes and the UI renders
them differently, because they are different facts:

| outcome | what is true | what is still needed |
|---|---|---|
| `MEMBER_ADDED` | a NEXUS login already existed for that address; access is **live now** | nothing |
| `PENDING_FIRST_SIGN_IN` | the role is recorded and will apply on first sign-in | **somebody has to give that person a way to sign in** |

**Who must close it, and how.** Three routes, in order of preference:

1. **Ali, today, no code:** Supabase dashboard → Authentication → Users →
   *Invite user*, with the same address. Supabase sends its own invite email; the
   `AFTER INSERT` trigger on `auth.users` grants the recorded role the moment the
   account row appears. Verified end to end on staging (§3e C1–C5).
2. **A one-function backend, later:** a Supabase Edge Function holding the
   service_role key that calls `inviteUserByEmail` and nothing else. That is the
   only thing that would let the dashboard's own button send the invitation, and
   it is a deliberate decision to hold a service key, not a detail.
3. **Self-service sign-up**, if the account is ever configured for it: the
   colleague signs up with that address and the trigger does the rest. NEXUS is
   uninvolved either way.

**What must not be done:** putting the service_role key in the bundle, or an
"Invite" button that appears to send an email and does not. The second is worse
than the first is honest — a screen that lies about having invited somebody
produces a colleague who never arrives and an owner who thinks they did.

---

## 5. Frontend

Everything below is **in the working tree and not deployed.** No git command was
run and the push cannot happen from this session.

### `lib/data.js`

Two predicates added beside the existing five, reading the **same column the
database reads** (`tenant_members.role`, never `users.role`):

- `canManageAccess()` — owner/admin. Mirrors the one authority lookup all four
  write functions begin with.
- `canGrantOwner()` — owner only. Mirrors `NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY`.

Both answer **true when authority is unknown**, for the reason that file already
gives: a failed membership read must not tell an owner they are not one.

### `screens/team.js` — a second card, "Who has access"

- reads `rpc/nexus_team_roster` and `rpc/nexus_team_pending`, settled
  independently, `null` (not `[]`) until answered;
- per member: name, the address they sign in with, when they were added, when
  they last signed in (or **"has never signed in"**), account role, staff link,
  approver status, and **Remove access**;
- **role change** is a select + Save, with `owner` *omitted from the options*
  rather than shown and refused when the caller is not an owner, and a sentence
  saying why it is missing;
- **staff link** is a select + Link. A member with no link is called out in
  words, because that is rbac open item 4 and it is a working defect: leads are
  filed against a STAFF id, so a `sales` login with no link can edit **no leads
  at all**, and without a sentence it presents as "the product is broken";
- **Remove access** expands an in-place confirmation naming exactly what happens
  — access gone immediately, **the NEXUS login is not deleted**, N leads stay
  assigned (counted from the leads this screen already read, with the cap
  disclosed) — before the second click;
- **Add a colleague** is email + role + optional staff record. Every role is
  listed with what the database lets it do, and `NO_CREDENTIAL` sits under the
  form;
- the whole controls layer is omitted, not disabled, on an account that may not
  manage access — the card subtitle already says whose decision it is, and a dead
  form is a worse way to say the same thing than a sentence.

**Every write checks what came back.** `acCall()` refuses to claim anything on a
non-array or empty response — the lesson `lib/unit-form.js` and
`lib/lead-drawer.js` were both fixed for. A no-op role change reports *"was
already X, so nothing changed"* rather than "Saved.", because the function tells
it so (`changed: false`).

**Refusals reach the reader.** Only an `NX001` whose `DETAIL` matches
`/^NX_TEAM_[A-Z_]+$/` is rendered, parsed out of `.technical` — the same
discipline `screens/finance.js` uses. Anything else falls back to the user-safe
clause `lib/errors.js` writes; nothing else from the wire reaches the screen.

The three dead tooltips are gone. `NO_INVITE` and `NO_ROLE_WRITE` now say what
the staff-directory row actually is (a staff record, not a login; a job title,
not an account role) and point at the card. The drawer's two disabled buttons
became one live **Manage access**. `NO_DELETE` is unchanged — removing somebody
from the **staff directory** is still not offered, and that is a different act
from removing their access.

### `screens/compliance.js` — a third card, "WhatsApp consent"

Read-only. Two sections: **where each customer stands now**
(`nexus_whatsapp_consent_current`, the database's own answer) and **everything
recorded** (`nexus_whatsapp_consent_events`, newest first, capped at 200 with the
cap disclosed when it bites). Each line carries the customer, in or out, when,
the mechanism, the evidence kind and reference, and **both instants** — when the
customer said it and when NEXUS wrote it down.

**The empty state is the load-bearing part.** Production holds zero rows, and the
card says:

> *Nothing has been recorded here yet. Read that as the absence of a record and
> nothing else: it is not a statement that nobody has opted out, and it is not a
> statement that anybody has agreed.*

It lives on Compliance rather than Team on purpose: this is about **customers**,
and the Team screen is about **staff**. Putting it there would have been a
category error.

### Build

```
$ npm run build   (apps/executive-dashboard)
vite v5.4.21 building for production
✓ 89 modules transformed
dist/assets/main-Bl-VFtAE.js   1,430.88 kB │ gzip: 421.79 kB
✓ built in 2.75s
```

`node --check` clean on `screens/team.js`, `screens/compliance.js`,
`lib/data.js`. Two warnings, both pre-existing and unrelated (the dynamic-import
note on `lib/data.js`, and the >500 kB chunk size).

---

## 6. The quality gate — and the two FAILs, stated exactly

```
$ node QUALITY_GATE.mjs
PASS 15   FAIL 2   WARN 2   NOT RUN 17
FAIL P0 R2  Every screen renders real content with no page errors
FAIL P0 R3  No query the database would reject — and the check is not vacuous
WARN P0 S3  Every query names a relation and columns that exist
WARN P1 S5b Exposure totals coalesce a null impact to zero   (pre-existing)
exit 1
```

Baseline before this pass: **PASS 18, FAIL 0, WARN 1, NOT RUN 17.**

**Both FAILs and the new WARN have one cause, and it is not the screens.** The
gate carries an embedded schema snapshot taken `2026-09-06T05:05:00Z` — about an
hour before these migrations. Its render stub answers any RPC it does not
recognise with `404 PGRST202`:

```
R3 · 404 PGRST202 Could not find the function public.nexus_team_roster
   · 404 PGRST202 Could not find the function public.nexus_team_pending
   · 404 PGRST202 Could not find the function public.nexus_whatsapp_consent_events
   · 404 PGRST202 Could not find the function public.nexus_whatsapp_consent_current
R2 · compliance: chars=25977 errState=true stuck=false newErrors=4
   · team:       chars=16001 errState=true stuck=false newErrors=4
```

The four functions **exist on both projects** and were exercised as five
different roles above. The screens are behaving correctly: a read that failed
renders as a read that failed.

**Proved, rather than argued.** A throwaway copy of the gate — written to `/tmp`,
run once, deleted, never in the repo — with the nine new function names added to
its stub allow-list and nothing else changed:

```
PASS 18   FAIL 0   WARN 1   NOT RUN 17
```

**Identical to the pre-change baseline, S3 included.** So the two FAILs are the
stale snapshot and nothing else, and the screens render correctly against a stub
that serves the functions.

`QUALITY_GATE.mjs` was **not edited** — 371,432 bytes, mtime `05:47:39`, which
predates every change in this pass; it contains no occurrence of
`nexus_team_roster`.

**What clears it, and it is the gate owner's to do:** refresh the embedded
snapshot (`--refresh-schema` against a live catalogue, or a `--catalogue` file),
which adds the nine names to `SNAPSHOT.rpcs`. I did not attempt the
`--catalogue` route because the catalogue carries **339 KB of function source**
and a truncated one is rejected by the gate's own integrity check — a truncated
transfer reported as a live PASS is the exact failure that check exists to
prevent.

**The 17 NOT RUN are the live-database and browser lanes** (L1–L13, B1–B4). They
need `NEXUS_DB_URL` / `NEXUS_STAGING_*` credentials that do not exist in this
container. **They are NOT RUN, not PASS**, and nothing here converts them.

---

## 7. Still open

1. **The frontend is in the working tree, not deployed.** Until Ali deploys,
   the live dashboard has no access card and no consent card. The database side
   is live on production now and refuses correctly regardless.
2. **Nobody can be sent a sign-in link from NEXUS.** §4. This is the one thing
   standing between "a role is recorded" and "a colleague is working", and
   closing it is either Ali inviting the address in the Supabase dashboard
   (works today, proved) or a deliberate decision to run one Edge Function
   holding a service key.
3. **`v_audit_unregistered_writers` will call `Team Access` an unrecognised
   writer and give the wrong advice.** Its disposition CASE names
   `Inventory Action Center` and nothing else, so a database function that
   writes an audit row is told to *"register it from the box with its real n8n
   id"* — which is impossible, because it is not an n8n workflow. **This is
   pre-existing and affects four writers, not one:** `Inventory Cost Price
   Change`, `Inventory Unit Deleted`, `Lead Recovery Action Center` and now
   `Team Access`. Deliberately **not** fixed here: it means replacing a
   `security_invoker` view four screens read, on a pass about access and
   consent, and `CREATE OR REPLACE VIEW` has silently dropped that option three
   times in this codebase. The fix is one branch in the disposition CASE, or —
   better — driving it from a small function that reads the audit workflow names
   out of `pg_proc.prosrc` so the list maintains itself.
4. **A small, bounded disclosure in `nexus_team_invite`.** An owner or admin can
   learn whether an arbitrary email address already has a NEXUS login, from the
   `MEMBER_ADDED` vs `PENDING_FIRST_SIGN_IN` outcome. It cannot be removed
   without making the two outcomes indistinguishable, and they must not be —
   one person can sign in now and the other cannot. Recorded rather than hidden.
5. **`nexus_team_invite` and `nexus_team_cancel_invite` refuse when the caller is
   owner or admin at more than one dealership** (`NX_TEAM_INVITE_AMBIGUOUS_TENANT`).
   Deliberate: they take no tenant argument, because a definer function that
   takes a tenant is the `action_write_audit` shape CLAUDE.md records as a hole.
   Unreachable today — nobody holds two — and it needs a screen that asks first.
6. **`service_role` bypasses all of this**, by design. n8n holds that key and can
   write `tenant_members` directly with no role check and no audit row. The
   disciplined door is the one a person comes through.
7. **The consent screen has nothing to show on production**, because
   `whatsapp_opt_in_event` holds zero rows and the messaging layer has never
   carried a real customer message. The screen is correct and currently
   uninformative; it fills the day that layer is switched on, which
   `CLAUDE.md` says it should not be yet.
8. **Staging carries the fixtures from last night's pass** (`…a003`–`…a007`,
   `@*.staging.invalid`), used and left in place. This pass created **no**
   persistent staging rows: every probe rolled back, including the two
   `auth.users` rows (`cccccccc-…`) and the three consent rows written to prove
   the trigger and the accessors. Verified afterwards — `tenant_member_invite`
   0, `whatsapp_opt_in_event` 0, `Team Access` audit rows 0, probe triggers 0.

   **Staging is not a quiet room, and it produced an unplanned live test.**
   A third dealership, `demo-northwind`, with three logins
   (`dddddddd-…`, `@northwind.demo.invalid`), was created by **another session**
   at `06:23:18` today — four minutes after the claim trigger was installed on
   staging. The trigger therefore ran on three real `auth.users` INSERTs it knew
   nothing about, found no open invitation for those addresses, and did nothing:
   all three accounts were created normally and all three got the membership
   their own creator gave them. That is the no-op path exercised against
   somebody else's writes, unrehearsed.
9. **Two FAILs on the quality-gate board**, §6 — the gate's snapshot, not the
   screens, with the counter-proof recorded. Not converted to PASS and not
   worked around.
