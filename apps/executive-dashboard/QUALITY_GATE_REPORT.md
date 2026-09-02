# NEXUS OS — quality gate report

**Gate:** `apps/executive-dashboard/QUALITY_GATE.mjs`, rebuilt 2 September 2026.
**Run:** 2026-09-02, offline lanes only, in a container with no database credentials.
**Result: `exit 1` — 2 launch-critical checks FAILED, 14 could not run.**

Counts: **PASS 16 · FAIL 2 · WARN 1 · NOT RUN 14.**

> Both failures are the same defect reached from two directions, and it is a real
> one in the product, not a gate artefact. It is named in **Real defects** below.
> Nothing was downgraded, suppressed or exempted to reduce the count.

---

## 1. Why the old gate had to be rebuilt rather than patched

The previous gate produced false failures, and a gate that cries wolf gets
ignored on the day it is right. Three separate mechanisms:

1. **A hand-typed `SCHEMA` stub** that predated the Profit Sentinel, the Action
   Center and multi-tenancy. It knew 24 relations; the database has 36. It
   reported `v_conversations.msg_count`, `competitors.match_quality` and
   `v_competitor_latest` as non-existent. **All three exist** — verified against
   `information_schema.columns` on 2026-09-02 (evidence in §3).
2. **Two hand-typed constants about the product's own shape** — a 14-entry
   `SCREEN_IDS` missing `actions`, and a literal `r.nav === 14` against a
   `lib/nav.js` that has held fifteen entries since the Action Center landed.
3. **A build with no environment.** The gate ran `vite build` without
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, so `lib/env.js` raised a
   configuration error, `app.js` painted "Configuration problem" and returned
   before boot, and all fourteen screens were graded empty. That was recorded by
   a prior agent as *"the browser half needs credentials this environment does
   not have"*. **That diagnosis was wrong**, and it cost the only lane that
   renders anything. The browser lane now runs headless, offline, signed in.

The recurrence is the defect. Adding seven relations by hand would have bought
about a fortnight, so nothing in the gate is a hand-maintained list of what the
database contains any more.

---

## 2. How the schema is now self-updating

Three sources, in order of authority, with the gate stating which one it used:

| Source | Gives | When |
|---|---|---|
| `NEXUS_DB_URL` (psql) or `--catalogue file.json` | relations, columns, function bodies, ACLs, RLS, policies, `security_invoker`, live Sentinel and ledger state | full LIVE lane |
| `NEXUS_ENV` / `SUPABASE_URL` + service-role key | relations and columns, off PostgREST's own OpenAPI root | column map only |
| The `SNAPSHOT` block inside the gate | relations and columns, plus the recorded live baseline | offline fallback |

- `node QUALITY_GATE.mjs --refresh-schema` **rewrites the snapshot block inside
  `QUALITY_GATE.mjs` itself**, between two markers, from whichever live source is
  configured. Refreshing is one command, not an editing session.
- `--print-sql` emits the single catalogue query, so anyone with SQL access (a
  Supabase console, an MCP client, `psql`) can dump `cat.json` and hand it to
  `--catalogue`. **That query was executed against the live project at
  19:38:20 UTC on 2026-09-02** and returns a valid 91,369-byte JSON document —
  36 relations, 35 non-extension functions with bodies and ACLs, RLS state,
  policies, `security_invoker` state, 12 Sentinel rows and the ledger counts. The
  path is verified, not merely written down.
- `L1` compares the embedded snapshot against live every time the live lane runs
  and **fails** on drift, so a stale snapshot is itself a reported defect.
- The stub PostgREST that the render lane serves **fabricates its rows from the
  same map**, so a new column appears in the fixtures the moment it appears in
  the database.

**Offline, an unknown column is not a failure.** It is indistinguishable from a
stale snapshot, and treating it as a failure is exactly what produced the three
false failures. It is reported as `WARN` with the reason stated. With a live
catalogue the same finding is unambiguous and is a hard `FAIL`.

---

## 3. False failures removed, and the evidence each was false

