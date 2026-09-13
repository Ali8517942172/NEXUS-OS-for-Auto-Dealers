# BREAK-LOG — attacking the Customer / Conversation / Opportunity model

Everything here ran against **staging `wwspuxrbiyagnrnzgate`** on 9 September 2026.
Nothing ran against production. Every object is prefixed `im_`.

Owner's constraint honoured: *"Customer → Conversation → Opportunity ko abhi code
mat karwao."* No repo code was changed, no migration was written, no production
object was touched. This is a staging model built to be broken.

Three generations of the resolver exist on staging, on purpose, so the failures
are reproducible rather than described:

| function | what it is |
|---|---|
| `im_resolve_customer_v1` | deliberately naive: read-then-write, no locking, phone treated as an exclusive key |
| `im_resolve_customer_v1_racewindow` | v1 with a configurable pause between read and write, so the TOCTOU window is observable rather than a matter of microsecond luck |
| `im_resolve_customer_v2` | first repair attempt — advisory locks, strong/weak keys, `is_shared` flag |
| `im_resolve_customer_v3` | second repair — same, but "shared" lives in a tenant-scoped registry table |

**Score: 11 attacks run. v1 failed 6 of them. v2 fixed 4 and introduced 1 new
failure of its own. v3 fixes that one and still loses on 2 that are not fixable
by design — they are priced instead.**

---

## Attack 0 — the staging DDL guard (run first, because it shapes everything)

```sql
create view public.im_v_customer_360 as select ... from public.im_customer c;
```

**Real result — FAILED, as designed:**
```
ERROR: 42501: NEXUS SECURITY GATE: view(s) public.im_v_customer_360 in schema public lack security_invoker
CONTEXT: PL/pgSQL function public.nexus_require_security_invoker_views() line 38 at RAISE
```

Re-run with `with (security_invoker = on)` inline: succeeded. `pg_class.reloptions`
= `{security_invoker=on}`. Confirmed again after a later `CREATE OR REPLACE VIEW` —
the option must be restated on every replace, exactly as the guard's HINT says.

**Verdict: guard works. Both `im_v_customer_360` and `im_v_conversation_thread`
carry `security_invoker=on`.**

---

## Attack 1 — one human, three phone formats

```sql
select * from im_resolve_customer_v1(<tenant>,'+971526647253',…);  -- CREATED 340efd85…
select * from im_resolve_customer_v1(<tenant>,'0526647253',…);     -- MATCHED 340efd85…
select * from im_resolve_customer_v1(<tenant>,'971526647253',…);   -- MATCHED 340efd85…
```

**Result: PASSED for the three formats in the brief.** One customer, three arrivals.

Then the same attack with the shapes a real dealership actually types:

```sql
select * from im_resolve_customer_v1(<tenant>,'ph: 052 664 7253 ext 4',…);
-- customer_id NULL, verdict REFUSED_NO_IDENTIFIER
```

**BROKEN.** Root cause found by direct test of the normaliser:

| input | v1 returned | truth |
|---|---|---|
| `ph: 052 664 7253` | **NULL** | +971526647253 |
| `Tel: +971526647253` | **NULL** | +971526647253 |
| `052 664 7253 ext 4` | **`+9715266472534`** | +971526647253 |
| `+971 52 664 7253 / 04 555 1234` | **NULL** | +971526647253 |
| `971556456535:77` | +971556456535 | +971556456535 |

Three failure modes, one of them silent:

1. `split_part(raw, ':', 1)` — added to strip the WAHA `:77` device suffix that
   production really contains — **destroys any number preceded by a label**.
   `"ph:"` and `"Tel:"` become the whole string. The fix for a real production
   defect created a worse one.
2. `ext 4` is silently absorbed into the number, producing
   `+9715266472534` — a plausible-looking number that belongs to nobody. This is
   **worse than NULL**: NULL refuses, this one creates a *second customer* for a
   human already in the book, with a phone that will never match again.
3. Two numbers in one field exceed 15 digits and return NULL.

**Verdict v1: FAILED.** Not on the three formats in the brief — on the fourth,
fifth and sixth formats that a receptionist types.

**Fix (`im_normalize_phone_v3`):** strip `:NN` only when it *directly follows* 8–15
digits; strip `ext/x/#` tails; truncate at `/ , ;` or " or " and flag the arrival
`TRUNCATED_MULTI`; only then strip separators. Re-tested on 13 inputs — all 13
correct, including `(052) 664-7253` and `00971526647253`.

