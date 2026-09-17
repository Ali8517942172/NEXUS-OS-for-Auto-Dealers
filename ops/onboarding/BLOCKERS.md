# What stands between today and a paying dealer #2

**17 September 2026.** Evidence gathered read-only from production
`dsvuoovivysszdoiorch` and by rehearsing the onboarding on staging
`wwspuxrbiyagnrnzgate`. Ranked by what bites first.

## The short answer

**A dealer can be given a working NEXUS account today. They cannot be given a
working WhatsApp channel today, and creating their tenant degrades ALBA.**

The account half — tenant, staff, memberships, isolation, lead capture from the
showroom floor and the phone — was rehearsed end to end on staging and **passed**.
The channel half — the dealer's own Meta credentials, which is the entire product
promise — has **never been executed once, for anybody, including ALBA**.

---

## 1 · Creating tenant #2 silently degrades tenant #1 · BLOCKER · bites the same minute

`public.nexus_scoped_tenant_id()` answers only while **exactly one** dealership is
active. It is `coalesce(nexus_current_tenant_id(), <the one active tenant, only if
count = 1>)`. The second active tenant makes it `NULL`, and nothing raises.

**Evidence — production, today:**
`select * from public.nexus_tenancy_readiness()` returns **no BLOCKER row**. One
dealership. The gate is dormant, and dormant reads as green.

**Evidence — staging, 3 active dealerships, measured today:**

| call | returned |
|---|---|
| `nexus_scoped_tenant_id()` | `NULL` |
| `nexus_comm_keys_for_lead('a@b.com','+971500000000')` | `[]` |
| `nexus_comm_keys_for_lead('a@b.com','+971500000000','<tenant>')` | `["+971500000000@whatsapp.lead","971500000000@c.us","a@b.com"]` |
| `search_rag_documents('refund policy', 3)` | `[]` |
| `nexus_tenancy_readiness()` | `BLOCKER — backend scope resolves to no dealership` |

The database's own words for the consequence: *"the Customer 360 nightly batch
syncs nobody, writes no audit row, so the first symptom is a dealership asking why
its customer list emptied … identity resolution stops matching, so inbound messages
create duplicate people."* That hits **ALBA**, not just the new dealer.

**Narrower than `nexus_multi_tenant_blockers()` claims.** That function name-matches
`prosrc` including comments and lists 8 callers. Stripping comments, only
**`nexus_comm_keys_for_lead(text,text)`**, **`nexus_lead_for_comm_key(text)`** and
**`search_rag_documents(text,int)`** genuinely call it (plus the two self-reporting
functions). `nexus_active_dealership_ids`, `nexus_workflow_catalogue` and —
importantly — **`nexus_resolve_channel_tenant`** only mention it in a comment.

**Confirmed good:** at 3 active tenants on staging,
`nexus_resolve_channel_tenant('whatsapp_cloud_phone_number_id','909090909090909')`
still resolved to the correct tenant. Inbound webhook routing survives dealer #2.

**What clears it:** give those three consumers and the Customer-360 batch an explicit
tenant and drive them once per dealership over `nexus_active_dealership_ids()`. The
3-argument overloads already exist and already work — this is wiring, not design.
**What only looks like clearing it:** widening `nexus_scoped_tenant_id()` to pick a
dealership when the caller named none. That trades silence for one dealership's
batch reading another's data.

---

## 2 · The per-dealer credential path has never been run · BLOCKER · bites at first message

This is the one the existing runbook already admits (FACT-169), and it is worse
than the runbook says.

**Evidence — production:**
- `select count(*) from public.channel_secret` → **0**
- `select * from public.nexus_meta_onboarding_status()` → `meta_app_secret`,
  `meta_system_user_token`, `meta_verify_token` all **`MISSING`** for ALBA's number
  `1306545252542419`
- ALBA's `channel_registry.credential_ref` → `env:META_APP_SECRET+META_WA_TOKEN`

So NX930 built the vault, `nexus_channel_secret_put()` /
`nexus_channel_secret_reveal()` exist and are `SECURITY DEFINER`, and **not one
credential has ever been stored in it**. Dealer #1 runs on a single global env var
on the n8n box. Dealer #2 arrives with a different app secret, the receiver checks
the X-Hub signature against ALBA's, and refuses — correctly and fatally.

`ops/n8n-whatsapp-cloud/verify-or-refuse.node.js` *does* call
`nexus_channel_secret_reveal` — but it is source in the repo, not a deployed n8n
workflow, and `ops/n8n-bundle-NOT-DEPLOYED/` (items 00–09) is the standing evidence
that this bundle is not live. **Implemented ≠ deployed.**

**This is what makes "can a dealer be onboarded today" a NO for WhatsApp.**

---

## 3 · Staging cannot rehearse the half that matters · BLOCKER on confidence

