# Closing the two-dealership defects — F1..F5

**6 September 2026.** Staging `wwspuxrbiyagnrnzgate`, production `dsvuoovivysszdoiorch`.
Acting on `/home/claude/repo/two-tenant-proof-2026-09-06.md`.

No git command was run. The n8n box (`35.224.126.225`) was not contacted.
`QUALITY_GATE.mjs` was read but not edited. No dashboard screen and no `lib/nav.js`
was touched. Every probe ran inside a `DO $$ … $$` block ending in an
unconditional `RAISE EXCEPTION`, so the transaction aborts and the result comes
back in the error message.

**Three migrations, both projects, byte-identical, md5-verified against
`supabase_migrations.schema_migrations.statements[1]` on production:**

| version | name | md5 | bytes |
|---|---|---|---|
| `20260906045700` | `tenancy_readiness_blocker_for_silent_backend_scope` | `20a9011fa072343e19e0ccd195d67a5b` | 18793 |
| `20260906050249` | `policy_refusals_say_what_they_mean_when_a_date_is_absent` | `e4e39d7cba306f19d1d06c4cb079be73` | 17703 |
| `20260906050648` | `messaging_layer_deny_end_users_is_designed_not_incidental` | `acffa311d1603daec6d636227c9347b7` | 4996 |

Each file in `supabase/migrations/` has no trailing newline and `md5sum` equals
the recorded md5.

All four functions this pass created or replaced are **byte-identical across the
two projects** (`md5(prosrc)`): `nexus_active_dealership_ids`
`60989b3c6d26e1cdad27ba38168a6c8a`, `nexus_tenancy_readiness`
`fa3ea7c0947e969c86b8505afa625147`, `policy_verify_rule`
`a0ec97d9192de2fdd053274afaed857b`, `policy_platform_verify_rule`
`b0e5ed18d929e5d5429c3cdb7e472627`.

---

## F2 (P1) — the gate was green over the failure it exists to catch

### Measured first, on both projects

Staging, `service_role`, in one transaction:

```
active non-quarantine dealerships     = 2  (staging-alpha, staging-bravo)
nexus_scoped_tenant_id()              = NULL
nexus_tenancy_readiness()             -> INFO, INFO, WARN, WARN.  BLOCKERs = 0
```

Production, `service_role`, same query:

```
active non-quarantine dealerships     = 1  (alba-cars)
nexus_scoped_tenant_id()              = fff6a2b5-cfd5-4460-8383-875bc5826de0
nexus_tenancy_readiness()             -> BLOCKERs = 0        (correct here)
```

So the claim in the proof reproduces exactly, and the gate's silence at two
dealerships is not explained by anything else.

### It is not only Customer 360 — five consumers, measured with positive controls

Five live objects take their scope from `nexus_scoped_tenant_id()`
(`nexus_workflow_catalogue` names it only in a comment and was excluded after
reading its body):

| consumer | staging, 2 dealerships | positive control, same transaction |
|---|---|---|
| `v_customer_directory` to `service_role` | **0** | Alpha session 3, Bravo session 1 |
| `v_inventory_sales` to `service_role` | **0** | Alpha session 2, Bravo session 1; `inventory` base table 3 |
| `search_rag_documents(q, limit)` 2-arg | **0** | 3-arg with explicit Alpha tenant: **1** |
| `nexus_comm_keys_for_lead(email, phone)` | **0 keys** | 3-arg with explicit tenant: **3 keys** |
| `nexus_lead_for_comm_key(key)` | **NULL** | 3-arg with explicit tenant: **lead 1** |

The RAG control required a row: staging holds zero `rag_documents`, so one was
inserted **inside the aborted transaction** purely to give the negative result a
positive twin. Without it, "0 rows" would have been an absent measurement
dressed as a green one.

The two identity helpers were not on anyone's list and are the worst of the
five: they fail closed *by design* (`return '{}'` / `return null`) when handed a
NULL tenant with more than one active tenant, so inbound WhatsApp stops matching
known customers and starts creating duplicate people.

Production re-proof, aborted transaction, a second tenant made active:

```
active dealerships                          = 2
nexus_scoped_tenant_id()                    = NULL
v_inventory_sales to service_role           = 0     (control: inventory = 12 rows)
v_customer_directory to service_role        = 0     (control: leads = 3 rows)
search_rag_documents(q,limit) 2-arg         = 0     (control: 3-arg explicit ALBA = 5)
```

`select count(*) ... from tenants` afterwards: 2 rows, 1 active dealership,
0 probe rows. Nothing persisted.

