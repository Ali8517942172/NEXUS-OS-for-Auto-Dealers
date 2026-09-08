# n8n change required by the quarantine cutover — **NOT DEPLOYED**

**Nothing in this file has been applied.** The production n8n box (35.224.126.225)
was not contacted, no workflow was opened, edited, published or activated, and no
file under `n8n-workflows/` in the repo was modified. This is an instruction sheet
for whoever next holds the box, under the one-agent-at-a-time rule.

Date: 5 September 2026. Database change it accompanies: migrations
`20260905201206`, `20260905201227`, `20260905201337` on production
`dsvuoovivysszdoiorch` (already applied).

---

## What changed underneath n8n

`public.nexus_default_tenant_id()` is the column DEFAULT on `tenant_id` for
**sixteen** tables (`audit_log`, `communication_logs`, `competitors`,
`customer_360_profiles`, `daily_metrics`, `deals_embeddings`, `finance_quotes`,
`inventory`, `inventory_profit_settings`, `kyc_documents`, `leads`,
`processed_messages`, `purchase_history`, `rag_documents`, `users`,
`whatsapp_contacts`).

| | before 5 Sep | after 5 Sep |
|---|---|---|
| a `service_role` write that OMITS `tenant_id` | filed under **ALBA CARS** | filed under **UNATTRIBUTED — QUARANTINE** |
| that row visible on ALBA's dashboard | yes | **no** |
| that row in ALBA's revenue / recovery / attribution figures | yes | **no** |
| that row recoverable | n/a | yes — one `UPDATE ... SET tenant_id` as `service_role` |

A write that **sends** `tenant_id` is completely unaffected. The column default
only fires when the column is absent from the request body.

---

## 1. The documented `Resolve Tenant` rollback now means something different

Recorded on 3 Sep (`claude/nexus-tenancy-wave-and-the-second-waha-2026-09-03.md`):

> `Resolve Tenant` runs BEFORE `Claim Message Id` … The
> `nexus_default_tenant_id()` fallback fires only if `Resolve Tenant` is disabled,
> **which is the documented rollback.**

That rollback used to be harmless with one dealership: disabling the node sent
rows to ALBA, which was correct anyway. **It is no longer harmless.** Disabling
`Resolve Tenant` now sends live ALBA WhatsApp traffic to quarantine, where the
dealership cannot see it.

**Required edit** — WhatsApp BDC AI Agent, node `Resolve Tenant`, and the sticky
note next to it:

> ROLLBACK WARNING (changed 5 Sep 2026). Disabling this node no longer falls back
> to ALBA CARS. `nexus_default_tenant_id()` now returns the UNATTRIBUTED
> quarantine tenant, so every row written while this node is off is invisible to
> the dealership until it is re-attributed. If you disable it, note the start
> time, and afterwards run `select * from public.nexus_quarantine_census();` as
> service_role and `UPDATE` those rows back to ALBA's tenant id
> (`fff6a2b5-cfd5-4460-8383-875bc5826de0`). Do not delete them.

This is a **note/documentation** change, not a logic change. The node's behaviour
when enabled is already correct.

## 2. Find the workflows that still omit `tenant_id` — measure, do not guess

CLAUDE.md records "17 of 21 n8n workflows now resolve a tenant … and stamp it
explicitly rather than relying on the column default". **Which four do not is not
established anywhere I could read**, and this session could not check:

- the repo copies under `n8n-workflows/` are a **stale export** — `_index.json`
  says `exported_at: 2026-08-30T18:01:07Z`, and `grep -c tenant_id` returns **0
  across all 22 files**, i.e. they predate the tenancy wave entirely. Patching
  them would be fiction, so they were left alone.
- the box was out of scope for this session.

The measurement now exists and costs nothing. As `service_role`:

```sql
select * from public.nexus_quarantine_census();
```

Empty = every live write path stamps `tenant_id`. Non-empty = the named tables
have a writer that does not, and `newest` tells you when it last fired. Run it
**within 24 hours of 5 Sep 2026** and then daily until it is stable — this is the
first time the answer has been observable, and it is the cheapest moment to get
it, because with one dealership a misfiled row is recoverable rather than
disclosed to a competitor.

`select * from public.nexus_tenancy_readiness();` carries the same finding as a
WARN with per-table counts.

For each workflow the census implicates, add `tenant_id` to the **request body**
(not just the URL) from whatever the workflow already resolved — the WAHA session
via `channel_registry`, the JWT user via `tenant_members`, or the calling
workflow for sub-workflow hops. Then re-attribute the rows it already wrote.

## 3. Still outstanding, unchanged by this work

The three `?on_conflict=` URL edits from 2 Sep are still open and are reported by
`nexus_tenancy_readiness()`:

| workflow | node | change |
|---|---|---|
| Master Router | `Persist Lead (deterministic)` | `?on_conflict=email` → `?on_conflict=tenant_id,email` |
| Customer 360 | `Supabase - Upsert Profile` | `?on_conflict=customer_id` → `?on_conflict=tenant_id,customer_id` |
| Closed-Won Sync | `Supabase (Postgres) - Upsert Vector` | `?on_conflict=deal_id` → `?on_conflict=tenant_id,deal_id` |

These interact with the quarantine cutover: an upsert whose conflict target is a
bare natural key can match a row under a different tenant. The indexes they need
already exist.

## 4. Rollback of the database change itself

There is no "put the flag back on ALBA" — a CHECK constraint
(`tenants_unattributed_default_must_be_quarantine`) forbids it, deliberately.
If the quarantine behaviour has to be undone in an emergency, the honest options
are, in order of preference:

1. **Re-attribute** — `update <table> set tenant_id = 'fff6a2b5-cfd5-4460-8383-875bc5826de0'
   where tenant_id = (select id from tenants where is_quarantine);` as
   `service_role`. This is the intended remedy and needs no schema change.
2. Only if the constraint itself is judged wrong: drop it by name, then move the
   flag. That is a reviewable diff and `nexus_tenancy_readiness()` will
   immediately report a BLOCKER saying the default points at a real dealership —
   which is the point.

Do **not** simply clear the flag from the quarantine tenant. With nothing holding
it, `nexus_default_tenant_id()` returns NULL and every write omitting `tenant_id`
fails `23502` against a NOT NULL column — the inbound customer message is
destroyed rather than retained. `nexus_tenancy_readiness()` reports that state as
a BLOCKER for exactly that reason.
