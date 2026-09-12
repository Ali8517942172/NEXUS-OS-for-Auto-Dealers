# The empty tables were not empty because nobody wrote to them

12 September 2026. Adversarial cross-check of `ops/message-durability/` and
`ops/identity-model/`, both written 9 September. Production
`dsvuoovivysszdoiorch` **read-only**; staging `wwspuxrbiyagnrnzgate` read-only
(the `im_*` objects a sibling built there were read, not modified). No n8n call
was made. Every number below is a query I ran myself, not a figure copied from a
sibling's document — which matters, because three days have passed and most of
them have moved.

Written to exactly one file: this one.

---

## VERDICT 1 — evidence decay: CONFIRMED, and it is now a family of three

### 1.1 The purge window and the counts

```sql
select min(processed_at)::text, max(processed_at)::text, count(*),
       (now() - interval '7 days')::text from public.processed_messages;
-- 2026-09-05 10:25:39.791352+00 | 2026-09-12 16:08:42.2093+00 | 86 | 2026-09-05 18:52:51+00
select count(*) from public.processed_messages where processed_at < now()-interval '7 days';
-- 6
```

The 7-day window is real and is being enforced: on 9 Sep the table's earliest row
was `2026-09-02 06:07`; today it is `2026-09-05 10:25`. Three days passed, the
floor moved three days. `n_tup_del = 377` against `n_tup_ins = 320` on that table
— **more rows have been deleted from `processed_messages` than the stats counter
has recorded inserted.** The deleter is `n8n-workflows/nexus_retention_purge.json`
→ `Prune Dedupe Guard`, `DELETE /rest/v1/processed_messages?processed_at=lt.{{ $now.minus(7,'days') }}`.
CONFIRMED from the repo JSON, as the sibling said.

### 1.2 The invariant, re-run today — the prediction was right and the reason was wrong

P0 §4.1 invariant 1, verbatim body, run as a plain SELECT:

```
8 Sep (P0)   : 6 lost in 4 convos — 158510264357112(6/3), 184984711217354(1/0),
                                    204479249027311(3/2), 210097552777273(1/0)
9 Sep (GAP)  : 5 lost in 3 convos
12 Sep (me)  : 2 lost in 1 convos — 158510264357112@lid (2 claimed / 0 recorded)
```

The sibling predicted the gate goes green around 15 September with nothing
repaired. The decay is confirmed. **But the reading needs correcting in the
dealership's favour and against the system's**: `158510264357112@lid` is still
FAIL, and its numbers are not the old ones — it was 6/3, it is now 2/0. The three
older claims were purged; **two new claims have since been lost on the same
conversation.** So the defect is not a historical residue draining away on a
timer. It is live and reproducing, and the purge is hiding *current* loss, not
just old loss. That is worse than the sibling's framing, not better.

### 1.3 The deletion is itself unlogged

```sql
select distinct workflow from public.audit_log where logged_at > now()-interval '10 days';
-- 18 workflow names returned; NOT ONE of them is the retention purge.
```

`nexus_retention_purge.json` contains a `Log Purge to Audit` node. Production's
`audit_log` holds no row from it in ten days. So the only first-party record that
rows were destroyed does not exist either. **The evidence is deleted and the
deletion leaves no evidence.**

### 1.4 THE GENERALISATION — three self-clearing mechanisms, only one of them a purge

I enumerated every invariant/gate definition in the repo and traced each to its
source tables.

