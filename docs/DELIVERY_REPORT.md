# Delivery Report — why every workflow now has one

*Added 26 Aug 2026.*

## The defect

One shape repeated in fourteen places across the system:

```
[ something is really sent, or really deleted ]
        │
[ a node that records it, with onError: "continueRegularOutput" ]
        │
[ a terminal node that writes status: 'SUCCESS' without looking ]
```

`continueRegularOutput` does not mean "this cannot fail". It means a failed HTTP
node does not fail the run: n8n emits an item shaped `{ error: … }` on the main
output and execution carries on. Nothing downstream ever read that key. So the
WhatsApp reply silently did not go, or the `communication_logs` row silently did
not land — and the execution finished green, and the dashboard stayed calm.

That is the whole explanation for "messages were dropping while the dashboard
looked healthy". The dashboard was not wrong about what it was reading. What it
was reading was a row that had been written by a node that never checked.

**The swallow itself is usually correct.** A logging failure should not abort a
customer conversation. What was wrong was the *claim* made afterwards. So the
swallowing stays and the lying stops.

## The fix

A Code node named `Delivery Report` sits immediately before each terminal node.
It holds an explicit list of every node whose success that terminal node is about
to assert, checks each one, and emits a verdict the terminal node must use:

| status    | meaning |
|-----------|---------|
| `SUCCESS` | every claimed step verified |
| `PARTIAL` | bookkeeping was lost — named, never hidden |
| `FAILED`  | a customer-visible or irreversible step did not land |

`critical: true` marks the acts that cannot be quietly lost: a WhatsApp send, an
email, a Slack post, a storage delete, a CRM write. `critical: false` marks
bookkeeping — its loss downgrades to `PARTIAL` rather than `FAILED`, but the
dropped step is always named in `delivery.dropped` and appended to the audit
summary, because a count nobody can explain is a count nobody reads.

### Two traps it is built around

`$('Some Node')` **throws** when that node did not run on this branch, and `?.`
cannot rescue it. Every lookup is therefore inside a `try/catch` that reports
`did not run on this branch` instead of taking the run down. This matters most on
branching workflows — KYC has five terminal nodes and each one claims only the
sends on its own branch.

`audit_log.status` carries a CHECK constraint — `status = upper(status)` — so
`PARTIAL` is legal but only in upper case. `kyc_documents.verdict` is a closed
vocabulary (`PENDING|APPROVED|REJECTED|ESCALATED`), so the honest delivery status
is appended to `remarks` there rather than overwriting the verdict.

## Where it landed

| Workflow | What it used to assert without looking |
|---|---|
| WhatsApp BDC | the reply reached the customer |
| WhatsApp Send (Dashboard Reply) | `status: "sent"` returned to the rep's browser |
| Phase 6 Silence Detector | the lead was escalated *and* marked, so it is never chased again |
| Lead Escalation | `escalated: true` returned to the Silence Detector that believes it |
| KYC/AML (×5 branches) | `APPROVED` on a document Storage may never have retained |
| 7-Day Warm Drip | seven days of sends, judged by one hardcoded string |
| Master Router | the escalation, the CRM write and the WhatsApp message all landed |
| wf_108 ERP Sync | the Bitrix24 write, and the dedupe lookup that prevents duplicates |
| Competitor Scraping | the intel row — the run's entire product |
| Retention Purge | AML compliance for an irreversible delete |
| Ask-AI | the answer reached the caller |
| Customer 360 | "0 emails, 0 mentions" — indistinguishable from an outage |
| Slack Command Center | the answer was posted where the person typed the command |
| Sync Closed-Won → pgvector | the vector upsert |

`Inventory Ageing Recompute` was examined and left alone: its RPC node has no
`onError` override, so a non-2xx throws and the run stops before anything is
logged. Reaching its audit row genuinely means the recompute succeeded. There was
no defect there and none was invented.
