/* ═══════════════════════════════════════════════════════════════════════════
   P0-1, third and last part.

   BUSINESS RULE (unchanged from p0_1b)
   A write inside a SECURITY DEFINER function names the dealership it writes to
   in its own WHERE clause, close enough to the statement that a reader — human
   or gate — can see it without scrolling.

   WHY THIS EXISTS
   p0_1b gave action_decide's decision write an explicit
   `and a.tenant_id = v_ctx.tenant_id`. It is correct and it is still 984
   characters below the `update` keyword, because the SET clause carries four
   inline CASE expressions. The release gate's L4 check reads 900 characters
   after each write and reports anything further as "carries no tenant
   predicate, it rewrites every dealership's rows" — a P0 that blocks the gate.
   Here that is a false positive about behaviour and a fair complaint about
   legibility: 84 characters is the whole of the difference between a control a
   reviewer can see and one they must go looking for.

   THE FIX
   The two longest assignments are computed into variables immediately above the
   statement, where they read better anyway, leaving the write as a short list of
   assignments with its tenant predicate visible. v_row is the row already locked
   FOR UPDATE by the SELECT above, so v_row.assigned_to_staff_id,
   v_row.assigned_role and v_row.engine_owner_role are the same values `a.*`
   referred to and no other session can have moved them. Behaviour is unchanged;
   what changes is that nobody has to take that on trust.

   Nothing is weakened to achieve it: the predicate added in p0_1b stays, the
   FOR UPDATE lock stays, and the approval checks above are untouched. The
   function is rewritten from its own live definition by three asserted textual
   substitutions, so no other line can drift.
   ═══════════════════════════════════════════════════════════════════════════ */

do $$
declare
  fn  constant regprocedure := 'public.action_decide(uuid,text,text,text,date,uuid)'::regprocedure;
  d   text := pg_get_functiondef(fn);
  before_len integer;
  after_len  integer;
begin
  before_len := regexp_instr(
    substring(d from regexp_instr(d,'update public\.inventory_actions a set',1,1,0,'i')),
    'tenant_id', 1, 1, 0, 'i');

  -- 1 · two new locals
  if position('  v_sent    text;' || chr(10) || 'begin' in d) = 0 then
    raise exception 'p0_1c: declaration block not in the expected shape; refusing to guess';
  end if;
  d := replace(d,
        '  v_sent    text;' || chr(10) || 'begin',
        '  v_sent    text;' || chr(10)
     || '  v_new_assignee uuid;   -- hoisted out of the SET clause below' || chr(10)
     || '  v_new_role     text;   -- so the tenant predicate stays readable' || chr(10)
     || 'begin');

  -- 2 · compute them just above the write
  if position('  update public.inventory_actions a set' || chr(10) || '    status               = v_target,' in d) = 0 then
    raise exception 'p0_1c: decision write not in the expected shape; refusing to guess';
  end if;
  d := replace(d,
        '  update public.inventory_actions a set' || chr(10) || '    status               = v_target,',
        '  -- v_row is the row locked FOR UPDATE above, so v_row.* is exactly what' || chr(10)
     || '  -- a.* referred to and nothing can have moved it underneath us.' || chr(10)
     || '  v_new_assignee := case when v_target = ''APPROVED'' then p_assign_staff_id' || chr(10)
     || '                         else v_row.assigned_to_staff_id end;' || chr(10)
     || '  v_new_role     := case when v_target <> ''APPROVED'' then v_row.assigned_role' || chr(10)
     || '                         when p_assign_staff_id is null then v_row.engine_owner_role' || chr(10)
     || '                         else v_assign.role end;' || chr(10) || chr(10)
     || '  update public.inventory_actions a set' || chr(10) || '    status               = v_target,');

  -- 3 · the SET clause now assigns the two locals
  if position('    assigned_to_staff_id = case when v_target = ''APPROVED'' then p_assign_staff_id else a.assigned_to_staff_id end,' in d) = 0 then
    raise exception 'p0_1c: assignment expressions not in the expected shape; refusing to guess';
  end if;
  d := replace(d,
        '    assigned_to_staff_id = case when v_target = ''APPROVED'' then p_assign_staff_id else a.assigned_to_staff_id end,' || chr(10)
     || '    assigned_role        = case when v_target <> ''APPROVED'' then a.assigned_role' || chr(10)
     || '                                when p_assign_staff_id is null then a.engine_owner_role' || chr(10)
     || '                                else v_assign.role end,',
        '    assigned_to_staff_id = v_new_assignee,' || chr(10)
     || '    assigned_role        = v_new_role,');

  execute d;

  after_len := regexp_instr(
    substring(d from regexp_instr(d,'update public\.inventory_actions a set',1,1,0,'i')),
    'tenant_id', 1, 1, 0, 'i');
  raise notice 'p0_1c: tenant predicate moved from % to % characters below the write', before_len, after_len;
  if after_len = 0 or after_len >= 900 then
    raise exception 'p0_1c: predicate is still % characters away; the rewrite did not achieve its purpose', after_len;
  end if;
end $$;