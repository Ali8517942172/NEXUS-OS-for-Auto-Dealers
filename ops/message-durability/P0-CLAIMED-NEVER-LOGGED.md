# Claimed, and then nothing: six inbound WhatsApp messages that exist nowhere

**Measured 8 September 2026 against production `dsvuoovivysszdoiorch`. Read-only
throughout; nothing in this file was written to any database, and no n8n call was
made from here.**

The number is **6**, not 5. The date range is **2026-09-01 10:26:44 UTC to
2026-09-04 06:21:37 UTC**. It has not recurred in the 26 claims since, and the
mechanisms that produced it are both still in the deployed workflow, so "not
recurring" is a fact about the traffic and not about the code.

Three of the six can be partially recovered — the bytes are still in Supabase
Storage. Three cannot be recovered from anything NEXUS holds.

---

## 1. What was measured

### 1.1 The join that does not exist

The obvious query — `processed_messages` LEFT JOIN `communication_logs` on the
message id — cannot be written, and that is the first finding.

```sql
select count(*) from public.communication_logs where channel = 'whatsapp';
-- 137
select count(*) from public.communication_logs
 where channel = 'whatsapp' and external_message_id is not null;
-- 0
```

**0 of 137.** `communication_logs.external_message_id` exists as a column, carries
a CHECK and feeds a unique index, and no writer has ever populated it — the
database half of `ops/n8n-bundle-NOT-DEPLOYED/03-*` is applied and the n8n half is
not. So a claim and the message it admitted share **no key at all**.

That has a consequence worth stating before any number: **"claimed but never
logged" is not expressible as a join today. It can only be counted.** A counting
test can say six were lost; it cannot, on its own, say *which* six. Everything
below that names an individual row does so with corroborating evidence from a
third table, not from the join.

### 1.2 The measurement, and the query that produced it

`processed_messages.chat_id` is a WAHA chat id (`…@lid`).
`communication_logs.lead_email` is the chat id **until** a `leads` row appears for
that person, after which it becomes the lead's email. `whatsapp_contacts` holds
`chat_id → lead_email` and resolves the drift. So the count is per conversation,
with identity resolved through the contacts table:

```sql
with claim as (
  select p.tenant_id, p.chat_id, p.message_id, p.processed_at
    from public.processed_messages p
   where p.source = 'waha'
),
era as (select coalesce(min(processed_at), now()) as t0 from claim),
logged as (
  select c.id, c.tenant_id, c.created_at,
         coalesce(w.chat_id, c.lead_email) as chat_id
    from public.communication_logs c
    left join public.whatsapp_contacts w
           on w.tenant_id = c.tenant_id and w.lead_email = c.lead_email
   where c.channel = 'whatsapp' and c.direction = 'inbound'
     and c.created_at >= (select t0 from era)
)
select coalesce(k.chat_id, g.chat_id)                          as chat,
       count(distinct k.message_id)                            as claims,
       count(distinct g.id)                                    as recorded,
       count(distinct k.message_id) - count(distinct g.id)     as lost
  from claim k
  full outer join logged g
    on g.tenant_id = k.tenant_id and g.chat_id = k.chat_id
 group by 1
having count(distinct k.message_id) <> count(distinct g.id)
 order by 1;
```

Result, whole history:

| chat | claims | recorded | lost |
|---|---|---|---|
| `158510264357112@lid` | 6 | 3 | **3** |
| `184984711217354@lid` | 1 | 0 | **1** |
| `204479249027311@lid` | 3 | 2 | **1** |
| `210097552777273@lid` | 1 | 0 | **1** |
| | | | **6** |

Totals that the table has to reconcile against, all read the same minute:

```sql
select count(*) from public.processed_messages;                    -- 41
select min(processed_at), max(processed_at) from public.processed_messages;
-- 2026-09-01 10:26:44.942502+00 .. 2026-09-08 17:24:34.794258+00
select count(*) from public.communication_logs
 where channel='whatsapp' and direction='inbound'
   and created_at >= '2026-09-01 10:26:44.942502+00';              -- 35
```

41 − 35 = 6. The per-conversation table sums to the same 6, so no loss is hidden
by one conversation over-counting against another.

### 1.3 Why a proximity test says 3, and why that answer is wrong

A "is there any inbound row for this chat within [−5 s, +180 s] of the claim"
test returns **3**, not 6:

```
2026-09-01: 1   210097552777273@lid  false_210097552777273@lid_60CBD6573EA97AE098
2026-09-02: 1   204479249027311@lid  false_204479249027311@lid_3EB0815E1ECB77F0BE3512
2026-09-04: 1   184984711217354@lid  false_184984711217354@lid_C682208B9702FC1068
```

It misses the three losses in `158510264357112@lid` because they happened inside
an eight-second burst in which two *other* messages from the same chat **were**
recorded. A presence test in a shared window answers "was anything logged near
here", not "was this message logged", and those are different questions. This is
the same shape of mistake `ops/n8n-waha-gate/README.md` already records against
itself — a detector built out of "is there a neighbour" goes blind exactly where
the neighbour exists. **The count balance is the measurement; the proximity test
is only useful for pinning a date.**

### 1.4 The correction to 5

`ops/whatsapp-lead-capture/SPEC.md` line 137 says *"Five messages were claimed and
never logged."* Its query was window-bounded:

```sql
... where processed_at >= now() - interval '7 days'
```

Run on 8 September that window opens on 1 September at the same hour, and it
excludes two conversations entirely: `7430662529034@lid` (4 claims, 1 Sep 14:52 →
15:18) and `210097552777273@lid` (1 claim, 1 Sep 10:26:44). Dropping those two
leaves exactly the nine chats and **36** claims that SPEC.md reports, against
**31** inbound rows — so the arithmetic in SPEC.md is right and reproduces
exactly.

**The window hid one row.** `210097552777273@lid` at 2026-09-01 10:26:44.942502
is a real, permanent loss and falls outside a seven-day window run on 8
September. Over the full history the number is **6**. SPEC.md's "five" should be
read as "five in the last seven days as of 8 September", which is true and is not
the number the owner asked for.

### 1.5 The six rows

