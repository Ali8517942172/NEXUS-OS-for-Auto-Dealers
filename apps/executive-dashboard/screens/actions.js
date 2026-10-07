/* NEXUS OS — screens/actions.js
   The Action Center: the screen where the Profit Sentinel stops being a report.

   PRODUCT.md states the claim as detect -> decide -> act -> measure. Lane A
   built DETECT: public.v_inventory_profit_sentinel scores every unit and
   recommends REPRICE / PROMOTE / HOLD and the rest, per VIN, from real cost and
   real days in stock. Nothing recorded what a person DID about any of it. This
   screen is the other three verbs, and every one of them is a database write
   through a function, never a row this browser composes.

   WHERE EVERYTHING COMES FROM
     public.v_inventory_action_queue     one row per action, joined to the unit,
                                         to the people, and to what the engine
                                         says about that unit RIGHT NOW.
     public.v_inventory_action_timeline  every recorded step, with the audit_log
                                         row behind it and that row classified
                                         by public.nexus_outcome_class.
     rpc/sentinel_inventory_actions      the engine, for units that have a
                                         recommendation and no action yet.
     rpc/action_approver_context         who this account is and whether it may
                                         decide. Read from the database, not
                                         guessed from users.role in the browser.
     rpc/action_propose | action_decide | action_mark_executed
                                         the writes. All SECURITY DEFINER, all
                                         authorisation-checked server side.

   FOUR RULES THIS SCREEN IS BUILT AROUND

   1. NEVER RENDER A SUGGESTED PRICE MOVEMENT. The engine has no verified market
      comparable for a single unit on this lot — every row comes back
      UNKNOWN_NO_COMPARABLE or UNKNOWN_UNVERIFIED_COMPARABLE — so "drop it by
      AED 12,000" would be a number nobody computed. REPRICE here means "a human
      should look at the price of this car", and the card says so in words.

   2. EXPOSURE IS NOT RECOVERY. engine_impact_aed is gross margin sitting in a
      unit that has not sold. It is labelled "at risk" everywhere it appears and
      is never added up into anything called recovered, expected or saved.

   3. NO OUTCOME IS A SENTENCE, NOT A DASH. outcome_sentence is computed in the
      view so that one screen cannot say "—" where another says "AED 0". Both
      would be lies: purchase_history carries no reference to an inventory unit
      at all, so a sale cannot presently be tied to a car by anything but a
      person's word, and this screen says that out loud rather than leaving a
      gap where a figure would go.

   4. AUTHORISATION IS SHOWN, NOT HIDDEN. Where this account may not decide, the
      buttons are rendered and disabled with the database's own refusal sentence
      on them, and a banner explains why. Hiding them would teach the operator
      that the feature does not exist; the database refuses the call either way.
      Measured 2 Sep 2026: Tenant A has one staff row (Ali Asgher, job title
      senior_rep) and no manager. He can approve because he is the ACCOUNT OWNER
      (tenant_members.role = 'owner'), not because of his job title, and the
      record stores which of the two it was. */

import { db, dbWrite, onIdentityChange } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, dubaiStamp, esc, mins, num } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { modalError } from '../lib/modal.js';
import { displayName } from '../lib/privacy.js';
import { BTN, errorState, skeleton, openStitchDrawer } from '../lib/stitch-ui.js';
import { SX, BANNER, BANNER_ICON, stitchModal, kpi, panel, table, pill, stateEmpty, linkBtn, wireGo, engineHeader, engineFooter, evidenceChain, STEP_TEXT, STEP_LIST } from './revenue.js';

const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const valOf = r => (r.status === 'fulfilled' ? r.value : null);
const errOf = r => (r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : null);

/* ── Vocabulary ────────────────────────────────────────────────────────────
   Two vocabularies meet on this screen and they must not be merged.

   The ACTION LIFECYCLE (inventory_actions.status) is what a person did about a
   recommendation. The OUTCOME CLASS (nexus_outcome_class, mirrored by
   lib/health.js) is what a recorded run did, and it appears here only on the
   timeline beside the audit row it classifies. A rejection is a SUCCESS in the
   second vocabulary — the system successfully recorded a decision — and that
   is not a contradiction, it is the two axes doing their own jobs. The timeline
   labels both, side by side, so nobody has to guess which is which. */
const LIFECYCLE = {
  PROPOSED:         { label: 'Waiting on a decision', tone: 'warm',
                      blurb: 'The engine recommended this and nobody has answered yet.' },
  APPROVED:         { label: 'Approved',              tone: 'ok',
                      blurb: 'A person with authority said do it. It has not been carried out yet.' },
  REJECTED:         { label: 'Rejected',              tone: 'unknown',
                      blurb: 'A person said no, with a reason. Not a failure — it is how the engine learns it was wrong.' },
  DEFERRED:         { label: 'Deferred',              tone: 'cold',
                      blurb: 'Not now. Still open, and due again on the date recorded.' },
  EXECUTED:         { label: 'Carried out',           tone: 'ok',
                      blurb: 'Somebody recorded that they did it. Whether it produced anything is a separate question.' },
  EXECUTION_FAILED: { label: 'Not carried out',       tone: 'hot',
                      blurb: 'It was attempted and it did not happen.' },
  CANCELLED:        { label: 'Withdrawn',             tone: 'unknown',
                      blurb: 'Pulled before it was carried out.' },
};
const life = s => LIFECYCLE[up(s)] || { label: str(s) || 'Unknown', tone: 'unknown',
  blurb: 'This dashboard has no wording for that state; it is shown exactly as the database holds it.' };

/* ── The recovered-value evidence test ─────────────────────────────────────
   THE ONE DERIVATION FOR THE ONLY MONEY IN THIS PRODUCT THAT CLAIMS TO BE
   REAL. Exported, and screens/overview.js imports it rather than writing a
   second copy, because two derivations of a monetary claim is exactly the
   shape INV "one figure, one derivation" exists to stop.

   `recovered_value_aed` is not a figure this dashboard may render on its own
   null-ness. The sentence that has always sat beside it — "attributed", "a
   recorded sale tied to it by a person" — is a claim about FOUR other columns,
   and it was being made on a test of ONE. The database says what the claim
   costs, in public.inventory_actions:

     CONSTRAINT inventory_actions_recovered_needs_real_sale CHECK (
       recovered_value_aed IS NULL
       OR (outcome_state = 'ATTRIBUTED'
           AND outcome_purchase_id   IS NOT NULL
           AND attribution_basis     IS NOT NULL
           AND recovered_value_basis IS NOT NULL))

   Read live from pg_constraint on 3 Sep 2026. All four are required, including
   `recovered_value_basis` — the earlier three-column reading of this rule was
   short by one, and the fourth is the column that says HOW the figure was
   arrived at, which is the difference between an attributed number and a typed
   one.

   A CHECK is a storage rule, not a rendering rule, and the distinction is the
   whole point. The constraint holds today and every live row is null, so
   nothing fabricated is on screen. But it is not the only way a row reaches
   this browser: a view could compute the column, a future migration could drop
   or defer the constraint, a service-role import could arrive before it, and
   the screen would have no way to notice. So the screen tests the evidence
   itself and does not delegate its honesty to a constraint it cannot see.

   THREE STATES, AND THE THIRD IS THE POINT.
     NOT_RECORDED  no figure. The view's own outcome_sentence says which input
                   is missing. Never a zero, never a dash.
     ATTRIBUTED    a figure with all four columns behind it. Renders as money,
                   still labelled attributed and NOT confirmed as caused.
     UNSUPPORTED   a figure with the evidence missing. The figure is WITHHELD
                   and the disagreement is stated. Hiding it silently would be
                   the same defect one layer down: the reader would see nothing
                   and conclude nothing was recovered, when what is true is that
                   the row is broken. A row claiming money with no evidence
                   behind it cannot be stored by this database, so if one is on
                   screen something upstream is wrong and somebody must look. */
export const RECOVERY_EVIDENCE_COLS = ['outcome_state', 'outcome_purchase_id',
  'attribution_basis', 'recovered_value_basis', 'recovered_value_aed'];

