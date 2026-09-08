# `channel_message_events` — shape, wiring, and what refuses a real message today

Written 8 September 2026. Every constraint claim below carries the `SELECT` that
proved it, run read-only against production `dsvuoovivysszdoiorch`. Nothing here
was applied. **Measured** and **Proposed** are kept apart on purpose: the first
half of this document is a reading of the live catalogue, the second half is a
design that has never run.

The owner's instruction is `channel_message_events` ko finally use karo. The
table is designed, correctly shaped, and holds zero rows. This document says
what has to be written into it, by whom, from which field of which payload, and
what will refuse the write on the first real customer message.

---

## 0. Scope, and the three questions this document does not answer

Owned here: the **shape** of `channel_message_events` and the **wiring** that
fills it.

Not owned here, and deliberately not re-decided:

| question | owner | what this document assumes |
|---|---|---|
| claim-before-write or write-before-claim (durability) | the durability agent | §3 writes the channel event **before** any reply is composed, and treats a `23505` on the idempotency key as "already handled, stop". If that agent lands claim-after-write instead, only the ordering in §3.5 changes; no column changes. |
| what a customer / conversation / opportunity *is* | the identity-model agent | §4 and §5 need a stable person entity. This document does not invent one. Where it needs one it names a **join column** (`customer_identity_key`) and leaves the entity it points at to that agent. `lead_event` is treated as opaque. |
| whether `communication_logs.lead_email` is replaced by that entity | the identity-model agent | §4 fixes the linkage for **new** rows only, and says explicitly that the 142 historical rows are not fixed by anything proposed here. |

Also not owned: `whatsapp_conversation_state`. It is read in §5 because the
dedupe design must not touch it, and the reason it must not touch it is the
whole point of §5.3.

---

# PART ONE — MEASURED

## 1. The table as it actually is

### 1.1 Columns

```sql
select a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as type,
       a.attnotnull, pg_get_expr(d.adbin, d.adrelid) as default_expr
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where n.nspname = 'public' and c.relname = 'channel_message_events'
 order by a.attnum;
```

| # | column | type | null | default |
|---|---|---|---|---|
| 1 | `event_id` | uuid | NOT NULL | `gen_random_uuid()` |
| 2 | `tenant_id` | uuid | NOT NULL | — |
| 3 | `integration_id` | uuid | NOT NULL | — |
| 4 | `provider` | text | NOT NULL | — |
| 5 | `channel_type` | text | NOT NULL | — |
| 6 | `direction` | text | NOT NULL | — |
| 7 | `external_message_id` | text | NOT NULL | — |
| 8 | `customer_external_id` | text | null | — |
| 9 | `customer_phone` | text | null | — |
| 10 | `conversation_id` | text | null | — |
| 11 | `message_kind` | text | NOT NULL | — |
| 12 | `media_ref` | text | null | — |
| 13 | `media_mime` | text | null | — |
| 14 | `media_sha256` | text | null | — |
| 15 | `provider_account_id` | text | null | — |
| 16 | `provider_delivery_ref` | text | null | — |
| 17 | `origin_verified` | text | NOT NULL | — |
| 18 | `received_at` | timestamptz | NOT NULL | — |
| 19 | `recorded_at` | timestamptz | NOT NULL | `now()` |

**There is no message body column, and no `lead_id`, and no `customer_id`.**
That is not an omission. `media_ref` is constrained to be a *reference* and not
content (`media_ref !~ '^data:'`). This table is a provenance and identity
ledger for messages, not a transcript. Section 4 turns on this fact.

### 1.2 Constraints

```sql
select con.conname, con.contype, pg_get_constraintdef(con.oid) as def
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'channel_message_events'
 order by con.contype, con.conname;
```

| kind | name | definition |
|---|---|---|
| CHECK | `channel_message_events_channel_type_check` | `channel_type IN ('whatsapp_waha_session','whatsapp_cloud_phone_number_id')` |
| CHECK | `channel_message_events_cloud_requires_signature` | `provider <> 'whatsapp_cloud' OR origin_verified = 'hmac_sha256_x_hub'` |
| CHECK | `channel_message_events_customer_phone_is_digits_or_null` | `customer_phone IS NULL OR customer_phone ~ '^[0-9]{6,20}$'` |
| CHECK | `channel_message_events_direction_check` | `direction IN ('inbound','outbound')` |
| CHECK | `channel_message_events_extmsg_shape` | `external_message_id = btrim(...) AND length BETWEEN 1 AND 300` |
| CHECK | `channel_message_events_media_ref_is_a_reference` | `media_ref IS NULL OR (length <= 500 AND media_ref !~ '^data:')` |
| CHECK | `channel_message_events_message_kind_check` | `message_kind IN ('text','image','audio','video','document','sticker','location','contacts','interactive','button','order','reaction','system','unsupported')` |
| CHECK | `channel_message_events_origin_verified_check` | `origin_verified IN ('hmac_sha256_x_hub','shared_header','unverified')` |
| CHECK | `channel_message_events_provider_check` | `provider IN ('waha','whatsapp_cloud')` |
| CHECK | `channel_message_events_provider_matches_channel_type` | `(waha AND whatsapp_waha_session) OR (whatsapp_cloud AND whatsapp_cloud_phone_number_id)` |
| CHECK | `cme_extmsg_is_a_provider_id` | `external_message_id !~ '[[:space:]]' AND length >= 8 AND !~* '^(nokey:\|outreach:\|exec-\|run-\|job-)' AND !~ '^[0-9]+$'` |
| FK | `channel_message_events_tenant_id_fkey` | `(tenant_id) → tenants(id) ON DELETE RESTRICT` |
| FK | `channel_message_events_integration_id_fkey` | `(integration_id) → channel_registry(integration_id) ON DELETE RESTRICT` |
| FK | `cme_carrier_belongs_to_the_tenant` | `(integration_id, tenant_id) → channel_registry(integration_id, tenant_id)` |
| PK | `channel_message_events_pkey` | `(event_id)` |
| UNIQUE | `channel_message_events_channel_direction_extmsg_key` | `(tenant_id, integration_id, direction, external_message_id)` |

Note what is **absent**: no shape check on `customer_external_id` (no
lower/btrim, unlike both sibling tables), no length or secret check on
`conversation_id` (unlike `wde_refs_are_not_secrets` on the sibling), no check
that `media_mime` accompanies `media_ref`, no check that `media_sha256` is 64
hex characters.

### 1.3 Indexes

| index | definition |
|---|---|
| `channel_message_events_pkey` | UNIQUE `(event_id)` |
| `channel_message_events_channel_direction_extmsg_key` | UNIQUE `(tenant_id, integration_id, direction, external_message_id)` |
| `channel_message_events_customer_idx` | `(tenant_id, customer_external_id)` |
| `channel_message_events_integration_idx` | `(integration_id)` |
| `channel_message_events_tenant_received_idx` | `(tenant_id, received_at DESC)` |

There is no index on `customer_phone`, and none on `(tenant_id, direction,
external_message_id)` — which is the exact predicate
`whatsapp_record_delivery_status` uses to find the outbound event to link a
status callback to (§2, D4).

### 1.4 RLS and grants

```sql
select c.relrowsecurity, c.relforcerowsecurity,
       p.polname, p.polcmd, pg_get_expr(p.polqual, p.polrelid) as using_expr
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
 where n.nspname = 'public' and c.relname = 'channel_message_events';
```

`relrowsecurity = true`, **`relforcerowsecurity = true`** (the table owner is
subject to RLS too — only two of the seven tables surveyed have this).

