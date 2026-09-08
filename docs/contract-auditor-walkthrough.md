# KYC/AML Document Auditor — Walkthrough
> NEXUS OS · NEXUS OS · Last Updated: 2026-07-17

## Overview

The Contract Auditor is a public-facing AI tool that lets any car buyer upload a contract or RTA invoice and instantly detect hidden fees or KYC document anomalies. It uses Google Gemini Flash (via OpenRouter) for vision analysis.

**Live URL:** https://nexus-contract-auditor.vercel.app
**n8n Webhook:** `https://35.224.126.225.nip.io/webhook/audit-kyc`
**n8n Workflow:** `wf_101` — KYC/AML Document Auditor

---

## Architecture

```
User uploads contract (JPG/PNG/PDF)
        ↓
Vercel Frontend (nexus-contract-auditor.vercel.app)
        ↓ POST /webhook/audit-kyc
GCP VM `nexus-vm` → n8n Docker (published at https://35.224.126.225.nip.io)
        ↓
[Receive Document] Webhook node
        ↓
[OpenRouter Vision] HTTP Request → openrouter.ai/api/v1/chat/completions
  Model: google/gemini-flash-1.5
        ↓
[Parse & Return Result] Code node
        ↓
[Respond to Webhook] → JSON back to browser
        ↓
Frontend renders: VERIFIED / DISCREPANCY stamp, line items, fee comparison
```

---

## n8n Workflow (wf_101) Node Details

| Node | Type | Purpose |
|------|------|---------|
| Receive Document | Webhook POST | Entry at `/audit-kyc` |
| OpenRouter Vision (KYC Analysis) | HTTP Request v4.1 | Gemini Flash vision call |
| Parse & Return Result | Code | Parse AI JSON response |
| Respond to Webhook | Respond to Webhook | Return result to browser |

---

## Expected AI Response Shape

```json
{
  "document_type": "Emirates ID",
  "name": "Ahmed Al-Rashid",
  "id_number": "784-1985-1234567-1",
  "expiry_date": "2027-03-15",
  "nationality": "UAE",
  "is_valid": true,
  "risk_level": "LOW",
  "flags": [],
  "verification_notes": "Document appears authentic."
}
```

For contract audits, the frontend also renders:
```json
{
  "hidden_fee_aed": 0,
  "registration_fee_charged_aed": 420,
  "official_rta_fee_aed": 420,
  "line_items": [{ "label": "RTA Registration", "amount_aed": 420 }],
  "alert": "All fees match official RTA rates."
}
```

---

## How to Test

**Webhook test (curl):**
```bash
curl -X POST https://35.224.126.225.nip.io/webhook/audit-kyc \
  -H "Content-Type: application/json" \
  -d '{"document_url": "https://example.com/contract.jpg"}'
```

**Frontend test:**
1. Open https://nexus-contract-auditor.vercel.app
2. Drag & drop contract image or PDF
3. Click Run Audit — results in 3-5 seconds

**n8n manual test:**
1. https://35.224.126.225.nip.io → login → wf_101 → Execute Workflow

---

## Deployment

**Frontend:** Vercel static deploy from `apps/contract-auditor/index.html`
**Backend:** n8n in Docker on the GCP VM `nexus-vm` (us-central1-a), published over HTTPS at https://35.224.126.225.nip.io

To restart backend, on the VM: `cd /opt/nexus && sudo docker compose -f docker-compose.single.yml restart n8n`

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Could not reach audit service" | On the VM: `cd /opt/nexus && sudo docker compose -f docker-compose.single.yml up -d`, then activate wf_101 in n8n |
| Null AI response | Check OpenRouter credits at openrouter.ai |
| CORS error | Add `Access-Control-Allow-Origin: *` in n8n webhook node |
| n8n unreachable at https://35.224.126.225.nip.io | Check the VM is running and the n8n container is up (`sudo docker compose -f docker-compose.single.yml ps` in `/opt/nexus`) |

---

## Future Improvements

- PDF text extraction before Vision API (saves tokens for digital PDFs)
- Supabase `audit_logs` table for analytics
- IP-based rate limiting
- Arabic contract support
- Downloadable branded PDF audit report
