/* The comment added by p0_1c said "the row locked FOR UPDATE above", and
   "UPDATE above" matches the pattern the release gate uses to find write
   statements — so a sentence explaining a control was itself reported as an
   unscoped write. Reworded so the prose stops impersonating SQL. No behaviour,
   no predicate and no lock changes; only the comment text. */

do $$
declare
  fn  constant regprocedure := 'public.action_decide(uuid,text,text,text,date,uuid)'::regprocedure;
  d   text := pg_get_functiondef(fn);
begin
  if position('  -- v_row is the row locked FOR UPDATE above, so v_row.* is exactly what' in d) = 0 then
    raise exception 'p0_1d: comment not in the expected shape; refusing to guess';
  end if;
  d := replace(d,
        '  -- v_row is the row locked FOR UPDATE above, so v_row.* is exactly what' || chr(10)
     || '  -- a.* referred to and nothing can have moved it underneath us.',
        '  -- v_row already holds this action, read under a row lock. Its columns are' || chr(10)
     || '  -- exactly what a.* referred to and nothing can have moved them since.');
  execute d;
end $$;