| Claim by the old gate | Verdict | Evidence |
|---|---|---|
| `v_conversations.msg_count` does not exist | **FALSE** | `v_conversations` has 24 columns and `msg_count` is one of them, alongside `internal_count`, `msg_inbound_count`, `msg_outbound_count`, `last_msg_at`, `last_msg`, `last_msg_direction`, `awaiting_msg_reply` — the INV-004 message/marker split. Read from `information_schema.columns` 2026-09-02. |
| `competitors.match_quality` does not exist | **FALSE** | `competitors` has 16 columns including `listing_title`, `source_host`, `source_kind`, `offer_name`, `offer_condition`, `match_quality`, `match_note`, `tenant_id`. |
| `v_competitor_latest` does not exist | **FALSE** | It is a view in `public` with 15 columns. `pg_class.relkind = 'v'`. |
| Seven relations "missing" | **FALSE** | `v_inventory_profit_sentinel` (73 cols), `v_inventory_action_queue` (70), `inventory_actions` (46), `inventory_action_events`, `inventory_profit_settings`, `inventory_action_policy`, `inventory_action_reason_codes`, `tenants`, `tenant_members`, `v_inventory_action_timeline`, `v_fin_gate_quote_evidence` all exist. |
| `nav === 14` | **FALSE** | `lib/nav.js` declares 15: `overview, leads, conversations, compliance, inventory, competitors, ask, finance, customers, actions, campaigns, deals, automation, team, settings`. Rendered count now measured against the parsed list, so the two cannot disagree. |
| 14 of 14 screens fail; `loggedIn=false navItems=0` | **FALSE, and a gate bug** | With `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` supplied to the build and a well-formed stub JWT, the same code gives `loggedIn=true`, `navItems=15`, **15/15 screens rendering**, 0 page errors, 98 PostgREST calls, 0 rejected. |
| "No query the database would reject — none" | **VACUOUS, not false** | It printed clean on a run in which no screen ever executed a query, because the app never booted. `R3` now fails if fewer than 30 PostgREST calls were observed: a clean result is meaningless without the number of queries that produced it. |

Four more false positives were produced by the *new* checks during development
and removed before this run — each is documented in the gate at the line that
now prevents it:

- `dbWrite('POST', …)` had the HTTP verb captured as the relation name, inventing
  four missing tables (`POST`, `PATCH`, `DELETE`).
- `INSUFFICIENT` was reported unhandled because `screens/inventory.js` prints
  `enquiry_coverage` **verbatim** rather than branching on it. Printing the
  database's own word is handling it. Likewise `screens/overview.js` partitions
  `holding_cost_state` on `'COMPUTED'` — complement handling, which is stronger
  than naming each state because it stays correct when a new state appears.
- `ltvSub` in `screens/customers.js` was read as a loan-to-value derivation. It
  holds **lifetime** value, a different quantity the browser may sum; and the
  arithmetic test was matching the `/` of a closing HTML tag.
- `screens/actions.js` and `lib/deal-form.js` were reported as classifying audit
  statuses. `actions.js` compares `inventory_actions.status` — the action
  lifecycle, a different axis its own header is at pains to keep separate.
  `deal-form.js` compares `delivery.status` off the closed-won webhook's
  synchronous response — a receipt to the operator, not a stored audit row. Audit
  reads are now detected from the queries a file issues, not from prose inside a
  template literal.

Line numbers are now the reader's line numbers: comments are blanked rather than
deleted, so nothing is reported at the wrong line.

---

## 4. What the gate checks now

Three lanes, and the gate always says which one a result came from.

### Lane 1 — OFFLINE · source (no network, no credentials)

