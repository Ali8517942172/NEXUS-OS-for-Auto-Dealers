# Risks, failure modes, and what to verify

Severity is about *this* change: what it can break that works today, and what it
can silently fail to fix.

---

## R1 — the fail-open: the key set misses the rep's row  ★ highest

**What happens.** `Human Reply Check` builds an `or=(lead_email.eq."…",…)`
filter from six keys. If the rep's outbound row is filed under a seventh, the
query returns **zero rows**. Zero rows is indistinguishable from "no human has
spoken". `Human Spoke Recently?` returns `human_mode: 'normal'`, the bot replies,
and the original bug is back — with a green execution, no error, and nothing in
any log to say the check ran and got it wrong.

**Why it is the worst one.** Every other failure mode here is loud or
conservative. This one is silent *and* unsafe, and it is silent in exactly the
scenario the change exists to prevent.

**The specific hole.** The rep's row is keyed on `v_conversations.chat_id` (what
the browser sent to). The check is keyed on `payload.from` (what the webhook
received). Keys 4–6 (`<digits>@c.us`, `+<digits>`, `<digits>`) bridge the common
mismatch. The uncovered case is: the dashboard sent to a `…@lid` address while
the inbound arrives as `…@c.us` for the same contact. No LID form is derivable
from a phone number, so no expression can bridge it — it needs a canonical key.

**Detect it.** Query (e) in `migration.sql` §5 lists every distinct
`lead_email` key per WhatsApp thread. Any contact whose rows span a `…@lid`
key *and* a `…@c.us` key is exposed. Cross-check against the pane note in
`conversations.js` ("Assembled from N keys in communication_logs.lead_email"),
which prints the keys `v_conversations` resolved for each thread — if it ever
lists a key the check does not build, that thread is exposed.

**Durable fix (not in this handoff).** Give `communication_logs` a canonical
person key — a `contact_id`, or a `thread_key` written at insert time — so
"messages to this person" stops being a string-equality guess across six
spellings. `v_conversations` already does this resolution; the log table should
carry the result rather than every reader re-deriving it.

**Interim mitigation if you want belt and braces on day one.** Temporarily drop
`HARD_SILENCE_MIN` to 0 and treat *every* thread as supervised. The bot then
never renegotiates a rep's number in any thread, at the cost of never being
allowed to negotiate at all. Not recommended as a steady state — it disables the
product's negotiation behaviour — but it is the safe setting while R1 is being
measured.

---

## R2 — `NULL` misread as human → the bot mutes itself

**What happens.** If a reader ever treats `sent_by IS NULL` as "a human sent
this", the BDC agent's own `Log Conversation` row (which writes `NULL` until
`OPERATIONS_bdc.json` is applied, and would write `NULL` again if that op were
reverted) reads as a colleague's message. The bot then falls silent for 30
minutes after every message it sends — a total, self-inflicted outage of the
WhatsApp BDC that looks like a crash and produces no errors.

**Why it will not happen as shipped.** The filter is
`sent_by=not.in.(bot,drip,kyc,system,router,outreach,silence)`, and
`NULL NOT IN (…)` evaluates to `NULL`, i.e. not matched. This is load-bearing
three-valued logic, which is why `migration.sql` and the column comment both say
so explicitly.

**What would break it.** Rewriting the filter as `sent_by=neq.bot` is *equally*
safe (same NULL behaviour) but reads as if it were checking one thing.
Rewriting it as `sent_by=not.is.null` — which looks like a tidy simplification —
is the catastrophic version. Do not.

**Verify.** After applying everything, send one bot-answered message and confirm
a second inbound within 30 minutes still gets a reply.

---

## R3 — an automated writer mistaken for a rep

**What happens.** A new or changed workflow writes `sent_by` with a token not in
the reserved list — `'n8n'`, `'nexus'`, `'campaign'`. The open-set rule reads it
as a person and the bot goes quiet for 30 minutes, then supervised for 12 hours,
every time that workflow touches a thread.

**Direction.** Conservative — the bot is over-quiet, never over-talkative. This
is the deliberate trade in DESIGN.md §1.

**Prevention.** The reserved list is in the `COMMENT ON COLUMN`. Any new
automated writer must be added there **and** to the `not.in.(…)` filter on
`Human Reply Check`. Two places; there is no single source of truth for this and
that is a real weakness of a one-column design.

**Detect.** `select distinct sent_by from communication_logs where sent_by is not null;`
Anything without an `@` that is not in the reserved list is a bug.

---

## R4 — adjacent fail-open left in place: `Recent Outreach Check`

Not introduced here, not fixed here. `Recent Outreach Check` filters on
`lead_email=eq.{{ $json.lead_email || 'none' }}` — one key, and when
`lead_email` is null it sends the literal string `'none'`, which matches
nothing. `Skip Duplicate Outreach` then lets a second INITIAL_OUTREACH through:
the same duplicate-welcome failure that node was built to stop (16 Aug, two
welcome messages four minutes apart).

