# SCOPED-FUSE — `nexus_scoped_tenant_id()` at dealership #2

Migration: `supabase/migrations/20260917080000_nx991_the_fuse_went_dark_at_the_second_dealership.sql`
Tested on staging `wwspuxrbiyagnrnzgate` with **3 active non-quarantine tenants**.
Production `dsvuoovivysszdoiorch` was read **SELECT-only**; nothing was applied there.

---

## 1. What was broken

`public.nexus_scoped_tenant_id()` is a fail-closed fuse built for a single-dealership
world. Its fallback arm carries this guard:

```
and (select count(*) from public.tenants
      where status = 'active' and not is_quarantine) = 1
```

So for any caller with **no signed-in identity** — service_role, n8n, the nightly
batches — it returns `NULL` the moment a second dealership exists. Returning NULL
was the safe half of the decision.

**The defect is what the callers did with NULL: each answered with an empty result
and no error.** An empty result is indistinguishable from "there is no data". That
is how a dealer is told they have no leads when they have twenty.

Production looks healthy *only* because it has exactly one real dealership
(`alba-cars`) plus a quarantine tenant, which does not count towards the guard.
`nexus_scoped_tenant_id()` on production returns `fff6a2b5-…` today and `NULL`
the day dealership #2 is created — in the same moment, quietly.

## 2. Blast radius, measured — not guessed

Read from production `pg_proc.prosrc`, `pg_views.definition`, `pg_policies`.
**No RLS policy references the fuse** (0 rows).

### Real callers (5) — these went blind at 2+ tenants

| Object | What it did at 2+ tenants |
|---|---|
| `nexus_comm_keys_for_lead(text,text)` | returned `{}` — "this lead has no channels" |
| `nexus_lead_for_comm_key(text)` | returned `null` — "no such lead" |
| `search_rag_documents(text,integer)` | returned 0 rows — "no company document says that" |
| `v_customer_directory` | 2 rows → **0 rows** (previously measured) |
| `v_inventory_sales` | 12 rows → **0 rows** (previously measured) |

All five are backend-facing. An `authenticated` dealer session was never affected,
because `nexus_current_tenant_id()` answers first from their membership.

### Diagnostics (2) — still point at the fuse on purpose

`nexus_tenancy_readiness()`, `nexus_multi_tenant_blockers()`. Their job is to
report what the fuse currently answers. Left unchanged.

### False alarms (3) — confirmed individually, not assumed

`nexus_active_dealership_ids()`, `nexus_workflow_catalogue()`,
`nexus_resolve_channel_tenant(text,text)`. All three match a name-search of
`prosrc` because a **prose comment** mentions the fuse. Strip line comments and
the call count is 0. `nexus_resolve_channel_tenant` resolves from
`channel_registry` and is genuinely fine at N dealerships — the previous agent's
finding is confirmed.

`nexus_multi_tenant_blockers()` over-reported for exactly this reason (it used
`prosrc like '%nexus_scoped_tenant_id%'`) **and under-reported at the same time**:
it only scanned `pg_proc`, so the two views that really did read the fuse were
never listed. NX991 adds `nexus_fuse_dependent_objects()`, which strips comments,
requires a call, and includes `pg_views`.

## 3. What was changed, and why

The fuse itself is **not** changed. It still fails closed. It is not replaced with
anything that guesses a default dealership. What changed is that the five real
callers stop asking it a question it cannot answer, and stop translating
"I cannot tell" into "there is nothing".

One new decision point, `public.nexus_caller_tenant_scope(purpose)`:

* **member** → every dealership they belong to, and nothing else. Same plural
  house pattern as `nexus_channel_status()`.
* **signed-in person with no membership** → `'{}'`. Their identity is *known*, so
  "you are a member of no dealership" is a complete, true answer. Never a default.
* **backend caller, exactly 1 active dealership** → that dealership. Byte-for-byte
  today's production behaviour.
* **backend caller, 2+ active dealerships** → **raises SQLSTATE `NX991`**, with a
  hint naming the tenant-taking form to call instead. Never `'{}'`.

Per-arm reasoning:

* `nexus_comm_keys_for_lead(email, phone)` — takes explicit identifiers, so it is
  plural-scoped and delegates per dealership to the existing 3-arg form. Every
  `chat_id` is read under exactly one `tenant_id`.
* `nexus_lead_for_comm_key(key)` — genuinely singular. Answers only when exactly
  one of the caller's dealerships claims the key. Two claimants → `null`, the same
  refusal-to-guess the tenant-scoped form already applies *within* a dealership.
* `search_rag_documents(q, n)` — plural-scoped, re-ranked, cut to `match_limit`.
  Kept **SECURITY INVOKER** so `rag_documents` RLS still binds an authenticated
  caller, as the 3-arg form's own comment requires.
* both views — `= nexus_scoped_tenant_id()` became
  `= any(nexus_caller_tenant_scope(...))`; `security_invoker = true` preserved.
  `v_customer_directory` already grouped by `tenant_id`, so a member of two
  dealerships gets two rows for one email rather than one merged row belonging to
  neither.

