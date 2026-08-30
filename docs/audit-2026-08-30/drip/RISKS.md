# Risks, unverifiable assumptions, and the post-apply checklist

Everything below was reasoned from files only. No live n8n, Supabase or device tool was touched.

---

## 1. What could break

### 1.1 Executions already suspended in a `Wait` when this is applied — the sharpest edge
A drip enrolled before this change is sitting in a `Wait` node right now. When it resumes it may run
against the **new** graph, and its `Normalize Lead Input` ran under the **old** code, so
`enrolled_at` is `undefined`. `created_at=gt.undefined` is a PostgREST **400**, the read node throws,
and a live enrolment dies mid-sequence.

*Mitigation already in the design:* the `created_at` expression falls back to eight days ago when
`enrolled_at` is absent —
`'gt.' + ($('Normalize Lead Input').first().json.enrolled_at || new Date(Date.now() - 8*86400000).toISOString())`.
Eight days covers the whole sequence window, so a reply anywhere inside it still stops the drip. The
fallback is deliberately not the epoch: every WhatsApp-sourced lead has old inbound history, and an
epoch floor would stop every in-flight drip on contact that predates enrolment.

*Residual risk:* an in-flight lead whose only reply is older than 8 days but newer than its
enrolment (only possible for an enrolment older than 8 days, i.e. already past day 7) is unaffected
in practice. **Check for suspended executions before applying** (checklist item 1).

### 1.2 `+` in the `or=(...)` filter
One identity key is `+<digits>@whatsapp.lead`. In a URL query string a raw `+` decodes to a space. The
n8n HTTP node serialises `queryParameters` and should emit `%2B`, and `Fetch Thread History` in
`whatsapp_bdc_ai_agent.json` has relied on exactly this for months — which is why the pattern was
copied rather than re-invented. **This was not verified against a live request.** If it is wrong, it
is wrong there too, and the symptom is benign in one direction: the key silently matches nothing, the
gate misses a reply logged under the synthesised address, and the drip continues. Checklist item 4
tests it directly.

### 1.3 The roster now shows two rows per completed enrolment
`campaigns.js:354` does `r.runs++` for every drip `audit_log` row, so a completed sequence will read
"2 runs" (`ENROLLED` + the completion row) and an early exit will read "2 runs" as well. The count is
cosmetic — `r.first` (enrolment) and `r.last` (outcome) are what the screen actually reasons with,
and both become *more* correct. The dashboard-side follow-up is one line: count only rows whose
`status !== 'ENROLLED'` (`campaigns.js:348-358`).

### 1.4 The "no mail logged" alert will fire on fresh enrolments
Because enrolments now appear on the roster immediately, `zeroSend` (`campaigns.js:464`) will flag
every enrolment during its first 24 hours — correctly, since no mail has been sent yet, but as red
where nothing is wrong. This is a direct consequence of making the roster truthful. The dashboard fix
is to exempt enrolments younger than the first `Wait` (1 day). Worth saying to whoever owns that
screen before they see it.

### 1.5 A case-mismatched email stops the sequence
`Lead State (Day N)` matches `email=eq.<email>` and Postgres `eq` is case-sensitive. The dashboard
posts `lead.email` straight from the `leads` row it read, so it matches exactly; the Master Router
path passes the same value it upserts. But if any caller ever normalises case, the gate finds zero
rows and reports "the lead row no longer exists" — a false stop. It fails **closed** (nothing is
sent) and it is loud (an audit row naming the reason), which is the right direction, but it would be
a wrong reason. If this ever appears, change the filter to `ilike` rather than widening the terminal
list.

### 1.6 Supabase unavailable at a gate kills the enrolment
By design (`onError: stopWorkflow` after 3 retries). The execution fails, `errorWorkflow`
`iYJkh1kztWxZXDbT` fires, and no audit row is written for that enrolment — so a lead that died this
way is **invisible on the roster as anything but a stale enrolment**. That is the accepted cost of
never mailing on stale information. If the box's Supabase reachability turns out to be flaky, the
correct answer is a retry/resume policy, not `continueRegularOutput`.

### 1.7 `@lid` replies are not matched
A WhatsApp LID chat id contains no phone digits and cannot be derived from anything in `leads`
(`Resolve Lead Identity` says so explicitly). If an inbound reply is logged under a bare `<opaque>@lid`
key — which happens only when the sender's number could not be matched to a lead — this gate will not
see it and the drip will continue. Nothing in the database closes that gap today; closing it needs a
`lead_lid` column or an identity table, which is a schema change, not a workflow change.

### 1.8 The change is atomic, so a stale export is safe
`OPERATIONS.json` was built against an export dated 30 Aug 04:11. If the live workflow has drifted,
a `removeConnection` or `setNodePosition` naming a node that no longer exists will fail and
`update_workflow` saves **nothing**. Re-export and regenerate rather than forcing.

---

## 2. What could NOT be verified from files

