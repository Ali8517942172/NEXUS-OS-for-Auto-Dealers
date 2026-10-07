# Customer, Conversation, Opportunity, Deal — an identity model for NEXUS

Design, 8 September 2026. **This is a proposal. Nothing here has been applied.**
No migration file is written by this document and none should be written from it
until the open questions at the end are answered.

Every figure below was measured on the day of writing through the read-only SQL
channel against production `dsvuoovivysszdoiorch` and, where stated, staging
`wwspuxrbiyagnrnzgate`. Where a claim is *predicted* from PostgreSQL semantics
rather than measured, it says so and it is listed again in §7 as a measurement
that must be taken before anything ships.

The decision this document serves is Ali's, framed by him:

```
Customer            = permanent identity
Conversation        = thread
Lead / Opportunity  = time-bounded buying opportunity
Deal                = outcome
```

and his caution, which is the constraint on the answer rather than a preference
about it: *"abhi 'one permanent lead per person' mat lock karo without real
dealership testing"*. A repeat buyer returning after eight months for a Patrol
must keep their history **and** get a new opportunity.

---

## 1. What exists today, measured before anything is designed

### 1.1 Row counts

Production `dsvuoovivysszdoiorch`, exact counts (`count(*)`, not `n_live_tup`):

| table | rows | rows on staging |
|---|---|---|
| `leads` | **5** | 31 |
| `lead_event` | **1** | 3 |
| `communication_logs` | **142** | 37 |
| `channel_message_events` | **0** | 0 |
| `whatsapp_contacts` | **14** | — |
| `customer_360_profiles` | **4** | — |
| `purchase_history` | **1** | — |
| `deals_embeddings` | **1** | — |
| `processed_messages` | **41** | — |
| `audit_log` | **881** | — |
| `tenants` | **2** | 4 |
| `inventory` | **12** | — |

`leads` holds five rows across **one** tenant. The whole of the pilot's customer
book is five people. That is the single most important number in this document:
**a migration that has to move data is a migration that has to move five rows.**
The cost of this change is not the data. It is the consumers.

### 1.2 What each key actually is

`leads` — surrogate integer `id` (`leads_pkey`, `nextval('leads_id_seq')`),
`tenant_id uuid NOT NULL DEFAULT nexus_default_tenant_id()`. The *natural* key
is `leads_tenant_email_key UNIQUE (tenant_id, email)` — a bare unique index, not
a constraint. There is no unique index on phone. `leads_email_key`, the former
global `UNIQUE(email)`, was dropped by `20260902112540`.

**`leads.email` is not an email address. It is the customer identity key, and
where there is no email the workflows mint one out of the phone number.** All
five production rows:

| id | name | email | phone | source | status |
|---|---|---|---|---|---|
| 34 | Siva Thangavelu | `+971547484167@whatsapp.lead` | +971547484167 | nexus-master-router | DISQUALIFIED |
| 35 | Effco Contracting llc | `''` (empty string, length 0) | +971505433953 | nexus-master-router | DISQUALIFIED |
| 38 | Ali | `shabbir53ujjainwala@gmail.com` | +918517942172 | nexus-master-router | WARM |
| 121 | Preflight Walk-In | `walkin-preflight-01@nexus-preflight.invalid` | +971500000001 | walk_in | new |
| 122 | Hussain | `+971556382721@whatsapp.lead` | +971556382721 | nexus-master-router | COLD |

Two of five carry a synthetic address, one carries a `.invalid` preflight
address, one carries the empty string, and **one** carries a real email. Any
design that treats `leads.email` as an email is designing against 20% of the
data.

The empty string is worth pausing on. `leads_tenant_email_key` is a unique
index, and a unique index does not constrain NULL — but `''` is not NULL. Lead
35 holds `''`. **A second no-email lead written as `''` for this tenant is
refused `23505`, and a second one written as NULL is not.** Two spellings of
"no email", one of which is a uniqueness constraint and one of which is not.

`communication_logs.lead_email` is a fourth thing again. It is not an email
either; `lib/identity.js:1-30` documents four incompatible key shapes in that one
text column, and the production distribution is:

| key shape | rows | distinct keys |
|---|---|---|
| `<digits>@lid` | **95** | 14 |
| `+<digits>@whatsapp.lead` | 25 | 3 |
| a real email address | 22 | 1 |

**Two thirds of the message history is keyed by a WhatsApp LID, which carries no
phone digits at all.** A LID can only be turned into a person through
`whatsapp_contacts`, and of the 14 `whatsapp_contacts` rows, **11 have
`lead_email` NULL** — they are attached to nobody. One of them holds the phone
`971556456535:77`: a real number with a WAHA device suffix on it.

`whatsapp_contacts` — PK `(tenant_id, chat_id)`. `chat_id` is the LID or `@c.us`
address; `lead_email` is a nullable back-pointer to `leads.email` **as text, with
no foreign key**.

`customer_360_profiles` — `id uuid` PK, `UNIQUE (tenant_id, customer_id)` where
`customer_id` is *text*, and `email text` with a plain index. It is an
aggregation output written nightly by the Customer 360 n8n job, not an identity
table. 4 rows.

`purchase_history` — `id uuid` PK, `UNIQUE (tenant_id, deal_id) WHERE deal_id IS
NOT NULL`, and — importantly — **`lead_id integer REFERENCES leads(id) ON DELETE
SET NULL`**. This is already the deal table. It already links opportunity to
outcome. 1 row.

`lead_event` — `event_id uuid` PK, identity `UNIQUE (tenant_id, source_key,
external_event_id)`, `lead_id integer REFERENCES leads(id) ON DELETE SET NULL`,
and three composite foreign keys pinning it to its endpoint's tenant, source and
environment. This is the newest and by far the most carefully built table in the
set. 15 columns are granted SELECT to `authenticated` individually; the table
itself grants `authenticated` nothing.

`channel_message_events` — `event_id uuid` PK, `UNIQUE (tenant_id,
integration_id, direction, external_message_id)`, composite FK to
`channel_registry(integration_id, tenant_id)`. **0 rows.** It is the intended
home of every inbound/outbound message and nothing has ever been written to it.

`deals_embeddings` — `deal_id text`, a 1536-dimension vector, 1 row. Not part of
the identity model and not touched by this design.

### 1.3 The rule that decides "same customer" today — and there are two of them, and they disagree

**Writer A, the live n8n Master Router** (`JnlZFAVmFAuNXVya`). Node `Persist Lead
(deterministic)` POSTs to `/rest/v1/leads?on_conflict=tenant_id,email` with
`Prefer: resolution=merge-duplicates`, and where the lead has no email it
synthesises `'+' + phone.replace(/[^0-9]/g,'') + '@whatsapp.lead'`.

> Repo↔box drift, noted in passing: the repo copy
> `n8n-workflows/nexus_master_lead_router_ai_agent.json` still says
> `on_conflict=email`. The migration header of `20260902112540` records the
> published version as `on_conflict=tenant_id,email`. The repo file is stale.

That upsert **is** "one permanent lead per person", already, in production,
today. It is not a future risk to avoid — it is the current behaviour. And it is
worse than a lock-in: `merge-duplicates` **overwrites** `name`, `status`,
`ai_score`, `vehicle_interest` and `budget_aed` on every repeat contact. The
customer who bought a Corolla in January and asks about a Patrol in September
does not get a new opportunity; their January row is **overwritten** with
September's vehicle and score, and January's is gone.

**Writer B, door three** — `nexus_promote_lead_event(uuid)`. Its body does a
plain `INSERT INTO public.leads (...) RETURNING id`. No `ON CONFLICT`. Every
promotion is a new lead. And since `nexus_lead_record_manual()` ends with
`select * into v_prom from public.nexus_promote_lead_event(v_rec.event_id)`, the
dashboard's own walk-in form goes through the same insert.

So the two live writers hold opposite rules:

| | same email arrives twice |
|---|---|
| Master Router (A) | one row, overwritten, history destroyed |
| door three (B) | `INSERT` → `23505 leads_tenant_email_key` |

