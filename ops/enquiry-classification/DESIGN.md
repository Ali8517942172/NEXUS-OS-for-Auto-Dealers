# The enquiry classifier and the held queue

**A design, 8 September 2026. Nothing here is applied.** No migration is run, no
n8n node is published, no row is written. Every SQL block is a proposal to run
later, deliberately, with someone watching. The measurements are read-only
queries against production `dsvuoovivysszdoiorch`, run today, and each one is
printed with the query that produced it.

This document owns one layer and one layer only: **the classifier that decides a
conversation's phase, and the queue that holds what it declined.**
`ops/whatsapp-lead-capture/SPEC.md` owns everything around it — the endpoint
rows, the provenance kind, the `external_event_id`, the four doors, the n8n
graph, the arming order. That document made the decision this one implements:

> **B, with the classification deciding the PHASE and never deciding whether the
> arrival is recorded.**

The owner has accepted it, in these words:

> **Capture everything. Promote intelligently. Lose nothing.**

Nothing below contradicts the SPEC. Where the SPEC left a hole — what exactly is
classified, what the prompt says, which model says it, what the error budget is,
what the queue looks like, and where the decision is written down — this
document fills it.

---

## 0. The vocabulary, reconciled with the phase machine before anything else

The accepted model names a state called `HELD`:

```
WhatsApp → Authenticate → Durable message event → Conversation
  → AI intent classification → RECEIVED
      → Vehicle enquiry?
            NO  → HELD
            YES → HYDRATE → existing customer? → ATTACH or PROMOTE
```

**`HELD` is not a new `lead_event.phase`, and it must not become one.** The phase
CHECK on production is closed:

```sql
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.lead_event'::regclass and conname = 'lead_event_phase';
```

    CHECK (phase = ANY (ARRAY['RECEIVED','HYDRATED','PROMOTED','DUPLICATE',
                              'REJECTED','QUARANTINED','EXPIRED']))

**`HELD` is what a person sees. `RECEIVED` plus a recorded classification is what
the database holds.** The mapping is exact and it is one view, not a migration:

| the owner's word | the database |
|---|---|
| RECEIVED | `lead_event.phase = 'RECEIVED'`, no classification row yet |
| HELD | `lead_event.phase = 'RECEIVED'` **and** a latest `enquiry_classification` row whose decision is `HOLD` |
| HYDRATE | `nexus_hydrate_lead_event` → `phase = 'HYDRATED'` |
| ATTACH / PROMOTE | `nexus_attach_lead_event` / `nexus_promote_lead_event` → `phase = 'PROMOTED'` |
| terminalised | `phase = 'QUARANTINED'`, `disposition_reason` set |

**Three reasons a ninth phase value is the wrong answer**, and the third is the
one that would actually bite:

1. Every reader learns a new value — `v_lead_origin`, `nexus_lead_trace`, the
   Lead Sources screen, `nexus_lead_ingest_invariants()`. The SPEC rejected a
   ninth `lead_provenance_kind` on exactly this reasoning and the reasoning does
   not change because the table changed.
2. `lead_event_terminal_needs_reason` lists the four terminal phases. `HELD`
   would be a fifth non-terminal phase with a mandatory reason, which is a
   different rule wearing the same constraint's name.
3. **The sweep's index would stop matching.** `leadingest_03` creates
   `on public.lead_event (received_at) where phase = 'RECEIVED'` — a partial
   index whose whole purpose is finding not-yet-promoted arrivals. Move held
   rows to a new phase and the quarantine sweep (SPEC §7.1 M5) is a sequential
   scan over an append-only table that only grows. The index was built for this
   query before this query existed; do not walk away from it.

So: **held is derived, and the phase machine is untouched.** The view is §4.2.

---

## 1. The classification contract

### 1.1 What is classified: the conversation, not the message

The SPEC already says the conversation. It is worth saying why, because the
alternative is cheaper and looks reasonable until you read one week of real
traffic.

**"How much?" carries no intent. "How much for the Patrol" does.** They are the
same three-word grammar and one of them is a customer. A per-message classifier
sees the first, has nothing to attach it to, and must either guess (and
manufacture a lead out of a question about a kitchen worktop — two of those are
in the measured week) or refuse (and lose the customer who asked about the
Patrol yesterday and the price today).

The measured week says this is the ordinary case, not the edge:

```sql
select count(*) as inbound, count(distinct lead_email) as people
  from public.communication_logs
 where channel_key = 'whatsapp' and direction_key = 'inbound'
   and created_at >= now() - interval '7 days';
```

    31 | 9

**Thirty-one messages from nine people: 3.4 messages per person per week.** A
per-message classifier throws away two-thirds of what it could have read, and
throws it away on precisely the openers — *"Hi"*, *"السلام علیکم"* — that carry
the least signal on their own.

The conversation is also what makes the *recovery* work. The SPEC's step 3 —
*"Hi" today and "how much for the Patrol" tomorrow is one lead, created on the
second message, with the first message already in the record* — is only
implementable if the second classification can see the first message. A
per-message classifier has no such tomorrow.

### 1.2 The input, exactly

One classification call takes **one conversation** and produces **one verdict**.
The conversation is identified the way everything else in this design is: by the
`lead_event` whose `external_event_id` is `'wa:' || <E.164>` (SPEC §5.2).

```
INPUT to the classifier
  conversation_ref     the lead_event.event_id  (never sent to the model)
  messages             up to the last 20 messages for this thread, oldest first,
                       each: { seq, direction, text, sent_at }
                       text truncated at 400 characters per message
                       source: v_lead_messages / communication_logs for this
                               thread_key, plus the current inbound message,
                               which may not be logged yet
  total_chars          hard cap 6,000 characters across all messages
```

**Everything the model is NOT given, and why each one is deliberate:**

| withheld | why |
|---|---|
| the inventory (`search_inventory`) | it returns `price_aed` **and `cost_aed`**. A model that can see internal vehicle cost is a model that can put internal vehicle cost into a `reason` string that renders on a screen. The classifier has no reason to know what we stock — "is this a vehicle enquiry" does not depend on whether we have the car |
| `finance_calculator` | the classifier decides nothing about money (§7) |
| the customer's name, phone, email, `push_name` | it decides intent from content. Identity is NEXUS's job and it is already done deterministically. A model given a phone number is a model that can echo a phone number |
| any CRM state — prior leads, prior deals, VIP status | that is the Router's scoring input, after a lead exists. Feeding it here makes "is this a customer" depend on "were they a customer", which is how a returning buyer's *"can you pick up my daughter"* becomes a HOT lead |
| tools of any kind | the n8n Agent node is not used. There is nothing to call |

**Where the messages come from, and the one gap in that source.** The thread is
read from `communication_logs` through the resolution `v_conversations` already
does — `thread_key` is the identity, `chat_id` is the address, and they are not
the same string. `communication_logs` is **not** a complete record: the SPEC
measures five messages claimed in `processed_messages` and never logged. So the
classifier's input is the best available record and not the whole truth, and the
held-queue row says how many messages it read (§4.3) rather than implying it read
them all.

### 1.3 The output schema

**Two objects, and the boundary between them is the point.**

The model returns only what only the model can know. **Every field NEXUS can
compute for itself, NEXUS computes for itself** — the model never names the model
that answered, never stamps the prompt version, never reports its own latency,
never decides the hold reason. Model-authored metadata is model-authored text,
and the repo has already found a fabricated citation arriving pre-validated in
`ask.js` because a marker the model emitted was trusted as a fact about
retrieval.

**What the model returns** — strict JSON, no other object shape accepted:

```json
{
  "verdict": "VEHICLE_ENQUIRY",
  "confidence": "HIGH",
  "unclear_because": null,
  "evidence": [
    { "seq": 3, "quote": "how much for the Patrol" }
  ],
  "vehicle_mentioned": "Patrol",
  "language": "en",
  "reason": "The customer asks the price of a named vehicle."
}
```

