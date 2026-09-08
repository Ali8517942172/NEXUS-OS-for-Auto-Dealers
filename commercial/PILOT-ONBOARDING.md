# NEXUS OS — Pilot Onboarding

**Version 2.1 · 3 September 2026**
**How to put one dealership live, in order, with honest timings.**

This is the document that turns a signature into a working deployment, and turns a working
deployment into one you can repeat for the next dealership. Follow it in order. The steps
are sequenced because some of them block others.

**Step 1 is the number separation, and it comes before everything — before the first demo,
not just before go-live.** The system today runs on Ali's personal WhatsApp number and the
database holds private conversations belonging to people who have nothing to do with any
dealership. That has to be undone before a buyer ever sees a screen. It is Step 1 for that
reason, and it is not a footnote.

**Realistic total: 3 to 5 working days of Ali's time, spread across 1 to 3 calendar weeks**,
including the 2 to 3 hours for Step 1.
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
personal phone, not the owner's phone, and not a number already in someone's WhatsApp
Business app on a handset.** A brand-new SIM is the right answer. A number with personal
history on it will bring that history into the database on first sync, and there is no clean
way to take it back out afterwards.

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

### Step 1 — Separate the number. Before the first demo, not just before go-live.

**Nothing else in this document starts until this is done.**

Today NEXUS OS sends and receives on **Ali's personal WhatsApp number**. Every proven result
in the sales pack went through it. It cannot stay that way for one commercial reason and one
ethical one: a dealership will not put its customers on a channel that is also somebody's
family chat, and the people already on that channel never agreed to have their messages
stored in a product database.

**Three numbers, and they never merge again:**

| Number | What it is for | When it is needed |
|---|---|---|
| **The personal number** | Ali's own life. It is disconnected from NEXUS OS and never reconnected. | Immediately. |
| **The NEXUS demo number** | A dedicated number owned by NEXUS, used only for demos and internal testing. Every buyer demo runs on this. It has no personal history and never will. | Before the first buyer demo. |
| **The client business number** | The dealership's own number, on the dealership's own Meta Business account, carrying only their customers. | Before the pilot's first real customer message. |

**A personal number and the product never share a channel again.** Not for a quick test, not
for a weekend, not "just to check something". If a test needs a real handset, it goes on the
demo number.

#### What happens to the private data already in the database

The database currently holds WhatsApp contacts and conversations that belong to no
dealership — a contracting company, a perfumer, family members, and discussions about cheques
and payments. They were captured because the product was listening to a personal number.

**They are deleted, not hidden, and it happens before any dealership data arrives.**

1. **List them.** Go through `whatsapp_contacts` and identify every contact that is not a
   vehicle enquiry. Everything else on that list is out.
2. **Delete their messages and their contact rows** from `communication_logs` and
   `whatsapp_contacts`, and delete the lead records created from non-customer traffic — there
   are disqualified rows in `leads` that are a contracting company and a wrong number.
3. **Do it by hand and verify the counts afterwards.** The retention purge workflow is
   registered, is marked active, and **has never run once**. There is no automatic purge to
   rely on and there is no scheduled job that will do this for you.
4. **Then take the counts again** and record them, so the pilot starts from a database whose
   contents you can account for line by line.

**Why this cannot wait for the tenant separation work.** The database now separates
dealerships, but the workflows do not — every n8n workflow writes as a system account with no
dealership attached, so its rows land under the one default dealership. That means the
pilot's customer conversations and these private conversations would land in the same place
and a dealership login would see both. Separation at the database layer does not clean up
data that is already inside the tenant. Deletion does.

**Say it to the buyer in plain words, before they ask:** *"Until today this ran on my own
number, so it picked up messages that had nothing to do with cars — including my family's.
Those are deleted, and your pilot starts on a number that has never been used for anything
else. That is why the number is step one and not step five."*

**Ali's time: 2–3 hours, plus the cost of a new SIM.**

---

### Step 2 — Start the WhatsApp Cloud API migration. Day one, alongside Step 1.

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

### Step 3 — Load the inventory

Import the file into the `inventory` table. Then verify, by eye, on the Inventory screen:

- Every row has a VIN. The form accepts a blank one; the system will not stop you.
- The asking prices match the file.
- The cost prices are present — the ageing and margin logic needs them.
- The ageing recompute has run once and produced sensible days-in-stock.

**Then do the one test that matters:** message the number yourself asking the price of three
different cars, and check each answer against the sheet. If any price is wrong, stop and fix
the data. A wrong price is the fastest way to lose the pilot.

**Ali's time: 1 hour, plus 30 minutes of price spot-checks.**

### Step 4 — Add the staff

Add each person to the `users` table with name, email, role, status and Slack id. Create
their dashboard logins.

**Tell them, in writing, what this means today:** every person you give a login to can see
every lead, every customer, every message and every cost price. **There are no per-role
permissions.**