**A repeat walk-in with the same email address raises a unique-violation at the
operator's screen today.** That is a checkable prediction, and §7 puts it in the
test plan rather than asserting it from reading alone.

The nine-digit rule is the third statement of the same question.
`nexus_lead_for_comm_key(text, uuid)` resolves a message key to a lead by, in
order: exact `leads.email`; then the **last nine digits** of any numeric prefix,
but only if exactly one person matches (`if v_people > 1 then return null` —
ambiguity is refused, not guessed); then `whatsapp_contacts.chat_id →
lead_email`; then the contact's phone tail. `lib/identity.js` mirrors it on the
client and says why: *"THE MATCHING RULE IS NOT OURS TO CHOOSE"* — the keys in
`communication_logs` were written by a workflow that used nine digits, so any
reader must use nine digits.

`nexus_trace_linkability_report()` says how well all this works, in production,
today:

```
leads with no email                              1 of 5
communication_logs not attributable to a lead  107 of 142
audit_log rows carrying no customer at all     807 of 881
a real correlation id exists                   no
```

**75% of the message history cannot be attached to any customer.** That is the
problem this design exists to fix, and it is a bigger number than the lead count.

### 1.4 Every consumer of `leads` — the cost of the change

This list must be complete, because a rename is only as safe as this list is.

**Views. 16 depend on `leads` directly; the transitive closure is 21.** All 21
hold `authenticated=r`.

Direct (16): `v_attribution_edges`, `v_attribution_events`,
`v_attribution_lead_chain`, `v_attribution_sale_chain`, `v_conversations`,
`v_customer_360`, `v_customer_directory`, `v_deal_rescue_candidates`,
`v_deal_rescue_readiness`, `v_inventory_profit_sentinel`, `v_lead_messages`,
`v_lead_recovery`, `v_lead_recovery_coverage`, `v_lead_recovery_queue`,
`v_needs_attention`, `v_team_performance`.

Transitively (5 more): `v_attribution_link_map`, `v_deal_rescue`,
`v_deal_rescue_state_model`, `v_inventory_action_queue`,
`v_lead_recovery_state_model`.

**Functions whose body names `leads` — 18.** Twelve are `SECURITY DEFINER`:

| function | definer | executable by |
|---|---|---|
| `assign_hot_lead()` | yes | postgres, service_role — trigger `trg_assign_hot_lead` on `leads` |
| `capture_daily_metrics()` | yes | postgres, service_role |
| `nexus_lead_for_comm_key(text, uuid)` | yes | postgres, service_role |
| `nexus_lead_record_manual(9 args)` | yes | **authenticated**, postgres, service_role |
| `nexus_lead_trace(integer)` | yes | **authenticated**, postgres, service_role |
| `nexus_mark_first_response()` | yes | postgres, service_role — trigger on `communication_logs` |
| `nexus_onboard_dealership(4 args)` | yes | postgres, service_role |
| `nexus_team_link_staff(uuid, uuid)` | yes | **authenticated**, postgres, service_role |
| `nexus_team_revoke_access(uuid)` | yes | **authenticated**, postgres, service_role |
| `nexus_team_roster()` | yes | **authenticated**, postgres, service_role |
| `nexus_tenancy_readiness()` | yes | postgres, service_role |
| `nexus_trace_linkability_report()` | yes | postgres, service_role |
| `lead_recovery_record_outcome(...)` | yes | (names `leads` only inside a longer identifier) |

Six are invoker: `lead_event_guard_lead_tenant()`, `nexus_lead_assign_owner`,
`nexus_lead_attribution_summary`, `nexus_lead_ingest_invariants`,
`nexus_promote_lead_event`, `nexus_quarantine_census`.

**Triggers on `leads` — 2.** `trg_assign_hot_lead` (BEFORE INSERT OR UPDATE OF
status, assigned_to_id) and `nexus_leads_owner_change_audit_trg` (AFTER UPDATE OF
assigned_to_id).

**RLS on `leads` — 3 policies.** `leads_deny_anon` (ALL, false),
`leads_authenticated_all` (ALL, `tenant_id IN nexus_current_tenant_ids()`),
`leads_role_update` (UPDATE, owner/admin/manager on any row of their tenant, or
sales/member on rows assigned to them).

**Grants on `leads`.** `authenticated=r` at table level, plus **eight
column-level UPDATE grants**: `assigned_to`, `assigned_to_id`, `budget_aed`,
`email`, `name`, `phone`, `status`, `vehicle_interest`. These eight are the
`lib/lead-drawer.js` write path and they are what the guard eats (§2).

**n8n workflows reading or writing `/rest/v1/leads` — 8 of the 18 registered as
active in `workflow_registry`:**

| workflow | node | method |
|---|---|---|
| NEXUS Master Lead Router (`JnlZFAVmFAuNXVya`) | Supabase Lead Lookup | GET `leads` |
| " | Persist Lead (deterministic) | **POST `leads?on_conflict=tenant_id,email`** |
| Lead Escalation - AI Agent (`KI6P1Qcf3MIZakNa`) | Fetch Escalated Lead | GET |
| " | Mark Lead Escalated | **PATCH `leads?email=eq.…`** |
| wf_108 ERP Sync - Bitrix24 (`bxNBzBrcOtcFpMPn`) | Fetch HOT Leads | GET |
| " | Link Back to Supabase | **PATCH `leads?email=eq.…`** |
| 7-Day Warm Lead Drip (`G7FhvMY2ucW5Fg7X`) | Lead State (Day 1/3/5/7) | GET × 4 |
| Slack Command Center (`VmnIXo7tM30zqawp`) | Update Lead Status, Search Leads | GET |
| WhatsApp BDC AI Agent (`BiyHk9ZXxJUVGbf6`) | Fetch All Leads | GET |
| Phase 6 - 12-Hour Silence Detector (`B3TcpfzOMWj8oWgF`) | Fetch Open Leads | GET |
| Customer 360 Aggregation (`AZkGM5M4c1uzSH7S`) | — reads `v_customer_directory` | GET (view) |

**Three of those are writers, and two of the three address rows by
`email=eq.…`.** Any change to what `leads.email` means is a change to those two
workflows, and they live on a GCP VM, not in this repo.

**Dashboard screens — 20 of 22 read `leads` or a view built on it.** Only
`screens/lead-sources.js` and `screens/policy.js` are clean.

Direct `leads?…` REST reads: `app.js:245`, `lib/integrations.js:53`,
`lib/lead-drawer.js:256`, `lib/identity.js:952,956`, `screens/deals.js:289`,
`screens/finance.js:2095`, `screens/overview.js:920,1719,3065`,
`screens/automation.js:885`, `screens/conversations.js:1105,2528`,
`screens/campaigns.js:598`, `screens/leads.js:397`, `screens/team.js:402`,
`screens/customers.js:553,1273`, `screens/ask.js:1666`,
`screens/compliance.js:845`.

Through views: `screens/attribution.js`, `screens/actions.js`,
`screens/inventory.js`, `screens/money-leaks.js`, `screens/revenue.js`,
`screens/lead-recovery.js`, `screens/deal-rescue.js`, `screens/settings.js`,
`screens/competitors.js`.

The one write path from the browser is `lib/lead-drawer.js`, and owner
assignment already routes through `rpc/nexus_lead_assign_owner` rather than a
PATCH (`lib/lead-drawer.js:485-511`).

**Total: 21 views, 18 functions, 2 triggers, 3 policies, 8 column grants, 8 n8n
workflows on a VM, 20 of 22 dashboard screens.** That is the bill for renaming
`leads`.

---

## 2. The constraint that decides the shape of the answer

### 2.1 The guard, read from the live catalogue

`nexus_guard_born_open_grants` is present on both projects. Measured today:

```
evtevent  = ddl_command_end
evttags   = NULL            -- fires on EVERY ddl_command_end
evtenabled= O
owner     = postgres
prosecdef = false           -- SECURITY INVOKER, deliberately
proconfig = search_path=pg_catalog
```

