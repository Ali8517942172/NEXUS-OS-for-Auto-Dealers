# Meta Lead Ads — the steps only a human can do

**Written 16 September 2026.** Everything in this file happens at
`business.facebook.com` or `developers.facebook.com`, in a browser, signed in as
someone who actually owns the Business. No script in this repository can do any
of it: Meta requires a person to click, and it requires that person to hold the
Business.

`GO-LIVE.md` is the database and box sequence. This file is the Meta side. They
meet at step 5.

> **Nothing in this file asks you to paste a token into a chat, a ticket, a
> commit or this repository.** A token is installed once, into the vault, by the
> call in step 6. If anyone ever asks you to send them the token itself, the
> answer is no — including if they say they are helping with this file.

---

## The order, and why it is this order

```
1  System User exists and holds the Page
2  token issued with the two scopes
3  Lead Access Manager grant            <- the failure that looks like success
4  webhook: object "page", field "leadgen"
5  POST /{page-id}/subscribed_apps      <- the step everybody skips
6  install the token into the vault
7  register the Page against the dealership   (GO-LIVE.md step 1)
8  enable the endpoint                        (GO-LIVE.md step 4)
9  Lead Ads Testing Tool -> prove a real row
10 only now, spend ad budget
```

**Steps 8 and 10 are last on purpose.** `nexus_lead_source_readiness()` reports
a source as `CONNECTED` the moment an active production endpoint exists — that
is the whole test. It does not know whether the token works, whether the Graph
hop succeeds, or whether one lead has ever arrived. Enabling the endpoint before
step 9 passes puts a green pill in front of a dealership over a source where
every lead stops at `RECEIVED` and no salesperson ever sees a customer. That
already happened once, on 7 September, and the endpoints were disabled again the
same day.

Spending ad budget before step 9 is the same mistake with money attached. Leads
bought before the Graph hop works are not recoverable: the webhook is answered,
the row is written at `RECEIVED`, and the customer's details expire on Meta's
side.

---

## 1 · A System User that holds the Page

`business.facebook.com` → **Business Settings** → **Users** → **System Users** →
**Add**.

- Name it for the job, not for a person: `nexus-lead-ingest`.
- Role: **Employee** is enough. Admin is not required and should not be given.
- Then **Add Assets** → **Pages** → select the dealership's Page → grant
  **Manage Page** (or at minimum the Page role your Business allows that
  includes lead access).

**Why a System User and not your own login.** A Page token minted from a person
expires — the short-lived one within hours, the long-lived one in about two
months — and it dies entirely when that person leaves the dealership. The
symptom is not an error anyone sees: it is the dealership's Facebook leads going
quiet some weeks after go-live with a green "Connected" pill still on the
screen. A System User token does not expire on a schedule.

## 2 · Issue the token, with exactly two scopes

Still in **System Users**, select `nexus-lead-ingest` → **Generate New Token**.

- App: the Meta app that owns the webhook subscription (step 4).
- Scopes — tick exactly these two:
  - **`leads_retrieval`** — without it, `GET /v25.0/<leadgen_id>` answers
    **code 10**.
  - **`pages_show_list`** — without it the token cannot see the Page at all and
    step 5 fails.
- Token expiration: **Never**.

Copy it **once**, straight into step 6. Do not paste it anywhere else on the
way. If you lose it, generate a new one — that is cheaper than a token in a
chat log.

## 3 · Lead Access Manager — the failure that looks like success

**Business Settings** → **Integrations** → **Lead Access Manager** → select the
Page → **Assign** → add both:

- the **System User** from step 1, and
- the **app** from step 2.

**Read this paragraph twice.** Steps 1 and 2 give the token the *right to ask*.
This step gives it the *right to be answered*. They are separate grants in two
different screens and Meta does not warn you that you have done only one. The
symptom of missing this step is the worst one in the whole system:

- the webhook delivery arrives,
- the HMAC verifies,
- we answer Meta `200`,
- a `lead_event` row is written at phase `RECEIVED`,
- Meta's dashboard shows the lead as delivered,
- `GET /v25.0/<leadgen_id>` answers **code 200** (or **code 10**),
- and **no customer ever reaches a salesperson**.

Everything looks connected. Nothing is. `Fetch Lead From Graph` names this case
`GRAPH_LEAD_ACCESS_NOT_GRANTED` and says so in its `why` — that reason text
exists specifically so this step is the first place you look.

## 4 · Subscribe the webhook to `leadgen`

`developers.facebook.com` → your app → **Webhooks**.

- Object: **Page** — *not* `whatsapp_business_account`. If you subscribe the
  wrong object to this URL, `Verify Or Refuse` refuses it by name with
  `WRONG_WEBHOOK_OBJECT` and tells you which URL that delivery belongs at.
- Callback URL: `https://35.224.126.225.nip.io/webhook/meta-lead-ads`
- Verify Token: the value of `META_WEBHOOK_VERIFY_TOKEN` on the box.
- Subscribe to field: **`leadgen`**. (`leadgen_update` is optional; the receiver
  ignores non-`leadgen` Page fields and says it did.)

Click **Verify and Save**. Meta immediately sends a `GET` with `hub.challenge`
and expects the bare challenge value echoed back. A wrong verify token is
answered `403 HUB_VERIFY_TOKEN_MISMATCH`.

**A confirmed subscription is not a delivered lead.** The executions this
produces run `webhook → Verify Or Refuse → Respond Without Writing` and stop.
Nothing is written and nothing should be.

## 5 · `POST /{page-id}/subscribed_apps` — the step everybody skips

