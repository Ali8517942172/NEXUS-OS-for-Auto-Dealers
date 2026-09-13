# NEXUS OS — Demo Script

**Version 2.1 · 3 September 2026**
**Runs in 12 minutes. Do not run long.**

**Two changes from version 1.0, and they are not cosmetic.** The "17.8 seconds" line is
gone — you no longer quote a response time at all, and the replacement wording is below.
And the price you close on is now a setup fee plus a monthly band, not a flat monthly fee.

Read this whole document before your first demo, including the DO NOT SHOW list. The list
has a reason beside every entry, because a salesperson who does not know *why* a screen is
off-limits will open it anyway when a buyer pushes.

---

## The one thing this demo proves

A customer messages your WhatsApp about a car. Nobody at the dealership touches it. They get
back the right car, the right asking price, and no hint of what you paid for it. It lands on the right customer record without creating a duplicate. You can read the
whole exchange afterwards.

That is the whole demo. It is one path. It is real, it is repeatable, and it is the only
path in this system that has been proven end to end on live traffic.

**Do not add a second story.** The temptation to show finance quoting or compliance is the
single biggest risk in this meeting. Every one of those screens is honest about being empty,
and an empty screen in a sales meeting reads as a broken product even when the emptiness is
the correct answer.

---

## Before the buyer arrives — 20 minutes of setup

1. **Load their stock, or at least six of their cars,** into the inventory table with real
   asking prices and real cost prices. The demo dies if you quote a Fortuner to a Nissan
   dealer. If you cannot get their stock, say up front that the stock on screen is a sample
   and show the ageing flags instead.
2. **Demo on the dedicated NEXUS demo number. Never on a personal number.** A buyer's phone
   showing a personal WhatsApp profile, or a stray family message appearing in the
   Conversations screen, ends the meeting. If the demo number is not ready, postpone the
   demo.
3. **Send yourself a test message on the demo number and confirm you get a reply.** Do this
   within the hour before the meeting, not the night before. The WhatsApp connection uses an
   unofficial client and it drops.
4. **Open the dashboard, sign in, and leave it on Overview.** Signing in live wastes a
   minute and can fail.
5. **Have a second phone ready** — ideally the buyer's own phone, which is far more
   convincing than yours.
6. **Check the Fortuner (or their equivalent) price is what you are going to say.** Read it
   off the Inventory screen with your own eyes.

---

## The script, beat by beat

### Beat 1 — Inventory (90 seconds). Establish the ground truth first.

**Open:** `Assets → Inventory`

**Say:**
> "Before I show you the AI, I want to show you what it is reading from. This is your stock.
> Every car has an asking price and a cost price. The Fortuner: asking AED 152,000, cost
> AED 133,000. Remember the cost number — I am going to come back to it."

Point out the ageing flags: on the sample stock, three of twelve cars carry a WARNING or
CRITICAL flag, average 57 days in stock. Say the ageing recompute runs every night at 00:15
and has run 20 times with 20 successes. **Read the average off the screen** — it goes up by one
every night.

**Why this beat comes first:** if you show the reply before the price, the buyer has no way
to check it. Showing the inventory first turns the reply from a demo into a verification.

---

### Beat 2 — The message (60 seconds). Let the buyer send it.

**Say:**
> "Take your phone. Message this number and ask about one of these cars, however you would
> actually type it. Spelling mistakes are fine — that is the point."

Hand them the number. Let them type it themselves. If they will not, type it yourself but
say the words out loud as you type.

The proven example, typed exactly like this by a real person on 2 September:
> `Hi i m interested in the fortuner whats the price`

Then **stop talking and let the phone sit there.** The silence is the demo. Do not fill it.

---

### Beat 3 — The reply (30 seconds). Read it out loud.

The reply that came back on 2 September 2026:

> "The Toyota Fortuner 2.7 VXR 2024 we have in stock is AED 152,000. Let me know if you'd
> like more details or a test drive!"

**Say:**
> "Two things. AED 152,000 is exactly the number on the Inventory screen — it did not guess,
> it looked it up. And it did not mention AED 133,000. It knows your cost price and it will
> not say it. That is not the model being polite; it is a rule in the system."

