# WhatsApp voice-note (PTT) transcription branch — CORRECTED DESIGN

**Target workflow:** `BiyHk9ZXxJUVGbf6` — *WhatsApp BDC AI Agent*.
**Validated against:** `/home/claude/audit/n8n-workflows/whatsapp_bdc_ai_agent.json`
(36 nodes, `_exported_from.updatedAt = 2026-08-30T04:10:02Z`, active, published).
**Status:** OFFLINE DESIGN. Nothing applied. No live server contacted.
**Supersedes:** `/home/claude/nexus-ref/fixes/voice/{DESIGN.md,nodes.json,RISKS.md}` — that pass
was written without the workflow JSON and is wrong in ways listed in §9.

---

## 0. TL;DR

Six new nodes are inserted **between `Extract Message & Sender` and `Fetch All Leads`** —
*not* in front of `Is Document?`, which is where the earlier pass put them. Four existing nodes
are patched. The branch downloads the audio from WAHA at node 7 of the run, transcribes it on
Groq `whisper-large-v3` without translating, writes the transcript into `message`, and rejoins
the untouched main chain, so a voice note is answered by exactly the same
`Reply Eligibility → Should The Bot Reply? → Model Ladder → AI BDC Sales Agent → Guard Reply →
Send Reply → Log Conversation → Delivery Report → Audit Log` path a text message takes.

**The single most important finding, and it is not the one the earlier pass reported:**
`Extract Message & Sender` (line ~55 of its `jsCode`) ends with

```js
if (!text && !isImage) return [];
```

A voice note has `payload.body === ''` and `media.mimetype === 'audio/ogg; codecs=opus'`, so
`isImage` is `false` and **the execution terminates there, at node 6 of ~16**. `Fetch All Leads`,
`Resolve Lead Identity`, `Is Document?` and everything after them never run. Any branch hung off
`Resolve Lead Identity` — which is what the earlier design specified — would have been dead code
that never fired once. That node **must** be patched; it is not optional.

---

## 1. Attach point

### 1.1 Exact attach point

```
Extract Message & Sender   main output 0      ← THE ATTACH POINT
```

Today that output has exactly **one** target:

```
"Extract Message & Sender": { "main": [ [ { "node": "Fetch All Leads", "type": "main", "index": 0 } ] ] }
```

After the change:

```
Extract Message & Sender  main[0] → Is Voice Note?
Is Voice Note?  main[0] true   → Download Voice Note → Prepare Voice Upload → Voice Is Usable?
                                    ├ true  → Transcribe Voice (Groq) ┐
                                    └ false ────────────────────────► Merge Voice Transcript
                                                                          └→ Fetch All Leads
Is Voice Note?  main[1] false  → Fetch All Leads          ← every existing message path, unchanged
```

Because the attach point is a **single-target** output, no fan-out ordering changes anywhere.
(The earlier design interposed on `Resolve Lead Identity`'s fan-out and reasoned at length about
preserving element order in a 2-element array. The real array has **three** elements —
`Is Document?`, `Upsert WhatsApp Contact`, `Fetch Thread History` — the last added 30 Aug. That
analysis was against a stale graph.)

### 1.2 Why here and not after `Resolve Lead Identity`

`Resolve Lead Identity` is the **single choke point** for the customer's words. Every consumer
downstream re-reads `message` from it by name, discarding whatever the previous node passed:

| node | how it reads the customer's words |
|---|---|
| `Reply Eligibility` | `const ctx = $('Resolve Lead Identity').first().json;` … 73-keyword allowlist over `ctx.message` |
| `Model Ladder` | `return [{ json: { ...ctx, ...prev, message: ctx.message, … } }]` — `ctx.message` **overrides** `prev` |
| `AI BDC Sales Agent` (`text`) | `const cur = String($('Resolve Lead Identity').first().json.message \|\| '')` |
| `Skip Duplicate Outreach` | `const ctx = $('Resolve Lead Identity').first().json;` |
| `New Lead Worth Scoring?` (cond 4) | `$('Resolve Lead Identity').first().json.message` |
| `Shape Lead For Router` | `message`/`vehicle_interest` ← `ctx.message` |
| `Log Conversation` | `lead_email` ← same node |

