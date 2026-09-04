# NEXUS OS — Executive Dashboard

The dealership's single screen. One Supabase project and one n8n instance,
built as a **vanilla ES-module Vite bundle** — no framework, no server, no build
step beyond `vite build`. Deployed to Vercel as static files.

> **Note, 22 Aug 2026.** An earlier version of this file documented a REST API at
> `/api/v1/dashboard`, `/api/v1/dashboard/ask`, `/api/v1/dashboard/forecast` and
> `/api/health`. **No such API exists and none was ever built.** The dashboard
> talks to Supabase over PostgREST and to n8n over webhooks, directly from the
> browser. That table is removed rather than left standing, because a README that
> describes endpoints nobody can call is worse than no README.

> **No framework and no Tailwind.** React, Socket.io and a WebSocket event bus
> have each been described in some document about this product; none is in the
> bundle. Tailwind *was* used and was removed — `postcss.config.js` records why
> (its `content` scanning silently dropped runtime-built classes). `styles.css`
> is now plain CSS with design tokens. `tailwindcss` survives in
> `package.json`'s devDependencies and is not used by the build.

## Twenty screens here, fourteen in production

Measured 2026-09-03. This branch (`wip/platform-truth-2026-09-01`) registers
**20** screens and the gate renders all 20. **`origin/main` — which is what
Vercel builds — carries 14.** The six that exist only here are the Revenue
Recovery engine screens plus the Action Center: `revenue`, `leadrecovery`,
`dealrescue`, `attribution`, `policy`, `actions`.

Verify rather than assume, with
`git ls-tree -r --name-only origin/main apps/executive-dashboard/screens/`.

Two of the six are honest about being empty rather than broken, and that is by
design: `v_deal_rescue` returns **0 rows** because no deal record exists to
rescue, and the Deal Rescue screen reads `v_deal_rescue_readiness` — nine
prerequisites, each with what it unlocks and what was measured — to say *why*
it is empty instead of showing a blank table.

---

## What it actually talks to

**Supabase** (`dsvuoovivysszdoiorch`, Postgres 17) over PostgREST, with the
signed-in user's JWT, as role `authenticated`. Reads are governed by RLS **and,
since 2–3 Sep 2026, by the grant underneath it**: measured 2026-09-03, `anon`
holds SELECT on **0 of the 73** tables and views in `public`, and
`authenticated` holds SELECT on 72. "`anon` can read nothing" is now a
privilege, not only a row filter — which matters, because a row filter returning
zero rows never proved the grant was absent. See the default-grant section of
`CLAUDE.md`.

The bundle has exactly **one write helper** — `dbWrite` in `lib/data.js` — and it
is called from exactly two places:

| caller | what it writes |
|---|---|
| `lib/unit-form.js` | `inventory` — create, edit, delete a unit |
| `lib/lead-drawer.js` | `leads.assigned_to_id` — assign a lead to a rep |

Those two are why `inventory` keeps `arwd` and `leads` keeps `rw` for
`authenticated`; every other table and view in `public` is `authenticated=r`.

**Everything else that changes state goes through an RPC, not a table.**
`screens/actions.js` posts to `rpc/action_propose`, `rpc/action_decide` and
`rpc/action_mark_executed`, and reads `rpc/action_approver_context` and
`rpc/sentinel_inventory_actions`. Those functions are `SECURITY DEFINER` owned
by `postgres`, so they touch their tables as `postgres` and the caller's table
grants do not apply — which is what makes the narrow grants above safe.
`sentinel_inventory_actions` and `search_rag_documents` are the exceptions:
they are `SECURITY INVOKER` and *do* read as the caller.

`kyc_documents`, `rag_documents`, `finance_quotes` and `users` are deliberately
**not writable from the browser** — those are service-role paths through n8n.

**Supabase Storage** for archived KYC documents, through
`signedUrl()` in `lib/data.js`. The `kyc-documents` bucket is private; a member
of staff gets a 60-second signed URL, `anon` gets nothing. No public URLs, no
service-role key in the bundle.

**n8n** (21 workflows on the GCP VM `35.224.126.225`, under Docker) over
**eight** webhooks, listed in `HOOK` in `lib/data.js`:

| `HOOK.*` | path | screen |
|---|---|---|
| `askAi` | `ask-ai` | Ask AI |
| `finance` | `finance-calc` | Finance |
| `warmDrip` | `lead-trigger` | Campaigns, Leads |
| `closedWon` | `deals/closed-won` | Deals |
| `kyc` | `audit-kyc` | Compliance |
| `erpSync` | `erp-sync` | Automation |
| `escalation` | `lead-escalation` | Leads |
| `whatsappSend` | `whatsapp-send` | Conversations |