| gate / invariant | source tables | self-clears? |
|---|---|---|
| `nexus_lead_ingest_invariants` (`…leadingest_04…sql`) | `leads`, `lead_event`, `lead_ingest_endpoint`, `lead_provenance_kind`, `lead_source_catalogue` | **no retention purge.** But `leads` shows `n_tup_del = 43` (demo teardown, `ops/demo/teardown_demo_tenant.sql:*`) — deletion happens, it is just not scheduled |
| `nexus_provider_router_invariants` (`…chanroute_07…sql`) | `channel_send_directive`, `channel_provider_capability`/`_rank`, `channel_send_form` | no purge |
| `nexus_message_durability_invariants` (**proposed, never deployed**) | `processed_messages` | **YES — 7-day DELETE.** The known case |
| `nexus_send_durability_invariants` (held migration §9) | `channel_message_events`, `channel_send_directive` | no purge — and the held file revokes `DELETE/TRUNCATE` on `cme` from `service_role`, which is the right instinct |
| CI: `ops/ci/function-grants.mjs`, `migration-hygiene.mjs`, `secret-scan.mjs` | repo files only | n/a |
| **`v_needs_attention`, branch 1** (the dashboard's alert list) | `audit_log` with **`a.logged_at > now() - '24:00:00'`** | **YES — a 24-hour rolling window.** A `FAILURE`/`PARTIAL` run vanishes from the attention list one day later whether or not anyone touched it |
| **`v_needs_attention`, branch `kyc_archive_gap`** | `kyc_documents` with `purged_at IS NULL` **and `created_at > '2026-08-17 16:01:48+00'`** | **YES — a hard-coded floor date.** Any un-archived document created before that instant is invisible to the alert forever. The `purged_at IS NULL` clause is a second latent exit: a row marked purged stops being an archive gap even though `storage_path` is still NULL |
| `v_workflow_health` (compliance + health screens) | `audit_log`, 30-day windows (`runs_30d`, `failures_30d`, …) | **YES — 30-day windows** |

So the answer to "does any *other* gate read from a table subject to a retention
purge" is: **strictly, no — `processed_messages` is the only purged table any gate
reads.** But that is the wrong question, and answering only it would be
reassuring and false. The mechanism that matters is *an alert that clears without
the condition being repaired*, and NEXUS has three of them, two of which are live
on the dashboard today and neither of which involves a purge at all. `audit_log`
is the table that survives the purge, and it is read through a 24-hour window.

One honest limit on the `kyc_archive_gap` exit: `Find Expired Documents` selects
`storage_path=not.is.null`, so the purge as exported cannot set `purged_at` on a
gap row. That specific self-heal is **latent, not live**. The 24-hour and 30-day
windows are live. `kyc_documents` today: 3 rows, 0 purged, 0 with NULL
`storage_path` — no gap currently exists to be silenced.

---

## VERDICT 2 — "six purpose-built messaging tables were never written to" is FALSE

This is the sibling's largest error and it inverts the story.

```sql
select relname, n_live_tup, n_tup_ins, n_tup_del, n_tup_upd, last_autovacuum
  from pg_stat_user_tables where schemaname='public' and relname in (…);
```

| table | live | **n_tup_ins** | n_tup_del | n_tup_upd | last autovacuum |
|---|---|---|---|---|---|
| `channel_message_events` | 0 | **37** | 0 | 0 | never |
| `channel_send_directive` | 0 | **38** | 1 | 0 | never |
| `whatsapp_delivery_events` | 0 | **16** | 0 | 1 | never |
| `whatsapp_customer_message_seen` | 0 | **129** | 3 | 0 | 2026-09-04 13:46 |
| `whatsapp_message_usage` | 0 | **10** | 0 | 5 | never |
| `whatsapp_conversation_state` | 0 | **136** | 2 | 20 | 2026-09-04 13:42 |
| `whatsapp_opt_in_event` | 0 | **175** | 0 | 0 | 2026-09-04 13:54 |

**541 insert attempts across seven tables. 0 live rows. 6 deletes.** The
arithmetic leaves ~535 tuples that were inserted and are not there and were not
deleted — the signature of **transactions that aborted**. `pg_stat` counts
`n_tup_ins` for aborted transactions too; an aborted insert leaves a dead tuple,
which is why three of these tables have been autovacuumed despite never holding a
live row. Autovacuum does not run on a table nothing ever touched.

The sibling's own §4 offers the mechanism without connecting it to this:
`ops/n8n-whatsapp-cloud/receiver.sdk.js:265` sends `'+' + customer_wa_id` into a
column constrained `^[0-9]{6,20}$`. `whatsapp_opt_in_event` at 175 rejected
inserts is not a table nobody wired up.

**This changes the story completely.** "Designed but unexercised, `NOT RUN` not
`PASS`" becomes "**exercised at least 541 times and rejected every single time,
silently, with no operator ever told**". The first is a backlog item. The second
is a live production failure with a three-week history, and it is the strongest
single piece of evidence in either directory that the durability work is
necessary. The sibling ran `count(*)` and stopped.

Stated limit: `pg_stat` counters reset on `pg_stat_reset()` and on a `DROP`+
`CREATE` of the table (new relid). I did not check `stats_reset`. Non-zero
`n_tup_ins` with zero live rows and no deletes is **strong** evidence of aborted
writes, not proof. It is more than enough to refuse the "never written" claim.

Also moved: `communication_logs` is **218 rows, still 0 with
`external_message_id`** (was 142/0), and carries `n_tup_ins = 604, n_tup_del = 508`.
The sibling wrote "`communication_logs` is not purged by that workflow" — true,
and misleading: **508 rows have been deleted from it**, by
`ops/demo/{seed,teardown}_demo_tenant.sql`. Not purged is not the same as not
deleted, and the transcript is the table identity-model wants to build on.

---

## VERDICT 3 — the send call sites: CONFIRMED, and the worse failure named

Re-read from the workflow JSON. 0 of 6 WhatsApp send call sites capture a provider
id (independently confirmed by the database: 0 of 218 rows carry one); 0 of 6
persist an outcome as data; `whatsapp_send_dashboard_reply.json` →
`Send via WAHA` uses `onError: continueErrorOutput` into a terminal `set` node and
writes nothing on failure; the other five use `onError: continueRegularOutput`, so
the error item walks down the same main output the log node hangs off and an
outbound row is written whether or not the send happened.

**Which failure mode is worse for a dealership: logged-and-not-sent.**

Not because it is more frequent — it is 5 of 6 sites rather than 1 — but because
of who is standing there when it fails. Call site 2 is the salesperson pressing
Send in the Conversations screen. It fails *in front of a human*, and
`screens/conversations.js:2949` tells that human the truth: *"Nothing left the
dealership number."* The record is wrong, and the one person who can repair it
knows it is wrong and is holding the phone. Cost: one re-send.

Call sites 1, 3, 4, 5, 6 are unattended — the BDC agent, the drip campaign, the
KYC re-upload loop. They fail with nobody watching and write a row asserting the
customer *was* contacted. Every downstream consumer then reads that row as
contact: the silence detector does not fire, the drip advances to day 3, the
`trg_comm_logs_first_response` trigger sets `leads.response_time_minutes` from a
message that never arrived, and the SLA reports green. The customer is never
answered and the system is certain they were. A false negative costs a re-send; a
**false positive suppresses the retry**, corrupts the response-time metric, and is
undetectable from inside the database — which is precisely why §2.3's table of
unanswerable questions exists. For a business whose stated core problem is the
five-minute rule, a silent "we already replied" is the expensive one.

---

## VERDICT 4 — the held migration `20260909050000_*.sql`

**Never parsed by any Postgres.** No staging apply, no dry run — CONFIRMED, the
file says so itself and staging carries no `channel_message_outcome`.

- **`security_invoker = on` inlined in every CREATE VIEW: CORRECT.** There is
  exactly one `CREATE VIEW` (`v_channel_send_unsettled`, line 761) and it is
  `create view … with (security_invoker = on) as`. `grep -i "alter view"` returns
  nothing. The 42501 trap is avoided, and the file documents why at lines 69-73.
- **`ALTER TABLE`: two targets** — `channel_message_events` and
  `channel_send_directive` (plus three `enable row level security` on tables it
  creates in the same transaction). Both measured to hold nothing for
  `anon`/`authenticated`, so `nexus_guard_born_open_grants` strips nothing live.
  Correct analysis.
- **Grants re-asserted: YES (§10, lines 862-889). Verified afterwards: NO.**
  `grep "has_table_privilege\|relacl\|aclitem"` over the file returns **zero
  matches**. The file re-asserts grants and then asserts nothing about them. This
  is the gap that matters: the whole justification for §10 is "so the file is
  correct even if a grant is added between now and the day it is applied" — and a
  grant added between now and then is exactly the case where a blind re-assert of
  a *stale measured list* silently narrows a privilege someone added in the
  meantime. A closing `DO $$ … raise exception $$` over `has_table_privilege` for
  the four roles × five objects would cost ten lines and turn an assumption into a
  check. **Recommend adding it before this file is applied anywhere.**
  Same shape: §11's seven refusal proofs (a)-(g) are SQL comments. A guard nobody
  has seen go red is a guard nobody has tested — the file's own words, and the
  file does not execute them.
- One f2-shaped defect **inside the test block**: §11(d) passes
  `'shared_header'` as `origin_verified`. The provenance ladder's value is
  `shared_secret_header` (rank 50). If that literal is copied into a writer it is
  a rejected row; in a test it is a test that fails for the wrong reason.

### The relaxation of `channel_message_events_cloud_requires_signature`

Today: `provider <> 'whatsapp_cloud' OR origin_verified = 'hmac_sha256_x_hub'`.
Proposed: `provider <> 'whatsapp_cloud' OR direction <> 'inbound' OR origin_verified = 'hmac_sha256_x_hub'`.

**Does it weaken the provenance ladder? No — it removes a place where the ladder
is currently forced to lie.** The rungs (`hmac_sha256_x_hub` 90 vs
`shared_secret_header` 50) exist to rank *how well we know a message came from
who it claims*. That question is only meaningful **inbound**. On an outbound row
NEXUS is the sender; there is no counterparty signature to rank, and the honest
value is `unverified`. The constraint as written refuses `unverified` on outbound
Cloud rows and accepts `hmac_sha256_x_hub` — i.e. it **refuses the truth and
accepts the lie**, and every outbound Cloud row that ever gets written must
therefore be written at rank 90 falsely. A ladder whose top rung is the only legal
value for a class of rows that cannot climb it is already broken; narrowing the
constraint to `direction = 'inbound'` restores it. Inbound Cloud rows keep the
full rank-90 requirement, unchanged.

**My recommendation: APPROVE the narrowing, with two conditions, and it still
needs the owner's signature — it is not mine to give and it is not the migration
author's.**
1. Narrow to inbound *and* add the complementary constraint the file does not
   have: outbound `whatsapp_cloud` rows must be `origin_verified = 'unverified'`,
   not merely *allowed* to be. Without it the relaxation legalises rank 90 on
   outbound instead of forbidding it, and the lie stays writable.
2. Apply it on staging first and run §11(a)-(g) as statements. Under this file
   `whatsapp_message_usage.event_id` (NOT NULL FK to `channel_message_events`)
   becomes writable for Cloud for the first time — the billing chain comes alive
   on a table that has never held a committed row.

The conditions matter more than usual given Verdict 2: this constraint sits on a
table with 37 aborted inserts and zero successes. Nobody has ever seen a committed
row in it.

---

## VERDICT 5 — identity: the dedup justification is false, and the capture
## justification is now stronger than when it was written

```sql
select count(*), count(distinct regexp_replace(coalesce(phone,''),'[^0-9]','','g')),
       count(distinct right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),9))
  from public.leads;
-- 6 | 6 | 6
```

**CONFIRMED. Inside `leads`: 6 rows (was 5 — lead 126 "Sharri" is new), 6 distinct
normalised phones, 6 distinct tails, 0% collision.** Anyone justifying
Customer→Conversation→Opportunity by "leads double-count people" is wrong on this
data, three days later, with a larger sample. 1 of 6 leads carries a usable email.

The capture numbers, re-run:

| measure | 9 Sep (sibling) | 12 Sep (me) |
|---|---|---|
| `communication_logs` rows | 142 | **218** |
| attach to nothing at all | 83 (58%) | **110 (50%)** |
| distinct keys that are a human with no lead row | 11 | **16** |
| `whatsapp_contacts` rows | 14 | **20** |
| …with `lead_email` NULL | 11 | **16** |
| identity-bearing rows / distinct humans | 19 / 15 | **26 / 22** |
| cross-table duplicate rows | 4 (21%) | **4 (15%)** |
| phones needing a WAHA `:NN` suffix strip | 1 (5.3%) | **3 (11.5%)** |

Read the two trends against each other, because they are the answer:
**the dedup number is flat in absolute terms (4, then 4) and falling as a
proportion. The capture number is growing in both — 11 → 16 uncaptured humans,
+27 unattached messages in three days.** The dedup problem is a fixed historical
residue. The capture problem accrues every day the pilot runs. The
normalisation defect more than doubled.

### Does the sibling's `im_*` design address *capture*, or the dedup problem it disproved?

Staging holds the built model: `im_customer` 24, `im_identity` 37,
`im_conversation` 6, `im_opportunity` 6, `im_identity_review` 3, `im_merge_log` 1,
`im_shared_key` 1, `im_race_result` 4. Read, not touched.

**Judgement: the resolver is built for dedup; capture is handled, but by the one
component that is deferred to a `preview`/`apply` pair a human must run, and the
design explicitly plans to leave most of it unattached.**

Evidence both ways:
- **For capture**: `im_resolve_customer_v3` mints an anonymous customer when
  there is no phone and no email (`CREATED_ANON`, attack 3b) — that is a genuine
  capture mechanism and it is a regression fix against today's `leads`.
  `DESIGN.md:765` stages a `nexus_customer_backfill_preview()` /
  `_apply(p_confirm)` pair over the orphans.
- **Against**: `DESIGN.md:553-556` — *"107 of 142 rows will have no entry on day
  one, and that is the correct state, not a bug."* Recomputed on today's data
  that is **110 of 218**. The `conversation_key` table is keyed
  `PRIMARY KEY (tenant_id, key_value)` on `communication_logs.lead_email`, a
  column the sibling's own P0 documents as *drifting* ("lead_email drifts from
  the chat id to the lead's email the moment a lead row appears"). And the
  shipping order puts backfill in Stage 1 behind a human confirmation while the
  resolver, merge, un-merge, shared-key registry and advisory-lock machinery are
  all first-class.
- The whole `im_shared_key` / strong-vs-weak-key / `AMBIGUOUS_REVIEW` apparatus —
  attacks 2, 2b, 2c, the entire family — exists to stop **over**-merging. On this
  production data, over-merging has happened **zero** times. The design's centre of
  mass is on the 0%-incidence problem.

The model is not wrong; its stated purpose is. If the justification is capture,
the backfill is the product and the resolver is the plumbing, and they are
currently ordered the other way round.

---

## VERDICT 6 — the concurrency race: the v3 fix **narrows**, it does not prevent

`BREAK-LOG.md` attack 7 v1, real `pg_cron` result, confirmed from the file:
`ARM_A_whatsapp` died with **`23505` on `im_identity_unique_exclusive`**, 1.6 ms
apart from the winning arm. **The arrival was lost, not duplicated.** The unique
index converted a duplicate-row problem into a dropped-lead problem. For a
lead-capture product that is the worst available outcome, and the sibling names it
correctly.

v3 takes `pg_advisory_xact_lock` on every key before the read
(`STAGING-MODEL.sql:383-385`). **It narrows the window; it does not close it**, for
three reasons read from that code:

1. **It only serialises writers that share a key.** The lock is
   `hashtextextended(tenant || kind || value_norm)` per key. The measured trial
   used two arms carrying the *same* phone in two formats — they normalise to one
   value and take one lock, so of course they serialised. Two arms arriving on
   **different** keys that belong to the same human (WhatsApp with `wa_lid`, web
   form with `email`) take **disjoint** locks, both miss on their own key, both
   insert, and the second still hits `im_identity_unique_exclusive` → `23505` →
   arrival lost. That is the real-world shape — a human reaching a dealership on
   two channels — and it is the case the trial did not run.
2. **`v_all` is not locked in a deterministic order.** It is built by appending
   email, then `wa_lid`, then `instagram`, then phone in caller-argument order
   (lines 364-369) and locked with `foreach` in that order. Two backends carrying
   the same two keys in different argument order take them in opposite order →
   **deadlock, `40P01`** → also an aborted arm, also a lost arrival. Sorting
   `v_all` before the lock loop is a one-line fix and is not there.
3. **There is no retry.** `im_resolve_customer_v3` has no exception handler; the
   only `exception when others` in the file is in `im_race_arm`, the *test
   harness*, which records the sqlstate and returns cleanly. The production path
   has nothing that catches `23505`/`40P01` and re-reads.

The sibling's own caveat is right as far as it goes ("one trial, two writers, idle
database, throughput NOT MEASURED") but it understates: the untested cases are not
harder versions of the tested one, they are **different** ones. **The fix is
`lock(sorted(keys))` + `exception when unique_violation or deadlock_detected then
re-read and match`.** Until the resolver cannot raise, a dealership still loses
leads — just less often, which is the failure mode hardest to notice.

Incidental, from staging: `im_customer` shows 27 inserts and 24 live rows.
`DESIGN.md:452` says customers are tombstoned via `merged_into`, *"never delete"*.
Three are unaccounted for. Either the harness deleted rows the model says are
undeletable, or three inserts aborted. Neither is in `BREAK-LOG.md`.

---

## VERDICT 7 — un-merge: shipping merge before un-merge is proven is not acceptable

`BREAK-LOG.md` attack 6, by the sibling's own admission: the repair restored
1 customer / 1 conversation / 1 opportunity and **stranded 3 objects including a
finance application, while `im_unmerge_customer` reported 1 orphan.**

What that implies, stated as the reviewer rather than the author:

A merge is a **destructive, operator-triggered, high-confidence-feeling**
operation. Its whole safety case is "if we get it wrong we can undo it." Here the
undo is wrong *and wrong in the direction that hides itself* — it under-reports.
An operator who un-merges reads "1 orphan", handles the one, and walks away from
three, one of which is a finance application: a credit document now attached to
the wrong human inside a tenant. That is not a stale row, it is the cross-person
leak attack 2 was built to prevent, re-entering through the repair path.

And the reporting defect is worse than the stranding defect. Stranded objects that
are *counted* are a work list. Stranded objects the tool says are not there are
invisible, and the count is the only thing an operator sees.

**Merge must not ship until un-merge reports a number that matches reality,
proven by a test that strands objects on purpose and asserts the reported count
equals the real count.** That test does not exist; attack 6 is the closest thing
and it is the test that *found* the discrepancy, not one that asserts it is gone.
"Reversible" is a claim about the un-merge, and the un-merge is measured broken.

---

## CROSS-CONSISTENCY — three contradictions between the two designs

### C1. The 35 FK edges and the composite-FK ask: **the same problem, and one fix does not currently serve both**

`ops/pilot-isolation/ISOLATION-MODEL.md §8`: *"35 foreign keys permit a
cross-tenant reference … unprotected_edges 35 · covered_by_composite_twin 10"*
(H10). identity-model's attack 5b is one instance of exactly that class — an
opportunity linked to *another customer's* conversation — and it is fixed with the
composite-FK shape `lead_event` already uses (`DESIGN.md:1169-1171`, re-attacked →
`23503`). **Same problem.** A composite FK carrying the tenant is the single fix
for both, and the repo already proves the pattern works
(`lead_event.(origin_verified, provenance_counts_as_real) → lead_provenance_kind`).

But identity-model then **declines** it at its most important edge
(`DESIGN.md:513-519`): `lead_customer` refuses a cross-tenant link **with a
trigger, not a composite FK**, because the composite FK needs
`CREATE UNIQUE INDEX ON leads(id, tenant_id)` and that DDL is the *unmeasured*
prediction of its own §2.2. So the new design **adds fresh edges to the very set
pilot-isolation counted 35 of** — protected by a trigger, which a table owner can
`ALTER TABLE … DISABLE TRIGGER` and which does not constrain rows already present.
One fix would serve both, and the blocker is not the fix, it is an unmeasured DDL
prediction. **Measuring that prediction on staging is cheap and unblocks both
directories.** Nobody has run it.

### C2. `communication_logs`: the deferred column and the required link **do** conflict, at the ledger

message-durability §8 deliberately omits `communication_logs.channel_event_id`
until an n8n writer exists — good discipline, and it names the precedent
(`external_message_id`: shipped, zero writers, 0 of 218 rows a month later).
identity-model needs messages to attach to a human and refuses to alter
`communication_logs` at all, using the `conversation_key(tenant_id, key_value)`
side table over `lead_email`.

On `communication_logs` itself the two do not collide — different targets, and
the side table tolerates `lead_email`'s drift because many keys may point at one
conversation. **The collision is one table further along.** message-durability's
stated endgame is that per-message truth lives in `channel_message_events`. I read
that table's columns on production:

```
event_id, tenant_id, integration_id, provider, channel_type, direction,
external_message_id, customer_external_id, customer_phone, conversation_id,
message_kind, media_ref, media_mime, media_sha256, provider_account_id,
provider_delivery_ref, origin_verified, received_at, recorded_at
```

There is **no `lead_email`, no `customer_id`, no lead reference** — and the held
migration adds none. So every message that lands in the ledger the durability plan
is building attaches to **no conversation under identity's design**, because
`conversation_key` is keyed on a `lead_email` shape
(`'email','c.us','lid','whatsapp.lead','s.whatsapp.net'`) that the ledger does not
carry. The recovery key would have to be `customer_phone` — which identity's own
measurement says is the only usable key, but which `conversation_key` is not
keyed on.

**Neither design owns the message→human link, and each assumes the other table
carries it.** A deferred column and a required link are not incompatible; a
deferred column and a required link *on two different tables with no shared key*
are.

Worse, a straight name collision in one schema:
`channel_message_events.conversation_id` is **`text`** — the provider's thread
ref, commented *"WAHA has no conversation concept; Meta … omits it … An honest
absence"* — while identity-model's `conversation.conversation_id` is a **`uuid`
primary key**. Two columns, one name, one schema, different types, different
meanings. That is the `ops/f2-tenant-rule/RECONCILIATION.md` failure mode forming
in advance, and it is trivial to fix now by renaming identity's to
`im_conversation_id` or the ledger's to `provider_conversation_ref`.

### C3. Provenance: **both designs are outside the contract, and one reuses a name the contract deliberately retired**

```
grep -c data_origin  ops/identity-model/DESIGN.md           -> 0
                     ops/identity-model/STAGING-MODEL.sql   -> 0
                     ops/message-durability/DESIGN.md       -> 0
                     ops/message-durability/held/*.sql      -> 0
```

`ops/data-provenance/CONTRACT.md` defines `data_origin` **not null default
`'UNKNOWN'`**, FK → `data_origin_kind(origin)`, with `counts_as_real` / `is_test`
as two booleans.

- **Neither design writes a value a provenance enum would reject**, because
  neither design writes a provenance value at all. Every table both designs
  create — `im_customer`, `im_identity`, `conversation`, `opportunity`,
  `lead_customer`, `conversation_key`, `channel_message_outcome`,
  `channel_message_event_type`, `channel_message_event_outcome` — is born with
  **no provenance column**, and none of them appears in CONTRACT's wave 1/2/3
  scope list. So the answer to "does either leave a provenance column
  unpopulated" is: **worse — they leave the column absent, which is not a state
  the contract's invariants (I1-I4) can even detect.**
- The concrete consequence: lead 121 is `Preflight Walk-In /
  walkin-preflight-01@nexus-preflight.invalid`, which CONTRACT classifies
  `TEST_FIXTURE` (`is_test = true`, `counts_as_real = false`). identity-model's
  Stage 1 backfill resolves **all** leads and `whatsapp_contacts` into
  `im_customer`. Lead 121 becomes a Customer with no origin column and no way to
  mark it test. **The identity backfill launders test data into the customer
  table**, and the customer table is what every future revenue and pipeline number
  will count. Given `ops/f1-test-revenue/`'s existence this is not hypothetical.
- And a direct name contradiction: `im_customer.created_by text NOT NULL CHECK
  (created_by IN ('promoter','backfill','operator','merge'))`
  (`DESIGN.md:453-454`). CONTRACT.md:48 records that it **renamed** its own
  `created_by` to `origin_recorded_by` precisely because `created_by` already
  exists on `tenant_member_invite` as a `uuid` FK to an auth user. identity-model
  reintroduces the retired name as a third type and a third meaning, with a
  table-local `CHECK` instead of an FK to a catalogue — the exact
  vocabulary-invisible-to-consumers shape the held migration's own §11(a) calls
  "THE f2 TEST".

---

## What I did not reach

- I did not verify §2.1's twelve send call sites node-by-node against the n8n box.
  Forbidden, and the repo export is 30 August; every send verdict is *as exported*.
- I did not check `pg_stat_database.stats_reset`, so Verdict 2's 541 inserts are
  strong evidence of aborted writes, not proof.
- I did not run the `im_*` attacks myself, including the two race shapes Verdict 6
  says are untested (disjoint keys; unsorted lock order). Those are the two
  highest-value tests nobody has run.
- I did not read `whatsapp_contacts` push names to judge whether the 16 uncaptured
  humans are customers, suppliers or staff. The sibling flagged this and it is
  still **NOT MEASURED**; the "22 humans" figure must not be quoted as 22 buyers.
- I did not enumerate all 35 FK edges to count how many new ones the two designs
  would add. C1's claim is that they add some, not how many.
- `ops/journey-lab/`, `ops/certification/` and `ops/truth-dashboard/` may define
  further gates. I traced the two deployed invariant functions, the CI scripts and
  the two dashboard views; that enumeration is not proven exhaustive.
