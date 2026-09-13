/* NEXUS SYSTEM TRUTH — screens/system-truth.js
   VENDOR TELEMETRY. Written 8 September 2026 against ops/truth-dashboard/SPEC.md,
   which was measured read-only on production (`dsvuoovivysszdoiorch`) that day.

   This screen exists for one sentence of the owner's: *"this will save you
   massive debugging time once real traffic starts."* A screen that flatters
   saves no debugging time — it costs it, because it sends the reader looking in
   the wrong place. So nothing below rounds an absence up to a zero, and nothing
   below renders an empty panel that could be read as an all-clear.

   ═══════════════════════════════════════════════════════════════════════════
   1 · REGISTRATION — the lines to apply, and where they may NOT be applied
   ═══════════════════════════════════════════════════════════════════════════
   This module registers itself as `SCREENS.systemtruth`, the same way every
   other screen does. It is NOT wired up by this file, because wiring it into
   the dealer bundle is the one thing that must not happen (§3 below).

   IN THE VENDOR BUILD ONLY — apps/truth-dashboard/app.js, or whatever entry
   module the vendor plane ends up with:

       import './screens/system-truth.js';

   AND, in that build's nav (a vendor nav, not lib/nav.js):

       { group: 'Platform', items: [
         { id:'systemtruth', title:'System Truth', icon:'query_stats' },
       ]},

   DO NOT add either line to apps/executive-dashboard/app.js or to
   apps/executive-dashboard/lib/nav.js. Those two files build the bundle that is
   served to a dealership's own browser. `import.meta.glob` in app.js is an
   explicit list precisely so that a file dropped into screens/ is not picked up
   by a wildcard — this file relies on that, and adding a glob pattern for it
   would ship vendor telemetry to the customer.

   ═══════════════════════════════════════════════════════════════════════════
   2 · THE DATABASE OBJECTS THAT MUST EXIST FIRST, AND THE GRANTS
   ═══════════════════════════════════════════════════════════════════════════
   None of them exists today. Verified read-only on production, 8 Sep 2026:

       select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'nexus_truth%';
       -- 0 rows

   TEN accessors. Six are SPEC.md §5.2 verbatim. Four more are proposed by this
   screen, and each is marked; they are what the fifth and sixth panels need and
   the specification argues for both (§7) without declaring their shapes.

     SPEC §5.2, unchanged
       nexus_truth_source_funnel(p_since timestamptz, p_environment text)
       nexus_truth_messaging(p_since timestamptz)
       nexus_truth_revenue(p_since timestamptz)
       nexus_truth_ai(p_since timestamptz)          -- long form, one row per metric
       nexus_truth_freshness()
       nexus_truth_manifest()

     PROPOSED HERE, for panels five and six
       nexus_truth_workflows(p_since timestamptz)
         over public.v_workflow_health, which EXISTS and carries the finding
         nothing renders to the vendor: `wf_108 ERP Sync - Bitrix24`,
         runs_30d 18, successes_30d 7, last_success 2026-08-19 11:04:08Z,
         health DEGRADED. Re-measured 8 Sep 2026; still 19 August.
         NOTE, measured rather than assumed: v_workflow_health carries NO
         tenant_id column. `workflow_registry` deliberately has none either
         (CLAUDE.md, 6 Sep 2026) — the register is the vendor's, and three
         registered workflows serve no dealership at all. So this accessor is
         the one of the ten that does NOT group by tenant, and must not grow a
         tenant predicate that filters nothing while reading like a scope.
       nexus_truth_unregistered_writers()
         over public.v_audit_unregistered_writers, which EXISTS and DOES carry
         tenant_id. Two rows today.
       nexus_truth_platform_state()
         the strip SPEC §7 asks for: nexus_tenancy_readiness(),
         nexus_quarantine_census(), nexus_lead_ingest_invariants(),
         nexus_definer_scoping_audit(), nexus_trace_linkability_report() and
         nexus_public_exposure_report(false), normalised to
         (check text, level text, detail text, source_function text, computed_at).
         All six of those source functions EXIST on production today.
       nexus_truth_refusals(p_since timestamptz)
         THE ONE WITH NO TABLE UNDER IT. See §4.

   All ten: LANGUAGE sql, STABLE, SECURITY INVOKER (deliberately NOT DEFINER —
   SPEC §5.2 gives the reasoning, and this repository has paid for a borrowable
   definer function twice), SET search_path TO public, pg_catalog.

   The grants, verbatim, per function. `public` is named FIRST and is not
   optional: ops/ci/function-grants.mjs exists because `revoke from anon,
   authenticated` leaves the PUBLIC grant intact, both roles keep reaching the
   function through it, and `proacl` reads clean afterwards.

       revoke all on function public.<name>(<args>) from public, anon, authenticated;
       grant execute on function public.<name>(<args>) to service_role;

   And each migration asserts, rather than trusting the revoke:

       do $$ begin
         if has_function_privilege('authenticated', 'public.<name>(<args>)', 'execute')
         or has_function_privilege('anon',          'public.<name>(<args>)', 'execute') then
           raise exception 'NEXUS: truth accessor % is reachable by a dealership role', '<name>';
         end if;
       end $$;

   Nothing here runs ALTER TABLE. Creating functions is safe;
   `nexus_guard_born_open_grants()` fires on every DDL and its ALTER TABLE path
   has already stripped two live dashboard write paths off `inventory` once this
   month (migration 20260906071310).

   ═══════════════════════════════════════════════════════════════════════════
   3 · THE GUARD — this screen must never be reachable from a dealership session
   ═══════════════════════════════════════════════════════════════════════════
   CONTROL-PLANE.md §2.1 puts operational health, usage events and error events
   in the vendor's plane, and §2.3 says the two planes should not share a
   database, let alone a bundle. This screen aggregates across dealerships. A
   dealership must never see it and must never learn from it that another
   dealership exists.

   "Not linked from their nav" is not the guard. The dealer bundle is served to
   the dealership's own browser, and a screen inside it is one nav id and one
   `import` away from being rendered — or from being read out of the bundle with
   devtools, which needs no nav at all. So the guard is layered, and only the
   first layer is real:

     LAYER 1, the only one that is a boundary: THIS FILE IS NOT IN THE DEALER
       BUNDLE. app.js lists its screens one per line and its `import.meta.glob`
       block enumerates five explicit paths; neither names this file, and a CI
       check should assert that neither ever does:
           grep -n "system-truth" apps/executive-dashboard/app.js \
                                  apps/executive-dashboard/lib/nav.js   # must be empty
           grep -c "systemtruth" apps/executive-dashboard/dist/assets/main-*.js  # must be 0
       That second line is the one that matters, because the deployed bundle is
       the witness and the source is not — this repository has twice checked the
       wrong artefact and believed the answer.

     LAYER 2, a latch inside the module, so that a build which imports it by
       accident renders a refusal instead of telemetry. The vendor build sets
       VITE_NEXUS_PLANE=control; nothing else does. Without it this module
       registers a screen that reads NOTHING — no accessor is called, no fetch
       is issued — and says why. It is a latch, not a lock: a latch cannot stop
       someone reading the strings out of a bundle it should not be in, which is
       exactly why layer 1 is the guard and this is the seatbelt.

     LAYER 3, the credential. Every accessor is `service_role` only, and
       `service_role` cannot exist in a browser. A dealership session presenting
       its own JWT is refused 42501 by grant even if it reaches the function
       name. That is real, and it is also the last line rather than the first:
       a refusal that renders as "NOT RUN — permission refused" still tells the
       reader the function exists, and the function's NAME is itself vendor
       information.

   The vendor deployment therefore reads through a server-side proxy holding
   SUPABASE_SERVICE_ROLE (SPEC §6.2, `server/index.mjs`), never from the
   browser. `truthRead()` below is the single seam where that swap happens: it
   is the ONE read path in this file, and re-pointing it at the proxy is a
   one-line change with no call site to revisit.

   ═══════════════════════════════════════════════════════════════════════════
   4 · WHY THERE IS A REFUSALS PANEL, AND WHY IT IS THE HARSHEST ONE
   ═══════════════════════════════════════════════════════════════════════════
   SPEC §7 calls this the single most valuable thing missing from the owner's
   sketch, and the reason is the `'+'` defect: `p_customer_phone: '+' +
   customer_wa_id` sends a `+` prefixed to Meta's already-bare E.164 digits, the
   row is refused by CHECK, the insert raises — and **a refused write leaves no
   row in any table**. Every counter on this screen stays exactly where it was.
   The same hole is metric S7: this system records what it accepted and nothing
   about what it refused, and the refusals are where the defects are.

   So the Refusals panel does NOT render NOT RUN when its accessor is missing.
   It renders NOT COMPUTABLE, and that distinction is the whole point: there is
   no table under it. `public.nexus_write_refusal` does not exist — verified
   read-only on production, 8 Sep 2026, zero relations in `public` matching
   /refus|write_refusal|error_event/ and zero functions matching /refusal/. An
   accessor installed over nothing would return zero rows, and zero rows would
   render as "nothing has been refused", which is the exact lie the panel exists
   to prevent. Both the table AND its writer are owed, and the panel names both.

   ═══════════════════════════════════════════════════════════════════════════
   5 · WHAT THIS FILE DOES NOT DO, DELIBERATELY
   ═══════════════════════════════════════════════════════════════════════════
   · It does not import lib/vocabulary.js. SPEC §0.3: that module keeps supplier
     names off a DEALER's screen. Here the supplier name is frequently the whole
     finding — "the second WAHA host" is not a sentence that survives redaction —
     so importing it would delete the information this screen exists to carry.

   · It does not restate the status ladder. CLAUDE.md: one figure, one
     derivation, and `ops/evidence-standard/STATUS-LADDER.md` is that derivation.
     Hardcoding "40 of 42 implemented, 1 real-traffic proven" here would be a
     second copy that goes stale silently, which is the defect this repository
     has recorded seven times as a caption contradicting its own branch. The
     header points at the ladder and computes none of it.

   · It carries a LOCAL MANIFEST and that manifest is never a source of VALUES.
     SPEC §5.2 makes `nexus_truth_manifest()` the enforcement object: a metric
     absent from it cannot be drawn. That function does not exist, so the labels,
     reasons, drill-downs and plausible-lie notes below are transcribed from
     ops/truth-dashboard/SPEC.md dated 8 September 2026 — prose, reviewed, and
     stale the moment the schema moves. NOT ONE STATE AND NOT ONE NUMBER IS
     TRANSCRIBED. Every metric renders NOT RUN until an accessor answers, so
     this screen cannot show a figure it did not read. The day the database
     manifest lands it wins, and any disagreement with the local copy is
     rendered as a fault rather than silently resolved.

   · It does not merge cell(), funnel() and the manifest into the panels. SPEC
     §6.2 wants those as three modules in apps/truth-dashboard/lib/ so the rules
     live inside objects rather than being conventions people remember. This
     file owns exactly one path, so they are three clearly fenced sections here
     and they are the first thing to extract when this becomes its own app.

   ═══════════════════════════════════════════════════════════════════════════
   6 · THE FIVE RENDERINGS, WHICH MUST NEVER LOOK ALIKE
   ═══════════════════════════════════════════════════════════════════════════
   The legend at the top of the screen renders all five side by side, so the
   difference is on the page and not only in this comment.

     0                a numeral. MEASURED, with its denominator and its age.
                      The only rendering that emits a `.num` node.
     0 proven         a numeral, plus the evidence that makes the zero a
                      finding. Reserved for R6: recovered revenue is AED 0 and
                      SPEC verified it rather than asserting it.
     NOT MEASURED     a WORD, amber. The mechanism exists and every input is
                      absent. No numeral anywhere in the cell.
     NOT COMPUTABLE   a WORD, grey. Nothing in the schema can express it. No
                      numeral, and the schema absence is named.
     NOT RUN          a WORD, red, naming the accessor and the SQLSTATE. The
                      query did not execute. SPEC §3: NOT RUN ≠ PASS, and the
                      header cannot read healthy while any panel is in it.
                      This mirrors QUALITY_GATE.mjs, where NOTRUN() is a
                      distinct record state and a P0 in it does not exit 0. */

import { db, onIdentityChange } from '../lib/data.js';
import { ago, dubaiStamp, esc, n0, num, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
/* kpi() is deliberately NOT imported — see tile() for why this screen builds
   the `.kpi` markup itself. */
import { openDrawer, panel, table } from '../lib/ui.js';

/* ══════════════════════════════════════════════════════════════════════════
   SECTION A · The plane latch
   ══════════════════════════════════════════════════════════════════════════ */

const PLANE = String(import.meta.env?.VITE_NEXUS_PLANE || '').trim().toLowerCase();
const IS_VENDOR_PLANE = PLANE === 'control';

/* ══════════════════════════════════════════════════════════════════════════
   SECTION B · Small local vocabulary
   ══════════════════════════════════════════════════════════════════════════ */

const str = v => String(v == null ? '' : v).trim();
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted = h => `<div class="cell-sub">${h}</div>`;
const hot = h => `<div class="cell-sub t-hot">${h}</div>`;
const warm = h => `<div class="cell-sub t-warm">${h}</div>`;
const bold = h => `<div style="font-weight:600">${h}</div>`;
const wrap = h => `<div style="white-space:normal">${h}</div>`;
const mono = t => `<span class="mono">${esc(t)}</span>`;
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));

/* ══════════════════════════════════════════════════════════════════════════
   SECTION C · The render states — SPEC §2 and §4, Rule 1
   ══════════════════════════════════════════════════════════════════════════
   `numeral: true` is the ONLY licence to print a digit, and cell() below is the
   only reader of it. Note which entries do not have it: UNKNOWN and
   NOT_COMPUTABLE are absences and PARTIAL is a number that does not cover its
   own label — so PARTIAL may print a numeral only with a mandatory qualifier
   beside it, never bare, which is what `requires_qualifier` enforces.

   PROVEN_ZERO is its own state and not a flavour of MEASURED. A zero that was
   measured against a denominator is a finding; a zero that arrives because
   nothing was ever written is not; and SPEC's whole R2/R6 argument is that a
   tile cannot tell a reader which one it is holding unless the two states are
   different objects. */
