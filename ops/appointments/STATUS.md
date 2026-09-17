# Appointments — what a booking actually does

**Status: schema implemented and tested on staging `wwspuxrbiyagnrnzgate` on 17 Sep 2026.
NOT applied to production `dsvuoovivysszdoiorch`. Nothing calls it yet — no workflow,
no receiver, no screen.**

Migration: `supabase/migrations/20260917101500_nx995_the_post_promised_booked_showroom_visits_and_nothing_could_hold_one.sql`

## Why this exists

A published Adqonic post says NEXUS will "schedule showroom visits seamlessly" and
"turn website visitors & social leads into booked appointments automatically".
Measured on production the same day: **0 tables, 0 functions and 0 columns** matching
anything to do with appointments, bookings, visits, showrooms, slots or calendars.
Nothing in NEXUS could hold a booking. Ali's instruction was to make the claim true
rather than delete it. This is the schema half of that. The claim is **not yet true**
until something calls it — see "What this does NOT do".

## What a booking now actually is

Six states, each with a plain-English sentence stored beside it in
`public.appointment_state`:

| state | is it a booking? | what it means |
|---|---|---|
| `REQUESTED` | **no** | A customer asked to come in. No time proposed, nothing in anyone's diary. |
| `OFFERED` | **no** | We proposed times. The customer has not agreed to any of them. |
| `CONFIRMED` | **yes** | The customer agreed to one specific time. This is the only state that is a booking. |
| `ATTENDED` | yes | A human recorded that they walked in. |
| `NO_SHOW` | yes | A human recorded that they did not. |
| `CANCELLED` | no | Called off. `outcome_reason` says by whom and why. |

Two lies are structurally impossible:

* **"Booked" cannot be shown for something nobody confirmed.** `counts_as_booked` is a
  column on the lookup table, false for `REQUESTED` and `OFFERED`. A screen reads it
  instead of deciding for itself.
* **"Attended" is never inferred from time passing.** No code path moves `CONFIRMED`
  to `ATTENDED`. A confirmed slot whose time has gone produces
  `awaiting_outcome = true` and the evidence line *"the slot has passed and nobody has
  recorded whether they turned up"* — never a number.

`nexus_appointment_mark_attended()` additionally **refuses** any appointment that has
not started yet.

## Objects

| object | what it is |
|---|---|
| `public.appointment` | one showroom visit. Tenant-scoped. RLS on: `authenticated` may SELECT its own dealership's rows only; no INSERT/UPDATE/DELETE policy exists for browsers at all. |
| `public.appointment_state` | the six words + their meanings. Lookup, RLS on, read-all for signed-in. |
| `public.appointment_transition` | every legal move, as data. The write functions read it, so the machine has one definition and refusals can quote it. |
| `public.appointment_event` | append-only history. UPDATE refused outright by trigger; DELETE/TRUNCATE go through the NX900 guard. |
| `nexus_appointment_status(p_days)` | the read path. SECURITY DEFINER, scoped by `nexus_current_tenant_ids()`, **returns zero rows for a caller with no membership** — never a default dealership. One plain-English `evidence` line per row. |
| `nexus_appointment_request / _offer_slots / _confirm / _cancel / _mark_attended` | the write path. `service_role` only — revoked from `public`, `anon` and `authenticated`. |
| `nexus_appointment_stamp_ends_at()` | trigger; recomputes `ends_at` from `starts_at + duration_minutes` on every write, overwriting whatever the caller passed. |

An appointment attaches to the customer, lead, vehicle and salesperson that **already
exist**, by four composite foreign keys that all carry `tenant_id`. It cannot invent a
parallel person and it cannot point at another dealership's records — that is a key,
not a rule somebody has to remember.

## Double booking

`appointment_no_double_booking`, an `EXCLUDE USING gist` over
`tstzrange(starts_at, ends_at, '[)')`, partial on `state = 'CONFIRMED'`, keyed on
`(tenant_id, salesperson-or-resource)`.

* **Why an exclusion and not a unique constraint.** `UNIQUE (assigned_to_id, starts_at)`
  only catches two appointments that begin on the same second. 14:00–14:45 beside
  14:30–15:15 would both be accepted and one of those customers gets stood up. Overlap
  is a range question, so the mechanism has to be a range operator.
* **Why partial on CONFIRMED.** Offering the same 16:00 to three customers is normal
  and stays legal. Two of them *agreeing* to it is what gets refused.
* **Why a constraint and not a check inside the function.** n8n and every receiver run
  as `service_role`, which carries `rolbypassrls`. A constraint is the one layer they
  cannot skip. Verified on staging by a raw INSERT that bypassed the function entirely.
* `'[)'` bounds mean back-to-back is legal: 07:00–08:00 and 08:00–09:00 for the same
  salesperson both succeed.
* **Known gap:** an appointment confirmed with *neither* a salesperson *nor* a resource
  is outside the constraint — there is nothing to double-book it against. The accessor
  reports `slot_is_protected = false` for those rows and says so in the evidence line.

