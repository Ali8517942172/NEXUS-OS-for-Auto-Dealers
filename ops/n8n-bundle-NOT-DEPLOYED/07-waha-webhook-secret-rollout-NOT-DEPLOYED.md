# 07 — Arm `WAHA_WEBHOOK_SECRET` on `whatsapp-inbound` — **NOT DEPLOYED, LAST, TRAFFIC-AFFECTING**

**This is the change that can silently destroy real customer messages. It is last
on purpose, and every step below has a stated precondition.**

`POST /webhook/whatsapp-inbound` is the one business webhook that accepts
unauthenticated calls and *acts on them*. What an unauthenticated caller gets
today: keyword-matched AI replies **sent to a number they choose**
(`Send Reply via WAHA HTTP API` posts to `body.payload.from`; `Guard Reply` filters
content, never the recipient), plus rows in `processed_messages`,
`whatsapp_contacts`, `communication_logs`, `audit_log`, and — via
`Score New Lead (Master Router)`, which enters the router through
`Called Internally` and bypasses that router's own `Auth Gate` — rows in `leads`.

## The gate already exists and is correct. The hole is configuration.

`WAHA Auth Gate` (`n8n-nodes-base.code`, `onError: stopWorkflow`), read live today.
Three states, all env-driven:

| `WAHA_WEBHOOK_SECRET` | `WAHA_WEBHOOK_ENFORCE` | mode | behaviour |
|---|---|---|---|
| unset / empty | anything | **DORMANT** | everything passes. **This is the box today.** |
| set | ≠ `true` | **MONITOR** | everything passes, tagged `_gate.mode` |
| set | `true` | **ENFORCE** | items without a matching `x-nexus-webhook-secret` are dropped (`continue`), silently, no throw |
| **unset** | **`true`** | **fails closed** | drops everything — deliberate, so a typo'd secret cannot silently re-open the door |

The header is `x-nexus-webhook-secret`, compared with a length-checked
constant-time compare. `_gate` is emitted in **every** state and carries `mode` —
so DORMANT vs MONITOR is readable directly rather than inferred from an absent key.

**Two corrections to earlier text, both confirmed today:**

- `saveDataSuccessExecution` on `BiyHk9ZXxJUVGbf6` is **`"all"`**, not `"none"`.
  The MONITOR window **is** observable. Earlier text said it was not.
- `WAHA Webhook (POST)` responds `onReceived`, so the HTTP 200 is on the wire
  before the gate runs. An unauthorised caller still gets 200. **Never describe
  this as returning 401.** It is also why a misconfigured secret cannot make WAHA
  think the endpoint is broken and back off — WAHA sees 200 either way, which is
  exactly what makes silent message loss possible.

## The trap, in one sentence

**Hardcoding the secret in n8n before WAHA sends the header drops every real
customer message, and nothing anywhere reports an error.** The fix is on the VM
first, in n8n never.

## The measured fact that unblocks arming it

There are **two** WAHA hosts posting the same messages: the box
(`35.224.126.225`, WAHA/2026.7.2, `me.jid …:12`) and an external UAE host
(`2.50.10.149`, WAHA/2026.7.1, `me.jid …:8`) running ~40 s behind. Same WhatsApp
account, different device index, second older WAHA instance.

`EVIDENCE-second-waha-2026-09-06.md` in this directory answers the question that
decides this rollout. **Over 102 sampled executions across 8h56m (5 Sep 18:23 →
6 Sep 03:19 UTC), 51 distinct `payload.id`, every single one arrived from BOTH
hosts. Zero arrived from `.149` only. Zero arrived from the box only.**

**So arming the gate with only the box's WAHA configured would, on that evidence,
have dropped no messages.** Read the three stated limits in the evidence file
before treating that as permission — in particular, the sample is 9 hours in
which both hosts were up throughout, and it contains **zero** genuine customer
conversations (all 51 were group / `status@broadcast` / `@newsletter`).

