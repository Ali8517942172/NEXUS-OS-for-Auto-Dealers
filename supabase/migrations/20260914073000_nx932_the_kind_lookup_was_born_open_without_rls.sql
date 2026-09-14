-- NX932 — channel_secret_kind was born open without RLS.
--
-- Applied to production dsvuoovivysszdoiorch 2026-09-14. Mirrors production.
--
-- It carries no secret, only the human description of each credential kind, and
-- an onboarding screen has a good reason to read it. But this project's rule is
-- that every public table states its own access explicitly rather than
-- inheriting the born-open default -- an unstated grant is how the last one got
-- missed (nexus_multi_tenant_blockers was executable by every signed-in user
-- for the same reason). So: RLS on, and a policy that says out loud "yes,
-- signed-in users may read the descriptions."
--
-- channel_secret itself was verified separately: no grant to anon, authenticated
-- or public. The only way to a value remains nexus_channel_secret_reveal().

alter table public.channel_secret_kind enable row level security;

revoke all on public.channel_secret_kind from public, anon;

drop policy if exists channel_secret_kind_readable on public.channel_secret_kind;
create policy channel_secret_kind_readable on public.channel_secret_kind
  for select to authenticated using (true);

comment on table public.channel_secret_kind is
  'Descriptions of the credential kinds a channel can hold. Readable by '
  'signed-in users on purpose -- an onboarding screen explains what each one '
  'is. Holds no secret and no pointer to one.';