Attaching **after** that node means patching six of them. Attaching **before** it means patching
**one** — `Resolve Lead Identity` itself — and every other node keeps working with no edit at all.
That is the difference between a change that is auditable and one that is not.

It is also strictly better for the 180 s file lifetime: the download now happens **before**
`Fetch All Leads`, which is a `returnAll` Supabase table scan and the slowest step on the
pre-agent path.

### 1.3 The `Is Document?` fear is refuted

The earlier design justified its position partly by fearing a voice note could be misrouted into
the KYC auditor. It cannot. The real code is

```js
const isImage = payload.hasMedia === true && String(media.mimetype || '').startsWith('image/');
```

`is_document` is `true` only for an `image/*` mimetype, and `Is Document?` additionally ANDs
`matched_lead === true`. A PTT can never satisfy either condition — and in practice never reached
that node anyway (§0). No protection is needed and none is built.

---

## 2. The IF condition

### 2.1 Where the existence test actually lives

The requirement is to branch on the **existence of `payload._data.Message.audioMessage`**, not on
`MediaType`. That test is performed inside `Extract Message & Sender`, which is the only node in
the workflow that holds the raw webhook payload:

```js
const audioMsg = (payload._data && payload._data.Message && payload._data.Message.audioMessage) || null;
const isVoice = !!audioMsg;
```

It is a deliberate deviation from the earlier design, which put a `$('WAHA Webhook (POST)')`
reach-back with an `isExecuted` guard inside the IF node's expression. Doing the test where the
payload already lives removes the reach-back, removes the guard, removes the `object`/`exists`
operator, and removes the "is the webhook output `.body.payload` or `.payload`?" ambiguity the
earlier pass flagged as its own top risk — `Extract Message & Sender` already normalises that
(`const body = item.body || item; const payload = body.payload || {};`).

### 2.2 `Is Voice Note?` — exact condition

```
leftValue:  ={{ $json.is_voice }}
operator:   { "type": "boolean", "operation": "true", "singleValue": true }
rightValue: true
combinator: and
options:    { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 }
looseTypeValidation: true
typeVersion: 2.2
```

This is byte-for-byte the shape of the existing `Is Document?` condition, so it is house-consistent.

### 2.3 `Voice Is Usable?` — exact condition

```
leftValue:  ={{ $json.voice_ok }}
operator:   { "type": "boolean", "operation": "true", "singleValue": true }
```

### 2.4 typeVersion — corrected

Every IF node already in this workflow is **`typeVersion: 2.2`** (`Is Real Inbound?`,
`Is New Message?`, `Is Document?`, `Should The Bot Reply?`, `New Lead Worth Scoring?`).
The earlier design specified **2.3**. Both new IF nodes here are **2.2**.
Code nodes are **2**. HTTP Request nodes are **4.2**. All match what is in the file.

---

## 3. Node-by-node flow

```
Is New Message? (true)  ─┐
Called by Master Router ─┴─► Extract Message & Sender   (code 2, PATCHED)      [784, 304]
                                     │  emits is_voice / audio_url / audio_seconds / audio_mime
                                     ▼
                              Is Voice Note?            (if 2.2, NEW)          [800, 1040]
                                     ├── false ──────────────────────────────────────┐
                                     └── true                                        │
                                         ▼                                           │
                              Download Voice Note       (httpRequest 4.2, NEW) [976, 976]
                                     ▼                                               │
                              Prepare Voice Upload      (code 2, NEW)         [1152, 976]
                                     ▼                                               │
                              Voice Is Usable?          (if 2.2, NEW)         [1328, 976]
                                     ├── true ──► Transcribe Voice (Groq)     [1504, 896]
                                     │                    │  (httpRequest 4.2, NEW)  │
                                     └── false ───────────┴──► Merge Voice Transcript│
                                                                (code 2, NEW) [1696, 976]
                                                                     │               │
                                                                     ▼               ▼
                                                            Fetch All Leads   (existing) [608, 144]
                                                                     ▼
                                                            Resolve Lead Identity (code 2, PATCHED)
                                                                     ▼
                                          Is Document? / Upsert WhatsApp Contact / Fetch Thread History
                                                          … entire existing chain, untouched …
```