### The fix

`20260906045700`. A BLOCKER that **measures** rather than assumes:

```sql
where d.n > 1 and d.scoped is null      -- d.scoped = public.nexus_scoped_tenant_id()
```

Its detail names all five consumers, says what clears it (drive them over the
new `public.nexus_active_dealership_ids()`), and says what would only *look*
like clearing it (widening the resolver, which converts silence into one
dealership's batch reading and writing another's data).

`public.nexus_active_dealership_ids()` was added as the plural answer.
ACL read immediately after creation, per CLAUDE.md's rule:
`postgres=X/postgres | service_role=X/postgres`; `anon` EXECUTE **false**,
`authenticated` EXECUTE **false**. Identical on both projects. It does not appear
in `get_advisors`' `authenticated_security_definer_function_executable` list,
which is the independent confirmation.

**`nexus_scoped_tenant_id()` was deliberately NOT changed.** Its NULL is correct
— "silent rather than wrong at 2 tenants" is what its own comment says. The
defect was that nothing reported the silence.

### Proved both directions

| condition | BLOCKERs |
|---|---|
| staging, 2 active dealerships | **1** — `backend scope resolves to no dealership` |
| staging, `staging-bravo` suspended inside an aborted txn → 1 active | **0** |
| production as it stands, 1 active | **0** |
| production, second tenant active inside an aborted txn | **1** |

A gate that goes red *and* goes green.

---

## F2b — every other branch of `nexus_tenancy_readiness()`, fired deliberately

Each fired in its own rolled-back transaction on staging. This is the part that
answers "can this gate go red at all".

| # | branch | fired by | result |
|---|---|---|---|
| 1 | BLOCKER · unattributed default points at a real dealership | dropped `tenants_unattributed_default_must_be_quarantine`, moved the flag to `staging-alpha` | **FIRES** |
| 2 | BLOCKER · no tenant holds the unattributed default | cleared `is_unattributed_default` everywhere | **FIRES** |
| 3 | BLOCKER · backend scope resolves to no dealership (new) | two active dealerships | **FIRES** |
| 4 | WARN · rows sitting in the quarantine tenant | one `rag_documents` row under the quarantine tenant; detail printed `rag_documents 1` | **FIRES** |
| 5 | BLOCKER · natural key globally unique, workflow-pinned | `create unique index on deals_embeddings(deal_id)` | **FIRES** |
| 6 | WARN · natural key globally unique, unpinned | `create unique index on purchase_history(deal_id)` | **FIRES** |
| 7 | BLOCKER · `tenant_id` nullable AND defaulted | `alter table competitors alter column tenant_id drop not null` (default `nexus_default_tenant_id()` left) | **FIRES** |
| 8 | BLOCKER · `tenant_id` nullable and orphaning | …then `drop default` | **FIRES** |
| 9 | INFO · natural keys correctly scoped | live state, 8 keys listed | fires (true today) |
| 10 | INFO · rows with no tenant right now | **could not fire — see below** | **WAS DEAD** |

Branch 1 is unreachable while its CHECK constraint stands, which is the point of
it — it is a constraint-integrity detector, and dropping the constraint makes it
fire, so it is not decoration.

**Branch 10 was decoration and has been replaced.** It counted
`tenant_id IS NULL` on `leads`, `communication_logs`, `audit_log`, `inventory`
and `whatsapp_contacts`. Read from `pg_attribute` on both projects: all five are
`attnotnull = true`. The branch could never return a row, on any database this
schema describes, while reading like coverage of exactly the risk the gate
exists for. It now counts the two tables that genuinely can hold a NULL
(`policy_rule`, `policy_rule_event`) and labels them **platform-scope rows**
rather than orphans — which is what they are. It fires on both projects today.
Detecting a *newly* nullable table remains the job of branches 7/8 and the
"nullable by design" WARN, all of which read `pg_attribute` at call time rather
than a hand-maintained list.

---

## F1 (P1) — the documented ACL check was blind, and this is the third time

### The old query returns zero rows on both projects

```sql
select c.relkind, c.relname, coalesce(array_to_string(c.relacl, E'\n'), '(owner-only)') acl
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','v','m','p','S')
  and (has_table_privilege('authenticated', c.oid, 'UPDATE')
    or has_table_privilege('anon',          c.oid, 'UPDATE'))
order by 1, 2;
```

Staging: **0 rows.** Production: **0 rows.** In the same pass a signed-in
dealership owner successfully INSERTed into `inventory`.

### What the corrected query finds that the old one missed

Identical on both projects:

