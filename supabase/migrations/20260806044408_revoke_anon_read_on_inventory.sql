-- inventory exposes cost_aed, gross_margin, net_margin and recommended_commission.
-- Those are commercially sensitive: anyone holding the public anon key could read
-- the dealership's entire margin structure. Not PII, but not public either.
DROP POLICY IF EXISTS "Allow anon read access" ON inventory;
DROP POLICY IF EXISTS inventory_anon_read ON inventory;
DROP POLICY IF EXISTS "Enable read access for all users" ON inventory;