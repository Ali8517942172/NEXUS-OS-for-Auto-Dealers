# OWNER-ACTIONS — what only Ali can do, in the order to do it

**6 September 2026.** Everything in this file was gathered from the overnight
commit messages and the evidence files in `/home/claude/out/`, not from memory.
Each item says **what it unblocks**, **what "done" looks like**, **roughly how
long**, and **what breaks if it is done out of order.**

Companion files: `STATUS-2026-09-06.md` (what moved), `VERSIONS.md` (the four
columns), `ops/n8n-bundle-NOT-DEPLOYED/` (the nine n8n changes, with
exact before/after per node).

---

## How to read the ordering

The list is in **three tiers**, and the tiers matter more than the items:

| tier | what it is | total | what it gets you |
|---|---|---|---|
| **A** | Five things that are minutes each and are the whole difference between a demo you can run today and one you cannot | **~1–2 hours** | A backed-up repository, a live site with the flagship screen on it, a net-margin figure instead of twelve refusals, and a colleague who can log in |
| **B** | The n8n bundle — nine changes, and **the order is the deliverable** | **~1 week, mostly waiting between windows** | WhatsApp safe to switch on, and something watching it |
| **C** | Big items that block nothing in A or B and must not be allowed to delay them | weeks / open-ended | Messaging legally usable, a second dealership, a paying customer |

**The single most important sentence in this file:** *tier A does not depend on
tier B or C at any point.* The Profit Sentinel and Today's Money Leaks demo is
read-only, runs on ALBA's own honest data, and needs no WhatsApp, no Meta
attestation and no second dealership. **You can be demoing this afternoon.**

---

# TIER A — today

## A1 · Get the work off this container and onto GitHub

**This outranks everything else in this file.**

**The measurement.** `origin/main` is at `4e963bd`. This branch is **75 commits**
ahead. The newest transfer patch on disk,
`/home/claude/out/nexus-M0-M1-2026-09-06.patch`, carries **14** commits and stops
at `383c511`. **Nine commits exist in this container and nowhere else:**

`69b0ee4` `655e52f` `b22a2d9` `7718c2c` `710817a` `a8d7914` `09999fb` `09b77e9`
`fd37925`

Which is to say: the two-dealership proof, the tenancy-readiness fix, the gate's
freshness anchor, B1–B3 passing, **Today's Money Leaks**, the usable role model,
the demo dealership and the three engine defects. **If this container is lost
before this is done, all of that is lost.** The database migrations are safe —
they are applied to production and mirrored in `supabase/migrations/` — but the
screens, the gate changes and the evidence are not.

**Why it needs you.** Two things block pushing from an agent session and neither
is fixable from inside one: the cloud container is not in the session's
authorised repository set (the git proxy refuses to inject a credential, HTTP
403), and your clone's `credential.helper` is `manager` — Windows Credential
Manager, which does not exist in the Linux VM the device shell runs in.

**What "done" looks like.**

1. Ask this session (or the next one) to produce a patch for the nine commits.
   **It has not been produced** — this pass was instructed to run no git command
   that writes, so `git format-patch` was not run. It is one command and about
   thirty seconds.
2. Apply it in your clone at `C:\Users\user\Desktop\MY RESUMES\nexus-os` —
   `git am --3way <path>`. An agent can do this for you through the device shell.
3. **You** run the push in PowerShell:
   `git push origin wip/platform-truth-2026-09-01`
4. Confirm on GitHub that the branch head matches `fd37925`'s **tree**, not its
   SHA. **A SHA mismatch across a patch transfer is the expected outcome** —
   `git am` writes new commit objects. Compare `git rev-parse <ref>^{tree}`.

**Time:** 15–30 minutes, most of it waiting on `git am`.

**Out of order:** nothing else in this file is destroyed by doing it late, but
everything else in this file is destroyed by *never* doing it. If `git am` stalls
in the device shell that is a permissions symptom, not a conflict — git cannot
unlink its own `.git/*.lock` files there. Grant delete permission on the Desktop
folder, `git am --abort`, re-run clean. **Do not nurse a half-applied `am`
forward.**

**Unblocks:** A2 (the deploy reads from GitHub), and every future session's
ability to start from the current state.

---

## A2 · Deploy the dashboard

