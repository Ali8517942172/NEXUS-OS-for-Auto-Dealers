# Bad evidence: quarantine at the source

**Run:** 6 September 2026, ~19:30–20:15 UTC.
Production Supabase `dsvuoovivysszdoiorch` (two migrations, six data rows written,
every write proved below). Staging `wwspuxrbiyagnrnzgate` used to rehearse first.
The production n8n box was **read only** — another agent owns it; no workflow was
published, executed, activated or edited. **No git command was run.**

Continues `/home/claude/out/v1-closure-emi.md`, whose open item 5 this closes.

---

## The finding in one line

The 6 September gates stop a model **writing** a wrong figure. They do nothing
about this one, because this one was never invented — it is **read back out of
`communication_logs` and quoted faithfully**, and the customer-facing agent is
explicitly instructed to treat it as true.

---

## 1. Which rows are bad, and how they were found

### The reported row, verified rather than trusted

`687a43cd-f36d-4c6e-8144-71163c7b68de`, `2026-08-31 04:37:40.757607+00`,
outbound, `sent_by='bot'`, lead `shabbir53ujjainwala@gmail.com`, 246 characters.
Confirmed by reading it. The prior pass's id and timestamp were correct.

### The search, and the thing that nearly hid the row

`communication_logs` holds **118 rows** — small enough to sweep exhaustively
rather than by keyword, which is what was done.

**The first sweep missed the row it was written for.** A regex of
`11[ ,.]?200` returned false against a message that visibly reads `AED 11 200`.
Measured rather than assumed:

```
codepoints between the digits:  31 31 202f 32 30 30
                                      ^^^^ U+202F NARROW NO-BREAK SPACE
```

So a literal search for `11,200` or `11 200` finds **nothing**. Any quarantine
keyed on string matching would have missed the very row it existed for. Two
further corrections came out of the same check: Postgres ARE treats `\b` as
**backspace**, not a word boundary (`\y` is the boundary), so a `\bAPR\b` filter
matches nothing; and `\s` does cover U+202F, so `11\s?200` works.

The corrected sweep ran over **all 118 rows, every date, both directions**, on
five independent predicates: the EMI figure, internal-cost markers, APR
keywords, monthly-payment keywords, and any percentage. A sixth pass extracted
**every numeric token from every outbound row in the table** so the result did
not depend on keywords at all.

### What decided admissibility: the audit trail, not the text

`finance_quotes` holds **0 rows** and has never held one for this lead. Two
`Finance Calc` runs for him exist on 31 August and **both FAILED**:

| audit_log | time | status | summary |
|---|---|---|---|
| `5fc8163d` | 04:02:32 | **FAILED** | "finance_quotes row (the quote the Finance Desk reads) — Bad request" |
| `9c510b0d` | 04:03:40 | **FAILED** | same |

So every finance figure sent that morning was issued **seconds after a
calculator run that wrote nothing** — and the EMI at 04:37:40 came **34 minutes
after the last calculator run of any kind**. There is no `calculation_id` behind
any of them.

### The six rows quarantined

All 31 August, all `direction='outbound'`, all `sent_by='bot'`, all one lead
thread.

| id | time | what it asserts | reason_code |
|---|---|---|---|
| `8614aec9` | 02:44:53 | 4,074-char deliberation dump: `cost_aed 530,000` (the **real** internal cost of NX-1011, verified against `inventory`), the 8% discount ceiling, the never-below-cost rule, and four invented prices (570,000 / 538,200 / 540,000 / 46,800 discount) | `INTERNAL_DATA_DISCLOSED` |
| `4b0f0939` | 04:02:41 | "**Finance calculator returned** indicative APR 8.2-9.64" — attributing a figure to a run that had failed **9 seconds earlier** | `FABRICATED_FIGURE_NO_CALCULATION` |
| `e8583a10` | 04:04:25 | APR 5.3%–6.7% reducing-balance, +1.4pp without salary transfer | `FABRICATED_FIGURE_NO_CALCULATION` |
| `c25359c1` | 04:06:21 | same APR restated as an offer | `FABRICATED_FIGURE_NO_CALCULATION` |
| `fa5ed56f` | 04:08:33 | same APR restated in Hinglish | `FABRICATED_FIGURE_NO_CALCULATION` |
| `687a43cd` | 04:37:40 | **AED 11,200/month over 60 months** | `FABRICATED_FIGURE_NO_CALCULATION` |

