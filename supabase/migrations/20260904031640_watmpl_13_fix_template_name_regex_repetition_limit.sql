-- Postgres caps a regex repetition count at 255, so '^[a-z0-9_]{1,512}$' is not
-- a valid pattern and every insert raised 2201B. Meta allows a 512-character
-- template name, so the length test moves out of the regex.
alter table public.whatsapp_templates drop constraint wat_name_shape;
alter table public.whatsapp_templates add constraint wat_name_shape
  check (name = lower(btrim(name)) and length(name) between 1 and 512 and name ~ '^[a-z0-9_]+$');