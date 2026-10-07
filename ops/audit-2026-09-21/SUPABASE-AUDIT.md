# NEXUS OS Supabase Production Audit — dsvuoovivysszdoiorch
Read-only. 2026-09-21.

## 1. Tables — RLS / tenant scoping
- All 84 tables in `public` have `rowsecurity = true`. `nexus_intake` schema has no tables (one function only). No table grants SELECT to `anon`.
- 2 tables run `FORCE ROW SECURITY`: `channel_message_events`, `whatsapp_customer_message_seen`.
- Tables with `has_tenant_id=true` whose policy text doesn't literally say "tenant" were checked by hand: `processed_messages`, `tenant_members`, `whatsapp_conversation_state`, `whatsapp_delivery_events`, `whatsapp_opt_in_event`, `lead_ingest_endpoint`, `lead_ingest_provider_identity`, `channel_send_directive`, `channel_registry`, `channel_message_events`, `whatsapp_customer_message_seen`. All of these are `deny anon+authenticated / service_role only` (backend-only tables) or `tenant_members_self_read` (`auth_user_id = auth.uid()`). No cross-tenant read exposure found among these.
- `daily_metrics` has no primary key (perf advisor INFO).

## 2. Functions
- 140 `SECURITY DEFINER` functions in `public`. Only 54 have `EXECUTE` granted to `authenticated` (none to `anon`) — see advisor list below. None of the 54 take an explicit tenant-id parameter; all derive tenant from `nexus_scoped_tenant_id()/nexus_current_tenant_id()` off the JWT, so no caller-supplied cross-tenant parameter was found.
- `nexus_intake.submit_sales_lead(...)` is `SECURITY DEFINER`, EXECUTE granted to both `anon` and `authenticated` — intentional (public lead-intake form), writes only, does not return cross-tenant rows.
- 3 functions have mutable `search_path` (WARN): `lead_ingest_provider_identity_touch`, `lead_ingest_endpoint_touch`, `nexus_classify_message_intent`.

## 3. Advisors
**Security:** 0 ERROR, 4 WARN groups — (1) 3 functions with mutable search_path, (2) `vector` and `pg_trgm` extensions installed in `public` schema, (3) 1 SECURITY DEFINER function (`submit_sales_lead`) executable by anon (by design), (4) 54 SECURITY DEFINER functions executable by `authenticated` (audited above, no cross-tenant param found), (5) leaked-password protection disabled (auth setting).
**Performance:** 0 ERROR, all WARN/INFO — 82 unindexed FKs, 1 `auth_rls_initplan` re-eval issue on `tenant_members_self_read` (wrap `auth.uid()` in `(select ...)`), `daily_metrics` no PK, 49 unused indexes.

## 4. Migration drift (prod `list_migrations` vs `$HOME/nexus-work/supabase/migrations/`)
- Every migration in both directions matches by **name**; ~18 of them differ only in **timestamp** between the local filename and the prod-applied version (files were renumbered locally after being applied — cosmetic, not a functional gap), concentrated around 2026-09-07 and 2026-09-14.
- **Real drift (2 migrations on disk, never applied to prod):**
  - `20260907230000_the_entry_path_exists_so_connected_is_true_again.sql`
  - `20260914073000_nx932_the_kind_lookup_was_born_open_without_rls.sql` ← name implies an RLS fix that is **not live in production**.

## 5. Product truth (row counts, 2026-09-21)
| Capability | Status | Detail |
|---|---|---|
| leads | HAS REAL DATA | 28 total (Tenant A 21, test-dealer-b 4, test-dealer-c 3). By source: nexus-master-router 26, walk_in 1, whatsapp-whatsapp_cloud 1. By scoring_state: SCORED 25 / PENDING 3. **By score_source: AI_SCORE_UNKNOWN 25, RULES 3 — zero leads carry a real AI score_source.** |
| lead_event | TEST DATA ONLY | 1 row total (Tenant A). |
| conversation | TEST DATA ONLY | 1 row (Tenant A). |
| communication_logs (messages) | HAS REAL DATA | Tenant A 425; test-dealer-b 12, test-dealer-c 7, quarantine 12. |
| channel_message_events | TEST DATA ONLY | 2 rows (Tenant A). |
| appointments | **EMPTY** | 0 rows. |
| notification outbox by status | **EMPTY (effectively)** | 4 rows total, all `PENDING` — nothing has ever advanced to SENT/FAILED. |
| tenant_subscription / subscription_state | **EMPTY** | 0 rows — no tenant, including Tenant A, has a subscription row. |
| channel_registry by type+status | TEST DATA ONLY | 2 active (Tenant A): 1 whatsapp_waha_session, 1 whatsapp_cloud_phone_number_id. |
| lead_ingest_endpoint | TEST DATA ONLY | 6 rows (Tenant A only). |
| audit_log (7d) | HAS REAL DATA | Tenant A 632; test-dealer-b 25, quarantine 24, test-dealer-c 9. |
| rag_documents | TEST DATA ONLY | 15 rows (Tenant A only). |
| inventory | TEST DATA ONLY | 12 rows (Tenant A only). |
| deals / purchase_history | TEST DATA ONLY | Tenant A 1, test-dealer-b 1. |
| customer_360_profiles | TEST DATA ONLY | Tenant A 18, test-dealer-b 5, test-dealer-c 3. |
| deals_embeddings | TEST DATA ONLY | Tenant A 1, test-dealer-b 1. |
| finance_quotes | **EMPTY** | 0 rows. |
| kyc_documents | TEST DATA ONLY | 19 rows total. |
| attribution (v_attribution_events/edges/link_map) | HAS REAL DATA | events 467, edges 448, link_map 48. |

## 6. Test fixtures still present in production
- Tenants `NEXUS TEST DEALER B` (`9060a854-ec38-4f0d-a39c-54372f1998b1`, slug `test-dealer-b`) and `NEXUS TEST DEALER C` (`d6c3bc16-83e0-4568-9547-07bd4468415c`, slug `test-dealer-c`) both exist, created 2026-09-20, with live rows in `leads`, `communication_logs`, `customer_360_profiles`, `purchase_history`, `deals_embeddings`, `audit_log`. These are not just tenant registrations — they carry populated business data in the same tables Tenant A's data lives in.
- Quarantine tenant `02c86264-6653-4522-b055-1c3f359a82fe` also holds live rows (12 communication_logs, 24 audit_log entries in 7d).
