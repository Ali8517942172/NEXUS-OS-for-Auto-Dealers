# Webhook authentication and authorization — three confirmed exposures

Offline patch set. Nothing live was touched to produce this. Everything below was
read from the exports in `/home/claude/audit/n8n-workflows/`.

| # | Endpoint | Workflow | Live id | Decision |
|---|----------|----------|---------|----------|
| 1 | `POST /webhook/whatsapp-inbound` | WhatsApp BDC AI Agent (36 nodes in this export) | `BiyHk9ZXxJUVGbf6` | **Shared-secret header, staged in three env-driven modes** |
| 2 | `GET /webhook/infra-probe` | NEXUS Infra Health Probe | `57QpbNQGwlFKb0q3` | **Authenticate AND stop leaking, plus a real verdict** |
| 3 | `POST /webhook/slack-command` | Slack Command Center - AI Agent | `VmnIXo7tM30zqawp` | **Switch the endpoint off; harden the tools behind it** |

A note that applies to 1 and 3 and that must not be glossed over: both of those
webhook nodes respond `onReceived`, so the HTTP 200 is already on the wire before
any gate node runs. **Neither fix returns 401.** What they buy is that nothing
downstream happens — no WhatsApp send, no model spend, no database write. Only
exposure 2 uses `responseMode: responseNode`, and that is the only one of the
three that can be given a genuine 401.

---

## 1 — `/webhook/whatsapp-inbound`

### What is actually exposed

`WAHA Webhook (POST)` → `Prefilter` → `Is Real Inbound?` → `Claim Message Id` →
`Is New Message?` → `Extract Message & Sender` → … → `Send Reply via WAHA HTTP API`.

`Prefilter` reads `body.payload.from` straight off the request body. That value
becomes `sender`, and `Send Reply via WAHA HTTP API` posts
`{ chatId: <sender>, text: <model output>, session: 'default' }` to
`http://waha:3000/api/sendText`. So an anonymous caller who knows the URL can:

* make the dealership's own WhatsApp number send text of the caller's choosing to
  any phone number in the world (the model's output is steerable through
  `payload.body`, and the reply is delivered to a caller-chosen `chatId`);
* spend the OpenRouter and Groq free-tier quota, one agent run per request, on a
  box with production concurrency 2 — a trivial denial of the real customer channel;
* write rows into `communication_logs`, `whatsapp_contacts`, `processed_messages`,
  and, through `New Lead Worth Scoring?` → `Shape Lead For Router` →
  `Score New Lead (Master Router)`, into `leads`;
* trigger the KYC branch (`Is Document?` → `Download KYC Image` → `Send to KYC
  Auditor`) with an attacker-controlled media URL.

### The three candidate fixes, weighed

**n8n's built-in `authentication: "headerAuth"`.** Rejected. Three reasons.
(a) It requires an `httpHeaderAuth` credential, and there is none — a grep across
all 23 workflow exports finds only `supabaseApi`, `slackApi`, `gmailOAuth2`,
`openRouterApi`, `groqApi` and `httpQueryAuth`. The brief is explicit that we do
not attach credentials we cannot confirm exist. (b) It is binary: there is no way
to run it in observe-only mode, so the first wrong character in the WAHA config
means WAHA gets a 403 on every delivery and the dealership's only live customer
channel goes dark with no warning. (c) Rolling it back means editing the webhook
node and re-registering the production webhook.

**An allowlist on the sender.** Rejected as a primary control. `payload.from` is
supplied by the caller; allowlisting it authenticates nothing. It would also
break the business — the whole point is that *new* customers message in.

