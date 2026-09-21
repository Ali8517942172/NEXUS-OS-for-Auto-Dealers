# lead-intake-website

Public intake for a dealer's embedded website form (`/embed/nexus-lead-form.js`).

- **Deploy with `verify_jwt = false`** (anonymous browser callers). There is no `supabase/config.toml` in this repo; pass it at deploy time.
- Files: `index.ts`, `validate.mjs` (both must be deployed).
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (both injected by Supabase; nothing to set).
- Requires migration `20260921201000_nx1012_website_form_intake.sql` (`public.nexus_ingest_website_form`, service_role only).
- Test: `node --test supabase/functions/lead-intake-website/validate.test.mjs`