**v3 re-run of the attack:** four arrivals (`+971521110000`, `0521110000`,
`971521110000`, `Tel: (052) 111-0000 ext 3`) → **one customer
`cb09b357-8959-4c09-84f5-829d9bdc8edd`, verdicts CREATED / MATCHED / MATCHED /
MATCHED. PASSED.**

---

## Attack 2 — two different humans on one phone (family / switchboard)

```sql
select * from im_resolve_customer_v1(<tenant>,'+97142221111','rashid.almansoori@example.ae',…);
-- CREATED 11917b4c-1dc8-4ca1-baec-fd5001fb2603
select * from im_resolve_customer_v1(<tenant>,'+97142221111','maryam.almansoori@example.ae',…);
-- MATCHED 11917b4c-1dc8-4ca1-baec-fd5001fb2603     <-- two humans, one row
```

**BROKEN, and this is the worst failure in the log.** Maryam was absorbed into
Rashid's customer record. Her email address became one of *his* identities.

### Blast radius — measured, not imagined

Two conversations and two opportunities were then created as they would be in
life, and the customer card read:

```sql
select display_name, identity_count, conversation_count, open_opportunities, identities
from im_v_customer_360 where customer_id='11917b4c-…';
```
```
display_name        | Rashid Al Mansoori
identity_count      | 3
conversation_count  | 2
open_opportunities  | 2
identities          | email:maryam.almansoori@example.ae,
                      email:rashid.almansoori@example.ae,
                      phone:+97142221111
```

**Yes: customer A sees customer B's history.** One card labelled with Rashid's
name carries Maryam's email address, Maryam's email thread, and an opportunity
recorded as *"Maryam: private purchase, do not tell husband"*. Any rep opening
Rashid's 360 reads it. Any automation that mails "your enquiries" to the
customer's address sends Maryam's private purchase to whichever address it picks
first.

RLS does not help here and cannot: **NEXUS RLS is tenant-scoped, and both humans
are in the same tenant.** There is no person-scope in the system. The leak is
inside the blast radius of a single dealership, which is exactly where a family
lives.

### Attack 2b — the dealership's own landline

Four unrelated walk-ins, all logged with the showroom number `+97143334444`:

```
A2b.1 CREATED 1fcc619f-…   A2b.2 MATCHED 1fcc619f-…
A2b.3 MATCHED 1fcc619f-…   A2b.4 MATCHED 1fcc619f-…
```
```
display_name   | Walk-in 1
identity_count | 5
identities     | email:walkin1@…, email:walkin2@…, email:walkin3@…, email:walkin4@…,
                 phone:+97143334444
```

**Four humans collapsed into one.** Note what the model failed to notice: each
arrival brought a *brand-new, never-seen email address*. Four distinct strong
identifiers is overwhelming evidence these are four people, and v1 read it as
zero evidence, because a phone match short-circuits everything.

**Verdict v1: FAILED. High severity — a data-protection failure, not a data-quality one.**

**Fix (v2/v3):** split keys into **strong** (email, WhatsApp LID, Instagram handle —
account-bound, one human) and **weak** (phone — shareable). If an arrival matches
only on the weak key, and the matched customer already holds a strong key of the
same kind that the arrival contradicts, **do not fuse**: declare the number
shared, create a separate customer, and file a review row.

**v3 re-run** (`+97166667777`, three humans, then both return):

| arrival | verdict | customer |
|---|---|---|
| Rashid3 + `r3@example.ae` | CREATED | `50682166-…` |
| Maryam3 + `m3@example.ae` | **CREATED_SPLIT_SHARED_PHONE** | `0420a92c-…` |
| Sara3 + `s3@example.ae` | CREATED | `f636d3da-…` |
| Rashid3 returns | **MATCHED `50682166-…`** | correct |
| Maryam3 returns | **MATCHED `0420a92c-…`** | correct |

Three humans, three records, each returning to their own. **PASSED.** A
`SHARED_PHONE_SPLIT` review row was filed for a human to confirm.

---

## Attack 2c — the failure v2 introduced by itself

This one is worth more than the others, because the *repair* broke a case v1 got right.

v2 modelled "shared" as a boolean **on the identity row**. Sequence run:

| arrival | v2 verdict |
|---|---|
| Rashid2 + `rashid2@…` on `+97144445555` | CREATED |
| Maryam2 + `maryam2@…` on same number | CREATED_SPLIT_SHARED_PHONE ✅ |
| Sara2 + `sara2@…` on same number | CREATED |
| **Rashid2 returns with his own email** | **`AMBIGUOUS_REVIEW` — "matched 2 customers"** |

**A known customer, arriving with an email the system has seen before, was
refused entry.** State dump:

```sql
select i.kind, i.value_norm, i.is_shared, c.display_name from im_identity i join im_customer c using(customer_id) …
```
```
phone | +97144445555 | is_shared=true  | Rashid2
phone | +97144445555 | is_shared=true  | Maryam2
phone | +97144445555 | is_shared=false | Sara2    <-- here
```

Root cause: "shared" is a fact about **the number for the tenant**, but v2 stored
it **per identity row**. Sara2's arrival found no *non-shared* match, so it took
the create branch, and the create branch happily inserted a fresh, non-shared copy
of the very number that had already been declared shared. From then on the number
resolved to Sara2, and Rashid2's email + phone matched two customers at once.

**Verdict v2: FAILED — a regression the naive v1 did not have.**

**Fix (v3):** a `im_shared_key (tenant_id, kind, value_norm)` registry. Once a key
is declared shared it is shared for every writer, forever, and can never resolve
anybody. Re-run above: PASSED.

### The price of that fix, measured

```sql
select 'anon call '||g, r.* from generate_series(1,3) g,
lateral im_resolve_customer_v3(<tenant>,'+97166667777',null,null,null,'Unknown caller '||g) r;
-- CREATED ed24eea5-…   CREATED be579644-…   CREATED 50b66a8d-…
```

**Three inbound calls on the shared line = three throwaway customers.** A number
in the shared registry stops being an identifier at all, so an arrival carrying
*only* that number can never be recognised. On a busy company switchboard this is
one junk customer per call, forever. **This is not fixed. It is priced.** The
mitigation is a human working the `im_identity_review` queue, and that queue is
work the dealership does not do today.

---

## Attack 3 — a human with no phone and no email

```sql
select * from im_resolve_customer_v1(<tenant>,null,null,null,'@dxb_car_guy','dxb_car_guy');
-- CREATED 19e6d274-…
select * from im_resolve_customer_v1(<tenant>,null,null,null,'@DXB_Car_Guy',…);
-- MATCHED 19e6d274-…      (case-insensitive, correct)
```
**PASSED** — an Instagram handle is a perfectly good identity and the model treats
it as one.

```sql
select * from im_resolve_customer_v1(<tenant>,null,null,null,null,'Man in a grey Kandura');
-- customer_id NULL, verdict REFUSED_NO_IDENTIFIER
```

**BROKEN, and it is a regression against production.** A human walked onto the
forecourt and the model refuses to record them. Production `leads` handles this
today: row 121 is `Preflight Walk-In` with the minted address
`walkin-preflight-01@nexus-preflight.invalid`. The new model is *stricter than
the thing it replaces*, in the direction of losing a customer.

**Fix (v2/v3):** `p_allow_anon` mints an `anon` identity holding a fresh UUID, so
the customer exists and can be linked to later. Re-run: two anonymous walk-ins →
`CREATED_ANON eefe6131-…` and `CREATED_ANON 0d930c80-…`, two distinct rows,
**PASSED**. The honest cost: two anon customers can never be merged automatically,
because a UUID matches nothing. They wait for a human.

---

## Attack 4 — two open opportunities for one customer at once

Trade-in and new purchase, both open, both on the same WhatsApp conversation.

**No constraint objected.** `im_v_customer_360.open_opportunities = 2`. Nothing in
the schema assumes one opportunity per customer or per conversation.

But the model is not therefore sound. The query a message-attribution job would run:

```sql
select v.external_thread_key, count(*) candidate_opportunities, string_agg(…)
from im_conversation v join im_conversation_opportunity co … join im_opportunity o …
where v.external_thread_key='wa-fatima-1' group by 1;
```
```
wa-fatima-1 | 2 | trade_in (2019 Corolla trade-in) | new_purchase (2026 Patrol)
```

**Verdict: PASSED structurally, UNDECIDABLE operationally.** An inbound WhatsApp
message on that thread belongs to one of two open opportunities and the model
carries no tiebreaker. Revenue attribution therefore has to either pick (wrong
half the time) or split (double-count — the exact defect the model was built to
remove). **This is not solved. It needs a rule the owner has not yet given**, and
until it exists, per-opportunity attribution on a multi-intent conversation is
**NOT MEASURED and should not be reported as a number.**

