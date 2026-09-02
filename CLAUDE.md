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

## What the product is

**NEXUS is a Revenue Recovery & Action OS for dealerships**, not an AI chatbot,
not a CRM, not an automation platform. It sits *above* the dealership's
existing DMS, CRM, inventory and accounting systems, finds where money is
leaking, decides the next best action, and executes it with the team in
control. It replaces none of those systems. `PRODUCT.md` holds the full thesis,
the commercial role of each of the 14 modules, the engines, and the roadmap —
read it before proposing any feature.

The sequencing rule that matters more than the strategy: **build the engine
whose data already exists.** An engine that renders "no data" to a paying
dealership is worse than one that does not exist. Measured 2 Sep — inventory
has cost and days-in-stock on all 12 units, so Profit Sentinel is buildable
now; there is **no service table, no appointment table and no recon-cost
column**, so Service Retention and most of Deal Rescue are blocked on
integrations, not on code. Sell those as roadmap, never as capability.

Never fabricate a monetary impact. Estimated, attributed and confirmed are
three different words; do not call an estimate revenue, and do not claim
recovered revenue until a real business outcome occurs.

## Tenancy: the database is finished. The workflows are most of the way.

As of 2 September the database side is **complete**. `tenant_id` on every
tenant-scoped table and NOT NULL on all of them; every natural business key
scoped per dealership (`leads.email`, `customer_360_profiles.customer_id`,
`deals_embeddings.deal_id`, `inventory.id`, `whatsapp_contacts.chat_id`,
`processed_messages.message_id`, `purchase_history.deal_id`, `users.email`);
tenant-scoped RLS; the five SECURITY DEFINER functions that were cross-tenant
bypasses scoped; `v_inventory_sales` and `v_customer_directory` scoped. Proven
adversarially with two synthetic tenants as real roles with JWT claims — reads,
writes, updates, deletes, tenant-hopping, a forged `tenant_id` claim, membership
self-grant, all ten views, hot-lead routing, phone-tail identity collision and
the whole `anon` surface all returned zero. Do not redo this work.

17 of 21 n8n workflows now resolve a tenant from something real — the WAHA
session for WhatsApp, the authenticated user via `tenant_members` for
JWT-guarded webhooks, the calling workflow for sub-workflow hops — and stamp it
explicitly rather than relying on the column default.

**It is still not safe to onboard a second dealership**, and what remains is
operational rather than structural:

- `NEXUS_TENANT_MAP` is not set on the box. Every resolver falls through to its
  built-in single-tenant map. The moment that env var holds two keys, roughly
  fifteen code paths switch from "the only dealership" to "unresolved" at once.
  **Rehearse that switch on a staging box before it happens in production.**
- Customer 360 goes *silent* at two dealerships — `nexus_scoped_tenant_id()`
  returns null for a `service_role` caller once more than one tenant is active,
  so the nightly batch syncs nobody and writes no audit row. Silent, not wrong,
  but it must iterate tenants before anyone is onboarded.
- `tenants.is_unattributed_default` means an omitted `tenant_id` lands in
  whichever dealership holds the flag. Harmless with one; wrong with two. Either
  point it at a quarantine tenant or convert the remaining omissions to explicit
  nulls.

`select * from public.nexus_tenancy_readiness();` is the live gate — but note
its remaining BLOCKER fires whenever any tenant holds the default flag and
cannot see n8n at all, so it will not clear from workflow work. Read it with
that in mind.

## What is actually proven

Proven live on 2 Sep 2026, with a real inbound WhatsApp message:
identity resolved to an existing lead without creating a duplicate; an
inventory-grounded reply in 17.8 seconds quoting a real price with the vehicle's
cost withheld; a SUCCESS audit row. That path is demoable and honest.

Deals now works end to end. On 2 September a real closed-won deal was recorded
through the live dashboard UI: `purchase_history` row with the correct
`amount_aed`, `purchase_date`, `lead_id` and `tenant_id`, a `deals_embeddings`
row, an audit row, and the Deals screen showing it. Submitted four times, one
row — idempotency is proven, not assumed.

Finance is subtler than "never exercised", and the earlier claim in this file
was wrong. `finance_quotes` shows 16 inserts and 13 deletes in
`pg_stat_all_tables` — the insert path has worked repeatedly and a journey
teardown script deletes the rows after every test. "Empty" means cleared, not
never. What is genuinely unproven is whether it works *today*: the fix to the
constraint that broke it is nine minutes younger than the last failure and has
not been exercised since.

KYC has 3 rows and 0 verified. A row appearing is not the capability working —
check the outcome, not the count. `Customer 360` is a once-daily batch, not live.

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
