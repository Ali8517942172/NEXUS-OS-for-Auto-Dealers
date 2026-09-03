/* NEXUS OS — screens/lead-recovery.js
   LEAD RECOVERY. Whether a lead is leaking, what the engine can see while it
   answers, and — the whole value of the screen — what it cannot.

   Live at the time of writing this engine reports THREE leads and ZERO at risk.
   That zero is the most valuable claim on the page and it is printed at full
   size, unsoftened, with the engine's own reason under it. A dashboard that
   never prints a zero is a dashboard that is guessing.

   WHERE EVERYTHING COMES FROM — nothing below is computed in this file
     v_lead_recovery              one deterministic row per lead: state, the
                                  basis for that state, risk and the basis for
                                  it, the recommended action, the owner, the
                                  response clock, silence, confidence, the
                                  confirmed outcome, and the recovery
                                  attribution — which is a different question
                                  from the outcome and is answered separately.
     v_lead_recovery_coverage     the engine's own honesty surface: identity
                                  resolution, silence-detector freshness, how
                                  many leads have no owner, and a plain-English
                                  paragraph naming what it cannot tell a
                                  dealership. That paragraph is printed here
                                  verbatim.
     v_lead_recovery_state_model  every state the engine can emit, whether a
                                  branch for it exists at all, and how many
                                  leads are in it right now.
     v_lead_recovery_queue        the recovery desk: proposed, decided and
                                  executed actions.
     v_lead_recovery_health       the desk's own summary, including the only
                                  revenue figure this product may call
                                  recovered.

   ═══════════════════════════════════════════════════════════════════════════
   FIVE RULES THIS SCREEN IS BUILT AROUND
   ═══════════════════════════════════════════════════════════════════════════

   1. NEVER "0 LEAKS RECOVERED". That sentence reads as a performance figure and
      it is not one. The words used here are "no measurable recovery opportunity
      is currently detected" — the engine scored every lead on file and flagged
      none — and "no completed business outcome has been linked to an action".
      Both are statements about the evidence chain, not about the sales team.

   2. THE ENGINE'S OWN "WHAT I CANNOT TELL YOU" PARAGRAPH IS PRINTED VERBATIM.
      It is better written than anything this file could paraphrase, and a
      paraphrase would be a second copy of a business fact that drifts the first
      time the view is edited. It is also split into its own CANNOT clauses —
      by its own labels, not by this screen's judgement — so each limitation
      sits next to the panel it limits.

   3. THE ENGINE IS BLIND TO ROUGHLY HALF THE CONVERSATION AND SAYS SO.
      51 of 106 message events resolve to a lead; the other 55 belong to
      WhatsApp handles that match no lead at all. Every count on this page is
      computed over the resolved half, and that denominator is stated beside the
      figures rather than left for the reader to discover.

   4. A CONFIRMED SALE IS NOT A RECOVERED ONE. The one converted lead carries
      recovery_attribution_state = SALE_WITHOUT_RECOVERY_ACTION, whose basis
      reads: "This lead converted and NEXUS recovered nothing: no recovery
      action was ever raised against it. The sale is the dealership's, not the
      product's." That sentence is given its own block on this screen, because
      the temptation to quietly claim that sale is the single most expensive
      mistake this product could make.

   5. AN UNMEASURED THING NEVER RENDERS AS A ZERO OR A DASH. Every unknown on
      this page is the engine's own state word plus the engine's own reason
      sentence. opportunity_value_aed is NULL on every lead — the state is
      UNKNOWN_NO_LINK and the basis says "A figure here would be invented." */

import { db } from '../lib/data.js';
import { aed, dubaiDate, dubaiStamp, esc, mins, num, pct, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty } from '../lib/states.js';
import { tenantLabel, tenantState } from '../lib/tenant.js';
import { kpi, panel, table } from '../lib/ui.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const n0  = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted  = h => `<div class="cell-sub">${h}</div>`;
const hot    = h => `<div class="cell-sub t-hot">${h}</div>`;
const bold   = h => `<div style="font-weight:600">${h}</div>`;
const wrap   = h => `<div style="white-space:normal">${h}</div>`;

const readFailed = (what, err) =>
  hot(`${esc(what)} could not be read (${esc(str(err && err.message) || 'no reason given')}), so nothing is claimed `
    + 'here and nothing is ruled out.');

/* THE ONE WAY AN UNKNOWN RENDERS: the engine's state word, then the engine's
   reason. Never a dash — a dash beside "What it could be worth" reads as zero,
   and zero is a claim this engine explicitly refuses to make. */
const unknownCell = (state, reason) =>
  `<span class="pill unknown"><span class="dot"></span>${esc(str(state) || 'UNKNOWN')}</span>`
  + muted(esc(str(reason)) || 'The engine records no reason for this state, which is itself a gap.');

/* One clause out of the engine's own "what I cannot tell you" paragraph, which
   is written as CANNOT SIZE: … CANNOT SEE: … CANNOT CONFIRM SILENCE: … and so
   on. Split on the engine's own labels, so a clause it adds tomorrow appears
   without anyone editing this file, and the whole paragraph is printed
   elsewhere on the page unaltered. */
