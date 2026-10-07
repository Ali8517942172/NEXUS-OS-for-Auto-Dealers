# `workflow_registry` off the dealer data plane — 6 September 2026

Migration: `20260906042024_workflow_registry_off_the_dealer_plane_via_vendor_accessor`
Applied: staging `wwspuxrbiyagnrnzgate` (`20260906041847`) first, then production
`dsvuoovivysszdoiorch` (`20260906042024`).
Repo file: `supabase/migrations/20260906042024_workflow_registry_off_the_dealer_plane_via_vendor_accessor.sql`
md5 parity: file `6cca2bbcf8658df2429dffc6177f01f5` == `md5(statements[1])` on **both**
projects, length 10360, one statement, no trailing newline (last byte `;`).

`QUALITY_GATE.mjs` was read and **not edited**. Nothing was added to
`L2_EXEMPT_TABLES`. No row was created in either database to satisfy a check. No
git command was run. The production n8n box was not written to.

---

## 1. The design question, and why the obvious column was the wrong answer

The brief asked for a `tenant_id` and a scoped policy, and the measurement says
that is a shape that fits the check rather than the truth.

**The 18 rows are the vendor's, not a dealership's.** They are NEXUS's register
of the n8n workflows the platform runs. Three of them —
`NEXUS Public — Home` / `— Privacy` / `— Terms` — are NEXUS's own marketing and
OAuth-consent pages and serve **no** dealership at all. And **no measurement
anywhere in this database maps an automation to a dealership**: there is no
enrolment table, no join, nothing derivable. `v_workflow_health` computes health
from the caller's own `audit_log` rows, but a workflow with no audit rows in a
tenant is `NEVER_RAN` / `NOT_INSTRUMENTED` — which is exactly what that view
exists to say — so membership cannot be derived from audit rows either without
deleting the rows the view is for.

So the three candidates, and why two were rejected:

**Rejected — a `tenant_id`, nullable-meaning-platform.** Every row would be NULL
for ever. The policy would read `tenant_id is null or tenant_id in
(nexus_current_tenant_ids())`, whose left arm is true for all 18 rows: a
predicate that filters nothing, written so it reads like a scope. It would clear
`L2` (the qual is no longer the literal `true`) while changing what a dealership
can see by exactly zero rows. That is the definition of chasing the check.
A *non*-nullable `tenant_id` is worse: it can only be populated by inventing
18 mappings that no measurement supports, and one of those inventions would be
"NEXUS's privacy page belongs to Tenant A".

**Rejected — splitting the table.** A vendor half (`id`, triggers, cadence) and a
dealer-safe half (the naming/alias projection the views need). The dealer-safe
half still needs `authenticated` to read it, therefore still needs a
`USING (true)` policy for `authenticated`, therefore is the identical `L2`
finding under a new name — the failure is relocated, not closed. It also creates
a second copy of the same names, which `NEXUS_INVARIANTS.md`'s "one figure, one
derivation" rule exists to prevent, and a sync problem between the two.

**Chosen — the table leaves the dealer data plane entirely, and a vendor-owned
accessor answers the dealership's question.**

- `workflow_registry`: no table privilege for `authenticated`, no column
  privilege, and `workflow_registry_read` **dropped**. `workflow_registry_deny_anon`
  (RESTRICTIVE, anon, `USING false`) and `workflow_registry_service_role_all` are
  untouched, as is every `service_role` privilege.
- `public.nexus_workflow_catalogue()` — `SECURITY DEFINER`, `STABLE`,
  `SET search_path = public, pg_catalog`, owned by `postgres`. EXECUTE granted to
  `authenticated` and `service_role`, revoked from `anon` **and** PUBLIC (a direct
  grant and a PUBLIC grant are separate ACL rows; both named). It returns
  `name, audit_name, audit_aliases, category, description, is_active,
  writes_audit_log` and **cannot** return `id`, `trigger_type` or
  `trigger_detail` — they are absent from its result type. The withholding is now
  structural, where before it was seven column grants somebody had to remember.
- All four `security_invoker` views read the accessor instead of the table.

**Why a function and not a view.** A `security_invoker` view is checked against
the caller's privileges on **every base column its body reads**, not on the
columns the outer query asked for — that is what forced `v_workflow_health` to be
rebuilt on 5 September. With the table closed to `authenticated`, any object whose
body reads it must be `SECURITY DEFINER`, and a view cannot be: the event trigger
`nexus_require_security_invoker_views` and gate check `L3` both require
`security_invoker = true` on every view in `public`. A function is also the
honest object here for a second reason: it is an **interface with an owner**. A
table grant can only say "you may read these columns"; a function can say "the
vendor answers this question on your behalf", which is CONTROL-PLANE.md 2.4's
rule, and it is the single place a per-dealership filter goes the day a fact
exists to filter on.