| Assumption | Why it matters | How to settle it |
|---|---|---|
| `alwaysOutputData: true` makes a zero-row HTTP node emit exactly one empty item | The whole "no reply" path depends on it. If it emitted nothing, the branch would die silently and no audit row would be written. | Checklist item 3 |
| n8n splits a PostgREST JSON array response into one item per row | `.all().filter(r => r.id)` assumes it. `Fetch Thread History` in `whatsapp_bdc_ai_agent.json` already depends on this behaviour. | Checklist item 3 |
| A resumed execution restores `$('Normalize Lead Input')` including the new `enrolled_at` | Already true for `name`/`email`/`vehicle_interest` after every Wait in this workflow today, so it is behaviour this workflow has proven — but not proven for a field added today. | Checklist item 5 |
| `audit_log.status` accepts `'ENROLLED'` | `status text` with no CHECK constraint in `supabase/create_missing_tables.sql:16`. | Checklist item 2 |
| Completed runs currently write `lead_email: null` | Inferred from `Prefer: return=minimal` on `Log Final Offer Email` → empty body → empty item spread into `Delivery Report`. Never observed. | `select lead_email from audit_log where workflow = '7-Day Warm Lead Drip' order by logged_at desc limit 5;` — if they are already populated, the `Delivery Report` change is harmless belt-and-braces. |
| The live `leads` table has `id, name, email, phone, status` | Two conflicting schema files exist (`architecture/supabase_schema.sql` says `first_name`/`last_name`/`phone_number`; `architecture/database_schema.sql` says `name`/`phone`). The column set used here is the one **every other workflow** reads and writes (`nexus_master_lead_router_ai_agent.json` upserts `name, email, phone, status, ai_score, budget_aed`), so `supabase_schema.sql` is stale. | `list_tables` or one `select … limit 1`. |
| The terminal-status list covers the vocabulary in use | Observed in the workflows: `HOT, WARM, COLD, CONTACTED, QUALIFIED, WON, LOST, DISQUALIFIED` (+ lowercase `new`). All comparisons are upper-cased and trimmed, so `lost` and `Lost` are caught. Values outside the list are treated as live. | `select distinct status from leads;` — add anything terminal that appears. |
| WAHA reachability / the Gmail credential | Untouched by this change, and both were already reported broken elsewhere in the audit. A dead Gmail credential still fails the run exactly as it does today. | — |

---

## 3. What to check after applying

Run these in order. Stop at the first one that fails; the change is a single atomic version and can be
rolled back with `get_workflow_history` / `restore_workflow_version`.

1. **Before applying — find suspended executions.**
   `search_executions` for workflow `G7FhvMY2ucW5Fg7X` with status `waiting`. If any exist, either
   let them finish (up to 7 days) or accept §1.1: they resume against the new graph and rely on the
   8-day fallback. Record how many there were.

2. **Validate, then read one enrolment row.**
   `validate_workflow` on `G7FhvMY2ucW5Fg7X` — expect no errors and 36 nodes. Then enrol one test
   lead (a real `leads` row you own, with a real email and a phone, status `WARM`) via
   `POST /webhook/lead-trigger`, and within a minute:
   `select status, lead_email, lead_name, summary, logged_at from audit_log where workflow = '7-Day Warm Lead Drip' order by logged_at desc limit 3;`
   Expect a row with `status = 'ENROLLED'`, the lead's email in `lead_email`, and `logged_at` equal
   to *now* — not seven days from now. Confirm the Campaigns screen shows that person under
   "Who is enrolled" **the same minute**.

3. **Confirm the zero-row shape.** Open the execution in n8n and look at
   `Replies Since Enrol (Day 1)`: it should show **one item with empty JSON**, and
   `Still Enrolled? (Day 1)` should have taken the **true** output. If the replies node shows zero
   items and the execution ends there, `alwaysOutputData` did not take — re-apply that
   `setNodeSettings` operation and re-test before trusting anything else.

4. **Test the identity filter directly, before trusting the reply gate.** In the n8n execution, copy
   the resolved `or` parameter out of `Replies Since Enrol (Day 1)`'s request and confirm it reads
   `(lead_email.eq.<email>,lead_email.eq.<digits>@c.us,lead_email.eq.+<digits>@whatsapp.lead)` and
   that the `+` went out as `%2B`. Then insert an inbound row under **each** of the three keys in
   turn and confirm each one alone stops the sequence.

5. **The real test — reply mid-sequence.** With the test lead enrolled, insert
   `{lead_email: '<the lead email>', channel: 'whatsapp', direction: 'inbound', message: 'test reply', created_at: now()}`
   into `communication_logs`, then let the day-1 gate run (or temporarily set `Wait Day 1` to
   1 minute **in a duplicate of the workflow**, never in this one). Expect: the day-1 email is
   **not** sent, and exactly **one** new `audit_log` row appears with `status = 'PARTIAL'` and a
   summary beginning `Stopped before the day-1 welcome - the customer replied on …`. Also confirm
   `enrolled_at` survived the Wait — if the reason instead says "the lead row no longer exists",
   the resumed execution lost the field (§2).

6. **Test the terminal exit.** Enrol a second test lead, set its status to `WON`, let the gate run.
   Expect the same shape with `the lead status is WON, which is terminal`, and `verified: []`.

7. **Test the phone fix — the whole point of the second defect.** Enrol from the **dashboard**
   (which sends no phone) a lead that has a phone in `leads`. At the day-1 gate, confirm
   `Has WhatsApp? (Day 1)` takes the **true** branch and `WhatsApp: Welcome` posts a `chatId` of
   `<digits>@c.us`. Before this change it always took the false branch.

8. **Confirm the happy path still completes unchanged.** One lead through all four gates: four
   `Lead State` / `Replies Since Enrol` pairs all green, all four sends fired, and exactly two
   `audit_log` rows — `ENROLLED`, then `SUCCESS` with a summary beginning `Completed - `. If the
   completion row's `status` is `PARTIAL`, read `delivery.dropped` — that is `Delivery Report`
   reporting a real send that did not land, not a fault in this change.

9. **Confirm nothing was added that shouldn't be.** `get_workflow_details` and check
   `settings.executionTimeout` is still **unset**. A five-minute ceiling on this workflow kills every
   enrolment four minutes into the first wait while the webhook still answers 200.

10. **Watch the box.** After the first day of live enrolments, confirm n8n's execution list shows no
    new failures on `G7FhvMY2ucW5Fg7X` and that the e2-micro is not queueing at concurrency 2. The
    change adds 8 short reads per enrolment spread over 7 days; if that shows up in load, the problem
    is elsewhere.
