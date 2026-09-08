# Why finance_calculator kept failing, and the four things actually wrong
**2026-08-30 · executions 6646, 6660, 6668 · workflows `BiyHk9ZXxJUVGbf6`, `unMMpeL9uuPO79pp`**

Three live runs were captured with `saveDataSuccessExecution: all`, so everything below is read from
stored node data rather than inferred.

## The scoreboard first

| Exec | Customer message | Tool calls | Model runs | Duration | What the customer got |
|---|---|---|---|---|---|
| 6646 | "600" | 1 | 2 | 42s | An answer, but it asked for an "AECB email address" |
| 6660 | "…trade in… approx 5 lakh" | 6 | 7 | **87s** | "Sorry, I didn't catch that properly." |
| 6668 | "Mere pass trade in nahi hai, credit score 600 hai" | **11** | **12** | **147s** | "Sorry, I didn't catch that properly." |

In 6668 the agent's raw output was not an answer at all — it was its own debugging monologue, leaking
into the reply field: *"Maybe the field name is different: maybe it's `credit_score`? Let's try that."*
`Guard Reply` caught it and substituted the apology, which is the guard doing its job. But the customer
asked a simple question twice and got nothing twice.

## Root cause: one missing array

n8n decides how a sub-workflow tool presents itself to the model from a single condition in
`WorkflowToolService.ts`:

```ts
this.useSchema = (subWorkflowInputs?.schema ?? []).length > 0;
```

It reads the **caller node's own persisted `workflowInputs.schema`** — it never inspects the
sub-workflow at runtime. Our `finance_calculator` node had `mappingMode` and `value` but **no `schema`
key at all**. So `useSchema` was false, n8n built a LangChain `DynamicTool` (a single free-text
parameter), and every argument the model produced was stringified into one field. The declared
`$fromAI` fields were never bound. **The tool could not succeed with any input, and had not worked
since it was wired up.**

This also explains the escalating retries. The agent was not malfunctioning — it was reasoning
correctly against a contract it could not satisfy, trying `creditScore`, then `"600"` as a string,
then `credit_score`, then adding `lead_email` by hand.

### The trap in the first fix

The earlier fix set the sub-workflow trigger to `inputSource: "workflowInputs"`. That was necessary but,
alone, **made things worse**. `ExecuteWorkflowTrigger.execute()` does:

```ts
...pickBy(json, (_value, key) => newKeys.has(key))
```

Every key not in the declared schema is silently discarded, and every declared-but-unsupplied field is
pre-seeded with `null`. So the envelope key was stripped before any code in the sub-workflow could
unwrap it. Before: arguments arrived unparsed. After: they did not arrive at all. Exec 6660 and 6668
are that state.

The fix is both halves together: give the caller a real `schema` array **and** declare the envelope keys
`query` and `input` on the trigger so a degraded call is still recoverable.

## The four fixes applied

**1 · Tool binding.** `finance_calculator` now carries a 7-entry `schema` array, which is what puts it
into structured mode. `query` and `input` are declared on both sides so that if the caller ever degrades
again, `Calculate Equity & Tier` can unwrap the envelope instead of rejecting the call. A `_degraded`
flag is emitted whenever that fallback path is used — if it ever shows `true` in production, the
structured binding has silently reverted and that is the signal.

`lead_email` is a caller-side expression, not a `$fromAI` field, so it never enters the schema handed to
the model. The model cannot see it and cannot invent it. In degraded mode only, it falls back to the
envelope and the quote is flagged `email_from_model: true`, so the Finance Desk can tell a
workflow-established identity from a model-asserted one.

**2 · Error payloads written for a model, not a log file.** A bare `errors: []` array reads to an LLM as
"not done yet" and invites a retry. Every rejection now leads with an imperative `instruction`, then
`problems`, `expected` and `example_valid_call`. The wiring-fault case gets a hard stop: *"STOP. Do not
call finance_calculator again in this turn — retrying cannot fix this… tell the customer a colleague
will come straight back with the rate."* A customer-facing sentence, not an error code.

