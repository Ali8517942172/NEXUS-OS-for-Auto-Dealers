# The idempotency family — complete census, and what is now closed

**Date:** 5 September 2026
**Projects:** production `dsvuoovivysszdoiorch`, staging `wwspuxrbiyagnrnzgate`
**Method:** every unique index and constraint in `public` on production, every
`ON CONFLICT` clause in every non-aggregate `public` function, and every
`..._key` / `..._idempotency` name, read from the catalogue — not from the repo.
Every verdict below is a measurement or is marked as not measured.

**Migrations applied by this pass** (both projects, production-recorded md5):

| version | name | md5(statements[1]) |
|---|---|---|
| `20260905211409` | `processed_messages_message_id_must_be_a_provider_id` | `67b828d0cd64335b09deedc8d6108da1` |
| `20260905211423` | `message_identities_refuse_ids_minted_per_attempt` | `f8b86ffd0b08d7e22713be539bf0d2c2` |
| `20260905211435` | `whatsapp_template_identity_normalises_language_and_waba` | `32c0e59dc56f30631ea1a5760b620025` |

Repo files under `supabase/migrations/` match those md5s byte for byte, with no
trailing newline. Staging and production carry byte-identical definitions for
all four new CHECKs and the rebuilt template index.

---

## 1. The four the audit named as open — where they actually stand

`AUDIT-2026-09-04.md` recorded four. **Three were closed by other passes before
this one started**; I re-measured each rather than taking the record's word.

| # | Audit's item | Measured state now | Closed by |
|---|---|---|---|
| 1 | `whatsapp_delivery_events` keys on unnormalised `status_raw`, key omits `integration_id` | **CLOSED.** Key is `(tenant_id, integration_id, provider_message_id, status_key)`, `status_key` generated `lower(btrim(status_raw))` | `20260905192912` / `20260905192939` (another pass) |
| 2 | Eight of nine `tenant_id` + `integration_id` tables accept a mismatched pairing | **CLOSED.** All eight now carry a composite FK to `channel_registry(integration_id, tenant_id)`: `cme_`, `csd_`, `wcs_`, `wcms_`, `wde_`, `wmu_`, `woie_`, `wt_carrier_belongs_to_the_tenant` | another pass |
| 3 | `policy_applied_rule_id` is a bare uuid with no foreign key | **CLOSED.** `channel_send_directive_policy_applied_rule_id_fkey FOREIGN KEY (policy_applied_rule_id) REFERENCES policy_rule(id) ON DELETE RESTRICT` | another pass |
| 4 | `communication_logs`' unique index is inert | **DATABASE HALF CLOSED, DEFECT OPEN.** Key rebuilt on generated `channel_key`/`direction_key`; a CHECK refuses `nokey:`/`outreach:`/`exec-`/`run-`/`job-` and bare epochs. **No writer sends the column** — 114 live rows, all NULL. See `/home/claude/out/communication-logs-writer-change-NOT-DEPLOYED.md` | `20260905204047` / `20260905204353` (another pass) |

So of the four, **one remains open, and it is open in n8n, not in the database.**

---

## 2. The full census

Every uniqueness key in `public` on production. The point is the complete list;
most of it is fine.

### 2a. Keys that carry an operation's repeat-safety