| ID | Check | Result |
|---|---|---|
| S1 | Navigation and screen registry agree — both parsed from `lib/nav.js`, no constant | **PASS** — 15 nav entries, 15 registered screens |
| S2 | Nobody reached outside the helper contract (`Math.random`, raw `fetch`, inline `<style>`, `localStorage`, remote import, `eval`) | **PASS** — 35 files, now including `lib/` and `app.js`, each banned construct with a named owner |
| S3 | Every query names a relation and columns that exist | **PASS** — 104 distinct paths, checked against the snapshot |
| S4 | No browser-side tenant scoping — no `tenant_id=eq.` filter, no write composing one | **PASS** |
| S5 | No zero substituted for an uncomputable economic figure | **PASS** — 6 unknownable figures across 35 files |
| S5b | Exposure totals coalesce a null impact to zero | **WARN** — see §6 |
| S6 | Every state the engine emits reaches the reader (literal, UNKNOWN-prefix guard, complement, or verbatim) | **PASS** |
| S7 | No invented or hard-coded market price | **PASS** |
| S8 | No finance figure computed by the browser or by a model | **PASS** |
| S9 | Exposure is never called recovery, and recovery names its sale | **FAIL** — §5 |
| S10 | One outcome vocabulary, and it is not the action lifecycle | **PASS** |

### Lane 2 — OFFLINE · rendered (headless Chromium, stubbed PostgREST)

| ID | Check | Result |
|---|---|---|
| R0 | The bundle builds, and the gate builds it, with the app's environment contract satisfied | **PASS** |
| R1 | The app boots and registers every screen | **PASS** — `loggedIn=true`, `navItems=15`, 0 page errors |
| R2 | Every screen renders real content with no page errors | **PASS** — 15/15 |
| R3 | No query the database would reject — **and the check is not vacuous** | **PASS** — 98 calls, 0 rejected |
| R4 | An uncomputable figure renders as words, never as zero | **PASS** — no `AED 0`, no `0.0%` |
| R5 | A fabricated recovered value is refused by the screen | **FAIL** — §5 |
| R6 | Every action lifecycle state has its own words | **PASS** — all seven |
| R7 | Authorisation is shown and disabled, not hidden | **PASS** — 7 disabled controls plus the refusal sentence |

The stub serves **the live shape, not a convenient one**: `holding_cost_accrued_aed`
null / `NOT_COMPUTABLE`, `net_margin_aed` null / `NOT_COMPUTABLE`, market
`UNKNOWN_NO_COMPARABLE` and `UNKNOWN_UNVERIFIED_COMPARABLE`, demand
`UNKNOWN_LOW_COVERAGE`, coverage `INSUFFICIENT` — the state of all twelve units.
It also serves three hostile rows on purpose: a competitor named `"null"`, a
competitor named `"Pardon Our Interruption"` with no price, and a queue row
carrying `recovered_value_aed: 250000` with `outcome_state NONE_YET`, no
`outcome_purchase_id` and no `attribution_basis`.

### Lane 3 — LIVE · database (needs a real connection; never faked)

| ID | Check |
|---|---|
| L1 | The embedded schema snapshot still matches the live catalogue |
| L2 | RLS on every tenant-owned table; no policy open to `anon` or `authenticated` |
| L3 | Every public view carries `security_invoker` |
| L4 | No SECURITY DEFINER function granted to `authenticated` writes across tenants |
| L5 | `anon` holds no EXECUTE on any SECURITY DEFINER function reading tenant data (L5b warns on the SECURITY INVOKER case) |
| L6 | Sentinel economics are deterministic — no rate means no holding cost and no net margin; `impact_kind NONE` means no impact; every confidence has a basis |
| L7 | UNKNOWN has not silently become a number without the evidence to support it |
| L8 | Every ledger event links to exactly one audit row, in its own tenant (L8b warns when one audit row covers several events) |
| L9 | Every `audit_log` writer is a registered workflow, so a business execution is distinguishable from a health check |
| L10 | No `recovered_value_aed` exists without an attributed sale behind it |

**All ten reported NOT RUN in this run** — reason: *no `NEXUS_DB_URL` and no
`--catalogue` file; the live lane needs a SQL connection because RLS, EXECUTE
grants, `security_invoker` and function bodies are catalogue facts PostgREST does
not expose.*

The lane's logic was exercised before shipping against a catalogue fixture built
from live measurements taken at 18:25–18:55 UTC on 2026-09-02. Against it the
gate returns **L1, L2, L3, L6, L7, L8, L10 PASS; L4 and L9 FAIL; L5b WARN** —
matching, statement for statement, the findings recorded in §7. That verifies the
lane works; it is **not** a live run and is not reported as one.

---

## 5. The blocking failures

### S9 + R5 · a recovered value is rendered on a one-column test while the words beside it claim four

