-- All 13 workflows now write to audit_log, so every one has an audit_name and
-- writes_audit_log = true. Before this, 9 of 13 were invisible on the
-- Automation screen and the UI had to say "Not logged" for them.
UPDATE workflow_registry SET audit_name = v.a, writes_audit_log = true
FROM (VALUES
  ('qHAtd3RckAKRBUkE','Ask-AI RAG Query'),
  ('AZkGM5M4c1uzSH7S','Customer 360 Aggregation'),
  ('LphiGg4iqF1bn6El','Competitor Price Scraping'),
  ('unMMpeL9uuPO79pp','Finance Calc'),
  ('G7FhvMY2ucW5Fg7X','7-Day Warm Lead Drip'),
  ('dhy2DDjWUqwuzHLW','Sync Closed-Won to pgvector'),
  ('VmnIXo7tM30zqawp','Slack Command Center'),
  ('B3TcpfzOMWj8oWgF','Phase 6 Silence Detector'),
  ('BiyHk9ZXxJUVGbf6','WhatsApp BDC Agent')
) AS v(id,a)
WHERE workflow_registry.id = v.id;

SELECT count(*) FILTER (WHERE writes_audit_log) AS instrumented, count(*) AS total FROM workflow_registry;