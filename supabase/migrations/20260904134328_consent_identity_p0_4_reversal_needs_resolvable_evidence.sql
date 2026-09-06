------------------------------------------------------------------
-- 9. Reversing a withdrawal.
--
-- After part 7, every replay route was closed and one route was left:
-- assert a brand new consent act, dated after the OPT_OUT, under a
-- mechanism that names a human act, with a reference nobody can look
-- up. Measured on production: that still took BLOCKED / CUSTOMER_OPTED_OUT
-- back to OPTED_IN.
--
-- A database cannot tell a true claim from a false one. It can insist
-- that the claim POINT AT SOMETHING. So a reversal must cite evidence
-- NEXUS can resolve to a row it already holds, dated after the
-- withdrawal: the customer's own measured inbound message, or an
-- audit_log row belonging to this dealership. An off-channel opt-in --
-- a web form, a signature in the showroom -- is still recordable, but
-- the system that took it has to leave a trace first and then cite it.
-- "Trust me" becomes "point at the row".
--
-- This is a constraint on the caller that does not exist yet, which is
-- the cheapest moment it will ever be imposed. It costs a first opt-in
-- nothing: it applies only where a customer has already said no.
------------------------------------------------------------------
create or replace function public.whatsapp_record_opt_in_event(
  p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_event text,
  p_occurred_at timestamptz, p_mechanism text, p_evidence_kind text,
  p_evidence_ref text, p_recorded_by text, p_notes text default null)