| field | type | what NEXUS does with it |
|---|---|---|
| `verdict` | `VEHICLE_ENQUIRY` \| `NOT_VEHICLE_ENQUIRY` \| `UNCLEAR` | the primary input to the decision table (§1.5). Any other value is a parse failure |
| `confidence` | `HIGH` \| `MEDIUM` \| `LOW` | the second input to the decision table. Three bands, not a number — see §1.4 |
| `unclear_because` | `TOO_SHORT` \| `NO_SUBJECT` \| `LANGUAGE_NOT_UNDERSTOOD` \| `AMBIGUOUS_SUBJECT` \| `MIXED_TOPICS` \| `null` | required when `verdict = UNCLEAR`, null otherwise. Chooses between the `NEEDS_MORE_CONTEXT` and `UNCLEAR` hold reasons. It is a **closed vocabulary**, so it can be counted; the free-prose `reason` cannot |
| `evidence` | array of `{seq, quote}`, 0–3 entries | **verified verbatim before it is believed** (§1.6). Rendered on the held-queue row so a salesperson sees what the machine read, not what it concluded |
| `vehicle_mentioned` | verbatim substring or `null` | becomes `normalized.vehicle_interest` at hydration **only if it appears verbatim in the input**. Never a matched inventory record, never a trim, year or variant the customer did not type. `null` is a correct answer and is written as null |
| `language` | BCP-47-ish tag or `"mixed"` or `"unknown"` | rendered on the queue row, and counted, so the language mix is a measured fact rather than an assumption. Decides nothing |
| `reason` | one sentence, ≤ 200 chars | rendered to **staff only**, in the held queue. It never enters an outbound message, a lead field, or anything a customer reads (§7) |

**What NEXUS stamps, from its own knowledge:**

| field | source |
|---|---|
| `model` | the ladder tier's model id — the string the node actually sent |
| `ladder_tier` | 0-based index in the ladder, so a silent drop to the backup tier is visible. `ask.js` records that this is currently *unknowable* for the RAG path because nothing in the payload marks a fallback; this design does not repeat that |
| `prompt_version` | a constant in the node, `enquiry-classifier/1.0.0`. Bumped by hand whenever the prompt text changes |
| `latency_ms`, `classified_at` | measured by the node |
| `input_digest` | `sha256` of the exact serialised message array sent to the model — so "was this decision made on the same conversation I am looking at?" is answerable |
| `message_count`, `input_chars` | what the model was given |
| `evidence_verified` | boolean, from the verbatim check (§1.6) |
| `decision` | `PROMOTE` \| `HOLD` \| `NO_CALL` — from the decision table, deterministically |
| `hold_reason` | one of the six (§1.5) — NEXUS's label, not the model's |

**The rule stated once: the model describes the content, NEXUS decides what to
do about it.** That is the same separation `leadingest_06` exists to protect
between content and origin, applied one layer up.

### 1.4 Confidence: three bands, and why not a number

The obvious design is `confidence: 0.87` and a cutoff. **Rejected**, for three
reasons that are specific to this system rather than general:

1. **A free-model ladder makes a numeric cutoff meaningless.** Three different
   OpenRouter models plus a Groq fallback answer this prompt (§5). `0.7` on
   `nemotron-3.5-lightning` and `0.7` on `minimax-m2.7` are not the same claim,
   and nothing calibrates them. A single cutoff across four models is a cutoff
   across four different scales.
2. **A number invites tuning without evidence.** The measured false-negative
   rate (§3) is the only thing that should move this threshold, and it takes
   weeks of held-queue clicks to produce. A decimal knob gets nudged on a hunch
   the first week; a three-value band has to be argued about.
3. **The repo already has a 1–100 scale and it means something else.**
   `leads.ai_score` and `ai_decision.intent` are the Router's *urgency* judgement
   about a lead that already exists. Reusing the shape here would leave two
   scores, both 1–100, both AI-written, answering different questions, and
   somebody would eventually compare them.

`HIGH` / `MEDIUM` / `LOW` are defined **in the prompt** in behavioural terms, not
left to the model's sense of the words (§2).

### 1.5 The decision table

Deterministic. This is a lookup, not a judgement, and it lives in a Code node
where it can be read and tested without a model.

| verdict | confidence | evidence verified | → decision | hold_reason |
|---|---|---|---|---|
| `VEHICLE_ENQUIRY` | HIGH | yes | **PROMOTE** | — |
| `VEHICLE_ENQUIRY` | MEDIUM | yes | **PROMOTE** | — |
| `VEHICLE_ENQUIRY` | LOW | yes | HOLD | `POTENTIAL_ENQUIRY` |
| `VEHICLE_ENQUIRY` | any | **no** | HOLD | `HUMAN_REVIEW` |
| `NOT_VEHICLE_ENQUIRY` | HIGH or MEDIUM | n/a | HOLD | `NOT_VEHICLE_ENQUIRY` |
| `NOT_VEHICLE_ENQUIRY` | LOW | n/a | HOLD | `UNCLEAR` |
| `UNCLEAR` | any | n/a | HOLD | `NEEDS_MORE_CONTEXT` if `unclear_because ∈ {TOO_SHORT, NO_SUBJECT}`, else `UNCLEAR` |
| output did not parse as the schema | — | — | HOLD | `HUMAN_REVIEW` |
| no tier answered | — | — | **NO_CALL** → HOLD | `CLASSIFIER_UNAVAILABLE` |

**PROMOTE means hand off to the SPEC's chain**, not "write a lead":
`nexus_hydrate_lead_event` → `nexus_lead_for_phone` → `nexus_attach_lead_event`
or `nexus_promote_lead_event`. This document never writes to `public.leads` and
neither does the classifier.

**The five hold reasons the owner named, mapped exactly:**

| the owner's words | `hold_reason` | when |
|---|---|---|
| Potential enquiry | `POTENTIAL_ENQUIRY` | reads like an enquiry, evidence thin |
| Needs more context | `NEEDS_MORE_CONTEXT` | too short to tell — the *"Hi"* case |
| Not vehicle enquiry | `NOT_VEHICLE_ENQUIRY` | confidently something else |
| Unclear | `UNCLEAR` | the model could not decide, and said why |
| Human review | `HUMAN_REVIEW` | a deterministic check fired, or a person sent it back |

**And a sixth, proposed, flagged as a proposal.** `CLASSIFIER_UNAVAILABLE` — the
model was never reached. It is **not** one of the five and must not be folded
into `UNCLEAR`, because those five are statements about the customer and this one
is a statement about us. Rendering our outage as the customer's ambiguity is the
"unknown rendered as none" defect this codebase has found in seven places. It
carries different behaviour too: it is retried, and §4.5 forbids the sweep from
ever terminalising a conversation that only ever held this reason. It is open
question 1.

### 1.6 The evidence check, which is the only thing standing between a verdict and a lead

**Every `quote` must appear verbatim in the message it names.** The check is
deterministic code, runs before the decision table, and is the reason a promote
can be defended:

```
for each e in evidence:
    m = messages[e.seq]                       # seq out of range → fail
    ok = normalise(m.text).includes(normalise(e.quote))
    # normalise: NFKC, collapse whitespace, casefold. Nothing else.
    # No fuzzy matching, no edit distance, no "close enough".
evidence_verified = (evidence non-empty) and (every entry ok)
```

**A `VEHICLE_ENQUIRY` with no evidence, or with an unverifiable quote, is not
promoted.** It is held as `HUMAN_REVIEW`. This is the `ask.js` fabricated-citation
finding ported: a model shown sections S1–S13 and writing `[S14]` got a real
document title rendered under its answer. There, the cost was a wrong citation on
a screen. Here, the cost is a customer who does not exist being phoned.

`vehicle_mentioned` passes the same check against the whole input before it is
allowed to become `vehicle_interest`. A model that answers `"Nissan Patrol
Platinum 2024"` to a customer who typed `"patrol"` has invented a trim and a
year, and that string would land in the CRM and be read as what the customer
asked for.

**Normalisation is NFKC-plus-whitespace-plus-case and nothing more, on purpose.**
The input contains Arabic and Urdu script, and any cleverer normaliser is a place
where a quote in a script nobody on the team reads gets silently "corrected" into
a match.

---

## 2. The prompt

House style: one system message, hard rules in capitals, dated rules naming the
incident that produced them, strict JSON out and nothing else. `prompt_version`
is a constant in the node — **the model is never asked to echo it**, because a
version string the model wrote is not evidence of which prompt ran.

### 2.1 System message — `enquiry-classifier/1.0.0`

