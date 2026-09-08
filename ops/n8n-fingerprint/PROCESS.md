# The n8n fingerprint process — versioning production workflow changes

**Status: PROPOSED. Nothing in this file has been applied.** No script named
here exists in the repository, no CI job has been added, no lock file has been
created, no workflow has been fetched, and the production n8n box
(`35.224.126.225`) was not contacted while this was written. Every measurement
below was taken from files already in the repository. Where a fact about n8n's
own behaviour could not be read out of this repository it is marked **asserted**
and appears again under "Unknowns".

The rule this exists to serve, stated by the owner:

> **Live n8n = source of operational truth. Git export = source of
> reproducibility, not live truth.**

and the shape every production change is to carry:

    deploy → fetch live definition → export → commit → fingerprint

with one hard constraint, restated by the owner on 8 September 2026 and already
recorded in `CLAUDE.md` under "House rules that exist because something broke":
**many agents inspect; one agent publishes.** Inspect, design, test, review and
draft run in parallel. Writing to the box does not.

---

## 0. Why this exists — the defects, each cited

Every row was checked against the file named, in this checkout, today.

| # | Defect | Where it is recorded |
|---|---|---|
| 1 | The repo's workflow export is a **30 August** snapshot and is used as if it were live. | `CLAUDE.md`: "`n8n-workflows/*.json` is a 30 Aug export containing zero occurrences of `tenant_id`". Confirmed here: `grep -ro tenant_id n8n-workflows/*.json` returns **0** across all 22 files, so the export cannot name the four workflows that omit `tenant_id`. Each export file carries `_exported_from.updatedAt`; the newest is `2026-08-30T17:59:08.838Z`. |
| 2 | A claim was read out of that stale export and was **wrong**. | `CLAUDE.md`: "~~`slack-command` is closed by accident~~ **Retracted**… The claim above was read from the 30 August repo export, which is stale; the box is the witness." Full retraction with execution `9325` in `ops/n8n-bundle-NOT-DEPLOYED/00-slack-command-claim-corrected-NO-CHANGE-NOT-DEPLOYED.md`. |
| 3 | The SDK round-trip check covers **only the two Code node bodies**, so the scaffolding around them — webhook path, credential, `retryOnFail`, `onError` — is invisible to the very check whose purpose is repo↔box equality. That gap shipped. | `ops/n8n-google-lead-form/build-sdk.js:48-57`: "This line said ':key' here, and therefore in the generated SDK, while the published workflow said 'google-ads-lead'. The round-trip check below covers the two Code BODIES and nothing around them". The check itself is at `:369-388` and compares exactly two files. |
| 4 | A node's behaviour is invisible in an export you skim. | `ops/n8n-waha-gate/prefilter.assignments.md:8`: "`Prefilter` is a Set node in assignments mode with `includeOtherFields` off, so these four fields are the *entire* item from here on." That file opens by saying it exists "because the repo's `n8n-workflows/*.json` is a 30 August export and this node has changed twice since". |
| 5 | Parallel writes have taken the production VM down **twice**; on 28 August four zombie executions held four of five concurrency slots and froze the instance for **23 hours**. | `CLAUDE.md`, "House rules…"; `JOURNEYS.md:2098-2103`; `ops/n8n-bundle-NOT-DEPLOYED/README.md:159`. |
| 6 | The box is in **queue mode**, so a Code node's `$env` is read by `n8n-worker`, not `n8n`. This cost a day on the WAHA gate. | `CLAUDE.md`, "The worker is the process that reads `$env`, and the box is in queue mode": "`GET /rest/settings` … returns **`executionMode: "queue"`** … **The verification and the defect were in different containers.**" Repeated in `ops/n8n-meta-lead-ads/GO-LIVE.md:256-293` and `ops/n8n-waha-gate/README.md:207-225`. |

Two more, found while checking the six above. Both are measurements, not
inferences.

**7. One workflow, four different node counts in this repository.**
`BiyHk9ZXxJUVGbf6` — WhatsApp BDC AI Agent:

| source | nodes |
|---|---:|
| `n8n-workflows/backup/whatsapp_bdc.json` | 11 |
| `n8n-workflows/whatsapp_bdc_ai_agent.json` (`_exported_from.updatedAt 2026-08-30T17:59:08.838Z`) | 43 |
| `docs/audit-2026-08-30/webhookauth/DESIGN.md:8`, from a 04:10:02Z export the same day | 36 |
| `JOURNEYS.md:1435`, measured from the published definition on 4 September | 45 |

`docs/audit-2026-08-30/webhookauth/RISKS.md:7` already names this as the top
risk of that audit — "**The live workflow has been edited since this export**" —
and `docs/audit-2026-08-30/voice/RISKS.md:13` calls comparing `updatedAt` against
the export "the single most dangerous property of this change set". That
comparison is a fingerprint with one field. This document is the same idea
carried through.

**8. `scripts/export-live-workflows.mjs` cannot produce a complete export, and
would produce a confusing one.** Its `FILE_MAP` holds **13** workflow ids.
Twenty-one export files in `n8n-workflows/` carry `_exported_from.id`, and
**8 of those ids are not in the map** — they would be skipped and merely listed
at the end:

    57QpbNQGwlFKb0q3  NEXUS Infra Health Probe
    iYJkh1kztWxZXDbT  NEXUS Error Handler          <- the errorWorkflow every alarm routes to
    yx6m55p1Kj8V7koR  WhatsApp Send (Dashboard Reply)
    ZUc42jcwwHoBeEr8  Inventory Ageing Recompute
    aIYwwoYStDAi9kHy  NEXUS Retention Purge
    bhzCbnro0MlSCwwo  NEXUS Public — Home
    vKTmNepP4fGaTAe8  NEXUS Public — Privacy
    Z0zFB6IKvARAzjpQ  NEXUS Public — Terms

The three receivers published on 7 September — `EYva4c2bMV5MGq0o` (Google Ads
Lead Form), `JDqy54w2HUH7pHgW` (Meta Lead Ads), `J8MXprxVw1yhjBpp` (WhatsApp
Cloud) — appear in **no** export file and in **no** map. `JOURNEYS.md:45-52`
counted **21 workflows / 334 nodes** on the box on 4 September; `README.md:190`
still says "18 registered workflows". The manifest must be **discovered from the
box**, never hand-maintained, and an id present on the box but absent from the
repo must be a finding rather than a log line.

---

## 1. What a fingerprint is

### 1.1 What it is a fingerprint *of*

Not of the HTTP response. `GET /api/v1/workflows/:id` returns fields that move
without the workflow changing, and fields that differ between two instances
running the identical definition. A hash of the response would change on every
fetch and would never match between the GCP box and a staging box, which makes
it useless for the one question it is asked: **is what runs today the same thing
the repository records?**

So the fingerprint is over a **canonical definition**: the subset of the fetched
object that decides what the workflow *does*, rendered in a form that is stable
across fetches, across saves that changed nothing, and across instances.

Two hashes are produced, and both go in the committed file:

- **`fp.definition`** — the canonical definition. This is the one that gates.
  It is what a change record quotes and what the drift check compares.
- **`fp.envelope`** — everything else the fetch returned that is not provably
  volatile: node positions, credential **ids**, `webhookId`s, pinned data, tags,
  the workflow id. A change here is **reported and never fails the build**. It
  exists so that "the fingerprint deliberately ignores this" cannot quietly
  become "nobody is looking at this".

