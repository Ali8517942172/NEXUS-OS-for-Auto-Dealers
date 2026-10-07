# `channel_message_events` as an append-only message-durability log

**9 September 2026.** Design only. Nothing here has run. The migration that would
install it is held at
`ops/message-durability/held/20260909050000_a_send_that_left_no_row_is_a_send_that_never_happened.sql`
and is **not** in `supabase/migrations/`.

Every "is" below about the current schema is measured in `GAP-MEASURED.md`.
Every "would" is a proposal.

---

## 1. What the object has to do that today's cannot

`channel_message_events` already exists (0 rows, 19 columns, `service_role` only,
RLS FORCE). It is a good ledger of messages that **succeeded**. Three properties
stop it being a durability log:

| property | today | why it matters |
|---|---|---|
| `external_message_id NOT NULL` + `cme_extmsg_is_a_provider_id` | a row requires a provider id | a rejected send has no provider id, so the failure cannot be recorded at all |
| no append-only trigger | `service_role` holds `UPDATE, DELETE, TRUNCATE` | `GAP-MEASURED.md §0` shows a scheduled `DELETE` already erasing the evidence of the P0 from `processed_messages` |
| no notion of an attempt | one row per accepted message | there is no row to write **before** the provider call, so a crash mid-send leaves nothing |

The design extends this table rather than adding a fourth ledger. Reasons: the
owner named this object; `channel_send_directive` already owns the routing and
policy decision and should not also own transport truth; and a fourth vocabulary
for the same five outcomes is exactly the `ops/f2-tenant-rule` failure this brief
warns against.

---

## 2. The unit of the log: an event, not a message

**Two rows per outbound message, one row per inbound message. No row is ever
updated.**

| event_type | direction | written when | outcome it carries |
|---|---|---|---|
| `MESSAGE_RECEIVED` | inbound | the receiver has verified the payload and holds the provider's id | `RECEIVED` |
| `SEND_ATTEMPTED` | outbound | **before** the HTTP call to the provider | `PENDING` |
| `SEND_SETTLED` | outbound | after the provider answers, or after the caller gives up | one of the four terminal send outcomes |
| `DELIVERY_STATUS` | outbound | a provider status callback arrives | `DELIVERED` / `READ` / `FAILED_AFTER_ACCEPT` |

Append-only is enforced by a `BEFORE UPDATE OR DELETE` trigger that raises,
copying `whatsapp_delivery_events_append_only` — the sibling that already has one.
An outcome therefore never mutates; it is superseded by a later row. The current
state of a message is a `DISTINCT ON` over its events, not a column somebody
edits.

This is also what makes the log survive a purge job. There is no legal `DELETE`
— and the migration additionally **revokes `UPDATE`, `DELETE` and `TRUNCATE` on
this table from `service_role`**, because a row trigger does not fire on
`TRUNCATE` and `service_role` holds that privilege today. Append-only enforced
by a trigger while the writer can `TRUNCATE` is not append-only. Nothing loses a
capability it uses: both writers are `SECURITY DEFINER` and run as the function
owner.

---

## 3. Write-ahead: decided, and why

**Decision: the `SEND_ATTEMPTED` row is written before the provider call, in its
own committed transaction, and the send does not proceed without it.**

The alternative — write once, after the provider answers — is what the six live
call sites do, and `GAP-MEASURED.md §2.1` shows both of its failure modes in
production code. The argument:

| we crash… | write-after (today) | write-ahead (proposed) |
|---|---|---|
| before the provider call | nothing; correct by luck | `SEND_ATTEMPTED/PENDING` row. A reconciler sees an unsettled attempt and can check the provider. Slightly wrong, and visibly so |
| **after the provider accepted, before we record it** | **nothing. The customer has the message and NEXUS has no trace. This is the P0, on the outbound side** | `SEND_ATTEMPTED/PENDING` survives. The honest sentence — "we attempted this at 14:03, outcome unknown" — is on the record and a human can resolve it |
| the provider rejected it | call site 2 writes nothing; the others write "we said this" | `SEND_SETTLED/REJECTED_BY_PROVIDER` with the provider's error code |

The cost of write-ahead is a false positive: an attempt row for a send that never
left. That is the *right* error. A false "we may have contacted them" is
answerable by looking; a false "we never contacted them" sends a second message
to a customer who already got the first, or tells a manager that a salesperson
did not do their job.

**The dashboard already speaks this sentence and does not store it.**
`screens/conversations.js` renders *"whether the message left cannot be told from
here. Check WhatsApp before sending again."* Write-ahead is that sentence,
persisted, with a timestamp and a recipient.

