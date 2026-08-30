# Schema drift: what the repo claims vs what the database is

Compiled 2026-08-30 from the live catalogue of Supabase project `dsvuoovivysszdoiorch`
and from the two SQL files in `architecture/`. Every claim below was checked against
`pg_class`, `pg_attribute`, `pg_constraint`, `pg_indexes`, `pg_policies`,
`pg_get_viewdef`, `pg_get_functiondef`, `pg_get_triggerdef`, `pg_extension`,
`information_schema.role_table_grants`, `cron.job` and `storage.buckets`.

The authoritative description of the database is now **`schema.sql`** in this folder.

---

## The two that cause damage

### 1. `architecture/supabase_schema.sql` opens the stock list — including what we paid — to anyone with the anon key

The file contains:

```
CREATE POLICY "Allow read access to public on inventory"
    ON public.inventory FOR SELECT TO public USING (true);
```

`public` in Postgres is not "logged-in users". It is *every* role, and on Supabase that
includes **`anon`** — the role behind the publishable key that ships in the dashboard's
front-end JavaScript. Combined with the platform's default `GRANT ALL ... TO anon`
(which is live today on every table), that policy makes `public.inventory` world-readable.

`inventory` holds `cost_aed` — the acquisition cost of each unit — alongside
`gross_margin`, `net_margin` and `recommended_commission`. Anyone who opens the
dashboard, reads the anon key out of the page source and issues one PostgREST request
would get the dealership's buy prices and margins on every car on the lot.

**This is not live today.** No policy on the live database names the role `public` or
`anon` permissively; `anon` is denied everywhere by the RLS default-deny, and named
explicitly only on `processed_messages`, to deny it. Running this file would create
the exposure.

Demonstrated, not assumed: a local PostgreSQL 16 replica of the live schema was built
from `schema.sql`, a unit was inserted, and `SET ROLE anon; SELECT ... FROM inventory`
returned nothing. The policy above was then applied and the same query returned
`U1 cost_aed=80000`. Dropping the policy again returned nothing.

**Do not run `architecture/supabase_schema.sql`.**

### 2. The same file installs two triggers that break every UPDATE to `leads` and `inventory`

This is the part nobody has noticed, and it is arguably worse because it is silent
until the first write.

The file defines `update_updated_at_column()` and attaches it:

```
CREATE TRIGGER update_leads_updated_at     BEFORE UPDATE ON public.leads     ...
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON public.inventory ...
```

Both triggers assign `NEW.updated_at`. **Neither live table has an `updated_at`
column.** The `CREATE TABLE` statements above them are `IF NOT EXISTS`, so on the live
database they are skipped and no column is added — but the `CREATE TRIGGER` statements
have no such guard and *do* execute.

Result, from the same local replica: after running the file, every
`UPDATE public.leads ...` fails with

```
ERROR: record "new" has no field "updated_at"
CONTEXT: PL/pgSQL assignment "NEW.updated_at = NOW()"
```

That kills, at minimum: assigning a lead to a rep, changing a lead's status from the
dashboard or from Slack, the escalation workflow's `escalated_at` stamp, the SLA
meter's `response_time_minutes` write, editing a vehicle, and
`recompute_inventory_derived()` — which failed in the same test — and with it the whole
inventory ageing and holding-cost calculation.

### 3. The status CHECK — a fresh-database landmine, inert against live

```
status TEXT DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','lost','converted'))
```

Live `leads.status` is free text written in UPPER CASE. The values in use and in code
are `HOT`, `WARM`, `COLD`, `DISQUALIFIED`. The constraint would reject every one of
them, and its default of `'new'` matches nothing any reader looks for:
`assign_hot_lead()` tests `status = 'HOT'`, `capture_daily_metrics()` counts
`upper(status)` in HOT/WARM/COLD, `v_needs_attention` and `v_team_performance` test
`upper(l.status) = 'HOT'`.

Against the live database this constraint never applies — `CREATE TABLE IF NOT EXISTS`
skips the table that already exists, so nothing is altered. The damage is to any *new*
environment: a staging or replacement project built from this file gets a `leads` table
that the master router cannot insert a single row into.

---

## Table-by-table: `architecture/supabase_schema.sql` vs live