Its body, read verbatim from `pg_proc.prosrc`, loops over
`pg_event_trigger_ddl_commands()` and acts only on rows where
**`schema_name = 'public'`**, dispatching on `object_type`:

```
table / view / materialized view / foreign table
      revoke all on <obj> from anon
      revoke insert, update, delete, truncate on <obj> from authenticated
sequence
      revoke all on sequence <obj> from anon
      revoke update on sequence <obj> from authenticated
function / procedure / aggregate
      revoke all on function <obj> from anon
```

then re-asserts the schema door if `anon` has regained `USAGE`. It swallows
every exception so it never aborts someone else's DDL, and it guards re-entry
with a transaction-local `nexus.acl_guard` setting.

### 2.2 What fires it and what does not

| operation | `object_type` reported | destructive branch runs? | evidence |
|---|---|---|---|
| `ALTER TABLE public.leads …` | `table` | **YES** | measured: `20260906071310` header records `inventory` going from `authenticated=rd` + 9 column ACLs to `authenticated=r` + none on **both** projects after `20260906065739` ran two ALTERs |
| `CREATE TABLE public.x` | `table` | YES, on the new table | same branch; harmless because nothing has been granted yet |
| `ALTER TABLE … ENABLE ROW LEVEL SECURITY` | `table` | YES | it is an `ALTER TABLE` |
| `CREATE VIEW` / `ALTER VIEW` | `view` | YES | same branch |
| `CREATE FUNCTION` / `CREATE OR REPLACE FUNCTION` | `function` | revokes `anon` EXECUTE only | which is what we want anyway |
| `CREATE TRIGGER` | `trigger` | **NO** | measured on staging in a rolled-back transaction, recorded in `CLAUDE.md`: 8 column grants before and after, `relacl` byte-identical, `authenticated` still holds UPDATE |
| `GRANT` / `REVOKE` | — | **NO** | `pg_event_trigger_ddl_commands()` returns `schema_name = NULL` for grants, so `if r.schema_name = 'public'` is NULL and the branch is skipped. Corroborated live: `inventory` today holds `authenticated=rd` plus 17 column grants applied by `20260906071310`, and `lead_event` holds 15 column SELECT grants — all applied by `GRANT` statements and all still standing |
| `CREATE INDEX` / `DROP INDEX` | `index` | **predicted NO — unmeasured** | see below |
| `COMMENT ON TABLE` | `table` | **predicted YES — unmeasured** | see below |
| `CREATE POLICY` | `policy` | predicted NO — unmeasured | |
| `CREATE EXTENSION` | — | NO, and cannot be made to | `supautils` re-runs it as `supabase_admin` and skips non-superuser event triggers; measured with three simultaneous instrumented triggers |

**Two entries in that table are predictions, not measurements, and the design
below depends on the first of them.** `CLAUDE.md` says of the concurrency fix
that the answer was *"**not** a unique index on `leads` and **not** a marker
column: both are `ALTER TABLE` on `public.leads`"*. A unique **constraint** is an
`ALTER TABLE`; a bare `CREATE UNIQUE INDEX` is not, and `leads_tenant_email_key`
is a bare index. But it was created by `20260902102629` on **2 September**, and
the guard was installed by `20260904112959` on **4 September** — so it is not
evidence about the guard. **There is no post-guard measurement of `CREATE INDEX`
on `leads` anywhere in this repo.** §7.1 makes taking it the first task.

`COMMENT ON TABLE` is the more dangerous prediction, because it is the one that
would bite silently. PostgreSQL collects `COMMENT` into
`pg_event_trigger_ddl_commands()` with the commented object's own type, so
`COMMENT ON TABLE public.customer` should report `table` and should run the
revoke. If that is right, **a comment written after a grant deletes the grant**,
with no grant-shaped diff to review.

### 2.3 What this repo's own migrations already do about it

`20260907023308_leadingest_03` builds `lead_event` in this order:

```
line  18  create table public.lead_event (…)
line 103  comment on table / on column …
line 123  create index × 5
line 165  create trigger …
line 169  alter table public.lead_event enable row level security
line 171  create policy × 2
line 177  revoke all on public.lead_event from anon, authenticated, public
line 178  grant all on public.lead_event to service_role
```

**Grants last.** Every operation that might fire the destructive branch happens
while the table holds nothing worth losing, and the grants land after the last of
them. Those grants are live today. This is the house pattern and this design
adopts it without variation.

### 2.4 The blast radius is narrower than "tables the dashboard uses"

The guard revokes `INSERT, UPDATE, DELETE, TRUNCATE` from `authenticated`. It
does **not** revoke `SELECT`. Measured today, that means only two tables in
`public` are actually endangered by an `ALTER TABLE`:

| table | `authenticated` holds | at risk |
|---|---|---|
| `leads` | `r` + 8 column UPDATE grants | **the 8 column grants** |
| `inventory` | `rd` + 17 column INSERT/UPDATE grants | **the DELETE and all 17** |
| `communication_logs` | `r` | nothing |
| `customer_360_profiles` | `r` | nothing |
| `whatsapp_contacts` | `r` | nothing |
| `purchase_history` | `r` | nothing |
| `lead_event` | 15 column SELECT grants, no table grant | predicted nothing — a table-level `REVOKE INSERT,UPDATE,DELETE,TRUNCATE` cascades to column privileges *of those types*, not to column SELECT. **Unmeasured; §7.1** |
| `channel_message_events` | nothing | nothing |

This is the same reasoning `20260907200000` used to justify an `ALTER TABLE` on
`lead_source_catalogue`, and it asserted the outcome rather than trusting it.
Every migration this design proposes must do the same.

### 2.5 The rule this design obeys

> **No `ALTER TABLE` on `public.leads` and none on `public.inventory`.** New
> facts about a lead go in a new table keyed by `lead_id`, or in a function.
> Grants are the last statement in every migration. Every migration asserts its
> own grants survived rather than trusting the reasoning.

Every object proposed in §3 is annotated with whether it fires the guard.

---

## 3. The model (proposal)

### 3.0 Is `leads` renamed, kept, or demoted?

**Proposal: kept, byte for byte, and demoted in meaning only. `public.leads`
becomes the opportunity table without being told so.**

The argument for renaming is real: `leads` is now the wrong word for the thing,
and a schema that lies about what it holds costs a reader something every time
they read it. The argument against is §1.4 — 21 views, 18 functions, 8 n8n
workflows on a box outside this repo, and 20 of 22 screens. A rename is not one
change; it is 60-odd changes that must all land in the same instant, several of
them by hand in an n8n UI, against a system nobody can take down.

The tempting middle — `CREATE VIEW opportunity AS SELECT * FROM leads` — is
worse than either. It is two names for one fact, and this repo has already
recorded what that costs: *"Two writers for one fact is how a count ends up
double"* (`CLAUDE.md`, on the duplicated audit row). A second name invites a
second read path, then a second write path, then a divergence nobody sees.

So the rename happens in exactly one place, and it is a place that already
exists for this purpose: **`apps/executive-dashboard/lib/vocabulary.js`**, which
today maps `leads: 'leads'`. The schema keeps the word `leads`; the product
learns to say "opportunity". A comment on `public.leads` would say so in the
database too — but `COMMENT ON TABLE public.leads` is `object_type = 'table'` and
is exactly the prediction in §2.2 that would eat the eight column grants. **Do
not comment `leads` until §7.1 has been measured.**

### 3.1 New objects

Five tables and three functions. None of them touches `leads`, `inventory`,
`communication_logs`, `lead_event` or `channel_message_events`.

#### `public.customer` — the permanent identity

```
customer_id     uuid    PK   default gen_random_uuid()
tenant_id       uuid    NOT NULL  REFERENCES tenants(id) ON DELETE RESTRICT
display_name    text                    -- best known name, not authoritative
first_seen_at   timestamptz NOT NULL default now()
last_seen_at    timestamptz NOT NULL default now()
merged_into     uuid    NULL REFERENCES customer(customer_id)  -- tombstone, never delete
created_by      text    NOT NULL CHECK (created_by IN
                        ('promoter','backfill','operator','merge'))
```