**What write-ahead does not buy.** It does not make the send exactly-once. Neither
WAHA's `POST /api/sendText` nor Meta's Cloud send accepts a client-supplied
idempotency key, so a retry after a lost response can genuinely deliver the
message twice and no key we hold can prevent it. Write-ahead makes the duplicate
**visible** (two attempts, one settled, one unsettled) instead of invisible. Do
not claim more than that.

---

## 4. The idempotency key, in both cases

Two keys, for two different jobs. Conflating them is how the delivery-status join
breaks.

### 4.1 When the provider returns an id

`(tenant_id, integration_id, direction, external_message_id)` — the constraint
the table already has, `channel_message_events_channel_direction_extmsg_key`.

**It is kept exactly as it is, and not made partial.** Once
`external_message_id` becomes nullable, PostgreSQL's default `NULLS DISTINCT`
means two failed sends — both NULL — do not collide, which is the behaviour
wanted, while two deliveries of the same provider id still do. So the constraint
keeps its name, `nexus_record_channel_event`'s
`ON CONFLICT ON CONSTRAINT channel_message_events_channel_direction_extmsg_key
DO NOTHING` keeps working untouched, and `first_seen` still comes out of that
INSERT. The serialisation point does not move. This is the reason the migration
does not have to rewrite that function, and rewriting a SECURITY DEFINER function
whose source I would be re-deriving is exactly the risk worth avoiding.

This key absorbs **provider redeliveries**. It is the only key that can, because
the provider id is the only thing both deliveries share.

### 4.2 When it does not

`attempt_id uuid`, generated by the caller **before** the provider call, unique on
`(tenant_id, attempt_id, event_type)`.

This key absorbs **our own retries of the same logical send** — an n8n
`retryOnFail` firing twice, a workflow re-run on the same item. It does not and
cannot absorb a provider-side duplicate.

`attempt_id` is `NOT NULL` on every outbound row and `NULL` on inbound. The
`SEND_SETTLED` row carries the same `attempt_id` as its `SEND_ATTEMPTED` row;
that is the join between them, and the `(tenant_id, attempt_id, event_type)`
unique guarantees at most one of each.

**The rule, stated once:** `external_message_id` is always the provider's own id
and never one of ours. `attempt_id` is always ours and never the provider's. A
message with no provider id gets no `external_message_id` — it does not get a
minted one. `cme_extmsg_is_a_provider_id` already refuses
`nokey:` / `outreach:` / `exec-` / `run-` / `job-` prefixes and all-digit values,
and that constraint stays exactly as it is on non-null values.

---

## 5. How a later delivery-status callback joins back

Meta's status callback carries `statuses[].id` — the same `wamid` the send
returned — plus `recipient_id` and pricing. `whatsapp_record_delivery_status`
already looks the outbound event up. Measured, from `pg_get_functiondef`, and
quoted in `ops/channel-events/WIRING-SPEC.md §2.2 D4`:

```
where e.tenant_id = v_tenant and e.direction = 'outbound'
  and e.external_message_id = v_ext
```

Two changes, both small:

1. **The predicate must include `integration_id`.** It does not today. During
   dual-run a Cloud callback can link to a WAHA outbound event of the same tenant,
   and `wde_waha_reports_no_billing` keys on the delivery row's provider, not the
   event's — so Cloud pricing could attach to a WAHA message. The lookup becomes
   `(tenant_id, integration_id, direction='outbound', external_message_id)`.
2. **There is no index for the predicate as written.** The table's indexes are
   `(event_id)`, `(tenant_id, integration_id, direction, external_message_id)`
   (the unique), `(tenant_id, customer_external_id)`, `(integration_id)` and
   `(tenant_id, received_at DESC)`. The three-column predicate the function uses
   today can only be served by a prefix-mismatched scan of the unique index;
   the corrected four-column predicate is served by it exactly. Another reason to
   add `integration_id` rather than add an index.

**The row it joins to is the `SEND_SETTLED` row**, because that is the one
carrying the provider id. If we crashed before settling, there is no such row and
the callback lands `UNLINKED_NO_OUTBOUND_EVENT` — which is already how
`wde_link_state_matches_the_fk` models it, and is the honest state.

**The recovery that is deliberately not implemented.** A callback carrying
recipient + timestamp could be matched to an unsettled `SEND_ATTEMPTED` row by
proximity. That is a heuristic that invents a fact, and this repository refuses
those. Instead the unsettled attempt and the unlinked delivery both stay visible,
and a human can join them by looking at WhatsApp. Stated as an accepted gap, not
solved.

