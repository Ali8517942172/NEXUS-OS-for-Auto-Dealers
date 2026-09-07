-- The flip. lead_source_catalogue.manual_entry_surface names the screen a
-- person uses to enter a lead of this kind by hand; with it set,
-- nexus_lead_source_readiness() reports walk_in and phone_call as CONNECTED
-- again -- this time truthfully.
--
-- IT IS ALSO THE PROOF THAT 20260907200000 WAS NOT A HARDCODE. That migration
-- could have said "MANUAL_ENTRY is never CONNECTED", which would have been
-- wrong today and wrong silently. It said "CONNECTED requires a recorded entry
-- surface" instead, and this one statement is what recording that surface looks
-- like.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- APPLIED TO STAGING ONLY, ON PURPOSE. RUN IT ON PRODUCTION THE DAY THE
-- DASHBOARD IS DEPLOYED, NOT BEFORE.
-- ═══════════════════════════════════════════════════════════════════════════
-- The column records a fact about the SHIPPED dashboard, and the button lives
-- in the repository until Vercel builds it. Setting this before that deploy
-- would put the green pill back while the deployed bundle still has no way to
-- add a lead -- which is precisely the defect the previous migration existed to
-- remove, re-introduced by the fix for it. Staging carries it as the rehearsal.
--
-- Confirm the deploy first, then run this here. The check is one line in the
-- browser bundle: it must contain `rpc/nexus_lead_record_manual`.

update public.lead_source_catalogue
   set manual_entry_surface = 'apps/executive-dashboard/lib/manual-lead-form.js'
 where delivery_shape = 'MANUAL_ENTRY';

do $$
declare v_n integer; v_bad integer;
begin
  select count(*) into v_n from public.lead_source_catalogue
   where delivery_shape = 'MANUAL_ENTRY' and manual_entry_surface is not null;
  if v_n = 0 then
    raise exception 'no manual source was updated -- the readiness state will not change';
  end if;
  -- The CHECK already refuses this, so it is belt and braces: nothing that is
  -- delivered by a provider may claim a surface a person types into.
  select count(*) into v_bad from public.lead_source_catalogue
   where delivery_shape <> 'MANUAL_ENTRY' and manual_entry_surface is not null;
  if v_bad > 0 then
    raise exception '% provider-delivered source(s) claim a manual entry surface', v_bad;
  end if;
end $$;
