# Standing up dealership 2 — the procedure, step by step

**Written 9 September 2026.** Nothing in this file has been executed. Every step is
marked **[AUTOMATED]** (a function or statement exists and does the work) or
**[MANUAL — OWNER]** (a person must act, usually because a credential or an external
account is involved).

**I do not ask for, handle, store or write any secret value.** Where a credential is
required this file names it, says who issues it, says where it must live, and says
what NEXUS stores *instead* of it. If a step below appears to want you to paste a
secret into a document, it is being read wrongly.

---

## 0 · Before anything: what activation changes on the same second

`tenants.status = 'active'` on a second non-quarantine dealership is not a
configuration change. It is the condition several functions branch on. Measured
consequences, from `ISOLATION-MODEL.md`:

| effect | mechanism | who notices |
|---|---|---|
| `nexus_scoped_tenant_id()` starts returning **NULL** | its own guard: `… and (select count(*) from tenants where status='active' and not is_quarantine) = 1` | the nightly Customer 360 batch syncs nobody |
| **Ask AI answers nothing, for both dealerships** | `search_rag_documents(q, limit)` passes that NULL on, and the 3-arg body returns early when `v_tenant is null and count(active tenants) > 1` | every user of the Ask AI screen (H7) |
| dealership 2's owner can read **Tenant A's full workflow register**, 18 rows | `nexus_workflow_catalogue()` guards with `exists(select 1 from nexus_current_tenant_ids())` — a membership test, not a filter (H1) | nobody, unless someone looks |
| any human who is a member of both gets a **silent pick** of one dealership on six code paths | `nexus_current_tenant_id()` → `order by created_at limit 1` (H5) | the vendor, on day 1 |

**So the order is: fix, rehearse, then activate.** Activating first and fixing after
means the first thing dealership 2 experiences is an outage on the AI screen and a
view of somebody else's automation register.

---

## 1 · Entry gate — what must be closed before a second dealership exists at all

Not a wish list. Each line is a measured item with a named source.

| # | must be true | today | source |
|---|---|---|---|
| G1 | The five `nexus_scoped_tenant_id()` consumers are driven over `nexus_active_dealership_ids()` instead | **open** — still exactly five | `BLOCKERS.md` §2.4 |
| G2 | `nexus_workflow_catalogue()` filters by tenant, or `workflow_registry` gains a `tenant_id` | **open** | H1 / `two-tenant-proof` F6, gate L2 |
| G3 | The silence detector's second write path names its tenant | **open, live 8 Sep** | H12 |
| G4 | `search_rag_documents` has a tenant to work with at ≥2 dealerships | **open** | H7 |
| G5 | The 6 predicted-to-fail break tests in `BREAK-TESTS.md` have been **run on staging** and their results recorded | **NOT RUN** | this folder |
| G6 | No single human is a member of both dealerships, or `nexus_current_tenant_id()` refuses ambiguity the way `nexus_lead_record_manual` already does | **open** | H5 |
| G7 | The deployed n8n workflows have been exported and diffed, and every Supabase write node either names a tenant or calls a resolver | **UNKNOWN — export is 4 days older than `channel_registry`** | `BLOCKERS.md` §2.6, G1 in BREAK-TESTS |
| G8 | Tenant A's non-dealership WhatsApp traffic is deleted and the personal handset disconnected | **open — 107 of 142 messages, arriving as of 8 Sep** | `BLOCKERS.md` §2.2, §2.3 |
| G9 | A written controller/processor term exists, naming retention, deletion-on-request and hosting location | **open** | `BLOCKERS.md` §2.3 |

**G8 and G9 are not tenancy work and they are not optional.** Dealership 2's
customers' data would land in a database that currently holds a contracting company's
and a perfumer's private messages, with `whatsapp_opt_in_event` = 0 rows of consent.

---

## 2 · Rehearse on staging, in this order

**[MANUAL — OWNER, or an engineer with the staging service key]**

1. Confirm staging still matches production structurally (the 8-query comparison in
   `two-tenant-proof` §1 — 1731 columns, 374 constraints, 269 functions, 169 indexes,
   163 policies, 59 tables, 39 views, 19 triggers **as of 6 Sep**; production has
   since moved to 67 tables / 42 views / 192 policies, so **re-measure both, do not
   carry those numbers forward**).
