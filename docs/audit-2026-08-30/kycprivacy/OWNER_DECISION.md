# Your customers' ID documents — a decision only you can make

**30 August 2026. Please read this before we change anything.**

---

## What is happening right now

When a customer sends a photo of their Emirates ID or passport to your WhatsApp number, our system sends that photo to a free artificial-intelligence service on the internet to read it.

The company that runs that free service says, in its own help pages, that **most free services of this kind train on the messages they receive, and some may publish them.** One of the three services we currently use is Google's free tier, and Google's own terms say, word for word: *"Do not submit sensitive, confidential, or personal information"* to it, and that *"human reviewers may read, annotate, and process"* what is sent.

So, plainly: your customers' passports are being sent to companies who are permitted to keep them, learn from them, and in some cases show them to their own staff. Those companies are outside the UAE.

Your customers were never told this. Your own privacy page on your website currently tells them the opposite — that their information stays on infrastructure you control and is never used to train AI.

**Nothing has gone wrong yet that we know of. This is not a breach. It is a practice that would be very hard to defend if anyone asked.**

---

## Can we just turn on a "private mode"?

I checked this first, because it would have been the easy answer.

The service does offer a private setting — you can tell it "only use providers who keep nothing." But when you switch that on, **every free option disappears.** I checked all of them on 30 August: there are eight free services that can read images, and not one of them qualifies as private. The free ones are free precisely because they are allowed to keep what you send.

So there is no setting that fixes this. It is a real choice.

---

## Your three options

### Option 1 — Pay a tiny amount. Everything keeps working. *(what I recommend)*

We move the document check to the paid version of **the same AI model we already use**. Paid versions come with a contract: the company keeps nothing and is not allowed to learn from it.

- **What it costs:** about **19 US cents per thousand documents.** Not per document — per thousand. To start, the service asks for a minimum top-up of about **$10**, which at your volume would last years.
- **A useful side effect:** that same $10 lifts a limit that is currently squeezing your whole system. Right now, because everything runs on free AI, the entire NEXUS setup is capped at **50 AI requests per day** across every workflow. Topping up raises that to 1,000 per day.
- **What you lose:** nothing. Same speed, same accuracy, same instant reply to the customer.

### Option 2 — Change nothing, spend nothing

Documents keep going to the free services.

- **What it costs:** nothing in money. What it risks is a customer, a regulator, or a finance partner asking where their passport went — and there being no good answer. It also means your published privacy page stays untrue, which is its own problem.
- **What you lose:** nothing today.

### Option 3 — Stop using AI for this. A person checks the documents.

The customer's document is still received and stored safely. Instead of an AI reading it, it appears in your team's Slack channel and a member of staff looks at it and says yes or no. Everything after that — the "please send a clearer photo" message, the three-attempt limit, the escalation — works exactly as it does now.

- **What it costs:** roughly **half a minute of someone's time per document**, and the customer waits for a person instead of getting an answer in three seconds.
- **What you lose:** the instant reply. Also, this one is not a settings change — we would need to build it, so it takes longer to put in place than Option 1.

---

## What I would do

**Option 1.** It is the only choice that keeps the speed you built this system for and stops your customers' identity documents being handed to companies allowed to keep them. It costs less per year than a tank of fuel. I would not let a ten-dollar limit decide where a customer's passport ends up.

If you would rather not spend anything at all, take **Option 3**, not Option 2. Slower is defensible. This is not.

---

## Four things being fixed regardless of what you choose

These need no decision from you and cost nothing. We will do them either way.

1. **Copies of ID photos were being kept when something went wrong.** If a document check failed — including when someone sent a document without permission, or when the free AI was simply too busy — the system quietly saved a full copy of the photo in its own internal logs on the server. That stops.
2. **Whatever the AI wrote about the document was being repeated to the customer and filed in the general message log.** If the AI wrote back "the name Ahmed Al-… and date of birth do not match", that sentence went into your WhatsApp reply and into the same message history your sales chatbot reads back on every later conversation — and that history is never deleted. From now on the customer sees one of four fixed, neutral sentences, and the message log records only that a re-upload was requested. The detail still gets recorded, but in the compliance records where it belongs, which are access-controlled and deleted on schedule.
3. **Stored files were named after the customer.** Documents were being filed under names like `kyc/ahmed_at_gmail.com/2026/08/…`, so anyone who could see the list of files could read your customer list without opening a single one. Files are now filed under a meaningless reference.
4. **The system was announcing itself.** Every request was labelled "NEXUS OS – KYC Auditor" with your web address attached, purely to appear on a public leaderboard on the AI company's website. Removed.

---

## Two things worth asking someone

**Do you actually have to collect these documents?** The UAE Ministry of Economy's list of businesses required to do identity checks covers property agents, accountants, gold and jewellery dealers, and company formation agents. **Car showrooms are not on it.** If none of your finance partners require this check in writing, the strongest privacy protection available is simply to stop asking for the documents. Worth a conversation with your bank before we spend effort protecting a process you may not need.

**Which rules apply to you?** If your trade licence is mainland Dubai, the federal data protection law applies. If you are licensed in DIFC or ADGM, a different and stricter rulebook applies. We do not know which you are, and it changes what is required. Please tell us.

---

## What happens next

Tell us **Option 1, 2 or 3**. That is all we need. The four fixes above go in this week regardless, and your privacy page will need rewriting to match whichever option you choose — it currently describes a system you do not have.
