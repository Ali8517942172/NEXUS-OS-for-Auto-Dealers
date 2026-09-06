# 06 — Which control belongs on which webhook — **NOT DEPLOYED**

**One mechanism for all eleven would be wrong.** The endpoints have three
different callers, and a caller determines what can be proved about it.

## What "authentication: ABSENT" actually means

n8n's `webhook` node has an optional `authentication` parameter (basic / header /
JWT). On this box **not one business webhook sets it.** Every guard is downstream
application logic, so the endpoint accepts the request, returns its configured
response, and starts an execution *before* anything refuses. Ten refuse
correctly; one does not (see 07).

**Verified directly today, from the live published definitions — 5 of 11:**

| path | workflow | webhook node `parameters` | `authentication` |
|---|---|---|---|
| `whatsapp-inbound` | `BiyHk9ZXxJUVGbf6` | `{httpMethod:"POST", path:"whatsapp-inbound", options:{}}` | **ABSENT** |
| `slack-command` | `VmnIXo7tM30zqawp` | `{httpMethod:"POST", path:"slack-command", options:{responseData:"NEXUS is on it…"}}` | **ABSENT** |
| `whatsapp-send` | `yx6m55p1Kj8V7koR` | `{httpMethod:"POST", path:"whatsapp-send", responseMode:"lastNode", options:{}}` | **ABSENT** |
| `deals/closed-won` | `dhy2DDjWUqwuzHLW` | `{httpMethod:"POST", path:"deals/closed-won", responseMode:"responseNode", options:{}}` | **ABSENT** |
| `nexus-inbound-lead` | `JnlZFAVmFAuNXVya` | `{httpMethod:"POST", path:"nexus-inbound-lead", options:{}}` | **ABSENT** |

The remaining six (`lead-trigger`, `ask-ai`, `finance-calc`, `audit-kyc`,
`lead-escalation`, `erp-sync`) I did **not** re-open today. Their status is taken
from the live test recorded in `CLAUDE.md` on 3 September. Stated so nobody
upgrades an inherited claim into a measurement.

---

## Endpoint 1 of 3 kinds — `whatsapp-inbound`: **shared secret**

Caller: WAHA, a server we control. A shared header is provable and cheap.
The mechanism already exists in the workflow (`WAHA Auth Gate`) and is dormant
because `WAHA_WEBHOOK_SECRET` is unset on the VM. **This is change 07 and nothing
else.** Do not put a JWT here: WAHA has no user session and no way to obtain one.

## Endpoint 2 of 3 kinds — `slack-command`: **Slack request signing**

Caller: Slack's servers. Slack cannot carry a Supabase JWT, so the current
`Auth Gate` is a lock rather than an integration — see file `00`, which corrects
the claim that this endpoint is closed by accident. It is closed by design.

The correct control, when someone actually wires a slash command:
HMAC-SHA256 of `'v0:' + X-Slack-Request-Timestamp + ':' + the RAW request body`,
keyed with the app signing secret, compared in constant time against
`X-Slack-Signature`, plus a ±5-minute timestamp window against replay.

Three prerequisites the current workflow does not meet, all named in the node's
own comment: `rawBody` enabled on `SlackWebhook`, a rewrite of `Extract Command`
(which today reads the parsed form object at `.body`), and the signing secret in
n8n. **And one consequence that is easy to miss: Slack signing authenticates
Slack, not a dealership.** The tenant today hangs off the Supabase user in the
JWT, so swapping the gate for signature verification *removes the only tenant
signal this workflow has*. Map Slack `team_id` → tenant in the same change or the
CRM agent becomes tenant-blind.

**Not scheduled in this bundle.** There is no Slack integration to protect and no
revenue behind it.

## Endpoint 3 of 3 kinds — the dashboard endpoints: **the JWT, validated at the edge**

Caller: `apps/executive-dashboard`, a **public JavaScript bundle**. Anything you
put in that bundle is readable by anyone who opens the site. **A shared secret
here is worthless** — it would be a secret published on the internet, and worse
than nothing because it would look like a control in an audit.

