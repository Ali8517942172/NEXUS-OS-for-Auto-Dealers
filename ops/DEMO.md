# Running the NEXUS demo

**Written 6 September 2026. Every figure in this file was measured against the
staging project on that date, signed in as the demo dealership's own owner
account through the live REST API — not read out of a privileged SQL session.**

> [!WARNING]
> **Read this before you show anyone. One line on this screen is measurably
> false with this data, and it is in the register the screen exists to make
> trustworthy.**
>
> *Checks that came back clear* includes **"No open enquiry is recorded as
> having missed the first-response target — 11 open enquiries checked against
> this dealership's own first-response target."** Six of those eleven **did**
> miss it: 7, 12, 41, 18, 95 and 6 minutes against a 5-minute target. The
> alert feed on the same page lists all six by name.
>
> Cause: `screens/money-leaks.js` tests `sla_state === 'BREACHED'`, and
> `v_lead_recovery` emits **`BREACHED_SLA`**. One word, and a check that can
> never fail reports itself clear. It has never shown on production because
> ALBA has one open enquiry.
>
> **Until it is fixed: do not open the clear register in front of a buyer**, or
> open it and say the truth — *"that line is wrong, here is why, and I would
> rather show you the bug than a number you can't check."* Fixing it is a
> one-word change owned by whoever owns that file; the finding is written up in
> `/home/claude/out/demo-tenant-evidence.md`. Everything else on the path below
> was verified line by line.

`LAUNCH.md` says Track B — "make it sellable" — does not wait for Track A, and
that the demo is read-only: it needs no WhatsApp, no consent fix, no Meta
attestation. This file is how you actually run it.

**The deployed dashboard points at PRODUCTION and must keep pointing there.**
Production holds ALBA CARS, the one real dealership, and its counts are the
counts every claim in `commercial/WHAT-WE-CLAIM.md` rests on. You demo from a
**local build pointed at staging**, and you put it back afterwards. Section 6
is how.

---

## 1 · The dealership you will be showing

**NORTHWIND MOTORS (DEMO — FICTIONAL DEALERSHIP)** — slug `demo-northwind`,
tenant id `dddddddd-dddd-4ddd-8ddd-dddddddddddd`, on the **staging** Supabase
project `wwspuxrbiyagnrnzgate`. It is the third tenant beside Alpha Motors and
Bravo Autos, and it is invented from end to end.

**Say that out loud in the first thirty seconds.** Not because the deck says
to — because the buyer will work it out from the screen anyway. Every person on
it is called *"<Name> Example (demo)"*, every address ends `.demo.invalid`
(RFC 2606 — a domain that can never resolve), every phone is `+9715000000NN`
(a number that cannot be dialled), every unit id starts `DEMO-`, every VIN
starts `DEMOVIN`, and every competitor is *"… (demo)"*. A dealer who spots that
before you say it will wonder what else you were not going to mention.

The sentence that works: *"This is a made-up dealership with made-up cars, so
nothing here is another customer's business. The shape of it is real — 29 cars,
24 enquiries, a fortnight of decisions — and every number on the screen is
computed by the same code that would run on yours."*

### Its shape, and why each number was chosen

| | | why |
|---|---|---|
| Units on the lot | **29** (27 available, 2 sold) | Small enough to be a UAE independent, big enough that ageing means something. At 12 units, "three cars are ageing" is a list; at 29 it is a pattern. |
| Units the engine flags | **9** | 31% of the lot. A dealership with nothing ageing has no reason to buy, and one with 60% ageing is not a business. |
| Units the engine is content with | **20** on `HOLD` | The clear register needs a real denominator. "20 of 29 on HOLD, each carrying margin the engine does not consider at risk" is the sentence that makes the other nine credible. |
| Enquiries | **24** — 11 open, 13 closed | 46% of enquiries going nowhere is an ordinary month. Ranking five needing action out of eleven open is a decision; ranking one out of one is not. |
| Enquiries needing an action | **5** | Matches the shape `LAUNCH.md` sketches for this screen. |
| Messages on file | **37**, of which **31** resolve to an enquiry | 83.8% identity resolution, deliberately not 100%. Three WhatsApp threads resolve to nobody at all, which is what a real dealership number looks like. |
| Confirmed sales | **2**, AED 254,000 | Enough that CONFIRMED has a holder — and **none of it is attributed to anything NEXUS did**, which is the point. |
| Action records | **5**, in five different shapes of stuck | Approved-not-done, attempted-and-failed, rejected-with-a-reason, waiting-on-a-person, deferral-expired. One of each, so no shape is a special case. |
| Competitor listings | **9**, none usable | Every one is `weak`, `model_only`, unrecorded, or too old. The engine grades market position UNKNOWN on all 29 units and names no price. |
| Holding-cost rate | **not recorded** | Deliberate. It is what makes net margin render `NOT_COMPUTABLE` with its reason, on every unit. |