export function recoveryEvidence(r) {
  const raw = r == null ? null : r.recovered_value_aed;
  const amount = (raw == null || raw === '' || Number.isNaN(Number(raw))) ? null : Number(raw);
  if (amount == null) return { state: 'NOT_RECORDED', amount: null, missing: [], basis: '' };

  /* Named in the operator's language, not the column's, because this sentence
     is read by a general manager and not by whoever wrote the migration. The
     column name is kept alongside so the person who has to fix the row can
     find it. */
  const missing = [];
  if (up(r.outcome_state) !== 'ATTRIBUTED')
    missing.push(`the outcome is recorded as ${str(r.outcome_state) || 'nothing at all'}, not ATTRIBUTED (outcome_state)`);
  if (!str(r.outcome_purchase_id))
    missing.push('no recorded sale is linked to it (outcome_purchase_id)');
  if (!str(r.attribution_basis))
    missing.push('nobody recorded on what basis the sale was tied to this action (attribution_basis)');
  if (!str(r.recovered_value_basis))
    missing.push('nobody recorded how the figure itself was arrived at (recovered_value_basis)');

  return missing.length
    ? { state: 'UNSUPPORTED', amount, missing, basis: str(r.recovered_value_basis) }
    : { state: 'ATTRIBUTED',  amount, missing: [], basis: str(r.recovered_value_basis) };
}

/* The single sentence every screen uses for the UNSUPPORTED case, so the
   product describes this defect the same way wherever it surfaces. It does not
   contain the figure: the figure is the thing being withheld. */
export const unsupportedRecoverySentence = ev =>
  `A recovered amount is recorded on this action with no evidence behind it, so NEXUS will not show it as money: `
  + `${ev.missing.join('; ')}. The database cannot store that combination, so this row is a fault to be reported, `
  + `not an amount to be read.`;

/* The engine's own recommendation words. HOLD reads calm because HOLD is the
   engine saying there is nothing to do; the rest are graded by how much is at
   stake. Same map as screens/inventory.js uses, for the same reason: a
   recommendation is not a severity and must not be painted like one. */
const REC_TONE = {
  HOLD: 'ok', PROMOTE: 'cold', REPRICE: 'warm', INSPECT: 'warm',
  RECON: 'warm', TRANSFER: 'warm', MANAGER_REVIEW: 'hot', WHOLESALE: 'hot',
};
const recTone = v => REC_TONE[up(v)] || 'unknown';

/* What the action actually asks a person to DO. This is the sentence that keeps
   REPRICE honest: the engine has no verified market data for these units, so it
   is asking for a human price review, not naming a new price. If a future
   engine ever earns the right to propose a figure, it will arrive as its own
   column and this map is where that would have to be handled explicitly. */
const REC_ASK = {
  REPRICE:        'Review the asking price on this unit. NEXUS is not proposing a figure and cannot: it holds no verified market comparable for this car.',
  PROMOTE:        'Put this unit in front of more buyers — listing, campaign, floor priority.',
  WHOLESALE:      'Consider moving this unit out through the trade rather than retail.',
  TRANSFER:       'Consider moving this unit to another location.',
  INSPECT:        'Physically look at this unit before deciding anything else.',
  RECON:          'Send this unit for reconditioning.',
  MANAGER_REVIEW: 'A manager needs to look at this unit personally.',
};
const recAsk = v => REC_ASK[up(v)] || 'The engine recommends ' + (str(v) || 'nothing recognisable') + '. This dashboard has no wording for that recommendation, so nothing is claimed about what it asks for.';

const RISK_TONE = { SEVERE: 'hot', HIGH: 'hot', ELEVATED: 'warm', LOW: 'cold', UNKNOWN: 'unknown' };
const riskTone = v => RISK_TONE[up(v)] || 'unknown';

const QUEUE_COLS = '*';
const LIMIT = 500;

/* ── Reads ─────────────────────────────────────────────────────────────── */
const readQueue   = () => db(`v_inventory_action_queue?select=${QUEUE_COLS}&order=proposed_at.desc&limit=${LIMIT}`);
const readCtx     = () => db('rpc/action_approver_context').then(r => (Array.isArray(r) ? r[0] : r) || null);
const readCodes   = () => db('inventory_action_reason_codes?select=*&order=sort.asc');
const readEngine  = () => db('rpc/sentinel_inventory_actions');
const readTimeline = id => db(`v_inventory_action_timeline?select=*&action_id=eq.${encodeURIComponent(id)}&order=at.asc`);

/* Writes. PostgREST posts to the function; the function returns exactly one row
   of (ok, idempotent, refusal_code, refusal_reason, action). A refusal comes
   back as ok = false with HTTP 200 — deliberately, in the database: raising
   would roll back the audit row that records the refusal, and a refusal nobody
   can see afterwards is not an audit. So every caller here checks `ok`. */
async function call(fn, body) {
  const r = await dbWrite('POST', `rpc/${fn}`, body);
  const row = Array.isArray(r) ? r[0] : r;
  if (!row) throw new Error(`${fn} returned nothing at all, which should not be possible.`);
  return row;
}

/* ── Evidence ────────────────────────────────────────────────────────────
   engine_evidence is an array of { fact, source } written by the engine. It is
   rendered verbatim, source included, because the source is the difference
   between a claim and a citation. Anything that is not that shape is shown as
   raw JSON rather than dropped — a silently ignored evidence item is a card
   claiming more support than it has. */
function evidenceList(ev) {
  const rows = Array.isArray(ev) ? ev : [];
  if (!rows.length) {
    return `<div class="${SX.sub}">The engine attached no evidence to this recommendation. That is not the
      same as there being none — it is this row carrying none, and nothing is inferred from the gap.</div>`;
  }
  return `<ul class="${STEP_LIST}">${rows.map(e => {
    const fact = str(e && e.fact), src = str(e && e.source);
    if (!fact) return `<li><span class="${SX.mono}">${esc(JSON.stringify(e))}</span></li>`;
    return `<li>${esc(fact)}${src ? `<div class="text-[10px] text-outline">${esc(src)}</div>` : ''}</li>`;
  }).join('')}</ul>`;
}

/* ── The card ────────────────────────────────────────────────────────────
   Five seconds, six answers, in this order: what, which unit, why, the
   evidence, who should act, and what happens if nobody does. */