```text
You are the NEXUS OS enquiry classifier for a car dealership in the UAE. You read
a WhatsApp conversation and answer exactly one question: is this person enquiring
about buying, financing, part-exchanging or test-driving a vehicle from this
dealership?

You are not a salesperson. You do not reply to the customer. Nothing you write is
ever sent to anyone outside the dealership. Your entire output is a JSON object
that a program reads.

WHAT COUNTS AS A VEHICLE ENQUIRY
An enquiry is present when the customer is asking about acquiring a vehicle from
us. Any ONE of these is enough:
- they name or describe a vehicle and ask about it (price, availability, mileage,
  year, specification, colour, condition, warranty, photos);
- they ask about financing, instalments, a down payment, a bank, salary transfer
  or leasing for a vehicle;
- they offer or ask about a trade-in, part-exchange or selling their car to us;
- they ask to see a car, to visit, to book a test drive, or where we are, in the
  context of a vehicle;
- they reply to one of our listings or adverts, even briefly ("is this still
  available?", "still there?");
- they ask us to send options within a stated budget or category ("any 7-seater
  under 80k?").

WHAT IS NOT A VEHICLE ENQUIRY
- personal, family or social conversation of any kind;
- another business selling TO us, quoting us, invoicing us, or chasing a payment
  from us — building materials, printing, design work, IT, recruitment;
- an existing service, warranty-claim, registration or paperwork matter that is
  not about acquiring a vehicle;
- a job application;
- a wrong number;
- spam, a scam, a phishing attempt, or a request for a password, an OTP, a code
  or account access. Added 8 September 2026: one week of real traffic on this
  line contained a message reading "I know your router password, can you give me
  your router pa…". Classify that NOT_VEHICLE_ENQUIRY at HIGH confidence. It is
  not an ambiguous message.

INTENT, NOT SENTIMENT. Added 8 September 2026, the rule this classifier exists
for. You are judging what the customer WANTS, never how they FEEL and never how
they sound.
- An angry, blunt or rude message about a car IS a vehicle enquiry. "This price
  is a joke, what's your real number" is a customer negotiating.
- A warm, polite, friendly message about anything else is NOT a vehicle enquiry.
  "Assalamu alaikum brother, hope you are well, come for dinner" is family.
- A one-word message is not "negative". It is short. Say UNCLEAR, do not guess.
- Do not reward enthusiasm and do not punish terseness. UAE buyers write short.

LANGUAGE. Added 8 September 2026 after one week of real traffic on this line was
measured: Gujarati, Urdu, Hindi, Punjabi and English, mixed inside single
conversations. A UAE dealership line will also carry Arabic, Malayalam, Tagalog,
Tamil, Bengali, Nepali, Russian, Farsi and more.
- Classify in ANY language. A vehicle enquiry in Malayalam is a vehicle enquiry.
- Roman-script transliteration is normal and is not a different language.
  "kitna price hai", "gaadi available hai", "bhai kitne ka", "kam aad ha" are
  ordinary customer messages. Read them.
- Mixed-script and code-switched messages are ordinary. Read the whole thing.
- If you genuinely cannot read the message, return UNCLEAR with
  unclear_because = "LANGUAGE_NOT_UNDERSTOOD". Never guess a meaning from a
  script you cannot read, and never assume a message you cannot read is spam.
- Report the language you saw in "language". If two or more, say "mixed". If you
  do not know, say "unknown". Never guess a language to look confident.

READ THE WHOLE CONVERSATION, NOT THE LAST MESSAGE. The conversation is given
oldest first. "How much?" on its own means nothing; "How much?" three messages
after "do you have the Patrol" is a price question about a Patrol. Equally, a
vehicle named eight messages ago in a conversation that has since become a
personal chat does not make today's "call me" a vehicle enquiry.

INVENT NOTHING. Added 8 September 2026, from a live incident on this system: a
model quoted a customer a monthly instalment of AED 11,200 that nothing had
calculated, and the figure survived into a later internal brief and was almost
read back to the customer.
- Never state a price, an instalment, a rate, a tenure, a down payment, a
  discount or any other figure. Not in "reason", not anywhere. You have no
  numbers and you are not asked for any.
- Never name a vehicle the customer did not name. Do not add a make to a model,
  a year, a trim or a variant. If they wrote "patrol", the vehicle is "patrol".
- Never state anything about the customer that the messages do not say — no
  name, no budget, no timeline, no seriousness, no nationality, no job.
- Never say what we have in stock. You have not been told and it is not part of
  this question.
- Every quote in "evidence" must be copied CHARACTER FOR CHARACTER from the
  message you name. A quote that does not appear in that message is checked and
  rejected by the program, and your verdict is set aside.

WHEN YOU ARE NOT SURE, SAY SO. Returning UNCLEAR is a correct, expected and
frequently right answer. It is not a failure and nothing bad happens: the
conversation is kept, a person sees it, and you are asked again when the customer
writes more.
- Never pick VEHICLE_ENQUIRY because it seems more useful.
- Never pick NOT_VEHICLE_ENQUIRY to be tidy.
- When you return UNCLEAR you MUST set unclear_because to one of:
    TOO_SHORT               there is not enough text to judge — "hi", "salam"
    NO_SUBJECT              they wrote enough, but named no subject at all
    LANGUAGE_NOT_UNDERSTOOD you could not read it
    AMBIGUOUS_SUBJECT       the subject could be a vehicle or could be something
                            else, and the conversation does not settle it
    MIXED_TOPICS            a genuine vehicle question is mixed with unrelated
                            business and you cannot tell which is the point

CONFIDENCE. Use these definitions, not your own sense of the words:
  HIGH    the conversation would read the same way to any colleague. There is an
          explicit vehicle, finance, trade-in or visit request, or the message is
          plainly personal or plainly another trade.
  MEDIUM  you believe your verdict and you can quote the line it rests on, but a
          reasonable colleague could read it the other way.
  LOW     you are leaning. Say LOW rather than inventing certainty.
If your verdict is VEHICLE_ENQUIRY you MUST provide at least one evidence quote.
A VEHICLE_ENQUIRY with no evidence is discarded by the program.

OUTPUT
Return ONLY a raw JSON object and nothing else. No markdown, no code fences, no
commentary before or after, no explanation of your reasoning.

{
  "verdict": "VEHICLE_ENQUIRY" | "NOT_VEHICLE_ENQUIRY" | "UNCLEAR",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "unclear_because": null | "TOO_SHORT" | "NO_SUBJECT" | "LANGUAGE_NOT_UNDERSTOOD" | "AMBIGUOUS_SUBJECT" | "MIXED_TOPICS",
  "evidence": [ { "seq": 3, "quote": "exact text copied from message 3" } ],
  "vehicle_mentioned": null | "the vehicle words the customer typed, verbatim",
  "language": "en" | "ar" | "hi" | "ur" | "gu" | "pa" | "ml" | "tl" | "mixed" | "unknown",
  "reason": "one short sentence, under 200 characters, no figures"
}
```

### 2.2 User message

```text
=Conversation with this person, oldest first. Message numbers are the "seq"
values you must use in evidence.

{{ $json.transcript }}

Classify this conversation now.
```

`transcript` is built by the node as:

```
[1] customer (2026-09-02 06:07): salam
[2] us (2026-09-02 06:07): Hello! Welcome to Tenant A…
[3] customer (2026-09-03 11:20): how much for the Patrol
```

Direction is rendered `customer` / `us` rather than `inbound` / `outbound`
because the second pair is jargon and the model reads English prose better than
it reads a schema.

### 2.3 Worked examples against the measured week

Not tests. These are the seven-day sample characterised in
`ops/whatsapp-lead-capture/SPEC.md` §1.5, and what this prompt should say about
each. **Any implementation of this design must run these before it is armed**, as
positive and negative controls in the SPEC's §7.4 step 1.

| the message | expected verdict | confidence | notes |
|---|---|---|---|
| *"Hi i m interested in the fortuner whats the price"* | `VEHICLE_ENQUIRY` | HIGH | evidence quotes the line; `vehicle_mentioned = "fortuner"` — lower case, as typed |
| *"I have been driving for 6-7 hours. Can you please adjust for a while?"* | `NOT_VEHICLE_ENQUIRY` | HIGH | **this is lead 122 on production.** A friend asking a favour, currently a COLD lead with `ai_score = 30` |
| a tile and kitchen-worktop quotation, slabs and prices in AED | `NOT_VEHICLE_ENQUIRY` | HIGH | another trade quoting us. Contains AED figures and is still not a customer — the reason the rules say "another business selling TO us" explicitly |
| *"please update our payment status"* | `NOT_VEHICLE_ENQUIRY` | HIGH or MEDIUM | unrelated business chasing us |
| *"I know your router password, can you give me your router pa…"* | `NOT_VEHICLE_ENQUIRY` | HIGH | named in the prompt |
| *"salam"* alone | `UNCLEAR` / `TOO_SHORT` | any | → `NEEDS_MORE_CONTEXT`, held, reclassified on the next message |
| Gujarati/Punjabi family messages about coming home, samosas, prayers | `NOT_VEHICLE_ENQUIRY` | HIGH | the twenty-two-message bulk of the week |

