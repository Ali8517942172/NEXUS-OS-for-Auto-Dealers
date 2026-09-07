# The open door on `/webhook/whatsapp-inbound`, and how to close it without losing a customer

**Status, 7 September 2026: still open.** `WAHA_WEBHOOK_SECRET` is unset on the
VM, so `WAHA Auth Gate` is `DORMANT` and every caller passes.

This is not theoretical any more. **Lead 122 — a real person, a real UAE phone
number — entered production through this door at 14:05 UTC today.**

## What is actually calling it, measured today

29 executions sampled across 04:40 → 14:48 UTC on 7 September, headers read from
the saved webhook item on every one.

| | |
|---|---|
| distinct `user-agent` | **1** — `WAHA/2026.7.2`, 29/29 |
| distinct `session` | **1** — `default`, 29/29 |
| distinct `me.jid` | **1** — `971526647253:12@s.whatsapp.net`, 29/29 |
| distinct `x-forwarded-for` | **1** — `35.224.126.225`, 29/29 |
| requests carrying `x-nexus-webhook-secret` | **0 of 29** |
| pairs sharing a `payload.id` | **0** |

Two things follow, and they point in opposite directions.

**The second WAHA really is gone.** Zero duplicate `payload.id`, one build, one
device index. The 3–6 September doubling is over, which retires the "execution
count is roughly double the truth" caveat for traffic after 6 September.

**And that makes enforcement more dangerous, not less.** With two senders, a
premature `WAHA_WEBHOOK_ENFORCE=true` cut off whichever one lacked the header and
the other carried on — survivable and visible. With one sender and the header
absent on 29 of 29 requests, the same mistake drops **100% of a dealership's
inbound WhatsApp**, silently, and the only symptom is that the bot stops
replying.

> `x-forwarded-for` is the box's own address because WAHA runs on that box and
> reaches n8n through the public hostname. It distinguished the two senders in
> September only because the second one was genuinely external. Do not read it
> as a per-sender identifier in general.

## The gate itself is correct, and that is now proven rather than assumed

`node ops/n8n-waha-gate/gate.test.js` — **24 assertions, all passing** — runs the
deployed node body against a faked `$env`. n8n's `test_workflow` cannot do this:
it reads the box's real environment, so it can only ever reproduce the state the
box is already in, which is the one state that needs no proving.

| state | env | behaviour |
|---|---|---|
| **DORMANT** | secret unset | everything passes. The rollback, and today's state. |
| **MONITOR** | secret set, enforce ≠ `true` | everything passes, tagged, so the header can be confirmed on real traffic first |
| **ENFORCE** | secret set, enforce = `true` | only a matching header survives |
| **misconfigured** | enforce = `true`, secret **unset or empty** | **everything is dropped** — fails closed |

That last row is the one worth having: an operator who typo'd the variable name
has explicitly asked for enforcement, and passing everything would leave the
endpoint open, held open by the setting meant to close it.

Measured, not preferred: `TRUE`, `True` and ` true ` all enforce (the node
trims and lower-cases); `1`, `yes` and `on` do not.

Also pinned, because "we added a secret" is often heard as "and duplicates are
handled": **the gate is not a dedupe.** The same authenticated request replayed
five times passes five times. Redelivery is absorbed by the claim on
`processed_messages`, which is a different control — see below.

## The claim gate has a fail-open, and an unauthenticated caller can reach it

`Claim Message Id` POSTs to `processed_messages` with
`Prefer: resolution=ignore-duplicates,return=representation`, and `Is New
Message?` continues when `message_id` **OR** `error` is present.

| outcome | what PostgREST returns | routed |
|---|---|---|
| new message | the inserted row | continue — correct |
| duplicate | `[]` (ignore-duplicates) | stop — correct, this is the dedupe |
| **insert refused** | 400, swallowed by `onError: continueRegularOutput` | **continue** |

The third row is a deliberate fail-open — losing a real customer's message is
worse than processing one twice — and it should be *stated*, because it
currently reads as an accident.

