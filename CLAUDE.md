# Working on NEXUS OS

Read this before doing anything in this repo.

## Who you are working for

Ali owns this product. As of 2 September 2026 he has decided to run this as a
business rather than as an engineering project, and he has asked that work here
be judged the way an owner judges it:

**Does this make NEXUS OS sellable to a real dealership on a subscription, and
does it keep it sellable once they are using it?**

That is not a licence to cut corners — an owner carries the liability for what
the software says to a customer. It means:

- Weigh revenue, risk and time-to-cash alongside correctness. A defect that
  cannot reach a customer is not urgent. A defect that puts a wrong number in
  front of a buyer, or one dealership's data in front of another, is.
- Say what is proven and what is not, in plain commercial terms. "Wired but
  never fired" is a real and useful answer. A confident claim that turns out to
  be false costs a customer, not a code review.
- Never help overstate the product. The current honest position is a
  **controlled dealership pilot**, not "enterprise-ready" or "compliant". If a
  claim is not backed by evidence in this repo or the database, do not make it
  and do not help make it.
- Prefer finishing one path a buyer can see end to end over improving five they
  will never open.

## What the product is

**NEXUS is a Revenue Recovery & Action OS for dealerships**, not an AI chatbot,
not a CRM, not an automation platform. It sits *above* the dealership's
existing DMS, CRM, inventory and accounting systems, finds where money is
leaking, decides the next best action, and executes it with the team in
control. It replaces none of those systems. `PRODUCT.md` holds the full thesis,
the commercial role of each of the 14 modules, the engines, and the roadmap —
read it before proposing any feature.

The sequencing rule that matters more than the strategy: **build the engine
whose data already exists.** An engine that renders "no data" to a paying
dealership is worse than one that does not exist. Measured 2 Sep — inventory
has cost and days-in-stock on all 12 units, so Profit Sentinel is buildable
now; there is **no service table, no appointment table and no recon-cost
column**, so Service Retention and most of Deal Rescue are blocked on
integrations, not on code. Sell those as roadmap, never as capability.

Never fabricate a monetary impact. Estimated, attributed and confirmed are
three different words; do not call an estimate revenue, and do not claim
recovered revenue until a real business outcome occurs.

## Tenancy: the database is finished. The workflows are most of the way.

As of 2 September the database side is **complete**. `tenant_id` on every
tenant-scoped table and NOT NULL on all of them; every natural business key
scoped per dealership (`leads.email`, `customer_360_profiles.customer_id`,
`deals_embeddings.deal_id`, `inventory.id`, `whatsapp_contacts.chat_id`,
`processed_messages.message_id`, `purchase_history.deal_id`, `users.email`);
tenant-scoped RLS; the five SECURITY DEFINER functions that were cross-tenant
bypasses scoped; `v_inventory_sales` and `v_customer_directory` scoped. Proven
adversarially with two synthetic tenants as real roles with JWT claims — reads,
writes, updates, deletes, tenant-hopping, a forged `tenant_id` claim, membership
self-grant, all ten views, hot-lead routing, phone-tail identity collision and
the whole `anon` surface all returned zero. Do not redo this work.

Read "returned zero" narrowly: it meant **zero rows**, and for `anon` that was
evidence about RLS only. The grants underneath were still wide open and were not
closed until 2 Sep (views, then all 16 base tables and the sequences). Row counts
never proved the `anon` surface shut, and no future claim about it should rest on
them.

That 2 Sep pass closed **`anon` only**. It left `authenticated=arwdDxtm` — full
INSERT/UPDATE/DELETE/TRUNCATE — on 32 objects, and the wording above was read by
the next three agents as "grants: done". Narrowed 3 Sep 2026 (migration
`authgrant_narrow_authenticated_to_actual_consumers`): every table and view in
`public` is now `authenticated=r`, except `inventory` (`arwd`) and `leads` (`rw`),
which are live dashboard write paths, and `processed_messages` plus the three
sequences, where `authenticated` now holds nothing. `service_role` unchanged.

17 of 21 n8n workflows now resolve a tenant from something real — the WAHA
session for WhatsApp, the authenticated user via `tenant_members` for
JWT-guarded webhooks, the calling workflow for sub-workflow hops — and stamp it
explicitly rather than relying on the column default.

**It is still not safe to onboard a second dealership**, and what remains is
operational rather than structural:

- `NEXUS_TENANT_MAP` is not set on the box. Every resolver falls through to its
  built-in single-tenant map. The moment that env var holds two keys, roughly
  fifteen code paths switch from "the only dealership" to "unresolved" at once.
  **Rehearse that switch on a staging box before it happens in production.**
- Customer 360 goes *silent* at two dealerships — `nexus_scoped_tenant_id()`
  returns null for a `service_role` caller once more than one tenant is active,
  so the nightly batch syncs nobody and writes no audit row. Silent, not wrong,
  but it must iterate tenants before anyone is onboarded.
- `tenants.is_unattributed_default` **no longer points at a dealership.** Fixed
  5 Sep 2026 (migrations `20260905201206`/`201227`/`201337`, evidence in
  `/home/claude/out/unattributed-default-evidence.md`). It is held by a
  quarantine tenant — slug `__unattributed__`, `status='quarantine'`,
  `is_quarantine=true` — and a CHECK constraint
  (`tenants_unattributed_default_must_be_quarantine`) makes re-pointing it at a
  real dealership impossible without dropping that constraint by name. A backend
  write that omits `tenant_id` is now **retained** under quarantine rather than
  filed under ALBA: unreadable by any dealership session (no `tenant_members`
  row, and `nexus_current_tenant_ids()` requires `status='active'` — both locks
  measured, including against a forged membership row plus a forged JWT claim),
  excluded from all 29 tenant-carrying views **in their own definitions**, and
  findable by `service_role` via `nexus_quarantine_census()`.
  `nexus_scoped_tenant_id()` was decoupled from the flag and still returns ALBA,
  so Customer 360 did not go silent. **What this does not fix:** the four n8n
  workflows that still omit `tenant_id` are not identified anywhere — the repo's
  `n8n-workflows/*.json` is a 30 Aug export containing zero occurrences of
  `tenant_id` and cannot answer it. Their rows now land in quarantine instead of
  ALBA, which is visible and recoverable rather than silent. **Run
  `select * from public.nexus_quarantine_census();` as `service_role` daily until
  it is stable** — that census is the only measurement of which writers are
  broken, and this is the cheapest moment to take it. Also: disabling
  `Resolve Tenant` in n8n, the documented rollback, no longer falls back to ALBA;
  see `/home/claude/out/n8n-quarantine-change-NOT-DEPLOYED.md` (not deployed).
