# Risks, unverified assumptions, and how to test without cutting off customers

## Global caveats

| # | Assumption | Why it matters | If it is wrong |
|---|---|---|---|
| G1 | The exports in `/home/claude/audit/n8n-workflows/` match the live box. The BDC export carries 36 nodes and `updatedAt` 2026-08-30T04:10:02Z; the brief describes it as 44 nodes. **The live workflow has been edited since this export.** | Node names and connection edges are read from the export. `OPERATIONS_bdc.json` only asserts one edge — `WAHA Webhook (POST)` → `Prefilter`. | If some later edit already inserted a node between the webhook and `Prefilter`, the `removeConnection` op will not match and the array will be rejected as a whole (which is the safe failure). Re-read the live workflow with `get_workflow_details` and re-point the two connection ops before applying. |
| G2 | `update_workflow` operation-type names (`addNode`, `setNodeSettings`, `updateNodeParameters`, `setNodePosition`, `addConnection`, `removeConnection`) and the top-level `{workflowId, versionName, versionDescription, operations}` envelope. Taken from the shapes already used by this project's other applied patch sets, not from a successful call in this session. | A rejected array applies nothing. | Budget one round of correction. Failure is atomic and safe. |
| G3 | `$env` works in Code nodes on this box (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, compose passes the vars). Stated in the brief and consistent with `$env.WAHA_API_KEY` being used in live HTTP nodes. | Every gate here reads `$env`. | If `$env` returned undefined, **every gate is dormant / fail-open** — the endpoints go back to today's behaviour, they do not go dark. This was the deciding factor in choosing the fail-open-when-unconfigured design. |
| G4 | An n8n container restart is required for a new `.env` value to be visible. | Two restarts in the WhatsApp rollout, ~30 s each. | If your compose setup reloads without a restart, so much the better. Test on the probe (Part B) first — it is not on the customer path. |
| G5 | All three workflows share `errorWorkflow: iYJkh1kztWxZXDbT` and it actually notifies someone. | The new `Probe Alarm` relies on it to be heard. | If nothing is wired to notify, the alarm produces a failed execution and no alert. Verify by checking that a recent failure somewhere in the system produced a message someone saw. |

---

## Exposure 1 — WhatsApp webhook

### What could break

* **The one real outage window** is the ~30 s n8n restart at Stage 2 and Stage 4.
  A customer messaging in that window gets no bot reply. The message itself is not
  lost — it is still in WhatsApp — and the Phase 6 silence detector is the
  existing net. Do it at night, Dubai time.
* **WAHA sends the header wrongly and enforcement is switched on anyway.** Then
  every real customer message is silently dropped: no reply, no log row, no error,
  no alert. This is the worst realistic outcome, and it is exactly why MONITOR
  mode exists and why the runbook forbids Stage 4 until `_gate.ok = true` is
  observed on real traffic. Do not skip step 11.
* **Someone rotates the secret in one place only.** Same failure, same silence.
  `OWNER_STEPS.md` closes with the two-place rule.
* **`saveDataSuccessExecution` is `none` on this workflow**, so by default there
  is nothing to inspect in MONITOR mode. The runbook turns saving on for the watch
  window and off again. If it is left on, the database grows.
* **Silent drops mean no alerting on attacks.** Deliberate: throwing would let an
  attacker generate unlimited error-workflow alerts and execution rows on a
  958 MB box. The cost is that a real misconfiguration is also quiet — which is
  what MONITOR mode is for.

### What could not be verified

* **The exact WAHA configuration surface for custom headers.** WAHA carries the
  webhook under `config.webhooks[]` with `url`, `events` and `customHeaders`
  (`[{name, value}]`) — the `url`/`events` shape is confirmed by the probe's own
  `Format Probe` code reading exactly those fields off the live response. The
  `customHeaders` field name, the dashboard's label for it, and the global env
  form (`WHATSAPP_HOOK_CUSTOM_HEADERS`) are **taken from WAHA's documented
  behaviour, not verified against this deployment.** Check the running version's
  docs. WAHA also supports HMAC webhook signing (an `X-Webhook-Hmac` header keyed
  by a configured secret) — strictly stronger, since the signature covers the
  body — but it is a bigger change on both sides and equally unverified here. The
  static shared header is the smaller, reversible first step; the gate node is the
  place to upgrade to HMAC later without touching anything else.
* **Whether the WAHA dashboard on this box exposes a header field at all.** If it
  does not, this becomes a config-API call and Ali needs help for that one step.
* **Whether anything other than WAHA legitimately calls `/webhook/whatsapp-inbound`.**
  Nothing in the 23 exports does. If some external tool or an old test script does,
  it will start being dropped at Stage 4. MONITOR mode will show it first:
  requests arriving with `header_present: false` after WAHA is configured are
  exactly this case — investigate before enforcing.

### How to test without cutting off real customers

1. Stage 1 and Stage 2 are behaviour-preserving by construction: with the gate
   dormant or in monitor mode, `return items` runs for every request. The test is
   simply "send a WhatsApp from your own phone and get a reply".
2. To prove the gate actually blocks, before Stage 4 — while still in MONITOR —
   `curl -s -X POST https://35.224.126.225.nip.io/webhook/whatsapp-inbound -H 'Content-Type: application/json' -d '{"event":"message","payload":{"id":"probe-test-1","from":"999999999999@c.us","fromMe":false,"body":"gate test"}}'`
   and look at the `WAHA Auth Gate` output for that run: it must show
   `ok: false, header_present: false`. Repeat with
   `-H 'X-Nexus-Webhook-Secret: <the secret>'` and it must show `ok: true`.
   Use a nonsense `from` so no real person is messaged. In MONITOR both requests
   still run the full chain, so expect a `processed_messages` row and a failed
   send — that is fine and is the last time it will be.