### The three things the demo must show the product refusing to do

These are not gaps in the fixture. They are the fixture.

1. **`NOT_COMPUTABLE`, with a reason.** Net margin, on all 29 units: *"Not
   computable. This dealership has not recorded what a day of floor costs, so
   no holding figure and no net margin are shown. The inputs are here instead:
   AED 268,000 of capital tied up for 214 days."* And once more where it costs
   real money — **DEMO-2130, GMC Yukon Denali 2022**, 132 days old, list price
   AED 235,000, **acquisition cost never entered**. The engine names it as a
   leak, grades it SEVERE, and refuses to put a figure on it: `impact_kind =
   NOT_COMPUTABLE`, no number printed.
2. **A check that could not be measured**, in its own register. The 12-Hour
   Silence Detector has **never recorded a successful run for this
   dealership** — so "0 enquiries have gone quiet" is not a finding and the
   screen says so. Six more lines sit beside it.
3. **A lead whose value is `UNKNOWN_NO_LINK`.** All 24 of them, in fact. No
   enquiry in this database carries a budget and no column links an enquiry to
   a car, so Lead Recovery names the leak and refuses to size it. The customer
   half of "revenue at risk" does not exist at any confidence, and the screen
   fills it in with nothing.

---

## 2 · Pointing a build at staging

Two environment variables. Nothing else changes.

```bash
cd apps/executive-dashboard

cat > .env.local <<'ENV'
VITE_SUPABASE_URL=https://wwspuxrbiyagnrnzgate.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3c3B1eHJiaXlhZ25ybnpnYXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NTg0ODAsImV4cCI6MjEwNDAzNDQ4MH0.xR393pv06QZc5mkjR1-HdG1-ZnEMaDvxad6DPE5c_CE
ENV

npm run dev          # http://localhost:5173
```

**Leave `VITE_N8N_BASE_URL` unset.** There is no n8n box behind staging, and
`lib/env.js` treats it as optional — the app boots, and the screens that call a
workflow (Ask AI, the WhatsApp send box, the finance calculator) say *"workflow
calls are disabled"* rather than failing oddly. That is the truthful state and
you should not paper over it: **this demo shows the data and decision layer, not
the automation layer.** Say so when you reach one of those screens.

**Do not `npm run build` and deploy this.** The Vercel deployment must keep
pointing at production. If you need to show it on a buyer's screen, screen-share
`localhost`.

### The logins

All three are on the fictional dealership only. They see 29 units and 24
enquiries and **nothing** of Alpha Motors or Bravo Autos — measured, not assumed
(section 5).

| sign in as | email | password | tenant role |
|---|---|---|---|
| the owner (**use this one**) | `owner@northwind.demo.invalid` | `NexusDemo!2026` | `owner` |
| the sales manager | `manager@northwind.demo.invalid` | `NexusDemo!2026` | `manager` |
| the salesperson (**for the refusal**) | `sales@northwind.demo.invalid` | `NexusDemo!2026` | `sales` |

These passwords are in a repository because the account they open holds nothing
but invented rows on a staging project. Rotate them the day the staging URL goes
anywhere near a customer's machine, by re-running the seed with a different
literal.

---

## 3 · The click path, what each screen actually says, and what to say with it

This is `LAUNCH.md`'s path — dashboard → Today's Money Leaks → a stuck lead →
ageing stock → a deal blocker → the recommended action → approve → the audit
trail. **Everything quoted below was rendered by the live views on 6 September
2026, not written from intention.** Figures move as the fixture ages by a day;
re-run the seed on the morning of the demo and they come back to exactly these.

---

### Step 1 — Sign in. It opens on **Today's Money Leaks**.

It is the default screen, which is itself the argument: the product opens on
*where is money leaking and what should be done about it*, not on a chart.

**Four tiles, and the fourth is the one to point at:**

