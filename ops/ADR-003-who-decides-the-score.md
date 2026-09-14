# ADR-003 — Who decides the score

**Date:** 14 September 2026
**Status:** ACCEPTED, and deliberately temporary
**Supersedes nothing. Pairs with:** `ops/ADR-002-scaling-ladder-and-when-to-pay.md`

## The question

A lead arrives. A number between 0 and 100 and one of HOT / WARM / COLD decide
whether a salesperson's phone lights up in three seconds or whether the lead
goes into a drip. Who produces that number — the AI model, or deterministic
rules?

## What was actually happening

Measured on production, not assumed:

- The model ladder is entirely free-tier: `nvidia/nemotron-3.5-lightning:free`,
  `nvidia/nemotron-3-super-120b-a12b:free`, `minimax/minimax-m2.7:free`, with
  `openai/gpt-oss-120b` on Groq. **None of them is configured for structured
  output** — JSON is requested in prose and hoped for (FACT-096).
- On 13 Sep a model collapsed into repetition. A fallback regex `\b(\d{1,3})\b`
  matched `000` inside the babble, `parseInt("000")` gave `0`, and a live lead
  was filed **WARM / 0**. That was never a verdict (FACT-090).
- A quieter path was worse. An empty `{}` **parsed successfully**, so `intent`
  defaulted WARM and `score` defaulted 50 with `parse_failed: false`. An empty
  model response was byte-identical in the database to a genuine WARM/50
  (FACT-095).
- `parse_failed` was computed and **never persisted** (FACT-093), and a parse
  failure did not degrade the run's recorded status — it was filed SUCCESS
  (FACT-094).
- Fallback fired on 2 of 13 Master Router runs. **15%.** (FACT-092)
- Zero tests covered any of it (FACT-098).

So the honest summary of the old state: *roughly one lead in seven was scored by
a regex reading model babble, and nothing anywhere could tell you which one.*

## The decision

**Deterministic rules are authoritative. The model runs, its answer is recorded,
and it is labelled as a non-authoritative signal.**

Three things follow:

1. **Rules score every lead.** Explainable, deterministic, and every point is
   attributable to a named signal — reachable by phone, named an enquiry,
   buying-intent phrase, urgency phrase, budget band, already in a live thread.
   The same lead always produces the same number. Nothing here hallucinates and
   nothing here times out.
2. **The model's answer is kept, not thrown away**, in `leads.ai_score_raw` and
   `leads.ai_intent_raw`. That is what makes the flip in the next section a
   measurement rather than a guess.
3. **A parse that "succeeds" on `{}` is not a verdict.** Both `intent` and
   `score` must be present and valid or the answer is a fallback. That closes
   the hole that made an empty response look confident.

`leads.score_source` carries one of four labels, and
`nexus_scoring_health()` refuses to average across them:

| label | meaning |
|---|---|
| `RULES` | the deterministic scorer decided — today's default |
| `AI_SCORE_CONFIRMED` | the model returned valid structured JSON and decided |
| `AI_SCORE_FALLBACK` | the model returned no usable verdict |
| `AI_SCORE_UNKNOWN` | provenance was never recorded — every row written before today |

**UNKNOWN is not ZERO. FALLBACK is not a model verdict.** A FALLBACK 50 and a
CONFIRMED 50 are not the same number and must never be aggregated together.

## When this flips

Per ADR-002, the spending trigger is **two paying auto dealers**. At that point
the paid model arrives, and a paid model means real structured output
(`response_format` / a JSON schema), which is the only thing that makes an AI
verdict trustworthy enough to route on.

The flip is **one constant** in the `Parse AI Decision` node:

```js
const AUTHORITY = 'RULES';   // -> 'AI'
```

No schema change. `score_source` starts writing `AI_SCORE_CONFIRMED` where the
model answered properly and `AI_SCORE_FALLBACK` where it did not, and the rules
score keeps being written alongside as the comparison baseline.

**The evidence to require before flipping**, not a date: at least 200 leads
scored by both, and `nexus_scoring_health()` showing `AI_SCORE_FALLBACK` under
1% of runs. Until that is measured, "the AI scores leads" is a claim, not a
fact.

## What this costs

Rules are blunter than a good model on unusual phrasing. A lead that says "my
brother told me you had the black one" scores low on rules and a strong model
would catch it. That is the accepted cost. The alternative — a free model
silently filing a buying customer as WARM/0 — costs a sale, and costs it
invisibly.

## What is enforced, not just written down

- `leads_score_source_is_a_known_label` — a CHECK constraint. A row cannot be
  written with an unlabelled score.
- `ops/scoring/parse-ai-decision.test.js` — runs the *exact* jsCode body lifted
  out of the workflow JSON against decoder babble, `{}`, half-objects, invented
  intents, out-of-range scores and prose budgets. 18 assertions. Wired into CI,
  so the defect cannot come back quietly.
