# Human handover: stopping the bot from talking over a sales rep

Offline design. Nothing live was touched. Read against
`/home/claude/audit/` as exported on 30 Aug 2026.

Apply in this order: `migration.sql` → `OPERATIONS_send.json` →
`OPERATIONS_bdc.json`. `conversations.patch.md` is display-only and can go
whenever. Every intermediate state is safe — see §7.

---

## 0. The failure, exactly

Two independent facts combine into one bad outcome.

**Fact one — the send path throws away the sender.**
`whatsapp_send_dashboard_reply.json` → `Prepare Send` (node id
`ed9bd121-…`) already computes

```
sent_by = {{ $('Verify JWT').first().json.email || 'dashboard' }}
```

and `Log Outbound` then writes
`{lead_email: chat_id, channel:'whatsapp', direction:'outbound', message}` —
four fields, none of them `sent_by`. The value is computed, carried through two
nodes, and dropped. `communication_logs` is
`(id, lead_email, channel, direction, message, created_at)`; there is no column
that could have held it anyway.

**Fact two — the bot never looks at what was already said.**
`whatsapp_bdc_ai_agent.json` → `Reply Eligibility` computes `bot_may_reply` from
exactly three things: `matched_lead === true`, `direction === 'outbound'`, or a
hit in a 74-word dealership keyword list. It reads `Resolve Lead Identity` and
nothing else. `Recent Outreach Check` does read `communication_logs`, but it is
wired to suppress a *duplicate INITIAL_OUTREACH* (`Skip Duplicate Outreach`
returns early unless `direction === 'outbound'` or the message starts with
`INITIAL_OUTREACH:`), so it never fires on an inbound customer message.

**The outcome.** A rep types "I can do 78,000 final" into the dashboard and
sends. The customer replies "ok". The webhook fires, `Resolve Lead Identity`
matches the number to a lead, `Reply Eligibility` sees `matched_lead = true`,
`Should The Bot Reply?` passes, the negotiation agent runs — and it has its own
guardrails ("open 3–5% below your ceiling", "never confirm a floor"), so it
produces a *different* number and sends it on the same WhatsApp line seconds
after the rep's. The customer sees the dealership contradict itself
mid-negotiation, from one phone number, and now knows there is room below 78,000.

Note what the bot does see: `Fetch Thread History` pulls the last 12 messages
into the agent's prompt, so the rep's "78,000 final" may well be *in the
prompt*. It doesn't help. The prompt frames every outbound row as "You:" — the
agent reads the rep's offer as its own previous message and feels free to move
off it. Seeing the message is not the same as knowing a person is holding the
thread.

---

## 1. Part 1 — the database

One additive, nullable column. Full reasoning is in `migration.sql`; the
decisions in brief:

| Decision | Choice | Why |
|---|---|---|
| Column | `sent_by text` on `communication_logs` | The identity of whoever produced an outbound message. |
| Default | **none** | `default 'bot'` would be metadata-only on PG11+ (no rewrite), so the objection is honesty, not cost. Four of the five writers of this table are automated, but the fifth is the dashboard: stamping historical rows `'bot'` would assert something we do not know. |
| Historical rows | left `NULL`, not backfilled | `NULL` = "written before 30 Aug 2026, sender not recorded". Nothing will ever read them: the suppression rule looks at a 30-minute / 12-hour window and every `NULL` row is older than the moment the column shipped. |
| `NULL` semantics | **not human** | Non-negotiable. Until `OPERATIONS_bdc.json` lands, the bot's own `Log Conversation` writes `NULL`. If `NULL` counted as human the bot would read its own last reply as a colleague's and mute itself for 30 minutes after every message it sent. The filter `sent_by=not.in.(bot,…)` excludes `NULL` naturally, because `NULL NOT IN (…)` is `NULL`. |
| Index | **none added** | `idx_comm_logs_lead_email` already exists and already carries the selective predicate — it reduces the table to one person, and the largest thread in this system is 66 messages (`conversations.js` header, 24 Aug). The remaining three predicates filter 66 rows. A composite index would tax every insert on the hot path (the BDC agent inserts twice per inbound message) and buy nothing. The partial index to add *if* the table passes ~1M rows is written out, commented, in `migration.sql` §2. |
| CHECK constraint | **none** | Every writer logs with `onError: continueRegularOutput`. A future workflow writing an unforeseen token would get a 400, the node would swallow it, and the customer's message would be delivered with no row in the history — silent data loss, worse than an untidy column. Vocabulary lives in `COMMENT ON COLUMN`. |
| RLS / grants | nothing to change, but verify | `security/fix_rls.sql` gives `authenticated` a *table-level* SELECT, which covers columns added later. A column-level grant would not. Query (b) in `migration.sql` §5 checks it. n8n uses `service_role` and bypasses RLS entirely. |