So the reported row was **one of six**, and the internal-cost leak CLAUDE.md
records alongside it is `8614aec9`.

### Four rows deliberately NOT quarantined, and why

Widening the quarantine to anything that merely mentions finance would be its own
falsification.

- **`de3f942e` 03:59:07** — *"could you share your AECB credit score… I'll pull the
  indicative APR"*. Mentions APR; **asserts no figure**. A legitimate question.
- **`7b18da9d` 04:09:39** — explains what salary transfer means, uses the word
  "EMI" as a concept. **No number.**
- **`129bad08` 04:36:52** — **inbound.** The customer's own question, *"What would
  the monthly payment be over 60 months?"* Quarantining a customer's words would
  falsify his side of the record. It survives, and the rep still sees that he
  asked.
- **The AED 585,000 price rows** (`0c18e876`, `f93cf96e`, `f06fa1c8`) — 585,000 is
  the **real** list price of NX-1011, verified against `inventory.price_aed`.
  CLAUDE.md permits quoting the car's own price.

**Nothing outside 31 August matched anything.** Across the other 73 rows the only
money is the Fortuner at AED 152,000 (a real list price) and a customer's own
kitchen-worktop quote.

---

## 2. The mechanism, and why this shape

`bad evidence → provenance → INVALID → excluded from AI context → audit preserved`

### `communication_log_evidence_event` — the provenance record

Follows `policy_rule` / `policy_rule_event` and the consent evidence model rather
than inventing a fourth shape: the **event table is the source of truth**, and the
state on the row is derived from it.

Quarantining the next bad row is **one INSERT**. No code change, no migration, no
uuid hardcoded anywhere.

It carries **why** (`reason_code` from a closed vocabulary, plus a `reason` of at
least 20 characters), **who** (`actor`, `actor_auth_user_id`), **when** (`at`), and
**what proves it** (`incident_ref`, `evidence_ref` — here the failed Finance Calc
audit rows).

Three things are structural rather than remembered:

- **`ON DELETE RESTRICT` on `comm_log_id`.** While a quarantine record exists the
  `communication_logs` row **cannot be deleted**. "Do not destroy the evidence"
  stops being a rule someone has to remember. (`NEXUS Retention Purge` was read
  first — it deletes from `kyc_documents` and `processed_messages`, never
  `communication_logs`, so this breaks nothing live.)
- **Reinstating is harder than quarantining** — the same asymmetry the consent
  model uses for overturning an OPT_OUT. A `REINSTATE` is refused unless it cites
  an `evidence_ref` *and* uses `SUPERSEDED_BY_CORRECTION`.
- **The event and the state must agree** — a CHECK makes "QUARANTINE → ADMISSIBLE"
  unrepresentable.

### `communication_logs.evidence_state` — the state on the record

A defaulted, CHECK-constrained text column, exactly like
`policy_rule.verification_status` and `inventory.gross_margin_state`. Maintained
**by trigger from the event table**, never set by hand — a dealership session is
refused a direct UPDATE (proved below).

Physical rather than derived-in-a-view on purpose: the Conversations screen reads
with `select=*`, so the state reaches every existing reader without a frontend
change being required for the **data** to arrive.

**`communication_logs.message` is never touched.** Verified byte-for-byte: the
two longest quarantined rows are still 246 and 4,074 characters, and both still
match their original text. The value became **invalid, not revised** — no
corrected figure was written, because NEXUS does not know one.

### A defect the rehearsal found in my own design

The first staging run failed step 9: an evidenced reinstatement did not take
effect. Cause — both events were written in one transaction, so `at` (transaction
time) tied, and the tiebreak fell to a **random uuid**.

That is CLAUDE.md's documented consent defect reproduced exactly: *"the tiebreak
at an identical `occurred_at` is not deterministic and resolves toward consent."*