| Key | Columns | Genuine retry collides? | Genuinely different event collides? | Caller-controlled or per-attempt component? | Verdict |
|---|---|---|---|---|---|
| `whatsapp_customer_message_seen_pkey` | `tenant_id, integration_id, customer_wa_id, external_message_id` | **yes** (proved 23505) | no — other carrier inserts (staging B5) | `external_message_id` was caller-supplied with only a trim/length check → **fixed this pass** | **CLOSED (this pass)** |
| `channel_message_events_channel_direction_extmsg_key` | `tenant_id, integration_id, direction, external_message_id` | **yes** (23505) | no — other direction inserts (prod C4) | same → **fixed this pass** | **CLOSED (this pass)** |
| `whatsapp_delivery_events_idempotency` | `tenant_id, integration_id, provider_message_id, status_key` | **yes** (23505, incl. `'  sent '` vs `'sent'`) | no — other status inserts; other carrier inserts | `status_key` generated; `provider_message_id` **fixed this pass** | **CLOSED** |
| `processed_messages_pkey` | `tenant_id, message_id` | **yes** (23505) | no | **`message_id` was minted per attempt by the live writer** → constraint added this pass; **writer still mints** | **DB CLOSED / DEFECT OPEN in n8n** |
| `communication_logs_external_identity_key` | `tenant_id, channel_key, direction_key, external_message_id` | would, if fed | no | `channel_key`/`direction_key` generated; CHECK refuses minted ids | **DB CLOSED / DEFECT OPEN in n8n** (no writer) |
| `whatsapp_opt_in_event_act_key` | `tenant_id, integration_id, customer_wa_id, event, occurred_at` | yes | no | nothing caller-invented in it | **FINE** |
| `whatsapp_opt_in_event_evidence_once` | `tenant_id, integration_id, customer_wa_id, lower(btrim(evidence_ref))` | yes | no | `evidence_kind` deliberately absent; `event` deliberately absent | **FINE** |
| `channel_send_directive_request_ref_key` | `tenant_id, request_ref` WHERE not null | yes | no | `request_ref` is caller-supplied **and is the event** — the caller's declaration of "same logical send"; `requested_by` correctly removed; null ref refuses rather than going unkeyed | **FINE** |
| `whatsapp_templates_identity_key` | was `tenant_id, provider, COALESCE(waba_ref,''), name, language` | yes | **`en_US` and `en_us` were two identities for one Meta template** | `language` case was not folded | **CLOSED (this pass)** — now `(tenant_id, provider, waba_key, name, language_key)`, both generated |
| `whatsapp_templates_provider_id_key` | `tenant_id, provider, provider_template_id` WHERE not null | yes | no | the provider's own id | **FINE** |
| `whatsapp_message_usage_one_per_message` | `tenant_id, event_id` | yes | no | `event_id` is an FK to an already-unique event | **FINE** |
| `whatsapp_conversation_state_pkey` | `tenant_id, integration_id, customer_wa_id` | n/a — state, not an event | n/a | none | **FINE** |
| `daily_metrics_tenant_snapshot_key` | `tenant_id, snapshot_date` | yes | no | none | **FINE** |
| `customer_360_profiles_tenant_customer_id_key` | `tenant_id, customer_id` | yes | no | `customer_id` is the directory uuid; the two-key-space bug was fixed in the aggregation node | **FINE** |
| `deals_embeddings_tenant_deal_id_key` | `tenant_id, deal_id` | yes | no | none | **FINE** |
| `purchase_history_tenant_deal_id_key` | `tenant_id, deal_id` WHERE not null | yes | no | none | **FINE** |
| `leads_tenant_email_key` | `tenant_id, email` | yes | no | none in the key — but see §4, the router posts `?on_conflict=email` | **FINE (key) / see §4** |
| `users_tenant_email_key` | `tenant_id, email` | yes | no | none | **FINE** |
| `whatsapp_contacts_pkey` | `tenant_id, chat_id` | yes | no | none | **FINE** |
| `inventory_pkey` | `tenant_id, id` | yes | no | none | **FINE** |
| `tenant_capability_pkey` | `tenant_id, capability_key` | yes | no | none | **FINE** |
| `tenant_members_pkey` | `tenant_id, auth_user_id` | yes | no | none | **FINE** |

### 2b. Registry / vocabulary / invariant keys — not event identities

`channel_registry_pkey`, `channel_registry_integration_tenant_key` (the target of
the eight composite FKs), `channel_registry_type_identifier_key` (global on
purpose — one phone number belongs to one dealership; `external_identifier` is
normalised by CHECK), `tenants_slug_key`, `tenants_one_quarantine`,
`tenants_one_unattributed_default`, `inventory_actions_one_live_per_unit`,
`policy_rule_global_version_uq`, `policy_rule_tenant_version_uq`,
`policy_rule_supersedes_uq`, `policy_jurisdiction_code_owner_uq`,
`policy_unit_code_kind_uq`, `policy_unmigrated_constant_uq`, and the
`*_pkey` of every lookup table (`attribution_*`, `channel_send_form`,
`channel_provider_*`, `deal_rescue_*`, `lead_recovery_*`,
`whatsapp_message_intent`, `policy_rule_type`, `tenant_capability_catalogue`,
`tenant_configuration*`, `inventory_action_reason_codes`, …).
All **FINE** — none of these is a repeat-safety key for an inbound event.

### 2c. Every `ON CONFLICT` in a `public` function