**The vocabulary.** Reserved automation tokens: `bot`, `drip`, `kyc`, `system`,
`router`, `outreach`, `silence`. Anything else is a person. In practice a person
is the lowercased email of the Supabase user whose JWT authorised the send, or
the literal `dashboard` when that user has no email (phone-auth accounts).

This is a *closed set for machines, open set for people*, and the direction is
deliberate: an unrecognised token is read as human, which makes the bot go
quiet. Conservative. The opposite arrangement — a closed set for humans — would
make an unrecognised token read as a machine, and the bot would talk over
whoever it was.

---

## 2. Part 2 — the workflows

### 2a. `WhatsApp Send (Dashboard Reply)` — persist the sender

One real change. `Log Outbound` → `/jsonBody` gains

```
sent_by: String($('Prepare Send').first().json.sent_by || 'dashboard').trim().toLowerCase()
```

`Prepare Send` already has the value. It is derived from `Verify JWT`
(`/auth/v1/user`), and `Auth OK?` has already rejected the request unless that
call returned an `id`, so by the time `Prepare Send` runs the identity is
verified server-side. Lowercasing makes `Ali@X.com` and `ali@x.com` one rep.

A second op re-asserts `Log Outbound`'s settings
(`onError: continueRegularOutput`, `alwaysOutputData`, `retryOnFail`, 3 tries)
at their current values, so the logging step stays soft: a failed log must never
turn a delivered WhatsApp message into a reported failure. `Delivery Report`
already reports it as a non-critical dropped claim.

**The frontend is not part of this.** See §5 and `conversations.patch.md` — the
sender must not come from the browser.

### 2b. `WhatsApp BDC AI Agent` — go quiet for a human

Two new nodes, spliced into the one chain that leads to the agent.

```
… Skip Duplicate Outreach → Log Incoming Message
                                 │
                                 ▼
                        Human Reply Check        (httpRequest, [1120,112])
                                 │
                                 ▼
                      Human Spoke Recently?      (code,        [1360,112])
                                 │
                                 ▼
                         Reply Eligibility → Should The Bot Reply? → Model Ladder → AI BDC Sales Agent
```

`Human Reply Check` asks one question of `communication_logs`: *has a person
sent an outbound message to this customer in the last 24 hours?*

```
select     created_at,sent_by,message,lead_email
or         <the canonical key set — see part 3>
direction  eq.outbound
sent_by    not.in.(bot,drip,kyc,system,router,outreach,silence)
created_at gte.<now − 24h>
order      created_at.desc
limit      1
```

`limit=1` is not an optimisation, it is a correctness requirement. An n8n HTTP
node splits a JSON array response into **one item per row**, and this node sits
in the main chain, so two rows would run every node after it — including the AI
agent and the WAHA send — twice. `Fetch Thread History` avoids this by sitting
on a parallel branch that feeds nothing (its own `notes` say so); `Recent
Outreach Check` avoids it with `limit=1` followed by a Code node that collapses
to one item. This follows the second, proven pattern.

`Human Spoke Recently?` collapses 0 or 1 row (or an error item) into exactly one
item, and owns both time windows and the handover text. It reads its context
from `$('Resolve Lead Identity')`, **not** from `$input`, because its input is an
HTTP node and an HTTP node's output replaces the item. This is the same trap
already documented on `Model Ladder`: `Log Incoming Message` is an insert with
`Prefer: return=minimal`, returns an empty body, and the agent failed with "No
prompt specified" on every tier until it started reaching back.

Three more parameter edits:

- `Log Conversation` → `sent_by: 'bot'`.
- `Log Incoming Message` → `sent_by: ($json.direction === 'outbound' ? 'bot' : null)`.
  Inbound rows stay `NULL`; `direction` already says the customer sent it.
- `Fetch Thread History` → the same widened key set, `select` gains `sent_by`,
  `limit` 12 → 30. See part 3 for why this node changes too.

And two behavioural edits:

- `Reply Eligibility` → `bot_may_reply` gains **one** new way to be false, in
  front of everything else: `if (human_mode === 'silent') return false;`. The
  74-word keyword allowlist and the `matched_lead` / `direction` rules are
  preserved byte-for-byte, comments included. `reply_reason` gains the
  explanation, so an execution shows *why* the bot said nothing.
- `AI BDC Sales Agent` → `/text` prepends the handover note (when there is one)
  immediately before `Customer says now:`, so it is the last instruction the
  model reads. The thread-history block and the whole system message are
  untouched.

---

## 3. The quiet window — the decision, and the argument

**Chosen: a two-stage window. Hard silence for 30 minutes, then supervised
replies out to 12 hours, then normal.**

```
   rep sends ──┬──────────────── 30 min ────────────────┬──────── 12 h ────────┬────────▶
               │        STAGE 1: SILENT                 │  STAGE 2: SUPERVISED │  NORMAL
               │  bot does not reply at all             │  bot replies         │  bot replies
               │                                        │  instantly, told a   │  as it does
               │                                        │  colleague is here   │  today
```

### Why not a single window

A single window has to be both things at once and cannot be. The problem
statement names the two constraints and they pull in opposite directions: long
enough not to interrupt a negotiation, short enough that a customer who writes
the next morning gets an instant answer. Pick 30 minutes and a rep who steps
away after a 6pm exchange leaves the bot free to renegotiate at 6:31pm. Pick 12
hours of silence and the system's whole premise — the 5-minute rule, an instant
answer around the clock — is gone for any thread a rep has ever touched, which
over time is the valuable half of the inbox. Every single-window value is
someone's disaster.

Splitting the window makes the two constraints stop competing, because they are
answers to *different* questions. "Is a person actively typing right now?" is a
question about minutes. "Has a person been involved in this deal at all
recently?" is a question about hours. The first should stop the bot dead. The
second should change what the bot is allowed to say.

### Stage 1 — 30 minutes of hard silence

A WhatsApp haggle runs at roughly a minute per turn. The observed failure —
"I can do 78,000 final" / "ok" / bot quotes its own number — happens inside a
single turn. Five minutes would cover that specific exchange and nothing else:
a rep who takes a phone call, walks a customer to a car, or checks stock with
the finance desk is gone for longer than five minutes and comes back to find the
bot has renegotiated their deal. Thirty minutes covers a realistic interruption.

Thirty minutes is also the point where the cost of silence starts to be real
rather than theoretical, and this is the honest limit of the argument: for up to
thirty minutes, a customer can send a message and get nothing back. That is
acceptable here for one specific reason — the *only* way to be in stage 1 is
that a human from the dealership messaged this customer in the last half hour.
The customer is not unattended. They are, by construction, in a live
conversation with a person who has the thread open. The bot standing back is
what a second salesman would do.

Beyond thirty minutes that stops being true, and stage 1 must end.

### Stage 2 — supervised out to 12 hours

From 30 minutes to 12 hours the bot answers, instantly, but its prompt is
prepended with a handover note: a colleague is already handling this
conversation, here is what they last said and when, do not contradict it, do not
restate/improve/reduce/re-confirm/withdraw any price, discount, figure, deadline
or commitment they made, do not make a commercial offer of your own, answer the
factual part only — stock, spec, availability, timing, policy — and if the
question is commercial, say the colleague is looking after that and will come
straight back. One or two short lines, no new topics.

This is the part that makes the design work, because it is what lets stage 1 be
short *and* lets the whole rule be long. The customer's experience above 30
minutes is never silence — it is a fast, careful, factual answer that leaves the
deal exactly where the rep left it.