**And configure both anyway.** The cost is one extra header on a host Ali
controls; the cost of being wrong is a real customer message that never arrives
and never errors.

---

## The rollout, in order, with preconditions

### Step 0 — precondition: identify the `.149` machine

`PRECONDITIONS.md` §1. We now know **what** it is (a second, older WAHA serving
the same WhatsApp account on device index 8). We do not know **which machine** it
is. That is Ali's; nobody else can find it.

**Decide before proceeding:** configure it, or decommission it. Both are fine.
"Leave it and arm the gate" is the one option that is not.

### Step 1 — VM: set the secret, do NOT enforce

```
# /opt/nexus/.env
WAHA_WEBHOOK_SECRET=<32+ random chars>
# WAHA_WEBHOOK_ENFORCE deliberately NOT set
```

Restart n8n. The gate moves DORMANT → **MONITOR**. Behaviour is unchanged:
everything still passes.

### Step 2 — WAHA: send the header, on **both** hosts

Configure the webhook on the box's WAHA and on `2.50.10.149` (or decommission the
latter) to send `x-nexus-webhook-secret: <the same value>`.

In WAHA this is `config.webhooks[].customHeaders`. **Note for later:** once this
is set, `GET /api/sessions/default` returns that secret inside
`config.webhooks[].customHeaders`. That is why `Format Probe` in the health probe
builds its output field by field and hides the webhook list unless
`NEXUS_PROBE_VERBOSE=true`. Do not widen that node, and do not set
`NEXUS_PROBE_VERBOSE=true` on a probe endpoint that has no `NEXUS_PROBE_KEY`.

### Step 3 — observe MONITOR, and do not skip it

`saveDataSuccessExecution` is `"all"`, so every execution is saved. Watch until
you have seen, from **both** source addresses:

```
_gate.mode           == "MONITOR"
_gate.header_present == true
_gate.ok             == true
```

**Wait for a genuine 1:1 customer message, not just group traffic.** In the 9
hours I sampled there were none. A MONITOR window that only ever saw
`status@broadcast` has not tested the path that matters.

**Do not proceed until `_gate.ok` is true on every item from every source you
intend to keep.** Any `header_present: false` is a host you have not configured.

### Step 4 — enforce

```
WAHA_WEBHOOK_ENFORCE=true
```

Restart n8n. Items without a matching header are now dropped silently.

### Step 5 — prove it, immediately, with a real message

Send one WhatsApp message from a real handset to the dealership number and
confirm a reply arrives. **This is the only test that matters** — the gate drops
silently and WAHA keeps seeing 200, so a broken rollout looks exactly like a quiet
day.

## What breaks if applied out of order

| wrong order | what happens |
|---|---|
| secret in n8n **before** WAHA sends the header | **every real customer message is dropped**, silently, with 200s going back to WAHA. The worst outcome in this bundle. |
| `WAHA_WEBHOOK_ENFORCE=true` with the secret unset | the gate fails closed and drops **everything**. Loud (the bot stops), which is the correct direction for a misconfiguration to fail — but still an outage. |
| enforce before configuring `.149` | that host's deliveries stop. On today's evidence that costs nothing, because the box delivers the same messages — but the evidence is 9 hours old and 51 non-customer messages wide. |
| before 05 (the probe) | you enforce blind. Nothing is watching the WhatsApp channel. |
| in the same window as 04 or 06 | all three produce "the bot stopped replying". You will not know which. |

## Verify

See `VERIFY.md` §07.

## Roll back

Three rollbacks, fastest first:

1. **~10 seconds, no restart:** n8n editor → `BiyHk9ZXxJUVGbf6` → right-click
   `WAHA Auth Gate` → disable → save → publish. A disabled node passes its input
   straight through; the channel is instantly back to pre-patch behaviour.
2. **One env line + restart:** unset `WAHA_WEBHOOK_ENFORCE` → back to MONITOR,
   everything passes, header still observable.
3. **Full:** unset `WAHA_WEBHOOK_SECRET` too → DORMANT, i.e. exactly today.
