# Model Ladder patch spec — permanent free-tier answer to "AI scoring quota ran out"

Target workflow: `JnlZFAVmFAuNXVya` ("NEXUS Master Lead Router - AI Agent").
Written against the snapshot at `ops/tenant-precedence/patched4/JnlZFAVmFAuNXVya.json`
(`versionId aeaf34eb-20db-4440-826d-b2ebf4b078de`, `updatedAt 2026-09-20T07:09:30.129Z`).
**This is a spec, not a workflow edit.** Read-only access was used to produce
it (`mcp__n8n__get_workflow_details`, `mcp__n8n__list_credentials`); nothing
was written to n8n. The agent doing the persist-first merge should re-read
the live workflow first and diff against the snapshot above before applying
anything here, in case it drifted.

---

## 0. IMPORTANT cross-reference found while writing this spec

Two things already live in this repo change what "tag score_source" should
mean here, and both were found only by reading, not asked-for in the
original brief -- flagging them because getting the label wrong is worse
than not labelling at all:

1. **`leads.score_source` already exists in production** (migration
   `20260914065739_nx920_a_score_now_says_who_decided_it.sql`, applied
   14 Sep 2026) with a CHECK constraint
   (`leads_score_source_is_a_known_label`) allowing exactly four values:
   `RULES`, `AI_SCORE_CONFIRMED`, `AI_SCORE_FALLBACK`, `AI_SCORE_UNKNOWN`.
   Lower-case `'rules'`/`'ai'` are **not** legal values for that column --
   writing them would fail the constraint the moment `Persist Lead` (or
   anything else) tried to save one. `rule-based-scorer.js` therefore emits
   `score_source: 'RULES'` and `rules_score` (also an NX920 column), not
   `'rules'`. Section 4.5 below uses `AI_SCORE_CONFIRMED` /
   `AI_SCORE_FALLBACK` for the AI path for the same reason, plus the
   `ai_score_raw` / `ai_intent_raw` columns NX920 added for it.
2. **`ops/ADR-003-who-decides-the-score.md` (accepted, 14 Sep 2026) already
   decided that RULES should be authoritative for every lead today**, not
   just a last-resort fallback -- ~15% of runs were being scored by a regex
   reading model babble, an empty `{}` was indistinguishable from a genuine
   WARM/50, and none of the free-tier models support structured output. The
   ADR even specifies the flip mechanism for later (`const AUTHORITY =
   'RULES'; // -> 'AI'` in `Parse AI Decision`, flipping at 2 paying
   dealers per ADR-002). **As of the workflow snapshot this spec is written
   against, `Parse AI Decision` implements none of this** -- no
   `score_source`, no `AUTHORITY` constant, still the old regex-babble
   fallback ADR-003 describes replacing. This spec's job, per its brief, is
   narrower than ADR-003: make the rules scorer the terminal tier so a
   quota outage can never lose a lead. That is a strict subset of, and
   fully compatible with, what ADR-003 already calls for. Fully
   implementing ADR-003 (rules scoring every lead immediately, AI as a
   recorded-but-non-authoritative signal) is a natural, small follow-on --
   the columns and the constant name already exist, only the wiring in
   `Parse AI Decision` does not.
3. **A concurrent, broader fix for the same underlying defect (NX1002) is
   already in flight** in this working tree:
   `supabase/migrations/20260920160000_nx1002_the_lead_was_lost_when_the_quota_ran_out.sql`
   adds `leads.scoring_state` (`PENDING`/`SCORED`/`FAILED` -- pipeline
   state, orthogonal to `score_source`) plus
   `nexus_pending_scoring_leads_for_tenant` /
   `nexus_record_lead_scoring_result` for a "persist first, score later"
   redesign (move `Persist Lead` before the ladder; PATCH the row once
   scoring completes; an hourly sweep re-scores anything still `PENDING`).
   **That patch and this one solve different halves of the same day**: NX1002
   guarantees the row is never lost even if scoring never completes; this
   patch guarantees scoring itself never dead-ends when AI quota is gone,
   so a HOT lead still gets routed and Slacked *immediately* rather than
   waiting on the next hourly sweep (which is important for the product's
   own 5-minute/3-second response commitments -- a sweep alone does not
   meet those). They compose: if both land, `Persist Lead` writes
   `scoring_state='PENDING'` up front, the ladder (now with this patch's
   terminal rules tier) always produces a decision inline, and whichever
   node PATCHes `scoring_state='SCORED'` should fire for a rules-sourced
   decision exactly the same way it does for an AI one -- that PATCH node
   belongs to the NX1002 patch, not this one, so it is not specified here,
   only flagged as needing to treat `RULES` decisions identically to `AI_*`
   ones.