Canvas region `y ≈ 900–1100` is empty in the live layout (lowest existing node is
`Recent Outreach Check` at `[832, 816]`), so no node overlaps.

### 3.1 `Download Voice Note` — httpRequest 4.2

| setting | value | why |
|---|---|---|
| `method` | `GET` | |
| `url` | `={{ $json.audio_url }}` | `Extract Message & Sender` already applied the `http://localhost:3000` → `http://waha:3000` rewrite, exactly as it does for `document_url`. Mirrors `Download KYC Image`'s `={{ $json.document_url }}`. |
| header | `X-Api-Key: {{ $env.WAHA_API_KEY }}` | identical to `Download KYC Image` and `Send Reply via WAHA HTTP API`. **No n8n credential object** — the whole workflow uses the env var for WAHA. |
| `options.response.response.responseFormat` | `file` | verified against n8n docs + `HttpRequestV3.node.ts` |
| `options.response.response.outputPropertyName` | `data` | must stay `data`; `Prepare Voice Upload` and the Groq upload key on it |
| `options.timeout` | `20000` | file is 10–400 kB over the Docker bridge |
| `onError` | `continueRegularOutput` | **deliberately not** the KYC pattern. `Download KYC Image` throws; a throw here routes to error workflow `iYJkh1kztWxZXDbT` and the customer gets nothing. |
| `alwaysOutputData` | `true` | guarantees `Prepare Voice Upload` receives an item to inspect |
| `retryOnFail` | `false` | a 404 after expiry will 404 again; retrying only burns the remaining lifetime |

Groq's remote-`url` form field is **not** used: the WAHA URL is container-internal
(`http://waha:3000/api/files/…`) and needs an `X-Api-Key` header. Groq can supply neither.

### 3.2 `Prepare Voice Upload` — code 2, `runOnceForAllItems`

Gates, in order, each producing a distinct `voice_drop_reason`:

1. `json.error` present → `waha download failed: …`
2. no `binary.data` → `waha returned no audio body (file expired, 404, or media was never stored)`
3. `audio_seconds > 180` → `voice note is Ns, over the 180s cap`
4. mimetype does not start with `audio/` → `unsupported mimetype: …`

On success it forces `binary.data.fileName = 'voice.ogg'`, `fileExtension = 'ogg'`,
`mimeType = 'audio/ogg'`. This matters: WAHA sets `media.filename` to **null** for audio
(documented — filename is populated only for documents), so n8n falls back to the URL basename
or the literal `data`, and Groq rejects an upload whose filename has no recognised audio
extension.

It never calls `this.helpers.getBinaryDataBuffer()`. The workflow runs `binaryMode: "separate"`,
so the audio bytes live outside the item; pulling them into the heap of a 958 MB box buys
nothing — only metadata is needed, and n8n streams the file at upload time. The duration gate
reads `audio_seconds` (from `audioMessage.seconds`) rather than byte length for the same reason.

Duration cap rationale: 180 s of Opus PTT ≈ 400 kB, two orders of magnitude under Groq's 25 MB
free-tier ceiling. The cap exists to protect the **7,200 audio-seconds/hour** free-tier bucket
(180 s × 40 notes/hour) and the 2-slot concurrency limit, not the file size.

### 3.3 `Transcribe Voice (Groq)` — httpRequest 4.2

`POST https://api.groq.com/openai/v1/audio/transcriptions`, `contentType: "multipart-form-data"`.

