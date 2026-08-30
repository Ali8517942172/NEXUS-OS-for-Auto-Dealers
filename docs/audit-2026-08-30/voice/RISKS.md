# Voice-note branch — RISKS, UNVERIFIED ITEMS, PRE-APPLY CHECKLIST

Companion to `DESIGN.md` and `OPERATIONS.json`. Nothing here has been applied; no live server was
contacted. The workflow JSON at `/home/claude/audit/n8n-workflows/whatsapp_bdc_ai_agent.json`
(exported 2026-08-30T04:10:02Z) was the only source of truth about the workflow.

---

## A. Must be checked against the live box BEFORE applying

| # | check | how | why it matters |
|---|---|---|---|
| **P1** | The export is still current. | `get_workflow_details BiyHk9ZXxJUVGbf6`, compare `updatedAt` against `2026-08-30T04:10:02.353Z`. | Three of four patches are **whole-`jsCode` replacements**. If anyone edited `Extract Message & Sender`, `Resolve Lead Identity`, `Delivery Report` or `New Lead Worth Scoring?` since the export, applying `OPERATIONS.json` silently reverts their change. **This is the single most dangerous property of this change set.** If `updatedAt` differs, re-export and re-derive the patches from the new source. |
| **P2** | One real voice-note webhook body. | Send a PTT to the WAHA session with the workflow off, or read a saved execution. Confirm `payload._data.Message.audioMessage` exists, `payload.media.url` is populated and starts `http://localhost:3000`, and `audioMessage.seconds` is a number. | The whole branch keys on these three. `hasMedia: true` with `media: null` is a documented WAHA state (media detected but not downloaded) — if that is what arrives, `audio_url` is `null` and every voice note takes failure path 5.7. |
| **P3** | `WHATSAPP_FILES_LIFETIME` on the running `waha` container. | `docker inspect waha` / compose env. | Design assumes the documented default of **180 s**. If it is set to `0` the expiry race disappears entirely; if it is set lower than 180 the download must move even earlier or the duration cap must shrink. |
| **P4** | `WAHA_API_KEY` is visible to n8n as an env var. | It already is — `Download KYC Image` and `Send Reply via WAHA HTTP API` both use `{{ $env.WAHA_API_KEY }}` and work. Confirm `N8N_BLOCK_ENV_ACCESS_IN_NODE` is not set. | No new credential is created for WAHA. |
| **P5** | A `httpHeaderAuth` credential exists with Name `Authorization`, Value `Bearer <GROQ_API_KEY>`; substitute its id for every `"<<CREDENTIAL_ID>>"`. | `list_credentials`. | Applying with the literal placeholder produces a node that 401s on every voice note (which degrades to failure path 5.2, not silence — but transcription never works). |
| **P6** | The Groq key has STT quota, and STT is enabled on that account. | One `curl` to `/openai/v1/audio/transcriptions` with a short OGG. | The existing key is only ever used for **chat** (`Groq Chat Model`). Chat access does not imply audio access. |
| **P7** | Canvas region `y ≈ 900–1100`, `x ≈ 800–1700` is still empty. | Open the canvas. | Lowest node in the export is `Recent Outreach Check` at `[832, 816]`. Overlap is cosmetic only. |
| **P8** | n8n version, and whether it is affected by the multipart-binary regression. | `/rest/settings` or the UI footer; compare against issue #28854. | See R1. |

## B. After applying — the three tests that actually prove it

1. **Text message unchanged.** Send a normal text from a known lead. Expect: `Is Voice Note?`
   false, `Delivery Report` note = `all 3 claimed steps verified`, `delivery.status = SUCCESS`.
   Any change here means the `Extract`/`Resolve` patches broke the text path.
2. **Voice note from a matched lead.** Expect a sales reply in the customer's language, and
   `all 4 claimed steps verified`.
3. **Forced failure.** Temporarily point `Transcribe Voice (Groq)`'s URL at a 404. Expect the
   customer to still receive an apology, and `delivery.status = PARTIAL` with
   `voice note transcription — groq: …` in `dropped[]`. **This is the test that proves the
   "never silence" rule**, and it is the one most likely to be skipped.

---

## C. Risks

### R1 — n8n multipart binary upload regression (HIGHEST TECHNICAL RISK)
n8n issue **#28854**, *"HTTP Request node: File not attached when sending multipart-form-data
(400 'No file field in request')"*, reports exactly this configuration
(`contentType: multipart-form-data`, `parameterType: formBinaryData`, `inputDataFieldName`)
failing on n8n 2.17.3 / HTTP Request node v4.4, fixed by PR #29022. Related:
issue #26748 (multipart binary upload ECONNREFUSED in sub-workflows, regression in 2.10.2) and
issue #23307 (binary references via expressions).
**I could not determine which n8n version this box runs**, so I cannot say whether it sits inside
the affected range. The parameter *names* are verified correct against `HttpRequestV3.node.ts`;
the risk is a runtime bug, not a naming error.
*Symptom:* Groq returns HTTP 400 on every voice note. *Blast radius:* failure path 5.2 — the
customer still gets the apology, so this degrades rather than breaks. *Mitigation if hit:* upgrade
n8n, or replace `Transcribe Voice (Groq)` with a Code node that builds the multipart body by hand
from `getBinaryDataBuffer` (accepting the heap cost for a ≤400 kB file).