| Function | Target | Verdict |
|---|---|---|
| `nexus_record_channel_event` | `ON CONSTRAINT channel_message_events_channel_direction_extmsg_key DO NOTHING` | **FINE** — named constraint, returns the first event on a replay |
| `whatsapp_record_customer_message` | `ON CONSTRAINT whatsapp_customer_message_seen_pkey DO NOTHING`, then the state upsert `(tenant_id, integration_id, customer_wa_id) DO UPDATE … WHERE excluded > current` | **FINE** — the seen-table is the serialisation point and the window is monotonic |
| `whatsapp_record_delivery_status` | `ON CONSTRAINT whatsapp_delivery_events_idempotency DO NOTHING` | **FINE** |
| `whatsapp_record_opt_in_event` | bare `DO NOTHING` | **FINE** — bare covers both consent constraints, which is what is wanted |
| `capture_daily_metrics` | `(tenant_id, snapshot_date) DO UPDATE` | **FINE** |
| `nexus_onboard_dealership` | `(slug)`, `(tenant_id, email)`, `(tenant_id, auth_user_id)` | **FINE** — and it refuses to rename the quarantine tenant before the upsert |
| `nexus_register_channel` | `(channel_type, external_identifier) DO UPDATE SET credential_ref, status` | **FINE** — the conflict target omits `tenant_id`, which would be a cross-tenant carrier hijack, **except that the function reads the existing owner first and raises if it is a different dealership.** Measured in the body, not assumed. |

---

## 3. What this pass changed, and how each was proved

Every probe below ran inside a transaction that ends in `raise exception`, so
**nothing was persisted**. Confirmed afterwards on production: `processed_messages`
73 rows (unchanged, 0 matching `%PROBE%`), `whatsapp_customer_message_seen` 0,
`channel_message_events` 0, `whatsapp_delivery_events` 0, `whatsapp_templates` 0,
`communication_logs` 114. No production business data was altered.

### 3a. `processed_messages.message_id` must be the provider's

The AI agent's "have I already answered this?" claim. Live writer
(`whatsapp_bdc_ai_agent.json:713`) posts `$json.message_id || ('nokey:' + $now.toMillis())`.
A per-attempt id means every retry claims a fresh identity and the agent answers
the customer again.

Measured before applying, so the constraint could not fail on live data: 73 rows,
shortest id 44 characters, 0 with whitespace, 0 minted, 0 numeric, 0 untrimmed.
**The `nokey:` branch has never fired in production** — this is a latent defect on
a live path, not a live incident.

**Production SQLSTATEs:**

```
A1 nokey:1757083200000            -> 23514   refused
A2 1757083200000 (bare epoch)     -> 23514   refused
A3 1428 (n8n $execution.id shape) -> 23514   refused
A3b outreach:abcdefgh             -> 23514   refused
A4 real WAHA id                   -> INSERTED
A5 same id, source changed to     -> 23505   retry collides; a caller cannot
   'outreach'                                mint a second claim by relabelling
A6 a different real id            -> INSERTED  a different event does not collide
```

### 3b. The three v2 message identities refuse an id minted per attempt

`whatsapp_customer_message_seen`, `channel_message_events`,
`whatsapp_delivery_events` each required only a trimmed, non-empty id. None
required it to be the **provider's**. `whatsapp_record_customer_message` carries
a 400-character hint against per-delivery ids — a hint is advice, and
`service_role` writes these tables directly, so it was not a guard.

`whatsapp_customer_message_seen` is the sharp one: it is the key that stops a
replay moving `last_customer_message_at`, and that column is the single fact that
turns `TEMPLATE_REQUIRED` into `FREEFORM_ALLOWED`. `CLAUDE.md` records the window
fix as "defeated by the live `nokey:` shape". It is not defeatable that way now.

**Production SQLSTATEs:**

```
B1 seen: nokey:…                        -> 23514
B2 seen: exec-991                       -> 23514
B3 seen: real id                        -> INSERTED
B4 seen: SAME id replayed with a         -> 23505   the window cannot be extended
   timestamp six hours later                        by replaying one message
C1 events: nokey:…                      -> 23514
C2 events: real id                      -> INSERTED
C3 events: same id, same direction      -> 23505
C4 events: same id, other direction     -> INSERTED  genuinely different event
D1 delivery: nokey:…                    -> 23514
D2 delivery: real id, status_raw 'SENT' -> INSERTED
D3 delivery: same id, '  sent '         -> 23505   case + whitespace collide
D4 delivery: same id, 'delivered'       -> INSERTED  genuinely different event
```

Carrier separation could only be proved on **staging**, which has two carriers on
one tenant; production has exactly one and I did not create a second:

```
B5 (staging) seen: same message id, other carrier     -> INSERTED
D4 (staging) delivery: same id, other carrier         -> INSERTED
```

A uuid is **not** refused, deliberately. Unlike consent evidence — which must
resolve to a row NEXUS already holds — a message id is only required to be
stable across attempts, and some providers do issue uuid-shaped ids. A bare
integer **is** refused: an n8n `$execution.id`, a `$now.toMillis()` and a unix
epoch are all bare integers, and no WhatsApp provider message id is.

