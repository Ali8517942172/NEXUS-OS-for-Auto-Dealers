# NEXUS OS — Claims Register

**Version 1.0 · Measured against the live system on 2 September 2026**

This document has one job: keep Ali from saying something in a meeting that the system
cannot back up.

Read the right-hand column before every meeting. If a claim is not in the left column, do
not make it. If you want to add one, prove it against the database first and then add it
here with the query result and the date.

**A buyer who discovers a gap you disclosed trusts you more. A buyer who discovers a gap you
hid does not buy from you again.**

---

## Part 1 — Claims you may make

| You may say | Evidence, measured 2 Sep 2026 |
|---|---|
| "A customer's WhatsApp message gets an automatic reply with no human involved." | Live inbound at 06:07:12.52 on 2 Sep, automated outbound at 06:07:30.35, logged as sent by `bot`. 19 automated replies since 31 August. |
| "The reply came back in 17.8 seconds." | 06:07:30.348 minus 06:07:12.521 = 17.827s. **Only ever as a specific past example, never as a rate.** |
| "Replies take seconds to a couple of minutes." | 19 replies since 31 Aug: fastest 13.3s, median 41.6s, slowest 219.4s. |
| "The price it quotes comes from your stock list, not from the AI's imagination." | Reply quoted AED 152,000; `inventory.price_aed` for VIN MHFXW9F31P0450103 (Toyota Fortuner 2.7 VXR 2024) is exactly 152000. |
| "It knows your cost price and will not disclose it." | `cost_aed` for that VIN is 133,000. It does not appear in the reply text. Gate added after a 31 Aug leak — see Part 2. |
| "The message attached to the customer who was already on file, without creating a duplicate." | Message resolved to lead 38, created 31 Aug 02:40. `leads` count was 3 before and 3 after. |
| "When it cannot tell two customers apart by phone number, it refuses to guess and leaves the message unassigned." | Resolution requires a unique 9-digit phone tail; a tail shared by two people matches nobody. Both database resolution paths agree on all 14 distinct message keys, 0 disagreements. Guard is by construction — no collision exists in live data to have triggered it. |
| "Every run writes an independently verified record — the system checks that each step it claims actually landed." | The 2 Sep run logged `SUCCESS — all 3 claimed steps verified`. `audit_log` holds 590 rows since 14 Aug (589 an hour earlier — it grows with every run). |
| "The system grades its own workflows and tells you when one is broken." | `v_workflow_health` over 18 registered workflows: 2 HEALTHY, 11 DEGRADED, 1 PRODUCING_NOTHING, 1 NEVER_RAN, 3 NOT_INSTRUMENTED. |
| "Days-in-stock is recomputed every night and flags cars that are sitting." | Inventory Ageing Recompute: 18 runs, 18 successes, 100%, graded HEALTHY. Last run 1 Sep 20:15. 12 units, average 56.4 days, 3 flagged WARNING or CRITICAL. |
| "Duplicate WhatsApp messages do not produce duplicate replies." | `processed_messages` holds 100 claimed message ids; the id is claimed atomically before the reply is generated. |
| "It stays quiet when one of your people is already in the chat." | Reply-eligibility check runs before the model. Present in the published workflow. |
| "Everything is on the record and you can read it back." | 108 rows in `communication_logs` (83 inbound WhatsApp, 25 outbound), each with direction, timestamp and sender. |
| "The dashboard is 14 screens over one live database." | 14 registered screens; one Supabase project, no second data store. |
| "The AI can answer staff questions from your own documents." | Ask-AI RAG agent: 14 runs, 11 successes, graded HEALTHY. **Add: "it has not been exercised since 24 August and holds 15 sample documents, not yours."** |
| "You would be the first dealership on it." | 1 user account, 3 lead records, of which 2 are disqualified wrong numbers. |
| "It is a supervised pilot on my infrastructure, not a self-service product." | True and it is the correct frame. Say it early. |

---

## Part 2 — Claims you may NOT make

