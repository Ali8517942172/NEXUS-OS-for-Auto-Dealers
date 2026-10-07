# Site enquiry form — go-live

What makes `https://nexusforautodealers.com` accept an enquiry and put it in a
human's inbox. Written 13 Sep 2026.

The form is broken today: the live endpoint answers **HTTP 503 `not_delivered`**
because the deployed bundle is PR #18 from 8 Sep and predates
`apps/marketing-site/api/lead.js` as it now stands. Nothing below fixes that on
its own — step 5 does.

**Resend is out permanently. Gmail is the email provider.** Do not reintroduce
`RESEND_API_KEY` or `NEXUS_NOTIFY_FROM`; nothing in the repo references them any
more and nothing should.

---

## Already done — no action

| | Evidence |
|---|---|
| `lead.js` migrated off Resend, posts to a guarded n8n webhook | `apps/marketing-site/api/lead.js:26-50` (header), `:148-166` (the POST) |
| Header name and the seven-field body shape fixed | `apps/marketing-site/api/lead.js:49`, `:155-162` |
| Gmail OAuth2 credential exists and has worked since August | `n8n-workflows/lead_escalation_ai_agent.json` — credential id `1Cgivoyjt7psAirH` |
| The `site-enquiry` workflow authored | `ops/site-enquiry/site-enquiry.workflow.json` (not imported — step 2) |
| Simulation endpoint migration authored | `ops/site-enquiry/held/20260913T120000Z_register_the_site_enquiry_simulation_endpoint.sql` (**HELD, not applied** — step 4) |

---

## Owner does

### 1. Set the guard secret in n8n

Generate a long random value yourself. Nobody else generates it, sees it, or
needs it.

| Variable | Where | Secret? |
|---|---|---|
| `NEXUS_NOTIFY_WEBHOOK_SECRET` | n8n container environment (restart n8n after setting it) | **Yes.** This is the whole guard. |
| `NEXUS_NOTIFY_TO` | n8n container environment | No. Recipient address. Optional — defaults to `aliasgher892@gmail.com` inside the workflow. |

n8n must not have `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, or the Code node cannot
read `$env` and the workflow refuses every request. That is the correct way for
a guard to fail, but it is not the state you want.

### 2. Import the workflow

n8n → Workflows → Import from File → `ops/site-enquiry/site-enquiry.workflow.json`.
Open **Email: Site Enquiry (Gmail)** and **the three Audit nodes** and confirm
each shows a bound credential (Gmail OAuth2 API; Supabase account). Then
**activate** the workflow — an inactive workflow answers 404 on the production
webhook path, which `lead.js` reports as `notify_404`.

### 3. Set the same secret in Vercel

| Variable | Where | Secret? |
|---|---|---|
| `NEXUS_NOTIFY_WEBHOOK_SECRET` | Vercel project env (Production) | **Yes.** Must be byte-identical to step 1. |
| `NEXUS_NOTIFY_WEBHOOK_URL` | Vercel project env (Production) | No. Optional; defaults to `https://35.224.126.225.nip.io/webhook/site-enquiry`. Set it only if n8n moves. |

If `NEXUS_NOTIFY_WEBHOOK_SECRET` is unset in Vercel, `lead.js` never calls the
webhook at all and answers 503 `notify_secret_not_configured`.

### 4. Optional — the simulation endpoint

Only if you want the website to also exercise the ingestion contract. Skip it
and everything above still works; `lead.js` treats this path as instrumentation
and a failure here never fails a request.

Read the held file first. It **creates a new tenant**, because production has
only Tenant A (a real dealership) and the quarantine tenant (status
`quarantine`, which the endpoint resolver rejects) — neither is usable and the
file says why. Paste it into the Supabase SQL editor, run it, then run the
`SELECT` at the foot of it and copy the `public_key`.

| Variable | Where | Secret? |
|---|---|---|
| `NEXUS_LEAD_ENDPOINT_KEY` | Vercel project env (Production) | No — it is an identifier, not an authenticator. Still unguessable; do not publish it. |
| `SUPABASE_URL` | Vercel project env | No. |
| `SUPABASE_SERVICE_KEY` | Vercel project env | **Yes.** Service role key. |

All three must be set together or the optional write does not run.

### 5. Deploy

Deploy `main` (or whichever branch carries the current `lead.js`) to Vercel
production. Until this happens the live site keeps serving the 8 Sep bundle and
keeps answering 503 no matter what is configured.

---

## Verification

Run this **after** step 5:

```
curl -i -X POST https://nexusforautodealers.com/api/lead \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://nexusforautodealers.com' \
  -d '{"full_name":"Go-Live Check","email":"you@example.com","phone":"+971500000000","dealership":"Verification run","stock_size":"50-100","message":"Ignore - go-live verification.","submission_id":"golive-2026-09-13-01","elapsed_ms":9000}'
```

Expected: **`HTTP/1.1 200`** and body `{"ok":true,"recorded":null}` — or
`{"ok":true,"recorded":"recorded"}` if you did step 4.

Anything else means it is not live. `503 not_delivered` with `detail` tells you
which step is missing: `notify_secret_not_configured` → step 3;
`notify_401` → the two secrets differ; `notify_404` → workflow not active
(step 2); `notify_unreachable` → n8n is not answering at the URL.

### Evidence must appear in four independent places

1. **The Vercel response** — the 200 above.
2. **The Gmail inbox** at `NEXUS_NOTIFY_TO` — subject
   `NEXUS enquiry: Go-Live Check (Verification run)`.
3. **An `audit_log` row** —
   `select workflow, status, lead_name, summary, logged_at from public.audit_log where workflow = 'Site Enquiry Notification' order by logged_at desc limit 5;`
   Expect `status = 'SUCCESS'`.
4. **A `lead_event` row**, only if you did step 4 —
   `select event_id, tenant_id, phase, source_key, occurred_at from public.lead_event order by occurred_at desc limit 5;`
   `tenant_id` must be `00000000-51b0-4000-a000-000000000001`, never Tenant A's.

**A green n8n execution is not proof.** The Gmail node runs with
`onError: continueRegularOutput`, which means a failed send leaves the execution
green on purpose so the failure can reach an audit row. Five of the six WhatsApp
send nodes in this repo do exactly that and then record "we said this" anyway;
this workflow's **Delivery Report** node is the thing that stops it. Green plus
an inbox plus a `SUCCESS` audit row is proof. Green alone is a screenshot.

To check the failure path deliberately: revoke the Gmail credential, re-run the
curl, and confirm a `503` from Vercel **and** an `audit_log` row with
`status = 'FAILED'` carrying the contact details. That row is the point of the
whole exercise — it is what lets you phone someone whose enquiry did not arrive.

---

## What I could not settle

- **`audit_log.tenant_id` falls to its column default `nexus_default_tenant_id()`.**
  Every one of the sixteen existing workflows that writes this table omits the
  column, so the new workflow does the same rather than diverge. But a NEXUS
  *vendor* enquiry landing under a *dealership's* default tenant is the same
  boundary `lead.js` is careful about, one table over. Worth a decision; out of
  scope for this folder, which owns nothing outside `ops/site-enquiry/`.
- **The held migration has never been executed.** Its constraint reasoning was
  checked against the migration source and the live catalogue read-only. NOT RUN
  is not PASS.
