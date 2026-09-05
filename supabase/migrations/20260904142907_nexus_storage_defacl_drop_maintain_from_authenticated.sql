-- Parity with the public line, which is authenticated=r. The storage line was
-- left at authenticated=rm because REVOKE ALL-minus-a-list does not cover
-- MAINTAIN, new in PG17. MAINTAIN allows VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH
-- on the table; not a read of a row, but not something a signed-in dealership
-- user has any business holding on a storage object either.
alter default privileges for role postgres in schema storage
  revoke maintain on tables from authenticated;