---

## 6. What is stored when a send fails

The row most systems drop is the one where **we never called the provider at
all**, and the one where **we called and do not know what happened**. Both are in
the vocabulary:

| outcome | means | provider id | who writes it |
|---|---|---|---|
| `ACCEPTED_BY_PROVIDER` | provider took it and gave an id | **required** | settle |
| `REJECTED_BY_PROVIDER` | provider answered, and said no | forbidden | settle |
| `TRANSPORT_ERROR` | we could not reach the provider, or it did not answer in time | forbidden | settle |
| `NOT_ATTEMPTED` | policy, window, opt-out or capability said do not send. Not a failure — a decision | forbidden | settle |
| `UNKNOWN_PROVIDER_OUTCOME` | we called, and cannot tell. The write-ahead row was never settled and a reconciler gave up | forbidden | reconciler |
| `PENDING` | in flight, this instant | forbidden | attempt |

A failure row carries: `attempt_id`, `tenant_id`, `integration_id`, `direction`,
`customer_external_id` / `customer_phone`, `message_kind`, `attempt_no`,
`requested_at`, `settled_at`, `provider_error_code`, `provider_error_detail`,
`provider_http_status`, and `directive_id` when a `channel_send_directive` row
exists. It carries **no body** — the body lives in `communication_logs` and in
`channel_send_directive.message_body`, and this table's `media_ref !~ '^data:'`
constraint says content is not its job.

`provider_error_detail` is length-capped and refused if it looks like a
credential, mirroring `csd_credential_ref_is_not_a_secret` — provider error bodies
echo request headers more often than anyone expects.

**`NOT_ATTEMPTED` is the row this system most needs and least has.** Tenant A's
salespeople currently cannot distinguish "the AI decided not to message this
customer" from "nobody got round to it". `channel_send_directive` was built for
that decision and holds 0 rows; this event references it rather than restating it.

---

## 7. The vocabulary lives in exactly one place

This is the constraint from `ops/f2-tenant-rule/RECONCILIATION.md`: a producer
emitting `exact_year|model_only|weak` against a consumer filtering
`{exact,strong}` produced a structurally empty result that was read for a week as
"no good data". Two providers and four event types is the same trap, doubled.

**Three catalogue tables, and no CHECK constraint anywhere holding a copy:**

- `channel_message_outcome(outcome PK, provider_id_expected, provider_accepted,
  is_terminal, counts_as_customer_contact, meaning, what_would_change_it, sort)`
- `channel_message_event_type(event_type PK, direction, is_provider_reported,
  meaning, sort)`
- `channel_message_event_outcome(event_type, outcome, PK(event_type,outcome))` —
  the legal pairs, FK'd to both

`channel_message_events` then carries **three foreign keys, no CHECKs**:

```
(event_type, direction)  -> channel_message_event_type(event_type, direction)
(event_type, outcome)    -> channel_message_event_outcome(event_type, outcome)
(outcome, provider_id_present) -> channel_message_outcome(outcome, provider_id_expected)
```

where `provider_id_present` is `GENERATED ALWAYS AS (external_message_id IS NOT
NULL) STORED` — the writer cannot lie about it.

### How a writer emitting an unknown value fails loudly

- unknown `outcome` → `23503` foreign key violation on INSERT. The row is not
  written and the caller gets an error naming the constraint. It does not become a
  row nobody's filter matches.
- known `outcome`, wrong direction or wrong event type → `23503` on the pairing
  FK. `SEND_ATTEMPTED` with `direction='inbound'` cannot exist.
- `ACCEPTED_BY_PROVIDER` with no provider id, or `TRANSPORT_ERROR` **with** one →
  `23503` on the composite FK against the generated column. The two halves of the
  claim have to agree.

Compare with today: `csd_send_result_check` is a CHECK on one table. A second
writer spelling it `accepted` instead of `ACCEPTED_BY_PROVIDER` gets `23514` —
also loud, but only *that table* knows the list, so nothing else can be built
against it without copying the array. The catalogue is readable, joinable, and
documents itself.

### How a consumer is stopped from hardcoding

The catalogues are granted `SELECT` to `authenticated` with a permissive RLS read
policy — they are vocabulary, not tenant data. **A consumer filters by joining a
property, never by an inline array:**

```sql
-- right
select e.* from channel_message_events e
  join channel_message_outcome o on o.outcome = e.outcome
 where o.counts_as_customer_contact;

-- wrong, and it is what f2 did
where e.outcome in ('ACCEPTED_BY_PROVIDER','DELIVERED')
```