**Why 12 hours.** It has to clear "the next morning" and it does: a rep's last
message at 18:00 expires at 06:00, so a 09:00 customer gets normal service. A
rep's last message at 22:00 has not expired at 09:00 — and that is the right
answer, not a bug. Eleven hours after a rep messaged at 10pm, that deal is still
that rep's deal; the bot still replies instantly, it simply does not reopen the
numbers. 12 hours also matches the number this system already uses for "this
thread has gone quiet" (`phase_6_12_hour_silence_detector`), which means one
concept and one number for operators to hold, not two.

### Both numbers live in one place

`HARD_SILENCE_MIN = 30` and `SUPERVISED_HOURS = 12` are constants at the top of
`Human Spoke Recently?`. The HTTP node deliberately fetches a wider 24-hour
window and carries no semantics, so tuning is a one-line edit in one node.
`24h ≥ SUPERVISED_HOURS` is the only coupling and it is noted in the code.

---

## 4. Part 3 — identity. The part most likely to be got wrong

### The collision

`communication_logs.lead_email` is one text column holding at least three
different kinds of key, depending on which component wrote the row:

| Writer | What it puts in `lead_email` |
|---|---|
| `whatsapp_bdc_ai_agent` → `Log Incoming Message` / `Log Conversation` | `lead_email \|\| sender` — the lead's real email if the number matched a lead, otherwise the raw WhatsApp chat id (`…@c.us` **or** `…@lid`) |
| `whatsapp_send_dashboard_reply` → `Log Outbound` | `chat_id` — the WAHA address the browser sent to |
| `kyc_aml_document_auditor…` | `lead_email \|\| chat_id` |
| `7_day_warm_lead_drip_campaign`, `phase_6_12_hour_silence_detector` | the lead's email |
| something upstream | a synthesised `+<digits>@whatsapp.lead` — `Fetch Thread History` builds this key to read it back, so rows exist under it |

So one person's messages are routinely filed under two or three different keys.
This is not hypothetical: `conversations.js` (header, 24 Aug) records one
customer appearing as two threads, "46 messages under his email and 20 under his
LID", and the per-thread read at line 1207 was fixed to query
`lead_email=in.(…)` across every key precisely because reading one key "returned
only the rows that happened to be logged under that key — two thirds of this
customer's history, rendered as though it were all of it."

### Why this is the dangerous part

A "did a human reply recently?" query that matches the wrong key does not error.
It returns zero rows. Zero rows is indistinguishable from "no human has spoken",
and the bot replies. **The miss fails OPEN — straight back into the exact bug
this handoff exists to fix, with a green execution and no error anywhere.**

That is worth stating twice, because it inverts the usual instinct. In most
places a lookup returning nothing is harmless. Here, nothing is the *unsafe*
answer, and it is also the *silent* answer.

### The key set

`Fetch Thread History` already builds a three-key `or=(...)`:

```
(() => { const c = $json;
         const d = String(c.sender_phone || '').replace(/[^0-9]/g,'');
         const keys = [c.sender, c.lead_email, d ? '+' + d + '@whatsapp.lead' : null].filter(Boolean);
         return '(' + keys.map(k => 'lead_email.eq.' + k).join(',') + ')'; })()
```

That is the right shape and the wrong contents. It is reused and widened to six:

| # | Key | Written by |
|---|---|---|
| 1 | `c.sender` — the chat id exactly as WAHA delivered it (`…@c.us` or `…@lid`) | BDC log nodes when the number matched no lead |
| 2 | `c.lead_email` — the matched lead's real email | BDC log nodes, drip, silence detector, KYC |
| 3 | `+<digits>@whatsapp.lead` | the synthesised form `Fetch Thread History` already reads |
| 4 | `<digits>@c.us` — **new** | the dashboard's `Log Outbound`, when `v_conversations.chat_id` is the `@c.us` form of a number whose inbound arrives as `@lid` |
| 5 | `+<digits>` — **new** | a bare E.164 number |
| 6 | `<digits>` — **new** | bare digits |

Keys 4–6 are the ones that matter for this fix. The rep's message is written by
the *dashboard*, keyed on `v_conversations.chat_id`; the check runs from the
*webhook*, keyed on `payload.from`. Those two are only the same string when
WhatsApp addresses the chat the same way in both directions, and it does not
always: `Extract Message & Sender` carries a long comment about LID addressing
precisely because "a LID chat id has no phone digits in it at all". Key 4 is the
bridge.