| tile | value | its own sub-line |
|---|---|---|
| Leaks today | **13** | each carries what is leaking, the rows behind it, a named money word, a confidence and one thing to do |
| Gross margin behind them | **AED 143,500** | *"AED 143,500 of gross margin exposed across those leaks · 7 of 7 included, none omitted"* |
| Checks that came back clear | **4** | each names how many rows it looked at — **and one of the four is wrong; see the warning at the top** |
| Checks that could not run | **7** | *"Unknown is not zero. Each one says since when, why, and the single thing that would light it up."* |

**Say, roughly:**

> "Thirteen things want attention this morning, ranked by the money behind them.
> The AED 143,500 is one thing and one thing only: gross margin — your asking
> price minus what you paid — sitting in cars that have not sold. It is not
> revenue, it is not a loss, and it is not money I am claiming to recover. The
> banner under the tiles says that every single time the number appears.
>
> Now look at the fourth tile. Seven checks could not be run at all, and they
> are counted **separately** from the four that came back clean. Every dashboard
> you have been shown reports those two as the same green zero. This one won't."

**If they ask why 13 leaks but only 7 in the money figure:** because six of the
thirteen carry no figure — five enquiries, which this database cannot value at
all, and one car whose acquisition cost was never entered. Say that plainly; it
is the honest answer and it leads straight into step 3.

---

### Step 2 — The first register: **what is leaking, worst first**

Eight unit lines and five enquiry lines, ranked by exposure. The top of it:

| # | line | badge | size |
|---|---|---|---|
| 1 | *A decision was taken on Land Rover Range Rover Vogue 2021 and nothing has been recorded as done* | **Decided, not done** | AED 47,000 exposed |
| 2 | *Work on Nissan Patrol LE 2022 was attempted and did not happen* | **Attempted, not carried out** | AED 30,000 exposed |
| 3 | *The engine flags BMW X5 xDrive40i 2022 and nobody has ever been asked about it* | **Never raised** | AED 26,000 exposed |
| 4 | *Toyota Fortuner VXR 2023 is waiting on somebody to answer* | **Nobody has answered** | AED 17,000 exposed |
| 5 | *The wait somebody chose on Toyota Land Cruiser VXR 2022 has run out* | **Deferral expired** | AED 11,000 exposed |
| 6–8 | three more never-raised units | | AED 8,000 · 4,500 · **Not computable** |
| 9–13 | five enquiries needing an action | | **Not computable** on all five |

Every line carries five things under it: **why this is a leak** (not why it is a
fact), the **evidence** with the view each row came from, the **size** in one of
four named money words, a **confidence and its basis**, and **one action**.

**Say:**

> "Line one is not a car problem. Somebody with the authority approved it six
> days ago and nothing has been recorded as done since — so the dealership
> believes it is handled and the margin is still in the car. The gap between a
> decision and an act is the leak, not the Range Rover.
>
> Line two is worse. You have already spent the decision *and* the attempt: it
> was tried and the marketplace feed rejected the price change. Nothing
> re-raises that automatically. It stops there unless a person picks it up.
>
> Line three is the one most dealers recognise. The engine has been saying the
> same thing about that X5 every day for four months and nobody in the building
> has ever been asked to answer it once."

---

### Step 3 — A stuck enquiry, and the figure the product refuses to invent

Scroll to the enquiry lines. **Yusuf Example (demo)** — state
`WAITING_RESPONSE`, risk `HIGH`, action `ESCALATE`, owner Rita Example (demo).
Evidence: *"The customer sent the last message. The dealership has not replied."*
— eight days ago.

And the size cell says, for all five: **Not computable** — *"No enquiry in this
database carries a budget and nothing links an enquiry to a unit, so there is no
value to put on it. Not zero — unknown."*

**Say:**

> "A customer asked about a trade-in eight days ago and nobody has answered.
> That is real and it is evidenced — you can see the message timestamps.
>
> Now watch what it does **not** do. It will not tell you that enquiry is worth
> AED 40,000. Nothing in this database says what he was going to spend, and
> nothing links him to a specific car. Most systems would put a number there
> anyway, because a number sells better than a blank. This one prints *unknown*
> and tells you exactly which two facts are missing. When you connect your CRM
> and those facts arrive, the number appears — and it will be a real one."

---

### Step 4 — Ageing stock

Open **Inventory**, or stay on the leak register — the ageing story is the same
in both. The three worst:

| unit | days | cost | price | gross margin | band | engine says |
|---|---|---|---|---|---|---|
| DEMO-2101 Toyota Land Cruiser VXR 2022 | 214 | 268,000 | 279,000 | **11,000** (3.94%) | CRITICAL | `WHOLESALE` |
| DEMO-2104 Land Rover Range Rover Vogue 2021 | 187 | 305,000 | 352,000 | **47,000** (13.35%) | CRITICAL | `MANAGER_REVIEW` |
| DEMO-2107 Nissan Patrol LE 2022 | 148 | 232,000 | 262,000 | **30,000** (11.45%) | CRITICAL | `REPRICE` |

The bands are **this dealership's own** — warning at 75 days, critical at 110,
promote at 60, wholesale at 170, minimum margin 9% — not NEXUS defaults, and the
engine says so.

**Say:**

> "Two hundred and fourteen days. That Land Cruiser has been on your floor for
> seven months and it has AED 11,000 of margin left in it — under your own 9%
> floor. The engine does not say 'reprice it', because there is no room. It says
> wholesale, and it says why.
>
> And notice what it will **not** do: it never names a price. It holds nine
> competitor listings for these models and not one of them meets the match
> quality you set — same model name, different trim, different mileage, or
> captured 25 days ago. So it asks for a human price review and names no figure.
> A system that invents a price from a listing it cannot tie to your car is
> guessing with your gross."

---

### Step 5 — A deal blocker: the product refusing to invent a pipeline

Open **Deal Rescue**.

**What it actually says on staging today:** *"No prerequisites are recorded —
the readiness view is empty, so this screen cannot say what is blocking the
engine."*

**That is a staging gap, not the product.** On production the same screen lists
**nine named prerequisites, none of them met**, each with what it unlocks, why
it is not merely code, and what was measured. Staging is missing the platform
reference rows behind it (`deal_rescue_prerequisites` = 0 on staging, 9 on
production — see `/home/claude/out/demo-tenant-evidence.md`, finding 5).

**So do not open Deal Rescue in a demo until that is fixed.** Take the deal
blocker from **Today's Money Leaks → "Checks that could not run"** instead,
which is a stronger place for it anyway. Its seven lines on this data:

1. *Whether any enquiry has gone quiet on us* — **no successful run is on
   record at all**. "The silence detector reads NEVER_SUCCEEDED… reading '0 gone
   quiet' as good news would be reading a stopped clock." **Unlock:** start the
   workflow. Not code, not an integration — the cheapest thing on the list.
2. *How fast the exposed margin is being eaten, and therefore net margin on any
   unit* — 29 of 29 units. **Unlock:** one number, what a day on the lot costs.
3. *Whether any unit is priced above or below the market* — 29 of 29 graded
   UNKNOWN. **Unlock:** a competitor feed that returns a listing tied to a
   specific car.
4. *Whether a slow-selling unit is slow because nobody wants it or because
   nobody has seen it* — 29 of 29, enquiry coverage INSUFFICIENT.
5. *Whose conversations we are looking at* — 31 of 37 message events resolve to
   an enquiry, and 3 WhatsApp handles match nobody.
6. *What Lead Recovery says it cannot tell you, in its own words* — the engine's
   own sentence, verbatim, not a paraphrase.
7. **Service retention, missed appointments and no-shows, and true margin after
   reconditioning — *never measured, on any day*.** There is no service table,
   no appointments table and no reconditioning-cost column, and no connection to
   a system that holds them.

**Say:**

> "This is the register I would want if I were buying. Line seven is the biggest
> money in your year and the product tells you flatly it has never looked at it —
> instead of showing you an empty service panel that reads like a clean bill of
> health. Every other line says since when, why, and the one thing that would
> light it up. That is your roadmap, written as consequences instead of features,
> and it is on the screen rather than in a document I could quietly rewrite."

---

### Step 5b — The two registers most people skip, and shouldn't

**Checks that came back clear (4).** *Skip this one for now — see the warning at
the top of this file.* When it is fixed, the three sound lines are worth thirty
seconds each:

- *Nothing is stuck for want of somebody able to approve it* — 5 action records,
  none escalated.
- *No live decision rests on an engine finding that has since changed* — 3 live
  actions, the engine re-read on this page load and still agreeing with each.
- *The engine is content with the rest of the stock and recommends holding* —
  **20 of 29 units on HOLD**, each carrying gross margin it does not consider at
  risk yet.