- ~~**`workflow_registry` is readable by every signed-in user and is not
  tenant-scoped.**~~ **Closed 6 September 2026** — migration
  `20260906042024_workflow_registry_off_the_dealer_plane_via_vendor_accessor`,
  applied to staging then production, evidence in
  `/home/claude/out/workflow-registry-scoping-evidence.md`. **`QUALITY_GATE`
  check L2 now PASSES** (12 open policies, 12 exempt, 0 not) and nothing was
  added to `L2_EXEMPT_TABLES`.

  **It did not get a `tenant_id`, and that was the finding.** The 18 rows are
  the *vendor's* register of the automations NEXUS runs. Nothing in this
  database maps an automation to a dealership, and three of the registered
  workflows are NEXUS's own public pages, which serve none — so a `tenant_id`
  could only have been filled by inventing that mapping, and a
  nullable-meaning-platform one would have been a predicate that filters
  nothing while reading like a scope. The table left the dealer data plane
  instead: **no table grant, no column grant, no `authenticated` policy**
  (`workflow_registry_read` dropped; the anon-deny and service_role policies
  untouched). Measured on production as the ALBA owner with a real JWT claim:
  `count(*)`, `select name`, `select *` and `select id` on the table all return
  **42501**; as `anon` over the live REST API, `42501 permission denied for
  schema public`.

  The one thing CONTROL-PLANE.md Part 4 says a dealership *is* entitled to now
  arrives through `public.nexus_workflow_catalogue()` — `SECURITY DEFINER`,
  `STABLE`, owned by `postgres`, EXECUTE to `authenticated` and `service_role`
  and revoked from `anon` and PUBLIC. It returns the naming projection only
  (`name, audit_name, audit_aliases, category, description, is_active,
  writes_audit_log`) and **cannot** return `id`, `trigger_type` or
  `trigger_detail`: those are absent from the function's own result type rather
  than merely unprojected, so re-opening the leak needs a deliberate edit, not
  a forgotten revoke. The four `security_invoker` views —
  `v_workflow_health`, `v_lead_recovery`, `v_needs_attention`,
  `v_audit_unregistered_writers` — read that function, which is why they still
  work with the table closed. Their outputs were diffed against their
  pre-change bodies: **symmetric difference 0 rows on all four**.
  `v_workflow_health` still returns **18 rows to a dealership session**.

  **A caller acting as `authenticated` gets rows only as a member of an active
  dealership**, so a signed-in session belonging to no dealership now gets zero
  from the accessor and zero from `v_workflow_health` — it used to enumerate
  all 18. **What is still disclosed, deliberately:** a real member can count
  the 18 automations through `v_workflow_health`, because that view is the
  sanctioned projection. The accessor is now the single place a per-dealership
  filter goes when a fact exists to filter on.

`select * from public.nexus_tenancy_readiness();` is the live gate. The BLOCKER
that "fires whenever any tenant holds the default flag" — i.e. could never clear
— was replaced on 5 Sep 2026 by four measured branches, and **production now
returns zero BLOCKERs**: two pre-existing WARNs on `policy_rule` and
`policy_rule_event` (nullable by design, platform scope) and two INFO lines. It
still cannot see n8n at all, so it will never report a workflow that omits
`tenant_id` directly — but `nexus_quarantine_census()`, which it now surfaces as
a WARN, measures exactly that from the rows those workflows write.

## What is actually proven

Proven live on 2 Sep 2026, with a real inbound WhatsApp message:
identity resolved to an existing lead without creating a duplicate; an
inventory-grounded reply in 17.8 seconds quoting a real price with the vehicle's
cost withheld; a SUCCESS audit row. That path is demoable and honest.

Deals now works end to end. On 2 September a real closed-won deal was recorded
through the live dashboard UI: `purchase_history` row with the correct
`amount_aed`, `purchase_date`, `lead_id` and `tenant_id`, a `deals_embeddings`
row, an audit row, and the Deals screen showing it. Submitted four times, one
row — idempotency is proven, not assumed.

Finance is subtler than "never exercised", and the earlier claim in this file
was wrong. `finance_quotes` shows **25 inserts and 15 deletes** in
`pg_stat_all_tables` (re-measured 5 Sep 2026; this file said 16 and 13) — the insert path has worked repeatedly and a journey
teardown script deletes the rows after every test. "Empty" means cleared, not
never. What is genuinely unproven is whether it works *today*: the fix to the
constraint that broke it is nine minutes younger than the last failure and has
not been exercised since.

KYC has 3 rows and 0 verified. A row appearing is not the capability working —
check the outcome, not the count. `Customer 360` is a once-daily batch, not live.

On 31 Aug the WhatsApp agent invented an EMI of AED 11,200 (the true figure was
nearer 7,800) and sent it to a real person, and a separate reply leaked the
dealership's internal vehicle cost. Both are now gated. The WhatsApp finance
path should not go live.

## The open webhook — read before touching anything WhatsApp

Tested live 3 Sep. There are **11 business POST webhooks**, and **not one uses
n8n's own `authentication` parameter** — every guard is downstream application
logic, so every endpoint accepts the request and starts an execution before
refusing. Ten refuse correctly. One does not:

**`POST /webhook/whatsapp-inbound` accepts unauthenticated calls.** Its
`WAHA Auth Gate` is env-driven and **dormant on this box** — `WAHA_WEBHOOK_SECRET`
is unset, so the gate's early `return items;` passes everything through. Proven
by running the published workflow with a payload that dies before any write: the
gate emitted the item with no `_gate` key, which only the dormant branch does.

What an unauthenticated caller gets: keyword-matched AI replies **sent to a
number they choose** (`Guard Reply` filters content, never the recipient), rows
in `processed_messages`, `whatsapp_contacts`, `communication_logs`, `audit_log`,
and — via `Score New Lead`, which enters the Master Router through
`Called Internally` and **bypasses that router's own Auth Gate** — rows in
`leads`. A guarded front door with an unguarded side door behind it.

**And the caller picks the dealership.** `Resolve Tenant` keys off `body.session`,
which is caller-supplied; a bogus session resolves to the sole configured tenant
today. The moment `NEXUS_TENANT_MAP` holds two dealerships, one JSON field
chooses whose data is written — and n8n writes as `service_role`, `BYPASSRLS`,
so nothing in the database filters it. **Every tenant control proven this week
has this in front of it.**

The workflow code is already correct; the hole is configuration, and the fix is
on the VM, not in n8n: set `WAHA_WEBHOOK_SECRET`, make WAHA send
`x-nexus-webhook-secret`, confirm in MONITOR mode, then set
`WAHA_WEBHOOK_ENFORCE=true`. Hardcoding a secret in n8n first would silently
drop every real customer message, because WAHA is not sending the header yet.
One trap: that workflow has `saveDataSuccessExecution:"none"`, so MONITOR-mode
executions are never saved and the monitoring window is unobservable — flip it
to `"all"` for the rollout or you will enforce blind.

~~Also: `slack-command` is closed by accident, not by design.~~ **Retracted
6 Sep 2026, measured against the live published definition.**
`Tenant For JWT User` **has** `alwaysOutputData: true`. Execution `9325` shows it
emitting one empty item, `Auth Gate` running, and throwing — status `error`, not
`success`. `slack-command` is closed **by design**. The claim above was read from
the 30 August repo export, which is stale; the box is the witness.

## House rules that exist because something broke

- **One agent on the n8n box at a time.** Parallel writes have taken the
  production VM down twice. Repo and database work parallelises fine.
- **n8n edits stay in draft until published.** Verify against the *published*
  version by fetching it back, not against your draft.
- **No frontend may compute a finance figure.** APR, EMI, monthly payment, LTV
  come from the calculator with `calculation_id` and `execution_id` behind them,
  or they do not appear. Without evidence: no number, not even "indicative".
- **A missing row is not proof the event did not happen.** Unknown ≠ none. This
  codebase has rendered that lie in six separate places.
- **One figure, one derivation.** See `NEXUS_INVARIANTS.md`.
- **Check captions against the branch they sit in.** Sentences asserting the
  opposite of their own code have been found seven times here.
- **After creating ANY function, table, view or sequence, read its ACL.**
  Supabase's default privileges grant EXECUTE **directly to those roles**, and
  `REVOKE ... FROM PUBLIC` does not touch a direct grant. This exact shape has
  opened a hole three times: the RAG search functions, the tenancy helpers, and
  `action_write_audit` — which takes a tenant as an argument and runs as
  definer, so any signed-in user could have forged audit rows against another
  dealership. Revoke explicitly from `anon` and `authenticated`, then re-check
  with `get_advisors`.
- **Every public view needs `security_invoker`.** A database event trigger now
  fails the deploy without it; `CREATE OR REPLACE VIEW` silently drops the
  option and did so three times.

## The default-grant check: `anon` **and** `authenticated` (six holes)