| body parameter | `parameterType` | value |
|---|---|---|
| `file` | `formBinaryData`, `inputDataFieldName: "data"` | the binary from `Download Voice Note` |
| `model` | `formData` | `whisper-large-v3` |
| `response_format` | `formData` | `verbose_json` — yields `language` and `duration` alongside `text` |
| `temperature` | `formData` | `0` |
| `prompt` | `formData` | `WhatsApp voice note to a Dubai car dealership. The speaker mixes Roman Urdu, Hindi, Arabic and English. Write it exactly as spoken, in Latin script, and do not translate.` |

`parameterType` values `formBinaryData` / `formData` and `inputDataFieldName` verified against
`HttpRequestV3.node.ts` and the node docs ("Parameter Type → n8n Binary File", "Input Data Field
Name"). The earlier design omitted `parameterType: "formData"` on the four scalar fields; the
default is `formData` so it would have worked, but explicit is safer against a UI round-trip.

| setting | value |
|---|---|
| auth | `authentication: "genericCredentialType"`, `genericAuthType: "httpHeaderAuth"` |
| `options.timeout` | `60000` |
| `onError` | `continueRegularOutput` |
| `alwaysOutputData` | `true` |
| `retryOnFail` / `maxTries` / `waitBetweenTries` | `true` / `2` / `2000` |

Retry is capped at 2 with a 2 s gap: a Groq 429 is a per-minute bucket, and this box allows only
**two** concurrent production executions — better to fall through to the graceful fallback than
to sit in a retry loop holding a slot.

**Model choice, confirmed against Groq's model table:** `whisper-large-v3` (multilingual,
189× realtime, 10.3 % WER) over `whisper-large-v3-turbo` (216× realtime, 12 % WER,
transcription-only). At 189× realtime a 30 s note costs ~0.16 s of Groq compute, so the speed
difference is irrelevant on this workload and the accuracy difference is not, for code-switched
speech.

### 3.4 `Merge Voice Transcript` — code 2

Join point for both legs. Always emits exactly one item; never throws. Reads the pre-flight
verdict back from `$('Prepare Voice Upload')` because the Groq HTTP node **replaces** the item.

Emits: `message`, `is_voice: true`, `voice_transcribed`, `voice_transcript`, `voice_language`,
`voice_seconds`, `voice_drop_reason`.

---

## 4. Language fidelity

Requirement: transcribe **as spoken**, never translate, so the agent's existing rule — *"Mirror
the customer's language. If they write in Roman Urdu or Hindi, reply the same way."* (already in
the system message) — still applies.

1. `/audio/transcriptions`, never `/audio/translations`. Groq's docs are explicit: "The
   transcription endpoint converts spoken audio to text in its original language. The separate
   translations endpoint converts audio to English."
2. `whisper-large-v3` — the multilingual model.
3. **`language` is deliberately not sent.** Pinning `ur` or `hi` forces single-language decoding
   and biases against the Urdu/Hindi/Arabic/English code-switching these customers actually use.
4. `prompt` primes Latin-script, code-switched output (224-token limit; this is well under).
5. `temperature: 0`.

**Known weakness, stated plainly:** Whisper's default for Urdu/Hindi/Arabic speech is native
script (`اردو` / `हिंदी` / `العربية`), not Roman. The `prompt` biases it; it does not guarantee it.
Two knock-on effects, both real:

* `Reply Eligibility`'s 73 keywords are Latin-only, so a native-script transcript from an
  **unmatched** number fails the allowlist and gets silence (§5.6);
* the agent may answer in native script even though the customer normally types Roman Urdu.

Neither is fixed by this branch. The cheap mitigation if it shows in testing is one extra line in
the agent's system message — an edit to an existing node, out of scope here, recorded in RISKS.md.

---

## 5. Failure modes

Every row ends with the customer receiving a WhatsApp message **if they were eligible for one at
all** (§5.6 is the one honest exception, and it is pre-existing policy, not a new hole).