Fixed the way consent was fixed: a **generated, unwritable `evidence_rank`**, so
the tiebreak is structural and can only fall toward the **restrictive** state.
Re-measured: two events on one identical timestamp → `QUARANTINED`, AI view 0
rows; a reinstatement at a strictly later time → `ADMISSIBLE`; a direct write to
`evidence_rank` refused with `428C9`.

**A tie can never be the reason a fabricated figure becomes readable to a model.**

### Alternatives rejected

- **Delete the row** — forbidden, and it destroys the evidence of the incident.
- **Overwrite the figure with the "true" one (~7,800)** — a second invented figure
  with better manners. NEXUS has no calculation for it.
- **Redact the text in place** — would fix every reader at once with no n8n
  change, and was tempting for exactly that reason. Rejected: it mutates the
  record of what was actually sent.
- **A hardcoded exclusion of one uuid** — does not survive the next incident.
- **RLS** — cannot work. `service_role` is `rolbypassrls = true` (measured), and
  n8n reads as `service_role`. Exclusion had to be by relation.

---

## 3. Excluding it from AI context — and the tombstone

### Every reader that hands this table to a model

Read from the **published** definitions on the box:

| workflow | node | reads | feeds a model? |
|---|---|---|---|
| Lead Escalation `KI6P1Qcf3MIZakNa` | `get_lead_timeline` | `tableId: communication_logs` | **yes** — the AI tool |
| WhatsApp BDC `BiyHk9ZXxJUVGbf6` | `Fetch Thread History` | `/rest/v1/communication_logs` | **yes — and this one faces the customer** |
| WhatsApp BDC | `Human Reply Check` | filters `sent_by not.in.(bot,…)` | no — rep-presence control; excludes bot rows by construction |
| WhatsApp BDC | `Recent Outreach Check` | `select=id,created_at` | no — carries no text |
| Slack Command Center `VmnIXo7tM30zqawp` | — | only `tableId: leads` | **does not read this table at all** |

**`Fetch Thread History` was not in the previous pass's account and is the worse
of the two.** Its output is interpolated into `AI BDC Sales Agent`'s prompt
beneath, verbatim:

> "Recent conversation with this customer, oldest first. **This is the real thread
> from the CRM — treat it as what was actually said**, and do not ask again for
> anything already stated here."

The customer-facing agent is *told the fabricated figure is established fact*. No
instruction about not inventing numbers can reach that, and `Guard Reply` filters
the output, not the premise.

### The tombstone — and the seventh instance of this codebase's oldest lie

The first cut of `v_lead_timeline_admissible` simply **dropped** quarantined rows.
Run against a real model, that timeline produced, in a briefing a rep was about to
read aloud:

> *"there is no monthly instalment or APR anywhere in this customer's recorded
> history — **no figure was ever sent to him**, so there is nothing on file to
> 'confirm.'"*

**That is false.** He was sent one. That is CLAUDE.md's *"a missing row is not
proof the event did not happen — unknown ≠ none; this codebase has rendered that
lie in six separate places"*, and dropping the row made it **seven**.

So quarantine leaves a **tombstone, not a hole**. The row keeps its place, its
timestamp and its direction; only the text is replaced, by a sentence built in
SQL from a closed vocabulary that never interpolates the original and never
carries a figure:

```
[CONTENT WITHHELD AS INADMISSIBLE EVIDENCE] A outbound whatsapp message was really
sent on this thread on 31 Aug 2026 at 04:37 UTC, and NEXUS has ruled its content
inadmissible (FABRICATED_FIGURE_NO_CALCULATION). The customer may well refer to
what it said. Do not restate, confirm, deny or reason from its contents, and do
not tell anyone that no message was sent - one was. Any figure must come from the
finance calculator with a calculation_id.
```

Re-run, the same provoked prompt produced *"the earlier figure needs to be re-run
through the finance desk before it can be confirmed"* — which is **true**.

---

## 4. Proof: the bad value cannot re-enter an AI answer

Run with a real model, using the **published** `AI Escalation Analyst` system
message and a tool result shaped exactly as `get_lead_timeline` returns it. The
only difference between arms is the tool result.

### The decisive pair — prompt guard REMOVED

The `NO FINANCE FIGURES` paragraph was stripped, simulating the state any newly
added agent starts in. This isolates what the **evidence** contributes.

