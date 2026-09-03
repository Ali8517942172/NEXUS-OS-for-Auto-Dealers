# NEXUS OS — quality gate

Run 2026-09-03T07:27:00.179Z

Schema source: SNAPSHOT (2026-09-03T00:00:00Z)

### B1 · A decide() call by a non-approver is refused by Postgres, not just greyed out in the UI

**NOT RUN** · P0 · LIVE · database

_Could not run: needs a real signed-in session: the refusal is enforced in a SECURITY DEFINER function, and a stubbed RPC proves only what the UI does with the answer_


### B2 · Submitting the same decision twice produces one state change (idempotent=true on the second)

**NOT RUN** · P0 · LIVE · database

_Could not run: needs a real session and a writable action; the gate is read-only against production and will not create one_


### B3 · A member of dealership A cannot see or act on dealership B's actions

**NOT RUN** · P0 · LIVE · database

_Could not run: needs two signed-in sessions in two tenants; proven adversarially on 2026-09-02 per CLAUDE.md, not re-proven by this gate_


### B4 · The rendered figures match the live rows for a real dealership

**NOT RUN** · P0 · LIVE · database

_Could not run: the render lane serves a stub on purpose, so the result is deterministic; matching live data is a separate, credentialed run_


### L1 · The embedded schema snapshot still matches the live catalogue

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L10 · No recovered_value_aed exists without an attributed sale behind it

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L2 · RLS is on for every tenant-owned table, and no policy is open to anon or authenticated

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L3 · Every public view carries security_invoker

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L4 · No SECURITY DEFINER function granted to authenticated writes across tenants

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L5 · anon holds no EXECUTE on any function that reads tenant-owned data

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L6 · Sentinel economics are deterministic: no rate means no holding cost and no net margin

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L7 · UNKNOWN has not silently become a number without the evidence to support it

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L8 · Every action ledger event links to exactly one audit row, in its own tenant

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### L9 · Every audit_log writer is a registered workflow, so a business execution is distinguishable

**NOT RUN** · P0 · LIVE · database

_Could not run: no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose_


### S5b · Exposure totals coalesce a null impact to zero

**WARN** · P1 · OFFLINE · source

- screens/actions.js:637: const exposureWaiting = waiting.reduce((s, r) => s + (Number(r.engine_impact_aed) \|\| 0), 0);
- Defensible — impact_kind NONE means no exposure — but a total built this way cannot distinguish "no exposure" from "not computed". Partition by impact_kind before summing if that distinction ever has to hold.

### R0 · The bundle builds, and the gate builds it

**PASS** · P0 · OFFLINE · rendered

- vite build, fresh, with the app environment contract satisfied

### R1 · The app boots and registers every screen

**PASS** · P0 · OFFLINE · rendered

- loggedIn=true, navItems=20 matching lib/nav.js
- 0 page errors across the whole run

### R2 · Every screen renders real content with no page errors

**PASS** · P0 · OFFLINE · rendered

- 20/20 screens rendered
- overview:39685c/8cards  leads:10095c/2cards  conversations:13897c/3cards  compliance:24337c/4cards  revenue:31238c/7cards  leadrecovery:18406c/6cards  dealrescue:13852c/5cards  attribution:21076c/6cards  policy:19710c/6cards  inventory:6336c/2cards  competitors:20394c/4cards  ask:8870c/4cards  finance:32774c/7cards  customers:20892c/2cards  actions:22265c/6cards  campaigns:16966c/7cards  deals:18471c/5cards  automation:32334c/7cards  team:14827c/4cards  settings:28894c/11cards

### R3 · No query the database would reject — and the check is not vacuous

**PASS** · P0 · OFFLINE · rendered

- 129 PostgREST calls observed across 20 screens; 0 rejected

### R4 · An uncomputable figure renders as words, never as zero

**PASS** · P0 · OFFLINE · rendered

- served: holding_cost_accrued_aed null / NOT_COMPUTABLE, net_margin_aed null / NOT_COMPUTABLE, market UNKNOWN_NO_COMPARABLE, demand UNKNOWN_LOW_COVERAGE — the live shape on 12 of 12 units
- no "AED 0" and no "0.0%" reached any of the 8 screens that render money: overview, inventory, actions, revenue, leadrecovery, dealrescue, attribution, policy

### R5 · A fabricated recovered value is refused by the screen

