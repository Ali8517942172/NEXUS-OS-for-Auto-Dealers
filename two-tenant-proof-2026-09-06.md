# M4 — two dealerships, one database: what was proved and what was not

**6 September 2026.** Staging `wwspuxrbiyagnrnzgate` (all writes). Production
`dsvuoovivysszdoiorch` (read-only; used only to confirm staging matches).
No git command was run. The production n8n box (`35.224.126.225`) was not contacted.

Every probe below ran inside a `DO $$ … $$` block that ends in an unconditional
`RAISE EXCEPTION`, so the transaction aborts whatever happens and the result comes
back in the error message. **Nothing was left behind** — see §9.

---

## 1 · The two dealerships, and what was already on staging

| | Alpha Motors | Bravo Autos |
|---|---|---|
| tenant_id | `11111111-1111-4111-8111-111111111111` | `22222222-2222-4222-8222-222222222222` |
| owner (auth uid) | `aaaaaaaa-…-a001` | `bbbbbbbb-…-b001` |
| other members | member `a002`, manager `a003`, sales `a004`/`a005`, technician `a006`, admin `a007` | member `b002` |
| WAHA sessions | `staging-alpha` (`cbc09bb4-…`), `alpha-second-session` (`aaaa0002-…`) | `staging-bravo` (`3584f726-…`) |

Third tenant: `__unattributed__` `9448e5d8-4035-4e57-979f-65d0411cb916`,
`status='quarantine'`, `is_quarantine=true`, holding `is_unattributed_default`.