| policy | cmd | roles | using / check |
|---|---|---|---|
| `channel_message_events_deny_end_users` | ALL | `authenticated`, `anon` | `false` / `false` |
| `channel_message_events_service_role_all` | ALL | `service_role` | `true` / `true` |

Grants: `postgres` and `service_role` hold the full set. **`authenticated` and
`anon` hold nothing at all** — not even SELECT. So no dashboard screen can read
this table directly today; anything the UI needs must come through a view or an
RPC, and that view will itself be `security_invoker` (see §6.0).

### 1.5 The siblings, and their row counts

```sql
select 'channel_message_events' t, count(*) n from channel_message_events
union all select 'whatsapp_delivery_events',       count(*) from whatsapp_delivery_events
union all select 'whatsapp_customer_message_seen', count(*) from whatsapp_customer_message_seen
union all select 'whatsapp_message_usage',         count(*) from whatsapp_message_usage
union all select 'channel_registry',               count(*) from channel_registry
union all select 'whatsapp_conversation_state',    count(*) from whatsapp_conversation_state
union all select 'communication_logs',             count(*) from communication_logs;
```

| table | rows | confirms |
|---|---|---|
| `channel_message_events` | **0** | zero, as expected |
| `whatsapp_delivery_events` | **0** | zero |
| `whatsapp_customer_message_seen` | **0** | zero |
| `whatsapp_message_usage` | **0** | zero |
| `whatsapp_conversation_state` | **0** | zero |
| `channel_registry` | **2** | both tenant `fff6a2b5…` (ALBA CARS): WAHA session `default`, Cloud phone_number_id `1306545252542419` |
| `communication_logs` | **142** | **not 120** — it has grown since the last measurement; the whatsapp/inbound bucket is still being written every day (latest row `2026-09-08 17:24:39Z`) |

The whole messaging layer below `channel_registry` is empty. Every claim about
its behaviour in this repository, including the ones in this document, is a
claim about code that has never processed a real message.

Key structural facts about the siblings, from `pg_constraint`:

- `whatsapp_delivery_events.event_id` → `channel_message_events(event_id)`,
  nullable, guarded by `wde_link_state_matches_the_fk`: a delivery row is either
  `LINKED` with an event or `UNLINKED_NO_OUTBOUND_EVENT` with none.
- `whatsapp_message_usage.event_id` → `channel_message_events(event_id)`,
  **NOT NULL**, plus `UNIQUE (tenant_id, event_id)`. **A message with no
  `channel_message_events` row can have no cost record.** This is the load-
  bearing fact behind defect D3.
- `whatsapp_customer_message_seen` and `whatsapp_conversation_state` both
  normalise their customer id (`= lower(btrim(...))`, length 1–120).
  `channel_message_events.customer_external_id` does not (D8).

---

## 2. What refuses a real message

`nexus_record_channel_event` (SECURITY DEFINER, `search_path = public,
pg_catalog`) validates the role, the presence of `external_message_id`, the
registry lookup, the channel/tenant status, the provider mapping, and the Cloud
signature — each with a named exception and a sentence. **Everything else it
passes through to the CHECK constraints unchanged.** So every row below that is
a `no` becomes a raw `23514` / `23505` at the INSERT, not one of this
function's readable refusals. That difference is the "what the caller
experiences" column.

The live Cloud receiver (`ops/n8n-whatsapp-cloud/receiver.sdk.js`, node
`Record Channel Event`) sends, verbatim:

```
p_customer_external_id: $('Verify Or Refuse').item.json.customer_wa_id,
p_customer_phone:  '+' + $('Verify Or Refuse').item.json.customer_wa_id,
p_message_kind:    $('Verify Or Refuse').item.json.message_kind,
p_external_message_id: $('Verify Or Refuse').item.json.message_id,
p_received_at:     $('Verify Or Refuse').item.json.occurred_at,
```

and `Verify Or Refuse` sets `message_kind: String(m.type || 'text')` — Meta's
own type string, unmapped — and `occurred_at: measurable ? ISO : null`.

### 2.1 The constraint table

Evaluated by applying each constraint's own expression, read from
`pg_constraint`, to the value the transport actually produces:

```sql
with v(label, val) as (values
 ('cloud_phone_plus','+971501234567'),
 ('cloud_phone_bare','971501234567'),
 ('waha_wa_id_cus','971501234567@c.us'),
 ('waha_wa_id_lid','123456789012345@lid'),
 ('cloud_wamid','wamid.HBgMOTcxNTAxMjM0NTY3FQIAEhggQjNFQjBDMkM3RjhBOTk5RTM3RjE='),
 ('waha_id_full','false_971501234567@c.us_3EB0C767D26B8CE5A1B2'),
 ('waha_id_short','3EB0C767D26B8CE5'),
 ('cloud_media_id','1234567890123456'),
 ('waha_media_dataurl','data:image/jpeg;base64,/9j/4AAQSkZJRg'),
 ('waha_media_url','http://waha:3000/api/files/false_971501234567@c.us_3EB0.jpeg'))
select label, val,
  (val ~ '^[0-9]{6,20}$')                                    as customer_phone_ok,
  ((val !~ '[[:space:]]') and length(val) >= 8
    and (val !~* '^(nokey:|outreach:|exec-|run-|job-)')
    and (val !~ '^[0-9]+$'))                                 as extmsg_is_provider_id_ok,
  ((val = btrim(val)) and length(val) between 1 and 300)     as extmsg_shape_ok,
  ((length(val) <= 500) and (val !~ '^data:'))               as media_ref_ok
  from v;
```

