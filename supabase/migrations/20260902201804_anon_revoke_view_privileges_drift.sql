-- BUSINESS RULE: the public anon key is issued to anyone who opens the dashboard
-- in a browser. No dealership-owned row, and no write path to one, may be
-- reachable with it. A dealership's leads, conversations, customers, deal
-- margins and finance evidence are the product's confidential asset; one
-- dealership seeing another's, or an anonymous caller mutating either, ends the
-- subscription and creates liability.
--
-- WHAT WAS ACTUALLY OPEN (measured 2 Sep 2026, not assumed):
--   These 10 views each carried `anon=arwdDxtm/postgres` — that is ALL
--   privileges, not merely SELECT as first reported: SELECT, INSERT, UPDATE,
--   DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN.
--   Verified as role `anon`: all 10 return 0 rows, because every view is
--   security_invoker and every base table carries a RESTRICTIVE
--   `<table>_deny_anon` policy (USING false / WITH CHECK false).
--   BUT `DELETE FROM public.v_inventory_sales` as `anon` PARSES AND EXECUTES —
--   it is stopped only by the RLS row filter, affecting 0 rows. The privilege
--   itself is granted. v_inventory_sales and v_fin_gate_quote_evidence are
--   auto-updatable (information_schema.views.is_updatable = YES), so this is a
--   live write path standing on exactly ONE lock (RLS). That is one lock too
--   few for a delete against inventory.
--
-- WHY REVOKING IS SAFE — who actually reads these (edge_logs, role per request
-- from request.sb.jwt.authorization.payload.role):
--   authenticated : v_needs_attention(105), v_workflow_health(27),
--                   v_conversations(15), v_competitor_latest(6),
--                   v_customer_360(3), v_customer_directory(3),
--                   v_team_performance(3)  -- the dashboard, which signs in
--                   (app.js boot() renders the login card and RETURNS before
--                   any screen fetches, so no read happens pre-sign-in)
--   service_role  : v_customer_directory, v_inventory_sales -- user_agent 'n8n',
--                   apikey prefix 'sb_secret_...'
--   anon          : ZERO reads of any of these 10 views.
-- The only anon GETs in the window went to v_inventory_action_queue and
-- v_inventory_action_timeline — the newer Action Center views, which never had
-- an anon grant — and both returned 401. That is the natural experiment: with
-- no anon grant the endpoint fails clean and no feature breaks. These 10 are
-- drift from Supabase's default privileges, not a design.
--
-- authenticated and service_role are untouched below, so every reader above
-- keeps exactly what it has. PUBLIC is revoked alongside anon because a PUBLIC
-- `=` ACL entry is a grant anon reaches through, which is how one of these
-- stayed open before.

revoke all on table
  public.v_conversations,
  public.v_customer_360,
  public.v_customer_directory,
  public.v_lead_messages,
  public.v_needs_attention,
  public.v_team_performance,
  public.v_inventory_sales,
  public.v_competitor_latest,
  public.v_fin_gate_quote_evidence,
  public.v_workflow_health
from anon, public;

-- Stop the drift recurring: Supabase's default privileges are what granted
-- these in the first place, so a future CREATE VIEW in public would be born
-- with the same anon grant unless the default itself is changed.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