**The honest expectation.** On this sample the classifier should produce one
promote out of nine conversations. The current production path produced four
leads across its whole lifetime, **zero of them a real vehicle enquiry, two
requiring manual disqualification**. A classifier that gets this sample right is
not impressive; a classifier that gets it wrong is worse than what exists.

---

## 3. The failure budget, as a business decision

### 3.1 The two errors are not the same size, and neither is the same size as its own recovery

| | what it costs | who notices | what it costs to fix |
|---|---|---|---|
| **False positive** — a rubbish conversation promoted | one CRM card. An SLA clock starts, pipeline value moves, and a salesperson may phone a stranger | the salesperson, immediately, because it arrives in front of them | one close-click, plus the phone call if they made it before reading it |
| **False negative** — a real enquiry held | a customer | **nobody**, unless someone opens the held queue | one promote-click, if anyone looks |

**The asymmetry that actually governs this design is not FP-vs-FN. It is
automatic-vs-attended.** A false positive is delivered to a human whether they
want it or not. A false negative is delivered to a screen someone has to choose
to open. So the quantity to minimise is not the false-negative rate. It is:

> **unrecovered false negatives** — real enquiries the classifier declined that
> no human ever promoted, and which terminalised.

That reframing is what lets a precision-favouring threshold be the right answer
without "we lose customers" being the price. And it puts the load where it
belongs: **the held queue's visibility, not the model's cleverness, is what makes
this design safe.** If the queue is not read, the recommendation in §3.3 is the
wrong recommendation, and §3.5's coverage figure is what says so out loud.

### 3.2 The base rate is brutal, and worse: it is unmeasured on the surface that matters

```sql
select count(*) as inbound,
       count(*) filter (where message ~* '(car|vehicle|suv|sedan|price|aed|dirham|finance|installment|emi|test drive|mileage|model|toyota|nissan|bmw|mercedes|lexus|kia|hyundai|land ?cruiser|patrol|available|سيار|سعر)') as vehicle_keyword_hits
  from public.communication_logs
 where channel_key='whatsapp' and direction_key='inbound'
   and created_at >= now() - interval '7 days';
```

    31 | 1

**One in thirty-one, and the one was planted** — Ali's own Indian number, his own
test (SPEC §1.5). At that base rate a classifier with 95% precision and 95%
recall promotes one true enquiry and one and a half rubbish ones. Precision on a
1-in-31 line is dominated by the false-positive rate on the 30, not by the
true-positive rate on the 1.

**And the caveat is load-bearing.** That is Ali's personal handset — his family's
number and his other businesses'. A dealership sales line inverts the mix, and
nobody in this repo knows by how much. **So the threshold recommended below is
recommended for a line whose base rate is unknown and possibly terrible**, which
argues for precision; and it is paired with a counting scheme (§3.4) that makes
the threshold movable on evidence once a real line has run for a month.

### 3.3 The recommendation

**Optimise against unrecovered false negatives. Set the promote threshold high.
Buy recall back with the queue, not with the model.**

> **Threshold: promote when `verdict = VEHICLE_ENQUIRY` AND `confidence ∈ {HIGH,
> MEDIUM}` AND at least one evidence quote verified verbatim. Hold everything
> else.**

Three components, and each is doing separate work:

- **`VEHICLE_ENQUIRY`** — no promoting on `UNCLEAR`. An unclear conversation is
  held and asked again tomorrow, which costs nothing, because the arrival is
  already recorded.
- **`HIGH` or `MEDIUM`, not `HIGH` alone.** `HIGH`-only would hold a genuine
  *"is this still available?"* reply to one of our own listings — the single most
  common real enquiry in the UAE market and the one that reads ambiguous out of
  context. That is a false negative on the highest-value message type, and the
  queue is a poor place for a customer who is ready now.
- **Verified evidence, as a hard gate.** This is what stops the threshold being
  a vibe. A model that cannot quote the line it is relying on is a model whose
  confidence is not about this conversation.

**Why not lower.** Promoting on `LOW` would, on the measured week, promote
family messages. The production record of the eager path is precision zero and
two manual disqualifications on thirty messages; a dealership that gets that at
volume stops opening the CRM, and then every downstream figure in this product is
measuring an unread screen.

**Why not higher.** Requiring `HIGH` plus a named vehicle would hold every
listing reply and every finance question, which is most of the money.

**And the threshold is a constant in one Code node, versioned with the prompt.**
Changing it changes `prompt_version`. A threshold that moves without the audit
row saying so makes every historical rate uncomparable.

### 3.4 How each error is COUNTED

An uncounted error rate is not a rate. Four counters, three of which need nobody
to remember anything.

**FN-1 — the promote-from-held click. The primary measured false-negative rate.**

Every promote from the held queue is, by definition, a conversation the
classifier declined and a human overrode. It is recorded as an act, with the
actor, at the moment it happens.

```sql
-- PROPOSED. Reads the classification ledger of §6.
select date_trunc('week', h.acted_at)                              as week,
       count(*) filter (where h.action = 'PROMOTE')                as promoted_from_held,
       count(*) filter (where h.action in ('PROMOTE','DISMISS'))   as reviewed,
       round(100.0 * count(*) filter (where h.action = 'PROMOTE')
             / nullif(count(*) filter (where h.action in ('PROMOTE','DISMISS')),0), 1)
                                                                   as fn_rate_pct_of_reviewed
  from public.enquiry_hold_action h
 where h.tenant_id = <tenant> group by 1 order by 1;
```

**The denominator is the whole argument.** It is *reviewed* held conversations,
not *all* held conversations. A held row nobody opened is not a true negative; it
is an unknown, and counting it as a correct rejection is how a classifier scores
99% by being ignored. Which forces the second figure:

**FN-1b — coverage. Published beside FN-1, never without it.**

```sql
select count(*)                                                   as held_total,
       count(*) filter (where acted_at is not null)               as reviewed,
       round(100.0*count(*) filter (where acted_at is not null)/nullif(count(*),0),1) as coverage_pct
  from public.v_enquiry_held_all where tenant_id = <tenant>
    and first_received_at >= now() - interval '30 days';
```

**Below roughly 60% coverage, FN-1 is not reported as a rate at all** — it is
reported as "N conversations were promoted out of M reviewed, of H held", and the
screen says the rest is unknown. `lead-recovery.js` already does exactly this with
its 51-of-106 denominator, printed beside the figures rather than left for the
reader to discover. Same rule, same reason.

**FN-2 — the customer NEXUS held and the dealership found anyway. Needs nobody.**

The most valuable counter, because it runs on a schedule and depends on no human
clicking anything. A lead created by *any other route* — walk-in, phone call,
Meta, a salesperson typing it in — whose phone matches a conversation this
classifier was holding at the time.

```sql
-- PROPOSED. One row per customer NEXUS declined and the dealership got anyway.
select l.id, l.name, l.source, l.created_at, e.event_id,
       c.verdict, c.confidence, c.hold_reason, c.model, c.prompt_version
  from public.leads l
  join public.lead_event e
    on e.tenant_id = l.tenant_id
   and e.external_event_id = 'wa:' || regexp_replace(coalesce(l.phone,''),'[^0-9+]','','g')
  join lateral (select * from public.enquiry_classification x
                 where x.event_id = e.event_id and x.classified_at < l.created_at
                 order by x.classified_at desc limit 1) c on true
 where l.source <> e.source_key
   and c.decision = 'HOLD'
   and l.created_at >= now() - interval '90 days';
```

Every row is a false negative with a receipt: the customer, the verdict that held
them, the model that produced it and the prompt version it ran under. **This is
also the query that answers "why did you not tell me about this customer" for the
one case where the dealership already knows the answer is embarrassing.**

**FP — the promoted card that was not a customer. Counted by an act, not inferred
from a status.**

The tempting counter is `leads.status = 'DISQUALIFIED'`. **Measured today, that
column has no CHECK constraint and mixed casing:**

```sql
select status, count(*) from public.leads group by 1 order by 2 desc;
```

    DISQUALIFIED 2 | COLD 1 | WARM 1 | new 1

```sql
select conname from pg_constraint
 where conrelid='public.leads'::regclass and contype='c';
```

    leads_response_time_nonneg          -- and nothing about status

A free-text column with five values in four casings is not a metric. **So the
false positive is counted by an explicit act**: a "Not a customer" control on a
WhatsApp-promoted lead, which writes a row naming the `event_id`, the reason from
a closed vocabulary (`NOT_A_CUSTOMER`, `WRONG_NUMBER`, `ANOTHER_BUSINESS`,
`SPAM`, `DUPLICATE_OF_EXISTING`) and the actor. `DISQUALIFIED` may still be set —
that is the salesperson's workflow — but the counter reads the act.