returns public.whatsapp_opt_in_event
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_skew  constant interval    := interval '5 minutes';
  v_floor constant timestamptz := timestamptz '2015-01-01 00:00:00+00';
  v_cust  text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_evk   text := upper(btrim(coalesce(p_evidence_kind,'')));
  v_evr   text := btrim(coalesce(p_evidence_ref,''));
  v_ev    text := upper(btrim(coalesce(p_event,'')));
  v_mech  text := upper(btrim(coalesce(p_mechanism,'')));
  v_by    text := btrim(coalesce(p_recorded_by,''));
  v_at    timestamptz := p_occurred_at;
  v_notes text := p_notes;
  v_row   public.whatsapp_opt_in_event;
  v_seen  record;
  v_lastout timestamptz;
  v_resolved boolean := false;
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  ------------------------------------------------------------------
  -- Whose channel, and whose customer.
  ------------------------------------------------------------------
  if not exists (select 1 from public.channel_registry cr
                  where cr.integration_id = p_integration_id
                    and cr.tenant_id = p_tenant_id
                    and cr.status = 'active') then
    raise exception using errcode = '42501',
      message = 'That channel is not an active registered channel of that dealership.',
      detail  = 'NEXUS_CONSENT_CHANNEL_NOT_REGISTERED_TO_TENANT',
      hint    = 'Resolve the tenant from the channel identity (nexus_resolve_channel_tenant) rather than passing both in independently.';
  end if;

  if v_cust = '' then
    raise exception using errcode = '22023',
      message = 'A customer WhatsApp identity is required to record consent.',
      detail  = 'NEXUS_CONSENT_CUSTOMER_IDENTITY_REQUIRED';
  end if;

  if v_ev not in ('OPT_IN','OPT_OUT') then
    raise exception using errcode = '22023',
      message = format('%L is not a consent event NEXUS recognises.', coalesce(nullif(v_ev,''),'(empty)')),
      detail  = 'NEXUS_CONSENT_EVENT_UNKNOWN',
      hint    = 'A consent event is OPT_IN or OPT_OUT. An unrecognised third value is refused rather than treated as either.';
  end if;

  if v_by = '' then
    raise exception using errcode = '22023',
      message = 'Recording consent requires naming who recorded it.',
      detail  = 'NEXUS_CONSENT_RECORDED_BY_REQUIRED',
      hint    = 'recorded_by is not part of the event''s identity -- two systems recording the same act do not make two acts -- but an unattributable consent record cannot be audited.';
  end if;

  ------------------------------------------------------------------
  -- When. Bounded in both directions, and bounded differently
  -- depending on which way the error would fall.
  ------------------------------------------------------------------
  if v_at is null then
    raise exception using errcode = '22023',
      message = 'A consent act with no timestamp cannot be ordered against a withdrawal.',
      detail  = 'NEXUS_CONSENT_TIMESTAMP_REQUIRED',
      hint    = 'Send the moment the customer acted, from the provider''s payload or the form''s own submission time. Do not substitute the time the row is being written.';
  end if;

  if v_at < v_floor then
    raise exception using errcode = '22023',
      message = format('A consent act dated %s predates WhatsApp business messaging and is a broken timestamp, not an old fact.',
                       to_char(v_at at time zone 'UTC','YYYY-MM-DD')),
      detail  = 'NEXUS_CONSENT_TIMESTAMP_IMPLAUSIBLE',
      hint    = 'Check the parse: an epoch in seconds read as milliseconds, or a missing timezone, lands here. Re-record with the real moment.';
  end if;

  if v_at > now() + v_skew then
    if v_ev = 'OPT_IN' then
      raise exception using errcode = '22023',
        message = format('A consent grant dated %s has not happened yet, and NEXUS will not hold a permission on the strength of it.',
                         to_char(v_at at time zone 'UTC','YYYY-MM-DD HH24:MI') || ' UTC'),
        detail  = 'NEXUS_CONSENT_TIMESTAMP_IN_FUTURE',
        hint    = 'A future-dated OPT_IN outranks every real event on file, including a withdrawal, so it is refused rather than stored and ignored -- a stored row reads as consent to anyone auditing this table. Five minutes of clock skew is tolerated. If the provider clock is further out than that, fix the clock.';
    else
      -- A withdrawal is never refused for a clock disagreement.
      v_notes := concat_ws(' ', v_notes,
        format('[NEXUS] Stated occurred_at %s was beyond the accepted clock skew and was clamped to the time of recording; a withdrawal is never refused because two clocks disagree.',
               to_char(v_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') || ' UTC'));
      v_at := now();
    end if;
  end if;

  ------------------------------------------------------------------
  -- Evidence. Required, and for a grant, checkable.
  ------------------------------------------------------------------
  if v_evr = '' then
    raise exception using errcode = '22023',
      message = 'A consent event with no evidence reference cannot be recorded.',
      detail  = 'NEXUS_CONSENT_EVIDENCE_REF_REQUIRED',
      hint    = 'Send the reference to the thing the customer actually did: the provider''s own message id, the form submission id, the signed document reference, the source-system record id. Do NOT substitute an n8n execution id, a webhook delivery id, a generated uuid or a timestamp -- those identify NEXUS''s own retry, not the customer''s act, and each retry would mint a fresh consent record. If there is genuinely no reference, do not record consent.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || p_integration_id::text || v_cust, 0));

  if v_ev = 'OPT_IN' then
    if v_evk = 'WHATSAPP_MESSAGE_ID' then
      -- The strongest route, and the only one NEXUS can check by itself:
      -- the customer sent a message and NEXUS measured it.
      select s.* into v_seen
        from public.whatsapp_customer_message_seen s
       where s.tenant_id = p_tenant_id and s.integration_id = p_integration_id
         and s.customer_wa_id = v_cust and s.external_message_id = v_evr;
      if not found then
        raise exception using errcode = '22023',
          message = 'That message id is not a message NEXUS has observed from this customer on this channel.',
          detail  = 'NEXUS_CONSENT_EVIDENCE_NOT_OBSERVED',
          hint    = 'An OPT_IN evidenced by the customer''s own message must name a message already recorded by whatsapp_record_customer_message for this same conversation. Record the inbound message first. A message id NEXUS never saw is an assertion, not evidence -- if the consent came from somewhere else, say where with the matching evidence_kind.';
      end if;
      if v_at <> v_seen.first_occurred_at then
        raise exception using errcode = '22023',
          message = 'The consent timestamp does not match the message it cites.',
          detail  = 'NEXUS_CONSENT_EVIDENCE_TIME_MISMATCH',
          hint    = format('Message %L was observed at %s. A consent act evidenced by a message happened when that message was sent; a different timestamp on the same evidence is how one act becomes two.',
                           v_evr, to_char(v_seen.first_occurred_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') || ' UTC');
      end if;

    elsif v_evk = 'AUDIT_LOG_ID' then
      if v_evr !~* v_uuid
         or not exists (select 1 from public.audit_log a
                         where a.id = v_evr::uuid and a.tenant_id = p_tenant_id) then
        raise exception using errcode = '22023',
          message = 'That audit log id is not on file for this dealership.',
          detail  = 'NEXUS_CONSENT_EVIDENCE_NOT_ON_FILE',
          hint    = 'An AUDIT_LOG_ID must name a row that exists in audit_log for this tenant. A uuid that resolves to nothing is a generated id wearing an evidence label.';
      end if;

    else
      -- COMMUNICATION_LOG_ID, FORM_SUBMISSION_ID, DOCUMENT_REF,
      -- SOURCE_SYSTEM_RECORD_ID: NEXUS holds no table to check these
      -- against, so they stay operator assertions. What can be refused
      -- is the shape that means "I had nothing to put here".
      if v_evr ~* v_uuid
         or v_evr ~ '^[0-9]{10,}$'
         or v_evr ~* '^(nokey:|urn:uuid:|exec[-_:]|execution[-_:]|run[-_:]|job[-_:])' then
        raise exception using errcode = '22023',
          message = format('%L is a generated identifier, not evidence a person could go and check.', v_evr),
          detail  = 'NEXUS_CONSENT_EVIDENCE_LOOKS_GENERATED',
          hint    = 'A bare uuid, a bare epoch, or an execution/run/job id identifies a NEXUS process, not something the customer did, and NEXUS cannot resolve it to anything. If the reference genuinely is a row in this database, cite it with a kind that can be checked (AUDIT_LOG_ID) or qualify it so a human can find the table it belongs to (for example form:<id>). If it is an n8n execution id, it is not evidence of consent.';
      end if;
    end if;

    ----------------------------------------------------------------
    -- Reversing a withdrawal.
    ----------------------------------------------------------------
    select max(e.occurred_at) into v_lastout
      from public.whatsapp_opt_in_event e
     where e.tenant_id = p_tenant_id and e.integration_id = p_integration_id
       and e.customer_wa_id = v_cust and e.event = 'OPT_OUT'
       and e.occurred_at <= now() + v_skew;

    if v_lastout is not null and v_at > v_lastout then
      -- A withdrawal is reversed by an act of the customer's, not by an
      -- operator keystroke and not by a re-import.
      if v_mech in ('OPERATOR_RECORDED','IMPORTED_FROM_SOURCE_SYSTEM') then
        raise exception using errcode = '22023',
          message = 'This customer has withdrawn consent, and a withdrawal cannot be reversed by NEXUS or by an import.',
          detail  = 'NEXUS_CONSENT_REVERSAL_REQUIRES_CUSTOMER_ACT',
          hint    = format('The most recent OPT_OUT on this conversation is dated %s. An OPT_IN after it must name something the customer did -- their own message, a form they submitted, a document they signed or a call that was recorded. OPERATOR_RECORDED and IMPORTED_FROM_SOURCE_SYSTEM name no act of the customer''s, and re-importing an old CRM opt-in over a fresh STOP is exactly the harm this table exists to prevent.',
                           to_char(v_lastout at time zone 'UTC','YYYY-MM-DD HH24:MI') || ' UTC');
      end if;

      -- And the act it names must be one NEXUS can resolve to a row it
      -- already holds, dated after the withdrawal. A free-text reference
      -- nobody can look up is the last route by which a conversation
      -- came back from BLOCKED without the customer doing anything.
      if v_evk = 'WHATSAPP_MESSAGE_ID' then
        v_resolved := v_seen.first_occurred_at > v_lastout;
      elsif v_evk = 'AUDIT_LOG_ID' then
        select exists (select 1 from public.audit_log a
                        where a.id = v_evr::uuid and a.tenant_id = p_tenant_id
                          and a.logged_at > v_lastout)
          into v_resolved;
      end if;

      if not v_resolved then
        raise exception using errcode = '22023',
          message = 'Reversing a withdrawal requires evidence NEXUS can resolve, and this reference resolves to nothing.',
          detail  = 'NEXUS_CONSENT_REVERSAL_REQUIRES_RESOLVABLE_EVIDENCE',
          hint    = format('The most recent OPT_OUT on this conversation is dated %s. A first opt-in may rest on the recording system''s word; overturning a customer''s STOP may not, because a reference nobody can look up is indistinguishable from a fabricated one. Cite either the customer''s own inbound message (evidence_kind WHATSAPP_MESSAGE_ID, already recorded by whatsapp_record_customer_message and dated after the opt-out), or an audit_log row of this dealership''s dated after the opt-out (evidence_kind AUDIT_LOG_ID). An off-channel re-subscription is still recordable: write the audit_log row when the form is submitted, then cite it here.',
                           to_char(v_lastout at time zone 'UTC','YYYY-MM-DD HH24:MI') || ' UTC');
      end if;
    end if;
  end if;

  ------------------------------------------------------------------
  -- Record it. Both unique constraints are serialisation points: a
  -- concurrent second backend blocks on the uncommitted key and then
  -- finds it committed, so one act produces one row however many
  -- writers raced for it.
  ------------------------------------------------------------------
  insert into public.whatsapp_opt_in_event
    (tenant_id, integration_id, customer_wa_id, event, occurred_at,
     mechanism, evidence_kind, evidence_ref, recorded_by, notes)
  values (p_tenant_id, p_integration_id, v_cust, v_ev, v_at,
          v_mech, v_evk, v_evr, v_by, nullif(btrim(coalesce(v_notes,'')),''))
  on conflict do nothing
  returning * into v_row;

  if v_row is null then
    -- Already on file. Return the fact as first recorded; a redelivery
    -- does not restate it later than it happened, and a restatement
    -- under different paperwork does not make it a second act.
    select * into v_row from public.whatsapp_opt_in_event e
     where e.tenant_id = p_tenant_id and e.integration_id = p_integration_id
       and e.customer_wa_id = v_cust and lower(btrim(e.evidence_ref)) = lower(v_evr);
    if v_row is null then
      select * into v_row from public.whatsapp_opt_in_event e
       where e.tenant_id = p_tenant_id and e.integration_id = p_integration_id
         and e.customer_wa_id = v_cust and e.event = v_ev and e.occurred_at = v_at;
    end if;
  end if;
  return v_row;
end;
$function$;

revoke all on function public.whatsapp_record_opt_in_event(uuid,uuid,text,text,timestamptz,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.whatsapp_record_opt_in_event(uuid,uuid,text,text,timestamptz,text,text,text,text,text) to service_role;