Same defect, caught in source and again on the rendered page.

`inventory_actions` carries `inventory_actions_recovered_needs_real_sale`:
`recovered_value_aed` may be non-null only when `outcome_state = 'ATTRIBUTED'`
**and** `outcome_purchase_id IS NOT NULL` **and** `attribution_basis IS NOT NULL`
**and** `recovered_value_basis IS NOT NULL`. The database is right. The screens
do not read any of it:

- `screens/actions.js:280` — `r.recovered_value_aed == null ? … : aed(…) + "attributed, not confirmed"`
- `screens/actions.js:639` — the Recovered column, same null test, caption `attributed`
- `screens/overview.js:1879` — `const attributed = q.filter(a => n0(a.recovered_value_aed) != null)`, feeding
  *"N actions have a recorded sale tied to them by a person: AED X of realised gross margin"*

Served the forged row, both screens printed **AED 250,000**, and Overview
asserted a recorded sale tied by a person to an action whose `outcome_state` is
`NONE_YET`. The claim is a four-column claim made on a one-column test, so
nothing can notice when they disagree, and the figure it prints is money.

This is **latent, not visible today**: `recovered_value_aed` is null on all three
live actions (re-checked 19:35 UTC), and the CHECK stands. It becomes visible the
moment the constraint is relaxed, a view exposes a computed recovery, or another
writer reaches the column. Per PRODUCT.md — *estimated, attributed and confirmed
are three different words* — and CLAUDE.md's *check captions against the branch
they sit in*, this is launch-critical and the gate exits non-zero for it.

**Not fixed here.** `screens/actions.js` and `screens/overview.js` belong to
Agent B.

---

## 6. The warnings

- **S5b** — `screens/actions.js:548`:
  `waiting.reduce((s, r) => s + (Number(r.engine_impact_aed) || 0), 0)`.
  Defensible: `impact_kind NONE` carries a null impact that genuinely means no
  exposure. But a total built this way cannot tell *no exposure* from *not
  computed*. Partition by `impact_kind` before summing if that ever has to hold.
  Kept as a warning rather than promoted, because on today's data the two cases
  coincide — not because the check was softened.
- **L8b** *(live lane)* — 7 ledger events share 6 audit rows: one `action_decide`
  call emits `APPROVED` and `ASSIGNED` and audits once. One decision, one audit
  row is defensible; anything that counts audit rows to count actions will be
  short by one per assignment.
- **L5b** *(live lane)* — `search_rag_documents(q, match_limit)` is granted
  EXECUTE to `anon` and reads `rag_documents`. It is SECURITY **INVOKER**, so RLS
  answers and `anon` reads nothing today — surface, not exposure. Revoke it
  anyway: nothing stops a later `CREATE OR REPLACE` from adding SECURITY DEFINER,
  and at that moment it becomes a cross-tenant read with no diff that mentions a
  grant. This is why it is reported rather than ignored, and why it is a warning
  rather than a P0.

---

## 7. Real defects found, that are not gate problems

Named, not fixed. None is in a file this agent owns.

### D1 · `recompute_inventory_derived()` rewrites every dealership's inventory — P0, cross-tenant write

`SECURITY DEFINER`, owner `postgres`, EXECUTE granted to **`authenticated`**,
takes no tenant argument, and its single statement is:

```
update public.inventory i set days_in_stock = …, gross_margin = …, vat_amount = …,
       holding_cost_accrued = …, net_margin = …, recommended_commission = …, aging_alert = …
  from ( select inv.id, … from public.inventory inv where inv.acquired_at is not null ) d
 where i.id = d.id;
```

No tenant predicate anywhere. Because it is SECURITY DEFINER it bypasses RLS, so
**any signed-in user of any dealership can rewrite seven derived columns on every
other dealership's stock**, including `net_margin` and `recommended_commission`.
Measured across all fourteen SECURITY DEFINER functions granted to
`authenticated`: eighteen write statements carry `tenant_id`, one does not, and
this is it. Caught by **L4**.

Note the function is otherwise careful — `d.rate is null → null`, never zero,
which is why the Sentinel reads NOT_COMPUTABLE honestly. The defect is the scope,
not the arithmetic.

