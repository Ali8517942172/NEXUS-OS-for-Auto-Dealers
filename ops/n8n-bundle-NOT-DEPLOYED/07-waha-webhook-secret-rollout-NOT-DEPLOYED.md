# 07 — Arm `WAHA_WEBHOOK_SECRET` on `whatsapp-inbound` — **NOT DEPLOYED, LAST, TRAFFIC-AFFECTING**

> **SUPERSEDED IN PART, 18 Sep 2026 — see `ops/launch/WAHA-GATE-MEASURED-2026-09-18.md`.**
> The gate is **not** DORMANT and has not been for at least part of 18 Sep: measured
> `_gate.mode == "ENFORCE"`, `header_present == true`, `ok == true` from the box.
> The rollout steps below remain correct as a procedure; the "this is the box today"
> state claim does not.

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
account, different device index, second older WAHA instance. **That external host
was named on 8 September 2026 by Ali, not by measurement: his own Windows desktop
`desktop-l3an0ma`, WAHA in Docker Desktop, the PC that used to host n8n behind
`https://desktop-l3an0ma.tail2141f7.ts.net`.** Measured the same day, it was
**still posting** — execution 11103 at 06:07:40 UTC, `session.status`, no header
— and it was then **stopped by hand at 06:08:24 UTC**. Status:
**identified, and stopped by hand on 8 Sep 2026 — not yet permanently removed
(`restart: always` still declared, device 8 still linked).** See step 0.

`EVIDENCE-second-waha-2026-09-06.md` in this directory answers the question that
decides this rollout. **Over 102 sampled executions across 8h56m (5 Sep 18:23 →
6 Sep 03:19 UTC), 51 distinct `payload.id`, every single one arrived from BOTH
hosts. Zero arrived from `.149` only. Zero arrived from the box only.**

**So arming the gate with only the box's WAHA configured would, on that evidence,
have dropped no messages.** Read the three stated limits in the evidence file
before treating that as permission — in particular, the sample is 9 hours in
which both hosts were up throughout, and it contains **zero** genuine customer
conversations (all 51 were group / `status@broadcast` / `@newsletter`).

**And configure both anyway** — that was the instruction, and as of 8 September
2026 it is **superseded**. `.149`'s WhatsApp session is no longer authenticated,
so it delivers `session.status` and no messages; there is no capture to preserve
and enforcement would drop those posts harmlessly. Configure the box's WAHA.
`.149` still has to be **permanently** closed for a different reason — it can
restart — see step 0.

---

## The rollout, in order, with preconditions

### Step 0 — precondition: dispose of the `.149` machine, and verify it

`PRECONDITIONS.md` §1. We know **what** it is (a second, older WAHA serving the
same WhatsApp account on device index 8), and since **8 September 2026** we know
**which machine**: Ali's own Windows desktop **`desktop-l3an0ma`**, running WAHA
in Docker Desktop, the PC that used to host n8n behind
`https://desktop-l3an0ma.tail2141f7.ts.net`. That came from Ali, not from a
measurement here.

**The decision is made — he asked for it to be removed. What happened on
8 September, measured rather than assumed.** It had *not* stopped on its own:
execution **11103** at **06:07:40 UTC** on production carries
`x-forwarded-for 2.50.10.149`, `WAHA/2026.7.1`, `me.jid …:8`,
`body.event session.status`, no `x-nexus-webhook-secret`. Docker Desktop on that
PC showed the `nexus-os` compose project with `n8n` (5678), `n8n-db` and `waha`
(3000) all running, and the WAHA container's own log at 06:02:22 recorded a
`session.status` POST to `/webhook/whatsapp-inbound` returning 200. The compose
project was **stopped by hand through the Docker Desktop UI at 06:08:24 UTC**.
Deletion was declined, deliberately, because the dialog says nothing about the
named volumes holding that n8n's workflows and credentials and the WAHA
linked-device session.

**Why the 6 and 7 September samples reported it gone, and it is a method fault.**
Both grouped by `payload.id` and looked for duplicate pairs. That host's
WhatsApp session is no longer authenticated, so it emits `session.status` events
and no `message` events — events that carry no `payload.id` and can never form a
pair. **Absence of duplicates is not absence of the sender.**