| Do not say | The gap |
|---|---|
| **"It quotes finance — monthly payment, APR, EMI."** | `finance_quotes` holds **0 rows**. The calculator has 62 logged runs: 46 rejected, 8 produced no calculation, 5 failed, 3 succeeded — and even the 3 successes left no quote row. Last success 24 August. |
| **"The finance figures are reliable."** | On **31 August the WhatsApp agent invented a monthly payment of AED 11,200 and sent it to a real person.** The true figure was nearer AED 7,800. The path is gated. Never present a finance number verbally either. |
| **"It verifies customer ID / it is KYC compliant."** | `kyc_documents` holds **3 rows and 0 verified customers**. All three are `NOT_A_DOCUMENT`, verdict `REJECTED`, voided — images correctly identified as not identity documents. The auditor workflow: 9 runs, 7 failures, 0 successes, last run 17 August. The path has never once succeeded. |
| **"It tracks closed deals / shows you sold revenue."** | `purchase_history` holds **0 rows**. No sale has ever been recorded through this system. The lead-to-sale link was added to the schema on 2 September and has never carried a deal. Wired, never fired. |
| **"It monitors competitor prices."** | 120 runs, 14 usable prices, 106 producing nothing. The system's own health rule classifies it `PRODUCING_NOTHING`. |
| **"It runs automated marketing follow-up."** | The 7-day drip campaign: 5 runs, 5 failures, 0% success. Last run 26 August. |
| **"It is multi-tenant / your data is isolated from other dealerships."** | **No table has a tenant column.** All 15 access policies granting the signed-in role are `USING (true)` — any authenticated user reads every lead, message, customer and document. This is the single biggest blocker to a second paying dealership and it is why the pilot is capped at one. *Note: the repository README describes a multi-tenant architecture. That describes an intention. Do not read from it in a meeting.* |
| **"Enterprise-ready", "enterprise-grade", "SOC 2", "GDPR compliant", "ISO"** | None has been assessed, audited or certified. There is no data-processing agreement drafted. |
| **"99.9% uptime" / any SLA figure** | There is no SLA and no uptime measurement. The VM has been taken down twice by concurrent changes and is documented as CPU-starved. The infra health probe is registered and has **never run**. |
| **"Real-time" / "instant" / "under 20 seconds"** | Measured range 13.3s to 219.4s. On 2 September one reply took 3 minutes 39 seconds. |
| **"It answers every message."** | 83 inbound WhatsApp messages, 34 received a reply. The rest were non-customer traffic on a shared number and were correctly left alone — but do not claim full coverage. |
| **"It has handled hundreds of customers."** | 3 lead records total, 2 of them disqualified wrong numbers. 12 WhatsApp contacts. The honest word is *pilot*. |
| **"Facebook, Instagram, the website and TikTok feed into it."** | Those webhooks exist and are wired. **Not one lead has ever arrived through any of them.** Every real inbound has come through WhatsApp. |
| **"Customer 360 gives you a live view of the customer."** | It is a once-daily batch, 2 profiles on file, 25 runs at 36% success. It is not live. |
| **"Data is purged on a retention schedule."** | The retention purge workflow is registered, is marked active, and has **never run**. KYC records carry a `retain_until` of 2033 that nothing has ever enforced. |
| **"It has been penetration-tested / security-reviewed."** | It has not. An access-key exposure was found and closed on 2 September; the fix is real, the external review is not. |

---

## Part 3 — The WhatsApp channel. Disclose this before signature, every time.

**The system currently sends and receives through WAHA, an unofficial WhatsApp client,
running on a personal mobile number.**

Everything proven in Part 1 went through that channel. It works. It is also three separate
problems, and a dealership owner will understand all three immediately:

**1. It is against WhatsApp's terms of service.** Unofficial clients are automated
third-party access to WhatsApp. Meta bans numbers for it, without warning and without
appeal. If that happens mid-pilot, the dealership loses its WhatsApp number — the number
printed on its cars and its listings. That is a commercial risk to the buyer, not a
technical inconvenience, and it must be stated in those terms.

**2. It is running on a personal number, and it is reading personal messages.** The database
currently holds 12 WhatsApp contacts, of which one is a car enquiry. The others are family
and unrelated business contacts — a contracting company, a perfumer, a cosmetics shop — and
their private conversations have been captured and stored, including cheque and payment
discussions in Gujarati. This is unacceptable for a commercial deployment and it is also the
clearest possible argument for a dedicated dealership number. Say it plainly: *"Right now it
is on my own number and it picks up my mother's messages. That is exactly why step one of
your onboarding is a dedicated number that only your customers use."*

**3. There is no template approval, no green tick, no delivery guarantee.** The official API
brings message templates, a verified business profile, and a delivery receipt. The
unofficial client brings none of them.

### The plan to tell the buyer

> "Week one of your onboarding, before a single customer of yours touches it, the number
> moves to the official WhatsApp Cloud API through a Meta Business account in **your**
> dealership's name. The privacy policy and terms pages Meta requires for that approval are
> already live — that groundwork is done. The pilot does not go live on real customers until
> the migration is complete.
>
> Two things that come with it and you should know now: your business gets verified with
> Meta, which takes a few days and needs your trade licence. And messages you send outside a
> 24-hour reply window are charged per message by Meta — small money at pilot volume, but it
> is a real line item and it is yours, not mine."

**Never demo on the unofficial channel to a buyer without saying which channel it is.** If
the buyer later learns that the impressive 17.8-second reply came through a client that
could get their number banned, you have lost the account and the referral behind it.

---

## Part 4 — How to keep this document true

- **Before every buyer meeting**, re-run the counts in Part 2. `finance_quotes`,
  `kyc_documents` and `purchase_history` are the three that change the sales conversation the
  moment any of them holds its first genuine success.
- **A row appearing is not a success.** `kyc_documents` went from 0 to 3 rows on 2 September
  and the number of verified customers stayed at zero. Check the outcome, not the count.
- **When a claim moves from Part 2 to Part 1**, write the date, the query and the result
  beside it. A claim with no evidence line does not belong in Part 1.
- **Nothing moves from Part 2 to Part 1 on the strength of code being written.** It moves
  when it has run, on real data, and left a record. "Wired but never fired" stays in Part 2.

---

## Final verification

Re-run against the live Supabase project `dsvuoovivysszdoiorch` at **08:48:10 UTC on
2 September 2026**, after this pack was drafted, because other work was changing the
database while it was being written:

| Table | Rows | Reading |
|---|---|---|
| `finance_quotes` | **0** | Finance quoting has never completed. |
| `kyc_documents` | **3**, of which **0 verified** | All three rejected as not an identity document. KYC has never succeeded. |
| `purchase_history` | **0** | No sale has ever been recorded. |
| `leads` | **3** | Two are disqualified wrong numbers. |
| `communication_logs` | **108** | 83 inbound WhatsApp, 25 outbound. |
| `inventory` | **12** | AED 3,046,900 asking, AED 2,667,000 cost. |
| `audit_log` | **590** | Growing; 589 at 08:3x. First row 14 August 2026. |

The database counts here are what a buyer will be told. Re-run them before each meeting.