2. Run the full journey under a third staging tenant, not just Alpha and Bravo — a
   two-tenant fixture cannot catch a bug that only appears when the resolver has to
   choose among three.
3. Run every test in `BREAK-TESTS.md`. Record each as PASS / FAIL / INCONCLUSIVE with
   the actual SQLSTATE or row count. **`NOT RUN` is not a result.**
4. Fix what fails. Re-run the whole file, not the failing test alone.

---

## 3 · Credentials the owner must supply

Named here; **not collected here, and never written into this repository.**

| # | credential | issued by | what NEXUS stores instead | needed at |
|---|---|---|---|---|
| C1 | Supabase Auth login for dealership 2's owner (email + a password they set themselves) | the owner, in the Supabase dashboard | `auth.users.id` only | step 4 |
| C2 | WhatsApp Business **phone number ID** and **WABA ID** | Meta Business Manager, on **dealership 2's own** Meta account | `channel_registry.external_identifier` (the phone number ID — an identifier, not a secret) | step 6 |
| C3 | WhatsApp Cloud **permanent access token** | Meta, same account | `channel_registry.credential_ref` — **a reference to the n8n credential, never the token** | step 6 |
| C4 | Meta **app secret** and **webhook verify token** | Meta, same account | nothing in Postgres — n8n credential store only | step 6 |
| C5 | Lead-endpoint **public key** and **shared secret**, one pair per lead source | generated by whoever runs step 7 | `lead_ingest_endpoint.public_key` (public by design) and `secret_ref` (a reference) | step 7 |
| C6 | Meta Lead Ads **page ID / form ID**, Google **Lead Form** identifiers | dealership 2's ad accounts | `lead_ingest_provider_identity.identity_value` — identifiers, not secrets | step 7 |
| C7 | CRM credentials, if dealership 2 uses one | the dealership | out of scope — Bitrix has not succeeded since 19 Aug (`BLOCKERS.md` §2.9) | — |

**Two rules that are not negotiable.** (a) The WhatsApp number must be **dealership
2's own number on dealership 2's own Meta Business account.** Not the vendor's, not
a shared one, not a WAHA session on somebody's handset. (b) `credential_ref` columns
hold a *pointer* to a credential in n8n. The moment a token is pasted into a Postgres
column it is in every backup, every `pg_dump`, and readable to `service_role`.

---

## 4 · Create the login and the dealership

**[MANUAL — OWNER]** Create the auth user first. `nexus_onboard_dealership` refuses
otherwise, in its own words: *"no auth.users row for %. Create the login in Supabase
Auth first, then re-run."*

**[AUTOMATED]** Then, as `service_role` (the function is `EXECUTE`-revoked from
`authenticated` — probe S13, 6 Sep, returned `42501`):

```sql
select public.nexus_onboard_dealership(
  p_slug        => 'dealership-two-slug',
  p_name        => 'Dealership Two Legal Name',
  p_owner_email => 'owner@dealershiptwo.example',
  p_owner_role  => 'owner');
```

**What it does**, read from its body: inserts `tenants` (`status='active'`,
`is_unattributed_default=false`, refusing if the slug is the quarantine tenant),
inserts a `users` staff row (`role='manager'`, `status='online'`), inserts
`tenant_members` binding the auth uid to the tenant with the given role. All three
are `ON CONFLICT DO UPDATE`, so it is idempotent.

**What it does NOT do — every one of these is a separate manual step below:**
no `tenant_configuration`, no `tenant_capability`, no `channel_registry`, no
`lead_ingest_endpoint`, no `policy_rule`, no `inventory_profit_settings`, no
`lead_recovery_settings`, no `deal_rescue_settings`, no inventory, no RAG documents.

**It also sets `status='active'` immediately**, which is the switch §0 describes. If
G1–G4 are not closed, **do not run this yet** — or run it and immediately set
`status='inactive'` in the same transaction, then activate at step 10.