Each call carries the user's Supabase JWT so the workflow can verify a real
session. **The verification is application logic inside the workflow, not n8n's
own `authentication` parameter** — every one of these endpoints accepts the
request and starts an execution before refusing it. `CLAUDE.md` records which
one does not refuse. **No screen may invent a webhook path.**

A feature that needs an endpoint which does not exist ships as a *disabled*
control whose `title` names exactly what is missing.

WhatsApp itself does not run through a vendor cloud API: the transport in both
directions is **WAHA**, self-hosted on the same VM.

---

## Layout

```
app.js            188 lines — boot, auth, router over the SCREENS registry
lib/              19 modules — badges, comm-events, data, deal-form, dom, env,
                  format, health, identity, integrations, lead-drawer, modal,
                  nav, pipeline, prefs, states, tenant, ui, unit-form
                  (+ identity.test.mjs)
screens/          20 modules — one per screen, one owner each
styles.css        the entire design system. Screens add no CSS.
```

The four engine screens are imported through `import.meta.glob([...], { eager:
true })` rather than plain `import` statements, and the reason is written into
`app.js`: a plain import of a file that has not landed is not a missing screen,
it is a build failure that takes all twenty down. `lib/nav.js` offers the ids
either way and renders an explicit "not part of this build" state for one whose
module never arrived.

A screen may **only** edit its own file. Shared behaviour belongs in `lib/`.

---

## The two gates — run both

They catch different classes of failure, and neither substitutes for the other.

### `npm run gate` — does it render?

Three lanes now, not one: an **offline source lint** (`S1`–`S10`), an
**offline render pass** in headless Chromium over all 20 screens (`R0`–`R7`),
and a **live database lane** (`L1`–`L10`) that reads the catalogue directly for
the things PostgREST cannot expose — RLS, EXECUTE grants, `security_invoker` and
function bodies. A fourth group (`B1`–`B4`) needs a second dealership or a
writable session and reports **NOT RUN**, which is not a PASS.

Latest run, 2026-09-03T11:45Z: **PASS 26 · FAIL 2 · WARN 2 · NOT RUN 4, exit 1.**
`QUALITY_GATE_REPORT.md` holds the detail. A red gate is the expected state
while `L2` and `L9` are open; do not read a green build log as a green gate.

The lint fails on:

- `Math.random()`, raw `fetch()`, inline `<style>`, direct `localStorage`,
  remote imports, or a missing `SCREENS.<id>` registration
- any page error, any screen stuck in a skeleton, any screen in its error state,
  a nav that does not register all 20
- a zero substituted for an uncomputable economic figure (`R4`, `S5`), a
  recovered value with no attributed sale behind it (`R5`, `S9`, `L10`), a
  finance figure computed in the browser (`S8`), or browser-side tenant scoping
  (`S4`)

The render lane stubs every PostgREST response with a fixed `200` and a fake
row. That is deliberate — it makes the render deterministic — but it means
**the render lane cannot tell you whether your query is valid**. `S3` checks
statically that every query names a relation and columns that exist; running
them is `npm run probe`, below.

### `npm run probe` — will the database accept it?

```
NEXUS_ENV=/path/to/.env npm run probe
```

Pulls every `db()` path out of the screen sources and runs each against the real
database with `limit=1`, then checks every `HOOK.*` resolves to a webhook
`workflow_registry` actually has registered and active. It does not care how many
rows come back — only that PostgREST accepts the query.

This exists because the render gate was not enough. `team.js` once selected
`leads.lead_score`; that column does not exist, PostgREST rejected the whole
request with `42703`, and the roster lost its per-rep counts in production while
the gate reported clean.

Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the env file. Service
role is used on purpose — this checks the *shape* of the query; RLS is verified
separately. **Never commit that file.**

---

## Running it

```
npm install
npm run dev
```

`.env` (not committed) needs:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_N8N_BASE_URL=
```

A missing `VITE_N8N_BASE_URL` is a recoverable condition: the workflow-backed
controls disable themselves and say why, and the rest of the app works.

Chromium for the gate comes from `PLAYWRIGHT_BROWSERS_PATH` if it is set;
otherwise `npx playwright install chromium`.

---

## The two standing rules

1. **Never render a number the database did not produce.** No placeholder
   figures, no `Math.random()`, no "example" data. An empty table is an empty
   table and must say so.
2. **Every panel has four states** — loading, error, empty, loaded — and they are
   different states. "Failed to load" and "nothing here" are opposite findings
   and must never look alike.