| # | claimed at (UTC) | chat | `message_id` | cause (§2) |
|---|---|---|---|---|
| 1 | 2026-09-01 10:26:44.942502 | `210097552777273@lid` | `false_210097552777273@lid_60CBD6573EA97AE098` | halted before `Resolve Lead Identity` |
| 2 | 2026-09-02 07:25:18.753678 | `158510264357112@lid` | `false_…_AC5ABE835AE49686556086B9216E1491` | KYC branch |
| 3 | 2026-09-02 07:25:18.753743 | `158510264357112@lid` | `false_…_AC4472F83300A225C2221D89D47FB837` | KYC branch |
| 4 | 2026-09-02 07:25:22.899421 *or* 07:25:24.098321 | `158510264357112@lid` | `false_…_AC1130BD…` *or* `false_…_ACC247C4…` | KYC branch |
| 5 | 2026-09-02 08:09:56.124894 | `204479249027311@lid` | `false_204479249027311@lid_3EB0815E1ECB77F0BE3512` | halted before `Resolve Lead Identity` |
| 6 | 2026-09-04 06:21:37.553793 | `184984711217354@lid` | `false_184984711217354@lid_C682208B9702FC1068` | halted before `Resolve Lead Identity` |

Row 4 is deliberately ambiguous and stays that way. Six claims land in that chat
in eight seconds; three of them produced `kyc_documents` rows and two produced
`communication_logs` rows; **which individual claim maps to which outcome is not
determined by the data**, because no table joins a claim to a message. The
*count* — three lost in that conversation — is exact. Any file that names one of
those two ids specifically is asserting, not measuring.

### 1.6 Is it still happening

**Not observed since 2026-09-04 06:21:37.** 26 claims have been made since, all
of them recorded:

```sql
select count(*) from public.processed_messages
 where processed_at > '2026-09-04 06:21:37.553793+00';   -- 26
```

Running the §4 invariant restricted to `processed_at >= '2026-09-05'` returns
**PASS / 0**. That is a statement about four days of traffic that happened to be
text-only from unmatched senders. Both mechanisms in §2 are still present. Do not
write "fixed".

---

## 2. Root cause

### 2.1 The order of nodes, and which source says so

**The repository's `n8n-workflows/whatsapp_bdc_ai_agent.json` is a 30 August 2026
export and is not the live definition.** It carries neither `WAHA Auth Gate` nor
`Resolve Tenant`, both of which `CLAUDE.md` states are live, and its
`settings.saveDataSuccessExecution` is `"none"` where `CLAUDE.md` records the
published value as `"all"`. It is used below as a **hint about structure only**,
and every claim that rests on it is marked. Where a first-party reading of the
published definition exists — `ops/n8n-waha-gate/prefilter.assignments.md`, read
from published version `5a594564-2e77-4deb-9306-3e544b542284` on 7 September —
that is used instead and said so.

Established from the published definition (`prefilter.assignments.md`):

```
… → Prefilter → Is Real Inbound? → Claim Message Id → Is New Message? → …
```

`Prefilter` is a Set node with `includeOtherFields` **off**, so from that point
the item is exactly four fields — `message_id`, `sender`, `direction`,
`is_real_inbound`. **The customer's words are not among them.** The claim is made
from an item that does not contain the message.

Established from the stale export, and therefore a hint (§2.5 says how to
confirm it):

```
Claim Message Id → Is New Message?(true) → Extract Message & Sender
  → Is Voice Note? → [Download Voice Note → Prepare Voice Upload → Voice Is Usable?
                      → Transcribe Voice (Groq) → Merge Voice Transcript]
  → Fetch All Leads → Resolve Lead Identity
        ├─ Is Document?(true)  → Download KYC Image → Image To Base64 → Send to KYC Auditor
        ├─ Is Document?(false) → Recent Outreach Check → Skip Duplicate Outreach → Log Incoming Message
        ├─ Upsert WhatsApp Contact
        └─ Fetch Thread History
```

**Nine nodes on the shortest path between the claim and the write, fourteen on
the voice path, and one whole branch that never reaches the write at all.**

### 2.2 Every path by which an execution can claim and then not record

| # | path | reachable today | evidence that distinguishes it |
|---|---|---|---|
| 1 | **`Is Document?` TRUE → KYC branch.** Condition is `is_document AND matched_lead`; the TRUE branch terminates at `Send to KYC Auditor` and has **no edge to `Log Incoming Message`**. Structural, deterministic, silent. | **YES** | a `kyc_documents` row (and a `storage.objects` row) at claim + ~9 s, with no `communication_logs` row |
| 2 | **`Extract Message & Sender` returns `[]`.** A Code node returning an empty array halts the branch with no error. Four such returns; the live one is `if (!text && !isImage && !isVoice) return [];` — every media type that is not an image and not audio: stickers, video, non-image documents, location, contacts, reactions, polls. `Prefilter.is_real_inbound` does **not** test for content, so these are claimed first. | **YES** | no `whatsapp_contacts` row and no `communication_logs` row and no `audit_log` row for that chat at that time — nothing downstream of the claim ran |
| 3 | **A node between them throws.** `Extract Message & Sender`, `Resolve Lead Identity`, `Skip Duplicate Outreach` are Code nodes with no `onError`; `Recent Outreach Check` and `Download KYC Image` are HTTP nodes with no `onError` (`Recent Outreach Check` retries first, `Download KYC Image` does not). Any of them failing ends the execution after the claim. | **YES** | an n8n execution with `status='error'` and a `stoppedAt` inside the window (§5.3) |
| 4 | **`Skip Duplicate Outreach` returns `[]`.** By design, and only when `direction==='outbound'` or the message starts `INITIAL_OUTREACH:` — the outreach path, not an inbound customer message. | **no, for inbound** | `processed_messages.source` would be `'outreach'`; measured **0 of 41** are |
| 5 | **`Claim Message Id` inserts, then its response is lost** (10 s timeout). The row commits server-side; `onError: continueRegularOutput` replaces the item with `{error:…}`; `Is New Message?` continues on `error`; `Extract Message & Sender` recovers the payload from `$('WAHA Webhook (POST)')` so it may survive — or may not, depending on what the error item carries. | **YES, latent** | an n8n execution whose `Claim Message Id` node output holds an `error` key |
| 6 | **`Log Incoming Message`'s own `retryOnFail` exhausts.** It has `onError: continueRegularOutput`, so the execution *continues* and the bot still replies — the message is lost while the conversation looks healthy. | **YES** | a bot reply in `communication_logs` with no matching inbound row, plus a `SUCCESS` `audit_log` row |
| 7 | **The execution crashes, is evicted, or times out.** `executionTimeout` 300 s; `CLAUDE.md` records a live `Master Router` timeout on 2 Sep 08:18. Queue mode with concurrency 2 will queue rather than drop, but a worker restart mid-flight loses in-flight work. | **YES** | execution `status` in `('crashed','canceled')`, or an `audit_log` `FAILED` row |
| 8 | **`Is Real Inbound?` filters the item out after the claim.** | **NO** | `prefilter.assignments.md`, read from the published definition, puts `Is Real Inbound?` **before** `Claim Message Id`. Its TRUE branch is the only edge into the claim. This path does not exist. |
| 9 | **The deliberate fail-open** (`onError: continueRegularOutput` + `Is New Message?` on `message_id` OR `error`). | **YES, and it is not a loss path** | it makes the flow continue when it would otherwise stop; it can only *reduce* loss. It is upstream of the loss, not the cause of it. Do not remove it (§3.4). |
| 10 | **A caller reaching the open webhook** and claiming ids for messages that never existed. | **YES** — the door is open (`WAHA_WEBHOOK_ENFORCE` still cannot be armed) | all 41 claims carry `source='waha'` and a real `@lid` chat, across 11 distinct chats, 9 of which have a `whatsapp_contacts` row carrying a plausible UAE or India handset number. No evidence of this, and no way to exclude it while the door is open. |