**The one approved sentence for what the product does. Use these words:**
> "Nexus automatically responds to inbound dealership enquiries and routes high-intent
> opportunities to the right team."

**On timing — do not attach a number to that sentence.** If the buyer asks how fast, and only
if they ask:
> "Seconds to a couple of minutes. I am not going to give you a number I can hold to, because
> I do not have enough production traffic yet to promise one. When I do, I will put the
> measurement in writing."

If they push for the actual spread, you may give the measured range and you must give all of
it, not the good end: **fastest 13 seconds, median 39 seconds, slowest 3 minutes 38 seconds,
across 18 automated replies. Four of the eighteen took over 100 seconds.**

**Banned, permanently: "17.8 seconds", "under 20 seconds", "instant", "real time",
"immediately".** One fast measurement is not a rate. A buyer who is told 17 seconds and
watches 90 will not believe the rest of the demo, and he will be right not to.

---

### Beat 4 — Conversations (90 seconds). It went on the record.

**Open:** `Work → Conversations`

The exchange the buyer just sent is there — their message in, the bot's reply out, both
timestamped, marked as sent by the bot rather than by a person.

**Say:**
> "Nothing here is the AI's account of what it did. Every one of these lines is a record
> written at the time. If a salesperson tells you a customer was answered, you can check."

---

### Beat 5 — Leads (2 minutes). This is the beat that separates it from a chatbot.

**Open:** `Work → Leads`

**Say:**
> "Here is the part I actually care about. That message did not create a new customer. It
> found the customer who was already there — created two days earlier — and attached itself.
> One person, one record."

Then the harder half, and say it plainly:
> "And when it cannot tell two customers apart by phone number, it attaches the message to
> neither. It leaves it unassigned rather than guessing. A message sitting unassigned is a
> problem you can fix in ten seconds. A message filed against the wrong customer is a problem
> you find out about when the wrong person gets a call."

**A live figure you can quote:** of the logged messages, only a minority resolve to a named
customer record and the rest sit unresolved — count it before the meeting rather than
quoting this document, because it moves. Say it out loud if asked. It is not a failure: most
of the rest is non-customer traffic on a shared personal number, which is exactly why a
dedicated dealership number is step one of onboarding.

---

### Beat 6 — Automation (2 minutes). The uncomfortable screen, shown on purpose.

**Open:** `Operations → Automation`

This screen shows 18 workflows and their health. Right now: **2 healthy, 11 degraded, 1
producing nothing, 1 never run, 3 not instrumented.**

**Show it anyway. Say this:**
> "I could have kept you off this screen. Here is why I am not. The system grades its own
> workflows and it grades them harshly — one failure in thirty days and a workflow goes
> amber. The WhatsApp agent shows 42% over thirty days, because most of that month was me
> building it. Since 28 August it has run 47 times with 40 successes. I am showing you the
> bad number and the good number, because you are going to see this screen in week one either
> way and I would rather you hear it from me."

Then point at the competitor scraper, marked "producing nothing":
> "That one finds a usable price on 17 attempts out of 168. The system says so itself, in
> those words. It is not in your pilot and I am not charging you for it."

**Why this beat exists:** it is the trust beat. A buyer who has just watched you volunteer
your worst screen will believe your best one. Skipping it is the short-term play.

---

### Beat 7 — Close (2 minutes). No screen.

Shut the laptop.

**Say:**
> "What you saw is one path, and it is the only path I will sell you today: a WhatsApp
> message becomes an answered customer with a correct price, on the record. Everything else
> in this system is built and unproven, and I have written down which is which — I will send
> you that document, not a brochure.
>
> It is a managed pilot, not a software subscription. AED 5,000 to set it up, then AED 2,500
> to AED 3,500 a month, three months minimum. Where you land in that band is a rule, not a
> negotiation: you start at 2,500 and you add 250 for each of four things — stock over 50
> cars, more than 400 customer messages a month, more than five people needing a login, and
> whether you want me running the WhatsApp number for you. On what you have told me that is
> AED X a month. One dealership, one number, on my infrastructure with me watching it every
> day. If it is not working by day 30, you tell me and we stop."

**Work out the band figure before the meeting and say the number, not the rule and then a
pause.** The rule is there so you can defend the number when they push, not so you can
compute it in front of them.