## 4. Staging evidence (3 active tenants: A, B, Dubai Motors)

**BEFORE** (pre-NX991 wrapper bodies replayed verbatim as `nx991_before_*`, backend caller):

| | value |
|---|---|
| `nexus_scoped_tenant_id()` | `NULL` |
| `nexus_comm_keys_for_lead(email, phone)` | `[]` — silently, no error |
| `search_rag_documents(q, 6)` | `0` rows — silently, no error |

**AFTER (a) — correct non-empty answers for a caller in tenant A**

| | A's caller | B's caller |
|---|---|---|
| `nexus_caller_tenant_scope` | `[A]` | `[B]` |
| `nexus_comm_keys_for_lead` | **4 keys** | 3 keys (own lead) |
| `nexus_lead_for_comm_key('971…111@c.us')` | lead **11** | — |
| `search_rag_documents('nx991refundpolicy', 6)` | **1 row**, `alpha.pdf` | **1 row**, `bravo.pdf` |
| `v_inventory_sales` | **3 rows** | **4 rows** |
| `v_customer_directory` | **4 rows** | **5 rows** |

**AFTER (b) — isolation, proven not asserted**

A non-derivable private `chat_id` (`55511122233@lid`) was planted on tenant A's
`whatsapp_contacts`, so the test cannot be satisfied by echoing the caller's own input.

| probe | result |
|---|---|
| A's caller sees A's private chat_id | **true** |
| B's caller sees A's private chat_id | **false** |
| B resolves A's private chat_id to a lead | `null` |
| A resolves B's chat_id (`971…222@c.us`) | `null` |
| `v_inventory_sales` rows from another tenant, A's caller | **0** |
| `v_customer_directory` rows from another tenant, B's caller | **0** |
| B's caller sees any `%t-a.invalid` customer | **0** |
| member of A **and** B: sees tenant C rows | **0** (scope 2, 7 inv rows, `alpha.pdf,bravo.pdf`) |
| member of A and B, phone present in both | `null` — refuses to guess |

**AFTER (c) — caller with no membership**

`role=authenticated`, `sub` with no `tenant_members` row:
scope `[]`, `v_inventory_sales` **0**, `v_customer_directory` **0**,
`search_rag_documents` **0**. No default dealership substituted.

**AFTER (d) — backend caller with no identity, 3 tenants: every arm raises**

| arm | outcome |
|---|---|
| `nexus_comm_keys_for_lead(2-arg)` | **RAISED NX991** |
| `nexus_lead_for_comm_key(1-arg)` | **RAISED NX991** |
| `search_rag_documents(2-arg)` | **RAISED NX991** |
| `v_inventory_sales` | **RAISED NX991** |
| `v_customer_directory` | **RAISED NX991** |
| pre-NX991 replica, same conditions | returned silently — the defect |

**Single-dealership regression (production's shape today).** B and C suspended,
1 active tenant, backend caller:

| | before | after |
|---|---|---|
| `nexus_comm_keys_for_lead` key count | 4 | **4** |
| `search_rag_documents` rows | 1 | **1** |

Identical. Tenant A sees no behaviour change from this migration.

`nexus_fuse_dependent_objects()` on staging after NX991: **0 rows.**

**Nothing failed.** One thing was caught and fixed mid-test: a platform default
privilege silently granted `EXECUTE` on the newly created
`nexus_fuse_dependent_objects()` to `authenticated`; revoking only `public, anon`
left it standing. The migration now revokes `authenticated` explicitly.

## 5. Still single-tenant / still unsafe before dealer #2

1. **`n8n-workflows/ask_ai_rag_query_agent.json` still calls the 2-arg
   `search_rag_documents(q, match_limit)`.** After NX991 it will **error** at two
   dealerships instead of silently answering nothing. It must be moved to the
   3-arg form. *This is the intended trade: loud beats silent — but it is a live
   workflow that will break on the day dealer #2 is created.*
2. **Any backend batch reading `v_customer_directory` / `v_inventory_sales`** must
   iterate `public.nexus_active_dealership_ids()` and filter per dealership.
   Customer-360 is the known candidate; it has **not** been audited by this pass.
3. **This migration is NOT APPLIED TO PRODUCTION.** Staging-proven ≠
   production-proven.
4. **The wider tenancy surface was not audited here.** This pass covered the five
   objects that read the fuse and nothing else. `nexus_multi_tenant_blockers()`
   still reports its other blockers; they stand.
5. **`nexus_scoped_tenant_id()` is still granted to `anon`** on production
   (pre-existing). It is fail-closed for anon, but the grant has no reason to exist.
6. **No load or concurrency testing.** `nexus_caller_tenant_scope()` is called
   twice per row-source inside `v_customer_directory` (the UNION has two arms).
   It is `STABLE` so the planner may fold it, but this was not profiled.
7. **The file on disk carries a `begin;`/`commit;` wrapper and the full prose
   header; staging received the same DDL without those.** Functionally identical,
   but the exact file has not itself been executed anywhere.
