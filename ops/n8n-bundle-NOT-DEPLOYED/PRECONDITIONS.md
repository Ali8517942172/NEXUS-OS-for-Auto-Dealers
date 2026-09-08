# PRECONDITIONS — what is Ali's alone

**Nothing in this bundle can be applied by an agent past these. Each item says
what "done" looks like and what it unblocks. Nothing here has been done.**

---

## 1. The second WAHA host — `2.50.10.149`

**What we now know (measured, 6 Sep 2026):** it is a **second, older WAHA
instance serving the same WhatsApp account**, not a stranger.

| | the box | the second host |
|---|---|---|
| `x-forwarded-for` | `35.224.126.225` | **`2.50.10.149`** |
| `user-agent` / `environment.version` | WAHA/2026.7.2 | WAHA/**2026.7.1** |
| `me.jid` | `971526647253:**12**@s.whatsapp.net` | `971526647253:**8**@s.whatsapp.net` |
| `me.id`, `me.lid`, `me.pushName` | `971526647253@c.us`, `210999328125144@lid`, "Ali Asgher" | identical |
| engine / platform | GOWS, linux/x64 | GOWS, linux/x64 |
| lag behind the box | — | ~40 s, consistently |

Same account, **different device index**, older build, non-GCP address geolocating
to the UAE.

**Which machine it is — answered 8 September 2026, by Ali, not by measurement.**
It is **his own Windows desktop `desktop-l3an0ma`**, running WAHA in Docker
Desktop; the same PC that used to host n8n, reached over a Tailscale funnel at
`https://desktop-l3an0ma.tail2141f7.ts.net`, from before the move to GCP. In his
words: *"purana waha mene desktop docker pe chalaya tha aur n8n bhi tailscale ke
zariye use bhi local pc pe download kiya tha but ab sab kuch gcp pe hai to use
remove kar do purana wala."* Nothing was read off that machine from here — this
is the owner's statement, and it is the only evidence for the host's identity.

*Consistent with, not proof of:* execution `11094` (8 Sep) carried a `webhookUrl`
of `https://desktop-l3an0ma.tail2141f7.ts.net/...` inside a WAHA payload — the
same hostname. The live WAHA session config has not been read back, so what that
instance points at today is still unknown.

**He has chosen decommission.** That decision is made; the work is not finished.

**What was actually found and done — measured, 8 September 2026.** It had not
stopped on its own. Production execution **11103** at **06:07:40 UTC** carries
`x-forwarded-for 2.50.10.149`, `user-agent WAHA/2026.7.1`,
`me.jid 971526647253:8@s.whatsapp.net`, `body.event session.status`, no
`x-nexus-webhook-secret`, `_gate.header_present false` — two days after this
repo recorded it as gone. Docker Desktop on `desktop-l3an0ma` showed a compose
project **`nexus-os`** at `C:\Users\user\Desktop\MY RESUMES\nexus-os` with
three containers running: `n8n` (5678), `n8n-db` (postgres:16-alpine) and `waha`
(devlikeapro/waha, 3000). The project was **stopped by hand through the Docker
Desktop UI at 06:08:24 UTC**; the GCP box was unaffected. Deleting the project
was declined, because the confirmation dialog says nothing about the named
volumes that hold that n8n's workflows and credentials and the WAHA
linked-device session.

**Why the earlier samples missed it, and it is a method fault worth carrying.**
Both the 6 September and 7 September samples grouped by `payload.id` and looked
for duplicate pairs. That host's WhatsApp session is no longer authenticated, so
it emits `session.status` events and no `message` events — events that carry no
`payload.id` and can never form a pair. **Absence of duplicates is not absence
of the sender.** Full account: `CLAUDE.md`, "It had not stopped. It was stopped,
by hand, at 06:08 UTC on 8 September 2026".

**Status: identified, and stopped by hand on 8 Sep 2026 — not yet permanently
removed (`restart: always` still declared, device 8 still linked).** Do not write
"removed", "decommissioned" or "done".

**"Done" looks like one of two things, and both are acceptable:**

- **Configure it** — add `x-nexus-webhook-secret` to its WAHA webhook
  `customHeaders`, same value as the box. Keeps a redundant capture path. Note
  that since its session lost authentication it captures nothing: it posts
  `session.status` and no messages, so this option now buys nothing.
- **Decommission it** — the two steps that are actually outstanding:
  `docker update --restart=no n8n n8n-db waha` on that PC, and unlinking
  WhatsApp linked device **8** on the handset.

**"Done" does NOT look like:** leaving it alone and arming the gate; the
identification; or the manual stop on its own. `restart: always` is declared on
all three services, and Docker restarts a manually stopped `always` container
when the daemon next starts — a Docker Desktop restart or a Windows reboot brings
the whole project back. **Neither outstanding step has been done.** Verification
is one observation from the box: no delivery carrying `me.jid …:8` over a window
long enough to mean something, with the desktop powered on and Docker running —
and read across *all* events, not by looking for duplicate `payload.id`.

**Unblocks:** change **07** (arming `WAHA_WEBHOOK_SECRET`), and therefore **09**.

**How urgent, honestly:** less than it looked, and for a second reason now.
`EVIDENCE-second-waha-2026-09-06.md` measured 51 distinct messages over ~9 hours
and **every one arrived from both hosts** — none from `.149` alone. On that
evidence arming the gate without configuring `.149` would have dropped nothing.
Since its session lost authentication it delivers only `session.status` posts,
which `Prefilter` discards anyway, so enforcement would drop them harmlessly.
That is not permission to arm the gate: **enforcement is blocked today by the
box's own traffic**, which reads `_gate.header_present true, ok false` — see
§2 and `ops/n8n-waha-gate/README.md`. A different blocker from the one this
section used to describe.

---

## 2. `WAHA_WEBHOOK_SECRET` on the VM, and WAHA sending the header

Two separate acts, and **the order between them is the whole risk in this bundle.**

**"Done" looks like:**

1. `/opt/nexus/.env` carries `WAHA_WEBHOOK_SECRET=<32+ random chars>` and
   **`WAHA_WEBHOOK_ENFORCE` is NOT set**; n8n restarted.
2. **Then** the box's WAHA sends `x-nexus-webhook-secret: <same value>` in
   `config.webhooks[].customHeaders`. *(Was "both WAHA hosts". Corrected
   8 September 2026: `.149` was stopped by hand that morning and its WhatsApp
   session is not authenticated, so it delivers `session.status` and no messages
   — there is nothing to configure and nothing lost if enforcement drops it.
   §1 stays open for the separate reason that it can restart.)*
3. **Then** saved executions show `_gate.mode == "MONITOR"`,
   `_gate.header_present == true`, `_gate.ok == true` — **from every source
   address you intend to keep, on at least one genuine 1:1 customer message**,
   not only on group traffic.
4. **Only then** `WAHA_WEBHOOK_ENFORCE=true`, restart, and one real WhatsApp
   message sent from a real handset gets a reply.

**Doing 2 before 1 is harmless.** Doing 1 in the n8n *node* instead of the VM env,
before 2, **silently drops every real customer message** — WAHA keeps seeing 200
and never backs off.

**Where this stands on 8 September 2026: stuck at step 3, and not for the reason
anyone expected.** Steps 1 and 2 are done — the header arrives, measured on
executions 11098/11099/11100, and the SHA-256 fingerprint of what WAHA sends
changed between 11096 and 11098, so the rotation reached WAHA. The gate
nevertheless reads `mode MONITOR, header_present true, ok false` on the box's own
traffic. The box runs in **queue mode** (`GET /rest/settings` →
`executionMode: "queue"`, concurrency 2), so the Code node that reads
`$env.WAHA_WEBHOOK_SECRET` executes in **`n8n-worker`**, not in `n8n`.
`docker compose up -d n8n` recreates the container you then `printenv`, and
leaves the one that does the comparing on the old value. Recreate both, and
verify where the value is consumed without printing it:

```
docker compose exec -T n8n-worker sh -c 'printf %s "$WAHA_WEBHOOK_SECRET" | sha256sum'
```

**Step 4 stays blocked until step 3 actually reads `ok: true`.** This is a
different blocker from §1's: the second sender no longer delivers messages, but
the box's own traffic currently fails its own comparison, so enforcing would
drop 100% of real inbound.

**Also set at the same time:** `NEXUS_PROBE_KEY` (any 24+ random chars). Without
it `Probe Auth Gate` in the health probe is dormant and the probe endpoint answers
anyone. **Do not set `NEXUS_PROBE_VERBOSE=true`** — once WAHA carries the secret,
`GET /api/sessions/default` returns it inside `config.webhooks[].customHeaders`,
and verbose mode is the one path that could echo the webhook list outward.

**Unblocks:** **05** (probe key), **07**, **09**.

---

## 3. The Meta policy attestation

**Production holds zero attestations and zero verified rules:**

```
select count(*) from public.policy_platform_attestation  ->  0
```

`policy_verify_rule()` refuses global rules by design ("global rules are verified
by the platform"). The platform path exists —
`policy_platform_verify_rule(uuid,text,text,text,text,text,date,date,text,text,text)`,
`service_role`-only, confirmed today — and it **demands an attestation**: a named
person, a reachable contact, a source kind, an openable reference, and the day it
was read. A global rule cannot reach `VERIFIED` without one.

Until then `WA_CUSTOMER_SERVICE_WINDOW_HOURS` stays `NOT_VERIFIED` and **every
conversation in production returns `TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED`.**
That is the engine being honest, and it is the single thing standing between the
messaging layer and being usable.

**"Done" looks like:** Ali opens the Meta Business account, reads the current
WhatsApp customer-service-window rule with his own eyes, and records it through
`policy_platform_verify_rule()` naming himself, his contact, the Meta document,
its URL, and the date he read it. **Nobody else can do this** — the attestation is
a statement about who checked, and an agent cannot be that person.

**Unblocks:** nothing in this bundle. It unblocks *switching WhatsApp messaging
on at all*, which is a separate and larger decision. **It is listed here so it is
not mistaken for something these nine changes deliver.**

**And note what it does not unblock:** `CLAUDE.md` records that the idempotency
family is judged not safe enough to switch WhatsApp messaging on, independently of
the attestation. Attesting the rule removes one blocker, not the verdict.

---

## 4. `NEXUS_TENANT_MAP`

**Not set on the box.** Every resolver falls through to its built-in
single-tenant map (`{ 'default': 'fff6a2b5-cfd5-4460-8383-875bc5826de0' }`),
which is hardcoded identically in `Resolve Tenant` (WhatsApp BDC),
`Find Silent Leads` (Phase 6), `Transform & Unify` (Customer 360) and
`Prepare Send` (WhatsApp Send) — read in all four today.

**The moment that var holds two keys, roughly fifteen code paths switch from "the
only dealership" to "unresolved" at once.**

**"Done" looks like:** the two-key switch **rehearsed on a staging box first**,
with a written list of which paths went to `unresolved` and what each did about
it. Then set in production.

**Two things that make the rehearsal weaker than it looks, both stated rather than
discovered later:**

- Production carries seven **column-level** grants on `channel_registry`;
  staging carries none. That is the table change 09 makes the resolver read.
- `v_customer_directory` **does not expose `tenant_id`**, so Customer 360 has no
  tenant signal at all with two dealerships configured. Its own node comment says
  so: *"THIS BATCH MUST NOT BE RUN WITH TWO DEALERSHIPS until v_customer_directory
  carries tenant_id."* That is a migration, not a workflow change, and it is not
  in this bundle.

**Unblocks:** onboarding a second dealership. **Not required for any of changes
01–09** — every one of them is correct with one dealership configured.

---

## 5. Not a precondition, but Ali's decision: `workflow_registry` vs the box

Two rows assert `is_active = true` for workflows the box has **never published**
(`57QpbNQGwlFKb0q3`, `B3TcpfzOMWj8oWgF` — both `activeVersionId: null`). The
dashboard reads the registry.

Either publish them (files 05 and 08) or correct the registry. **Leaving the
disagreement is the one option that keeps the dealership's Automation screen
saying something false.**
