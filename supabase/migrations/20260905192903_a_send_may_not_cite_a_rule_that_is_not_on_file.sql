alter table public.channel_send_directive
  add constraint channel_send_directive_policy_applied_rule_id_fkey
  foreign key (policy_applied_rule_id) references public.policy_rule(id)
  on delete restrict;

create or replace function public.channel_send_directive_guard_policy_citation()
returns trigger language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_owner uuid;
  v_found boolean := false;
begin
  if new.policy_applied_rule_id is null then
    return new;
  end if;

  select r.tenant_id, true
    into v_owner, v_found
    from public.policy_rule r
   where r.id = new.policy_applied_rule_id;

  if not v_found then
    raise exception
      'channel_send_directive: policy rule % is not on file. A send may not cite a rule that does not exist.',
      new.policy_applied_rule_id using errcode = '23503';
  end if;

  if v_owner is not null and v_owner is distinct from new.tenant_id then
    raise exception
      'channel_send_directive: policy rule % belongs to dealership %, but this directive is for %. One dealership''s own policy is not authority over another dealership''s send.',
      new.policy_applied_rule_id, v_owner, new.tenant_id using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.channel_send_directive_guard_policy_citation() from anon, authenticated, public;

create trigger channel_send_directive_guard_policy_citation
  before insert or update of policy_applied_rule_id, tenant_id
  on public.channel_send_directive
  for each row execute function public.channel_send_directive_guard_policy_citation();