Guard: `CREATE TABLE` → `table` → fires, on an empty table. Grants last.
RLS: `customer_deny_anon` (ALL, false); `customer_read_own_tenant` (SELECT,
`tenant_id IN nexus_current_tenant_ids()`); `customer_service_all` (ALL,
service_role). Grants: `SELECT` to `authenticated`, `ALL` to `service_role`.
**No write grant to `authenticated`** — customers are created by door three and
by the merge RPC, never by a PATCH.

`merged_into` is why merges are reversible. A merged customer is never deleted;
its row survives pointing at its survivor, and `nexus_customer_split` clears the
pointer. Deleting would make a merge a one-way door, and merges are the operation
most likely to be wrong (§5.1).

#### `public.customer_identifier` — the identity rule, as data

```
tenant_id        uuid NOT NULL REFERENCES tenants(id)
identifier_kind  text NOT NULL CHECK (identifier_kind IN
                   ('email','phone_tail9','phone_e164','wa_chat_id','wa_lid'))
identifier_value text NOT NULL
customer_id      uuid NOT NULL REFERENCES customer(customer_id)
first_seen_at    timestamptz NOT NULL default now()
valid_until      timestamptz NULL       -- a number the customer gave up
evidence         text NOT NULL          -- which arrival asserted this
PRIMARY KEY (tenant_id, identifier_kind, identifier_value)
```

The primary key **is** the identity rule: within one dealership, one identifier
value of one kind belongs to at most one customer. It is enforceable, it is
visible, and it is the single place a human can look to ask "why did NEXUS think
these two people were the same".

Guard: `CREATE TABLE` → fires, on an empty table. Same RLS shape, same grants.

`valid_until` is how a changed number works: the old `phone_tail9` row stays,
stamped with the date it stopped being reachable, still pointing at the same
customer. Nothing is deleted, so nothing is forgotten.

#### `public.lead_customer` — the demotion of `leads`, without touching `leads`

```
lead_id      integer PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE
tenant_id    uuid NOT NULL REFERENCES tenants(id)
customer_id  uuid NOT NULL REFERENCES customer(customer_id)
link_basis   text NOT NULL CHECK (link_basis IN
               ('exact_email','phone_tail9','wa_chat_id','wa_lid',
                'operator','new_customer','backfill'))
linked_at    timestamptz NOT NULL default now()
linked_by    text NOT NULL
```

**This table is the whole point of the design.** The obvious change — `ALTER
TABLE leads ADD COLUMN customer_id` — fires the guard and deletes the eight
column grants `lib/lead-drawer.js` writes through. A separate table keyed on
`lead_id` carries the identical fact and fires nothing on `leads`. It is the same
move `CLAUDE.md` records as the worked example: *"a trigger buys the same
guarantee without touching the table"*.

`lead_id` as the primary key enforces at most one customer per opportunity.
A cross-tenant link is refused by a **trigger**, not by a composite foreign key
to `leads(id, tenant_id)` — because that composite key would require a unique
index on `leads(id, tenant_id)`, and `CREATE UNIQUE INDEX` on `leads` is the
unmeasured prediction of §2.2. `lead_event_guard_lead_tenant()` already does
exactly this job for `lead_event` and is the pattern to copy. `CREATE TRIGGER` is
measured not to fire the guard.

#### `public.conversation` — the thread

```
conversation_id  uuid PK default gen_random_uuid()
tenant_id        uuid NOT NULL REFERENCES tenants(id)
customer_id      uuid NOT NULL REFERENCES customer(customer_id)
opened_at        timestamptz NOT NULL default now()
last_activity_at timestamptz NOT NULL default now()
closed_at        timestamptz NULL
close_reason     text NULL CHECK (close_reason IN ('dormant','merged','operator'))
CHECK ((closed_at IS NULL) = (close_reason IS NULL))
```

Partial unique index enforcing one open thread per customer:
`CREATE UNIQUE INDEX conversation_one_open_per_customer ON conversation
(tenant_id, customer_id) WHERE closed_at IS NULL`. Guard: `CREATE INDEX` on a
**new** table — even if the prediction in §2.2 is wrong and it does fire, the
table holds no grants yet at that point, so it costs nothing. The ordering makes
the prediction irrelevant here.

#### `public.conversation_key` — attaching the four key shapes without altering `communication_logs`

```
tenant_id       uuid NOT NULL REFERENCES tenants(id)
key_value       text NOT NULL          -- exactly as it appears in lead_email
conversation_id uuid NOT NULL REFERENCES conversation(conversation_id)
key_shape       text NOT NULL CHECK (key_shape IN
                  ('email','c.us','lid','whatsapp.lead','s.whatsapp.net'))
PRIMARY KEY (tenant_id, key_value)
```

`communication_logs.lead_email` holds four incompatible shapes and cannot get a
foreign key without an `ALTER TABLE` — which, per §2.4, would actually be *safe*
on that table (it holds only `authenticated=r`). It is still not done here, for a
different reason: a foreign key would refuse the 107 message rows that resolve to
nobody, and refusing them would mean deleting a dealership's message history to
satisfy a constraint. `conversation_key` is a side table that says what it knows
and stays silent about the rest. **107 of 142 rows will have no entry on day
one, and that is the correct state, not a bug.**

#### Functions

`nexus_customer_resolve(p_tenant uuid, p_email text, p_phone text, p_chat_id
text) RETURNS uuid` — `SECURITY INVOKER`, `search_path=public`. The single
identity rule. Executable by `service_role` only. Guard: `CREATE FUNCTION` →
revokes `anon` EXECUTE, which is desired.

`nexus_customer_merge(a uuid, b uuid, p_reason text)` and
`nexus_customer_split(p_customer uuid, p_identifier_kind text,
p_identifier_value text, p_reason text)` — `SECURITY DEFINER`, executable by
`authenticated` **only after §7 has been satisfied**; `service_role` from day
one. Both write `audit_log`.

### 3.2 What makes two arrivals the same customer

**Neither phone nor email on its own. An identifier of a *kind*, matched exactly,
and only when the match is unambiguous.**

Resolution, in order — first hit wins:

1. **Normalise before matching.** An `email` matching
   `^\+?[0-9]{6,20}@whatsapp\.lead$` is **not an email**. It is a phone claim
   wearing an address, and 2 of 5 production leads carry one. Convert it to a
   `phone_tail9`. An email that is `''` or NULL yields no email claim at all.
   A phone is stripped of everything but digits, then of any WAHA device suffix
   (`971556456535:77` → `971556456535`), then reduced to its **last nine
   digits** — nine because `nexus_lead_for_comm_key`, `v_lead_messages`,
   `lib/identity.js` and the n8n `Resolve Lead Identity` node all already use
   nine, and diverging would silently split or silently merge people.
2. **`wa_lid` is matched exactly and is never treated as a phone.** Its digits
   are an opaque machine id. This is stated as a rule in `lib/identity.js`
   (*"Never add `lid` or `g.us` to this list"*) and it matters more here than
   anywhere: 95 of 142 production message rows are LID-keyed.
3. Collect every claim the arrival supports — up to one `email`, one
   `phone_tail9`, one `wa_chat_id`, one `wa_lid`. Look each up in
   `customer_identifier`.
4. **Zero matches → new customer.** Write the customer, write every claim as an
   identifier row.
5. **All matches agree on one `customer_id` → that customer.** Write any claim
   that was not yet on file.
6. **Matches disagree → refuse.** Create a **new** customer, link the
   opportunity to it, and record the disagreement. Do not merge. This is the
   behaviour `nexus_lead_for_comm_key` already has (`if v_people > 1 then return
   null`), promoted from "return nothing" to "return something honest and flag
   it". A wrong merge shows one person two other people's conversations; a wrong
   split shows one person twice. The second is embarrassing and recoverable; the
   first is a data-protection incident.