---

## Attack 5 — an opportunity that must move between conversations mid-life

Fatima's Patrol purchase moves from the WhatsApp thread to an email finance thread:

```sql
update im_conversation_opportunity set unlinked_at = now() where opportunity_id = <patrol>;
insert into im_conversation_opportunity (conversation_id, opportunity_id, …)
values (<mail-fatima-finance>, <patrol>, …);
-- returned: 63a42633-… | 34c34c20-…
```
**PASSED.** The many-to-many link table with `unlinked_at` moves the opportunity
and keeps the historical link. This is why the join table exists instead of a
`conversation_id` column on `im_opportunity`.

### Attack 5b — link an opportunity to *another customer's* conversation

```sql
insert into im_conversation_opportunity (conversation_id, opportunity_id, tenant_id)
select v.conversation_id, o.opportunity_id, …
from im_conversation v, im_opportunity o
where v.external_thread_key='thread-rashid-tradein' and o.vehicle_interest='2019 Corolla trade-in';
-- INSERT 1 row.  Accepted.
```

**BROKEN.** Fatima's trade-in was attached to Rashid's email thread. Nothing
checked that the conversation and the opportunity belong to the same human.
Revenue would be credited to the wrong customer and Rashid's thread view would
render Fatima's opportunity.

**Fix:** the composite-FK trick `lead_event` already uses —
`unique (conversation_id, customer_id)`, `unique (opportunity_id, customer_id)`,
`customer_id` carried on the link row, two composite foreign keys. Attack re-run:

```
ERROR: 23503: insert or update on table "im_conversation_opportunity"
violates foreign key constraint "im_co_opp_same_customer"
DETAIL: Key (opportunity_id, customer_id)=(0c4e20f1-…, 11917b4c-…) is not present in table "im_opportunity".
```
**PASSED after fix.**

---

## Attack 6 — a merge that later proves wrong

Two humans on one office line, wrongly fused by hand:

```sql
select im_merge_customers(<Khalid>, <Noura>, 'shared office landline - assumed same person');
-- merge_id 99f139e5-7299-4189-9fb8-d13ff2a54300
```

Three weeks of life then land on the fused record: a new phone identity, a new
WhatsApp conversation, a new finance opportunity. Card reads
`Khalid | identities 3 | conversations 2 | open opportunities 2`.

Then the merge is reversed:

```sql
select * from im_unmerge_customer('99f139e5-…');
-- restored_identities 1 | restored_conversations 1 | restored_opportunities 1 | orphaned_since_merge 1
```

Post-state:

```
Khalid | active | identity_count 2 | conversations 1 | open opps 1 | email:khalid@…, phone:+971501234567
Noura  | active | identity_count 1 | conversations 1 | open opps 1 | email:noura@…
```

**Verdict: reversible in structure, LOSSY in meaning — a partial failure.**
Noura got back exactly what the merge log recorded. But the objects created
*during* the merged period cannot be assigned to either human:

```sql
with m as (select * from im_merge_log where merge_id='99f139e5-…')
select (select count(*) from im_identity i, m where i.customer_id=m.winner_id and i.created_at>m.merged_at),
       (select count(*) from im_conversation v, m where v.customer_id=m.winner_id and v.opened_at>m.merged_at),
       (select count(*) from im_opportunity o, m where o.customer_id=m.winner_id and o.opened_at>m.merged_at);
-- identities_stranded 1 | conversations_stranded 1 | opportunities_stranded 1
```

**Three objects stranded, including a finance application.** Un-merge restores the
past. It cannot restore the middle. Longer the wrong merge lives, more is
stranded — the loss grows with time-to-detection, not with data volume.

A second defect found in the same attack: **my own `im_unmerge_customer` reported
`orphaned_since_merge = 1` when the true figure was 3** — it counted stranded
identities only, not conversations or opportunities. An un-merge tool that
under-reports its own damage is worse than one that refuses to run. Recorded, not
yet fixed.

A third, found in passing: after the merge, `im_v_customer_360` still listed
Noura as a row with zeros in every column. The directory showed a ghost. Fixed by
adding `where c.status = 'active'` to the view (restated
`with (security_invoker = on)` on the replace, per Attack 0).

---

