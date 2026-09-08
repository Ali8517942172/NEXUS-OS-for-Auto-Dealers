# `Claim Message Id` mints an identity per attempt — required change — **NOT DEPLOYED**

**Status: NOT DEPLOYED. The duplicate-reply defect is NOT closed.**

The database half is applied to staging and production
(`20260905211409_processed_messages_message_id_must_be_a_provider_id`, identical
md5 on both) and proved adversarially: `processed_messages` now refuses a minted
id with SQLSTATE 23514.

**What that does and does not buy.** It stops the table accumulating false
idempotency claims, and it makes the run report the failure instead of claiming
success. **It does not stop the duplicate reply**, because the node is fail-open:
see below. Only the node change closes that.

---

## The defect, measured

`whatsapp_bdc_ai_agent.json:713` (repo export, 30 August — a floor, not a census;
that export contains zero occurrences of `tenant_id` although the live box
demonstrably stamps one, so the published definition may differ and must be read
from the box before editing):

```
message_id: ($json.message_id || ('nokey:' + $now.toMillis()))
```

`processed_messages` exists to answer "have I already answered this message?".
Its key is `(tenant_id, message_id)`. `$now.toMillis()` changes on every attempt,
so on a redelivery or an n8n retry of one real customer message:

| attempt | id posted | insert | `Is New Message?` | outcome |
|---|---|---|---|---|
| 1 | `nokey:1757083200000` | 201 | TRUE | AI replies |
| 2 | `nokey:1757083200461` | 201 | TRUE | **AI replies again** |

A message that genuinely carries an id is deduped correctly — the node sends
`Prefer: resolution=ignore-duplicates,return=representation`, so a duplicate
returns an empty body, `$json.message_id` is undefined, `Is New Message?` is
FALSE and no reply is sent. **Only the `nokey:` branch is broken.**

**The branch has never fired in production.** All 73 live rows carry a real WAHA
id (shortest 44 characters); `nokey_rows = 0`. So this is a latent defect on a
live path, not a live incident — and adding the constraint broke nothing.

## Why the constraint alone does not close it

`Claim Message Id` is `onError: continueRegularOutput`, `alwaysOutputData: true`,
and `Is New Message?` is an **OR** of `!!$json.message_id` and `!!$json.error`.
So an error from the claim reads as "new message, go ahead and reply". After the
constraint the sequence is 400 → `$json.error` truthy → TRUE → reply. Same
customer-visible outcome, now reported as PARTIAL by `Verify Delivery` rather
than silently claimed as SUCCESS.

That fail-open is a defensible availability choice for a *transport* failure. It
is the wrong answer for a *refused identity*, which is not a transient error.

---

## The change

Read the **published** definition from the box first; do not re-import the repo
export, which would revert the tenant work. One agent on the box at a time.
n8n edits stay in draft until published — verify by fetching the published
version back, not against your draft.

### 1. `Claim Message Id` — stop minting

```
message_id: $json.message_id
```

with no fallback. If the provider gave no id, do not post at all — route that
item past the claim. The database will refuse a minted id either way; the point
of the node change is that NEXUS stops asking.

### 2. `Is New Message?` — an error is not a licence to reply

Replace the OR condition `!!$json.error` with a rule that distinguishes the two
error kinds:

- a **transport/timeout** error (no HTTP status, or 5xx): treat as today, reply,
  and let `Verify Delivery` report PARTIAL. Availability wins; the worst case is
  one duplicate.
- a **400 with `SQLSTATE 23514`** (`processed_messages_message_id_is_a_provider_id`):
  **do not reply**. NEXUS cannot tell whether it has already answered this
  message, and answering twice is worse than answering late.

### 3. `Verify Delivery` — name the reason

`Claim Message Id` is already in `CLAIMED` as non-critical. Leave it non-critical,
but make the dropped-reason text carry the SQLSTATE so the operator sees
"identity refused" rather than a generic HTTP error.

## How to verify after publishing

1. Fetch the published version back and confirm line 713 has no `nokey:`.
2. Send one WhatsApp message with a normal id; confirm exactly one
   `processed_messages` row and one reply.
3. Replay the same webhook body; confirm **no** second row and **no** second reply.
4. Confirm `select count(*) from processed_messages where message_id like 'nokey:%'`
   is still 0.

Until steps 1–4 are done and recorded, this defect stays **open**.