Volatile fields — `updatedAt`, `createdAt`, `versionId`, `activeVersionId`,
`triggerCount`, `staticData`, `shared`, `homeProject` — are in **neither** hash.
They are recorded verbatim in the committed file's `publication` block, and
`versionId` / `activeVersionId` are *asserted* by the export process (§2.2)
rather than hashed.

### 1.2 Included, and why

| Included | Why it is load-bearing |
|---|---|
| Workflow `name` | It is the human handle in every change record and in `workflow_registry`. |
| `settings`, all keys | `saveDataSuccessExecution: "none"` made a monitoring window unobservable — `CLAUDE.md` records having to flip it to `"all"` "or you will enforce blind". `errorWorkflow` decides whether an alarm reaches `audit_log`. `executionOrder`, `timezone` (`Asia/Dubai`), `executionTimeout`, `callerPolicy` all change behaviour. |
| Per node: `name`, `type`, `typeVersion` | A `typeVersion` bump changes node semantics. |
| Per node: `parameters`, in full and deep | This is the webhook `path` and `httpMethod` that shipped wrong (defect 3), the `includeOtherFields` flag that empties the item (defect 4), every `jsCode` body, every URL, every expression. |
| Per node: `notes` | The house rule "**Check captions against the branch they sit in** — sentences asserting the opposite of their own code have been found seven times here" (`CLAUDE.md`) makes an on-box comment part of what must not drift silently. |
| Per node: `onError`, `retryOnFail`, `maxTries`, `waitBetweenTries`, `alwaysOutputData`, `executeOnce`, `continueOnFail`, `disabled` | Exactly the fields defect 3 says are invisible to the SDK round-trip. `alwaysOutputData` is the single field the `slack-command` retraction turned on. `onError: continueRegularOutput` on `Claim Message Id` is the deliberate fail-open documented in `prefilter.assignments.md`. `disabled` is how `Probe Webhook` was closed (`ops/evidence/v1-closure-n8n.md`). |
| Per node: credential **type key → credential name** | A node bound to no credential, or to a differently-named one, is a real defect. |
| `connections`, with array order preserved | The topology. Order inside one output array is preserved, not sorted — see §1.6. |

### 1.3 Normalised away, and why

| Normalised away | Why |
|---|---|
| `updatedAt`, `createdAt` | Move on every save, including a save that changed nothing. |
| `versionId` | A new UUID per save. Asserted, not hashed. |
| `activeVersionId`, `active`, `isArchived` | Publication *state*, not definition. If publishing moved the fingerprint, the same definition published twice would have two fingerprints and the fingerprint would stop being an identity. Asserted separately (§2.2). |
| Workflow `id` | Per-instance. The desktop instance recorded in `n8n-workflows/backup/README.md` ran its own copies with their own ids. Recorded in `identity`, compared by equality by the drift check, kept out of the hash so a definition stays comparable across instances. |
| Node `id` | n8n reassigns node ids on import and duplicate; the committed exports already show them rewritten to `"1"`, `"2"`, … `connections` are keyed by node **name**, not id, so nothing depends on them. |
| Node `position` | Canvas coordinates. **This is the costliest exclusion — see §1.6.** |
| `webhookId` | Per-instance; `scripts/export-live-workflows.mjs` already drops it with the comment "regenerated per instance". Kept in the envelope, because for a path-parameter webhook it is part of the registered URL (`build-sdk.js:48-51`). |
| Credential **id** | Differs between instances. Only the name is hashed. |
| `pinData` | Editor fixtures. Asserted (**asserted**) to affect manual executions only. In the envelope, never dropped from the file, because pinned data left on a production trigger is a smell that must stay visible. |
| `staticData` | Runtime state, not definition — the probe's consecutive-failure counter lives here (`ops/evidence/v1-closure-n8n.md`). It changes on its own. Neither hashed **nor committed**. |
| `tags`, `meta`, `shared`, `homeProject`, `triggerCount` | Instance bookkeeping. `tags` are in the envelope because §4 puts the lock holder in one. |
| CRLF inside any string | `.gitattributes` sets `* text=auto eol=lf` and says why: "Without this, exporting workflows re-wrote whole files with no real change." Git will not preserve a CRLF distinction in a committed export, so the fingerprint must not claim to. Every string is converted to LF before hashing. |
| Object key order | JSON objects are unordered; n8n re-serialises them on save. Keys are sorted. **Array order is not touched** — `headerParameters.parameters`, `conditions`, and connection targets are ordered. |
| `null` and `false` on the eight node policy flags | n8n returns `"onError": null` (seen in `ops/n8n-bundle-NOT-DEPLOYED/00-…md`) where another fetch omits the key. Absent, `null` and `false` all mean "off" and collapse to absent. |
| `maxTries` / `waitBetweenTries` when `retryOnFail` is not `true` | They do nothing in that state. **n8n's defaults are not filled in** when retry *is* on: an explicit `maxTries: 3` and an absent one hash differently. That is deliberate noise — inventing a default means the fingerprint silently changes meaning the day n8n changes its default. A cosmetic drift is cheap; a false "clean" is not. |

### 1.4 The algorithm

Runnable. ESM, no dependencies, the shape of `ops/ci/*.mjs`. Would live at
`ops/n8n-fingerprint/fingerprint.mjs`.