**[MANUAL — VERIFY]**
```sql
select id, slug, name, status from public.tenants order by created_at;
select tenant_id, auth_user_id, role, staff_user_id from public.tenant_members;
select id, name, email, role, tenant_id from public.users;
```
Expect 3 tenant rows, 2 memberships, 2 staff rows. **Today production has exactly one
of each** (`users 1`, `tenant_members 1`), so this is the first time the multi-row
case exists anywhere but staging.

---

## 5 · Do not make the vendor a member of both (H5)

**[MANUAL — OWNER]** The temptation is to add the vendor's own login to dealership 2
so support is easy. Measured consequence:

- `nexus_current_tenant_ids()` returns **both**, so every RLS-scoped screen shows
  **both dealerships' rows merged**;
- eight views have **no `tenant_id` column** (`v_team_performance`,
  `v_needs_attention`, `v_workflow_health`, `v_competitor_latest`,
  `v_fin_gate_quote_evidence`, `v_deal_rescue_readiness`, and the two state-model
  views), so those rows cannot even be attributed on screen (H6);
- `nexus_current_tenant_id()` silently picks the **earliest membership**, and
  `recompute_inventory_derived()` — a write, granted to `authenticated` — uses it (H5);
- `nexus_lead_record_manual` will refuse outright with `DEALERSHIP_AMBIGUOUS`.

**Use a separate login per dealership.** If cross-dealership support access is
genuinely needed, that is a feature to design, not a membership row to add.

---

## 6 · Register the messaging channel

**[MANUAL — OWNER]** Complete Meta Business verification and phone-number
registration on dealership 2's own account (C2–C4). Store the token and app secret in
the **n8n credential store**, and note the credential's name — that name is what goes
in `credential_ref`.

**[AUTOMATED]** As `service_role`:
```sql
select public.nexus_register_channel(
  p_tenant_slug        => 'dealership-two-slug',
  p_channel_type       => 'whatsapp_cloud_phone_number_id',
  p_external_identifier=> '<the phone number ID from Meta>',
  p_credential_ref     => '<the NAME of the n8n credential, not the token>',
  p_status             => 'active');
```

**Expect a `23505` if the identifier is already registered** —
`channel_registry_type_identifier_key` is `UNIQUE (channel_type, external_identifier)`
**globally**, deliberately: one phone number cannot belong to two dealerships. That
refusal is the control working. Do not force past it.

**[MANUAL — VERIFY]**
```sql
select * from public.nexus_resolve_channel_tenant('whatsapp_cloud_phone_number_id','<id>');
-- must return dealership 2, and nothing else
select * from public.nexus_resolve_channel_tenant('whatsapp_cloud_phone_number_id','<Tenant A id>');
-- must still return Tenant A
```

**The gap this step cannot close.** `nexus_resolve_channel_tenant` is a pure function
of the string it is handed. Whoever can call the inbound webhook chooses which
dealership is written. The only thing authenticating that string lives on the n8n box
(`WAHA_WEBHOOK_SECRET`, recorded unset). **`BREAK-TESTS.md` G2 is the test; it is
NOT RUN; and this file cannot claim the inbound path is authenticated.**

---

## 7 · Lead ingest endpoints

**[MANUAL — OWNER + engineer]** There is **no onboarding helper for this** — measured:
the only endpoint accessors are `nexus_lead_endpoint_for_public_key` and
`nexus_lead_endpoint_for_provider_identity`, both `service_role`-only readers. Rows
must be inserted directly, one per lead source dealership 2 actually uses.

```sql
insert into public.lead_ingest_endpoint
  (tenant_id, source_key, required_provenance_for_source, declared_provenance,
   provenance_counts_as_real, environment, public_key, secret_ref,
   origin_allowlist, status, rate_limit_per_minute, label)
values
  ('<dealership 2 tenant id>', 'walk_in', '<from lead_source_catalogue>', '<same>',
   true, 'production', '<generated public key>', '<reference to the stored secret>',
   '{}', 'active', 60, 'Dealership Two — walk-in');
```

**Rules the table enforces and the runbook must respect:**
- `source_key` must exist in `lead_source_catalogue` — the vocabulary is a table, not
  free text (`nexus_record_lead_event` raises `SOURCE_NOT_IN_CATALOGUE`).
