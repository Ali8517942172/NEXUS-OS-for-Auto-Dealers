# Round 4 brief — 24 Aug 2026: one real customer, and nothing else

You own exactly ONE file. Do not edit any other file — other agents are working
on the other screens right now and a write outside your file will be lost.

## What changed under you

The database was cleaned tonight. Everything that was not this dealership's real
data has been deleted (a full export was taken first). **The system now holds
exactly one customer**, and he is to be treated as a real customer, not a test:

    name    ALI ASGHER UJJAIN WALA  /  Shabbir Ujjainwala
    email   shabbir53ujjainwala@gmail.com
    phone   +918517942172
    chat    158510264357112@lid          (this is the WhatsApp reply address)

Row counts now, read live:

    leads                 1     inventory            12
    communication_logs   66     rag_documents        15
    kyc_documents         9     finance_quotes        3
    whatsapp_contacts     1     purchase_history      1
    users                 1     deals_embeddings      1
    competitors           0     customer_360_profiles 1
    audit_log           289     daily_metrics         6

What was removed, and why it matters to your screen:

* **136 messages** from thirteen WhatsApp handles belonging to people in the
  owner's personal phone book. They were never customers — they are the people
  who received the fabricated KYC approvals.
* **9 kyc_documents rows that were never submissions** (greeting cards, a
  religious banner, a Sikh prayer text). The `void_reason` partition is now
  **empty**. Keep the code that handles it — the gate that produced them is
  fixed but the branch must still be correct — and make sure an empty voided
  section renders as nothing rather than as an empty box.
* **All 15 competitor rows.** Twelve were seed data whose `our_price_aed`
  contradicted real inventory (a Land Cruiser quoted at AED 290,000 against an
  actual list price of 385,000; the GLE, X5, Cayenne and Macan were never in
  stock), which means **all five "undercut" alerts on Overview were fabricated**.
  The other three were scrape failures. `competitors` is empty until the
  scraper runs at 05:00 UTC.
* **3 seeded staff rows** with a NULL email and `pending_invite`. `users` is
  now one row: Ali Asgher, senior_rep.
* A duplicate `customer_360_profiles` row from the Bitrix era.

`v_conversations` was also rebuilt: the same customer used to appear as **two**
threads (46 messages under his email, 20 under his LID) because
`communication_logs.lead_email` holds an email when a lead is known and a
WhatsApp handle when it is not. It now resolves to one person per thread — 66
messages, one row — while still exposing the `chat_id` to reply on.

## Your job

**Make your screen correct, honest and good-looking with exactly one customer.**

This is harder than it sounds and it is the whole point of this round. A
dashboard designed against seeded data usually looks broken when the data is
real and sparse. Specifically:

1. **Empty states are now the common case, not the edge case.** `competitors` has
   zero rows. Most screens have one of something. An empty state must say what
   is empty, why it might be empty, and what would fill it — never a bare
   "No data" and never an empty card with a heading and nothing under it.
2. **Never present n=1 as a statistic.** "Average response time" over one lead is
   not an average. Percentages, distributions and trends over one row are
   meaningless and must say so. Several screens already do this well — read
   `screens/overview.js` for the standard.
3. **Do not fabricate.** If a panel has nothing real to show, it says so.
4. **Check every number your screen prints against the counts above.** If your
   screen would show something that no longer exists, fix it.
5. **The phone number goes beside the name** wherever a person is shown.
   `leads.phone`, `purchase_history.phone`, `v_conversations.phone` and
   `v_customer_360.phone` all carry it. `users` has **no phone column** — staff
   numbers are stored nowhere, and that absence is stated, not blank.

## Hard rules

- **Do not make live network calls to Supabase, n8n or WAHA from your shell.**
  That box is a 1-vCPU VM and has been crashed twice by concurrent load. The
  authority on columns is the `CORRECTION` section at the bottom of
  `/tmp/dash-work/SCHEMA.md`. I run the probe centrally at the end.
- **Never invent an endpoint.** `HOOK` in `lib/data.js` is the complete list. No
  hook for what you need → render the control disabled with a `title=` naming
  exactly what is missing.
- Only `leads`, `inventory` and `finance_quotes` are browser-writable.
- Use `tone()` from `lib/format.js`. Do not write a private severity map.
- Nav badges belong to `lib/badges.js`. Do not write to `#badge-*`
  (overview is the one documented exception).
- `esc()` every interpolated value.
- Comment *why*, not *what*.

## Done means

    cd /tmp/dash-work && node --input-type=module --check < screens/<yours>.js

parses. Report: what you changed, what now renders as an empty state and how it
reads, any statistic you had to withdraw because n=1, and anything wrong you
found outside your file.