3. After Stage 4, repeat the unsigned `curl`. Nothing should happen at all: no new
   execution beyond the gate, no send, no rows. The HTTP response is still 200 —
   that is expected and is not a failure of the fix.
4. Watch `communication_logs` for the following morning. If inbound volume looks
   normal, enforcement is not eating real traffic.

---

## Exposure 2 — health probe

### What could break

* **A 15-minute schedule adds 96 executions a day.** Each is one HTTP call inside
  the Docker network plus two tiny Code nodes; negligible against production
  concurrency 2, and `saveDataSuccessExecution: none` on this workflow means they
  do not accumulate in the database. If the box is already CPU-starved (a known
  theme in this project's history), widen the interval rather than removing it.
* **Alert fatigue.** `Probe Alarm` de-duplicates using
  `$getWorkflowStaticData('global')`: 1st failure, then every 8th (~2 h).
  **Static data persists only for production executions** — manual runs from the
  editor do not update the counter reliably, so a manual run may alert when you
  did not expect it.
* **`Respond Degraded` returning 503 will make any uptime checker pointed at this
  URL go red.** That is the intent, but if anything already polls this endpoint and
  treats non-200 as a page-out, expect noise the first time WAHA hiccups.
* **`ok` requires `webhook_count > 0`.** If a maintenance window legitimately
  clears the webhook list, the probe reports FAIL. Correct, but surprising.
* **The verbose flag is a loaded gun.** `NEXUS_PROBE_VERBOSE=true` restores the
  connected number and webhook URLs. Only ever set it while `NEXUS_PROBE_KEY` is
  also set, and unset it afterwards.
* **A secret-in-a-URL hazard:** the `?key=` fallback is a convenience. Query
  strings land in proxy logs, browser history and referrer headers. Prefer the
  header; treat the query key as rotatable.

### What could not be verified

* **`options.responseCode` on `respondToWebhook` typeVersion 1.1.** Sidestepped
  rather than assumed: two Respond nodes with literal integers (401, 503) instead
  of one node with an expression. If even the literal is rejected on this version,
  the fallback is to set the code in `options.responseHeaders`-adjacent config for
  your version, or upgrade the node's typeVersion.
* **`scheduleTrigger` typeVersion 1.2 and the `rule.interval[].minutesInterval`
  shape.** Standard for current n8n, not confirmed against this instance.
* **What `/api/sessions/default` returns on this specific WAHA build** when the
  container is up but the session is not scanned. The verdict logic covers
  transport error, non-2xx, non-`WORKING` status, missing number and zero
  webhooks; a build that reports health some other way could produce a false FAIL.
  Watch the first day of scheduled runs before trusting the alarm.

### How to test safely

The probe is not on the customer path — test it freely. Sequence: (a) unauthenticated
GET must return 401; (b) GET with the key must return `PASS`; (c) confirm the
response contains **no** phone number and **no** webhook URLs; (d) to prove the
FAIL path without touching WAHA, temporarily point `WAHA Sessions`' URL at
`http://waha:3000/api/sessions/does-not-exist`, call the probe, confirm 503 with a
reason, then put the URL back — do **not** stop the WAHA container to test this.
`Run Manually` still works for a no-HTTP dry run.

---

## Exposure 3 — Slack

### What could break

* **Nothing that currently works.** Zero executions in ~70 edits is the whole
  basis of the decision. Verify it yourself before deactivating: n8n → the
  workflow → **Executions**. If that list is *not* empty, stop — the premise is
  wrong, and the choice should be reconsidered in favour of implementing Slack
  signature verification.
* **The `Update Lead Status` allowlist throws on an unrecognised value.** Inside a
  `supabaseTool`, a throwing parameter expression surfaces as a failed tool call.
  Expected behaviour is that the agent reports it and moves on; **it is possible
  it instead fails the whole agent run.** Fail-closed either way — a rejected
  status is never written — but it is a behaviour change to watch for if the
  workflow is ever reactivated.
* **The allowlist may be too narrow.** It was taken verbatim from the original
  `$fromAI` description (`HOT, WARM, COLD, CONTACTED, QUALIFIED, WON, LOST`).
  The real `leads.status` domain in Supabase was not checked. If the database uses
  other values, widen the `ALLOWED` array — do not delete the check.
* **`Search Leads` calling `$fromAI` twice with the same keys.** Repeating a
  `$fromAI` key returns the same argument and does not add a schema field — that
  is the documented behaviour, but it is **not verified on this instance.** The
  descriptions are byte-identical to the originals and the
  `/*n8n-auto-generated-fromAI-override*/` markers are preserved, so the generated
  tool schema should be unchanged. If it turns out a second call generates a
  duplicate parameter, move the check into a plain Code node instead.
* **Legitimate `%%` searches now fail.** Intentional. Dropping `limit` 20 → 5 also
  narrows genuine results.

### What could not be verified

* Whether a Slack app exists at all, whether any slash command points here, and
  whether anyone is waiting on this feature. If someone is, the answer is the
  build-it-properly recipe at the end of `DESIGN.md`, not reactivation.
* Whether deactivating the workflow breaks any dashboard button. Nothing in the
  23 exports calls `/webhook/slack-command`; a grep of `/home/claude/audit/apps/` for
  `slack-command` and `infra-probe` returned nothing, so no dashboard page calls
  either endpoint. That covers the code in the audit tree only — not anything
  running elsewhere.

### Note on the hard-coded key in this workflow

`Verify JWT` contains a literal Supabase key. It is the **publishable anon key**
(`"role":"anon"`), which is meant to ship publicly; the prior security audit
reached the same conclusion. It is not a finding, and it is not touched here. It
does mean RLS is the only real database boundary — out of scope for this patch set.