- `declared_provenance` must match what the endpoint can actually prove.
  `nexus_record_lead_event` refuses a production event whose provenance is weaker than
  the endpoint declares: `PROVENANCE_WEAKER_THAN_ENDPOINT_DECLARES`.
- `public_key` is `UNIQUE` globally.
- **Create at least one `environment='simulation'` endpoint per dealership** before
  the pilot. Production today has **five endpoints, all `production`, and none
  simulation** — which is why `v_lead_origin.is_test_traffic` can only ever return
  false and why a preflight test is on file as production traffic
  (`BLOCKERS.md` §1.2). Dealership 2 must not repeat that.

**[MANUAL — OWNER]** For Meta/Google lead forms, register the provider identity:
```sql
insert into public.lead_ingest_provider_identity
  (endpoint_id, source_key, provider, identity_kind, identity_value, label, status)
values ('<the endpoint just created>','meta_lead_ads_facebook','meta','page_id','<page id>','Dealership Two page','active');
```
`UNIQUE (provider, identity_kind, identity_value)` is **global**. Two dealerships
cannot claim one ad account; the second gets `23505` (H2).

---

## 8 · Settings, policy and capabilities — none of it is automatic

**[MANUAL — OWNER, with the dealership]** `nexus_onboard_dealership` creates none of
these, and their absence is not neutral: several engines render `NOT_COMPUTABLE` or
`settings_are_defaults = true` without them, which is honest but is not a working
product.

| table | what is missing without it | evidence the engine complains |
|---|---|---|
| `tenant_configuration` | timezone, currency, business hours, AI tone, approval rules, follow-up policy | `tenant_configuration_default` holds the platform defaults and `nexus_my_tenant_config()` reads the tenant row |
| `tenant_capability` | which channels/features are unlocked | `tenant_capability_catalogue.absent_means` states the fallback per key |
| `inventory_profit_settings` | **holding cost per day** — without it net margin is `NOT_COMPUTABLE` on every unit | `v_inventory_profit_sentinel.holding_cost_state` |
| `lead_recovery_settings` | SLA minutes, silence hours | `v_lead_recovery.settings_are_defaults` |
| `deal_rescue_settings` | at-risk / stalled thresholds | `v_deal_rescue.settings_are_defaults` |
| `policy_rule` (`TENANT_HOUSE`) | quiet hours, local rules | `v_policy_rule.may_be_relied_on` |

**[AUTOMATED where it exists]** House rules go in through
`policy_propose_rule(...)` then `policy_verify_rule(...)`, as the dealership's own
owner. A dealership may legislate only in `TENANT_HOUSE`: `PLATFORM_WHATSAPP`,
`NEXUS_HOUSE` and regulator jurisdictions all raise `NX001`.

**Watch H4:** `policy_rule.tenant_id` is **nullable** and nothing ties nullability to
jurisdiction. A `TENANT_HOUSE` rule written with a NULL tenant becomes globally
readable. Assert after every insert:
```sql
select count(*) from public.policy_rule where jurisdiction='TENANT_HOUSE' and tenant_id is null;
-- must be 0
```

---

## 9 · The team

**[AUTOMATED]** As dealership 2's owner, signed in:
```sql
select public.nexus_team_invite('rep@dealershiptwo.example','sales', null);
select * from public.nexus_team_pending();
select public.nexus_team_link_staff('<their auth uid, once they sign up>','<their staff users.id>');
select * from public.nexus_team_roster();
```
**[MANUAL — OWNER]** Each rep creates their own Supabase Auth login. Supabase's own
invite call needs the service-role key and there is no Edge Function for it
(`apps/executive-dashboard/screens/team.js:1650`), so the sign-up is a person's job.

**Untested surface warning:** `nexus_team_set_role`, `nexus_team_revoke_access`,
`nexus_team_link_staff` and `nexus_team_invite` are four of the 45 `SECURITY DEFINER`
functions in class D — RLS is off inside them and their tenant scoping is
hand-written. `BREAK-TESTS.md` E1 probes all four cross-tenant. **NOT RUN.**

