-- Close the Supabase default `authenticated=arwdDxtm` grant across public.
--
-- Why: CREATE in `public` grants ALL privileges directly to `anon` and
-- `authenticated`. On 32 objects that grant was never narrowed, so `authenticated`
-- held INSERT/UPDATE/DELETE **and TRUNCATE** on tables including audit_log, users,
-- finance_quotes and purchase_history. RLS filtered the DML to 0 rows, but RLS does
-- not apply to TRUNCATE at all: measured in a rolled-back transaction, a signed-in
-- user truncated `competitors` from 13 rows to 0.
--
-- Consumers established from edge logs (not assumed): `authenticated` issues GET
-- only; every observed write carries user agent `n8n` and runs as `service_role`.
-- The dashboard's only direct table writes, confirmed in the shipped bundle
-- (dist/assets/main-*.js), are inventory (POST/PATCH/DELETE) and leads (PATCH);
-- everything else goes through SECURITY DEFINER rpc/* owned by postgres, which is
-- unaffected by the caller's table grants.
--
-- service_role is deliberately untouched throughout.

-- 1. Read-only for the dashboard: SELECT is the only verb any consumer uses.
do $$
declare t text;
  ro text[] := array[
    'audit_log','communication_logs','competitors','customer_360_profiles',
    'daily_metrics','deals_embeddings','finance_quotes','inventory_profit_settings',
    'kyc_documents','purchase_history','rag_documents','users',
    'whatsapp_contacts','workflow_registry'];
begin
  foreach t in array ro loop
    execute format('revoke all on public.%I from authenticated, anon, public', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 2. inventory — live dashboard write path (unit form: create / edit / delete).
--    Kept, minus TRUNCATE/REFERENCES/TRIGGER/MAINTAIN which no path uses.
revoke all on public.inventory from authenticated, anon, public;
grant select, insert, update, delete on public.inventory to authenticated;

-- 3. leads — live dashboard write path is owner assignment (PATCH) only.
--    INSERT and DELETE are n8n's, as service_role.
revoke all on public.leads from authenticated, anon, public;
grant select, update on public.leads to authenticated;

-- 4. processed_messages — the WhatsApp idempotency ledger. RLS already denies
--    `authenticated` every verb (processed_messages_no_authenticated USING false),
--    and the table appears nowhere in the dashboard source or shipped bundle.
--    Removing the grant makes that two locks instead of one.
revoke all on public.processed_messages from authenticated, anon, public;

-- 5. Views — all 15 are security_invoker; two (v_inventory_sales,
--    v_fin_gate_quote_evidence) are auto-updatable. Nothing writes through them.
do $$
declare v text;
  vs text[] := array[
    'v_action_center_health','v_audit_unregistered_writers','v_competitor_latest',
    'v_conversations','v_customer_360','v_customer_directory',
    'v_fin_gate_quote_evidence','v_inventory_action_queue','v_inventory_action_timeline',
    'v_inventory_profit_sentinel','v_inventory_sales','v_lead_messages',
    'v_needs_attention','v_team_performance','v_workflow_health'];
begin
  foreach v in array vs loop
    execute format('revoke all on public.%I from authenticated, anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- 6. Sequences — `authenticated` held rwU, and UPDATE on a sequence is setval():
--    rewinding leads_id_seq would collide primary keys on the dealership's next
--    real insert. After the above, `authenticated` INSERTs into no sequence-backed
--    table (inventory has no sequence; leads/competitors/rag_documents INSERT is
--    now revoked), so USAGE is not needed either.
revoke all on sequence
  public.leads_id_seq, public.competitors_id_seq, public.rag_documents_id_seq
  from authenticated, anon, public;