`QUALITY_GATE.mjs` already pins column lists and fails on drift; the same gate
should grow a rule that no dashboard file contains a literal from
`channel_message_outcome`. That is a follow-up, named here so it is not forgotten.

### Seeding, and the one existing vocabulary this must not fork

`channel_message_outcome` is seeded with the **exact spellings** already in
`csd_send_result_check`: `PENDING`, `ACCEPTED_BY_PROVIDER`,
`REJECTED_BY_PROVIDER`, `NOT_ATTEMPTED`, `TRANSPORT_ERROR`. The migration then
**drops that CHECK and replaces it with a foreign key** from
`channel_send_directive.send_result` to the catalogue. After it, the five strings
exist in one place in the database. That is the whole point, and it is the reason
the migration touches a table it does not own.

---

## 8. Relationship to `communication_logs`: coexist, joined

Measured first (`GAP-MEASURED.md §3.4`), then decided.

**Not replaced.** It holds the body; it holds `channel='system'` and
`direction='internal'` rows the event vocabulary refuses; it has a designed email
path; 0 of 142 rows can be backfilled with a provider id; and it carries
`trg_comm_logs_first_response AFTER INSERT FOR EACH ROW`, which a view cannot.

**Not fed one-way either.** The join is one nullable column,
`communication_logs.channel_event_id uuid → channel_message_events(event_id)`,
nullable forever because email rows, system rows and all 142 historical rows have
no channel event.

Adding that column is an `ALTER TABLE` on a table with a live
`authenticated: SELECT` grant, so the ACL guard fires and the grant must be
re-asserted in the same migration. **It is therefore deliberately not in this
migration.** It belongs with the writer change that populates it, and shipping a
column with no writer is what produced `external_message_id`: applied in the
database, armed in zero writers, 0 of 142 for a month. Named as the next step,
held back on purpose.

The writer contract, when it lands: begin the attempt → call the provider →
settle → write `communication_logs` with **both** `channel_event_id` and
`external_message_id`. That last field is what finally arms
`communication_logs_external_identity_key` and kills the ~12% duplicate-inbound
defect at the same time.

---

## 9. Ordering, and the claim

`P0-CLAIMED-NEVER-LOGGED.md §3` settles the inbound ordering: the claim must not
precede the durable write, and the strongest form is that they are the same
write. This design is compatible and does not re-decide it: the inbound
`MESSAGE_RECEIVED` insert is already the serialisation point (`first_seen` out of
`ON CONFLICT DO NOTHING RETURNING`), and §4.1 keeps that property through the
change to a partial index.

What this design adds to that decision: **`processed_messages` should stop being
the claim.** It has a 7-day TTL applied by `Prune Dedupe Guard`, so it cannot be
the record of anything. `channel_message_events` is append-only and never purged.
Retiring `Claim Message Id` in favour of the event insert is one n8n change and
is not mine to make — recorded here so the durability argument and the retention
finding are joined in one place.

---

## 10. Open questions

1. **`channel_message_events_cloud_requires_signature` refuses an honest Cloud
   outbound row.** `origin_verified='unverified'` — the truth about a call we
   made — is rejected; `'hmac_sha256_x_hub'` — a signature we never received — is
   accepted. The held migration relaxes it to inbound only, per
   `ops/channel-events/WIRING-SPEC.md §3.5 Option A`. **That constraint is not
   mine.** Needs the sign-off of whoever owns the Cloud signature invariant before
   the migration moves.
2. **Whether `attempt_id` should be echoed to the provider.** Neither WAHA nor
   Cloud accepts one today. If Meta adds one, the two keys in §4 collapse into
   one and this design gets simpler. NOT AVAILABLE, not "no".
3. **Reconciliation cadence.** Who marks an unsettled attempt
   `UNKNOWN_PROVIDER_OUTCOME`, and after how long? A 15-minute threshold matches
   the P0's own alarm invariant, but nothing has been measured about how long a
   WAHA send actually takes — the one measured real send took 17.8 s
   (`channel_provider_capability`, `MEASURED_HERE`, 2 Sep). One sample.
4. **The six live call sites all use `onError: continueRegularOutput`.** Under
   write-ahead the log node must hang off the *settle* call, not off the send's
   main output, or the "logged-and-not-sent" mode survives the change. That is an
   n8n edit, and I have not made it.
5. **`channel_send_directive.requested_send_form` / `resolved_send_form` have no
   FK to `channel_send_form`** while `channel_provider_capability.send_form` does.
   Same class of defect, not fixed here to keep the migration reviewable.