### 2.3 Which paths the measured rows actually match

**Three rows: path 1, the KYC branch. Mechanically confirmed.**

```sql
select id, chat_id, lead_email, created_at, storage_path, verdict, document_type
  from public.kyc_documents order by created_at;
```

Exactly three rows exist in that table, ever. All three are
`chat_id = '158510264357112@lid'`, all three `lead_email =
'shabbir53ujjainwala@gmail.com'`, created **2026-09-02 07:25:27.815627**,
**07:25:29.211588**, **07:25:32.977583** — 8.9 to 10.5 seconds after the three
unrecorded claims in that same chat between 07:25:18.75 and 07:25:24.10, which is
the right latency for a download plus a vision call.

The condition that gates that branch closes the argument. `Is Document?` requires
`is_document AND matched_lead`, and `matched_lead` is set by `Resolve Lead
Identity` only when a `leads` row matches on the last nine digits of the sender's
number:

```sql
select id, name, email, phone, status from public.leads;
-- 38 | Ali | shabbir53ujjainwala@gmail.com | +918517942172 | WARM
```

`whatsapp_contacts` gives `158510264357112@lid → phone 918517942172 → lead_email
shabbir53ujjainwala@gmail.com`. **Lead 38 is the only lead among the four
affected conversations**, so `158510264357112@lid` is the only one of the four
that could take the KYC branch — and it is the only one of the four with
`kyc_documents` rows. The corroboration runs both ways.

There is a control in the same data: on 2026-09-01 14:52:33 a
`communication_logs` inbound row reads `"[Customer sent a document image]"` for
`7430662529034@lid` — a chat with **no** lead row, therefore `matched_lead =
false`, therefore `Is Document?` false, therefore routed to `Log Incoming
Message` and recorded with the placeholder. **An image from an unmatched sender
is recorded. The same image from a matched lead is not.** That is the branch, and
nothing else in the data produces that asymmetry.

**Three rows: path 2 or path 3, halting before `Resolve Lead Identity`.**

`Upsert WhatsApp Contact` hangs off `Resolve Lead Identity`, so a contact row is
proof the execution got that far.

```sql
select p.chat_id, p.processed_at from public.processed_messages p
 where not exists (select 1 from public.whatsapp_contacts w
                    where w.tenant_id = p.tenant_id and w.chat_id = p.chat_id);
-- 210097552777273@lid  2026-09-01 10:26:44.942502+00
-- 184984711217354@lid  2026-09-04 06:21:37.553793+00
```

Two of the fourteen `whatsapp_contacts` rows are missing for chats that have a
claim. **No execution for either conversation has ever reached `Resolve Lead
Identity`.** `audit_log` has no `WhatsApp BDC Agent` row in either window, and
`communication_logs` has no row of any direction for either chat, ever. Those two
executions claimed and then produced nothing anywhere.

The third, `204479249027311@lid` at 08:09:56.124894, has a contact row — but from
its neighbours' executions (`last_seen 08:12:57.578`, one second after the bot's
reply to the 08:09:46 message). It cannot have taken the KYC branch: that chat
has no lead row, so `matched_lead` is false, and no fourth `kyc_documents` row
exists. Its neighbours at 08:09:14 and 08:09:46 were both recorded and both
produced `SUCCESS` audit rows; this one produced nothing.

**Between path 2 and path 3 for these three, the data does not decide, and the
distinguishing evidence is in n8n, not in Postgres** — path 2 leaves a `success`
execution, path 3 leaves an `error` one. §5.3 gives the query. What can be said
from Postgres alone: all three claimed, and then no downstream node that writes
anything ever ran.

### 2.4 The shape of the defect, stated once

**The claim is written from an item that does not contain the message, and the
message is written nine to fourteen nodes later.** Everything in §2.2 is a way of
falling into that gap. The gap is the defect; the individual nodes are only the
places it happens to open.

And it is one-way. `Claim Message Id` sends
`Prefer: resolution=ignore-duplicates`, so a redelivery of any of those six is
answered by PostgREST with `[]`, `Is New Message?` reads that as "already
processed", and the execution stops. **The claim survives; the message never
existed; and the mechanism that would have given it a second chance is the same
one that guarantees it will not get one.**

### 2.5 What would have to be read to make §2.1's graph first-party

`n8n-workflows/whatsapp_bdc_ai_agent.json` is 30 August. The live edge list is in
the published definition of workflow `BiyHk9ZXxJUVGbf6`. Someone with box access
should fetch it and confirm three things specifically:

1. `Is Document?`'s TRUE branch still has no path to `Log Incoming Message`.
2. `Extract Message & Sender` still contains `if (!text && !isImage && !isVoice) return [];`.
3. `Recent Outreach Check` and `Download KYC Image` still carry no `onError`.

Until that is done, §2.2 rows 1, 2 and 3 are **structurally inferred from a stale
export and corroborated by production data**, which is a weaker claim than
"read from the box" and is deliberately not written as one. Rows 8 and 9 rest on
`prefilter.assignments.md` and are first-party.

---

## 3. Where the durability boundary belongs