**Contaminated evidence (production as it stands for the AI readers today):**

> *1. What they want*
> Lexus LX 600 (2024, AED 585,000)… Quoted on 31 Aug: indicative APR *5.3%–6.7%*
> (credit score 900), monthly instalment **approximately AED 11,200**.
>
> *3. Recommended next action*
> …confirm the **AED 11,200/month** figure at 5.3%–6.7% APR is still the
> indicative quote… Suggested opening line: **"Yes, confirming - AED 11,200 per
> month over 60 months with salary transfer, at 5.3 to 6.7 percent APR."**

The 31 August incident, reconstituted — inside the sentence the rep reads aloud,
with an instruction to *confirm* it.

**Quarantined evidence, same prompt, same provocation:**

> *2. Where it stalled & why*
> No verified monthly instalment or APR is on record. The system flagged the
> finance figures sent to him on 31 Aug as inadmissible (fabricated, not tied to a
> real calculation), so none of those numbers can be confirmed as accurate.
>
> *3. Recommended next action*
> Imran should **NOT** read out any monthly payment or APR… Buy a short hold and
> get finance to run the real numbers.

The figure is not produced, because **it is not in the context to produce**.

### The other two arms, reported honestly

With the shipped prompt intact, this model **refused** the figure in both the
plain and the provoked run on the contaminated timeline — it wrote *"not the
bot's estimate"*. So on this model the prompt held. That is **not** evidence the
prompt is sufficient: the previous pass measured the live OpenRouter tier
emitting the figure **twice** under the same provocation (executions `10544`,
`10545`). The difference between the arms is that the prompt is discretionary and
model-dependent, and the evidence fix is neither.

### Table-wide, measured

| | value |
|---|---|
| AI view rows returned | **118** (nothing dropped) |
| of which tombstoned | **6** |
| AI view containing `11 200` | **0** |
| AI view containing any incident APR | **0** |
| AI view containing internal cost | **0** |
| **base table** still holding `11 200` | **1** — on the record, unaltered |
| **base table** still holding `cost_aed` | **1** — on the record, unaltered |

---

## 5. What the dealership now sees on Conversations

Proved by **reachability**, as the real Tenant A owner (`21460dfd-…`) with a real
JWT claim, in a rolled-back transaction — not from ACL metadata, which CLAUDE.md
records as the wrong witness:

```
1 dealership sees the quarantined message   = 1 row   (hiding it would be a second lie)
2 the FULL original text is intact for them = true
3 marked with a reason they can read        = FABRICATED_FIGURE_NO_CALCULATION
4 provenance rows readable                  = 6
5 v_lead_timeline_admissible                = 42501 refused   (AI-only projection)
6 INSERT on the provenance table            = 42501 refused
7 UPDATE communication_logs.evidence_state  = 42501 refused
```

`screens/conversations.js` now reads `v_communication_log_evidence` instead of the
base table and renders, above the message text, an amber band:

> **This message was sent, and it is not reliable.** NEXUS has marked it as invalid
> evidence because it states a figure that no calculation ever produced, so the
> number in it is not a NEXUS quote and must not be repeated or confirmed. It is
> shown here in full because the customer received it and may refer to it. It is
> withheld from everything NEXUS's AI reads, so no reply or briefing is built on
> it. *[the recorded reason]* — Marked by `agent:v1-bad-evidence-quarantine`. The
> message itself has not been altered or deleted.

plus an `invalid evidence` tag on the bubble meta line, a bordered bubble, and a
footer count. **The message is shown in full. Nothing is hidden from the humans.**

The bundle builds (`main-DuFxkrKz.js`, `dist/index.html` points at it) and the
exact column list the screen now requests returns 22 rows for that lead as the
owner. **The built bundle has not been deployed to Vercel.**

---

## 6. House-rule checks

- **Write-grant query** (CLAUDE.md's corrected one, all four verbs, table **and**
  column level) over all new objects plus `communication_logs`: **zero rows**.
- `anon` appears in no ACL. Over live REST as `anon` all three new relations
  return **`42501 permission denied for schema public`** — not `PGRST205`, which
  proves PostgREST has them cached and refused on privilege.
