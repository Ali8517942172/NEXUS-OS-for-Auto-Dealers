# Starting a journey — the five-minute version

Read `README.md` (the full plan) first. This page is the checklist you actually follow.

## Before you touch anything

1. **Health + zombie check.** `cd /tmp && python3 nexus_healthcheck.py` — and separately,
   because the public API does not list `running` and the old queued check missed `new`:

   ```sql
   select status, count(*), min("createdAt"), max("createdAt")
   from execution_entity group by 1 order by 2 desc;
   ```

   Any execution `running` longer than its workflow's timeout is a permanently lost
   concurrency slot. The limit is 5. Five of those and the whole instance is frozen —
   that is what happened on 28 Aug and cost 23 hours. Stop them before starting:
   `POST /api/v1/executions/{id}/stop` (works on `new` as well as `running`).

2. **Confirm the previous journey was torn down.** `select * from leads;` should show
   nothing for `shabbir53ujjainwala@gmail.com`. If it does, the last teardown did not run
   and journey N+1's results will be contaminated by journey N.

3. **Record the watermark** into `docs/journeys/J<N>/00_watermark.json`:
   `max(execution_entity.id)` on nexus-vm, and `now()` from Supabase.

## While it runs

- **Ali sends every customer message himself, from his phone.** The agent cannot
  originate WhatsApp or email — that is deliberate, not a bug to route around.
- **≥ 20 seconds between messages.** WAHA re-delivers; a burst is what built the
  328-execution queue on 28 Aug.
- **One journey at a time. Never parallel agents against n8n / Supabase / WAHA.**
- After each step, read the workflow's `Delivery Report` output — not the green tick.
  Since 26 Aug every terminal node reports what it actually verified. A run can be green
  and still have dropped the message.

## When it ends

1. **Archive before delete.** Dump every table listed in Part 2.2 to `J<N>/`, plus the
   n8n executions above the watermark *with node run data*. Teardown destroys the
   evidence; the archive is the only thing that lets you compare J3 against J8 later.
2. **Teardown in the order given in Part 2.3.** `leads` goes last — the WhatsApp and KYC
   rows are keyed on its email, and deleting it first orphans them silently.
3. **Delete the Storage objects** under `kyc-documents/` for this customer, or J10's
   archive-gap alert fires on ghosts.
4. **Put the inventory unit back** to `Available`.
5. **Zombie check again.** Leaving one behind poisons the next journey.
6. Write `99_RESULT.md`: what passed, what failed, and — most important — anything that
   *looked* like it passed but whose Delivery Report said `PARTIAL`.

## At the very end of all ten

Restore the shortened clocks (Part 1, P5). A 7-day drip left at 2 minutes is a spam
cannon pointed at real customers.