| Repo file says | Live |
|---|---|
| `leads.id UUID DEFAULT gen_random_uuid()` | `integer` from `leads_id_seq` |
| `leads.first_name`, `leads.last_name` | one column, `name text NOT NULL` |
| `leads.phone_number` | `phone` |
| `leads.company` | does not exist |
| `leads.notes` | does not exist |
| `leads.status` CHECK new/contacted/qualified/lost/converted | free text, HOT/WARM/COLD/DISQUALIFIED, no CHECK |
| `leads.email TEXT NOT NULL UNIQUE` | nullable; uniqueness is a standalone unique **index** `leads_email_key`, not a constraint |
| `leads.updated_at` | does not exist |
| — | live has, and the file omits: `source`, `vehicle_interest`, `budget_aed`, `ai_score`, `assigned_to`, `assigned_to_id` (FK → `users`), `response_time_minutes`, `escalated_at` |
| `inventory.id UUID` | `text` — the dealer stock number |
| `inventory.sku`, `name`, `description`, `quantity`, `price DECIMAL`, `category`, `updated_at` | none of these exist |
| — | live `inventory` is `model, vin, status, days_in_stock, price_aed, cost_aed, gross_margin, holding_cost_accrued, net_margin, recommended_commission, vat_amount, aging_alert, ai_recommendation, acquired_at` |
| `document_embeddings` (uuid, document_id, content, metadata jsonb, embedding vector(1536)) + HNSW index | **does not exist.** The RAG table is `rag_documents`, and it uses tsvector full-text + pg_trgm, not embeddings. Creating `document_embeddings` adds a permanently empty table that nothing reads. |
| Policies named "Allow full access to authenticated users on leads" etc. | Live policy names are all snake_case (`leads_authenticated_all`, …). The repo names do not collide, so running the file **adds** duplicate permissive policies rather than replacing anything. |

## Table-by-table: `architecture/database_schema.sql` vs live

This file is a different fantasy from the first one — the two contradict each other as
much as they contradict the database.

* It uses bare `CREATE TABLE leads` and `CREATE TABLE audit_log` with no `IF NOT EXISTS`.
  Against the live project the first of those aborts immediately with
  `relation "leads" already exists`. In the Supabase SQL editor the whole script is one
  submission, so nothing at all is applied. It is inert against live and destructive only
  as a blueprint for a new project.
* **Seven tables that exist nowhere in the system:** `roles`, `user_profiles`,
  `customers`, `vehicles`, `deals`, `campaigns`, `document_embeddings`. No n8n workflow
  and no dashboard screen references any of them. Live staff live in `users`; live
  customers are derived from `leads` + `purchase_history` through `v_customer_directory`
  and `v_customer_360`; live vehicles are `inventory`; live closed deals are
  `purchase_history`.
* **`user_profiles` references `auth.users(id)`.** Live `public.users` has no
  relationship to `auth.users` at all — no foreign key, no shared id. Anything written
  against that assumption is wrong.
* **`leads` again, differently wrong:** uuid id, `ai_priority`, `ai_intent`,
  `ai_probability`, `budget_min`/`budget_max`, `timeline`, `has_trade_in`,
  `assigned_to UUID REFERENCES user_profiles`, `assigned_at`, `last_contacted_at`,
  `updated_at`. Live has none of these. Live's `budget_aed` is a single integer; live's
  `assigned_to` is a **text display name** and the uuid is a separate column,
  `assigned_to_id`, pointing at `users`.
* **`audit_log` is incompatible with what every workflow actually posts.** The file
  defines `(id BIGSERIAL, user_id, action, table_name, record_id, old_values, new_values,
  ip_address, created_at)` — a row-change audit trail. The live table, which sixteen of
  the twenty-two workflow JSONs write to, is
  `(id uuid, workflow, status, lead_name, lead_email, lead_score, intent, summary,
  logged_at)` — a workflow run journal, with `CHECK (status = upper(status))`. If the
  repo shape were ever created, every workflow's logging step and both dashboard health
  views would break at once.
* Its RLS policies reference `assigned_to = auth.uid()` and a `user_profiles`→`roles`
  join. Neither exists. Live RLS is far blunter: any authenticated user sees everything
  (see "Things that are true and worth knowing" below).

---

## Live objects that appear in NO repo SQL file

Twelve tables, all six views, all nine functions, all three triggers, the scheduled job and
the storage bucket are undocumented by either file. They are now documented in
`schema.sql`.

**Tables (12):**

| Table | What it is for |
|---|---|
| `communication_logs` | every message in or out, any channel — the transcript the Conversations screen reads |
| `competitors` | scraped rival listings; negative `price_diff_aed` is an undercut alert |
| `customer_360_profiles` | cached email/Slack counters from the Customer 360 aggregation workflow |
| `daily_metrics` | one snapshot row per day — the only history in the system |
| `deals_embeddings` | 1536-dim embedding per closed deal; written, never read, 0 rows |
| `finance_quotes` | every indicative auto-loan quote the finance calculator produced |
| `kyc_documents` | UAE AML identity checks, one row per submission, 7-year retention |
| `processed_messages` | WhatsApp de-duplication ledger — stops the bot answering twice |
| `purchase_history` | closed-won deals; what makes a lead a customer |
| `rag_documents` | the "Ask AI" knowledge base (full-text + trigram, **not** vectors) |
| `whatsapp_contacts` | the identity bridge: chat_id ↔ real phone ↔ push name ↔ lead |
| `workflow_registry` | hand-maintained catalogue of the 18 workflows that should exist |

(`users`, `leads`, `inventory` and `audit_log` also exist live but are at least *named*
by a repo file — wrongly, as tabulated above.)

**Views (6):** `v_conversations`, `v_customer_360`, `v_customer_directory`,
`v_needs_attention`, `v_team_performance`, `v_workflow_health`. All are
`security_invoker`, so base-table RLS still applies through them. `v_needs_attention`
depends on `v_conversations` and must be created after it.

