# Cross-Tenant Guard (NX997)

**Migration:** `supabase/migrations/20260918140000_nx997_a_conversation_could_belong_to_three_dealerships_at_once.sql`
**Status:** applied and proved on staging `wwspuxrbiyagnrnzgate` 18 Sep 2026. **Not yet applied to production `dsvuoovivysszdoiorch`.**

---

## 1. The hole

Connected as `service_role`, staging accepted this row with no error:

| column | value |
|---|---|
| `conversation.tenant_id` | dealer **B** |
| `conversation.customer_id` | dealer **A**'s customer |
| `conversation.integration_id` | dealer **C**'s WhatsApp channel |

One row, three dealerships. `leads.assigned_to_id` likewise accepted another dealer's user.

Two reasons it was possible:

1. **`conversation.integration_id` had no foreign key of any kind.** Not a composite one — *none*. It was a bare `uuid` column. Staging had accumulated two `conversation` rows whose `integration_id` pointed at a `channel_registry` row that did not exist anywhere.
2. **Every other reference was single-column.** `conversation.customer_id → customer(id)` is satisfied by *any* dealership's customer.

**RLS does not help on this path.** `service_role` has `rolbypassrls`, and the ingest path runs as `service_role`. Every policy NX982/NX984 wrote is switched off for the exact role doing the writing. A row-level policy also only describes who may *read* a row; it says nothing about whether a row is internally coherent. Only constraints and triggers are evaluated for `service_role`, so only a constraint or a trigger holds this wall up.

The one table that already refused was `lead_event`, via NX976's trigger `lead_event_guard_lead_tenant`. That trigger is the template for this work.

---

## 2. The three mechanisms

### A. Composite foreign key carrying `tenant_id` — *preferred*
The NX995 `appointment` pattern. Parent gets `UNIQUE (tenant_id, <pk>)`; child references `(tenant_id, <fk>)`. Postgres refuses in the storage engine, for every role, `rolbypassrls` included. Used wherever the parent's `tenant_id` is `NOT NULL`.

`MATCH SIMPLE` (the default) is what we want: a `NULL` reference skips the check, so an unassigned lead stays legal.

### B. `lead_event`-style trigger — *only where a FK would be wrong*
`policy_rule.tenant_id` is **nullable by design**: 6 of 7 rules on staging are platform-global rules (`tenant_id IS NULL`) shared by every dealership. A composite FK would demand a parent at `(tenant_id, id)` and would therefore **refuse every tenant that cites a global rule** — it would take the policy engine down. The trigger encodes the real rule:

```
parent missing           -> refuse (dangling citation)
parent tenant_id IS NULL -> allow  (platform-global rule)
parent tenant_id = mine  -> allow
parent tenant_id = other -> REFUSE
```

### C. Polymorphic trigger — *where no FK can be written*
`journey_step` points at its subject through `(ref_table text, ref_id text)`. No foreign key can express that. The trigger resolves `ref_table` against a fixed allow-list and compares `tenant_id`. It enforces **only** when `ref_table` is a known tenant-scoped table *and* `ref_id` parses as a UUID — staging holds rows whose `ref_id` is a 2-character legacy handle, and those stay legal. A reference to a row that no longer exists is *not* refused: `journey_step` is an evidence log, and refusing to record evidence because its subject was deleted would lose the audit trail.

---

## 3. Coverage

### Composite FK (`*_same_dealership`) — 25 added, 29 total incl. NX995's four

