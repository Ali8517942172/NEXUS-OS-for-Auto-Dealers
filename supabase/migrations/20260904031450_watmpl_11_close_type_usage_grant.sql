-- A composite type carries no data, but a NULL typacl means the implicit
-- default: USAGE to PUBLIC. whatsapp_policy_decision_row was closed the same way
-- and this keeps the pair consistent, so a future ACL sweep sees one shape.
revoke usage on type public.whatsapp_template_sendability_row from public;
grant  usage on type public.whatsapp_template_sendability_row to service_role;