The owner's separate instruction is that `channel_message_events` becomes the
canonical per-message record. That is the **shape** question and another agent
owns it. This section answers only: **does the claim happen before or after the
durable write.**

### 3.1 The answer

**After. And the strongest form of "after" is that they are the same write.**

### 3.2 The argument from failure modes

Three orderings, and what each does with the same fault.

**(a) Claim, then write — today.**

| fault | outcome |
|---|---|
| anything between the two fails, throws, filters, or branches away | the message is lost **permanently and silently**, because the claim suppresses every redelivery. Measured: 6. |
| the write fails after retries | lost, and the execution continues and replies, so the conversation looks healthy |
| the claim fails | fail-open: processed unclaimed. Risk is a duplicate, not a loss |

Every fault in the window is a permanent loss. The window is nine to fourteen
nodes wide and includes a model call, two HTTP fetches and a branch that
deliberately never reaches the write.

**(b) Write, then claim.**

| fault | outcome |
|---|---|
| the write fails | the claim is never reached; the message is unclaimed; a redelivery is processed normally. **No loss.** |
| the write succeeds, the claim fails | fail-open continues; a redelivery re-runs the flow; the write is idempotent under `(tenant_id, direction, external_message_id)` so it is a no-op. Cost: a possible second reply. **No loss.** |
| anything after both fails | the message is already durable. The *processing* is lost, not the message. That is recoverable by a human reading the conversation. |

**(c) One transaction — the write returns the dedupe answer.**

There is no window at all. `INSERT … ON CONFLICT DO NOTHING RETURNING` on the
canonical table gives exactly the signal `Prefer: resolution=ignore-duplicates`
gives today — a row back means new, nothing back means duplicate — except that
the row it wrote **carries the message**, not just the fact that a message
happened. `channel_message_events` already has the unique constraint this needs:
`channel_message_events_tenant_direction_extmsg_key UNIQUE (tenant_id, direction,
external_message_id)`.

(c) dominates (b), which dominates (a). The whole of §2.2 is a list of things
that stop existing under (c).

### 3.3 The one thing (c) requires that the shape agent must decide

`channel_message_events` states in its own migration comment that it holds no
body column and "there never will be one". So "durable" cannot mean only that
table. The requirement this note places on the shape is:

> **The event row and the customer's words must be written in the same
> transaction, and the new-or-duplicate answer must come out of that
> transaction.** Whether the words go to `communication_logs` with
> `external_message_id` populated, or somewhere new, is the shape agent's call.
> Two separate HTTP POSTs from two n8n nodes is not one transaction and does not
> satisfy this.

The practical form is a single `service_role` function — the
`nexus_record_channel_event(…)` family already exists — that takes the id, the
routing identity and the text, writes both rows, and returns `(event_id,
is_new)`. n8n calls it once. `Is New Message?` branches on `is_new`.

### 3.4 Does this preserve the trade the repo already made

The repo's recorded judgement, in `ops/n8n-waha-gate/README.md` and
`prefilter.assignments.md`: *losing a real customer's message is worse than
processing one twice*, which is why the fail-open on `error` exists.

**(c) preserves it and makes it cheaper.** Under (c), a database outage means the
write fails, so no claim exists, so a redelivery is processed — which is exactly
what the fail-open was protecting. The n8n node should keep `onError:
continueRegularOutput` so the reply path still runs and the customer is not left
in silence; the difference is that continuing no longer carries a permanent claim
behind it. The fail-open stops being a trade against loss and becomes only a
trade against a duplicate reply.

**And the cost of the duplicate is already paid for.** The known duplicate-row
defect (`CLAUDE.md`: ten of 83 inbound rows are retry duplicates, ~12%) is caused
by the same missing `external_message_id`; the unique index
`communication_logs_external_identity_key` exists and is inert waiting for the
writer. The writer change that fixes this note's defect is the same writer change
that makes duplicates impossible. One change, both.

### 3.5 What not to do

- **Do not remove the fail-open on `error`.** §3.4.
- **Do not move `Claim Message Id` later while leaving it a separate node.**
  That narrows the window; it does not close it, and a narrowed window is harder
  to reason about than a wide one.
- **Do not delete claims to "re-open" a message.** §5.2.
- **Do not mint an id when the payload has none.** Already settled on 7 September
  and for the right reason: an invented id is a lie that lets the same message be
  processed twice.

---

## 4. The invariant, as something a machine checks

Called **`public.nexus_message_durability_invariants()`**, in the style of
`public.nexus_lead_ingest_invariants()`: `returns table (invariant text, status
text, detail text)`, `language sql`, `stable`, `set search_path = public`,
`security invoker`, revoked from `public`/`anon`/`authenticated` and granted to
`service_role` only.

The migration is **not written here**, per instruction. When it is written it
should be called something like
`supabase/migrations/<ts>_msgdur_01_claimed_never_logged_invariants.sql`.

### 4.1 The SQL