Step 4 subscribes **the app** to the `leadgen` field. It does **not** subscribe
**this Page** to **this app**. Both are required, and Meta's UI shows you only
the first one. Without this call the handshake succeeds, the app looks
subscribed, and no delivery ever arrives.

In the **Graph API Explorer**, with the System User token selected:

```
POST /v25.0/{page-id}/subscribed_apps
     subscribed_fields=leadgen
```

Confirm it:

```
GET /v25.0/{page-id}/subscribed_apps
```

The response must list your app with `leadgen` in `subscribed_fields`. An empty
`data: []` means this step did not take, whatever the Webhooks screen says.

## 6 · Install the token into the vault — never into `.env`

One SQL statement, run by whoever holds production access, with the token pasted
into the placeholder and nowhere else:

```sql
select public.nexus_lead_ingest_secret_put(
  p_endpoint_id  => '4d4f5cf2-f966-4d4e-9d9e-605757c615b7',  -- meta_lead_ads_facebook, ALBA CARS
  p_kind         => 'meta_page_access_token',
  p_secret       => '<<< paste the System User token here, then clear your clipboard >>>',
  p_installed_by => 'owner: <your name>, per ops/n8n-meta-lead-ads/OWNER-RUNBOOK.md step 6'
);
```

For dealership number two, resolve the endpoint rather than pasting a UUID:

```sql
select public.nexus_lead_ingest_secret_put(
  p_endpoint_id  => (select e.endpoint_id
                       from public.lead_ingest_endpoint e
                       join public.tenants t on t.id = e.tenant_id
                      where t.slug = '<dealership slug>'
                        and e.source_key = 'meta_lead_ads_facebook'
                        and e.environment = 'production'),
  p_kind         => 'meta_page_access_token',
  p_secret       => '<<< paste >>>',
  p_installed_by => 'owner: <name>'
);
```

**Do not put the token in `/opt/nexus/.env` as `META_PAGE_ACCESS_TOKEN`.** That
variable still exists and still works, but only while
`NEXUS_REQUIRE_PER_DEALER_SECRETS` is not `true`, and it is a one-dealership
design: dealership number two's leads would be fetched with dealership number
one's token, which Meta answers `code 200` — or, far worse, answers for a Page
both happen to share. Once every live dealership's token is in the vault, set
`NEXUS_REQUIRE_PER_DEALER_SECRETS=true` and recreate **both** the `n8n` and
`n8n-worker` containers. The box runs in queue mode; recreating only `n8n`
leaves the container that actually executes nodes on the old value, and that
already cost a day once.

Verify without printing it:

```sql
select endpoint_id, kind, installed_by, created_at
  from public.nexus_lead_ingest_secret
 where kind = 'meta_page_access_token';
```

One row, correct endpoint, recent timestamp. That is the whole check. **There is
nothing to prove against Meta until step 9** — a token cannot be exercised
without a real `leadgen_id`.

## 7 · Register the Page against the dealership

`GO-LIVE.md` step 1, unchanged. `lead_ingest_provider_identity` with
`provider = 'meta'`, `identity_kind = 'facebook_page_id'`,
`identity_value = <the Page id, digits only>`.

The Page id is **not a secret** — it is on the Page's About tab. It may go in a
ticket or in this repository. Nothing about the security of this path rests on
it being unknown; it rests on the HMAC over the raw bytes and on this row.

## 8 · Enable the endpoint

`GO-LIVE.md` step 4. Facebook first; Instagram is a separate statement and a
separate decision.

## 9 · Prove it with the Lead Ads Testing Tool

`https://developers.facebook.com/tools/lead-ads-testing`. Select the Page and the
form, **Create Lead**.

What must be true afterwards, in this order — check all three, not just the
first:

| check | query | expected |
|---|---|---|
| the delivery arrived and verified | n8n execution list for `meta-lead-ads` | one execution reaching `Record Lead Event` |
| the customer was fetched | `select phase, hydrated_at from public.lead_event where source_key like 'meta%' order by created_at desc limit 1` | `PROMOTED`, `hydrated_at` not null |
| a salesperson can see them | `select full_name, phone_e164 from public.leads order by created_at desc limit 1` | the test lead's details |

**A row stuck at `RECEIVED` is step 3.** Open the execution, read
`reason_code` on the `Fetch Lead From Graph` node, and go back to whichever step
it names. That is what the reason codes are for.

## 10 · Only now, spend ad budget

A lead bought before step 9 passes is a customer who filled in a form and was
never contacted, and there is no way to go back for them.

---

## Reason codes, and which step each one sends you to

| `reason_code` | go back to |
|---|---|
| `HUB_VERIFY_TOKEN_MISMATCH` | step 4 — verify token |
| `WRONG_WEBHOOK_OBJECT` | step 4 — object is `page`, not `whatsapp_business_account` |
| `SIGNATURE_MISMATCH` | the app secret on the box is not this app's secret |
| `PAGE_NOT_REGISTERED` | step 7, then step 8 |
| `NO_PAGE_TOKEN_FOR_THIS_PAGE` | step 6 |
| `GRAPH_TOKEN_REJECTED` (190) | steps 1–2 — re-issue the System User token |
| `GRAPH_LEADS_RETRIEVAL_PERMISSION_MISSING` (10) | step 2 — the `leads_retrieval` scope |
| `GRAPH_LEAD_ACCESS_NOT_GRANTED` (200) | **step 3** — Lead Access Manager |
| `GRAPH_LEAD_HAS_NO_FIELD_DATA` | the lead form itself asks for nothing |
| `NORMALIZED_FULL_NAME_REQUIRED` / `NORMALIZED_NEEDS_EMAIL_OR_PHONE` | the lead form does not collect enough to contact anyone |
| no execution at all | **step 5** — `subscribed_apps` |
