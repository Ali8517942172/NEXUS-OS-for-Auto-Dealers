-- Same defect as the customer service window, one table over. A consent fact was
-- identified by nothing at all, so re-recording the SAME evidence with a bumped
-- occurred_at inserted a second row and overtook a later OPT_OUT -- proved on
-- 4 Sep: BLOCKED/CUSTOMER_OPTED_OUT became FREEFORM_ALLOWED by replay alone.
-- A consent evidenced by one form submission or one WhatsApp message is one fact
-- however many times it is delivered, so occurred_at is deliberately NOT in the
-- key: letting the timestamp mint a new identity is exactly the attack.
alter table public.whatsapp_opt_in_event
  add constraint whatsapp_opt_in_event_evidence_key
  unique (tenant_id, integration_id, customer_wa_id, event, evidence_kind, evidence_ref);

create or replace function public.whatsapp_record_opt_in_event(
  p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_event text,
  p_occurred_at timestamptz, p_mechanism text, p_evidence_kind text,
  p_evidence_ref text, p_recorded_by text, p_notes text default null)
returns whatsapp_opt_in_event
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_cust text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_evk  text := upper(btrim(coalesce(p_evidence_kind,'')));
  v_evr  text := btrim(coalesce(p_evidence_ref,''));
  v_ev   text := upper(btrim(coalesce(p_event,'')));
  v_row  public.whatsapp_opt_in_event;
begin
  if not exists (select 1 from public.channel_registry cr
                  where cr.integration_id = p_integration_id
                    and cr.tenant_id = p_tenant_id
                    and cr.status = 'active') then
    raise exception using errcode = '42501',
      message = 'That channel is not an active registered channel of that dealership.';
  end if;

  insert into public.whatsapp_opt_in_event
    (tenant_id, integration_id, customer_wa_id, event, occurred_at,
     mechanism, evidence_kind, evidence_ref, recorded_by, notes)
  values (p_tenant_id, p_integration_id, v_cust, v_ev, p_occurred_at,
          upper(btrim(coalesce(p_mechanism,''))), v_evk, v_evr,
          btrim(coalesce(p_recorded_by,'')), p_notes)
  on conflict on constraint whatsapp_opt_in_event_evidence_key do nothing
  returning * into v_row;

  if v_row is null then
    -- Already on file. Return the fact as first recorded; a redelivery does not
    -- restate it later than it happened.
    select * into v_row from public.whatsapp_opt_in_event e
     where e.tenant_id = p_tenant_id and e.integration_id = p_integration_id
       and e.customer_wa_id = v_cust and e.event = v_ev
       and e.evidence_kind = v_evk and e.evidence_ref = v_evr;
  end if;
  return v_row;
end;
$function$;