```sql
create or replace function public.nexus_message_durability_invariants()
returns table (invariant text, status text, detail text)
language sql
stable
security invoker
set search_path = public
as $$
  with claim as (
    select p.tenant_id, p.chat_id, p.message_id, p.processed_at
      from public.processed_messages p
     where p.source = 'waha'
  ),
  era as (select coalesce(min(processed_at), now()) as t0 from claim),
  logged as (
    -- lead_email drifts from the chat id to the lead's email the moment a lead
    -- row appears, so identity is resolved through whatsapp_contacts. This join
    -- exists ONLY because communication_logs.external_message_id is unpopulated;
    -- when a writer sends it, replace this whole CTE with a join on the id and
    -- delete invariant 2.
    select c.id, c.tenant_id, c.created_at,
           coalesce(w.chat_id, c.lead_email) as chat_id
      from public.communication_logs c
      left join public.whatsapp_contacts w
             on w.tenant_id = c.tenant_id and w.lead_email = c.lead_email
     where c.channel = 'whatsapp' and c.direction = 'inbound'
       and c.created_at >= (select t0 from era)
  ),
  balance as (
    select coalesce(k.tenant_id, g.tenant_id) as tenant_id,
           coalesce(k.chat_id,  g.chat_id)    as chat_id,
           count(distinct k.message_id)       as claims,
           count(distinct g.id)               as recorded
      from claim k
      full outer join logged g
        on g.tenant_id = k.tenant_id and g.chat_id = k.chat_id
     group by 1,2
  ),
  lost as (select * from balance where claims > recorded)
  select 'Every claimed inbound message has a durable message record',
         case when coalesce(sum(claims - recorded),0) = 0 then 'PASS' else 'FAIL' end,
         coalesce(sum(claims - recorded),0)::text
         || ' claimed message(s) with no record, in ' || count(*)::text
         || ' conversation(s): '
         || coalesce(string_agg(chat_id || ' (' || claims || ' claimed / '
                                || recorded || ' recorded)', ', ' order by chat_id), '(none)')
    from lost
  union all
  -- Invariant 2 is why invariant 1 has to count instead of join. It is not a
  -- side note: while it is FAIL, invariant 1 can say how many were lost and
  -- cannot say which.
  select 'A claim can be joined to its record by identity, not by counting',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' of '
         || (select count(*) from public.communication_logs where channel = 'whatsapp')::text
         || ' whatsapp communication_logs row(s) carry no external_message_id'
    from public.communication_logs
   where channel = 'whatsapp' and external_message_id is null
  union all
  select 'Every claim is mirrored in the canonical per-message ledger',
         case when (select count(*) from public.processed_messages where source = 'waha')
                 = (select count(*) from public.channel_message_events where direction = 'inbound')
              then 'PASS' else 'FAIL' end,
         (select count(*) from public.processed_messages where source = 'waha')::text
         || ' claim(s) against '
         || (select count(*) from public.channel_message_events where direction = 'inbound')::text
         || ' inbound channel_message_events row(s)'
  union all
  -- The signature of an execution that claimed and then died before anything
  -- downstream wrote: Upsert WhatsApp Contact hangs off Resolve Lead Identity,
  -- so no contact row means the pipeline never reached it.
  select 'No claim exists for a conversation the pipeline never reached',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' claim(s) whose chat has no whatsapp_contacts row: '
         || coalesce(string_agg(distinct p.chat_id, ', '), '(none)')
    from public.processed_messages p
   where p.source = 'waha'
     and not exists (select 1 from public.whatsapp_contacts w
                      where w.tenant_id = p.tenant_id and w.chat_id = p.chat_id)
  union all
  -- The one that alarms in minutes rather than at audit time.
  select 'No claim made in the last 24 hours is still without a record after 15 minutes',
         case when coalesce(sum(claims - recorded),0) = 0 then 'PASS' else 'FAIL' end,
         coalesce(sum(claims - recorded),0)::text || ' outstanding claim(s) in the last 24 hours'
    from (
      select count(distinct k.message_id) as claims, count(distinct g.id) as recorded
        from claim k
        left join logged g
          on g.tenant_id = k.tenant_id and g.chat_id = k.chat_id
         and g.created_at >= k.processed_at - interval '5 second'
       where k.processed_at between now() - interval '24 hour' and now() - interval '15 minute'
       group by k.tenant_id, k.chat_id
    ) recent
  union all
  select 'No claim carries an id minted per delivery attempt',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' claim(s) whose message_id would not survive a redelivery'
    from public.processed_messages
   where message_id ~* '^(nokey:|outreach:|exec-|run-|job-)' or message_id ~ '^[0-9]+$'
  union all
  select 'Loss by day', 'INFO',
         coalesce((select string_agg(d || ': ' || n, ', ' order by d)
                     from (select k.processed_at::date::text as d, count(*)::text as n
                             from claim k
                            where not exists (
                              select 1 from logged g
                               where g.tenant_id = k.tenant_id and g.chat_id = k.chat_id
                                 and g.created_at between k.processed_at - interval '5 second'
                                                      and k.processed_at + interval '180 second')
                            group by 1) x), '(none)')
         || '  -- proximity test; undercounts a loss sharing a window with a recorded message';
$$;

revoke all on function public.nexus_message_durability_invariants()
  from public, anon, authenticated;
grant execute on function public.nexus_message_durability_invariants() to service_role;
```

### 4.2 It is red right now

The body above, run as a plain `select` against production `dsvuoovivysszdoiorch`
on 8 September 2026:

```
Every claimed inbound message has a durable message record        FAIL
  6 claimed message(s) with no record, in 4 conversation(s):
  158510264357112@lid (6 claimed / 3 recorded), 184984711217354@lid (1 claimed / 0 recorded),
  204479249027311@lid (3 claimed / 2 recorded), 210097552777273@lid (1 claimed / 0 recorded)

A claim can be joined to its record by identity, not by counting  FAIL
  137 of 137 whatsapp communication_logs row(s) carry no external_message_id

Every claim is mirrored in the canonical per-message ledger       FAIL
  41 claim(s) against 0 inbound channel_message_events row(s)

No claim exists for a conversation the pipeline never reached     FAIL
  2 claim(s) whose chat has no whatsapp_contacts row:
  184984711217354@lid, 210097552777273@lid

No claim made in the last 24 hours is still without a record …    PASS   0 outstanding
No claim carries an id minted per delivery attempt                PASS   0
Loss by day                                                       INFO   2026-09-01: 1, 2026-09-02: 1, 2026-09-04: 1
```

### 4.3 How it is made to fail on purpose

This repository has found two gates that could not go red, so this is stated
rather than assumed.

**1. Four of the seven rows are FAIL on production today, unforced.** A gate
whose first run is red on real data is not a gate that has never fired. The
strongest available proof is already in §4.2.

**2. Both branches are proven reachable in the same function, on the same data,
without any write.** Rows 5 and 6 return PASS while rows 1–4 return FAIL, so the
`case` expressions are demonstrably not stuck.

**3. Invariant 1 specifically, both ways, read-only.** Run the identical body
with `claim` restricted to `processed_at >= '2026-09-05'`:

```
PASS   0 claimed message(s) with no record
```

and unrestricted:

```
FAIL   6 claimed message(s) with no record
```

Same expression, same tables, opposite answers according to which rows are in
scope. **Executed on production 8 September 2026; both results above are
measured, not predicted.**

**4. The forced-red procedure, for after the six are repaired.** Not executed —
this session is read-only and this is a write:

```sql
begin;
insert into public.processed_messages (message_id, source, chat_id, processed_at, tenant_id)
values ('false_999999999999999@lid_DELIBERATEREDTEST01', 'waha', '999999999999999@lid',
        now(), (select id from public.tenants where slug = '__unattributed__'));
select * from public.nexus_message_durability_invariants();
-- expect: invariant 1 FAIL with 1, invariant 4 FAIL naming 999999999999999@lid
rollback;
```

