-- Found by running the path, not by reading it.
--
-- The first cut of v_lead_timeline_admissible DROPPED quarantined rows. Fed
-- that timeline, the escalation model wrote, in a briefing a rep was about to
-- read to the customer:
--
--   "there is no monthly instalment or APR anywhere in this customer's
--    recorded history -- no figure was ever sent to him, so there is nothing
--    on file to 'confirm.'"
--
-- That is FALSE, and it is this codebase's oldest defect wearing a new hat:
-- CLAUDE.md, "A missing row is not proof the event did not happen. Unknown is
-- not none. This codebase has rendered that lie in six separate places."
-- Silently deleting the row from the model's view made it seven. The customer
-- WAS given AED 11,200; he will say so on the call; and the rep would have been
-- briefed that nothing was ever sent.
--
-- So quarantine leaves a TOMBSTONE, not a hole. The model is told a message
-- exists at that timestamp and that its content is inadmissible -- and is not
-- told what the content was. The bad value still never reaches a model; the
-- FACT of the message is no longer erased.
--
-- The tombstone is built in SQL from a closed vocabulary and the row's own
-- timestamp. It never interpolates the original text and never carries a
-- figure, so it cannot itself become the next bad evidence.

create or replace view public.v_lead_timeline_admissible
with (security_invoker = true) as
  select c.id, c.lead_email, c.channel, c.direction,
         case
           when c.evidence_state = 'ADMISSIBLE' then c.message
           else '[CONTENT WITHHELD AS INADMISSIBLE EVIDENCE] A '
                || c.direction || ' ' || coalesce(c.channel,'message')
                || ' message was really sent on this thread on '
                || to_char(c.created_at at time zone 'UTC','DD Mon YYYY "at" HH24:MI') || ' UTC'
                || ', and NEXUS has ruled its content inadmissible ('
                || coalesce(e.reason_code,'UNSPECIFIED') || '). '
                || 'The customer may well refer to what it said. Do not restate, '
                || 'confirm, deny or reason from its contents, and do not tell '
                || 'anyone that no message was sent - one was. Any figure must '
                || 'come from the finance calculator with a calculation_id.'
         end as message,
         c.created_at, c.sent_by, c.tenant_id, c.external_message_id,
         c.channel_key, c.direction_key, c.evidence_state,
         (c.evidence_state <> 'ADMISSIBLE') as content_withheld
    from public.communication_logs c
    left join lateral (select ev.reason_code
                         from public.communication_log_evidence_event ev
                        where ev.comm_log_id = c.id
                        order by ev.at desc, ev.evidence_rank asc, ev.id desc
                        limit 1) e on true
   where not exists (select 1 from public.tenants _q
                      where _q.is_quarantine and _q.id = c.tenant_id);

comment on view public.v_lead_timeline_admissible is
  'The conversation timeline as a model may see it. Rows ruled inadmissible keep their place, their timestamp and their direction, but their CONTENT is replaced by a tombstone naming the reason. Two failures are being avoided at once: quoting a fabricated figure back as fact (which dropping the row fixes) and telling a rep that no message was ever sent (which dropping the row CAUSES). Every reader that hands history to a model must read this, not communication_logs.';

revoke all on public.v_lead_timeline_admissible from anon, authenticated, public;
grant select on public.v_lead_timeline_admissible to service_role;