## 1. What the live ladder actually does today

`Validate & Enrich Input` -> `Model Ladder` -> `AI Lead Scoring Agent` (a
LangChain Agent node with `needsFallback: true`, primary LM =
`OpenRouter Chat Model`, fallback LM = `Groq Fallback`) -> on success ->
`Parse AI Decision` -> `Intent Switch` (+ `Persist Lead (deterministic)`).

- `Model Ladder` (`n8n-nodes-base.code`, id `mr-ladder-01`) is a **3-tier
  retry ladder**, not a single call. It holds a `TIERS` array of
  `{ orModel, groqModel }` pairs:
  1. `nvidia/nemotron-3.5-lightning:free` / `openai/gpt-oss-120b`
  2. `nvidia/nemotron-3-super-120b-a12b:free` / `openai/gpt-oss-120b`
  3. `minimax/minimax-m2.7:free` / `openai/gpt-oss-120b`
  Every tier uses the **same** Groq model as fallback; only the OpenRouter
  model changes per tier. It reads `attempt` off the previous item, picks
  `TIERS[attempt]`, and outputs `{ lead, attempt, maxTiers, orModel, groqModel }`
  into `AI Lead Scoring Agent`.
- `AI Lead Scoring Agent` has `onError: "continueErrorOutput"`. Output 0
  (success) -> `Parse AI Decision`. Output 1 (error -- i.e. BOTH the
  OpenRouter model AND the Groq fallback failed for that tier) ->
  loops back into `Model Ladder`, which increments `attempt` and tries the
  next tier.
- **The break**: `Model Ladder` has `onError: null` (default = stop the
  workflow). When `attempt >= TIERS.length` (all 3 tiers exhausted, i.e.
  OpenRouter's daily free quota is gone on every tier AND Groq also failed
  on every tier), it does `throw new Error('All 3 model tiers failed...')`
  with **no error-output wiring**, so the execution dies right there. The
  lead is never scored, never routed to `Intent Switch`, never persisted,
  no Slack alert -- nothing downstream of this node runs at all. This is
  "the AI scoring quota ran out" failure mode.

## 2. Provider/credential reality check