**PASS** · P0 · OFFLINE · rendered

- served a row with recovered_value_aed 250000, outcome_state NONE_YET, outcome_purchase_id null, attribution_basis null, recovered_value_basis null — all four columns the CHECK requires absent
- it did not reach any of the 8 money-rendering screens as a figure: overview, inventory, actions, revenue, leadrecovery, dealrescue, attribution, policy

### R6 · Every action lifecycle state has its own words

**PASS** · P0 · OFFLINE · rendered

- all seven inventory_actions.status values rendered with distinct wording

### R7 · Authorisation is shown and disabled, not hidden

**PASS** · P0 · OFFLINE · rendered

- served may_decide=false / NOT_AN_APPROVER; screen rendered 10 disabled controls and the refusal sentence

### S1 · Navigation and screen registry agree

**PASS** · P0 · OFFLINE · source

- 20 nav entries, 20 registered screens, parsed from lib/nav.js: overview, leads, conversations, compliance, revenue, leadrecovery, dealrescue, attribution, policy, inventory, competitors, ask, finance, customers, actions, campaigns, deals, automation, team, settings

### S10 · One outcome vocabulary, and it is not the action lifecycle

**PASS** · P0 · OFFLINE · source

- every file that reads audit_log or v_workflow_health imports lib/health.js and classifies through it
- screens/actions.js reads audit_outcome_class from v_inventory_action_timeline rather than re-deriving it
- the action lifecycle and the run outcome are never passed through each other

### S2 · Nobody reached outside the helper contract

**PASS** · P0 · OFFLINE · source

- 40 source files linted (screens, lib and app.js)

### S3 · Every query names a relation and columns that exist

**PASS** · P0 · OFFLINE · source

- 135 distinct PostgREST paths extracted from 40 files
- column map: SNAPSHOT (2026-09-03T00:00:00Z), 73 relations

### S4 · No browser-side tenant scoping

**PASS** · P0 · OFFLINE · source

- no db() path filters on tenant_id; no dbWrite() body composes one; lib/tenant.js reads membership to label the session only

### S5 · No zero substituted for an uncomputable economic figure

**PASS** · P0 · OFFLINE · source

- 6 unknownable figures checked across 40 files
- live evidence: holding_cost_accrued_aed and net_margin_aed are NULL on 12 of 12 units

### S6 · Every state the engine emits reaches the reader

**PASS** · P0 · OFFLINE · source

- screens/inventory.js: holding_cost_state — every value named
- screens/overview.js: holding_cost_state — partitioned on the computed value, so every other state is handled by complement
- screens/revenue.js: holding_cost_state — partitioned on the computed value, so every other state is handled by complement
- lib/unit-form.js: holding_cost_state — every value named
- screens/inventory.js: net_margin_state — every value named
- screens/overview.js: net_margin_state — partitioned on the computed value, so every other state is handled by complement
- lib/unit-form.js: net_margin_state — every value named
- screens/inventory.js: market_position — every value named
- screens/overview.js: market_position — UNKNOWN family covered by a prefix guard
- screens/revenue.js: market_position — UNKNOWN family covered by a prefix guard
- screens/inventory.js: demand_signal — every value named
- screens/overview.js: demand_signal — UNKNOWN family covered by a prefix guard
- screens/inventory.js: enquiry_coverage — printed verbatim, so any value reaches the reader

### S7 · No invented or hard-coded market price

**PASS** · P0 · OFFLINE · source

- REPRICE asks for a human price review; no screen names a figure

### S8 · No finance figure is computed by the browser or by a model

**PASS** · P0 · OFFLINE · source

- APR / EMI / monthly / LTV are read from finance_quotes with calculation_id and execution_id, never derived
- lifetime value in screens/customers.js is summed from purchase_history and is not a finance figure — excluded on purpose, by name

### S9 · Exposure is never called recovery, and recovery names its sale

**PASS** · P0 · OFFLINE · source

- recoveryEvidence() is the single derivation and reads all four columns the CHECK names: outcome_state, outcome_purchase_id, attribution_basis, recovered_value_basis
- defined in screens/actions.js; every render of recovered_value_aed routes through it
- no bare null test on recovered_value_aed survives outside that function
- live: recovered_value_aed is null on all 3 inventory_actions rows, so a fabricated figure is latent, not visible today