The quarantine tenant is used deliberately so that a `commit` typed by accident
files the row where nothing reads it. Run inside a transaction and roll back.

**5. What would make invariant 1 go quietly green while messages are still being
lost, and the guard against it.** If a future change made `Log Incoming Message`
write *more* rows than there were claims — a retry duplicate, say — the balance
`claims > recorded` would be satisfied per conversation even with a real loss
inside it. That is not hypothetical: `CLAUDE.md` measures ~12% retry duplicates
today. **The guard is invariant 2.** While `external_message_id` is unpopulated
the counting test is the best available and its blind spot must be stated;
**once a writer populates it, invariant 1 must be rewritten as a join and
invariant 2 deleted.** A counting invariant left in place after the join becomes
possible is decoration.

### 4.4 On staging

`wwspuxrbiyagnrnzgate` holds `processed_messages` = 0, `channel_message_events` =
0, `communication_logs` = 37. Invariants 1, 4, 5 and 6 return **PASS vacuously**
there. A vacuous PASS is not evidence, and staging must not be used to
demonstrate this gate.

---

## 5. Recovery

### 5.1 What is gone

**Three of the six are unrecoverable from anything NEXUS holds**, and no future
work recovers them:

- `210097552777273@lid`, 2026-09-01 10:26:44.942502
- `204479249027311@lid`, 2026-09-02 08:09:56.124894
- `184984711217354@lid`, 2026-09-04 06:21:37.553793

Checked and empty for all three: `communication_logs` (any direction, any time,
for those chats), `channel_message_events` (0 rows in the table),
`whatsapp_customer_message_seen` (0 rows), `kyc_documents` (3 rows, all a
different chat), `audit_log` (no `WhatsApp BDC Agent` row in any of the three
windows), `storage.objects` (only the three `kyc-documents` files below). The
words were never written to a NEXUS table by any node.

### 5.2 Releasing the claim does not help, and would cost something

Deleting the six `processed_messages` rows would let a redelivery through. **No
redelivery is coming.** WAHA retries a webhook within its own short retry policy,
not days later; four to seven days have passed. Releasing a claim only matters
for a message that is *about* to be redelivered.

What it would break, if done anyway: `processed_messages` is the honest count of
arrivals — SPEC.md §5.5 relies on that, and it is the only table that records
these six ever existed at all. Deleting them destroys the only surviving evidence
of the defect and makes §4.2 go green for the wrong reason. **Do not delete
them.** If they must be marked, mark them somewhere else.

### 5.3 What n8n may still hold, and the exact query

n8n saved execution data is the only place the message bodies could still be, and
this session cannot reach the box. **State the retention first, because it is a
deadline, not a detail:**

| compose file | `EXECUTIONS_DATA_MAX_AGE` | oldest surviving execution on 8 Sep |
|---|---|---|
| `docker-compose.yml` | `168` h (7 days) | ~2026-09-01 |
| `docker-compose.single.yml` | `72` h (3 days) | ~2026-09-05 |

`docs/J1-RUN-CHECKLIST.md` drives the `single` file; `CLAUDE.md` records
`executionMode: queue`, which only `docker-compose.yml` can produce. **The
repository does not settle which file the box runs**, and the two answers are
"three of the six may still be there" and "all six are already pruned". `docker
compose ps` on the VM settles it.

`CLAUDE.md` records the live workflow's `saveDataSuccessExecution` as `"all"`, so
if an execution survives pruning, its saved data contains the webhook item and
therefore `body.payload.body` — the text. Run on the box:

```bash
docker compose exec -T n8n-db psql -U n8n -d n8n -v ON_ERROR_STOP=1 -c "
  select e.id, e.\"startedAt\", e.\"stoppedAt\", e.status, e.mode,
         position('60CBD6573EA97AE098' in ed.data) > 0 as m1,
         position('3EB0815E1ECB77F0BE3512' in ed.data) > 0 as m2,
         position('C682208B9702FC1068'  in ed.data) > 0 as m3
    from execution_entity e
    join execution_data ed on ed.\"executionId\" = e.id
   where ed.data like '%60CBD6573EA97AE098%'
      or ed.data like '%3EB0815E1ECB77F0BE3512%'
      or ed.data like '%C682208B9702FC1068%'
   order by e.\"startedAt\";"
```

Then, for any row that comes back, dump that one execution's data and read
`body.payload.body`, `body.payload.hasMedia`, `body.payload.media.mimetype` and
`body.payload._data.Message`:

```bash
docker compose exec -T n8n-db psql -U n8n -d n8n -At -c \
  "select data from execution_data where \"executionId\" = <ID>;" > /tmp/exec-<ID>.json
```

**That query also settles §2.3's open question.** `e.status` on those executions
distinguishes path 2 (`success` — a Code node returned `[]` and nothing errored)
from path 3 (`error`/`crashed` — a node threw). Nothing in Postgres can tell them
apart; this can.

**Do not assert either way before running it.** This note does not claim the
executions are gone and does not claim they are there.

### 5.4 Three of the six ARE partially recoverable, today, from NEXUS

This contradicts a blanket "unrecoverable" and is the reason the blanket
statement is not made.

```sql
select id, bucket_id, name, created_at,
       metadata->>'size' as bytes, metadata->>'mimetype' as mime
  from storage.objects where name like 'kyc/2026/09/%' order by created_at;
```

| object | created (UTC) | bytes | mime |
|---|---|---|---|
| `kyc/2026/09/mtjruh0k-nqqlefyw5b.jpg` | 2026-09-02 07:25:27.324861 | 117 647 | image/jpeg |
| `kyc/2026/09/mtjruibs-cinc2fvwj6.jpg` | 2026-09-02 07:25:28.774414 | 108 221 | image/jpeg |
| `kyc/2026/09/mtjrukyw-94u9kzpthi.jpg` | 2026-09-02 07:25:32.582917 | 223 485 | image/jpeg |

Bucket `kyc-documents`, `purged_at` null, `retain_until` 2033-09-02 on all three
`kyc_documents` rows. **The three lost messages in `158510264357112@lid` were
images, and the image bytes still exist.** What is lost is that they were ever
*messages* — no `communication_logs` row, no caption, no place in the thread. The
conversation as a salesperson would read it still has a hole; the content does
not.