| constraint | realistic value | source | result | what the caller experiences |
|---|---|---|---|---|
| `..._customer_phone_is_digits_or_null` | `+971501234567` | Cloud receiver, `'+' + wa_id` | **REFUSED** | `23514` at `Record Channel Event`. `retryOnFail:3`, no `onError` → node throws → `Respond 200 Recorded` never runs → n8n answers Meta 5XX → Meta retries → identical failure. The lead is lost and the endpoint looks alive. |
| `..._customer_phone_is_digits_or_null` | `971501234567` | Cloud, `'+'` removed | accepted | — |
| `..._customer_phone_is_digits_or_null` | `971501234567@c.us` | WAHA `payload.from` | **REFUSED** | Same `23514`. The WAHA adapter must extract digits, not pass the JID. |
| `..._customer_phone_is_digits_or_null` | `123456789012345@lid` | WAHA LID chat | **REFUSED** | Same. And an `@lid` handle carries **no phone digits at all** — the number, when present, is in `_data.Info.SenderAlt`. If it is absent the honest value is `NULL`, which the constraint permits. Never synthesise. |
| `cme_extmsg_is_a_provider_id` | `wamid.HBgMOTcxNTAxMjM0NTY3FQIAEhggQjNFQjBDMkM3RjhBOTk5RTM3RjE=` (62 chars) | Cloud `messages[].id` | accepted | — |
| `channel_message_events_extmsg_shape` | same wamid | Cloud | accepted | 62 ≤ 300 |
| `cme_extmsg_is_a_provider_id` | `false_971501234567@c.us_3EB0C767D26B8CE5A1B2` | WAHA `payload.id` | accepted | — |
| `cme_extmsg_is_a_provider_id` | `3EB0C767D26B8CE5` | WAHA short id | accepted | — |
| `cme_extmsg_is_a_provider_id` | `1234567890123456` | any all-digit id | **REFUSED** | `23514`. Correct behaviour — this is the check that stops an epoch being used as a message id — but it means a provider that ever emits a numeric id has no home here. |
| `..._media_ref_is_a_reference` | `data:image/jpeg;base64,…` | WAHA inlined media | **REFUSED** | `23514`. The adapter must store a URL or a provider media id, never the bytes. |
| `..._media_ref_is_a_reference` | `http://waha:3000/api/files/…` | WAHA `mediaUrl` | accepted | Accepted, and **wrong** — that URL is container-local and expires. See §3.4. |
| `..._message_kind_check` | Meta `text`,`image`,`audio`,`video`,`document`,`sticker`,`location`,`contacts`,`interactive`,`button`,`order`,`reaction`,`system`,`unsupported` | Cloud | accepted | — |
| `..._message_kind_check` | Meta `request_welcome`, `ephemeral`, `unknown` | Cloud | **REFUSED** | `23514`, passed straight through by `String(m.type)`. `request_welcome` fires when a customer opens a chat from an ad or a click-to-WhatsApp link — a first-touch marketing lead — and is exactly the delivery a dealership most wants recorded. |
| `..._message_kind_check` | WAHA `chat` | WAHA text message | **REFUSED** | `23514`. **`chat` is whatsapp-web.js's type string for an ordinary text message.** A WAHA adapter that passes `payload.type` through refuses *every text message it will ever see*. |
| `..._message_kind_check` | WAHA `ptt`, `vcard`, `multi_vcard`, `revoked`, `ciphertext`, `e2e_notification`, `notification_template`, `poll_creation`, `poll_update`, `list`, `list_response`, `buttons_response`, `template_button_reply`, `groups_v4_invite`, `call_log`, `gp2`, `product`, `payment`, `broadcast_notification` | WAHA | **REFUSED** (19 of 19) | `23514` each. `ptt` is a voice note, which this repository already transcribes and treats as a first-class message. |
| `..._direction_check` | `inbound`, `outbound` | both | accepted | `internal` — which `communication_logs` holds 2 rows of — is refused. |
| `..._origin_verified_check` | `hmac_sha256_x_hub`, `shared_header`, `unverified` | both | accepted | — |
| `..._cloud_requires_signature` | Cloud **inbound**, `hmac_sha256_x_hub` | Cloud receiver | accepted | Correct and load-bearing. |
| `..._cloud_requires_signature` | Cloud **outbound**, `unverified` (the honest value for a call we made) | any Cloud sender | **REFUSED** | `23514`. See D3 — this is the largest defect in the set. |
| `..._cloud_requires_signature` | Cloud **outbound**, `hmac_sha256_x_hub` (a signature we never received) | any Cloud sender | **accepted** | The constraint accepts the lie and refuses the truth. |
| `..._provider_matches_channel_type` | both live registry rows | registry | accepted | Derived inside the function from `channel_registry.channel_type`; a caller cannot get this wrong. |

The proof for the `message_kind` rows:

```sql
with k(src, val) as (values ('waha','chat'),('waha','ptt'),('meta','request_welcome'),
                            ('meta','ephemeral'),('meta','unknown') /* … 37 values … */)
select src, val,
       val = any (array['text','image','audio','video','document','sticker','location',
                        'contacts','interactive','button','order','reaction','system','unsupported'])
         as accepted
  from k;
-- waha/chat -> false   waha/ptt -> false   meta/request_welcome -> false
-- meta/ephemeral -> false   meta/unknown -> false
```

23 of 37 realistic type strings are refused: 19 WAHA, 3 Meta, plus WAHA's `chat`
counted among the 19.

### 2.2 Every defect found, including the one already on record

| # | defect | evidence | severity |
|---|---|---|---|
| **D1** | Cloud receiver sends `'+' + wa_id` into a digits-only column. | `('+971501234567' ~ '^[0-9]{6,20}$') → false`, `('971501234567' ~ …) → true` | Already on record in `ops/whatsapp-cloud/WAHA-EXIT-PLAN.md §2`. Re-verified. Blocks the first real Cloud message. |
| **D2** | `message_kind` is passed through unmapped from both providers. WAHA's `chat` (every text message) and `ptt` (every voice note) are refused; Meta's `request_welcome` (every click-to-WhatsApp ad lead), `ephemeral` and `unknown` are refused. | §2.1 table | **New.** Blocks the first WAHA message outright, and Meta's highest-value lead type. |
| **D3** | `cloud_requires_signature` makes an honest outbound Cloud row impossible. Because `whatsapp_message_usage.event_id` is NOT NULL FK to this table, **NEXUS can never record the cost of a WhatsApp Cloud message.** And because `whatsapp_record_delivery_status` links a status callback by looking up `channel_message_events` where `direction='outbound'`, every Cloud delivery callback lands `UNLINKED_NO_OUTBOUND_EVENT` forever, so `whatsapp_apply_delivery_to_usage` never fires. | `pg_get_functiondef('whatsapp_record_delivery_status')` — the lookup is `where e.tenant_id = v_tenant and e.direction='outbound' and e.external_message_id = v_ext`; `wmu_*` constraints; `whatsapp_message_usage_event_id_fkey` | **New in this consequence.** The constraint itself is on record; that it silently disables the entire billing chain is not. |
| **D4** | That same lookup does **not** filter `integration_id`, and no constraint requires `whatsapp_delivery_events.integration_id` to match the linked event's `integration_id`. During dual-run, a status callback arriving on the Cloud carrier can link to an outbound event recorded on the WAHA carrier of the same tenant, and `wde_waha_reports_no_billing` is keyed on the *delivery row's* provider, not the event's — so Cloud pricing could be attached to a WAHA message. | function source above; `pg_constraint` shows only `whatsapp_delivery_events_event_id_fkey (event_id)`, no composite | **New.** Low probability (the id spaces do not overlap today), zero prevention. |
| **D5** | `wde_recipient_is_digits_or_null` on `whatsapp_delivery_events` is the *same* `^[0-9]{6,20}$` rule. Meta's `statuses[].recipient_id` is bare digits, so the status receiver is safe **if** it passes the field through — and will hit D1's exact failure the moment anyone prefixes it. Nothing calls the function yet. | `pg_get_constraintdef` | **New (same class as D1).** Latent. |
| **D6** | `channel_registry_type_identifier_key` is `UNIQUE (channel_type, external_identifier)` with **no `tenant_id`**. The one live WAHA row has `external_identifier = 'default'`, which is WAHA's default session name. A second dealership running its own WAHA instance cannot register, anywhere in the platform. | `CREATE UNIQUE INDEX channel_registry_type_identifier_key ON public.channel_registry USING btree (channel_type, external_identifier)` | **New.** Harmless for Cloud (`phone_number_id` is globally unique at Meta); a hard block for WAHA multi-tenancy. |
| **D7** | `communication_logs.external_message_id` is NULL on **142 of 142** rows, so `communication_logs_external_identity_key` — a btree UNIQUE containing that column — collides on nothing. The idempotency fix is applied in the database and armed in zero writers. | `count(*) filter (where external_message_id is not null) → 0` | **Re-measured and worse.** `ops/n8n-bundle-NOT-DEPLOYED/03-…` recorded 0 of 114; it is now 0 of 142. |
| **D8** | `customer_external_id` has no normalisation check, while both sibling tables enforce `= lower(btrim(...))`. The same person can be `971…@C.US` here and `971…@c.us` there, and `channel_message_events_customer_idx` is built on the un-normalised column. | `pg_constraint`: `wacms_customer_normalised` and `wa_conv_customer_id_normalised` exist; no equivalent on this table | **New.** Cheap to fix additively. |
| **D9** | `conversation_id` has no length or secret check, unlike `wde_refs_are_not_secrets` on the sibling that holds the same Meta value. | `pg_constraint` | **New.** Minor. |
| **D10** | `received_at` is `NOT NULL` with no default; `nexus_record_channel_event` coalesces a null to `now()`. `Verify Or Refuse` emits `occurred_at: null` on its `ACCEPT_UNMEASURABLE` branch. So an undated message gets a **fabricated** receipt time in this ledger, while `whatsapp_record_customer_message` correctly refuses the same message (`'An inbound message with no timestamp cannot open a window'`). The two ledgers would disagree, and this one would be the one that made something up. | function source; receiver source | **New.** |
| **D11** | `external_message_id` is capped at 300 here and at 512 in `communication_logs`. A provider id between 301 and 512 characters is recordable in one ledger and not the other. | `channel_message_events_extmsg_shape` vs `communication_logs_external_message_id_is_a_provider_id` | **New.** Latent; no such id is known today. |
| **D12** | `media_ref` accepts WAHA's `mediaUrl`, which is a container-local, expiring URL. The constraint cannot tell a durable reference from a dead one. | §2.1 table | **New.** A shape problem the constraint cannot solve; §3.4 solves it in the adapter. |

