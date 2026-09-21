# WAHA gate — measured live state, 18 Sep 2026

**Method:** read `_gate` out of saved executions of `BiyHk9ZXxJUVGbf6` via the n8n MCP.
`_gate` is emitted by `WAHA Auth Gate` in every state, so this is the mode the box is
actually in — not the mode a document says it is in.

| execution | started (UTC) | source | `_gate.mode` | `header_present` | `ok` |
|---|---|---|---|---|---|
| 15267 | 2026-09-18 16:08:54 | `35.224.126.225`, WAHA/2026.7.2 | **ENFORCE** | true | true |
| 15283 | 2026-09-18 17:16:32 | `35.224.126.225`, WAHA/2026.7.2 | **ENFORCE** | true | true |

## What this overturns

`ops/n8n-bundle-NOT-DEPLOYED/07-waha-webhook-secret-rollout-NOT-DEPLOYED.md`,
`ops/launch/N8N-TENANT-AUDIT.md` and every derived summary describe the gate as
**DORMANT** ("unset / empty secret, everything passes, this is the box today").
**That is stale.** At 16:08 UTC on 18 Sep the gate was already `ENFORCE`, the box's
WAHA was already sending `x-nexus-webhook-secret`, and the compare was passing.

The claim made earlier on 18 Sep — *"`/webhook/whatsapp-inbound` is unauthenticated,
anyone can write to production"* — was **read off these documents, not measured.**
It was wrong for at least the window above. Correcting it here rather than leaving
the wrong version in the repo.

**Unchanged and still true:** the endpoint answers HTTP 200 before the gate runs
(`responseMode: onReceived`), so an unauthorised caller still gets 200 and a drop is
silent. Never describe this endpoint as returning 401.

## Two live findings from the same measurement

### F1 — the secret is stored in plaintext in n8n execution data

`saveDataSuccessExecution` is `"all"`, and the webhook node saves request headers.
`x-nexus-webhook-secret` is therefore written into the n8n database on **every**
saved execution and is readable by anyone with n8n UI access, the n8n public API,
or the n8n MCP connection. Its blast radius is no longer "the VM" — it is
"anything that can read n8n executions."

Options, none applied yet: prune execution data on a retention window; drop
`saveDataSuccessExecution` to `none` on this workflow (costs the observability that
made this measurement possible); or accept it as an internal-only origin token and
rotate it when n8n access changes. **Decision open.**

### F2 — check `/opt/nexus/.env` for a duplicate `WAHA_WEBHOOK_SECRET` line

A change on 18 Sep appended a freshly generated secret to `/opt/nexus/.env` believing
the gate was DORMANT. The secret the gate compared against at 17:16 is still the one
the box's WAHA sends, so nothing is being dropped **right now** — but if a second
`WAHA_WEBHOOK_SECRET=` line exists, the next container recreate can flip the expected
value to one WAHA does not send, and **every customer message starts dropping silently
with WAHA still seeing 200.**

Owner check, reveals no secret value:

```
grep -c '^WAHA_WEBHOOK_SECRET=' /opt/nexus/.env      # must be 1
grep -c '^WAHA_WEBHOOK_ENFORCE=' /opt/nexus/.env     # must be 1
```

If the first is `>1`, delete the line that does **not** match what the box's WAHA sends
in `config.webhooks[].customHeaders`, then `docker compose up -d n8n` and re-read
`_gate.ok` on the next execution before walking away.

## Still open, unchanged

Step 0 of bundle 07: `2.50.10.149` (`desktop-l3an0ma`) still declares `restart: always`
and WhatsApp linked device 8 is still linked. With the gate now enforcing, if that host
comes back it is dropped rather than double-writing — but it remains an unretired host
holding a live linked device.