Recovery is a data repair, not a code change: for each of the three, insert a
`communication_logs` row keyed on the lead, timestamped from
`storage.objects.created_at`, with the message text set to a placeholder naming
the storage path. **It is a write and this session did not make it.** It should
not be made until `external_message_id` is populated by the writer, or the three
repair rows become three more rows that nothing can join.

### 5.5 The instruction that comes out of §5.3, in one line

**Run the n8n query in §5.3 today.** Under the `single` compose file the window
has already closed; under the other it closes for the 2 September pair within
about a day and for the 4 September row on about 11 September. Every day this
waits, "unrecoverable" becomes true for reasons that had nothing to do with the
original defect.

---

## 6. Blast radius

Stated exactly, and deliberately not inflated.

| | |
|---|---|
| messages lost | **6** |
| conversations affected | **4** |
| dealerships affected | **1** — Tenant A, `fff6a2b5-cfd5-4460-8383-875bc5826de0`; the only tenant with traffic |
| period | **2026-09-01 10:26:44 UTC → 2026-09-04 06:21:37 UTC**, 2 days 20 hours |
| claims in that period | 15 of 41 lifetime. 6 of those 15 lost |
| loss rate, whole history | **6 of 41 = 14.6%** |
| loss rate, in the affected period | **6 of 15 = 40%** |
| claims since | 26, none lost |
| of the 6, in the CRM as a lead | **1 conversation** — lead 38, `shabbir53ujjainwala@gmail.com`, status WARM, phone +918517942172, which accounts for 3 of the 6 |
| of the 6, a dealership vehicle enquiry | **0 that can be shown to be one.** The three whose content survives are photographs of a kitchen-materials quotation; the bot replied *"Sorry, we specialise in premium cars and can't help with kitchen designs"*. The other three have no surviving content and their nature is unknown |
| lead 122 — the one real external-origin production lead — affected | **no.** `150345548320909@lid`: 9 claims, 9 recorded, 0 lost |

**What a dealership would have experienced.** In the two conversations that lost
their only message, a person sent something to the dealership's WhatsApp number
and it produced nothing at all: no row in the CRM, no line in the conversation
thread, no alert, no reply. To the salesperson the conversation does not exist.
To the customer, the dealership ignored them. In the two conversations that lost
a message mid-thread, the thread reads as continuous and a message is simply
missing from the middle of it — the harder failure, because nothing looks wrong.

**The honest limit on the severity.** The WAHA session runs on Ali's personal
handset, so this traffic is his own contacts rather than a dealership's inbound
enquiries, and none of the six can be shown to be a vehicle enquiry. **That
limits what was lost. It does not limit the defect.** The pipeline is identical
for a real customer, the branch that swallowed three of them fires precisely
because the sender *is* a matched lead, and the day a dealership's number is on
the other end the same six-in-forty-one becomes six real enquiries.

---

## Unknowns

- **Which of the three losses in `158510264357112@lid` maps to which claimed
  `message_id`.** The count is exact; the mapping is not determinable, because no
  table joins a claim to a message. Six claims, three KYC rows, two logged rows,
  eight seconds.
- **Whether the three non-KYC losses are path 2 (`Extract Message & Sender`
  returned `[]`) or path 3 (a node threw).** Postgres cannot distinguish them.
  The n8n execution `status` can, and the query is in §5.3 and has not been run.
- **What those three messages were.** No content survives anywhere in NEXUS. If
  the executions survive pruning, `body.payload` says.
- **Whether n8n's saved executions still hold them.** Depends on which compose
  file the box runs — 72 h or 168 h retention — which this repository does not
  settle. Not asserted either way.
- **Whether the live workflow still has the edge list in §2.1.** Read from a 30
  August export, corroborated by production data, not read from the box. The
  three specific things to confirm are in §2.5.
- **Whether path 6** — `Log Incoming Message` exhausting `retryOnFail` while the
  execution continues and replies — **has ever fired.** It would look like a bot
  reply with no inbound row and a `SUCCESS` audit row. Not searched for here; it
  would need the same 1:1 mapping that §1.1 says does not exist.
- **Whether any of the 41 claims came from a caller other than WAHA.** The
  webhook is still open. Nothing in the data suggests it; nothing excludes it.
- **Whether losses occurred before 2026-09-01 10:26:44.** `processed_messages`
  has no row older than that and `communication_logs` starts 2026-08-25. A claim
  that was never written leaves no trace, so the pre-1-September period cannot be
  measured at all — it is not "zero", it is "unmeasurable".
- **What `whatsapp_contacts.message_count` was meant to be.** 0 on all 14 rows.
  If it were incremented it would be a second independent check on this
  invariant. Already flagged in SPEC.md §5.5; unchanged.

## What only Ali can do

1. **Run the n8n execution query in §5.3, today.** Box access only. It is the
   only way to recover the content of three of the six and the only way to close
   the path-2-versus-path-3 unknown, and the retention window is closing — under
   the `single` compose file it may already have closed.
2. **Settle which compose file the box runs** — `docker compose ps` — because it
   decides both the retention deadline above and the `n8n-worker` question that
   is separately blocking the WAHA secret rollout.
3. **Fetch the published definition of workflow `BiyHk9ZXxJUVGbf6`** and confirm
   the three points in §2.5, so §2.1's graph stops being an inference from a
   stale export.
4. **Decide whether the three recovered images are repaired into
   `communication_logs`** (§5.4). It is a production write and a judgement about
   whether a reconstructed row is better or worse than a visible hole.
5. **Authorise the writer change.** The fix is one n8n change — the claim and the
   durable write become one call — and it is the same change that populates
   `external_message_id`, retires the ~12% duplicate-row defect, and turns
   invariant 1 from a count into a join. It cannot be deployed from this
   repository.

---

# Addendum — 9 September 2026: the evidence is on a seven-day timer, and the outbound half

**Measured 9 September 2026 against production `dsvuoovivysszdoiorch`. Read-only
throughout; nothing was written to any database, and no n8n API call was made.
Nothing above is retracted. Two things are added, and the first changes how this
document should be read.**

Full measurement: `ops/message-durability/GAP-MEASURED.md`.
Design: `ops/message-durability/DESIGN.md`.
Held migration: `ops/message-durability/held/20260909050000_a_send_that_left_no_row_is_a_send_that_never_happened.sql`.

## A1. Six is now five, and nothing was fixed

