# NEXUS OS — Pilot Onboarding

**Version 1.0 · 2 September 2026**
**How to put one dealership live, in order, with honest timings.**

This is the document that turns a signature into a working deployment, and turns a working
deployment into one you can repeat for the next dealership. Follow it in order. The steps
are sequenced because some of them block others, and the one that blocks the most is the
WhatsApp migration — start it on day one.

**Realistic total: 3 to 5 working days of Ali's time, spread across 1 to 3 calendar weeks.**
The calendar spread is not Ali's speed. It is Meta's business verification and the
dealership's speed at sending an inventory file.

---

## What you need from the dealership

Ask for all four on the day they sign, in one message. Chasing them one at a time is how a
one-week onboarding becomes a month.

### 1. The inventory file — the single most important item

**What:** every car currently in stock, as a spreadsheet or CSV.

**Must contain, per car:**

| Field | Why it matters |
|---|---|
| Model, with year and trim | This is what the bot matches the customer's words against. "Fortuner" has to find "Toyota Fortuner 2.7 VXR 2024". |
| VIN | The unique key. A car without a VIN cannot be registered, insured or handed over, and the system will accept a blank one rather than reject the row — so a blank VIN is a silent problem. |
| **Asking price, in AED** | This is the number the bot quotes to customers. If it is wrong, the bot is wrong, out loud, to a customer. |
| **Cost price, in AED** | Never disclosed to customers. Used for margin and for the ageing/discount logic. |
| Date acquired, or days in stock | Drives the ageing flags. |
| Status (available / reserved / sold) | Stops the bot quoting a car that is already gone. |

**Say this to them, in these words:** *"The asking price in this file is the price my system
will quote your customers. Have whoever owns pricing check it before you send it."*

**Time: 30 minutes of Ali's time to load. Days of waiting for the dealership.** Ask on day
one.

### 2. The WhatsApp number

A number the dealership is willing to dedicate to customer enquiries. **Not a salesperson's
personal phone, and not a number already in someone's WhatsApp Business app on a handset.**

You need from them:
- The number itself
- Access to receive an SMS or call on it during setup
- Their **trade licence** and business details, for Meta business verification
- Confirmation they are willing to move this number onto the official WhatsApp Cloud API,
  which means it stops working as a normal WhatsApp app on a phone

That last point surprises people. Explain it before they choose the number.

### 3. The staff list

Name, email, role, and Slack handle if they use Slack, for everyone who should see the
dashboard or receive a hot-lead alert. Also: **who is the finance person**, because every
finance question the bot receives gets handed to a human, and it needs a name.

### 4. Working hours and escalation rules

- Opening hours, per day, and the weekend (UAE weekends vary by business)
- Should the bot reply outside hours, or only capture and wait?
- Who gets pinged for a hot lead, and on what — Slack or WhatsApp?
- How long may a customer wait before it escalates to a human?

**There is no settings screen for any of this.** It is configured by hand inside the n8n
workflows. Budget the time; do not promise them a toggle.

---

## What Ali configures, step by step

### Step 1 — Start the WhatsApp Cloud API migration. Day one, before anything else.

**This is the long pole. Nothing about the pilot is safe until it is done.**

Today the system talks to WhatsApp through WAHA, an unofficial client, on a personal number.
That is against WhatsApp's terms of service and the number can be banned without warning. A
dealership's WhatsApp number is printed on its cars and its listings; losing it is a real
commercial loss. **No real customer of the dealership touches the system until this step is
complete.**

1. Create a Meta Business account **in the dealership's name**, not yours.
2. Submit business verification with their trade licence. **Meta takes 2 to 10 working
   days.** You do not control this. Submit it on day one.
3. Register the number on WhatsApp Cloud API and complete the display-name review.
4. Repoint the inbound webhook to the same address the current client posts to, so nothing
   downstream changes.
5. Migrate the outbound send path from the unofficial client to the Cloud API.
6. Submit any message templates needed for messages sent outside the 24-hour reply window.

**Ali's time: 3–4 hours. Calendar: 2–10 working days, and it is Meta's clock.**

**Already done and worth knowing:** the privacy policy and terms pages Meta requires are
live and reachable. That approval blocker is cleared.

### Step 2 — Load the inventory

Import the file into the `inventory` table. Then verify, by eye, on the Inventory screen:

- Every row has a VIN. The form accepts a blank one; the system will not stop you.
- The asking prices match the file.
- The cost prices are present — the ageing and margin logic needs them.
- The ageing recompute has run once and produced sensible days-in-stock.

**Then do the one test that matters:** message the number yourself asking the price of three
different cars, and check each answer against the sheet. If any price is wrong, stop and fix
the data. A wrong price is the fastest way to lose the pilot.

**Ali's time: 1 hour, plus 30 minutes of price spot-checks.**

### Step 3 — Add the staff

Add each person to the `users` table with name, email, role, status and Slack id. Create
their dashboard logins.

**Tell them, in writing, what this means today:** every person you give a login to can see
every lead, every customer, every message and every cost price. **There are no per-role
permissions.** If the dealership does not want a junior salesperson seeing what they paid
for each car, give that person no login during the pilot. This is a real limitation, it is
in the claims register, and it should be said out loud rather than discovered.

**Ali's time: 30 minutes.**

### Step 4 — Working hours, escalation and the finance handoff

Configured by hand in the n8n workflows:

- Reply window and out-of-hours behaviour
- Hot-lead alert destination and who is tagged
- Silence-detector threshold — the hourly job that finds conversations that went quiet
- **The finance handoff.** Confirm the finance path is gated off and that a finance question
  produces a handoff to the named finance person, not a number. Test it with a real finance
  question before go-live and read the reply yourself.