const RENDER = {
  MEASURED: {
    word: null, tone: 'ok', numeral: true, requires_qualifier: false,
    blurb: 'A number that means what its label says, over a denominator this screen states.',
  },
  PROVEN_ZERO: {
    word: null, tone: 'ok', numeral: true, requires_qualifier: true,
    blurb: 'Zero, and the zero was verified rather than assumed. The evidence behind it is printed beside it.',
  },
  PARTIAL: {
    word: 'PARTIAL', tone: 'warm', numeral: true, requires_qualifier: true,
    blurb: 'A number exists and does not cover the metric. It never appears without the sentence saying what it misses.',
  },
  UNKNOWN: {
    word: 'NOT MEASURED', tone: 'warm', numeral: false, requires_qualifier: false,
    blurb: 'The mechanism exists and every input is absent. This is not zero, and it must never be rendered as one.',
  },
  NOT_COMPUTABLE: {
    word: 'NOT COMPUTABLE', tone: 'unknown', numeral: false, requires_qualifier: false,
    blurb: 'Nothing in the schema can express this. No query would make it appear; a column, a table or a writer is missing.',
  },
  NOT_RUN: {
    word: 'NOT RUN', tone: 'hot', numeral: false, requires_qualifier: false,
    blurb: 'The query did not execute. NOT RUN is not a pass, and this screen cannot read healthy while any panel is in it.',
  },
};
const renderState = s => RENDER[String(s || '').toUpperCase()] || null;

/* ══════════════════════════════════════════════════════════════════════════
   SECTION D · The manifest — transcribed from SPEC.md, values never included
   ══════════════════════════════════════════════════════════════════════════
   One entry per metric the specification names. Read §5 of the header before
   editing: `state` is deliberately ABSENT from every entry, because a state is
   a claim about the database and this file has not read the database. What each
   entry carries is prose (label, why, the plausible lie), the accessor and field
   that would answer it, and the drill-down.

   `drill` is REQUIRED. SPEC §4 Rule 3: every number is clickable through to the
   rows behind it, or it does not belong on this screen. Where no rows exist to
   show, `drill.rows` is `'NONE'` and the reason is on the cell — which is the
   correct shape for the four AI metrics and is why the rule is worth its cost.

   `stale_after` is null on every entry, and that is measured honesty rather
   than an oversight: SPEC's own Unknowns §5 says the thresholds are not chosen,
   because choosing them without traffic would be inventing a normal. cell()
   implements the replacement behaviour so it works the day one is set, and says
   plainly that none is set today. */

