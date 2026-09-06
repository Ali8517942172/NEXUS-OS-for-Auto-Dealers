# 03 — `communication_logs` writers must send `external_message_id` — **NOT DEPLOYED**

**Measured today, production `dsvuoovivysszdoiorch`:**

```
select count(*) from public.communication_logs                                  -> 114
select count(*) from public.communication_logs where external_message_id is not null -> 0
```

**0 of 114.** The database half is applied (migrations `20260905204047` /
`20260905204353`); the writer half is not. Until it is, a retried or redelivered
POST still creates a second row for one real communication.

Verified against the live published definitions, not the 30 August export:

| workflow | node | live body sends `external_message_id`? |
|---|---|---|
| `BiyHk9ZXxJUVGbf6` WhatsApp BDC | `Log Incoming Message` | **no** |
| `BiyHk9ZXxJUVGbf6` WhatsApp BDC | `Log Conversation` | **no** |
| `yx6m55p1Kj8V7koR` WhatsApp Send | `Log Outbound` | **no** |

---

## What the database will now refuse — **and the two CHECKs are NOT the same**

`communication_logs_external_message_id_is_a_provider_id`, read from
`pg_constraint` today:

```sql
CHECK ( external_message_id IS NULL
     OR ( external_message_id !~ '[[:space:]]'
      AND length(external_message_id) BETWEEN 8 AND 512
      AND external_message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'
      AND external_message_id !~ '^[0-9]{10}$'
      AND external_message_id !~ '^[0-9]{13}$' ) )
```

Compare `processed_messages`, `whatsapp_customer_message_seen`,
`channel_message_events` and `whatsapp_delivery_events`, which all use:

```sql
... AND <col> !~ '^[0-9]+$'      -- ALL digits, any length
```

**`communication_logs` bans only bare 10- and 13-digit epochs; the other four ban
every all-digit string.** A 12-digit id is accepted by `communication_logs` and
refused by the rest. Use the stricter rule everywhere so one helper is correct on
all five tables and nobody has to remember which is which.

### The shared guard — use this, not the looser one in the source note

```js
const clean = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!s || /\s/.test(s) || s.length < 8 || s.length > 300) return null;
  if (/^(nokey:|outreach:|exec-|run-|job-)/i.test(s)) return null;
  if (/^[0-9]+$/.test(s)) return null;          // stricter than communication_logs
  return s;
};
```

(300, not 512: `channel_message_events` and `whatsapp_delivery_events` cap at 300,
`communication_logs` at 512. The tighter bound is safe on all of them.)

## The unique index it feeds — confirmed live

```
communication_logs_external_identity_key
  UNIQUE (tenant_id, channel_key, direction_key, external_message_id)
```

`channel_key` and `direction_key` are **`GENERATED ALWAYS … STORED`**:

```
channel_key    = lower(btrim(coalesce(channel,   '')))
direction_key  = lower(btrim(coalesce(direction, '')))
```

`external_message_id` is nullable, so the 114 existing NULL rows do not collide
and no backfill is required.

---

## Node 1 — `BiyHk9ZXxJUVGbf6` → `Log Incoming Message`

Live node: `retryOnFail: true`, `maxTries: 3`, `onError: continueRegularOutput`,
`Prefer: return=minimal`. This is the retrying writer named in `CLAUDE.md` as the
cause of the ~12% duplicate inbound rows.

**The trap, re-confirmed against the live `jsCode` today:** `$json` at this node
does **not** carry the message id. `Extract Message & Sender` emits `message_id`
(line ~143), but `Resolve Lead Identity` builds a **fresh object** whose returned
keys are `lead_email … tenant_id` and **do not include `message_id`**;
`Skip Duplicate Outreach` passes that object through. The id must be reached for
by node name.

**Before** (`parameters.jsonBody`, verbatim, live):

```
={{ JSON.stringify(Object.assign({ lead_email: $json.lead_email || $json.sender, channel: 'whatsapp', direction: ($json.direction === 'outbound' ? 'outbound' : 'inbound'), message: ($json.direction === 'outbound' ? '[system] Initial outreach requested by the Master Router' : $json.message), sent_by: ($json.direction === 'outbound' ? 'bot' : null) }, $json.tenant_id ? { tenant_id: $json.tenant_id } : {})) }}
```

**After:**