> "A zero is only worth anything when it says what it counted. Twenty of your
> twenty-nine cars are fine and the screen says so with the denominator attached."

**What this screen refuses to call a leak (5 kinds, 22 alerts).** This is the
register that sells the product to a sceptic — every one of these is something a
competitor's dashboard would put on your morning list as a finding.

| alert kind | items | verdict | in one sentence |
|---|---|---|---|
| `undercut` | 7 | **REFUSED** | Seven listings are cheaper than ours and not one can be tied to our car. A price difference against a listing nobody can match is arithmetic, not a finding. |
| `sla_breach` | 6 | **NO RULE** | The screen has no rule for this kind, so it neither counts it as a leak nor clears it, and says so. |
| `inventory_aging` | 5 | **ALREADY RANKED** | The same five cars are in the leak register above with their evidence. Named here so the two lists reconcile, not counted twice. |
| `unanswered_chat` | 3 | **REFUSED** | Three WhatsApp threads waiting on a reply, none of which resolves to an enquiry record. Calling those a money leak would be inventing the customer. |
| `lead_unassigned` | 1 | **NO RULE** | As above. |

**Two honesty notes for the presenter, because a buyer may spot both:**

- The `unanswered_chat` verdict is written as *"Not one WhatsApp thread in this
  database resolves to a lead record."* The three threads **under** that verdict
  genuinely resolve to nobody — but the sentence overstates: 14 of this
  dealership's 17 threads do resolve to an enquiry. It is a hard-coded sentence
  that happened to be true of ALBA's data. If asked: *"that sentence is too
  broad — it is right about these three and wrong about the database, and it is
  on my list."*
- The `inventory_aging` rows show a title and **no detail at all**, because
  `v_needs_attention` builds that sentence by concatenating the accrued holding
  cost, which is NULL here — and in SQL, anything concatenated with NULL is
  NULL. It is the holding-rate gap showing through in a second place.

**Say, closing the register:**

> "Twenty-two alerts. The product turned four of them down and told you why, and
> for two kinds it says plainly that nobody has written a rule yet rather than
> quietly counting them. That is the number I would check first if I were you —
> not the thirteen it did raise."

---

### Step 6 — The recommended action, and approving it

Open **Action Center**. Find **DEMO-2115, Toyota Fortuner VXR 2023 — PROPOSED,
undecided for 3 days, AED 17,000 exposed.** The engine's own words:

> *"On the lot 103 days — past the 75-day ageing threshold this database already
> uses — and still carrying 10.76% gross margin, which is room above the 9%
> floor to move the price without going under cost."*

and the cost of doing nothing:

> *"AED 17,000 of gross margin stays exposed in a unit that has been on the lot
> 100 days. That is the amount AT RISK, not an expected loss and not a
> recoverable sum. How fast it is being eaten is NOT COMPUTABLE — this
> dealership has no holding rate on record."*

**If you want the strongest thirty seconds in the demo, do this first:** sign in
as `sales@northwind.demo.invalid` and try to approve it. Measured live:

> **Refused.** *"This account may not approve inventory actions. Its account
> role is sales and its job title is Sales Executive; approval needs an account
> role in (owner, admin, manager)."*

and **the refusal is written to the audit trail** as its own event —
`APPROVAL_REFUSED`, actor Rita Example (demo), authority *"NONE - refused;
account role sales"*, audit status `REJECTED`.

Then sign back in as the owner and approve, assigning it to Omar Example (demo).

**Say:**

> "Your salesperson cannot approve a price move. And the refusal is not silent —
> it is on the record with her name on it. That is what 'with your team in
> control' means in practice: not that everyone can do everything, but that
> everything anyone tried is written down."

---

### Step 7 — The audit trail

Stay on that action and open its timeline. Four rows, each with an audit chip:

| when | event | actor | audit |
|---|---|---|---|
| 3 days ago | `PROPOSED` | Omar Example (demo), Sales Manager | SUCCESS |
| just now | `APPROVAL_REFUSED` | Rita Example (demo), Sales Executive | **REJECTED** |
| just now | `APPROVED` | Dana Example (demo), Owner, `TENANT_OWNER` | SUCCESS |
| just now | `ASSIGNED` | Dana Example (demo) | SUCCESS |

The approval's own detail line, written by the database and not by the sales
pitch:

> *"Approved by Dana Example (demo) on authority TENANT_OWNER. Assigned to Omar
> Example (demo). **Nothing has been executed yet and no money has been
> recovered — approval is a decision, not an outcome.**"*

**And now go back to Today's Money Leaks.** The leak count is still **13** and
the exposure is still **AED 143,500**. What changed is the *shape* of line four:
it has moved from *"Toyota Fortuner VXR 2023 is waiting on somebody to answer"*
to *"A decision was taken on Toyota Fortuner VXR 2023 and nothing has been
recorded as done"*.

**Say — and this is the closing line of the demo:**

> "I just approved AED 17,000 of exposure and the number did not move. It won't,
> until somebody records that they actually changed the price, and even then it
> is not recovered revenue until a car sells and a person writes down on what
> basis they are crediting it. Every other product you will see would have shown
> you AED 17,000 recovered the moment you clicked approve.
>
> That is the whole difference. This thing will not tell you good news it cannot
> evidence — which is the only reason you should believe it when it does."

**Try approving twice**, if there is time. The second returns *"This decision was
already recorded by you at 06 Sep 2026 10:19 GST. No second record was created."*
One click or five, one row.

---

## 4 · When they ask something the product cannot answer yet

The rule is `commercial/WHAT-WE-CLAIM.md`, and this file does not exceed it. The
three questions every dealer asks, with the answers you may give:

### "Has anyone else used this?"

> **"No. You would be the first."**
>
> One dealership is on the system and it is my own test account: three enquiries,
> one recorded sale, and that sale is my own test lead, not a customer's. **No
> dealership customer has ever bought a car through this system.** Zero paying
> customers. The dealership you are looking at right now is invented — I built it
> so I could show you the product without showing you somebody else's business.
>
> What is real: it has answered live WhatsApp enquiries, it quoted a price
> straight off a real stock list and did not leak the cost price, and it has been
> tested hard against itself. What is not real is a production track record, and
> I am not going to invent one.

**Never** say enterprise-ready, enterprise-grade, SOC 2, GDPR compliant, ISO,
99.9%, or any uptime or response-time figure. None has been assessed and there
is no SLA and no uptime measurement. If pushed on speed: *"seconds to a couple
of minutes"*, with the slow end included, and no number attached to the headline
sentence.

### "What happens to my data?"

> It runs on my infrastructure, in one database, with your dealership separated
> from any other at the database level. Every table that holds your data carries
> a dealership id and every access rule checks it, so a signed-in user reads only
> their own dealership's rows. That was tested on 2 September with two test
> dealerships and re-tested harder on 3 September across every table and every
> view — including with the same customer email and the same phone number
> deliberately planted in both. Each saw its own rows and none of the other's,
> writes across the line were refused, and a forged dealership id in a login
> token was ignored.
>
> **The automation layer is not there yet** — the background workflows write as a
> system account with no dealership attached — **so I run one dealership per
> system.** That is a real limit, not a formality.
>
> Your data is yours throughout. Stock, customers and conversation history export
> to CSV on request at any point without notice. If you stop, you get the export
> within five working days and it is deleted from my systems within thirty.

**And volunteer this before they find it:** today the system sends and receives
through an unofficial WhatsApp client on a personal number. It works — but it
is against WhatsApp's terms, the number can be banned without warning, and it is
currently picking up personal messages. Week one of onboarding moves the number
to the official WhatsApp Cloud API under a Meta Business account **in the
dealership's name**, and no customer of theirs touches it before that is done.
A buyer who learns that later has stopped buying.

### "What does it cost me to try?"

> **Setup AED 5,000 once. Then AED 2,500 to AED 3,500 a month, three-month
> minimum.** The three months run from the day the first real customer message is
> answered, not from signature. Quarter one, all in: AED 12,500 at the bottom of
> the band, AED 15,500 at the top.
>
> The band is a rule, not a haggle. Start at AED 2,500; add AED 250 each for
> more than 50 vehicles, more than 400 inbound messages a month, more than five
> logins, or if I run the WhatsApp number for you. Set from your actual data at
> signature and fixed for the three months.
>
> **Month one is a get-out month.** If it is not working by day 30, say so and we
> stop — you pay month one and the setup and nothing further. And if the system
> is putting wrong information in front of your customers and I cannot fix it, I
> will end the pilot myself and refund the unused month.

### If they ask something you cannot answer

