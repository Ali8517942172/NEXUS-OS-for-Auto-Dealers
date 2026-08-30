# DESIGN — KYC document privacy

Companion to `RESEARCH.md`. Every factual claim used here is cited there.

Two files of operations accompany this document:

- **`OPERATIONS_kyc.json`** — apply now. No owner decision required. A JSON **array of two complete `update_workflow` argument objects** (the KYC workflow `qTnh3nwWheFJbFkU`, and a one-operation companion for the BDC workflow `BiyHk9ZXxJUVGbf6`). Apply them in order.
- **`OPERATIONS_kyc_vision.json`** — **do not apply without the owner's sign-off.** It changes where customers' ID documents are sent, and it costs money (a very small amount). That is his call, not mine. See `OWNER_DECISION.md`.

---

## 1. The primary problem, and my recommendation

Right now the dealership sends photographs of customers' passports and Emirates IDs to free AI endpoints whose provider — in OpenRouter's own words — is likely to *"train on, or … publish, the prompts they receive"*. One of the three configured routes is Google AI Studio's unpaid tier, whose terms say in plain words: *"Do not submit sensitive, confidential, or personal information to the Unpaid Services"* and *"human reviewers may read, annotate, and process your API input and output."*

I checked whether this can be fixed with a setting. It cannot. OpenRouter does expose exactly the switch you would want — `provider: {"data_collection": "deny"}` and `provider: {"zdr": true}` — but of the 8 free vision-capable models on OpenRouter on 30 August 2026, **zero** are on the zero-data-retention endpoint list. Turning the switch on does not make the call private; it makes the call return 404.

So the honest framing is: there is no configuration of the free tier in which a passport is safe to send. The choice is between **not sending it** and **paying a trivial amount not to send it to a free endpoint**.

### Recommended: Option F — same model, paid ZDR endpoint

Switch `OpenRouter Vision (KYC Analysis)` from the three `:free` slugs to the **paid** `google/gemma-4-26b-a4b-it` — the same model that is already third in the current fallback list — with `provider: {"zdr": true, "data_collection": "deny"}` and no `models` fallback array (a fallback array is exactly what would silently drop the request back onto a free endpoint).

Why this and not the others:

- **Capability cost: none.** Same model family, same vision capability, same prompt, same output shape. Nothing downstream changes.
- **Cost: ≈ $0.19 per thousand documents.** A $10 top-up covers years and, as a side effect, lifts the free-model rate limit across the rest of NEXUS from 50/day to 1,000/day.
- It is the only option that keeps the 3-second automated verdict *and* stops the transfer to a training endpoint.
- It removes the single-provider fragility of the current setup as a bonus: 128 ZDR image-capable endpoints exist, so a replacement is one string away.

It breaks the stated "free tier only" constraint. I am recommending it anyway, explicitly and with the number attached, because the constraint was set for a system that routes marketing leads, and this node routes passports. A ten-dollar constraint should not decide where a customer's identity document goes. **The owner gets to disagree** — that is what `OWNER_DECISION.md` is for.

### Fallback if the owner will not spend anything: Option E — route to a human

Stop the automated vision call. On receipt of a KYC document: archive it (unchanged), then post a notification to the compliance Slack channel and let a named person open the stored document and record a verdict. The re-upload loop, the attempt counter and all the customer messaging stay exactly as they are — they are driven by a verdict, and a human can supply one.

- **Capability lost:** the instant verdict. Turnaround goes from ~3 seconds to however long it takes someone to look. The auto re-ask loop only advances when a human acts.
- **Cost:** roughly 30 seconds of staff attention per document.
- **Not included in these operation files.** It is a build (new nodes, rewiring of the `Validation Check` input, a verdict-capture path), not a settings change, and shipping a half-designed rewire would be worse than shipping nothing. If the owner picks this, it is the next piece of work.

### Rejected

- **Option B — guardrail on, free models kept.** `zdr: true` with free models returns 404 on every request. As a *deliberate* fail-closed it is coherent (better silence than a leaked passport), but it is Option E without the human, so customers who send documents simply get nothing. Rejected as a standalone answer; it is however what `OPERATIONS_kyc_vision.json` degrades to if the owner insists on free models, and I have made that degradation safe rather than silent (see §2.2).
- **Option C — a different free provider with better terms.** I looked. I could not evidence one. I am not going to name a vendor whose free-tier terms I have not read.
- **Option D — ask the model for less.** Sending a passport and asking only "yes/no" still sends the passport. It fixes the free-text leak, which I am fixing anyway in `OPERATIONS_kyc.json` by a means that costs no capability. On its own it is a half-fix that would feel like a whole one, which makes it the most dangerous option on the list.

---

## 2. Secondary leak 1 — raw ID images in n8n's execution store

**Mechanism.** `saveDataErrorExecution: "all"`. `Auth Gate` *throws* on a bad token, so an unauthenticated POST carrying a passport writes the full base64 into n8n's execution store on the e2-micro and forwards it to the error workflow. A free-model 429 does the same, and on a 50-requests-per-day free ceiling that is routine, not exceptional.

