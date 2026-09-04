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
- `tenants.is_unattributed_default` means an omitted `tenant_id` lands in
  whichever dealership holds the flag. Harmless with one; wrong with two. Either
  point it at a quarantine tenant or convert the remaining omissions to explicit
  nulls.
- **`workflow_registry` is readable by every signed-in user and is not
  tenant-scoped.** Its policy is `SELECT USING (true)` for `authenticated`, and
  the table has no `tenant_id` column — which is survivable only because there
  is one dealership. It holds the real n8n workflow ids, names, trigger detail
  and `is_active` flags, i.e. which automations a dealership runs and which are
  switched off: operational configuration, not shipped vocabulary. Give it a
  `tenant_id` and a scoped policy before onboarding a second dealership.
  Measured and left failing on purpose: `QUALITY_GATE.mjs` check **L2** is red
  on exactly this row, and `workflow_registry` is deliberately excluded from
  `L2_EXEMPT_TABLES` so the finding stays visible instead of being absorbed
  into an exemption list.

`select * from public.nexus_tenancy_readiness();` is the live gate — but note
its remaining BLOCKER fires whenever any tenant holds the default flag and
cannot see n8n at all, so it will not clear from workflow work. Read it with
that in mind.

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
was wrong. `finance_quotes` shows 16 inserts and 13 deletes in
`pg_stat_all_tables` — the insert path has worked repeatedly and a journey
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

Also: `slack-command` is closed **by accident**, not by design — its
`Tenant For JWT User` lacks `alwaysOutputData:true`, so the chain halts before
`Auth Gate` runs, and unauthenticated probing records SUCCESS with no audit row.

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
roughly double the truth. And an external host is posting genuine WhatsApp
traffic into production through an open door; find out what `2.50.10.149` is
before arming the gate, because arming it will cut off whichever sender is not
configured with the secret.

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
paths; `automation.js` renders n8n execution deep links, node names and
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