Keys 4–6 cannot over-match. They are all derived from the same phone number, so
anything they hit is the same person. `lead_email` never legitimately contains
bare digits for someone else.

Three further details, all of which are easy to get wrong:

1. **`$json` is not the context here.** `Fetch Thread History` hangs directly off
   `Resolve Lead Identity`, so `$json` is the context there. `Human Reply Check`
   hangs off `Log Incoming Message`, which is a Supabase insert with
   `Prefer: return=minimal` and **returns an empty body**. Both copies of the
   expression therefore use `$('Resolve Lead Identity').first().json`, which is
   correct from either position — and which makes the two strings *byte
   identical*, so a diff proves they agree.
2. **Values are double-quoted and escaped.** `lead_email.eq."foo@bar.com"`, with
   `"` and `\` backslash-escaped, mirroring the reasoning already written out at
   `conversations.js:1194` — the quotes and commas that delimit a PostgREST list
   must survive as delimiters whatever the key contains. Dots inside a value are
   fine (PostgREST splits on the first two), commas are not.
3. **An empty key set yields a sentinel**, `(lead_email.eq."__no_identity__")`,
   not `()`. `()` is a PostgREST 400; the sentinel is a valid request that
   matches nothing. With no identity there is no thread, so "no human replied" is
   the correct answer rather than a swallowed error.

`Fetch Thread History` gets the same widened expression, `sent_by` added to its
`select`, and `limit` raised 12 → 30. Not scope creep: if the two queries
disagree about who this person is, the history the agent reads and the human
check that constrains it are describing different conversations. The prompt
still slices to the last 10, so a larger limit changes nothing the model sees.

### The residual gap, stated plainly

One case is still not covered: the dashboard sent to a `…@lid` address while the
inbound webhook arrives as `…@c.us` for the same person. There is no LID form
derivable from a phone number, so no expression can bridge it. It requires two
differently-addressed chats for one contact, which the data does not currently
show — query (e) in `migration.sql` §5 is how you check, and R1 in `RISKS.md`
has the durable fix (a canonical person key on `communication_logs`, or reading
the key set from `v_conversations`, which already resolves every log row onto one
person).

---

## 5. What the customer and the rep each experience

| Case | Customer sees | Rep sees |
|---|---|---|
| **Rep replied 3 min ago, customer answers "ok"** | Nothing from the bot. The rep's number, the rep's voice, one negotiation. | Their offer stands. `reply_reason` on the execution reads `held back — ali@… replied from the dashboard 3 min ago; the bot stays out of the thread for 30 min after a human speaks`. This is the bug, fixed. |
| **Rep replied 45 min ago; customer asks "is it still available?"** | An instant, factual answer: yes, in stock, here's the spec. No price movement, no new offer. | Nothing was given away. The number they left on the table is the number still on the table. |
| **Rep replied 45 min ago; customer asks "can you do better on price?"** | An instant answer that does not renegotiate: "my colleague is looking after the pricing on this one and will come straight back to you." | The commercial conversation is still theirs. The customer was not left hanging while they were away. |
| **Rep replied at 18:00; customer writes at 09:00 next day** | Full normal service, instantly. 15 h > 12 h. | Nothing changed. |
| **Rep replied at 22:00; customer writes at 09:00 next day** | Full normal service *except* on price — 11 h is still supervised. Still instant, still useful. | Their 22:00 position is intact. |
| **Bot replied 3 min ago, customer answers** | Normal service. `sent_by='bot'` is excluded by the filter, so the bot never mutes itself. | Unchanged. |
| **A stranger with no keyword messages the number** | Nothing — unchanged. The keyword allowlist is preserved byte-for-byte. | Unchanged; still surfaced as `unanswered_chat`. |
| **Supabase is down when the check runs** | An instant reply, in supervised mode — factual, no numbers. | Degraded safely. `reply_reason` records `[supervised: the human-reply lookup failed, so a colleague is assumed to be in this thread]`. |
| **A lead the rep has never touched** | Unchanged in every respect. | Unchanged. |

The one thing the customer can lose is up to 30 minutes of silence, and only
when a human from the dealership messaged them inside that half hour.

---

## 6. Fail directions, on purpose

| Situation | Direction | Reasoning |
|---|---|---|
| `sent_by IS NULL` (pre-migration row, or the bot's own row before the ops land) | **not human** → bot replies | Otherwise the bot mutes itself for 30 min after each of its own replies. |
| `sent_by` is an unrecognised token | **human** → bot goes quiet | An unknown writer is more likely a person than a machine we forgot; and quiet is the recoverable mistake. |
| Lookup errors (Supabase down, 400, timeout after 2 tries) | **supervised** → bot replies, carefully | Full silence on an outage would take the whole BDC offline. A normal reply would risk contradicting a rep. Supervised is neither. |
| Key set misses the rep's row | **not human** → bot replies | ⚠️ The one genuine fail-open. This is R1 in `RISKS.md` and the reason part 3 is as long as it is. |
| `Human Spoke Recently?` produces no readable mode | **bot replies** | Last-resort fail-open. Reading the mode is wrapped in try/catch; an expression that threw here would kill the run and the customer would get nothing at all. A bug should not become a silent outage. |

---

## 7. Order of application, and every intermediate state

1. **`migration.sql`.** Additive; nothing reads `sent_by` yet. Safe to sit here
   indefinitely.
2. **`OPERATIONS_send.json`** (workflow `yx6m55p1Kj8V7koR`). Rep sends now
   stamp `sent_by`. Nothing reads it yet — behaviour identical to today. Safe to
   sit here indefinitely, and it is worth sitting here for a day so that when
   step 3 goes live there is already real data to test against.
3. **`OPERATIONS_bdc.json`** (workflow `BiyHk9ZXxJUVGbf6`). The rule goes live.
4. **`conversations.patch.md`** — display only, any time after step 1.

Reversed (3 before 2) the check simply finds no human rows and the system
behaves exactly as it does today. There is no ordering that is worse than the
status quo.

---

## 8. Deliberately not shipped

- **A suppression trace.** When the bot goes quiet nothing is written anywhere,
  and the BDC workflow runs with `saveDataSuccessExecution: "none"`, so a
  suppressed run leaves no record at all. The obvious fix — wiring
  `Should The Bot Reply?` output 1 (currently `[]`) to an `audit_log` insert —
  is left out because `audit_log` is read by four dashboard screens
  (`automation.js:569`, `campaigns.js:283`, `finance.js:1234`, `ask.js:932`) and
  the volume effect on those was not assessable offline. It is R5 in
  `RISKS.md` with the verification workaround.
- **`Recent Outreach Check`'s single-key filter.** It uses
  `lead_email=eq.{{ $json.lead_email || 'none' }}` — the same class of fail-open
  (a null `lead_email` becomes the literal `'none'`, matches nothing, and a
  duplicate outreach goes out). The fix is to paste in the canonical key set.
  Left out to keep the blast radius on the reply path; it fails toward *sending*
  a second welcome, not toward contradicting a rep. R4.
- **Adding `sent_by` to the other automated writers** (drip, KYC, silence
  detector). They write `NULL` today, which reads as "not human" — correct
  behaviour, no urgency. When they are next touched they should adopt their
  reserved tokens (`drip`, `kyc`, `silence`), which are already in the filter.
- **A canonical person key on `communication_logs`.** The real fix for part 3,
  and much larger than this change. R1.

---

## 9. Files

| File | What it is |
|---|---|
| `migration.sql` | The column. Idempotent, commented, with verification queries. |
| `OPERATIONS_send.json` | 2 ops for `WhatsApp Send (Dashboard Reply)` (`yx6m55p1Kj8V7koR`). |
| `OPERATIONS_bdc.json` | 13 ops for `WhatsApp BDC AI Agent` (`BiyHk9ZXxJUVGbf6`). |
| `conversations.patch.md` | Frontend: what must change (nothing), and what may. |
| `RISKS.md` | Failure modes, the fail-open one first, and the post-apply checks. |
| `_gen.py` | Generates both operation arrays. It exists so the canonical key-set expression is written once and emitted into both `Human Reply Check` and `Fetch Thread History` as identical strings. Re-run it after editing; do not hand-edit one copy. |

Credential placeholder in both operation files: `"<<SUPABASE_CRED_ID>>"`
(live value in the export is `dv4OeARarErZLHCj`, name `Supabase account`).
