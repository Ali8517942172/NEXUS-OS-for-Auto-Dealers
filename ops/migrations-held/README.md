# ops/migrations-held — written, reasoned about, deliberately NOT applied

A migration in `supabase/migrations/` is a statement that this schema change
**should be applied**. Anything that reads that folder — `supabase db push`, the
Supabase GitHub integration, `ops/ci/migration-hygiene.mjs`, a future person
running the folder in order — takes it that way, and is right to.

A migration that is deliberately held is therefore not a migration yet. Left in
that folder it fails every automated push, for ever, and the failure carries no
information: it looks identical to a broken migration. So it lives here instead,
and this file says what would have to be true before it moves back.

Same discipline as `ops/n8n-bundle-NOT-DEPLOYED/`.

## What is held, and why

### `20260908090000_the_grant_that_no_longer_has_a_screen_behind_it.sql`

Revokes the `authenticated` column-level UPDATE grant on `public.leads`.

**Why it was written.** That grant existed for exactly one caller:
`lib/lead-drawer.js`, which used to `PATCH leads?id=eq.<id>` to assign an owner.
That screen now calls `rpc/nexus_lead_assign_owner` instead, and the deployed
production bundle was measured on 7 September 2026 to contain **zero**
occurrences of `leads?id=eq`. So the grant no longer has a screen behind it —
which is what made revoking it a real option rather than a two-screen outage.

**Why it is still held.** Its own preflight refuses, and the refusal is correct.
`nexus_lead_assign_owner` is `SECURITY INVOKER` **on purpose** — the UPDATE runs
as the caller, so `leads_role_update` still decides and no authorisation is
re-implemented inside a definer function. But an invoker function needs the
caller to hold the grant. Revoking it breaks the RPC.

**What would have to be true before applying it.** One of:

- `nexus_lead_assign_owner` becomes `SECURITY DEFINER` — which means writing a
  second copy of `leads_role_update`'s authorisation inside it, and the copy that
  drifts is the one that silently grants too much. `CLAUDE.md` argues against
  this at length. It is a decision, not a refactor.
- or the owner-assignment path moves off the dealer plane entirely.

**And check n8n first, either way.** `service_role` does not need this grant, but
nothing has established that no other writer relies on it. "The dashboard no
longer uses it" is not "nothing uses it".

Apply this with someone watching, on staging first, with the two live dashboard
write paths (`lib/unit-form.js` → `inventory`, `lib/lead-drawer.js` → `leads`)
exercised afterwards as a real signed-in session.

## Moving one back

Move the file into `supabase/migrations/` unchanged, keeping its version, and
delete its section above in the same commit. If the file has been edited since
it was written, say so in the commit message — a held migration that quietly
changed while it sat here is worse than one that was never written.