## Attack 7 — concurrency: two channels create the same customer in the same second

The harness runs tool calls sequentially, so two parallel MCP calls are **not** a
race — measured attempts were 3.4 s and 5.0 s apart with the sleep-barrier trick,
and the second arm always read after the first had committed. Recorded here so
nobody repeats it: **that method cannot produce a race and any "PASS" from it is
meaningless.**

Real concurrency was obtained with `pg_cron`, which starts all jobs due on a tick
in separate background workers.

### v1 — the naive resolver

```sql
select cron.schedule('im_race_a','51 3 9 9 *', $$select im_race_arm('ARM_A_whatsapp','+971502221111',…,3)$$);
select cron.schedule('im_race_b','51 3 9 9 *', $$select im_race_arm('ARM_B_webform','0502221111',…,3)$$);
```

**Real result:**

| arm | fired_at | pid | customer_id | verdict | sqlstate | errmsg |
|---|---|---|---|---|---|---|
| ARM_A_whatsapp | 03:51:00.207145+00 | 584531 | NULL | NULL | **23505** | duplicate key value violates unique constraint "im_identity_unique_exclusive" |
| ARM_B_webform | 03:51:00.208752+00 | 584530 | dfb22675-… | CREATED | — | — |

Two separate backends, **1.6 milliseconds apart**. **BROKEN.**

Read the failure precisely, because the obvious reading is wrong. The unique
index did its job — there is no duplicate customer. What it produced instead is
**a dropped arrival**: the WhatsApp message errored out and no customer, no
conversation and no reply exists for it. In n8n that is a red node and a customer
who is never answered. **The unique index converted a duplicate-row problem into a
lost-lead problem, which for a dealership is the more expensive one.**

### v3 — advisory transaction locks taken on every key *before* the read

| arm | fired_at | pid | customer_id | verdict | sqlstate |
|---|---|---|---|---|---|
| ARM_A_whatsapp [v3] | 03:58:00.088864+00 | 585151 | 03288584-ba29-49e2-b3d6-0480abfce2c8 | CREATED | — |
| ARM_B_webform [v3] | 03:58:00.091100+00 | 585152 | **03288584-ba29-49e2-b3d6-0480abfce2c8** | MATCHED | — |

Two backends, **2.2 milliseconds apart**, both resolved to the **same** customer.
No error, no duplicate, no dropped arrival. **PASSED.**

Caveat, stated because it is not measured: this was one trial at one concurrency
level on an idle staging database. **Throughput under lock contention, and
behaviour at more than two simultaneous writers, are NOT MEASURED.**

---

## Summary

| # | attack | v1 | v3 | severity if shipped as v1 |
|---|---|---|---|---|
| 0 | view without `security_invoker` | guard blocks (42501) | — | — |
| 1 | three phone formats | PASS | PASS | — |
| 1b | labelled / ext / multi-number phone | **FAIL** (NULL, and one silent corruption) | PASS | high — silent duplicate humans |
| 2 | two humans on one phone | **FAIL** — fused, A sees B's history | PASS | **critical — cross-person data leak inside a tenant** |
| 2b | switchboard, four humans | **FAIL** — all four fused | PASS | critical |
| 2c | known customer returns after a split | v2 regression: **FAIL** | PASS (registry) | high — known customer refused |
| 3 | Instagram handle only | PASS | PASS | — |
| 3b | no phone, no email at all | **FAIL** — refused | PASS (anon mint) | high — regression vs today's `leads` |
| 4 | two open opportunities | PASS structurally | PASS structurally | **attribution undecidable — unsolved** |
| 5 | opportunity moves conversation | PASS | PASS | — |
| 5b | opportunity linked to another customer's conversation | **FAIL** — accepted | PASS (composite FK, 23503) | high — misattributed revenue |
| 6 | wrong merge, then un-merge | partial — reversible but 3 objects stranded | same | medium, grows with time-to-detection |
| 7 | two channels, same second | **FAIL** — 23505, arrival lost | PASS | high — silently dropped lead |

**Not fixed, priced instead:**
- a shared number stops identifying anybody, so anonymous calls on a company line
  mint one junk customer each (measured: 3 calls → 3 customers);
- anon-minted walk-ins can never be auto-merged;
- an inbound message on a conversation with two open opportunities cannot be
  attributed without a rule the owner has not given;
- `im_unmerge_customer` under-reports its own stranded objects (1 reported, 3 real).