**A membership gate came with it, and it is the part that actually closes
enumeration.** A caller acting as `authenticated` or `anon` gets rows only if
`exists (select 1 from public.nexus_current_tenant_ids())`; every other caller
(`service_role`, `postgres`, the nightly batches) gets the register. The idiom is
`coalesce(current_setting('role', true), 'none')`, which is what
`nexus_scoped_tenant_id()` already uses, and it fails **open** for the platform
and **closed** for a dealership session — the direction that matters. A PostgREST
caller cannot change that GUC.

**What this does NOT close, stated so nobody finds it later and calls it a
regression.** A session that IS a member of an active dealership still sees
**18 rows** through `v_workflow_health` and can count them. That is deliberate:
CONTROL-PLANE.md Part 4 says a dealership is entitled to know whether its
automations are running, and the view is the sanctioned projection. The brief's
"a dealership cannot enumerate or count the vendor's automations" and its "18
rows still reach a dealership session" cannot both hold literally, and the second
is the one Part 4 requires. What changed is that the **table** is unreachable
(ids, triggers, row count, and every future column and row the vendor adds), and
that a signed-in session belonging to **no** dealership now gets zero where it
previously enumerated all 18.

---

## 2. Measured BEFORE, production

```
relacl        = postgres=arwdDxtm/postgres | service_role=arwdDxtm/postgres
column grants = authenticated=r/postgres on name, audit_name, category, is_active,
                description, writes_audit_log, audit_aliases
                (id, trigger_type, trigger_detail: no grant)
auth_privs    = {SELECT}   (has_table_privilege / has_any_column_privilege)
policies      = workflow_registry_deny_anon        RESTRICTIVE ALL  {anon}           USING false
                workflow_registry_read             PERMISSIVE  SELECT {authenticated} USING true
                workflow_registry_service_role_all PERMISSIVE  ALL    {service_role}  USING true
rowcount      = 18 ; RLS on ; force RLS off ; owner postgres ; no tenant_id column
```

