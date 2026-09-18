# Arming the WAHA webhook gate — why this is not a browser-UI task

Date: 2026-09-18. Status: **NOT DONE. Owner action required.**

## The request

"Set `WAHA_WEBHOOK_SECRET` and `WAHA_WEBHOOK_ENFORCE` — do it from the browser UI."

## Why the browser UI cannot do it

`WAHA Auth Gate` (workflow `BiyHk9ZXxJUVGbf6`) reads `$env.WAHA_WEBHOOK_SECRET`
and `$env.WAHA_WEBHOOK_ENFORCE`. `$env` in n8n is the **process environment of the
n8n container on the GCP VM** (`/opt/nexus/.env` -> docker compose). The n8n web UI
has no field that writes `$env`. n8n *Variables* are a different namespace (`$vars`)
and the gate does not read them. So there is no browser path to this change.

The tenant-scoped replacement (`ops/tenant-scope-bdc/…TENANT_SCOPED.json`) reads
`$env['WAHA_WEBHOOK_SECRET__' + TENANT_SLUG_UPPER]` — same story, same host.

## Why I am not typing the secret

Standing rule in this project: I do not type, handle or repeat secrets, passwords,
API keys, tokens or OTPs into any field. Browser or computer-use permission does not
change that. Same reason the n8n password and the GitHub sudo-mode code stayed with
Ali. The secret is generated on the VM and never passes through a transcript.

## This is a 5-step traffic-affecting rollout, not two env vars

Full detail: `ops/n8n-bundle-NOT-DEPLOYED/07-waha-webhook-secret-rollout-NOT-DEPLOYED.md`.
Gate states:

| SECRET | ENFORCE | mode | behaviour |
|---|---|---|---|
| unset | anything | DORMANT | everything passes. **This is the box today.** |
| set | != true | MONITOR | everything passes, tagged `_gate.mode` |
| set | true | ENFORCE | items without matching header dropped **silently** |
| unset | true | fails closed | drops **everything** |

**Setting both at once, today, drops every real customer WhatsApp message silently
— WAHA still sees HTTP 200 (`responseMode: onReceived`), so nothing reports an error.**

### Owner steps (run on the VM, not from a browser)

```
# 1. VM: set the secret only. Do NOT set ENFORCE yet.
cd /opt/nexus
openssl rand -hex 32            # generate; do not paste this value into chat
#   add to /opt/nexus/.env:   WAHA_WEBHOOK_SECRET=<that value>
docker compose up -d n8n        # gate: DORMANT -> MONITOR, behaviour unchanged

# 2. WAHA (the box, 35.224.126.225): add to the webhook config
#    config.webhooks[].customHeaders:  x-nexus-webhook-secret: <same value>

# 3. Observe MONITOR. saveDataSuccessExecution="all", so every execution is saved.
#    Require, from every source you intend to keep:
#      _gate.mode == "MONITOR"  &&  _gate.header_present == true  &&  _gate.ok == true
#    Must include at least one genuine 1:1 customer message, not only group/broadcast.

# 4. Only then:  WAHA_WEBHOOK_ENFORCE=true  in .env  ->  docker compose up -d n8n

# 5. Send one real WhatsApp from a handset and confirm a reply arrives.
#    The gate drops silently; a broken rollout looks exactly like a quiet day.
```

### Still-open precondition (step 0)

`2.50.10.149` — Ali's Windows desktop `desktop-l3an0ma`, WAHA in Docker Desktop,
same WhatsApp account on linked device 8. Stopped by hand 8 Sep 2026 06:08:24 UTC,
but `restart: always` is still declared and device 8 is still linked, so a reboot
brings it back. Close it with `docker update --restart=no n8n n8n-db waha` on that
PC plus unlinking device 8.

## The alternative that closes the hole now, with no secret

Unpublish `BiyHk9ZXxJUVGbf6` via the n8n MCP. Reversible in one call. Cost: inbound
WhatsApp stops. Measured context — sampled traffic was group / `status@broadcast` /
`@newsletter` only, zero genuine customer conversations, and what does arrive lands
in `__unattributed__` quarantine and reaches no dealer. **Not done — awaiting Ali's
decision, because he chose the env-var route.**
