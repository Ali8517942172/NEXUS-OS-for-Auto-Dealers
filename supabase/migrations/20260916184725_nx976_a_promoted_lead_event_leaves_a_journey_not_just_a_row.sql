-- NX976 — A promoted lead event leaves a journey, not just a row.
--
-- NX970 put the journey on channel_message_events, so a WhatsApp enquiry can
-- be walked hop by hop: message -> customer -> conversation -> classification
-- -> promotion -> lead. Every other way a lead enters this system -- a
-- salesperson typing a phone call or a walk-in, a Meta lead ad, a Google lead
-- form, the website -- arrives through `lead_event` instead, and left no
-- journey at all. nexus_journey_trace() returned nothing for them.
--
-- That made every non-WhatsApp source second class in the one screen that is
-- supposed to answer "why does this lead matter and what happened to it". A
-- dealership evaluating NEXUS on a phone lead saw a row; on a WhatsApp lead
-- they saw the evidence. Same product, two answers.
--
-- Same shape as NX970, and the same rule: THE TRAIL MAY NEVER COST THE LEAD.
-- Everything is wrapped so a bug here records a FAILED step and returns; it
-- cannot roll back the promotion that triggered it. Losing a real enquiry to
-- protect the audit of it would be exactly backwards.
--
-- CONVERSATION_OPENED is SKIPPED on purpose and says why: a phone call and a
-- walk-in are not carried by a messaging channel, so there is no thread to
-- open. A blank step would read as a gap; a stated skip reads as a decision.

begin;

create or replace function public.nexus_journey_on_lead_event_promoted()
returns trigger
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog','pg_temp'
as $fn$
declare
  v_norm   jsonb := coalesce(new.normalized, '{}'::jsonb);
  v_digits text;
  v_email  text;
  v_cust   uuid;
  v_corr   text := new.event_id::text;
begin
  begin
    v_digits := nullif(regexp_replace(coalesce(v_norm->>'phone_e164',''), '[^0-9]', '', 'g'), '');
    -- A number that does not look like a number is dropped, not stored. A
    -- mangled one is a customer nobody can reach, wearing the shape of one
    -- who can.
    if v_digits is not null and v_digits !~ '^[0-9]{6,20}$' then
      v_digits := null;
    end if;
    v_email := nullif(btrim(coalesce(v_norm->>'email','')), '');

    if v_digits is not null then
      insert into public.customer (tenant_id, display_name, phone_digits, email)
      values (new.tenant_id, nullif(btrim(coalesce(v_norm->>'full_name','')),''), v_digits, v_email)
      on conflict (tenant_id, phone_digits) where phone_digits is not null
      do update set last_seen_at = now(),
                    display_name = coalesce(public.customer.display_name, excluded.display_name),
                    email        = coalesce(public.customer.email,        excluded.email)
      returning id into v_cust;
    elsif v_email is not null then
      -- No unique index on email, so this cannot upsert. A person known only
      -- by an address is recorded as new rather than guessed into an existing
      -- row -- merging two people because they share a typo is worse than
      -- holding two rows for one person.
      insert into public.customer (tenant_id, display_name, phone_digits, email)
      values (new.tenant_id, nullif(btrim(coalesce(v_norm->>'full_name','')),''), null, v_email)
      returning id into v_cust;
    end if;

    insert into public.journey_step
      (correlation_id, tenant_id, step, status, ref_table, ref_id, detail)
    values
      (v_corr, new.tenant_id, 'LEAD_EVENT_RECORDED', 'OK', 'lead_event', new.event_id::text,
       'Arrived as ' || new.source_key || ', provenance ' || new.origin_verified
       || ', counts as real: ' || new.provenance_counts_as_real::text || '.'),
      (v_corr, new.tenant_id, 'CUSTOMER_IDENTIFIED',
       case when v_cust is null then 'SKIPPED' else 'OK' end,
       'customer', v_cust::text,
       case when v_cust is null
            then 'The normalised lead carried neither a usable phone number nor an email, so no person row was made.'
            when v_digits is not null
            then 'Identified on the phone number the lead carried.'
            else 'Identified on the email address the lead carried; no phone number to match on.'
       end),
      (v_corr, new.tenant_id, 'CONVERSATION_OPENED', 'SKIPPED', null, null,
       'This source is not carried by a messaging channel, so there is no thread to open. Stated rather than left blank: a gap and a decision look the same in an empty row.'),
      (v_corr, new.tenant_id, 'LEAD_PROMOTED',
       case when new.lead_id is null then 'FAILED' else 'OK' end,
       'leads', new.lead_id::text,
       case when new.lead_id is null
            then 'The event says PROMOTED but carries no lead_id. Promotion did not finish.'
            else 'Promoted to lead ' || new.lead_id::text || '.'
       end);
  exception when others then
    -- The trail records its own failure and gets out of the way.
    begin
      insert into public.journey_step (correlation_id, tenant_id, step, status, detail)
      values (v_corr, new.tenant_id, 'JOURNEY_FROM_LEAD_EVENT', 'FAILED', left(sqlerrm, 500));
    exception when others then null;
    end;
  end;
  return new;
end
$fn$;

comment on function public.nexus_journey_on_lead_event_promoted() is
  'Writes the journey for a lead that did NOT arrive as a message: manual '
  'phone and walk-in entry, Meta and Google lead ads, the website. The '
  'messaging equivalent is nexus_journey_on_message_recorded (NX970). Neither '
  'may ever fail the write that triggered it.';

drop trigger if exists journey_on_lead_event_promoted on public.lead_event;

-- Both INSERT and UPDATE. nexus_promote_lead_event() updates phase on an
-- existing row today, but a path that inserts an already-promoted row would
-- otherwise leave no trail and nothing would say so.
create trigger journey_on_lead_event_promoted
  after insert or update of phase on public.lead_event
  for each row
  when (new.phase = 'PROMOTED')
  execute function public.nexus_journey_on_lead_event_promoted();

commit;