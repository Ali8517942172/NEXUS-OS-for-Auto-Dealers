# 04 — `Claim Message Id` mints an identity per attempt — **NOT DEPLOYED**

**Confirmed against the live published definition today**, not against the stale
30 August export. The source note cited `whatsapp_bdc_ai_agent.json:713` and
warned that the export "may differ". It does differ — the export contains zero
occurrences of `tenant_id` while the live node stamps one — **but the `nokey:`
expression is present on the box, unchanged.**

| | |
|---|---|
| workflow | `BiyHk9ZXxJUVGbf6` — WhatsApp BDC AI Agent (`active: true`, `versionId == activeVersionId == e09df9f0-c146-4b59-a19b-16545d3ac50d`) |
| nodes | `Claim Message Id`, `Is New Message?`, `Delivery Report` |

Live `Claim Message Id`: `alwaysOutputData: true`, `onError: continueRegularOutput`,
`retryOnFail: null`, `Prefer: resolution=ignore-duplicates,return=representation`,
`options.timeout: 10000`.

**Live `parameters.jsonBody`, verbatim:**

```
={{ JSON.stringify(Object.assign({ message_id: ($json.message_id || ('nokey:' + $now.toMillis())), source: ($json.direction === 'outbound' ? 'outreach' : 'waha'), chat_id: $json.sender }, $json.tenant_id ? { tenant_id: $json.tenant_id } : {})) }}
```

## The defect

`processed_messages` answers "have I already replied to this message?". Its key is
`PRIMARY KEY (tenant_id, message_id)`. `$now.toMillis()` changes on every attempt:

| attempt | id posted | insert | `Is New Message?` | outcome |
|---|---|---|---|---|
| 1 | `nokey:1757083200000` | 201 | TRUE | AI replies |
| 2 | `nokey:1757083200461` | 201 | TRUE | **AI replies again** |

A message that carries a real id is deduped correctly — the `Prefer` header makes
a duplicate return an empty body, `$json.message_id` is undefined,
`Is New Message?` is FALSE, no reply. **Only the `nokey:` branch is broken.**

**Still latent, re-measured today:**

```
select count(*) from public.processed_messages                          -> 73
select count(*) from public.processed_messages where message_id like 'nokey:%' -> 0
```

Zero `nokey:` rows have ever been written. This is a latent defect on a live path,
not a live incident.

## Why the constraint alone does not close it

`processed_messages_message_id_is_a_provider_id`, read live:

```sql
CHECK ( message_id !~ '[[:space:]]'
    AND length(message_id) >= 8
    AND message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'
    AND message_id !~ '^[0-9]+$' )
```

So a `nokey:` post is now refused with **SQLSTATE 23514**. But the node is
fail-open: `onError: continueRegularOutput` + `alwaysOutputData: true`, and
`Is New Message?` is an **OR** (live, verbatim) of

```
{{ !!$json.message_id }}   OR   {{ !!$json.error }}
```

so an error from the claim reads as "new message, go ahead". After the constraint
the sequence is 400 → `$json.error` truthy → TRUE → **reply anyway**. Same
customer-visible outcome; it is merely reported as PARTIAL by `Verify Delivery`
instead of silently claimed as SUCCESS.

That fail-open is a defensible availability choice for a **transport** failure. It
is the wrong answer for a **refused identity**, which is not transient.

---

## The change

### 4.1 `Claim Message Id` — stop minting

**Before:**

```
message_id: ($json.message_id || ('nokey:' + $now.toMillis()))
```

**After:**

```
message_id: $json.message_id
```

Full replacement body:

```
={{ JSON.stringify(Object.assign({ message_id: $json.message_id, source: ($json.direction === 'outbound' ? 'outreach' : 'waha'), chat_id: $json.sender }, $json.tenant_id ? { tenant_id: $json.tenant_id } : {})) }}
```

If the provider gave no id, do not post at all — route that item past the claim.
The database refuses a minted id either way; the point of the node change is that
**NEXUS stops asking**.

> Note the `source` field already distinguishes the outreach branch, and on that
> branch `Extract Message & Sender` supplies
> `'outreach:' + Date.now() + '-' + random` as `message_id`. That is also refused
> by the same CHECK (`^outreach:`). The outreach branch must therefore route past
> the claim too. **This is the one part of this change that alters the outreach
> path, and `CLAUDE.md` records that zero `'[system] Initial outreach…'` rows have
> ever existed in `communication_logs`, so that path has never fired in
> production.** Do not let that reassurance become "so it does not matter" — it
> means the change is untested there, not that it is safe there.

### 4.2 `Is New Message?` — an error is not a licence to reply

Replace the second OR condition `{{ !!$json.error }}` with a rule that separates
the two error kinds:

- **transport / timeout** (no HTTP status, or 5xx): behave as today — reply, and
  let `Verify Delivery` report PARTIAL. Availability wins; worst case is one
  duplicate.
- **400 carrying `23514`** (`processed_messages_message_id_is_a_provider_id`):
  **do not reply.** NEXUS cannot tell whether it has already answered, and
  answering twice is worse than answering late.

Condition expression for the second branch:

```
={{ (() => {
  const e = $json.error;
  if (!e) return false;                       // no error -> this branch is not the reason
  const s = Number(e.status || e.statusCode || 0);
  const t = JSON.stringify(e);
  if (s === 400 && /23514|processed_messages_message_id_is_a_provider_id/.test(t)) return false;
  return true;                                // transport / 5xx -> reply as today
})() }}
```

### 4.3 `Delivery Report` — name the reason

`Claim Message Id` is already listed in `CLAIMED` as non-critical. Leave it
non-critical, but make the dropped-reason text carry the SQLSTATE so the operator
reads "identity refused" rather than a generic HTTP error.

## What breaks if applied out of order

- **Do 03 first.** 03 makes `communication_logs` carry the provider id, which is
  the only way to see afterwards whether a message was answered once or twice.
  Applying 04 first leaves you judging a reply-suppression change from execution
  screenshots.
- **Do not do this after 07 (the gate).** During the gate rollout you want exactly
  one variable moving on the WhatsApp path. This one changes when the bot declines
  to reply; that is precisely the symptom an armed gate also produces, and you
  will not be able to tell them apart.

## Verify

See `VERIFY.md` §04.

## Roll back (under a minute)

Restore the `($json.message_id || ('nokey:' + $now.toMillis()))` body and the
plain `{{ !!$json.error }}` condition, and republish. No data written under the
new version needs undoing — the change only ever *suppresses* a write.