**3 · Iteration cap 8 → 3.** A legitimate journey needs one or two tool calls. At ~12s per model
round-trip on this box, 3 caps a bad conversation near 48s instead of 147s. Note for the record: the
empty output was **not** a max-iterations event — on n8n 2.x that throws a `NodeOperationError` with
explicit text. This was a genuinely empty model completion, a separate and upstream-unfixed n8n issue
(#11375, closed *not planned*). The cap bounds the damage; it is not the cure.

**4 · Groq fallback model was dead.** All three ladder tiers named `llama-3.3-70b-versatile`. Groq shut
that id down for free and developer tiers on **16 August 2026** — two weeks ago. Their deprecations page
names `openai/gpt-oss-120b` as the replacement, their models page now marks the old id
Enterprise/Contact-Sales, and it has no row at all in the free-tier rate-limit table.

Because Groq is only the fallback, it had never fired, so nothing surfaced this. It would have failed
for the first time on the day the primary was already down — the worst possible moment. Now
`openai/gpt-oss-120b`: production tier (not preview), free-tier callable, supports tool calling.
Its real ceiling is **8K tokens/minute**, which binds long before the 30 req/min limit does.

## A fifth change, made on safety grounds — please read

The rate table was invented by an earlier build and was being quoted to real customers over WhatsApp.
Three things were wrong with it:

- **It quoted unlabelled point rates.** UAE banks advertise a *flat* rate; true cost is the
  *reducing-balance* rate, roughly 1.87× the flat rate over 60 months. An unlabelled number is read as
  flat and so understates the cost by about half. CBUAE Consumer Protection Standard 2.3.1.13 requires
  an APR to be labelled as an APR and to be inclusive of fees.
- **Its worst band quoted 12.5%** — above Emirates NBD's published ceiling of 9.00% reducing / 9.65%
  APR. There is no published UAE band that supports that number.
- **Its cut-offs were American.** 720/680/620 and "Prime Plus / Subprime" are US FICO conventions. No
  UAE lender uses them. 620 was labelled "Subprime" although it sits inside ADCB's *Fair* band.

Replaced with ADCB's published AECB bands (the only band set published by an actual UAE lender — AECB
publishes none) and reducing-balance APR **ranges**, anchored to the observed used-car market and capped
at ENBD's published ceiling. Basis: used car, 60-month term, salary transfer.

| AECB score | Band | Reducing-balance APR | Flat equivalent |
|---|---|---|---|
| 746–900 | Excellent | 5.3 – 6.7% | ~2.50 – 3.20% |
| 711–745 | Very good | 5.9 – 7.5% | ~2.75 – 3.65% |
| 651–710 | Good | 6.7 – 8.7% | ~3.20 – 4.35% |
| 541–650 | Fair | 8.2 – 9.65% | ~4.05 – 4.90% |
| below 541 | Poor | **no rate quoted — refer to the bank** | — |

Every reply must now carry: *"Indicative only, not a bank approval. The bank sets the final rate after
reviewing the AECB report, salary transfer and employer. Shown as reducing-balance APR including fees.
Min 20% down payment, max 60 months (UAE Central Bank rules)."*

Worth knowing: **salary transfer is worth ~1.4pp reducing — a bigger lever than credit score.** A
score-only table varies the input that matters least. Adding a salary-transfer question would improve
quote accuracy more than any further tuning of the bands.

## Two decisions that are Ali's, not the system's

1. **Does ALBA CARS earn commission from a bank for arranging finance?** This is now more than a
   business question. CBUAE 5.2.3.3 requires commission arrangements to be *disclosed to the consumer*
   with controls against conflict of interest. An AI agent that steers customers toward financing while
   the dealership earns undisclosed commission is precisely the arrangement that rule addresses. The
   only reliable source for the number is ALBA CARS' own bank agreements.
2. **Whether ALBA CARS is contractually an "agent"** of any bank under CBUAE 5.1.1.80 — banks are held
   responsible for their agents' conduct, and those agreements may carry their own rate-quoting clauses.

---

**Note added 8 September 2026.** The two questions above are ALBA CARS' questions
because ALBA CARS is tenant #1 and the pilot. They are not one-off business
questions about a single dealer: **every dealership NEXUS is sold to has its own
bank agreements, its own commission arrangement, and its own answer to whether it
is contractually an agent of a bank.** So the answers belong in per-tenant
configuration and in the policy engine, not in a constant and not in an agent
prompt. Nothing about the finance figures above is changed by this note.

## Still open

- `saveDataSuccessExecution` on `BiyHk9ZXxJUVGbf6` remains `all` for one more verification message.
  **Restore to `none` after that** — real disk and CPU cost on an e2-micro.
- Voice-note branch designed but not applied (`/home/claude/nexus-ref/fixes/voice/`). One caveat found
  during design: `Model Ladder` re-reads `message` from `Resolve Lead Identity`, so without a patch the
  transcript would be discarded and the branch would be a silent no-op.
- `Window Buffer Memory` is still present but disconnected, and shows up as a validation warning on
  every save. It was deliberately replaced by `Fetch Thread History` (memory now survives restarts).
  It should be deleted rather than left dangling.
- The Groq replacement is verified from documentation only. No live call has been made — it needs one
  manual test invocation before it is trusted.