```js
#!/usr/bin/env node
/* NEXUS OS — the fingerprint of an n8n workflow definition.
 *
 * WHAT THIS IS FOR
 * ----------------
 * "Live n8n = source of operational truth. Git export = source of
 * reproducibility." Reproducibility needs an identity, and n8n does not supply
 * one: versionId is a new UUID on every save, updatedAt moves when nothing
 * changed, and node ids, positions, webhookIds and credential ids all differ
 * between two instances running the identical definition. Hashing the API
 * response answers a question nobody asked.
 *
 * So this hashes a CANONICAL DEFINITION -- the part that decides what the
 * workflow does -- and hashes the rest separately, so that "we deliberately
 * ignore this" never quietly becomes "nobody is looking at this".
 *
 * THE ALGORITHM IS VERSIONED IN THE OUTPUT. Every fingerprint is prefixed
 * `nexusfp1-`. If the canonicalisation ever changes, bump it: a fingerprint
 * computed under different rules must be visibly incomparable, not quietly
 * unequal.
 *
 * WHAT IT CANNOT SEE is written down in PROCESS.md §1.6 and is not short.
 *
 * EXIT (as a CLI)  0 printed a fingerprint · 3 this script could not run
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const ALGORITHM = 'nexusfp1';

const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');

/* Git stores these files with eol=lf (.gitattributes), so a CRLF distinction
   cannot survive a commit. The fingerprint must not claim to see one. */
const lf = s => s.replace(/\r\n/g, '\n');

/* Sorts object keys at every depth; leaves array order alone, because array
   order is meaningful in n8n (header parameters, filter conditions, the targets
   of one connection output). Drops undefined; keeps null. */
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortDeep(v[k]);
    return out;
  }
  return typeof v === 'string' ? lf(v) : v;
}

/* Absent, null and false all mean "off" for these. n8n returns all three
   spellings depending on how the node was last saved. */
const FLAGS = ['disabled', 'alwaysOutputData', 'executeOnce', 'continueOnFail', 'notesInFlow'];

function canonicalNode(n) {
  const out = {
    name: n.name,
    type: n.type,
    typeVersion: n.typeVersion,
    parameters: sortDeep(n.parameters ?? {}),
  };
  /* A node comment is part of the definition here. This project has found
     seven sentences asserting the opposite of the code they sit next to. */
  if (typeof n.notes === 'string' && n.notes.trim() !== '') out.notes = lf(n.notes);
  for (const f of FLAGS) if (n[f] === true) out[f] = true;
  /* onError is a string when set and null when not. These four fields are the
     ones the SDK round-trip cannot see, which is why they are in the hash. */
  if (typeof n.onError === 'string' && n.onError) out.onError = n.onError;
  if (n.retryOnFail === true) {
    out.retryOnFail = true;
    /* Defaults are NOT filled in: inventing one makes the fingerprint change
       meaning the day n8n changes its default, silently. */
    if (n.maxTries !== undefined && n.maxTries !== null) out.maxTries = n.maxTries;
    if (n.waitBetweenTries !== undefined && n.waitBetweenTries !== null) out.waitBetweenTries = n.waitBetweenTries;
  }
  /* Credential NAME, never id: ids differ between instances, and the binding is
     what matters. The cost is in PROCESS.md §1.6 -- two credentials sharing a
     name are indistinguishable after this. */
  const creds = n.credentials || {};
  const bound = {};
  for (const k of Object.keys(creds).sort()) bound[k] = creds[k]?.name ?? null;
  if (Object.keys(bound).length) out.credentials = bound;
  return out;
}

function canonicalConnections(conns) {
  const out = {};
  for (const src of Object.keys(conns || {}).sort()) {
    const byKind = {};
    for (const kind of Object.keys(conns[src] || {}).sort()) {
      /* Two levels of array, both positional: output index, then the targets of
         that output. Neither is sorted. */
      byKind[kind] = (conns[src][kind] || []).map(output =>
        (output || []).map(e => ({ node: e.node, type: e.type, index: e.index })));
    }
    out[src] = byKind;
  }
  return out;
}

/** The canonical definition. Throws rather than guessing. */
export function canonicalise(wf) {
  if (!wf || typeof wf !== 'object') throw new Error('not a workflow object');
  if (!Array.isArray(wf.nodes)) throw new Error('workflow has no nodes array');
  const nodes = {};
  for (const n of [...wf.nodes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (typeof n.name !== 'string' || !n.name) throw new Error('a node has no name');
    if (nodes[n.name] !== undefined) {
      /* n8n is understood to forbid this; if it ever happens, keying by name
         would silently drop a node, so refuse instead. */
      throw new Error(`two nodes are named ${JSON.stringify(n.name)} — cannot key by name`);
    }
    nodes[n.name] = canonicalNode(n);
  }
  return {
    algorithm: ALGORITHM,
    name: wf.name,
    settings: sortDeep(wf.settings ?? {}),
    nodes,
    connections: canonicalConnections(wf.connections),
  };
}

/** Everything deliberately left out of the definition, recorded so it is still watched. */
export function envelopeOf(wf) {
  const pick = f => Object.fromEntries([...(wf.nodes || [])].sort((a, b) => (a.name < b.name ? -1 : 1))
    .map(n => [n.name, f(n)]).filter(([, v]) => v !== undefined && v !== null));
  return sortDeep({
    workflowId: wf.id ?? null,
    positions: pick(n => n.position),
    nodeIds: pick(n => n.id),
    webhookIds: pick(n => n.webhookId),
    credentialIds: pick(n => {
      const c = n.credentials || {};
      const ids = Object.fromEntries(Object.keys(c).sort().map(k => [k, c[k]?.id ?? null]));
      return Object.keys(ids).length ? ids : undefined;
    }),
    pinnedNodes: Object.keys(wf.pinData || {}).sort(),
    pinnedDataHash: wf.pinData ? sha(JSON.stringify(sortDeep(wf.pinData))) : null,
    tags: (wf.tags || []).map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean).sort(),
  });
}

export const fingerprint  = obj => `${ALGORITHM}-${sha(JSON.stringify(obj))}`;
export const short        = fp  => fp.slice(ALGORITHM.length + 1, ALGORITHM.length + 13);
/** Per node, so a drift report names the node that moved, not just the workflow. */
export const nodeFingerprints = canon =>
  Object.fromEntries(Object.entries(canon.nodes).map(([k, v]) => [k, sha(JSON.stringify(v)).slice(0, 12)]));

/* CLI: fingerprint a JSON file holding one workflow as the API returns it. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) { console.error('usage: fingerprint.mjs <workflow.json>'); process.exit(3); }
  let wf;
  try { wf = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { console.error(`cannot read ${path}: ${e.message}`); process.exit(3); }
  /* Accept either a raw API object or a committed export, which nests it. */
  const src = wf.definition && wf.nexus_export ? null : wf;
  let canon, env;
  try {
    canon = src ? canonicalise(src) : wf.definition;
    env   = src ? envelopeOf(src)   : wf.envelope;
  } catch (e) { console.error(`cannot canonicalise: ${e.message}`); process.exit(3); }
  console.log(`definition  ${fingerprint(canon)}`);
  console.log(`envelope    ${fingerprint(env)}`);
  console.log(`nodes       ${Object.keys(canon.nodes).length}`);
  for (const [n, f] of Object.entries(nodeFingerprints(canon))) console.log(`  ${f}  ${n}`);
}
```

### 1.4.1 The algorithm was exercised, on this repository's own exports

Not asserted. The code block above was extracted verbatim and run against the
committed exports in this checkout on 8 September 2026. It fingerprinted **21 of
21** workflow files and refused the twenty-second, `n8n-workflows/_index.json`,
with `cannot canonicalise: workflow has no nodes array` — correct, it is a
catalogue, not a workflow.

Then twenty properties, against the 43-node `whatsapp_bdc_ai_agent.json`. Every
one held.

| mutation | `fp.definition` | |
|---|---|---|
| set `updatedAt`, `versionId`, `activeVersionId`, `active`, workflow `id` | unchanged | as designed |
| reverse the node array | unchanged | |
| move every node to `[999,999]` | unchanged | and `fp.envelope` **moved**, as designed |
| rewrite every node `id` and `webhookId` | unchanged | |
| rewrite every credential `id`, keep names | unchanged | |
| write `onError: null` where the key was absent | unchanged | |
| write `alwaysOutputData: false` where the key was absent | unchanged | |
| convert every `jsCode` body to CRLF | unchanged | |
| reverse the key order of every `parameters` object | unchanged | |
| add `pinData`, `staticData`, `tags` | unchanged | |
| set `maxTries: 99` on a node whose `retryOnFail` is off | unchanged | it does nothing there |
| `alwaysOutputData` off → on, one node | **moved** | the `slack-command` field |
| `retryOnFail` off → on, one node (`WAHA Webhook (POST)`) | **moved** | |
| `maxTries` 3 → 99 on a node that *is* retrying | **moved** | |
| webhook `path` → `…/:key` | **moved** | the defect that shipped |
| rebind one credential to a different name | **moved** | |
| append four words to one node's `notes` | **moved** | |
| `settings.saveDataSuccessExecution` `none` → `all` | **moved** | |
| empty one connection output | **moved** | |
| rename one node | **moved** | |
| give two nodes the same name | **throws**: `two nodes are named "OpenRouter Chat Model" — cannot key by name` | refuses rather than silently dropping a node |

One incidental measurement, taken while writing that table: the 30 August export
of `BiyHk9ZXxJUVGbf6` carries `settings.saveDataSuccessExecution: "none"`, which
is the value `CLAUDE.md` warns about — "flip it to `"all"` for the rollout or
you will enforce blind". Whether it is still `none` on the box is unknown from
here.

Two properties worth stating plainly, because they are what make the thing
usable:

- **The committed export contains the canonical definition itself**, not just
  its hash. So `fp.definition` is recomputable offline from the committed file
  with no box and no credential — which is what the offline CI lane checks
  (§3.1), and what makes a change record's before/after pair verifiable by
  anyone reading the repository a year later.
