# Billing — what exists, and what a trial actually does

**17 September 2026 · agent TRIAL · migration `nx990`**
**Status: authored and TESTED ON STAGING. NOT APPLIED TO PRODUCTION.**

Read `ops/landing-page/PRICE-DECISION.md` first. The price is decided:
**AED 399 per month, flat, permanent, first month free.** Nothing here reopens it.

---

## 1. What existed before this

Nothing. Swept on production `dsvuoovivysszdoiorch` on 17 Sep 2026:

| Probe | Result |
|---|---|
| Tables matching `bill\|subscrip\|plan\|trial\|entitle\|seat\|invoic` | **0** |
| Functions matching the same | **0** |
| Commercial columns on `public.tenants` | **0** of 7 |

So NEXUS could be **sold** — the public site states a price — and could not be
**subscribed to**. A dealer who said yes could not be given a trial that ended,
and nobody could answer *who is paying · who is in trial · whose trial expired
yesterday*.

## 2. What nx990 adds

**Tables**

| Object | What it is |
|---|---|
| `public.subscription_state` | Lookup. Five words — `TRIAL`, `ACTIVE`, `PAST_DUE`, `CANCELLED`, `EXPIRED` — each with the sentence it means and whether it counts as entitled. |
| `public.tenant_subscription` | One row per dealership. State, `price_aed` (default 399), `currency`, trial start/end, paid start, cancellation date and reason, notes. |
| `public.subscription_event` | Append-only history, one row per change. `UPDATE` is refused outright by a trigger with no escape hatch. |

**Functions**

| Object | Who may call it |
|---|---|
| `nexus_subscription_status()` | `authenticated`, `service_role` |
| `nexus_subscription_start_trial(uuid, int, text, text)` | `service_role` **only** |
| `nexus_subscription_convert_to_paid(uuid, numeric, text, text)` | `service_role` **only** |
| `nexus_subscription_cancel(uuid, text, text)` | `service_role` **only** |

`nexus_subscription_status()` is shaped exactly like `nexus_channel_status()`:
scoped by `nexus_current_tenant_ids()`, and it **returns no rows at all** for a
caller with no membership. It never falls back to a default dealership.

`tenant_subscription` and `subscription_event` are both on the NX900
destructive-write guard (4 new triggers), because n8n and every receiver run as
`service_role`, which carries `rolbypassrls`.

## 3. What a dealer's trial ACTUALLY does

**It does exactly one thing: it records a date.**

- `start_trial` writes `TRIAL`, `trial_started_at = now()`, `trial_ends_at =
  now() + 30 days`, and one `TRIAL_STARTED` event.
- `nexus_subscription_status()` can then answer, for that dealership only, what
  state they are in and how many days are left.

**What it does NOT do — all of it, explicitly:**

1. **Nothing switches off.** No code in NEXUS reads `tenant_subscription` to
   withdraw the product. An expired trial keeps working exactly as it did the
   day before. `subscription_state.entitled` is *reported*, never *imposed*.
2. **Nothing sweeps.** No scheduled job moves a lapsed `TRIAL` to `EXPIRED`.
   The accessor works around this honestly: it reports the **effective** state
   beside the **stored** one and flags `state_is_stale`, so a trial that ended
   in August reads `EXPIRED`, not "30 days left". Proven on staging.
3. **Nobody is told.** No email, no WhatsApp, no dashboard banner fires at day
   23, day 30 or day 31. The data is there; nothing reads it to anyone.
4. **No money moves.** There is no Stripe, no card, no token, no bank detail,
   no processor id, and **no column that could hold one**. Money is collected
   by Ali, by hand, outside this system. The schema records *that* a
   dealership is subscribed and since when — never how they paid.
5. **No invoice exists.** Nothing generates, numbers, stores or sends one.
   No VAT treatment is modelled (UAE VAT is 5% and is not represented here).
6. **No self-serve signup.** A trial is started by `service_role` only. A
   dealership's browser cannot start, convert or cancel its own subscription,
   by design — proven on staging, see §5.
7. **No proration, no annual term, no discount, no banding.** PRICE-DECISION
   leaves banding on stock size, message volume and logins deliberately open;
   `price_aed` is per-dealer so a future band has somewhere to live, and
   nothing computes one today.