const cannotClauses = text => {
  const t = str(text);
  if (!t) return [];
  const out = [];
  const re = /CANNOT [A-Z][A-Z ]*?:/g;
  const marks = [];
  let m;
  while ((m = re.exec(t)) !== null) marks.push({ label: m[0], at: m.index, end: m.index + m[0].length });
  marks.forEach((k, i) => {
    const stop = i + 1 < marks.length ? marks[i + 1].at : t.length;
    out.push({ label: k.label.replace(/:$/, ''), body: t.slice(k.end, stop).trim().replace(/\.$/, '') });
  });
  return out;
};

const shared = make => {
  let p = null;
  return () => {
    if (!p) { p = make(); p.catch(() => { p = null; }); }
    return p;
  };
};
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));

const linkBtn = (id, label) => (SCREENS[id]
  ? `<button class="btn sm" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="btn sm ghost" disabled title="${esc(label)} is not part of this build: the navigation offers the screen and no module in this bundle registers it.">${esc(label)} — not in this build</button>`);
const wireGo = card => {
  card.querySelectorAll('[data-go]').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => go(b.dataset.go));
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.leadrecovery = async host => {
  const readLeads = shared(() => db('v_lead_recovery'
    + '?select=lead_id,lead_name,lead_status,lead_is_open,lead_created_at,state,state_basis,'
    + 'response_time_minutes,response_time_state,sla_first_response_minutes,sla_state,response_time_note,'
    + 'last_contact_at,last_contact_state,messages_resolved,messages_in,messages_out,'
    + 'hours_since_our_last_message,minutes_since_their_last_message,silence_state,silence_threshold_hours,'
    + 'silence_markers_on_file,silence_detector_state,silence_detector_note,risk_level,risk_basis,'
    + 'recommended_action,action_reason,owner_name,owner_state,owner_note,action_state,'
    + 'opportunity_value_aed,opportunity_value_state,opportunity_value_basis,'
    + 'confirmed_outcome_state,confirmed_revenue_aed,confirmed_outcome_date,confirmed_outcome_basis,'
    + 'recovery_attribution_state,recovered_value_aed,recovery_attribution_basis,confidence,confidence_basis,'
    + 'human_approval_required,automation_state,automation_note,vehicle_interest_text,vehicle_state,vehicle_note,'
    + 'settings_are_defaults,computed_at'
    + '&order=lead_id.asc&limit=500'));

  const readCoverage = shared(() => db('v_lead_recovery_coverage?select=*'));

  const readStates = shared(() => db('v_lead_recovery_state_model'
    + '?select=state,sort,meaning,engine_can_produce,blocked_by,requires,leads_in_state_now,observation'
    + '&order=sort.asc&limit=100'));

  const readQueue = shared(() => db('v_lead_recovery_queue'
    + '?select=id,lead_id,lead_name,lead_status,status,is_live,awaiting_decision,recommendation,engine_state,'
    + 'engine_reason,engine_still_agrees,outcome_state,outcome_sentence,opportunity_value_state,'
    + 'opportunity_value_basis,proposed_at,days_open'
    + '&order=proposed_at.desc&limit=200'));

  const readHealth = shared(() => db('v_lead_recovery_health'
    + '?select=actions_total,awaiting_decision,approved_not_executed,executed,execution_failed,rejected,deferred,'
    + 'cancelled,outcomes_attributed,outcomes_not_attributable,executed_awaiting_outcome,attributed_revenue_aed,'
    + 'events_total,events_without_audit,audit_rows,last_audit_at,health'));

  /* ── Derivations, once, in one place ──────────────────────────────────── */
  const leadFacts = rows => {
    const leads = rows || [];
    /* Partitioned on the one value that means "the engine put a figure to
       this", so every other state is handled by complement — including a state
       nobody here has heard of yet. Live on all three leads: UNKNOWN_NO_LINK. */
    const sized = leads.filter(d => n0(d.opportunity_value_aed) != null);
    const owned = leads.filter(d => up(d.owner_state) === 'ASSIGNED');
    const timed = leads.filter(d => up(d.response_time_state) === 'MEASURED');
    /* A sale on file, and the SEPARATE question of whether this product had
       anything to do with it. The second is the one that matters commercially
       and it is never inferred from the first. */
    const withSale = leads.filter(d => up(d.confirmed_outcome_state) === 'CONFIRMED_SALE');
    const attributed = leads.filter(d => up(d.recovery_attribution_state) === 'RECOVERED_BY_ACTION');
    const unattributedSales = leads.filter(d => up(d.recovery_attribution_state) === 'SALE_WITHOUT_RECOVERY_ACTION');
    return { leads, sized, owned, timed, withSale, attributed, unattributedSales,
      defaults: leads.some(d => d.settings_are_defaults === true),
      computedAt: leads.length ? leads[0].computed_at : null };
  };

  /* ══════════════════════════════════════════════════════════════════════
     P1 · The zero, at full size, with its reason
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'Is this dealership leaking leads today?',
    sub: 'The engine scores every lead on file and states a risk with a reason for each. The headline counts below are '
       + 'the coverage view&rsquo;s own, not a recount of the rows further down',
    actions: linkBtn('leads', 'Open Leads') + ' ' + linkBtn('revenue', 'Open Revenue Recovery'),
    load: async () => {
      const [c, l] = await Promise.all([settle(readCoverage()), settle(readLeads())]);
      if (c.err && l.err) throw c.err;
      return { c, l };
    },
    render: ({ c, l }) => {
      const C = c.err ? null : (c.v && c.v[0]) || null;
      const F = l.err ? null : leadFacts(l.v);

      const riskTile = C
        ? kpi('Leads at risk', num(C.leads_at_risk),
            muted(`Of ${num(C.leads_total)} ${plural(C.leads_total, 'lead', 'leads')} scored`
              + (n0(C.leads_risk_unknown)
                  ? `, and ${num(C.leads_risk_unknown)} whose risk could not be determined at all`
                  : ', none of them scored as undetermined')
              /* The zero says only what a zero proves: the engine ran and
                 flagged nothing. WHY each lead is not leaking is that lead's
                 own risk_basis, printed per row further down — asserting a
                 single reason here would be this screen inventing one. */
              + `. ${n0(C.leads_at_risk)
                  ? 'Each one is listed below with the evidence behind it.'
                  : 'No measurable recovery opportunity is currently detected: the engine scored every lead on file '
                    + 'and flagged none of them. That is the engine answering, not the engine failing — each lead\'s '
                    + 'own reason is in the table below.'}`),
            n0(C.leads_at_risk) ? 't-hot' : '')
        : kpi('Leads at risk', num(null), readFailed('The coverage view', c.err));

      const unknownTile = C
        ? kpi('Risk undetermined', num(C.leads_risk_unknown),
            muted(n0(C.leads_risk_unknown)
              ? 'Scored neither way. Unknown is not the same as safe, and these are not in the count beside them.'
              : 'Every lead on file was scored one way or the other, so nothing is sitting in an unknown state.'),
            n0(C.leads_risk_unknown) ? 't-hot' : '')
        : kpi('Risk undetermined', num(null), readFailed('The coverage view', c.err));

      const ownerTile = C
        ? kpi('Leads with no owner', num(C.leads_with_no_owner),
            muted(`Of ${num(C.leads_total)} ${plural(C.leads_total, 'lead', 'leads')}. `
              + (n0(C.leads_with_no_owner)
                  ? 'An action with nobody\'s name on it is an action nobody does. NEXUS holds no verified role '
                    + 'directory for this dealership and will not guess one.'
                  : 'Every lead names the person responsible for it.')),
            n0(C.leads_with_no_owner) ? 't-hot' : '')
        : kpi('Leads with no owner', num(null), readFailed('The coverage view', c.err));

      /* The two figures that must never be merged, side by side and named
         differently on purpose. */
      const confirmedTile = C
        ? kpi('Confirmed sales on file', num(C.leads_with_a_confirmed_sale),
            muted(n0(C.leads_with_a_confirmed_sale)
              ? `${aed(C.confirmed_revenue_aed)} of confirmed revenue against `
                + `${plural(C.leads_with_a_confirmed_sale, 'this lead', 'these leads')}. Confirmed means a sale row `
                + 'exists — it says nothing about who or what caused it.'
              : 'No lead on file carries a recorded sale. That is what this database holds, not proof that nobody '
                + 'bought anything.'),
            n0(C.leads_with_a_confirmed_sale) ? 't-won' : '')
        : kpi('Confirmed sales on file', num(null), readFailed('The coverage view', c.err));

      const recoveredTile = C
        ? kpi('Sales attributed to a recovery action', num(C.sales_attributed_to_a_recovery_action),
            muted(n0(C.sales_attributed_to_a_recovery_action)
              ? 'Linked to an executed action in this lane by a named person.'
              : `${num(C.recovery_actions_total)} recovery `
                + `${plural(C.recovery_actions_total, 'action has', 'actions have')} ever been raised, and no `
                + 'completed business outcome has been linked to one. Nothing has been recovered because nothing has '
                + 'been connected — that is an evidence gap, not a result.'),
            n0(C.sales_attributed_to_a_recovery_action) ? 't-won' : '')
        : kpi('Sales attributed to a recovery action', num(null), readFailed('The coverage view', c.err));

      /* Two reads of one engine disagreeing is a fact worth saying out loud
         rather than quietly preferring one of them. */
      const mismatch = (C && F && Number(C.leads_total) !== F.leads.length)
        ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">rule</span><div>
             The coverage view counts ${num(C.leads_total)} ${plural(C.leads_total, 'lead', 'leads')} and the lead
             list returned ${num(F.leads.length)}. Two reads of one engine disagree, so the counts above are the
             coverage view&rsquo;s and the rows below are the list&rsquo;s. Neither has been adjusted to agree with
             the other.
           </div></div>`
        : '';

      const settings = (C && C.settings_are_defaults === true)
        ? `<div class="banner info"><span class="material-symbols-outlined" style="font-size:20px">tune</span><div>
             ${bold('These thresholds are this product&rsquo;s defaults, not this dealership&rsquo;s policy.')}
             ${muted(`The first-response SLA behind every judgement above is `
               + `${num(C.sla_first_response_minutes)} ${plural(C.sla_first_response_minutes, 'minute', 'minutes')}, `
               + 'and no row in this dealership&rsquo;s settings states it. A reasonable starting point, and not yet '
               + 'an agreed rule.'
               + (C.sla_agrees_with_needs_attention === false
                   ? ' It also DISAGREES with the number hardcoded in the Needs Attention queue, so two screens in '
                     + 'this product are currently quoting two different SLAs.'
                   : ' It agrees with the number hardcoded in the Needs Attention queue, checked on read.'))}
           </div></div>`
        : '';

      return `<div class="grid g5">${riskTile}${unknownTile}${ownerTile}${confirmedTile}${recoveredTile}</div>`
        + mismatch + settings;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P2 · What this engine cannot tell you — verbatim
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'What this engine cannot tell you',
    sub: 'The engine&rsquo;s own account of its blind spots, printed exactly as the database holds it. Read this before '
       + 'quoting anything else on this page',
    load: () => readCoverage(),
    render: rows => {
      const C = (rows && rows[0]) || null;
      if (!C) {
        return stateEmpty('The coverage view returned no row',
          'This engine publishes its own limitations and none came back, so this screen cannot say what it can and '
          + 'cannot see. That is a missing honesty surface, not a clean bill of health — treat every figure on this '
          + 'page as unqualified until it reads again.', 'visibility_off');
      }
      const text = str(C.what_this_engine_cannot_tell_you);
      if (!text) {
        return stateEmpty('The engine records no account of its limitations',
          'The coverage row exists and its explanation column is empty. That is a gap in the engine rather than an '
          + 'absence of limitations, and nothing on this page should be read as unqualified because of it.', 'visibility_off');
      }
      const clauses = cannotClauses(text);
      const split = clauses.length
        ? `<div class="section" style="margin-top:16px">
             <div class="label-caps">The same paragraph, clause by clause</div>
             ${table([
               { label: 'It cannot', strong: true, render: k => `<span class="mono">${esc(k.label)}</span>` },
               { label: 'Because', render: k => wrap(muted(esc(k.body))) },
             ], clauses)}
             ${muted('Split on the engine&rsquo;s own labels, so a limitation it records tomorrow appears here without '
               + 'anyone editing this screen. The paragraph above is the source and is unaltered.')}
           </div>`
        : muted('This screen could not find the engine&rsquo;s own clause labels inside that paragraph, so it is shown '
            + 'whole and unsplit rather than cut in a way the engine did not intend.');

      return `<div class="quote">${esc(text)}</div>` + split;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P3 · Identity coverage — the engine is blind to half the conversation
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'How much of the conversation this engine can actually see',
    sub: 'Every count on this page is computed over messages that resolve to a lead. This is that denominator, stated '
       + 'rather than left to be discovered',
    actions: linkBtn('conversations', 'Open Conversations'),
    load: () => readCoverage(),
    render: rows => {
      const C = (rows && rows[0]) || null;
      if (!C) {
        return stateEmpty('The coverage view returned no row',
          'Identity resolution, silence-detector freshness and the message denominator all live in that row, so none '
          + 'of them can be stated here.', 'link_off');
      }
      const resolved = n0(C.message_events_resolved_to_a_lead);
      const events = n0(C.message_events);
      const unresolved = (resolved != null && events != null) ? events - resolved : null;

      const head = `<div class="grid g4">
          ${kpi('Message events that resolve to a lead', (resolved != null && events != null)
            ? `${num(resolved)} / ${num(events)}`
            /* The row came back and the count did not. That is not a failed
               read and must not be worded as one, and it is not a zero either:
               the engine holds no number here, so none is shown. */
            : '<span class="pill unknown"><span class="dot"></span>NOT COUNTED</span>',
            (resolved != null && events != null)
              ? muted(`The engine&rsquo;s own identity resolution rate is ${esc(pct(C.identity_resolution_pct))}. `
                  + `The other ${num(unresolved)} message ${plural(unresolved, 'event resolves', 'events resolve')} to `
                  + 'nobody — every figure on this page is blind to ' + plural(unresolved, 'it', 'them') + '.')
              : muted('The coverage row was read and carries no message counts, so how much of the conversation this '
                  + 'engine can see is unknown on this render. Unknown, not none — treat every count on this page as '
                  + 'unqualified until it reads again.'),
            (unresolved ? 't-hot' : ''))}
          ${kpi('WhatsApp handles matching no lead', num(C.unresolved_whatsapp_handles),
            muted(n0(C.unresolved_whatsapp_handles)
              ? 'Real people this dealership is exchanging messages with, and no lead row for any of them. Their '
                + 'conversations are invisible to every count on this page. Unknown, not absent.'
              : 'Every WhatsApp handle on file resolves to a lead.'),
            n0(C.unresolved_whatsapp_handles) ? 't-hot' : '')}
          ${kpi('Leads with no measured response time', num(C.leads_with_no_measured_response_time),
            muted(n0(C.leads_with_no_measured_response_time)
              ? `Of ${num(C.leads_total)} ${plural(C.leads_total, 'lead', 'leads')}. A blank response time means `
                + 'nobody measured one — never that nobody answered.'
              : 'Every lead on file carries a measured first response.'),
            n0(C.leads_with_no_measured_response_time) ? 't-hot' : '')}
          ${kpi('Silence detector', str(C.silence_detector_state) || 'not stated',
            muted((C.silence_detector_last_success_at
                ? `Last succeeded ${esc(dubaiStamp(C.silence_detector_last_success_at))}`
                : 'No successful run is on record')
              + (C.silence_detector_last_run_at
                  ? `, last ran ${esc(dubaiStamp(C.silence_detector_last_run_at))}`
                  : ', and no run at all is on record')
              + (str(C.silence_detector_last_run_class)
                  ? ` and that run was classified ${esc(str(C.silence_detector_last_run_class))}`
                  : '')
              + '. '
              + (up(C.silence_detector_state) === 'STALE'
                  ? 'While it is stale, the ABSENCE of a silence marker corroborates nothing: "the customer has gone '
                    + 'quiet" is computed here from message timestamps alone and is weaker than it looks.'
                  : 'Silence markers written by this detector corroborate the timestamps the engine computes from.')),
            up(C.silence_detector_state) === 'STALE' ? 't-hot' : '')}
        </div>`;

      const detail = `<div class="section" style="margin-top:16px">
          <div class="label-caps">The raw denominators, as the engine counted them</div>
          <dl class="kv">
            <dt>Communication log rows</dt><dd>${num(C.communication_log_rows)}</dd>
            <dt>Of which message events</dt><dd>${num(C.message_events)}
              ${muted('The remainder are silence markers, which are not messages and are never counted as '
                + `conversation. ${num(C.silence_markers)} on file.`)}</dd>
            <dt>Resolved to a lead</dt><dd>${num(C.message_events_resolved_to_a_lead)}
              ${muted('Resolved by the one identity rule this system owns (INV-002): exact email, else the last nine '
                + 'digits of a phone but only where that tail belongs to exactly one person, else a bridge through '
                + 'the WhatsApp contact book. A shared tail matches nobody, on purpose.')}</dd>
            <dt>Leads with no resolved conversation</dt><dd>${num(C.leads_with_no_resolved_conversation)}
              ${muted(n0(C.leads_with_no_resolved_conversation)
                ? 'The engine knows nothing about what was said to these people.'
                : 'Every lead has at least one message the identity rule could attach to it.')}</dd>
            <dt>Actions whose lead belongs to another dealership</dt><dd>${num(C.actions_whose_lead_is_another_tenants)}
              ${muted('A cross-tenant reference would be a data fault, not a finding about leads. This is the engine '
                + 'checking itself on every read.')}</dd>
            <dt>Computed at</dt><dd>${esc(dubaiStamp(C.computed_at))}
              ${muted('This engine is a view, so it is recomputed on read rather than refreshed on a schedule.')}</dd>
          </dl>
        </div>`;

      return head + detail;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P4 · Every lead, and the reason it is not leaking
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'Every lead the engine scored',
    sub: 'One deterministic row per lead. The Why column is the engine&rsquo;s own basis, not a summary of it',
    actions: linkBtn('leads', 'Open Leads'),
    load: () => readLeads(),
    render: rows => {
      const F = leadFacts(rows);
      if (!F.leads.length) {
        return stateEmpty('This engine scored no leads',
          'No lead row reached it. That is an empty pipeline or a read that matched nothing, and this screen cannot '
          + 'tell those two apart — so nothing is claimed about whether anything is leaking.', 'person_search');
      }

      const body = table([
        { label: 'Lead', strong: true, render: d =>
            `<div>${esc(str(d.lead_name) || ('Lead ' + str(d.lead_id)))}</div>`
            + muted(`#${esc(str(d.lead_id))} &middot; ${esc(str(d.lead_status) || 'no status')} &middot; `
              + (d.lead_is_open === true ? 'open' : d.lead_is_open === false ? 'closed' : 'open/closed not stated')) },
        { label: 'State', render: d =>
            pill(str(d.state) || 'UNKNOWN', '', { verbatim: true })
            + muted(esc(str(d.state_basis)) || 'The engine records no basis for this state.') },
        { label: 'Risk', render: d =>
            pill(str(d.risk_level) || 'UNKNOWN', '', { verbatim: true }) },
        { label: 'Why', render: d => wrap(muted(esc(str(d.risk_basis))
            || 'The engine records no basis for this risk level, which is itself a gap.')) },
        { label: 'Response', render: d => (up(d.response_time_state) === 'MEASURED'
            ? `<div>${esc(mins(d.response_time_minutes))}</div>`
              + muted(`${esc(str(d.sla_state) || 'SLA not stated')} against a `
                + `${num(d.sla_first_response_minutes)}-minute target`)
            : unknownCell(d.response_time_state, d.response_time_note)) },
        { label: 'Silence', render: d =>
            pill(str(d.silence_state) || 'UNKNOWN', '', { verbatim: true })
            + muted(up(d.silence_detector_state) === 'STALE'
                ? `Detector ${esc(str(d.silence_detector_state))} — computed from message timestamps only`
                : `${num(d.silence_markers_on_file)} ${plural(d.silence_markers_on_file, 'marker', 'markers')} on file, `
                  + `threshold ${num(d.silence_threshold_hours)} h`) },
        { label: 'Owner', render: d => (up(d.owner_state) === 'ASSIGNED'
            ? `<div>${esc(str(d.owner_name) || 'assigned, unnamed')}</div>`
              + muted(esc(str(d.owner_state)))
            : unknownCell(d.owner_state, d.owner_note)) },
        { label: 'What it could be worth', render: d => (n0(d.opportunity_value_aed) != null
            ? aed(d.opportunity_value_aed)
            : unknownCell(d.opportunity_value_state,
                str(d.opportunity_value_basis).replace(/^UNKNOWN\.\s*/i, ''))) },
        { label: 'Next action', render: d =>
            pill(str(d.recommended_action) || 'NONE', '', { verbatim: true })
            + muted(esc(str(d.action_reason)) || 'The engine records no reason for this recommendation.') },
      ], F.leads);

      /* ── The sentence this product must never be allowed to blur ─────────
         One lead converted. The engine says, in its own words, that NEXUS had
         nothing to do with it. Printed as its own block because inside a table
         cell it would be skimmed, and this is the claim a buyer would most like
         to hear overstated. */
      const disclaimers = F.unattributedSales.map(d => `<div class="banner warm" style="margin-top:12px">
          <span class="material-symbols-outlined" style="font-size:20px">handshake</span>
          <div>
            ${bold(`${esc(str(d.lead_name) || ('Lead ' + str(d.lead_id)))} converted — and NEXUS is not claiming it.`)}
            ${muted(esc(str(d.recovery_attribution_basis))
              || 'The engine records this state with no basis, which is itself a gap.')}
            ${muted(`Confirmed: ${aed(d.confirmed_revenue_aed)}`
              + (d.confirmed_outcome_date ? ` on ${esc(dubaiDate(d.confirmed_outcome_date))}` : '')
              + '. ' + esc(str(d.confirmed_outcome_basis) || 'No basis is recorded for the confirmed outcome.'))}
            ${muted('<span class="mono">' + esc(str(d.recovery_attribution_state)) + '</span> is a different column '
              + 'from the confirmed outcome, and answering the second has never been allowed to answer the first.')}
          </div></div>`).join('');

      const notes = [];
      notes.push(`${num(F.sized.length)} of ${num(F.leads.length)} `
        + `${plural(F.leads.length, 'lead carries', 'leads carry')} a monetary opportunity figure. `
        + (F.sized.length
            ? 'The rest are excluded from any total on this page.'
            : 'Not one does, so there is no estimated pipeline on this screen and there will not be one until a lead '
              + 'can be sized. The engine says a figure here would be invented, and it is right.'));
      notes.push(`${num(F.owned.length)} of ${num(F.leads.length)} `
        + `${plural(F.leads.length, 'lead names', 'leads name')} an owner, and `
        + `${num(F.timed.length)} ${plural(F.timed.length, 'carries', 'carry')} a measured first response.`);
      notes.push(`${num(F.withSale.length)} ${plural(F.withSale.length, 'lead has', 'leads have')} a confirmed sale on `
        + `file and ${num(F.attributed.length)} ${plural(F.attributed.length, 'has', 'have')} that sale attributed to `
        + 'a recovery action. Confirmed and attributed are different words and they are never interchanged here.');
      if (F.defaults) {
        notes.push('The SLA and silence thresholds behind every judgement in this table are this product&rsquo;s '
          + 'defaults rather than thresholds this dealership has set.');
      }
      if (F.computedAt) notes.push(`Scored ${esc(dubaiStamp(F.computedAt))}.`);

      return body + disclaimers + `<div class="section" style="margin-top:16px">${notes.map(t => muted(t)).join('')}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P5 · What the engine can say, and what it is saying today
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'Every state this engine can reach',
    sub: 'A branch that exists and is empty, and a branch that does not exist, are two different findings. Do not read '
       + 'a zero as evidence a branch is broken, or a branch as evidence of data',
    load: () => readStates(),
    render: rows => {
      const states = rows || [];
      if (!states.length) {
        return stateEmpty('The state model returned no rows',
          'The engine publishes its own vocabulary and none came back, so this screen cannot say which states are '
          + 'reachable. That is a missing reference table, not a finding about leads.', 'checklist');
      }
      const blocked = states.filter(s => s.engine_can_produce === false);
      const observed = states.filter(s => n0(s.leads_in_state_now));

      const body = table([
        { label: 'State', strong: true, render: s =>
            pill(str(s.state), s.engine_can_produce === false ? 'hot' : 'ok', { verbatim: true })
            + muted(wrap(esc(str(s.meaning)) || 'No meaning is recorded for this state.')) },
        { label: 'Observation', render: s =>
            pill(str(s.observation) || 'UNKNOWN', '', { verbatim: true }) },
        { label: 'Leads in it now', align: 'r', render: s => (n0(s.leads_in_state_now) != null
            ? num(s.leads_in_state_now)
            : '<span class="t-muted">not counted</span>') },
        { label: 'What it takes to be in it', render: s => wrap(muted(esc(str(s.requires))
            || 'The engine records no requirement for this state.')) },
        { label: 'Blocked by', render: s => (s.engine_can_produce === false
            ? `<span class="pill hot"><span class="dot"></span>${esc(str(s.blocked_by) || 'BLOCKED')}</span>`
              + muted('No branch of the engine can return this state, and none may be written until this is cleared. '
                + 'Adding one before then would be fabrication.')
            : muted('A branch exists for this state.')) },
      ], states);

      const note = muted(`${num(states.length)} ${plural(states.length, 'state is', 'states are')} defined. `
        + `${num(blocked.length)} ${plural(blocked.length, 'is', 'are')} structurally unreachable — no code path can `
        + `produce ${plural(blocked.length, 'it', 'them')} — and `
        + `${num(observed.length)} ${plural(observed.length, 'has', 'have')} a lead in `
        + `${plural(observed.length, 'it', 'them')} right now. Everything in between is a branch that works and that `
        + 'nothing has landed in, which is an observation about this dealership rather than about the software.');

      return body + `<div class="section" style="margin-top:16px">${note}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P6 · The recovery desk, and the provenance of this page
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'The recovery desk',
    sub: 'What has been put to a person in this lane, what came back, and the only revenue figure this product is '
       + 'allowed to call recovered',
    actions: linkBtn('actions', 'Open Action Center'),
    load: async () => {
      const [q, h, c, l] = await Promise.all([settle(readQueue()), settle(readHealth()),
                                             settle(readCoverage()), settle(readLeads())]);
      if (q.err && h.err && c.err) throw q.err;
      return { q, h, c, l };
    },
    render: ({ q, h, c, l }) => {
      const rows = q.err ? null : (q.v || []);
      const H = h.err ? null : (h.v && h.v[0]) || null;
      const C = c.err ? null : (c.v && c.v[0]) || null;
      const F = l.err ? null : leadFacts(l.v);

      /* The health view aggregates the action lane. With no action in the lane
         it returns NO ROW — which is an absent summary, not a set of zeroes,
         and it is said that way. The counts underneath come from the coverage
         view, which counts the same lane and does return a row. */
      const head = H
        ? `<div class="grid g4">
             ${kpi('Actions raised', num(H.actions_total),
               muted(`${num(H.awaiting_decision)} awaiting a decision, ${num(H.approved_not_executed)} approved and `
                 + `not carried out, ${num(H.executed)} carried out.`))}
             ${kpi('Outcomes attributed', num(H.outcomes_attributed),
               muted(n0(H.outcomes_attributed)
                 ? `${num(H.outcomes_not_attributable)} marked not attributable.`
                 : 'No completed sale has been linked to any action in this lane.'))}
             ${kpi('Revenue this product may call recovered', n0(H.attributed_revenue_aed) != null
               ? aed(H.attributed_revenue_aed)
               : '<span class="pill unknown"><span class="dot"></span>NOT ATTRIBUTED</span>',
               muted(n0(H.attributed_revenue_aed) != null
                 ? 'Attributed by a named person to an executed action, against a confirmed sale.'
                 : 'Null until a person attributes a confirmed sale to an executed action. Null, not zero: nothing '
                   + 'has been recovered because nothing has been connected.'))}
             ${kpi('Desk health', str(H.health) || 'not stated',
               muted(`${num(H.events_total)} recorded ${plural(H.events_total, 'step', 'steps')}, `
                 + `${num(H.events_without_audit)} without an audit row behind `
                 + `${plural(H.events_without_audit, 'it', 'them')}.`
                 + (H.last_audit_at ? ` Last audit ${esc(dubaiStamp(H.last_audit_at))}.` : ' No audit row on record.')))}
           </div>`
        : h.err
          ? `<div class="section">${readFailed('The desk health view', h.err)}</div>`
          : `<div class="banner info"><span class="material-symbols-outlined" style="font-size:20px">inbox</span><div>
               ${bold('The desk summary returned no row at all.')}
               ${muted('That is an absent summary rather than a row of zeroes, and the difference matters: it means '
                 + 'there is nothing in this lane to summarise, not that the lane was measured and found empty.'
                 + (C
                     ? ` The coverage view counts ${num(C.recovery_actions_total)} recovery `
                       + `${plural(C.recovery_actions_total, 'action', 'actions')} in it, `
                       + `${num(C.recovery_actions_executed)} carried out and `
                       + `${num(C.recovery_outcomes_attributed)} with an attributed outcome.`
                     : ' The coverage view could not be read either, so nothing is stated about the lane at all.'))}
             </div></div>`;

      const list = rows == null
        ? `<div class="section">${readFailed('The recovery queue', q.err)}</div>`
        : table([
            { label: 'Lead', strong: true, render: a =>
                `<div>${esc(str(a.lead_name) || ('Lead ' + str(a.lead_id)))}</div>`
                + muted(`#${esc(str(a.lead_id))} &middot; ${esc(str(a.lead_status) || 'no status')}`) },
            { label: 'Recommended', render: a => pill(str(a.recommendation) || 'NONE', '', { verbatim: true }) },
            { label: 'Status', render: a => pill(str(a.status) || 'UNKNOWN', '', { verbatim: true })
                + muted(a.engine_still_agrees === false
                    ? 'The engine no longer agrees with the recommendation this was approved on.'
                    : a.engine_still_agrees === true
                      ? 'The engine still agrees with the recommendation this was approved on.'
                      : 'Whether the engine still agrees is not recorded.') },
            { label: 'What it could be worth', render: a => unknownCell(a.opportunity_value_state,
                str(a.opportunity_value_basis).replace(/^UNKNOWN\.\s*/i, '')) },
            { label: 'Outcome', render: a => wrap(muted(esc(str(a.outcome_sentence))
                || 'The database records no outcome sentence against this action.')) },
          ], rows, {
            empty: stateEmpty('No recovery action has ever been raised',
              'The engine has scored every lead and nobody has been asked to do anything about any of them, so this '
              + 'desk is unopened rather than cleared. Nobody is late, and nothing has been rejected.', 'task_alt'),
          });

      /* The engine writes this note per lead, so it is only printed as a
         statement about the lane when every lead agrees on it. Where they do
         not, one row's sentence is not the lane's sentence and none is shown
         rather than promoting an arbitrary row to speak for the rest. */
      const notes = F ? [...new Set(F.leads.map(d => str(d.automation_note)).filter(Boolean))] : [];
      const automation = notes.length === 1
        ? muted('<strong>Who carries out a recovery action:</strong> ' + esc(notes[0]))
        : notes.length > 1
          ? muted(`The engine records ${num(notes.length)} different notes about who executes an action in this lane, `
              + 'one per lead, so none is shown here as though it described the lane. Each row&rsquo;s own note is on '
              + 'that row.')
          : F && F.leads.length
            ? muted('The engine records no note about who executes an action in this lane.')
            : '';

      /* ── The provenance strip ───────────────────────────────────────────
         Evidence, confidence, coverage, unknown, last updated, tenant, action.
         Every line is read from something on this page rather than asserted
         here; where a read failed, the line says so instead of going quiet. */
      const t = tenantState();
      const label = tenantLabel(t);
      const tenantLine = !t.loaded
        ? 'Still being read.'
        : !t.ok
          ? `The membership read failed (${esc(str(t.error))}), so this page cannot say which dealership these rows `
            + 'belong to. It is not a claim that they belong to none.'
          : label
            ? `${esc(label)}. Every row above is scoped by the database against this account, not filtered by this screen.`
            : 'This account has a membership with no readable dealership name.';

      const confidences = F
        ? [...new Set(F.leads.map(d => str(d.confidence)).filter(Boolean))].join(', ')
        : '';

      const strip = [
        ['Evidence', C
          ? `Every state on this page is derived from rows in this database: ${num(C.leads_total)} `
            + `${plural(C.leads_total, 'lead', 'leads')}, ${num(C.message_events)} message events and `
            + `${num(C.silence_markers)} silence ${plural(C.silence_markers, 'marker', 'markers')}. `
            + 'No judgement here is a model output.'
          : 'The coverage view could not be read, so the evidence behind these figures is not stated.'],
        ['Confidence', confidences
          ? `The engine grades each lead: ${esc(confidences)}. Its basis is printed against each row, and it never `
            + 'exceeds what the underlying key allows — identity resolved by rule is MEDIUM, never HIGH.'
          : 'No lead row was read on this render, so no confidence is stated.'],
        ['Data coverage', C
          ? `${num(C.message_events_resolved_to_a_lead)} of ${num(C.message_events)} message events resolve to a lead `
            + `(${esc(pct(C.identity_resolution_pct))}); the remainder are invisible to every count above. `
            + `${num(C.leads_with_no_measured_response_time)} of ${num(C.leads_total)} `
            + `${plural(C.leads_total, 'lead has', 'leads have')} no measured response time.`
          : 'Not established — the coverage view could not be read.'],
        ['Unknown', C && str(C.what_this_engine_cannot_tell_you)
          ? esc(str(C.what_this_engine_cannot_tell_you))
          : 'The engine&rsquo;s own account of its limitations could not be read on this render, so nothing on this '
            + 'page should be treated as unqualified.'],
        ['Last updated', C && C.computed_at
          ? `${esc(dubaiStamp(C.computed_at))}. This engine is a view, recomputed on read.`
          : 'Not stated on this render.'],
        ['Tenant', tenantLine],
        ['Action', C
          ? (n0(C.leads_at_risk)
              ? 'Work the leads flagged above, each with the reason the engine gave.'
              : 'Nothing is waiting on anybody in this lane. The next thing that would change this page is not a '
                + 'decision — it is resolving the WhatsApp handles that match no lead, which is what makes half the '
                + 'conversation countable.')
          : 'Not established on this render.'],
      ];

      const stripHtml = `<div class="section" style="margin-top:16px">
          <div class="label-caps">Where this page stands</div>
          <dl class="kv">${strip.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
        </div>`;

      return head + list
        + (automation ? `<div class="section" style="margin-top:16px">${automation}</div>` : '')
        + stripHtml;
    },
  }).then(wireGo);
};