```
={{ (() => {
  const clean = (v) => { const s = String(v == null ? '' : v).trim();
    if (!s || /\s/.test(s) || s.length < 8 || s.length > 300) return null;
    if (/^(nokey:|outreach:|exec-|run-|job-)/i.test(s)) return null;
    if (/^[0-9]+$/.test(s)) return null;
    return s; };
  const ex = $('Extract Message & Sender').first().json || {};
  const outbound = $json.direction === 'outbound';
  const body = {
    lead_email: $json.lead_email || $json.sender,
    channel: 'whatsapp',
    direction: outbound ? 'outbound' : 'inbound',
    message: outbound ? '[system] Initial outreach requested by the Master Router' : $json.message,
    sent_by: outbound ? 'bot' : null,
    external_message_id: outbound ? null : clean(ex.message_id)
  };
  return JSON.stringify($json.tenant_id ? Object.assign(body, { tenant_id: $json.tenant_id }) : body);
})() }}
```

Two deliberate choices:

- **`outbound ? null`.** On the `Called by Master Router` outreach branch,
  `Extract Message & Sender` sets
  `message_id: 'outreach:' + Date.now() + '-' + Math.random().toString(36).slice(2,10)`
  — read from the live node today. That is a per-execution value and exactly what
  the CHECK refuses. `clean()` would strip it anyway; the ternary makes the intent
  legible. That row genuinely has no provider id in either direction.
- **`tenant_id` stays conditional**, exactly as today. Do not make it
  unconditional: an `undefined` would be serialised out by `JSON.stringify`
  anyway, but the existing shape is what the tenancy wave verified.

### The `from + ':' + timestamp` fallback is safe — and I measured why

`Extract Message & Sender` falls back to `from + ':' + payload.timestamp` when
WAHA omits `payload.id`, and to `''` when there is no timestamp either.
The `''` becomes `null` via `clean()`. The first form is **stable across
redeliveries of one message**, which matters because it is the value that would
be indexed. Measured on live pairs today: executions 10312 (`2.50.10.149`) and
10313 (the box) carry different `x-webhook-timestamp` (1788658872760 vs
1788658832362) but **the same `payload.timestamp` (1788658830)**; 10314/10315
likewise share `payload.timestamp` 1788658866. `payload.timestamp` is the
WhatsApp message time, not the delivery time. The fallback also passes the CHECK:
it contains `@` and `:` so it is not all-digits, and it is well over 8 characters.

## Node 2 — `BiyHk9ZXxJUVGbf6` → `Log Conversation` (outbound bot reply)

Live node: `retryOnFail: true`, `maxTries: 3`, `onError: continueRegularOutput`.
`$json` here is the response from `Send Reply via WAHA HTTP API`.

**Before** (verbatim, live):

```
={{ JSON.stringify(Object.assign({ lead_email: $('Resolve Lead Identity').first().json.lead_email || $('Resolve Lead Identity').first().json.sender, channel: 'whatsapp', direction: 'outbound', message: $('Guard Reply').first().json.output || '(no AI output)', sent_by: 'bot' }, $('Resolve Lead Identity').first().json.tenant_id ? { tenant_id: $('Resolve Lead Identity').first().json.tenant_id } : {})) }}
```

**After:**

```
={{ (() => {
  const clean = (v) => { const s = String(v == null ? '' : v).trim();
    if (!s || /\s/.test(s) || s.length < 8 || s.length > 300) return null;
    if (/^(nokey:|outreach:|exec-|run-|job-)/i.test(s)) return null;
    if (/^[0-9]+$/.test(s)) return null;
    return s; };
  const r = $json || {};
  const sent = clean(
    (r.id && typeof r.id === 'object' ? (r.id._serialized || r.id.id) : r.id) ||
    (r._data && r._data.id && (r._data.id._serialized || r._data.id.id)) ||
    r.messageId || (r.key && r.key.id)
  );
  const ident = $('Resolve Lead Identity').first().json || {};
  const body = {
    lead_email: ident.lead_email || ident.sender,
    channel: 'whatsapp',
    direction: 'outbound',
    message: $('Guard Reply').first().json.output || '(no AI output)',
    sent_by: 'bot',
    external_message_id: sent
  };
  return JSON.stringify(ident.tenant_id ? Object.assign(body, { tenant_id: ident.tenant_id }) : body);
})() }}
```