## 4. What is still missing before anyone can be CHARGED

In the order they block:

1. **A way to take money.** Today: a bank transfer Ali chases by hand. Nothing
   in this repo records a payment, a receipt, or a failure to pay.
2. **A sweep.** Something that runs daily, moves lapsed trials to `EXPIRED`,
   and writes the `TRIAL_EXPIRED` event. Until then the stale flag is the
   substitute, not the fix.
3. **A notification.** Day-23 and day-30 messages to the dealer, and one to
   Ali. `PAST_DUE` in particular is a state a human has to be told about.
4. **An invoice, with UAE VAT.** A number series, a PDF, a record of what was
   billed for which month.
5. **Enforcement, if it is ever wanted.** A decision first: does an expired
   trial lose the product, or keep it while somebody calls them? Nothing here
   presumes an answer.
6. **A screen.** `nexus_subscription_status()` has no caller. No page in the
   frontend reads it yet.
7. **Terms the dealer agreed to.** Nothing records consent to a price, a date
   of agreement, or a version of the terms.

## 5. Staging test results (`wwspuxrbiyagnrnzgate`, 17 Sep 2026)

Run against the existing two-tenant adversarial harness (tenant A
`0a1a…000a` / user `aaaa1111…`, tenant B `0b1b…000b` / user `bbbb2222…`).

| # | Test | Result |
|---|---|---|
| a | `start_trial(A, 30)` | `TRIAL`, `trial_ends_at = 2026-10-17 16:30:44Z` — exactly 30 days. Accessor reports **30 d left**. |
| b | `authenticated` A reads `tenant_subscription` | **1 row** — A only. B's row invisible. Same for `subscription_event` (1 row, tenant A) and the accessor (1 row). Mirror test as B: 1 row, B only. |
| c | `anon` reads either table, the lookup, or the accessor | **All 5 refused** — `permission denied for schema public`. Blocked at the schema door (NX975) before RLS is consulted; the restrictive anon policies sit behind that as defence in depth. Production was checked: `has_schema_privilege('anon','public','usage')` is **false** there too. |
| d | `authenticated` with a `sub` holding **no** membership | Accessor: **0 rows**. Table: **0 rows**. No default dealership. |

Also measured, same session:

| Test | Result |
|---|---|
| `authenticated` A `UPDATE`/`INSERT` on `tenant_subscription` | refused — `permission denied for table` |
| `authenticated` A calls `convert_to_paid` | refused — `permission denied for function` |
| `start_trial` on the quarantine tenant | refused — *"that is the unattributed quarantine tenant, not a dealership"* |
| `start_trial` twice for the same dealership | refused |
| `UPDATE public.subscription_event` | refused — `NX990 APPEND_ONLY_REFUSED` |
| `DELETE FROM public.tenant_subscription` | refused — `NX900 DESTRUCTIVE_WRITE_REFUSED`; 2 rows survived |
| `convert_to_paid(A, 399)` | `ACTIVE / 399.00 AED / started 2026-09-17`; evidence: *"Paying AED 399.00 a month since 17 Sep 2026 Dubai time. Collected by hand — NEXUS holds no payment instrument."* |
| `cancel(B, reason)` | `CANCELLED` with the reason stored; blank reason refused |
| history after all of it | `TRIAL_STARTED ->TRIAL \| TRIAL_STARTED ->TRIAL \| CONVERTED_TO_PAID TRIAL->ACTIVE \| CANCELLED TRIAL->CANCELLED` |
| trial back-dated to end 30 days ago, row left saying `TRIAL` | accessor returns `EXPIRED`, `stored=TRIAL`, `stale=true`, `entitled=false`, evidence: *"The free month ran out on 18 Aug 2026 Dubai time and the row still says TRIAL — nothing sweeps it."* |
| dealership with no subscription row at all | `NONE`, `entitled=false`, evidence: *"No subscription has ever been created for this dealership."* |

**Nothing failed.** Staging was left with tenant A `ACTIVE` and tenant B with no
subscription row — synthetic test state, not a fixture anything depends on.

**Implemented and tested on staging ≠ production-proven.** Production has not
been touched by this work: it was read with `SELECT` only.