D1, D2 and D10 all sit on the inbound path and all fire before the first row is
written. D3 sits on the outbound path and cannot be fixed by a writer at all.

---

## 3. PROPOSED — the writer contract

Nothing in this section has run. It is what §6 would install.

### 3.1 The rule

**One row per message per carrier per direction.** `external_message_id` is
always the *provider's own message id* and never a per-delivery id — WAHA's
`x-webhook-request-id` and `body.id` change per delivery and would defeat the
idempotency key; `nexus_record_channel_event` already says so in its refusal
text. A message that carries no provider id is not recorded here at all; it is
recorded in `communication_logs` with `external_message_id IS NULL` and the
conversation stays unmeasured. That refusal is deliberate and is the same one
`whatsapp_record_customer_message` makes.

### 3.2 Inbound, column by column

| column | WhatsApp Cloud | WAHA |
|---|---|---|
| `tenant_id` | derived inside the function from `channel_registry` — never passed | same |
| `integration_id` | resolved from `entry[].changes[].value.metadata.phone_number_id` via `nexus_resolve_channel_tenant('whatsapp_cloud_phone_number_id', …)`. Meta's own field, in bytes we verified. | resolved from the WAHA **session name** via `nexus_resolve_channel_tenant('whatsapp_waha_session', …)`. Note: `body.session` is caller-supplied, so this is only as strong as the gate in front of it — see §3.6. |
| `provider` / `channel_type` | derived in the function | derived in the function |
| `direction` | `'inbound'` | `'inbound'` |
| `external_message_id` | `messages[].id` (the `wamid.…`) | `payload.id` (`false_…@c.us_3EB0…` or the bare `3EB0…`), **never** `x-webhook-request-id` |
| `customer_external_id` | `messages[].from` — bare E.164 digits | `payload.from` — the JID as sent (`971…@c.us` or `…@lid`), lowercased and trimmed by the adapter |
| `customer_phone` | `messages[].from` **verbatim, no `'+'`** (fixes D1) | digits extracted from the JID: for `@c.us` the part before `@`; for `@lid` **`NULL` unless** `_data.Info.SenderAlt` yields digits. Never synthesise a number from a LID. |
| `conversation_id` | not present on an inbound `messages[]` element — `NULL`. Meta's conversation object arrives only on `statuses[]`. | `NULL` — WAHA has no equivalent |
| `message_kind` | **mapped**, not passed through (fixes D2) — see §3.3 | **mapped** — see §3.3 |
| `media_ref` | `messages[].image.id` (or `.audio.id`, `.document.id`, …) — Meta's media id, which is redeemable against the Graph API for as long as the media lives | see §3.4 |
| `media_mime` | `messages[].<type>.mime_type` | `payload.media.mimetype` |
| `media_sha256` | `messages[].<type>.sha256` — Meta gives it | WAHA does not give it; `NULL`, not a computed substitute |
| `provider_account_id` | `entry[].id` — the WABA id | the WAHA session's `me.id`, or `NULL` |
| `provider_delivery_ref` | the delivery's own id if one is available; otherwise `NULL` | `x-webhook-request-id` — **this is the column that per-delivery id belongs in**, and the reason the column exists |
| `origin_verified` | `'hmac_sha256_x_hub'`, and only after the raw-bytes HMAC passed | `'shared_header'` when the WAHA gate verified a shared secret; `'unverified'` otherwise. Never `hmac_sha256_x_hub`. |
| `received_at` | `to_timestamp(messages[].timestamp)`. **If `timestamp` is absent or zero, do not call this function at all** (fixes D10) — record in `communication_logs` and leave the conversation unmeasured, matching what the window writer already does. | `payload.timestamp`, same rule |

### 3.3 The `message_kind` map

The adapter owns this, not the database, because the two providers' vocabularies
are different sizes and neither is ours. Unmapped values collapse to
`'unsupported'` — which the constraint already permits and which is the honest
answer for a type we have not taught the system.

| NEXUS `message_kind` | Cloud `messages[].type` | WAHA `payload.type` |
|---|---|---|
| `text` | `text` | **`chat`** |
| `image` | `image` | `image` |
| `audio` | `audio` | `audio`, **`ptt`** |
| `video` | `video` | `video` |
| `document` | `document` | `document` |
| `sticker` | `sticker` | `sticker` |
| `location` | `location` | `location` |
| `contacts` | `contacts` | `vcard`, `multi_vcard` |
| `interactive` | `interactive` | `list`, `list_response`, `buttons_response`, `template_button_reply` |
| `button` | `button` | — |
| `order` | `order` | `product`, `order` |
| `reaction` | `reaction` | `reaction` |
| `system` | `system`, `request_welcome`, `ephemeral` | `e2e_notification`, `notification_template`, `gp2`, `groups_v4_invite`, `broadcast_notification`, `call_log`, `revoked` |
| `unsupported` | `unknown`, anything else | `ciphertext`, `poll_creation`, `poll_update`, `payment`, anything else |

Two judgement calls, stated so they can be argued with:

- **`request_welcome` maps to `system`, and that loses information.** It is the
  click-to-WhatsApp first touch and a dealership would want to count it. The
  alternative is to widen the CHECK, which is §6 Stage 2. Until then `system`
  is the honest bucket and the lost attribution is recorded in
  `provider_delivery_ref` / the raw log, not invented in `message_kind`.
- **`ptt` maps to `audio`.** A voice note *is* audio; the fact that it was a
  push-to-talk recording is not currently representable and is not worth a
  vocabulary change on its own.

### 3.4 Media, and the two transports' disagreement

Cloud gives a **media id** (`messages[].image.id`) plus a `sha256`. That id is
durable for as long as Meta keeps the media, is not a URL, and is redeemable
with a token we hold. Record it in `media_ref` and record the `sha256`.

WAHA gives either a container-local `mediaUrl` (`http://waha:3000/api/files/…`),
which dies when the container restarts, or inline base64, which
`..._media_ref_is_a_reference` refuses outright. Neither is a durable reference.
The adapter must therefore either:

1. fetch the bytes, put them in object storage, and record **that** URL plus a
   locally computed `media_sha256`; or
2. record `media_ref = NULL`, `media_mime` from the payload, and accept that the
   media is not retrievable later.

Option 2 is what the system does today by omission. Option 1 is a real piece of
work and belongs to whoever owns media, not to this document. **What must not
happen is recording the WAHA `mediaUrl` and calling it a reference** — the
constraint accepts it and the value is dead within a restart (D12).