**And say the second half, which is worse than the first.** A login is not read-only. Measured
3 September 2026: any signed-in user can change a vehicle's asking price and cost price,
**delete a vehicle record outright**, and reassign any lead. There is no role check in the
database and none in the interface, so nothing stops it and nothing warns first. The Action
Centre — the one screen that does have an approval model — gates *approving a recommendation
to reprice a car* while the unit form does not gate *deleting the car*. That inconsistency is
real, it is written up in `SECURITY_REGRESSION_REPORT.md` as SEC-05, and until it is closed the
only control is who holds a login.

If the dealership does not want a junior salesperson seeing what they paid for each car — or
able to delete a car from the stock list — give that person no login during the pilot. Put
that sentence in the email, not just in the conversation.

**Ali's time: 30 minutes.**

### Step 5 — Working hours, escalation and the finance handoff

Configured by hand in the n8n workflows:

- Reply window and out-of-hours behaviour
- Hot-lead alert destination and who is tagged
- Silence-detector threshold — the hourly job that finds conversations that went quiet
- **The finance handoff.** Confirm the finance path is gated off and that a finance question
  produces a handoff to the named finance person, not a number. Test it with a real finance
  question before go-live and read the reply yourself.

**Ali's time: 2–3 hours, including testing.**

### Step 6 — Load their documents into Ask AI

Warranty terms, service policy, trade-in policy, finance partners, whatever staff ask about.
The system currently holds 15 sample documents; theirs replace them.

**Optional for a first pilot.** If the dealership has not sent documents by day three, ship
without it and keep Ask AI switched off rather than let it answer from sample data.

**Ali's time: 1–2 hours if the documents arrive clean.**

### Step 7 — Move the infrastructure off free tiers

Free tiers are fine for building and wrong for a paying customer.

- **The VM.** It is a Google Cloud e2-micro on the Always Free tier, it is documented as
  CPU-starved, and it has been taken down twice. Move to a paid instance before go-live.
- **Supabase.** The free tier pauses after inactivity and takes no daily backups. Move to
  the paid tier. A pilot that loses a week of conversations is over.
- **AI models.** Currently OpenRouter and Groq free tiers, which are rate-limited with no
  availability guarantee. Put paid keys in. The fallback model ladder exists precisely
  because free capacity disappears.
- **Close the inbound webhook.** `POST /webhook/whatsapp-inbound` accepts unauthenticated
  requests today. The check is written into the workflow but it is **dormant**, because
  `WAHA_WEBHOOK_SECRET` is unset on the box — so it passes everything through. What is
  actually holding the door is a second control downstream, an allowlist on the WhatsApp
  session name, which refuses an unknown session and writes nothing; that was proven live on
  3 September. Close it properly in this order: set `WAHA_WEBHOOK_SECRET`, make WAHA send the
  `x-nexus-webhook-secret` header, confirm in MONITOR mode that **real** messages are passing
  the gate, and only then set `WAHA_WEBHOOK_ENFORCE=true`. **Do not set the secret first.**
  WAHA is not sending that header yet, so enforcing before it does would silently drop every
  real customer message. Send yourself one WhatsApp before touching anything, because the
  session allowlist is already live.

**Ali's time: 2 hours, plus 1 hour for the webhook rollout. Cost: roughly AED 400–600 a
month, which the pilot price covers.**

### Step 8 — Shadow run. Two days. Do not skip this.

**Before any real customer gets an automated reply**, run the system in shadow: it drafts,
Ali reads every draft, Ali sends. Two working days minimum.

You are checking three things:

1. **Are the prices right?** Against their sheet, every time.
2. **Does it stay off finance?** Any finance number appearing in a draft is a stop-the-line
   event.
3. **Does it sound like their dealership?** Tone is the thing a buyer notices first and the
   easiest thing to fix early.

**Ali's time: 2–4 hours across two days.**