Hand over `PILOT-OFFER.md` and `WHAT-WE-CLAIM.md`. Handing over the claims register is the
strongest move in this meeting. Do it.

---

## DO NOT SHOW — and the reason for each

Every reason below is a fact from the live system on 2 September 2026. Read the reasons, not
just the list.

| Screen | Why it stays shut |
|---|---|
| **Intelligence → Finance Desk** | The quotes table holds **zero rows**. The screen is honest and will render as empty, which looks broken. Worse: on 31 August an earlier build quoted a real person a monthly payment of **AED 11,200** when the true figure was nearer **AED 7,800**, and sent it. That is a number a dealership could be held to. The path is gated off and stays off. |
| **Work → Compliance** | The KYC register holds **3 rows and zero verified customers** — all three submissions were correctly rejected as "not an identity document". The auditor workflow has 12 logged runs, 10 failures, 0 successes, and has never succeeded once. A buyer who sees a compliance screen assumes compliance. You have none to sell. |
| **Operations → Deals** | No dealership customer has ever bought a car through this system. The sales table held zero rows until 09:59 on 2 September, when a repair test wrote one row against Ali's own lead — a Lexus at AED 585,000 that nobody bought. The sync job is 19 runs, 15 failures, graded DEGRADED. A pipeline screen showing one deal that is not a deal is worse than an empty one. |
| **Assets → Competitors** | 17 usable prices out of 168 attempts. The system classifies it as "producing nothing" in those words. Do not open a screen that argues against you. |
| **Operations → Campaigns** | The drip campaign has run 8 times and failed 8 times. 0% success, and it has never succeeded once. |
| **Operations → Team** | There is **one user** in the system. A team screen showing one person undercuts everything you just said about a dealership floor. |
| **Settings** | It exposes integration configuration and connection state. It is an engineering screen and it invites engineering questions you do not want in a sales meeting. |
| **Intelligence → Ask AI** | *Judgement call.* It works — 11 successes in 17 logged runs, graded healthy — but it **has not produced an answer since 24 August** and there are only 15 documents loaded. The six later entries are an unauthenticated security probe being correctly refused, not the agent working. Show it only if the buyer asks about "AI answering staff questions", and say clearly it is loaded with sample documents, not theirs. |
| **Intelligence → Customer 360** | Holds **2 profiles** and refreshes once daily as a batch. If you show it, do not describe it as live. It is a nightly job. |
| **Overview — the Pipeline value tile** | With the current data it correctly reports that no open lead has a budget recorded. That is the right answer and it looks like a bug. Overview is the landing screen so the buyer will see it; steer to Inventory within fifteen seconds and do not narrate the tiles. |

---

## The three questions that will be asked, and the honest answers

### "Can it work out the monthly payment for the customer?"

> "No, and I am not going to let it. The finance calculator has run 65 times and written
> zero quotes. Its last recorded success was 24 August. On 31 August it quoted a real person
> AED 11,200 a month when the right answer was closer to AED 7,800 — and it sent it. I
> switched that path off and it stays off for your pilot.
>
> What it does instead is hand the conversation to your finance person with the customer's
> question and the car attached. That is the honest version, and it is the version that
> cannot get you a complaint from a customer holding a screenshot."

**Never soften this into "finance is coming soon".** If they need finance quoting, that is a
real reason not to buy yet, and telling them so is what gets you the call back in three
months.

### "Does it verify ID? We have compliance obligations."

> "No. Three documents have gone through the KYC path and all three were correctly rejected
> as not being identity documents. Zero have ever been successfully verified. I will not sell
> you a compliance tool I have never seen succeed.
>
> What the system does do is refuse to show a customer as compliant when it does not know.
> An unchecked customer shows as unknown, not as clear. That is deliberate — a compliance
> screen that reports 'no problems found' when the checker itself failed is worse than no
> screen at all."

### "How many dealerships are using this?"