const MANIFEST = [
  /* ── Panel 1 · Sources ─────────────────────────────────────────────────── */
  { panel: 'sources', metric: 'received', label: 'Received',
    accessor: 'nexus_truth_source_funnel', field: 'received', unit: 'arrivals',
    as_of_field: 'newest_arrival_at', stale_after: null,
    why: 'Arrivals NEXUS actually recorded through a door it holds a record of.',
    lie: 'count(*) from leads. That returns more, and the extra rows never arrived through any door NEXUS records — '
       + 'they were written by a workflow. Counting rows in the destination table and calling it "received" is the '
       + 'mistake leads.source already made.',
    drill: { rows: 'lead_event', predicate: 'every recorded arrival, newest first' } },

  { panel: 'sources', metric: 'authenticated', label: 'Authenticated',
    accessor: 'nexus_truth_source_funnel', field: 'authenticated', unit: 'arrivals',
    as_of_field: 'newest_arrival_at', stale_after: null,
    why: 'Arrivals an external system attested. Not "an origin was recorded" — the kind of proof is the whole fact.',
    lie: 'count(*) where origin_verified is not null. The column is never null, because operator_recorded is a value. '
       + 'lead_provenance_kind.is_externally_attested is the flag. counts_as_real is a DIFFERENT question — '
       + 'leadingest_06 split them precisely so a walk-in could be real and unattested at once — and reading it here '
       + "reports a salesperson's word as authentication.",
    drill: { rows: 'lead_event joined to lead_provenance_kind', predicate: 'is_externally_attested = true' } },

  { panel: 'sources', metric: 'normalized', label: 'Normalised',
    accessor: 'nexus_truth_source_funnel', field: 'normalized', unit: 'arrivals',
    as_of_field: 'newest_arrival_at', stale_after: null,
    why: 'Arrivals whose payload was turned into fields NEXUS can act on.',
    lie: "Treating phase = 'HYDRATED' as normalised. Hydration is the second provider hop — Meta, inbound email. "
       + 'Google and walk-in never hydrate and would count as zero while being fully normalised. '
       + '`normalized is not null` is the fact.',
    drill: { rows: 'lead_event', predicate: 'normalized is not null' } },

  { panel: 'sources', metric: 'promoted', label: 'Promoted to a lead',
    accessor: 'nexus_truth_source_funnel', field: 'promoted', unit: 'arrivals',
    as_of_field: 'newest_arrival_at', stale_after: null,
    why: 'Arrivals that became a customer record.',
    lie: 'count(*) where lead_id is not null. Identical today BY CONSTRAINT '
       + '(lead_event_promotion_is_symmetric), and it is the constraint that makes it true, not the data. Relax the '
       + 'constraint and the two diverge silently. Read phase.',
    drill: { rows: 'lead_event', predicate: "phase = 'PROMOTED'" } },

  { panel: 'sources', metric: 'held', label: 'Held for review',
    accessor: null, field: null, unit: 'arrivals',
    forced: 'NOT_COMPUTABLE',
    as_of_field: null, stale_after: null,
    why: 'A decision to pause an arrival pending review.',
    absence: 'There is no HELD phase. lead_event_phase allows exactly RECEIVED, HYDRATED, PROMOTED, DUPLICATE, '
       + 'REJECTED, QUARANTINED, EXPIRED. Nothing records a decision to pause, nobody who paused it, and no reason.',
    lie: 'Rendering the non-terminal count under the word "Held". A queue depth of 0 and a review queue of 0 are '
       + 'opposite findings — the first says the pipeline is idle, the second says nothing is waiting on a human. '
       + 'The nearest measurable thing includes an arrival that is 40 ms old.',
    drill: { rows: 'NONE', predicate: 'no relation records a hold' } },

  { panel: 'sources', metric: 'quarantined_arrival', label: 'Quarantined — the arrival reading',
    accessor: 'nexus_truth_source_funnel', field: 'quarantined', unit: 'arrivals',
    as_of_field: 'newest_arrival_at', stale_after: null,
    why: 'An arrival that was refused at the door. One of THREE unrelated things this database spells "quarantined".',
    lie: 'Adding the three, or rendering any one of them under a bare label "Quarantined". "An arrival was refused", '
       + '"traffic could not be attributed to a dealership at all" and "a message’s evidence was retracted after '
       + 'the fact" are not one counter, and a single tile is how they become one.',
    drill: { rows: 'lead_event', predicate: "phase = 'QUARANTINED'" } },

  { panel: 'sources', metric: 'quarantined_tenant', label: 'Quarantined — the unattributable-traffic reading',
    accessor: null, field: null, unit: 'audit rows',
    forced: 'UNKNOWN',
    as_of_field: null, stale_after: null,
    why: 'Rows filed under the `__unattributed__` quarantine tenant, because no dealership could be resolved for them.',
    absence: 'The accessor as specified in SPEC §5.2 returns one `quarantined` column, and that column is the ARRIVAL '
       + 'reading. This second reading needs a field of its own — nexus_quarantine_census() already computes it and '
       + 'nothing carries it into nexus_truth_source_funnel. That is a gap in the accessor shape, not in the database.',
    lie: 'Reusing the arrival column for this word. Two different populations under one label is exactly the defect '
       + 'the three-way split exists to prevent.',
    drill: { rows: 'audit_log under the quarantine tenant', predicate: 'tenants.is_quarantine = true' } },

  { panel: 'sources', metric: 'quarantined_evidence', label: 'Quarantined — the withdrawn-evidence reading',
    accessor: null, field: null, unit: 'messages',
    forced: 'UNKNOWN',
    as_of_field: null, stale_after: null,
    why: "Messages whose evidence was withdrawn after the fact — communication_logs.evidence_state = 'QUARANTINED'.",
    absence: 'Same gap as the reading above: no field on the specified accessor carries it.',
    lie: 'Folding it into either of the other two. A retracted piece of evidence is not a refused arrival.',
    drill: { rows: 'communication_logs', predicate: "evidence_state = 'QUARANTINED'" } },

  { panel: 'sources', metric: 'failed', label: 'Failed',
    accessor: 'nexus_truth_source_funnel', field: 'rejected', unit: 'arrivals',
    partner_field: 'hydration_failed',
    forced: 'PARTIAL',
    qualifier: 'recorded · arrivals refused BEFORE the database are not counted here, and there is no ledger that '
       + 'would count them',
    as_of_field: 'newest_arrival_at', stale_after: null,
    why: 'Arrivals NEXUS refused after they reached the database.',
    absence: 'The failures that matter happen before the database. There is no HTTP receiver for any lead source, so '
       + 'an arrival refused at the edge — bad signature, rate limit, malformed body, unregistered endpoint — leaves '
       + 'NO ROW ANYWHERE. nexus_record_lead_event raises NX001 on refusal, and a raise writes nothing.',
    lie: 'Reporting a bare number under "Failed" and letting the reader conclude nothing has failed. What it actually '
       + 'means is "nothing that failed was ever recorded", and the two readings are opposite. This stays PARTIAL '
       + 'permanently until the refusal ledger in panel six exists.',
    drill: { rows: 'lead_event', predicate: "phase = 'REJECTED', plus hydration errors" } },

  { panel: 'sources', metric: 'unlinked_leads', label: 'Leads with no recorded arrival',
    accessor: 'nexus_truth_source_funnel', field: 'leads_without_arrival', unit: 'leads',
    as_of_field: 'newest_arrival_at', stale_after: null,
    why: 'The direction of "unlinked" that is a real measurement: a customer record exists and no door records them '
       + 'arriving. Every one of these entered the system through a door the funnel above does not have.',
    lie: 'Quoting the OTHER direction — promotions with no lead — which a CHECK constraint guarantees is zero. True, '
       + 'meaningless and reassuring. A number a database constraint guarantees is not a measurement of the system, '
       + 'and this screen renders it as guaranteed rather than as measured.',
    drill: { rows: 'leads with no lead_event', predicate: 'not exists (select 1 from lead_event e where e.lead_id = leads.id)' } },

  /* ── Panel 2 · AI ──────────────────────────────────────────────────────── */
  { panel: 'ai', metric: 'classified', label: 'Classified',
    accessor: 'nexus_truth_ai', field: 'classified', unit: 'leads',
    forced: 'PARTIAL',
    qualifier: 'this is a STOCK, not a flow — it counts leads currently carrying a score, not classifications made',
    as_of_field: null, stale_after: null,
    why: 'How many classifications the AI has made.',
    absence: 'leads.ai_score is a current value on a row: no timestamp, no history, no writer column. A lead scored '
       + 'five times counts once, and a lead rescored yesterday is indistinguishable from one scored in August. '
       + 'audit_log.intent is a run summary and the overwhelming majority of audit rows carry none.',
    lie: 'Publishing count(*) where ai_score is not null as "classifications today", or dividing it by a time window. '
       + 'That produces a rate no event ever had.',
    drill: { rows: 'leads', predicate: 'ai_score is not null' } },

  { panel: 'ai', metric: 'accepted', label: 'Accepted',
    accessor: 'nexus_truth_ai', field: 'accepted', unit: null,
    forced: 'NOT_COMPUTABLE',
    as_of_field: null, stale_after: null,
    why: "A human's verdict that a classification was right.",
    absence: 'No table records a decision about a classification. No accept/reject event, no reviewer, no timestamp. '
       + 'leads.status is the OUTCOME of routing, not a verdict on the AI.',
    lie: 'Reading status = ai-implied intent as "accepted". It measures whether two derived fields agree with each '
       + 'other, which they will, because one was computed from the other. A tautology rendered as an accuracy figure.',
    drill: { rows: 'NONE', predicate: 'no relation records a decision about a classification' } },

  { panel: 'ai', metric: 'ai_held', label: 'Held for review',
    accessor: 'nexus_truth_ai', field: 'held', unit: null,
    forced: 'NOT_COMPUTABLE',
    as_of_field: null, stale_after: null,
    why: 'A classification a person paused.',
    absence: 'The same absence as "Held" in Sources, one layer up: no review queue, no hold reason, no holder.',
    lie: "Counting status = 'new'. A lead nobody has touched yet is not a classification a human paused.",
    drill: { rows: 'NONE', predicate: 'no relation records a hold on a classification' } },

  { panel: 'ai', metric: 'manual_override', label: 'Manual override',
    accessor: 'nexus_truth_ai', field: 'manual_override', unit: null,
    forced: 'NOT_COMPUTABLE',
    as_of_field: null, stale_after: null,
    why: 'A person disagreeing with the score and changing it.',
    absence: 'leads.ai_score has NO column grant to any dealership role — any role writing it is refused 42501 — so a '
       + 'dealership cannot override it at all today. And if that changed tomorrow, the column has no history and no '
       + 'writer, so an override would overwrite the evidence that an override happened. lead_owner_events records '
       + 'reassignment of OWNERSHIP and is not about the score.',
    lie: 'Comparing ai_score against a threshold and calling disagreement an override. Nobody disagreed; a constant '
       + 'was chosen.',
    drill: { rows: 'NONE', predicate: 'ai_score has no history and no writer column' } },

  { panel: 'ai', metric: 'false_positive', label: 'False positive',
    accessor: 'nexus_truth_ai', field: 'false_positive', unit: null,
    forced: 'NOT_COMPUTABLE',
    as_of_field: null, stale_after: null,
    why: 'A lead scored HOT that was not.',
    absence: 'There is no ground truth. A false positive requires a labelled outcome, and the only outcome NEXUS holds '
       + 'is a sale. One labelled outcome cannot support a rate.',
    lie: "Using status = 'DISQUALIFIED' as the negative label. Leads auto-created in error and quarantined as "
       + 'DISQUALIFIED are INGESTION defects, not classifier mistakes, and counting them as false positives blames the '
       + 'model for a bug in the plumbing.',
    drill: { rows: 'NONE', predicate: 'no labelled outcome exists to compare a score against' } },

  { panel: 'ai', metric: 'false_negative', label: 'False negative',
    accessor: 'nexus_truth_ai', field: 'false_negative', unit: null,
    forced: 'NOT_COMPUTABLE',
    as_of_field: null, stale_after: null,
    why: 'A lead scored COLD that converted — or a lead NEXUS never saw at all.',
    absence: 'Structurally uncomputable. The second half is unreachable by construction: the system cannot count what '
       + 'did not arrive. Even with perfect labelling this metric is bounded above by ingestion coverage.',
    lie: 'Reporting a false-negative rate computed only over leads NEXUS holds. It answers a narrower question than '
       + 'the words on the tile, and it gets BETTER every time ingestion misses a lead. A metric that improves when '
       + 'the system loses data must not be on this screen.',
    drill: { rows: 'NONE', predicate: 'unreachable — the system cannot count what did not arrive' } },

  /* ── Panel 3 · Messaging ───────────────────────────────────────────────── */
  { panel: 'messaging', metric: 'claims', label: 'Received',
    accessor: 'nexus_truth_messaging', field: 'claims', unit: 'messages',
    as_of_field: 'newest_message_at', stale_after: null,
    why: 'Inbound messages NEXUS claimed. The claim is idempotent, which is why it — and not the transport — is the '
       + 'arrival counter.',
    lie: 'Counting n8n executions. Before 6 September two WAHA hosts posted every message, so the execution list is '
       + 'roughly DOUBLE the truth. processed_messages absorbed the doubling; the execution list did not.',
    drill: { rows: 'processed_messages', predicate: 'within the aligned window' } },

  { panel: 'messaging', metric: 'logged_inbound', label: 'Logged (inbound)',
    accessor: 'nexus_truth_messaging', field: 'logged_inbound', unit: 'messages',
    as_of_field: 'newest_message_at', stale_after: null,
    why: 'Inbound messages that reached the conversation ledger.',
    lie: 'Comparing this with Received across their NATURAL ranges rather than an aligned window. processed_messages '
       + 'and communication_logs begin on different days, so the raw comparison reads as "more logged than arrived", '
       + 'which is impossible and is purely the window mismatch. Align the window or refuse the comparison.',
    drill: { rows: 'communication_logs', predicate: "direction = 'inbound' within the aligned window" } },

  { panel: 'messaging', metric: 'claims_without_log', label: 'Received but never logged',
    accessor: 'nexus_truth_messaging', field: 'claims_without_log', unit: 'messages',
    as_of_field: 'newest_message_at', stale_after: null,
    why: 'THE HIGHEST-VALUE CELL ON THIS SCREEN. A message NEXUS claimed and then lost before it reached the ledger.',
    lie: 'Joining processed_messages.chat_id to communication_logs.lead_email directly. One person’s messages are '
       + 'filed under up to four key shapes as their record matures, so the naive join overstates the defect several '
       + 'times over — and an overstated defect is discredited the first time someone checks it. Resolve through '
       + 'whatsapp_contacts and the @whatsapp.lead forms.',
    drill: { rows: 'processed_messages with no resolved communication_logs row', predicate: 'identity rule, not a foreign key' } },

  { panel: 'messaging', metric: 'replies', label: 'Replied',
    accessor: 'nexus_truth_messaging', field: 'replies_attributed', unit: 'messages',
    partner_field: 'replies_unattributed',
    forced: 'PARTIAL',
    qualifier: 'means "an outbound row exists in this thread", never "this message was answered"',
    as_of_field: 'newest_message_at', stale_after: null,
    why: 'Outbound messages NEXUS can attribute to a sender.',
    absence: 'sent_by is not constrained and is null on some outbound rows. There is no per-message link between an '
       + 'inbound message and the reply to it.',
    lie: 'Rendering every outbound row as a reply. Some assert nothing about who sent them, and system/outbound rows '
       + 'are the dealership writing ABOUT a conversation rather than inside it — attribution_event_type.MESSAGE_SENT '
       + 'already excludes those and this panel must too.',
    drill: { rows: 'communication_logs', predicate: "direction = 'outbound' and sent_by is not null" } },

  { panel: 'messaging', metric: 'delivered', label: 'Delivered',
    accessor: 'nexus_truth_messaging', field: 'delivery_receipts', unit: 'receipts',
    forced: 'NOT_COMPUTABLE',
    override_word: 'NO RECEIPTS ON FILE',
    as_of_field: 'newest_message_at', stale_after: null,
    why: 'Messages a provider confirmed delivering.',
    absence: 'whatsapp_delivery_events is empty and the current transport does not produce receipts that reach it. '
       + 'Delivery is a Cloud API fact (statuses[]), and channel_message_events — where a Cloud message would land — '
       + 'is also empty.',
    lie: 'Rendering 0 as a delivery count. "0 delivered" and "no delivery evidence exists" are opposite operational '
       + 'findings, and the second is the true one.',
    drill: { rows: 'whatsapp_delivery_events', predicate: 'no writer produces these rows today' } },

  { panel: 'messaging', metric: 'send_failed', label: 'Failed to send',
    accessor: 'nexus_truth_messaging', field: 'sends_failed', unit: 'sends',
    forced: 'NOT_COMPUTABLE',
    as_of_field: 'newest_message_at', stale_after: null,
    why: 'Outbound messages a provider refused or a transport dropped.',
    absence: 'channel_send_directive — the table holding send_result (ACCEPTED_BY_PROVIDER / REJECTED_BY_PROVIDER / '
       + 'TRANSPORT_ERROR / PENDING) — holds no rows. The messaging layer is built and has never carried a message.',
    lie: 'Substituting v_workflow_health failures for the WhatsApp agent as "messages failed". A workflow run failing '
       + 'is not a message failing; the same run can fail after a message was delivered.',
    drill: { rows: 'channel_send_directive', predicate: "send_result in ('REJECTED_BY_PROVIDER','TRANSPORT_ERROR')" } },

  { panel: 'messaging', metric: 'retrying', label: 'Retrying',
    accessor: 'nexus_truth_messaging', field: 'sends_pending', unit: 'sends',
    forced: 'NOT_COMPUTABLE',
    as_of_field: 'newest_message_at', stale_after: null,
    why: 'Sends in flight on a retry.',
    absence: "send_result = 'PENDING' is the only retry-shaped state and its table is empty. On the inbound side a "
       + 'redelivery is ABSORBED by the idempotency claim and leaves no trace that it happened.',
    lie: 'Counting duplicate n8n executions as retries. Before 6 September that number was the second WAHA host, not '
       + 'a retry, and the two have opposite remedies.',
    drill: { rows: 'channel_send_directive', predicate: "send_result = 'PENDING'" } },

  /* ── Panel 4 · Revenue. Six words, six evidentiary standards. ──────────── */
  { panel: 'revenue', metric: 'detected', label: 'detected', word_rank: 1,
    accessor: 'nexus_truth_revenue', field: 'detected_count', unit: 'occurrences',
    money: false,
    as_of_field: 'computed_at', stale_after: null,
    standard: 'A row in a state view, with the basis it was derived from. Nothing about money.',
    why: 'NEXUS noticed a situation. An OCCURRENCE, never an amount.',
    lie: 'Attaching a value to a detection. There is no per-lead value input — budget_aed is null on every lead.',
    drill: { rows: 'v_needs_attention', predicate: 'every open occurrence' } },

  { panel: 'revenue', metric: 'estimated', label: 'estimated', word_rank: 2,
    accessor: 'nexus_truth_revenue', field: 'estimated_aed', unit: 'AED',
    partner_field: 'estimated_inputs_present',
    money: true, forced: 'UNKNOWN',
    as_of_field: 'computed_at', stale_after: null,
    standard: 'The input value present, the basis named, and the word "estimated" attached wherever it is rendered.',
    why: 'A monetary figure NEXUS computed from a stated input that is not a transaction — a budget the customer '
       + 'named, a list price.',
    absence: 'Every input is absent. The mechanism exists (v_lead_recovery.opportunity_value_state / _basis); the '
       + 'data does not. Zero inputs present.',
    lie: 'coalesce(sum(budget_aed), 0), which returns 0 and is indistinguishable on a tile from "this pipeline is '
       + 'worth nothing". UNKNOWN ≠ ZERO is a house rule because of exactly this expression, and it is forbidden here.',
    drill: { rows: 'leads', predicate: 'budget_aed is not null' } },

  { panel: 'revenue', metric: 'attributed', label: 'attributed', word_rank: 3,
    accessor: 'nexus_truth_revenue', field: 'attributed_aed', unit: 'AED',
    partner_field: 'attributed_sales',
    money: true,
    as_of_field: 'newest_sale_at', stale_after: null,
    standard: 'A purchase_history row with a lead_id, and that lead traceable back to a recorded arrival.',
    why: 'A CONFIRMED sale connected to a specific NEXUS-recorded cause by an unbroken chain of keys.',
    lie: 'Reading leads.source as the channel. It holds the name of the WRITER on most rows. A pie chart of that '
       + "column is a chart of one internal workflow's name, presented as marketing attribution. "
       + 'attribution_edge_type.CAMPAIGN_TO_LEAD is ABSENT_NO_TABLE: no campaigns table, no utm, no click id.',
    drill: { rows: 'purchase_history joined to lead_event', predicate: 'e.lead_id = p.lead_id and e.tenant_id = p.tenant_id' } },

  { panel: 'revenue', metric: 'influenced', label: 'influenced', word_rank: 4,
    accessor: 'nexus_truth_revenue', field: 'influenced_aed', unit: 'AED',
    partner_field: 'influenced_basis',
    money: true,
    as_of_field: 'newest_sale_at', stale_after: null,
    standard: 'A confirmed sale, a lead link, at least one message resolving to that lead by the identity rule — and '
       + 'the basis STATED, because the identity rule is a rule and not a foreign key.',
    why: 'A confirmed sale where NEXUS demonstrably touched the customer, without a claim that the touch caused it.',
    lie: 'Presenting the same amount under both "influenced" and "attributed" without both being labelled and the '
       + "overlap stated. It is one sale. Two words for one number, side by side, doubles it in the reader's head — "
       + 'and that is the specific pattern detected ≠ estimated ≠ attributed exists to stop.',
    drill: { rows: 'communication_logs resolving to the sold lead', predicate: 'identity rule, basis stated per row' } },

  { panel: 'revenue', metric: 'confirmed', label: 'confirmed', word_rank: 5,
    accessor: 'nexus_truth_revenue', field: 'confirmed_aed', unit: 'AED',
    partner_field: 'confirmed_sales',
    money: true,
    as_of_field: 'newest_sale_at', stale_after: null,
    standard: 'A purchase_history row with an amount. There is no edge to break — DEAL_TO_REVENUE is PRESENT_SAME_ROW.',
    why: 'Money the dealership recorded receiving. Revenue, not profit.',
    lie: 'Presenting it as gross profit. attribution_edge_type.DEAL_TO_MARGIN is BLOCKED_BY_UPSTREAM: cost sits on the '
       + 'inventory unit, purchase_history holds no unit reference, so NEXUS can say what the dealership sold for and '
       + 'CANNOT say what it made. Also DEAL_CREATED is PRESENT_CONFLATED — purchase_history only ever records a '
       + 'closed-won deal, so the part of the funnel where deals are LOST is invisible.',
    drill: { rows: 'purchase_history', predicate: 'every recorded sale, newest first' } },

  { panel: 'revenue', metric: 'recovered', label: 'recovered', word_rank: 6,
    accessor: 'nexus_truth_revenue', field: 'recovered_aed', unit: 'AED',
    partner_field: 'recovery_actions_raised',
    money: true, proven_zero: true,
    as_of_field: 'newest_sale_at', stale_after: null,
    standard: 'All four: an action raised by NEXUS, BEFORE the sale, executed, and an outcome recorded against that '
       + 'action by a named person.',
    why: 'A confirmed sale that would not have happened without a NEXUS action. The strongest claim the product makes.',
    lie: 'Counting a sale as recovered because its lead reached the RECOVERED state. lead_recovery_states.RECOVERED '
       + 'means a RECOVERED LEAD, not revenue recovered by NEXUS, and v_lead_recovery.recovery_attribution_state '
       + 'answers SALE_WITHOUT_RECOVERY_ACTION when no action was raised. This is the single most commercially '
       + "dangerous number in the product, and the repository's position — recovered revenue is 0 proven — is "
       + 'CONFIRMED BY MEASUREMENT rather than asserted.',
    drill: { rows: 'lead_recovery_actions and inventory_actions', predicate: "outcome_state = 'ATTRIBUTED'" } },
];

const MANIFEST_BY_METRIC = new Map(MANIFEST.map(m => [m.metric, m]));
const metricsIn = p => MANIFEST.filter(m => m.panel === p);

/* SPEC §5.2: a metric absent from the manifest CANNOT BE DRAWN. Enforced by
   throwing rather than by remembering — a lookup that returned undefined would
   render an empty cell, and an empty cell on this screen reads as a clear. */