**A shared-secret header checked in a Code node against `$env`.** Chosen. It
matches the established pattern here (`$env.WAHA_API_KEY`, `$env.BITRIX24_WEBHOOK_URL`,
with `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and the compose file passing them in),
needs no credential, needs no new infrastructure, costs one cheap node on a
958 MB box, and — decisively — it can be staged.

### The design

One new node, `WAHA Auth Gate` (Code, `typeVersion` 2), inserted between
`WAHA Webhook (POST)` [0, 304] and `Prefilter` [144, 304], placed at [144, 464].
It reads header `X-Nexus-Webhook-Secret` case-insensitively and compares it to
`$env.WAHA_WEBHOOK_SECRET` with a constant-time-style loop.

Three modes, both toggles in `/opt/nexus/.env`:

| `WAHA_WEBHOOK_SECRET` | `WAHA_WEBHOOK_ENFORCE` | Behaviour |
|---|---|---|
| unset / empty | (any) | **DORMANT** — every item passes, byte-identical to today |
| set | not `true` | **MONITOR** — every item passes, each tagged `_gate: {ok, header_present, enforcing}` |
| set | `true` | **ENFORCE** — non-matching items are dropped (`return []`), nothing downstream runs |

Why the node is safe to insert:

* The other entry point, `Called by Master Router` (executeWorkflowTrigger) →
  `Extract Message & Sender`, does not pass through the gate and is untouched.
* `Extract Message & Sender` reaches back with `$('WAHA Webhook (POST)')` **by
  node name**, which an insertion downstream of the webhook does not disturb.
* The `_gate` key it adds is inert: `Prefilter` is a Set node in assignments mode
  with `includeOtherFields` off, so it emits only its four assignments and `_gate`
  reaches nothing else.
* Rejection is `return []`, not a throw. An attacker therefore produces no error
  executions and no alert storm through the error workflow (`iYJkh1kztWxZXDbT`).
* `alwaysOutputData` is deliberately **false** on this node. With it true, a
  rejected request would push an empty item into `Prefilter`.
* Its `onError` is `stopWorkflow` — if the gate itself ever fails, it fails closed.

### What must change on the WAHA side

WAHA must attach a custom header to its webhook calls. In WAHA the webhook is
part of the session config: `config.webhooks[]` carries `url`, `events` and
`customHeaders` (an array of `{name, value}`). The value goes in as
`X-Nexus-Webhook-Secret: <the secret>`. Ali does this in the WAHA dashboard, or by
re-POSTing the session config; `OWNER_STEPS.md` has both. Some WAHA builds also
expose a global env form of this (`WHATSAPP_HOOK_CUSTOM_HEADERS`) — treat the
exact variable name as unverified and prefer the session config.

Two properties make a WAHA mistake survivable: the webhook still answers 200 to
WAHA in every mode (so WAHA never decides the endpoint is broken and stops
retrying), and MONITOR mode proves the header is arriving *before* anything is
enforced.

### Rollout order

1. Apply `OPERATIONS_bdc.json`. Nothing changes — the gate is dormant. Send one
   real WhatsApp message and confirm the bot still replies.
2. Add `WAHA_WEBHOOK_SECRET` to `/opt/nexus/.env`, restart n8n. Now MONITOR.
   The channel still works for everyone, authenticated or not.
3. Add the custom header in WAHA.
4. Watch. Turn on "Save successful production executions" for this workflow for
   the watch window, send test messages, and confirm the gate node's output shows
   `_gate.ok = true` on real WAHA traffic. Do not proceed until it does.
5. Add `WAHA_WEBHOOK_ENFORCE=true`, restart n8n. Send one more real message.
6. Turn execution saving back off.

The one true outage window is the ~30 s n8n restart in steps 2 and 5. Do it late
at night Dubai time. Messages sent during the restart are not lost from WhatsApp —
only the bot's reply to them is — and the Phase 6 silence detector is the existing
safety net for that.

### Rollback, in increasing order of blast radius

1. **10 seconds, no restart:** n8n editor → WhatsApp BDC AI Agent → disable the
   `WAHA Auth Gate` node → Save. A disabled node passes its input straight to its
   output, so the channel is instantly back to pre-patch behaviour.
2. Remove `WAHA_WEBHOOK_ENFORCE` from `.env`, restart → MONITOR (everything passes).
3. Also remove `WAHA_WEBHOOK_SECRET` → DORMANT.
4. Restore the previous version from n8n's workflow version history.

---

## 2 — `/webhook/infra-probe`

### Decision: authenticate **and** stop returning sensitive detail, **and** give it a verdict.

Both, not either. Authentication is the control; redaction is what limits the
damage if the key leaks, if the workflow is ever exported to a public repo (these
exports already are on GitHub), or if someone turns the gate off to debug. And
neither of those addresses the third bug, which is that the endpoint lies.

**The leak.** `Format Probe` returned `connected_number` (the dealership's live
WhatsApp number) and `webhooks: [{url, events}]` — the WAHA webhook list, which
contains the `/webhook/whatsapp-inbound` URL. Exposure 2 was literally publishing
the address of exposure 1. The new `Format Probe` builds its response field by
field and emits only `ok`, `verdict`, `reasons`, `session_status`,
`number_connected` (a boolean, not the number), `webhook_count` and `checked_at`.
The old detail moves behind `NEXUS_PROBE_VERBOSE=true`, off by default.

There is a trap here for whoever edits that node next, and it is written into the
node's comment: once the WhatsApp secret is installed in WAHA, the upstream
`/api/sessions/default` response contains it under
`config.webhooks[].customHeaders`. **Never pass `s` or `s.config` through to the
output.** The old code happened not to, by picking `url` and `events`; the new
code makes it explicit.

**The lie.** `WAHA Sessions` has `neverError: true` *and*
`onError: continueRegularOutput`. `neverError` only swallows non-2xx HTTP
statuses; a dead container is a transport error (ECONNREFUSED), which `onError`
then converts into a data item carrying `error`. Either path produced
`status: null`, and `Respond` still answered HTTP 200. Green was indistinguishable
from dead. The new `Format Probe` fails the check when the transport errored, or
the status is not 2xx, or the session status is not `WORKING`, or no number is
connected, or zero webhooks are configured, and it names the reasons.

`Probe Passed?` (IF) then routes to the existing `Respond` (200) or a new
`Respond Degraded` (503). Two Respond nodes with fixed status codes, rather than
one node with an expression in `options.responseCode`, because a literal integer
is certain to work and an expression in that field is not.

**The missing caller.** Nothing ran the probe. A new `Every 15 Minutes` schedule
trigger feeds `WAHA Sessions`, and `Probe Alarm` throws on a FAIL verdict, which
n8n routes to the configured error workflow `iYJkh1kztWxZXDbT`. It does not throw
on every failing run — WAHA can be down for hours and four alerts an hour trains
everyone to ignore them. `$getWorkflowStaticData('global')` counts consecutive
failures; it alerts on the 1st and then every 8th (~2 hours) until recovery.
`Probe Alarm` is positioned at [1200, 220], below and right of both Respond nodes,
so under `executionOrder: v1` the HTTP response is sent before it throws.

**The gate.** `Probe Auth Gate` (Code) checks `X-Nexus-Probe-Key` against
`$env.NEXUS_PROBE_KEY`, falling back to `?key=` so the probe stays checkable from
a phone browser. It is dormant while the env var is unset. Because this webhook
uses `responseMode: responseNode`, rejection must be *routed*, not dropped —
returning `[]` would hang the request until n8n's webhook timeout. So the gate
always emits one item and `Probe Authorized?` sends failures to
`Respond Unauthorized` (a real HTTP 401, with a body that says nothing about WAHA
and is identical for a missing and a wrong key).

`Run Manually` is left wired to `WAHA Sessions` and keeps working.

**Rollback:** comment `NEXUS_PROBE_KEY` out of `.env` and restart (gate dormant);
disable the `Every 15 Minutes` node to stop the schedule and the alarm; or restore
the previous version.

---

## 3 — `/webhook/slack-command`

### Decision: switch the endpoint off. Do not build Slack signature verification now.

The evidence is decisive, and the previous engineer already wrote it into the
`Auth Gate` node: this workflow has been **edited ~70 times and executed zero
times**. Combined with the guard that is in place, that is not ambiguous.
`SlackWebhook` → `Verify JWT` (Supabase `GET /auth/v1/user`) → `Auth Gate`
requires a Supabase *user* JWT. Slack's servers cannot send one. So every genuine
`/nexus` command is rejected, and always has been. There is no working integration
to preserve — **there is only an open door.**

Meanwhile the guard that is there authenticates without authorizing: any valid
Supabase session token passes, with no check of role, channel or user. Anyone who
lifts a token out of a dashboard session can drive the CRM agent's write tool.

Against that, implementing HMAC verification would mean:

* enabling `rawBody` on `SlackWebhook` (Slack signs the raw request body; n8n's
  parsed form object cannot be re-serialised back to the exact signed bytes);
* rewriting `Extract Command`, which today reads the parsed form fields at `.body`
  and would then have to parse the raw body itself;
* obtaining the signing secret from a Slack app that may not exist yet;
* and it would **create** a working, internet-reachable path from Slack into the
  CRM's write tool — building a new door in the same pass that we are closing two.

None of that can be verified offline, and all of it is work in service of a
feature nobody has ever used. Turning the endpoint off is one action, is
completely effective, and is trivially reversible.

**The action:** unpublish / deactivate workflow `VmnIXo7tM30zqawp`. Deactivating
removes `/webhook/slack-command` from n8n's production router entirely — the URL
starts returning 404, not 200. That is the fix, and it is an owner/operator step,
not something an operations array can express.

### What `OPERATIONS_slack.json` does anyway — defence in depth

The workflow will still exist and someone may reactivate it. The array closes the
three specific weapons behind the door, and should be applied **before**
deactivating, so the endpoint is never briefly reachable with the old tools.

1. **`Update Lead Status` — the unconstrained `$fromAI` status argument.**
   Today the value is `$fromAI('status', …, 'string')` written straight into
   `leads.status` — free text, chosen by a model that an anonymous caller was
   prompting. Now the expression validates against a fixed allowlist
   (`HOT, WARM, COLD, CONTACTED, QUALIFIED, WON, LOST`), upper-cases and trims,
   and throws otherwise. Verified: `hot` → `HOT`, `' Won '` → `WON`,
   `DROP TABLE leads` → throws. This is applied regardless of the disable/enable
   decision, exactly as the brief requires.

2. **`Search Leads` — the bulk dump.** `limit` was 20 and both `ilike` filters
   accepted `%%`, which matches everything: "dump 20 arbitrary leads into a Slack
   channel". The `name` expression now reads both `$fromAI` arguments (same keys,
   byte-identical descriptions so the generated tool schema is unchanged) and
   throws unless there are at least 2 real characters of a name or 3 of an email.
   `limit` drops to 5. The `/*n8n-auto-generated-fromAI-override*/` markers are
   preserved on both fields.

3. **`Post Answer to Slack` — the exfiltration relay.** It POSTs to
   `$json.response_url`, which comes from the caller's request body. The check
   goes in `Format Slack Response` (a real Code node, so it can throw cleanly
   rather than an expression inside an HTTP node): the URL must match
   `^https://hooks\.slack\.com/`. Genuine Slack response URLs always do.

`Verify JWT` and `Auth Gate` are left exactly as they are. They fail closed, and
the comment in `Auth Gate` is an accurate record of why.

### If the dealership ever does want slash commands

Do it as its own piece of work, in this order: create the Slack app and copy the
signing secret into `/opt/nexus/.env` as `SLACK_SIGNING_SECRET`; enable raw body
on `SlackWebhook`; add a Code node that computes
`HMAC-SHA256(signing_secret, 'v0:' + X-Slack-Request-Timestamp + ':' + rawBody)`,
compares it in constant time against `X-Slack-Signature`, and rejects a timestamp
more than 5 minutes old; rewrite `Extract Command` to parse the raw body; add an
authorization check (allowed channel ids, allowed Slack user ids) — signature
verification proves the request came from your Slack workspace, it does not prove
the sender should be allowed to change lead statuses; then remove
`Verify JWT`/`Auth Gate`; then reactivate. Keep all three hardenings above.

---

## Order of application across all three

1. `OPERATIONS_slack.json`, then deactivate `VmnIXo7tM30zqawp`. Lowest risk —
   nothing is using it. Closes one whole exposure immediately.
2. `OPERATIONS_probe.json`, then `NEXUS_PROBE_KEY` in `.env`. Also low risk; the
   probe is not on the customer path. This closes the discovery route to exposure 1.
3. `OPERATIONS_bdc.json`, then the staged rollout above. Highest risk, done last,
   done slowly, at night, with the disable-the-node rollback ready.

## Everything the owner must change outside n8n

* `/opt/nexus/.env`: `WAHA_WEBHOOK_SECRET`, `WAHA_WEBHOOK_ENFORCE`,
  `NEXUS_PROBE_KEY` (and optionally `NEXUS_PROBE_VERBOSE`), each followed by an
  n8n container restart.
* WAHA session config: a custom header `X-Nexus-Webhook-Secret` on the webhook
  entry pointing at `/webhook/whatsapp-inbound`.
* Slack: nothing — the decision is to leave the integration off. If any Slack app
  exists with a slash command pointed at `/webhook/slack-command`, remove that
  command so nobody is confused by a 404 later.

Step-by-step, non-developer instructions are in `OWNER_STEPS.md`.