```sql
select date_trunc('week', acted_at) as week,
       count(*) filter (where action = 'NOT_A_CUSTOMER') as false_positives,
       count(*) filter (where action = 'CONFIRMED_CUSTOMER') as confirmed
  from public.enquiry_promotion_feedback where tenant_id = <tenant>
 group by 1 order by 1;
```

**And the FP denominator has the same honesty problem in reverse**: a promoted
lead nobody marked either way is unknown, not correct. The screen prints
`false_positives / (false_positives + confirmed)` and, beside it, how many
promoted leads carry no verdict at all.

### 3.5 What is reported, and to whom

One row of figures, on the held-enquiries screen, every one of them carrying its
denominator:

```
Last 30 days
  Conversations recorded              H
  Promoted automatically              P        of which marked not-a-customer   F
  Held                                Hd       of which reviewed by a person    R   (coverage R/Hd)
  Promoted from held                  Q        false negatives, of R reviewed
  Found by another route while held   Z        false negatives nobody had to click
  Quarantined without ever being reviewed  U   ← this is the number that matters
```

**`U` is the product's real failure count.** Everything else is recoverable.

---

## 4. The held queue as a product surface

### 4.1 Who sees it

**The dealership. Specifically a salesperson or sales manager, signed in, scoped
by RLS to their own tenant.**

Not the operator. `CONTROL-PLANE.md`'s rule holds: *symptom and impact to the
dealership; mechanism and location to the vendor*. Ali needs the counted rates in
§3.5 — precision, recall, coverage, model tier distribution — and he needs them
**without customer message content**. Those are two different surfaces and this
document proposes only the first. The operator-plane version is out of scope
here and is open question 6.

### 4.2 The view

```sql
-- PROPOSED, not applied. Derived, not a new phase. Reads as the dealership.
create or replace view public.v_enquiry_held as
select
  e.event_id,
  e.tenant_id,
  e.source_key,
  e.received_at                                as first_received_at,
  c.classified_at                              as last_classified_at,
  c.hold_reason,
  c.verdict,
  c.confidence,
  c.unclear_because,
  c.reason                                     as machine_reason,
  c.evidence,
  c.evidence_verified,
  c.language,
  c.message_count                              as messages_read,
  c.model,
  c.ladder_tier,
  c.prompt_version,
  -- the queue's clock runs from the LAST inbound message, not the first
  m.last_inbound_at,
  m.inbound_count,
  m.last_inbound_excerpt,
  -- identity, resolved the way v_conversations resolves it: never the @lid
  ct.display_name,
  ct.phone_e164
from public.lead_event e
join lateral (
  select * from public.enquiry_classification x
   where x.event_id = e.event_id
   order by x.classified_at desc limit 1
) c on true
left join lateral ( /* thread facts from communication_logs, resolved */ ) m on true
left join lateral ( /* contact resolution, v_conversations rules */ ) ct on true
where e.phase = 'RECEIVED'
  and c.decision = 'HOLD';
```

`v_enquiry_held_all` is the same view without the `phase = 'RECEIVED'` filter,
carrying quarantined rows too, for the coverage arithmetic and the archive tab.

**Grants and RLS follow the layer's existing shape**: `authenticated` gets
`SELECT` only, tenant-scoped; every action goes through a `SECURITY DEFINER` RPC.
No screen writes `lead_event` directly. `nexus_guard_born_open_grants()` will
strip anything born open, which is the intended behaviour and not an obstacle.

### 4.3 What a row shows

Ordered by what a salesperson decides on, not by what the system knows:

1. **Who** — resolved name, then WhatsApp profile name, then phone, then "not
   identified". **Never the raw `@lid` handle.** All nine chat ids in the
   measured week are `@lid` and a LID handle identifies nobody;
   `conversations.js` already carries this rule and the screen that broke it.
2. **The last thing they said**, verbatim, up to ~200 characters, in its original
   script. Not a summary. **A summary of a held message is a second AI decision
   about a conversation we already declined to act on**, and the salesperson's
   whole job on this screen is to read what the customer actually wrote.
3. **When** — last inbound, relative ("3 days ago"), plus the message count.
4. **Why it is held** — the hold reason as a plain phrase, in the owner's five
   words: *Potential enquiry · Needs more context · Not vehicle enquiry ·
   Unclear · Human review* (and the proposed sixth, *Classifier unavailable*,
   worded as "NEXUS could not read this yet", because that is our fault and
   should read like it).
5. **What the machine read** — the verified evidence quotes, shown as quotes. If
   `evidence_verified` is false the row says *"NEXUS could not confirm what it
   was reading"* and that alone is why the row is here.
6. **Language**, as a small tag. It is how the manager discovers the line needs a
   Malayalam speaker.
7. **How long left** — days until quarantine, from the last inbound message.
8. **On expand: the provenance line** — model, ladder tier, prompt version,
   classified-at. Not on the row. A salesperson does not need it; the person
   asking "why did you not tell me about this customer" does, and they will be
   looking at this screen when they ask.

### 4.4 The actions

Three, and each goes through an RPC.

**Promote** — `nexus_enquiry_promote_held(p_event_id uuid, p_note text)`.
It does exactly what an automatic promote does and nothing more:
`nexus_hydrate_lead_event` → `nexus_lead_for_phone` → `nexus_attach_lead_event`
or `nexus_promote_lead_event`. **The human's click replaces the classifier's
verdict, not the pipeline.** Door three still writes the lead and the audit row
in one transaction. It also writes an `enquiry_hold_action` row with
`action = 'PROMOTE'` and the actor — which is FN-1.

**Dismiss** — `nexus_enquiry_dismiss_held(p_event_id uuid, p_reason text)`.
Terminalises early: `phase = 'QUARANTINED'`, `disposition_reason` from a closed
vocabulary. **Dismiss is not delete.** The event, the messages and every
classification stay. The row moves to the archive tab and can still be promoted
from there — a dismissal is a human saying "not now", and humans are wrong too.
Writes `action = 'DISMISS'`, which is the other half of FN-1's denominator.

**Ask for more context** — `nexus_enquiry_request_context(p_event_id uuid,
p_template_key text)`. Sends the customer a short message inviting them to say
what they are looking for, so a `NEEDS_MORE_CONTEXT` hold can resolve itself.

> **This action is the most dangerous thing on the screen and it is constrained
> accordingly.** It sends text to a real person on behalf of the dealership.
> **The text is a fixed, human-authored template chosen from a closed set. No
> model writes a word of it. No field of the classifier's output is interpolated
> into it** — not `reason`, not `vehicle_mentioned`, not `language`. It routes
> through the existing provider router and the policy/template gate exactly like
> every other outbound message, so the jurisdiction, opt-out and template rules
> that already exist apply unchanged. And it is rate-limited to **once per
> conversation**: a queue that can nag is a queue that will.

The KYC Phase 5 workflow is the precedent worth copying: `Decide: Re-ask or
Escalate` builds its customer message from a closed vocabulary of four strings
chosen off booleans, and the EMI sweep marked it *clean by construction* for
exactly that reason.

### 4.5 What happens when the next message arrives

This is the mechanism that makes holding cheap, and it is already specified.

The new message hits the same chain. `nexus_record_lead_event` computes the same
`'wa:' || <E.164>` key, `ON CONFLICT … DO NOTHING` returns `was_duplicate = true`
with the same `event_id`, and **the classifier runs again on the longer thread**.

- If it now qualifies, the event hydrates and promotes. The row leaves the queue.
  *"Hi"* on Tuesday and *"how much for the Patrol"* on Wednesday is one lead,
  created on Wednesday, with Tuesday already in the record.
- If it still does not, the queue row **updates in place**: new hold reason, new
  evidence, higher message count, and **the clock resets**, because the clock
  runs from the last inbound message.
- A new `enquiry_classification` row is written every time. The ledger is
  append-only; the view shows the latest. So "it used to say Unclear and now it
  says Not an enquiry" is answerable, and a prompt change's effect on real
  conversations is visible in the ledger rather than being asserted.

**A conversation that is actively running is never quarantined**, because the
timer measures silence, not age. That is the single most important consequence of
resetting the clock on inbound, and it is why the timer number below is less
frightening than it looks.

### 4.6 The timer

**Recommendation: 30 days of silence, then `QUARANTINED` with
`disposition_reason = 'NOT_A_VEHICLE_ENQUIRY_WITHIN_WINDOW'`.**