function manifestEntry(metric) {
  const m = MANIFEST_BY_METRIC.get(metric);
  if (!m) throw new Error(`system-truth: no manifest entry for metric "${metric}". A metric that is not in the manifest cannot be drawn.`);
  if (!m.drill) throw new Error(`system-truth: manifest entry "${metric}" carries no drill-down. SPEC §4 Rule 3 forbids rendering it.`);
  return m;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION E · The one read path, and how a failure is classified
   ══════════════════════════════════════════════════════════════════════════
   Everything this screen learns about an accessor is learned here, so the
   difference between "this function has not been installed" and "this role may
   not call it" is decided once. Both render as NOT RUN — SPEC §3 — and both
   NAME THE FUNCTION, because the point of the degradation is that the screen
   doubles as its own installation checklist.

   PGRST202 is PostgREST's "function not found in schema cache". 42501 is the
   Postgres refusal, which PostgREST answers with 403. lib/data.js already puts
   the SQLSTATE on `.code` and the HTTP status on `.status`, so nothing here
   parses an error string — this repository has been burned by a check that
   string-matched one spelling of a value.

   THE SWAP FOR THE VENDOR DEPLOYMENT IS THIS FUNCTION AND NOTHING ELSE. Today
   it goes through lib/data.js's db(), which presents the signed-in session's
   JWT. In the vendor plane it must POST to the proxy that holds
   SUPABASE_SERVICE_ROLE and exposes exactly these ten names by body. No call
   site below changes. */

const ACCESSOR_STATE = {
  OK: 'OK',
  MISSING: 'MISSING',            /* the function is not installed */
  REFUSED: 'REFUSED',            /* installed, and this role may not execute it */
  UNREACHABLE: 'UNREACHABLE',    /* the request produced no response */
  FAILED: 'FAILED',              /* something else, and this screen will not guess */
};

function classifyAccessorFailure(err) {
  const code = str(err && err.code);
  const status = Number(err && err.status);
  if (code === 'PGRST202' || status === 404) return ACCESSOR_STATE.MISSING;
  if (code === '42501' || status === 403) return ACCESSOR_STATE.REFUSED;
  if (str(err && err.nexusErrorCase) === 'offline') return ACCESSOR_STATE.UNREACHABLE;
  if (str(err && err.nexusErrorCase) === 'session') return ACCESSOR_STATE.UNREACHABLE;
  return ACCESSOR_STATE.FAILED;
}

/* The sentence a reader can act on, per failure, naming the function. */
function accessorSentence(fn, kind, err) {
  const name = mono(fn + '()');
  switch (kind) {
    case ACCESSOR_STATE.MISSING:
      return `${name} is not installed on this database. PostgREST answered PGRST202 — the function is absent from the `
        + 'schema cache. This panel is not empty and it is not clear; it has not been computed. The migration that '
        + 'creates it is named in the header of this file, with its grants.';
    case ACCESSOR_STATE.REFUSED:
      return `${name} exists and this credential may not execute it — SQLSTATE 42501. Every truth accessor is granted `
        + 'to service_role only and revoked from public, anon and authenticated, so a browser session is refused by '
        + 'design. The vendor deployment reads through the service-role proxy; a dealership session reaching this '
        + 'sentence means this module is in a bundle it must not be in.';
    case ACCESSOR_STATE.UNREACHABLE:
      return `${name} could not be reached, so nothing was computed. The request produced no answer at all — this is `
        + 'not a statement about the accessor, and certainly not about the data behind it.';
    default:
      return `${name} answered in a way this screen cannot place`
        + (str(err && err.status) ? ` (HTTP ${esc(str(err.status))}${str(err.code) ? `, SQLSTATE ${esc(str(err.code))}` : ''})` : '')
        + '. Nothing is being claimed either way. A guess dressed as a diagnosis would be worse than the admission.';
  }
}

/* One accessor, read once per render. `args` is a plain object; it is encoded as
   PostgREST query parameters, matching how every other screen in this codebase
   calls a read-only function (screens/compliance.js is the closest example). */
async function truthRead(fn, args) {
  const q = args && Object.keys(args).length
    ? '?' + Object.entries(args)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const rows = await db(`rpc/${fn}${q}`);
  return Array.isArray(rows) ? rows : (rows == null ? [] : [rows]);
}

/* The memo is per RENDER and not per page load, for the reason
   screens/lead-sources.js and screens/money-leaks.js both record: a
   module-scoped memo that is never cleared re-renders the previous answer under
   a caption saying it was re-read, and survives the re-auth path that does not
   reload the page. Here the second risk is the graver one — this screen
   aggregates across dealerships, so a stale answer is a stale answer about
   somebody else's business. */
const MEMOS = new Set();
const sharedRead = (fn, args) => {
  let p = null;
  const f = () => {
    if (!p) {
      p = settle(truthRead(fn, args)).then(r => ({
        fn,
        rows: r.err ? null : r.v,
        kind: r.err ? classifyAccessorFailure(r.err) : ACCESSOR_STATE.OK,
        err: r.err,
      }));
    }
    return p;
  };
  MEMOS.add(() => { p = null; });
  return f;
};
const resetReads = () => { MEMOS.forEach(reset => reset()); };
onIdentityChange(resetReads);

const readSources    = sharedRead('nexus_truth_source_funnel');
const readMessaging  = sharedRead('nexus_truth_messaging');
const readRevenue    = sharedRead('nexus_truth_revenue');
const readAi         = sharedRead('nexus_truth_ai');
const readFreshness  = sharedRead('nexus_truth_freshness');
const readManifest   = sharedRead('nexus_truth_manifest');
const readWorkflows  = sharedRead('nexus_truth_workflows');
const readUnregWrit  = sharedRead('nexus_truth_unregistered_writers');
const readPlatform   = sharedRead('nexus_truth_platform_state');
const readRefusals   = sharedRead('nexus_truth_refusals');

const ALL_ACCESSORS = [
  { fn: 'nexus_truth_source_funnel', read: readSources, panel: 'Sources' },
  { fn: 'nexus_truth_ai', read: readAi, panel: 'AI' },
  { fn: 'nexus_truth_messaging', read: readMessaging, panel: 'Messaging' },
  { fn: 'nexus_truth_revenue', read: readRevenue, panel: 'Revenue' },
  { fn: 'nexus_truth_workflows', read: readWorkflows, panel: 'Workflows' },
  { fn: 'nexus_truth_unregistered_writers', read: readUnregWrit, panel: 'Workflows' },
  { fn: 'nexus_truth_platform_state', read: readPlatform, panel: 'Workflows' },
  { fn: 'nexus_truth_refusals', read: readRefusals, panel: 'Refusals' },
  { fn: 'nexus_truth_freshness', read: readFreshness, panel: 'every panel (ages)' },
  { fn: 'nexus_truth_manifest', read: readManifest, panel: 'every panel (labels and rules)' },
];

/* ══════════════════════════════════════════════════════════════════════════
   SECTION F · Age — SPEC §4, Rule 4
   ══════════════════════════════════════════════════════════════════════════
   Every figure shows its age. Not as a footnote: SPEC's own measurement is that
   Sources was a day and a half stale while Messaging was minutes old, and
   rendered without ages the panels read as one snapshot of one moment. They are
   not.

   The replacement half of Rule 4 — above `stale_after`, the age REPLACES the
   value — is implemented and inert, because no threshold has been chosen. Every
   manifest entry carries `stale_after: null` and the cell says so, rather than
   this file inventing a normal for a system that has not carried traffic. */
function ageLine(asOf, staleAfterMs) {
  if (!asOf) {
    return warm('This figure carries no timestamp, so how old it is cannot be said. An age that is not recorded is not '
      + 'an age of zero.');
  }
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) {
    return warm(`The timestamp on this figure could not be read (${esc(str(asOf))}), so its age is unknown.`);
  }
  const age = Date.now() - t;
  const stamp = dubaiStamp(asOf);
  if (staleAfterMs == null) {
    return muted(`Newest row behind this figure: <span title="${esc(stamp)}">${esc(ago(asOf))}</span>. `
      + 'No staleness tolerance has been chosen for it, so the age is stated and never hides the number — choosing a '
      + 'threshold before this system has carried traffic would be inventing a normal.');
  }
  return age > staleAfterMs
    ? hot(`STALE — the newest row behind this figure is <span title="${esc(stamp)}">${esc(ago(asOf))}</span>, past `
      + 'the tolerance set for it. The value is withheld rather than shown beside a warning.')
    : muted(`Newest row behind this figure: <span title="${esc(stamp)}">${esc(ago(asOf))}</span>, within tolerance.`);
}
function isStale(asOf, staleAfterMs) {
  if (staleAfterMs == null || !asOf) return false;
  const t = Date.parse(asOf);
  return !Number.isNaN(t) && (Date.now() - t) > staleAfterMs;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION G · cell() — the ONLY path from a number to the DOM
   ══════════════════════════════════════════════════════════════════════════
   SPEC §4, Rules 1, 3 and 4 all live inside this function, and they live here
   rather than in the panels for one reason: a rule that lives in a panel is a
   convention, and a convention survives exactly as long as the person who wrote
   it. Nothing below this section interpolates a value into a template literal.

   Three refusals, all of them throws rather than silent fallbacks:
     · a metric with no manifest entry cannot be drawn;
     · a metric with no drill-down cannot be drawn;
     · a state that is not `numeral: true` never touches `value`.

   The `.num` node is emitted on exactly one branch, and it always carries
   `data-drill`. That is what makes gate check T4 — "every .num node carries a
   non-empty data-drill, and following it returns the rendered count" —
   mechanical rather than a review. */
function cell({ metric, state, value, partner, as_of, notRun }) {
  const m = manifestEntry(metric);
  const rs = renderState(state);
  if (!rs) {
    /* A state this screen does not know is a FAULT, not a blank. The same rule
       screens/lead-sources.js applies to a lead phase, applied to the thing that
       decides whether a numeral may be printed at all. */
    return `<div class="kpi-value">${pill('STATE NOT RECOGNISED', 'hot', { verbatim: false })}</div>`
      + hot(`The accessor returned a state this screen has no branch for: “${esc(str(state) || 'nothing at all')}”, `
        + 'shown exactly as it stands. Nothing is claimed about this metric in either direction, and it is deliberately '
        + 'not folded into a state it might mean.');
  }

  const staleMs = m.stale_after == null ? null : m.stale_after;
  const drillKey = `${m.panel}:${m.metric}`;

  /* Rule 1. Not a numeral, so `value` is not read on this path at all. */
  if (!rs.numeral || isStale(as_of, staleMs)) {
    const word = m.override_word || rs.word || 'NOT AVAILABLE';
    const body = state === 'NOT_RUN'
      ? hot(notRun || 'The query for this figure did not execute.')
      : (m.absence ? muted(esc(m.absence)) : '');
    return `<div class="kpi-value">${pill(word, rs.tone, { verbatim: false })}</div>`
      + muted(esc(m.why))
      + body
      + (m.lie ? muted(`<span style="font-weight:600">The plausible wrong answer:</span> ${esc(m.lie)}`) : '')
      + drillNote(m, drillKey, null)
      + ageLine(as_of, staleMs);
  }

  /* Rule 1, the other half. A numeral, and it must have come from a read. */
  const n = n0(value);
  if (n == null) {
    return `<div class="kpi-value">${pill('NO VALUE RETURNED', 'hot', { verbatim: false })}</div>`
      + hot(`${esc(m.accessor || 'the accessor')} answered, and the field ${esc(str(m.field) || 'for this metric')} was `
        + 'absent or unreadable in the row it returned. A state of MEASURED with no number behind it is a contradiction, '
        + 'and it is reported rather than rendered as a zero.')
      + ageLine(as_of, staleMs);
  }

  const shown = m.money ? `AED ${num(n)}` : num(n);
  const provenMark = state === 'PROVEN_ZERO'
    ? ` <span class="pill ok"><span class="dot"></span>proven</span>`
    : '';
  const partialMark = state === 'PARTIAL'
    ? ` <span class="pill warm"><span class="dot"></span>PARTIAL</span>`
    : '';

  /* Rule 3. `data-drill` on the numeral itself, not on the card. */
  const numeral = `<span class="num" data-drill="${esc(drillKey)}" role="button" tabindex="0" `
    + `title="Open the rows behind this figure">${esc(shown)}</span>`;

  const qualifier = rs.requires_qualifier
    ? (m.qualifier
        ? warm(esc(m.qualifier))
        : hot('This state requires a qualifier and the manifest entry carries none, so the figure is reported as '
            + 'unqualified rather than shown as if it stood alone.'))
    : '';

  return `<div class="kpi-value">${numeral}${provenMark}${partialMark}</div>`
    + muted(esc(m.why))
    + qualifier
    + (partner != null ? muted(esc(partnerLine(m, partner))) : '')
    + (m.lie ? muted(`<span style="font-weight:600">The plausible wrong answer:</span> ${esc(m.lie)}`) : '')
    + drillNote(m, drillKey, n)
    + ageLine(as_of, staleMs);
}

function partnerLine(m, partner) {
  if (m.metric === 'recovered') {
    return `${num(partner)} recovery ${plural(partner, 'action has', 'actions have')} ever been raised. That count is `
      + 'printed beside the zero so that "0 proven" is visibly a statement about EVIDENCE and not about the '
      + "dealership's performance.";
  }
  if (m.metric === 'estimated') return `${num(partner)} leads carry a budget input.`;
  if (m.metric === 'failed') return `${num(partner)} of those are hydration errors.`;
  if (m.metric === 'replies') return `${num(partner)} outbound rows record nothing about who sent them.`;
  if (m.partner_field) return `${esc(m.partner_field)}: ${num(partner)}.`;
  return `Second figure: ${num(partner)}.`;
}

/* Rule 3, stated on the cell rather than assumed. Where rows CAN be shown, the
   cell says which relation and predicate the drill re-runs — the headline and
   the row list are then two evaluations of one expression, and a disagreement
   between them is visible rather than argued about. Where rows CANNOT be shown,
   the cell says so, which is what makes the four uncomputable AI metrics render
   as named absences instead of as numbers. */
function drillNote(m, key, n) {
  if (m.drill.rows === 'NONE') {
    return muted(`<span style="font-weight:600">No rows to open.</span> ${esc(m.drill.predicate)}. Under the rule that `
      + 'every number is clickable through to the rows behind it, a metric with no rows cannot be rendered as a number '
      + 'at all — which is the correct shape for this one.');
  }
  return muted(`<span style="font-weight:600">Behind this figure:</span> ${esc(m.drill.rows)} — `
    + `${esc(m.drill.predicate)}.`
    + (n == null ? ' Nothing to open until the accessor answers.' : ' Click the figure to open them.'));
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION H · funnel() — SPEC §4, Rule 2
   ══════════════════════════════════════════════════════════════════════════
   A funnel shows its DROP-OFFS, not only its top and bottom. Three things are
   enforced here and each of them is a defect this replaces:

     · fewer than three stages throws. Two stages is a pair of numbers wearing
       a funnel's clothes.
     · the delta between each adjacent pair is its OWN element with its own
       label. `36 → 31` and `36 arrived, 31 logged, 5 lost` are the same two
       numbers and only one of them is a finding.
     · where two adjacent stages are not BOTH measured, the link renders as
       broken and carries the reason. It does not skip to the next measurable
       pair, because skipping produces a shorter funnel that looks complete.

   One check the specification implies and does not state: a stage that is
   LARGER than the one before it is a fault, not a drop-off. SPEC's own Sources
   reading rises from authenticated back up to normalised, which means the
   stages are not nested sets and the word "funnel" is doing work it has not
   earned. That is rendered as a fault rather than as a negative drop. */
function funnel(stages) {
  if (!Array.isArray(stages) || stages.length < 3) {
    throw new Error('system-truth: a funnel needs at least three stages. Two stages is a top and a bottom, which is the '
      + 'shape this rule exists to forbid.');
  }
  const parts = [];
  stages.forEach((s, i) => {
    parts.push(`<div class="kpi"><div class="label-caps">${esc(s.label)}</div>${s.html}</div>`);
    if (i < stages.length - 1) parts.push(link(s, stages[i + 1]));
  });
  return `<div class="grid" style="gap:12px">${parts.join('')}</div>`;
}

function link(a, b) {
  const both = a.state === 'MEASURED' && b.state === 'MEASURED';
  if (!both) {
    const which = a.state !== 'MEASURED' ? a.label : b.label;
    const st = a.state !== 'MEASURED' ? a.state : b.state;
    const word = (renderState(st) || {}).word || st;
    return `<div class="banner warm" style="margin:0">
      <span class="material-symbols-outlined" style="font-size:20px">link_off</span>
      <div>${bold(`Broken link — ${esc(a.label)} to ${esc(b.label)}`)}
        ${muted(`${esc(which)} is ${esc(String(word))}, so the drop between these two stages cannot be computed. `
          + 'This link is drawn broken rather than skipped: skipping to the next measurable pair would produce a '
          + 'shorter funnel that looks complete.')}</div></div>`;
  }
  const x = n0(a.value);
  const y = n0(b.value);
  if (x == null || y == null) {
    return `<div class="banner warm" style="margin:0">
      <span class="material-symbols-outlined" style="font-size:20px">link_off</span>
      <div>${bold(`Broken link — ${esc(a.label)} to ${esc(b.label)}`)}
        ${muted('Both stages report as measured and at least one returned no number, which is a contradiction and is '
          + 'reported as one.')}</div></div>`;
  }
  const d = x - y;
  if (d < 0) {
    return `<div class="banner hot" style="margin:0">
      <span class="material-symbols-outlined" style="font-size:20px">report</span>
      <div>${bold(`FAULT — ${esc(b.label)} exceeds ${esc(a.label)} by ${esc(num(-d))}`)}
        ${muted('A later stage cannot hold more than the one before it unless the two are measuring different sets. '
          + 'This is not a negative drop-off and it is not rendered as one — it says the stages are not nested, and '
          + 'until that is reconciled the word "funnel" is doing work it has not earned.')}</div></div>`;
  }
  return `<div class="banner ${d > 0 ? 'warm' : 'info'}" style="margin:0">
    <span class="material-symbols-outlined" style="font-size:20px">${d > 0 ? 'trending_down' : 'trending_flat'}</span>
    <div>${bold(d > 0
        ? `${esc(num(d))} lost between ${esc(a.label)} and ${esc(b.label)}`
        : `Nothing lost between ${esc(a.label)} and ${esc(b.label)}`)}
      ${muted(d > 0
        ? `${esc(num(x))} reached ${esc(a.label)} and ${esc(num(y))} reached ${esc(b.label)}. The drop is the finding; `
          + 'the two ends on their own are not.'
        : `${esc(num(x))} at both stages. A zero drop over a stated denominator, which is a measurement — not the `
          + 'absence of one.')}</div></div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION I · rate() — a denominator too small to support a rate
   ══════════════════════════════════════════════════════════════════════════
   The repository records `v_team_performance` reporting "average first response
   1 minute, 100% within SLA" over ONE assigned lead — and that lead is a wrong
   number asking about solar mounting hardware (ops/pilot-readiness/BLOCKERS.md
   §1.3). A percentage over one row is not a rate; it is one row wearing a
   percentage.

   So this returns null below a floor, the caller renders the raw numbers, and
   the refusal is stated. The floor is deliberately conservative and deliberately
   arguable — what is NOT arguable is that a screen may compute a percentage
   over a denominator it can count on one hand. */
const RATE_FLOOR = 30;
function rate(numerator, denominator, floor = RATE_FLOOR) {
  const s = n0(numerator);
  const d = n0(denominator);
  if (s == null || d == null || d <= 0) {
    return { ok: false, why: 'NO_DENOMINATOR', pct: null, numerator: s, denominator: d };
  }
  if (d < floor) {
    return { ok: false, why: 'DENOMINATOR_TOO_SMALL', pct: null, numerator: s, denominator: d, floor };
  }
  return { ok: true, why: null, pct: (s / d) * 100, numerator: s, denominator: d };
}
function rateCell(label, r) {
  if (r.ok) {
    return bold(`${esc(label)}: ${esc(r.pct.toFixed(1))}%`)
      + muted(`${esc(num(r.numerator))} of ${esc(num(r.denominator))}.`);
  }
  if (r.why === 'NO_DENOMINATOR') {
    return bold(esc(label)) + hot('No denominator, so there is no rate. This is not 0% and it is not 100%.');
  }
  return bold(`${esc(label)}: ${esc(num(r.numerator))} of ${esc(num(r.denominator))}`)
    + warm(`The rate is REFUSED rather than computed: ${esc(num(r.denominator))} is below the `
      + `${esc(num(r.floor))} this screen requires before it will divide. A percentage over a handful of rows swings `
      + 'by tens of points on one row and reads as a measurement. The raw numbers are shown instead, and they are the '
      + 'honest form of this figure today.');
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION J · Per-panel degradation
   ══════════════════════════════════════════════════════════════════════════
   The rule the whole screen turns on: a panel whose accessor did not answer
   must not render as empty. An empty panel reads as an all-clear, and on this
   screen an all-clear is the one thing that must never be accidental.

   So a missing accessor produces a panel that is FULLER than a working one: the
   metrics it would have carried, each as NOT RUN, each naming what is missing.
   That is what makes the screen useful before any of it is installed — it is
   its own installation checklist. */
function accessorBanner(res, extra) {
  const kind = res.kind;
  const tone = kind === ACCESSOR_STATE.MISSING ? 'warm' : 'hot';
  const head = kind === ACCESSOR_STATE.MISSING
    ? 'NOT RUN — this panel’s accessor is not installed'
    : kind === ACCESSOR_STATE.REFUSED
      ? 'NOT RUN — this credential may not execute this panel’s accessor'
      : 'NOT RUN — this panel’s accessor did not answer';
  return `<div class="banner ${tone}" style="margin-bottom:16px">
    <span class="material-symbols-outlined" style="font-size:20px">${kind === ACCESSOR_STATE.MISSING ? 'download' : 'report'}</span>
    <div>${bold(head)}
      ${muted(accessorSentence(res.fn, kind, res.err))}
      ${muted('Nothing below is a zero. Every figure in this panel is an unknown, and none of them is a clear.')}
      ${extra ? muted(esc(extra)) : ''}</div></div>`;
}

/* One row of the accessor answer per dealership. SPEC §5.1: the accessors group
   by tenant and never return a bare cross-tenant total — a total is a sum of
   VISIBLE rows, computed here from rows the reader can see, not a query with
   the tenant predicate left off, which would silently include the quarantine
   tenant. This function is that sum, and it is the only place one is made. */
function sumAcross(rows, field) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let total = 0;
  let counted = 0;
  rows.forEach(r => {
    const v = n0(r && r[field]);
    if (v != null) { total += v; counted += 1; }
  });
  return counted ? { total, counted, of: rows.length } : null;
}
function newestAcross(rows, field) {
  if (!Array.isArray(rows)) return null;
  let best = null;
  rows.forEach(r => {
    const v = r && r[field];
    if (!v) return;
    const t = Date.parse(v);
    if (Number.isNaN(t)) return;
    if (best == null || t > Date.parse(best)) best = v;
  });
  return best;
}

/* The value + state a cell needs, derived from one accessor answer. This is the
   only place a state is decided, and it decides it from what the READ returned —
   never from the manifest, which carries no states on purpose. */
function figureFor(m, res) {
  if (!res || res.kind !== ACCESSOR_STATE.OK) {
    return { state: 'NOT_RUN', value: null, partner: null, as_of: null,
             notRun: accessorSentence(m.accessor || (res && res.fn) || 'the accessor', res ? res.kind : ACCESSOR_STATE.FAILED, res && res.err) };
  }
  if (m.forced) {
    const agg = m.field ? sumAcross(res.rows, m.field) : null;
    const partner = m.partner_field ? sumAcross(res.rows, m.partner_field) : null;
    return {
      state: m.forced,
      value: agg ? agg.total : null,
      partner: partner ? partner.total : null,
      as_of: m.as_of_field ? newestAcross(res.rows, m.as_of_field) : null,
    };
  }
  const agg = sumAcross(res.rows, m.field);
  if (!agg) {
    return { state: 'UNKNOWN', value: null, partner: null,
             as_of: m.as_of_field ? newestAcross(res.rows, m.as_of_field) : null };
  }
  const partner = m.partner_field ? sumAcross(res.rows, m.partner_field) : null;
  /* PROVEN_ZERO, and it is the accessor's answer that earns it, not this file's
     opinion: the value is zero AND the accessor returned the count of evidence
     that would have made it non-zero. Without that second figure it is an
     ordinary unqualified zero and is rendered as one. */
  const provenZero = m.proven_zero && agg.total === 0 && partner != null;
  return {
    state: provenZero ? 'PROVEN_ZERO' : 'MEASURED',
    value: agg.total,
    partner: partner ? partner.total : null,
    as_of: m.as_of_field ? newestAcross(res.rows, m.as_of_field) : null,
  };
}

/* One tile. Every metric on this screen goes through here, and here goes
   through cell(), so there is exactly one path from a figure to the page.

   It builds the `.kpi` markup rather than calling lib/ui.js's kpi(). That is
   not a preference: kpi() puts its `value` argument INSIDE `.kpi-value`, and
   cell() returns a `.kpi-value` block followed by several explanatory lines —
   the reasons, the plausible wrong answer, the drill-down and the age — which
   are the parts of this screen that stop a figure being read as more than it
   is. Nesting them inside the numeral's own element would shrink them into the
   number's typography (kpi() also measures the string's length to decide
   whether to shrink the face, and every cell here is long). The sublines are
   not decoration on the number; on this screen they are half the number. */
function tile(metric, res) {
  const m = manifestEntry(metric);
  const f = figureFor(m, res);
  return `<div class="kpi"><div class="label-caps">${esc(m.label)}</div>${cell({ metric, ...f })}</div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION K · Drill-down
   ══════════════════════════════════════════════════════════════════════════
   SPEC's Unknowns §7 states a boundary this screen does not solve and must not
   pretend to: every accessor returns counts and states and never customer rows,
   but a drill-down into communication_logs shows MESSAGE TEXT — and
   CONTROL-PLANE.md §2.4 warns that the moment a support screen renders a
   customer's content beside a project reference, the control plane has become a
   console into the dealership's business.

   So the drill-down opens and shows what it WOULD read, and refuses to read it.
   That is not a placeholder waiting to be filled in: the two candidate designs
   are a narrower vendor role, or a drill that returns row IDENTIFIERS and
   timestamps only, and neither has been decided. Wiring a service-role read
   through here before that decision is made is how the boundary gets crossed by
   a convenience. */
function wireDrills(card) {
  card.querySelectorAll('[data-drill]').forEach(node => {
    const open = () => {
      const key = str(node.dataset.drill);
      const metric = key.split(':')[1];
      let m = null;
      try { m = manifestEntry(metric); } catch { m = null; }
      if (!m) return;
      openDrawer(`<div class="drawer-head"><div>
          <div class="card-title">${esc(m.label)}</div>
          <div class="card-sub">The rows behind this figure</div>
        </div></div>
        <div class="drawer-body">
          <div class="banner warm">
            <span class="material-symbols-outlined" style="font-size:20px">gpp_maybe</span>
            <div>${bold('The rows are not shown, and that is a decision rather than a gap.')}
              ${muted('Every accessor on this screen returns counts and states and never customer rows. A drill-down '
                + 'into the conversation ledger would show message text, and the control-plane boundary says platform '
                + 'telemetry is the vendor’s while customer content is the dealership’s, reachable only through an '
                + 'audited support path. Two designs would satisfy both — a narrower vendor role, or a drill that '
                + 'returns row identifiers and timestamps only — and neither has been decided. Until one is, this '
                + 'drawer states the query instead of running it.')}</div></div>
          <dl class="kv">
            <dt>Relation</dt><dd>${mono(m.drill.rows)}</dd>
            <dt>Predicate</dt><dd>${mono(m.drill.predicate)}</dd>
            <dt>Accessor</dt><dd>${m.accessor ? mono(m.accessor + '()') : esc('none — this metric has no accessor')}</dd>
            <dt>Field</dt><dd>${m.field ? mono(m.field) : esc('none')}</dd>
          </dl>
          ${muted('The headline and this row list are meant to be two evaluations of ONE expression, so that a '
            + 'disagreement between them is visible rather than argued about. That is the point of re-running the '
            + 'same predicate rather than writing a second query for the drawer.')}
        </div>`);
    };
    node.addEventListener('click', open);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION L · The screen
   ══════════════════════════════════════════════════════════════════════════ */

/* The latch from §3 of the header. Registered unconditionally so that a build
   which imports this module by accident gets a refusal rather than nothing at
   all — a screen id that renders blank is indistinguishable from a bug, and the
   reader of a dealer bundle deserves to be told this screen is not theirs
   rather than left guessing. It reads nothing: no accessor is called on this
   path, and no fetch is issued. */
if (!IS_VENDOR_PLANE) {
  SCREENS.systemtruth = async host => {
    host.innerHTML = `<div class="state err">
      <span class="material-symbols-outlined">shield_lock</span>
      <h3>System Truth is vendor telemetry and is not part of this application</h3>
      <p>This screen aggregates platform health across every dealership NEXUS runs, which is the vendor’s side of the
         glass and not a dealership’s. This build does not declare itself the vendor plane, so nothing has been read:
         no query was issued, no accessor was called, and nothing about any dealership — this one or any other — has
         been loaded into this page.</p>
      <p>If you are seeing this inside a dealership’s dashboard, the module has been bundled somewhere it should not
         be. That is a build to correct, not a permission to grant.</p></div>`;
  };
} else {

SCREENS.systemtruth = async host => {
  /* Every visit re-reads. A stale platform figure is worse than a slow one, and
     on a screen that aggregates across dealerships a memo that outlives the
     render is a memo about somebody else's business. */
  resetReads();

  /* ────────────────────────────────────────────────────────────────────────
     P0 · What this screen is, what it is not, and the five renderings
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'NEXUS System Truth — vendor telemetry',
    sub: 'Platform health for the vendor, aggregated across every dealership NEXUS runs. This is not a dealership '
       + 'view and no dealership may reach it',
    load: async () => {
      const results = await Promise.all(ALL_ACCESSORS.map(a => a.read()));
      return { results };
    },
    render: ({ results }) => {
      const notRun = results.filter(r => r.kind !== ACCESSOR_STATE.OK);
      /* SPEC §3: the header cannot read healthy while any panel is NOT RUN.
         There is no branch below that produces a green overall state, and there
         will not be one until every accessor answers. */
      const overall = notRun.length
        ? `<div class="banner hot">
             <span class="material-symbols-outlined" style="font-size:20px">report</span>
             <div>${bold(`${num(notRun.length)} of ${num(results.length)} accessors did not run.`)}
               ${muted('This screen cannot report healthy while any of them is in that state. NOT RUN is not a pass — '
                 + 'the same rule the quality gate holds, where a check that did not execute is a distinct record from '
                 + 'one that passed and a P0 in that state does not produce a clean exit. Every panel below says which '
                 + 'function it is waiting for.')}
               ${muted(notRun.map(r => `${r.fn}()`).join(' · '))}</div></div>`
        : `<div class="banner info">
             <span class="material-symbols-outlined" style="font-size:20px">check_circle</span>
             <div>${bold('Every accessor answered.')}
               ${muted('That is a statement about the READS, not about the platform. Several metrics below are '
                 + 'uncomputable whatever the accessors return, because the writer that would produce their rows does '
                 + 'not exist.')}</div></div>`;

      const legend = `<div class="banner info" style="margin-top:16px">
        <span class="material-symbols-outlined" style="font-size:20px">rule</span>
        <div>${bold('The five renderings on this screen, which must never be mistaken for one another.')}
          ${muted('A zero is a finding. An unknown is not a zero. An uncomputable metric is not an unknown. A query '
            + 'that did not run is none of the three. This codebase has rendered an absence as a zero in six separate '
            + 'places, which is why they are drawn differently and why the difference is printed here rather than '
            + 'only described in a document.')}
          <div class="grid g5" style="margin-top:12px;gap:12px">
            ${legendTile('0', 'MEASURED', 'A numeral, with the denominator it was measured over and the age of the newest row behind it. The only rendering that prints a digit on its own.')}
            ${legendTile('0 <span class="pill ok"><span class="dot"></span>proven</span>', 'PROVEN ZERO', 'A zero that was verified, with the evidence beside it. Recovered revenue is the case this exists for: nought, and measured to be nought.')}
            ${legendTile(`${pill('NOT MEASURED', 'warm', { verbatim: false })}`, 'UNKNOWN', 'The mechanism exists and every input is absent. A word, never a numeral — coalesce(sum(x), 0) is the expression this rendering forbids.')}
            ${legendTile(`${pill('NOT COMPUTABLE', 'unknown', { verbatim: false })}`, 'NOT COMPUTABLE', 'Nothing in the schema can express it. No query would make it appear; a column, a table or a writer is missing, and the cell names which.')}
            ${legendTile(`${pill('NOT RUN', 'hot', { verbatim: false })}`, 'NOT RUN', 'The query did not execute. The accessor and the SQLSTATE are named, so the screen doubles as its own installation checklist.')}
          </div></div></div>`;

      const boundary = `<div class="banner warm" style="margin-top:16px">
        <span class="material-symbols-outlined" style="font-size:20px">shield</span>
        <div>${bold('The boundary this screen sits on.')}
          ${muted('Platform telemetry is the vendor’s. Customer content is the dealership’s. Every accessor here '
            + 'returns counts and states and never customer rows, and the drill-downs state their query rather than '
            + 'running it, because a drill into the conversation ledger shows message text and that decision has not '
            + 'been taken. A dealership must never see this screen and must never learn from it that another '
            + 'dealership exists.')}
          ${muted('This screen computes no status ladder. One figure, one derivation — '
            + 'ops/evidence-standard/STATUS-LADDER.md is that derivation, and a second copy here would go stale '
            + 'silently.')}</div></div>`;

      const manifestRes = results.find(r => r.fn === 'nexus_truth_manifest');
      const freshRes = results.find(r => r.fn === 'nexus_truth_freshness');

      return overall + legend + boundary
        + manifestNote() + manifestDiff(manifestRes)
        + freshnessSection(freshRes);
    },
  });

  /* ────────────────────────────────────────────────────────────────────────
     P1 · Sources — the arrival funnel and its drop-offs
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'Sources — is ingestion working',
    sub: 'A question about NEXUS, not about any one dealership. The drops between the stages are the finding; the two '
       + 'ends on their own are not',
    load: () => readSources(),
    render: res => {
      const head = res.kind === ACCESSOR_STATE.OK
        ? ''
        : accessorBanner(res, 'Every stage below renders NOT RUN and the links between them render broken, which is '
            + 'the correct shape: a funnel drawn from an unanswered query is not a funnel with nothing in it.');

      const stageOf = metric => {
        const m = manifestEntry(metric);
        const f = figureFor(m, res);
        return { label: m.label, state: f.state, value: f.value, html: cell({ metric, ...f }) };
      };

      let funnelHtml;
      try {
        funnelHtml = funnel([
          stageOf('received'), stageOf('authenticated'), stageOf('normalized'), stageOf('promoted'),
        ]);
      } catch (e) {
        funnelHtml = `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">report</span>
          <div>${bold('The funnel refused to draw itself.')}${muted(esc(str(e && e.message)))}</div></div>`;
      }

      const rest = ['held', 'quarantined_arrival', 'quarantined_tenant', 'quarantined_evidence', 'failed', 'unlinked_leads']
        .map(k => tile(k, res)).join('');

      const guaranteed = `<div class="banner info" style="margin-top:16px">
        <span class="material-symbols-outlined" style="font-size:20px">lock</span>
        <div>${bold('Promotions with no lead behind them: guaranteed zero, and shown as guaranteed rather than as measured.')}
          ${muted('A CHECK constraint forbids the row, so the number cannot be anything else. "0 unlinked" in this '
            + 'direction is true, meaningless and reassuring — a figure a database constraint guarantees is not a '
            + 'measurement of the system, and it is deliberately not given a tile of its own beside figures that are. '
            + 'The direction that IS a measurement is the one above: leads with no recorded arrival.')}</div></div>`;

      return head + funnelHtml + `<div class="grid g3" style="margin-top:16px">${rest}</div>` + guaranteed;
    },
  }).then(wireDrills);

  /* ────────────────────────────────────────────────────────────────────────
     P2 · AI — the panel that is mostly absence, on purpose
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'AI — what can be said about the classifier',
    sub: 'Four of these six cannot be computed by any query, and that is the most useful thing this panel says. '
       + 'Installing the accessor does not change it',
    load: () => readAi(),
    render: res => {
      const head = res.kind === ACCESSOR_STATE.OK
        ? ''
        : accessorBanner(res, 'Note what the accessor landing would and would not fix here: it would answer the first '
            + 'metric and it would leave the other four exactly as they are, because they have no rows behind them in '
            + 'any table.');

      const tiles = metricsIn('ai').map(m => tile(m.metric, res)).join('');

      const standing = `<div class="banner warm" style="margin-top:16px">
        <span class="material-symbols-outlined" style="font-size:20px">psychology_alt</span>
        <div>${bold('There is no ground truth, so there is no accuracy figure — and there will not be one until there is.')}
          ${muted('A false positive needs a labelled outcome: this lead was scored HOT and was not. The only outcome '
            + 'NEXUS holds is a sale. A false negative is worse than unmeasured, it is structurally unreachable — half '
            + 'of it is leads NEXUS never saw, and a system cannot count what did not arrive. Any false-negative rate '
            + 'computed over the leads NEXUS DOES hold gets better every time ingestion loses one, and a metric that '
            + 'improves when the system loses data must not be on this screen at any state.')}</div></div>`;

      return head + `<div class="grid g3">${tiles}</div>` + standing;
    },
  }).then(wireDrills);

  /* ────────────────────────────────────────────────────────────────────────
     P3 · Messaging — the aligned window, and the drop-off inside it
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'Messaging — arrival, ledger, delivery',
    sub: 'Two counters covering two different windows. Every figure here is over the ALIGNED window or it is not a '
       + 'comparison at all',
    load: () => readMessaging(),
    render: res => {
      const head = res.kind === ACCESSOR_STATE.OK ? '' : accessorBanner(res);

      const aligned = res.kind === ACCESSOR_STATE.OK
        ? alignmentBanner(res.rows)
        : `<div class="banner warm" style="margin-bottom:16px">
             <span class="material-symbols-outlined" style="font-size:20px">timelapse</span>
             <div>${bold('Whether the two counters are on an aligned window cannot be checked.')}
               ${muted('The arrival counter and the conversation ledger begin on different days. Compared across their '
                 + 'natural ranges the ledger holds MORE than ever arrived, which is impossible and is purely the '
                 + 'window mismatch. Until the accessor states window_is_aligned, the comparison is refused rather '
                 + 'than made.')}</div></div>`;

      const stageOf = metric => {
        const m = manifestEntry(metric);
        const f = figureFor(m, res);
        return { label: m.label, state: f.state, value: f.value, html: cell({ metric, ...f }) };
      };

      let funnelHtml;
      try {
        funnelHtml = funnel([stageOf('claims'), stageOf('logged_inbound'), stageOf('delivered')]);
      } catch (e) {
        funnelHtml = `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">report</span>
          <div>${bold('The funnel refused to draw itself.')}${muted(esc(str(e && e.message)))}</div></div>`;
      }

      const gap = tile('claims_without_log', res);
      const rest = ['replies', 'send_failed', 'retrying'].map(k => tile(k, res)).join('');

      /* The drop-off gets its own emphasis because it is the highest-value cell
         on the screen and because it is the one most easily overstated. The
         naive join overstates it several times over, and an overstated defect
         is discredited the first time someone checks it. */
      const gapBand = `<div class="banner warm" style="margin-top:16px">
        <span class="material-symbols-outlined" style="font-size:20px">priority_high</span>
        <div>${bold('The gap between claimed and logged is the highest-value figure on this screen.')}
          ${muted('It is also the easiest to get wrong. Joining the arrival counter to the ledger on the obvious key '
            + 'overstates the loss several times over, because one person’s messages are filed under up to four key '
            + 'shapes as their record matures. The identity rule that resolves them is a RULE, not a foreign key, and '
            + 'it resolves roughly half the ledger; the unresolved half is unknown, not "no conversation".')}</div>
        </div><div class="grid g3" style="margin-top:12px">${gap}</div>`;

      return head + aligned + funnelHtml + gapBand + `<div class="grid g3" style="margin-top:16px">${rest}</div>`;
    },
  }).then(wireDrills);

  /* ────────────────────────────────────────────────────────────────────────
     P4 · Revenue — six words, six standards, never one number
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'Revenue — six words that must never be summed',
    sub: 'detected · estimated · attributed · influenced · confirmed · recovered. Ordered by how much must be true '
       + 'before the word may be used. There is no total on this panel and there is no code path that could make one',
    load: () => readRevenue(),
    render: res => {
      const head = res.kind === ACCESSOR_STATE.OK ? '' : accessorBanner(res);

      const words = metricsIn('revenue')
        .slice()
        .sort((a, b) => a.word_rank - b.word_rank)
        .map(m => {
          const f = figureFor(m, res);
          return `<div class="kpi">
            <div class="label-caps">${esc(m.label)}</div>
            ${cell({ metric: m.metric, ...f })}
            ${muted(`<span style="font-weight:600">Evidence required:</span> ${esc(m.standard)}`)}
          </div>`;
        }).join('');

      /* SPEC R4's plausible lie, stated on the page rather than left to the
         reader: the same amount can legitimately appear under two of these
         words, and two words for one number side by side doubles it in the
         reader's head. There is no arithmetic anywhere on this panel. */
      const overlap = `<div class="banner warm" style="margin-top:16px">
        <span class="material-symbols-outlined" style="font-size:20px">join_inner</span>
        <div>${bold('These six figures overlap and are still not addable.')}
          ${muted('The same sale can appear under "influenced" and under "confirmed" — that is not double counting, it '
            + 'is one sale meeting two different evidentiary standards. Adding any two of these words produces a '
            + 'number no transaction ever had, and it is precisely the pattern the six-word vocabulary exists to stop. '
            + 'Nothing on this panel is summed, and the panel carries no total element for anyone to reach for.')}
          ${muted('Where "attributed" and "influenced" show the same amount, that is one sale under two standards and '
            + 'the overlap is a finding about the CHAIN, not about the money: attribution requires an unbroken chain '
            + 'of keys back to a recorded arrival, and influence requires only a demonstrable touch.')}</div></div>`;

      const recovered = `<div class="banner info" style="margin-top:16px">
        <span class="material-symbols-outlined" style="font-size:20px">fact_check</span>
        <div>${bold('"Recovered" is the strongest claim this product makes, and the repository’s position is that it is 0 proven.')}
          ${muted('That position is verified by measurement rather than repeated: not one recovery action and not one '
            + 'attributed inventory action has ever carried an attributed outcome on production. Four things must all '
            + 'be true before the word may be used — an action raised by NEXUS, raised BEFORE the sale, executed, and '
            + 'an outcome recorded against that action by a named person.')}
          ${muted('A lead reaching the RECOVERED state is not this. That state means a recovered LEAD, and the one sale '
            + 'this database holds resolves to "sale without recovery action" — the lead did reach the state, and no '
            + 'NEXUS action preceded the sale, so nothing was recovered by NEXUS.')}
          ${muted('The tile shows a PROVEN zero when the accessor answers, with the number of actions ever raised '
            + 'beside it, so that "0 proven" is visibly a statement about evidence and not about the dealership’s '
            + 'performance. Until the accessor answers it shows NOT RUN, because a proven zero is a measurement and '
            + 'this screen may not print one it has not taken.')}</div></div>`;

      return head + `<div class="grid g3">${words}</div>` + overlap + recovered;
    },
  }).then(wireDrills);

  /* ────────────────────────────────────────────────────────────────────────
     P5 · Workflows — the panel the owner's sketch does not have
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'Workflows and platform state — the fifth panel',
    sub: 'None of Sources, AI, Messaging or Revenue looks at workflow runs. The database already knows which '
       + 'automations stopped succeeding and nothing renders it to the vendor',
    load: async () => {
      const [w, u, p] = await Promise.all([readWorkflows(), readUnregWrit(), readPlatform()]);
      return { w, u, p };
    },
    render: ({ w, u, p }) => {
      const why = `<div class="banner info" style="margin-bottom:16px">
        <span class="material-symbols-outlined" style="font-size:20px">history</span>
        <div>${bold('Why this panel exists.')}
          ${muted('Of the six defects this repository has already found, this is the one the four sketched panels '
            + 'would have missed entirely: an ERP sync whose last success is three weeks old, and a command-centre '
            + 'workflow whose successes all summarise as the single word "Completed", naming nothing. The health view '
            + 'has carried both facts for weeks; nothing renders them to the vendor. Under the rule that every figure '
            + 'shows its age, a three-week-old last success is the loudest thing on this page.')}
          ${muted('Read the two differently. A workflow run failing is not a message failing — the same run can fail '
            + 'after a message was delivered — so nothing on this panel may be substituted for a figure in Messaging.')}
          </div></div>`;

      /* Three reads, three independent degradations. A panel that went dark
         because one of its three sub-sections could not be read would be
         hiding two answers it actually has. */
      const wfSection = w.kind !== ACCESSOR_STATE.OK
        ? accessorBanner(w, 'The registered automations, their 30-day outcome counts and the age of each last success '
            + 'are all unread. No workflow is being reported as healthy and none is being reported as failing.')
        : workflowTable(w.rows);

      const unregSection = u.kind !== ACCESSOR_STATE.OK
        ? accessorBanner(u, 'Whether anything is writing to the audit trail under a name the register does not know '
            + 'could not be checked. An unregistered writer is how a workflow nobody remembers deploying stays '
            + 'invisible.')
        : unregisteredTable(u.rows);

      const platSection = p.kind !== ACCESSOR_STATE.OK
        ? accessorBanner(p, 'The platform-state strip is unread. It is the one place a defect that hits the DEALER '
            + 'plane while leaving this screen working would surface — the tenancy resolver going silent at the second '
            + 'dealership is exactly that shape, and every panel here would keep reporting correctly while five other '
            + 'consumers went quiet.')
        : platformTable(p.rows);

      return why
        + `<div class="section">${bold('Registered automations')}</div>${wfSection}`
        + `<div class="section" style="margin-top:20px">${bold('Writers the register does not know')}</div>${unregSection}`
        + `<div class="section" style="margin-top:20px">${bold('Platform state')}</div>${platSection}`
        + `<div class="banner warm" style="margin-top:16px">
             <span class="material-symbols-outlined" style="font-size:20px">visibility_off</span>
             <div>${bold('What this panel still cannot see, stated so it is not assumed away.')}
               ${muted('It cannot see the automation host at all. A workflow that exists on the box and is not '
                 + 'registered, or is registered and unpublished, is invisible here — the register and the box have '
                 + 'disagreed before, and the register is what this reads. It also cannot tell which HOST delivered an '
                 + 'arrival: the database records the provider family, not the sender, so a second instance posting '
                 + 'duplicate traffic is undetectable from any query on this screen. That finding was made in '
                 + 'execution HEADERS, which reach no table.')}</div></div>`;
    },
  });

  /* ────────────────────────────────────────────────────────────────────────
     P6 · Refusals — the ledger that does not exist
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'Refusals — what the database turned away',
    sub: 'A refused write leaves no row anywhere, so every counter on this screen stays exactly where it was. This is '
       + 'the sixth panel and it is the one with nothing under it',
    load: () => readRefusals(),
    render: res => {
      /* THE DELIBERATE ASYMMETRY. Every other panel renders NOT RUN when its
         accessor is missing. This one renders NOT COMPUTABLE, because the
         accessor is not the missing piece — the TABLE is, and so is the writer
         that would fill it. An accessor installed over nothing would answer
         cleanly with zero rows, and zero rows here would read as "nothing has
         been refused", which is the exact lie this panel exists to prevent.

         Verified read-only on production, 8 September 2026: zero relations in
         `public` match /refus|write_refusal|error_event/ and zero functions
         match /refusal/. */
      const missingLedger = `<div class="banner hot" style="margin-bottom:16px">
        <span class="material-symbols-outlined" style="font-size:20px">report</span>
        <div>${bold('NOT COMPUTABLE — there is no refusal ledger, so there is nothing an accessor could read.')}
          ${muted('This panel deliberately does NOT say NOT RUN. A missing accessor is a query that did not execute; '
            + 'this is a fact the database has never recorded. Installing the accessor over an empty table would '
            + 'produce a clean answer of zero refusals, and a clean zero here is worse than no panel at all.')}
          ${muted('Two things are owed and both are named: the table '
            + '<span class="mono">public.nexus_write_refusal</span> — SQLSTATE, constraint name, the function that '
            + 'raised, the tenant, the writer, the moment — and the ADAPTER change that writes a row when a channel '
            + 'writer or the arrival recorder raises. The accessor '
            + '<span class="mono">nexus_truth_refusals(timestamptz)</span> is the third piece and the least of them.')}
          </div></div>`;

      const worked = `<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px">bug_report</span>
        <div>${bold('The worked example, because this panel is abstract until you see one.')}
          ${muted('A send path prefixes a "+" onto digits that are already bare E.164. The row is refused by CHECK, '
            + 'the insert raises, and nothing is written — anywhere. What a reader of this screen would see is the '
            + 'Messaging arrival count advancing while the ledger count does not: the received-but-never-logged gap '
            + 'widening by one. That is a SYMPTOM, and it points at the wrong subsystem. The cause is a refused write, '
            + 'and the refusal is the row that does not exist.')}
          ${muted('The same hole is the "Failed" metric in Sources. There is no HTTP receiver for any lead source '
            + 'today, so an arrival refused at the edge — bad signature, rate limit, malformed body, unregistered '
            + 'endpoint — leaves no row either, and the arrival recorder raises on refusal, which writes nothing. '
            + 'This system records what it accepted and nothing about what it refused, and the refusals are where the '
            + 'defects are.')}</div></div>`;

      /* If the accessor DOES answer one day, its answer is rendered — but the
         ledger note above stays, and a zero-row answer is still not an
         all-clear until the writer is proven to be writing. */
      const answered = res.kind === ACCESSOR_STATE.OK
        ? (Array.isArray(res.rows) && res.rows.length
            ? refusalTable(res.rows)
            : `<div class="banner hot" style="margin-top:16px">
                 <span class="material-symbols-outlined" style="font-size:20px">report</span>
                 <div>${bold('The accessor answered and returned no rows. That is NOT an all-clear.')}
                   ${muted('Zero refusals and "no writer has ever recorded a refusal" are indistinguishable from here, '
                     + 'and they are opposite findings. Until a refusal has been deliberately provoked and seen to '
                     + 'appear in this panel, an empty result is evidence about the ledger and not about the system. '
                     + 'A gate that cannot go red is decoration — this repository has found two of those — and the same '
                     + 'rule applies to a panel.')}</div></div>`)
        : '';

      return missingLedger + worked + answered;
    },
  });

  /* ────────────────────────────────────────────────────────────────────────
     P7 · What this screen cannot answer, whatever is installed
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'What this screen cannot answer — unknown is not zero',
    sub: 'Every gap above, named, with what would close it. The last four rows are permanent and are printed on every '
       + 'render so the promise is on the screen rather than only in a document',
    load: async () => {
      const results = await Promise.all(ALL_ACCESSORS.map(a => a.read()));
      return { results };
    },
    render: ({ results }) => {
      const rows = [];

      results.filter(r => r.kind !== ACCESSOR_STATE.OK).forEach(r => {
        const a = ALL_ACCESSORS.find(x => x.fn === r.fn);
        rows.push({
          what: `Everything in the ${a ? a.panel : 'unknown'} panel that this accessor answers`,
          detail: `${r.fn}() — ${r.kind === ACCESSOR_STATE.MISSING ? 'not installed' : r.kind === ACCESSOR_STATE.REFUSED ? 'refused, SQLSTATE 42501' : 'did not answer'}`,
          why: 'Not one figure it would have carried is a zero. They are unknowns, and no absence in that panel may be '
             + 'read as a clear.',
          unlock: 'The migration named in the header of this file, with its grants — revoked from public, anon and '
                + 'authenticated, granted to service_role, and asserted afterwards rather than trusted.',
          kind: 'NOT RUN',
        });
      });

      rows.push({
        what: 'Whether anything on this screen behaves correctly at more than one dealership',
        detail: 'Untested. One dealership is active on production',
        why: 'The accessors scope with the plural dealership-ids helper and group by tenant, which is the shape that '
           + 'survives two — but the shape has not been run against two, and the only assurance offered is that it does '
           + 'not call the resolver that is known to go NULL at the second dealership. Every cross-tenant claim on this '
           + 'screen is a design that has not been exercised, not a design that has been proven.',
        unlock: 'A second active dealership on a staging database, and the same reads run against it. Not on '
              + 'production: activating a second dealership there silences five consumers of the single-tenant '
              + 'resolver.',
        kind: 'UNPROVEN',
      });

      rows.push({
        what: 'Which HOST delivered an arrival, and whether a second sender is posting duplicates',
        detail: 'Never recorded, on any day',
        why: 'The database records the provider FAMILY, not the sender. The one time a duplicate sender was found, it '
           + 'was found in automation execution headers — forwarded-for, user-agent, the device index on the account — '
           + 'and none of those reaches any table. The channel event table has the right columns and no writer, so it '
           + 'holds nothing. A transport-versus-ledger comparison is the shape that would catch it and there is no '
           + 'transport figure to compare against.',
        unlock: 'A writer that records the sending identity per arrival. Until then this screen is blind to a whole '
              + 'class of defect and says so rather than implying coverage.',
        kind: 'ROADMAP',
      });

      rows.push({
        what: 'What any refused write was, when nothing was written',
        detail: 'No ledger exists',
        why: 'A refused write leaves no row in any table, so every counter here stays where it was and the defect '
           + 'surfaces only as a symptom in a neighbouring panel. This is the single most valuable thing missing from '
           + 'this screen.',
        unlock: 'The refusal table and the adapter change that writes it, both named in panel six. The accessor is the '
              + 'least of the three.',
        kind: 'ROADMAP',
      });

      rows.push({
        what: 'How stale is too stale for any figure on this screen',
        detail: 'No tolerance is set for any metric',
        why: 'Every figure states its age and none of them withholds itself for being old, because no threshold has '
           + 'been chosen. Choosing one before this system has carried traffic would be inventing a normal, and the '
           + 'ages measured today are the state of a quiet system rather than a baseline.',
        unlock: 'A per-metric tolerance in the database manifest, chosen once there is traffic to choose it against. '
              + 'The replacement behaviour is already implemented and inert.',
        kind: 'ROADMAP',
      });

      rows.push({
        what: 'What the rows behind any figure on this screen actually contain',
        detail: 'Deliberately not read',
        why: 'Every accessor returns counts and states and never customer rows. A drill-down into the conversation '
           + 'ledger would show message text, and the control-plane boundary puts customer content on the '
           + "dealership's side of the glass, reachable only through an audited support path. The drawers state their "
           + 'query instead of running it.',
        unlock: 'A decision between a narrower vendor role and a drill-down that returns row identifiers and '
              + 'timestamps only. Neither has been taken, and wiring a service-role read through before it is taken '
              + 'is how the boundary gets crossed by a convenience.',
        kind: 'BOUNDARY',
      });

      return table([
        { label: 'What is not known', strong: true, render: x => wrap(esc(x.what)) },
        { label: 'How much / since when', render: x => wrap(muted(esc(x.detail))) },
        { label: 'Why it matters', render: x => wrap(muted(esc(x.why))) },
        { label: 'What would close it', render: x => wrap(`<div class="t-warm">${esc(x.unlock)}</div>`) },
        { label: 'Kind', render: x => pill(x.kind, x.kind === 'NOT RUN' ? 'hot' : x.kind === 'UNPROVEN' ? 'warm' : 'unknown', { verbatim: false }) },
      ], rows);
    },
  });
};

}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION M · Renderers used by more than one panel
   ══════════════════════════════════════════════════════════════════════════ */