§4.2 above ran invariant 1 on 8 September and got *"6 claimed message(s) with no
record, in 4 conversation(s)"*. The same body, run today:

```
5 | 3 | 158510264357112@lid (6/3), 184984711217354@lid (1/0), 204479249027311@lid (3/2)
```

`210097552777273@lid` — the `2026-09-01 10:26:44.942502+00` claim — is gone.

```sql
select min(processed_at)::text, max(processed_at)::text, count(*),
       (now() - interval '7 days')::text
  from processed_messages;
-- 2026-09-02 06:07:09.584087+00 | 2026-09-08 17:24:34.794258+00 | 36 | 2026-09-02 03:43:18+00
```

`processed_messages` was 41 when §2.2 was written and is **36** now. The deleter
is first-party and in this repository — `n8n-workflows/nexus_retention_purge.json`,
node **`Prune Dedupe Guard`**:

```
DELETE /rest/v1/processed_messages?processed_at=lt.{{ $now.minus(7,'days') }}
```

**So invariant 1 goes green on its own.** `184984711217354@lid` (2026-09-04
06:21:37) is deleted on 11 September; the three `158510264357112@lid` claims and
the `204479249027311@lid` one went on 9 September's run or go on the 10th. By
roughly 15 September the gate reads PASS with nothing repaired.

That is not a new defect — it is this document's defect seen from the other side.
The only durable trace that a message was *seen* has a seven-day TTL, and the
table that survives carries no message id to join it to (still 0 of 142). **A
gate that self-heals by forgetting is worse than one that stays red**, and
§4.3's discipline — a gate must be made to fail on purpose — needs a companion:
a gate must also be checked for whether it can go green on its own.

Consequences for the text above, none of which require a correction to it:

- §5 (Recovery) is now harder, not easier. §5.3's n8n query is the only route to
  three of the six and the claim rows that name them are being deleted while the
  execution history ages out separately.
- §1.6 (*"has not recurred in the 26 claims since"*) still stands. A crude
  per-`chat_id` recount today appears to show a surplus on
  `150345548320909@lid` (9 claims, 5 inbound rows under that key). **It is not a
  loss.** That conversation writes `communication_logs` rows under *two* keys —
  `150345548320909@lid` on 7 Sep and `+971556382721@whatsapp.lead` on 7–8 Sep,
  the same person — because `whatsapp_contacts` gained a `lead_email` for it
  mid-conversation. Counting per key is invalid for exactly the reason §1.1
  gives, and §4.1's `logged` CTE resolves identity through `whatsapp_contacts`
  precisely to avoid this. **Use §4.1's body, not a per-key count.**
- **`P0 §4.1`'s invariant should gain a check that this table is not being
  purged**, or the loss counter will keep resetting. Naming it here rather than
  editing §4.1, which is quoted elsewhere.

## A2. The same defect on the outbound side, and it is wider

§3 answers where the durability boundary belongs for **inbound**. The outbound
side was not measured above. It is measured now, and both halves of the failure
are live at once.

Every send call site in the repository, enumerated by parsing all
`n8n-workflows/*.json` — the WhatsApp six match
`ops/whatsapp-cloud/WAHA-EXIT-PLAN.md §1b`, found by a different method:

| | |
|---|---|
| WhatsApp send call sites | 6, all WAHA. No Cloud send node exists |
| ...capturing the provider's message id | **0** — confirmed by the database: 0 of 142 rows carry one |
| ...persisting a send outcome as data | **0**. Two KYC nodes persist it as English inside the message body |
| ...persisting nothing at all when the send fails | **1**: `whatsapp_send_dashboard_reply` → `Send via WAHA` has `onError: continueErrorOutput`, and output 1 goes to `Respond Send Failed`, a terminal `set` node. Its own text: *"Nothing was sent and nothing was logged — the message is still unsent."* **That is the salesperson's own reply from the Conversations screen** |
| ...writing an outbound "we said this" row **even when the send failed** | **5**: `onError: continueRegularOutput` routes the error item down the same main output the `Log …` node hangs off |
| Python send call sites | 0 |

So the two failure modes are opposites and both are deployed:
**sent-and-not-logged** (call site 2) and **logged-and-not-sent** (the other
five). §2.4's sentence — *the claim is written from an item that does not
contain the message* — has an outbound twin: **the log is written from an item
that does not contain the provider's answer.**

The dashboard is honest about it in the browser and nowhere else.
`screens/conversations.js` renders *"whether the message left cannot be told
from here. Check WhatsApp before sending again."* Nothing persists that
sentence, so tomorrow the question is unanswerable.

## A3. Three ledgers exist for this, two have never held a row

- `channel_message_events` — **0 rows**, and `external_message_id` is `NOT NULL`
  plus provider-id-shaped, so **a rejected send is a row it structurally refuses**.
  It also has **no append-only trigger**, while its sibling
  `whatsapp_delivery_events` does, and `service_role` holds `UPDATE, DELETE,
  TRUNCATE` on it. Given A1, that is not a theoretical concern.
- `channel_send_directive` — **0 rows**, and it already holds the send-outcome
  vocabulary, in a CHECK where nothing else can see it:
  `PENDING | ACCEPTED_BY_PROVIDER | REJECTED_BY_PROVIDER | NOT_ATTEMPTED | TRANSPORT_ERROR`.
- `communication_logs` — 142 rows, no status column, no provider id, no error
  column.

The held migration extends `channel_message_events` into the append-only log,
writes the attempt **before** the provider call (§3's argument, applied
outbound), and moves those five strings into a catalogue table with foreign keys
so an unknown value is `23503` at INSERT rather than a row nobody's filter
matches. It is **not** applied and has one unresolved cross-owner dependency;
its header says which.

## A4. What only Ali can do — two additions to the list above

6. **Decide whether `Prune Dedupe Guard` should be deleting `processed_messages`
   at all.** It is a dedupe cache with a seven-day TTL that is currently the only
   record of a message being seen. Under the design in `DESIGN.md` the claim
   moves into an append-only table and the purge becomes harmless; until then it
   is deleting the evidence of an open P0. One n8n change, and not mine to make.
7. **Confirm on the box that no live workflow calls `nexus_record_channel_event`
   with `p_direction='outbound'`.** Under the held migration such a call becomes
   `23503` rather than a bad row — loud and correct, and still a behaviour
   change. The exported workflows contain no such call; the box was not read.
