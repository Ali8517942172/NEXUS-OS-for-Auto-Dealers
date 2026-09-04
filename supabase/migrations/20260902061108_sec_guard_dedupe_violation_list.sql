-- CREATE OR REPLACE VIEW emits two ddl_command rows for the same object, which made
-- the guard's error text repeat the view name. Dedupe so the message reads cleanly.
-- Business rule unchanged: every view in schema public must carry security_invoker.

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
    SELECT DISTINCT ddl.objid, ddl.object_identity
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

    -- Accept every truthy spelling Postgres accepts for a boolean reloption.
    -- Both `security_invoker=on` and `security_invoker=true` are in use here.
    v_val := lower(btrim(coalesce(split_part(v_opt, '=', 2), '')));

    IF v_val NOT IN ('on','true','yes','1')
       AND NOT (v_bad @> ARRAY[r.object_identity]) THEN
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
