# RISKS — what could break, what is unverified, what to check after applying

Nothing here was executed against the live instance. Every claim below is from
reading `/home/claude/audit/n8n-workflows/*.json` and `/home/claude/audit/supabase/*.sql`.

---

## 1. The first run after this change will be loud

Defect 1 has been suppressing WhatsApp-only leads since the workflow was written.
Fixing it releases the whole accumulated backlog at once. The run is capped at
`MAX_PER_RUN = 8` escalations/hour, so the backlog drains at up to ~192/day —
each one an AI briefing, a Slack post to `C0BKTLL1X54`, a Gmail alert to
`aliasgher892@gmail.com` and a `leads.escalated_at` write, all for conversations
that may be months old and already dead.

**Before enabling on the hour**, run `Find Silent Leads` alone (Run Manually →
let it reach the code node, then stop) and read the item count. If it is large,
either raise `SILENCE_HOURS`, lower `MAX_SILENCE_HOURS` (currently 40 days) for
one pass to drain only recent silences, or backfill `[SILENCE-ESCALATED]` markers
for the historic tail before the first live run.

## 2. Leads with `status IS NULL` are still excluded — before and after

PostgREST `neq` does not match NULL. Under the old `anyFilter` OR, a NULL-status
lead failed both conditions and was excluded; under `allFilters` it still is.
This change does **not** regress it, but it does **not** fix it either, and it is
invisible in the n8n UI. If `select count(*) from leads where status is null` is
non-zero, replace the Supabase node with an HTTP Request using
`or=(status.is.null,status.not.in.("LOST","DISQUALIFIED","WON"))`.

## 3. Parameter keys that could not be verified against this n8n build

* `matchType: "allFilters"` on the Supabase node — copied verbatim from a working
  node in the same estate (`find_available_rep`, `lead_escalation_ai_agent.json`).
  Confident.
* `condition: "gte"` on `created_at` in the Supabase node's filter list — **not
  used anywhere in this estate**. If the node rejects it, or silently ignores it,
  the 40-day window is not applied and `Fetch Recent Comms` reverts to pulling the
  whole table. Verify by comparing the node's output item count before and after.
  Fallback: an HTTP Request node with
  `?select=lead_email,direction,message,created_at&created_at=gte.<iso>&order=created_at.desc`,
  which also adds column projection — the Supabase node has no `select`, so message
  bodies are still transferred in full and the 958 MB box still pays for them.
* `n8n-nodes-base.if` typeVersion 2.2 with a boolean `true` operator on an
  expression `leftValue`. If your build objects, the equivalent is a string
  `notEmpty` on `={{ $json.escalated === true ? 'yes' : '' }}`.
* `setNodeSettings` is assumed to *replace* the node's settings, so each op
  restates the full set (retry/maxTries/waitBetweenTries/alwaysOutputData/onError)
  rather than the one field that changed. If it merges instead, the result is the
  same.

## 4. `whatsapp_contacts` may be almost empty

The pre-flight notes count **1 row** in `whatsapp_contacts`. It is populated only
by `Upsert WhatsApp Contact` in the BDC workflow, going forward. Until it fills,
the `@lid` bridge resolves almost nothing — a lead whose entire history is filed
under a LID chat id stays invisible to the detector. Non-LID WhatsApp keys
(`@c.us`, `+…@whatsapp.lead`, bare digits) do not depend on it. There is no
schema file for this table in `/home/claude/audit/supabase/`; column names
(`chat_id`, `phone`, `lead_email`) are taken from the upsert body and the
dashboard's `customers.js`. **Check the table exists and RLS/service-role access
works** — if the fetch 404s the node returns an error item, which the code node
filters out, and the run continues degraded rather than failing loudly.

## 5. `direction: 'internal'` on the marker row