### R2 — `isExecuted` inside the Code node sandbox — **UNVERIFIED**
`$('node').isExecuted` is documented for **expressions**
(docs.n8n.io → Expression reference → NodeOutputData: *"Is `true` if the node has executed,
`false` otherwise"*). I could not find documentation confirming it is exposed identically inside a
**Code node**. Three patches use it (`Resolve Lead Identity`, `Delivery Report`, and by extension
the voice path). All three are written as
`if (mt && (mt.isExecuted === undefined || mt.isExecuted))` inside a `try/catch`, so:
if `isExecuted` is missing the guard falls through to `.first()` and the unexecuted-node throw is
caught. **Worst case is that the voice transcript is ignored and the branch behaves as today — not
an exception.** Verify with a one-line Code node before trusting it in a fourth place.

### R3 — whole-`jsCode` replacement is destructive
Restated from P1 because it is the likeliest way this change causes damage. `Extract Message &
Sender`, `Resolve Lead Identity` and `Delivery Report` each carry dated incident post-mortems in
their comments (the LID addressing fix, the infinite reply loop, the 26 Aug wrong-number
incident, the `binaryMode: separate` base64 bug). The patches in `OPERATIONS.json` were generated
by exact-string substitution on the exported source, so every comment is preserved **as of that
export** — but only as of that export. Take a workflow version snapshot before applying;
`get_workflow_history` / `restore_workflow_version` is the rollback path.

### R4 — Native-script transcripts break the keyword allowlist
Whisper's default for Urdu/Hindi/Arabic speech is native script. `Reply Eligibility`'s 73 keywords
are Latin-only. An **unmatched** number whose transcript comes back as `اردو` matches nothing and
is silenced, even though the transcription succeeded. The `prompt` biases toward Latin script; it
does not guarantee it. Matched leads are unaffected (`matched_lead` short-circuits the allowlist).
*Mitigation if it shows in testing:* add a handful of Arabic/Devanagari keywords to the allowlist,
or grant eligibility on `voice_transcribed === true`. Both are edits to a security-relevant node
and are deliberately not bundled here.

### R5 — Concurrency, not the 180 s clock, is the real timing risk
`N8N_CONCURRENCY_PRODUCTION_LIMIT = 2` on a 1-shared-vCPU / 958 MB box. Queue wait happens
**before node 1 of the execution**, so no node ordering can protect against it — if two agent runs
are ahead in the queue, the voice note's execution has not started and the WAHA file is ageing.
Placing the download at node 7 (before the `returnAll` `Fetch All Leads` scan) buys as much
headroom as is available inside the execution; it cannot buy headroom outside it.
*Consequence when it bites:* failure path 5.1 — apology instead of an answer, never silence.
*The invariant this ordering buys:* **do not add a `Wait` node, a rate-limit sleep or a queue hop
anywhere between the webhook and `Download Voice Note`.**

### R6 — Reusing the existing `groqApi` credential — **UNVERIFIED**
Credential `JgOg4w1ZMJc37lmL` ("Groq account") already holds the key, used by `Groq Chat Model`.
Whether n8n's `groqApi` credential type exposes an `authenticate` block selectable from the HTTP
Request node's `predefinedCredentialType` picker was **not verified**. `httpHeaderAuth` is
specified instead, which means a second copy of the key on the box. If `groqApi` does work, swap
`authentication: "genericCredentialType"` / `genericAuthType: "httpHeaderAuth"` for
`authentication: "predefinedCredentialType"` / `nodeCredentialType: "groqApi"` and drop the
`httpHeaderAuth` credential — one fewer secret to rotate.

### R7 — Groq free-tier limits taken as given, only partly confirmed
Groq's docs confirm **25 MB** max file size on the free tier and OGG among accepted formats. The
**20 RPM** and **7,200 audio-seconds/hour** figures were supplied in the task brief and I did not
independently confirm them from the rate-limit table. The 180 s duration cap is sized against the
audio-seconds figure (180 s × 40 notes/hour). If the real ceiling is lower, lower `MAX_SECONDS` in
`Prepare Voice Upload`. A 429 is failure path 5.2 — degraded, never silent.

### R8 — `verbose_json` response shape
`Merge Voice Transcript` reads `j.text` and `j.language`. Groq's `verbose_json` is
OpenAI-compatible and returns both at the top level, but I did not see a live response body. If
the shape differs, `transcript` is empty → failure path 5.3 (apology), not an exception. Cheap
hedge: switch `response_format` to `json` and drop `voice_language`, which is only used for
diagnostics.

### R9 — `Delivery Report` note string changes on voice runs
`all 3 claimed steps verified` becomes `all 4 …`. Any runbook, dashboard query or journey test
that string-matches `3` will report a false negative on voice runs. The em dash in
`what + ' — ' + why` is **U+2014** and the claim string is exactly `voice note transcription`.

### R10 — Duplicate WAHA deliveries
WAHA has delivered the same message three times in one second (documented in `Extract Message &
Sender`'s comments). Dedupe happens at `Claim Message Id`, which is **upstream** of the voice
branch, so duplicates are dropped before any Groq call. No extra quota is burned. This is a reason
not to move the download any earlier than `Extract Message & Sender`.

### R11 — Longer-held execution slot
A voice run holds one of two production slots ~1.3–4.3 s longer than a text run. On a box that hit
6/5 active with a growing queue on 26 Aug, this is a real if small contributor. No mitigation
proposed; recorded so it is not a surprise.

---

## D. Open questions for the business

* **Q1.** Should an **unknown** number whose voice note failed to transcribe get an apology, or
  stay silent? Current design: silent, preserving the 26 Aug wrong-number control. Changing it is
  an edit to `Reply Eligibility` (§5.6 of DESIGN.md).
* **Q2.** Is 180 s the right maximum voice-note length, or should it track the Groq audio-seconds
  budget more tightly?
* **Q3.** Should the agent's system message gain *"If the incoming message is in Urdu, Hindi or
  Arabic script, reply in Roman script"*? Relevant to R4; out of scope here.

---

## E. What I could NOT verify

1. n8n version on the box, and therefore exposure to the #28854 multipart regression (R1).
2. `isExecuted` availability inside the Code node sandbox (R2).
3. A real WAHA PTT webhook body — the `_data.Message.audioMessage` path, `media.url` population
   for audio, and `audioMessage.seconds` are all taken from the task brief and WAHA docs, not
   observed (P2).
4. The running value of `WHATSAPP_FILES_LIFETIME` (P3).
5. Whether `groqApi` is usable as a `predefinedCredentialType` from the HTTP Request node (R6).
6. Groq's live `verbose_json` response body (R8).
7. Groq free-tier RPM and audio-seconds-per-hour (R7).
8. Whether the exported JSON is still current (P1).

Nothing in `OPERATIONS.json` uses a parameter name I did not verify against n8n docs or source.
Where a value could not be verified it is named UNVERIFIED above rather than guessed silently.

---

## F. Sources

**n8n**
- HTTP Request node — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
  (Body Content Type → Form-Data, *Parameter Type → "n8n Binary File"*, *Input Data Field Name*;
  Response → *Response Format → File*, *Put Output in Field*)
- `HttpRequestV3.node.ts` — https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts
  (`parameterType` options `formBinaryData` / `formData`; `inputDataFieldName`;
  `options.response.response.responseFormat` values `autodetect|json|text|file`;
  `options.response.response.outputPropertyName` default `data`)
- Expression reference → NodeOutputData — https://docs.n8n.io/build/work-with-data/transform-data/expression-reference/nodeoutputdata
  (`all()`, `first()`, `last()`, **`isExecuted`**, `item`, `itemMatching()`, `params`)
- Issue #28854, multipart-form-data file not attached — https://github.com/n8n-io/n8n/issues/28854
- Issue #26748, multipart binary upload in sub-workflows — https://github.com/n8n-io/n8n/issues/26748
- Issue #23307, binary references via expressions — https://github.com/n8n-io/n8n/issues/23307

**Groq**
- Speech-to-text — https://console.groq.com/docs/speech-to-text
  (`POST /openai/v1/audio/transcriptions`; `file` | `url`, `model`, `language`, `prompt` (224
  tokens), `response_format` `json|verbose_json|text`, `temperature`, `timestamp_granularities[]`;
  `whisper-large-v3` multilingual 189× / 10.3 % WER vs `whisper-large-v3-turbo` 216× / 12 % WER,
  transcription-only; 25 MB free-tier file cap; FLAC/MP3/MP4/MPEG/MPGA/M4A/**OGG**/WAV/WebM;
  transcriptions keeps the original language — **translations** is the endpoint that forces English)

**WAHA**
- Receive messages — https://waha.devlike.pro/docs/how-to/receive-messages/
  (`payload.media` = `{url, mimetype, filename, error}`; applies to voice notes / PTT;
  `filename` is null for audio; `hasMedia: true` with `media: null` is possible;
  files require `X-Api-Key`)
- Storages — https://waha.devlike.pro/docs/how-to/storages/
  (`WHATSAPP_FILES_LIFETIME` default **180 seconds**, `0` = forever; `WHATSAPP_FILES_FOLDER`
  default `/app/.media`)

**n8n MCP**
- `update_workflow` operation schema (loaded, not called): `addNode.node` is
  `additionalProperties: false` accepting only `name, type, typeVersion, id, position, parameters,
  credentials, disabled, notes`; node error settings go through `setNodeSettings`
  (`maxTries` 2–5, `waitBetweenTries` 0–5000); `setNodeParameter` takes `nodeName` + JSON-Pointer
  `path` + `value`; connection ops take `source`/`sourceIndex`/`target`/`targetIndex`/`connectionType`.
