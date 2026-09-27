/* NEXUS OS — screens/revenue.js
   REVENUE RECOVERY. The owner's answer to "where is my dealership leaking
   money today?", assembled from the engines that actually exist.

   This screen computes almost nothing of its own. Every engine below already
   states its own finding, its own basis and its own blind spots in the
   database; this screen puts them on one page in the order an owner reads them
   and refuses, loudly, to add them together.

   WHERE EVERYTHING COMES FROM
     v_inventory_profit_sentinel   12 units scored from real cost and real days
                                   in stock. impact_aed is MARGIN EXPOSED.
     v_action_center_health        the inventory action lane in one row: how
                                   many decisions are open, how much margin sits
                                   behind them, how many outcomes attributed.
     v_inventory_action_queue      the individual actions, each carrying the
                                   view's own outcome_sentence.
     v_lead_recovery               one row per lead: state, risk, and the
                                   sentence explaining why it cannot be sized.
     v_lead_recovery_coverage      the same engine's aggregate AND its own
                                   what_this_engine_cannot_tell_you paragraph.
     v_deal_rescue                 in-flight deals. Structurally empty today.
     v_deal_rescue_candidates      everything examined and refused, each with
                                   why it is NOT a deal.
     v_deal_rescue_readiness       the nine prerequisites, measured live.
     v_policy_rule                 rule versions with their authority grading.
     v_policy_unmigrated_constant  the constants still hard-coded in the product.
     v_attribution_sale_chain      the one confirmed sale, hop by hop.

   ═══════════════════════════════════════════════════════════════════════════
   THE FIVE RULES THIS SCREEN IS BUILT AROUND
   ═══════════════════════════════════════════════════════════════════════════

   1. THERE IS NO TOTAL "REVENUE AT RISK" ON THIS PAGE AND THERE MUST NOT BE.
      It would be the most sellable sentence in the product and the least true.
      Nothing in this system can compute it. Lead Recovery's
      opportunity_value_aed is NULL on every lead (UNKNOWN_NO_LINK — no lead
      carries a budget and no column links a lead to a unit), so the customer
      side of that total does not exist at any confidence. The Sentinel's figure
      is MARGIN EXPOSED — gross margin sitting inside a car that has not sold —
      which is a different quantity from revenue and is measured on cars rather
      than on customers. The Sentinel's number appears here under its own name,
      with what it excludes stated beside it, and the arithmetic stops there.

   2. THE ZEROS ARE THE PRODUCT. "0 leads at risk" and "AED 0 confirmed
      recovery" are the two most valuable claims on this page, because they are
      what make every other number believable — a dashboard that never prints a
      zero is a dashboard that is guessing. They are shown plainly, at full
      size, with the reason underneath. They are never softened, never hidden
      behind an empty state, and never spun.

   3. ESTIMATED, ATTRIBUTED AND CONFIRMED ARE THREE DIFFERENT WORDS. They get
      three separate rows in the ledger panel and are never interchanged.
      Live at the time of writing: estimated is NOT COMPUTED, attributed is
      AED 0, confirmed recovery is AED 0 — while AED 585,000 of CONFIRMED
      REVENUE sits on file and is explicitly not attributed to anything NEXUS
      did. Collapsing those four facts into one number is the exact failure this
      screen exists to prevent. None of those figures is written into this file;
      every one is read.

   4. NEVER "0 LEAKS RECOVERED". That sentence reads as a performance figure and
      it is not one: nothing has been recovered because nothing has yet been
      linked to a completed business outcome, which is a statement about the
      evidence chain, not about the sales team. The words used here are "no
      measurable recovery opportunity is currently detected" and "no completed
      business outcome has been linked to an action", and they are what the
      database supports.

   5. A TILE THAT SUMS SOMETHING SAYS HOW MANY ROWS IT COULD NOT INCLUDE. Every
      total on this page is followed by its own denominator and its own
      exclusions, counted from the rows rather than asserted — and the two kinds
      of exclusion are counted separately, because "the engine claims no impact
      here" is an answer and "the engine could not put a figure to this" is a
      gap. */

import { db } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { aed, dubaiDate, dubaiStamp, esc, num, pill } from '../lib/format.js';
import { maskText } from '../lib/privacy.js';
import { healthWords } from '../lib/health.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const n0  = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted  = h => `<div class="ds-cell-sub">${h}</div>`;
const hot    = h => `<div class="ds-cell-sub t-hot">${h}</div>`;
const bold   = h => `<div style="font-weight:600">${h}</div>`;

/* One clause out of the engine's own "what I cannot tell you" paragraph, which
   is written as CANNOT SIZE: … CANNOT SEE: … CANNOT CONFIRM: …

   Printed rather than paraphrased on purpose: the database owns that sentence,
   and a paraphrase here would be a second copy of a business fact that drifts
   the first time the view is edited. If the label is not present the whole
   paragraph is returned — never a placeholder, because a missing clause must
   not read as an absent limitation. */
const cannotClause = (text, label) => {
  const t = str(text);
  const i = t.indexOf(label);
  if (i < 0) return t;
  const rest = t.slice(i + label.length);
  const j = rest.search(/CANNOT [A-Z]/);
  return (j < 0 ? rest : rest.slice(0, j)).trim();
};

/* Reads shared between panels are memoised so that two panels describing the
   same rows cannot describe two different moments — and the memo is DROPPED on
   rejection, because panel()'s Retry re-invokes `load` and a cached rejection
   would give the operator a button whose only possible outcome is the same
   failure. Same shape as screens/overview.js, for the same reason. */
const shared = make => {
  let p = null;
  return () => {
    if (!p) { p = make(); p.catch(() => { p = null; }); }
    return p;
  };
};
/* A read whose failure must not withhold its neighbours. Resolves to the value
   or the error and never rejects; each panel decides for itself whether a
   partial answer is still worth rendering. */
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));

/* ── Navigating to an engine screen that may not be in this build ───────────
   Four of the screens this page points at — Lead Recovery, Deal Rescue,
   Attribution and Policy — are separate modules. lib/nav.js registers all five
   ids whether or not every module has landed, and go() renders an explicit
   "not in this build" state for one that has not.

   A button that silently did nothing, or that bounced the operator to Overview,
   would be worse than a disabled one: this codebase's own rule is that a click
   which appears to work and does nothing is the single outcome that must not
   happen. So the button says which of the two it is before it is pressed. */
const linkBtn = (id, label) => (SCREENS[id]
  ? `<button class="btn sm" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="btn sm ghost" disabled title="${esc(label)} is not part of this build: the navigation offers the screen and no module in this bundle registers it.">${esc(label)} — not in this build</button>`);
const wireGo = card => {
  card.querySelectorAll('[data-go]').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => go(b.dataset.go));
  });
};

/* A read that failed, said in one sentence, in the place the figure would have
   been. Never a bare dash: a dash beside "Leads at risk" reads as zero, and
   zero is a finding this screen makes deliberately. */
const readFailed = (what, err) =>
  hot(`${esc(what)} could not be read (${esc(str(err && err.message) || 'no reason given')}), so nothing is claimed here and nothing is ruled out.`);