Say the words *"I don't know, and I am not going to guess in a sales meeting.
I will measure it and send you the number."* Then do. A buyer who catches a
guess stops believing the parts that were true.

The three that come up most, and the honest answers:

- **"Can it quote finance — monthly payment, APR?"** No. `finance_quotes` holds
  no live rows and the calculator's last success was 24 August. On 31 August the
  WhatsApp agent invented a monthly payment and sent it to a real person; the
  path is gated shut and stays shut. It is the feature buyers ask for first and
  the one I cannot sell today.
- **"Does it verify customer ID / is it KYC compliant?"** No. Three documents
  have been through it, all rejected as not-a-document, zero verified customers,
  and the auditor workflow has never once succeeded.
- **"Can you put my second branch on it?"** Not yet, and that is the same answer
  as the data question above. One dealership per system until the automation
  layer is dealership-aware.

---

## 5 · Proving isolation, live, if a buyer asks

Worth offering unprompted to a technical buyer. Signed in as
`owner@northwind.demo.invalid` on 6 September 2026:

```
rpc/sentinel_inventory_actions  ->  29 units, all tenant dddddddd-…
GET /rest/v1/inventory          ->  29 rows, one tenant id
GET /rest/v1/leads              ->  24 rows, one tenant id
```

Alpha Motors' three units and Bravo Autos' one are on the same database, in the
same tables, and this session cannot see any of them. Their row counts were
identical before the demo tenant existed, while it existed, and after it was
torn down.

---

## 6 · Putting it back afterwards

**Three things, in this order.**

**1. Take the local build off staging.**

```bash
cd apps/executive-dashboard
rm .env.local          # the deployed build reads Vercel's env, not this file
```

Nothing was deployed, so nothing needs redeploying. **Confirm before you walk
away**: `git status` shows no change to any tracked file, and the Vercel
deployment still answers with production data.

**2. Decide whether to keep the demo dealership.**

Keeping it is fine and costs nothing — it is about 140 rows on a staging project and
it cannot reach production. Re-run the seed before the next demo to refresh the
ageing dates; it is idempotent and purges itself first.

**3. Remove it when you are done with it.**

```
Supabase SQL editor, project wwspuxrbiyagnrnzgate:
  paste ops/demo/teardown_demo_tenant.sql   -> RUN
```

It prints a before/after row count per table and refuses outright if it is
pointed anywhere that looks like production. Proven on 6 September 2026:
every count went to zero, and Alpha Motors (3 units / 3 leads / 2 actions / 8
audit rows / 7 users), Bravo Autos (1 / 1 / 1 / 1 / 2), the quarantine tenant,
the `GATE-PROBE-` fixture unit and all nine pre-existing `auth.users` rows were
byte-for-byte where they started.

**What teardown deliberately does not touch:** any platform reference table.
`workflow_registry`, `policy_rule`, `deal_rescue_prerequisites`,
`inventory_action_reason_codes` and the rest hold exactly what they held before
the demo. The demo tenant never wrote to one.

---

## 7 · Re-creating the dataset

```
Supabase SQL editor, project wwspuxrbiyagnrnzgate:
  paste ops/demo/seed_demo_tenant.sql       -> RUN     (~2 seconds)
```

Idempotent: it purges every row carrying the demo tenant id and rewrites them,
so running it twice leaves one copy, and running it the morning of a demo resets
anything a previous rehearsal approved. All ageing is anchored to *today*, so
the Land Cruiser is 214 days old whenever you seed.

**Both scripts refuse to run against production, on two independent tests:**

- **(a)** they raise `NX999` if any tenant's slug or name contains `alba` —
  measured on production 6 September 2026: **true**, so both scripts stop before
  the first `DELETE`;
- **(b)** they raise `NX999` unless **both** `staging-alpha` and `staging-bravo`
  exist — measured on production: **false**, so both scripts stop again.

Guard (a) was fired deliberately on staging inside a rolled-back probe that
planted an ALBA-looking tenant: it raised, and the plant did not persist. A
guard that has never gone red is decoration.

**If either guard ever refuses on staging, do not edit it out.** It means
staging no longer looks like staging, and that is a finding.

---

## 8 · The one thing not to do

Do not run either script, or any part of either script, against
`dsvuoovivysszdoiorch`. Putting invented rows in the same database as the one
real dealership would poison every count in `commercial/WHAT-WE-CLAIM.md`, and
those counts are the only thing standing between this product and a claim it
cannot back up.