function legendTile(value, word, blurb) {
  return `<div class="kpi"><div class="label-caps">${esc(word)}</div>
    <div class="kpi-value sm">${value}</div>
    <div class="kpi-sub">${esc(blurb)}</div></div>`;
}

/* The manifest note, printed on every render. It is the difference between a
   screen whose rules come from the database and one whose rules come from a
   document somebody transcribed, and a reader has to be able to tell which one
   they are looking at. */
function manifestNote() {
  return `<div class="banner warm" style="margin-top:16px">
    <span class="material-symbols-outlined" style="font-size:20px">description</span>
    <div>${bold('The labels, reasons and drill-downs on this screen were transcribed from a document, not read from the database.')}
      ${muted('The manifest accessor is the enforcement object: a metric absent from it cannot be drawn, and adding a '
        + 'tile is supposed to require a migration that states its query, its drill-down and its staleness tolerance. '
        + 'That accessor is not installed, so this file carries a local copy of the prose — which goes stale silently '
        + 'the moment the schema moves, and is exactly the kind of second derivation this codebase keeps paying for.')}
      ${muted('What the local copy deliberately does NOT carry is a single state or a single value. Every figure on '
        + 'this screen renders NOT RUN until an accessor answers, so nothing here can be a number this screen did not '
        + 'read. When the database manifest lands it wins, and any disagreement between the two is rendered as a '
        + 'fault rather than quietly resolved.')}</div></div>`;
}