### 3.5 Outbound, and the constraint that makes an honest row impossible

For **WAHA outbound**, the contract is straightforward: `direction='outbound'`,
`external_message_id` = the id WAHA returned from the send call,
`origin_verified='unverified'` — because it is: we made the call, nobody signed
anything — `customer_external_id` / `customer_phone` = the recipient,
`received_at` = the moment the provider accepted the send.

For **Cloud outbound**, `channel_message_events_cloud_requires_signature`
refuses `origin_verified='unverified'` and accepts `'hmac_sha256_x_hub'`. The
repository already records this and records that `origin_verified` on an
outbound row is evidence of nothing. Restating it is not an answer, so here is
one.

**The column is answering the wrong question for outbound rows.** For an inbound
row, `origin_verified` answers *"did the provider prove it sent us this?"* — a
real question with a real cryptographic answer. For an outbound row there is no
such question; the provider did not send us anything. What is worth recording
about an outbound row is *"did the provider acknowledge it, and with what id?"*,
which is a different fact with a different answer.

Three ways out, and the recommendation:

| option | what it does | cost |
|---|---|---|
| **A. Widen the constraint to inbound only** — `provider <> 'whatsapp_cloud' OR direction <> 'inbound' OR origin_verified = 'hmac_sha256_x_hub'` | Restores the ability to write an honest Cloud outbound row. Keeps the inbound guarantee exactly as strong. | One `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT`. Both DDL statements fire the ACL guard (harmless). **Not this document's constraint to change** — it belongs to whoever owns the Cloud signature invariant. This document proposes it and does not apply it. |
| **B. Add a fourth `origin_verified` value, `not_applicable_outbound`,** and require it on outbound rows | Makes the column's meaning explicit instead of merely permitted. | Widens a vocabulary that other code reads; needs a sweep of consumers. More honest than A, more disruptive. |
| **C. Leave it, and keep `channel_send_directive` as the outbound ledger** | Zero change. | **This is the status quo and it is broken**, because `whatsapp_message_usage.event_id` is a NOT NULL FK to *this* table and `channel_send_directive` cannot satisfy it. Cost accounting stays impossible for Cloud, forever (D3). |

**Recommendation: A**, and it must land before any Cloud send, not after. Until
it lands, this document's writer contract for Cloud outbound is: **do not write
a `channel_message_events` row at all.** Writing one by asserting
`hmac_sha256_x_hub` would put a false provenance claim into the ledger whose
entire purpose is provenance, to work around a constraint — the exact trade this
repository refuses everywhere else. A missing row is an absence NEXUS can see
and explain; a fabricated signature is not.

### 3.6 Ordering, and the dependency on the durability agent

Assumed, not decided here: the receiver writes the channel event **first**, and
treats "already present" as "another delivery of this message is already being
handled — stop". `nexus_record_channel_event` already returns
`first_seen boolean` for exactly this, and its `ON CONFLICT ON CONSTRAINT
channel_message_events_channel_direction_extmsg_key DO NOTHING` makes the INSERT
the serialisation point.

If the durability agent lands claim-after-write, the only change is that the
reply path branches on something other than `first_seen`. No column here moves.

One caveat this document cannot resolve: for WAHA, `integration_id` is resolved
from a **caller-supplied** session name, so `first_seen` is only as trustworthy
as the gate in front of it. On Cloud it is resolved from a field inside bytes
Meta signed, and is trustworthy. That asymmetry is the WAHA gate's problem, not
this table's, and it is already recorded in `ops/n8n-waha-gate/README.md`.

---

## 4. PROPOSED — `communication_logs`

### 4.1 Name the consumers first, because that list is the cost

**Views (11), from `pg_depend`:**

```sql
select distinct dependent.relname, dependent.relkind
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class dependent on dependent.oid = r.ev_class
  join pg_class src on src.oid = d.refobjid
  join pg_namespace n on n.oid = src.relnamespace
 where n.nspname = 'public' and src.relname = 'communication_logs'
   and dependent.relname <> 'communication_logs';
```

`v_attribution_edges`, `v_attribution_events`, `v_attribution_lead_chain`,
`v_attribution_sale_chain`, `v_communication_log_evidence`, `v_conversations`,
`v_customer_360`, `v_inventory_profit_sentinel`, `v_lead_messages`,
`v_lead_recovery_coverage`, `v_lead_timeline_admissible`.

**Functions (7), from `pg_proc.prosrc`:**
`nexus_lead_trace`, `nexus_mark_first_response`, `nexus_quarantine_census`,
`nexus_quarantine_comm_log`, `nexus_sync_comm_log_evidence_state`,
`nexus_tenancy_readiness`, `nexus_trace_linkability_report`.

**Trigger (1):** `trg_comm_logs_first_response AFTER INSERT ON
communication_logs FOR EACH ROW EXECUTE FUNCTION nexus_mark_first_response()` —
this is what sets `leads.response_time_minutes`. **A view cannot carry an AFTER
INSERT FOR EACH ROW trigger.**

**n8n workflows that write it (6):** `whatsapp_bdc_ai_agent`
(`Log Incoming Message`, `Log Conversation`), `whatsapp_send_dashboard_reply`
(`Log Outbound`), `7_day_warm_lead_drip_campaign` (six `Log …` nodes, all
**email**), `phase_6_12_hour_silence_detector`, `lead_escalation_ai_agent`,
`kyc_aml_document_auditor_re_upload_loop_phase_5`.

**Dashboard files that read it or its views (21):** `screens/actions.js`,
`attribution.js`, `campaigns.js`, `compliance.js`, `conversations.js`,
`customers.js`, `deals.js`, `inventory.js`, `lead-recovery.js`, `leads.js`,
`money-leaks.js`, `overview.js`, `revenue.js`, `team.js`; `lib/comm-events.js`,
`format.js`, `identity.js`, `identity.test.mjs`, `lead-drawer.js`,
`unit-form.js`, `vocabulary.js`. Plus `QUALITY_GATE.mjs`, which pins the exact
column list of `communication_logs`, `v_conversations`, `v_lead_messages`,
`v_customer_360`, `v_lead_timeline_admissible` and
`v_communication_log_evidence` and fails on drift.

**Also:** `ops/demo/seed_demo_tenant.sql` and `teardown_demo_tenant.sql` insert
into and delete from it directly; `supabase/sentinel/sentinel_03_engine_view.sql`
reads it.

### 4.2 The answer: parallel write, narrowed. Not a view. Not retired.

**`communication_logs` does not become a view over `channel_message_events`.**
Three reasons, in order of how decisive they are:

1. **`channel_message_events` has no message body, by design.** `v_conversations`
   returns `last_message` and `last_msg`; `v_lead_messages` returns `message`;
   `v_lead_timeline_admissible` returns `message` and `content_withheld`; the
   AI agent's `Fetch Thread History` reads message text out of
   `communication_logs`. A view over a table with no text column cannot produce
   text. Adding a body column to `channel_message_events` would change what that
   table *is* — it is currently a provenance ledger with a constraint
   (`media_ref !~ '^data:'`) explicitly forbidding content — and that is a
   decision for whoever owns retention and PII, not a side effect of this
   wiring.