**Ali's time: 2–3 hours, including testing.**

### Step 5 — Load their documents into Ask AI

Warranty terms, service policy, trade-in policy, finance partners, whatever staff ask about.
The system currently holds 15 sample documents; theirs replace them.

**Optional for a first pilot.** If the dealership has not sent documents by day three, ship
without it and keep Ask AI switched off rather than let it answer from sample data.

**Ali's time: 1–2 hours if the documents arrive clean.**

### Step 6 — Move the infrastructure off free tiers

Free tiers are fine for building and wrong for a paying customer.

- **The VM.** It is a Google Cloud e2-micro on the Always Free tier, it is documented as
  CPU-starved, and it has been taken down twice. Move to a paid instance before go-live.
- **Supabase.** The free tier pauses after inactivity and takes no daily backups. Move to
  the paid tier. A pilot that loses a week of conversations is over.
- **AI models.** Currently OpenRouter and Groq free tiers, which are rate-limited with no
  availability guarantee. Put paid keys in. The fallback model ladder exists precisely
  because free capacity disappears.

**Ali's time: 2 hours. Cost: roughly AED 400–600 a month, which the pilot price covers.**

### Step 7 — Shadow run. Two days. Do not skip this.

**Before any real customer gets an automated reply**, run the system in shadow: it drafts,
Ali reads every draft, Ali sends. Two working days minimum.

You are checking three things:

1. **Are the prices right?** Against their sheet, every time.
2. **Does it stay off finance?** Any finance number appearing in a draft is a stop-the-line
   event.
3. **Does it sound like their dealership?** Tone is the thing a buyer notices first and the
   easiest thing to fix early.

**Ali's time: 2–4 hours across two days.**

### Step 8 — Go live, and watch it daily

Switch on automated replies. Then, **every working day for the first two weeks**:

- Read every conversation the bot had. All of them.
- Check the Automation screen for a workflow that has newly gone degraded.
- Check that new messages are landing on the right customer and not sitting unassigned.

**This is the supervision the pilot price pays for.** Estimate 30 minutes a day in week one,
dropping to a couple of hours a week by week four.

---

## What could go wrong

Ranked by how much damage it does, not by how likely it is.

| Risk | What actually happens | What to do |
|---|---|---|
| **The WhatsApp number gets banned** | The dealership loses the number printed on its cars. Immediate, total, and your fault in their eyes. | The only real mitigation is Step 1. Never go live on real customers over the unofficial client. If you demo on it, say so. |
| **The bot quotes a wrong price** | A customer holds a screenshot of a price the dealership must either honour or refuse. Either outcome damages the pilot. | Prices come from their file; verify by hand at Step 2 and re-verify whenever stock changes. Agree a stock-refresh cadence in writing. |
| **A finance number reaches a customer** | This has already happened once: on 31 August an earlier build sent a real person a monthly payment of AED 11,200 when the true figure was nearer AED 7,800. | The path is gated. Test it at Step 4, read drafts at Step 7, and never re-enable it during a pilot. |
| **Meta business verification stalls** | Go-live slips by a week or more and it looks like your delay. | Submit on day one. Tell the dealership at signature that Meta takes 2–10 days and it is not your clock. |
| **The inventory file never arrives, or arrives stale** | The bot quotes cars that are sold. | Do not start the three-month clock until stock is loaded. Agree who sends updates and how often. |
| **The VM falls over** | Messages stop being answered and nobody notices, because the infra health probe has never run. | Move off the free VM at Step 6. Check the Automation screen daily. Consider this the pilot's weakest point. |
| **The dealership asks for a second branch on the same system** | You cannot. There is no tenant separation; branch two would read branch one's customers. | Say no. Say why. It is a genuine engineering limit, not a pricing tactic. |
| **A staff member sees cost prices they should not** | There are no per-role permissions. | Restrict who gets a login, at Step 3, in writing. |
| **The dealership asks about data retention or deletion** | The retention purge workflow is registered, is marked active, and **has never run once**. Nothing enforces a retention window today. | Do not claim automatic purging. Offer manual deletion on request and put it in the pilot agreement. |
| **Messages land unassigned** | Of 108 logged messages, 47 resolve to a named customer. Most of the rest are non-customer traffic on a shared number. | A dedicated number fixes most of it. Explain that an unassigned message is the system refusing to guess, and show them where to find them. |
| **Personal or unrelated conversations get captured** | Currently real: 12 WhatsApp contacts on file, of which one is a car enquiry. The rest are personal and business contacts whose private messages are stored. | A dedicated number that has never been used personally. Non-negotiable, and it is Step 1. |

---

## The repeatability checklist

The second dealership should be faster than the first. It will only be faster if you write
down what slowed you on this one.

After each onboarding, record:

- [ ] Actual hours per step, against the estimates above
- [ ] How long Meta verification took, in calendar days
- [ ] How many cars in the inventory file needed fixing before load, and what was wrong
- [ ] Every question the dealership asked that this document did not answer
- [ ] Every price the bot got wrong in the shadow run, and why
- [ ] Anything you configured by hand that should have been a setting

**Then update this document.** The second pilot should be quicker to deliver and better
argued. That is the whole point of writing it down.

**And the hard limit, again:** one dealership per instance until the database separates
tenants. If a second pilot sells before that work is done, it needs its own separate
Supabase project and its own VM — which roughly doubles the infrastructure cost and all of
the supervision. Price the second pilot with that in mind, or build tenant separation first.
