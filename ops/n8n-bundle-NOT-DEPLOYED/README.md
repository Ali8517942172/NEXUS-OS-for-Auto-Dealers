# n8n change bundle — **NOTHING IN HERE IS DEPLOYED**

Assembled 6 September 2026 against the **live published** definitions on the
production box (35.224.126.225) and the **live** production database
(`dsvuoovivysszdoiorch`).

**What this pass did:** read the box (read-only), read the database (read-only),
verified every inherited claim against both, and wrote these files.
**What this pass did NOT do:** publish, unpublish, activate, update, execute or
test any workflow; write any row; touch `apps/` or `supabase/`; run git.

Two workflows that obviously *should* be published — the Infra Health Probe and
the Phase 6 Silence Detector — were deliberately **not** published. They are
traffic-affecting and they belong to Ali, in order, with a rollback.

---

## Read this first: the repo export is not evidence

`n8n-workflows/*.json` in the repo is a **30 August export** and is stale. It
contains **zero** occurrences of `tenant_id` while the box demonstrably stamps one
(measured today: `Resolve Tenant` → `Claim Message Id` → live executions carrying
`tenant_id: fff6a2b5-…`). Every "before" quoted in these files was read from the
box, not from that export. **Do not re-import it — doing so would revert the
tenancy wave.**

## Three inherited claims that did not survive contact with the box

| claim | verdict |
|---|---|
| `slack-command` is closed **by accident** — `Tenant For JWT User` lacks `alwaysOutputData:true` | **FALSE.** It has `alwaysOutputData: true`. Execution `9325` shows `Auth Gate` running and throwing; status `error`, not `success`. Closed **by design**. See `00`. |
| Master Router needs `?on_conflict=email` → `tenant_id,email` | **ALREADY DONE** on the live node. See `02`. |
| Customer 360 needs `on_conflict=customer_id` → `tenant_id,customer_id` | **ALREADY DONE** on the live node. See `02`. |

And one that was understated: Closed-Won's upsert has **no `on_conflict` at all**,
not the `?on_conflict=deal_id` the note assumed — which means it is not a
tenancy-hygiene edit but a probable live failure of the dashboard's closed-won
submission. See `02`.

---

## The order, and why

Safe → observable → traffic-affecting. **The order is the deliverable**; the
individual edits are the easy part.

| # | change | touches | reversible in | risk |
|---|---|---|---|---|
| **00** | `slack-command` claim corrected — **no change** | a sentence in `CLAUDE.md` | n/a | none |
| **01** | `Resolve Tenant` rollback warning (note only) | 1 node's Notes | seconds | none |
| **02** | Closed-Won `Upsert Vector`: add `?on_conflict=tenant_id,deal_id` | 1 URL | seconds | low |
| **03** | `communication_logs` writers send `external_message_id` | 3 node bodies | seconds | low — additive |
| **04** | `Claim Message Id` stops minting `nokey:`; `Is New Message?` stops treating 23514 as a licence to reply | 2–3 nodes | seconds | **medium — can suppress a reply** |
| **05** | Publish **NEXUS Infra Health Probe** | 1 publish + 1 registry row | seconds | medium |
| **06** | Edge JWT validation for the dashboard webhooks | Caddy, not n8n | seconds (`caddy reload`) | medium |
| **07** | **Arm `WAHA_WEBHOOK_SECRET`** | VM env + the box's WAHA (`.149` no longer applies — see below) | ~10 s (disable the gate node) | **HIGH — can silently drop every customer message** |
| **08** | Publish **Phase 6 Silence Detector** | 1 publish | seconds | **high — contacts humans** |
| **09** | `Resolve Tenant`: `NEXUS_TENANT_MAP` → `channel_registry` | 1–2 nodes | seconds | high |

### The ordering constraints that actually bite

- **03 before 04.** 03 makes `communication_logs` carry the provider id. That is
  the only way to see afterwards whether a message was answered once or twice.
  Do 04 first and you are judging a reply-suppression change from screenshots.
- **05 before 07.** The gate rollout is the change that can take the WhatsApp
  channel dark, and the probe is the only thing that would tell you. **Right now
  nothing is watching the WhatsApp channel** — the probe has never been published
  (`activeVersionId: null`) while `workflow_registry` says `is_active = true`, and
  the dashboard reads the registry.
- **07's internal order is the single largest risk in this bundle.**
  Set the secret on the **VM** first → make **both** WAHA hosts send
  `x-nexus-webhook-secret` → confirm MONITOR shows `_gate.ok: true` from every
  source **on a genuine customer message** → only then `WAHA_WEBHOOK_ENFORCE=true`.
  **Hardcoding the secret in n8n before WAHA sends the header silently drops every
  real customer message**, and WAHA keeps seeing 200 so nothing ever errors.
  **Update 8 September 2026:** "both hosts" now means the box only —
  `2.50.10.149` was stopped by hand that morning and its session was already
  unauthenticated, so it delivers no messages to configure for. The step is
  nevertheless stuck: the gate reads `header_present true, ok false` on the
  **box's own** traffic, because in queue mode the comparison runs in
  `n8n-worker` and `docker compose up -d n8n` does not recreate it. See
  `PRECONDITIONS.md` §2.