function actionCard(r, ctx) {
  const L = life(r.status);
  const owner = str(r.assigned_to_name)
    ? esc(r.assigned_to_name)
    : (str(r.assigned_role) || str(r.engine_owner_role)
        ? `${esc(str(r.assigned_role) || str(r.engine_owner_role))} <span class="${SX.chip}">a role, not a person</span>`
        : `<span class="${SX.dim}">Nobody named</span>`);

  /* The engine may have changed its mind since this was proposed. Saying so is
     the whole point of freezing its words on the row: a manager approving a
     recommendation the engine has since withdrawn should be told before, not
     after. `null` means the engine has no current row for this unit, which is
     a third state and is worded as one. */
  const drift = r.engine_still_agrees === false
    ? `<div class="${BANNER.warm}">
         <span class="${BANNER_ICON}">change_circle</span>
         <div>The engine no longer recommends ${esc(r.recommendation)} for this unit — it now says
              <strong>${esc(str(r.engine_now_recommendation) || 'nothing')}</strong>.
              What you see below is what it said when this action was raised, on
              ${esc(dubaiStamp(r.proposed_at))}, because that is what the decision has to be judged against.</div></div>`
    : (r.engine_still_agrees == null && r.status !== 'REJECTED' && r.status !== 'CANCELLED'
        ? `<div class="${BANNER.warm}">
             <span class="${BANNER_ICON}">help</span>
             <div>The engine has no current row for this unit, so this dashboard cannot say whether it still
                  recommends ${esc(r.recommendation)}. That is unknown, not agreement.</div></div>`
        : '');

  const money = r.engine_impact_aed == null
    ? `<span class="${SX.dim}">No monetary impact claimed</span>`
    : `${aed(r.engine_impact_aed)} <span class="${SX.chip}">at risk, not recoverable</span>`;

  /* The evidence chain — action-center--31efb6's stepper. RESULT is pending
     until outcome_state says something other than NONE_YET; the money in it
     goes through recoveryEvidence() exactly like the outcome block below, so a
     figure without its four evidence columns is never shown here either. */
  const ev = recoveryEvidence(r);
  const pending = !str(r.outcome_state) || up(r.outcome_state) === 'NONE_YET';
  const evCount = Array.isArray(r.engine_evidence) ? r.engine_evidence.length : null;
  const actionStep = `<p class="${STEP_TEXT}"><strong>${esc(L.label)}</strong></p>`
    + `<p class="${STEP_TEXT} ${SX.dim}">${esc(L.blurb)}</p>`
    + (r.decided_at ? `<p class="${STEP_TEXT}">Decided by ${esc(str(r.decided_by_name) || 'an account with no staff record')}, ${esc(dubaiStamp(r.decided_at))}</p>` : '')
    + (r.executed_at ? `<p class="${STEP_TEXT}">Carried out by ${esc(str(r.executed_by_name) || 'somebody')}, ${esc(dubaiStamp(r.executed_at))}</p>` : '');
  const resultStep = `${pending ? '' : `<div class="${SX.row}">${pill(str(r.outcome_state), '', { verbatim: true })}</div>`}${
      ev.state === 'ATTRIBUTED'
        ? `<p class="${STEP_TEXT}"><strong>${aed(ev.amount)}</strong> attributed, not confirmed as caused</p>`
        : ev.state === 'UNSUPPORTED'
          ? `<p class="${STEP_TEXT} ${SX.hotTx}">An amount is recorded with nothing behind it — not shown</p>`
          : ''}<p class="${STEP_TEXT} ${SX.dim}">${esc(str(r.outcome_sentence) || 'No outcome linked.')}</p>`;

  return `<article class="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/40 shadow-sm flex flex-col gap-3" data-action="${esc(r.id)}">
    ${drift}
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container-low/70 p-3 rounded-lg">
      <div class="flex items-center gap-2.5 flex-wrap min-w-0">
        <span class="font-label-numeric-md text-label-numeric-md font-bold text-primary bg-primary-fixed/60 px-2 py-0.5 rounded">${esc(r.unit_id)}</span>
        <span class="font-body-md text-body-md font-semibold text-on-surface">${esc(str(r.unit_model) || 'Unit with no model recorded')}</span>
        ${r.unit_vin ? `<span class="font-label-numeric-sm text-[10px] px-1.5 py-0.5 rounded bg-surface-container-highest text-secondary uppercase">VIN ${esc(r.unit_vin)}</span>` : ''}
        ${r.unit_status ? `<span class="font-body-sm text-body-sm text-outline">${esc(r.unit_status)}</span>` : ''}
        <span class="font-label-numeric-sm text-[11px] text-outline">raised ${esc(dubaiStamp(r.proposed_at))}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0 flex-wrap">
        ${pill(L.label, L.tone, { verbatim: false })}
        ${r.engine_overall_risk ? pill(`${str(r.engine_overall_risk)} risk`, riskTone(r.engine_overall_risk), { verbatim: false }) : ''}
        ${r.engine_confidence ? `<span class="${SX.chip}" title="${esc(str(r.engine_confidence_basis))}">confidence ${esc(str(r.engine_confidence).toLowerCase())}</span>` : ''}
        <div class="text-right"><span class="font-table-header text-[9px] text-outline uppercase block">Margin at risk</span>
          <span class="font-label-numeric-md text-label-numeric-md text-error font-bold">${r.engine_impact_aed == null ? 'none claimed' : aed(r.engine_impact_aed)}</span></div>
      </div>
    </div>

    ${evidenceChain({
      recommendation: `<div class="${SX.row}">${pill(str(r.recommendation), recTone(r.recommendation), { verbatim: true })}</div>`
        + `<p class="${STEP_TEXT} mt-1">${esc(recAsk(r.recommendation))}</p>`,
      reason: `<p class="${STEP_TEXT}">${esc(str(r.engine_reason) || 'The engine recorded no reason on this row.')}</p>`,
      evidenceCount: evCount,
      evidence: evidenceList(r.engine_evidence),
      action: actionStep,
      resultPending: pending,
      result: resultStep,
    })}

    <div class="${SX.g2}">
      <div class="${SX.note}"><div class="${SX.caps}">Who should act</div>
        <div class="font-body-sm text-body-sm text-on-surface">${owner}</div>
        ${str(r.assigned_to_name) ? '' : `<div class="${SX.sub}">NEXUS holds no verified role directory for this dealership, so it names the role the engine asked for rather than putting a person's name against work it cannot confirm they own.</div>`}
      </div>
      <div class="${SX.note}"><div class="${SX.caps}">If nobody acts</div>
        <div class="font-body-sm text-body-sm text-on-surface">${money}</div>
        <div class="${SX.sub}">${esc(str(r.cost_of_doing_nothing) || str(r.engine_impact_basis) || 'Nothing is claimed about the cost of waiting on this one.')}</div>
      </div>
    </div>

    ${decisionStrip(r, ctx)}
  </article>`;
}

/* The decided/outcome footer. Present on every card, including the ones that
   have not been decided, so that "no outcome yet" is a visible statement rather
   than an absence a reader has to notice. */
function decisionStrip(r, ctx) {
  const bits = [];
  if (r.decided_at) {
    bits.push(`<div><div class="${SX.caps}">Decision</div>
      <div class="font-body-sm text-body-sm text-on-surface">${esc(life(r.status).label)} by ${esc(str(r.decided_by_name) || 'an account with no staff record')}
        on ${esc(dubaiStamp(r.decided_at))}
        <span class="${SX.chip}" title="${esc('The basis on which this account was allowed to decide. a TENANT_ basis is authority from the account itself; STAFF_ROLE_POLICY is a job title the dealership has granted approval to.')}">${esc(str(r.decided_by_authority) || 'authority not recorded')}</span></div>
      ${r.decision_reason_label ? `<div class="${SX.sub}"><strong>${esc(r.decision_reason_label)}</strong> — ${esc(str(r.decision_reason_meaning))}
         ${r.decision_says_engine_was_wrong === true ? `<span class="${SX.chip}">recorded as the engine being wrong</span>` : ''}
         ${r.decision_says_engine_was_wrong === false ? `<span class="${SX.chip}">the engine was right; the answer was still no</span>` : ''}</div>` : ''}
      ${r.decision_note ? `<div class="${SX.sub}">${esc(r.decision_note)}</div>` : ''}
      ${r.defer_until ? `<div class="${SX.sub}">Due again ${esc(String(r.defer_until))}${r.deferral_now_due ? ' — that date has passed' : ''}</div>` : ''}
      </div>`);
  }
  if (r.executed_at) {
    bits.push(`<div><div class="${SX.caps}">Carried out</div>
      <div class="font-body-sm text-body-sm text-on-surface">${esc(str(r.executed_by_name) || 'somebody')} on ${esc(dubaiStamp(r.executed_at))}</div>
      ${r.execution_note ? `<div class="${SX.sub}">${esc(r.execution_note)}</div>` : ''}
      ${r.execution_failure ? `<div class="${SX.hot}">${esc(r.execution_failure)}</div>` : ''}</div>`);
  }
  if (r.escalated_at && r.status === 'PROPOSED') {
    bits.push(`<div class="${BANNER.hot}">
      <span class="${BANNER_ICON}">error</span>
      <div><strong>Escalated ${esc(dubaiStamp(r.escalated_at))}.</strong> ${esc(str(r.escalation_reason))}</div></div>`);
  }

  /* The outcome block. recovered_value_aed is the only money on this screen
     that is not exposure, and it exists only where a person tied a recorded
     sale to this action. Where it is null the view's sentence says which input
     is missing; it never renders as a zero and never as an em dash. Where a
     figure is present but the four evidence columns do not back it, the figure
     is withheld and the disagreement is named — see recoveryEvidence(). */
  const ev = recoveryEvidence(r);
  bits.push(`<div><div class="${SX.caps}">Outcome</div>
    <div class="font-body-sm text-body-sm text-on-surface">${
      ev.state === 'NOT_RECORDED'
        ? `<span class="${SX.dim}">Nothing recovered has been recorded</span>`
      : ev.state === 'ATTRIBUTED'
        ? `${aed(ev.amount)} <span class="${SX.chip}" title="${esc(ev.basis)}">attributed, not confirmed</span>`
        : `<span class="${SX.hotTx}">An amount is recorded here with nothing behind it — it is not shown</span>`}</div>
    ${ev.state === 'UNSUPPORTED' ? `<div class="${BANNER.hot}">
      <span class="${BANNER_ICON}">report</span>
      <div>${esc(unsupportedRecoverySentence(ev))}</div></div>` : ''}
    <div class="${SX.sub}">${esc(str(r.outcome_sentence) || 'No outcome state recorded on this row.')}</div>
    ${r.outcome_sale_vehicle ? `<div class="${SX.sub}">Linked sale: ${esc(r.outcome_sale_vehicle)} · ${r.outcome_sale_amount_aed == null ? 'amount not recorded' : esc(aed(r.outcome_sale_amount_aed))} · ${esc(String(r.outcome_sale_date || 'no date'))}</div>` : ''}
  </div>`);

  return `<div class="flex flex-col gap-3 border-t border-outline-variant/40 pt-3">
    <div class="${SX.g2}">${bits.join('')}</div>
    <div class="flex items-center justify-end gap-2 flex-wrap">${buttons(r, ctx)}</div>
  </div>`;
}

/* Buttons are rendered whether or not this account may use them, and a disabled
   one carries the database's own sentence as its tooltip. A hidden button
   teaches the operator the feature does not exist; a disabled one with a reason
   teaches them who to ask. The database refuses the call either way — none of
   this is the security boundary. */
function buttons(r, ctx) {
  const may = !!(ctx && ctx.may_decide);
  const why = esc(str(ctx && ctx.refusal_reason) || 'This account may not decide inventory actions.');
  const gate = may ? '' : ` disabled title="${why}"`;
  const open = `<button class="${BTN.secondary}" data-open="${esc(r.id)}">History</button>`;

  if (r.status === 'PROPOSED' || (r.status === 'DEFERRED')) {
    return `<button class="${BTN.primary}" data-decide="APPROVE" data-id="${esc(r.id)}"${gate}>Approve</button>
      <button class="${BTN.destructive}" data-decide="REJECT" data-id="${esc(r.id)}"${gate}>Reject</button>
      <button class="${BTN.secondary}" data-decide="DEFER" data-id="${esc(r.id)}"${gate}>Defer</button>
      ${open}`;
  }
  if (r.status === 'APPROVED') {
    return `<button class="${BTN.primary}" data-exec="${esc(r.id)}">Record that this was carried out</button>
      <button class="${BTN.secondary}" data-cancel="${esc(r.id)}"${gate}>Withdraw</button>${open}`;
  }
  return open;
}

/* ── Decision dialogs ────────────────────────────────────────────────────── */
function decideDialog(r, decision, codes, after) {
  const isReject = decision === 'REJECT';
  const isDefer  = decision === 'DEFER';
  const usable   = (codes || []).filter(c => Array.isArray(c.applies_to) && c.applies_to.includes(decision));

  const title = isReject ? 'Reject this recommendation'
              : isDefer  ? 'Defer this recommendation'
              : 'Approve this action';

  /* The rejection reason is not a formality. It is the only evidence NEXUS will
     ever have that a recommendation was wrong, and it is what a calibration
     pass would be built from. Saying that here is cheaper than discovering
     later that every note reads "no". */
  const preamble = isReject
    ? `<div class="${BANNER.info}">
         <span class="${BANNER_ICON}">school</span>
         <div>A rejection is a useful result, not a failure. The reason you pick is the only record
              NEXUS will have that this recommendation was wrong, so it is required and so is a note.</div></div>`
    : isDefer
    ? `<div class="${BANNER.info}">
         <span class="${BANNER_ICON}">schedule</span>
         <div>A deferral stays on the queue and becomes due again on the date you set. It is not a rejection
              and it is not an approval.</div></div>`
    : `<div class="${BANNER.info}">
         <span class="${BANNER_ICON}">info</span>
         <div>Approving records a decision. It does not change a price, does not message anybody and does not
              recover any money — nothing is dispatched from this build. The action then waits for somebody to
              record that they carried it out.</div></div>`;

  const body = `${preamble}
    <div class="${SX.sub}">
      <strong>${esc(str(r.unit_model) || r.unit_id)}</strong> · <span class="${SX.mono}">${esc(r.unit_id)}</span>
      · ${esc(str(r.recommendation))}</div>
    <div class="${SX.stack}">
      ${(isReject || isDefer) ? `<div class="${SX.field}"><label class="${SX.label}" for="acRc">Reason${isReject ? ' (required)' : ''}</label>
        <select class="${SX.input}" id="acRc">
          <option value="">Choose a reason…</option>
          ${usable.map(c => `<option value="${esc(c.code)}">${esc(c.label)}</option>`).join('')}
        </select>
        <div class="${SX.hint}" id="acRcHint">The list is closed on purpose: free text cannot be counted.</div></div>` : ''}
      ${isDefer ? `<div class="${SX.field}"><label class="${SX.label}" for="acUntil">Due again on (optional)</label>
        <input type="date" class="${SX.input}" id="acUntil" /><div class="${SX.hint}">Must be in the future, or it is due the moment you set it.</div></div>` : ''}
      <div class="${SX.field}"><label class="${SX.label}" for="acNote">Note${isReject ? ' (required)' : ''}</label>
        <textarea class="${SX.input}" id="acNote" rows="3" placeholder="${esc(isReject ? 'What does the engine not know about this car?' : 'Anything the next person needs to know.')}"></textarea></div>
    </div>`;

  const m = stitchModal(title, body,
    `<button class="${BTN.primary}" id="acGo">${esc(isReject ? 'Record rejection' : isDefer ? 'Record deferral' : 'Approve')}</button>
     <button class="${BTN.secondary}" id="acCancel">Cancel</button>`);

  const hint = m.wrap.querySelector('#acRcHint');
  m.wrap.querySelector('#acRc')?.addEventListener('change', e => {
    const c = usable.find(x => x.code === e.target.value);
    if (hint) hint.textContent = c ? c.meaning : 'The list is closed on purpose: free text cannot be counted.';
  });
  m.wrap.querySelector('#acCancel').addEventListener('click', m.close);
  m.wrap.querySelector('#acGo').addEventListener('click', async () => {
    const btn = m.wrap.querySelector('#acGo');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      const row = await call('action_decide', {
        p_action_id: r.id,
        p_decision: decision,
        p_reason_code: m.wrap.querySelector('#acRc')?.value || null,
        p_note: m.wrap.querySelector('#acNote').value.trim() || null,
        p_defer_until: m.wrap.querySelector('#acUntil')?.value || null,
        p_assign_staff_id: null,
      });
      if (!row.ok) {
        /* A refusal is not an exception. The database answered, and its sentence
           is better than anything this file could write, so it is shown as-is. */
        btn.disabled = false; btn.textContent = 'Try again';
        m.msg(`<span class="${SX.hotTx}">${esc(row.refusal_reason || row.refusal_code || 'The database refused this and gave no reason, which is itself a defect.')}</span>`);
        return;
      }
      m.close();
      after(row.idempotent
        ? 'Nothing changed — that decision was already recorded, and no second record was created.'
        : `Recorded. ${esc(str(r.unit_id))} is now ${life(row.action.status).label.toLowerCase()}.`);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Try again';
      modalError(m, e);
    }
  });
}

function executeDialog(r, after) {
  const m = stitchModal('Record that this was carried out',
    `<div class="${BANNER.warm}">
       <span class="${BANNER_ICON}">warning</span>
       <div>This records a claim about the real world against your name. NEXUS did not do this and cannot
            check it — nothing is dispatched from this build.</div></div>
     <div class="${SX.sub}"><strong>${esc(str(r.unit_model) || r.unit_id)}</strong>
       · <span class="${SX.mono}">${esc(r.unit_id)}</span> · ${esc(str(r.recommendation))}</div>
     <div class="${SX.stack}">
       <div class="${SX.field}"><label class="${SX.label}" for="acEx">What did you do?</label>
         <textarea class="${SX.input}" id="acEx" rows="3" placeholder="e.g. price reviewed with the sales manager and left unchanged"></textarea></div>
       <div class="${SX.field}"><label class="flex items-center gap-2 font-body-sm text-body-sm font-semibold text-on-surface"><input type="checkbox" id="acFail" /> It was attempted and did not happen</label>
         <div class="${SX.hint}">Recorded as a failure, in the same words the rest of NEXUS uses for one.</div></div>
     </div>`,
    `<button class="${BTN.primary}" id="acGo">Record</button><button class="${BTN.secondary}" id="acCancel">Cancel</button>`);
  m.wrap.querySelector('#acCancel').addEventListener('click', m.close);
  m.wrap.querySelector('#acGo').addEventListener('click', async () => {
    const btn = m.wrap.querySelector('#acGo');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      const failed = m.wrap.querySelector('#acFail').checked;
      const note = m.wrap.querySelector('#acEx').value.trim() || null;
      const row = await call('action_mark_executed', {
        p_action_id: r.id, p_note: note, p_failed: failed, p_failure: failed ? note : null,
      });
      if (!row.ok) {
        btn.disabled = false; btn.textContent = 'Try again';
        m.msg(`<span class="${SX.hotTx}">${esc(row.refusal_reason || row.refusal_code)}</span>`);
        return;
      }
      m.close();
      after(row.idempotent ? 'Already recorded — nothing changed.' : 'Recorded. No money has been attributed to it: that needs a real sale and a person to tie the two together.');
    } catch (e) { btn.disabled = false; btn.textContent = 'Try again'; modalError(m, e); }
  });
}

/* ── Outcome dialogs ─────────────────────────────────────────────────────
   See "Record the outcome" in the screen below for what these may and may not
   claim. Neither sends an amount. */
function outcomeDialog(r, after) {
  const m = stitchModal('Link a recorded sale to this action',
    `<div class="${BANNER.warm}">
       <span class="${BANNER_ICON}">warning</span>
       <div>Linking a sale ATTRIBUTES it to this action against your name. It does not show that the action caused
            the sale. The recorded sales carry no reference to a car, so the list below is only sales whose
            description shares words with this unit — a prompt for you, not evidence.</div></div>
     <div class="${SX.sub}"><strong>${esc(str(r.unit_model) || r.unit_id)}</strong>
       · <span class="${SX.mono}">${esc(r.unit_id)}</span> · carried out ${esc(dubaiStamp(r.executed_at))}</div>
     <div id="ocList">${skeleton({ rows: 3 })}</div>
     <div class="${SX.field}"><label class="${SX.label}" for="ocNote">How do you know this sale belongs to this action? (required)</label>
       <textarea class="${SX.input}" id="ocNote" rows="3"></textarea></div>`,
    `<button class="${BTN.primary}" id="acGo" disabled>Link this sale</button><button class="${BTN.secondary}" id="acCancel">Cancel</button>`);
  m.wrap.querySelector('#acCancel').addEventListener('click', m.close);
  const go_ = m.wrap.querySelector('#acGo');
  db(`rpc/action_outcome_candidates?p_action_id=${encodeURIComponent(r.id)}`).then(list => {
    const host = m.wrap.querySelector('#ocList');
    if (!host) return;
    const rowsC = Array.isArray(list) ? list : [];
    if (!rowsC.length) {
      host.innerHTML = stateEmpty('No recorded sale looks like this unit',
        'No sale on or after the date this was carried out shares enough of its description with this unit. If none '
        + 'can be tied to it, close it with “No sale can be tied” instead.');
      return;
    }
    host.innerHTML = `<div class="flex flex-col gap-2">${rowsC.map((c, i) => `
      <label class="${SX.pick}"><input type="radio" name="ocPick" value="${i}" class="mt-1" />
        <div><div><strong>${esc(str(c.vehicle) || 'No vehicle recorded')}</strong> · ${c.amount_aed == null ? 'amount not recorded' : aed(c.amount_aed)}
          · ${esc(str(c.purchase_date) || 'no date')}</div>
          <div class="${SX.sub}">${esc(displayName(c.customer_name))} · ${esc(num(c.shared_tokens))} shared words · ${esc(str(c.link_evidence))}</div></div>
      </label>`).join('')}</div>
      <div class="${SX.sub}">${esc(str(rowsC[0].evidence_note))}</div>`;
    host.querySelectorAll('input[name=ocPick]').forEach(x => x.addEventListener('change', () => { go_.disabled = false; }));
    go_.addEventListener('click', async () => {
      const pick = host.querySelector('input[name=ocPick]:checked');
      if (!pick) return;
      const sale = rowsC[Number(pick.value)];
      go_.disabled = true; go_.textContent = 'Recording…';
      try {
        const row = await call('action_record_outcome', {
          p_action_id: r.id, p_purchase_id: sale.purchase_id,
          p_note: m.wrap.querySelector('#ocNote').value.trim() || null,
        });
        if (!row.ok) {
          go_.disabled = false; go_.textContent = 'Try again';
          m.msg(`<span class="${SX.hotTx}">${esc(row.refusal_reason || row.refusal_code || 'The database refused this and gave no reason, which is itself a defect.')}</span>`);
          return;
        }
        m.close();
        after(row.idempotent
          ? 'Nothing changed — that sale was already linked to this action.'
          : 'Linked. The sale is now attributed to this action — attributed, not confirmed as caused. Any figure is the database’s, computed from the recorded sale.');
      } catch (e) { go_.disabled = false; go_.textContent = 'Try again'; modalError(m, e); }
    });
  }).catch(e => {
    const host = m.wrap.querySelector('#ocList');
    if (host) host.innerHTML = errorState({ what: 'the candidate sales', err: e });
  });
}

function notAttributableDialog(r, after) {
  const m = stitchModal('No sale can be tied to this action',
    `<div class="${SX.sub}">This closes the action on the record as having
       no attributable outcome. No figure is written and none is implied. Say what is missing — it is what the next
       person reads.</div>
     <div class="${SX.sub}"><strong>${esc(str(r.unit_model) || r.unit_id)}</strong>
       · <span class="${SX.mono}">${esc(r.unit_id)}</span></div>
     <div class="${SX.field}"><label class="${SX.label}" for="naNote">What is missing (required)</label><textarea class="${SX.input}" id="naNote" rows="3"></textarea></div>`,
    `<button class="${BTN.primary}" id="acGo">Close as not attributable</button><button class="${BTN.secondary}" id="acCancel">Cancel</button>`);
  m.wrap.querySelector('#acCancel').addEventListener('click', m.close);
  m.wrap.querySelector('#acGo').addEventListener('click', async () => {
    const btn = m.wrap.querySelector('#acGo');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      const row = await call('action_mark_not_attributable', {
        p_action_id: r.id, p_note: m.wrap.querySelector('#naNote').value.trim() || null,
      });
      if (!row.ok) {
        btn.disabled = false; btn.textContent = 'Try again';
        m.msg(`<span class="${SX.hotTx}">${esc(row.refusal_reason || row.refusal_code || 'The database refused this and gave no reason, which is itself a defect.')}</span>`);
        return;
      }
      m.close();
      after(row.idempotent ? 'Already closed as not attributable — nothing changed.' : 'Closed. No outcome is attributed to this action and no figure is recorded.');
    } catch (e) { btn.disabled = false; btn.textContent = 'Try again'; modalError(m, e); }
  });
}

/* ── The history drawer ─────────────────────────────────────────────────── */
async function historyDrawer(r) {
  openStitchDrawer({ icon: 'history', title: str(r.unit_model) || r.unit_id,
    sub: `${r.unit_id} · ${str(r.recommendation)}`,
    bodyHtml: `<div id="acHist">${skeleton({ rows: 5 })}</div>` });

  let rows = null, err = null;
  try { rows = await readTimeline(r.id); } catch (e) { err = e.message; }
  const host = $('acHist');
  if (!host) return;
  if (err) { host.innerHTML = errorState({ what: 'this action’s history', err }); return; }
  if (!rows.length) {
    host.innerHTML = stateEmpty('No steps recorded',
      'This action has no timeline rows, which should not happen — proposing one writes the first. Treat it as a defect, not as an action that never moved.');
    return;
  }
  host.innerHTML = `
    <div class="${SX.note}"><div class="${SX.caps}">What happened</div>
      <div class="${SX.sub}">
        Two different words on every line. <strong>Step</strong> is what happened to this action.
        <strong>Audit</strong> is how <span class="${SX.mono}">NEXUS’s own rule for what a run achieved</span> classifies the row that was
        written to <span class="${SX.mono}">The activity log</span> for it — the same vocabulary the Automation screen uses.
        A rejection is a recorded SUCCESS: the system succeeded at recording that a person said no.</div>
      <div class="${SX.timeline}">${rows.map(t => `
        <div class="${SX.tlItem}"><span class="${SX.tlDot}"></span>
          <div class="${SX.row}">
            <strong>${esc(t.event)}</strong>
            ${t.audit_outcome_class ? `<span class="${SX.chip}" title="${esc(`This run was recorded as ${str(t.audit_status) || 'having no status'}`)}">audit: ${esc(t.audit_outcome_class)}</span>` : `<span class="${SX.chip}">no audit row linked</span>`}
            <span class="font-label-numeric-sm text-[11px] text-outline ml-auto">${esc(dubaiStamp(t.at))}</span>
          </div>
          <div class="${SX.sub}">${esc(str(t.actor_name) || 'no staff record')}${t.actor_authority ? ` · ${esc(t.actor_authority)}` : ''}</div>
          ${t.detail ? `<div class="font-body-sm text-body-sm text-on-surface whitespace-normal">${esc(t.detail)}</div>` : ''}
        </div>`).join('')}</div></div>
    <div class="${SX.note}"><div class="${SX.caps}">Audit rows behind this</div>
      <div class="${SX.sub}">Every line above with an audit chip is a real entry in the
        activity log, filed under <span class="${SX.mono}">Inventory Action Center</span>.
        It is deliberately kept out of the automation register: these are decisions people took in this dashboard,
        not automation runs, and mixing them into automation health would make both numbers mean less.</div></div>`;
}

/* ── Screen ──────────────────────────────────────────────────────────────── */
/* The one piece of state this module keeps between renders. Registered with
   lib/data.js so a re-authentication as a different person clears it; see the
   comment on onIdentityChange there for why module state is the thing RLS
   cannot reach. */
let NOTICE = null;
onIdentityChange(() => { NOTICE = null; });

SCREENS.actions = async host => {
  /* The root is the Stitch scope (`nx-stitch` switches on the scoped reset the
     design classes were drawn against). It is a wrapper this screen appends and
     NOT a class on `#screen`, for the reason the old `.ds-screen` wrapper gave:
     lib/nav.js empties `#screen` between renders without touching its classes,
     so a class set there would follow the operator onto another screen.
     Design: design/stitch/action-center-next-best-actions-queue--be8f47.html (primary), --31efb6 and --b76b17. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-lg');
  host.appendChild(root);
  root.insertAdjacentHTML('beforeend', engineHeader({
    title: 'Action Center',
    sub: 'What the engines recommend, who has to decide it, what was done, and the outcome — recommendation to result, on the record.',
    actionsHtml: linkBtn('inventory', 'Open Inventory') + linkBtn('revenue', 'Open Revenue Recovery'),
  }));
  wireGo(root);

  const notice = el('div', 'empty:hidden'); root.appendChild(notice);
  const strip  = el('div', SX.g5); strip.innerHTML = skeleton({ rows: 2 }); root.appendChild(strip);
  const body   = el('div', 'flex flex-col gap-space-lg'); root.appendChild(body);

  const say = msg => {
    notice.innerHTML = `<div class="${BANNER.info}">
      <span class="${BANNER_ICON}">check_circle</span><div>${msg}</div></div>`;
  };
  /* A write re-renders the screen through go(), which runs this function again
     from scratch, so the confirmation has to survive one render. It lives in a
     module variable rather than in storage: lib/prefs.js owns persistence, and
     this is a sentence that should not outlive the tab. It is cleared on a
     change of signed-in identity through the registry in lib/data.js, because
     a message about what the last person did has no business appearing over
     the next person's queue. */
  const reload = msg => { NOTICE = msg || null; go('actions'); };
  if (NOTICE) { say(NOTICE); NOTICE = null; }

  /* allSettled, never catch(() => []). "The queue is empty" and "the queue
     would not load" are opposite statements and this screen must not merge
     them — an empty Action Center reads as "there is nothing to do", which is a
     claim about the dealership. */
  const [qR, cR, kR, eR] = await Promise.allSettled([readQueue(), readCtx(), readCodes(), readEngine()]);
  const rows = valOf(qR), rowsErr = errOf(qR);
  const ctx  = valOf(cR), ctxErr  = errOf(cR);
  const codes = valOf(kR) || [];
  const engine = valOf(eR), engineErr = errOf(eR);

  if (rowsErr) {
    strip.remove();
    body.innerHTML = errorState({ what: 'the action queue', err: rowsErr });
    return;
  }

  const waiting  = rows.filter(r => r.status === 'PROPOSED');
  const deferred = rows.filter(r => r.status === 'DEFERRED');
  const approved = rows.filter(r => r.status === 'APPROVED');
  const closed   = rows.filter(r => ['REJECTED', 'EXECUTED', 'EXECUTION_FAILED', 'CANCELLED'].includes(r.status));
  const rejected = rows.filter(r => r.status === 'REJECTED');
  const engineWrong = rejected.filter(r => r.decision_says_engine_was_wrong === true).length;

  /* Units the engine flags that have no LIVE action. This is the gap between
     what the engine noticed and what anybody did about it, and it is the number
     that says whether this screen is being used.

     A unit whose action was rejected or withdrawn stays on this list on
     purpose, with its previous decision shown beside it. Hiding it would make a
     rejection look like the unit had stopped being flagged, which is false —
     the engine still flags it, every day, and somebody may legitimately want to
     raise it again later. Whether they may raise it TODAY is the database's
     answer, not this screen's: action_propose() refuses inside the
     dealership's own re-proposal cooldown and says so in the refusal. */
  const live = new Set(rows.filter(r => r.is_live).map(r => r.unit_id));
  const lastClosed = new Map();
  closed.forEach(r => { if (!lastClosed.has(r.unit_id)) lastClosed.set(r.unit_id, r); });
  const flagged = (engine || []).filter(u => up(u.recommendation) !== 'HOLD');
  const unraised = flagged.filter(u => !live.has(u.id));

  /* Partitioned before summing (QUALITY_GATE S5b): only rows that carry a
     figure are added, and the rows that do not are counted separately and
     named in the tile, so "no exposure claimed" and "not computed" are never
     folded into one zero. */
  const sizedWaiting = waiting.filter(r => r.engine_impact_aed != null && !Number.isNaN(Number(r.engine_impact_aed)));
  const exposureWaiting = sizedWaiting.reduce((s, r) => s + Number(r.engine_impact_aed), 0);
  const anyImpactMissing = sizedWaiting.length < waiting.length;

  strip.innerHTML = [
    kpi('Waiting on a decision', num(waiting.length),
      waiting.length ? 'Nobody has answered these yet' : 'Nothing is waiting on a person'),
    kpi('Margin at risk in those', waiting.length ? aed(exposureWaiting) : '—',
      waiting.length
        ? `Gross margin sitting in ${num(waiting.length)} ${plural(waiting.length, 'unit', 'units')} that ${plural(waiting.length, 'has', 'have')} not sold. At risk — not a loss, not recoverable revenue.${anyImpactMissing ? ' One or more of these claims no impact, so this total is under-counted rather than complete.' : ''}`
        : 'No undecided actions, so there is no exposure to total.'),
    kpi('Approved, not yet done', num(approved.length),
      approved.length ? 'Decided but nobody has recorded carrying them out' : 'Nothing approved is outstanding'),
    kpi('Rejected', num(rejected.length),
      rejected.length
        ? `${num(engineWrong)} of them recorded as the engine being wrong — that is the calibration data`
        : 'No recommendation has been rejected yet'),
    kpi('Flagged, no action raised', engineErr ? '—' : num(unraised.length),
      engineErr
        ? 'The engine could not be read, so this cannot be counted. Not zero — unknown.'
        : `${num(flagged.length)} ${plural(flagged.length, 'unit carries', 'units carry')} a recommendation the engine would act on`),
  ].join('');

  /* Who is signed in, and what the database will let them do. Read from
     rpc/action_approver_context, not inferred here — the browser has no
     business deciding this and the database would refuse it anyway. */
  const authority = ctxErr
    ? `<div class="${BANNER.warm}"><span class="${BANNER_ICON}">help</span>
        <div>This screen could not read who you are (${esc(ctxErr)}), so it cannot say whether you may decide
             anything. The buttons are left enabled and the database will answer — it is the only thing that
             decides this — but expect a refusal if you are not an approver.</div></div>`
    : ctx && ctx.may_decide
    ? `<div class="${BANNER.info}"><span class="${BANNER_ICON}">verified_user</span>
        <div>You may approve, reject and defer actions here on authority
             <strong>${esc(str(ctx.authority))}</strong>${up(str(ctx.authority)).startsWith('TENANT_')
               ? ` — that is your account role at this dealership (<span class="${SX.mono}">${esc(str(ctx.tenant_role))}</span>), not your job title (<span class="${SX.mono}">${esc(str(ctx.staff_role) || 'none recorded')}</span>). Every decision records which of the two it was.`
               : ` — a job title this dealership has granted approval to.`}</div></div>`
    : `<div class="${BANNER.hot}"><span class="${BANNER_ICON}">lock</span>
        <div><strong>You cannot decide actions here.</strong> ${esc(str(ctx && ctx.refusal_reason) || 'The database gave no reason, which is itself a defect.')}
             ${ctx && ctx.tenant_has_any_approver === false
               ? ' Until somebody at this dealership holds an approving role, every decision attempt is escalated and recorded as such, and nothing is approved by default.'
               : ''}</div></div>`;

  /* action-center--be8f47's two columns: the proposal workstream on the left,
     "Record the outcome" and the desk telemetry in the rail on the right. */
  body.innerHTML = `${authority}
    <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_18rem] gap-space-lg items-start">
      <div class="flex flex-col gap-space-lg min-w-0" data-main></div>
      <div class="flex flex-col gap-space-lg min-w-0" data-rail></div>
    </div>`;
  const main = body.querySelector('[data-main]');
  const rail = body.querySelector('[data-rail]');

  const section = (title, sub, list, empty) => {
    const wrap = el('section', 'flex flex-col gap-3');
    wrap.innerHTML = `<div class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2 flex-wrap"><span class="w-2 h-2 rounded-full bg-primary shrink-0"></span>
          <h2 class="font-headline-md text-headline-md text-on-surface">${esc(title)}</h2>
          <span class="${SX.chip}">${num(list.length)}</span></div>
        <p class="font-body-sm text-body-sm text-on-surface-variant">${sub}</p></div>
      ${list.length ? `<div class="flex flex-col gap-3">${list.map(r => actionCard(r, ctx)).join('')}</div>`
                    : empty}`;
    main.appendChild(wrap);
    return wrap;
  };

  const dueDeferred = deferred.filter(r => r.deferral_now_due);
  const notDue      = deferred.filter(r => !r.deferral_now_due);

  section('Waiting on a decision',
    'Raised from the engine and unanswered. Each card carries the engine’s own reason and its own evidence; nothing here proposes a price.',
    waiting.concat(dueDeferred),
    stateEmpty('Nothing is waiting on a person',
      unraised.length
        ? `Every action that has been raised is decided. ${num(unraised.length)} ${plural(unraised.length, 'unit is', 'units are')} still flagged by the engine with no action raised — they are listed further down.`
        : 'No action has been raised that nobody has answered. That is not the same as the engine having nothing to say; the engine’s own list is further down.'));

  if (approved.length) {
    section('Approved, waiting to be carried out',
      'A decision was taken. Nothing has been dispatched — this build records what people do, it does not do it for them.',
      approved, '');
  }
  if (notDue.length) {
    section('Deferred', 'Answered with “not now”. They come back on the date recorded.', notDue, '');
  }

  /* ── Record the outcome ──────────────────────────────────────────────────
     Added 7 Oct 2026. The loop stopped at "carried out": action_record_outcome
     (the ONLY writer of recovered_value_aed), action_outcome_candidates and
     action_mark_not_attributable existed and nothing called them, so no action
     could ever end in an attributed sale or in an honest "no evidence".

     An executed action is closed one of two ways, both by an approver, both
     with a sentence from the person:
       · link a RECORDED sale to it. The candidates are sales whose free-text
         vehicle shares two words with this unit's model — a prompt, never
         evidence — and confirming one records HUMAN_CONFIRMED_LINK against
         your name. This screen sends the sale's id and your note, never an
         amount: whatever figure results is computed by the database from the
         recorded sale, and stays null where an input is missing. It is
         ATTRIBUTED, not confirmed as caused.
       · say that no sale can be tied to it. No figure is written or implied.
     Refusals come back as ok = false with the database's sentence, same as
     every other write on this screen. */
  const awaitingOutcome = rows.filter(r => r.status === 'EXECUTED'
    && !['ATTRIBUTED', 'NOT_ATTRIBUTABLE'].includes(up(r.outcome_state)));
  const byIdAll = new Map(rows.map(r => [r.id, r]));
  const outcomeCard = el('div'); rail.appendChild(outcomeCard);
  panel(outcomeCard, {
    icon: 'fact_check',
    title: 'Record the outcome',
    sub: 'Carried-out actions that nobody has closed yet. Link a recorded sale, or say on the record that none can be '
       + 'tied to it. Estimated, attributed and confirmed are different words: linking a sale here makes it attributed, '
       + 'nothing more',
    load: async () => awaitingOutcome,
    /* A list of tiles rather than a table: this lives in the rail of
       action-center--be8f47 ("Target Executed Action Overview" + the two
       reconciliation choices), where five columns do not fit. */
    render: list => (list.length ? `<div class="${SX.stack}">${list.map(r => {
        const may = !!(ctx && ctx.may_decide);
        const gate = may ? '' : ` disabled title="${esc(str(ctx && ctx.refusal_reason) || 'This account may not record an outcome.')}"`;
        return `<div class="bg-surface-container-low rounded-lg p-3 flex flex-col gap-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><div class="font-label-numeric-sm text-label-numeric-sm font-bold text-primary">${esc(r.unit_id)} · EXECUTED</div>
              <div class="font-body-md text-body-md font-semibold text-on-surface">${esc(str(r.unit_model) || r.unit_id)}</div></div>
            ${pill(str(r.recommendation), recTone(r.recommendation), { verbatim: true })}
          </div>
          <div class="${SX.sub}">Carried out ${esc(dubaiStamp(r.executed_at))} by ${esc(str(r.executed_by_name) || 'no staff record')}</div>
          <div class="${SX.sub}">${esc(str(r.outcome_sentence) || 'No outcome recorded.')}</div>
          <div class="flex flex-col gap-2 pt-1">
            <button type="button" class="${BTN.primary}" data-link="${esc(r.id)}"${gate}>Link a recorded sale</button>
            <button type="button" class="${BTN.secondary}" data-noattr="${esc(r.id)}"${gate}>Close — no sale can be tied</button>
          </div></div>`;
      }).join('')}</div>`
      : stateEmpty('No carried-out action is waiting for an outcome',
        'Every action recorded as carried out has already been linked to a sale or closed as not attributable — or none has been carried out yet.', 'task_alt')),
  }).then(card => {
    card.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      const r = byIdAll.get(b.dataset.link); if (r) outcomeDialog(r, reload);
    }));
    card.querySelectorAll('[data-noattr]').forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      const r = byIdAll.get(b.dataset.noattr); if (r) notAttributableDialog(r, reload);
    }));
  });

  /* Closed actions are a table, not cards: they are read for the record, not
     for a decision, and the reason code is the column that matters. */
  const closedCard = el('div'); main.appendChild(closedCard);
  panel(closedCard, {
    icon: 'history',
    title: 'Decided',
    sub: `${num(closed.length)} closed ${plural(closed.length, 'action', 'actions')} — including every rejection, which is the most useful thing on this screen`,
    load: async () => closed,
    render: list => table([
      { label: 'Unit', render: r => `<div>${esc(str(r.unit_model) || r.unit_id)}</div><div class="${SX.subMono}">${esc(r.unit_id)}</div>` },
      { label: 'Recommended', render: r => pill(str(r.recommendation), recTone(r.recommendation), { verbatim: true }) },
      { label: 'What was decided', render: r => pill(life(r.status).label, life(r.status).tone, { verbatim: false }) },
      { label: 'Why', render: r => r.decision_reason_label
          ? `<div>${esc(r.decision_reason_label)}</div><div class="${SX.sub}">${esc(str(r.decision_note))}</div>`
          : `<div class="${SX.sub}">${esc(str(r.decision_note) || 'No reason recorded')}</div>` },
      { label: 'Decided by', render: r => `<div>${esc(str(r.decided_by_name) || '—')}</div><div class="${SX.sub}">${esc(str(r.decided_by_authority) || '')}</div>` },
      /* Same three-way test as the card footer, from the same function. The
         cell cannot carry the full sentence, so UNSUPPORTED gets the words and
         the tooltip and never the figure; the card below states it in full. */
      { label: 'Recovered', align: 'r', render: r => {
          const ev = recoveryEvidence(r);
          if (ev.state === 'NOT_RECORDED')
            return `<span class="${SX.dim}" title="${esc(str(r.outcome_sentence))}">nothing recorded</span>`;
          if (ev.state === 'ATTRIBUTED')
            return `${aed(ev.amount)}<div class="${SX.sub}">attributed</div>`;
          return `<span class="${SX.hotTx}" title="${esc(unsupportedRecoverySentence(ev))}">not shown</span>`
            + `<div class="${SX.sub}">an amount with no evidence behind it</div>`;
        } },
    ], list, {
      empty: stateEmpty('Nothing has been decided yet',
        'No action has been approved, rejected, deferred or withdrawn. Once one is, the reason lands here and stays.'),
      onRow: true,
    }) + `<div class="${SX.sub}">
      The Recovered column is empty on every row until somebody links a real recorded sale to an action.
      <span class="${SX.mono}">The recorded sales</span> holds no reference to an inventory unit — not a VIN, not a stock
      number — so NEXUS cannot tie a sale to a car by itself, and it will not guess. Approving something does not
      recover money and neither does carrying it out. A figure only appears where the row carries all four of
      <span class="${SX.mono}">outcome_state = ATTRIBUTED</span>, <span class="${SX.mono}">outcome_purchase_id</span>,
      <span class="${SX.mono}">attribution_basis</span> and <span class="${SX.mono}">recovered_value_basis</span>; where an
      amount is present without them the amount is withheld and the row is flagged as a fault.</div>`,
  }).then(card => {
    card.querySelectorAll('tbody tr').forEach((tr, i) => {
      tr.classList.add('clickable');
      tr.addEventListener('click', () => historyDrawer(closed[i]));
    });
  });

  /* The engine's own list, for units nobody has raised an action on. This is
     where an action enters the system. */
  const engineCard = el('div'); main.appendChild(engineCard);
  panel(engineCard, {
    icon: 'radar',
    title: 'Flagged by the engine, no action raised',
    sub: `Straight from <span class="${SX.mono}">sentinel_inventory_actions()</span>, worst first. Raising one freezes what the engine says today onto a record a person then answers.`,
    load: async () => { if (engineErr) throw new Error(engineErr); return unraised; },
    render: list => table([
      { label: 'Unit', render: u => {
          const prior = lastClosed.get(u.id);
          return `<div>${esc(str(u.model) || u.id)}</div><div class="${SX.subMono}">${esc(u.id)}</div>`
            + (prior ? `<div class="${SX.sub}">Already answered once: ${esc(life(prior.status).label.toLowerCase())} by ${esc(str(prior.decided_by_name) || 'somebody')} on ${esc(dubaiStamp(prior.decided_at))}${prior.decision_reason_label ? ` — ${esc(prior.decision_reason_label)}` : ''}. The engine still flags it.</div>` : '');
        } },
      { label: 'Recommended', render: u => pill(str(u.recommendation), recTone(u.recommendation), { verbatim: true }) },
      { label: 'Risk', render: u => pill(str(u.overall_risk), riskTone(u.overall_risk), { verbatim: true }) },
      { label: 'Days in stock', align: 'r', render: u => (u.days_in_stock == null ? `<span class="${SX.dim}">unknown</span>` : num(u.days_in_stock)) },
      { label: 'At risk', align: 'r', render: u => (u.impact_aed == null
          ? `<span class="${SX.dim}">none claimed</span>`
          : `${aed(u.impact_aed)}<div class="${SX.sub}">exposure</div>`) },
      { label: '', align: 'r', render: u => `<button class="${BTN.secondary}" data-raise="${esc(u.id)}">Raise action</button>` },
    ], list, {
      empty: stateEmpty('Every flagged unit already has a live action',
        'The engine is recommending something on ' + num(flagged.length) + ' ' + plural(flagged.length, 'unit', 'units') + ', and each of them already has an action open on this screen.'),
    }),
  }).then(card => {
    card.querySelectorAll('[data-raise]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Raising…';
      try {
        const row = await call('action_propose', { p_unit_id: b.dataset.raise });
        if (!row.ok) { b.disabled = false; b.textContent = 'Raise action'; say(`<span class="${SX.hotTx}">${esc(row.refusal_reason)}</span>`); return; }
        reload(row.idempotent ? 'That unit already had an open action — no second one was created.' : 'Action raised. It is now waiting on a decision.');
      } catch (e) { b.disabled = false; b.textContent = 'Raise action'; say(`<span class="${SX.hotTx}">${esc(e.message)}</span>`); }
    }));
  });

  /* ── Desk telemetry ──────────────────────────────────────────────────────
     action-center--be8f47 "Floor SLA Telemetry", measured from this queue's own
     timestamps and nothing else. Time to decision is decided_at − proposed_at
     over the actions a person has answered, shown with how many it is taken
     over; the outcome line is three counts, never a rate, because a percentage
     of a handful of actions reads as a performance figure it is not. */
  const answered = rows.filter(r => r.decided_at && r.proposed_at)
    .map(r => (new Date(r.decided_at).getTime() - new Date(r.proposed_at).getTime()) / 60000)
    .filter(m => Number.isFinite(m) && m >= 0).sort((a, b) => a - b);
  const median = answered.length
    ? (answered.length % 2 ? answered[(answered.length - 1) / 2] : (answered[answered.length / 2 - 1] + answered[answered.length / 2]) / 2)
    : null;
  const executed = rows.filter(r => r.status === 'EXECUTED');
  const attributedN = rows.filter(r => up(r.outcome_state) === 'ATTRIBUTED').length;
  const notAttrN = rows.filter(r => up(r.outcome_state) === 'NOT_ATTRIBUTABLE').length;
  const tele = el('section', 'bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/30 p-5 flex flex-col gap-3');
  tele.innerHTML = `<div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[20px]">speed</span>
      <h2 class="font-headline-md text-headline-md text-on-surface">Desk telemetry</h2></div>
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-surface-container-low rounded-lg p-3 flex flex-col gap-1">
        <span class="font-table-header text-table-header uppercase tracking-wider text-secondary">Median time to decision</span>
        <span class="font-label-numeric-lg text-headline-lg font-bold text-on-surface">${median == null ? '—' : esc(mins(median))}</span>
        <span class="${SX.sub}">${median == null ? 'No action has been answered yet, so there is nothing to time.' : `Over ${num(answered.length)} answered ${plural(answered.length, 'action', 'actions')}.`}</span>
      </div>
      <div class="bg-surface-container-low rounded-lg p-3 flex flex-col gap-1">
        <span class="font-table-header text-table-header uppercase tracking-wider text-secondary">Carried out → outcome</span>
        <span class="font-label-numeric-lg text-headline-lg font-bold text-on-surface">${num(attributedN)} / ${num(executed.length)}</span>
        <span class="${SX.sub}">${num(attributedN)} attributed, ${num(notAttrN)} closed as not attributable, of ${num(executed.length)} carried out. Attributed is not confirmed as caused.</span>
      </div>
    </div>`;
  rail.appendChild(tele);

  /* Wiring for the cards. Delegated from `body` because the sections are built
     in one pass and a card can be re-rendered by a reload. */
  const byId = new Map(rows.map(r => [r.id, r]));
  body.addEventListener('click', e => {
    const dec = e.target.closest('[data-decide]');
    if (dec && !dec.disabled) { const r = byId.get(dec.dataset.id); if (r) decideDialog(r, dec.dataset.decide, codes, reload); return; }
    const ex = e.target.closest('[data-exec]');
    if (ex) { const r = byId.get(ex.dataset.exec); if (r) executeDialog(r, reload); return; }
    const op = e.target.closest('[data-open]');
    if (op) { const r = byId.get(op.dataset.open); if (r) historyDrawer(r); return; }
    const cn = e.target.closest('[data-cancel]');
    if (cn && !cn.disabled) {
      const r = byId.get(cn.dataset.cancel); if (!r) return;
      const m = stitchModal('Withdraw this action',
        `<div class="${SX.sub}">Withdrawing closes the action without carrying it out. Say why —
           it is recorded against your name and it is what the next person reads.</div>
         <div class="${SX.field}"><label class="${SX.label}" for="acWhy">Why</label><textarea class="${SX.input}" id="acWhy" rows="3"></textarea></div>`,
        `<button class="${BTN.destructive}" id="acGo">Withdraw</button><button class="${BTN.secondary}" id="acCancel">Cancel</button>`);
      m.wrap.querySelector('#acCancel').addEventListener('click', m.close);
      m.wrap.querySelector('#acGo').addEventListener('click', async () => {
        const btn = m.wrap.querySelector('#acGo'); btn.disabled = true; btn.textContent = 'Withdrawing…';
        try {
          const row = await call('action_cancel', { p_action_id: r.id, p_note: m.wrap.querySelector('#acWhy').value.trim() || null });
          if (!row.ok) { btn.disabled = false; btn.textContent = 'Try again'; m.msg(`<span class="${SX.hotTx}">${esc(row.refusal_reason)}</span>`); return; }
          m.close(); reload('Withdrawn.');
        } catch (err) { btn.disabled = false; btn.textContent = 'Try again'; modalError(m, err); }
      });
    }
  });

  root.insertAdjacentHTML('beforeend', engineFooter({
    source: 'v_inventory_action_queue · v_inventory_action_timeline · rpc/sentinel_inventory_actions · rpc/action_approver_context',
    evidence: `${num(rows.length)} recorded ${plural(rows.length, 'action', 'actions')}; every write goes through an authorised function`,
  }));
};