/* ── v_attribution_sale_chain, reduced once, for both screens that read it ──
   EXPORTED, and it is the only definition. Until 27 Sep 2026 this function
   existed twice — here and in screens/attribution.js — and the two agreed only
   because the shared half of them was character-for-character the same. Both
   print `Confirmed revenue` off `revenue`, so one edit to either copy and the
   same figure had two derivations, which is precisely what
   NEXUS_INVARIANTS.md's "one figure, one derivation" rule exists to stop. The
   two screens are a click apart in the nav, so the disagreement would have been
   visible to the owner before it was visible to us.

   WHY THE DEFINITION LIVES HERE AND NOT IN attribution.js, which is the more
   natural owner of the view: app.js imports this module with a plain
   `import './screens/revenue.js'`, so it is unconditionally part of the bundle —
   its absence is already a build failure. attribution.js is registered through
   the `import.meta.glob` block instead, precisely because it is one of the five
   engine screens that "may legitimately not have landed yet"; a static
   `import './attribution.js'` from here would turn that absence into a build
   failure that takes every other screen down with it. So the dependency points
   from the optional module to the guaranteed one, and it must never be inverted.
   A shared lib/ module would be the tidier home and is outside this pass.

   The returned object is the UNION of what the two screens print, not a base
   the callers extend: an extension point is a second place a figure can be
   derived, which is the defect. Every field is reduced from the columns both
   readers already select, so each screen reads the fields it renders and
   ignores the rest. Nothing here is a new figure and no rounding changed. */