/* The manifest note above claims that when the database manifest lands it wins
   and any disagreement is rendered as a fault. This function is that claim,
   implemented — because a caption asserting something its own branch does not
   do is a defect this repository has now found eight times, and writing the
   sentence without the code would have been the ninth.

   The comparison is deliberately over the SET of (panel, metric) keys and not
   over the prose. Two people writing the same metric's explanation differently
   is an editorial difference; a metric the database knows about and this file
   does not is a tile that cannot be drawn, and a metric this file draws that
   the database has never heard of is a tile with no migration behind it. Those
   two are the faults. */
function manifestDiff(res) {
  if (!res) return '';
  if (res.kind !== ACCESSOR_STATE.OK) {
    return `<div class="banner warm" style="margin-top:16px">
      <span class="material-symbols-outlined" style="font-size:20px">rule_folder</span>
      <div>${bold('The database manifest could not be read, so the local copy could not be checked against it.')}
        ${muted(accessorSentence(res.fn, res.kind, res.err))}
        ${muted('Every label, reason and drill-down on this screen is therefore unverified prose. It is not wrong — it '
          + 'is unchecked, which is a different and smaller claim than the one this screen would like to make.')}</div></div>`;
  }
  const dbKeys = new Set((Array.isArray(res.rows) ? res.rows : [])
    .map(r => `${str(r && r.panel)}:${str(r && r.metric)}`).filter(k => k !== ':'));
  const localKeys = new Set(MANIFEST.map(m => `${m.panel}:${m.metric}`));
  const onlyDb = [...dbKeys].filter(k => !localKeys.has(k));
  const onlyLocal = [...localKeys].filter(k => !dbKeys.has(k));
  if (!onlyDb.length && !onlyLocal.length) {
    return `<div class="banner info" style="margin-top:16px">
      <span class="material-symbols-outlined" style="font-size:20px">rule_folder</span>
      <div>${bold('The database manifest and this file agree on every metric.')}
        ${muted(`${num(dbKeys.size)} metrics, symmetric difference zero. That is an agreement about WHICH metrics `
          + 'exist, not about how each is worded — the prose on this screen is still the local copy, and the day the '
          + 'accessor also carries the reasons, this file should stop carrying them.')}</div></div>`;
  }
  return `<div class="banner hot" style="margin-top:16px">
    <span class="material-symbols-outlined" style="font-size:20px">report</span>
    <div>${bold('FAULT — the database manifest and this screen disagree about which metrics exist.')}
      ${onlyDb.length ? muted(`<span style="font-weight:600">Known to the database and not drawn here:</span> `
        + `${esc(onlyDb.join(', '))}. A migration added a metric and this screen has not caught up, so a tile that has `
        + 'a query, a drill-down and a staleness tolerance behind it is missing from the page entirely.') : ''}
      ${onlyLocal.length ? muted(`<span style="font-weight:600">Drawn here and unknown to the database:</span> `
        + `${esc(onlyLocal.join(', '))}. That is worse: a tile with no migration behind it, which is exactly what the `
        + 'manifest-as-enforcement-object rule exists to make impossible.') : ''}
      ${muted('Neither side is being picked. The disagreement is the finding.')}</div></div>`;
}

