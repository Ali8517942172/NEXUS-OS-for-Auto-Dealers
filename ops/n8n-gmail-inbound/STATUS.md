# STATUS — Gmail inbound lead receiver

Measured 2026-09-16. Three columns, kept apart on purpose: **code exists** is not
**wired**, and **wired** is not **has ever received a real payload**. Collapsing
those three is how a system comes to claim a channel it has never carried a
customer on.

| Thing | Code exists | Wired | Ever received a real payload |
|---|---|---|---|
| `parse-lead-email.node.js` | **YES** — 47 assertions pass (`node ops/n8n-gmail-inbound/parse-lead-email.test.js`) | **NO** — not imported into n8n | **NO** |
| `gmail-inbound.workflow.json` | **YES** — authored, JSON parses, all connection targets resolve, `"active": false` | **NO** — never imported to the n8n box | **NO** |
| Dedicated ingest Gmail inbox | n/a | **DOES NOT EXIST** | **NO** |
| Inbound Gmail OAuth credential | n/a | **DOES NOT EXIST**. The only Gmail credential on the box, `1Cgivoyjt7psAirH`, is **outbound send** and must stay that way. The workflow ships with a deliberately unresolvable placeholder id so an import cannot bind the wrong one. | **NO** |
| `lead_ingest_endpoint` row for `marketplace_email_notification` | n/a | **DOES NOT EXIST** — confirmed by SELECT, 2026-09-16. The five endpoint rows on production are google_ads_lead_form, meta_lead_ads_facebook, meta_lead_ads_instagram (all `disabled`), phone_call and walk_in (both `active`). | **NO** |
| `mailbox_read_oauth` as a provenance kind | n/a | **DOES NOT EXIST YET** — the orchestrator's migration. See the blocker below. | n/a |
| `lead_event` rows with `origin_verified = 'mailbox_read_oauth'` | n/a | n/a | **ZERO** |

**No inbound email of any kind has ever entered this system.** The
`marketplace_email_notification` catalogue row and the simulator scenario that
references it are not a receiver; they are a description of one.

---

## The blocker the orchestrator has to clear first

Confirmed by SELECT on production, 2026-09-16:

- `lead_source_catalogue.marketplace_email_notification.required_provenance` is
  **`hmac_sha256_svix`**. That is Resend's webhook signature shape. Resend is
  banned.
- `lead_ingest_endpoint` carries
  `CHECK (environment <> 'production' OR declared_provenance = required_provenance_for_source)`.

So **a production email endpoint cannot be inserted at all** until
`required_provenance` becomes something Gmail polling can honestly declare. This
code assumes that value will be **`mailbox_read_oauth`**.

Two things the orchestrator should check while writing that migration, both
found by reading the live constraints:

1. `lead_ingest_endpoint_secret_ref_required` lists
   `hmac_sha256_x_hub, hmac_sha256_svix, shared_secret_header, shared_secret_in_body`.
   `mailbox_read_oauth` is not among them, so **no `secret_ref` will be
   required** — which is correct, because there is no shared secret here. The
   OAuth token lives in n8n's credential store, not in this table.
2. `lead_source_delivery_shape` permits
   `INBOUND_EMAIL_METADATA_THEN_FETCH`, which is the row's current value. The
   Gmail Trigger with `simple: false` hands over the **whole message**, not
   metadata to be fetched separately. The value is not wrong enough to block
   anything, but it describes a two-hop shape this receiver does not use.
   Worth a decision, not a silent leave-as-is.

Not my call and not my table. **I wrote nothing to the database.** Every
statement above came from a `SELECT`.

---

## The endpoint row must be created `disabled`, and that is not a formality

When the orchestrator inserts the `marketplace_email_notification` row, it must
have `status = 'disabled'`.

`status = 'active'` is a claim that this dealership has a working email lead
channel. Today that claim would be false in five separate ways at once: no
inbox, no credential, no imported workflow, no forwarding rule, and no message
ever parsed outside a test harness.

**The row goes `active` on the day a real email produces a real `lead_event` —
not the day the row is written.** The acceptance test is one sentence:

> Send a real lead email to the ingest address; a `lead_event` appears with
> `origin_verified = 'mailbox_read_oauth'`, and either a `lead` row appears or a
> `REJECTED` event names its own defect.

Until then, disabled.

> **Do not enable the row to make the pill green.** The dashboard pill reads
> `status`. Flipping it turns an honest "not connected yet" into a dishonest
> "connected", and the next person to look — an owner, a dealer, an auditor —
> has no way to tell the difference. The two disabled Meta endpoints and the
> disabled Google endpoint on this project are already carrying that discipline;
> this row joins them.

---

## What is actually proven

- The parse body's behaviour, against 47 assertions, in a harness — **not** on
  the n8n box, **not** against a real Gmail payload. A harness proves the logic;
  it does not prove the Gmail Trigger emits the shape the harness feeds it. That
  is why the body handles both known header shapes and why Step 6 of the runbook
  says to run the workflow manually once and read every node's output before
  activating anything.
- The workflow JSON parses and its connections resolve. **NOT RUN** on n8n.
- The Code node body in the workflow is byte-identical to the tested file.

## What is not proven and should not be claimed

- That the Gmail Trigger's real output shape matches either fixture.
- That any marketplace's real notification template contains labelled fields
  this parser recognises. Nobody has read one yet.
- That `mailbox_read_oauth` will be accepted by the database, because it does
  not exist yet.
- Anything at all about deliverability, forwarding, or SPF/DKIM behaviour in
  practice.

## Files

```
ops/n8n-gmail-inbound/
  parse-lead-email.node.js     the Code-node body (single source of truth)
  parse-lead-email.test.js     47 assertions, dependency-free, node <file>
  gmail-inbound.workflow.json  importable, active:false, placeholder Gmail cred
  SETUP-RUNBOOK.md             owner steps, quota numbers, four failure modes
  STATUS.md                    this file
```