The SPEC's M5 sweep needs a number and records that seven days was a guess. The
argument for thirty:

- The clock measures **silence since the last inbound**, not age. A conversation
  someone is having is never swept.
- A UAE vehicle purchase is a weeks-long decision. A customer who says *"salam"*,
  goes quiet for three weeks and comes back with *"is the Patrol still there"* is
  an ordinary buyer, and at seven days their opener is already terminal.
- **`QUARANTINED` is not deletion and not a closed door.** The catalogue's own
  definition is *"held for inspection"*. The row stays, the archive tab shows it,
  and promote still works from it. The timer decides what is in the default view,
  not what exists. That is what makes thirty affordable and seven unnecessary.

And one hard rule on the sweep:

> **The sweep must never terminalise a conversation whose only classifications
> are `CLASSIFIER_UNAVAILABLE`.** Quarantining a conversation NEXUS never
> succeeded in reading is classification silently discarding an arrival by
> another name — the exact thing the accepted model forbids. Those rows stay in
> the queue, visibly, with our reason on them, until a classification succeeds or
> a person acts.

The sweep is `pg_cron`, which is installed:

```sql
select count(*) from pg_extension where extname = 'pg_cron';
```

    1

### 4.7 The screen

**File: `apps/executive-dashboard/screens/held-enquiries.js`.**
**Nav id: `heldenquiries`. Title: "Held Enquiries". Icon: `pending_actions`.**

Following the conventions that exist, not inventing a stack:

- **Vanilla ES module**, registering itself into `SCREENS` the way all sixteen do.
  No framework. `apps/executive-dashboard/` has no React, no Tailwind, no
  WebSocket, and this screen adds none.
- **Registered in `app.js` as a plain static import**, beside
  `import './screens/lead-sources.js'` — not in the `import.meta.glob` block.
  That block exists for the five Revenue Recovery engine modules that may not
  have landed; this file will be on disk, and `app.js`'s own comment says the
  static list is meant to be the readable inventory of what the app contains.
- **Nav placement: `Work` group, directly beneath `leadsources`, above
  `conversations`.** Lead Sources answers *which door did they come through*;
  this answers *who knocked and was not let in*. Conversations is the inbox and
  is a different question — it shows every thread; this shows only the ones with
  a decision pending. A held row deep-links into the Conversations thread rather
  than duplicating it.
- **Reads `v_enquiry_held` and `v_enquiry_classification_health`; writes through
  three RPCs and nothing else.** Two screens in this app write tables directly
  and this is not going to be the third.
- **It prints its own honesty paragraph**, `lead-recovery.js` rule 2: the health
  view carries a plain-English statement of what the queue cannot tell the
  dealership — that `communication_logs` is not a complete record of arrivals
  (five messages claimed and never logged, measured), that coverage below 60%
  makes the false-negative figure unquotable, and that the base rate this
  classifier was tuned against came from a personal handset. **Printed verbatim
  from the view**, not paraphrased in the file, so there is one derivation.
- **It prints zero properly.** An empty queue renders *"No conversation is
  currently held for review"* with the count of conversations recorded and
  classified in the window beside it — never a bare "0", which reads as a
  performance figure and is not one, and never an empty panel, which reads as a
  broken screen.

**No code is written here.** This section names the file, its place in the nav,
its data sources and the rules it must follow; the module is a separate piece of
work.

---

## 5. The model, under the free-tier constraint

**Hard constraint, from `README.md` and `ARCHITECTURE.md`: OpenRouter and Groq
free tiers only, behind a fallback ladder. There is no OpenAI credential on the
box.** Nothing in this design changes that and nothing in it needs to.

### 5.1 This is a small job, and that is the whole reason it fits in the free tier

The BDC agent needs tool calling, a 3,000-word system message, inventory,
policy and finance lookups, and it writes prose to a customer. **The classifier
needs none of that.** One system message, a transcript capped at 6,000
characters, one small JSON object out, no tools. Expect ~1,500–2,500 prompt
tokens and under 200 completion tokens.

**So it does not use the n8n Agent node.** It is a plain HTTP request to
OpenRouter's `chat/completions`. The Agent node exists to orchestrate tools and
carries a two-model limit that is the entire reason the ladder is hand-rolled as
a retry loop; with no tools to call there is nothing to orchestrate.

### 5.2 The ladder

Reuse the existing one. It is verified, it is dated, and its entries were each
removed or replaced for a recorded reason.

| tier | model | why here |
|---|---|---|
| 0 | `nvidia/nemotron-3.5-lightning:free` | fastest. Already tier 0 of the live ladder. A short strict-JSON classification is what a lightning-class model is for |
| 1 | `nvidia/nemotron-3-super-120b-a12b:free` | stronger, for the multilingual and code-switched cases tier 0 is likeliest to fumble |
| 2 | `minimax/minimax-m2.7:free` | third opinion, different vendor, different failure modes |
| 3 | `openai/gpt-oss-120b` on **Groq** | different provider entirely, so an OpenRouter-wide outage is not the end of the ladder. Free-tier ceiling 30 RPM / 1K RPD / 8K TPM / 200K TPD, **and TPM binds first** |

**Do not add `nvidia/nemotron-3-ultra-550b-a55b:free`.** Removed 29 August 2026
after failing on both agents inside the same real run — execs 6251 and 6253 —
with `Cannot read properties of undefined (reading 'message')`, having burned
~45 s per request first. The ladder escalated correctly both times; the model is
dead. Re-adding it costs 45 seconds per classification for nothing.

**Do not use `google/gemma-4-31b-it:free`** (429, rate-limited out of usefulness)
or `ling-3.0-flash:free` (404, free tier discontinued). Both are recorded in the
live ladder's own comments as the reason a previous four-tier ladder failed
entirely on live traffic.

**Before arming, every id is re-verified live**, the way the 16 August ladder was:
it exists, it is `:free`, and it returns parseable JSON for this prompt. A model
id in a repo is not evidence that the id still exists — this ladder has been
wrong about that three times.

### 5.3 Parsing, and the fallback that must not exist here

Reuse `Parse AI Decision`'s `extractJson` — straight parse, then fence-strip,
then outermost `{…}` block. It is written, it works, and re-implementing it is a
second derivation.

**But do not reuse its prose fallback.** When JSON extraction fails, that node
pulls an intent word and a number out of the prose and returns `WARM` / `50`,
deliberately, because a genuinely hot lead should not be silently downgraded to
COLD. **That reasoning is correct there and inverted here.** There, the fallback
adjusts a field on a lead that already exists. Here, the fallback would **create
a customer**. A regex that finds the word "enquiry" in a model's apology is not a
classification.

> **On any parse failure: `HUMAN_REVIEW`, held, never promoted.** No prose
> fallback, no keyword rescue, no default verdict.

### 5.4 When every tier is rate-limited

**The answer is not "guess". It is also not "promote by default" and not "reject
by default".** It is:

1. **The customer still gets their reply.** The classifier runs on a side branch,
   beside the reply path, exactly as SPEC §7.3 places it. A rate-limited model
   never delays or blocks a WhatsApp answer. The BDC agent has its own ladder and
   its own failure handling.
2. **The arrival is already recorded.** `nexus_record_lead_event` ran before the
   classifier and does not depend on it. **Nothing is lost when every model is
   down** — that is the entire point of classification deciding the phase rather
   than the recording.
3. **`decision = 'NO_CALL'`, `hold_reason = 'CLASSIFIER_UNAVAILABLE'`, written to
   the ledger** with `model = null`, `ladder_tier = null` and the error text. A
   classification that did not happen is recorded as not having happened.
4. **The conversation appears in the held queue immediately**, worded as ours:
   *"NEXUS could not read this yet"*. Not *Unclear*. Not *Not a vehicle enquiry*.
   A salesperson can promote it on the spot without waiting for a model.
5. **It is retried** — on the next inbound message, and by a sweep every 30
   minutes over `CLASSIFIER_UNAVAILABLE` rows younger than 24 hours, with
   exponential backoff. The retry is cheap: the conversation is in the database.
6. **The sweep may never quarantine it** (§4.6).
7. **A rate of these above a threshold is a workflow-health alarm on the operator
   plane, not a dealer-plane message.** The dealership sees "not read yet" on a
   row; the vendor sees "the free tier is exhausted".