**Shared handset** — a husband and wife, or a company phone. The rule merges
them, and it will be wrong. There is no signal in this data that could tell them
apart, and inventing one (name similarity) would produce a machine that
occasionally splits one person into two for having typed their name differently.
Accepted, and mitigated by `nexus_customer_split` being a supported operation
rather than a data repair.

**Changed number** — old `phone_tail9` row gets `valid_until`, new one is added,
both point at the same customer. History survives because nothing was deleted.
The new number arriving *cold*, with no email and no LID overlap, resolves to a
new customer; a human joins them with `nexus_customer_merge`. That is the honest
answer: the database cannot know.

**Two numbers** — two identifier rows, one customer. Works by construction.

**The nine-digit collision.** Nine digits is not globally unique. `+971 50 123
4567` and `+91 50 123 4567` share nine. Within one dealership's book this is
vanishingly unlikely and the ambiguity rule (step 6) catches it when it happens;
across a platform of many dealerships it would matter, which is why every key in
this design is scoped by `tenant_id` and no identifier is ever matched across
tenants.

### 3.3 What ends one opportunity and starts the next

**Proposal — an opportunity ends when the first of these happens:**

1. **Explicit close.** `leads.status` reaches a terminal value. The vocabulary
   already exists and does not need inventing: `nexus_lead_is_open(text)` lists
   `WON, CLOSED_WON, CONVERTED, DELIVERED, SOLD, LOST, CLOSED_LOST,
   DISQUALIFIED, UNQUALIFIED, CLOSED, DEAD, JUNK, SPAM, ARCHIVED` as not-open.
2. **A deal.** A `purchase_history` row names this `lead_id`. The sale is the
   end of the buying opportunity by definition.
3. **Dormancy.** No message on the customer's conversation and no status change
   for **N days**, N a tenant setting with a proposed default of **45**.
   `tenant_configuration` and `tenant_configuration_default` already exist and
   already hold 10 defaults, so this needs no new mechanism.

**A new opportunity starts** when a `lead_event` is promoted, or an inbound
message arrives, for a customer **all of whose opportunities are ended**. If any
opportunity is still open, the arrival attaches to it.

A **different vehicle does not start a new opportunity.** A customer who asks
about a Patrol on Monday and a Land Cruiser on Thursday is one person on one
shopping trip, and a dealership counts that as one deal in progress. Splitting it
would double the pipeline value on the Overview screen for a customer who is
going to buy one car.

**What this rule gets wrong, and a dealership would recognise all three:**

- **The 46-day customer.** Somebody who goes quiet for seven weeks over Ramadan
  or a summer trip and comes back to the same salesman about the same car gets a
  *new* opportunity. Their time-to-close resets and the number flatters us.
  45 days is a guess dressed as a policy; §8 asks Ali for the real number and
  §7 says it cannot be validated with five leads.
- **The fleet buyer.** Three cars bought at once is one opportunity and three
  `purchase_history` rows. Revenue is right; opportunity count under-reports.
  Accepted: `purchase_history` carries the count and the Revenue screen reads it.
- **The trade-in.** A customer selling us a car and buying one is one
  opportunity under this rule and is arguably two. Accepted for now because
  NEXUS has no trade-in entity at all; revisit when it does.

### 3.4 A conversation's boundary, and whether it survives a channel change

**Proposal: a conversation belongs to a *customer*, not to a channel, and a
channel change does not start a new one.**

Ali's example — WhatsApp, then the website form — is one person continuing one
enquiry, and treating it as two threads would show a salesman half a
conversation with no sign that it is half. That is the failure mode
`lib/identity.js` was written to stop: *"Every other consumer keys on a single
value and therefore renders a PARTIAL history with no sign that it is partial.
That is the more dangerous kind of wrong: it looks complete."*

The product already behaves this way. `v_conversations` groups by a `person_key`
built from `COALESCE(leads.email, whatsapp_contacts.lead_email,
communication_logs.lead_email)` and reconciles the four shapes server-side, and
`screens/conversations.js` reads under every key the view resolved. **The model
should be a description of the screen that already works, not a competing
theory.** `conversation_key` is that description made storable.

A conversation closes on the same dormancy timer, but it is a **separate row from
the opportunity** and closes independently. A customer with a closed opportunity
(they bought) and a live conversation (they are asking about servicing) is an
ordinary Tuesday at a dealership, and one row could not represent it.

**What this gets wrong:** a WhatsApp group (`@g.us`) belongs to nobody and gets
no conversation; a broker or a family member messaging on behalf of three buyers
gets one conversation and one customer. Both are accepted, and the second is the
shared-handset problem again.

### 3.5 How `lead_event` attaches without breaking door three's one-writer guarantee

The guarantee, in `CLAUDE.md`'s words: *"Every lead that becomes a customer
passes through `nexus_promote_lead_event`, so now no receiver *can* forget, and
the sentence has one derivation rather than five that drift."* It was won by
**removing** a second audit writer from `nexus_lead_record_manual`, and this
design must not put one back.

**Only `nexus_promote_lead_event` changes, by `CREATE OR REPLACE FUNCTION`.**
`nexus_record_lead_event` and `nexus_hydrate_lead_event` are untouched. Inside
the promoter's existing transaction — after the `SELECT … FOR UPDATE` on the
event row that closed the three-customers race, and after the `INSERT INTO leads
… RETURNING id`:

```
v_customer := nexus_customer_resolve(r.tenant_id,
                r.normalized->>'email',
                r.normalized->>'phone_e164',
                r.normalized->>'wa_chat_id');
insert into lead_customer (lead_id, tenant_id, customer_id, link_basis, linked_by)
     values (v_lead, r.tenant_id, v_customer, <basis>, 'promoter');
-- open or reuse the conversation
-- then the existing audit_log insert, with the customer id added to summary
```

Four properties this preserves, each of which a reviewer should check
independently:

- **One writer.** The customer link is created by the same function that writes
  the audit row, in the same transaction. There is no second path.
- **One audit row.** The existing `INSERT INTO audit_log` is extended, not
  duplicated. Its wording gains the customer id and loses nothing.
- **One lock.** The `FOR UPDATE` that fixed the three-customers race covers the
  new writes too, so five concurrent promotions of one phone-only event still
  produce one lead, one customer and one link.
- **No new grants.** `CREATE OR REPLACE FUNCTION` reports `function`; the guard
  revokes `anon` EXECUTE, which is already the state. `lead_event`'s 15 column
  grants are not touched because `lead_event` is not touched.

`nexus_lead_ingest_invariants()` gains a ninth check — *every lead carrying an
ingestion source has exactly one `lead_customer` row* — so this is held by a gate
that can go red, in the way the eighth check went red on the wreckage of the race
before it went green.

---

## 4. Migration path

Each stage ships alone, is reversible alone, and leaves the dashboard working.

### Stage 0 — the tables exist and nothing reads them

Create `customer`, `customer_identifier`, `lead_customer`, `conversation`,
`conversation_key`. Indexes, the cross-tenant triggers, RLS enable, policies —
then, last, `revoke all … from anon, authenticated, public`, `grant select … to
authenticated`, `grant all … to service_role`. The migration ends with a `DO`
block asserting its own grants survived and that `anon` holds nothing, in the
shape `20260906071310` uses.

Zero rows. No screen changes. No function changes.
**Half-migrated behaviour:** none — nothing reads these.
**Reversal:** `DROP TABLE`. Five statements.
**Fires the guard:** yes, on each `CREATE TABLE`/`CREATE VIEW`, all on empty
objects, and never on `leads`.

### Stage 1 — resolve, and a backfill a human can read before it runs

`CREATE FUNCTION nexus_customer_resolve(...)`. Then a **reporting** function
`nexus_customer_backfill_preview()` that returns what it *would* link, and a
separate `nexus_customer_backfill_apply(p_confirm boolean)` that writes only when
told. Five production leads and 14 `whatsapp_contacts`; a human can read the
whole preview in one screen.

