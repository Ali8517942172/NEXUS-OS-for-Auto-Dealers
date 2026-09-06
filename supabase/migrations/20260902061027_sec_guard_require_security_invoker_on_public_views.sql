-- BUSINESS RULE
-- Every view in schema `public` MUST carry the reloption `security_invoker`.
-- Why: without it, RLS on the underlying tables is evaluated as the view's OWNER
-- (postgres, which is BYPASSRLS) instead of the caller. A view created without the
-- option is therefore readable IN FULL by anyone holding the public anon key --
-- every customer name, phone, email and message body.
-- This has regressed three times, because `CREATE OR REPLACE VIEW` silently resets
-- reloptions to NULL: the option must be restated on EVERY replace. A comment is a
-- note, not a guard; this event trigger is the guard.
--
-- The trigger runs SECURITY INVOKER on purpose: it only reads catalogs and raises,
-- so it must never become a postgres-privileged code path for whoever runs the DDL.
-- search_path is pinned to pg_catalog so no object in `public` can shadow what it calls.
--
-- Break-glass (deliberate, auditable, session-scoped):
--   SET nexus.allow_insecure_view = 'on';

CREATE OR REPLACE FUNCTION public.nexus_require_security_invoker_views()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
DECLARE
  r      record;
  v_opt  text;
  v_val  text;
  v_bad  text[] := '{}';
BEGIN
  IF lower(coalesce(current_setting('nexus.allow_insecure_view', true), 'off'))
     IN ('on','true','yes','1') THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT ddl.objid, ddl.object_identity
      FROM pg_catalog.pg_event_trigger_ddl_commands() ddl
     WHERE ddl.object_type = 'view'
       AND ddl.schema_name = 'public'
  LOOP
    SELECT o
      INTO v_opt
      FROM pg_catalog.unnest(
             coalesce((SELECT c.reloptions
                         FROM pg_catalog.pg_class c
                        WHERE c.oid = r.objid), '{}'::text[])
           ) AS o
     WHERE o LIKE 'security_invoker=%'
     LIMIT 1;

    -- Accept every truthy spelling Postgres itself accepts for a boolean reloption.
    -- Both `security_invoker=on` and `security_invoker=true` are in use in this codebase.
    v_val := lower(btrim(coalesce(split_part(v_opt, '=', 2), '')));

    IF v_val NOT IN ('on','true','yes','1') THEN
      v_bad := v_bad || r.object_identity;
    END IF;
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION
      'NEXUS SECURITY GATE: view(s) % in schema public lack security_invoker',
      array_to_string(v_bad, ', ')
      USING ERRCODE = '42501',
            DETAIL  = 'Without security_invoker, RLS is evaluated as the view owner (postgres, BYPASSRLS), not the caller. Such a view exposes every underlying row to the public anon key.',
            HINT    = 'Recreate the view WITH (security_invoker = on). CREATE OR REPLACE VIEW resets reloptions to NULL, so the option must be restated on every replace.';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.nexus_require_security_invoker_views() IS
  'Guard: refuses any CREATE/ALTER of a public view that lacks security_invoker. Prevents the anon-key data-leak regression that has occurred three times. Break-glass: SET nexus.allow_insecure_view = ''on''.';

DROP EVENT TRIGGER IF EXISTS nexus_guard_security_invoker_views;

-- ALTER TABLE is included because `ALTER TABLE <view> RESET (security_invoker)` is
-- legal on a view and carries the ALTER TABLE tag; the object_type filter above means
-- ordinary table DDL loops over zero rows and passes straight through.
CREATE EVENT TRIGGER nexus_guard_security_invoker_views
  ON ddl_command_end
  WHEN TAG IN ('CREATE VIEW', 'ALTER VIEW', 'ALTER TABLE')
  EXECUTE FUNCTION public.nexus_require_security_invoker_views();

COMMENT ON EVENT TRIGGER nexus_guard_security_invoker_views IS
  'Business rule: every view in schema public must be security_invoker. See public.nexus_require_security_invoker_views().';