> **STILL UNVERIFIED, AND I COULD NOT VERIFY IT TODAY EITHER.** The exact shape of
> the WAHA `POST /api/sendText` response has **not been observed on this box**.
> I looked: `yx6m55p1Kj8V7koR` has **zero** retained executions, and every one of
> the 102 WhatsApp BDC executions in the last 9 hours stopped at
> `Is Real Inbound?` (all group / broadcast / newsletter traffic), so
> `Send Reply via WAHA HTTP API` did not run in any retained execution I could
> reach. The four shapes above are the ones WAHA/GOWS builds are known to use.
> **At deploy: run one real send, open the execution, read the
> `Send Reply via WAHA HTTP API` output, and add the actual path if it is not one
> of the four. If it lands on `null` for every send, say so — an outbound writer
> that always sends `null` has not been fixed, only made honest.**
> The engine on this box reports `"engine":"GOWS"` (read from
> `body.environment.engine` on live traffic), which narrows it but does not settle it.

## Node 3 — `yx6m55p1Kj8V7koR` → `Log Outbound` (human reply from the dashboard)

Live node: `retryOnFail: true`, `maxTries: 3`, `onError: continueRegularOutput`,
`alwaysOutputData: true`. `$json` is the `Send via WAHA` response.

**Before** (verbatim, live):

```
={{ JSON.stringify(Object.assign({ lead_email: $('Prepare Send').first().json.chat_id, channel: 'whatsapp', direction: 'outbound', message: $('Prepare Send').first().json.text, sent_by: String($('Prepare Send').first().json.sent_by || 'dashboard').trim().toLowerCase() }, $('Prepare Send').first().json.tenant_id ? { tenant_id: $('Prepare Send').first().json.tenant_id } : {})) }}
```

**After:** identical `clean()` + `sent` extraction as Node 2, with this body:

```
    lead_email: $('Prepare Send').first().json.chat_id,
    channel: 'whatsapp',
    direction: 'outbound',
    message: $('Prepare Send').first().json.text,
    sent_by: String($('Prepare Send').first().json.sent_by || 'dashboard').trim().toLowerCase(),
    external_message_id: sent
```

A human typing in the dashboard is not replying to any particular inbound
message, so "put the id of the inbound message being replied to" cannot work
here. The rule that works in both directions and both workflows is **the
provider's id for the message this row records**.

## Step 3 (optional) — make the write idempotent instead of merely refused

- URL query parameter: `on_conflict=tenant_id,channel_key,direction_key,external_message_id`
- Header: `Prefer: return=minimal,resolution=ignore-duplicates`

> **UNPROVEN, AND STILL UNPROVEN AFTER TODAY.** The SQL form
> `ON CONFLICT (tenant_id, channel_key, direction_key, external_message_id) DO NOTHING`
> is proved on both projects. What is **not** proved is PostgREST's translation of
> `on_conflict=` when two of the named columns are `GENERATED ALWAYS … STORED`.
> Testing it requires a POST, and this pass was read-only on both the box and the
> database, so I did not test it. **Test it with one POST against staging
> (`wwspuxrbiyagnrnzgate`) before production.**
>
> **If it fails, ship steps 1 and 2 anyway and drop step 3.** Without
> `on_conflict` the duplicate raises `23505` and PostgREST returns **409** — the
> second row is still refused, so the defect is still closed. `on_conflict` only
> makes the refusal quiet. Note that `retryOnFail: true` will retry that 409 up to
> `maxTries` before `onError: continueRegularOutput` lets the run proceed; that is
> noise in the execution log, not lost data.

## The eight writers deliberately left sending nothing

Unchanged from the source note, and re-confirmed for the one I could check:
`B3TcpfzOMWj8oWgF` → `Mark as Escalated` writes `channel:'system',
direction:'internal'` — an internal escalation note with **no provider leg at
all**. Correct for it to send nothing, permanently. (Its workflow is also
unpublished — see file 08.) The seven Gmail/WhatsApp/KYC writers stay `null`
because their response shapes were not observed; forcing a value would mean
inventing one. Leaving them null is the reason the column stayed nullable.

**Cheapest remaining win, not done here:** thread the Gmail node's response `id`
into the three drip email writers in `G7FhvMY2ucW5Fg7X`. That is a real provider id.

## What breaks if applied out of order

- **Before 04:** fine, and this is the required order. 04 changes which items reach
  the logging nodes; making the writer honest first means 04's effect is visible
  in the data rather than inferred.
- **After 04:** you spend 04's blast radius without gaining the witness that shows
  whether it worked.
- **Relative to 07:** independent. Do this while the gate is still dormant — it
  needs live traffic to be verifiable, and the traffic must not be interrupted.

## Verify

See `VERIFY.md` §03. **`communication_logs.external_message_id` going from 0
non-null to non-zero is the real witness.** Nothing else counts.

## Roll back (under a minute)

Paste the three "Before" bodies back and republish. The column is nullable, the
unique index ignores NULLs, and no row written under the new bodies needs
deleting.