> Read the heading. This section used to be called "the `anon` grant check", and
> that title is the direct cause of failure number four. `anon` was closed on
> 2 Sep 2026 and everyone who opened this file afterwards read the section as
> *done* — while **32 objects sat wide open to `authenticated`**, including
> `leads`, `inventory`, `users`, `audit_log`, `finance_quotes` and
> `purchase_history`. The default grant lands on **both roles**. Closing one says
> nothing about the other.

Supabase ships default privileges that grant **directly to `anon` and
`authenticated`** on everything created in `public` — `EXECUTE` on every new
function, and *all* privileges (`arwdDxtm` — SELECT **and INSERT/UPDATE/DELETE**,
not just SELECT) on every new table and view. Nobody writes those grants; they
arrive on their own, so nothing in the migration diff shows them.

**Read the ACL, and know what the letters mean.** `authenticated=arwdDxtm` is
not "read access". It is:

| letter | verb | filtered by RLS? |
|---|---|---|
| `r` | SELECT | yes |
| `a` | INSERT | yes |
| `w` | UPDATE | yes |
| `d` | DELETE | yes |
| `D` | **TRUNCATE** | **NO** |
| `x` | REFERENCES | n/a |
| `t` | TRIGGER | n/a |
| `m` | MAINTAIN | n/a |

**`D` is the one that matters most, and this file missed it for four rounds.**
RLS does not apply to TRUNCATE. So on every object carrying `D`, the reassuring
sentence "RLS is the remaining lock" was simply **false — there was no lock at
all**. Measured 3 Sep 2026 in a rolled-back transaction: as `authenticated`,
`TRUNCATE public.competitors` took the table from 13 rows to 0. The same grant
sat on `audit_log`, `purchase_history` and `finance_quotes` — a signed-in user
could have erased the audit trail and the sales record across **every** tenant,
and no policy in this database would have filtered a single row of it.

**`get_advisors` does not catch this.** It returned zero grant-related lints on
the same day all 32 objects were open. It flags missing RLS and definer
functions, not over-wide table privileges. Treat a clean advisors run as
evidence about RLS and nothing else; the ACL query below is the only check that
answers this question.

**The one query. Run it; do not reason about it.**

```sql
select c.relkind, c.relname, coalesce(array_to_string(c.relacl, E'\n'), '(owner-only)') acl
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','v','m','p','S')
  and (has_table_privilege('authenticated', c.oid, 'UPDATE')
    or has_table_privilege('anon',          c.oid, 'UPDATE'))
order by 1, 2;
```

Anything it returns that is not a deliberate, named write path is a hole. Note
it covers **sequences** too: `authenticated` held `rwU` on `leads_id_seq`, and
UPDATE on a sequence is `setval()` — rewinding the counter to collide primary
keys on the dealership's next real insert.

Three more things follow, and each has already cost this project:

- **`REVOKE ... FROM PUBLIC` does not remove a direct grant.** A direct
  `anon=X` entry and a PUBLIC `=X` entry are separate ACL rows. Revoke from
  **both** (`REVOKE ... FROM anon, public`), every time — revoking only PUBLIC
  is what left one of these open after it was believed closed.
- **The check belongs on every new function AND every new view**, not just the
  ones a linter flags. The linter only flags what reads a tenant-owned table, so
  a helper that merely *encodes a business rule* passes it while still carrying
  an anon grant. The danger is not the body today: a later
  `CREATE OR REPLACE FUNCTION` adding `SECURITY DEFINER`, or a view widened to
  read a new table, opens a live hole with **no grant-shaped diff to review**,
  because the grant was already sitting there.
- **RLS is one lock, not two.** A `<table>_deny_anon` RESTRICTIVE policy makes an
  anon read return 0 rows, which looks identical to having no privilege — so
  "returns 0 rows" is evidence about RLS, never evidence the grant is absent.
  Measured 2 Sep 2026 on the 10 views *and* on all 16 tenant-owned base tables:
  as `anon`, SELECT, UPDATE and DELETE all **parsed and executed** against every
  one of them, and were stopped only by the row filter. Check `relacl`/`proacl`,
  not row counts.
- **An incidental lock is not a designed lock, and it will not hold.** On the
  same measurement, anon INSERT was refused on all 16 tables — but not by RLS and
  not by any privilege. It failed on `permission denied for function
  nexus_default_tenant_id`, because the `tenant_id` column DEFAULT called a
  function anon could not execute. Supplying `tenant_id` explicitly skipped the
  default, and the INSERT then reached RLS. Had that column default ever changed,
  the only thing standing between an anonymous caller and a write would have
  disappeared with no grant-shaped and no policy-shaped diff to review. When you
  record *which* lock stopped a verb, name the real one — and if it is
  incidental, treat the object as open.

Default privileges for `anon` in `public` are now revoked on tables, functions
**and sequences** for objects created by `postgres` (`ALTER DEFAULT PRIVILEGES
FOR ROLE postgres IN SCHEMA public REVOKE ...`), which is the role migrations
run as. Sequences mattered: `anon` held `rwU`, and `UPDATE` on a sequence is
`setval()` — an anonymous caller could have rewound the id counter behind
`leads` and caused primary-key collisions on the dealership's next real insert.

That backstop is still partial, and the remaining hole **cannot be closed from
this project**. A separate `supabase_admin` default ACL on `public` still grants
`anon` on tables, functions and sequences, so anything created by that role — an
extension, a Supabase-managed object — is still born open. `ALTER DEFAULT
PRIVILEGES FOR ROLE supabase_admin` was attempted 2 Sep 2026 and returns
`42501 permission denied to change default privileges`: `postgres` is not a
member of `supabase_admin` and Supabase grants no route to it. Residual risk:
any object a future extension or Supabase platform upgrade creates in `public`
arrives with a full `anon` grant and nothing will revoke it automatically.
**So the per-object check below is load-bearing, not belt-and-braces — after
installing an extension or taking a platform upgrade, re-run it.** Check the
object you just made.

**Before revoking, establish the reader *and the writer* — do not revoke
reflexively, and do not trust what this file says the writers are.** The role per
request is in the edge logs at `request.sb.jwt.authorization.payload.role`; the
dashboard signs in and reads as `authenticated` (`app.js` `boot()` returns at the
login card before any screen fetches), and n8n reads and writes as `service_role`
(user agent `n8n`, `sb_secret_` key). Filter the logs to
`method in ('POST','PATCH','PUT','DELETE')` and look at who is actually writing.
If an object has no reader for a role, revoking costs nothing. If it has one, say
so and leave it.

**Establish the writers from the shipped bundle, not from belief.** Going into the
3 Sep pass the working assumption — written down and inherited — was that *every*
dashboard write goes through a `SECURITY DEFINER` function. That was **false**.
`grep -rn "dbWrite" apps/executive-dashboard/lib apps/executive-dashboard/screens`
finds two direct table writes, both live and both confirmed in
`dist/assets/main-*.js`, which is the deployed truth rather than the source:

- `lib/unit-form.js` → `inventory` POST / PATCH / DELETE (the unit form)
- `lib/lead-drawer.js` → `leads` PATCH (owner assignment)

Those two are why `inventory` keeps `arwd` and `leads` keeps `rw`. Revoking them
would have broken two working screens to close a lock nothing was exploiting —
a bad trade. Everything else routes through `rpc/*`, and because those functions
are `SECURITY DEFINER` **owned by `postgres`**, they touch their tables as
`postgres` and are completely unaffected by the caller's table grants. That is
what makes narrowing safe: check `prosecdef` and `proowner` before relying on it,
because `sentinel_inventory_actions` and `search_rag_documents` are
`SECURITY INVOKER` and *do* read as the caller.

Then prove it **per object, not once at the end**, in transactions you roll back
(a prior agent ran a live DELETE outside one and had to disclose it). A
`DO $$ ... $$` block that ends in `RAISE EXCEPTION` aborts unconditionally, so
nothing can persist even if a probe misbehaves. Prove three things each time: the
consumer still does what it needs, the verb you closed now fails with `42501`
(*blocked by GRANT* — not "0 rows", which only ever proves RLS filtered it), and
`service_role` is untouched. Re-check `get_advisors` at the end knowing it will
not see grants, and for a `security_invoker` view read it as `authenticated`
*and* as `service_role`, not just inspecting the ACL.