**When would this actually fire?** Groq's free tier is 8K TPM. At ~2K prompt
tokens per classification that is roughly four per minute on the fallback slot
alone, and the fallback only runs when all three OpenRouter tiers have already
failed. Against 31 inbound messages *per week* it is not close. It becomes real
at a burst — a marketplace listing going live, or a campaign — which is precisely
when the arrivals matter most, which is why the answer above is written down
rather than left to be discovered.

### 5.5 The latency budget

**The classifier is not on the reply path, so it does not spend the reply's
budget.** A dealership expects a reply in minutes; the BDC agent provides that
and is untouched. The classifier's budget is the *lead-creation* budget: how long
after a customer's message before their card is in front of a salesperson.

| bound | value | why |
|---|---|---|
| per-tier request timeout | **20 s** | the dead-tier incident burned ~45 s per attempt and contributed directly to concurrency exhaustion at 5 production slots. A short JSON classification that has not answered in 20 s is not going to |
| tiers | 4 | worst case ≈ 80 s of model time |
| whole-branch budget | **120 s** | including thread fetch and the RPC hops |
| target, normal path | **under 10 s** | tier 0 answers or it does not. `ask.js` records the slowest verified end-to-end RAG run at 8.8 s, and that one does retrieval and writes prose |
| hard ceiling, not ours | **300 s** | every workflow on the box carries `executionTimeout: 300`, added after two runaway executions took instance API latency from 0.34 s to 7.8 s. The branch must end long before this, and if it ever does not, the run is kept with its input as a failed run |

**Stated as the promise it makes to a dealership:** a WhatsApp enquiry becomes a
CRM card in **under a minute in the normal case, under two minutes in the worst
case where three models fail in turn**, and if every model is unreachable it
becomes a visible held row in seconds with our reason on it. None of those
numbers is the customer's reply time, which is unaffected.

---

## 6. The audit requirement

### 6.1 The question this table exists to answer

> *"Why did you not tell me about this customer?"*

**One query, one answer, with the input, the verdict, the reason, the model, the
prompt version and the timestamp.** Not a log to grep. Not a summary sentence.

### 6.2 Why not `audit_log`

`audit_log` is where door three writes the promotion sentence, and that stays
exactly as it is. But it cannot carry this:

```sql
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='audit_log' order by ordinal_position;
```

    id, workflow, status, lead_name, lead_email, lead_score, intent, summary,
    logged_at, tenant_id

`summary` is prose. **You cannot compute a false-negative rate from prose**, you
cannot group by hold reason, and you cannot compare two prompt versions.

**And the two facts must not be merged.** Door three's audit row records that a
lead was *promoted*; this table records that a conversation was *classified*.
Merging them would either lose every held conversation (there is no promotion to
hang the row on) or double-count every promoted one. `20260907240000` removed a
second audit writer for precisely this reason and the rule it established holds:
one derivation per fact, and two different facts get two tables.

### 6.3 The table

```sql
-- PROPOSED, not applied. Append-only. One row per classification ATTEMPT,
-- including the attempts where no model answered.
create table public.enquiry_classification (
  classification_id  uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  event_id           uuid not null references public.lead_event(event_id) on delete restrict,
  classified_at      timestamptz not null default now(),

  -- what it read
  message_count      integer not null,
  input_chars        integer not null,
  input_digest       text    not null,          -- sha256 of the exact transcript sent
  input_excerpt      text,                      -- last inbound message, capped at 500 chars

  -- what the model said
  verdict            text,                      -- null when no model answered
  confidence         text,
  unclear_because    text,
  evidence           jsonb  not null default '[]'::jsonb,
  evidence_verified  boolean not null default false,
  vehicle_mentioned  text,
  language           text,
  reason             text,

  -- what NEXUS decided
  decision           text not null,             -- PROMOTE | HOLD | NO_CALL
  hold_reason        text,

  -- how it was produced
  model              text,                      -- null when no model answered
  ladder_tier        integer,
  prompt_version     text not null,
  latency_ms         integer,
  error_text         text,

  constraint enquiry_classification_verdict
    check (verdict is null or verdict in ('VEHICLE_ENQUIRY','NOT_VEHICLE_ENQUIRY','UNCLEAR')),
  constraint enquiry_classification_confidence
    check (confidence is null or confidence in ('HIGH','MEDIUM','LOW')),
  constraint enquiry_classification_decision
    check (decision in ('PROMOTE','HOLD','NO_CALL')),
  constraint enquiry_classification_hold_reason
    check (hold_reason is null or hold_reason in
      ('POTENTIAL_ENQUIRY','NEEDS_MORE_CONTEXT','NOT_VEHICLE_ENQUIRY',
       'UNCLEAR','HUMAN_REVIEW','CLASSIFIER_UNAVAILABLE')),

  -- a hold must say why; a promote must not carry a hold reason
  constraint enquiry_classification_hold_needs_reason
    check ((decision = 'HOLD') = (hold_reason is not null)),
  -- a promote must rest on verified evidence, at the database, not only in code
  constraint enquiry_classification_promote_needs_evidence
    check (decision <> 'PROMOTE'
           or (verdict = 'VEHICLE_ENQUIRY' and evidence_verified
               and confidence in ('HIGH','MEDIUM'))),
  -- a model that answered has a name; one that did not, does not
  constraint enquiry_classification_model_and_verdict_agree
    check ((verdict is null) = (model is null))
);

create index enquiry_classification_event_idx
  on public.enquiry_classification (event_id, classified_at desc);
create index enquiry_classification_tenant_time_idx
  on public.enquiry_classification (tenant_id, classified_at desc);
create index enquiry_classification_hold_idx
  on public.enquiry_classification (tenant_id, hold_reason, classified_at desc)
  where decision = 'HOLD';
```

**`enquiry_classification_promote_needs_evidence` is the important one.** The
threshold of §3.3 is a constant in a Code node, and a Code node can be edited on
a box by anyone with access. This constraint makes the floor of that threshold a
row that cannot exist. A future change that decides to promote on `LOW`
confidence has to drop a named constraint on purpose rather than discover it by a
quiet edit.

Two companion tables, same shape of argument, named here and specified with the
screen:

- `enquiry_hold_action` — one row per human act on a held row: `event_id`,
  `action` (`PROMOTE` | `DISMISS` | `REQUEST_CONTEXT`), `actor`, `acted_at`,
  `reason`, `note`. **This is FN-1.**
- `enquiry_promotion_feedback` — one row per human verdict on a promoted lead:
  `event_id`, `lead_id`, `action` (`NOT_A_CUSTOMER` | `CONFIRMED_CUSTOMER`),
  reason from a closed vocabulary, actor. **This is FP.**

**RLS**: `service_role` all; `authenticated` `SELECT` scoped by tenant; `anon`
denied restrictively — the shape `leadingest_03` uses. The `input_excerpt` column
holds customer text, so it is dealer-plane data and the operator's health views
must aggregate over it without selecting it.

### 6.4 What it costs

**Deliberately not a second copy of the conversation.** The messages are already
in `communication_logs` and will be in `channel_message_events`. This table stores
a digest of what was sent, a capped excerpt of the last inbound message, and the
evidence quotes. That is what keeps the row small and it is also what keeps
customer content from having a third home.

**Row counts, at the only rate this repo has actually measured:**

```sql
select count(*) as msgs_7d, count(distinct chat_id) as chats_7d
  from public.processed_messages where processed_at >= now() - interval '7 days';
```

    36 | 9

One classification per genuine inbound message, on conversations not yet
promoted. On the measured week that is **31 rows, ≈ 134 per month** — one
handset, nine people.

Because a dealership line's volume is not measured anywhere in this repo, it is
given as scenarios rather than a figure:

| inbound WhatsApp per day | classifications per month | rows/month |
|---|---|---|
| the measured line (≈ 4.4/day) | ≈ 134 | 134 |
| 50 | ≈ 1,500 | 1,500 |
| 200 | ≈ 6,000 | 6,000 |

**Bytes.** Measured comparator:

```sql
select count(*) as total, pg_size_pretty(pg_total_relation_size('public.audit_log')) as size
  from public.audit_log;
```

    881 | 624 kB

That is ≈ 0.72 kB per row including indexes, on a table with a prose `summary`.
This row is wider — evidence JSON, an excerpt, three indexes — so budget **2 kB
per row**:

| scenario | per month | per year |
|---|---|---|
| measured line | ≈ 0.3 MB | ≈ 3 MB |
| 50/day | ≈ 3 MB | ≈ 36 MB |
| 200/day | ≈ 12 MB | ≈ 145 MB |

**A busy dealership costs about 145 MB a year to be able to answer "why did you
not tell me about this customer".** That is not a cost worth optimising, and it
is the reason the excerpt is capped rather than the row being dropped.