### D2 · The Action Center writes audit rows no health surface can see — P0, audit

`audit_log` holds 6 rows under the workflow `Inventory Action Center`, one per
recorded business decision. `workflow_registry` has **no row for it**, and
`v_workflow_health` is built from the registry. Those executions therefore appear
on no health tile, in no Automation screen, and in no `success_rate_30d`. The
same applies to `Example Workflow`. INV-001 makes the registry the declaration of
what writes an audit row, so an unregistered writer is exactly the case the
invariant exists to prevent. Caught by **L9**.

### D3 · The n8n Deals workflow is registered; the Action Center's Postgres path is not — P1, observability

Following from D2: the Action Center audits from inside `action_write_audit`, a
Postgres function, whereas every registered workflow audits from n8n. The
registry has no notion of a database-resident workflow, so registering it needs a
decision about `trigger_type` rather than just a row. Recording it here so the
choice is made deliberately.

---

## 8. What can only run with a signed-in browser against a real database

Reported by the gate as NOT RUN with these reasons, never as PASS:

| ID | Check | Why a stub cannot stand in |
|---|---|---|
| B1 | A `decide()` call by a non-approver is refused by Postgres | The refusal is enforced in a SECURITY DEFINER function. A stubbed RPC proves what the UI does with the answer, not that the answer would be a refusal. |
| B2 | The same decision submitted twice produces one state change (`idempotent=true` on the second) | Needs a real session and a writable action. This gate is read-only against production and will not create one. |
| B3 | A member of dealership A cannot see or act on dealership B's actions | Needs two signed-in sessions in two tenants. Proven adversarially on 2026-09-02 per CLAUDE.md; not re-proven here. |
| B4 | Rendered figures match the live rows for a real dealership | The render lane serves a stub on purpose, so the result is deterministic. Matching live data is a separate, credentialed run. |

What is **no longer** on this list, and was wrongly on it before: booting the
app, rendering all fifteen screens, exercising every PostgREST query shape, and
testing the UNKNOWN, hostile-row and authorisation paths. All of that runs
headless and offline.

---

## 9. Exit contract

| Code | Meaning |
|---|---|
| 0 | every launch-critical check ran and passed |
| 1 | at least one launch-critical check FAILED |
| 2 | nothing failed, but at least one launch-critical check could not run |
| 3 | the gate itself could not run (build failed, browser missing) |

A NOT RUN launch-critical check is not a pass, so exit 0 is unreachable without a
database connection. That is intentional.

**This run: exit 1** — S9 and R5 failed. With a live catalogue the same run also
fails L4 and L9.

---

## 10. Live values, re-checked at the end

Agent A is on the n8n box and Agent B is adversarially testing the Sentinel, so
every time-sensitive figure was re-measured after the gate was finished.
Baseline 18:30 UTC → re-check **19:35:33 UTC**, 2026-09-02:

| Figure | Baseline | Re-check | Moved |
|---|---|---|---|
| Sentinel units | 12 | 12 | no |
| `holding_cost_state = NOT_COMPUTABLE` | 12 | 12 | no |
| `net_margin_state = NOT_COMPUTABLE` | 12 | 12 | no |
| `market_position LIKE 'UNKNOWN%'` | 12 | 12 | no |
| `demand_signal = UNKNOWN_LOW_COVERAGE` | 12 | 12 | no |
| `inventory_actions` | 3 | 3 | no |
| `inventory_action_events` | 7 | 7 | no |
| distinct audit rows referenced | 6 | 6 | no |
| events with no audit row | 0 | 0 | no |
| actions with a recovered value | 0 | 0 | no |
| `audit_log` rows | 634 | 634 | no |
| `workflow_registry` rows | 18 | 18 | no |

**Nothing moved.** The snapshot the gate carries is current as of 19:35 UTC on
2 September 2026. `audit_log` was 584 in `NEXUS_INVARIANTS.md` earlier the same
day and is 634 now; that growth predates this pass and the invariants register
should be re-measured rather than trusted on that figure.

Re-run `--refresh-schema` after any migration. `L1` will fail on drift until
somebody does.