**Corrected after measuring `Prefilter`, which the first version of this note
had not read.** Prefilter already computes a stable fallback:

```
message_id = payload.id  ??  (payload.from + ':' + payload.timestamp)
```

So omitting `payload.id` alone does **not** reach the `nokey:` branch — it
produces `971…@c.us:1788…`, which satisfies the CHECK and dedupes correctly. The
earlier claim here that "a caller who simply omits `payload.id` bypasses the
claim entirely" was wrong, and it was wrong in the direction that overstates a
finding.

The reachable shape is narrower: a body carrying **neither `payload.id` nor
`payload.timestamp`**. Then `message_id` is empty, `Claim Message Id` mints
`'nokey:' + $now.toMillis()`, and since 5 September a CHECK refuses exactly that:

```
processed_messages_message_id_is_a_provider_id
  message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'  -- plus: no whitespace,
                                                       -- ≥8 chars, not all digits
```

The insert fails, `onError: continueRegularOutput` swallows it, `!!$json.error`
fires the second branch, and the message reaches the full downstream chain
unclaimed — including the WhatsApp send to a number the caller chooses. On the
open door that is free.

**How live this is: latent, not active.** `processed_messages` holds **zero**
`nokey:` rows, real WAHA payloads always carry `payload.id`, and the outreach
path has never fired. Nothing has gone through this. It is an attack path that
exists because the door is open, not a malfunction.

**Closed 7 September 2026, and not by minting a better fake id.** A body with no
id and no timestamp carries *nothing stable to key on*, so any id invented for it
is a lie — a second delivery of the same message would mint a different one and
be processed again. `Prefilter`'s `is_real_inbound` now also requires that the
payload carry an id or a timestamp, so such a body is treated as what it is: not
a real inbound message. The flow stops before the claim rather than reaching it
with an unusable identity.

**The fail-open on `error` is deliberately left in place**, and that is a
judgement rather than an oversight: with the id-less case stopped earlier, an
error at the claim now means the database is genuinely unreachable, and losing a
real customer's message to a transient outage is worse than processing one twice.
That trade is now *stated*; before, it read as an accident.

## The order, and it is not advice

1. **`WAHA_WEBHOOK_SECRET=<long random string>` on the VM. Nothing else. Restart n8n.**
   The gate is now MONITOR. Nothing is dropped. Verify: any new execution's
   `WAHA Auth Gate` output shows `_gate.mode = "MONITOR"`.
2. **Configure the WAHA session to send `x-nexus-webhook-secret` with that
   value** on its webhook to `/webhook/whatsapp-inbound`.
3. **Confirm on a genuine 1:1 message** — not a group, not a broadcast — that
   `_gate.header_present` and `_gate.ok` are both `true`. The 7 September sample
   contained **zero** genuine customer conversations (all groups, broadcasts and
   newsletters on Ali's personal handset), so this step needs one to be sent on
   purpose.
4. **Only then `WAHA_WEBHOOK_ENFORCE=true`.** Restart. Send one more real message
   and confirm it still arrives.

**Rollback, ~10 seconds, no restart:** open the workflow, disable the
`WAHA Auth Gate` node, save. A disabled node passes its input straight through.

**What this does not buy.** The webhook responds `onReceived`, so the HTTP 200 is
already on the wire before the gate runs — an unauthorised caller still gets a
200. What enforcement buys is that *nothing happens*: no WhatsApp send, no model
call, no database write. Do not describe it as returning 401, and do not expect
WAHA to notice a misconfiguration and back off, because WAHA sees 200 either way.

**And the other entrance is unchanged.** `Called by Master Router`
(`executeWorkflowTrigger` → `Extract Message & Sender`) does not pass through the
gate. That is by design — it is an internal call, not a public one — but it means
the gate secures *the public path*, not *the workflow*.

## Preserve Lead 122

It is real external-origin evidence that production ingestion happened, and it is
the reason this door is a P0 rather than a note. It carries
`source = nexus-master-router` — the writer, not the origin — which is separately
the thing the lead-ingestion layer exists to fix. **Do not delete it.**
