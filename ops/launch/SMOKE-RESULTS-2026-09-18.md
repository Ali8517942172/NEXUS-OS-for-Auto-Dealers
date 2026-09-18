# Launch smoke — results, 18 Sep 2026

**Harness:** `ops/launch/smoke.mjs` (this file is its output, pasted, not retyped)
**Run by:** agent SMOKE, 18 Sep 2026
**Command:** `node ops/launch/smoke.mjs --env=staging` and `node ops/launch/smoke.mjs --env=production`

| lane | PASS | FAIL | NOT RUN | exit |
|---|---|---|---|---|
| staging `wwspuxrbiyagnrnzgate` | 9 | 0 | 17 | 0 |
| production `dsvuoovivysszdoiorch` (read-only) | 7 | 0 | 16 | 0 |

**Nothing failed, and that is a much smaller claim than it looks.** Over half the
checks did not run. A NOT RUN is printed with its reason and is never counted as
a pass; `--strict` makes NOT RUN fail the run, which is what a launch gate should
use.

## What blocks the biggest NOT RUN block

1. **No staging `service_role` key exists in the env file.** NX996 (outbox) and
   NX995 (appointments) grant EXECUTE to `service_role` and nothing else, so
   every write-path check in those two groups is unrunnable from a client until
   an owner pastes the staging service key into
   `NEXUS_STAGING_SERVICE_ROLE_KEY`. The harness needs no other change: the
   whole sequence is written and waiting on that one line.
2. **`nexus_intake` is not in staging's exposed schemas.** The live
   `/api/lead` shape POSTs `rpc/submit_sales_lead` with
   `Content-Profile: nexus_intake`; staging answers `406 Invalid schema`. That
   is a Supabase dashboard setting (Project Settings → API → Exposed schemas),
   not a migration.
3. **`nexus_channel_status` does not exist on staging.** NX986 is applied on
   production and was never pushed to staging; applying DDL to staging was not
   permitted in this session, so it is reported absent rather than worked around.
4. **Production writes nothing, by construction.** `request()` throws on any
   method other than GET/HEAD in the production lane, so the notification,
   appointment, website and password-grant checks are refused there by the
   harness itself. PostgREST serves STABLE functions over GET, which is how the
   production accessor checks still ran as reads.

## Fixtures this harness depends on (staging only)

Synthetic accounts on `.invalid` domains, no real person, all under
`ZZ TEST TENANT A/B` and `ZZ DUBAI MOTORS`: `owner@alpha.staging.invalid` (tenant A),
`owner@bravo.staging.invalid` (tenant B), `tech@alpha.staging.invalid` (member of
no dealership), `zz-owner@dubaimotors.invalid` (member of a dealership carrying
channel rows). Their logins and tenant ids live in the env file under
`NEXUS_STAGING_*`. Membership rows for A and B were added on staging on 18 Sep 2026
so `nexus_current_tenant_id()` resolves for a real signed-in session.

## What this harness deliberately does NOT cover

- **RLS `WITH CHECK` clauses.** Every cross-tenant *write* is refused at the
  grant layer before RLS is consulted, so this harness tests reads only and
  leaves writes to `ops/tenant-isolation-tests/two-tenant-suite.sql`.
- **n8n, WhatsApp/Meta/Google delivery, ad accounts, Vercel.** Nothing here
  sends a message or touches a workflow. "Notification" means the outbox row's
  state machine, not that a human was told.
- **The Vercel `/api/lead` endpoint itself** — origin check, honeypot, timing
  trap, rate limit, E.164 coercion. This exercises the RPC that endpoint calls,
  in the same shape, not the HTTP handler in front of it.
- **Production data correctness.** Row counts are read and printed; nobody
  asserts they are right.
- **Load, concurrency and lease expiry.** One row at a time, no races.

---

## Staging lane — verbatim output

