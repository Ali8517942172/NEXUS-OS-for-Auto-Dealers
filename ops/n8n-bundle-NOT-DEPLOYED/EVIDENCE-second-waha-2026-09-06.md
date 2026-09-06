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