### 2.1 Stop storing it (ops 1 and 2 of call 1; call 2 entirely)

`setWorkflowSettings` → `saveDataErrorExecution: "none"`, with every other current setting restated verbatim so nothing else is clobbered (notably `errorWorkflow: iYJkh1kztWxZXDbT`, `timezone: Asia/Dubai`, `callerPolicy`, `executionTimeout: 300`).

**The same change is required on `whatsapp_bdc_ai_agent` (`BiyHk9ZXxJUVGbf6`).** Its node `Send to KYC Auditor` passes `document_base64` into the sub-workflow and that workflow *also* carries `saveDataErrorExecution: "all"`. Fixing only the KYC workflow leaves an identical copy of every passport in the caller's error store. This is call 2 in `OPERATIONS_kyc.json`, and it is the reason that file is an array rather than a single object.

**What is lost:** post-mortem debugging of failed KYC runs from the n8n UI. Mitigated — the error workflow `NEXUS Error Handler` still fires and still writes workflow name, error message, failing node, execution id and URL to `audit_log`. Failures stay visible; only the payload stops being kept. For a workflow whose payload is a passport, that is the correct trade.

### 2.2 Stop *generating* the failure in the first place (ops 3–5 of call 1)

Belt and braces. A free-model 429 or a `zdr`-induced 404 should not be an exception at all.

- `setNodeSettings` on `OpenRouter Vision (KYC Analysis)`: `onError: continueRegularOutput`, `alwaysOutputData: true`, retries unchanged (3 × 3000ms). The error now arrives as data, and `Parse JSON Output` already handles `response.error`.
- **But that exposes an existing untruth**, which must be fixed in the same change or this makes things worse. Today `Parse JSON Output`'s `fail()` path returns `isIdentityDocument: false`, which routes to the non-document branch, and `Record Non-Document` then writes `document_type: 'NOT_A_DOCUMENT'` with the remark *"The image was not a government-issued identity document"*. That would be the system asserting a fact about a customer's passport that no model ever gave it. The workflow's own stated principle — "when in doubt it must not speak" — is violated by a row, not a message.
  - `Parse JSON Output` is replaced to distinguish the two cases: a genuine `isIdentityDocument: false` verdict, versus `auditUnavailable: true` with an `auditFailureReason`. It also clamps the model's `remarks` to 300 characters.
  - `Record Non-Document` is replaced to branch on that flag: verdict `ESCALATED` (a value this workflow already writes elsewhere, so no schema risk), `document_type: null`, an honest remark naming the real cause, and no `void_reason` / `voided_at`. Neither branch sends the customer anything, which is already correct.

**Schema caution, stated rather than assumed:** no DDL for `kyc_documents` exists in `/home/claude/audit/`, so I could not verify the `verdict` column's permitted values. I deliberately reused `ESCALATED`, which the live workflow already inserts, instead of inventing `PENDING_REVIEW`. If the column turns out to be free text, `PENDING_REVIEW` would read better and is a one-word edit.

**Follow-up not included:** those `ESCALATED`-with-no-audit rows are currently written silently. If free-model 429s are frequent, they will pile up unseen and a customer who sent a passport gets no reply at all. A Slack alert on that path is worth adding — but it is a new node and a behaviour change, so it is named here rather than smuggled into the ops file.

---

## 3. Secondary leak 2 — model free text carrying PII into `communication_logs`

**Mechanism, and it is worse than it first looks.** `Decide: Re-ask or Escalate` sets `reason = parsed.remarks || …`. That model-authored string goes into the WhatsApp body *and* into `communication_logs.message`. And `communication_logs` is read back by `whatsapp_bdc_ai_agent` node `Fetch Thread History` (`select=direction,message,created_at`, last 12 rows), which feeds `AI BDC Sales Agent`. So a model that echoes "Name: … DOB: … ID 784-…" into `remarks` causes that PII to be (1) messaged to the customer, (2) stored in the general comms table, and (3) **re-sent to a third-party LLM on every subsequent chat turn, forever**. `nexus_retention_purge` purges `kyc_documents` and the storage bucket but never touches `communication_logs`, so it is never cleaned up.

### Fix (ops 6 and 7 of call 1)

- `Decide: Re-ask or Escalate` is replaced so the customer-facing reason comes from a **closed vocabulary** of four fixed phrases, selected only from booleans and a number — `tamperingDetected`, an expiry-date parse, `confidenceScore < 60`, else a generic. A `reasonCode` is emitted alongside. **No model-authored string reaches the message body.** `parsed` is still passed through unchanged, so `Record KYC (Rejected)` keeps writing `documentType`, `fullName` and `confidenceScore` into `kyc_documents` — the table that is RLS-protected and *is* purged. PII stays where it belongs.
- `Log KYC Re-ask` is replaced so `communication_logs.message` becomes `'[KYC-REJECT] Re-upload requested (attempt N of 3, reason code X) [delivery: …]'`. The `[KYC-REJECT]` prefix is preserved deliberately — `Decide: Re-ask or Escalate` counts attempts by `message.startsWith('[KYC-REJECT]')` and `Count Previous KYC Rejections` reads that table. Changing the prefix would silently break the retry limiter.

