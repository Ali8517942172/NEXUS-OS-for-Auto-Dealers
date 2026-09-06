-- Correcting a comment I wrote wrong in migration repair_poisoned_response_times.
--
-- I said lead 35 reads NULL because "nobody has ever replied to this lead".
-- That is false, and it is the same class of error this whole pass exists to
-- remove: an assertion the data does not support. Lead 35 HAS a reply -- one
-- outbound message, 74 seconds BEFORE its own lead row was created, preceded by
-- nine inbound messages. The entire conversation happened before the router
-- minted the lead. The trigger correctly declines to measure it, because a
-- reply that predates the lead is not this lead's clock.
--
-- So NULL here means "no first-reply time could be measured", NOT "never
-- answered". Any screen rendering it must say the former. A dashboard telling a
-- rep that a customer was never contacted, when he was answered inside two
-- minutes, is a worse lie than the 0 this replaced.

comment on column public.leads.response_time_minutes is
'Minutes from lead creation to the first genuine reply. NULL means NOT MEASURED - it does not mean unanswered. A reply logged before the lead row (the normal ordering when the bot answers and the router mints the lead afterwards) leaves NULL unless it is clock skew with no prior inbound, in which case it is 0. Written only by nexus_mark_first_response on communication_logs AFTER INSERT, first write wins.';

comment on function public.nexus_mark_first_response() is
'Sole authority for leads.response_time_minutes. Writes only over NULL (first reply wins). A reply predating the lead row leaves NULL - not zero - unless it is within 90s and no inbound precedes it, which is genuine clock skew and scores 0. Never clamps a negative interval, because that is what made every lead read 0 and report instant service.';