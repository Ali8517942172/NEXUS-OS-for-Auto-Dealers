# `Prefilter` — the four fields everything downstream keys on

Read from the **published** definition of workflow `BiyHk9ZXxJUVGbf6` after the
7 September 2026 change, version `5a594564-2e77-4deb-9306-3e544b542284`. It lives
here because the repo's `n8n-workflows/*.json` is a 30 August export and this
node has changed twice since.

`Prefilter` is a Set node in assignments mode with `includeOtherFields` off, so
these four fields are the *entire* item from here on. Anything not listed is
gone — which is why `_gate` from the auth gate never travels further, and why a
mistake in one of these four is a mistake in the whole downstream chain.

```js
// message_id  — the only identifier stable across redeliveries of one message.
// body.id (evt_…) and x-webhook-request-id are DELIVERY ids and change on every
// retry; payload.id does not. The fallback is not decoration: WAHA can deliver a
// message with no payload.id, and from+timestamp is stable across a redelivery
// where a clock reading would not be.
String($json.body?.payload?.id
  ?? ($json.body?.payload?.timestamp
        ? ($json.body?.payload?.from ?? '') + ':' + $json.body.payload.timestamp
        : ''))

// sender
String($json.body?.payload?.from ?? '')

// direction
'inbound'

// is_real_inbound
$json.body?.payload?.fromMe !== true
  && (!$json.body?.event || $json.body.event === 'message')
  && !!($json.body?.payload?.from)
  && !String($json.body.payload.from).endsWith('@g.us')
  && !String($json.body.payload.from).startsWith('status@')
  && !String($json.body.payload.from).endsWith('@newsletter')
  && (!!$json.body?.payload?.id || !!$json.body?.payload?.timestamp)   // added 7 Sep 2026
```

## The clause added on 7 September, and what it closes

`Is Real Inbound?` sends its TRUE branch to `Claim Message Id`, which is the only
thing that stops a redelivery being processed twice. That node POSTs to
`processed_messages` with
`Prefer: resolution=ignore-duplicates,return=representation`, and `Is New
Message?` continues when `message_id` **or** `error` is present:

| outcome | PostgREST returns | routed |
|---|---|---|
| new message | the inserted row | continue — correct |
| duplicate | `[]` | stop — correct, this is the dedupe |
| **insert refused** | 400, swallowed by `onError: continueRegularOutput` | **continue** |

The third row is a deliberate fail-open — losing a real customer's message is
worse than processing one twice — and until today it was reachable on purpose by
anyone who could reach the webhook. A body with **neither `payload.id` nor
`payload.timestamp`** left `message_id` empty; `Claim Message Id` then minted
`'nokey:' + $now.toMillis()`; the 5 September CHECK
(`message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'`) refused it; the error
fired the second branch; and the message ran the full chain **unclaimed** —
including the WhatsApp send to a number the caller chooses.

**It is closed by refusing the message, not by minting a better id.** A body with
nothing stable to key on has nothing that survives a redelivery, so any id
invented for it is a lie that would let the same message be processed again on
the next delivery. A message with no identity is not a real inbound message, and
that is now what the expression says.

**The fail-open on `error` is left in place, and that is a judgement.** With this
case stopped earlier, an error at the claim now means the database is genuinely
unreachable, and dropping a real customer's message over a transient outage is
the worse failure. Stated here rather than left to read as an accident.

## Proved before publishing, then verified on the box

`test_workflow` with the trigger pinned. All three of the first batch were
expected to stop at `Is Real Inbound?`, so **nothing downstream ran** — the TRUE
branch came back empty.

| item | `message_id` | `is_real_inbound` |
|---|---|---|
| group chat, has an id | `false_120363@g.us_ABC123` | `false` — the group rule, unchanged |
| 1:1, **no id and no timestamp** | `""` | **`false`** — the new clause. Before today this was `true` |
| 1:1, no id, **has a timestamp** | `971500000003@c.us:1788790123` | `false` (fromMe) — and the fallback computed correctly |

**Positive control, separately** — because three items designed to be refused
prove nothing about the path that must still work. An ordinary 1:1 customer
message with an id: `is_real_inbound = true`, routed to the TRUE branch, reached
`Claim Message Id`. Real traffic is unaffected.

Then the published version was fetched back and read, per the house rule: the new
clause is present, `message_id` is byte-identical to before, and the
`WAHA Auth Gate` body is untouched.

## What this does NOT do

It is not authentication. Every legitimate request today still arrives with **no**
`x-nexus-webhook-secret` (29 of 29 sampled), the door is still open, and the gate
is still `DORMANT`. This change removes one way of getting past the *dedup*
control; the way past the *front door* is still open and closing it needs the VM.
See `README.md` in this directory for that sequence.