**The step is still open, because the stop is reversible:** `restart: always` is
declared on all three services, and Docker restarts a manually stopped `always`
container when the daemon next starts, so a Docker Desktop restart or a Windows
reboot brings the project back. WhatsApp linked device **8** is still linked.

**So step 0 closes on one of two observations, not on the name and not on the
manual stop:**

- **Decommissioned** — `docker update --restart=no n8n n8n-db waha` run on that
  PC, device 8 unlinked in WhatsApp, and no delivery carrying `me.jid …:8` seen
  from the box over a window long enough to mean something with the desktop
  powered on and Docker running. Check across **all** events, not by looking for
  duplicate `payload.id`.
- **Configured** — `x-nexus-webhook-secret` present in its WAHA webhook
  `customHeaders`, same value as the box. Note this now buys nothing: with an
  unauthenticated session it captures no messages.

"Leave it and arm the gate" is the one option that is not fine. "We know whose PC
it is" and "it is stopped right now" are neither of the two above.

### Step 1 — VM: set the secret, do NOT enforce

```
# /opt/nexus/.env
WAHA_WEBHOOK_SECRET=<32+ random chars>
# WAHA_WEBHOOK_ENFORCE deliberately NOT set
```

Restart n8n. The gate moves DORMANT → **MONITOR**. Behaviour is unchanged:
everything still passes.

### Step 2 — WAHA: send the header (the box's WAHA; `.149` no longer applies)

Configure the webhook on the box's WAHA to send
`x-nexus-webhook-secret: <the same value>`. **`2.50.10.149` no longer needs
configuring** — it was stopped by hand on 8 Sep and its session was already
unauthenticated, so it delivers `session.status` and no messages; enforcement
would drop those posts harmlessly. It is still not permanently removed
(`restart: always` still declared, device 8 still linked), so step 0 stays open
even though step 2 no longer waits on it.

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

---

## 6 September 2026, evening — measured again, and who can do which step

Ali gave permission to do this rollout through the browser. Two of its four steps
are still not mine to do, and saying so is cheaper than discovering it halfway
through with the channel silent.

### The gate, read from the box just now

Execution `10593`, 19:32:03 UTC, `WAHA Auth Gate`'s own output:

```
_gate: { mode: "DORMANT", ok: false, header_present: false, enforcing: false }
```

Not inferred from an absent key — the node emits `mode` in every state, and it
says DORMANT. The door is open, today, and this is the measurement rather than a
recollection of the 3 September one.

Same execution, same read: `x-forwarded-for: 35.224.126.225`, `user-agent:
WAHA/2026.7.2`, `me.jid …:12@…`. One sender in this execution, the GCP box. And
the payload is `status@broadcast` again — the traffic in this window is still not
customer conversation.

**"`2.50.10.149` is still gone" was written here, and it is measurably false —
corrected 8 September 2026.** What this execution and the 29-execution sample of
7 Sep measured is that no `:8` delivery appeared *in samples that grouped by
`payload.id` and looked for duplicate pairs*. That host's WhatsApp session is no
longer authenticated, so it emits `session.status` events and no `message`
events — events that carry no `payload.id` and can never form a pair. **Absence
of duplicates is not absence of the sender.** Execution **11103** on 8 September
at **06:07:40 UTC** carries `x-forwarded-for 2.50.10.149`, `WAHA/2026.7.1`,
`me.jid …:8`, `body.event session.status`, no `x-nexus-webhook-secret`. It was
posting into production the whole time.

It was **stopped by hand** at **06:08:24 UTC** on 8 September through Docker
Desktop on `desktop-l3an0ma`. Status:
**identified, and stopped by hand on 8 Sep 2026 — not yet permanently removed
(`restart: always` still declared, device 8 still linked).** Do not write
"removed", "decommissioned" or "done".