Retention is deliberately **not** proposed here. The table is append-only and
kept, because its value is answering a question asked months later. If a purge is
ever wanted, it belongs to the existing Retention Purge workflow, applied to the
excerpt column rather than to the row — the verdict, the model and the prompt
version are the audit and must outlive the customer's words. That is open
question 5.

---

## 7. What must NOT be done

Every one of these is a trap this repo has already paid for, or a trap this
layer introduces. The SPEC's list of eighteen applies unchanged and is not
repeated; these are the ones that belong to the classifier and the queue.

1. **Do not let a classification stop an arrival being recorded.** The event is
   written before the classifier runs, by a call that does not depend on it. This
   is the accepted model's one non-negotiable line and every other rule here is
   downstream of it.

2. **Do not let the classifier put a figure anywhere.** Not a price, not an
   instalment, not a rate, not a tenure, not a down payment, not a discount, not a
   budget. On 31 August 2026 a model told a customer *"roughly AED 11 200 per
   month"* for a Lexus LX 600; the true figure was nearer AED 7,800. The number
   was still in `communication_logs` on 6 September, was faithfully quoted back
   into an internal escalation brief, went to Slack and to Gmail, and in a
   provocation run the model put it **inside the line the rep reads to the
   customer**. The classifier is not asked for a number, has no calculator, and
   the prompt forbids one; and `reason` is staff-only precisely so a figure that
   slipped through could not reach a buyer.

3. **Do not give the classifier the inventory tool.** `search_inventory` returns
   `cost_aed`. A model that can read internal vehicle cost is one edit away from
   writing internal vehicle cost into a `reason` string that renders on a screen.
   The BDC agent's guardrails exist because it volunteered AED 538,200 as its
   best price on 30 August and the customer took it instantly. The classifier
   does not need to know what we stock and therefore is not told.

4. **Do not let the classifier decide anything about money.** Whether we discount,
   what a car is worth, what a trade-in is worth, whether a budget is real. It
   answers one question with three possible values.

5. **Do not let any classifier output reach a customer.** `reason`,
   `vehicle_mentioned`, `language`, evidence quotes — none of them are
   interpolated into any outbound message, including the "ask for more context"
   template. That template is fixed, human-authored, chosen from a closed set,
   and routed through the existing policy and template gate.

6. **Do not fall back to a verdict when parsing fails.** `Parse AI Decision`'s
   prose fallback returns `WARM`/`50` on a parse failure and that is right there,
   because it adjusts a lead that exists. Here the same fallback creates a
   customer. Parse failure means `HUMAN_REVIEW`, held.

7. **Do not believe an unverified quote.** Every evidence span is checked
   character-for-character against the message it names, with NFKC, whitespace and
   case folding and nothing else. `ask.js` records a model shown S1–S13 emitting
   `[S14]` and getting a real document title rendered under its answer — a
   fabricated citation arriving pre-validated. Same failure, higher stakes.

8. **Do not let the model name a vehicle the customer did not type.**
   `vehicle_mentioned` is a verbatim substring or null. "Nissan Patrol Platinum
   2024" from a customer who wrote "patrol" is an invented trim and an invented
   year, and it would be written into `leads.vehicle_interest` and read as what
   the customer asked for.

9. **Do not take from the model anything NEXUS can compute.** Model id, ladder
   tier, prompt version, latency, timestamps and the hold reason are all stamped
   by code. A `prompt_version` the model echoed is not evidence of which prompt
   ran.

10. **Do not use a numeric confidence with a decimal cutoff.** Four models on the
    ladder, none calibrated against another, and a knob that gets nudged on a hunch
    (§1.4).

11. **Do not add `HELD` to `lead_event.phase`.** It is derived. §0.

12. **Do not quarantine a conversation NEXUS never managed to classify.** That is
    a silent discard wearing a phase name, and it happens on the day our model
    provider is down rather than on a day anyone is watching.

13. **Do not report a false-negative rate without its coverage.** A held row
    nobody opened is unknown, not a correct rejection. Below ~60% coverage the
    screen prints counts and says the rest is unknown.

14. **Do not count false positives from `leads.status`.** Measured today: no
    CHECK constraint, five values in four casings. Count the act.

15. **Do not run the classifier on the reply path.** It runs beside it. A model
    outage must never delay a customer's answer, and the SPEC already places these
    nodes on the TRUE branch of `Is New Message?` for this reason.

16. **Do not summarise a held message with a second model.** The salesperson's
    job on that screen is to read what the customer actually wrote. A summary of a
    message we already declined to act on is a second AI decision compounding the
    first, and it is the one place on the screen where an invented detail would
    look authoritative.

17. **Do not let the classifier touch provenance.** SPEC §8.17, restated because
    this is the document where someone would be tempted: "is this an enquiry" and
    "did something outside NEXUS attest this arrival" are two questions.
    `leadingest_06` exists because one flag answered two.

18. **Do not put customer message content on the operator plane.** Ali gets the
    counted rates; the dealership gets the messages. `input_excerpt` is
    dealer-plane data.

19. **Do not re-add a dead model to the ladder.**
    `nvidia/nemotron-3-ultra-550b-a55b:free`, `google/gemma-4-31b-it:free`,
    `ling-3.0-flash:free`. Each was removed for a recorded, dated reason.

20. **Do not add a column to `public.leads`.** `ALTER TABLE` there fires
    `nexus_guard_born_open_grants()` and strips the dashboard's write grants.
    Nothing in this design needs one.

---

## Open questions for Ali

Only the owner can decide these. They are additional to the SPEC's eight, not a
replacement for them; SPEC question 6 — the length of the held window — is
answered here with a recommendation of 30 days and is question 4 below.

1. **Is `CLASSIFIER_UNAVAILABLE` an acceptable sixth hold reason?** You named
   five, and five is a good number for a screen. This design argues for a sixth
   because the other five are statements about the customer and this one is a
   statement about us — and folding "our model provider was down" into "unclear"
   makes our outage read as the customer's ambiguity. It carries different
   behaviour too: it retries, and the sweep may never terminalise it. **Do you
   want it as a sixth reason on the screen, or shown as a system banner above the
   queue instead?**

2. **Promote on MEDIUM confidence, or HIGH only?** §3.3 recommends HIGH or
   MEDIUM, with verified evidence, because HIGH-only would hold *"is this still
   available?"* — a reply to one of our own listings, and in this market probably
   the commonest real enquiry there is. HIGH-only is a tighter CRM and a slower
   response to the readiest buyers. **This is the one number in this document
   that is genuinely a business preference and not a technical finding.**

3. **Who owns the held queue, and what happens if nobody opens it?** The entire
   safety of this design rests on someone reading that screen. If it is nobody's
   job, a false negative is not "one click" — it is a lost customer with a paper
   trail. **Is there a named person, and should NEXUS chase them?** A daily
   digest — *"6 conversations are held, 2 look like potential enquiries"* — is
   easy to build and would be a new automated message with its own failure modes.

4. **Thirty days of silence before quarantine — right?** §4.6 recommends thirty,
   measured from the last inbound rather than the first, so a live conversation is
   never swept, and notes that `QUARANTINED` keeps the row visible and promotable
   in an archive tab. Seven days makes a tidier default view; thirty matches a UAE
   buying cycle. **Given that nothing is deleted either way, is there a reason to
   prefer seven?**

5. **How long is the classification ledger kept?** §6.4 proposes keeping it
   indefinitely — ≈145 MB a year at 200 messages a day — because its value is
   answering a question asked months later. If it is ever purged, the proposal is
   to purge the customer excerpt and keep the verdict, model and prompt version.
   **Is indefinite retention of a capped customer excerpt acceptable to you, and
   to a dealership you sell this to?**

6. **What does the operator plane see?** This document builds the dealership's
   screen. You also need precision, recall, coverage and model-tier distribution
   across every dealership, to know whether the classifier is working — and under
   `CONTROL-PLANE.md`'s rule that is a separate surface with no customer message
   content on it. **Do you want that built alongside, or after a month of real
   data exists to put on it?**

7. **Should the classifier be run in shadow first?** It could be armed to classify
   and write the ledger while promoting nothing, for two weeks, on a real
   dealership line. At the end you would have a measured base rate, a measured
   verdict distribution and a list of what it would have promoted — and the
   threshold in §3.3 would be evidence rather than an argument. The cost is two
   weeks and one more thing running. **This is the cheapest way to make §3.2's
   "the base rate is unknown" stop being true, and it is the SPEC's question 8
   with a mechanism attached.**
