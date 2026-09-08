# `n8n-workflows/backup/` — historical exports, do NOT re-import

These eleven `.json` files are a **point-in-time export** of the n8n workflows,
kept from before the sync that produced the current exports one directory up in
`n8n-workflows/`. They are evidence of what was once live, not a deploy source.

Their exact export date is not recorded anywhere in the repo; the only signal is
the working-tree mtime, **31 August 2026**, which is weak evidence (an mtime does
not survive a fresh clone). Treat the date as approximate and the *topology* they
describe as the load-bearing fact.

## Why they must not be re-imported as-is

They describe the **pre-GCP topology**. NEXUS OS used to run n8n and WAHA in
Docker on Ali's Windows desktop `desktop-l3an0ma`, exposed over a Tailscale
funnel. Everything now runs on the GCP VM `nexus-vm` (us-central1-a), with n8n
reachable at `https://35.224.126.225.nip.io`. The desktop topology is what Ali
described on 8 September 2026 when he asked for the old stack to be removed —
**and that topology was still running that day.** Docker Desktop on
`desktop-l3an0ma` showed a compose project `nexus-os` with three containers
**running**: `n8n` (5678), `n8n-db` (postgres:16-alpine) and `waha` (3000). Its
WAHA had posted into production as recently as 06:07:40 UTC (execution 11103,
`session.status`, no secret header). So the assumption that "the desktop's n8n
has not answered for some time" was not a measurement, and the second n8n with
its own Postgres — schedules and credentials included — was live.

The compose project was **stopped by hand at 06:08:24 UTC on 8 September 2026**.
It is **identified, and stopped by hand on 8 Sep 2026 — not yet permanently
removed (`restart: always` still declared, device 8 still linked)**: Docker
restarts a manually stopped `always` container when the daemon next starts, so a
Docker Desktop restart or a Windows reboot brings the whole project back. See
`CLAUDE.md`, "It had not stopped. It was stopped, by hand, at 06:08 UTC on
8 September 2026", and
`ops/n8n-bundle-NOT-DEPLOYED/PRECONDITIONS.md` §1.

The concrete example, and the reason this file exists:

    whatsapp_bdc.json:177
      "url": "=https://desktop-l3an0ma.tail2141f7.ts.net/webhook/lead-escalation"

Nothing on the current stack should be calling that host. As of 8 September 2026
that host was answering — the desktop's n8n was running until it was stopped by
hand — and it is stopped rather than removed. Importing this workflow would
publish a node pointing at a machine outside the GCP deployment, and the failure
would be a silent non-delivery rather than an error anybody sees — or, worse, a
delivery, if that desktop comes back on the next reboot.

**The JSON in this directory is deliberately left byte-identical to the export.**
Rewriting the host inside it would destroy the only thing it is good for — an
honest record of what was actually running — and would turn a historical
artifact into something that looks safe to deploy. If you need a workflow to
run, take it from the live box or from `n8n-workflows/`, not from here.

## What these files are also cited as

`supabase/baseline/00000000000002_vocabulary_seed.sql` and
`supabase/migrations/20260903040621_policy_10_unmigrated_constant_register.sql`
both cite `n8n-workflows/backup/dynamic_pricing.json` by path as the location of
an unmigrated constant inside an LLM system prompt. Those citations describe
this backup copy specifically. **Changing the contents of these files would
break a recorded measurement**, which is a second reason to leave them alone.

## What is NOT known

Whether the workflows published on the box today still carry any of the values
recorded here has **not** been checked from this repo. These files are evidence
about 31 August 2026 and about nothing else.
