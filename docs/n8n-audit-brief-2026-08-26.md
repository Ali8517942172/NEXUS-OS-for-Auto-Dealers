# NEXUS OS — full n8n workflow audit, 26 Aug 2026

You are auditing **exported JSON files on local disk**. Every workflow is in
`/tmp/wf-audit/` — one file per workflow, plus `_index.json` and
`_executions.json` (the last 20 runs of each).

## HARD RULE, no exceptions

**Do not make ANY network call to n8n, Supabase, WAHA or OpenRouter.**
Do not curl, do not use MCP tools, do not "just check one thing" against the
live system. That VM is a 1-vCPU e2-micro; it has been crashed twice, it goes
CPU-starved several times a day, and four hours ago a burst of traffic orphaned
29 executions. Five agents probing it in parallel is exactly how it goes down
again. Everything you need is in the exported JSON. Read only.

**Report findings. Do not fix anything.** Editing a workflow means writing to
that box. Findings come back to the coordinator, who applies them serially.

## What the system is

A single-dealership automation OS. WhatsApp messages arrive via WAHA into the
BDC agent; a Master Router scores leads; escalations go to Slack and Gmail; KYC
documents are audited by a vision model; a dashboard reads Supabase. **There is
exactly one real customer** — Shabbir Ujjainwala, shabbir53ujjainwala@gmail.com,
+918517942172, chat `158510264357112@lid`. Everything else was deleted on
24 Aug after a full export.

## The specific traps this system has already been bitten by

Check every one of these on every node you touch. These are not hypotheticals —
each cost real production time in the last two weeks.

1. **An IF node handed ZERO items routes to NEITHER branch.** It produces
   nothing and the run ends **green**. This turned a failed lead lookup into a
   2-second "success" that sent no email and logged nothing. Wherever a node can
   legitimately return zero rows and an IF follows it, the upstream node needs
   `alwaysOutputData: true` or the silence is invisible. **Look for this
   everywhere.**

2. **`executionTimeout` does NOT reap an orphaned execution.** It bounds a slow
   one. Proven: two duplicate deliveries one second apart, same 300s ceiling —
   one errored at 235s, the other sat "running" 67 minutes.

3. **A Code node runs on n8n's task runner**, which starves on 1 vCPU
   ("Task execution aborted because runner became unresponsive"). Set and IF
   nodes evaluate in the main process. **Flag every Code node** and say whether
   its work could be done by Set/IF instead.

4. **`$('Some Node')` THROWS when that node did not run in this execution** — it
   does not return undefined, so `?.` and `||` cannot rescue it. Any expression
   or Code node referencing a node on a different branch is a latent crash.
   Flag every one and say which entry path leaves it unreached.

5. **An HTTP node's output REPLACES the item.** Anything downstream that expects
   the original fields is broken unless the data is re-attached.

6. **Free OpenRouter model ids get retired without warning** and answer 404 only
   when actually used. Four were found dead today. Flag any hardcoded model id.

7. **`$now.toISO()` emits `+04:00`**, which PostgREST decodes as a space in a
   query string. It must be `.toUTC().toISO()`.

8. **PostgREST rejects the WHOLE query on an unknown column** (42703). The real
   column lists are below — check every `select=`, filter and insert body.

9. **Multiple triggers make "Execute workflow" ambiguous** — n8n picks one, not
   necessarily the one you meant.

10. **A `respondToWebhook` on only one branch** means the other branch leaves the
    caller hanging or returns a raw 500 instead of the documented shape.

## The real database columns (probed live — trust this, not your memory)

    leads               id, name, email, phone, status, ai_score, source,
                        vehicle_interest, budget_aed, assigned_to, assigned_to_id,
                        response_time_minutes, escalated_at, created_at
                        NO lead_score, NO updated_at
    inventory           id, model, vin, status, acquired_at, cost_aed, price_aed,
                        days_in_stock, holding_cost_accrued, gross_margin,
                        net_margin, vat_amount, aging_alert, ai_recommendation,
                        recommended_commission
                        NO stock_id, make, year, colour, sold_at
    communication_logs  id, lead_email, direction, message, channel, created_at
    kyc_documents       id, lead_email, lead_name, chat_id, document_type,
                        full_name, date_of_birth, expiry_date, is_valid, tampering,
                        confidence_score, remarks, attempt_number, max_attempts,
                        verdict, reviewed_by, reviewed_at, storage_path,
                        retain_until, purged_at, void_reason, voided_at, created_at
    audit_log           id, workflow, status, lead_name, lead_email, lead_score,
                        intent, summary, logged_at
    users               id, name, email, role, status, slack_user_id, created_at
                        NO phone
    processed_messages  chat_id, message_id, source, processed_at
    whatsapp_contacts   chat_id, phone, push_name, lead_email, first_seen,
                        last_seen, message_count
    finance_quotes      id, lead_email, lead_name, vehicle_value_aed,
                        loan_payoff_aed, equity_aed, equity_status,
                        loan_to_value_pct, indicative_apr_pct, finance_tier,
                        credit_score, disclaimer, quoted_by, source, created_at
    purchase_history    id, deal_id, customer_name, email, phone, vehicle,
                        amount_aed, purchase_date, created_at
    competitors         id, competitor, model, our_price_aed, price_aed,
                        price_diff_aed, scraped_at, ai_recommendation
    rag_documents       id, doc_title, source_file, section, page_number,
                        content, search_vector          NO created_at
    deals_embeddings    id, deal_id, content, embedding, created_at
    customer_360_profiles id, customer_id, name, email, phone, total_emails,
                        total_slack_messages, last_synced_at
    workflow_registry   id, name, audit_name, audit_aliases, category,
                        trigger_type, trigger_detail, description, is_active,
                        writes_audit_log

## For EVERY node, check and report

- **credentials** — referenced but plausibly wrong or shared oddly; a node that
  needs one and has none
- **onError** — `stopWorkflow` / `continueRegularOutput` / `continueErrorOutput`:
  is it right? A node whose failure should stop the run but continues, or one
  whose failure is survivable but stops it
- **retryOnFail / maxTries / waitBetweenTries** — missing on a network call
- **HTTP timeout** — a node with no timeout can hang forever
- **alwaysOutputData** — see trap 1
- **disconnected nodes** — present in `nodes` but absent from `connections`, or
  connected from something that never runs
- **hardcoded values** that should be dynamic (emails, chat ids, channel ids,
  model names, URLs, table names)
- **expressions** that reference a node on another branch (trap 4)
- **`respondToWebhook` coverage** on every branch of a webhook workflow

## For EVERY workflow, check and report

- `settings`: `executionTimeout`, `errorWorkflow`, `saveDataErrorExecution`,
  `saveDataSuccessExecution`, `saveExecutionProgress`, `timezone`
  — **the 7-Day Warm Lead Drip must have NO executionTimeout** (its Wait Day
  1/3/5/7 nodes hold one execution open for a week). Every other workflow should
  have 300.
- number and kind of triggers (trap 9)
- whether `_executions.json` shows it actually running, and what its failures say
- cron expressions: n8n fires them in the workflow's OWN timezone. The scraper is
  `0 5 * * *` in `Asia/Dubai` = 01:00 UTC.

## Output

A findings list, **most severe first**. For each: workflow, node, what is wrong,
what would happen in production, and how confident you are. Separate
**CONFIRMED** (you can point at the JSON) from **SUSPECTED** (needs a live check
the coordinator will do). Say plainly if a workflow is clean — do not invent
findings to fill a report.