export const saleFacts = rows => {
  const sales = rows || [];
  const confirmed = sales.filter(s => up(s.revenue_state) === 'CONFIRMED' && n0(s.revenue_aed) != null);
  const withMargin = sales.filter(s => n0(s.gross_margin_aed) != null);
  return {
    sales, confirmed, withMargin,
    unconfirmed: sales.length - confirmed.length,
    revenue: confirmed.reduce((a, s) => a + Number(s.revenue_aed), 0),
    margin: withMargin.reduce((a, s) => a + Number(s.gross_margin_aed), 0),
    /* Summed over the hop counters the view itself produced, so this page and
       the per-sale detail below it cannot disagree about the same chain. */
    hopsTotal: sales.reduce((a, s) => a + (n0(s.hops_total) || 0), 0),
    hopsEvidenced: sales.reduce((a, s) => a + (n0(s.hops_evidenced) || 0), 0),
  };
};

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.revenue = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto another screen and restyle one nobody converted. A wrapper
     cannot leak — go() removes it with the rest of the subtree. Same pattern as
     screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js and screens/setup.js. */
  const root = el('div', 'ds-screen');
  host.appendChild(root);

  /* ── The reads ──────────────────────────────────────────────────────────
     Every path is a literal so that QUALITY_GATE.mjs can extract it and check
     each column name against the live catalogue. Do not move these into a map
     keyed by name: the gate cannot follow a variable, and a column renamed in
     the database would then reach a customer as a blank cell. */

  const readSentinel = shared(() => db('v_inventory_profit_sentinel'
    + '?select=id,model,aging_band,overall_risk,recommendation,impact_aed,impact_kind,days_in_stock,'
    + 'holding_cost_state,market_position,settings_are_defaults,computed_at'
    + '&order=impact_aed.desc.nullslast&limit=500'));

  const readActionHealth = shared(() => db('v_action_center_health?select=*'));

  const readQueue = shared(() => db('v_inventory_action_queue'
    + '?select=id,unit_id,unit_model,status,recommendation,engine_impact_aed,engine_impact_kind,'
    + 'outcome_state,outcome_sentence,proposed_at,decided_at'
    + '&order=proposed_at.desc&limit=200'));

  const readLeads = shared(() => db('v_lead_recovery'
    + '?select=lead_id,lead_name,lead_status,state,risk_level,risk_basis,recommended_action,'
    + 'opportunity_value_aed,opportunity_value_state,opportunity_value_basis,confirmed_outcome_state,'
    + 'recovery_attribution_state,owner_state,silence_state,computed_at'
    + '&order=lead_id.asc&limit=500'));

  const readCoverage = shared(() => db('v_lead_recovery_coverage?select=*'));

  const readRescue = shared(() => db('v_deal_rescue'
    + '?select=customer_label,lead_id,state,state_basis,recommended_action,evidence_tier,'
    + 'deal_value_state,days_since_movement&limit=200'));

  const readCandidates = shared(() => db('v_deal_rescue_candidates'
    + '?select=candidate_kind,candidate_ref,customer_label,source_table,verdict,verdict_basis,'
    + 'deal_value_aed,deal_value_state&order=candidate_kind.asc&limit=200'));

  const readReadiness = shared(() => db('v_deal_rescue_readiness'
    + '?select=id,sort,requirement,kind,met_now,measured_now&order=sort.asc&limit=100'));

  const readRules = shared(() => db('v_policy_rule'
    + '?select=jurisdiction,rule_type,rule_name,version,value_display,status,verification_status,'
    + 'authority,may_be_relied_on,source_name&order=rule_type.asc&limit=500'));

  const readConstants = shared(() => db('v_policy_unmigrated_constant'
    + '?select=layer,kind,location,current_value,reaches_a_customer,migration_state,'
    + 'proposed_rule_type,proposed_rule_name&limit=500'));

  const readSale = shared(() => db('v_attribution_sale_chain'
    + '?select=sale_id,purchase_date,customer_name,vehicle_text,revenue_aed,revenue_state,'
    + 'gross_margin_aed,margin_state,margin_note,vehicle_state,campaign_state,'
    + 'hops_total,hops_evidenced,first_break,chain&order=purchase_date.desc&limit=200'));

  /* ── Derivations, once, in one place ────────────────────────────────────
     Every figure this screen prints is computed here and nowhere else, so a
     tile and the panel beneath it cannot disagree about the same number. */

  const sentinelFacts = rows => {
    const units = rows || [];
    /* Partitioned on impact_kind, never on "is the number null". The two are
       not the same question. impact_kind NONE means the engine deliberately
       claims no exposure on that unit, which is an answer. A row of any other
       kind carrying no figure would mean the engine named an exposure it could
       not size, which is a gap. Counted separately; both reported. */
    const exposed = units.filter(u => up(u.impact_kind) === 'MARGIN_EXPOSED' && n0(u.impact_aed) != null);
    const noClaim = units.filter(u => up(u.impact_kind) === 'NONE');
    const unsized = units.filter(u => up(u.impact_kind) !== 'NONE' && n0(u.impact_aed) == null);
    const band = k => units.filter(u => up(u.aging_band) === k).length;
    const rec  = k => units.filter(u => up(u.recommendation) === k).length;
    return {
      units, exposed, noClaim, unsized,
      total: exposed.reduce((a, u) => a + Number(u.impact_aed), 0),
      critical: band('CRITICAL'), warning: band('WARNING'), healthy: band('HEALTHY'),
      hold: rec('HOLD'),
      needsDecision: units.filter(u => up(u.recommendation) && up(u.recommendation) !== 'HOLD').length,
      /* Partitioning on the one value that means "this was computed" handles
         every other state by complement, including a state nobody here has
         heard of yet. Live on all twelve units: NOT_COMPUTABLE. */
      noHolding: units.filter(u => up(u.holding_cost_state) !== 'COMPUTED').length,
      noMarket: units.filter(u => up(u.market_position).startsWith('UNKNOWN')).length,
      defaults: units.some(u => u.settings_are_defaults === true),
      computedAt: units.length ? units[0].computed_at : null,
    };
  };

  /* ══════════════════════════════════════════════════════════════════════
     P1 · The ledger. Five findings, then the three words, then the total
          this screen refuses to print.
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Where the money is, and what NEXUS can prove about it',
    sub: 'Five findings from four engines. Each figure is the one its own engine produced, in its own units, '
       + 'beside what it excludes. Nothing on this page is added to anything else on this page.',
    load: async () => {
      const [s, h, c, r, cd, sale, l] = await Promise.all([
        settle(readSentinel()), settle(readActionHealth()), settle(readCoverage()),
        settle(readRescue()), settle(readCandidates()), settle(readSale()), settle(readLeads()),
      ]);
      /* Only a total blackout raises to the error card. One engine being
         unreadable withholds one tile and says so; putting all five behind a
         single Retry would hide four answers that are perfectly available. */
      if (s.err && h.err && c.err && r.err && cd.err && sale.err && l.err) throw s.err;
      return { s, h, c, r, cd, sale, l };
    },
    render: ({ s, h, c, r, cd, sale, l }) => {
      const F = s.err ? null : sentinelFacts(s.v);
      const H = h.err ? null : (h.v && h.v[0]) || null;
      const C = c.err ? null : (c.v && c.v[0]) || null;
      const S = sale.err ? null : saleFacts(sale.v);
      const inFlight = r.err ? null : (r.v || []).length;
      const cands = cd.err ? null : (cd.v || []).length;

      /* ── Tile 1 · margin exposed on stock ──────────────────────────────
         The one money figure on this page. Named after what it is — margin
         exposed — and never after what it is not. */
      const exposureTile = F
        ? kpi('Margin exposed on stock', aed(F.total),
            muted(`Adds ${num(F.exposed.length)} of ${num(F.units.length)} scored ${plural(F.units.length, 'unit', 'units')}. `
              + `${num(F.noClaim.length)} ${plural(F.noClaim.length, 'unit is', 'units are')} left out because the engine claims no impact on `
              + `${plural(F.noClaim.length, 'it', 'them')}`
              + (F.unsized.length
                  ? `, and ${num(F.unsized.length)} because the engine named an impact it could not put a figure to`
                  : ', and none for want of a figure')
              + '. Gross margin sitting inside a car that has not sold — not revenue, not loss, not recovery.'),
            F.total ? 't-hot' : '')
        : kpi('Margin exposed on stock', num(null), readFailed('The Profit Sentinel', s.err));

      /* ── Tile 2 · the zero that matters most ───────────────────────────
         Rendered from the coverage view's own count rather than recounted from
         the lead rows in P4, so the tile and the table cannot disagree. */
      const riskTile = C
        ? kpi('Leads at risk', num(C.leads_at_risk),
            muted(`Of ${num(C.leads_total)} ${plural(C.leads_total, 'lead', 'leads')} scored`
              + (n0(C.leads_risk_unknown)
                  ? `, and ${num(C.leads_risk_unknown)} whose risk could not be determined at all`
                  : ', none of them scored as undetermined')
              /* The zero wording says only what a zero proves: the engine ran
                 and flagged nothing. WHY each lead is not leaking is that
                 lead's own risk_basis, printed per row further down — asserting
                 a single reason here would be this screen inventing one. */
              + `. ${n0(C.leads_at_risk)
                  ? 'Each is listed further down with its evidence.'
                  : 'No measurable recovery opportunity is currently detected: the engine scored every lead on file and flagged none of them. That is the engine answering, not the engine failing — each lead\'s own reason is in the table below.'}`),
            n0(C.leads_at_risk) ? 't-hot' : '')
        : kpi('Leads at risk', num(null), readFailed('Lead Recovery coverage', c.err));

      /* ── Tile 3 · zero deals, and why that is a schema fact ────────────*/
      const dealTile = (inFlight != null)
        ? kpi('Deals in flight', num(inFlight),
            muted(cands == null
              ? 'The candidate list could not be read, so nothing is said here about what was examined.'
              : `${num(cands)} ${plural(cands, 'candidate was', 'candidates were')} examined and `
                + `${plural(cands, 'it carries', 'each carries')} a recorded reason for not being a deal. `
                + 'No deal record exists while a deal is in progress: the sale record is written at the moment of sale, '
                + 'so there is no in-flight period for this engine to observe.'),
            inFlight ? 't-hot' : '')
        : kpi('Deals in flight', num(null), readFailed('Deal Rescue', r.err));

      /* ── Tile 4 · decisions waiting ────────────────────────────────────*/
      const decisionTile = H
        ? kpi('Decisions waiting', num(H.awaiting_decision),
            muted(`Of ${num(H.actions_total)} recorded ${plural(H.actions_total, 'action', 'actions')}. `
              + (n0(H.awaiting_decision)
                  ? `${aed(H.undecided_exposure_aed)} of exposure sits behind ${plural(H.awaiting_decision, 'it', 'them')}`
                    + (n0(H.undecided_with_no_figure)
                        ? `, and ${num(H.undecided_with_no_figure)} undecided ${plural(H.undecided_with_no_figure, 'action carries', 'actions carry')} no figure at all.`
                        : ', and every one of them carries a figure.')
                  : 'Nothing is waiting on a person.')
              + (n0(H.approved_not_executed)
                  ? ` ${num(H.approved_not_executed)} approved ${plural(H.approved_not_executed, 'action has', 'actions have')} not been carried out.`
                  : '')),
            n0(H.awaiting_decision) ? 't-hot' : '')
        : kpi('Decisions waiting', num(null), readFailed('Action Center health', h.err));

      /* ── Tile 5 · the other zero ───────────────────────────────────────
         Two action lanes exist and can attribute an outcome: inventory and lead
         recovery. Deal Rescue has no action lane at all, so it is named rather
         than counted as a third zero.

         AED 0 is printed only where zero attributed outcomes makes it provable.
         With any attributed outcome, the money is a figure this panel has not
         read and the tile says so instead of guessing at it. */
      const attributed = (H && C)
        ? Number(H.outcomes_attributed) + Number(C.recovery_outcomes_attributed)
        : null;
      const recoveryTile = (attributed === 0)
        ? kpi('Confirmed recovery', aed(0),
            muted('No completed business outcome has been linked to an action, across '
              + `${num(H.actions_total)} inventory ${plural(H.actions_total, 'action', 'actions')} and `
              + `${num(C.recovery_actions_total)} lead recovery ${plural(C.recovery_actions_total, 'action', 'actions')}. `
              + 'Deal Rescue has no action lane to attribute through. This is an evidence figure, not a performance figure.'))
        : attributed != null
          ? kpi('Confirmed recovery', num(null),
              muted(`${num(attributed)} ${plural(attributed, 'outcome has', 'outcomes have')} been attributed. `
                + 'What they are worth is held on the engine screens and is not summed here.'))
          : kpi('Confirmed recovery', num(null), readFailed('The action lanes', h.err || c.err));

      /* ── The three words ───────────────────────────────────────────────
         PRODUCT.md: estimated, attributed and confirmed are three different
         words and must never be interchanged on a screen. Here they are, one
         per row, each beside the derivation that produced it. */
      const ledgerRows = [];

      /* Derived, not asserted. It reads "Not computed" today because every lead
         comes back with a null opportunity value, and it will start showing a
         figure — with its own exclusions — the day any lead can be sized,
         without anyone having to remember to come back and edit this row. */
      const leads = l.err ? null : (l.v || []);
      const sized = leads ? leads.filter(d => n0(d.opportunity_value_aed) != null) : null;
      ledgerRows.push({
        word: 'Estimated',
        means: 'What a leak might be worth, before anybody acts on it.',
        value: (sized && sized.length)
          ? aed(sized.reduce((a, d) => a + Number(d.opportunity_value_aed), 0))
          : 'Not computed',
        why: (sized && sized.length)
          ? `Summed over ${num(sized.length)} of ${num(leads.length)} ${plural(leads.length, 'lead', 'leads')}. `
            + `${num(leads.length - sized.length)} ${plural(leads.length - sized.length, 'lead is', 'leads are')} `
            + 'excluded because this engine could not size ' + plural(leads.length - sized.length, 'it', 'them') + '.'
          /* The coverage view's summary first; failing that, the identical
             sentence each lead row carries. Losing the aggregate read must not
             turn a stated reason into "unknown" while the lead rows that
             explain it are sitting in memory. */
          : esc(C ? cannotClause(C.what_this_engine_cannot_tell_you, 'CANNOT SIZE:') : '')
            || esc(str((leads || []).map(d => str(d.opportunity_value_basis)).find(Boolean)))
            || (C
                ? 'The engine records no account of why it cannot size an opportunity.'
                : 'Neither the coverage view nor the lead rows could be read, so it is not known whether anything could be estimated.'),
      });

      ledgerRows.push({
        word: 'Attributed',
        means: 'Money a recorded action can be shown to have produced.',
        value: attributed === 0 ? aed(0) : num(null),
        why: attributed === 0
          ? `No action in either lane carries an attributed outcome, so no row anywhere holds a recovered value. `
            + `${num(H.executed)} inventory ${plural(H.executed, 'action has', 'actions have')} been carried out and `
            + `${num(C.recovery_actions_executed)} lead recovery `
            + `${plural(C.recovery_actions_executed, 'action has', 'actions have')} been carried out. `
            + 'Attribution needs an executed action and a completed outcome tied to it, and neither lane has both.'
          : attributed != null
            ? `${num(attributed)} ${plural(attributed, 'outcome is', 'outcomes are')} attributed; their value is not summed on this screen.`
            : 'The action lanes could not be read.',
      });

      ledgerRows.push({
        word: 'Confirmed',
        means: 'Revenue a completed sale actually produced. Not the same as recovered.',
        /* Same rule as the tile above and for the same reason: with nothing
           admitted there is no figure, and the word "Confirmed" beside AED 0
           would read as a confirmed nil rather than as an unconfirmed sale.
           `Estimated` two rows up already says "Not computed" in exactly this
           situation; this row now behaves the same way. */
        value: !S ? num(null) : S.confirmed.length ? aed(S.revenue) : 'Nothing confirmed',
        why: S
          ? `${num(S.confirmed.length)} ${plural(S.confirmed.length, 'sale', 'sales')} on file with CONFIRMED revenue`
            + (S.unconfirmed
                ? `, and ${num(S.unconfirmed)} excluded because ${plural(S.unconfirmed, 'its', 'their')} revenue is not confirmed or carries no amount`
                : ', and none excluded')
            + '. Summed from the attribution sale chain. This money is on the books and none of it is attributed to '
            + 'anything NEXUS did.'
            + (S.confirmed.length && C && n0(C.confirmed_revenue_aed) != null && Number(C.confirmed_revenue_aed) !== S.revenue
                ? ` THESE TWO VIEWS DISAGREE: Lead Recovery's coverage puts confirmed revenue at ${aed(C.confirmed_revenue_aed)}. `
                  + 'Neither has been adjusted to match the other and neither is presented as settled.'
                : '')
          : 'The sale chain could not be read.',
      });

      const ledger = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Word</th><th>What it means</th><th class="r">Today</th><th>How that figure was arrived at</th>
        </tr></thead><tbody>${ledgerRows.map(w => `<tr>
          <td class="strong">${esc(w.word)}</td>
          <td>${muted(esc(w.means))}</td>
          <td class="r num strong">${w.value}</td>
          <td>${muted(w.why)}</td>
        </tr>`).join('')}</tbody></table></div>`;

      return `<div class="grid g5">${exposureTile}${riskTile}${dealTile}${decisionTile}${recoveryTile}</div>

        <div class="section" style="margin-top:18px">
          <div class="label-caps">Three words that are not interchangeable</div>
          ${ledger}
        </div>

        <div class="banner info">
          <span class="material-symbols-outlined" style="font-size:20px">functions</span>
          <div>
            ${bold('There is no total &ldquo;revenue at risk&rdquo; on this page, and there is not going to be one.')}
            ${muted('Nothing in this system can compute it. Lead Recovery reports risk, not value: no lead carries a '
              + 'budget and no column links a lead to a unit, so its opportunity value comes back UNKNOWN on every row '
              + 'rather than zero. The Profit Sentinel&rsquo;s figure above is margin exposed inside unsold stock, which '
              + 'is a different quantity from revenue and is measured on cars rather than on customers. Adding them '
              + 'would produce one confident number made of two things that are not the same thing. Each engine&rsquo;s '
              + 'figure stands on its own below, in its own units.')}
          </div>
        </div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P2 · Margin exposed on stock — the Sentinel's own figure, itemised
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Margin exposed on stock',
    sub: 'Gross margin — list price minus acquisition cost — sitting inside units that have not sold. '
       + 'Exposure is not loss, not expected loss, not revenue and not recovery',
    actions: linkBtn('inventory', 'Open Inventory') + ' ' + linkBtn('actions', 'Open Action Center'),
    load: () => readSentinel(),
    render: rows => {
      const F = sentinelFacts(rows);
      if (!F.units.length) {
        return stateEmpty('The Profit Sentinel returned no units',
          'That is an empty lot or a read that matched nothing, and this screen cannot tell those two apart. '
          + 'No exposure figure is shown rather than a zero.', 'directions_car');
      }

      const body = F.exposed.length
        ? table([
            { label: 'Unit', strong: true, render: u =>
                `<div>${esc(str(u.model) || str(u.id))}</div><div class="ds-cell-sub mono">${esc(str(u.id))}</div>` },
            { label: 'Ageing', render: u => pill(str(u.aging_band), '', { verbatim: true }) },
            { label: 'Risk', render: u => pill(str(u.overall_risk), '', { verbatim: true }) },
            { label: 'Days in stock', align: 'r', render: u =>
                (n0(u.days_in_stock) == null ? '<span class="t-muted">unknown</span>' : num(u.days_in_stock)) },
            { label: 'Recommended', render: u => pill(str(u.recommendation), '', { verbatim: true }) },
            { label: 'Margin exposed', align: 'r', strong: true, render: u => aed(u.impact_aed) },
          ], F.exposed)
        : stateEmpty('No unit is carrying exposed margin today',
            `The engine scored ${F.units.length} ${plural(F.units.length, 'unit', 'units')} and claims no impact on any `
            + 'of them. That is the engine answering, not the engine being empty.', 'check_circle');

      /* Every note below is counted from the rows in F, so each sentence is true
         of the branch it sits in rather than of the day it was written. */
      const notes = [];
      notes.push(`This total adds ${num(F.exposed.length)} of ${num(F.units.length)} `
        + `${plural(F.units.length, 'unit', 'units')}. ${num(F.noClaim.length)} `
        + `${plural(F.noClaim.length, 'unit is', 'units are')} excluded because the engine recommends no action on `
        + `${plural(F.noClaim.length, 'it', 'them')} and therefore claims no impact — margin intact, not margin at risk. `
        + (F.unsized.length
            ? `${num(F.unsized.length)} further ${plural(F.unsized.length, 'unit is', 'units are')} excluded because the `
              + 'engine named an impact it could not put a figure to, which is a gap rather than a zero.'
            : 'No unit was left out for want of a figure the engine could not compute.'));

      if (F.noHolding) {
        notes.push(`How fast that margin is being eaten is NOT COMPUTABLE on ${num(F.noHolding)} of `
          + `${num(F.units.length)} ${plural(F.units.length, 'unit', 'units')}: this dealership has never recorded what `
          + 'a day of floor space costs. Unknown, not nil — the figure above is a stock, never a rate.');
      }
      if (F.noMarket) {
        notes.push(`No verified market comparable exists for ${num(F.noMarket)} of ${num(F.units.length)} `
          + `${plural(F.units.length, 'unit', 'units')}. That is why a REPRICE recommendation anywhere in this product `
          + 'means "a person should look at the price of this car" and never names a new price: NEXUS holds no figure '
          + 'it could honestly propose.');
      }
      if (F.defaults) {
        notes.push('The ageing and margin thresholds behind these bands are this product\'s defaults rather than '
          + 'thresholds this dealership has set. A reasonable starting point, and not yet an agreed policy.');
      }
      notes.push(`Ageing bands: ${num(F.critical)} CRITICAL, ${num(F.warning)} WARNING, ${num(F.healthy)} HEALTHY. `
        + `The engine is asking for a decision on ${num(F.needsDecision)} `
        + `${plural(F.needsDecision, 'unit', 'units')} and recommends HOLD on ${num(F.hold)}.`
        + (F.computedAt ? ` Scored ${esc(dubaiStamp(F.computedAt))}.` : ''));

      return body + `<div class="section" style="margin-top:16px">${notes.map(t => muted(t)).join('')}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P3 · The action lane — what a person has actually been asked
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'What has been put to a person, and what came back',
    sub: 'The inventory action lane. An approval is a decision rather than money, and a rejection is a result rather '
       + 'than a failure',
    actions: linkBtn('actions', 'Open Action Center'),
    load: async () => {
      const [h, q] = await Promise.all([settle(readActionHealth()), settle(readQueue())]);
      if (h.err && q.err) throw h.err;
      return { h, q };
    },
    render: ({ h, q }) => {
      const H = h.err ? null : (h.v && h.v[0]) || null;
      const rows = q.err ? null : (q.v || []);

      const summary = H
        ? `<div class="grid g4">
            ${kpi('Waiting on a decision', num(H.awaiting_decision), muted(n0(H.awaiting_decision)
                /* Both plurals key off undecided_with_no_figure, which is the
                   subject of the clause. Keying them off awaiting_decision put
                   "0 of them carries no figure and is not in that sum" on the
                   screen — a singular verb agreeing with the wrong noun. */
                ? `${aed(H.undecided_exposure_aed)} of exposure behind ${plural(H.awaiting_decision, 'it', 'them')}. `
                  + (n0(H.undecided_with_no_figure)
                      ? `${num(H.undecided_with_no_figure)} of them `
                        + `${plural(H.undecided_with_no_figure, 'carries no figure and is', 'carry no figure and are')} `
                        + 'not in that sum'
                      : 'Every one of them carries a figure, so none is missing from that sum')
                : 'Nobody is late answering anything'), n0(H.awaiting_decision) ? 't-hot' : '')}
            ${kpi('Approved, not carried out', num(H.approved_not_executed), muted(n0(H.approved_not_executed)
                ? 'Decided and still undone. Nothing about the unit has changed'
                : 'Nothing decided is sitting undone'), n0(H.approved_not_executed) ? 't-hot' : '')}
            ${kpi('Carried out', num(H.executed), muted(n0(H.executed)
                ? `${num(H.executed_awaiting_outcome)} still awaiting an outcome`
                : 'No action has been recorded as carried out, so no outcome can exist yet to measure'))}
            ${kpi('Outcomes attributed', num(H.outcomes_attributed), muted(n0(H.outcomes_attributed)
                ? `${num(H.outcomes_not_attributable)} marked not attributable`
                : 'No completed sale has been linked to any of these actions. Nothing has been recovered because '
                  + 'nothing has been connected — an evidence gap, not a result'))}
          </div>`
        : `<div class="section">${readFailed('Action Center health', h.err)}</div>`;

      const list = rows == null
        ? `<div class="section">${readFailed('The action queue', q.err)}</div>`
        : table([
            { label: 'Unit', strong: true, render: a =>
                `<div>${esc(str(a.unit_model) || str(a.unit_id))}</div>`
                + `<div class="ds-cell-sub mono">${esc(str(a.unit_id))}</div>` },
            { label: 'Recommended', render: a => pill(str(a.recommendation), '', { verbatim: true }) },
            { label: 'Status', render: a => pill(str(a.status), '', { verbatim: true }) },
            { label: 'Exposure at stake', align: 'r', render: a => (up(a.engine_impact_kind) === 'NONE'
                ? '<span class="t-muted">none claimed</span>'
                : n0(a.engine_impact_aed) == null
                  ? '<span class="t-muted">not sized</span>'
                  : aed(a.engine_impact_aed)) },
            { label: 'Outcome', render: a => muted(esc(str(a.outcome_sentence)
                || 'The database records no outcome sentence against this action.')) },
          ], rows, {
            empty: stateEmpty('No action has ever been raised',
              'The engine is recommending things and nobody has been asked about any of them, so nothing appears on '
              + 'any queue and nobody is late. That is an unopened lane rather than an approved one.', 'task_alt'),
          });

      const foot = H
        /* Printed the engine's own token — "Lane health: PRODUCING_NOTHING" —
           until 5 Sep 2026. lib/health.js already holds the sentence for every
           one of these states and every other screen uses it; this one had a
           raw enum where the words were. An unrecognised value still falls
           through to itself, which is healthWords' own rule. */
        ? muted(`Lane health: ${esc(str(H.health) ? healthWords(H.health).label : 'not stated')}. ${num(H.events_total)} recorded `
            + `${plural(H.events_total, 'step', 'steps')}, ${num(H.events_without_audit)} without an audit row behind `
            + `${plural(H.events_without_audit, 'it', 'them')}. `
            + (H.last_activity_at ? `Last activity ${esc(dubaiStamp(H.last_activity_at))}.` : 'No activity recorded.'))
        : '';

      return summary + list + (foot ? `<div class="section" style="margin-top:16px">${foot}</div>` : '');
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P4 · Lead Recovery — the zero, at full size, with its reason
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Lead Recovery',
    sub: 'Whether a lead is leaking, and what this engine can and cannot see while it answers',
    actions: linkBtn('leadrecovery', 'Open Lead Recovery') + ' ' + linkBtn('leads', 'Open Leads'),
    load: async () => {
      const [l, c] = await Promise.all([settle(readLeads()), settle(readCoverage())]);
      if (l.err && c.err) throw l.err;
      return { l, c };
    },
    render: ({ l, c }) => {
      const leads = l.err ? null : (l.v || []);
      const C = c.err ? null : (c.v && c.v[0]) || null;

      /* The headline count is the coverage view's, not a recount of the rows
         below it — one figure, one derivation. Where the two disagree the
         screen says so rather than quietly preferring one of them. */
      const head = C
        ? `<div class="grid g4">
            ${kpi('At risk', num(C.leads_at_risk), muted(n0(C.leads_at_risk)
                ? 'Each one is listed below with the evidence behind it'
                : 'No measurable recovery opportunity is currently detected. The engine scored every lead on file and '
                  + 'flagged none; the reason it gave for each one is in the Why column below'),
                n0(C.leads_at_risk) ? 't-hot' : '')}
            ${kpi('Risk undetermined', num(C.leads_risk_unknown), muted(n0(C.leads_risk_unknown)
                ? 'Not scored either way. Unknown is not the same as safe'
                : 'Every lead on file was scored one way or the other'),
                n0(C.leads_risk_unknown) ? 't-hot' : '')}
            ${kpi('Leads with no owner', num(C.leads_with_no_owner),
                muted(`Of ${num(C.leads_total)} ${plural(C.leads_total, 'lead', 'leads')}. `
                  + 'An action with nobody\'s name on it is an action nobody does'),
                n0(C.leads_with_no_owner) ? 't-hot' : '')}
            ${kpi('Sales attributed to a recovery action', num(C.sales_attributed_to_a_recovery_action),
                muted(n0(C.sales_attributed_to_a_recovery_action)
                  ? 'Linked to an action in this lane'
                  : `${num(C.leads_with_a_confirmed_sale)} confirmed `
                    + `${plural(C.leads_with_a_confirmed_sale, 'sale is', 'sales are')} on file `
                    + `(${aed(C.confirmed_revenue_aed)}), and none is linked to an action here. `
                    + 'Confirmed is not attributed'))}
          </div>`
        : `<div class="section">${readFailed('Lead Recovery coverage', c.err)}</div>`;

      const mismatch = (C && leads && Number(C.leads_total) !== leads.length)
        ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">rule</span><div>
             The coverage view counts ${num(C.leads_total)} ${plural(C.leads_total, 'lead', 'leads')} and the lead list
             returned ${num(leads.length)}. Two reads of one engine disagree, so the counts above are the coverage
             view's and the rows below are the list's. Neither has been adjusted to agree with the other.
           </div></div>`
        : '';

      const list = leads == null
        ? `<div class="section">${readFailed('The lead list', l.err)}</div>`
        : table([
            { label: 'Lead', strong: true, render: d =>
                `<div>${esc(maskText(str(d.lead_name) || ('Lead ' + str(d.lead_id))))}</div>`
                + `<div class="ds-cell-sub mono">#${esc(str(d.lead_id))} · ${esc(str(d.lead_status) || 'no status')}</div>` },
            { label: 'State', render: d => pill(str(d.state), '', { verbatim: true }) },
            { label: 'Risk', render: d => pill(str(d.risk_level), '', { verbatim: true }) },
            { label: 'Why', render: d => muted(esc(str(d.risk_basis)
                || 'The database records no basis for this risk level.')) },
            { label: 'What it could be worth', render: d => (n0(d.opportunity_value_aed) != null
                ? aed(d.opportunity_value_aed)
                : `<span class="t-muted">${esc(str(d.opportunity_value_state) || 'UNKNOWN')}</span>`
                  + muted(esc(str(d.opportunity_value_basis).replace(/^UNKNOWN\.\s*/i, ''))
                      || 'The database records no basis for withholding this figure.')) },
          ], leads, {
            empty: stateEmpty('This engine scored no leads',
              'No lead row reached it. That is an empty pipeline or a read that matched nothing, and this screen '
              + 'cannot tell those two apart.', 'person_search'),
          });

      /* The engine's own account of its blind spots, printed verbatim. It is
         better written than anything this file could paraphrase, and a
         paraphrase would be a second copy of a business fact that drifts the
         first time the view is edited. */
      const blind = C && str(C.what_this_engine_cannot_tell_you)
        ? `<div class="section">
             <div class="label-caps">What this engine cannot tell you</div>
             <div class="quote">${esc(str(C.what_this_engine_cannot_tell_you))}</div>
           </div>`
        : '';

      const detector = C
        ? muted(`Silence detector: ${esc(str(C.silence_detector_state) || 'not stated')}`
            + (C.silence_detector_last_success_at
                ? `, last succeeded ${esc(dubaiStamp(C.silence_detector_last_success_at))}`
                : ', with no successful run on record')
            + (up(C.silence_detector_state) === 'STALE'
                ? '. A stale marker corroborates nothing, so "the customer has gone quiet" is computed here from '
                  + 'message timestamps alone and is weaker than it looks.'
                : '.')
            + ` Identity: ${num(C.message_events_resolved_to_a_lead)} of ${num(C.message_events)} message events `
            + `resolve to a lead (${esc(str(C.identity_resolution_pct))}%), and `
            + `${num(C.unresolved_whatsapp_handles)} WhatsApp `
            + `${plural(C.unresolved_whatsapp_handles, 'handle matches', 'handles match')} no lead at all — any `
            + 'conversation on those handles is invisible to every figure on this page.')
        : '';

      return head + mismatch + list + blind + (detector ? `<div class="section">${detector}</div>` : '');
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P5 · Deal Rescue — nothing to rescue, and a reason for every candidate
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Deal Rescue',
    sub: 'No in-flight deal is a fact about this database rather than about the sales floor. '
       + 'Everything examined and refused is listed, with the reason it is not a deal',
    actions: linkBtn('dealrescue', 'Open Deal Rescue'),
    load: async () => {
      const [r, cd, rd] = await Promise.all([settle(readRescue()), settle(readCandidates()), settle(readReadiness())]);
      if (r.err && cd.err && rd.err) throw r.err;
      return { r, cd, rd };
    },
    render: ({ r, cd, rd }) => {
      const deals = r.err ? null : (r.v || []);
      const cands = cd.err ? null : (cd.v || []);
      const ready = rd.err ? null : (rd.v || []);
      const met = ready ? ready.filter(p => p.met_now === true).length : null;

      const head = `<div class="grid g3">
        ${deals == null
          ? kpi('Deals in flight', num(null), readFailed('Deal Rescue', r.err))
          : kpi('Deals in flight', num(deals.length), muted(deals.length
              ? 'Each is listed on the Deal Rescue screen, ranked by what it is stuck on'
              : 'No deal record exists while a deal is still in progress. The sale record is written at the moment of '
                + 'sale, so deal-created and sale-confirmed are one event and there is no in-flight period to observe'),
              deals.length ? 't-hot' : '')}
        ${cands == null
          ? kpi('Candidates examined', num(null), readFailed('The candidate list', cd.err))
          : kpi('Candidates examined', num(cands.length),
              muted(`Every row that could plausibly have been a deal, checked and refused. `
                + `${num(cands.length)} ${plural(cands.length, 'reason is', 'reasons are')} on record below`))}
        ${ready == null
          ? kpi('Prerequisites met', num(null), readFailed('The readiness list', rd.err))
          : kpi('Prerequisites met', `${num(met)} / ${num(ready.length)}`, muted(met === 0
              ? 'None of them. This engine is blocked on schema and integrations rather than on code'
              : 'Measured live against the schema, not asserted'))}
      </div>`;

      const candTable = cands == null
        ? ''
        : table([
            { label: 'What it is', strong: true, render: k =>
                `<div>${esc(str(k.customer_label) || str(k.candidate_ref) || 'unnamed row')}</div>`
                + `<div class="ds-cell-sub">${esc(str(k.candidate_kind))} · `
                + `<span class="mono">${esc(str(k.source_table))}</span></div>` },
            { label: 'Verdict', render: k => pill(str(k.verdict), '', { verbatim: true }) },
            { label: 'Why it is not a deal', render: k => muted(esc(str(k.verdict_basis)
                || 'The database records no reason for this verdict, which is itself a gap.')) },
            { label: 'Value', align: 'r', render: k => (n0(k.deal_value_aed) != null
                ? aed(k.deal_value_aed)
                : `<span class="t-muted">${esc(str(k.deal_value_state) || 'UNKNOWN')}</span>`) },
          ], cands, {
            empty: stateEmpty('Nothing was examined',
              'The candidate view returned no rows at all, so it found nothing that could even be considered — which '
              + 'is not the same as considering things and clearing them.', 'search'),
          });

      const readyBlock = ready == null
        ? `<div class="section">${readFailed('The readiness list', rd.err)}</div>`
        : `<div class="section" style="margin-top:16px">
             <div class="label-caps">What would have to exist before this engine has anything to rank</div>
             ${table([
               { label: 'Prerequisite', strong: true, render: p =>
                   `<div style="white-space:normal">${esc(str(p.requirement))}</div>`
                   + `<div class="ds-cell-sub mono">${esc(str(p.id))} · ${esc(str(p.kind))}</div>` },
               { label: 'Met', render: p => (p.met_now === true
                   ? pill('Met', 'ok', { verbatim: false })
                   : pill('Not met', 'hot', { verbatim: false })) },
               { label: 'Measured now', render: p => muted(esc(str(p.measured_now)
                   || 'The view returned no measurement for this prerequisite.')) },
             ], ready, {
               empty: stateEmpty('No prerequisites are recorded',
                 'The readiness view is empty, so this screen cannot say what is blocking the engine.', 'checklist'),
             })}
           </div>`;

      const note = muted('None of the above is a coding task waiting on somebody. It is a deal record that starts when '
        + 'a deal starts, an appointments feed, and a hard link from a sale to the unit that was sold — three '
        + 'integrations with systems the sales floor already uses. Until they exist this engine reports honestly that '
        + 'it has nothing to rank, and that is the correct output rather than a defect.');

      return head + candTable + readyBlock + `<div class="section">${note}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P6 · The Policy Engine — what every figure above is standing on
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'The rules these engines run on',
    sub: 'Jurisdiction and threshold rules are meant to be data with a source rather than constants in the code. '
       + 'This is how far that has got',
    actions: linkBtn('policy', 'Open Policy') + ' ' + linkBtn('compliance', 'Open Compliance'),
    load: async () => {
      const [ru, co] = await Promise.all([settle(readRules()), settle(readConstants())]);
      if (ru.err && co.err) throw ru.err;
      return { ru, co };
    },
    render: ({ ru, co }) => {
      const rules = ru.err ? null : (ru.v || []);
      const consts = co.err ? null : (co.v || []);

      const verified = rules ? rules.filter(k => up(k.verification_status) === 'VERIFIED').length : null;
      const reliable = rules ? rules.filter(k => k.may_be_relied_on === true).length : null;
      const facing = consts ? consts.filter(k => k.reaches_a_customer === true).length : null;
      const blocked = consts ? consts.filter(k => up(k.migration_state) === 'BLOCKED_ON_VERIFICATION').length : null;

      const head = `<div class="grid g4">
        ${rules == null
          ? kpi('Rule versions on record', num(null), readFailed('The policy rules', ru.err))
          : kpi('Rule versions on record', num(rules.length),
              muted('Every version of every rule, superseded ones included'))}
        ${rules == null
          ? kpi('Verified', num(null), readFailed('The policy rules', ru.err))
          : kpi('Verified', num(verified), muted(verified === 0
              ? `Not one. All ${num(rules.length)} ${plural(rules.length, 'version is', 'versions are')} recorded as a `
                + 'question, sourced to this codebase or to an unsourced research claim'
              : `Of ${num(rules.length)} ${plural(rules.length, 'version', 'versions')}`),
              verified === 0 ? 't-hot' : '')}
        ${rules == null
          ? kpi('May be relied on', num(null), readFailed('The policy rules', ru.err))
          : kpi('May be relied on', num(reliable), muted(reliable === 0
              ? 'No rule here is authoritative, so no customer-facing regulatory claim this product makes is currently '
                + 'backed by one'
              : `Of ${num(rules.length)} ${plural(rules.length, 'version', 'versions')}`),
              reliable === 0 ? 't-hot' : '')}
        ${consts == null
          ? kpi('Constants still in code', num(null), readFailed('The constant survey', co.err))
          : kpi('Constants still in code', num(consts.length),
              muted(`${num(facing)} of them reach a customer, and ${num(blocked)} `
                + `${plural(blocked, 'is', 'are')} blocked on verifying the rule ${plural(blocked, 'it', 'they')} `
                + 'would move to'),
              facing ? 't-hot' : '')}
      </div>`;

      const ruleTable = rules == null
        ? `<div class="section">${readFailed('The policy rules', ru.err)}</div>`
        : table([
            { label: 'Rule', strong: true, render: k =>
                `<div class="mono">${esc(str(k.rule_name))}</div>`
                + `<div class="ds-cell-sub">${esc(str(k.jurisdiction))} · ${esc(str(k.rule_type))} · `
                + `v${esc(str(k.version))} · ${esc(str(k.status))}</div>` },
            { label: 'Value', render: k => (str(k.value_display)
                ? `<span class="mono">${esc(str(k.value_display))}</span>`
                : '<span class="t-muted">no value recorded — the row is a question, not an answer</span>') },
            { label: 'Authority', render: k => pill(str(k.authority), '', { verbatim: true }) },
            { label: 'Source', render: k => muted(esc(str(k.source_name) || 'No source recorded.')) },
          ], rules, {
            empty: stateEmpty('No policy rule is on record',
              'Every threshold this product applies is therefore a constant in the code with nothing standing behind '
              + 'it.', 'gavel'),
          });

      const constTable = consts == null
        ? ''
        : `<div class="section" style="margin-top:16px">
             <div class="label-caps">Constants still hard-coded${facing ? `, ${num(facing)} of which reach a customer` : ''}</div>
             ${table([
               { label: 'Where', strong: true, render: k =>
                   `<div class="mono" style="white-space:normal">${esc(str(k.location))}</div>`
                   + `<div class="ds-cell-sub">${esc(str(k.layer))} · ${esc(str(k.kind))}</div>` },
               { label: 'Value in force', render: k => `<span class="mono">${esc(str(k.current_value))}</span>` },
               { label: 'Reaches a customer', render: k => (k.reaches_a_customer === true
                   ? pill('Yes', 'hot', { verbatim: false })
                   : pill('No', 'cold', { verbatim: false })) },
               { label: 'State', render: k => pill(str(k.migration_state), '', { verbatim: true }) },
               { label: 'Would become', render: k => muted(`<span class="mono">${esc(str(k.proposed_rule_type))}`
                   + ` / ${esc(str(k.proposed_rule_name))}</span>`) },
             ], consts, {
               empty: stateEmpty('No hard-coded constant was found',
                 'Either every rule has moved into the policy tables or the survey has not been run, and this screen '
                 + 'cannot tell those two apart.', 'done_all'),
             })}
           </div>`;

      const note = (rules && verified === 0 && facing)
        ? hot(`Read this panel with the one at the top of the page. A REPRICE recommendation names no price because no `
            + `market comparable is verified, and ${num(facing)} ${plural(facing, 'figure', 'figures')} this product can `
            + 'put in front of a customer still rest on a constant in the codebase rather than on a verified rule. '
            + 'Neither is a defect in the engines above; both are the same missing evidence, surfaced rather than '
            + 'papered over.')
        : '';

      return head + ruleTable + constTable + (note ? `<div class="section">${note}</div>` : '');
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P7 · The confirmed sales, hop by hop
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Confirmed revenue, and what is actually known about it',
    sub: 'Confirmed revenue is money a sale produced. It is not attributed revenue and it is not recovered revenue — '
       + 'this panel is that difference, made visible',
    actions: linkBtn('attribution', 'Open Attribution') + ' ' + linkBtn('deals', 'Open Deals'),
    load: () => readSale(),
    render: rows => {
      const S = saleFacts(rows);
      if (!S.sales.length) {
        return stateEmpty('No sale is on file',
          'The sale record holds no row this account can read, so there is no confirmed revenue to describe and none '
          + 'is claimed. An empty ledger, not a zero result.', 'receipt_long');
      }

      const head = `<div class="grid g3">
        ${S.confirmed.length
          ? kpi('Confirmed revenue', aed(S.revenue),
              muted(`Summed over ${num(S.confirmed.length)} of ${num(S.sales.length)} `
                + `${plural(S.sales.length, 'sale', 'sales')} on file`
                + (S.unconfirmed
                    ? `, with ${num(S.unconfirmed)} excluded because ${plural(S.unconfirmed, 'its', 'their')} revenue is not confirmed or carries no amount`
                    : ', with none excluded')
                + '. Confirmed means the amount is a column of the sale record itself.'), 't-won')
          /* Sales exist and not one of them is admitted. The total of an empty
             admitted set is arithmetically zero, and printing it is still the
             thing this product must not do: an executive reads the tile, not
             the line under it, and "AED 0" beside the word revenue reads as a
             trading result. The gross-margin tile immediately to the right has
             said "Not computable, which is not the same as zero" since it was
             written; this is the same situation and now says the same kind of
             thing. Nothing is claimed to be zero — what is stated is that
             nothing qualified, and why. */
          : kpi('Confirmed revenue', 'Nothing confirmed',
              muted(`${num(S.sales.length)} ${plural(S.sales.length, 'sale is', 'sales are')} on file and not one `
                + `carries a confirmed amount, so there is no confirmed revenue to total. That is an absence and `
                + `not a nil — the ${plural(S.sales.length, 'sale', 'sales')} may well have produced money the sale `
                + `record does not state. Confirmed means the amount is a column of the sale record itself.`))}
        ${S.withMargin.length
          ? kpi('Gross margin on those sales', aed(S.margin),
              muted(`Computable on ${num(S.withMargin.length)} of ${num(S.sales.length)} `
                + `${plural(S.sales.length, 'sale', 'sales')}; the rest are not in this figure`))
          : kpi('Gross margin on those sales', 'Not computable',
              muted('Not computable, which is not the same as zero. Acquisition cost is on record for every unit in '
                + 'stock, but nothing ties a sale to a unit, so there is no cost to subtract.'))}
        ${/* This tile printed a hard-coded aed(0) — the only monetary literal on
             the screen, derived from nothing and unable to change. It asserted
             "AED 0 attributed" on every render, including a render in which
             something HAD been attributed, because it read no row to find out.
             The claim it is entitled to make is about the SCHEMA, not about an
             amount: the sale chain this panel reads carries no link from a sale
             to an inventory or lead-recovery action, so nothing in these rows
             can be attributed to NEXUS and no total over them exists to print.
             The countable version of this question — how many outcomes are
             attributed, across both action lanes — is the "Confirmed recovery"
             tile in P1, which reads the two health views and prints AED 0 only
             where their counters make the nil provable. */''}
        ${kpi('Attributed to a NEXUS action', 'No link exists',
          muted('None of this revenue is attributed to anything this product did, and the sale record holds no column '
            + 'that could tie it to one — so this is the absence of a link rather than a measured nil. The sale is '
            + 'real, the money is real, and the causal link is absent, which is why it appears here as confirmed and '
            + 'nowhere as recovered.'))}
      </div>`;

      const detail = S.sales.map(s => {
        const chain = Array.isArray(s.chain) ? s.chain : [];
        const hops = chain.length
          ? `<div class="timeline">${chain.map(h => `<div class="tl-item">
               <div class="tl-dot"></div>
               <div class="tl-body">
                 ${bold(`${esc(str(h.hop))} ${pill(str(h.state), '', { verbatim: true })}`)}
                 ${muted(esc(str(h.note) || 'No note is recorded for this hop.'))}
               </div></div>`).join('')}</div>`
          : muted('The view returned no chain for this sale, so no hop can be shown. That is a missing explanation, '
              + 'not an unbroken chain.');
        return `<div class="section" style="margin-top:16px">
            ${bold(`${esc(maskText(str(s.customer_name) || 'Customer not named'))} — ${esc(str(s.vehicle_text) || 'vehicle not named')}`)}
            ${muted(`${aed(s.revenue_aed)} on ${esc(dubaiDate(s.purchase_date))} · `
              + `${num(s.hops_evidenced)} of ${num(s.hops_total)} hops evidenced · `
              + `first break at ${esc(str(s.first_break) || 'no break recorded')}`)}
            ${hops}
          </div>`;
      }).join('');

      return head + detail;
    },
  }).then(wireGo);
};
