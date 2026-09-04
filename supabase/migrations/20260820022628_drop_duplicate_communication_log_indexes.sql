-- communication_logs accumulated two pairs of byte-identical indexes across
-- earlier migrations. Each duplicate costs a write on every message the BDC
-- agent logs and buys nothing on read. Keep the idx_comm_logs_* names, which
-- match the naming used by the rest of the schema.
drop index if exists public.idx_comm_created;
drop index if exists public.idx_comm_lead_email;