# communication_logs writers — required change — **NOT DEPLOYED**

**Status: NOT DEPLOYED. The defect is NOT closed.**

The database side is applied to staging and production (migrations
`20260905204047` / `20260905204353`) and proved adversarially. The database can
now *refuse* a duplicate. It has nothing to refuse, because **no writer sends
`external_message_id` yet**, and every writer is an n8n node on the production
box (35.224.126.225), which this pass was instructed not to touch.

Until someone applies the node changes below and republishes, a retried or
redelivered write still creates a second `communication_logs` row for one real
communication, exactly as it did before.

---

## Why a doc and not a patch to `n8n-workflows/*.json`

The repo's export is dated **30 August** and is known stale: it contains zero
occurrences of `tenant_id`, while the live box demonstrably resolves and stamps
one (`Resolve Tenant` → `Claim Message Id`). Editing that export would produce a
file that looks authoritative and is not, and re-importing it would *revert* the
tenant work. So the change is written as node-level instructions against the
**published** definitions, to be applied in the n8n editor and verified by
fetching the published version back.

House rule from `CLAUDE.md`: **one agent on the n8n box at a time**, and **n8n
edits stay in draft until published — verify against the published version by
fetching it back, not against your draft.**

---

## What every changed node needs

Three edits per node.

**1. Add `external_message_id` to the JSON body**, using the provider's own id
for the message the row records, and **`null` when there isn't one**.

**2. Never mint an id.** The database now refuses `nokey:…`, `outreach:…`,
`exec-…`, `run-…`, `job-…`, a bare 10- or 13-digit epoch, anything containing
whitespace, and anything shorter than 8 characters, with SQLSTATE `23514`. A
minted per-attempt id changes on every retry, so it defeats the index it is
supposedly satisfying while making the row look identified. Send `null`.

**3. Make the write idempotent instead of merely refused** (optional but wanted):

- URL query parameter: `on_conflict=tenant_id,channel_key,direction_key,external_message_id`
- Header: `Prefer: return=minimal,resolution=ignore-duplicates`

> **VERIFY THIS ONE FIRST, IT IS UNPROVEN.** The SQL form
> `ON CONFLICT (tenant_id, channel_key, direction_key, external_message_id) DO NOTHING`
> is proved working on both projects (see the evidence file). What is **not**
> proved is PostgREST's translation of `on_conflict=` when the named columns are
> `GENERATED ALWAYS … STORED`. Test it with one POST against **staging**
> (`wwspuxrbiyagnrnzgate`) before touching production.
>
> **If it fails, drop step 3 and ship steps 1 and 2 anyway.** Without
> `on_conflict` the duplicate raises `23505` and PostgREST returns **409** — the
> second row is still refused, so the defect is still closed. `on_conflict` only
> makes the refusal quiet instead of noisy. Note that `retryOnFail: true` will
> retry a 409 up to its limit before `onError: continueRegularOutput` lets the
> workflow proceed; that is noise in the execution log, not lost data.

A shared guard expression, used verbatim in each node below:

```js
const clean = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!s || /\s/.test(s) || s.length < 8 || s.length > 512) return null;
  if (/^(nokey:|outreach:|exec-|run-|job-)/i.test(s)) return null;
  if (/^[0-9]{10}$/.test(s) || /^[0-9]{13}$/.test(s)) return null;
  return s;
};
```

---

## Node 1 — `whatsapp_bdc_ai_agent` → `Log Incoming Message` (inbound)

This is the node named in `CLAUDE.md` as the cause of the near-duplicate inbound
rows, and it is the highest-value change here: it is the only writer on the live
inbound path.

**The trap.** `$json` at this node does **not** carry the message id.
`Extract Message & Sender` emits `message_id` (from WAHA `payload.id`), but
`Resolve Lead Identity` builds a **fresh object** and does not copy it forward,
and `Skip Duplicate Outreach` passes that object through. So the id must be
reached for by node name, not read off `$json`.

Replace `parameters.jsonBody` with:

```
={{ (() => {
  const clean = (v) => { const s = String(v == null ? '' : v).trim();
    if (!s || /\s/.test(s) || s.length < 8 || s.length > 512) return null;
    if (/^(nokey:|outreach:|exec-|run-|job-)/i.test(s)) return null;
    if (/^[0-9]{10}$/.test(s) || /^[0-9]{13}$/.test(s)) return null;
    return s; };
  const ex = $('Extract Message & Sender').first().json || {};
  const outbound = $json.direction === 'outbound';
  return JSON.stringify({
    lead_email: $json.lead_email || $json.sender,
    channel: 'whatsapp',
    direction: outbound ? 'outbound' : 'inbound',
    message: outbound ? '[system] Initial outreach requested by the Master Router' : $json.message,
    sent_by: outbound ? 'bot' : null,
    external_message_id: outbound ? null : clean(ex.message_id)
  });
})() }}
```

`outbound ? null` is deliberate. On the `Called by Master Router` outreach
branch, `Extract Message & Sender` sets
`message_id: 'outreach:' + Date.now() + '-' + random`, which is a per-execution
value — precisely the shape the CHECK refuses. That row genuinely has no
inbound provider id and no outbound one either at this point, so `null` is the
honest value. `clean()` would strip it anyway; the ternary makes the intent
readable.