| Child | Reference closed | Parent |
|---|---|---|
| `conversation` | `customer_id` | `customer` |
| `conversation` | `integration_id` *(had no FK at all)* | `channel_registry` |
| `leads` | `assigned_to_id` | `users` |
| `lead_event` | `lead_id` *(second layer beside NX976's trigger)* | `leads` |
| `tenant_members` | `staff_user_id` | `users` |
| `appointment_event` | `appointment_id` | `appointment` |
| `inventory_action_events` | `action_id` | `inventory_actions` |
| `lead_recovery_action_events` | `action_id` | `lead_recovery_actions` |
| `inventory_actions` | `outcome_purchase_id` | `purchase_history` |
| `lead_recovery_actions` | `outcome_purchase_id` | `purchase_history` |
| `whatsapp_delivery_events` | `event_id` | `channel_message_events` |
| `whatsapp_message_usage` | `event_id`, `template_id`, `latest_status_delivery_event_id`, `provider_pricing_delivery_event_id` | various |
| `im_*` family (9 refs) | identity-merge graph | `im_customer` / `im_conversation` / `im_opportunity` |

The `im_*` tables exist on **staging only**; the migration skips them with a `notice` where absent, so one file runs unchanged on both databases.

### Trigger — `public.nexus_guard_same_tenant_ref()`
`channel_send_directive.policy_applied_rule_id`, `policy_rule.supersedes_id`, `policy_rule_event.rule_id`, `whatsapp_message_usage.policy_rule_id` — all → `policy_rule` (nullable tenant).

### Trigger — `public.nexus_journey_step_guard_ref_tenant()`
`journey_step (ref_table, ref_id)`.

---

## 4. What is NOT covered, and why

**`communication_logs` and `audit_log` carry no reference to close.** They are flat, denormalised evidence tables holding the customer's **email address** and the salesperson's **name as text** — not ids. There is no reference for a composite key to carry and no parent for a trigger to resolve. Their only tenant-scoped tie is `tenant_id → tenants`, already `NOT NULL` and already a foreign key; the verify block asserts both.

A guard on `communication_logs.lead_email` was considered and **deliberately rejected**. The obvious rule — "refuse if this email belongs to another dealership's lead" — is wrong in the UAE market this product serves, where a buyer shops four dealerships in an afternoon. Dealer B legitimately messages a person who is currently only a lead in dealer A's database. Enforcing it would refuse real business to close a hole that does not exist: an email address is not a tenant-scoped row, and two dealers holding the same address is not a breach.

**`customer` gets no new constraint** because it is a *parent*, not a child — its only FK is `tenant_id → tenants`. It is protected by already having `UNIQUE (tenant_id, id)`, which is what lets `conversation` and `appointment` cite it safely. The verify block asserts that key still exists.

---

## 5. Proof on staging (3 tenants)

Tenants: **A** `0a1a…000a`, **B** `0b1b…000b`, **C** `52e10fb2…` (ZZ DUBAI MOTORS).

### Refused

| # | Write | Exact error |
|---|---|---|
| 1 | **The original hole** — B's conversation, A's customer, C's channel | `ERROR: 23503: insert or update on table "conversation" violates foreign key constraint "conversation_customer_same_dealership"` — `DETAIL: Key (tenant_id, customer_id)=(0b1b0000-0000-4000-8000-00000000000b, a3a3a3a3-0000-4000-8000-00000000a3a3) is not present in table "customer".` |
| 2 | B's own customer, but on **C's channel** | `ERROR: 23503: … violates foreign key constraint "conversation_channel_same_dealership"` — `DETAIL: Key (integration_id, tenant_id)=(365a7a61-f599-48f3-bbf6-27a10cd674dd, 0b1b0000-0000-4000-8000-00000000000b) is not present in table "channel_registry".` |
| 3 | B's lead assigned to **A's salesperson** | `ERROR: 23503: insert or update on table "leads" violates foreign key constraint "leads_assigned_user_same_dealership"` — `DETAIL: Key (tenant_id, assigned_to_id)=(0b1b0000-0000-4000-8000-00000000000b, a5a5a5a5-0000-4000-8000-00000000a5a5) is not present in table "users".` |
| 4 | C's journey step narrating **A's customer** | `ERROR: NX001: Journey step belongs to one dealership and cites a customer row belonging to another.` — `DETAIL: NX997_JOURNEY_STEP_CROSS_TENANT_REF` |
| 5 | B's policy event citing **tenant 2222…'s rule** | `ERROR: NX001: Policy rule event belongs to one dealership and cites a policy_rule row belonging to another.` — `DETAIL: NX997_CROSS_TENANT_REF` |
| 6 | C's staff seat for **A's user** | `ERROR: 23503: insert or update on table "tenant_members" violates foreign key constraint "tenant_members_staff_same_dealership"` — `DETAIL: Key (tenant_id, staff_user_id)=(52e10fb2-8067-4f23-b1a5-d35ad613c8ce, a5a5a5a5-0000-4000-8000-00000000a5a5) is not present in table "users".` |

### Accepted (the guard must not over-block)

| Write | Result |
|---|---|
| C's conversation over **C's own** customer on **C's own** channel | accepted |
| B's lead assigned to **B's own** salesperson | accepted |
| C's journey step citing **C's own** customer | accepted |
| Journey step with legacy non-UUID `ref_id` (`'99'`) | accepted — historical rows stay legal |
| **B citing a platform-global `policy_rule` (`tenant_id IS NULL`)** | accepted — *this is the write a composite FK would have wrongly refused* |

---

## 6. Notes for the production run

- **Production is clean.** Checked 18 Sep 2026 with `LEFT JOIN` (an inner join hides dangling rows and gives a false all-clear): `conversation→customer` 0, `conversation→channel_registry` 0, `leads→users` 0, `lead_event→leads` 0, `tenant_members→users` 0, `whatsapp_message_usage→channel_message_events` 0, `whatsapp_delivery_events→channel_message_events` 0.
- **No table here is large.** Production row counts: `conversation` 1, `customer` 1, `leads` 12, `journey_step` 16, `communication_logs` 399, `audit_log` 1464. Every constraint builds and validates instantly; no meaningful `ACCESS EXCLUSIVE` lock window.
- **If a violating row ever exists, the migration fails loudly and rolls back the whole transaction.** That is intended. Fix or quarantine the row, then re-run — do not add the constraint `NOT VALID` to get past it.
- **Staging needed two rows removed first.** The two pre-existing `conversation` rows (`a4a4a4a4…`, `b4b4b4b4…`) were synthetic fixtures whose `integration_id` existed in no `channel_registry` row at all. They were deleted on staging. Production has no equivalent.
- **Staging retains labelled NX997 test rows**: customer `cc999999…`, conversation `cc000003…`, two `journey_step` rows with `correlation_id='nx997-probe'`, and one `policy_rule_event` with `actor='nx997-guard-test'`.

### One defect this migration's own verify block caught
`revoke all on function … from public` is **not** enough on Supabase: default privileges grant `EXECUTE` to `anon` and `authenticated` explicitly, so a browser role could still call a guard function directly. NX983 hit the same trap. The migration now revokes from the named roles too, guarded by a `pg_roles` existence check.

---

## 7. Additive only

No drops, no rewrites. Existing single-column foreign keys are left exactly where they are and the composite keys are added **alongside** them under new names. A single-column FK is not wrong, merely insufficient; removing it here would turn a security fix into a schema migration with a blast radius. NX976's `lead_event` trigger is untouched and keeps working.