`Slack: KYC Escalation` and `Log KYC Escalation` interpolate `$json.reason`, which is now a canned phrase; they need no edit.

**What is lost:** the BDC agent's thread history no longer shows the exact wording sent to the customer during a KYC rejection, and `communication_logs` no longer carries the rejection reason in prose. Both are readable from `kyc_documents` (`remarks`, `attempt_number`, `verdict`) by anyone entitled to see them. This is the point: the detail moves from the table everything reads to the table that is access-controlled and time-limited.

**Not changed, and flagged rather than hidden:** `Log KYC Approved` writes `'[KYC-APPROVED] Document verified for ' + lead_name`. That name comes from the *submitted lead record*, not from the document, and the same name already appears throughout `communication_logs` from ordinary chat. Removing it would be cosmetic. Left as is.

---

## 4. Secondary leak 3 — PII in storage object keys

**Mechanism.** `Prepare Archive` builds `kyc/<email-or-phone>/<yyyy>/<mm>/<uuid>.<ext>` — e.g. `kyc/ahmed_at_gmail.com/2026/08/…`. Anyone who can list the bucket reads the customer list out of the key names, without opening a single file. The same identity then appears in any log line, backup index, CDN path or error message that quotes a storage path.

### Fix (op 8 of call 1)

The identity segment is removed: `kyc/<yyyy>/<mm>/<uuid>.<ext>`. Everything else in the node — the 10 MB guard, the magic-byte sniffing, the 7-year `retain_until` — is untouched. `kyc_documents.storage_path` remains the only link between a customer and their document, and that table is RLS-protected.

**Why not a hash of the email?** A salted hash keeps per-customer grouping, but hashed identifiers are still pseudonymous personal data, are enumerable against a known customer list, and require a salt to be managed in env. Not worth it for a grouping nobody needs.

**What is lost:** you can no longer find a customer's documents by browsing the bucket; you must query `kyc_documents`. That is the intended effect.

**Verified not to break:** `nexus_retention_purge` (`Find Expired Documents` → `Delete Storage Objects` → `Mark Rows Purged`, plus `Find Archive Gaps`) drives entirely off `kyc_documents` rows, not off path structure. **Worth one check before applying:** the dashboard's `compliance.js` / `overview.js` are referenced in `security/fix_rls.sql` as readers of `kyc_documents`; if either constructs or parses a storage path by hand, it needs the same treatment. I could not read those files from `/home/claude/audit/`.

---

## 5. Also fixed, no decision needed — the identifying headers (op 2 of call 1)

`HTTP-Referer: https://nexuscorp.net` and `X-Title: NEXUS OS - KYC Auditor` are documented by OpenRouter as the site URL and title used **for public rankings on openrouter.ai**. They attach a named, publicly attributable KYC application to this traffic, and buy nothing. Both are removed (`sendHeaders: false`, `headerParameters.parameters: []`). Credential-based `Authorization` is unaffected.

This is a real reduction in exposure but it is not a fix for anything in §1 — de-identifying the sender does not de-identify the passport.

---

## 6. Not addressed here, and the owner should know

- **The published privacy policy is now inconsistent with the system.** `/privacy` (served by `nexus_public_privacy.json`, last updated 24 August 2026) tells customers their data lives "on infrastructure the dealership controls" and is "never used to train machine-learning models, ours or anyone else's." Whichever option is chosen, that page needs rewriting to match reality — and if Option F is chosen, it becomes true again except for the sentence about infrastructure, which needs a clause naming the AI processor.
- **Nobody has been asked.** There is no consent step anywhere in the flow telling a customer that their ID document will be sent to a third-party AI service. Under the PDPL the controller must be able to *prove* consent (Art. 6). A one-line disclosure in the WhatsApp message that requests the document is cheap and should exist whichever option wins.
- **Whether these documents need collecting at all.** The UAE Ministry of Economy's DNFBP list does not include motor vehicle dealers. If no finance partner requires this check, the strongest privacy fix available is to collect less. That is a business question, not an engineering one.
- **Which jurisdiction applies.** Mainland (federal PDPL) vs DIFC vs ADGM changes the rulebook. Unconfirmed.

## 7. Applying

1. Read `OWNER_DECISION.md` with the owner. Get an answer on the vision question.
2. Apply `OPERATIONS_kyc.json` — both calls, in order — regardless of that answer. Nothing in it depends on the decision.
3. Apply `OPERATIONS_kyc_vision.json` only if the owner chose the paid ZDR route. If he chose "no spend", do **not** apply it as written; scope Option E instead.
4. After applying: send one test document end-to-end and confirm (a) `kyc_documents` gets a row with a `kyc/YYYY/MM/uuid` path, (b) `communication_logs` shows the new terse `[KYC-REJECT]` form, (c) forcing a vision failure produces an `ESCALATED` row with an honest remark and **no** stored execution data.