Read via `mcp__n8n__list_credentials` (7 credentials total, no secrets
printed -- only what's below):

| Provider | Credential exists? | Type | id |
|---|---|---|---|
| Groq | **yes** | `groqApi` | `JgOg4w1ZMJc37lmL` |
| OpenRouter | **yes** | `openRouterApi` | `UUtKrBzkQOztAOzZ` |
| Google Gemini | **no** | -- | -- |
| Any other LLM provider (Mistral, Cohere, Together, HF, Anyscale, Azure OpenAI, etc.) | **no** | -- | -- |

Non-AI credentials also present, unrelated to scoring: Resend
(`httpHeaderAuth`), Apify (`httpQueryAuth`), Supabase (`supabaseApi`), Slack
(`slackApi`), Gmail OAuth2. **No new provider is actually available** --
Groq and OpenRouter, both already wired into the ladder, are the only two
AI credentials that exist in this n8n project. The permanent fix therefore
cannot add a 3rd AI provider; it has to add a **non-AI, zero-quota terminal
tier**.

## 3. Recommended tier order

Cheapest-to-fail-fast first, deterministic rules last, so a lead is *always*
scored:

1. **OpenRouter free model (current tier's `orModel`) as primary**, **Groq
   (`openai/gpt-oss-120b`) as the agent's built-in fallback** -- unchanged
   from today, repeated across the existing 3 tiers. This ordering is
   already correct for "fail fast": Groq only fires when OpenRouter's
   primary call fails, and Groq's failure mode (429 on quota, or a fast
   4xx) returns in low hundreds of ms, not the ~45s hangs the `Model
   Ladder` comments record for a dead/rate-limited OpenRouter `:free`
   model. Keeping Groq as the fast-failing second call per tier, rather
   than trying it as its own separate outer tier, avoids paying for a
   second full ~45s OpenRouter-style hang before falling through.
2. Tiers 2 and 3 (next `orModel`, same Groq fallback) -- unchanged, same
   reasoning.
3. **NEW terminal tier: the deterministic rule-based scorer**
   (`ops/tenant-precedence/code/rule-based-scorer.js`, see below). No
   network call, no credential, cannot be rate-limited, cannot itself
   throw (see `rule-scorer.test.mjs` case 9: garbage/empty input still
   returns a structured decision). This is what turns "ran out of quota"
   from a hard outage into "still 100% automated, just less precise."

If a 4th free OpenRouter model id becomes available later, insert it as tier
2/3/4 the same way -- the terminal rules tier always stays last.

## 4. Exact node/connection changes for `JnlZFAVmFAuNXVya`

### 4.1 Add one new node: "Rule-Based Lead Scorer"

- **Type**: `n8n-nodes-base.code` (same type as `Model Ladder` / `Parse AI
  Decision`).
- **Suggested id**: `mr-rules-01` (follows this workflow's `mr-*` id
  convention for hand-added nodes).
- **Position**: below/right of `Model Ladder`, e.g. `[352, 480]`.
- **`onError`**: `"continueRegularOutput"` -- defensive belt-and-suspenders
  matching the convention already used on `Slack: Unclassified Lead`,
  `Audit Log`, `Persist Lead (deterministic)` in this same workflow. The
  scorer is proven not to throw (test 9), so this should never actually
  trigger, but costs nothing.
- **`jsCode`**: paste the **entire contents** of
  `ops/tenant-precedence/code/rule-based-scorer.js` verbatim. That file
  *is* the Code node body -- it is guarded (`typeof $input !== 'undefined'`)
  so it behaves identically whether pasted into n8n or `require()`d by the
  test harness; nothing needs to be stripped or rewritten. It reads
  `$input.first().json.lead` (falls back to the raw item if `.lead` is
  missing) and returns `[{ json: { lead, ai_decision } }]` with
  `ai_decision.score_source === 'RULES'` and `ai_decision.score_reasons`
  populated -- the exact shape `Parse AI Decision` already produces.
- **Credential**: none. This is the entire point.

### 4.2 `Model Ladder`: flip `onError`

Change `Model Ladder`'s node-level setting from `onError: null` (stop
workflow) to:

```
"onError": "continueErrorOutput"
```

