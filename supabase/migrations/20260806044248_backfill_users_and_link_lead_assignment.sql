-- leads.assigned_to was free text ("Sarah K.", "Mohammed A.", "Khalid R.") while
-- users held exactly one row. The people leads were assigned to did not exist as
-- users, so no Team screen could join them.
--
-- Emails are deliberately left NULL: the names are real (they come from the leads
-- table), the email addresses are not known. Inventing them would be worse than
-- an empty field. status='pending_invite' marks them as needing a real account.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

INSERT INTO users (name, email, role, status)
SELECT DISTINCT l.assigned_to, NULL, 'sales_rep', 'pending_invite'
FROM leads l
WHERE l.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.name = l.assigned_to);

-- Keep the text column. Every n8n workflow writes to it and would break otherwise.
-- The FK is added alongside as the join key the UI uses.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to_id uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE leads l SET assigned_to_id = u.id
FROM users u WHERE u.name = l.assigned_to AND l.assigned_to_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to_id ON leads (assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_leads_status         ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at     ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email          ON leads (email);