**The measurement.** `origin/main`'s own `lib/nav.js` declares **14** screens.
The working tree declares **21**, and `let current = 'moneyleaks'`. **A buyer
opening the live site today sees the 14-screen build.** No Action Center, no
Revenue Recovery, no Deal Rescue, no Attribution, no Policy screen, no Team &
Access card, no consent card, and **no Today's Money Leaks** — the screen
`LAUNCH.md` has called the product for a week.

**What "done" looks like:** the live Vercel site loads on
`#moneyleaks` by default, the nav shows 21 entries, and the Team screen shows a
"Who has access" card. The database side of all of it is **already live on
production** and refuses correctly regardless of what is deployed — this is
purely the browser half.

**Time:** 15 minutes, once A1 is done.

**Out of order:** deploying before A1 is not possible (Vercel builds from the
repository). Deploying before A3 is fine — the screen already renders
`NOT_COMPUTABLE` with its reason and does not misbehave without a holding rate.

**Unblocks:** every demo conversation, and A4's second user having something to
look at.

**One thing to check after deploying**, because it is a known interaction and not
a guess: `rbac_02` — the stronger lock that withholds `UPDATE(cost_aed)` outright
— is written and **deliberately not applied**, because the currently-deployed
bundle's `unitRow()` sends `cost_aed` on every save and the outright withhold
would return `42501` on every "Save changes". **Re-apply `rbac_02`'s two
statements in the same release as the rebuilt dashboard**, not before, not much
later.

---

## A3 · Record the holding-cost rate — one number, and only you have it

**This is the cheapest unlock in the product and it is a business figure, not an
engineering task.**

**The measurement, taken today on production:** `inventory_profit_settings` holds
**one row** with `holding_cost_per_day_aed` **NULL**. Consequently
**0 of 12 units** produce a net margin — every one reads `NOT_COMPUTABLE` with
its reason, which is the engine being honest and is also twelve refusals where
there could be twelve figures.

**What it changes, concretely:**

- Twelve `NOT_COMPUTABLE` net margins become real numbers.
- The Money Leaks headline goes from *"AED 66,000 gross margin exposed"* to
  *"AED 66,000 exposed, being eaten at AED N a day"* — a stock, and then a rate
  of loss. **That is the sentence that sells this product**, and it is the one
  sentence the software cannot invent for you.
- The Inventory screen's "Holding cost accrued" tile stops reading *"Not
  computable"*.

**What "done" looks like.** You supply **four things**, not one, because the
schema records provenance and the engine renders an assumption differently from a
fact:

| field | what it is |
|---|---|
| `holding_cost_per_day_aed` | what one day of one car on your floor actually costs you — floor-plan interest, plot rent apportioned, insurance, depreciation allowance, however **you** account for it |
| `holding_cost_basis` | `DEALERSHIP_SUPPLIED` if it is your real figure, `PLACEHOLDER` if it is a working assumption. **If you mark it `PLACEHOLDER` the screens will say so on every figure derived from it** — which is correct, and is why you should give a real one |
| `holding_cost_source` | where the number came from, in a sentence — "monthly floor-plan statement ÷ average units" is a source; "roughly" is not |
| `holding_cost_set_by` | your name |

**There is no screen for this.** Measured: no dashboard code writes
`inventory_profit_settings`; every reference is a read. So it is a one-row
`UPDATE` an agent runs with `service_role`, or a small settings screen somebody
builds. **The number is yours; the write is thirty seconds.**

**Time:** 5–20 minutes of your thinking. The write is trivial.

**Out of order:** none. Nothing depends on it and it depends on nothing. Do it
before any demo, not after.

---

## A4 · Invite a second user, from the Supabase dashboard

**The measurement:** production holds **one** `auth.users` row and **one**
`tenant_members` row. The role model built over 5–6 September — owner / admin /
manager / sales / technician / member, with 37 adversarial cases behind it, a
last-owner guard, and a revocation proved to take `leads 3 / inventory 3 /
roster 7` to `0 / 0 / 0` in one transaction — **is inert until a second person
has a login.**

**Why it needs you, and what NEXUS honestly cannot do.** NEXUS cannot send a
sign-in link and does not pretend to: the deployed bundle carries the anon key,
`inviteUserByEmail` needs the service key, and `list_edge_functions` on
production returns `[]` — there is nowhere server-side to put one. **You close
this with no code.**

**What "done" looks like:**

1. In the NEXUS Team screen (after A2), record the colleague's email against a
   role. If they have no login yet the invite sits `PENDING_FIRST_SIGN_IN`.