> "None. You would be the first, and that is why it is a managed pilot at pilot money and not
> a subscription at software money. I run it and I watch it daily.
>
> On your data being separated from another dealership's: the database side of that was built
> and tested on 2 September. Every table carries a dealership id, every access rule checks it,
> and I tested it with two dealerships across every table and every screen — each one saw its
> own rows and none of the other's, and I could not write across the line or fake the
> dealership id in a login token.
>
> The automation is not there yet. The workflows that write your messages into the database
> run as a system account with no dealership attached, so a second dealership's traffic would
> file under the first. That is why I still run one dealership per system, and it is why you
> are getting a dedicated system rather than a seat on someone else's."

**Do not compress this into "we are multi-tenant now".** Half of it is proven and half of it
is not, and the half that is not is the half a buyer would care about.

### "How fast does it reply?"

> "Seconds to a couple of minutes. I could give you the best number I have ever measured, but
> it would be one measurement rather than a promise, and you would hold me to it. When there
> is enough of your traffic through it to state a real figure, I will state it and show you
> the measurement."

If they press, give the full measured spread — fastest, median **and** slowest. Never the
fast end alone.

---

## Hard rules for whoever gives this demo

1. **Never quote a monthly payment, APR or EMI.** Not verbally, not "roughly", not
   "indicative". The system has produced a wrong one and sent it to a real person.
2. **Never quote a response time, in any form.** Not "17.8 seconds", not "under 20 seconds",
   not "instant", not "real time". If asked, say "seconds to a couple of minutes" and, if
   pushed, give the whole measured range including the slowest. A response-time promise is
   the easiest claim in this pack to disprove in front of the buyer.
3. **Never say "enterprise", "compliant", "SOC 2" or "99.9%".** None is true.
4. **On "multi-tenant", say only what was tested.** The database now separates dealerships
   and that was proven on 2 September with two test dealerships. The workflows do not — they
   write as a system account with no dealership attached. So: "your data is separated at the
   database level, tested; the automation is not there yet, so I still run one dealership per
   system." Do not shorten that to "we are multi-tenant". The repository README used to claim
   a multi-tenant architecture; it was corrected on 3 September and now states the limit. If
   any version of it reads better than this document, this document is the one that is right.
5. **If the live demo fails, do not fake it.** Say: "That is the unofficial WhatsApp client
   dropping — it is exactly why moving to the official API is week one of your onboarding."
   Then walk the Conversations screen showing the 2 September exchange that did work. A
   recovered failure demonstrates the honesty you have been claiming for ten minutes.
6. **If you do not know, say you will check and then actually check.** Every figure in this
   pack came from a query against the live database. You can always get the real answer.
7. **Never say the system is secured, locked down, or hardened.** It has had no external
   review, and one endpoint — the inbound WhatsApp webhook — still accepts unauthenticated
   requests because its secret is not set on the server. That is a week-one configuration
   task and it is disclosed in the offer document. If a buyer asks about security, say what
   is true: "I have tested it hard myself and written down what I found. Nobody independent
   has looked at it, and there is one door I am closing in your first week."
8. **Never imply a dashboard login is read-only.** Anyone you give a login to can change a
   car's price, delete a vehicle record and reassign a lead. If the buyer asks who should get
   logins, that is the answer, and it is better said in the meeting than found in month two.


---

## Figures in this script

Checked against Supabase project `dsvuoovivysszdoiorch` on **3 September 2026**, scoped to the
one real dealership. Anyone re-running these counts must scope them to
`tenants.slug = 'alba-cars'` or the numbers will flatter you.

That dealership is the pilot — tenant #1 of a product built for dealerships generally. Every
figure below is therefore one tenant's figure, and none of it is evidence about how NEXUS
behaves with a second dealership on it.

108 messages, 24 resolving to a named customer · 3 leads · 12 vehicles · 0 customer sales
(1 `purchase_history` row exists, written 09:59:53 on 2 Sep by a repair test) · 0 finance
quotes · 3 KYC submissions, 0 verified · 1 login · 687 run records ·
18 automated replies at 13.3s fastest, 38.8s median, 218.3s slowest.

**Two warnings on reading the Automation screen before a meeting.** A workflow's *last run*
date is not evidence it worked — on 3 September a security test posted an unauthenticated
request to every endpoint, ten refused correctly, and each refusal wrote a failure row. That
one burst moved the last-run date on eight workflows, Ask AI and KYC among them. Read
*last success*. And the run counts in this script go stale within days: re-read them, and if
one has moved against you, say the new number.