No change to `jsCode` -- the existing `throw new Error('All ' + TIERS.length
+ ' model tiers failed for lead ' + ...)` is fine and should stay (it's
useful, human-readable evidence of exhaustion); it just needs to stop being
fatal. With `continueErrorOutput`, n8n passes `Model Ladder`'s **input**
item (`{ lead, attempt, maxTiers, orModel, groqModel }` -- confirmed by
tracing the loop: `AI Lead Scoring Agent`'s error output re-feeds `Model
Ladder`'s own last output back into it) out on output index 1, with
`.error` attached. `.lead` is present on that item, which is exactly what
`Rule-Based Lead Scorer` needs.

### 4.3 New connection: `Model Ladder` (error output, index 1) -> `Rule-Based Lead Scorer`

Add to the workflow's `connections` map:

```json
"Model Ladder": {
  "main": [
    [ { "node": "AI Lead Scoring Agent", "type": "main", "index": 0 } ],
    [ { "node": "Rule-Based Lead Scorer", "type": "main", "index": 0 } ]
  ]
}
```

(Output index 0 = normal path into the agent, unchanged. Output index 1 =
the new error output, only populated once all 3 tiers are exhausted.)

### 4.4 New connection: `Rule-Based Lead Scorer` -> `Parse AI Decision`

```json
"Rule-Based Lead Scorer": {
  "main": [
    [ { "node": "Parse AI Decision", "type": "main", "index": 0 } ]
  ]
}
```

**Route it into `Parse AI Decision`, NOT straight into `Intent Switch`.**
This is the one non-obvious but important part of this spec: `Audit Log`
and `Delivery Report` both hardcode `$('Parse AI Decision').first().json`
(named-node lookups, not "previous node"). `$('NodeName')` **throws** if
that node did not execute on the current branch (this is the exact pattern
this codebase already relies on elsewhere, e.g. `Validate & Enrich Input`'s
`try { $('Auth Gate').all(); } catch (e) { viaWebhook = false; }`). If the
rules scorer instead fed `Intent Switch` directly and skipped `Parse AI
Decision`, every rules-scored lead would make `Audit Log` and `Delivery
Report` throw and the run would still die -- just one node later than
today. Feeding `Parse AI Decision` keeps it as the single canonical
"decision" node for every downstream consumer, AI or rules, with zero
changes required to `Audit Log` or `Delivery Report`.

### 4.5 `Parse AI Decision`: add a short-circuit at the top, tag `score_source` per NX920

Two small, additive edits to the existing `jsCode` (nothing removed):

**(a) Short-circuit, inserted immediately after the existing first two lines**
(`const lead = ...`, `const rawOut = $input.first().json;`), **before** the
`const text = String(rawOut.output ?? ...)` line:

```js
// Rules-engine short-circuit: when every AI tier is exhausted, the new
// "Rule-Based Lead Scorer" node hands us an already-finished decision
// instead of raw agent text. Detect it by score_source and pass it straight
// through -- do NOT try to regex/JSON-parse it as if it were LLM output.
if (rawOut.ai_decision && rawOut.ai_decision.score_source === 'RULES') {
  return [{ json: { lead: rawOut.lead || lead, ai_decision: rawOut.ai_decision } }];
}
```

**(b) Tag the AI path using the SAME four-value label NX920 already put on
`leads.score_source`** (`RULES` / `AI_SCORE_CONFIRMED` / `AI_SCORE_FALLBACK`
/ `AI_SCORE_UNKNOWN` -- see section 0), not an invented `'ai'` string, so
whatever eventually writes this to the `leads` row doesn't hit the column's
CHECK constraint. Inside the existing `ai_decision` object literal near the
bottom (the one built field-by-field from `parsed`), add:

```js
const ai_decision = {
  intent: ['HOT', 'WARM', 'COLD'].includes(intent) ? intent : 'WARM',
  score: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : 50,
  reason: parsed.reason || null,
  budget_aed: budget_aed,
  parse_failed: parseFailed,
  // NX920 labels (leads.score_source's live CHECK constraint), not 'ai':
  // a parse failure is explicitly NOT a model verdict (ADR-003) and must
  // not be filed the same as a genuine structured answer.
  score_source: parseFailed ? 'AI_SCORE_FALLBACK' : 'AI_SCORE_CONFIRMED',  // <-- new
  ai_score_raw: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : null,   // <-- new, NX920 column
  ai_intent_raw: (parsed.intent || null),                                              // <-- new, NX920 column
  score_reasons: parseFailed                             // <-- new (this patch's own field, not an NX920 column)
    ? ['agent output did not parse as JSON; regex fallback used']
    : [],
};
```

This makes `ai_decision.score_source` a reliable `RULES` /
`AI_SCORE_CONFIRMED` / `AI_SCORE_FALLBACK` discriminator everywhere
downstream (Slack messages, the dashboard, `nexus_scoring_health()`, any
future analytics), consistent with the value set the database already
enforces, without touching `Intent Switch` (still just reads `.intent`) or
`Persist Lead (deterministic)` (still just reads `.score` / `.intent` /
`.budget_aed` -- unaffected either way; wiring the new NX920 columns into
that node's `jsonBody` is the optional follow-up noted in 4.6).

### 4.6 Nothing else changes

- `Intent Switch`, `Persist Lead (deterministic)`, `Audit Log`, `Delivery
  Report`, `Slack: Unclassified Lead`, all HOT/WARM/COLD dispatch nodes:
  **zero changes**. They all key off `$json.ai_decision.*` or off
  `$('Parse AI Decision')`, and both are unaffected by which tier produced
  the decision.
- `AI Lead Scoring Agent`, `OpenRouter Chat Model`, `Groq Fallback`,
  `Supabase Lead Lookup`, `check_purchase_history`, `Simple Memory`:
  **zero changes**. The existing 3-tier retry behavior is preserved exactly;
  this patch only adds what happens *after* tier 3 also fails.
- **Not required for this fix, easy follow-up (no schema change needed --
  the columns already exist, see section 0)**: extend `Persist Lead
  (deterministic)`'s `jsonBody` to also send `score_source`, `rules_score`
  (when `RULES`), and `ai_score_raw` / `ai_intent_raw` (when `AI_SCORE_*`)
  from `$json.ai_decision`, e.g. add to the `Object.assign(...)` call:
  `score_source: $json.ai_decision.score_source`, plus the two
  `Number(...) > 0` conditional spreads it already uses for `budget_aed` as
  the pattern for `rules_score` / `ai_score_raw`. Left out of this patch
  deliberately because `Persist Lead (deterministic)` is owned by the
  concurrent persist-first patch (NX1002, section 0.3) this spec is meant
  to be merged with, and Supabase access for this task was read-only
  (SELECT-only), so no write was made to confirm the exact column set
  live -- section 0 above is from reading the migration files only.

## 5. `onError` audit -- confirming no tier's failure can kill the run after this patch

| Node | `onError` after patch | Why the run survives its failure |
|---|---|---|
| `AI Lead Scoring Agent` | `continueErrorOutput` (unchanged, already correct) | Error output loops to `Model Ladder` |
| `Model Ladder` | `continueErrorOutput` (**changed from unset/stop**) | Error output (post-tier-3) now goes to `Rule-Based Lead Scorer` instead of stopping |
| `Rule-Based Lead Scorer` (new) | `continueRegularOutput` | No network I/O, proven not to throw on any input (test 9); defensive only |
| `Parse AI Decision` | unset (default) -- acceptable | Pure in-memory string/JSON handling on data that, on the rules path, is already a validated object; on the AI path this is the existing, already-hardened parser |
| `Persist Lead (deterministic)` | `continueRegularOutput`, `alwaysOutputData: true` (unchanged) | Already resilient |
| `Audit Log` | `continueRegularOutput` + retry (unchanged) | Already resilient |
| `Delivery Report` | unset (default), but every `$('Node')` call already wrapped in try/catch (unchanged) | Already resilient |

Net effect: the only way this workflow execution can still hard-stop after
this patch is a failure in `Webhook Catch-All` -> `Verify JWT` ->
`Tenant For JWT User` -> `Auth Gate` -> `Validate & Enrich Input` (auth/tenant
resolution, which correctly SHOULD refuse rather than guess -- see that
node's own comments) -- never a scoring-provider outage.

## 6. Verification checklist for the merging agent (no production writes needed)

1. Re-`get_workflow_details JnlZFAVmFAuNXVya` and diff `versionId` against
   `aeaf34eb-20db-4440-826d-b2ebf4b078de` before touching anything.
2. Apply 4.1-4.5 together in one update (they're only load-bearing as a
   set -- e.g. flipping `Model Ladder`'s `onError` without adding the new
   node/connection would silently swallow the "all tiers failed" case into
   nothing happening at all).
3. Run `node --check ops/tenant-precedence/code/rule-based-scorer.js` and
   `node ops/tenant-precedence/code/rule-scorer.test.mjs` (10/10 passing as
   of this spec) before pasting the code into the node.
4. Use `mcp__n8n__validate_workflow` and `mcp__n8n__validate_node_config`
   after the edit, then `mcp__n8n__test_workflow` (or `prepare_test_pin_data`
   pinning `Model Ladder`'s output straight to an `attempt: 3` item) to
   exercise the exhausted-quota path without needing OpenRouter/Groq to
   actually be out of quota.
5. Confirm in the test execution: `Audit Log` and `Delivery Report` both
   ran without throwing, and the persisted-lead assertion in `Delivery
   Report`'s `CLAIMED` list still shows up verified.