**And the consequence for enforcement has changed shape.** Enforcing would drop
the `.149` `session.status` posts harmlessly — they carry no customer message
and `Prefilter` discards them anyway. What blocks enforcement is the **box's
own** traffic: as of 8 September the gate reads `header_present: true, ok: false`
on it, because in queue mode the comparison runs inside `n8n-worker` and
`docker compose up -d n8n` recreates the wrong container. Enforcing against that
drops 100% of real inbound. Same blocker severity, different cause.

### What I cannot do, and why

- **Step 1, `WAHA_WEBHOOK_SECRET` in `/opt/nexus/.env` on the VM.** There is no
  shell on that machine from here; the n8n API is the only reach, and it does not
  set environment variables. **Ali's.**
- **Step 2, the `customHeaders` entry on WAHA.** This is typing a secret value
  into a field, and I do not handle secrets, passwords or tokens — browser
  permission does not change that. **Ali's.**
- **Step 3, the MONITOR proof.** It requires a genuine 1:1 customer message from
  a real phone. No amount of access substitutes for that. **Ali's, or a
  controlled handset.**
- **Step 4, `WAHA_WEBHOOK_ENFORCE=true`.** Also a VM environment variable, and it
  must not happen until step 3 has actually been observed.

So the honest position is that this rollout is **entirely owner-side**, and the
useful thing I can contribute is the measurement above and the ordering below.

### The order is different from what this file said, and safer

The original sequence was VM secret, then WAHA header. **Reverse the first two.**

Setting the WAHA header while `WAHA_WEBHOOK_SECRET` is unset is completely inert:
the gate is DORMANT, it reads no header, and it passes everything through exactly
as it does now. So the header can be configured first, at leisure, with zero risk
— and then setting the env var moves the gate DORMANT -> MONITOR with the header
**already flowing**, which is the state you actually want to observe.

Doing it the other way round leaves a window in which the gate is in MONITOR and
every item logs `header_present: false`, which is indistinguishable at a glance
from a header that was configured wrongly.

    1. WAHA:  add customHeaders x-nexus-webhook-secret: <value>     (inert, safe)
    2. VM:    WAHA_WEBHOOK_SECRET=<same value>, restart n8n          (-> MONITOR)
    3. Watch: _gate.header_present == true and _gate.ok == true,
              on a genuine 1:1 message, not group or broadcast traffic
    4. VM:    WAHA_WEBHOOK_ENFORCE=true                              (-> ENFORCE)

**Step 3 is not a formality and it is the one most likely to be skipped.** The
box is the only sender of customer messages, so arming the gate before the header
is confirmed drops one hundred per cent of inbound messages, and
`WAHA Webhook (POST)` responds `onReceived`, so WAHA sees HTTP 200 either way and
never backs off. Nothing anywhere reports an error. The channel simply goes quiet.

**And on 8 September 2026 step 3 is exactly where this is stuck.** Steps 1 and 2
are done — the header arrives, measured on executions 11098/11099/11100, and the
SHA-256 fingerprint of what WAHA sends changed between 11096 and 11098. The gate
reads `header_present: true` and **`ok: false`** on the box's own traffic. The box
runs in queue mode, so the Code node reading `$env.WAHA_WEBHOOK_SECRET` executes
in `n8n-worker`, and `docker compose up -d n8n` recreates the container you check
rather than the one that compares. Recreate both, and verify by fingerprint where
the value is consumed:

    docker compose exec -T n8n-worker sh -c 'printf %s "$WAHA_WEBHOOK_SECRET" | sha256sum'

### How to read the MONITOR window without reading n8n by hand

`saveDataSuccessExecution` is `"all"`, so every execution is retained. For each
recent execution of `BiyHk9ZXxJUVGbf6`, read `WAHA Auth Gate` -> `_gate` and the
trigger's `headers['x-forwarded-for']`. You are waiting to see, on a **1:1**
message (`payload.from` ending `@c.us`, not `@g.us`, `status@broadcast` or
`@newsletter`):

    _gate.mode == "MONITOR"   header_present == true   ok == true

If any 1:1 message shows `ok: false`, stop. That is the message that would have
been destroyed.