| object | grantee | verb | at table level | at column level |
|---|---|---|---|---|
| `inventory` | `authenticated` | DELETE | **true** | n/a |
| `inventory` | `authenticated` | INSERT | false | **true** |
| `inventory` | `authenticated` | UPDATE | false | **true** |
| `leads` | `authenticated` | UPDATE | false | **true** |

`pg_class.relacl` for `inventory` is
`postgres=arwdDxtm | service_role=arwdDxtm | authenticated=rd`;
`pg_attribute.attacl` carries `authenticated=aw` on
`id, model, vin, status, price_aed, cost_aed, ai_recommendation, acquired_at`
and `authenticated=a` on `tenant_id`. For `leads`, `relacl` is
`authenticated=r` and `attacl` carries `authenticated=w` on
`name, email, phone, vehicle_interest, budget_aed, status, assigned_to, assigned_to_id`.

**Two blindnesses, not one.** The column-level one is the known shape. The other
is that the old query tested `UPDATE` and nothing else, so `inventory`'s real
**table-level DELETE** was invisible too — and so would be a `TRUNCATE` grant,
which is the letter that section itself calls "the one that matters most",
because RLS does not filter it.

### Proved adversarially — the old query cannot go red

Staging, one rolled-back transaction, four holes planted:

```
grant update (amount_aed) on public.purchase_history to anon;
grant insert (doc_title)  on public.rag_documents   to authenticated;
grant truncate            on public.competitors     to authenticated;
grant delete              on public.audit_log       to authenticated;
```

**Old query: 0 rows.** Corrected query: 8 rows — the four planted plus the four
real:

```
audit_log        / authenticated / DELETE   / table=true  column=n/a
competitors      / authenticated / TRUNCATE / table=true  column=n/a
inventory        / authenticated / DELETE   / table=true  column=n/a
inventory        / authenticated / INSERT   / table=false column=true
inventory        / authenticated / UPDATE   / table=false column=true
leads            / authenticated / UPDATE   / table=false column=true
purchase_history / anon          / UPDATE   / table=false column=true
rag_documents    / authenticated / INSERT   / table=false column=true
```

A check that stays silent through an `anon` UPDATE grant and a `TRUNCATE` grant
is not a check.

### The read side is a separate query, and that is where the two earlier misses were

`has_any_column_privilege(…, 'SELECT')` with no table-level SELECT returns
exactly one row on each project: `channel_registry` / `authenticated`, columns
`integration_id, tenant_id, channel_type, external_identifier, status,
created_at, updated_at` — 7 of 8, `credential_ref` withheld. The deliberate
design. `policy_platform_attestation` no longer appears (revoked 4 Sep).

**A correction earned here:** CLAUDE.md said staging carries none of
`channel_registry`'s column grants. Re-measured — **staging carries the same
seven.** That gap in the rehearsal is closed; the n8n box remains the part of
staging that does not exist.

### What changed in CLAUDE.md

The heading was part of why it was misread, so it changed:

- was: `## The default-grant check: \`anon\` **and** \`authenticated\` (six holes)`
- now: `## The default-grant check: \`anon\` **and** \`authenticated\`, at TABLE **and** COLUMN level`

It named the roles and said nothing about the *level*, exactly as the previous
title named one role and said nothing about the other. The section now states
plainly that **this is the third time a column-level grant has hidden from this
file's own check** — `channel_registry` (4 Sep, reads), `policy_platform_attestation`
(4 Sep, reads, with no `relacl` entry at all), and now `inventory`/`leads`
(6 Sep, **writes**) — and that the pattern is: `relacl` is not the ACL, it is one
of two, and the check was blindest exactly where somebody had taken the most
care.

The corrected query is in the file with a clause-by-clause note on which
blindness each part removes, the four-row current result, the adversarial
planted-hole proof, and the companion read-side query.

---

## F4 — the two silent views are F2, and the diagnosis is confirmed by A/B

`v_customer_directory` and `v_inventory_sales` are both defined
`WHERE tenant_id = public.nexus_scoped_tenant_id()`. With that NULL, the
predicate is never true, so **0 rows and no error**.

Confirmed by the difference between the two projects rather than by reading the
definitions:

| | staging (2 dealerships) | production (1 dealership) |
|---|---|---|
| `nexus_scoped_tenant_id()` as `service_role` | NULL | ALBA |
| `v_customer_directory` to `service_role` | **0** | **2** |
| `v_inventory_sales` to `service_role` | **0** | **12** |
| control: `inventory` base table | 3 | 12 |
| control: each dealership's own session | Alpha 3/2, Bravo 1/1 | — |