No CHECK constraint exists in `supabase/create_missing_tables.sql` — `direction`
is plain `text` with a comment listing `'inbound' | 'outbound'`. If a constraint
or enum was added later out of band, the marker insert will 400. `Mark as
Escalated` has `onError: continueRegularOutput`, so the run survives, `Delivery
Report` reports PARTIAL, and the lead is simply re-escalated next hour — noisy,
not silent. Also check any dashboard screen or report that buckets
`communication_logs` by `direction`: an `'internal'` row will fall outside both
buckets, which is the intent, but a chart summing the two will no longer equal
the row count.

## 6. Sub-workflow return semantics — the one thing I could not verify

The gate now trusts `$json.escalated` from `Trigger Lead Escalation`. That value
is whatever n8n hands back as the sub-workflow's output, which is the data of the
**last node that ran**. `Return Result` has two incoming edges and therefore two
runs; moving it to `[1660, 720]` should make it last under `executionOrder: v1`
(fan-out by y-position), so the run the caller reads is the one that can see
`Delivery Report`. I could not confirm n8n's exact behaviour for a multi-run node
as the workflow's return value offline.

If it goes the other way, the failure is *conservative*: the caller sees
`escalated:false`, the marker is not written, and the lead is escalated again
next hour. Loud, not silent. **Check on the first live run:** open the Phase 6
execution, look at `Trigger Lead Escalation`'s output item and confirm
`status:'escalated'` / `escalated:true` for a lead whose Slack and email both
landed. If it reads `escalation_unverified`, the ordering did not take and the
next step is to make `Return Result` single-entry (delete the
`Send a message → Return Result` edge, leaving `Delivery Report → Return Result`
as the only path).

## 7. Loop-scoped `$('node')` lookups

`Delivery Report` and `Audit Log` read `$('Loop Over Silent Leads').item` and
`$('Trigger Lead Escalation')`. Inside a `splitInBatches` loop, `$('Node').all()`
returns the *latest* run of that node, not this iteration's — which is why the
false branch reports the marker as "deliberately skipped" instead of probing
`Mark as Escalated`. The remaining exposure is `Audit Log`, which fires per
iteration and depends on the report/audit branch completing before the loop-back;
that is what the y-position moves guarantee. **Check after applying:** with 2+
silent leads in one run, confirm `audit_log` has one row per lead and that
`lead_email` in each row matches the lead named in the matching Slack post.

## 8. Concurrency

There is still no cross-run lock. Two overlapping hourly runs can both select the
same lead before either writes its marker, producing a double escalation. The
`MAX_PER_RUN = 8` cap plus the 40-day window make a run short enough that overlap
is unlikely at hourly cadence, but it is mitigation, not a fix. The durable fix is
a concurrency limit on the workflow (or an advisory lock keyed on lead email
before the escalation call) and is out of scope here.

## 9. Blast radius on the escalation workflow

`KI6P1Qcf3MIZakNa` is shared with the Master Router's hot-lead path. Three
changes touch it: one agent prompt expression, one node position, one node's
error settings. The trigger's `inputSource` is deliberately **not** touched — see
DESIGN.md §Defect 2. **Regression check after applying:** fire one HOT lead
through the Master Router and confirm it still posts to `C0BJ5PLTPDJ` headed
":fire: *Hot Lead*", and that `Fetch Escalated Lead` still resolves via
`$json.lead.email`.

## 10. Post-apply checklist

1. `Fetch Open Leads` returns fewer rows than before (WON now excluded) and no
   longer returns everything unconditionally.
2. `Fetch Recent Comms` item count drops sharply; run duration drops with it.
3. `Find Silent Leads` output now contains WhatsApp leads — check `matched_on`
   on an item to see which identity key hit.
4. Every item carries a non-empty `reason`.
5. One escalation lands in `C0BKTLL1X54` headed ":rotating_light: *Escalated Lead
   Alert*", and the AI briefing mentions re-engagement / the silence window.
6. `communication_logs` gets exactly one `[SILENCE-ESCALATED]` row per successful
   escalation, `direction = 'internal'`, and **none** for a failed one.
7. Force a failure (revoke the Gmail credential for one run): confirm the audit
   row says FAILED, no marker row is written, and the same lead is escalated
   again on the next run.
8. Re-run within the hour: no lead is escalated twice.