**Half-migrated behaviour:** `lead_customer` is partially populated. Nothing
reads it yet.
**Reversal:** `DELETE FROM lead_customer; DELETE FROM customer_identifier;
DELETE FROM customer;` — safe because nothing points at them.
**Fires the guard:** `function` only.

### Stage 2 — door three writes the link

`CREATE OR REPLACE FUNCTION nexus_promote_lead_event(uuid)` per §3.5. Proved on
staging first with a positive control, then production, in the sequence
`20260907190000` used.

**Half-migrated behaviour, and this is the stage where it matters:** leads
created *before* stage 2 have no `lead_customer` row unless stage 1's backfill
gave them one. **Every reader must treat a missing link as "not yet resolved",
never as "no customer" and never as "not a customer".** This is the same
distinction `screens/leads.js` and `lib/vocabulary.js` already make between a
stated unknown and a false green, and getting it wrong here would put "no
customer record" on a screen for a real person.
**Reversal:** re-apply the function body from `20260907240000`, which the repo
keeps verbatim.
**Fires the guard:** `function` only.

### Stage 3 — the read path

`CREATE VIEW v_customer_journey` — `security_invoker` (a database event trigger
requires it), tenant-scoped, and excluding quarantine tenants **in its own
definition** — the `NOT EXISTS (SELECT 1 FROM tenants _q WHERE _q.is_quarantine
AND _q.id = _v.tenant_id)` wrapper that `v_customer_360`, `v_conversations`,
`v_customer_directory` and `v_lead_messages` all carry verbatim. It joins customer →
opportunities → conversations → `purchase_history`, and its "not yet resolved"
column is explicit rather than inferred from a NULL.

First screen: **`apps/executive-dashboard/screens/customers.js`** gains a journey
pane. Second: **`apps/executive-dashboard/lib/identity.js`** gains the server
answer as a *preferred* source while keeping its client-side resolver as the
fallback — because during stages 2 and 3 the server answer is incomplete and the
client resolver is not.
**Reversal:** revert the screen; drop the view.
**Fires the guard:** `view`, on an object with no grants yet. Grants last.

### Stage 4 — the Master Router stops owning identity

`n8n-workflows/nexus_master_lead_router_ai_agent.json`, node **`Persist Lead
(deterministic)`**, stops POSTing `leads?on_conflict=tenant_id,email` and instead
posts a lead event to door three. **This is the change that actually ends "one
permanent lead per person"**, and it is the one Ali's caution is about. It must
not ship until stages 0–3 have run against real dealership traffic for long
enough to see a repeat customer.

Note it is a change made in the n8n UI on a GCP VM, not by a migration. The repo
copy is already stale (§1.3) and must be re-synced first, or the change will be
made against the wrong baseline.
**Reversal:** re-publish the previous workflow version. n8n keeps them.
**Fires the guard:** nothing. It is not DDL.

### Stage 5 — optional, last, and only if it is needed

`DROP INDEX public.leads_tenant_email_key`. It is the constraint that makes a
second opportunity for the same emailed customer impossible, and after stage 4
nothing needs it as an upsert target. **Do not do this before stage 4**, and do
not do it at all until §7.1 has measured whether `DROP INDEX` fires the guard.

Dropping it also removes the incidental lock that `CLAUDE.md` credits with hiding
the three-customers race for emailed leads. The `FOR UPDATE` in the promoter is
what protects that now, and §7 requires the five-concurrent-callers harness to be
re-run *after* the drop, not before.

---

## 5. What this design gets wrong

### 5.1 It will merge two people who share a phone

§3.2. There is no signal in this data that separates a husband and wife on one
handset, and the honest options were "merge them and support splitting" or
"never merge on phone", the second of which throws away the only identifier 20%
of these customers have. Accepted; mitigated by `merged_into` and
`nexus_customer_split` being first-class.

### 5.2 The 45-day dormancy rule is a guess

§3.3. Nobody has measured what the gap between a UAE dealership's enquiries
actually looks like, because there are five leads. The number is in
`tenant_configuration` so it can be changed without a migration, which is the
best that can be done about a number that cannot yet be known.

### 5.3 It cannot fix 107 of 142 messages

`conversation_key` only knows what it is told. The 95 LID-keyed rows whose
`whatsapp_contacts` row has `lead_email = NULL` remain unattached to anybody, and
this design does not change that. **The real fix is the one
`nexus_trace_linkability_report()` already names — a correlation id carried from
receiver to outbound message — and it is deliberately not attempted here.**
Pretending a customer table fixes message linkability would be the more damaging
kind of wrong.

### 5.4 `leads` keeps a name that is now a lie

§3.0. Every future reader of the schema meets a table called `leads` that holds
opportunities, and the correction lives in a JavaScript file. That is a real
cost, paid deliberately to avoid touching 60 consumers at once.

### 5.5 The one-open-conversation rule makes a broker invisible

§3.4. Someone messaging on behalf of three buyers is one customer with one
thread. A dealership would call that wrong and would be right.

### 5.6 It adds a table the dashboard cannot ALTER either

`customer`, `customer_identifier` and `lead_customer` will get `SELECT` grants
for `authenticated`, and — if §8's answer is yes — eventually write grants too.
The moment they do, they join `leads` and `inventory` on the list of tables an
`ALTER TABLE` silently breaks. **This design does not make the guard problem
smaller; it makes it wider by three tables.** The mitigation is to get the shape
right in stage 0, because the second migration against these tables is the
expensive one.

### 5.7 It introduces a customer id that most of the system will not carry

n8n writes as `service_role` and addresses leads by `email=eq.…` in two live
workflows. Those workflows will keep doing that after stage 3. So for a period
whose length nobody can predict, the customer id is a dashboard-side fact and the
email is still the operational key. A design that claimed otherwise on the day
stage 3 shipped would be claiming a migration that had not happened.

### 5.8 Ambiguity refusal creates duplicate customers on purpose

Step 6 of §3.2 creates a second customer rather than guessing. On a dealership
with messy data that means visible duplicates on the customers screen. That is
the intended trade — a visible duplicate is a complaint, an invisible merge is an
incident — but it is a cost and a salesman will notice it before a reviewer does.

---

## 6. What must be tested before this goes near production

### 6.1 Guard measurements — first, and before any migration is written

Each on staging, each in a transaction that is rolled back, each comparing
`relacl` and the per-column `attacl` set **byte for byte** before and after, in
the shape `CLAUDE.md` records for the `CREATE TRIGGER` measurement:

1. `CREATE UNIQUE INDEX … ON public.leads (…)` — do the eight column UPDATE
   grants survive? §2.2 predicts yes; nothing has measured it since the guard was
   installed on 4 September.
2. `DROP INDEX public.leads_tenant_email_key` — same question. Gates stage 5.
3. `COMMENT ON TABLE public.leads IS '…'` — §2.2 predicts the grants are
   **destroyed**. If that is right it must be written into `CLAUDE.md`, because
   it is a silent one.
4. `ALTER TABLE public.lead_event ADD COLUMN …` — do the 15 column SELECT grants
   survive a table-level `REVOKE INSERT, UPDATE, DELETE, TRUNCATE`? §2.4 predicts
   yes.
5. `CREATE POLICY` on a table holding grants — predicted `policy`, predicted no.

### 6.2 The identity rule, against real shapes

`nexus_customer_resolve` must be tested against the actual production key shapes,
not against invented ones: `+971547484167@whatsapp.lead`, `''`, `158510264357112@lid`,
`971556456535:77`, `walkin-preflight-01@nexus-preflight.invalid`, and an Arabic
push_name (`محمد فارن حسین` is live in `whatsapp_contacts`). The lead simulator
already has a `j-arabic-name-unicode.js` scenario to build on.

Specifically: a LID must never resolve by digits; two different LIDs for one
phone must resolve to one customer via `whatsapp_contacts`; the `.invalid`
preflight address must not merge with anything.

### 6.3 Concurrency, again