### Step 9 — Go live, and watch it daily

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
| **Personal or unrelated conversations get captured** | Currently real: 12 WhatsApp contacts on file and one of them is a car enquiry. The rest are family and unrelated businesses — a contracting company, a perfumer — whose private messages, including cheque and payment discussions, are sitting in the database. | Step 1, in full: a dedicated number that has never been used personally, and the existing private rows deleted by hand before the pilot starts. Ranked here as the highest-damage risk on the list, because it is the one that is already true rather than merely possible. |
| **The WhatsApp number gets banned** | The dealership loses the number printed on its cars. Immediate, total, and your fault in their eyes. | The only real mitigation is Step 2. Never go live on real customers over the unofficial client, and never demo on a personal number at all. |
| **The bot quotes a wrong price** | A customer holds a screenshot of a price the dealership must either honour or refuse. Either outcome damages the pilot. | Prices come from their file; verify by hand at Step 3 and re-verify whenever stock changes. Agree a stock-refresh cadence in writing. |
| **A finance number reaches a customer** | This has already happened once: on 31 August an earlier build sent a real person a monthly payment of AED 11,200 when the true figure was nearer AED 7,800. | The path is gated. Test it at Step 5, read drafts at Step 8, and never re-enable it during a pilot. |
| **Meta business verification stalls** | Go-live slips by a week or more and it looks like your delay. | Submit on day one. Tell the dealership at signature that Meta takes 2–10 days and it is not your clock. |
| **The inventory file never arrives, or arrives stale** | The bot quotes cars that are sold. | Do not start the three-month clock until stock is loaded. Agree who sends updates and how often. |
| **The VM falls over** | Messages stop being answered and nobody notices, because the infra health probe has never run. | Move off the free VM at Step 7. Check the Automation screen daily. Consider this the pilot's weakest point. |
| **The dealership asks for a second branch on the same system** | You cannot yet. The database separates dealerships as of 2 September, was tested with two, and was re-tested harder on 3 September — but the workflows all write as a system account with no dealership attached, so branch two's messages would file under branch one. Three further defects fire on that same day: unclaimed ID document files fall to the default branch, a lead can be assigned to the other branch's staff, and two reports go silently empty. | Say no, and say exactly which half is done and what the other half costs. It is a genuine engineering limit, not a pricing tactic. A second branch is a separate quote, not a band adjustment. |
| **A staff member deletes a car, or changes a price** | There are no per-role permissions **and a login is not read-only**: any signed-in user can edit a vehicle's asking and cost price, delete the vehicle record, and reassign any lead. Nothing in the database or the interface stops it. | Restrict who gets a login, at Step 4, in writing. Treat a dashboard login as equivalent to write access to the stock file. |
| **Someone posts to the inbound webhook directly** | `POST /webhook/whatsapp-inbound` accepts unauthenticated requests; its secret check is dormant because the secret is unset on the box. The session allowlist behind it refuses an unknown session and writes nothing — that is the only control standing there today. | Step 7's webhook rollout, before the dealership's customers are on it. Do not describe the perimeter as closed until `WAHA_WEBHOOK_ENFORCE=true` and a real message has passed the gate. |
| **The dealership asks about data retention or deletion** | The retention purge workflow is registered, is marked active, and **has never run once**. Nothing enforces a retention window today. | Do not claim automatic purging. Offer manual deletion on request and put it in the pilot agreement. |
| **Messages land unassigned** | Measured 2 Sep 2026 at 09:58 UTC: of 108 logged messages, **24** resolve to a named customer record. Most of the rest is non-customer traffic on the shared personal number. | Step 1 fixes most of it. Explain that an unassigned message is the system refusing to guess, and show them where to find them. |

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

**And the hard limit, again:** one dealership per instance. The database half of tenant
separation was built and tested on 2 September and re-tested harder on 3 September; the
automation half was not started. The globally unique keys that used to be part of this
blocker — `leads.email` and `customer_360_profiles.customer_id` — **are now scoped per
dealership**, and the readiness report says so; do not keep quoting them as open.

What is actually left before a second dealership shares an instance:

1. The n8n workflows must send a dealership id with every write. They still write as a system
   account, and this is the one BLOCKER the readiness report shows.
2. Unclaimed ID document files in storage must stop falling through to whichever dealership
   holds the default flag. They are passports and Emirates IDs.
3. `leads.assigned_to_id` must stop pointing at any dealership's staff.
4. `nexus_scoped_tenant_id()` must stop returning null for the system account once a second
   dealership exists — today two reports and the nightly Customer 360 batch go **silent**
   rather than wrong, which is harder to notice.
5. Four launch-critical checks — a non-approver being refused, a repeated decision staying
   idempotent, one dealership being denied another's rows through the real signed-in path, and
   the rendered figures matching the live rows — have **never been run**, because production
   has one dealership and one user and that user is an approver. They need a staging project
   restored from a production snapshot. They are not passes today; they are unknowns.

Until those are done, a second dealership needs its own Supabase project and its own VM. That
roughly doubles the infrastructure cost and all of the supervision. Price the second pilot with
that in mind, or finish the list first. The system will tell you where it stands, with the
caveat that it only sees items 1–4's database half:
`select * from public.nexus_tenancy_readiness();`

**Also add to the checklist above:** how long the number separation in Step 1 actually took,
and how many private rows had to be deleted. The second dealership will not have that
problem, and the record of it is what proves the personal number never comes back.


---

## Figures in this document

Checked against Supabase project `dsvuoovivysszdoiorch` on **3 September 2026**, scoped to the
one real dealership (`tenants.slug = 'alba-cars'`). Anyone re-running these counts must scope
them the same way. On 2 September a raw `count(*)` at 09:57 showed 2 sales and 2 finance
quotes, and every one of them was another workstream's test data — a raw count will lie to you
in exactly the direction you want to be lied to.

That one dealership is the pilot — tenant #1 of a product built for dealerships generally, the
UAE first and then wider. Every figure below is one tenant's figure. The steps in this
document are written to be repeatable for the next dealership; the figures are not.

12 WhatsApp contacts, 1 of them a car enquiry · 108 messages, 24 resolving to a named
customer · 3 leads · 12 vehicles, **0 with a reconditioning cost** · **0 customer sales** (one
`purchase_history` row appeared at 09:59:53 on 2 Sep from a repair test against the owner's own
lead — not a sale) · 0 finance quotes · 3 KYC submissions and 0 verified · 15 sample Ask-AI
documents · 1 dashboard login · 687 run records · retention purge workflow: 0 runs, ever ·
infrastructure health probe: 0 runs, ever.