```
NEXUS launch smoke — lane: staging
env file: /sessions/rcw-01j7fn5nokfnmkkgwskac2j1/mnt/MY RESUMES/nexus-os/.env
project:  https://wwspuxrbiyagnrnzgate.supabase.co
keys:     publishable=present  service_role=ABSENT

GROUP          CHECK                                  VERDICT  DETAIL
-------------------------------------------------------------------------------------------------------
website        durable storage                        NOT RUN  submit_sales_lead unreachable over PostgREST (406: Invalid schema: nexus_intake). Either nexus_intake is missing from this project's exposed schemas, 
website        duplicate submission                   NOT RUN  submit_sales_lead unreachable over PostgREST (406: Invalid schema: nexus_intake). Either nexus_intake is missing from this project's exposed schemas, 
website        malformed refused                      NOT RUN  submit_sales_lead unreachable over PostgREST (406: Invalid schema: nexus_intake). Either nexus_intake is missing from this project's exposed schemas, 
website        attribution persisted                  NOT RUN  submit_sales_lead unreachable over PostgREST (406: Invalid schema: nexus_intake). Either nexus_intake is missing from this project's exposed schemas, 
notification   enqueue -> PENDING                     NOT RUN  NX996 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set
notification   claim leases the row                   NOT RUN  NX996 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set
notification   mark_failed -> RETRYING                NOT RUN  NX996 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set
notification   mark_sent -> SENT                      NOT RUN  NX996 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set
notification   illegal transition refused             NOT RUN  NX996 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set
appointments   request -> offer -> confirm            NOT RUN  NX995 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set
appointments   double booking refused                 NOT RUN  NX995 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set
appointments   attendance before start refused        NOT RUN  NX995 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set
isolation      A sees 0 of B's leads                  PASS     0 of B's 4 row(s); nothing foreign in an unfiltered read either
isolation      A sees 0 of B's customer               PASS     0 of B's 1 row(s); nothing foreign in an unfiltered read either
isolation      A sees 0 of B's conversation           NOT RUN  B has no rows in conversation; nothing for A to be denied
isolation      A sees 0 of B's appointment            PASS     0 of B's 1 row(s); nothing foreign in an unfiltered read either
isolation      A sees 0 of B's tenant_subscription    NOT RUN  B has no rows in tenant_subscription; nothing for A to be denied
isolation      B sees 0 of A's leads                  PASS     0 of A's 4 row(s); nothing foreign in an unfiltered read either
isolation      B sees 0 of A's customer               PASS     0 of A's 1 row(s); nothing foreign in an unfiltered read either
isolation      B sees 0 of A's conversation           NOT RUN  A has no rows in conversation; nothing for B to be denied
isolation      B sees 0 of A's appointment            PASS     0 of A's 6 row(s); nothing foreign in an unfiltered read either
isolation      B sees 0 of A's tenant_subscription    PASS     0 of A's 1 row(s); nothing foreign in an unfiltered read either
anon           every table refused                    PASS     9 tables, all refused to anon
anon           every accessor refused                 PASS     2 refused to anon; nexus_channel_status absent here and not counted
channels       member caller sees rows                NOT RUN  nexus_channel_status does not exist on this project (NX986 not applied here)
channels       no default dealership without membersh NOT RUN  nexus_channel_status does not exist on this project (NX986 not applied here)

9 PASS · 0 FAIL · 17 NOT RUN · 20.0s · lane staging
EXIT=0
```

## Production read-only lane — verbatim output

```
NEXUS launch smoke — lane: production (READ-ONLY)
env file: /sessions/rcw-01j7fn5nokfnmkkgwskac2j1/mnt/MY RESUMES/nexus-os/.env
project:  https://dsvuoovivysszdoiorch.supabase.co
keys:     publishable=present  service_role=present

GROUP          CHECK                                  VERDICT  DETAIL
-------------------------------------------------------------------------------------------------------
website        lead submission                        NOT RUN  production lane is read-only; submitting a lead there would be a test event in a real pipeline
notification   enqueue -> PENDING                     NOT RUN  production lane is read-only; the outbox machine is exercised on staging
notification   claim leases the row                   NOT RUN  production lane is read-only; the outbox machine is exercised on staging
notification   mark_failed -> RETRYING                NOT RUN  production lane is read-only; the outbox machine is exercised on staging
notification   mark_sent -> SENT                      NOT RUN  production lane is read-only; the outbox machine is exercised on staging
notification   illegal transition refused             NOT RUN  production lane is read-only; the outbox machine is exercised on staging
appointments   request -> offer -> confirm            NOT RUN  production lane is read-only; booking is exercised on staging
appointments   double booking refused                 NOT RUN  production lane is read-only; booking is exercised on staging
appointments   attendance before start refused        NOT RUN  production lane is read-only; booking is exercised on staging
isolation      A sees 0 of B's leads                  NOT RUN  production lane is read-only and signing a real user in there is a write; isolation is proved on staging
isolation      A sees 0 of B's customer               NOT RUN  production lane is read-only and signing a real user in there is a write; isolation is proved on staging
isolation      A sees 0 of B's conversation           NOT RUN  production lane is read-only and signing a real user in there is a write; isolation is proved on staging
isolation      A sees 0 of B's appointment            NOT RUN  production lane is read-only and signing a real user in there is a write; isolation is proved on staging
isolation      A sees 0 of B's tenant_subscription    NOT RUN  production lane is read-only and signing a real user in there is a write; isolation is proved on staging
anon           every table refused                    PASS     9 tables, all refused to anon
anon           every accessor refused                 PASS     3 refused to anon
channels       member caller sees rows                NOT RUN  no production member credentials here, and a password grant is a write; the member half is proved on staging
channels       no default dealership without membersh PASS     a caller with no membership got 0 rows, not somebody's dealership
prod read-only row counts                             PASS     tenants=2 leads=12 customer=1 conversation=1 appointment=0 nexus_sales_lead=4 nexus_notification_outbox=4 channel_message_events=2
prod read-only latest inbound channel event           PASS     whatsapp_cloud_phone_number_id at 2026-09-14T20:14:42+00:00 (92.0h ago), attested hmac_sha256_x_hub
prod read-only latest migration version               NOT RUN  supabase_migrations is not exposed over PostgREST (404: Could not find the table 'public.schema_migrations' in the s); read it with SQL, not this harn
prod read-only newest migration objects present       PASS     nexus_notification_outbox (NX996) exists and is readable — object presence, not a version number
prod read-only anon has no USAGE on schema public     PASS     401: permission denied for schema public

7 PASS · 0 FAIL · 16 NOT RUN · 13.0s · lane production
EXIT=0
```