- **The per-node table means a drift report names the node.** "Definition drift
  on `BiyHk9ZXxJUVGbf6`" is nearly useless on a 45-node workflow. "`Prefilter`
  `a1b2c3d4e5f6` → `9f8e7d6c5b4a`, everything else unchanged" is a diff you can
  act on.

### 1.5 The committed file

One file per workflow, at `n8n-workflows/live/<slug>.json`. A **new** directory:
the existing `n8n-workflows/*.json` are not overwritten (§6).

```json
{
  "nexus_export": 1,
  "fingerprint": {
    "definition": "nexusfp1-<64 hex>",
    "envelope":   "nexusfp1-<64 hex>",
    "algorithm":  "ops/n8n-fingerprint/fingerprint.mjs",
    "computed_at": "2026-09-08T00:00:00.000Z"
  },
  "identity":  { "id": "BiyHk9ZXxJUVGbf6", "name": "WhatsApp BDC AI Agent",
                 "instance": "https://35.224.126.225.nip.io" },
  "publication": { "active": true,
                   "versionId": "…", "activeVersionId": "…",
                   "versionId_equals_activeVersionId": true,
                   "updatedAt": "…", "fetched_at": "…" },
  "node_fingerprints": { "Prefilter": "a1b2c3d4e5f6", "…": "…" },
  "envelope":   { "positions": {}, "nodeIds": {}, "webhookIds": {},
                  "credentialIds": {}, "pinnedNodes": [], "pinnedDataHash": null, "tags": [] },
  "definition": { "algorithm": "nexusfp1", "name": "…", "settings": {},
                  "nodes": {}, "connections": {} }
}
```

Plus one manifest, `n8n-workflows/live/_manifest.json`, written by the same run:
every workflow id the box returned, its name, its slug, its two fingerprints,
`active`, and whether it has a file. **Ids on the box with no file are an entry
in the manifest with `"file": null`** — visible, not skipped. That is the
failure mode of `scripts/export-live-workflows.mjs`, which prints unmapped ids
as a closing log line and exits 0 (defect 8).

### 1.6 What the fingerprint MISSES

This is the section to read twice. A fingerprint is an identity, not a test, and
this one is an identity of one JSON document out of a system with at least six
other moving parts.

1. **Everything outside the workflow definition.** Credential *values*,
   environment variables on the VM, the compose file, Redis, the reverse proxy,
   WAHA's own configuration. The WAHA gate day was lost to
   `WAHA_WEBHOOK_SECRET` differing between the `n8n` and `n8n-worker`
   containers; the workflow definition was correct throughout and its
   fingerprint would not have moved by one bit. `CLAUDE.md`: "The verification
   and the defect were in different containers." **Any change record touching a
   Code node that reads `$env` must carry the `n8n-worker` fingerprint of that
   variable, because this hash cannot.**
2. **Execution order between parallel branches.** Node `position` is normalised
   away, and under `executionOrder: "v1"` the run order of sibling branches from
   one output is decided by canvas position (**asserted** — n8n's documented v1
   behaviour, not measured on this box). Dragging a node can therefore change
   what runs first without moving `fp.definition`. It moves `fp.envelope`, which
   is reported and does not fail. If that ordering ever becomes load-bearing,
   the fix is to make it explicit in the graph, not to hash pixel coordinates.
3. **Which credential, among several of the same name.** Only the credential
   name is hashed. Two credentials both called `Supabase account` are
   indistinguishable to `fp.definition`; the ids are in the envelope, so the
   change is visible but not blocking.
4. **Whether the workflow is published or active.** Deliberately in
   `publication`, asserted rather than hashed (§2.2). A definition that matches
   perfectly while `active: false` is a workflow that is not running, and only
   the assertion catches that. `ops/evidence/v1-closure-n8n.md` records two
   workflows sitting at `activeVersionId: null` for weeks while
   `workflow_registry` claimed `is_active = true`.
5. **Whether it works.** A matching fingerprint says the definition is the one
   recorded. It says nothing about whether the endpoint answers, whether the
   credential is still valid, or whether the downstream RPC exists. Evidence of
   function is a separate, mandatory section of the change record (§5).
6. **Other workflows.** A sub-workflow invoked by `executeWorkflow`, and the
   `errorWorkflow` in `settings` — `iYJkh1kztWxZXDbT`, the NEXUS Error Handler,
   which is the thing that turns a thrown alarm into an `audit_log` row — are
   separate ids with separate fingerprints. Changing the callee does not move
   the caller's hash. Mitigation: the export is **manifest-driven over every
   workflow on the box**, so the callee has its own row; and the change record
   must name every referenced workflow id.
7. **The other n8n.** `n8n-workflows/backup/README.md` records a second n8n,
   with its own Postgres, its own credentials and its own schedules, running on
   `desktop-l3an0ma` and posting into production as recently as 06:07:40 UTC on
   8 September 2026, stopped by hand at 06:08:24 UTC and **not removed**
   (`restart: always` still declared). A fingerprint of the GCP box says
   precisely nothing about it. `identity.instance` is in every file so that no
   export can ever be silently about the wrong box.
8. **Line endings.** Deliberate; see §1.3.
9. **`staticData`.** Runtime counters live there and change on their own.
   Neither hashed nor committed, so a change to them is invisible here.
10. **The registered webhook URL when the path carries a parameter.**
    `build-sdk.js:48-51` records that n8n registers a path-parameter webhook
    under an internal `webhookId` prefix, so the clean URL 404s. The `path`
    parameter is hashed; the resulting public URL is not derivable from the hash
    alone.
11. **Anything archived or deleted.** A workflow removed from the box vanishes
    from the manifest. That is a drift finding (an id the repo has a file for is
    gone), not a silent success — but a workflow that never had a file and was
    deleted before the first run of this process leaves no trace anywhere.
12. **Unicode form.** No NFC normalisation. Two visually identical strings in
    different composition forms hash differently. That is honest and noisy, and
    the noise has never been observed here.

---

## 2. The export process

### 2.1 Endpoints

All against `https://35.224.126.225.nip.io`, the base URL already hard-coded as
the default in `scripts/export-live-workflows.mjs:33` and `scripts/deploy_n8n.js:12`.
Authentication is the `X-N8N-API-KEY` header, as used at
`scripts/export-live-workflows.mjs:63` and `docs/J1-RUN-CHECKLIST.md:29`.

| Step | Request | Purpose |
|---|---|---|
| 1 | `GET /api/v1/workflows?limit=250` (follow `nextCursor` until exhausted) | **Discover the manifest.** Never a hand-maintained id list. |
| 2 | `GET /api/v1/workflows/{id}` for every id returned | The full definition, plus `versionId`, `activeVersionId`, `active`, `updatedAt`. |
| 3 | `GET /rest/settings` — **optional, recorded, not required** | `executionMode`. `CLAUDE.md` records this returning `"queue"`. It is on a different auth scheme (browser session, not the API key), so the exporter records "not read" rather than failing when it cannot. |

`limit=200` in the current script is a fixed page with no cursor follow; with the
box at 21+ workflows that is fine today and is a silent truncation the day it is
not. Follow the cursor.

### 2.2 Published, not draft — the assertion that makes the export honest

The house rule is already written: "**n8n edits stay in draft until published.**
Verify against the *published* version by fetching it back, not against your
draft" (`CLAUDE.md`), and
`ops/n8n-bundle-NOT-DEPLOYED/05-publish-infra-health-probe-NOT-DEPLOYED.md:63-64`:
"**version back** and confirm `activeVersionId` is no longer `null` and equals
`versionId`. Verify against the published version, not the draft."