**Not a separate defect, and no separate fix.** The views' fail-closed scoping is
deliberate and their own `comment on view` already says so in terms
("With two active tenants a service_role caller that sends no tenant gets zero
rows, never another dealership's stock"). Changing them to fall back to some
dealership would be the cross-tenant leak they were written to prevent. What was
missing was any signal that it had happened — which the F2 BLOCKER now provides,
naming both views by name.

**Not changed and stated as such:** the views themselves.

---

## F3 — the refusal is correct; no grant was opened

### Why the current refusal is right

- **The screen does not read those tables.** `grep -rn` over
  `apps/executive-dashboard/screens/` and `lib/`: zero queries against
  `whatsapp_opt_in_event`, `channel_message_events` or `whatsapp_delivery_events`.
  The only occurrence of any of the three is `lib/vocabulary.js:126`, a glossary
  entry. `screens/conversations.js` reads `v_conversations` and nothing else
  (`v_conversations?select=…` at line 1194).
- **A dealership already sees its own WhatsApp history.** Production
  `v_conversations` = 13 rows, `communication_logs` = 114 rows, both
  `authenticated=r` with a `tenant_id in (select nexus_current_tenant_ids())`
  RLS SELECT policy.
- **The refused tables hold nothing.** `whatsapp_opt_in_event` 0,
  `channel_message_events` 0, `whatsapp_delivery_events` 0 — on both projects.

So opening a grant would have designed a projection against no rows, for no
caller, to fix no symptom. When a caller exists the right shape is
`channel_registry`'s — a **column-level** grant withholding what is mechanism
rather than symptom — and it should be designed then, against real columns.

**Stated rather than papered over:** a dealership still has no way to see the
consent state its sends are refused on. That is a screen nobody has designed,
not a grant anybody forgot.

### What was done instead — a tightening

The sweep found an asymmetry. `channel_message_events`, `whatsapp_delivery_events`
and `whatsapp_customer_message_seen` each carry a RESTRICTIVE `_deny_end_users`
policy naming `anon` **and** `authenticated`. Seven siblings in the same
never-fired layer carried **no such floor** — including `whatsapp_opt_in_event`,
the consent record. They were closed only by the absence of a grant and the
absence of a permissive policy: RLS default-deny. An incidental lock.

`20260906050648` lays the same explicit floor on all seven
(`whatsapp_opt_in_event`, `whatsapp_conversation_state`, `whatsapp_message_intent`,
`channel_provider_capability`, `channel_provider_rank`, `channel_send_directive`,
`channel_send_form`). The migration **refuses to run** if any of them has grown
an end-user SELECT grant since it was written.

### Proved by counterfactual, not asserted

One rolled-back staging transaction. A real consent row written through
`whatsapp_record_opt_in_event`, then the pre-migration shape reconstructed —
floor dropped, `grant select … to authenticated`, and a permissive
`using (true)` policy added:

```
PRE-migration shape:   BRAVO owner reads ALPHA's consent rows = 1
POST-migration shape:  BRAVO owner reads ALPHA's consent rows = 0
POSITIVE CONTROL:      service_role sees 1 row throughout
```

A second probe, with only the accidental grant and no permissive policy:
`authenticated` reads **0** while `service_role` reads **1**.

### Nothing was broken

Before and after, on both projects, all ten messaging tables:
`authenticated` → **42501**; `service_role` row counts unchanged
(`whatsapp_message_intent` 4, `channel_provider_capability` 18,
`channel_provider_rank` 2, `channel_send_form` 9, the rest 0);
`restrictive-deny-for-authenticated = 1` on every one.
`service_role`'s consent WRITE through `whatsapp_record_opt_in_event` still
succeeds (proved on staging; the function body is byte-identical on production,
`md5(prosrc) = 0695b6e0b77e6ec278f15644f818b1bb` on both, so no write was made to
production to prove it).

`QUALITY_GATE` L2 is unaffected and was not edited: its open-policy detector
matches `qual = 'true'` or `with_check = 'true'`, and all ten of these policies
store `qual = 'false'`, `with_check = 'false'`. Verified in `pg_policies` on
production.

---

## F5 — the refusal that rendered an empty date, and led nowhere

### Reproduced exactly

Staging, as the signed-in Bravo owner, against `TENANT_HOUSE` rule `bbbb0001`
(status `ACTIVE`, `effective_from` NULL):

```
SQLSTATE NX001
DETAIL : EFFECTIVE_FROM_IS_FROZEN
MESSAGE: This version has been in force since  and that date cannot move.
HINT   : Verify it as it stands (pass no p_effective_from, or ), or supersede it
         with a version that starts on the new date.
```

**Two defects in one branch.** The blank is a NULL interpolated raw. The worse
half is the hint: "pass no `p_effective_from`" then fails `NO_EFFECTIVE_FROM`, so
**both routes it offers refuse** and the reader has nowhere to go.

`policy_platform_verify_rule` carried the identical branch and the identical dead
end. Both `ALREADY_VERIFIED` branches interpolated `verified_by` and
`verification_date` raw as well; neither column is NOT NULL.

### The state is real and the date genuinely cannot be set

`policy_rule_guard_immutability()` raises `23514` on any change to
`effective_from` once a version leaves DRAFT. Measured directly:

```
update policy_rule set effective_from = null where id = 5e4884af-…
-> 23514  policy_rule.effective_from cannot be changed once a version leaves DRAFT
```

So the honest message is not "that date cannot move" — there is no date — it is
"this version left DRAFT without one, and superseding is the only route".

### Fixed and re-proved on both projects

`20260906050249`. New code `EFFECTIVE_FROM_NOT_RECORDED`:

```
MESSAGE: This version left DRAFT - it is ACTIVE - without ever recording the date
         it started applying, so there is no start date to verify it against, and
         one cannot be set now: policy_rule.effective_from is frozen outside DRAFT.
HINT   : Supersede this version with policy_supersede_rule() and give the
         replacement the date the source says the rule started applying. Do not
         retry this call: passing p_effective_from is refused here, and passing
         nothing is refused as NO_EFFECTIVE_FROM, so superseding is the only route.
```

Positive controls, staging **and** production:

| probe | result |
|---|---|
| `policy_platform_verify_rule` on a rule with `effective_from = 2026-09-04`, different date supplied | `EFFECTIVE_FROM_IS_FROZEN` — **"in force since 2026-09-04"**, hint names `2026-09-04` |
| same function, `effective_from` NULL | `EFFECTIVE_FROM_NOT_RECORDED` |
| `policy_verify_rule`, no date supplied | `NO_EFFECTIVE_FROM` (unchanged) |
| `policy_verify_rule`, dealership approver on a global rule | `GLOBAL_RULE_NOT_TENANT_VERIFIABLE` (unchanged) |

No guard was added, removed, reordered or relaxed; no refusal became an
acceptance. ACLs unchanged and identical on both projects:
`policy_verify_rule` `postgres=X | authenticated=X | service_role=X`,
`prosecdef=true`; `policy_platform_verify_rule` `postgres=X | service_role=X`,
`prosecdef=false`.

---

## What was left behind

**Production:** `tenants` 2 rows / 1 active dealership / 0 probe rows;
`policy_rule` 13 rows / 0 `PROBE%` rows; `policy_platform_attestation` **0**;
`policy_rule` rows with `verification_status='VERIFIED'` **0**. Unchanged.
No production business data was altered. No row was created to satisfy any check.

**Staging:** every probe ran inside an aborted transaction. The only durable
staging changes are the three migrations themselves.

`get_advisors(security)` on production after the change: the pre-existing WARNs
only — `vector` and `pg_trgm` in `public`, the SECURITY DEFINER functions
executable by `authenticated` (all pre-existing and by design), and leaked
password protection. No new finding. `nexus_active_dealership_ids` is **absent**
from that list, which independently confirms `authenticated` cannot execute it.

## What was NOT changed, and why

- **`nexus_scoped_tenant_id()`** — its NULL at two dealerships is correct and
  deliberate. Widening it to pick a dealership would turn silence into one
  dealership's batch writing another's data. The gate reports the silence
  instead, and says so in the BLOCKER text.
- **`v_customer_directory` and `v_inventory_sales`** — fail-closed scoping is
  right, and their own comments already document it. F4 is F2, not a second bug.
- **Any grant on the messaging layer** — see F3. The refusal is correct; the
  missing thing is a screen, not a privilege.
- **`QUALITY_GATE.mjs`**, any dashboard screen, `lib/nav.js` — out of scope,
  owned by other agents. Read only. L2's open-policy detector was checked to
  confirm this pass cannot affect it.
- **The five NOT-NULL tables in the old dead INFO branch** — not made nullable,
  obviously; the branch was corrected to measure something that can be true.
- **`nexus_tenancy_readiness`'s `search_path`** — CLAUDE.md records
  `search_path = public, extensions` as a prerequisite for a *later* extension
  migration. Unrelated to this pass; left alone rather than smuggled in.