**Functions (9):** `nexus_is_reply`, `nexus_comm_keys_for_lead`,
`nexus_lead_for_comm_key`, `nexus_mark_first_response`, `nexus_backfill_response_time`,
`assign_hot_lead`, `recompute_inventory_derived`, `capture_daily_metrics`,
`search_rag_documents`.

**Triggers (3):** `trg_assign_hot_lead` and `trg_leads_backfill_response` on `leads`,
`trg_comm_logs_first_response` on `communication_logs`.

**Scheduled job (1):** pg_cron job 1, `nexus-daily-metrics`, `50 19 * * *` UTC
(23:50 Asia/Dubai), running `select public.capture_daily_metrics();`.

**Storage (1):** bucket `kyc-documents`, private, created 2026-08-17.

**Extensions:** live has `vector 0.8.2` and `pg_trgm 1.6` in `public`, plus `pgcrypto`,
`uuid-ossp`, `pg_stat_statements`, `supabase_vault` and `pg_cron`. Both repo files
enable only `vector` — and `vector` is used by exactly one column, in the one table
nothing reads.

---

## Live defects found during introspection

These are not repo-vs-live drift. They are things wrong in the database right now,
found while reading the catalogue. **Nothing here was changed** — this task was
read-only — and `schema.sql` reproduces them as they stand, with a warning comment.

### A. `nexus_lead_for_comm_key()` cannot succeed: it returns `uuid`, but `leads.id` is `integer`

The function is declared `RETURNS uuid` and assigns query results into a local
`v_id uuid`, but `public.leads.id` is `integer`. As soon as a lookup actually *matches*
a lead, the assignment raises:

```
ERROR: 22P02 invalid input syntax for type uuid: "34"
CONTEXT: PL/pgSQL function nexus_lead_for_comm_key(text) line 18 at SQL statement
```

Verified live by calling the function with a real lead address. It returns NULL
harmlessly when nothing matches, which is why the fault is invisible until it matters.

`nexus_mark_first_response()` calls it from an `AFTER INSERT` trigger on
`communication_logs`, and declares `v_lead uuid` and compares `l.id = v_lead` — the same
mismatch. So **the next genuine outbound WhatsApp / email / SMS message logged to an
already-known lead will fail to insert**, taking the workflow step with it.

Scope, measured: of the six distinct `lead_email` keys with outbound rows, four resolve
to a lead (`+971547484167@whatsapp.lead` and `shabbir53ujjainwala@gmail.com` directly;
`155315328786434@lid` and `158510264357112@lid` via `whatsapp_contacts.lead_email`) and
would therefore hit the error. The most recent outbound row that *did* insert cleanly,
at 17:00 UTC today, escaped only because its `channel` is `system`, which
`nexus_is_reply()` filters out before the lookup. Rows from 04:06 UTC today inserted
normally, so this was introduced between then and now.

The reverse path, `nexus_backfill_response_time()`, is unaffected — it uses
`nexus_comm_keys_for_lead()`, which returns `text[]` and never touches `leads.id`.

The fix is one word — `RETURNS integer`, `v_id integer`, `v_lead integer` — but it is a
DDL change and out of scope here. It should be made before the next customer message
arrives, and `schema.sql` regenerated afterwards.

### B. `daily_metrics` counts every audit row ever, not today's

`capture_daily_metrics()` fills `workflow_runs` and `workflow_failures` with
`SELECT count(*) FROM audit_log` and `... WHERE status='FAILED'` — with no date filter.
Both columns are therefore cumulative all-time totals stored in a table whose whole
purpose is per-day history, so a chart drawn from them can only ever slope upward.
Stated as observed; not changed.

---

## Things that are true and worth knowing

* **`anon` and `authenticated` hold `ALL` privileges on every table in `public`.** That
  is Supabase's platform default, not a choice made here. RLS is the only thing keeping
  the anon key out. That is exactly why item 1 above is so dangerous, and why no policy
  should ever be written `TO public`.
* **Any signed-in user can read and write every lead, every vehicle and every
  competitor row, and read everything else including KYC metadata.** The live policies
  are `USING (true)` per role, with no per-rep or per-manager scoping. That may well be
  the right call for a small dealership, but it is a decision, and it is not written
  down anywhere. `database_schema.sql`'s `assigned_to = auth.uid()` policy suggests
  somebody once intended otherwise.
* **The `leads.email` uniqueness that the router's `on_conflict=email` upsert relies on
  is an index, not a constraint** (`leads_email_key`). PostgREST accepts it either way,
  but a migration that drops "unused indexes" would silently break lead de-duplication.
* **`purchase_history.deal_id` is a *partial* unique index** (`WHERE deal_id IS NOT NULL`),
  which is what lets many legacy rows have no deal id while still making a retried
  closed-won webhook idempotent.
* **`rag_documents.search_vector` is a STORED GENERATED column.** Postgres maintains it;
  no workflow should ever write it.
* **`deals_embeddings.embedding` has no vector index** (no ivfflat, no HNSW). With 0
  rows that costs nothing today.
