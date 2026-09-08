# Is `2.50.10.149` ever the ONLY sender of a message? — **measured, 6 September 2026**

**Answer: not once in the sample. Every message arrived twice, once from each host.**

Nothing in this file was deployed. It is a read-only measurement taken from saved
n8n executions on the production box (35.224.126.225) and from production
Supabase `dsvuoovivysszdoiorch`.

---

## What was sampled, exactly

| | |
|---|---|
| workflow | `BiyHk9ZXxJUVGbf6` — WhatsApp BDC AI Agent |
| executions in the workflow's list | **988** (`search_executions` `count`, `estimated:false`) |
| executions sampled | **102** |
| execution id range | 10218 – 10323 (contiguous except ids 10294, 10305, 308, 10311, which belong to other workflows) |
| time window | **2026-09-05 18:23:46 UTC → 2026-09-06 03:19:26 UTC** (8h 56m) |
| status of all 102 | `success`, data retained (`saveDataSuccessExecution: "all"` on this workflow — confirmed on the published settings) |
| node read for the group key | `Prefilter` → `message_id` (which is `body.payload.id`, per the node's own expression) |
| node read for the sender | `WAHA Webhook (POST)` → `headers['x-forwarded-for']`, `headers['user-agent']`, `body.me.jid`, `body.environment.version` |

**Deliberately excluded and why.** The same listing page contains ids 10122–10217
with `status:"new"` and `startedAt: null` — queued and never executed, so they
carry no node data at all — and 10113/10114 with `status:"crashed"`. Neither can
answer the question, so neither is in the 102.

**This is a sample, not a census.** 102 of 988 executions. I have **not**
extrapolated the ratios below to the full 988, and this file does not claim to.

---

## Result: 51 distinct `payload.id`, every one seen exactly twice

| category | distinct `payload.id` | share |
|---|---|---|
| arrived from **both** sources | 51 | 100% |
| arrived from **the box only** (`35.224.126.225`) | **0** | 0% |
| arrived from **`.149` only** | **0** | **0%** |
| **total distinct messages in the sample** | **51** | — |

51 × 2 = 102. There is **no singleton in the sample.** Not one `payload.id`
appeared an odd number of times.

### How the sender was established

For **9 of the 51 pairs** I read `x-forwarded-for` on **both** halves. Those 9 are
spread across the whole window rather than clustered:

| pair | time (UTC) | box half | `.149` half | `payload.id` (abbreviated) |
|---|---|---|---|---|
| 10322 / 10323 | 03:19:26 | 10322 | 10323 | `false_…@newsletter_AC874C00A1326B38BFF0BD48E3BA3E46` |
| 10320 / 10321 | 03:15:47 | 10320 | 10321 | `false_120363406129814610@g.us_ACC2B1916…` |
| 10318 / 10319 | 02:57:28 | 10318 | 10319 | `false_120363428876084942@g.us_ACE7040EC…` |
| 10316 / 10317 | 01:47:45 | 10316 | 10317 | `false_status@broadcast_2AACB834A58B4B5F…` |
| 10314 / 10315 | 01:41:08 | 10314 | 10315 | `false_status@broadcast_2AC1CED32A9E4374…` |
| 10313 / 10312 | 01:40:32 | 10313 | 10312 | `false_status@broadcast_2ABA1ED69DBC41DB…` |
| 10309 / 10310 | 00:14:49 | 10309 | 10310 | `false_120363428876084942@g.us_3A03A7304…` |
| 10307 / 10306 | 22:04:34 | 10307 | 10306 | `false_120363428876084942@g.us_3A7A75A92…` |
| 10248 / 10249 | 18:49:49 | 10248 | 10249 | `false_120363262186212358@g.us_AC601627F…` |

Every one of those 9 is the same shape you already identified, with no exception:

```
box   : x-forwarded-for 35.224.126.225   user-agent WAHA/2026.7.2   me.jid 971526647253:12@s.whatsapp.net
.149  : x-forwarded-for 2.50.10.149      user-agent WAHA/2026.7.1   me.jid 971526647253:8@s.whatsapp.net
```

For the remaining 42 pairs I read `payload.id` on both halves but not the header
on both. **That is stated rather than glossed:** what is proved for all 51 is
"exactly two deliveries of this message id"; what is proved on 9 of them is
"one from each host". A pair where the *same* host delivered twice would be
indistinguishable from a cross-host pair in the 42 I did not open. Given 9 of 9
were cross-host and the pairing is perfectly regular, a same-host retry pair is
unlikely — but it is not measured.

### A concrete example of the only category that exists

Executions **10307** and **10306**, 22:04:33–34 on 5 September, both carrying
`payload.id = false_120363428876084942@g.us_3A7A75A928386626DA9E_74638075900128@lid`:

```
10307  x-forwarded-for: 35.224.126.225   WAHA/2026.7.2   jid …:12   x-webhook-timestamp 1788645874066
10306  x-forwarded-for: 2.50.10.149      WAHA/2026.7.1   jid …:8    x-webhook-timestamp 1788645914484
```

40.4 seconds apart, byte-identical `payload` — same `payload.timestamp`
(`1788645871`), same media `fileSHA256`. The `.149` host runs consistently
~40 s behind, matching the 41 s you measured on 10322/10323.

**There is no example of the other two categories to quote, because there are none
in the sample.**

## Consequence for the WAHA gate

Within this window, **arming `WAHA_WEBHOOK_ENFORCE` with only the box's WAHA
configured would have dropped zero messages** — every message the `.149` host
delivered was already delivered by the box.

Three limits on that conclusion, all of which belong in Ali's runbook:

1. **The window is 9 hours of one day.** It proves the two hosts were *both up*
   throughout it. It does not prove `.149` is never the sole survivor of an
   outage on the box.
2. **It is 51 messages, none of them a customer conversation** (see below). The
   duplication of a `status@broadcast` post is not evidence about the duplication
   of a genuine customer message, though nothing in WAHA's delivery path
   distinguishes them.
3. **The box's WAHA is also the send path.** `Send Reply via WAHA HTTP API`
   (WhatsApp BDC) and `Send via WAHA` (WhatsApp Send) both POST to
   `http://waha:3000/api/sendText` — the container on the GCP box. If that WAHA
   is down, NEXUS cannot reply regardless of who delivered the inbound. So the
   `.149` host being "the only sender" during a box outage would not rescue a
   conversation anyway; it would only create an inbound row with no possible reply.

**Net: configuring or decommissioning `2.50.10.149` loses nothing that was
measured. It is a duplicate delivery path, not a unique one.** The remaining
argument for configuring rather than decommissioning it is redundancy of
*capture*, not of *response*.

---

## Traffic composition — the audit's claim, checked with a number

`Is Real Inbound?` (an IF on `Prefilter.is_real_inbound`) is the system's own
classifier. Its live expression, read from the published definition:

```js
$json.body?.payload?.fromMe !== true
  && (!$json.body?.event || $json.body.event === 'message')
  && !!($json.body?.payload?.from)
  && !String($json.body.payload.from).endsWith('@g.us')
  && !String($json.body.payload.from).startsWith('status@')
  && !String($json.body.payload.from).endsWith('@newsletter')
```

**Read from `Prefilter`'s output on all 102 sampled executions:**

| `is_real_inbound` | executions | distinct `payload.id` |
|---|---|---|
| `true` (genuine 1:1 customer conversation) | **0** | **0** |
| `false` (group / status broadcast / newsletter) | **102** | **51** |

**0% of the sampled traffic was genuine customer conversation.** By sender:

| `payload.from` | distinct messages |
|---|---|
| `120363262186212358@g.us` (group) | 21 |
| `120363049265273748@g.us` (group) | 9 |
| `120363428876084942@g.us` (group) | 9 |
| `status@broadcast` | 3 |
| `120363039613956725@g.us` (group) | 2 |
| `120363406129814610@g.us` (group) | 1 |
| `120363165659692968@newsletter` | 1 |
| **1:1 customer chats (`@c.us` / `@s.whatsapp.net`)** | **0** |
| | **51** |

**The audit's claim is confirmed for this window, and more strongly than it was
put:** not "most" of the traffic is not customer conversation — in these 9 hours,
**none of it was**. This is Ali's personal WhatsApp account (`me.pushName: "Ali
Asgher"`, `971526647253`) sitting in community and family groups; the dealership
BDC agent is watching a personal handset's group feed.

Two consequences worth carrying:

- **Any headline "N WhatsApp messages handled" taken from the execution list is
  wrong twice over** — once for the 2× duplication, and again because the
  denominator is group chatter the agent correctly refuses to answer. In this
  window the honest number of customer messages is **zero**.
- **The prefilter is doing real work and doing it correctly.** 102 executions
  reached `Is Real Inbound?` and 102 stopped there. No AI call, no send, no
  `communication_logs` row. The cost of the second WAHA host is therefore
  102 wasted executions per 51 ignorable messages, not doubled customer replies.

---

# ADDENDUM — 8 September 2026: the host is named

**Nothing above is changed by this. No number, no table and no conclusion in this
file was re-derived; the measurements of 5–6 September stand exactly as recorded.**
This addendum records one new fact of a different kind, and its evidence is of a
different kind too.

**The fact.** `2.50.10.149` is **Ali's own Windows desktop `desktop-l3an0ma`**,
running WAHA in Docker Desktop. It is the same PC that used to host n8n, reached
over a Tailscale funnel at `https://desktop-l3an0ma.tail2141f7.ts.net`, from
before the move to GCP.

**How it is known.** Ali stated it, on 8 September 2026: *"purana waha mene
desktop docker pe chalaya tha aur n8n bhi tailscale ke zariye use bhi local pc pe
download kiya tha but ab sab kuch gcp pe hai to use remove kar do purana wala."*
Nothing was read off that machine from here. This is an owner statement, not a
measurement, and it is the only evidence for the host's identity.

| claim | status |
|---|---|
| two senders, same account, `me.jid …:8` vs `…:12`, builds 2026.7.1 vs 2026.7.2, ~40 s apart | **measured** (this file, 5–6 Sep) |
| 51 distinct messages, all delivered twice, zero singletons | **measured** (this file) |
| one sender only on 7 Sep, 29 executions, zero duplicate `payload.id` | **measured** (`ops/n8n-waha-gate/README.md`) |
| the `.149` host is `desktop-l3an0ma`, WAHA in Docker Desktop, ex-n8n host behind Tailscale | **stated by the owner, 8 Sep 2026** |
| the container is stopped | **not proven** |
| it will not restart | **not proven** — its compose declares `restart: always` |
| WhatsApp linked device **8** is unlinked | **not proven** |

**Status to carry forward: identified; decommissioning in progress, not yet
verified.** At the time of writing the desktop teardown was running and had not
been confirmed from either end. Do not write "removed" or "done" anywhere on the
strength of this addendum. **Superseded later the same day — see the second
addendum at the end of this file. The correct status is now: identified, and
stopped by hand on 8 Sep 2026 — not yet permanently removed (`restart: always`
still declared, device 8 still linked).**

**One observation consistent with the identification, which is not proof of it.**
On 8 September, execution `11094` carried a `webhookUrl` of
`https://desktop-l3an0ma.tail2141f7.ts.net/...` inside a WAHA payload — the same
Tailscale hostname. That is consistent with the desktop having been the WAHA
webhook target while it was the n8n host. It is not confirmation: the webhook
target has not been read out of the live WAHA session config, so what that
instance points at today is unknown.

**What the identification does and does not do to the rollout.** It removes the
search — nobody has to hunt a host by its address any more. It does not remove
the step: `PRECONDITIONS.md` §1 still closes on one of two observations, either
the container stopped with `restart: always` disabled and device 8 unlinked and
no `me.jid …:8` delivery seen from the box over a meaningful window, or
`x-nexus-webhook-secret` present in its WAHA webhook `customHeaders`.


---

# SECOND ADDENDUM — 8 September 2026: it had not stopped, and this file's method could not have seen it

**Nothing above is changed by this either. The 5-6 September numbers stand; so
does the first addendum. What changes is a claim made elsewhere on the strength
of samples shaped like this one.**

**The measurement.** Production execution **11103**, **8 September 2026 at
06:07:40 UTC**:

```
x-forwarded-for            2.50.10.149
user-agent                 WAHA/2026.7.1
me.jid                     971526647253:8@s.whatsapp.net
body.environment.version   2026.7.1
body.event                 session.status
x-nexus-webhook-secret     absent   ->  _gate.header_present = false
```

The `.149` host was **still posting into `/webhook/whatsapp-inbound` on
production on 8 September** — two days after `CLAUDE.md` and
`ops/n8n-waha-gate/README.md` recorded that the second WAHA had stopped.

**The method blind spot, which is this file's own method.** The 6 September
sample above and the 29-execution sample of 7 September both grouped by
`payload.id` and looked for duplicate pairs. That host's WhatsApp session is no
longer authenticated, so it emits `session.status` events and **no `message`
events at all** — events that carry no `payload.id` and can therefore never form
a pair. A sender that has stopped duplicating is invisible to a detector built
out of duplicates. **Absence of duplicates is not absence of the sender.**

This does not weaken the 51-pair result: in the 5-6 September window both hosts
were delivering `message` events and every one was seen twice, which is what
that sample measured and all it measured. It does mean the sample answers
"is `.149` ever the only sender of a message?" and does **not** answer "is
`.149` still calling this endpoint?". Only a per-request read of
`x-forwarded-for` across all events answers the second question.

**What was found and what was done.** Docker Desktop on `desktop-l3an0ma`,
opened on 8 September, showed a compose project **`nexus-os`** at
`C:\Users\user\Desktop\MY RESUMES\nexus-os` with **three containers
running**: `n8n` (5678), `n8n-db` (postgres:16-alpine) and `waha`
(devlikeapro/waha, 3000). Its own WAHA log at 06:02:22 records a
`session.status` POST to
`https://35.224.126.225.nip.io/webhook/whatsapp-inbound` returning status code
200. The compose project was **stopped by hand through the Docker Desktop UI at
06:08:24 UTC** (`Received SIGTERM signal`, `Deregistered all crons`,
`database system is shut down`). The GCP box was unaffected: `/healthz` `ok`,
and executions 11104 and 11105 arrived from `35.224.126.225` in the same minute.

Deletion of the compose project was **declined** deliberately — the Docker
Desktop confirmation says nothing about named volumes, and those volumes hold
that n8n's workflows and credentials and the WAHA linked-device session.

**Status to carry forward, replacing the first addendum's:
identified, and stopped by hand on 8 Sep 2026 — not yet permanently removed
(`restart: always` still declared, device 8 still linked).** `restart: always`
is declared on all three services and Docker restarts a manually stopped
`always` container when the daemon next starts, so a Docker Desktop restart or a
Windows reboot brings it back. The outstanding steps are
`docker update --restart=no n8n n8n-db waha` on that PC and unlinking WhatsApp
device **8** on the handset. Neither has been done. Do not write "removed",
"decommissioned" or "done".

**A second exposure this uncovered, never costed anywhere in this repo:** a
second n8n with its own Postgres — schedules, credentials and all — was live on
that machine alongside the WAHA container.

The authoritative account is `CLAUDE.md`, section "It had not stopped. It was
stopped, by hand, at 06:08 UTC on 8 September 2026".