/* SPEC §4's Rule 4 has a second half this screen would otherwise have read and
   discarded: the freshness accessor answers per RELATION, which is a different
   question from the per-metric ages on each cell. It is what says the four
   panels are not one snapshot of one moment — the arrival record and the sales
   record can be days old while the message ledger is minutes old, and rendered
   without this they read as though they were taken together. */
function freshnessSection(res) {
  if (!res) return '';
  if (res.kind !== ACCESSOR_STATE.OK) {
    return `<div class="banner warm" style="margin-top:16px">
      <span class="material-symbols-outlined" style="font-size:20px">schedule</span>
      <div>${bold('How old the data behind each panel is could not be read.')}
        ${muted(accessorSentence(res.fn, res.kind, res.err))}
        ${muted('Without it, nothing on this screen says that the panels are of different ages. Read together as one '
          + 'snapshot they would be misleading in a way that no single figure on the page is.')}</div></div>`;
  }
  const rows = (Array.isArray(res.rows) ? res.rows : []).slice()
    .sort((a, b) => Date.parse(a && a.newest_at || 0) - Date.parse(b && b.newest_at || 0));
  if (!rows.length) {
    return `<div class="banner hot" style="margin-top:16px">
      <span class="material-symbols-outlined" style="font-size:20px">report</span>
      <div>${bold('The freshness accessor answered and named no relations.')}
        ${muted('An empty answer here is not "everything is current". It is a check that reported nothing.')}</div></div>`;
  }
  return `<div class="section" style="margin-top:20px">${bold('How old each panel’s data is — these are not one snapshot')}</div>`
    + table([
      { label: 'Relation', strong: true, render: r => wrap(mono(str(r.relation) || 'unnamed')) },
      { label: 'Newest row', render: r => wrap(r.newest_at
          ? `<div style="font-weight:600" title="${esc(dubaiStamp(r.newest_at))}">${esc(ago(r.newest_at))}</div>`
          : hot('No newest row recorded, so this relation’s age is unknown — which is not the same as it being empty.')) },
      { label: 'What that means', render: r => wrap(muted('Oldest first. A panel resting on this relation is this old, '
          + 'whatever the panel above or below it says about itself.')) },
    ], rows);
}