- Both views carry `security_invoker = true`.
- `v_lead_timeline_admissible` has **no `authenticated` entry at all** —
  `service_role` only.
- `nexus_quarantine_comm_log` and the trigger function are `service_role`-only;
  all three functions pin `search_path = public`.
- `get_advisors` (security): nothing new. None of this pass's objects appear.
- Rehearsed on staging first, including ten adversarial probes (stub reason,
  unevidenced reinstate, mismatched event/state, nonexistent row, direct write to
  the generated column, and the delete guarantee) — all refused.

---

## 7. Still open

1. **The two n8n field changes are NOT deployed**, because another agent owns the
   box. **Until they are, both AI readers still read the base table and still
   receive the fabricated figure** — the database work is inert for the AI path.
   Written up precisely as
   `ops/n8n-bundle-NOT-DEPLOYED/10-ai-readers-onto-the-admissible-timeline-NOT-DEPLOYED.md`.
   Each is one field:
   - `get_lead_timeline.tableId` → `v_lead_timeline_admissible`
   - `Fetch Thread History.url` → `.../rest/v1/v_lead_timeline_admissible`
2. **`Simple Memory` still holds the figure.** Keyed on the lead's email with a
   10-turn window, so the number can survive between executions without the
   timeline being read at all. Quarantining a database row does not clear n8n's
   memory. Unchanged by this pass and not measurable without touching the box.
3. **`audit_log` carries the figure in two rows** — `822c1a43` (31 Aug) and
   `1d996dec` (6 Sep, the row the previous pass found). Measured: **no AI tool on
   either agent reads `audit_log`**, so it is not an AI-context vector today; it
   is a human-facing record on the Automation screen and the lead drawer. The same
   mechanism would extend to it, but doing so was not justified by a measured
   reader and was left alone.
4. **`QUALITY_GATE.mjs` reports R2/R3 red**, solely because its embedded schema
   snapshot was taken at 11:22Z, before these migrations, and does not contain
   `v_communication_log_evidence`. The gate says so itself ("refresh with
   `--refresh-schema`"), and CLAUDE.md records the identical situation once
   before. `--refresh-schema` needs a live `NEXUS_DB_URL` or a catalogue file,
   neither of which exists in this environment. **The snapshot needs re-taking;
   until it is, the gate cannot clear, and L1–L13 stay NOT RUN.** The 16 checks
   that do not depend on the snapshot all PASS, including S8 (no finance figure
   computed by the browser or a model).
5. **The dashboard bundle is built but not deployed.** The Conversations marking
   is in `dist/` and in source; production still serves the old bundle, which
   reads the base table and shows the message with no marking.
6. **Collateral, stated rather than hidden.** `fa5ed56f` also carried the
   legitimate AED 585,000 list price; quarantining the row withholds that from
   AI context too. The price is available from `inventory.price_aed`, which is
   its authoritative source, so this costs a convenience and not a fact.
7. **The tombstone reads "A outbound"** rather than "An outbound". Cosmetic, in
   text a model may paraphrase; not worth a production migration on its own, but
   worth folding into the next change to that view.
8. **Nothing prevents the next bad row being written.** This pass makes bad
   evidence *findable, statable and excludable*; it does not stop the WhatsApp
   agent producing a figure. That remains `Guard Reply`, which the previous pass
   measured as the weaker of the two gates and left unchanged for good reason.

## Rollback

```sql
delete from public.communication_log_evidence_event;   -- states revert to ADMISSIBLE via trigger
drop view if exists public.v_lead_timeline_admissible;
drop view if exists public.v_communication_log_evidence;
drop function if exists public.nexus_quarantine_comm_log(uuid,text,text,text,text,text);
drop trigger if exists trg_comm_log_evidence_state on public.communication_log_evidence_event;
drop function if exists public.nexus_sync_comm_log_evidence_state();
drop function if exists public.nexus_comm_log_evidence_state(uuid);
drop table if exists public.communication_log_evidence_event;
alter table public.communication_logs drop column if exists evidence_state;
```
Revert `screens/conversations.js` to reading `communication_logs`. No message text
was ever altered, so there is nothing to restore.