The five-`pg_cron`-backends-behind-a-`pg_sleep_until`-barrier harness that found
the three-customers race must be re-run against the **new** promoter, on a
**phone-only** event — the header of that harness says why it must be phone-only,
and the reason applies unchanged here. Expected: one lead, one customer, one
`lead_customer` row, five callers all naming it, zero orphans.

Then again after stage 5, because dropping `leads_tenant_email_key` removes the
incidental lock.

### 6.4 The repeat-customer journey, end to end

Promote a lead for a customer. Close it. Promote a second lead for the same
customer eight months later (simulated). Assert: two `leads` rows, **one**
`customer` row, two `lead_customer` rows, one conversation or two per the §3.3
rule, and the first opportunity's `vehicle_interest` **unchanged**. That last
assertion is the one the Master Router fails today.

### 6.5 The repeat-walk-in defect

Call `nexus_lead_record_manual` twice for the same email with different
`p_client_request_id`s. §1.3 predicts the second raises `23505` on
`leads_tenant_email_key`. Confirm it on staging. If confirmed it is a live
production defect independent of this design and should be filed as one.

### 6.6 What cannot be tested with one tenant and no test-marker column

`JOURNEYS.md` measured it and the answer has not changed: **no `journey_id`, no
`test_run_id`, no `is_test`, no `created_by_test` column exists on any base table
in `public`.** (`JOURNEYS.md` says 58 base tables; production holds **67** today,
so that count is stale and the conclusion is not.) Adding one to `leads` is an
`ALTER TABLE` on `leads` and is refused by §2.5. So:

- **Cross-tenant identity isolation cannot be tested on production.** It needs
  the staging tenants `11111111-…` (Alpha Motors) and `22222222-…` (Bravo
  Autos), and the assertion is that the same phone number in both produces **two
  customers**, one per tenant. Staging has 4 tenants and can do this. Production
  holds exactly two — `alba-cars` (active) and `__unattributed__` (quarantine,
  and the holder of `is_unattributed_default`) — so it has **one** real
  dealership and cannot test isolation at all.
- **Nothing about merge rates, duplicate rates or dormancy can be learned from
  five leads.** The 45-day default, the frequency of the shared-handset case, and
  whether ambiguity-refusal produces an annoying number of duplicates are all
  questions that need a real dealership's book. They are the reason Ali's
  caution is right, and they are the reason stage 4 is last.
- **A test customer cannot be told from a real one inside `customer`.** The same
  three-layer marker `JOURNEYS.md` builds — the tenant, the `.invalid`
  identity namespace, a source string — is the only available answer, and
  `customer.created_by` is the closest thing this design adds to a fourth. It is
  a *provenance* column, not a test marker, and it should not be pressed into
  service as one.
- **The n8n change in stage 4 cannot be tested from the repo at all.** The
  workflow lives on the VM, the repo copy is already stale, and there is no
  staging n8n. That is the weakest link in this plan and it is not a database
  problem.

---

## Open questions for Ali

1. **`leads` keeps its name, and "opportunity" is a word only the screens use.
   Yes or no?** A rename touches 21 views, 18 functions, 8 n8n workflows on the
   VM and 20 of 22 screens, all in one instant. §3.0 argues for keeping it. If
   the answer is no, this design needs re-costing, not re-shaping.

2. **When two arrivals share a phone number but nothing else, is that the same
   customer?** §3.2 says yes, and accepts that it will merge a husband and wife
   on one handset. The alternative is to require two matching identifiers, which
   would leave the 20% of your customers who have only a phone number
   permanently unmergeable. Which error do you want?

3. **How many days of silence end an opportunity?** §3.3 proposes 45 with no
   evidence for it. A number from Tenant A' actual experience is worth more
   than anything derivable from five leads. It is a tenant setting, so it can be
   changed later without a migration — but the first value ships as the default
   for every dealership after you.

4. **Does a customer who buys, then comes back for a second car, get a new
   opportunity — or does the sale close the whole journey?** §3.3 says the sale
   ends that opportunity and a later arrival opens a new one. Confirm, because it
   decides whether "repeat buyer" is a shape the Revenue screen can see.

5. **May a salesperson merge two customers from the dashboard, or is merging
   operations-only?** §3.1 grants the merge RPC to `service_role` on day one.
   Granting it to `authenticated` is a new write surface on the dealer plane,
   where the browser today holds eight narrow column grants and one RPC. A wrong
   merge shows one customer another customer's conversations.

6. **Is stage 4 — the Master Router giving up `on_conflict=tenant_id,email` — a
   change you want scheduled, or one that waits for a repeat customer to appear
   in the pilot?** Everything before it is additive and invisible. Stage 4 is
   the one that changes what happens to a real lead, and your caution reads as
   "wait". Confirm that it waits.

7. **Do you want the empty-string email on lead 35 corrected before any of this
   ships?** It is one row. `''` and NULL are two spellings of "no email" and only
   one of them is constrained by `leads_tenant_email_key`. Correcting it is a
   one-row `UPDATE`, not an `ALTER TABLE`, and it removes a trap the backfill in
   stage 1 would otherwise have to carry a special case for.

---

## 8. Addendum, 9 September 2026 — what building it on staging and breaking it taught

Everything above §8 was written from reading the catalogue. This section was
written after the model was actually built on staging `wwspuxrbiyagnrnzgate` and
attacked. It **corrects** three things §1–§7 got wrong and **confirms** two.

Evidence lives in `MEASURED-ON-PRODUCTION.md` (production, read-only),
`STAGING-MODEL.sql` (exactly what ran) and `BREAK-LOG.md` (each attack, its real
result). Where those disagree with §1–§7, they win: they are measurements and
§1–§7 is reading.

### 8.1 The production measurement changes the argument for the model

§1.1 counted five leads. It did not ask how many humans they represent. Measured:

- **Inside `leads`: 5 rows, 5 distinct normalised phones, 5 distinct nine-digit
  tails. Collision rate 0%.** There is no duplicate person in `leads` today. Any
  pitch of this model as "leads double-count humans" is false on this data.
- **Across `leads` + `whatsapp_contacts`: 19 identity-bearing rows, 15 distinct
  humans — 21% duplication.** Four humans exist twice, and one of the four
  (Effco, `111948809162873@lid`) is linked by nothing at all: its
  `whatsapp_contacts.lead_email` is NULL, and the only evidence the two rows are
  one person is a phone tail that no code computes.
- **The real number: the dealership has spoken to 15 people and `leads` knows 5.
  11 humans and 83 of 142 messages (58%) attach to no customer record at all.**

**So the argument for `customer` is not deduplication. It is that eleven humans
currently have no row anywhere that a salesperson can open.** §5.3 was right that
a customer table does not fix message linkability — but it was aimed at the wrong
target. The gap is not 107 unattributable messages; it is 11 unrepresented people.

### 8.2 §5.1 is wrong, and open question 2 now has an evidence-based answer

§5.1 accepted merging two people who share a phone, on the grounds that *"there
is no signal in this data that separates a husband and wife on one handset."*

**There is a signal, and the attack found it.** When Maryam arrives on Rashid's
landline she brings **her own email address** — a strong, account-bound
identifier that the matched customer does not hold and that contradicts the one
he does. Four walk-ins on the showroom line brought four distinct new emails. A
resolver that treats a phone match as sufficient is throwing that evidence away.

The corrected rule, built and tested as `im_resolve_customer_v3`:

- **strong keys** — email, WhatsApp LID, Instagram handle: account-bound, one
  human owns them;
- **weak key** — phone: shareable, because families and switchboards exist;
- a weak-key-only match whose strong key *contradicts* the matched customer does
  **not** merge. It declares the number shared in `im_shared_key`, creates a
  separate customer, and files a `SHARED_PHONE_SPLIT` review row.

Measured: three humans on one landline get three records, and each returns to
their own on a later arrival (`MATCHED`, correct customer, both times).