## Where the record lives

- `NEXUS_INVARIANTS.md` — INV-001..INV-008: the business rule, who owns it,
  how it is written and read, and the query that proves it. Open violations are
  recorded as open rather than described as passing. Keep it that way.
- `architecture/schema.sql` — regenerated from the live catalogue; a
  transcription, not a replay, and it goes stale within days.
- `DESIGN.md`, `README.md` — product and setup.

## Across a patch transfer, compare trees — not commit ids

3 Sep 2026. J1 reported that PR #5 and the container's branch "share no
commits" — it had run `git cat-file -t` on all thirteen of PR #5's commit ids
and found none locally. That reading nearly caused an unnecessary branch
surgery, and it was wrong.

`git am` writes new commit objects for identical content: new author date, new
parent, therefore a new SHA. Across a patch-transfer boundary a SHA comparison
can only ever report "no shared commits", whatever the contents are. It is
evidence of nothing.

The test that settles it is `git rev-parse <ref>^{tree}`. Container `0905195`
and Ali's `cef1bf0` both hashed to `91eb1463…` — the same work, transferred by
patch. After applying the five missing commits, container `cfa679a` and clone
`e907338` both hashed to `8519be3a…`.

So: **a SHA mismatch across a patch transfer is the expected outcome. Compare
`^{tree}` before concluding two chains diverged.**

## Ali's clone, and why the push cannot happen from here

The working copy is `C:\Users\user\Desktop\MY RESUMES\nexus-os`. It is inside a
connected folder, so `device_bash` can run git in it directly — no staging.

Two things block pushing from this session, and neither is fixable from here:

- The cloud container is not in the session's authorized repository set. The
  git proxy refuses to inject a credential (HTTP 403).
- The clone's `credential.helper` is `manager` — Windows Credential Manager,
  which does not exist in the Linux VM the device shell runs in.

So the pattern is: apply and verify in the clone via `device_bash`, then hand
Ali one `git push` to run in PowerShell. Give him the real path — a literal
`<your repo>` placeholder is a PowerShell parse error, and he has hit it.

**`git am` stalling in the device shell is a permissions symptom, not a
conflict.** git cannot unlink its own `.git/*.lock` files there, so the apply
dies halfway and leaves the repository mid-`am`. Call
`device_request_delete_permission` on the Desktop folder, `git am --abort`,
then re-run clean. Do not try to nurse a half-applied `am` forward with `mv`
tricks — the counter in `.git/rebase-apply` stops advancing and it re-applies
the same commit forever.

## Two WAHA instances are posting the same messages into production

3 Sep 2026, read from saved executions. Executions 9427 and 9428 carry the
**same `body.payload.id`** and different everything else:

| | 9427 | 9428 |
|---|---|---|
| `x-webhook-request-id` | `35bsz6mtlzeem9` | `1mt17mtlzf9bc` |
| `user-agent` | `WAHA/2026.7.2` | `WAHA/2026.7.1` |
| `x-forwarded-for` | `35.224.126.225` (the box) | `2.50.10.149` (external, UAE) |
| `me.jid` | `971526647253:12@…` | `971526647253:8@…` |

A second pair, 9420/9421, carries an identical `payload.id` and started **1 ms
apart** — far too close for a retry. Different build, different source address,
different device index on the same WhatsApp account. This is not one WAHA
retrying; it is **two senders**, and one of them is a host nobody has
accounted for.

So the execution list is pairs: 275 executions is roughly 137 messages. The
only thing absorbing the doubling is `Claim Message Id`. And the control that
would refuse an unknown sender — `WAHA Auth Gate` — is measured `DORMANT` on
that same traffic.

Two things follow. Any count of "messages" taken from the execution list is
roughly double the truth. And an external host is posting WhatsApp traffic into
production through an open door.

### `2.50.10.149` is identified — 6 September 2026

It is **not a stranger.** Executions 10322 and 10323 carry the same `payload.id`
and the same body, and differ like this:

| | 10322 | 10323 |
|---|---|---|
| `x-forwarded-for` | `35.224.126.225` (the box) | `2.50.10.149` |
| build | WAHA/2026.7.2 | WAHA/**2026.7.1** |
| `me.jid` | `971526647253:**12**@…` | `971526647253:**8**@…` |
| `me.id`, `me.lid`, `pushName` | identical | identical |
| `x-webhook-timestamp` | 1788664766034 | 1788664807464 — **41 s later** |

The same WhatsApp account, on a **different device index**, served by a
**second, older WAHA instance on a non-GCP (UAE) host**, running about forty
seconds behind. `reachoutTimelock` is present on one and absent on the other,
which is the build difference showing through the payload.

**And it is never the only sender.** 102 executions sampled over 8h56m
(5 Sep 18:23 → 6 Sep 03:19 UTC), grouped by `payload.id`: **51 distinct
messages, 51 arrived from both sources, 0 from the box only, 0 from `.149`
only.** Headers were read on both halves of 9 of the 51 pairs, spread across the
window; for the other 42 two deliveries were confirmed but not both headers.
Not extrapolated to the full 988.

So on this evidence **arming the gate without configuring `.149` would have
dropped nothing** — with three limits that belong in the runbook: the sample is
nine hours with both hosts up; it contains zero customer conversations; and the
box's WAHA is also the *send* path, so `.149` surviving a box outage would
produce an unanswerable inbound rather than a rescue.

What is still Ali's: **which machine** it is. WhatsApp → Linked Devices will show
device 8 beside device 12.

### And none of this traffic is a customer

Read from `Is Real Inbound?`'s own output rather than judged by eye: **0 of 102
executions — 0 of 51 messages — were genuine customer conversation.** All 51 were
`@g.us` groups, `status@broadcast` or `@newsletter` on Ali's personal handset.
The audit said most of the traffic is not customer conversation; in this window
**none** of it was.

## Corrections to what this file used to say

- **`saveDataSuccessExecution` on the WhatsApp workflow is `"all"`, not
  `"none"`.** The published settings say `all` for both success and error, with
  a 300 s timeout. The MONITOR window is observable today; earlier text here
  said it was not.
- **`Resolve Tenant` runs BEFORE `Claim Message Id`** — fourth node against
  sixth — and `Claim Message Id` **does** send `tenant_id`, taken from
  `Resolve Tenant`'s output. The `nexus_default_tenant_id()` fallback on
  `processed_messages` fires only if `Resolve Tenant` is disabled, which is the
  documented ten-second rollback. Claims file under the right dealership.
- **The claim gate's "side door" is not a live re-entry path.** `Called by
  Master Router` does connect straight to `Extract Message & Sender`, past the
  claim — but `HOT/WARM: Already In A Live Chat?` gate both callbacks on
  `lead.origin === 'whatsapp-bdc'`, and `Shape Lead For Router` always sets it.
  The internal branch also rewrites the item to `direction:'outbound'`, and
  `New Lead Worth Scoring?` requires `inbound`, so the loop is bounded at one
  pass. Zero of 275 retained executions are `mode:"integrated"`; zero
  `'[system] Initial outreach…'` rows exist in `communication_logs` ever.
- **`x-webhook-request-id` is a delivery id, not a message id.** Proven by the
  pair above. So is `body.id` (`evt_…`). The only identifier stable across
  deliveries of one WhatsApp message is `body.payload.id` — which is what
  `Prefilter` and `Claim Message Id` already key on. That design is correct.
- **`body.session` IS present on real inbound traffic**, value `"default"`,
  with `Resolve Tenant` emitting `tenant_source:"waha_session"` on live
  messages. The rollback contingency "WAHA sends no session" is dead; retire
  it. The `channel_registry` cutover has its input field.

## The duplicate inbound rows are a retry, not a second pass

Ten of 83 inbound `communication_logs` rows are near-duplicates — about 12%.
The `W.slam` case is one claim at 06:48:01 and two identical **inbound** rows
at 06:48:23 and 06:48:29. The re-entry path cannot produce that: it would have
written `direction:'outbound'` with the outreach marker.

Inferred cause: `Log Incoming Message` is published with `retryOnFail: true`
and `Prefer: return=minimal`, and it never populates `external_message_id`, so
a POST that commits server-side but whose response is lost gets retried and
inserts a second row with nothing to dedupe it. A unique index on
`(tenant_id, direction, external_message_id)` now exists and is inert until a
writer sends the column — that node is the writer to fix.

## The WhatsApp messaging layer — wired, never fired

4 Sep 2026. Four agents built a provider-agnostic messaging layer in the
database. **None of it has carried a real customer message.** Everything below
is applied to production and to staging at byte parity, and every part of it is
`service_role`-only with `anon` and `authenticated` refused by grant.

WAHA is temporary. The production transport is meant to be the official
WhatsApp Business Cloud API, and each dealership chooses. So nothing in NEXUS
core may know which provider carried a message.

**`channel_registry`** — tenant from a trusted integration identity, not from
an env var and not from anything the caller names. `whatsapp_waha_session` and
`whatsapp_cloud_phone_number_id` are both valid namespaces; the Cloud one is
still empty. The resolver returns a **set**, so unresolved is zero rows and an
n8n branch halts on it.

**The Message Policy Engine** — `whatsapp_policy_decision_for_channel(...)`
answers `FREEFORM_ALLOWED | TEMPLATE_REQUIRED | BLOCKED` with the reason, the
`policy_rule` row it applied, that rule's verification status, and what would
change the answer. No `SECURITY DEFINER` anywhere in it, and no model in the
path — the arguments are identifiers and a timestamp, so a message body cannot
become one.

**The 24-hour customer service window is Meta's rule, not a dealer setting.**
It lives in `policy_rule` under jurisdiction `PLATFORM_WHATSAPP`, seeded
`NOT_VERIFIED`, and the number `24` appears in no function body. Withdrawing
the rule produces `TEMPLATE_REQUIRED / POLICY_RULE_MISSING`, not a fallback.
One rule is deliberately filed under `NEXUS_HOUSE` instead — NEXUS refuses
marketing without evidenced opt-in even inside an open window, which is
stricter than the platform, and it is recorded as our choice rather than
Meta's requirement.

**Cloud API is structurally better than WAHA and the adapter must not squander
it.** Meta signs every webhook with `X-Hub-Signature-256` — HMAC-SHA256 over
the **raw bytes**, so hashing a re-serialised JSON object never matches; and
the tenant comes from Meta's own `metadata.phone_number_id`, not a
caller-chosen string. A CHECK constraint makes this structural: a
`whatsapp_cloud` row in `channel_message_events` cannot exist unless
`origin_verified = 'hmac_sha256_x_hub'`.

Write nothing before the signature verifies. The reason that matters most is
not storage: **claiming a `wamid` before verification is a denial of service on
a real customer** — the genuine Meta delivery then looks like a duplicate and
is silently dropped, and nothing appears broken.

**Never invent a messaging cost.** `whatsapp_message_usage` has **zero numeric
columns** and the monthly rollup has no total. `cost_state` distinguishes
"awaiting a provider report", "provider reported no pricing", "provider said
not billable" and "billable, amount unknown" — and a screen may not render any
of them as zero. Meta's `pricing` and `conversation` objects are stored
verbatim as provider-reported facts.

**NEXUS's template record is a cache, not an approval.** `nexus_state` and
`provider_status` are separate, an APPROVED with no observation timestamp is
unsavable, and `whatsapp_template_sendability()` takes a staleness tolerance
with **no default** — the caller must state how old an answer it will accept,
and that tolerance is recorded on the usage row. A 40-day-old APPROVED refuses.

**The router never selects a provider on cost.** Order is: conversation
continuity, then the official platform first, then earliest registered.
`channel_provider_rank` has no cost column, and
`nexus_provider_router_invariants()` fails if one appears — and fails again if
WAHA ever gains a capability Cloud lacks, which is the only route by which the
capability filter could push a send downward. Using an unofficial transport to
avoid an official platform's charges is a policy bypass, and the number at risk
of a ban is the dealership's own business line.

### A dealership could legislate as Meta, until 4 Sep

An adversarial pass proved this on production, as the ALBA CARS owner acting
as role `authenticated` — a signed-in dashboard user, no `service_role`, no
n8n — using only functions that carry EXECUTE for `authenticated`:

    propose PLATFORM_WHATSAPP / WA_CUSTOMER_SERVICE_WINDOW_HOURS = 99999  -> ok
    verify that same rule themselves                                      -> ok
    decision: TEMPLATE_REQUIRED -> FREEFORM_ALLOWED, AUTHORITATIVE,
              window_hours 99999, jurisdiction PLATFORM_WHATSAPP

Two facts combined: `policy_verify_rule` guarded *scope* but not
*jurisdiction*, and the lookup ordered `(tenant_id is null)` ascending, so a
tenant rule **outranked** the global one. The audit trail then said Meta had
said so.

Fixed by making it unrepresentable rather than refused. A jurisdiction is now
a namespace with an owner (`policy_jurisdiction`), the owner kind is pinned to
the rule by a composite foreign key, and a CHECK ties scope to ownership: a
dealership row under `PLATFORM_WHATSAPP` cannot exist. The lookup no longer
*orders* by scope — scope is a filter derived from ownership, so there is no
direction left to invert. A dealership may still hold house rules under
`TENANT_HOUSE`, and one is applied only when it is **strictly stricter** than
the platform's; a longer window is recorded as considered-and-ignored.

**The lesson worth keeping: a guard on scope is not a guard on authority.**
Asking "may this actor write a row of this shape" is a different question from
"may this actor speak in this name".

### And the platform-verification path exists now

`policy_verify_rule` returned `NO_SESSION` to `postgres` and `service_role`, so
nobody — not even the platform operator — could verify a global rule. That, not
policy, was why every conversation returned `TEMPLATE_REQUIRED`.

`policy_platform_verify_rule()` is `service_role`-only and demands an
attestation: a named person, a reachable contact, a source kind, an openable
reference, and the day it was read. No session means the actor cannot be
derived, so it must be stated. A global rule cannot reach `VERIFIED` without
one.

**Ali still has to check the WhatsApp rules against his own Meta account.** The
road is built; nobody has driven it. Production holds zero attestations and
zero verified rules.

### Corrections earned by measurement, 4 Sep

- **"Applied at byte parity" was wrong.** `md5(prosrc)` differs on 34 of 105
  functions between production and staging. Comment-and-whitespace-stripped
  they all match — staging's copies were applied with `--` comments removed —
  but the honest claim is *semantic* parity, and it must be stated that way.
- **"`service_role` only, `anon` and `authenticated` refused by grant" was
  wrong**, and the way it was wrong matters more than the claim.
  `channel_registry` carries **column-level** grants: `authenticated=r` on
  seven of eight columns with `credential_ref` deliberately withheld. That
  design is right — but **the ACL query prescribed above reads `relacl` and
  cannot see it**, and would report the table as `service_role`-only. Check
  `pg_attribute.attacl` as well, or the check is blind to exactly the grants
  someone took care over.
- **The template staleness gate was wired to nothing.** The function behaved
  as designed and the router never called it — it called a stub returning
  `UNVERIFIED_REGISTRY_PRESENT_NOT_WIRED` and set `SEND` before it. A 40-day
  stale APPROVED, a provider-REJECTED template, a NEXUS-retired one and a
  reference that never existed all returned `SEND / SENDABLE_TEMPLATE`. Now
  wired; the router takes a staleness tolerance with no default and refuses for
  want of one.
- **`channel_message_events` *can* hold an outbound `whatsapp_cloud` event** —
  by claiming a signature it does not have. The CHECK demands
  `hmac_sha256_x_hub`; recording an outbound with the honest value
  `shared_header` is refused, and claiming the signature is accepted. So the
  constraint pressures the writer into asserting something it cannot have, and
  `origin_verified` on an outbound row is evidence of nothing.
- **The forged-send CHECK is real but shallow.** It holds on NULL, empty string
  and out-of-vocabulary values, and on nothing else. `policy_decision` is bare
  `text` and `policy_applied_rule_id` a bare `uuid` with no foreign key,
  because **no decision entity is persisted anywhere** — the function returns a
  row type. A decision belonging to a different tenant, customer or
  conversation, or one taken 30 days ago against a window that has since
  closed, all insert cleanly. A tenant A directive naming tenant B's
  `integration_id` inserted cleanly too.
- **Two cracks in idempotency.** The key includes `requested_by`, which is
  caller-declared and defaults to a placeholder — two n8n nodes retrying the
  same logical send under different names produce two sends; and a null
  `request_ref` disables it entirely. Separately,
  `whatsapp_record_customer_message` ignores `external_message_id` and upserts
  on timestamp alone, so **replaying one message with a later timestamp extends
  the customer service window** — which is the fact that turns
  `TEMPLATE_REQUIRED` into `FREEFORM_ALLOWED`. Given two WAHA hosts posting the
  same `payload.id` and a retrying `Log Incoming Message`, that is the live
  traffic shape.

### Refusals must raise, not be returned in a column

`policy_verify_rule` and `policy_supersede_rule` signalled refusal as
`ok=false` and raised nothing. A `PERFORM` or an ignored column read as
success — the QA agent made exactly that mistake and filed a false finding
from it. The four dealership policy write functions now raise SQLSTATE `NX001`
with the machine code in `DETAIL`, the sentence in `MESSAGE` and the next step
in `HINT`, so PostgREST hands a dashboard all three.

### One blocker this layer still cannot clear itself

- **`policy_verify_rule()` refuses global rules by design** — "global rules are
  verified by the platform" — and no platform-verification path exists. So the
  window rule stays `NOT_VERIFIED`, and **every conversation in production
  returns `TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED` today.** That is the
  engine being honest, and it is also the single thing standing between this
  layer and being usable. Someone with the Meta Business account has to check
  the rule, and a platform-verification function has to exist to record that.
- **`channel_message_events` cannot hold an outbound `whatsapp_cloud` event** —
  its signature CHECK demands `hmac_sha256_x_hub`, right for an inbound
  webhook, impossible for a call we made ourselves.

### Two defects the router's own probes found, worth remembering

A CHECK constraint of the form `a OR b` **passes on NULL** — CHECK rejects only
FALSE. The "a SEND requires a policy decision" guarantee did not structurally
exist until an explicit `is not null` was added, and a forged send inserted
cleanly until then.

And a `row_number()` that counted ineligible candidates put WAHA first for a
template send it cannot carry, so the router asked the policy engine with a
NULL integration and got back `CHANNEL_NOT_REGISTERED_TO_TENANT` — **a tenancy
alarm raised by a ranking bug.** It failed closed, which is what the
constraints bought.

## Two planes, and the boundary between them

4 Sep 2026. NEXUS is a product Ali sells to dealerships, so there are two
audiences and they must not see the same screen.

- **Control Plane** — platform users, tenants, subscriptions, licences,
  entitlements, usage events, workflow and node health, error events,
  releases, support cases. Ali's.
- **Dealer Data Plane** — customers, leads, messages, vehicles, deals,
  finance, compliance, campaigns, actions, audit. The dealership's.

Least privilege applies to Ali too: platform telemetry by default, customer
content only through an audited support path. On Cloud he holds the database
credentials and nothing in software prevents him bypassing that path — the
document says so rather than pretending otherwise.

**The audit of what the dashboard shows today found no cross-tenant leak and
no secret rendered.** The finding is different and more ordinary: *the
operator's instrumentation accumulated inside the customer's product.*
`settings.js:1402` tells a dealership that one n8n instance serves every
dealership; `workflow_registry` is `SELECT USING (true)` for `authenticated`
with no `tenant_id` and 18 rows of workflow ids, cron expressions and webhook
paths (**that one is closed — see the `workflow_registry` bullet above; it is
off the dealer plane entirely as of 6 Sep 2026**); `automation.js` renders n8n
execution deep links, node names and
"spends OpenRouter tokens"; `ask.js` prints the model ladder and the prompt
budget. The operating rule is: **symptom and impact to the dealership;
mechanism and location to the vendor.**

**Self-hosted telemetry is a fiction.** That is what self-hosting means. A
licence check can gate first-run setup, carry an expiry and be revoked; it
cannot prove the software stopped running, report health, or count active
dealerships. Any control-plane design that assumes it can see a self-hosted
installation is designing against a customer who can block it at the firewall.

## The node count is 334, not 250-300

Read from the published definitions on the box, 4 Sep. 21 workflows, 334
nodes. **19 carry a published version; two have none at all** — Phase 6
Silence Detector and NEXUS Infra Health Probe, 12 nodes each,
`activeVersionId: null`.

That second one matters: **nothing is watching the WhatsApp channel.** The
Infra Health Probe is the schedule trigger, the WAHA session check and the
alarm that throws into the error workflow, and it has never been published.
`workflow_registry` reports `is_active = true` for both — the registry and the
box disagree, and the dashboard reads the registry.

**There is no run-marker column anywhere** — no `journey_id`, `test_run_id` or
`is_test` on any of the 58 tables. So a journey's test data is marked
structurally by `tenant_id` (NOT NULL everywhere, therefore unforgettable) and
by an RFC 2606 `.invalid` email namespace, with an external primary-key
manifest and a three-snapshot cleanup proof. Cleanup fails on collateral even
when every assertion passed.

And a phone number is not safely fakeable: `Guard Reply` filters content, never
the recipient. Either journeys run against a WAHA session on a controlled
device, or the send legs stay blocked.

## The idempotency family, and what the release verifier found

4 Sep 2026, two independent passes. The first fixed six identities; the second
verified PR #6 and found four things the branch's own author had not seen.

### The window could be extended by replaying a message

`whatsapp_record_customer_message` ignored `external_message_id` and upserted
on `last_customer_message_at` alone. Replaying one message with a later
timestamp moved the window forward six hours. Proved end to end:

    genuine customer message 30h ago  -> TEMPLATE_REQUIRED / WINDOW_CLOSED
    redelivery of the same payload.id -> FREEFORM_ALLOWED  / WINDOW_OPEN

That is not a data bug. `last_customer_message_at` is the single fact that
turns `TEMPLATE_REQUIRED` into `FREEFORM_ALLOWED`, so a replay was **NEXUS
granting itself permission to send outside Meta's window** — and with two WAHA
hosts posting the same `payload.id` and a retrying `Log Incoming Message`, it
was reachable from live traffic.

Fixed with `whatsapp_customer_message_seen`, keyed on the window's own identity
plus the message id. A single `last_seen_id` column would not work — A→B→A
defeats it, tested. A null `external_message_id` is **refused**: accepting one
restores the whole defect through another door, because with nothing to dedupe
on every redelivery looks new.

### An actor is not part of an event's identity

`nexus_request_send` keyed on `(tenant_id, requested_by, request_ref)`, and
`requested_by` is caller-declared. Two n8n nodes retrying the same logical send
under different names produced two sends; a null `request_ref` disabled
idempotency entirely. Both closed, and a null ref now refuses rather than
silently going unkeyed.

**Four more of the same shape**, found by looking for it deliberately:
`channel_message_events`'s key omitted `integration_id`; the directive was not
bound to its carrier; and `whatsapp_opt_in_event` **had no key at all** — so
replaying the same consent evidence with a bumped timestamp overturned a later
OPT_OUT, taking a conversation from `BLOCKED / CUSTOMER_OPTED_OUT` back to
`FREEFORM_ALLOWED`. Defect one's shape applied to consent withdrawal.

**Still open and stated rather than papered over:** a decision from a
*different conversation* cannot be closed by a constraint, because no decision
entity is persisted — `policy_applied_rule_id` is a bare uuid with no foreign
key and there is no row to compare against.

### The gate had been exempting workflow_registry all along

This file has said for a day that `workflow_registry` is "deliberately NOT
exempt" and "left failing on purpose". Measured against the base gate: its
filter was the substring regex `/reason_codes|workflow_registry/`, so
`workflow_registry` **was being silently exempted and was not among the
failures**. The claim was true of the intent and false of the artefact. It
fails by name now, with its reason.

**And on 6 September 2026 it stopped failing, by being fixed rather than
named.** The table is off the dealer data plane and `workflow_registry_read`
no longer exists, so it is not an open policy for the gate to judge. Nothing
was added to `L2_EXEMPT_TABLES`; `L2_NOT_EXEMPT_NOTES['workflow_registry']` is
left in place and is now dormant — it only prints if somebody re-creates a
`USING (true)` policy on that table, which is exactly when it should.

### `policy_platform_attestation` is on the wrong plane

Ten column-level `authenticated=r` grants and a `USING (true)` policy, with
**no `authenticated` entry in `relacl` at all** — so the ACL query prescribed
in this file, and the gate's own `l2AuthenticatedAclLetters`, both report it as
`service_role`-only. It is not. Every signed-in dealership user can read who
attested a global rule, their email, the source they read and when. Zero rows
today, so this is exposure of an empty table — but attestations are control
plane, and this is the dealer data plane.

### Three smaller things worth carrying

- **L5 is blind to a PUBLIC grant.** Its filter is `/anon=X/`; L4's also
  matches `/=X/`. `anon` inherits PUBLIC, and one PUBLIC-granted function
  exists. A future `CREATE OR REPLACE` adding `SECURITY DEFINER` and a tenant
  read to it would be invisible to L5 — the exact "no grant-shaped diff to
  review" shape that has opened three holes here.
- **The catalogue's 24-hour freshness tolerance is a fuse, not a lock.** A
  catalogue 23.92 hours old was accepted and produced a full live verdict — for
  a database with 60 functions where live had 110.
- **`applied_rule_*` names the wrong rule when a house rule closes the window.**
  The hours come from `TENANT_HOUSE` while `applied_rule_jurisdiction` reads
  `PLATFORM_WHATSAPP`. Anything persisting only `policy_applied_rule_id` will
  attribute the dealership's own decision to Meta — the same shape as the
  defect above it, one layer up. The truth is in `rules_considered`.

### Staging is not yet a faithful rehearsal

Semantic parity is exact — 110 functions, 356 constraints, 167 indexes, 161
policies, identical. But production carries seven `channel_registry` **column**
grants and staging carries none, and that is the table the tenant resolver
reads. Rehearsing the tenant-map switch there proves less than it appears to.

## anon read 8,500 rows, and the guard does not cover the door it came through

4 Sep 2026, proved by execution, not inferred.

The 2 September closure revoked default privileges for role **`postgres`
only**. Supabase carries a second line for **`supabase_admin`** in `public`,
and it was never closed. `CREATE EXTENSION … SCHEMA public` — run *by
postgres* — produces objects *owned by supabase_admin*, so a probe table
arrived with `anon=arwdDxtm` and **RLS off**, and `anon` then read **8,500
rows from it**. `REVOKE … FROM anon` as postgres returned SUCCESS and changed
nothing: the non-grantor no-op, exactly as this file warns.

The `postgres` line was also only half closed — a table created by an ordinary
migration was born with `authenticated` holding **TRUNCATE and DELETE**, and a
sequence with `setval()`. The 3 Sep pass narrowed the objects that existed and
never touched the default, so the defect was set to recur on every migration.

Both are closed now. The `postgres` line is narrowed to `SELECT` for
`authenticated` on tables and nothing on sequences — the FUNCTIONS line is
deliberately left, because every `rpc/*` the dashboard calls depends on it.
The line postgres does not own is handled by an event trigger,
`nexus_guard_born_open_grants()`, which is **`SECURITY INVOKER` on purpose**:
an event-trigger function runs as the role that ran the DDL, so the REVOKE
inside it executes *as the grantor* and bites. `SECURITY DEFINER` would run it
as postgres and turn it straight back into the proved no-op.

**Three things are not closed, and pretending otherwise would be worse than
the defect:**

- **The guard does not fire for `CREATE EXTENSION`** — measured with an
  instrumented trigger, which logged `CREATE TABLE` and `CREATE SEQUENCE` and
  logged nothing for `create extension`. That is the exact path that produced
  the 8,500-row read. **Operational rule: install extensions into
  `extensions`, never `public`.**
- **The one lever that would close it — `revoke usage on schema public from
  anon, public` — was not pulled.** Revoking from `anon` alone changes nothing
  (PUBLIC still holds `=U`); revoking from PUBLIC too returns 42501. Eleven
  roles hold that USAGE only through PUBLIC, including **`authenticator`, the
  role PostgREST logs in as**. That is a plausible whole-API outage and needs a
  rehearsal against a live REST endpoint first.
- **A third default-ACL line nobody has looked at:** `postgres` / `storage`
  still grants `anon` ALL on new tables and `rwU` on new sequences. Postgres
  owns that one, so it *can* be closed.

`policy_jurisdiction` and `policy_platform_attestation` are off the dealer data
plane now — revoked, not viewed, because `v_policy_rule` already carries the
verification facts a dealership legitimately needs and a second view would be a
second derivation of the same figure. Neither was added to the exemption map.
L2 is down from three failures to one, and the one left is the one deliberately
left red.

And a detection lesson: `inventory_actions_touch()` reached `anon` on both
projects, but via a **direct** grant on staging and via **PUBLIC** on
production. A sweep written as `proacl like '%anon=%'` flags staging and clears
production, which is exactly as reachable. The direct-vs-PUBLIC rule applies to
the *detection query*, not only to the REVOKE.

## The consent fix was half done, and messaging must not be switched on

Adversarial regression, 4 Sep. `recorded_by` was correctly removed from
`whatsapp_opt_in_event`'s identity — and **two other caller-controlled fields
were left in it**: `evidence_kind` and `evidence_ref`, both free text. So a
conversation that reached `BLOCKED / CUSTOMER_OPTED_OUT` returns to
`FREEFORM_ALLOWED` by three routes, none involving the customer:

- the same consent replayed under a different `evidence_ref`
- the same consent replayed under a different `evidence_kind`
- an OPT_IN dated 2099 — there is no temporal CHECK

And the tiebreak at an identical `occurred_at` **is not deterministic and
resolves toward consent**: `recorded_at` defaults to transaction time, so a
writer recording both events in one transaction ties on both sort keys and heap
order decides. Proved concurrently too — two OPT_INs racing an OPT_OUT across
three real backends returned `OPTED_IN`.

Today, with the window rule `NOT_VERIFIED`, that forgery sends a **marketing
template to someone who sent STOP**. After attestation it sends a free-form
message.

Compare `whatsapp_record_customer_message`, which refuses a null id and carries
a 400-character hint warning against per-delivery ids. The consent writer has
no equivalent discipline, and **no caller exists yet** — which is exactly why
the discipline must be structural before one is written.

**The window fix holds against every stable-id replay, including A→B→A — and
was defeated by the live `nokey:` shape, and is not any more** (5 Sep 2026: a
CHECK on `whatsapp_customer_message_seen`, `processed_messages`,
`channel_message_events` and `whatsapp_delivery_events` refuses ids minted per
attempt — `nokey:`, `outreach:`, `exec-`, `run-`, `job-`, and bare numeric ids.
The **node** still mints them, so the writer change in
`ops/n8n-bundle-NOT-DEPLOYED/04-*` is still owed).** `whatsapp_bdc_ai_agent.json:713`
mints `'nokey:' + $now.toMillis()` when the message id is absent: a
per-delivery id that changes on every retry, which is precisely what the
function's own hint warns against. Two `nokey:` ids for one message jump the
window to now.

**`nexus_request_send` is the one of the six that is properly finished** — all
five attacks held, including a genuine two-backend race.

Six more found by looking where nobody had: `whatsapp_delivery_events` keys on
unnormalised `status_raw`, so `delivered` and `DELIVERED` double-count, and its
key **omits `integration_id`** — the defect just fixed one table over — so a
second integration's genuine delivery report is silently dropped. Template
identity duplicates through a nullable `waba_ref`. And **seven of nine tables
carrying both `tenant_id` and `integration_id` accept a mismatched pairing** —
the functions check `channel_registry`, the tables do not, and `service_role`
writes tables directly.

A SEND can also cite a decision belonging to a different customer, or the
finance `MAX_LTV_PCT` rule, or a rule id that exists nowhere — because
`policy_applied_rule_id` is a bare uuid. **The cheapest real fix is one
constraint:** a foreign key to `policy_rule(id)`.

**Verdict: the idempotency family is not safe enough to switch WhatsApp
messaging on.**

## Consent identity, closed

4 Sep 2026. Five migrations, both projects, fingerprint identical across 279
objects. Production held zero consent rows before and after — no backfill,
nothing deleted.

**The key is now two constraints, not one.** `UNIQUE (tenant, integration,
customer, event, occurred_at)` is the act — "this customer said yes or no at
this moment on this channel", and nothing a caller invents is in it. A second
constraint pins evidence as a *property*: one reference attests one act,
normalised by `lower(btrim(…))`, with **`evidence_kind` deliberately absent**
so relabelling cannot mint a row and **`event` absent** so one reference cannot
attest both a yes and a no.

Dropping evidence from the key alone would have re-opened "identical evidence
at a bumped timestamp"; keeping it in the key was the original defect. It takes
both constraints to close both directions.

**`occurred_at` is bounded, asymmetrically, and the asymmetry is the point.** A
future OPT_IN is **refused** — a stored-but-ignored row reads as consent to
anyone auditing the table, and this codebase has already paid repeatedly for
"unknown rendered as a fact". A future OPT_OUT is **clamped to now** with the
stated time kept in notes, because a clock disagreement must never be the
reason a customer who sent STOP keeps being messaged.

**The tiebreak is structural and can only fall one way.** A generated,
unwritable `consent_rank` column puts OPT_OUT ahead of OPT_IN, and the
canonical order is `occurred_at desc, consent_rank asc, recorded_at desc,
id desc`. The two hand-written ORDER BYs that had to agree are gone — both
consumers now call one function. **The answer no longer depends on commit
order**, proved with five separate `pg_cron` backends whose execution windows
overlapped: two OPT_INs racing an OPT_OUT now returns `OPTED_OUT`.

**Overturning a STOP is held to a higher standard than granting consent in the
first place.** A first opt-in may rest on the recording system's word. A
reversal may not use `OPERATOR_RECORDED` or an import, and must cite evidence
NEXUS can resolve **to a row it already holds, dated after the withdrawal** —
the customer's own measured inbound message, or an audit row of that tenant's.
A bare uuid, a bare epoch, an `exec-`/`run-`/`job-`/`nokey:` prefix, or a
`wamid` NEXUS never observed are all refused by name.

All three original forgery routes, the tie, and the concurrent race now return
`BLOCKED / CUSTOMER_OPTED_OUT` — including with the platform rule attested
inside the transaction, which is the severity that will actually matter.

**What is left is not a consent defect.** There is no `SECURITY DEFINER` here,
so `service_role` writing the table directly bypasses the writer's checks; the
CHECKs and the derivation's own future-filter still bite, but a direct insert
of an OPT_IN one microsecond after an OPT_OUT still reads as consent. n8n holds
`service_role`. **The writer is the disciplined door, not the only door**, and
closing it properly means moving consent reversal onto a named-human path
rather than the n8n key — an authority question, the same lesson as
`policy_verify_rule`, and it deserves its own pass.

## The door was the schema, not the ACL

4 Sep 2026. The exposure was reproduced exactly: `CREATE EXTENSION postgis
SCHEMA public` as **postgres** produced `public.spatial_ref_sys` owned by
`supabase_admin`, RLS off, `anon=arwdDxtm` — and `anon` read **8,500 rows**,
inserted, updated and deleted. **Not read-only. Writable.**

**Root cause: `supautils`.** Supabase re-runs `CREATE EXTENSION` as
`supabase_admin` for the 70 names in `supautils.privileged_extensions`, and it
**skips non-superuser event triggers** — there is a
`supautils.log_skipped_evtrigs` setting for exactly this. Proved with three
triggers running simultaneously (untagged `ddl_command_start`, tagged
`ddl_command_start`, tagged `ddl_command_end`): all three logged a `CREATE
TABLE` in the same transaction, **none logged the `CREATE EXTENSION`**.

So the answer to "can the guard be made to cover it" is **no**, and a
scheduled sweep would not have been an answer either — a sweep cannot
remediate what it cannot out-race.

**The earlier 42501 on revoking schema USAGE did not reproduce.** `postgres`
is a member of `pg_database_owner`, which is the grantor. So the door that was
thought shut was open. `USAGE` is now revoked from `PUBLIC` and `anon` and
re-granted **by name** to the eleven service roles that held it only through
PUBLIC; the thirteen `pg_*` roles need no grant, because
`pg_read_all_data`/`pg_write_all_data` confer schema USAGE implicitly.

### The verification that matters, and the lesson in it

With the door shut, postgis was installed **for real** on staging.
`relacl` still read `anon=arwdDxtm`. `has_table_privilege('anon', …)` still
returned **true**. And `GET`/`POST /rest/v1/spatial_ref_sys` with the anon key
both returned **401, `42501 permission denied for schema public`** — `42501`
and not `PGRST205`, which proves PostgREST had the table cached and refused
anyway.

**ACL metadata was the wrong witness.** Every ACL sweep this project has run —
including the ones in this file — would have called that table exposed. The
reachability probe is the one that told the truth.

### Extensions are contained, not migrated — and the reason matters

`ALTER EXTENSION … SET SCHEMA extensions` succeeds, and doing it would break
the RAG path: `search_rag_documents` is pinned `search_path='public'` and its
trigram tier calls `word_similarity()` unqualified, so after the move that is
`42883 function does not exist`. A first test appeared to pass only on a cached
plan. Production holds 15 live `rag_documents` rows.

**Prerequisite for any later migration pass:** change `search_rag_documents`
and `nexus_tenancy_readiness` to `search_path = public, extensions` *first*.

The rule, written down: **extensions belong in `extensions`, never `public`.**

### What is still open, and it needs Supabase

**`authenticated` still reaches born-open objects** — measured live: SELECT
8,500 rows, UPDATE one row. It cannot lose `USAGE` on `public`, because the
dashboard lives there. Closing it needs Supabase to either close the
`supabase_admin` default-ACL line for `public` or pin extensions via
`supautils.extensions_parameter_overrides`. Both are config-file settings and
both return **55P02 "cannot be changed now"** from SQL.

`nexus_public_exposure_report()` reports reachability rather than ACL —
currently **anon 0, authenticated 149**. It reports and does not remediate,
because here a sweep genuinely cannot.

Reversal, if the schema revoke ever needs undoing, is one statement:
`grant usage on schema public to public;`