The JWT is the right control, and these workflows already check it: each runs
`Verify JWT` → `GET https://dsvuoovivysszdoiorch.supabase.co/auth/v1/user` with
the caller's `Authorization` header, then refuses when the response carries no
`.id`. Confirmed live on `whatsapp-send` (`Auth OK?` → `Respond Unauthorized`),
`deals/closed-won`, `nexus-inbound-lead` and `slack-command`. The `Auth Gate`
comment in `VmnIXo7tM30zqawp` names the same pattern in Lead Escalation, KYC,
ERP Sync, Ask-AI and the drip.

**So the JWT is not missing. What is missing is where it is checked.**

> **A count worth reconciling.** The brief called these "the eight dashboard
> endpoints". Counting the live `workflow_registry` rows I get **nine**: the
> eleven business POST webhooks (`infra-probe` is a GET and is excluded) minus
> `whatsapp-inbound` and `slack-command`. The nine are `lead-trigger`, `ask-ai`,
> `finance-calc`, `audit-kyc`, `lead-escalation`, `nexus-inbound-lead`,
> `deals/closed-won`, `erp-sync`, `whatsapp-send`. `erp-sync` is arguably
> server-to-server rather than dashboard-called, which would make it eight —
> I have not opened that workflow, so I am not asserting either way. The control
> is the same for all nine; only the label is in question.

### The honest upgrade: validate the JWT at the edge

Today an unauthenticated POST to any of these paths:

1. is accepted by Caddy,
2. starts an n8n execution,
3. makes an outbound HTTPS round trip to Supabase `/auth/v1/user`,
4. is refused by a downstream node,
5. and leaves an execution row.

Anyone who knows a path can spend the box's CPU and an outbound request per
POST, indefinitely, for free. On an e2-micro that is the whole machine —
`CLAUDE.md` already records this VM being CPU-starved and executions queueing
(and I saw 96 `status:"new"` never-executed WhatsApp executions in today's
listing, ids 10122–10217).

Move the check in front of n8n:

- **Where:** Caddy on the VM, in front of `/webhook/*`, for the nine dashboard
  paths only. `whatsapp-inbound` must be excluded (WAHA has no JWT) and
  `slack-command` must be excluded (Slack has no JWT).
- **What:** verify the `Authorization: Bearer` JWT's signature against the
  Supabase project JWT secret and check `exp`. That is a local signature check,
  not a call to `/auth/v1/user`, so it costs no network round trip.
- **What it buys:** an unauthenticated caller gets a real **401 before n8n is
  reached**. No execution, no CPU, no outbound request, no execution row.
- **What it does not buy, and must not be claimed:** it authenticates a *signed-in
  user*, not a *dealership*. The `Tenant For JWT User` → `tenant_members` lookup
  inside each workflow is still what resolves the tenant, and it must stay.

**This is a VM/Caddy change, not an n8n change.** It is in this bundle because it
is the honest answer to "the eleven webhooks carry no authentication", and because
writing "add a shared secret to all eleven" would have been the wrong answer for
nine of them.

### Do NOT set n8n's own `authentication` parameter on these nodes

It is tempting because the field exists. n8n offers basic auth, header auth and a
JWT credential — none of which validates a *Supabase* JWT against the project
secret with the claims these workflows read. Setting header auth would put a
shared secret back into the public bundle. Leave the parameter absent and fix it
at the edge.

## What breaks if applied out of order

- **Edge JWT validation must not be applied to `whatsapp-inbound`.** If it is,
  every real customer message is 401'd at the door and the WhatsApp channel dies
  silently — WAHA keeps getting a response and never backs off. Excluding that
  path is the single most important line of the Caddy config.
- **Apply after 05.** With the probe published you can see within 15 minutes if a
  Caddy rule caught a path it should not have.
- **Apply before 07** if you want, or after — they are independent. But do not do
  them in the same change window: both can produce "the bot stopped replying", and
  you need to be able to tell which one did it.

## Verify

See `VERIFY.md` §06.

## Roll back (under a minute)

Remove the matcher block from the Caddyfile and `caddy reload`. No n8n workflow
was edited, so there is nothing to republish.