2. In the **Supabase dashboard → Authentication → Users → Invite user**, invite
   the same address.
3. They accept and sign in. An `AFTER INSERT` trigger on `auth.users` grants the
   recorded role at that moment — **proved end to end on staging,
   case-insensitively, and proved unable to block account creation.**
4. Verify: the "Who has access" card lists two people with their roles.

**A warning that was learned the hard way:** do **not** create the `auth.users`
row with SQL. An `auth.users` row inserted by SQL with NULL `confirmation_token`
and friends breaks **every** sign-in on the project with
`500 Database error querying schema`, and nothing in the row looks wrong. Use the
dashboard.

**Time:** 5 minutes plus however long they take to accept.

**Out of order:** inviting before A2 works at the database but the colleague has
no access card to see. **Note what the next login inherits**: `member`, which now
means own-leads-only. If they should be able to decide actions, set their role
explicitly.

**Unblocks:** the role model stops being a claim and becomes an observable fact —
which is also what a dealership's procurement review asks about.

---

## A5 · Replace the project-instructions blueprint

**The measurement:** the repository itself is clean — every mention of Make.com,
Zapier, MongoDB, Odoo, FastAPI, React or Socket.io in the root `.md` files is a
**denial** that those are in the live path. **The Claude project instructions are
not.** They still describe that architecture as the live system and still tell
the reader to import blueprints into Make.com and Zapier, to run a Python FastAPI
RAG service, and to use MongoDB as a data lake. **None of that is true and none
of it has ever run in production.**

It is the first thing anyone opening the project reads — including every agent
session, which then starts from a false map.

**What "done" looks like:** the contents of
`claude/nexus-BLUEPRINT-REPLACEMENT-paste-into-project-instructions.md` are
pasted into the project instructions, replacing what is there. **That file has
existed since 3 September and has never been pasted in.**

**Time:** 2 minutes.

**Out of order:** none. Every session you run before doing this starts by
believing something false about the system.

---

# TIER B — the n8n bundle, this week

Nine changes, written up in `ops/n8n-bundle-NOT-DEPLOYED/`, each with
the exact node, the exact before and after, the out-of-order consequence and the
rollback. **Every one was written against the LIVE published definitions on the
box, not against `n8n-workflows/*.json` in the repo — that export is from
30 August, contains zero occurrences of `tenant_id`, and re-importing it would
revert the tenancy wave.**

**Two house rules the bundle assumes:** one agent on the box at a time (parallel
writes have taken the VM down twice), and you verify against the **published**
version by fetching it back, never against your draft.

## B0 · First: permanently remove the second WAHA — it is stopped, not gone

**This is the one thing in tier B that is genuinely only yours.** The machine is
no longer a mystery — as of 8 September 2026 it is named, it was **measured still
posting into production**, and its containers were **stopped by hand at 06:08:24
UTC that morning**. What is left is making that stop permanent, and it has not
been done.

**What is now known, measured 6 September from the box read-only.**
`2.50.10.149` is **not a stranger.** Executions 10322 and 10323 carry the same
`payload.id` and the same body:

| | the box | the second host |
|---|---|---|
| `x-forwarded-for` | `35.224.126.225` | **`2.50.10.149`** |
| build | WAHA/2026.7.2 | WAHA/**2026.7.1** |
| `me.jid` | `971526647253:**12**@…` | `971526647253:**8**@…` |
| `me.id`, `me.lid`, `me.pushName` | identical | identical |
| lag | — | ~40 s behind, consistently |

**It is your own WhatsApp account on a different device index**, served by a
second, older WAHA instance on a non-GCP address that geolocates to the UAE.

**Which machine it is — you answered this on 8 September 2026.** It is your own
Windows desktop **`desktop-l3an0ma`**, running WAHA in Docker Desktop: the same
PC that used to host n8n behind the Tailscale address
`https://desktop-l3an0ma.tail2141f7.ts.net`, from before the move to GCP. That is
your statement, not something measured from the box — nothing here has read that
machine. *Consistent with it, and not proof of it:* execution `11094` on 8 Sep
carried a `webhookUrl` of `https://desktop-l3an0ma.tail2141f7.ts.net/...` inside
a WAHA payload; the live WAHA session config has not been read back, so what that
instance points at today is unknown.

**It had not stopped on its own — measured 8 September 2026.** This repo recorded
on 6 September that the second WAHA was gone. It was not. Production execution
**11103** at **06:07:40 UTC** on 8 September carries:

```
x-forwarded-for            2.50.10.149
user-agent                 WAHA/2026.7.1
me.jid                     971526647253:8@s.whatsapp.net
body.event                 session.status
x-nexus-webhook-secret     absent
```

**Why nobody saw it.** The 6 and 7 September checks grouped messages by
`payload.id` and looked for the duplicate pairs that used to give the second
sender away. Your desktop's WhatsApp session is no longer logged in, so that WAHA
sends only `session.status` events and no actual messages — and those carry no
`payload.id`, so they can never form a pair. It was calling production the whole
time, invisibly to that check. **Absence of duplicates is not absence of the
sender.**

**What was found on the PC, and what was done.** Docker Desktop showed a compose
project **`nexus-os`** at `C:\Users\user\Desktop\MY RESUMES\nexus-os` with
**three containers running**: `n8n` (port 5678), `n8n-db` (postgres:16-alpine)
and `waha` (devlikeapro/waha, port 3000) — so a whole second n8n with its own
database was live there too, not just WAHA. The WAHA log at 06:02:22 shows its
POST to `https://35.224.126.225.nip.io/webhook/whatsapp-inbound` returning 200.
**The compose project was stopped through the Docker Desktop UI at 06:08:24
UTC.** The GCP box was unaffected. **Deleting the project was deliberately not
done** — the confirmation dialog says nothing about the named volumes, and those
volumes hold that n8n's workflows and credentials and the WAHA linked-device
session.

**Status: identified, and stopped by hand on 8 Sep 2026 — not yet permanently
removed (`restart: always` still declared, device 8 still linked).**

**The two steps that are left, and they are the whole item:**

1. On that PC: `docker update --restart=no n8n n8n-db waha`. `restart: always`
   is still declared on all three services, and Docker restarts a manually
   stopped `always` container the next time the daemon starts — so a Docker
   Desktop restart or a Windows reboot brings the whole thing back.
2. On your handset: WhatsApp → Linked Devices → unlink device **8**. This is the
   only step that stops your account being served by that machine at all.

**"Done" does NOT look like** knowing whose PC it is, or the containers being
stopped right now. Neither survives a reboot. Configuring it instead —
`x-nexus-webhook-secret` in its WAHA `customHeaders` — is no longer worth doing:
with an unauthenticated session it captures no messages, so it is not a redundant
capture path any more.

**Verification, when you have done both:** with the desktop powered on and Docker
running, no delivery carrying `me.jid …:8` from the box over a window long enough
to mean something — read across **all** events, not by looking for duplicate
`payload.id`.

**How urgent, honestly.** Measured over 102 executions spanning 8h56m —
**51 distinct messages, every one of them delivered from BOTH hosts, zero from
`.149` only, zero from the box only** — so this host never carried a message the
box did not. And since its session lost authentication it carries no messages at
all, so arming the gate would drop only its `session.status` posts, harmlessly.
**That is not a reason to skip it:** the exposure is a second n8n with its own
credentials and a linked WhatsApp device, both able to come back on the next
reboot.

**Time:** 10–30 minutes, at the desktop with the handset in your hand.

**Unblocks:** B7 (arming the webhook secret), and therefore B9.

## B1–B9 · The order, and the constraints that actually bite

Safe → observable → traffic-affecting.

| # | change | touches | reversible in | risk |
|---|---|---|---|---|
| **00** | `slack-command` claim corrected — **no change to make** | one sentence in `CLAUDE.md` | n/a | none |
| **01** | `Resolve Tenant` rollback warning (note only) | 1 node's Notes | seconds | none |
| **02** | Closed-Won `Upsert Vector`: **add** `?on_conflict=tenant_id,deal_id` | 1 URL | seconds | low |
| **03** | `communication_logs` writers send `external_message_id` | 3 node bodies | seconds | low, additive |
| **04** | `Claim Message Id` stops minting `nokey:`; `Is New Message?` stops treating a constraint refusal as licence to reply | 2–3 nodes | seconds | **medium — can suppress a reply** |
| **05** | **Publish the NEXUS Infra Health Probe** | 1 publish + 1 registry row | seconds | medium |
| **06** | Edge JWT validation for the dashboard webhooks | Caddy, not n8n | seconds (`caddy reload`) | medium |
| **07** | **Arm `WAHA_WEBHOOK_SECRET`** | VM env + the box's WAHA (see below) | ~10 s (disable the gate node) | **HIGH — can silently drop every customer message** |
| **08** | **Publish the Phase 6 Silence Detector** | 1 publish | seconds | **high — contacts humans** |
| **09** | `Resolve Tenant`: `NEXUS_TENANT_MAP` → `channel_registry` | 1–2 nodes | seconds | high |

**The constraints, each of which is a reason and not a preference:**

- **03 before 04.** 03 makes `communication_logs` carry the provider's id, which
  is the only way to tell afterwards whether a message was answered once or
  twice. Do 04 first and you are judging a reply-suppression change from
  screenshots. *(Measured today: **115** rows, **0** carrying an
  `external_message_id`. The database half of this identity has been applied
  since 5 September and has never had a writer.)*
- **05 before 07.** Arming the gate is the change that can take the WhatsApp
  channel dark, and the probe is the only thing that would tell you. **Right now
  nothing is watching the WhatsApp channel** — the probe has `activeVersionId:
  null` (never published) while `workflow_registry` says `is_active = true`, and
  the dashboard reads the registry. So the Automation screen currently tells the
  dealership its channel is monitored.
- **07's internal order is the single largest risk in the bundle.** Set the
  secret on the **VM** (`/opt/nexus/.env`, `WAHA_WEBHOOK_ENFORCE` **not** set),
  restart n8n → make the **box's** WAHA send `x-nexus-webhook-secret` → confirm
  saved executions show `_gate.mode == "MONITOR"`, `_gate.header_present == true`
  and `_gate.ok == true` **on at least one genuine 1:1 customer message, not just
  group traffic** → **only then** `WAHA_WEBHOOK_ENFORCE=true`. **Hardcoding the
  secret in the n8n node before WAHA sends the header silently drops every real
  customer message, and WAHA keeps seeing 200 so nothing ever errors.**
  *(Was "both WAHA hosts". Corrected 8 September 2026: `.149` was stopped by hand
  that morning and its WhatsApp session is not authenticated, so it delivers
  `session.status` and no messages — nothing to configure and nothing to lose if
  enforcement drops it. B0 is still open, for the different reason that it can
  restart.)*
- **Where 07 is stuck today, 8 September 2026.** The secret is set and the header
  arrives — measured on executions 11098/11099/11100, and the SHA-256 fingerprint
  of what WAHA sends changed between 11096 and 11098, so the rotation reached it.
  The gate still reads `mode MONITOR, header_present true, **ok false**` on the
  box's own traffic. The box runs in **queue mode** (`executionMode: "queue"`,
  concurrency 2), so the Code node that reads `$env.WAHA_WEBHOOK_SECRET` runs in
  **`n8n-worker`** — `docker compose up -d n8n` recreates the container you then
  check with `printenv` and leaves the one doing the comparison on the old value.
  Recreate `n8n` **and** `n8n-worker`, and verify where the value is consumed
  without printing it:
  `docker compose exec -T n8n-worker sh -c 'printf %s "$WAHA_WEBHOOK_SECRET" | sha256sum'`.
  Until that reads `ok: true`, enforcing drops 100% of real inbound.
- **Set `NEXUS_PROBE_KEY` (24+ random chars) at the same time as the webhook
  secret.** Without it `Probe Auth Gate` is dormant and the probe endpoint
  answers anyone. **Do not set `NEXUS_PROBE_VERBOSE=true`** — once WAHA carries
  the secret, `GET /api/sessions/default` returns it inside
  `config.webhooks[].customHeaders`, and verbose mode is the one path that could
  echo it outward.
- **07 before 09.** Moving the tenant map into `channel_registry` does not
  authenticate the caller; `body.session` is still caller-supplied. Doing 09
  first produces something that *looks* finished and is not. **Every tenant
  control proven this month sits behind that door.**
- **04, 06 and 07 in separate windows.** All three present as "the bot stopped
  replying". Run them together and you will not know which.
- **05 and 08 in separate windows.** Both write `audit_log` through the same
  error workflow, so separate them and a FAILED row has one possible author.
- **06 must exclude `whatsapp-inbound` and `slack-command`.** If edge JWT
  validation catches the WhatsApp path, every real customer message is 401'd at
  the door and the channel dies silently. **That exclusion is the most important
  line in the Caddy config.**

**On 08 specifically — the blast radius, before you press it.** The Phase 6
Silence Detector is what Lead Recovery depends on; the silence state has read
`STALE` for every lead since 26 August because nothing has computed it. The first
run after publishing surfaces the whole backlog. It is bounded — `MAX_PER_RUN = 8`
per hour, highest `ai_score` first, within a 40-day window — and production holds
**3** leads today, so today the backlog is trivially small. **Re-check that count
immediately before publishing.** `Trigger Lead Escalation` is the part that
reaches a human: it posts to Slack.

**What 08 is worth commercially:** it empties most of register 3 on Today's Money
Leaks, which is the register that currently says nine checks *could not run*. It
turns "not measured" into "clear" or into a real leak.

**Time for tier B:** the edits are minutes each. The waiting is the schedule —
separate windows for 04, 06, 07; a MONITOR period on 07 long enough to catch a
genuine customer message. Budget a week of calendar time and perhaps three hours
of your attention.

---

# TIER C — bigger, and blocking nothing above

## C1 · The Meta policy attestation

**The measurement, re-taken today:** `policy_rule` **13** rows, **0**
`VERIFIED`; `policy_platform_attestation` **0** rows. Until that changes,
`WA_CUSTOMER_SERVICE_WINDOW_HOURS` stays `NOT_VERIFIED` and **every conversation
in production returns `TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED`.** That is
the engine being honest, and it is a hard stop on the messaging layer being
usable.

**Why only you.** `policy_verify_rule()` refuses global rules by design — *"global
rules are verified by the platform"* — and the platform path
(`policy_platform_verify_rule(...)`, `service_role` only) **demands an
attestation**: a named person, a reachable contact, a source kind, an openable
reference, and the day it was read. **An agent cannot be that person.** The
attestation is a statement about who checked.

**What "done" looks like:** you open the Meta Business account, read the current
WhatsApp customer-service-window rule **with your own eyes**, and it is recorded
through `policy_platform_verify_rule()` naming you, your contact, the Meta
document, its URL, and the date you read it.

**Time:** 30–60 minutes, most of it finding the current Meta document.

**What it does NOT unblock, stated so it is not mistaken for a green light:**
nothing in tier B depends on it. And attesting the rule removes **one** blocker
from switching WhatsApp messaging on — the idempotency verdict is a separate one,
and the reply path around the database guarantee is still fail-open until B04 is
deployed.

## C2 · `NEXUS_TENANT_MAP`, and what has to exist before the rehearsal

**Not set on the box.** Every resolver falls through to its built-in
single-tenant map, hardcoded identically in four workflows — `Resolve Tenant`
(WhatsApp BDC), `Find Silent Leads` (Phase 6), `Transform & Unify` (Customer 360)
and `Prepare Send` (WhatsApp Send). **The moment that variable holds two keys,
roughly fifteen code paths switch from "the only dealership" to "unresolved" at
once.**

**"Done" looks like:** the two-key switch **rehearsed on a staging box first**,
with a written list of which paths went to `unresolved` and what each did about
it. Then set in production.

**Two things make the rehearsal weaker than it looks, and both are stated now
rather than discovered later:**

- Production carries seven **column-level** grants on `channel_registry`;
  staging carries none — and that is the table B09 makes the resolver read.
- **`v_customer_directory` does not expose `tenant_id` at all**, so Customer 360
  has no tenant signal with two dealerships configured. Its own node comment says
  the batch must not be run in that state. **That is a migration, it is not
  written, and it is not in the bundle.**

And a second, larger finding measured on 6 September: **five things go silent
together at two dealerships**, not just Customer 360 —
`v_customer_directory` and `v_inventory_sales` to `service_role`, the two-argument
`search_rag_documents`, and the two identity helpers
`nexus_comm_keys_for_lead` and `nexus_lead_for_comm_key`. The last two fail
closed *by design*, so **inbound WhatsApp stops matching known customers and
starts creating duplicate people, and nothing errors.**
`nexus_tenancy_readiness()` now carries a BLOCKER that measures exactly this;
today, at one dealership, it correctly returns **zero BLOCKERs**.

**Do not onboard a second dealership before that BLOCKER has been made to fire
and then cleared on a staging box.**

**Time:** a day of engineering plus the missing migration. **Nothing in tier A or
B needs it** — every one of the nine n8n changes is correct with one dealership
configured.

## C3 · A price, and a dealership willing to pay it

Nothing in this repository moves this one, and **it depends only on A1, A2 and
A3.** It is the only item anywhere in this file that can put a YES in the
"commercially validated" column of `VERSIONS.md`, which is currently NO for every
capability without exception.

---

# Smaller decisions that are yours, and cost minutes

These are not blocking, but each one is currently making a document or a screen
say something that is not true.

| | what | why it is yours | time |
|---|---|---|---|
| **D1** | **Two `workflow_registry` rows claim `is_active = true` for workflows the box has never published** (`57QpbNQGwlFKb0q3`, `B3TcpfzOMWj8oWgF`). The dashboard reads the registry | Either publish them (B05, B08) or correct the registry. **Leaving the disagreement is the one option that keeps the dealership's Automation screen saying something false** | 5 min, or it resolves itself when you do B05/B08 |
| **D2** | **Gate check `L9` — the `"Example Workflow"` audit row.** Established by measurement: it carries n8n's complete Error Trigger placeholder set (workflow id `1`, execution `231`, `Node With Error`), no workflow on the box is named that, no id is `1`, and it sits eight minutes after a genuine handler row — the shape of somebody smoke-testing the error handler | It clears with a **disposition** recorded against that writer, the way `Inventory Action Center` is already classified. **It must not be cleared with a `workflow_registry` row** — that would assert an automation exists that does not | 10 min, and it is the only P0 FAIL on the board |
| **D3** | **Re-run the gate's `--refresh-schema` and the full lane.** The definitive board (PASS 31 · FAIL 1 · WARN 2 · NOT RUN 3) is anchored to migration `20260906062139`; **four migrations have landed since**, and against that stale snapshot the render lane goes red on `v_deal_rescue_readiness.platform_evidence`. Measured both ways: it is the snapshot's age, not the product | Whoever owns `QUALITY_GATE.mjs` — the refresh rewrites that file in place and needs a live catalogue | 15 min |
| **D4** | **Run `B4` from a machine whose browser has direct egress.** Measured, not assumed: the headless browser here made one request to the Supabase host and got zero responses, `net::ERR_CONNECTION_RESET`, while the gate's own process read the same project seconds earlier. **Nothing in the product or the gate needs changing** | It is the only check that would prove the figures the dashboard renders match the rows in the database | 20 min on a laptop |
| **D5** | **Clean two `GATE-PROBE-%` units and two actions off staging.** A completed B1/B2 run cannot clean up after itself, by the product's own rule — an APPROVED action blocks re-proposal and cancelling starts a fourteen-day cooldown | The removal SQL is printed by B1 itself and is in `out/gate-FINAL-2026-09-06.md` §5. Note `audit_log` has no `action_id`, so those rows key off `summary` | 5 min |
| **D6** | **Run `select * from public.nexus_quarantine_census();` as `service_role`, daily.** It returns **0 rows** today | It is the **only** measurement of which n8n writers omit `tenant_id` — a question the repository cannot answer, because its workflow export is from 30 August and contains no `tenant_id` at all | 1 min a day |

---

# Two traps to hand to whoever does the engineering

Not yours to fix, but they will bite whoever touches these areas next, and they
were both learned the expensive way.

- **Every future `ALTER TABLE` on `inventory` or `leads` will strip the
  dashboard's write grants.** `nexus_guard_born_open_grants()` revokes write
  grants on any table DDL. It did exactly that on 6 September and the unit form
  stopped saving on both projects until a self-checking migration restored it.
  **The guard is doing what it was built to do** — the two live write paths are
  the exception it does not know about.
- **`n8n-workflows/*.json` in the repository is a 30 August export and must not
  be re-imported.** It contains zero occurrences of `tenant_id` while the box
  demonstrably stamps one. Re-importing it reverts the tenancy wave.

---

# If you only do three things today

1. **A1 — get the nine commits onto GitHub.** Everything else in this file
   assumes the work still exists.
2. **A2 — deploy.** A buyer currently cannot open the thing this project spent
   the week building.
3. **A3 — give me the holding-cost rate.** One number, five minutes, and it turns
   twelve refusals into twelve figures and a stock of exposure into a rate of
   loss.

Tier B is a week and it makes WhatsApp safe. Tier C is longer and it makes NEXUS
legal to message with, multi-dealership, and paid for. **None of the three above
waits on any of it.**
