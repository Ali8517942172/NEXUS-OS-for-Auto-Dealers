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

**What we do NOT know, and cannot: which machine it is.** Nobody but Ali can find
a host by its address. Candidates worth checking in order: an old laptop or
desktop still running a WAHA container from an earlier install; a home or office
NUC/Raspberry Pi; a previous VPS; a colleague's machine that was linked to the
business number during setup and never unlinked. WhatsApp's **Linked Devices**
screen on the handset will show device 8 alongside device 12 — that is the
fastest way in.

**"Done" looks like one of two things, and both are acceptable:**

- **Configure it** — add `x-nexus-webhook-secret` to its WAHA webhook
  `customHeaders`, same value as the box. Keeps a redundant capture path.
- **Decommission it** — unlink the device in WhatsApp and stop the container.

**"Done" does NOT look like:** leaving it alone and arming the gate.

**Unblocks:** change **07** (arming `WAHA_WEBHOOK_SECRET`), and therefore **09**.

**How urgent, honestly:** less than it looked. `EVIDENCE-second-waha-2026-09-06.md`
measured 51 distinct messages over ~9 hours and **every one arrived from both
hosts** — none from `.149` alone. On that evidence arming the gate without
configuring `.149` would have dropped nothing. The sample is 9 hours of one day
and contained zero genuine customer conversations, so it is grounds for confidence,
not for skipping the step.

---

## 2. `WAHA_WEBHOOK_SECRET` on the VM, and WAHA sending the header

Two separate acts, and **the order between them is the whole risk in this bundle.**

**"Done" looks like:**

1. `/opt/nexus/.env` carries `WAHA_WEBHOOK_SECRET=<32+ random chars>` and
   **`WAHA_WEBHOOK_ENFORCE` is NOT set**; n8n restarted.
2. **Then** both WAHA hosts send `x-nexus-webhook-secret: <same value>` in
   `config.webhooks[].customHeaders`.
3. **Then** saved executions show `_gate.mode == "MONITOR"`,
   `_gate.header_present == true`, `_gate.ok == true` — **from every source
   address you intend to keep, on at least one genuine 1:1 customer message**,
   not only on group traffic.
4. **Only then** `WAHA_WEBHOOK_ENFORCE=true`, restart, and one real WhatsApp
   message sent from a real handset gets a reply.

**Doing 2 before 1 is harmless.** Doing 1 in the n8n *node* instead of the VM env,
before 2, **silently drops every real customer message** — WAHA keeps seeing 200
and never backs off.

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
