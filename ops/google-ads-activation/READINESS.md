# Google Ads lead form — readiness, component by component

Measured 13 September 2026 against `/home/claude/repo` @ `wip/gate-L9-2026-09-03-continued`
and the production project `dsvuoovivysszdoiorch` (read only).

Four words, used strictly:

* **IMPLEMENTED** — the code or the row exists and can be read.
* **TESTED** — something automated exercised it and passed, here, with a result
  I can quote.
* **DEPLOYED** — it is on the box or in the database that serves real traffic.
* **PROVEN** — a real Google delivery went through it and left evidence.

**Nothing in this table is PROVEN.** No Google lead has ever arrived. `lead_event`
holds one row in its entire life and that row is the 7 Sep walk-in preflight
fixture; nothing named `google` has ever written an `audit_log` row.

| # | Component | IMPL | TEST | DEPL | PROVEN | Evidence |
|---|---|---|---|---|---|---|
| 1 | Endpoint registry row `google_ads_lead_form` | yes | — | **disabled** | no | `lead_ingest_endpoint`: `status='disabled'`, `public_key='alba-prod-google-leadform-0001'`, `declared_provenance='shared_secret_in_body'`, **`ingest_address` NULL**. Restated in `ops/v1-certification/V1-CERTIFICATION-MATRIX.md:28` |
| 2 | Tenant resolution from the URL key | yes | yes | yes | no | `supabase/migrations/20260907023225_leadingest_02_tenant_bound_endpoints.sql:134-161` — joins `e.status='active' and t.status='active'`, so component 1 being `disabled` means this returns **zero rows today** |
| 3 | n8n receiver workflow `EYva4c2bMV5MGq0o` | yes | yes | yes | no | `ops/n8n-google-lead-form/README.md:3` (published 7 Sep). Graph: `ops/n8n-google-lead-form/receiver.sdk.js:744-756` |
| 4 | Node bodies (extract / verify+redact) | yes | **yes** | yes | no | `node ops/n8n-google-lead-form/receiver.test.js` → **56 passed, 0 failed**, run 13 Sep 2026. Runs the deployed node bodies, and asserts the status code of every refusal |
| 5 | Refusal status codes up to the secret check | yes | yes | **yes, measured on the wire** | n/a | `ops/n8n-google-lead-form/README.md:9-19` — six live probes on 35.224.126.225, 7 Sep 2026 |
| 6 | Per-endpoint secret on the VM | — | — | **NO** | no | Live probe returned `500 ENDPOINT_SECRET_NOT_CONFIGURED` (README:16). `secret_ref` is read from our database, the value is read from `$env` at `ops/n8n-google-lead-form/verify-and-redact.node.js:127`. **Owner must set it.** |
| 7 | `nexus_record_lead_event` — door one | yes | yes | yes | no | `supabase/migrations/20260907190000_…:65-193`. `ON CONFLICT ON CONSTRAINT lead_event_identity_key DO NOTHING` + re-read (:165-181). Concurrency measured: five backends, one insert, four duplicates, no exception — `ops/journey-lab/TEST-MATRIX.md` T21 |
| 8 | `nexus_promote_lead_event` — door three | yes | yes | yes | no | `supabase/migrations/20260907240000_…:36-127`. `FOR UPDATE` at :50 (without it, five concurrent promotions made **three** leads on staging) |
| 9 | `audit_log` row on promotion | yes | — | yes | **no** | `supabase/migrations/20260907240000_…:110-124`, `workflow = 'ingest:' || r.source_key`. Fails closed: if the audit insert raises, the promotion rolls back with it (:29-33). No `ingest:google_ads_lead_form` row has ever existed |
| 10 | `leads` row → executive dashboard | yes | — | yes | no | Promotion writes `status='new'` (`20260907240000_…:82`). The dashboard reads `leads`; it has never read a Google-sourced one |
| 11 | **Bitrix24 CRM sync** | partial | — | — | **no — and not wired** | See "The two hops that do not exist" below |
| 12 | **Slack notification** | — | — | — | **no — and not wired** | See below |
| 13 | Google Ads account + lead form asset | — | — | **NO** | no | No Google Ads account is connected to this tenant (README:5). **Owner must supply.** |
| 14 | Rate limiting | **no** | — | — | — | `rate_limit_per_minute` is registered and read by the resolver and enforced by nothing (README, "What we do not control") |

## The two hops that do not exist

The task brief asks for evidence at a Bitrix24 hop and a Slack hop. Both are
**unbuilt for this source**, and saying otherwise would be the exact failure this
document exists to prevent.

* **Bitrix24.** `n8n-workflows/wf_108_erp_sync_bitrix24_crm.json` is real and
  maps a NEXUS lead onto `crm.lead.add` (`:155`). It has two entry points: an
  `executeWorkflowTrigger` called by the Master Router, and a backlog fetch
  `GET /rest/v1/leads?status=eq.HOT`. **The Google receiver calls neither.** Its
  graph ends at a `respondToWebhook` node (`receiver.sdk.js:744-756`) — there is
  no node after `Promote To Lead`. And the backlog path cannot pick the lead up
  either: promotion writes `status='new'`, the fetch filters `status=eq.HOT`.
  A Google lead reaching Bitrix24 today requires a human to move it.
* **Slack.** There is no Slack node anywhere in `ops/n8n-google-lead-form/`, and
  no edge from the receiver to `slack_command_center_ai_agent.json` or
  `lead_escalation_ai_agent.json`. Nothing notifies anybody that a Google lead
  arrived.

## Two defects in the registry row itself

1. **`status='disabled'`** — with component 2 requiring `status='active'`, every
   delivery to the live URL today resolves to zero rows and is answered
   `403 GOOGLE_KEY_REJECTED`, which Google **permanently discards**. If the URL
   is pasted into Google Ads before the row is enabled, real enquiries are
   destroyed and no retry brings them back.
2. **`ingest_address` is NULL** — this is the only column in
   `lead_ingest_endpoint` that records *where* a source arrives. Walk-in and
   phone-call endpoints carry `dashboard://lead-drawer`
   (`ops/v1-certification/V1-CERTIFICATION-MATRIX.md:29-30`); the Google row
   carries nothing, so the database cannot answer "which URL do I paste into
   Google Ads" and every certification pass has to reconstruct it from a README.
   `ops/v1-certification/OWNER-STEPS.md:246` already names this as blocking
   certification. The held migration in `held/` fixes both.

## What the owner must supply

1. A Google Ads account connected to ALBA, with a lead form asset (component 13).
2. The shared secret value, set on the n8n VM under the name in `secret_ref`,
   and pasted into the Google Ads lead form's webhook "key" field. It must never
   be typed into this repo, a migration, or a chat.
3. A decision on the held migration in `held/` — it is the only thing that turns
   component 1 from `disabled` to `active`.
4. A decision on whether Bitrix24 and Slack are in scope for go-live. If they
   are, they are new build, not configuration.