Gate, run against the 5 Sep catalogue before any change:
**PASS 26 · FAIL 2 · WARN 2 · NOT RUN 6, exit 1** — `L2` and `L9` failing.
`L2`'s line was `workflow_registry/workflow_registry_read: SELECT USING(true) for
authenticated — the table carries no tenant_id column …`.

### The consumers, measured rather than assumed

**Four views, all `security_invoker = true`, all `authenticated=r`.** What each
would have done if the policy had simply been dropped — this is the reason the
5 September pass left it, and the reason it is preserved rather than overruled:

| view | how it reads the register | with 0 rows visible |
|---|---|---|
| `v_workflow_health` | `FROM workflow_registry r` | 0 rows — the dealership loses the one thing Part 4 grants it |
| `v_lead_recovery` | 3 × `JOIN workflow_registry r` inside scalar subqueries, filtered `r.name ilike '%silence detector%'` | `silence_detector_last_run_at` / `_last_success_at` / `_last_run_class` all NULL — renders as **"the detector has never run"**, a false absence |
| `v_needs_attention` | `LEFT JOIN workflow_registry r`, `COALESCE(r.name, f.workflow)` | rows survive but fall back to the raw `audit_log.workflow` string |
| `v_audit_unregistered_writers` | `NOT EXISTS (… FROM workflow_registry r …)` | **inverts** — every audit writer becomes an "unrecognised writer" |

The third and fourth are worse than the 5 September note said: it is not "0 rows"
in every case, it is a false absence in one and a false accusation in another.

**No function** referenced the table (`pg_proc.prosrc ilike '%workflow_registry%'`
→ 0 rows before the change; 1 after, and it is the accessor).

**The dashboard**, verified in the shipped bundle `dist/assets/main-*.js` as well
as in source — six call sites across five screens read the table as
`authenticated`:
`settings.js:803`, `automation.js:870`, `campaigns.js:628`, `customers.js:555`,
`ask.js:1465`, `ask.js:1632`.

**n8n.** `service_role` is untouched by this migration — same `relacl`, same
policy, all ten columns — so no n8n workflow can be affected by construction.
Checked anyway: the repo's `n8n-workflows/**` export has **zero** occurrences of
`workflow_registry`, and the live published definition of `NEXUS Error Handler`
(read through `mcp__n8n__get_workflow_details`, read-only) contains none either
and reaches Supabase through the `supabaseApi` credential. The other 19 live
definitions were not each fetched; the `service_role`-untouched argument covers
them, and that is stated as an argument rather than as 21 measurements.

---

## 3. What was applied

One statement. In order: create the accessor; comment it; revoke EXECUTE from
PUBLIC and `anon`, grant to `authenticated` and `service_role`; rewrite the four
views **by substitution** inside a `DO` block; revoke the seven column privileges
and every table privilege from `authenticated`, `anon` and PUBLIC; drop
`workflow_registry_read`; rewrite the table and `v_workflow_health` comments.

The views are rewritten by taking `pg_get_viewdef(...)` and replacing
`workflow_registry r` with `public.nexus_workflow_catalogue() r`, rather than by
retyping 28 KB of `v_lead_recovery` to change one FROM clause. Three assertions
make that safe and they abort the migration rather than warn:

- the substring must occur at least once in each view (measured beforehand: all
  6 occurrences across the four views carry the alias `r`, and
  `count('workflow_registry') == count('workflow_registry r')` for every view, so
  there is no occurrence the replacement would miss);
- no occurrence of `workflow_registry` may survive the substitution;
- `reloptions @> array['security_invoker=true']` must hold after the replace.

`with (security_invoker = true)` is spelled inline in the `CREATE OR REPLACE`.

---

## 4. Adversarial proof — STAGING (`wwspuxrbiyagnrnzgate`), rolled back

Staging's `workflow_registry` is empty, so a fixture row was inserted **inside a
transaction that ends in `RAISE EXCEPTION`** and never committed; nothing was
left behind. Roles were entered with `set_config('role', …, true)` and a JWT
`sub` claim for a real staging member (`staging-alpha`). Grant verdicts are the
witness here, per CLAUDE.md; row counts are reported for completeness.

| caller | statement | BEFORE | AFTER |
|---|---|---|---|
| member (`staging-alpha`) | `count(*) from workflow_registry` | EXECUTED n=1 | **42501** |
| member | `select name from workflow_registry` | EXECUTED n=1 | **42501** |
| member | `select * from workflow_registry` | (n/a) | **42501** |
| member | `select trigger_detail from workflow_registry` | 42501 | **42501** |
| member | `nexus_workflow_catalogue()` | (did not exist) | EXECUTED n=1 |
| member | `v_workflow_health` | EXECUTED n=1 | EXECUTED n=1 |
| member | `select id from v_workflow_health` | (n/a) | **42703** (column does not exist) |
| member | `v_lead_recovery` | EXECUTED n=3 | EXECUTED n=3 |
| member | `v_needs_attention` | EXECUTED n=0 | EXECUTED n=0 |
| member | `v_audit_unregistered_writers` | EXECUTED n=1 | EXECUTED n=1 |
| **signed in, no dealership** | `count(*) from workflow_registry` | EXECUTED n=1 | **42501** |
| **signed in, no dealership** | `nexus_workflow_catalogue()` | (did not exist) | EXECUTED **n=0** |
| **signed in, no dealership** | `v_workflow_health` | EXECUTED n=1 | EXECUTED **n=0** |
| `service_role` | `select id, trigger_detail from workflow_registry` | EXECUTED n=1 | EXECUTED n=1 |
| `service_role` | `v_workflow_health` | EXECUTED n=1 | EXECUTED n=1 |
| `service_role` | `nexus_workflow_catalogue()` | (did not exist) | EXECUTED n=1 |
| `service_role` | `v_audit_unregistered_writers` | EXECUTED n=1 | EXECUTED n=2 |
| `anon` | `workflow_registry` | 42501 | **42501** |
| `anon` | `nexus_workflow_catalogue()` | (did not exist) | **42501** |
| `anon` | `v_workflow_health` | 42501 | **42501** |

(The `service_role` count of 2 against a member's 1 on the unregistered-writers
view is RLS on `audit_log` — `service_role` is `BYPASSRLS` — not a change made
here.)

Staging final state: `relacl` = postgres + service_role only; **zero** columns
carry an `attacl`; policies = the anon-deny and the service_role one;
`has_table_privilege(authenticated,…)` and `has_any_column_privilege(authenticated,…)`
both **false**; function ACL `postgres=X | authenticated=X | service_role=X` with
`has_function_privilege('anon', …)` **false**; all four views
`{security_invoker=true}` with unchanged column counts (25 / 67 / 7 / 8); and
**no view in `public` names `workflow_registry` any more**.

---

## 5. Adversarial proof — PRODUCTION (`dsvuoovivysszdoiorch`)

Rolled-back transaction, `set_config('role', …)` plus a real JWT `sub` claim for
the Tenant A owner (`21460dfd-…`, tenant `fff6a2b5-…`, `status='active'`).

```
Tenant A MEMBER  count(*) workflow_registry              -> 42501
Tenant A MEMBER  select name from table                  -> 42501
Tenant A MEMBER  select * from table                     -> 42501
Tenant A MEMBER  select id from table                    -> 42501
Tenant A MEMBER  nexus_workflow_catalogue()              -> EXECUTED n=18
Tenant A MEMBER  v_workflow_health                       -> EXECUTED n=18
Tenant A MEMBER  v_workflow_health where health not null -> EXECUTED n=18
Tenant A MEMBER  select id from v_workflow_health        -> 42703
Tenant A MEMBER  select trigger_detail from v_workflow_health -> 42703
Tenant A MEMBER  v_lead_recovery                         -> EXECUTED n=3
Tenant A MEMBER  v_lead_recovery detector_last_run_at not null -> EXECUTED n=3
Tenant A MEMBER  v_needs_attention                       -> EXECUTED n=9
Tenant A MEMBER  v_audit_unregistered_writers            -> EXECUTED n=2
NOMEMBER     count(*) workflow_registry              -> 42501
NOMEMBER     nexus_workflow_catalogue()              -> EXECUTED n=0
NOMEMBER     v_workflow_health                       -> EXECUTED n=0
FORGED CLAIM count(*) workflow_registry              -> 42501
SERVICE_ROLE id+trigger_type+trigger_detail          -> EXECUTED n=18
SERVICE_ROLE v_workflow_health                       -> EXECUTED n=18
SERVICE_ROLE nexus_workflow_catalogue()              -> EXECUTED n=18
SERVICE_ROLE v_audit_unregistered_writers            -> EXECUTED n=2
ANON         workflow_registry                       -> 42501
ANON         nexus_workflow_catalogue()              -> 42501
ANON         v_workflow_health                       -> 42501
```

`FORGED CLAIM` is the Tenant A `sub` plus a `tenant_id` claim naming a tenant that
does not exist; it changes nothing, because the accessor asks
`nexus_current_tenant_ids()` rather than reading a claim.

`v_lead_recovery detector_last_run_at not null = 3 of 3` is the line that proves
the inner joins did not collapse: the silence-detector resolution still works
through the accessor, so the view is not quietly reporting "never ran".

### The rewrite changed no answer — proved, not asserted

For each of the four views the **pre-change body** was reconstructed (substituting
`workflow_registry r` back in), created as a temp view, and diffed against the
live view as `postgres`, which can read both:

```
v_workflow_health            : symmetric difference vs its pre-change body = 0 row(s)
v_lead_recovery              : symmetric difference vs its pre-change body = 0 row(s)
v_needs_attention            : symmetric difference vs its pre-change body = 0 row(s)
v_audit_unregistered_writers : symmetric difference vs its pre-change body = 0 row(s)
```

And the source relation is identical for the caller who matters: the accessor read
as the Tenant A member and the table read as `postgres` produce the same 18 tuples over
all seven projected columns — `md5 = 549253c266b376a8760a8d616eb18c73` on both
sides.

### Production final state

```
workflow_registry relacl        = postgres=arwdDxtm/postgres | service_role=arwdDxtm/postgres
workflow_registry column grants = NONE (pg_attribute.attacl null on all ten columns)
auth_privs   = {}          anon_privs = {}
service_privs= {DELETE, INSERT, SELECT, TRUNCATE, UPDATE}
policies     = workflow_registry_deny_anon (RESTRICTIVE ALL anon USING false)
               workflow_registry_service_role_all (PERMISSIVE ALL service_role USING true)
rowcount     = 18   (unchanged; no row created, deleted or altered)

nexus_workflow_catalogue: secdef=true, volatile=s, owner=postgres,
  search_path=public, pg_catalog,
  proacl = postgres=X | authenticated=X | service_role=X
  exec_anon=false  exec_auth=true  exec_service=true

v_workflow_health / v_lead_recovery / v_needs_attention /
v_audit_unregistered_writers: {security_invoker=true}, authenticated=r,
  columns 25 / 67 / 7 / 8 (all unchanged)

views in public still naming workflow_registry : NONE
functions in public naming workflow_registry   : nexus_workflow_catalogue only
```

### Reachability, over the real REST API rather than the catalogue

CLAUDE.md's own lesson — *"ACL metadata was the wrong witness"* — applied. With the
live `anon` key against `https://dsvuoovivysszdoiorch.supabase.co/rest/v1`:

```
GET /workflow_registry?select=name              -> HTTP 401 {"code":"42501","message":"permission denied for schema public"}
GET /rpc/nexus_workflow_catalogue?select=name   -> HTTP 401 {"code":"42501","message":"permission denied for schema public"}
GET /v_workflow_health?select=name,health       -> HTTP 401 {"code":"42501","message":"permission denied for schema public"}
```

The middle line carries a second fact worth having: it is `42501`, **not**
`PGRST202 Could not find the function`. PostgREST has the accessor in its schema
cache and refused it on privilege — so the endpoint the dashboard now calls exists
and is correctly shaped, measured rather than assumed.

`get_advisors(security)` afterwards: **no ERROR-level lint.**
`nexus_workflow_catalogue` appears as one more WARN in the pre-existing
`authenticated_security_definer_function_executable` family, alongside
`nexus_current_tenant_ids`, `nexus_my_tenant_config`, `action_approver_context`
and 28 others. That is the intended shape — a definer function a signed-in user
may call — and it is recorded here rather than left for someone to discover.

---

## 6. Dashboard

Six PostgREST reads of the table would have become `403`, so they were repointed
to the accessor. PostgREST serves a `STABLE` set-returning function over `GET
/rest/v1/rpc/<name>` and honours `select=` and filters on the result, so the
change is one path per call site and nothing else moved:

| file:line | now reads |
|---|---|
| `screens/settings.js:803` | `rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases` |
| `screens/automation.js:879` | same (with a comment at `:870` saying why) |
| `screens/campaigns.js:628` | `…?select=name,audit_name,audit_aliases,category,is_active,writes_audit_log` |
| `screens/customers.js:555` | `…?select=name,audit_name,audit_aliases,writes_audit_log&name=ilike.${AGG_MATCH}` |
| `screens/ask.js:1465`, `:1632` | `…?select=name,audit_name,audit_aliases` |

No rendering code changed. Every one of these call sites already carried a written
fallback for a failed or empty registry read, and an empty result is now also what
a session belonging to no dealership gets — which those sentences already cover.
`campaigns.js`'s `looksLikeDrip` still tests `w.trigger_detail`; that has been
`undefined` since 5 September and falls back to the name match, unchanged.

`npm run build` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` /
`VITE_N8N_BASE_URL` set: **exit 0**, `✓ built in 3.32s`,
`dist/assets/main-DuqnCP-e.js 1,371.15 kB`. The two warnings printed are
pre-existing. The shipped bundle now contains the three accessor paths and
**zero** occurrences of `workflow_registry?select`.

---

## 7. `QUALITY_GATE.mjs` — what L2 says now

Run: `node QUALITY_GATE.mjs --catalogue /home/claude/out/catalogue.prod.2026-09-06.json`
from `apps/executive-dashboard`, catalogue taken from production at
**2026-09-06T04:29:01Z**.

**PASS 26 · FAIL 2 · WARN 2 · NOT RUN 6, exit 1** — the same counts as the
5 September run, and not the same rows.

**`L2` PASSES.**

```
PASS  P0  L2  LIVE · database  RLS is on for every tenant-owned table, and no policy
                               is open to anon or authenticated
   · 0 tables without RLS
   · 12 policies in public are USING(true) or WITH CHECK(true) for a role other than
     service_role; 12 are exempt and 0 are not
```

`workflow_registry` does not appear in `open_policies` at all any more, because
`workflow_registry_read` no longer exists. The twelve exempt names are the same
twelve shipped-vocabulary tables as before. **`L2_EXEMPT_TABLES` was not touched**,
and `L2_NOT_EXEMPT_NOTES['workflow_registry']` was left in place — it is now
dormant and will print again the moment anyone re-creates a `USING (true)` policy
on that table, which is exactly when it should.

Also passing, and relevant: `L3` (39/39 views carry `security_invoker` with a true
value), `L4` (32 of 121 definer functions reachable by `authenticated`, every write
statement tenant-scoped — the new accessor writes nothing), `L5` (1 of 121
functions executable by `anon`, and it is not the new one), and the whole render
lane `R0`–`R7`.

### The two failures, and neither is closed by this change

**`L9` — unchanged and pre-existing.** `"Example Workflow"` wrote one `FAILED`
`audit_log` row and resolves to no registry entry. It was failing before this pass
and is untouched by it. The gate's own line says not to invent a registry row to
clear it, and none was invented.

**`L1` — newly red, and it is not mine.** `"whatsapp_templates" columns differ
between live and the snapshot`. Measured: live has `language_key` and `waba_key`
and the snapshot does not. Those two columns were added by production migration
`20260905211435_whatsapp_template_identity_normalises_language_and_waba`, applied
at 21:14 on 5 September — **eighteen minutes after** the `SNAPSHOT` embedded in
`QUALITY_GATE.mjs` was taken (`takenAt 2026-09-05T20:56:16Z`). The 5 September gate
run used a catalogue from *before* that migration, so `L1` was green on a stale
reading; this pass took a fresher catalogue and the drift surfaced. Checked
specifically: **`v_workflow_health`'s column list is byte-identical between the
snapshot and live**, so nothing in this migration caused it — this change adds no
relation and alters no relation's columns, which is why it does not move `L1`
itself. The documented remedy is `node QUALITY_GATE.mjs --refresh-schema`, which
rewrites the snapshot **inside `QUALITY_GATE.mjs`**; this pass was forbidden to
edit that file, so `L1` is left red with its cause named. It is a stale-snapshot
failure, not an exposure.

### How the catalogue was obtained, and why that is not a shortcut

There is no `NEXUS_DB_URL` in this environment, so the live lane needs
`--catalogue`. The catalogue at `/home/claude/out/catalogue.prod.2026-09-06.json`
was built like this, and the method is recorded because a catalogue nobody can
re-derive is a claim:

- **Everything except function bodies** was dumped fresh from production in one
  statement (the SQL `--print-sql` emits, with `'body'` blanked and `p.oid` added),
  base64-encoded with its own `length` and `md5`, and both re-checked on
  reassembly.
- **Function bodies**: `md5(prosrc)` and `length(prosrc)` were read fresh for all
  **121** functions in the same session. **120** matched the 5 September catalogue
  byte-for-byte on `(name, args, md5, length)` and were carried over from it; the
  **one** that did not — `public.nexus_workflow_catalogue`, created by this pass —
  was fetched fresh in base64 and re-checked against its own md5 and length.
- `sum(len(body))` over the assembled catalogue is **308867**, which equals
  `meta.body_chars_expected` read from the live catalogue in the same statement
  (307642 before + 1225 for the new function). The gate's own integrity check
  re-verifies that count and the function count before it will use the file.

---

## 8. Not closed, not proven, stated plainly

1. **A dealership that is a member can still count its 18 automations** through
   `v_workflow_health`, with their names, categories, descriptions and `is_active`
   flags. That is the sanctioned projection and Part 4 requires it. The vendor's
   *register* — its size, its ids, its triggers, and anything it gains later — is
   closed.
2. **There is still no fact that says which automations serve which dealership.**
   Until one exists, the accessor cannot scope per tenant and does not pretend to.
   The design puts the one place that filter goes beyond argument; it does not
   supply the filter.
3. **Not tested through a real signed-in JWT over PostgREST.** The `authenticated`
   proofs above are `set_config('role',…)` plus a JWT `sub` claim in a rolled-back
   transaction, which is conclusive about grants and about what the accessor
   returns; the `anon` proofs *are* over the live REST API. No browser session was
   signed in and no Tenant A password is available in this environment, so the five
   repointed screens are syntax-checked, built and reasoned about, **not observed**
   rendering against live data.
4. **The render lane now exercises a different branch for those five screens.**
   `QUALITY_GATE.mjs`'s stub serves `[]` for any `rpc/<name>` it does not special-case,
   where it used to fabricate rows for the `workflow_registry` relation. `R0`–`R7`
   all still pass, but the registry-populated path on those five screens is no
   longer covered by the render lane. Adding a stub case would mean editing
   `QUALITY_GATE.mjs`, which this pass was forbidden to do.
5. **19 of 21 live n8n definitions were not individually inspected.** The argument
   that they cannot be affected is structural (`service_role` untouched) and is
   corroborated by a zero-hit repo grep and one live definition read; it is not 21
   measurements.
6. **`L1` is red** for the stale-snapshot reason in §7, and `L9` is red for the
   pre-existing reason. Neither is addressed by this change and neither was chased.
