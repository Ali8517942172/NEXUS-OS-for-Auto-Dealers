# 10 — Point the AI readers at `v_lead_timeline_admissible` — **NOT DEPLOYED**

Written 6 September 2026 against the **live published** definitions on the box.
The box was read only. Nothing here was published, executed or tested on it.

## Why

The 31 August incident put six bad rows into `communication_logs`: a fabricated
AED 11,200 monthly instalment, four unevidenced APR figures, and a deliberation
dump carrying the vehicle's real internal cost. All six are now
`evidence_state = 'QUARANTINED'` in production, with provenance in
`communication_log_evidence_event`. **Nothing was deleted and no message text was
altered.**

The database side is deployed. What is left is one field in each of two nodes.
Until those two fields change, **both AI readers still read the base table and
still receive the fabricated figure**, and the only thing standing between it and
a customer is the output guard — which is a prompt-and-regex layer, not evidence.

Measured with a real model on 6 Sep: with the prompt's `NO FINANCE FIGURES`
paragraph removed (the state the Slack Command Center is in today, and the state
any newly added agent starts in), the contaminated timeline produced

> "confirm the AED 11,200/month figure at 5.3%–6.7% APR is still the indicative
>  quote … *'Yes, confirming - AED 11,200 per month over 60 months with salary
>  transfer, at 5.3 to 6.7 percent APR.'*"

as the line the rep reads aloud. The same prompt on the admissible view could not
produce it: the number is not in the context.

## The two changes

Both are a single field. Neither adds, removes or reconnects a node.

### 1. `Lead Escalation - AI Agent` (`KI6P1Qcf3MIZakNa`), node `get_lead_timeline`

    parameters.tableId:  "communication_logs"  ->  "v_lead_timeline_admissible"

Everything else stays: `operation getAll`, `limit 20`, `orderBy created_at.desc`,
both filter conditions (`lead_email` from `$fromAI`, `tenant_id` from
`Fetch Escalated Lead`), `matchType allFilters`. The view exposes every column
the node reads plus `evidence_state` and `content_withheld`.

### 2. `WhatsApp BDC AI Agent` (`BiyHk9ZXxJUVGbf6`), node `Fetch Thread History`

    parameters.url:
      https://dsvuoovivysszdoiorch.supabase.co/rest/v1/communication_logs
      ->
      https://dsvuoovivysszdoiorch.supabase.co/rest/v1/v_lead_timeline_admissible

Query parameters unchanged (`select=direction,message,created_at,sent_by`, the
`or=(...)` identity filter, `tenant_id`, `order`, `limit=30`).

**This is the one that faces the customer.** Its output is interpolated into
`AI BDC Sales Agent`'s prompt beneath the sentence *"This is the real thread from
the CRM -- treat it as what was actually said"*. The customer-facing agent is
currently being told the fabricated figure is established fact.

## What NOT to change, and why

- **`Human Reply Check`** (same workflow) reads `communication_logs` and must
  keep reading it. It answers "has a human replied in the last 24h", filtering
  `sent_by not.in.(bot,drip,...)`. It is a control, not model context, and its
  `message` never reaches a prompt. Pointing it at the view would not be wrong
  today, but it would couple a rep-presence check to an evidence ruling for no
  benefit.
- **`Recent Outreach Check`** selects `id,created_at` only. No text, no figure.
- **`Log Conversation` / `Log Incoming Message`** are writers. The view is not
  insertable and they must keep POSTing to the base table.
- **Slack Command Center** does not read `communication_logs` at all — measured
  against its published definition, its only `tableId` is `leads`. Its finance
  exposure is real but it is a different defect and a different fix.

## The tombstone — read this before judging the diff

The view does **not** drop quarantined rows. It keeps the row, its timestamp and
its direction, and replaces only the message text with a tombstone naming the
reason.

That is not decoration. The first cut of this view did drop the rows, and the
escalation model then wrote, in a briefing a rep was about to read to the
customer: *"no figure was ever sent to him, so there is nothing on file to
confirm."* That is false — he was sent one — and it is CLAUDE.md's oldest defect
("a missing row is not proof the event did not happen") for the seventh time.
With the tombstone the same provoked run produced *"the earlier figure needs to
be re-run through the finance desk before it can be confirmed"*, which is true.

So if a future change makes this view filter rows out again, it reintroduces a
different lie in place of the one it removes.

## Verify after publishing

Against the **published** definition, not the draft:

1. `get_lead_timeline.tableId == 'v_lead_timeline_admissible'` in `activeVersion`.
2. `Fetch Thread History.url` ends `/rest/v1/v_lead_timeline_admissible`.
3. Run the escalation for `shabbir53ujjainwala@gmail.com`. The tool result must
   contain **no** `11 200`, **no** `5.3 %`, **no** `cost_aed`, and must contain
   four `[CONTENT WITHHELD AS INADMISSIBLE EVIDENCE]` entries for that lead.
4. `audit_log.summary` for that run carries no finance figure and no
   `finance_guard=redacted_*` marker — because with the evidence gone there is
   nothing for Guard Brief to redact. A `redacted_*` marker after this change
   means the model invented a figure rather than quoting one, which is a
   different problem and worth knowing.

## Rollback

Set the two fields back. The database objects can stay: with both nodes on the
base table the system is exactly as it is today.
