# founder-invite

An Edge Function, not a database function, because it is the one step in
"add a person to a dealership" that a Postgres function cannot do:
`auth.admin.inviteUserByEmail` needs the **service-role key**, and that key
must never reach the browser bundle. This function is the only place in
NEXUS OS that holds it.

See the long comment at the top of `index.ts` for the full account of why
this exists (it closes a gap `team_02`'s own migration comment named on
6 Sep 2026: "this project has ZERO Edge Functions deployed, so there is no
server-side place that key could live either") and exactly how the two
different callers — the platform founder and a dealership owner — are told
apart.

## Required environment variables

None of these are set by hand. Supabase injects all three into **every**
Edge Function's runtime automatically, scoped to the project it is deployed
in. `supabase functions deploy` does not need `--env-file` or `secrets set`
for any of them, and nothing in this repo sets them either — if one of
these is missing when the function is invoked, the function returns a
`500` naming which one, rather than guessing:

| Name | What it is | Where it comes from |
|---|---|---|
| `SUPABASE_URL` | This project's API URL | Injected automatically |
| `SUPABASE_ANON_KEY` | The public anon key | Injected automatically |
| `SUPABASE_SERVICE_ROLE_KEY` | The service-role key | Injected automatically — **never** set this anywhere else, never log it, never echo it back in a response |

If a future change needs a secret Supabase does **not** inject automatically
(a third-party API key, for example), set it with
`supabase secrets set NAME=value --project-ref dsvuoovivysszdoiorch` and
document it here — do not hardcode it into `index.ts`.

## Deploying

```
supabase functions deploy founder-invite --project-ref dsvuoovivysszdoiorch
```

No database migration is required for the function itself — `nx1004`
(`supabase/migrations/20260921110000_...`) only adds the founder-only RPCs
the *frontend* calls directly; this function calls `nexus_is_platform_admin()`
and reads `tenant_members` on its own.

## Calling it

```
POST {SUPABASE_URL}/functions/v1/founder-invite
Authorization: Bearer <the signed-in user's own Supabase session token>
Content-Type: application/json

{
  "tenant_id": "…uuid of the dealership being invited into…",
  "email": "person@example.com",
  "role": "manager",          // owner | admin | manager | sales | technician | member
  "staff_user_id": null,       // optional — must belong to tenant_id if set
  "redirect_to": null          // optional — where Supabase's invite email links to
}
```

The caller must be **either**:

- the platform founder (`nexus_is_platform_admin()` true for their own
  session), inviting into **any** dealership by id, **or**
- that dealership's own **owner** (a `tenant_members` row with
  `role = 'owner'` for exactly the `tenant_id` in the request — read through
  a client scoped to the caller's own JWT, so Postgres RLS decides what this
  function can even see).

Anyone else gets a `403` before any Auth Admin call is made.

### Response

```jsonc
{
  "outcome": "invited",       // invited | already_member | added_existing_account | error
  "tenant_id": "…",
  "tenant_name": "…",
  "email": "person@example.com",
  "role": "manager",
  "sent_invite_email": true
}
```

`already_member` means the dealership's existing membership decision about
this person was left untouched — the same refusal
`nexus_team_invite()`'s `NX_TEAM_ALREADY_A_MEMBER` makes on the database
side, for the same reason: a second invite must not silently change
somebody's role.

## What this does **not** replace

`public.nexus_team_invite()` (`team_02`) still exists and is unchanged. It
is the pre-Edge-Function path that records a *pending* membership for an
address with no login yet, to be claimed automatically the moment one is
created by whatever route Supabase Auth is configured for. This function is
a faster, complete path when the caller wants NEXUS itself to create that
login and email the invite — it does not delete or deprecate the older one.
