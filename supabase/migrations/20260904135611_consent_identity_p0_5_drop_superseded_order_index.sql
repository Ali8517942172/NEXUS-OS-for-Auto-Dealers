-- whatsapp_opt_in_event_latest_idx encodes the ordering this P0 replaced
-- (occurred_at desc, recorded_at desc) and is fully superseded by
-- whatsapp_opt_in_event_governing_idx, which shares its leading columns and
-- carries consent_rank between them. Leaving a "latest" index that spells out
-- the defeated ordering is an invitation to a future author to reproduce it.
drop index public.whatsapp_opt_in_event_latest_idx;