-- Removes the temporary probe table created by mt_keys_probe_create_temporary.
-- Its purpose is served: it established by observation that PostgREST emits the
-- FULL composite primary key as the ON CONFLICT target for both
-- resolution=merge-duplicates and resolution=ignore-duplicates, even when one
-- of the key columns is absent from the request body and filled by a DEFAULT.
-- Emitted SQL observed in pg_stat_statements: ON CONFLICT("k", "tenant_id").
drop table if exists public.mt_keys_probe;