---

## 10 · n8n

**[MANUAL — OWNER. Explicitly outside this document's scope and outside this pass's
permissions — nothing here touches the n8n box.]**

What must be true, stated as requirements rather than steps:

1. Every Supabase write node either **names a tenant** or calls a resolver
   (`nexus_resolve_channel_tenant`, `nexus_lead_endpoint_for_public_key`). A node that
   POSTs to `/rest/v1/<table>` with no tenant lands in quarantine on the 16 defaulted
   tables and fails `23502` on the other 26.
2. Tenant resolution comes from `channel_registry`, **not** from `NEXUS_TENANT_MAP`.
   Migration `20260903193511_chanreg_01` exists precisely to end the env-var mapping:
   *"Onboarding a second dealership therefore means editing an env var and restarting
   n8n: a production restart per customer, and a mapping nothing in the database can
   see, audit or scope."* **Whether the deployed workflows call the accessor is
   UNKNOWN** — the repository export predates the table by four days.
3. The inbound webhooks reject an unsigned request **before** starting an execution.
4. The **silence detector's second write path** is found and fixed (H12). One of its
   two paths omits the tenant; on 8 Sep four markers landed on Tenant A and one landed in
   quarantine, five minutes apart.

**Do not proceed past this step until the live workflows have been exported and
diffed** (`BREAK-TESTS.md` G1).

---

## 11 · Activate, then verify in this order

**[AUTOMATED]**
```sql
update public.tenants set status='active' where slug='dealership-two-slug';
```

**[MANUAL — VERIFY, immediately]**
```sql
-- 1 · the resolver census
select id, slug, status, is_quarantine from public.tenants;
select * from public.nexus_active_dealership_ids();          -- expect 2
select public.nexus_scoped_tenant_id();                      -- expect NULL. Confirm nothing depends on it.

-- 2 · the readiness gate (service_role)
select * from public.nexus_tenancy_readiness();              -- expect zero BLOCKERs
select * from public.nexus_quarantine_census();              -- expect zero rows

-- 3 · nothing crossed
select tenant_id, count(*) from public.leads group by 1;
select tenant_id, count(*) from public.communication_logs group by 1;
select tenant_id, count(*) from public.audit_log where logged_at > now() - interval '1 day' group by 1;

-- 4 · the FK detector
select tenant_id, actions_whose_lead_is_another_tenants from public.v_lead_recovery_coverage;
-- expect 0 for both dealerships

-- 5 · the two things activation is known to break
select count(*) from public.search_rag_documents('warranty policy', 5);   -- H7: expect 0 unless G4 closed
-- and, as dealership 2's owner:
select count(*) from public.nexus_workflow_catalogue();                    -- H1: expect 0, predicted 18
```

**[MANUAL — VERIFY, daily for the first week]**
```sql
select * from public.nexus_quarantine_census();
select tenant_id, count(*) from public.audit_log where logged_at > now() - interval '1 day' group by 1;
select tenant_id, count(*) from public.communication_logs where created_at > now() - interval '1 day' group by 1;
```
A quarantine count that **grows** means a live writer is still omitting the tenant.
Find it before it is somebody's customer.

---

## 12 · Rollback

**[AUTOMATED]** `update public.tenants set status='inactive' where slug='…';`

That single statement takes dealership 2 off the air completely and is reversible:
`nexus_current_tenant_ids()`, `nexus_resolve_channel_tenant`,
`nexus_tenant_ids_for_roles` and every RLS policy join `tenants` on
`status='active'`, so an inactive dealership's members read nothing and its channels
resolve to nothing. It also restores `nexus_scoped_tenant_id()` to a non-NULL answer
and un-breaks Ask AI.

**Do not delete the tenant row.** 37 foreign keys point at `tenants`, `tenant_id` is
`NOT NULL` on 40 tables, and a delete would either cascade real data away or fail
half-way. Deactivation is the rollback; deletion is a data-protection erasure request
and is a different, deliberate procedure that does not exist yet
(`BLOCKERS.md` §2.3, item 3 — the retention purge workflow is registered, marked
active, and **has never run**).