**And the cost of §5.1's accepted trade-off was understated.** The measured blast
radius: one customer card headed *"Rashid Al Mansoori"* carrying Maryam's email
address, her conversation, and an opportunity recorded *"Maryam: private purchase,
do not tell husband"*. §5.1 called this a data-quality trade. It is a
**cross-person data leak inside a single tenant**, and NEXUS RLS cannot see it
because RLS is tenant-scoped and both humans are in the same tenant. There is no
person-scope anywhere in the system. That should be the answer to open question 5
as well: a wrong merge is not a tidiness problem.

**Answer to open question 2: no.** Two arrivals sharing a phone and nothing else
are the same customer *only while no strong key contradicts*. The moment one does,
they split and the number stops being an identifier.

### 8.3 The price of that fix, which must be stated before it ships

Once a number is in `im_shared_key` it never identifies anybody again. Measured:
**three inbound calls on a shared line produced three throwaway customers.** On a
busy company switchboard that is one junk record per call, forever, until a human
works the `im_identity_review` queue — and that queue is work Tenant A does not do
today. This is not solved. It is priced, and the price is a person's time.

### 8.4 Normalisation is where the silent damage is, not identity

§6.2 listed the production key shapes to test against and was right to. What it
missed is that the *fix* for one of them creates a worse bug. Stripping the WAHA
`:77` device suffix with `split_part(raw, ':', 1)` — which the production data
genuinely requires — **destroys every number a human typed with a label**:
`"ph: 052 664 7253"` and `"Tel: +971526647253"` both normalise to NULL.

Worse, `"052 664 7253 ext 4"` silently normalises to **`+9715266472534`** — a
plausible number belonging to nobody, which creates a *second* customer for a
human already in the book and can never match again. **A silent wrong answer is
more expensive than a refusal**, and only one of the three failure modes here
refuses.

`im_normalize_phone_v3` is verified on 13 inputs including all of these. Any
production normaliser must carry the same test table, and must return a *quality*
alongside the value so `TRUNCATED_MULTI` arrivals can be flagged rather than
trusted.

### 8.5 §6.3 was right about concurrency and the fix is one line of intent

The naive read-then-write resolver, raced with two real `pg_cron` backends
**1.6 ms apart**, produced:

```
ARM_A_whatsapp | pid 584531 | sqlstate 23505 | duplicate key ... im_identity_unique_exclusive
ARM_B_webform  | pid 584530 | CREATED dfb22675-...
```

Read that precisely, because the obvious reading is wrong. The unique index
worked — there is no duplicate customer. What it produced instead is **a dropped
arrival**: the WhatsApp message errored, and no customer, no conversation and no
reply exists for it. **The index converted a duplicate-row problem into a
lost-lead problem, which for a dealership is the more expensive one.** Any design
that relies on a unique index to "handle" concurrency is choosing to lose leads.

The fix is `pg_advisory_xact_lock` on every normalised key **before** the read.
Re-raced: two backends 2.2 ms apart, both returned the same `customer_id`, one
CREATED and one MATCHED, no error. Throughput under contention and behaviour
above two writers are **NOT MEASURED**.

Method note for whoever re-runs this: **two parallel MCP tool calls are not
concurrent.** This harness executes them sequentially — measured 3.4 s and 5.0 s
apart even behind a wall-clock sleep barrier. A "pass" obtained that way means
nothing. Use `pg_cron`, which starts all jobs due on a tick in separate
background workers.

### 8.6 Three integrity holes §3 did not anticipate

1. **An opportunity could be linked to another customer's conversation.** Nothing
   checked that `conversation.customer_id = opportunity.customer_id`; the insert
   succeeded. Fixed with the composite-FK shape `lead_event` already uses
   (`unique (conversation_id, customer_id)`, `unique (opportunity_id, customer_id)`,
   `customer_id` on the link row, two composite FKs). Re-attacked: `23503`.
   **This constraint is not optional — without it, revenue attribution can be
   credited to the wrong human by an ordinary INSERT.**

2. **The 360 view listed merged-away customers as ghost rows** with zeros in
   every column. One `where status = 'active'` — but note that
   `CREATE OR REPLACE VIEW` resets `reloptions`, so `with (security_invoker = on)`
   had to be restated on the replace, exactly as the guard's HINT warns.

3. **A repair introduced a regression the naive version did not have.** Modelling
   "shared" as a boolean on the identity row let a later writer re-insert the
   same number as *not* shared; a known customer returning with his own email
   then matched two customers and was refused entry entirely. "Shared" is a fact
   about the key for the tenant, so it belongs in `im_shared_key`, keyed
   `(tenant_id, kind, value_norm)`. **The lesson generalises: any per-row flag
   that encodes a global fact will be re-introduced by the next writer.**

### 8.7 §3 and §5 were right about two things

- **The anonymous walk-in.** The first model refused to record a human with no
  phone and no email — *stricter than production `leads`, which mints
  `walkin-preflight-01@nexus-preflight.invalid` and does record them.* A new
  model that loses a customer the old one kept is a regression, and it was only
  visible because someone tried it. Fixed by minting an `anon` identity holding a
  UUID. Honest cost: anon customers can never be auto-merged, because a UUID
  matches nothing.
- **§5.8's ambiguity refusal is the right instinct**, and it now has a home:
  `im_identity_review` with `AMBIGUOUS_MULTI_CUSTOMER` and `SHARED_PHONE_SPLIT`
  reasons. Three review rows were filed by the attacks without anyone asking.

### 8.8 Un-merge: reversible in structure, lossy in meaning

§3.1 treated `merged_into` plus a split RPC as sufficient. Tested: a wrong merge
was reversed and the loser got back exactly what the merge log recorded — one
identity, one conversation, one opportunity. But **three objects created during
the merged period were stranded on the winner**, including a finance application,
and nothing can say which human they belong to.

**Un-merge restores the past. It cannot restore the middle. The loss grows with
time-to-detection, not with data volume** — which means the review queue in §8.3
is not optional hygiene, it is the mechanism that bounds this cost.

A defect found in the same attack and **not yet fixed**:
`im_unmerge_customer` reported `orphaned_since_merge = 1` when the true figure was
3 — it counts stranded identities only, not conversations or opportunities. An
un-merge tool that under-reports its own damage is worse than one that refuses to
run.

### 8.9 Still unsolved, and it needs a decision not a schema

Two open opportunities on one conversation (trade-in + new purchase) are accepted
by the schema — nothing assumes one, which §3 got right. But an inbound message on
that thread matches **two** candidate opportunities and the model carries no
tiebreaker. Attribution must then either pick (wrong half the time) or split
(double-count — the exact defect the model exists to remove).

**Until a rule exists, per-opportunity revenue attribution on a multi-intent
conversation is NOT MEASURED and must not be reported as a number.** This is a
new open question for Ali, and it is the one that decides whether the Revenue
screen can be trusted:

8. **When a customer has two open opportunities and sends one message, which one
   does it belong to?** Candidate rules: most recently touched; the one whose
   `vehicle_interest` the message mentions; ask the salesperson. Each is
   defensible; none is derivable from the data.

### 8.10 Revised status of §6's test plan

| §6 item | status |
|---|---|
| 6.1 guard measurements on `leads` | **NOT RUN** — untouched by this work |
| 6.2 identity rule vs real shapes | **partly run.** `:77` suffix, `''`, `.invalid` and synthetic-email exclusion covered by `im_norm_email`/`im_normalize_phone_v3`. **LID→customer resolution and Arabic push names NOT RUN.** |
| 6.3 concurrency | **RUN on the staging model** (`pg_cron`, two backends 2.2 ms apart, PASS). **NOT RUN against `nexus_promote_lead_event`.** |
| 6.4 repeat-customer journey | **NOT RUN** |
| 6.5 repeat-walk-in `23505` defect | **NOT RUN** — still a prediction, still worth filing |
| 6.6 cross-tenant isolation | **NOT RUN.** All staging work used Alpha Motors `11111111-…` only; Bravo `22222222-…` untouched. |

Nothing in §8 has been applied to production, and no repo code was changed. The
staging objects are all prefixed `im_` and the teardown is at the foot of
`STAGING-MODEL.sql`.