Staging is **not** a copy of production: 88 tables vs 118. It is missing
`channel_secret`, `channel_secret_kind`, `lead_ingest_secret`,
`lead_ingest_secret_kind`, and the functions `nexus_channel_secret_put`,
`nexus_channel_secret_reveal`, `nexus_lead_ingest_secret_put`,
`nexus_meta_onboarding_status`, `nexus_multi_tenant_blockers`.

Rehearsal attempt, verbatim:
```
ERROR: 42883: function public.nexus_channel_secret_put(unknown, unknown, unknown, unknown) does not exist
```

It also lacks `lead_ingest_endpoint`'s `_source_fk` and `_provenance_fk`
constraints, so an endpoint insert that passes on staging can still fail on
production. **Any future rehearsal of the credential steps must happen on a
parity environment.** Until then, steps 6, 8 and 10 of the runbook go to a real
dealer untested.

---

## 4 · The WAHA path still resolves tenants from an env map · HIGH

`ops/n8n-bundle-NOT-DEPLOYED/09-channel-registry-tenant-cutover-NOT-DEPLOYED.md`
records that the live `Resolve Tenant` node still reads `NEXUS_TENANT_MAP` rather
than `channel_registry`. Production `channel_registry` confirms the single WAHA row
is `external_identifier='default'`, `credential_ref='env:WAHA_API_KEY'` — one
container, one key, one number. `SCHEMA_GAPS.md` G1/G2 add that `channel_registry`
has **no endpoint/URL column at all** and `nexus_channel_secret_reveal()` is
hard-coded to `channel_type='whatsapp_cloud_phone_number_id'`, so a WAHA secret has
no schema home. A second dealership on WAHA would send from ALBA's number.

Relevant only if dealer #2 is offered WAHA rather than Cloud API. ADR-004's answer
is Cloud API (path B), so treat this as "do not offer WAHA to dealer #2."

---

## 5 · Paid-ad lead ingestion is disabled, for everyone · HIGH

Production `lead_ingest_endpoint` for ALBA: `meta_lead_ads_facebook`,
`meta_lead_ads_instagram`, `google_ads_lead_form` and
`marketplace_email_notification` are all **`status='disabled'`**. Only `walk_in`
and `phone_call` — both `operator_recorded`, both typed in by a human at
`dashboard://lead-drawer` — are `active`. `lead_ingest_secret` has **0 rows**.

**"We capture your Facebook and Google leads automatically" is not a claim
production supports today, for dealer #1 or dealer #2.** What it does support is a
salesperson recording a walk-in or a phone call. Sell that.

---

## 6 · Billing a UAE dealership needs the trade licence · MEDIUM · bites at day 30

ADR-004 is explicit: the free trial is technically clean under path B because the
dealer's own Meta account carries their own Cloud API usage, so NEXUS incurs no
per-message cost and needs no billing relationship *for the trial*. Invoicing at
the end of it is a different question and needs the licence. **Plan the trial to
end after the licence lands.** (Not legal advice — this restates ADR-004.)

---

## What is genuinely ready — rehearsed and passed on staging today

- `nexus_onboard_dealership(p_slug, p_name, p_owner_email, p_owner_role)` created a
  tenant + staff row + owner membership in one call, and **refused by name** when
  the `auth.users` row was missing.
- `nexus_register_channel(p_tenant_slug, p_channel_type, p_external_identifier,
  p_credential_ref, p_status)` registered a new number and **refused** to re-point
  ALBA's live `phone_number_id` to another dealership.
- `tenant_member_invite` + the `auth.users` trigger
  `trg_nexus_claim_pending_membership` auto-created a `sales` membership on first
  sign-in and marked the invite claimed. No manual membership insert needed.
- `lead_ingest_endpoint` rows for `walk_in` and `phone_call` inserted first time
  against the production constraint set.
- **Isolation held in both directions.** The new dealer's owner saw 1 tenant, 1
  lead, 1 channel — their own. Tenant A's owner saw 0 of the new dealer's rows.
- **Rollback by suspension works.** `update tenants set status='suspended'` took the
  owner's visibility to 0 tenants / 0 leads and took the channel off the air
  (`nexus_resolve_channel_tenant` → 0 rows), reversibly. This matters because the
  tenant row itself is **undeletable** — 35 tables hold `ON DELETE RESTRICT` FKs to
  `tenants(id)`.
- The dashboard (`apps/executive-dashboard/lib/tenant.js`) already names the
  dealership in the shell and refuses to render when the caller has no membership,
  rather than drawing missing rows as zeros.

---

## The honest verdict

**Dealer #2 can be signed up and given a dashboard today.** They will see their own
leads, their own team, and nobody else's. That much is tested.

**Dealer #2 cannot be put on WhatsApp today**, and attempting it would break ALBA's
identity resolution and Customer 360 at the same time.

Two things must ship before the second onboarding is booked: **the explicit-tenant
cutover for the three `nexus_scoped_tenant_id()` consumers (blocker 1)** and **the
receiver reading `nexus_channel_secret_reveal()` instead of one global env var
(blocker 2)**. Both should be proven on a parity staging environment (blocker 3)
before a real dealer's Meta app is pointed at NEXUS.