Also note `Extract Message & Sender` falls back to `from + ':' + payload.timestamp`
when WAHA omits `payload.id`, and to `''` when there is no timestamp either.
The first is stable across redeliveries of one message and is fine to send. The
second becomes `null` via `clean()`.

## Node 2 — `whatsapp_bdc_ai_agent` → `Log Conversation` (outbound bot reply)

`$json` at this node is the response from `Send Reply via WAHA HTTP API`.

```
={{ (() => {
  const clean = (v) => { const s = String(v == null ? '' : v).trim();
    if (!s || /\s/.test(s) || s.length < 8 || s.length > 512) return null;
    if (/^(nokey:|outreach:|exec-|run-|job-)/i.test(s)) return null;
    if (/^[0-9]{10}$/.test(s) || /^[0-9]{13}$/.test(s)) return null;
    return s; };
  const r = $json || {};
  const sent = clean(
    (r.id && typeof r.id === 'object' ? (r.id._serialized || r.id.id) : r.id) ||
    (r._data && r._data.id && (r._data.id._serialized || r._data.id.id)) ||
    r.messageId || r.key && r.key.id
  );
  return JSON.stringify({
    lead_email: $('Resolve Lead Identity').first().json.lead_email || $('Resolve Lead Identity').first().json.sender,
    channel: 'whatsapp',
    direction: 'outbound',
    message: $('Guard Reply').first().json.output || '(no AI output)',
    sent_by: 'bot',
    external_message_id: sent
  });
})() }}
```

**Unverified, and it must be checked at deploy:** the exact shape of the WAHA
`POST /api/sendText` response was **not observed** in this pass — the box was
out of scope and the repo export does not record a response. The expression
above tries the four shapes WAHA/GOWS builds are known to use and falls back to
`null`. Before republishing, run the workflow once and read the
`Send Reply via WAHA HTTP API` output in the execution; if the id sits somewhere
else, add that path. **If it lands on `null` for every send, say so — an
outbound writer that always sends `null` has not been fixed**, it has only been
made honest.

## Node 3 — `whatsapp_send_dashboard_reply` → `Log Outbound` (human reply)

Same shape; `$json` is the `Send via WAHA` response. Use the identical `sent`
expression as Node 2, with this body:

```
    lead_email: $('Prepare Send').first().json.chat_id,
    channel: 'whatsapp',
    direction: 'outbound',
    message: $('Prepare Send').first().json.text,
    sent_by: String($('Prepare Send').first().json.sent_by || 'dashboard').trim().toLowerCase(),
    external_message_id: sent
```

This node is why the 3 Sep column comment's rule ("on an outbound row, put the
id of the inbound message being replied to") was superseded: a human typing in
the dashboard is not replying to any particular inbound message, so there is no
inbound id to put. The superseding rule — *the provider's id for the message
this row records* — works in both directions and for both workflows.

---

## The eight writers deliberately left sending nothing

| workflow | node | why |
|---|---|---|
| `7_day_warm_lead_drip_campaign` | `Log Welcome Email`, `Log Follow Up Email`, `Log Final Offer Email` | send via the Gmail node; Gmail's response `id` is a real, stable message id and **should** be threaded through, but its availability at that node was not observed in this pass |
| `7_day_warm_lead_drip_campaign` | `Log WhatsApp Welcome`, `Log WhatsApp Check-in` | send via a WhatsApp node whose response shape was not observed |
| `kyc_aml_document_auditor_…_phase_5` | `Log KYC Re-ask`, `Log KYC Approved` | ditto |
| `phase_6_12_hour_silence_detector` | `Mark as Escalated` | writes `channel:'system', direction:'internal'` — an internal escalation note with **no provider leg at all**. It is correct for this one to send nothing, permanently. (It has also never run: that workflow had `activeVersionId: null` when the box was read on 4 Sep, and production holds zero rows with `direction='internal'`.) |

Leaving these at `null` is not a shortcut — it is the reason the column stayed
nullable. Forcing them to supply something would mean inventing it.

**Follow-up worth doing, not done here:** thread the Gmail node's response `id`
into the three drip email writers. That is a real provider id and it is the
cheapest remaining win on this table.

---

## Deploy checklist

1. Test the `on_conflict` + `resolution=ignore-duplicates` POST against
   **staging** first. Record whether PostgREST accepts generated columns in
   `on_conflict`. If it does not, ship without it (see above).
2. Edit nodes 1–3 in the n8n editor. **Publish**, then fetch the published
   version back and confirm the bodies are what you wrote.
3. Send one real WhatsApp message to the session and read the resulting
   `communication_logs` row: `external_message_id` must be non-null and must
   equal the `payload.id` in the execution's webhook body.
4. Then check the outbound row from the same conversation. If it is `null`,
   the WAHA send-response path is wrong — fix the expression, do not remove it.
5. Re-run:
   `select count(*) filter (where external_message_id is not null) from public.communication_logs;`
   That number, not this document, is the evidence the defect is closed.