`GET /api/v1/workflows/{id}` returns the **current** definition, which is the
draft when a draft exists (**asserted** — this is how every record in this repo
reads it; there is no endpoint in use here that fetches a named version by id).
So the exporter does not get to choose; it has to *test*:

```
published  ⇔  active === true  AND  activeVersionId  AND  versionId === activeVersionId
```

- **Published** → export it, `publication.versionId_equals_activeVersionId: true`.
- **Unpublished draft in front of a published version**
  (`versionId !== activeVersionId`) → **refuse to write the definition.** Write
  the file with `definition: null`, `refused: "draft_in_front_of_published"`,
  and both version ids. The whole point of the export is reproducibility of what
  *runs*; recording a draft as if it ran is the exact mistake that produced the
  retracted `slack-command` claim, one layer up.
- **Never published** (`activeVersionId: null`, `active: false`) → export it with
  `publication.active: false` and `never_published: true`. This state is real and
  must be visible: `JOURNEYS.md:52` counts two such workflows, and
  `VERSIONS.md:129` records `workflow_registry` claiming `is_active = true` about
  one of them.

The manifest carries the count of each, and the drift check fails on any refusal.

### 2.3 Credentials, and how no secret is committed

Three separate mechanisms, in order of how much they are relied on.

**1. n8n does not return credential secrets on the workflow endpoint.** Measured
in this checkout: every `credentials` block across all 22 committed export files
holds exactly `{ id, name }` and nothing else — six distinct entries
(`supabaseApi`, `slackApi`, `gmailOAuth2`, `openRouterApi`, `groqApi`,
`httpQueryAuth`). This is the mechanism that does the work, and it is **not**
relied on alone.

**2. The export refuses on a hit; it does not redact.** Before writing anything,
the exporter runs the exact `PATTERNS` list from `ops/ci/secret-scan.mjs` over
the serialised canonical form, with the same JWT rule: decode the payload, read
`role`, allow **only** `anon`, fail on anything else *and* on any token it
cannot classify. On a hit it writes no `definition` — it writes
`refused: "credential_material_in_parameters"` plus the node name and the
parameter path, and exits non-zero.

Refusal rather than redaction, deliberately: a redacted export is no longer the
thing the box runs, so the drift check would report a permanent difference and
someone would learn to ignore it. A refusal is loud, and it is also the correct
signal — a secret hand-typed into a node parameter is a live incident, not a
formatting problem.

**3. Nothing else is fetched.** `GET /api/v1/credentials` is not called. There is
no reason to, and the endpoint that could return credential data must not be in
this path at all.

### 2.4 The secret scan would pass — measured, not assumed

`ops/ci/secret-scan.mjs` is what would judge the committed exports. Run its six
patterns over `n8n-workflows/` in this checkout:

| pattern | hits |
|---|---:|
| `sb_secret_[A-Za-z0-9_-]{12,}` | 0 |
| `sk-or-v1-[A-Za-z0-9]{16,}` | 0 |
| `apify_api_[A-Za-z0-9]{16,}` | 0 |
| `xox[baprs]-[A-Za-z0-9-]{10,}` | 0 |
| `ghp_[A-Za-z0-9]{20,}` | 0 |
| `eyJhbGciOi[A-Za-z0-9._-]{30,}` | present in **10** files |

Every JWT hit decodes to one single distinct token:

```json
{"iss":"supabase","ref":"dsvuoovivysszdoiorch","role":"anon","iat":1783758435,"exp":2099334435}
```

`role` is `anon`, so `secret-scan.mjs` classifies it ALLOWED and reports it by
name — "Allowed by role claim, not by filename." The largest committed export is
`whatsapp_bdc_ai_agent.json` at **100,193 bytes**, two orders of magnitude below
the scan's `MAX_BYTES` of 8 MiB, so no export file is skipped as oversized. The
scan's `skippedBig` counter is worth watching anyway: a file it skips is a file
it did not judge, and a 100 KB export growing is not implausible.

A re-export under this process produces the same shape — same anon key, same
credential `{id,name}` references, more files — so it passes for the same
measured reason it passes today. That is a prediction with a stated basis, and
the exporter's own refusal pass (§2.3) is what makes it not merely a prediction.

---

## 3. The drift check

Two lanes, because one of them must never hold a credential.

### 3.1 Lane A — offline, every pull request, no credential

`node ops/n8n-fingerprint/verify-exports.mjs`. Runs on forks. Detects nothing
about the box, and says so in its own output. It checks:

- every file under `n8n-workflows/live/` recomputes to the `fp.definition` and
  `fp.envelope` it records — the committed canonical form and the committed hash
  agree;
- `node_fingerprints` agrees with `definition.nodes`;
- the manifest and the files agree in both directions;
- no file carries a `refused` marker;
- `publication.versionId_equals_activeVersionId` is `true` for every `active`
  workflow;
- every fingerprint quoted in a change record under
  `ops/n8n-fingerprint/changes/` resolves to a real commit of a real file;
- the algorithm prefix is `nexusfp1`.

This is the lane that stops a hand-edited export. It cannot stop drift.

### 3.2 Lane B — online, scheduled, never on a pull request

`node ops/n8n-fingerprint/drift-check.mjs`. Fetches the manifest and every
workflow, canonicalises, compares against the committed files.

**Authentication.** `X-N8N-API-KEY`, from `N8N_API_KEY`, held in a GitHub
**Environment** secret, not a repository secret. The constraint is already
written into this repository's CI and is not negotiable —
`.github/workflows/ci.yml`:

> CI holds no `NEXUS_DB_URL`, no service-role key and **no n8n API key**, and it
> must not: a pull request from a fork would then execute arbitrary code holding
> this dealership's database.

So Lane B is a **separate workflow file** with `on: schedule` and
`workflow_dispatch` only. It never triggers on `pull_request`, it checks out
`main`, and it runs no code that a pull request can modify. Its first executable
statement is a guard that exits 3 if `GITHUB_EVENT_NAME` is `pull_request` or if
`GITHUB_REF` is not `refs/heads/main` — belt and braces, because the cost of
being wrong is a fork holding an n8n API key.

