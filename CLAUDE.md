# Working on NEXUS OS

Read this before doing anything in this repo.

## Who you are working for

Ali owns this product. As of 2 September 2026 he has decided to run this as a
business rather than as an engineering project, and he has asked that work here
be judged the way an owner judges it:

**Does this make NEXUS OS sellable to a real dealership on a subscription, and
does it keep it sellable once they are using it?**

That is not a licence to cut corners — an owner carries the liability for what
the software says to a customer. It means:

- Weigh revenue, risk and time-to-cash alongside correctness. A defect that
  cannot reach a customer is not urgent. A defect that puts a wrong number in
  front of a buyer, or one dealership's data in front of another, is.
- Say what is proven and what is not, in plain commercial terms. "Wired but
  never fired" is a real and useful answer. A confident claim that turns out to
  be false costs a customer, not a code review.
- Never help overstate the product. The current honest position is a
  **controlled dealership pilot**, not "enterprise-ready" or "compliant". If a
  claim is not backed by evidence in this repo or the database, do not make it
  and do not help make it.
- Prefer finishing one path a buyer can see end to end over improving five they
  will never open.

## The one thing standing between this and subscription revenue

**The system is single-tenant.** There are no tenant columns, and every RLS
policy is `USING (true)`. Any signed-in user reads every lead, every message,
every customer. Selling a second dealership onto this database means the second
one can read the first one's customers.

Everything else on the roadmap is smaller than this. Do not design new features
that deepen the single-tenant assumption.

## What is actually proven

Proven live on 2 Sep 2026, with a real inbound WhatsApp message:
identity resolved to an existing lead without creating a duplicate; an
inventory-grounded reply in 17.8 seconds quoting a real price with the vehicle's
cost withheld; a SUCCESS audit row. That path is demoable and honest.

Never exercised, all time — `finance_quotes`, `kyc_documents` and
`purchase_history` all hold **zero rows**. Finance quoting, KYC and closed-won
deals have never completed once. Do not describe them as working. `Customer 360`
is a once-daily batch, not live.

On 31 Aug the WhatsApp agent invented an EMI of AED 11,200 (the true figure was
nearer 7,800) and sent it to a real person, and a separate reply leaked the
dealership's internal vehicle cost. Both are now gated. The WhatsApp finance
path should not go live.

## House rules that exist because something broke

- **One agent on the n8n box at a time.** Parallel writes have taken the
  production VM down twice. Repo and database work parallelises fine.
- **n8n edits stay in draft until published.** Verify against the *published*
  version by fetching it back, not against your draft.
- **No frontend may compute a finance figure.** APR, EMI, monthly payment, LTV
  come from the calculator with `calculation_id` and `execution_id` behind them,
  or they do not appear. Without evidence: no number, not even "indicative".
- **A missing row is not proof the event did not happen.** Unknown ≠ none. This
  codebase has rendered that lie in six separate places.
- **One figure, one derivation.** See `NEXUS_INVARIANTS.md`.
- **Check captions against the branch they sit in.** Sentences asserting the
  opposite of their own code have been found seven times here.
- **Every public view needs `security_invoker`.** A database event trigger now
  fails the deploy without it; `CREATE OR REPLACE VIEW` silently drops the
  option and did so three times.

## Where the record lives

- `NEXUS_INVARIANTS.md` — INV-001..INV-008: the business rule, who owns it,
  how it is written and read, and the query that proves it. Open violations are
  recorded as open rather than described as passing. Keep it that way.
- `architecture/schema.sql` — regenerated from the live catalogue; a
  transcription, not a replay, and it goes stale within days.
- `DESIGN.md`, `README.md` — product and setup.