### 3c. `whatsapp_templates` identity normalised

`wat_name_shape` already forced `name = lower(btrim(name))`, so the name half was
safe. `language` was not: `wat_language_shape` permits
`^[a-z]{2,3}(_[A-Za-z]{2,4})?$`, so `en_US` and `en_us` were two identities for
one Meta template — two `nexus_state` values for one thing, and the send path
takes whichever it reads first. `waba_ref` was folded by a `COALESCE` written
inside the index expression rather than by a column.

Now `(tenant_id, provider, waba_key, name, language_key)` with both keys
generated-always-stored, the same construction as `status_key`. The verbatim
provider strings stay in `language` and `waba_ref` as the evidence.

**Production SQLSTATEs:**

```
E1 name promo_probe, language en_US       -> INSERTED
E2 same, language en_us  (case forgery)   -> 23505   collides
E3 same, waba_ref '' vs NULL              -> 23505   collides
E4 same, language ar                      -> INSERTED  genuinely different
E5 same, waba_ref '123456'                -> INSERTED  genuinely different WABA
E6 write language_key directly            -> 428C9   generated, unwritable
E7 write waba_key directly                -> 428C9   generated, unwritable
```

E6/E7 are the forgery test that matters: no caller can mint a second identity by
writing the key column, because the key column cannot be written at all.

---

## 4. Still open — stated, not papered over

1. **`processed_messages`' writer still mints.** The database refuses it; the
   n8n node still asks. And the node is **fail-open** — `Claim Message Id` is
   `onError: continueRegularOutput` and `Is New Message?` is an OR that treats
   `$json.error` as "new message, reply". So after the constraint, a message with
   no provider id still produces a duplicate reply on retry; what changed is that
   the table no longer records a false claim and the run reports PARTIAL instead
   of SUCCESS. **The duplicate reply is closed only by the node change**, written
   up in `/home/claude/out/n8n-processed-messages-nokey-NOT-DEPLOYED.md`.

2. **`communication_logs` has no writer.** Another pass's item; 114 rows, all
   `external_message_id` NULL. `/home/claude/out/communication-logs-writer-change-NOT-DEPLOYED.md`.

3. **`processed_messages` has no `integration_id`** — the carrier is not in the
   identity, and the table has no such column. Latent rather than live: WAHA and
   Cloud API ids are different namespaces, two WAHA sessions for one tenant
   produce the same `payload.id` for one message (which *should* dedupe), and a
   different tenant is separated by `tenant_id`. I did not add the column: a
   `NOT NULL` carrier on a table whose only writer is a live n8n node that does
   not send it would break inbound WhatsApp immediately, on a box this pass was
   told not to touch. The right fix is the writer moving to
   `nexus_record_channel_event`, which already keys on the carrier — not a column
   bolted onto the legacy table.

4. **`nexus_master_lead_router_ai_agent.json:658` posts `leads?on_conflict=email`**
   while the only unique index is `(tenant_id, email)`. PostgREST will emit
   `ON CONFLICT (email)`, which has no matching index — a 42P10, not a silent
   duplicate. This is the database's own documented item
   (`nexus_tenancy_readiness()` names it by name) and it is an n8n fix, not a
   database one. **Not measured against the live box by this pass** — the repo
   export is 30 August and stale.

5. **`policy_rule_event` has no partial unique index over its NULL-tenant rows**,
   so duplicate platform-wide rows are possible (`nexus_tenancy_readiness()`
   WARN). Left alone deliberately: it is an append-only audit log carrying
   `actor` and `at`, and the same rule genuinely can be verified twice. It is not
   an idempotency key and giving it one would delete real history.

6. **The consent writer is the disciplined door, not the only door.** Unchanged
   by this pass and recorded in `CLAUDE.md`: there is no `SECURITY DEFINER` on
   `whatsapp_opt_in_event`, so `service_role` — which n8n holds — can insert an
   `OPT_IN` directly and bypass the writer's checks. That is an authority
   question, not an identity one.

7. **Two probe rows left on staging by another pass** —
   `whatsapp_delivery_events` holds `wamid.COLLIDE.1` × 2, recorded
   2026-09-05 19:26:52, not mine and not deleted by me. They satisfy the new
   CHECK, which is why the migration validated. Production is unaffected.

**None of this changes the verdict on messaging.** The identities are materially
better than they were this morning, but `processed_messages`' writer still mints
per attempt, `communication_logs` still has no writer, and every operational
messaging table except `processed_messages`, `communication_logs` and
`channel_registry` still holds **zero rows** — the layer remains wired but never
fired.