2. **`channel_message_events` cannot hold most of what `communication_logs`
   holds.** Its `channel_type` CHECK admits two WhatsApp values and nothing
   else. `communication_logs` today holds `channel='system'` (5 rows) and
   `direction='internal'` (2 rows), both refused by
   `channel_message_events_direction_check` and the channel/provider vocabulary;
   and the drip campaign's six `Log …` nodes write **email** rows, of which
   there happen to be zero in production right now but which are the designed
   behaviour of a live workflow.

   ```sql
   select coalesce(channel,'(null)') channel, coalesce(direction,'(null)') direction, count(*)
     from communication_logs group by 1,2 order by 3 desc;
   -- whatsapp / inbound   109
   -- whatsapp / outbound   28
   -- system   / outbound    3
   -- system   / internal    2
   ```

3. **A backfill is not possible.** Zero of 142 rows carry an
   `external_message_id`, which `channel_message_events` requires NOT NULL and
   constrains to look like a provider id. Minting one per historical row would
   mean inventing provider ids — precisely what `cme_extmsg_is_a_provider_id`
   exists to refuse. And a trigger that maintains `leads.response_time_minutes`
   cannot survive the table becoming a view.

**So the proposal is:** the two tables carry different facts and are joined, not
merged.

- `channel_message_events` — **identity and provenance.** Which carrier, which
  provider id, which direction, what kind, was the origin proved. One row per
  message per carrier. Never contains content.
- `communication_logs` — **content and the human-readable thread.** What was
  said, by whom, when. Keeps every consumer above working unchanged.
- The join: **`communication_logs.channel_event_id uuid` → `channel_message_events(event_id)`**,
  nullable, added additively (§6 Stage 3). Nullable because email rows, system
  rows and every one of the 142 historical rows have no channel event and never
  will.

The writer contract becomes: record the channel event first; if it succeeds,
pass `event_id` **and** the same `external_message_id` into the
`communication_logs` insert. That also, at last, arms `D7` — the
`communication_logs_external_identity_key` unique index that has never collided
on anything because the column is null on every row.

### 4.3 What this fixes about the email-string link, and what it does not

The defect: `communication_logs.lead_email` is one `text` column holding at
least four incompatible key shapes — a real email, a WhatsApp `@c.us` chat id, a
`@lid` handle, and a synthesised `+digits@whatsapp.lead`.

Re-measured today, and the previously quoted **79%** is stale in both
directions:

```sql
select count(*) total,
       count(*) filter (where lead_email like '%@lid') as lid_handles,
       count(*) filter (where exists (select 1 from leads l
                        where lower(btrim(l.email)) = lower(btrim(communication_logs.lead_email))))
         as matches_a_lead_email_directly,
       count(distinct lead_email) as distinct_keys
  from communication_logs;
-- 142 | 95 | 35 | 18

select count(*) filter (where nexus_lead_for_comm_key(lead_email, tenant_id) is not null)
       as resolved_by_the_identity_rule, count(*) as total
  from communication_logs;
-- 70 | 142
```

- **75.4%** (107 of 142) match no lead by direct email equality.
- **50.7%** (72 of 142) resolve to no lead even under the repository's own
  identity rule `nexus_lead_for_comm_key`.
- **95 of 142 rows are `@lid` handles**, which contain no phone digits at all.

**What the proposal fixes:** for every *new* WhatsApp row, the person is
reachable through `channel_event_id → channel_message_events.customer_external_id`
and `.customer_phone`, which are two typed columns with a stated meaning rather
than one text column with four. `customer_phone` in particular is
constraint-guaranteed to be bare digits or NULL, which is the only key that can
be matched against `leads.phone` without a regex.

**What it does not fix:**

- The 142 historical rows. They have no channel event and cannot be given one.
  They stay on `nexus_lead_for_comm_key` forever, at 50.7% unresolved.
- `@lid` rows, new or old. A LID handle has no phone digits; the number, when it
  exists at all, is in `_data.Info.SenderAlt` and the adapter (§3.2) may find
  nothing there. Those rows get `customer_phone IS NULL`, which is the honest
  answer and is still not a link to a lead.
- `lead_email` itself. Nothing here removes the column or changes any of the 11
  views. Retiring it is the identity-model agent's decision, and it should be
  made *after* new rows have a better key to be migrated onto, not before.

---

## 5. PROPOSED — dedupe across transports

### 5.1 What the three existing controls actually key on

| control | key | absorbs |
|---|---|---|
| `processed_messages_pkey` | `(tenant_id, message_id)` | a WAHA redelivery of the same `payload.id` |
| `whatsapp_customer_message_seen_pkey` | `(tenant_id, integration_id, customer_wa_id, external_message_id)` | a redelivery on the **same** carrier |
| `channel_message_events_channel_direction_extmsg_key` | `(tenant_id, integration_id, direction, external_message_id)` | the same |

None absorbs the cross-transport case, for three independent reasons: the
provider ids differ (`3EB0…` vs `wamid.HBg…`), the `integration_id` differs, and
the customer identity differs (`971…@c.us` vs bare `971…`).

### 5.2 What would absorb it, and what each costs

**There is no key that identifies "the same human utterance" across two
providers.** Anything claiming to is a heuristic. So the options are:

| option | mechanism | cost |
|---|---|---|
| **1. Content-window merge** — unique on `(tenant_id, customer_identity_key, direction, sha256(body), date_trunc('second', received_at))` | Collapses the genuine duplicate. | **Rejected.** It also collapses a customer who sends `ok` twice in the same second, and it requires the body — which this table deliberately does not hold. It buys a false merge to avoid a double reply. |
| **2. Do not dedupe the message. Serialise the *reply*.** A single-flight claim on `(tenant_id, customer_identity_key)` held for a short interval; the second transport's pipeline records its event and its `communication_logs` row, and does not compose a reply. | Both messages stay recorded, honestly, on their own carriers. Exactly one reply goes out. | An advisory lock or a small claim table, and a decision about the interval. Two rows appear in the thread for one utterance — visible, explicable, and true (the customer really did reach two numbers). |
| **3. Do nothing during dual-run; run the two numbers as two conversations.** | Zero code. | Two AI replies to one customer. §3 of `WAHA-EXIT-PLAN.md` argues the same number cannot be on both platforms at once, so this only happens when the dealership advertises two numbers. |

**Recommendation: option 2**, and only for the duration of the migration. It is
the only one that does not require inventing a fact.

Option 2 needs a grouping key, which is the one additive column this section
proposes:

```
channel_message_events.customer_identity_key text     -- normalised, nullable
```

Derived by the **adapter**, not by a generated column, because the `@lid` case
needs a payload field (`_data.Info.SenderAlt`) that the database cannot see:

- Cloud `971501234567` → `971501234567`
- WAHA `971501234567@c.us` → `971501234567`
- WAHA `123456789012345@lid` → `SenderAlt` digits if present, else **NULL**

NULL means *unknown*, and unknown never groups with anything. Index it
`(tenant_id, customer_identity_key)`. This groups **threads**; it does not
identify messages, and it must not be mistaken for a dedupe key.

### 5.3 The constraint on all of this — read before implementing

**Nothing proposed here may reach `whatsapp_conversation_state`.**

That table's window is what turns `TEMPLATE_REQUIRED` into `FREEFORM_ALLOWED`.
The repository already records the failure mode: `whatsapp_record_customer_message`
once upserted on timestamp alone, and replaying one message with a later
timestamp **extended Meta's 24-hour customer service window** — proved end to
end. The fix is the `whatsapp_customer_message_seen` seen-table as a
serialisation point, plus a monotonic guard, read live from
`pg_get_functiondef`:

```sql
on conflict (tenant_id, integration_id, customer_wa_id) do update
   set last_customer_message_at = excluded.last_customer_message_at, …
 where c.last_customer_message_at is null
    or excluded.last_customer_message_at > c.last_customer_message_at
```