## What this does NOT do

Everything below is absent on purpose, and none of it should be described as working.

1. **Nothing calls it.** No n8n workflow, no receiver, no webhook and no screen writes
   or reads an appointment. The post's word "automatically" is **not yet true**: today a
   booking only exists if somebody calls the function through `service_role` by hand.
2. **No calendar sync.** Nothing is written to Google Calendar, Outlook, or anybody's
   phone. A NEXUS booking is invisible to every other diary in the dealership until a
   human copies it across.
3. **No messages.** No confirmation, no reminder, no "your appointment is tomorrow"
   WhatsApp template, no email. `CONFIRMED` means a human recorded that the customer
   agreed — it does not mean the customer was ever written to. The messaging layer
   exists and this deliberately does not call it.
4. **No capacity or opening-hours model.** It does not know who is on shift, when the
   showroom opens, or that a Friday afternoon is a bad idea. It accepts 03:00 on a
   Saturday if somebody types it.
5. **No reschedule negotiation.** `CONFIRMED → CONFIRMED` exists as a reschedule, but
   there is no flow that asks a customer for a new time.
6. **No no-show sweep.** Nothing marks a passed appointment as `NO_SHOW` on a timer.
   Passed appointments accumulate as `awaiting_outcome = true` until a human answers,
   which is the honest behaviour and also means the list grows if nobody looks.
7. **No lead-state coupling.** Confirming an appointment does not move the lead's
   status, does not write a `journey_step`, and does not touch `lead_event`. Wiring that
   is a separate, deliberate piece of work.
8. **No attendance-rate metric anywhere.** The data now supports one; no screen shows
   one, and none should until items 1–3 exist, or it will report on a diary nobody
   is keeping.
9. **Not on production.** Applied and tested on staging only.

## Staging test results, 17 Sep 2026

Happy path (tenant A, `dd49bec9…`): `REQUESTED` 19:54:02Z via WHATSAPP → `SLOTS_OFFERED`
(3 slots) → `CONFIRMED` for 2026-09-19 03:00Z (07:00 Dubai), 60 min, ZZ Staff A,
`confirmed_slot_was_offered = true`. Three `appointment_event` rows written.

Refusals, verbatim:

* Double booking through `confirm()` — `NX995 DOUBLE_BOOKING_REFUSED: ZZ Staff A already
  has a confirmed appointment from 19 Sep 07:00 to 08:00 Dubai, which overlaps 19 Sep
  07:30 to 08:30 Dubai.`
* Double booking by raw INSERT (function bypassed) — `23P01 conflicting key value
  violates exclusion constraint "appointment_no_double_booking"`.
* Illegal transition — `NX995 TRANSITION_REFUSED: appointment … is CANCELLED, and
  CANCELLED -> CONFIRMED is not a move this machine allows.` HINT: `CANCELLED is
  terminal. Nothing follows it.`
* Attendance before the visit — `NX995 REFUSED: that appointment starts at 19 Sep 2026
  07:00 Dubai and has not happened yet. Attendance is something a person sees, not
  something a date implies.`
* Append-only — `NX995 APPEND_ONLY_REFUSED` on UPDATE of `appointment_event`.
* Delete guard — `NX900 DESTRUCTIVE_WRITE_REFUSED: public.appointment is evidence, not
  scratch.`

Isolation: tenant A member → 3 accessor rows, tenant A only. Tenant B member → 1 row,
tenant B only. Signed-in caller with no membership → **0 rows**. `anon` → `permission
denied for schema public`. Two dealerships confirmed the same wall-clock slot with no
conflict, which is correct: the exclusion is keyed on `tenant_id`.

Attendance, with real elapsed time (`2853e28d…`, tenant A): confirmed 19:55:14Z for
19:56:24Z, 5 min, bay `BAY-2`. At 20:01:51Z — after the slot had ended — the accessor
still read `state = CONFIRMED`, `counts_as_attended = false`, `awaiting_outcome = true`,
evidence *"The slot at 17 Sep 23:56 Dubai has passed and nobody has recorded whether they
turned up."* Time passing produced no attendance. A human then called it:
`nexus_appointment_mark_attended(..., true)` at 20:02:02Z → `ATTENDED`,
`counts_as_attended = true`, one new `appointment_event` row. Re-calling it as `NO_SHOW`
and cancelling it afterwards were both refused — `ATTENDED is terminal. Nothing follows it.`

Also refused: confirming a past time; cancelling with a blank reason; assigning tenant
A's appointment to tenant B's salesperson; offering a slot in the past; booking for the
quarantine tenant. Back-to-back (07:00–08:00 then 08:00–09:00, same salesperson) was
accepted, which is correct — `'[)'` bounds.

Test rows live in the synthetic `ZZ TEST TENANT A/B` tenants on staging and were left in
place as evidence; they cannot be deleted anyway (NX900 guard).