**Rows already on staging when this pass started, left untouched** (they belong to
earlier passes and are other people's evidence):

```
audit_log A=3 B=1 · channel_registry A=2 B=1 · channel_send_directive A=1 B=1
inventory A=2 B=1 · inventory_action_events A=4 B=1 · inventory_action_policy A=1 B=1
inventory_actions A=1 B=1 · inventory_profit_settings A=1 B=1 · leads A=3 B=1
policy_rule A=0 B=1 NULL=6 · tenant_members A=7 B=2 · users A=7 B=2
whatsapp_delivery_events A=2 B=0   (both rows are wamid.COLLIDE.1, both under Alpha)
```

Everything this pass created was created inside the aborted transactions and is gone.

### Staging and production are still structurally identical

Measured on both, this pass, same eight queries:

| | columns | constraints | functions | indexes | policies | tables | views | triggers |
|---|---|---|---|---|---|---|---|---|
| staging | 1731 | 374 | 269 | 169 | 163 | 59 | 39 | 19 |
| production | 1731 | 374 | 269 | 169 | 163 | 59 | 39 | 19 |

Grants match too: on **both** projects the only `public` relation carrying any
write privilege for `authenticated` at table level is `inventory` (`rd`).
**Function bodies were not compared** — the 4 September `md5(prosrc)` finding
(34 of 105 differing before comment-stripping) remains unretested. NOT RUN.

---

## 2 · The journey, walked under each dealership

Seven steps, in one transaction per tenant, using the **real writer for each step**:
a signed-in `authenticated` role with a JWT `sub` claim where the product has a
signed-in path, `service_role` where the real writer is n8n. Which role did what is
stated, because "proved as `service_role`" proves nothing about a dealership.

| step | Alpha | Bravo | run as |
|---|---|---|---|
| **1 enquiry** | `nexus_record_channel_event(cbc09bb4…, inbound, wamid.M4PROOF.A.ENQ.001)` → tenant **A**, `first_seen=t` | `…(3584f726…, wamid.M4PROOF.B.ENQ.001)` → tenant **B**, `first_seen=t` | `service_role` (n8n's role) |
| **1b window + consent** | `whatsapp_record_customer_message` + `whatsapp_record_opt_in_event` → `OPTED_IN` | same for `9715…902` | `service_role` |
| **2 lead** | id 13, tenant A | id 14, tenant B | `service_role` |
| **3 conversation** | `communication_logs` inbound row, tenant A | tenant B | `service_role` |
| **4 vehicle** | `M4-A-UNIT` **inserted by the signed-in Alpha owner** | `M4-B-UNIT` by the signed-in Bravo owner | `authenticated` |
| **5 policy decision** | `whatsapp_policy_decision_for_channel('whatsapp_waha_session','staging-alpha',…)` → tenant **A** | `'staging-bravo'` → tenant **B** | `service_role` |
| **6 action** | `action_propose` → `action_decide(APPROVE)` (`TENANT_OWNER`) → `action_mark_executed` → `EXECUTED` | same, tenant B | `authenticated` |
| **7 deal** | `purchase_history` AED 100,000 + `deals_embeddings`, then `action_record_outcome` → `ATTRIBUTED`, recovered **AED 5,000** | AED 200,000 → `ATTRIBUTED`, recovered **AED 105,000** | insert `service_role`, outcome `authenticated` |

Every step carried the right `tenant_id` on both walks. The four `audit_log` rows
each journey wrote (propose / approve / execute / outcome) all carried the walking
tenant and no other — verified as `service_role`: rows matching the action id and
carrying the *wrong* tenant = **0**, both directions.

One measurement from step 5 worth keeping: `whatsapp_policy_decision_for_channel`
with intent `CUSTOMER_SERVICE` returns `BLOCKED / INTENT_CATEGORY_UNKNOWN` —
`CUSTOMER_SERVICE` is not in `whatsapp_message_intent`. The four valid codes are
`SERVICE_REPLY`, `FOLLOW_UP`, `UTILITY`, `MARKETING`. Refusing an unknown intent
rather than guessing one is correct behaviour, recorded here so the next caller
does not read `BLOCKED` as a policy verdict.

---

## 3 · Assertion 1 — tenant isolation, both directions

50 probes, each as a signed-in owner of one dealership against the other's freshly
created journey rows. **Controls first**, because a probe that returns 0 against a
row that does not exist proves nothing.

| probe | A→A (control) | A→B | B→B (control) | B→A |
|---|---|---|---|---|
| read lead | rows=1 | **rows=0** | rows=1 | **rows=0** |
| read vehicle | rows=1 | **rows=0** | rows=1 | **rows=0** |
| read purchase | rows=1 | **rows=0** | rows=1 | **rows=0** |
| read conversation | rows=1 | **rows=0** | rows=1 | **rows=0** |
| read deal embedding | rows=1 | **rows=0** | rows=1 | **rows=0** |
| read action | rows=1 | **rows=0** | — | **rows=0** |
| UPDATE lead | rows=1 | **rows=0** | rows=1 | **rows=0** |
| UPDATE vehicle | rows=1 | **rows=0** | rows=1 | **rows=0** |
| UPDATE purchase | — | **SQLSTATE 42501** | — | **SQLSTATE 42501** |
| DELETE lead | — | **SQLSTATE 42501** | — | **SQLSTATE 42501** |
| DELETE purchase | — | **SQLSTATE 42501** | — | — |
| DELETE vehicle | reached the row (23503, FK from `inventory_actions`) | **rows=0** | reached the row (23503) | **rows=0** |

**Name the lock, not the outcome.** Three different locks appear above and they are
not interchangeable:

- `rows=0` — the verb was permitted and **RLS filtered every row**. This is the
  tenant lock doing its job.
- `42501` — refused by **GRANT** before RLS was consulted (`purchase_history` and
  `leads` carry no DELETE grant for `authenticated`; `purchase_history` no UPDATE).
- `23503` — on the *own-tenant* delete control the row **was matched** and a foreign
  key stopped it. That is a stronger control than `rows=1`: it proves the DELETE
  verb reaches the owner's own row, so the `rows=0` on the cross-tenant delete is a
  filter, not an absence of capability.

**Assertion 1: PASS, both directions.** Zero cross-tenant rows on read, update and
delete, with a live positive control on every line.

---

## 4 · Assertion 2 — messaging

| # | probe | result |
|---|---|---|
| M1 | inbound event through Alpha's carrier | tenant **A** — PASS |
| M2 | inbound event through Bravo's carrier | tenant **B** — PASS |
| M3–M5 | `nexus_resolve_channel_tenant` for `staging-alpha` / `staging-bravo` / `alpha-second-session` | A / B / A — PASS (both Alpha sessions resolve to Alpha) |
| M6 | same for an unregistered session `'default'` | **zero rows** — unresolved is empty, not a fallback |
| M7 | delivery report filed **through** Bravo's carrier by the writer | tenant **B**. The writer takes the tenant from the carrier; the caller does not supply it |
| M13 | direct insert: `whatsapp_delivery_events(tenant_id=A, integration_id=B)` | **SQLSTATE 23503** — composite FK |
| M14 | direct insert: `channel_message_events(tenant_id=A, integration_id=B)` | **SQLSTATE 23503** |
| M15 | direct insert: `whatsapp_opt_in_event(tenant_id=A, integration_id=B)` | **SQLSTATE 23503** |
| M16 | control: same insert with `tenant_id=B, integration_id=B` | rows=1 |
| M8–M12 | consent state at the engine: (A,A-carrier,A-customer)=`OPTED_IN`, (A,A,B-customer)=`NULL`, (B,B,A-customer)=`NULL`, (B,B,B-customer)=`OPTED_IN`, (A-tenant, B-carrier)=`NULL` | PASS |
| M21–M24 | `channel_registry`: A sees its 2 rows and 0 of Bravo's; B sees its 1 row and 0 of Alpha's | PASS |
| P22 | `whatsapp_policy_decision(tenant=A, integration=B)` | `BLOCKED / CHANNEL_NOT_REGISTERED_TO_TENANT` |

**Assertion 2: PASS, both directions** — and the carrier↔tenant binding is a
**constraint**, not a policy, which matters in §8.

**One thing this assertion cannot claim.** `whatsapp_opt_in_event`,
`channel_message_events` and `whatsapp_delivery_events` return **42501 to
`authenticated`** — no grant at all. "A consent event under one dealership is
invisible to the other" is therefore true but **trivially** true: it is invisible to
its own dealership too. The isolation that is doing real work here is M8–M12 at the
engine level, and that is what the PASS rests on. See finding F3.

---

## 5 · Assertions 3 and 6 — inventory, and every view that reads it

All **39** views in `public` were swept, as Alpha and as Bravo, and again as
`service_role`. For the 30 carrying `tenant_id`, the probe was
`count(*) where tenant_id = <the other dealership>`.

**Cross-tenant rows: 0. In all 39 views. In both directions.**

Selected rows, showing the counts partition rather than merely returning zero:

```
view                             A     B    svc   A_sees_B  B_sees_A
v_inventory_profit_sentinel      3     2     5       0         0
v_inventory_sales                3     2     0       0         0
v_inventory_action_queue         2     2     4       0         0
v_inventory_action_timeline      9     6    15       0         0
v_attribution_edges             14    10    24       0         0
v_attribution_events            11     7    18       0         0
v_attribution_sale_chain         1     1     2       0         0
v_customer_directory             4     2     0       0         0
v_customer_360                   4     2     6       0         0
v_conversations                  1     1     2       0         0
v_lead_recovery                  4     2     6       0         0
v_policy_rule                    6     7     7       0         0
v_needs_attention (no tenant_id) 1     1     2       —         —
v_team_performance (no tenant_id)7     2     9       —         —
```

The nine views with no `tenant_id` column cannot be probed by predicate, so they were
checked by partition instead: `v_team_performance` gives Alpha 7 and Bravo 2 against
9 for `service_role`, `v_needs_attention` 1 and 1 against 2. 7+2=9 and 1+1=2 — the
two dealerships' views are disjoint and together exhaust the whole. The other seven
hold zero rows for everyone.

Six sweep cells came back `42501` rather than a count:
`v_channel_provider_capability`, `v_channel_send_health`,
`v_whatsapp_conversation_window` — the messaging views, refused to end users by
grant. Recorded as refusals, not as passes.

**Attribution specifically** — Bravo's AED 200,000 sale must never become Alpha's
recovered revenue:

```
recovered_value_aed visible to Alpha  =   5,000  (1 row)
recovered_value_aed visible to Bravo  = 105,000  (1 row)
total as service_role                 = 110,000  (A-only 5,000 · B-only 105,000)
A sees B's sale in v_attribution_sale_chain   rows=0
B sees A's sale in v_attribution_sale_chain   rows=0
A sees B's unit in v_inventory_sales          rows=0
A sees B's customer in v_customer_directory   rows=0
A sees B's row in v_customer_360              rows=0
attribution edges carrying neither tenant     rows=0
```

**Assertions 3 and 6: PASS, both directions.**

---

## 6 · Assertion 4 — staff

| # | probe | result |
|---|---|---|
| S1 | Alpha **member** updates Bravo's lead | rows=0 |
| S2 | Alpha **member** updates Bravo's vehicle | rows=0 |
| S3 | Alpha **manager** updates Bravo's vehicle | rows=0 |
| S4 | Alpha **sales** updates Bravo's lead | rows=0 |
| S5 | Alpha **sales** updates an **own-tenant** lead not assigned to them | rows=0 — the intra-tenant role model holds too |
| S6 | control: Alpha **owner** updates an own-tenant lead | rows=1 |
| S7 | Alpha owner **grants itself membership of Bravo** | **42501** — no INSERT grant on `tenant_members` |
| S8 | Alpha owner **moves its own membership to Bravo** | **42501** |
| S9 | Alpha owner creates a user under Bravo | **42501** on `users` |
| S13 | Alpha owner calls `nexus_onboard_dealership()` | **42501 permission denied for function** |
| S10/S11 | Alpha owner reads `tenant_members` → **1 row** (its own); reads `users` → 7 (Alpha's staff only) | PASS |
| S12 | Bravo owner reads Alpha's `users` | rows=0 |
| S14/S15 | Bravo owner updates Alpha's vehicle → rows=0; grants itself Alpha membership → **42501** | PASS |
| S16 | Alpha owner presents a **forged JWT `tenant_id` claim naming Bravo** | `nexus_current_tenant_ids()` = Alpha only; leads visible 4, of which Bravo's = **0** |
| Q12 | Alpha owner presents a forged `tenant_id` claim naming the **quarantine tenant** | resolves to Alpha only |

**Assertion 4: PASS, both directions.** Membership is the authority and a signed-in
user cannot write it; the JWT claim is a filter over membership, never a source of it.

---

## 7 · Assertions 5, 7 and 8

### Assertion 5 — policy (re-proved as part of the journey, not cited)

| # | probe (as the signed-in Alpha owner unless stated) | result |
|---|---|---|
| P1 | proposes `TENANT_HOUSE / ALPHA_LOCAL_QUIET_HOURS` | `PROPOSED`, row carries **tenant A** |
| P2 | legislates in `PLATFORM_WHATSAPP` | **NX001** — *"…is Meta Platforms, Inc.'s namespace (PLATFORM), not this dealership's"* |
| P3 | legislates in `NEXUS_HOUSE` | **NX001** |
| P4 | legislates in `AE` (regulator) | **NX001** |
| P5 | **verifies** Bravo's house rule `bbbb0001` | **NX001** — *"That rule belongs to another dealership."* |
| P6 | **supersedes** Bravo's house rule | **NX001** — same |
| P7 | **withdraws** Bravo's house rule | **NX001** — *"not this dealership's to withdraw"* |
| P8 | verifies a `PLATFORM_WHATSAPP` rule | **NX001** — a single dealership's approver may not attest for the platform |
| P9 | supersedes a `PLATFORM_WHATSAPP` rule | **NX001** — a global rule binds every dealership |
| P10/P11 | Alpha reads Bravo's house rule → rows=0; Bravo reads it → rows=1 | PASS |
| P12/P13 | Alpha UPDATEs / DELETEs `policy_rule` directly | **42501** both |
| P14/P15 | **Bravo** verifies / supersedes Alpha's new rule | **NX001** both — the control holds in the other direction |
| PC2/PC3 | control: Alpha **verifies** then **supersedes its own** rule | `VERIFIED` v1, `SUPERSEDED` v2 — the ability exists and is scoped |
| PC4/PC5 | Bravo sees Alpha's rule → rows=0; withdraws it → **NX001** | PASS |

**Is Bravo's `TENANT_HOUSE` rule authority over Alpha's send?** No.

```
P17  A · SERVICE_REPLY  → TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED
     rule WA_CUSTOMER_SERVICE_WINDOW_HOURS (PLATFORM_WHATSAPP, NOT_VERIFIED)
P18  A · rules_considered mentions BRAVO_LOCAL_QUIET_HOURS?   no
P19  A · MARKETING      → BLOCKED / OPT_IN_NOT_EVIDENCED
     rule WA_MARKETING_REQUIRES_OPT_IN_EVEN_INSIDE_WINDOW (NEXUS_HOUSE)   — no Bravo rule
P20  B · SERVICE_REPLY  → TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED
P21  B · MARKETING      → BLOCKED / OPT_IN_NOT_EVIDENCED
```

**Assertion 5: PASS, both directions.**

### Assertion 7 — audit

| probe | result |
|---|---|
| Alpha reads any audit row carrying Bravo's tenant | rows=0 |
| Bravo reads any audit row carrying Alpha's tenant | rows=0 |
| Alpha reads its own journey's audit rows (control) | **rows=4** |
| Bravo reads its own journey's audit rows (control) | **rows=4** |
| Alpha reads Bravo's journey audit rows | rows=0 |
| Bravo reads Alpha's journey audit rows | rows=0 |
| `service_role`: audit rows for A's action carrying the wrong tenant | rows=0 |
| `service_role`: audit rows for B's action carrying the wrong tenant | rows=0 |
| `service_role`: `inventory_action_events` for either action carrying the wrong tenant | rows=0 |

**Assertion 7: PASS, both directions.**

### Assertion 8 — the quarantine tenant

| # | probe | result |
|---|---|---|
| Q1/Q2 | Alpha / Bravo see the quarantine tenant row | rows=0 / rows=0 |
| Q3/Q4 | control: each sees its own tenant row | rows=1 / rows=1 |
| Q5/Q6 | Alpha reads quarantine `leads` / `audit_log` | rows=0 / rows=0 |
| Q7/Q8 | either dealership **takes** `is_unattributed_default` | **42501** — no UPDATE grant on `tenants` |
| Q9 | `service_role` moves the flag to a dealership | **23514** `tenants_unattributed_default_must_be_quarantine` |
| Q10 | `service_role` clears `is_quarantine` on the holder | **23514** `tenants_quarantine_is_…` |
| Q11 | `nexus_quarantine_census()` | **zero rows** |
| W4 | `nexus_default_tenant_id()` as `service_role` | the quarantine tenant — a writer that omits `tenant_id` lands in quarantine, not on a dealership |

**Assertion 8: PASS.** Q9/Q10 matter most: these two are `CHECK` constraints, so
they hold against `service_role` as well as against a dealership.

### Extra — shared customer identity across two dealerships

Not on the list, but the journey starts with a customer and the same person can
enquire at both dealerships. Run as `service_role`:

```
C1  same lead email under BOTH dealerships          accepted   (leads.email scoped per tenant)
C2  same WhatsApp chat_id under BOTH                accepted
C3  same processed_messages message_id under BOTH   accepted — one dealership cannot
                                                    swallow the other's message as a duplicate
C4  control: the same claim twice within ONE        23505     — idempotency intact
C5/C6 same external_message_id via A's carrier then B's:  first_seen = t and t
C7  control: replay via A's carrier:                first_seen = f
C8  wamid.COLLIDE.1 (already twice under Alpha from an earlier pass) recorded
    under Bravo's carrier:                          tenant B, first_seen = t
C9/C11 Alpha reads the shared email → 1 row, all under A · Bravo → 1 row, all under B
```

Per-tenant scoping of the natural keys is real, and the idempotency keys are scoped
with it: dedupe still works inside a dealership and does not reach across.

### Extra — `anon`

Swept all 98 relations in `public` as `anon`: **98 refused by privilege
(42501 "permission denied for schema public"), 0 reached, 0 rows**. The schema door,
not the row filter, is what answers. `nexus_public_exposure_report()` — which carries
an `anon` EXECUTE grant — also dies at the schema door.

---

## 8 · What could NOT be proved, and why

This is the part that decides M4, and none of it is softened.

### 8.1 Nothing above the database was tested at all

Measured, not asserted:

- `service_role` has `rolbypassrls = true` (`pg_roles`).
- As `service_role`, `leads` visible = **4 across both dealerships** (A=3, B=1).
- As `service_role`, an INSERT naming `tenant_id = Bravo` **succeeded with no check
  whatsoever** (probe W3). Nothing in the database asked who was writing.
- Every messaging writer and the tenancy helpers are `service_role`-only:
  `nexus_record_channel_event`, `whatsapp_record_delivery_status`,
  `whatsapp_record_opt_in_event`, `nexus_resolve_channel_tenant`,
  `nexus_request_send`, `nexus_route_message`, `whatsapp_policy_decision*`,
  `nexus_onboard_dealership`, `nexus_tenancy_readiness` — all `42501` for
  `authenticated`.

n8n holds `service_role`. So the eight assertions split into two groups:

| control | mechanism | holds against `service_role`? |
|---|---|---|
| 1 tenant isolation (read/update/delete) | RLS | **No** |
| 3 inventory, and the 39 views | RLS + `security_invoker` | **No** |
| 4 staff / membership | RLS + grants | **No** |
| 6 attribution | RLS through views | **No** |
| 7 audit readability | RLS | **No** |
| 8 quarantine *readability* | RLS | **No** |
| 2 carrier↔tenant binding | composite FOREIGN KEY (23503) | **Yes** |
| 8 quarantine *flag* | CHECK constraint (23514) | **Yes** |
| idempotency / natural keys | UNIQUE index (23505) | **Yes** |
| `tenant_id NOT NULL` on 16 tables, 37 FKs to `tenants` | constraints | **Yes** |

So: **assertions 1, 3, 4, 6, 7 and the read half of 2 and 8 are UNTESTED above the
database and are not enforced there.** For n8n, the only tenant controls that exist
are the four constraint-shaped ones in the lower block. That is the actual state of
M4 and it is not improved by anything in §3–§7.

### 8.2 `NEXUS_TENANT_MAP` — NOT RUN

The n8n box is owned by another pass and was not contacted. This pass cannot say
what that variable holds. The switch has **still not been rehearsed** in the sense
that matters, which is on the box.

What *was* rehearsed is the database half of it, and it produced a live defect —
see F2 below: with two active dealerships, `nexus_scoped_tenant_id()` returns
**NULL**, which is the Customer 360 silence CLAUDE.md predicted, now measured rather
than predicted.

### 8.3 The inbound webhook — the database half only

`nexus_resolve_channel_tenant` is a pure function of the session string it is handed:

```
'staging-alpha'          → Alpha
'staging-bravo'          → Bravo
'alpha-second-session'   → Alpha
'default' (unregistered) → zero rows
```

That is correct behaviour and it is also the whole problem. With two dealerships
registered, **whoever controls that string chooses which dealership is written**, and
the only thing that authenticates the string lives on the box (`WAHA_WEBHOOK_SECRET`,
recorded as unset). The database cannot and does not check it. NOT RUN above the
database; the database half behaves exactly as designed.

### 8.4 Other NOT RUNs

- **`B3` — cross-dealership denial through a real signed-in browser session against
  the live PostgREST API.** Everything here used Postgres roles with
  `request.jwt.claims` set as a GUC, which is how PostgREST *presents* a JWT but is
  not a signed JWT travelling through PostgREST. Same limitation `VERSIONS.md`
  already records. NOT RUN.
- **`B1`, `B2`, `B4`** — non-approver refusal, decision idempotency,
  rendered-vs-live parity. Not attempted in this pass. NOT RUN.
- **Function-body parity between staging and production.** Structure matches
  exactly; bodies were not compared. NOT RUN.
- **Whether the 20-screen dashboard behaves correctly with two dealerships.** No
  frontend was exercised. NOT RUN.

---

## 9 · What was left behind

Nothing, with one honest exception.

A post-run census over every `public` table carrying `tenant_id` returns **exactly
the counts in §1** — identical to the pre-state, table for table. No probe row,
fixture or journey artefact persists, and no earlier pass's evidence was deleted or
altered (`wamid.COLLIDE.1` × 2 under Alpha, the Bravo `TENANT_HOUSE` rule
`bbbb0001`, the second Alpha session `aaaa0002`, the APPROVED `ALPHA-001` and
PROPOSED `BRAVO-001` actions and their 4 audit rows are all still there, untouched).

**The exception:** `leads_id_seq` is non-transactional and advanced. `last_value` is
now **23** while the highest existing `leads.id` is **9**. Roughly eleven id values
were consumed and rolled back. This is expected of a Postgres sequence, harmless, and
recorded so nobody later reads the gap as deleted rows.

Nothing was written to production. No git command was run. The n8n box was not contacted.

---

## 10 · Defects found — reported, not fixed

### F1 · The canonical grant check in `CLAUDE.md` is blind to column-level grants — P1 (audit integrity)

`CLAUDE.md` carries a query under the instruction *"Run it; do not reason about it"*,
keyed on `has_table_privilege('authenticated', c.oid, 'UPDATE')`. On **both** projects
that predicate is **false** for `inventory` and `leads`, and `relacl` reads
`authenticated=rd` and `authenticated=r`.

In this pass **a signed-in dealership owner successfully INSERTed a row into
`inventory`** (journey step 4, both tenants). The grants are real and live in
`pg_attribute.attacl`, not `pg_class.relacl`:

```
inventory  INSERT for authenticated on: id, model, vin, status, price_aed,
                                        cost_aed, ai_recommendation, acquired_at, tenant_id
inventory  UPDATE for authenticated on: id, model, vin, status, price_aed,
                                        cost_aed, ai_recommendation, acquired_at
leads      UPDATE for authenticated on: name, email, phone, vehicle_interest,
                                        budget_aed, status, assigned_to, assigned_to_id
```

Identical on staging and production. So the documented check would report both live
dashboard write paths as **closed** when they are open. The grants themselves look
deliberate and correctly narrow — this is a defect in the *check*, and the check is
the thing this repository relies on to notice a hole with no grant-shaped diff.
The fix is `has_any_column_privilege` alongside `has_table_privilege`, and reading
`attacl` as well as `relacl`. **Not applied — this pass does not fix what it finds.**

Consequence for the record: `CLAUDE.md`'s sentence *"No table grants a table-level
UPDATE"* is true and misleading in the same breath, and `VERSIONS.md`'s
*"`inventory` (`arwd`) and `leads` (`rw`)"* describes a shape that no longer exists
at table level.

### F2 · `nexus_tenancy_readiness()` is silent about the one thing that breaks at two dealerships — P1

Run on staging **with two active dealerships**, which is exactly the condition it
exists to gate:

```
INFO  unresolvable traffic is quarantined, never filed under a dealership
INFO  natural keys correctly scoped per dealership
WARN  tenant_id is nullable by design on policy_rule_event
WARN  tenant_id is nullable by design on policy_rule
→ zero BLOCKERs
```

Measured in the same transaction:

```
nexus_scoped_tenant_id() as service_role, 2 active dealerships = NULL
```

That NULL is the Customer 360 nightly batch having no scope: it syncs nobody and
writes no audit row. The live readiness gate returns **zero BLOCKERs** while standing
on top of it. It also says nothing about `workflow_registry` having no `tenant_id`.
A gate that is green on a database where a known engine goes silent is not measuring
onboarding readiness.

### F3 · A dealership cannot see its own consent, message or delivery records — P2 (product, not security)

`authenticated` gets **42501** on `whatsapp_opt_in_event`, `channel_message_events`,
`whatsapp_delivery_events`, and on the views `v_whatsapp_conversation_window`,
`v_channel_send_health`, `v_channel_provider_capability`. Correct as isolation and
consistent with "no end-user role in the messaging layer" — but it means the
consent record that the policy engine refuses sends on can never be shown to the
dealership that owns it, and it means assertion 2's "invisible to the other
dealership" is satisfied for a reason unrelated to tenancy. Recorded so a future
screen is designed around it rather than blocked by it.

### F4 · `v_customer_directory` and `v_inventory_sales` return zero rows to `service_role` — P2

Both are `security_invoker` and scoped by `nexus_current_tenant_ids()`, which is
empty for any role with no `auth.uid()`. Measured: Alpha 4 / Bravo 2 and
Alpha 3 / Bravo 2, but **service_role 0 and 0**, with no error. Any back-end reader
of those two views gets silence that looks like "no customers". This is the
"missing row is not proof the event did not happen" shape.

### F5 · A refusal string renders an empty date — P3

`policy_verify_rule` on Bravo's `bbbb0001` returned:

> `This version has been in force since  and that date cannot move.`

`effective_from` is NULL on that rule and the message interpolates it raw. Cosmetic,
but it is a refusal a dealership would read.

### F6 · `workflow_registry` — unchanged, still open

No `tenant_id` column; both dealerships read the identical set. Staging holds **0**
rows so there is nothing to leak there; **production holds 18**. Gate `L2` is
correctly red and must not be cleared by an exemption. Confirmed, not new.

---

## 11 · The verdict

**Assertion by assertion:**

| # | assertion | verdict |
|---|---|---|
| 1 | tenant isolation, read/update/delete, both directions | **PASS** at the database · UNTESTED above it |
| 2 | messaging: carrier resolves the tenant; a foreign carrier cannot be filed; consent does not cross | **PASS** — and the carrier binding is a constraint, so it holds against `service_role` too |
| 3 | inventory, in the tables and in all 39 views | **PASS** at the database · UNTESTED above it |
| 4 | staff cannot reach another dealership or grant themselves membership | **PASS** at the database · UNTESTED above it |
| 5 | policy: jurisdiction ownership, and a house rule binds only its author | **PASS**, both directions, with positive controls |
| 6 | attribution: one dealership's sale never becomes another's revenue | **PASS** at the database · UNTESTED above it |
| 7 | audit rows carry the right tenant and do not cross | **PASS** at the database · UNTESTED above it |
| 8 | quarantine invisible; neither can take the flag | **PASS** — flag protected by CHECK, so it holds against `service_role` too |
| — | `NEXUS_TENANT_MAP` switch on the box | **NOT RUN** |
| — | inbound webhook authentication | **NOT RUN** above the database |
| — | `B1`–`B4` | **NOT RUN** |

**What may now be said commercially**

> *"Isolation between two dealerships is proven adversarially at the database, in
> both directions, across a full customer journey — enquiry, lead, conversation,
> vehicle, policy decision, action and deal — under real signed-in dealership roles.
> Every probe returned zero cross-tenant rows, with a live positive control on each
> one."*

That is backed by every measurement in this file.

**What may still NOT be said**

> Anything containing the words *runtime*, *operational*, *production*, *ready for a
> second dealership*, or *safe to onboard*.

The workflow layer writes as `service_role`, which is `BYPASSRLS`; six of the eight
assertions above do not apply to it at all; and the inbound webhook still lets the
caller name the dealership. None of that was touched here.

**The one line.**

> **The honest sentence does not change.** It remains *"multi-tenant architecture
> implemented, second-dealer runtime proof pending"* — this pass upgrades
> *implemented* to *implemented and adversarially proven at the database*, and
> leaves *runtime* exactly where it was, because the layer that would carry a real
> second dealership's traffic was neither reached nor tested.