- **07 before 09.** Moving the tenant map into `channel_registry` does not
  authenticate the caller; `body.session` is still caller-supplied. Doing 09 first
  produces something that *looks* finished and is not. Every tenant control proven
  this month sits behind that door.
- **04, 06 and 07 in separate windows.** All three produce the same symptom —
  "the bot stopped replying". Run them together and you will not know which.
- **05 and 08 in separate windows.** Both write `audit_log` rows through the same
  error workflow (`iYJkh1kztWxZXDbT`). Separate them so a FAILED row has one
  possible author.
- **06 must exclude `whatsapp-inbound` and `slack-command`.** If edge JWT
  validation catches the WhatsApp path, every real customer message is 401'd at
  the door and the channel dies silently. That exclusion is the most important
  line in the Caddy config.

---

## The question that decided whether 07 can be armed

**Is `2.50.10.149` ever the ONLY sender of a message?**

**Measured: no — not once in the sample.** 102 executions of `BiyHk9ZXxJUVGbf6`
over 8h56m (5 Sep 18:23 → 6 Sep 03:19 UTC), **51 distinct `payload.id`, every one
of them delivered twice — once from `35.224.126.225`, once from `2.50.10.149`.
Zero from `.149` only. Zero from the box only.**

So arming the gate with only the box configured would, on that evidence, have
dropped nothing. **Configure the second host anyway** — the sample is 9 hours of
one day in which both hosts were up throughout, and it contained **zero genuine
customer conversations**. Full method, limits and worked examples:
`EVIDENCE-second-waha-2026-09-06.md`.

**Which host it is — 8 September 2026, stated by Ali, not measured.**
`2.50.10.149` is his own Windows desktop **`desktop-l3an0ma`**, running WAHA in
Docker Desktop; the same PC that used to host n8n behind a Tailscale funnel at
`https://desktop-l3an0ma.tail2141f7.ts.net`, from before the move to GCP. He has
asked for it to be removed.

**And it had not stopped — measured 8 September 2026.** Production execution
**11103** at **06:07:40 UTC** carries `x-forwarded-for 2.50.10.149`,
`WAHA/2026.7.1`, `me.jid …:8`, `body.event session.status`, no
`x-nexus-webhook-secret`. The 6 and 7 September samples missed it because both
grouped by `payload.id` and looked for pairs, and that host's session is no
longer authenticated: it emits `session.status` events, which carry no
`payload.id` and can never pair. **Absence of duplicates is not absence of the
sender.** Docker Desktop on that PC showed the `nexus-os` compose project with
`n8n`, `n8n-db` and `waha` all running; the project was **stopped by hand at
06:08:24 UTC** and deletion was declined.

**Carry it as: identified, and stopped by hand on 8 Sep 2026 — not yet
permanently removed (`restart: always` still declared, device 8 still linked).**
A Docker Desktop restart or a Windows reboot brings it back. See
`PRECONDITIONS.md` §1, `EVIDENCE-second-waha-2026-09-06.md`'s second addendum,
and `CLAUDE.md`, "It had not stopped. It was stopped, by hand, at 06:08 UTC on
8 September 2026".

**Second number from the same sample, because it changes what this channel is
worth:** `Is Real Inbound?` classified **0 of 102** executions (0 of 51 messages)
as genuine customer conversation. All 51 were group chats, `status@broadcast` or a
newsletter, arriving on Ali's personal handset. The audit's claim that most of
this traffic is not customer conversation is confirmed, and understated: in this
window **none of it was**.

---

## Files

| file | what it is |
|---|---|
| `README.md` | this runbook |
| `PRECONDITIONS.md` | what is Ali's alone, what "done" looks like, what each unblocks |
| `VERIFY.md` | per change, the query or observation that proves it worked |
| `EVIDENCE-second-waha-2026-09-06.md` | the Part 1 measurement in full |
| `00-…` … `09-…` | one file per change: exact node, exact before/after, out-of-order consequences, rollback |

## House rules this bundle assumes

- **One agent on the n8n box at a time.** Parallel writes have taken this VM down
  twice.
- **n8n edits stay in draft until published**, and you verify against the
  **published** version by fetching it back — not against your draft.
- **A missing row is not proof the event did not happen.** Several "before"
  numbers here are zero. Zero means measured-and-empty; it is stated that way,
  and where a zero could also mean not-yet-run, that is said too.