Both that guard and the seen-table key are **per-carrier by construction**
(`integration_id` is in both keys). Introducing `customer_identity_key` into
either would collapse two carriers into one window row — and then a WAHA
redelivery, arriving with a later clock, could move a window that a Cloud
message opened. That is the exact replay hole, reopened through a different
door.

So, stated as an invariant this design accepts:

> `customer_identity_key` may group threads for display, for reply
> single-flighting, and for joining to a person. It may not appear in any key,
> guard or predicate that decides whether a message window is open.

Correspondingly: `whatsapp_record_customer_message` is called **once per
carrier**, with that carrier's own `customer_wa_id` and `external_message_id`,
exactly as it is written today. A message that arrives on both transports opens
two windows, because two windows genuinely exist — one per number — and each is
governed by its own platform's rules.

---

## 6. PROPOSED — the migration

Additive, staged, reversible. Each stage stands alone and none depends on a
later one. Every stage's verification is a `SELECT` that fails loudly if the
stage did not land.

### 6.0 The ACL guard fires on every stage

```sql
select evtname, evtevent, evtenabled, evttags from pg_event_trigger order by evtname;
-- nexus_guard_born_open_grants        | ddl_command_end | O | (null)   <- NO TAG FILTER
-- nexus_guard_security_invoker_views  | ddl_command_end | O | {CREATE VIEW, ALTER VIEW, ALTER TABLE}
```

`nexus_guard_born_open_grants` has **no tag filter**, so it fires on *every*
DDL command in every stage below, including `ALTER TABLE … ADD CONSTRAINT` and
every `GRANT`. Its `nexus.acl_guard` flag is set with `is_local = true`, so it
is reset at statement end and does not suppress itself across statements in the
same migration.

What that means per object type, from the guard's own body:

| DDL in a stage | guard fires? | what it revokes |
|---|---|---|
| `ALTER TABLE … ADD COLUMN` / `ADD CONSTRAINT` on `public.channel_message_events` | **yes** | re-runs `REVOKE ALL … FROM anon` and `REVOKE INSERT/UPDATE/DELETE/TRUNCATE … FROM authenticated` on the table. No-op — the table already has neither. |
| `CREATE INDEX` | yes (the index is reported; not in the guard's object-type list) | nothing |
| `CREATE OR REPLACE FUNCTION` | **yes** | `REVOKE ALL ON FUNCTION … FROM anon`. So an RPC must be granted to `service_role` explicitly, in a statement **after** the create; that `GRANT` re-enters the guard, which revokes `anon` again and leaves `service_role` untouched. Any `GRANT EXECUTE … TO anon` would be silently undone. |
| `CREATE VIEW` | **yes, twice** | the ACL guard revokes as above; `nexus_guard_security_invoker_views` additionally requires `WITH (security_invoker = true)`. Every view below declares it. |

No stage below intends to grant anything to `anon` or `authenticated`, so the
guard is a no-op throughout. It is named per stage anyway because "it fires and
does nothing" is a different claim from "it does not fire".

---

### Stage 1 — fix the two things that block the first real message

**No DDL.** Two n8n edits in `ops/n8n-whatsapp-cloud/receiver.sdk.js`, then
republish `J8MXprxVw1yhjBpp`.

1. `p_customer_phone: '+' + $('Verify Or Refuse').item.json.customer_wa_id`
   → `p_customer_phone: $('Verify Or Refuse').item.json.customer_wa_id` (D1)
2. `message_kind: String(m.type || 'text')` in `verify-or-refuse.node.js`
   → the §3.3 map, defaulting to `'unsupported'` (D2)
3. Guard `p_received_at`: on the `ACCEPT_UNMEASURABLE` branch, do not call
   `nexus_record_channel_event` at all (D10)

*Guard:* not applicable — no DDL.
*Verify:* one real message from `+91 85179 42172`; then

```sql
select event_id, direction, provider, message_kind, customer_phone,
       origin_verified, received_at
  from channel_message_events order by recorded_at desc limit 5;
```

Expect one row, `customer_phone` bare digits, `received_at` equal to Meta's
`messages[].timestamp` and not to the receipt time.
*Rollback:* republish the previous workflow version. The receiver writes nothing
on the refusal path, so a bad version costs refused deliveries, not bad rows.

---

### Stage 2 — widen `message_kind`, and normalise `customer_external_id`

```sql
alter table public.channel_message_events
  drop constraint channel_message_events_message_kind_check,
  add  constraint channel_message_events_message_kind_check
       check (message_kind = any (array[
         'text','image','audio','video','document','sticker','location','contacts',
         'interactive','button','order','reaction','system','unsupported',
         'request_welcome','ephemeral']));

alter table public.channel_message_events
  add constraint cme_customer_external_id_normalised
      check (customer_external_id is null
             or (customer_external_id = lower(btrim(customer_external_id))
                 and length(customer_external_id) between 1 and 120));

alter table public.channel_message_events
  add constraint cme_conversation_id_is_not_a_secret
      check (conversation_id is null
             or (length(conversation_id) <= 200
                 and conversation_id !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'));
```

Fixes D8 and D9, and recovers `request_welcome` as a first-class kind so the
click-to-WhatsApp lead is not flattened into `system`. All three are safe to
add without `NOT VALID` because the table is empty.

*Guard:* fires on each `ALTER TABLE`; revokes nothing that exists.
*Verify:*

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.channel_message_events'::regclass and contype = 'c'
 order by conname;
```
Expect 13 CHECKs, the `message_kind` one listing 16 values.
*Rollback:* drop the two new constraints; restore the 14-value `message_kind`
list. Reversible while the table is empty; after rows exist, a narrowing
rollback needs `NOT VALID` or a sweep.

---

### Stage 3 — the join to `communication_logs`

```sql
alter table public.channel_message_events
  add column customer_identity_key text;

alter table public.channel_message_events
  add constraint cme_identity_key_is_digits_or_null
      check (customer_identity_key is null
             or customer_identity_key ~ '^[0-9]{6,20}$');

create index channel_message_events_identity_idx
    on public.channel_message_events (tenant_id, customer_identity_key)
 where customer_identity_key is not null;

alter table public.communication_logs
  add column channel_event_id uuid
      references public.channel_message_events(event_id) on delete restrict;

create index communication_logs_channel_event_idx
    on public.communication_logs (channel_event_id)
 where channel_event_id is not null;
```

Nullable throughout, so all 142 existing rows remain valid and every existing
writer keeps working unchanged.

*Guard:* fires on each statement; revokes nothing that exists. **Note:**
`ALTER TABLE` also fires `nexus_guard_security_invoker_views` — which inspects
views, not tables, and is a no-op here.
*Verify:*

```sql
select count(*) as rows_total,
       count(channel_event_id) as rows_linked
  from public.communication_logs;
-- expect 142 | 0 immediately after the stage
```
and after the first message on the new writer, `rows_linked` = 1.
*Rollback:* `drop column channel_event_id`, `drop column customer_identity_key`,
drop the two indexes. No data is lost because nothing but the new writer sets
them.

---

### Stage 4 — the writer

**No DDL.** The receivers begin sending `p_customer_identity_key` (a new
defaulted parameter on `nexus_record_channel_event` — see below) and passing the
returned `event_id` into the `communication_logs` insert alongside the same
`external_message_id`.

The function change is additive and must keep the existing 14-argument
signature callable, so it is a new parameter with a default at the end of the
list:

```sql
create or replace function public.nexus_record_channel_event(
  … existing 14 parameters unchanged …,
  p_customer_identity_key text default null)
returns table(event_id uuid, tenant_id uuid, first_seen boolean)
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$ … $$;

grant execute on function public.nexus_record_channel_event(
  uuid, text, text, text, timestamptz, text, text, text, text, text, text,
  text, text, text, text) to service_role;
```

*Guard:* `CREATE OR REPLACE FUNCTION` fires it and revokes `anon`'s EXECUTE —
which is the desired end state. The `GRANT … TO service_role` that follows fires
it again and is not affected.
*Caution:* adding a defaulted parameter creates a **new** function signature
rather than replacing the old one, so both exist afterwards and PostgREST will
resolve on the named arguments the caller sends. The old signature must be
dropped in a later stage, once no caller uses it — not in this one.
*Verify:* a real message, then

```sql
select c.id, c.channel, c.direction, c.external_message_id, c.channel_event_id,
       e.provider, e.customer_phone, e.customer_identity_key, e.origin_verified
  from communication_logs c
  join channel_message_events e on e.event_id = c.channel_event_id
 order by c.created_at desc limit 5;
```
Expect the `external_message_id` on both rows to be identical.
*Rollback:* revert the workflow. The columns stay, unset.

---

### Stage 5 — the outbound constraint (NOT this document's to apply)

Option A from §3.5:

```sql
alter table public.channel_message_events
  drop constraint channel_message_events_cloud_requires_signature,
  add  constraint channel_message_events_cloud_inbound_requires_signature
       check (provider <> 'whatsapp_cloud'
              or direction <> 'inbound'
              or origin_verified = 'hmac_sha256_x_hub');
```

**Proposed and not applied.** It is the Cloud-signature invariant's constraint,
not this one's. Until it lands, §3.5's rule holds: no Cloud outbound row is
written at all, `whatsapp_message_usage` stays empty for Cloud, and NEXUS has no
cost record for a Cloud message — which is D3, and which should be stated in
that language to whoever owns billing.

*Guard:* both statements fire it; revokes nothing that exists.
*Verify:* after the first Cloud send,

```sql
select e.event_id, e.direction, e.origin_verified, u.usage_id, u.billing_fact_state,
       d.link_state
  from channel_message_events e
  left join whatsapp_message_usage u on u.event_id = e.event_id
  left join whatsapp_delivery_events d on d.event_id = e.event_id
 where e.provider = 'whatsapp_cloud' and e.direction = 'outbound';
```
Expect one event, one usage row, and delivery rows moving to `LINKED`.
*Rollback:* restore the original constraint. Safe only while no outbound Cloud
row exists; once one does, the rollback would refuse it.

---

### Stage 6 — the two defects this document found in the siblings

Neither is on the `channel_message_events` write path; both are recorded here
because they were found by reading it, and both belong to other owners.

- **D4** — add a composite so a delivery event cannot link across carriers:
  `UNIQUE (event_id, integration_id)` on `channel_message_events`, then
  `FOREIGN KEY (event_id, integration_id) REFERENCES channel_message_events(event_id, integration_id)`
  on `whatsapp_delivery_events`; and add `and e.integration_id = p_integration_id`
  to the lookup in `whatsapp_record_delivery_status`.
- **D6** — `channel_registry_type_identifier_key` should be
  `(tenant_id, channel_type, external_identifier)`, or WAHA session names must
  be made globally unique by convention. Today, no second dealership can
  register a WAHA session named `default`, and `default` is what WAHA calls its
  session.

*Guard:* fires on each. *Verify / rollback:* per statement, standard.

---

## Unknowns

1. **Whether the deployed `J8MXprxVw1yhjBpp` is byte-identical to
   `ops/n8n-whatsapp-cloud/receiver.sdk.js`.** Every claim in §2 about what the
   receiver sends is a reading of the repository, not of the box. The `'+'`
   defect was found the same way. Confirm against the published definition
   before calling Stage 1 done.

2. **WAHA's exact type vocabulary on this deployment.** §3.3's WAHA column is
   built from whatsapp-web.js `MessageTypes`, which is what WAHA wraps. WAHA's
   own engine choice (WEBJS / NOWEB / GOWS) changes the strings. Nothing in this
   repository records which engine is running, and the WAHA path has written
   zero `channel_message_events` rows, so no observed value exists to check
   against. **`chat` for a text message is the single most important entry in
   that table and it is the one I am most confident of; the long tail is
   inferred.** One live WAHA delivery, logged raw, settles it.

3. **Whether Meta emits `request_welcome` to this app.** It is documented for
   click-to-WhatsApp entry points; whether it reaches a webhook subscribed only
   to `messages` on a test number is not established here.

4. **Whether `whatsapp_message_usage` is the only thing D3 disables.** I traced
   the FK and `whatsapp_apply_delivery_to_usage`. Other consumers of
   `whatsapp_message_usage` — the Compliance screen reads it, and
   `authenticated` holds SELECT on it — may have their own emptiness-handling
   that is currently indistinguishable from "no messages sent".

5. **What `communication_logs`' 47 non-`@lid` keys actually are.** 18 distinct
   keys across 142 rows; 35 rows match a `leads.email` directly; the identity
   rule resolves 70. What the other shapes are — synthesised
   `+digits@whatsapp.lead`, stale emails, typos — is not broken down here. It
   matters for whether §4.3's "not fixed" set can be reduced by anything other
   than a channel event.

6. **Whether media is worth storing.** §3.4 names two options and recommends
   neither, because retention and PII are not this document's call. Today
   option 2 (record nothing) is in force by omission and nobody has decided it.

7. **The cost of Stage 4's duplicate function signature.** Adding a defaulted
   parameter leaves both signatures resolvable. PostgREST resolves on named
   arguments, so the existing receiver keeps working — but this has not been
   tested against this project's PostgREST version, and a wrong resolution
   would silently drop `p_customer_identity_key`.

---

## Open questions for Ali

1. **`channel_message_events_cloud_requires_signature` — may it be narrowed to
   inbound?** Without this, NEXUS can never record what a WhatsApp Cloud
   message cost, because the cost table's foreign key points at a row the
   constraint forbids. The alternative is to keep writing outbound rows that
   claim a Meta signature we never received. I recommend narrowing it, and I
   have not applied it, because it is not this document's constraint.

2. **During the WAHA→Cloud dual-run, should a customer who reaches both numbers
   get one reply or two?** §5.2 recommends one (single-flight on the reply, both
   messages still recorded). Two is defensible — they really did contact two
   numbers — and is zero work. This is a business answer, not an engineering
   one.

3. **Is `request_welcome` worth its own `message_kind`?** It is the
   click-to-WhatsApp first touch, which is the closest thing to an attributable
   paid-marketing lead that WhatsApp produces. Stage 2 adds it. Say if you would
   rather it stayed folded into `system`.

4. **Do you want WhatsApp media retrievable six months later?** If yes, someone
   has to fetch WAHA's bytes and store them (§3.4 option 1) — real work, real
   storage cost. If no, we record the mime type and nothing else, and a document
   a customer sent is gone when the container restarts. Right now the answer is
   "no", by omission rather than decision.

5. **`communication_logs.lead_email` — when does it get retired?** §4 leaves it
   alone deliberately: new rows get a proper key through `channel_event_id`, the
   142 old ones never can. Retiring the column means rewriting 11 views and 21
   dashboard files. My recommendation is to leave it until new rows outnumber
   old ones by enough that the migration is worth the day.

6. **Is a second dealership on WAHA in the plan?** If yes, D6 blocks it — the
   registry's uniqueness is global and the one live WAHA session is called
   `default`. If ALBA CARS is the only WAHA tenant and every future dealership
   goes straight to Cloud, D6 never fires and can be left.