**An n8n API key cannot be made read-only** (**asserted** — it carries its
user's permissions). So the key Lane B holds can also write. Three mitigations,
all of which are admissions rather than fixes: the environment is unreachable
from a fork PR; the key is rotated on a schedule and its rotation is a change
record like any other; and the drift check performs `GET` only, which is a
property of the script, not of the credential.

**What it does when the box is unreachable.** This is the part that matters, and
the rule is one sentence: **a check that cannot reach the box must fail, and must
say what it did not compare.** Exit codes follow `ops/ci/*.mjs` — `0` clean,
`1` findings, `3` could not run — and the CI job carries **no**
`continue-on-error` and **no** `if: always()` that would swallow it.

| condition | verdict | why |
|---|---|---|
| DNS failure, TLS failure, connection refused, timeout | **exit 3**, job red | Nothing was compared. A green tick here would be a lie about the one fact the check exists to establish. |
| HTTP 401 / 403 | **exit 3**, job red, message names the key | A credential problem, not a clean box. |
| HTTP 5xx from the box | **exit 3**, job red | Same. |
| Manifest fetched, one workflow's `GET` fails | **exit 3** for that id, red | Partial comparison is reported as partial, never rounded up. |
| Manifest fetched, an id the repo has a file for is **404 / absent** | **exit 1** | Deleted or archived on the box. A finding, not an outage. |
| An id on the box has no file in the repo | **exit 1** | The `FILE_MAP` failure (defect 8) turned into a hard failure. |
| `fp.definition` differs | **exit 1**, report names the nodes whose per-node hash moved | The point of the whole exercise. |
| `fp.envelope` differs, definition identical | **exit 0 with a WARNING block** | Positions, credential ids, pinned data, tags. Reported by name, never fatal. |
| `versionId !== activeVersionId` on the box | **exit 1** | Somebody is holding an unpublished draft on production. |
| `active` differs from the committed file | **exit 1** | The `activeVersionId: null` / `is_active = true` disagreement, caught mechanically. |

Every run prints, in this repository's house style, a `RAN` line per check made
and a **`NOT RUN`** line naming, individually, every check it did not make — the
pattern `QUALITY_GATE.mjs --no-db` already uses to print "by name the seventeen
launch-critical checks it therefore did not make"
(`.github/workflows/ci.yml`). A drift report with an empty `NOT RUN` section is
the only kind that means "nothing has drifted".

```yaml
# .github/workflows/n8n-drift.yml — PROPOSED, not added.
name: n8n drift
on:
  schedule:    [{ cron: '17 */6 * * *' }]   # four times a day, off the hour
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: n8n-drift            # never two of these against one small box
  cancel-in-progress: false
jobs:
  drift:
    runs-on: ubuntu-latest
    environment: n8n-readonly       # a fork PR cannot reach this
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with: { ref: main }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - name: Refuse to run anywhere but a scheduled/dispatched run on main
        run: |
          test "$GITHUB_EVENT_NAME" != "pull_request" || exit 3
          test "$GITHUB_REF" = "refs/heads/main" || exit 3
      - name: Compare the committed exports against the live box
        env:
          N8N_API_KEY:  ${{ secrets.N8N_API_KEY }}
          N8N_BASE_URL: https://35.224.126.225.nip.io
        run: node ops/n8n-fingerprint/drift-check.mjs --report "$RUNNER_TEMP/drift.md"
        # No continue-on-error. Unreachable is exit 3 and exit 3 is red.
      - name: Keep the report
        if: always()
        uses: actions/upload-artifact@v4
        with: { name: n8n-drift-report, path: ${{ runner.temp }}/drift.md, if-no-files-found: ignore }
```

The comparison itself, once the fetch has succeeded:

```js
/* ops/n8n-fingerprint/drift-check.mjs — the comparison, less the plumbing. */
import { canonicalise, envelopeOf, fingerprint, nodeFingerprints, short } from './fingerprint.mjs';

function compare(committed, live) {
  const canon = canonicalise(live), env = envelopeOf(live);
  const out = { id: live.id, name: live.name, findings: [], warnings: [] };

  if (live.active && live.versionId !== live.activeVersionId)
    out.findings.push(`an unpublished draft is in front of the published version ` +
      `(versionId ${live.versionId} != activeVersionId ${live.activeVersionId}). ` +
      `Nothing below describes what is running.`);
  if (!!live.active !== !!committed.publication.active)
    out.findings.push(`active is ${live.active} on the box, ${committed.publication.active} in the repo`);

  const fpLive = fingerprint(canon);
  if (fpLive !== committed.fingerprint.definition) {
    const now = nodeFingerprints(canon), was = committed.node_fingerprints || {};
    const moved  = Object.keys(now).filter(n => was[n] && was[n] !== now[n]);
    const added  = Object.keys(now).filter(n => !(n in was));
    const gone   = Object.keys(was).filter(n => !(n in now));
    out.findings.push(`definition ${short(committed.fingerprint.definition)} -> ${short(fpLive)}` +
      (moved.length ? `; changed: ${moved.join(', ')}` : '') +
      (added.length ? `; added: ${added.join(', ')}` : '') +
      (gone.length  ? `; removed: ${gone.join(', ')}` : '') +
      /* Same nodes, different hash, and no node moved: it is the settings or
         the wiring. Say so rather than leaving the reader to guess. */
      (!moved.length && !added.length && !gone.length
        ? '; every node is unchanged, so the difference is in settings or connections' : ''));
  }

  const fpEnvLive = fingerprint(env);
  if (fpEnvLive !== committed.fingerprint.envelope)
    out.warnings.push(`envelope ${short(committed.fingerprint.envelope)} -> ${short(fpEnvLive)} ` +
      `(positions, node ids, webhook ids, credential ids, pinned data or tags). ` +
      `Not a definition change. Node position decides parallel-branch order under ` +
      `executionOrder v1, so read it before dismissing it.`);
  return out;
}
```

### 3.3 What the drift check can and cannot detect

**Can:** a definition edited on the box and not exported; an export edited in the
repo and not on the box; a workflow deactivated, deleted or archived; an
unpublished draft sitting in front of production; a workflow published on the box
that the repo has never heard of; a node added, removed or renamed; a changed
webhook path, credential binding, `retryOnFail`, `onError`, `alwaysOutputData`,
`jsCode`, expression or node comment — every field defect 3 says the SDK
round-trip cannot see.

**Cannot:** everything in §1.6. In particular it cannot see the VM's environment,
cannot see which container reads it, cannot see the second n8n on
`desktop-l3an0ma`, cannot tell you the workflow works, and cannot see a change
made and reverted between two runs — with a six-hour schedule, a change that
lives for an hour is invisible. Reducing the interval costs the box CPU; this
project already records it as a CPU-starved `e2-micro` frozen for 23 hours by
four zombie executions. Four times a day is a judgement, and the failure mode of
that judgement is stated here rather than left to be discovered.

---

## 4. One writer, as a mechanism

### 4.1 What was chosen, and why

**A lock file committed to `main`: `ops/n8n-fingerprint/BOX-LOCK.json`.**

The atomicity is not in the file; it is in `git push`. Two agents cannot both
create the same file on `main` from the same base commit — the second push is
rejected as non-fast-forward. That is a real compare-and-swap, over a mechanism
every agent here already uses, needing no new service, no database key, and no
access to the box in order to *release* the lock. The last property decides it:
a lock that lives on the box cannot be released when the box is the thing that
has fallen over, and this box has fallen over twice for exactly this reason.

Rejected, with reasons:

- **A tag on the n8n instance.** Visible in the UI where the writing happens,
  which is genuinely attractive. But claiming the lock would itself be a write to
  the box, an unreachable box would be unlockable, and it leaves no history.
- **A row in Supabase.** Real atomicity via a unique index and a real TTL. But CI
  holds no database credential and must not (`.github/workflows/ci.yml`), the
  history would live outside the repository, and it adds a dependency on the
  system whose outage is one of the things an agent may be on the box to fix.
- **A tag on the box mirrored from the file.** Two mechanisms, twice the ways to
  disagree. Rejected as friction; a rule nobody follows protects nothing.

### 4.2 The file

```json
{
  "held": true,
  "holder": "the agent or person, named exactly as they sign the change record",
  "instance": "https://35.224.126.225.nip.io",
  "claimed_at": "2026-09-08T14:11:00Z",
  "expires_at": "2026-09-08T16:11:00Z",
  "intent": "publish the WAHA secret rollout — ops/n8n-bundle-NOT-DEPLOYED/07-…",
  "workflows": ["BiyHk9ZXxJUVGbf6"],
  "change_record": "ops/n8n-fingerprint/changes/2026-09-08-waha-secret.md",
  "released_at": null,
  "broken_by": null,
  "broken_because": null
}
```

When nobody holds it: `{"held": false, "holder": null, …}` and the previous
holder's fields cleared. The file is never deleted — its git history is the
record of who has been on the box and when, which is the thing
`ops/evidence/v1-closure-n8n.md:3` currently asserts in prose ("Sole agent on the
production n8n box … for the duration") and nothing checks.

### 4.3 Claim, release, expiry, death

**Claim.** Read the file on `main`. If `held` is true and `expires_at` is in the
future, you do not have the box — stop. Otherwise set the fields, commit
`claim n8n box: <intent>`, and **push to `main` directly**. A rejected push means
somebody claimed it between your read and your write; re-read and stop. The push
succeeding is the claim. A default lease of **2 hours**, never longer than 8.

**Release.** Set `held: false`, `released_at`, leave `holder` in the history,
commit `release n8n box: <one-line outcome>`, push. Releasing is a precondition
of the change record being complete, and the offline CI lane (§3.1) fails a
change record whose lock claim has no matching release.

**Expiry.** `expires_at` is advisory and it is enough. Once it passes, the next
agent may take the lock, but only by filling in `broken_by` and
`broken_because` in the same commit that claims it. So a broken lease is never
silent, is always attributable, and always states what the breaker believed about
the previous holder. Extending your own lease is a commit too.

**If an agent dies holding it.** The lease expires, someone breaks it on the
record, and then — before writing anything — runs the drift check against the
box. A dead holder may have left a published change, an unpublished draft, or
nothing; `versionId !== activeVersionId` is exactly the signal that tells the
three apart, and §3.2 already makes it a hard finding. The breaker also runs the
zombie-execution check `JOURNEYS.md:2102` requires: four stuck executions held
four of five concurrency slots for 23 hours on 28 August, and an agent that died
mid-write is a plausible source of one.

### 4.4 What it does not prevent

Stated plainly, because a lock presented as a guarantee is worse than no lock.

- **It is advisory.** The box does not know it exists. Anyone with the n8n UI or
  the API key can write while another agent holds the lock, and nothing will stop
  them. It converts an unattributable collision into an attributable one.
- **It does not cover the owner.** The owner is on the box, by SSH and by the UI,
  and will not be filing lock commits. The drift check is what catches an
  unrecorded owner change — which is a feature: `versionId != activeVersionId`
  and a moved fingerprint say "somebody changed something" regardless of who.
- **It does not cover `.env` on the VM, `docker compose`, WAHA, or the second
  n8n.** It locks a definition surface, not a machine. The queue-mode incident
  happened entirely outside anything this lock can see.
- **It does not survive a force-push to `main`**, and it presumes every agent
  pushes lock commits to `main` rather than to a branch. A lock on a branch is
  not a lock.
- **It does not serialise reads**, and should not — the whole point of the house
  rule is that inspection parallelises.
- **A lease that expires does not mean the holder stopped.** It means the lease
  expired. That is why breaking one requires writing down what you believe and
  why.

---

## 5. The change record

One file per change, `ops/n8n-fingerprint/changes/YYYY-MM-DD-<slug>.md`, committed
in the same push as the re-exported workflow file. A change with no record, or a
record with no export, is an incomplete change.

```markdown
# <workflow name> — <one line: what changed> — <date>

| | |
|---|---|
| Workflow | `<name>` — `<id>` |
| Instance | `https://35.224.126.225.nip.io` |
| Changed by | `<holder>` |
| Lock claimed | `<commit sha>` — `<claimed_at>` |
| Lock released | `<commit sha>` — `<released_at>` |
| Export commit | `<commit sha>` of `n8n-workflows/live/<slug>.json` |

## What changed

Node by node. One row per node whose per-node fingerprint moved, plus a row for
`settings` or `connections` if the workflow hash moved with no node moving.

| node | before | after | what |
|---|---|---|---|
| `Prefilter` | `a1b2c3d4e5f6` | `9f8e7d6c5b4a` | added `(!!payload.id \|\| !!payload.timestamp)` to `is_real_inbound` |

## Fingerprints

| | before | after |
|---|---|---|
| `fp.definition` | `nexusfp1-<12>…` | `nexusfp1-<12>…` |
| `fp.envelope`   | `nexusfp1-<12>…` | `nexusfp1-<12>…` |

Full 64-hex values are in the committed export at the two commits named above.

## Publication

    before  active=<t/f>  activeVersionId=<uuid|null>
    publish -> activeVersionId=<uuid>
    fetch back: active=<t/f>, versionId == activeVersionId == <uuid>

Verified against the **published** version by fetching it back, not against the
draft.

## Rollback

- **Restore to** `activeVersionId <uuid>`, `fp.definition nexusfp1-<12>…`, which
  is the committed export at commit `<sha>`.
- **How:** <the exact steps — n8n's own version history, or re-import from the
  committed canonical form, stated explicitly>.
- **Time to roll back:** <measured or estimated, and which>.
- **What rollback does NOT restore:** environment variables on the VM,
  credential values, `staticData` counters, anything the caller has already
  been told, and any row already written. Name them for this change specifically.

## Evidence it works

Execution ids with statuses, or the measured HTTP responses, or the rows written
— whatever this change's claim actually rests on. A positive control as well as
the refusals: three items designed to be refused prove nothing about the path
that must still work.

## What this change does NOT do

<the limits, in the author's own words>

## What was NOT run

<named, individually>
```

Two fields are non-optional because their absence is what the process exists to
prevent: **the before fingerprint** (without it there is no rollback target) and
**"What was NOT run"** (without it a partial verification reads as a complete
one).

---

## 6. The existing artefacts, reconciled

Nothing here is deleted. Each verdict is a proposal.

### `n8n-workflows/*.json` — 22 files, a 30 August export

**What it is for after this process exists: nothing. It becomes historical.**
Every file carries `_exported_from.updatedAt` no later than
`2026-08-30T17:59:08.838Z`; it holds zero occurrences of `tenant_id`; it is
missing all three receivers published on 7 September; and its BDC file has 43
nodes where the box had 45 on 4 September. It has already produced one retracted
claim.

**Proposed:** do not regenerate in place, and do not delete. Move the 22 files to
`n8n-workflows/2026-08-30-export/` and add a README in the shape of
`n8n-workflows/backup/README.md` — what they are, the date, and the sentence
"these are evidence about 30 August 2026 and about nothing else". Fresh exports
go to the new `n8n-workflows/live/`. Two reasons not to overwrite: the old
filenames are cited by path across the repository (`WAHA-EXIT-PLAN.md:59` cites
`n8n-workflows/nexus_infra_health_probe.json:32`), and overwriting destroys the
only record of what 30 August looked like — the same argument
`n8n-workflows/backup/README.md` already makes for its own contents.

### `n8n-workflows/backup/` — 11 files, ~31 August, pre-GCP topology

**Unchanged. Historical, and correctly labelled already.** Its README is the
model this document borrows from: it explains that the files describe the
`desktop-l3an0ma` Tailscale topology, that `whatsapp_bdc.json:177` points at
`https://desktop-l3an0ma.tail2141f7.ts.net/webhook/lead-escalation`, that the
files are "deliberately left byte-identical to the export", and that two
migrations cite `dynamic_pricing.json` by path as a recorded measurement.

**Proposed:** leave every byte alone. Add one line to its README pointing at this
document, and add these eleven files to an explicit deny-list in whatever ever
imports (§6, `import_n8n_workflows.py`).

### `n8n-workflows/_pre_sync_backup/` — 12 files, ~31 August

Not mentioned in `backup/README.md` and not cited anywhere I can find. Same
eleven names as `backup/` plus `ask_ai_rag.json`. **Proposed:** treat exactly as
`backup/` — historical, never re-imported — and say so in a two-line README
rather than leaving a directory whose status has to be guessed. Would delete
nothing.

### `ops/n8n-google-lead-form/` — SDK source, build script, node bodies, tests

**Keep. This is the good pattern, and it needs one addition.** `build-sdk.js`
generates the SDK from the two node body files and round-trips them so nothing is
retyped. Its own comment names the gap: the check covers the two Code bodies
"and nothing around them, so a wrong path, credential or retry setting in this
scaffolding is invisible to it", and that gap shipped `google-ads-lead/:key`.

**Proposed:** after this process exists, `build-sdk.js` gains a third check —
compare the generated workflow's canonical form against
`n8n-workflows/live/google-ads-lead-form-receiver.json`'s `definition` and refuse
on divergence. That closes the scaffolding gap with the same mechanism that
covers everything else, and the file's closing line — "refusing to claim the repo
matches the box" — becomes true of the whole workflow instead of two strings.

### `ops/n8n-whatsapp-cloud/` — a divergence, measured today

`verify-or-refuse.node.js` opens: "The exact body of the `Verify Or Refuse` Code
node in the n8n workflow … (`J8MXprxVw1yhjBpp`), kept here so the repo holds what
the box runs." `receiver.sdk.js` in the same directory inlines a `jsCode` array
that claims to be the same node. **They are not the same text.** Measured: the
SDK's inlined body is **144 literal lines / 6,272 bytes**; the node file is
**223 lines / 10,987 bytes**; they differ from the first character. There is no
`build-sdk.js` in this directory, so nothing generates one from the other and
nothing checks them.

**Proposed:** keep both, add the build script, and **let the box decide which is
right** — fetch `J8MXprxVw1yhjBpp`, and whichever file disagrees with the
published `jsCode` is the one that is wrong. Until that fetch happens this
document does not claim to know which. Same for `ops/n8n-meta-lead-ads/` and
`ops/n8n-waha-gate/`, which hold node bodies with no SDK and no generator at all.

### `ops/n8n-bundle-NOT-DEPLOYED/` — 15 files: 11 numbered change sheets, plus README, PRECONDITIONS, VERIFY and one evidence file

**Keep as-is; it is the change-record format's direct ancestor.** Its files
already carry workflow id, `versionId == activeVersionId`, before/after,
rollback, and a preconditions document. It is the queue of intended changes; this
document is the record of executed ones.

**Proposed:** when one of these is executed, it produces a file under
`ops/n8n-fingerprint/changes/` and the bundle file gets a one-line "deployed, see
…" header. The `-NOT-DEPLOYED` suffix stays on everything else, and
`README.md:159`'s one-agent bullet gains a pointer to §4.

### `scripts/export-live-workflows.mjs`

**Superseded. Do not run it, do not delete it yet.** Three defects, all measured:
its `FILE_MAP` covers 13 of the 21+ workflows and skips the rest with a log line;
its `normalise()` drops only `webhookId` and keeps `id` — so `updatedAt` and
`versionId` never reach the file but nothing asserts the definition is the
published one; and it writes filenames (`nexus_master_router.json`,
`whatsapp_bdc.json`, …) that do not currently exist in `n8n-workflows/` but do
exist in `backup/` and `_pre_sync_backup/`. Running it would leave 13 new files
beside 22 old ones describing the same box at two different times.

**Proposed:** replace with `ops/n8n-fingerprint/export-live.mjs` (manifest-driven,
publication-asserted, fingerprinted, secret-refusing). Keep the old file with a
header pointing at the replacement for one release, then delete — it would be
deleted, not left, because a working-looking export script beside a real one is
exactly how someone re-materialises the stale filenames by accident.

### Two writers nobody has mentioned

`import_n8n_workflows.py` at the repository root imports eight named files from
`n8n-workflows/`. **All eight names resolve to nothing there today** — the only
files with those names live in `backup/`, the directory whose README says "do NOT
re-import" and whose `whatsapp_bdc.json:177` posts to `desktop-l3an0ma`. It is
inert only because the paths miss. **Running
`scripts/export-live-workflows.mjs` would materialise exactly those eight
filenames in exactly that directory and arm it.** It dedupes by workflow *name*,
so the realistic damage is duplicate workflows rather than overwritten ones.

`safe_import.sh` is worse and is four lines: it imports every JSON in
`/tmp/n8n-workflows/` into the container and then **publishes every workflow id
the box returns**, in a loop, with no filter. On a box carrying two
never-published workflows and one deliberately-unpublished one, that is a
mass-publish of things that were unpublished on purpose.

**Proposed:** point both at `n8n-workflows/live/`, make both refuse to run unless
`BOX-LOCK.json` names the caller, and delete `safe_import.sh`'s publish loop
outright. Neither is touched by this document.

---

## 7. What this process costs

Honestly, so the answer to "is it used" is not decided later by surprise.

Per change: one lock commit, one release commit, one re-export (seconds), one
change record (the expensive part — it is the evidence section, and that work is
already required by the house rules). Per day: four scheduled fetches of ~24
workflows against a CPU-starved `e2-micro`; a `GET` per workflow, no execution.
Per pull request: a few hundred milliseconds of offline hashing.

The thing it does not cost is a new service, a new credential in PR CI, or a
dependency on the box being up in order to release a lock.

---

## Unknowns

1. **Whether `GET /api/v1/workflows/{id}` returns the draft or the published
   definition when the two differ.** Every record in this repository reads it as
   the current definition and tests `versionId === activeVersionId` to find out
   which it got. This document does the same. **Not measured from here** — no
   n8n API endpoint that fetches a named version by id is used anywhere in this
   repo, and if one exists it would be strictly better than the assertion.
2. **Whether publishing an unchanged draft mints a new `versionId`.** If it does,
   a no-op republish moves `publication` and not `fp.definition`, which is the
   intended behaviour but has not been observed.
3. **Whether n8n forbids two nodes sharing a name.** `canonicalise()` throws if it
   sees it. If n8n permits it, keying by name is wrong and the algorithm needs a
   different key.
4. **Whether `pinData` can affect a production execution** in the n8n version on
   this box. Excluded from the definition on the documented behaviour that it
   affects manual runs only. If that is wrong, it belongs in `fp.definition`.
5. **The n8n version and API surface on the box.** Not recorded anywhere in this
   repository that I could find, and `docker-compose.yml` versus
   `docker-compose.single.yml` is itself unsettled — `CLAUDE.md` states "The repo
   does not know which compose file is on the box, and said it did."
   Cursor-paginated listing, field names, and the `/rest/settings` shape all
   depend on it.
6. **Whether an n8n API key can be scoped read-only.** Assumed no. If yes, Lane B
   should hold a read-only key and this section shrinks.
7. **Which of `ops/n8n-whatsapp-cloud/receiver.sdk.js` and
   `verify-or-refuse.node.js` matches the published `J8MXprxVw1yhjBpp`.** Only
   the box can say. Neither was fetched.
8. **How many workflows are on the box today.** 21 measured on 4 September
   (`JOURNEYS.md:45`), plus three receivers published on 7 September, minus
   anything removed since. `README.md:190` says 18. The first run of the export
   settles it; nothing in this repository does.
9. **Whether the desktop instance is still capable of running.**
   `n8n-workflows/backup/README.md` records it stopped by hand on 8 September and
   **not** removed, with `restart: always` still declared and device 8 still
   linked. If it comes back, it is a second box publishing into production that
   no fingerprint in this process covers.
10. **Whether the four workflows that omit `tenant_id` are among the ones that
    would be exported first.** They are still unidentified — that is defect 1,
    and this process is what would identify them, not something it already has.