The fallback is never a canned English string. `Merge Voice Transcript` writes an **instruction**
into `message` and lets the existing agent answer it — the only way the apology comes back in the
customer's own language. Same convention as the `INITIAL_OUTREACH:` prefix `Extract Message &
Sender` already injects:

```
SYSTEM_NOTE: This person sent a WhatsApp voice message and we were not able to turn it into
text. Do not guess what they said. Reply briefly, in whatever language they have been writing
in, say sorry you missed it, and ask them to write it out or send a shorter recording.
```

The drop reason is **not** interpolated into that text, on purpose: it flows into
`Reply Eligibility`, whose allowlist is a substring match, and an arbitrary Groq error string
could contain `model`, `service` or `car` and silently widen the allowlist for an unknown number.
The 73-keyword list was checked programmatically against the note above and the new
`[Customer sent a voice note]` placeholder: **zero matches** for both.

| # | failure | detected by | `message` sent to the agent | customer receives | `delivery.status` |
|---|---|---|---|---|---|
| 5.1 | **URL expired past 180 s / 404** | `Download Voice Note` `onError` → no `binary.data` | SYSTEM_NOTE | apology + "please type it or send a shorter one", in their language | **PARTIAL** |
| 5.2 | **Groq 429 / 5xx / 401** | `Transcribe Voice (Groq)` `onError` after 2 tries → `j.error` | SYSTEM_NOTE, reason `groq: …` | same | **PARTIAL** |
| 5.3 | **Empty transcript** (silence, pocket recording) | 200 with `text: ""` | SYSTEM_NOTE, reason `groq returned an empty transcript` | same | **PARTIAL** |
| 5.4 | **Audio too long** (> 180 s) | `Prepare Voice Upload`, **before** Groq is called — no quota burned | SYSTEM_NOTE | same | **PARTIAL** |
| 5.5 | **Unsupported mimetype** (not `audio/*`) | `Prepare Voice Upload` | SYSTEM_NOTE | same | **PARTIAL** |
| 5.6 | any of the above, **from an unmatched number** | `Reply Eligibility` → `Should The Bot Reply?` false | — | **nothing** (see below) | run ends before `Delivery Report` |
| 5.7 | `media.url` absent (`hasMedia: true, media: null` — WAHA downloaded nothing) | URL expression is `null`, HTTP node errors, caught | SYSTEM_NOTE | same as 5.1 | **PARTIAL** |
| 5.8 | success | — | the transcript | a normal sales reply | **SUCCESS** |

**No node on this branch is allowed to throw.** The KYC branch's throw-on-failure pattern
(`Download KYC Image`, `Image To Base64`) is explicitly not copied: a throw routes to error
workflow `iYJkh1kztWxZXDbT` and leaves the customer with silence.

### 5.6, expanded — the one exception, and why it is not a regression

`Reply Eligibility` grants a reply when the sender is a **matched lead**, when direction is
outbound, or when the text contains one of 73 dealership keywords. It is the control added after
the 26 Aug wrong-number incident (two strangers got sales replies to uncaptioned images).

* **Matched lead + failed transcription → always replied to.** `reply_reason: known lead`.
  The "never silence" rule holds for every customer the dealership actually knows.
* **Unmatched number + failed transcription → silent.** Making it reply would re-open exactly the
  hole closed on 26 Aug, and a voice note is a *cheaper* way to trigger it than text (no keyword
  to guess). This is a deliberate, pre-existing policy decision, unchanged by this branch.
* **Unmatched number + successful transcription → normal keyword rules**, identical to a text
  message. This is new capability: before this change that person got nothing at all.

If the business wants a reply in row 2, the fix is a new eligibility reason in `Reply Eligibility`
(`voice note we could not hear`) — a change to an existing security-relevant node, deliberately
not bundled here. Listed as open question Q1 in RISKS.md.

---

## 6. `delivery.status` — how it is computed, and the correct patch

The live `Delivery Report` builds a `CLAIMED` array of `{node, what, critical}` and maps a
`check(c)` function that reaches `$(c.node).all()`; a node that did not run yields
`ok: false, why: 'node did not run on this branch'`. Then:

```js
const dropped = results.filter(r => !r.ok);
const fatal   = dropped.filter(r => r.critical);
const status  = fatal.length ? 'FAILED' : dropped.length ? 'PARTIAL' : 'SUCCESS';
```

The voice branch adds a **fourth, non-critical claim** — but **only on runs where the branch
actually ran**, appended after the map rather than added to `CLAIMED`:

```js
let voiceClaim = null;
try {
  const mt = $('Merge Voice Transcript');
  if (mt && (mt.isExecuted === undefined || mt.isExecuted)) {
    const v = mt.first().json || {};
    voiceClaim = { what: 'voice note transcription', critical: false,
                   ok: v.voice_transcribed === true,
                   why: v.voice_transcribed === true ? '' :
                        String(v.voice_drop_reason || 'transcription failed').slice(0, 300) };
  }
} catch (e) { voiceClaim = null; }

const results = CLAIMED.map(check);
if (voiceClaim) results.push(voiceClaim);
```

**This is a correction.** The earlier design's snippet called `claims.push(...)` — there is no
variable named `claims` in the node, so it would have thrown `ReferenceError` inside
`Delivery Report`, the last node before the audit row. And adding the claim to `CLAIMED`
unconditionally, the other obvious approach, would make `check()` report *"node did not run on
this branch"* for **every text message** and turn every text run `PARTIAL`.

Resulting semantics, consistent with the existing convention:

| outcome | `verified[]` gains | `dropped[]` gains | `delivery.status` |
|---|---|---|---|
| voice transcribed, reply sent | `voice note transcription` | — | **SUCCESS** |
| transcription failed, fallback reply sent | — | `voice note transcription — <reason>` | **PARTIAL** |
| transcription fine, WAHA send failed | `voice note transcription` | `WhatsApp reply to the customer — …` | **FAILED** (critical) |
| text message (branch never ran) | — | — | unchanged, 3 claims |

The `dropped[]` join uses `what + ' — ' + why` with **U+2014 EM DASH**, per the existing node —
the claim string `voice note transcription` must match byte-for-byte anything the runbooks
assert on. The `note` string flips from `all 3 claimed steps verified` to `all 4 …` on voice
runs; any verification query that string-matches `3` must be updated.

---

## 7. Patches to existing nodes

Four, all included as operations in `OPERATIONS.json`.

### 7.1 `Extract Message & Sender` — **REQUIRED, hard blocker**

Without it nothing else in this document can ever execute (§0). Adds the `audioMessage` existence
test, the `localhost→waha` URL rewrite for audio, `is_voice` / `audio_url` / `audio_seconds` /
`audio_mime` on the output, `is_voice: false` on the outreach return, changes the drop guard to
`if (!text && !isImage && !isVoice) return [];`, and splits the placeholder so a voice note gets
`[Customer sent a voice note]` rather than the image placeholder (which contains the allowlist
keyword `document` and is string-compared by `New Lead Worth Scoring?`).

### 7.2 `Resolve Lead Identity` — **REQUIRED**

The choke point. Reads `Merge Voice Transcript` if it executed and substitutes `message`, plus
carries `is_voice`, `voice_transcribed`, `voice_transcript`, `voice_language`, `voice_seconds`,
`voice_drop_reason` forward. The node builds an explicit output object, so unknown keys are
dropped — carrying the fields through is not automatic.

The reach-back is defensive on both axes:

```js
try {
  const mt = $('Merge Voice Transcript');
  if (mt && (mt.isExecuted === undefined || mt.isExecuted)) voice = mt.first().json || null;
} catch (e) { voice = null; }
```

If `isExecuted` turns out not to be exposed in the Code-node sandbox it evaluates `undefined`,
`.first()` is attempted, and an unexecuted-node throw is caught — the text path is unaffected
either way.

### 7.3 `Model Ladder` — **NO PATCH NEEDED. The earlier design's "hard blocker" is now moot.**

The earlier pass flagged that `Model Ladder` re-reads `message` from `Resolve Lead Identity` and
would silently discard a transcript. **That is confirmed** — the live code is literally

```js
return [{ json: { ...ctx, ...prev, message: ctx.message, __attempt: attempt, … } }];
```

with `ctx = $('Resolve Lead Identity').first().json`, so `ctx.message` overrides anything `prev`
carries, and it throws `No message found on Resolve Lead Identity output` when that value is
empty. Under the earlier design's attach point this would have been fatal.

Under **this** attach point `ctx.message` *is* the transcript, because the substitution happens in
`Resolve Lead Identity` itself. `Model Ladder` is left completely untouched — the safest possible
outcome for a node that carries three dated incident post-mortems in its comments. The problem was
real; the fix is structural rather than another patch.

### 7.4 `Delivery Report` — **RECOMMENDED**, per §6.

### 7.5 `New Lead Worth Scoring?` — **RECOMMENDED (defence in depth)**

Adds a fifth condition, `message notStartsWith "SYSTEM_NOTE:"`. `Shape Lead For Router` copies
`ctx.message` into both `message` and `vehicle_interest` on the new-lead payload sent to the
Master Router; without this a failed transcription could create a lead whose stated vehicle
interest is our own internal note. It is defence in depth rather than strictly required — a
failed transcription from an unmatched number is silenced at `Should The Bot Reply?` and never
reaches this node — but it costs one operation.

---

## 8. Credentials and environment

| node | needs | note |
|---|---|---|
| `Download Voice Note` | `$env.WAHA_API_KEY` | **no n8n credential object.** Identical to the existing `Download KYC Image` and `Send Reply via WAHA HTTP API`, both of which use `X-Api-Key: {{ $env.WAHA_API_KEY }}` with no credential. |
| `Transcribe Voice (Groq)` | credential type **`httpHeaderAuth`** — Name `Authorization`, Value `Bearer <GROQ_API_KEY>` | `"<<CREDENTIAL_ID>>"` placeholder in `OPERATIONS.json`. Create the credential in n8n first and substitute its id. |

A `groqApi` credential (`JgOg4w1ZMJc37lmL`, "Groq account") already exists on the box for the
`Groq Chat Model` agent-fallback node. Reusing it via `authentication: "predefinedCredentialType"` /
`nodeCredentialType: "groqApi"` would avoid a second copy of the key, but whether n8n's `groqApi`
credential exposes an `authenticate` block selectable from the HTTP Request node is **UNVERIFIED**
— see RISKS.md R6. `httpHeaderAuth` is specified as the safe default.

**No new infrastructure, no ffmpeg, no container changes, no paid service.** OGG/Opus goes to Groq
byte-for-byte as WAHA stored it; Groq lists OGG among its accepted formats.

---

## 9. What changed from the earlier design pass, and why

| # | earlier design said | reality in the JSON | consequence |
|---|---|---|---|
| 1 | *"requires no edit to `Extract Message & Sender`"* | that node ends with `if (!text && !isImage) return [];` and `isImage` requires an `image/*` mimetype | **the earlier branch was dead code.** It could never fire, because the execution terminated four nodes upstream of its attach point. Patching this node is now the first required change. |
| 2 | attach at `Resolve Lead Identity` main[0], in front of `Is Document?` | six downstream nodes re-read `message` **by name** from `Resolve Lead Identity` | attach point moved **upstream** of `Resolve Lead Identity`, to `Extract Message & Sender` main[0]. One patch site instead of six. |
| 3 | `Model Ladder` patch is *"the highest-risk item and a hard blocker"* | confirmed accurate (`message: ctx.message` overrides `prev`) — but only under attach point #2 | with the new attach point `Model Ladder` needs **no patch at all**. |
| 4 | `Reply Eligibility` not mentioned | it runs the 73-keyword allowlist over `$('Resolve Lead Identity').message` | **missed silent-discard site.** Under the old attach point every unmatched caller's voice note would have been keyword-tested against `''` and silenced regardless of what they said. Fixed by the same single substitution. |
| 5 | `Delivery Report` patch calls `claims.push(...)` | there is no `claims` variable; the node maps a `const CLAIMED` through `check()` | the snippet would have thrown `ReferenceError` in the last node before the audit row. Rewritten as a conditional `results.push` after the map. |
| 6 | new IF nodes at `typeVersion: 2.3` | all six existing IF nodes are `2.2` | corrected to `2.2`. |
| 7 | node objects carry `onError` / `retryOnFail` / `alwaysOutputData` / `maxTries` inline | the MCP `update_workflow` `addNode.node` schema is `additionalProperties: false` and accepts only `name, type, typeVersion, id, position, parameters, credentials, disabled, notes` | those settings would have been **rejected or dropped**, silently removing every failure guard. They are now separate `setNodeSettings` operations. |
| 8 | worried a voice note could be routed to the KYC auditor | `is_document` requires an `image/*` mimetype **and** `matched_lead` | fear refuted; no protection built. |
| 9 | `Resolve Lead Identity` fan-out has 2 elements | it has 3 (`Fetch Thread History` added 30 Aug) | the ordering analysis was against a stale graph. Moot now — the new attach point is a single-target output, so no ordering changes at all. |
| 10 | 35 nodes / 77 allowlist keywords | 36 nodes / 73 keywords | cosmetic, but both were counted from a stale export. |
| 11 | download at node 10, ~T+3 s, after `Fetch All Leads` | — | download is now node 7, **before** the `returnAll` table scan. Strictly more headroom against the 180 s lifetime. |
| 12 | IF expression reaches into `$('WAHA Webhook (POST)').first().json.body?.payload?…` with an `isExecuted` guard, and flags "is it `.body.payload` or `.payload`?" as its top risk | `Extract Message & Sender` already normalises this: `const body = item.body \|\| item; const payload = body.payload \|\| {};` | the whole risk class is removed by doing the existence test inside that node instead. |
| 13 | Groq body scalars had no `parameterType` | default is `formData` | made explicit. |
| 14 | drop reason interpolated into the customer-facing SYSTEM_NOTE | `Reply Eligibility` substring-matches 73 keywords over that text | reason removed from the note; a Groq error containing `model` or `service` would otherwise widen the allowlist for an unknown number. |

Everything the earlier pass got **right** and is preserved: branch on `audioMessage` existence
not `MediaType`; download first, before any slow step; `onError: continueRegularOutput` everywhere
instead of the KYC throw pattern; no `getBinaryDataBuffer` under `binaryMode: separate`; force
`voice.ogg` / `audio/ogg` before upload; `/audio/transcriptions` never `/audio/translations`;
omit `language`; `whisper-large-v3` over turbo; a SYSTEM_NOTE instruction to the agent rather than
a canned English string; Groq retry capped at 2 because of the 2-slot concurrency limit.

---

## 10. Cost on the e2-micro

* **Text message path:** one extra IF evaluation. Nothing else — the branch is not entered.
* **Voice path:** one ~50–400 kB inbound transfer into n8n's binary store, one outbound multipart
  upload, two Code evaluations, one extra IF. **No audio bytes ever enter the Node heap** and no
  transcoding happens. Peak extra RAM is n8n's stream buffers, well under 10 MB.
* **Extra wall clock:** ~0.3 s download + 1–4 s Groq. That holds one of the two production slots
  slightly longer — the honest cost of the feature.
* **Free-tier draw:** one Groq STT request per voice note. Groq STT and the `Groq Chat Model`
  agent fallback share the same account but different buckets (audio-seconds vs. tokens).