function alignmentBanner(rows) {
  const anyAligned = Array.isArray(rows) && rows.some(r => r && r.window_is_aligned === true);
  const anyMisaligned = Array.isArray(rows) && rows.some(r => r && r.window_is_aligned === false);
  const start = Array.isArray(rows) && rows.length ? rows[0].window_start : null;
  if (anyAligned && !anyMisaligned) {
    return `<div class="banner info" style="margin-bottom:16px">
      <span class="material-symbols-outlined" style="font-size:20px">timelapse</span>
      <div>${bold('Both counters are on the aligned window.')}
        ${muted(start
          ? `The window starts at <span title="${esc(dubaiStamp(start))}">${esc(ago(start))}</span>, which is the later `
            + 'of the two counters’ first rows. Figures over any other range are not comparable and are not compared.'
          : 'The accessor states the window is aligned and did not say where it starts, which is itself worth '
            + 'reconciling.')}</div></div>`;
  }
  return `<div class="banner hot" style="margin-bottom:16px">
    <span class="material-symbols-outlined" style="font-size:20px">report</span>
    <div>${bold('The two counters are NOT on an aligned window, so the comparison between them is refused.')}
      ${muted('The arrival counter and the conversation ledger begin on different days. Across their natural ranges '
        + 'the ledger holds more than ever arrived, which is impossible and is purely the mismatch. A drop-off '
        + 'computed across misaligned windows is not a finding, it is arithmetic on two different populations.')}</div></div>`;
}

function healthPill(h) {
  const w = String(h || '').toUpperCase();
  /* Only one value is green, and the greenness is the accessor's word rather
     than this file's opinion. Everything that is an ABSENCE of evidence — never
     ran, not instrumented, nothing to rate — is neutral and not good: colouring
     an unmeasured workflow green is how a dashboard lies without anyone writing
     a false sentence. */
  const tone = w === 'HEALTHY' ? 'ok'
    : (w === 'DEGRADED' || w === 'PRODUCING_NOTHING') ? 'hot'
    : w ? 'unknown' : 'hot';
  return pill(w || 'NO HEALTH STATED', tone, { verbatim: true });
}

function workflowTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return `<div class="banner hot">
      <span class="material-symbols-outlined" style="font-size:20px">report</span>
      <div>${bold('The accessor answered and returned no workflows at all.')}
        ${muted('That is not "everything is fine" and it is not "there are no automations". The register holds the '
          + 'automations NEXUS runs, and an empty answer means either the register is empty or the read is scoped to '
          + 'nothing. Both are findings.')}</div></div>`;
  }
  /* Oldest last success first. Under the rule that every figure shows its age,
     the workflow that has not succeeded for longest belongs at the top — that
     ordering is the only thing on this table that says so. */
  const sorted = list.slice().sort((a, b) => {
    const ta = a.last_success ? Date.parse(a.last_success) : 0;
    const tb = b.last_success ? Date.parse(b.last_success) : 0;
    return ta - tb;
  });
  return table([
    { label: 'Automation', strong: true, render: r => wrap(bold(esc(str(r.workflow) || 'unnamed'))
        + (str(r.category) ? muted(esc(str(r.category))) : '')
        + (r.is_active === false ? warm('Registered and marked inactive.') : '')) },
    { label: 'Health', render: r => wrap(healthPill(r.health)) },
    { label: 'Last success', render: r => wrap(r.last_success
        ? `<div style="font-weight:600" title="${esc(dubaiStamp(r.last_success))}">${esc(ago(r.last_success))}</div>`
          + muted('The age of the last success is the first thing to read on this row.')
        : hot('Nothing has ever succeeded, or nothing has ever been logged. Those are different facts and this view '
            + 'cannot tell them apart — read the instrumentation column beside it.')) },
    { label: 'Last run', render: r => wrap(r.last_run
        ? `<span title="${esc(dubaiStamp(r.last_run))}">${esc(ago(r.last_run))}</span>`
        : muted('No run recorded.')) },
    { label: '30-day outcome', align: 'r', render: r => {
        const runs = n0(r.effective_runs_30d);
        const ok = n0(r.successes_30d);
        return wrap(rateCell('Success rate', rate(ok, runs)));
      } },
    { label: 'Instrumented', render: r => wrap(r.writes_audit_log === false
        ? muted('This automation records nothing about its own runs, so its health is UNKNOWN rather than good. A '
            + 'blank health record here is a blind spot, not an all-clear.')
        : muted('Writes to the audit trail, so its runs are countable.')) },
  ], sorted);
}

function unregisteredTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return `<div class="banner info">
      <span class="material-symbols-outlined" style="font-size:20px">check_circle</span>
      <div>${bold('Nothing is writing to the audit trail under a name the register does not know.')}
        ${muted('A zero with a denominator: the accessor answered and found none. It says nothing about a writer that '
          + 'writes no audit row at all, which is invisible to this check by construction.')}</div></div>`;
  }
  return table([
    { label: 'Writer name in the audit trail', strong: true, render: r => wrap(mono(str(r.workflow_written_in_audit_log) || 'unnamed')) },
    { label: 'Rows', align: 'r', render: r => `<div style="font-weight:600">${num(r.audit_rows)}</div>`
        + muted(`${num(r.audit_rows_30d)} in the last 30 days`) },
    { label: 'First seen', render: r => wrap(r.first_written_at
        ? `<span title="${esc(dubaiStamp(r.first_written_at))}">${esc(ago(r.first_written_at))}</span>`
        : muted('Not recorded.')) },
    { label: 'Last seen', render: r => wrap(r.last_written_at
        ? `<span title="${esc(dubaiStamp(r.last_written_at))}">${esc(ago(r.last_written_at))}</span>`
        : muted('Not recorded.')) },
    { label: 'Disposition', render: r => wrap(str(r.disposition)
        ? muted(esc(str(r.disposition)))
        : hot('No disposition recorded, so nothing here says whether this writer is deliberate or a leftover. An '
            + 'unregistered writer with no disposition is the one worth naming.')) },
  ], list);
}

function platformTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return `<div class="banner hot">
      <span class="material-symbols-outlined" style="font-size:20px">report</span>
      <div>${bold('The platform-state accessor answered and returned nothing.')}
        ${muted('Every check it aggregates is a gate that exists to be able to go red. A gate that returns no rows at '
          + 'all is not green — it is a gate that did not report, and this repository has twice found gates that '
          + 'could not fail.')}</div></div>`;
  }
  const level = l => {
    const w = String(l || '').toUpperCase();
    return pill(w || 'NO LEVEL', w === 'BLOCKER' || w === 'FAIL' ? 'hot' : w === 'WARN' ? 'warm' : 'unknown', { verbatim: true });
  };
  const sorted = list.slice().sort((a, b) => {
    const rank = x => ({ BLOCKER: 0, FAIL: 1, WARN: 2, REVIEW: 2 }[String(x || '').toUpperCase()] ?? 3);
    return rank(a.level) - rank(b.level);
  });
  return table([
    { label: 'Check', strong: true, render: r => wrap(esc(str(r.check) || 'unnamed check')) },
    { label: 'Level', render: r => wrap(level(r.level)) },
    { label: 'What it found', render: r => wrap(muted(esc(str(r.detail) || 'No detail recorded.'))) },
    { label: 'Where it comes from', render: r => wrap(str(r.source_function)
        ? mono(str(r.source_function) + '()')
        : muted('Not stated, which makes this row unverifiable from here.')) },
  ], sorted);
}

function refusalTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return table([
    { label: 'When', strong: true, render: r => wrap(r.refused_at
        ? `<span title="${esc(dubaiStamp(r.refused_at))}">${esc(ago(r.refused_at))}</span>`
        : hot('No time recorded on a refusal, which makes it uncorrelatable with anything else on this screen.')) },
    { label: 'SQLSTATE', render: r => wrap(mono(str(r.sqlstate) || 'not recorded')) },
    { label: 'Constraint', render: r => wrap(str(r.constraint_name)
        ? mono(str(r.constraint_name))
        : muted('No constraint named. A refusal raised by a function rather than by a constraint is the other shape, '
            + 'and the function column beside this one carries it.')) },
    { label: 'Raised by', render: r => wrap(str(r.raised_by)
        ? mono(str(r.raised_by))
        : hot('Nothing records which writer raised this. A refusal with no writer cannot be routed to anyone.')) },
    { label: 'Writer', render: r => wrap(muted(esc(str(r.writer) || 'not recorded'))) },
  ], list);
}