Fix is one `setNodeParameter`: replace the `lead_email` query parameter with the
canonical key set from `_gen.py` (the same `or=(…)` string, as an `or`
parameter). Left out to keep this change on the reply path. It fails toward
sending a duplicate welcome, not toward contradicting a rep.

---

## R5 — a suppressed reply leaves no trace

The BDC workflow runs with `saveDataSuccessExecution: "none"`. When the bot goes
quiet, `Should The Bot Reply?` output 1 is `[]` and the run ends. Nothing is
written to `communication_logs` (correctly — a suppression is not a message),
nothing to `audit_log`, and the execution is not retained. **You cannot prove
after the fact that the bot went quiet on purpose rather than crashed.**

`reply_reason` carries the full explanation, but only inside an execution that
is not saved.

**Workaround for the verification window.** In the n8n UI, Workflow Settings →
"Save successful production executions" → *Save*, run the tests below, read
`Reply Eligibility`'s `reply_reason` on each, then set it back to *Do not save*.
Leaving it on permanently is not advisable on this box: the VM is documented as
CPU-starved with 5 production slots, and execution storage has caused problems
before.

**Follow-up worth doing.** Wire `Should The Bot Reply?` output 1 to an
`audit_log` insert (`workflow: 'WhatsApp BDC'`, `status: 'SUPPRESSED'`,
`lead_email`, `summary: reply_reason`) with `onError: continueRegularOutput`. It
sits on a branch that currently goes nowhere, so it cannot affect the reply path.
It was left out of the operation array only because `audit_log` is read by four
dashboard screens (`automation.js:569`, `campaigns.js:283`, `finance.js:1234`,
`ask.js:932`) and the row-volume effect on those could not be judged offline —
in particular, the keyword allowlist already suppresses every stranger who
messages this number, so this node would log those too.

---

## R6 — the item-multiplication trap

`Human Reply Check` is an HTTP node **in the main chain**. n8n splits a JSON
array response into one item per row, so if `limit=1` were ever removed or
raised, every node after it — `Reply Eligibility`, the agent, `Send Reply via
WAHA`, `Log Conversation` — would run once per row. The customer would receive
several replies to one message.

`Fetch Thread History` avoids this by sitting on a branch that feeds nothing (its
own `notes` say so). `Recent Outreach Check` avoids it with `limit=1` plus a
Code node that collapses to one item; `Human Reply Check` follows that pattern.

**Guard.** `Human Spoke Recently?` returns exactly one item unconditionally, so
even if `limit` were raised the multiplication stops there. Do not remove that
property. Never set `Human Reply Check`'s `limit` above 1.

---

## R7 — changes to `Fetch Thread History`

Three parameter changes to a node that works today: widened `or`, `sent_by`
added to `select`, `limit` 12 → 30.

- **Widened `or`.** Strictly more rows, all of them the same person's. The risk
  is a malformed filter → PostgREST 400 → `onError: continueRegularOutput` →
  the agent's history goes empty and it starts asking for things the customer
  already said. Visible immediately in the first test message.
- **Double-quoted values** are new for this node. If quoting were wrong the
  symptom is the same 400. Verify with one live message before trusting it.
- **`limit` 12 → 30.** The prompt builder slices `.slice(-10)`, so nothing the
  model sees changes. It costs a slightly larger Supabase response on a
  CPU-starved box.

**Rollback for this node alone:** restore `select=direction,message,created_at`,
`limit=12`, and the original three-key unquoted `or`. The human check does not
depend on this node, so reverting it does not weaken the fix.

---

## R8 — collision with the pending `voice-final/OPERATIONS.json`

`/home/claude/audit/voice-final/OPERATIONS.json` is an unapplied operation array
for the **same** BDC workflow (`BiyHk9ZXxJUVGbf6`). The exported workflow has no
`Is Voice Note?` node, so it has not been applied.

**Overlap check — there is none.** Voice ops touch `Extract Message & Sender`,
`Resolve Lead Identity`, `Delivery Report` and `New Lead Worth Scoring?`
(`setNodeParameter`), plus six new nodes and a rewire of
`Extract Message & Sender → Fetch All Leads`. This handoff touches
`Log Incoming Message`, `Log Conversation`, `Fetch Thread History`,
`Reply Eligibility`, `AI BDC Sales Agent` and a rewire of
`Log Incoming Message → Reply Eligibility`. Disjoint node sets, disjoint
connections. **Either order works.**

One interaction to be aware of: with voice applied, `Resolve Lead Identity` also
emits the voice transcript as `message`. `Human Spoke Recently?` reads
`Resolve Lead Identity` and passes the whole context through, so a voice note is
suppressed and supervised exactly like text. That is correct and needs no extra
work.

