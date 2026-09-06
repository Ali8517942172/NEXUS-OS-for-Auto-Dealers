# 00 — `slack-command` is closed BY DESIGN, not by accident — **no change required**

**Nothing to deploy. This file exists to retract a claim in `CLAUDE.md`, because
a runbook step built on it would have been wasted work.**

## The claim

`CLAUDE.md`, "The open webhook":

> Also: `slack-command` is closed **by accident**, not by design — its
> `Tenant For JWT User` lacks `alwaysOutputData:true`, so the chain halts before
> `Auth Gate` runs, and unauthenticated probing records SUCCESS with no audit row.

## What the live published definition says

Workflow `VmnIXo7tM30zqawp` — Slack Command Center - AI Agent,
`versionId == activeVersionId == 1d736bd7-eed4-41e2-810c-2e9d383e2063`, `active: true`.

Node `Tenant For JWT User`:

```json
{ "name": "Tenant For JWT User",
  "type": "n8n-nodes-base.httpRequest",
  "alwaysOutputData": true,        <-- present
  "onError": null,
  "retryOnFail": null }
```

**`alwaysOutputData` is `true`.** The premise of the claim is false.

## And the box proves the consequence, not just the setting

The workflow has exactly **one** retained execution, `9325`
(2026-09-03 11:34:45 UTC), and its status is **`error`**, not `success`.
Reading its node data:

| node | executionStatus | output |
|---|---|---|
| `Verify JWT` | `success` | `{ error: { message: '401 - {"code":401,"error_code":"no_authorization",…}' } }` |
| `Tenant For JWT User` | `success` | **`[{ "json": {} }]`** — one empty item, which is exactly what `alwaysOutputData:true` produces from a zero-row PostgREST response |
| `Auth Gate` | **`error`** | `Slack Command Center rejected: unauthorized. A valid Supabase session token is required in the Authorization header.` |

`Auth Gate` **ran**, and it **threw**. `lastNodeExecuted: "Auth Gate"`.

## The corrected statement

`POST /webhook/slack-command` is closed by `Auth Gate`, which is a deliberate,
commented, fail-closed guard. An unauthenticated probe gets HTTP 200 plus the
`"NEXUS is on it"` ack (because `SlackWebhook` responds `onReceived`), and then
**nothing runs**: no AI agent, no Supabase write, no Slack post. The execution is
recorded as `error`, not `success`.

Two things in the original claim survive and should stay in `CLAUDE.md`:

- the 200-plus-ack behaviour is real, and "returns 401" would still be wrong;
- a Supabase user JWT remains the **wrong** guard for a genuine Slack slash
  command (Slack cannot carry one). The endpoint is locked, not integrated. The
  node's own comment says so and is worth keeping.

**Action for Ali: none, on this endpoint.** Delete the "closed by accident"
sentence from `CLAUDE.md` and replace it with the paragraph above. A dependency
on an accident would indeed have been a defect — but there is no accident here.