**Do not hand-merge the two arrays.** Apply one, confirm, apply the other.

---

## R9 — the agent ignores the handover note

The note is prepended to the *user* prompt, not the system message, because it
is per-run. The system message is long and contains strong, repeatedly-reinforced
instructions to negotiate ("BUT DO NEGOTIATE THE MOMENT THEY ASK",
"NEVER answer a direct price request with 'let me know if you'd like to talk
numbers'"). A free-tier model may follow the system message over the note and
quote a number anyway.

**Mitigations already in place.** The note is positioned immediately before
`Customer says now:`, i.e. last thing read. It is specific about the prohibited
actions rather than general. And it only governs stage 2 — stage 1, where the
risk is highest, is enforced in `Reply Eligibility`, in code, where no model can
override it.

**If it proves unreliable**, add a matching paragraph to the agent's
`systemMessage` (a `setNodeParameter` on `/options/systemMessage`) telling it
that a `HANDOVER NOTE` block in the prompt overrides the negotiation section.
Deferred because it is a change to a long, heavily-tuned prompt that should be
made on evidence, not in advance.

---

## R10 — `Verify JWT` returns no email

`Prepare Send` falls back to the literal `'dashboard'`. That is not in the
reserved automation list, so it reads as human and the suppression works.

Two consequences: the dashboard shows `dashboard` instead of a name, and two
different reps both appear as `dashboard`. Acceptable. What matters is that
`'dashboard'` must **never** be added to the reserved automation tokens — doing
so would silently disable suppression for every phone-auth rep.

---

# Verification after applying

Run in order. Steps 1–2 need only `migration.sql` + `OPERATIONS_send.json`.

1. **The column landed.** `migration.sql` §5 queries (a) and (c). Expect
   `sent_by | text | YES | null`, and `stamped = 0`.
2. **The rep's send is stamped.** Send one message from the dashboard. Then
   query (d). Expect a row with `sent_by = '<your supabase login email>'`,
   `direction = 'outbound'`. If it is `NULL`, `OPERATIONS_send.json` did not
   apply — stop here, nothing downstream will work.
3. **The bot's send is stamped.** Apply `OPERATIONS_bdc.json`. From a test phone
   that is *not* in `leads`, send a message containing a keyword (e.g. "price").
   Expect a bot reply and a row with `sent_by = 'bot'`.
4. **Hard silence works.** From the dashboard, reply to that test thread. Within
   5 minutes, send another inbound from the test phone. **Expect no bot reply.**
   With execution saving temporarily on (R5), `Reply Eligibility`'s
   `reply_reason` should read `held back — <you> replied from the dashboard N min
   ago…`.
5. **The bot does not mute itself.** Wait for the bot to answer something, then
   send another inbound within 30 minutes. **Expect a normal bot reply.** If the
   bot is silent here, R2 has occurred — check the `not.in.(…)` filter.
6. **Supervised mode works.** Either wait out 30 minutes, or temporarily set
   `HARD_SILENCE_MIN = 1` in `Human Spoke Recently?`. Send an inbound asking a
   *factual* question ("is it still available?") — expect a normal factual
   answer. Then send a *commercial* one ("can you do better?") — expect a
   deferral to the colleague and **no number**. Restore the constant.
7. **The identity trap.** Query (e). Confirm your test contact's rows are all
   under keys the expression builds — and specifically that step 4 worked at all,
   because step 4 passing *is* the proof that the dashboard's key and the
   webhook's key met. If step 4 failed while everything else passed, you are
   looking at R1, not at a broken window.
8. **The agent still has its history.** In any reply, confirm the bot does not
   re-ask for something already given in the thread. If it does, the widened
   `Fetch Thread History` filter is returning nothing (R7).
9. **Nothing else regressed.** Send an inbound from a number with no keyword and
   no lead row — expect silence, as before. Confirm the dashboard conversations
   screen still loads (`conversations.js:1207` is unchanged unless you took the
   optional patch).
10. **Turn execution saving back off** if you turned it on for step 4.

## Rollback

- **Workflows:** n8n keeps workflow history. Restore the previous version of
  `BiyHk9ZXxJUVGbf6` and `yx6m55p1Kj8V7koR`. Behaviour returns to today's,
  including the bug.
- **Partial rollback (keep the logging, drop the rule):** revert only
  `BiyHk9ZXxJUVGbf6`. `sent_by` keeps being written and stays useful for the
  dashboard.
- **Database:** leave the column. It is nullable and additive; dropping it is a
  larger risk than keeping an unused column. If it truly must go,
  `alter table public.communication_logs drop column if exists sent_by;` — but
  revert both workflows *first*, or their inserts will 400 and the log nodes
  (all `onError: continueRegularOutput`) will swallow it and lose message history
  silently.
