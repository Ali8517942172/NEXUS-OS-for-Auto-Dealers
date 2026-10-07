/* NEXUS OS — screens/attribution.js
   REVENUE ATTRIBUTION GRAPH. Campaign → Lead → Conversation → Vehicle → Deal →
   Sale, and — the point of the screen — exactly where that chain breaks.

   PRODUCT.md: "Never invent attribution where the relationship data does not
   exist." This screen is that sentence rendered. It does not score channels, it
   does not apportion revenue, and it does not fill a gap with a plausible
   guess. It shows which links the database can evidence, which it refuses, why
   each refusal is a refusal, and what integration would turn each one into an
   answer.

   WHERE EVERYTHING COMES FROM — nothing below is computed in this file
     v_attribution_link_map    the chain hop by hop, 16 hops. Per hop: the
                               state, the basis, whether that basis is evidence
                               at all, live coverage, a `finding` written
                               against the live catalogue, and `unlocked_by` /
                               `unlock_rank` — the integration that would close
                               it and how much attribution it would buy.
     v_attribution_sale_chain  one row per recorded sale, walking eight hops
                               with a state, a basis, a confidence and a reason
                               at each.
     v_attribution_lead_chain  one row per lead, walking six hops forward.
     v_attribution_edges       every candidate link between two records,
                               INCLUDING the ones NEXUS refuses.
     v_attribution_events      the event stream, with a row emitted even when
                               its lead does not resolve — because unknown is
                               not none.
     attribution_link_basis    the closed vocabulary of HOW a link was
                               established, and the `is_evidence` flag that
                               separates a link this product may reason from
                               (a key, a person's confirmation) from one it may
                               only display as a refusal (a text coincidence, an
                               empty column, a column that does not exist).

   ═══════════════════════════════════════════════════════════════════════════
   FOUR RULES THIS SCREEN IS BUILT AROUND
   ═══════════════════════════════════════════════════════════════════════════

   1. THE CAMPAIGN HOP IS NOT A GAP IN THE LAYOUT. It is the owner's first
      question — "which channel made me money" — and the answer today is that it
      cannot be answered at any confidence, because there is no campaigns table
      anywhere in this database and `leads.source` holds the name of the
      internal workflow that created the row. That is said at the top of the
      screen, in the engine's own words, rather than left as an empty cell the
      reader is invited to fill in for themselves.

   2. A PERFECT TEXT MATCH IS RENDERED AS A REFUSAL, AND THAT IS THE FEATURE.
      The one real sale reads "Lexus LX 600 2024" at AED 585,000 — character for
      character the model of unit NX-1011 and exactly its list price — and
      NX-1011 is still marked Available. The engine grades that hop
      UNKNOWN_TEXT_ONLY. A product that drew the line anyway would be right
      about this one row and would have taught its owner to trust a coincidence.

   3. THE ONLY COLOUR ON THIS PAGE IS THE ENGINE'S OWN `is_evidence` FLAG.
      Every state word is printed verbatim, and the green/red beside it is read
      from attribution_link_basis, never from a severity map in this file. A
      screen that invents its own opinion about which database word is bad has
      created a second derivation of the same fact.

   4. NO COVERAGE FIGURE IS INVENTED WHERE NOTHING WAS MEASURED. Eight of the
      sixteen hops report coverage_pct NULL with a sentence saying why — no
      instances can exist, or the candidate set is not enumerated row by row.
      Those hops are counted as "not measured" and are named; they are never
      folded into a denominator as zeroes. */

import { db } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { aed, dubaiDate, dubaiStamp, esc, num, pct } from '../lib/format.js';
import { maskText } from '../lib/privacy.js';
import { SCREENS, go } from '../lib/nav.js';
import { tenantLabel, tenantState } from '../lib/tenant.js';
/* The one definition of the v_attribution_sale_chain reduction, which both this
   screen and Revenue Recovery print `Confirmed revenue` from. It used to exist
   here as well, verbatim in its shared half, so the same figure had two
   derivations — see the comment above `saleFacts` in screens/revenue.js, which
   also says why the definition lives in that module rather than in this one:
   revenue.js is a plain static import in app.js and is always in the bundle,
   while this file is registered through `import.meta.glob` because it may not be
   on disk. The dependency points that way round on purpose. */
import { saleFacts } from './revenue.js';
import { SX, BANNER, BANNER_ICON, kpi, panel, table, pill, stateEmpty, unknownPill, linkBtn, wireGo, engineHeader, engineFooter } from './revenue.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const n0  = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted  = h => `<div class="${SX.sub}">${h}</div>`;
const hot    = h => `<div class="${SX.hot}">${h}</div>`;
const bold   = h => `<div class="${SX.bold}">${h}</div>`;
const wrap   = h => `<div class="${SX.wrap}">${h}</div>`;
const mono   = v => `<span class="${SX.mono}">${esc(str(v))}</span>`;

/* A read failure, said in one sentence, in the place the figure would have
   been. Never a bare dash: a dash beside "Hops evidenced" reads as zero, and
   zero on this screen is a finding rather than an absence. */
const readFailed = (what, err) =>
  hot(`${esc(what)} could not be read (${esc(str(err && err.message) || 'no reason given')}), so nothing is claimed `
    + 'here and nothing is ruled out.');

/* THE ONE WAY AN UNKNOWN IS ALLOWED TO RENDER on this screen: the engine's own
   state word, then the engine's own reason underneath it. Never '—', never 0,
   never an empty cell — each of those reads as "nothing happened" when what is
   true is "nothing is recorded". The fallback sentence is itself a finding: a
   state with no reason attached is a gap in the engine, not a gap in the data,
   and saying so is more useful than printing nothing. */
const unknownCell = (state, reason) =>
  `${unknownPill(str(state) || 'UNKNOWN')}`
  + muted(esc(str(reason)) || 'The engine records no reason for this state, which is itself a gap.');

/* Reads shared between panels are memoised so two panels describing the same
   rows cannot describe two different moments — and the memo is DROPPED on
   rejection, because panel()'s Retry re-invokes `load` and a cached rejection
   would give the operator a button whose only possible outcome is the same
   failure. Same shape as screens/overview.js and screens/revenue.js. */
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

/* ── Navigating to a screen that may not be in this build ───────────────────
   Four Revenue Recovery engine screens are separate modules and lib/nav.js
   offers all of their ids whether or not every module has landed. A button that
   silently did nothing, or bounced the operator elsewhere, would be worse than
   a disabled one, so the button says which of the two it is before it is
   pressed. */
/* linkBtn() and wireGo() come from the engine-desk kit in screens/revenue.js. */

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.attribution = async host => {
  /* The root is the Stitch scope (`nx-stitch` switches on the scoped reset the
     design classes were drawn against). It is a wrapper this screen appends and
     NOT a class on `#screen`, for the reason the old `.ds-screen` wrapper gave:
     lib/nav.js empties `#screen` between renders without touching its classes,
     so a class set there would follow the operator onto another screen.
     Design: design/stitch/attribution-multi-channel-revenue-engine--803cc4.html. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-lg');
  host.appendChild(root);
  root.insertAdjacentHTML('beforeend', engineHeader({
    title: 'Attribution',
    sub: 'Campaign → lead → conversation → vehicle → deal → sale: what this database can evidence about how money arrived, hop by hop.',
    actionsHtml: linkBtn('revenue', 'Open Revenue Recovery') + linkBtn('deals', 'Open Deals'),
  }));
  wireGo(root);

  /* Every path is a literal so QUALITY_GATE.mjs can extract it and check each
     column name against the live catalogue. Do not move these into a map keyed
     by name: the gate cannot follow a variable, and a column renamed in the
     database would then reach a customer as a blank cell. */

  const readMap = shared(() => db('v_attribution_link_map'
    + '?select=seq,edge,from_node,to_node,state,basis,basis_is_evidence,basis_confidence,source_ref,'
    + 'finding,unlocked_by,unlock_rank,instances_total,instances_evidenced,instances_refused,coverage_pct,coverage_note'
    + '&order=seq.asc&limit=200'));

  const readBasis = shared(() => db('attribution_link_basis'
    + '?select=basis,rank,is_evidence,default_confidence,label,description'
    + '&order=rank.asc&limit=100'));

  const readSale = shared(() => db('v_attribution_sale_chain'
    + '?select=sale_id,purchase_date,recorded_at,customer_name,vehicle_text,deal_id,revenue_aed,revenue_kind,'
    + 'gross_margin_aed,campaign_state,campaign_note,lead_id,lead_name,lead_state,lead_note,'
    + 'conversation_messages,conversation_state,conversation_note,vehicle_unit_id,vehicle_text_candidates,'
    + 'vehicle_state,vehicle_basis,vehicle_confidence,vehicle_note,deal_record_state,deal_record_note,'
    + 'finance_state,finance_note,revenue_state,revenue_note,margin_state,margin_note,'
    + 'hops_total,hops_evidenced,first_break,chain'
    + '&order=purchase_date.desc&limit=200'));

  const readLeadChain = shared(() => db('v_attribution_lead_chain'
    + '?select=lead_id,lead_name,created_at,status,campaign_state,campaign_note,'
    + 'conversation_messages,messages_in,messages_out,conversation_state,conversation_basis,conversation_note,'
    + 'vehicle_interest_text,vehicle_text_candidates,vehicle_state,vehicle_basis,vehicle_note,'
    + 'finance_quotes,finance_state,finance_note,sales_recorded,revenue_confirmed_aed,revenue_kind,last_sale_date,'
    + 'sale_state,sale_note,margin_state,margin_note,hops_total,hops_evidenced,first_break'
    + '&order=lead_id.asc&limit=500'));

  /* The one honest answer that DOES exist about where enquiries came from.
     nexus_lead_attribution_summary() reads the lead-ingestion layer, which
     records what the provider said at the moment of arrival — not leads.source,
     which holds the name of the workflow that wrote the row. It is built so it
     cannot flatter: the UNKNOWN bucket is emitted even at zero, and
     share_of_known and share_of_all are two different numbers so the kinder one
     cannot be quoted by accident. */
  const readOrigins = shared(() => db('rpc/nexus_lead_attribution_summary'));

  const readEdges = shared(() => db('v_attribution_edges'
    + '?select=edge,from_kind,from_ref,to_kind,to_ref,basis,confidence,note'
    + '&order=edge.asc&limit=1000'));

  const readEvents = shared(() => db('v_attribution_events'
    + '?select=event_seq,event_type,event_id,occurred_at,actor,subject_kind,subject_ref,lead_id,lead_basis,'
    + 'lead_confidence,lead_note,unit_id,unit_basis,unit_note,amount_aed,amount_kind,detail'
    + '&order=occurred_at.desc&limit=500'));

  /* ── Derivations, once, in one place ────────────────────────────────────
     Each of these counts rows this account could read. None of them recomputes
     a figure the engine already states: coverage per hop, hops per chain and
     the evidence flag per basis are all read, never derived. */

  const basisIndex = rows => {
    const by = new Map();
    (rows || []).forEach(b => by.set(up(b.basis), b));
    return by;
  };

  const mapFacts = rows => {
    const hops = rows || [];
    /* Partitioned on the engine's own boolean rather than on the spelling of
       the state. A state nobody here has heard of still lands on the correct
       side, because attribution_link_basis decides and this file does not. */
    const evidenced = hops.filter(h => h.basis_is_evidence === true);
    const refused   = hops.filter(h => h.basis_is_evidence === false);
    const ungraded  = hops.filter(h => h.basis_is_evidence !== true && h.basis_is_evidence !== false);
    /* Two kinds of "no coverage", counted separately and never merged. A hop
       with instances is measured; a hop with coverage_pct NULL was not measured
       at all and its own coverage_note says why. Folding the second into the
       first would report 0% for something nobody counted. */
    const measured   = hops.filter(h => n0(h.coverage_pct) != null);
    const unmeasured = hops.filter(h => n0(h.coverage_pct) == null);
    const instances  = measured.reduce((a, h) => a + (n0(h.instances_total) || 0), 0);
    const asEvidence = measured.reduce((a, h) => a + (n0(h.instances_evidenced) || 0), 0);
    const asRefusal  = measured.reduce((a, h) => a + (n0(h.instances_refused) || 0), 0);
    const unlocks = hops.filter(h => str(h.unlocked_by))
      .sort((a, b) => (n0(a.unlock_rank) ?? 999) - (n0(b.unlock_rank) ?? 999));
    return { hops, evidenced, refused, ungraded, measured, unmeasured, instances, asEvidence, asRefusal, unlocks,
      campaign: hops.find(h => up(h.edge) === 'CAMPAIGN_TO_LEAD') || null,
      firstUnlock: unlocks[0] || null };
  };

  /* ══════════════════════════════════════════════════════════════════════
     P1 · The chain, and the question it cannot answer
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Campaign → Lead → Conversation → Vehicle → Deal → Sale',
    sub: 'What this database can evidence about how money arrived, hop by hop — and, first, the one hop that makes '
       + 'the owner&rsquo;s question unanswerable',
    actions: linkBtn('revenue', 'Open Revenue Recovery') + ' ' + linkBtn('deals', 'Open Deals'),
    load: async () => {
      const [m, s, e] = await Promise.all([settle(readMap()), settle(readSale()), settle(readEdges())]);
      if (m.err && s.err && e.err) throw m.err;
      return { m, s, e };
    },
    render: ({ m, s, e }) => {
      const F = m.err ? null : mapFacts(m.v);
      const S = s.err ? null : saleFacts(s.v);
      const edges = e.err ? null : (e.v || []);

      /* ── The campaign banner ────────────────────────────────────────────
         Printed from the engine's own `finding` and `unlocked_by`, not
         paraphrased. A paraphrase here would be a second copy of a business
         fact that drifts the first time the view is edited — and this
         particular fact is the one a buyer asks about first. */
      const campaign = F && F.campaign;
      const campaignBanner = campaign
        ? `<div class="${BANNER.hot}">
             <span class="${BANNER_ICON}">campaign</span>
             <div>
               ${bold('&ldquo;Which channel made me money?&rdquo; cannot be answered — and this screen will not guess.')}
               <div class="${SX.sub}">${esc(str(campaign.finding))}</div>
               ${str(campaign.unlocked_by)
                  ? muted('<strong>What would answer it:</strong> ' + esc(str(campaign.unlocked_by)))
                  : muted('The engine records no integration that would close this hop, which is itself a gap.')}
             </div>
           </div>`
        : (m.err
            ? `<div class="${SX.note}">${readFailed('The attribution link map', m.err)}</div>`
            : `<div class="${BANNER.warm}"><span class="${BANNER_ICON}">rule</span>
                 <div>Nothing at all is recorded about the step from a campaign to a lead, so this screen cannot say
                 what is known about that link either way. That is a gap in the record, not a campaign that resolved.</div>
               </div>`);

      const hopTile = F
        ? kpi('Hops that can carry evidence', `${num(F.evidenced.length)} / ${num(F.hops.length)}`,
            muted(`${num(F.refused.length)} ${plural(F.refused.length, 'hop is', 'hops are')} a refusal: the basis `
              + `behind ${plural(F.refused.length, 'it', 'them')} is one this product may display and may not reason `
              + 'from — a text coincidence, an empty column, or a column that does not exist. '
              + (F.ungraded.length
                  ? `${num(F.ungraded.length)} ${plural(F.ungraded.length, 'hop carries', 'hops carry')} no evidence `
                    + 'flag at all and ' + plural(F.ungraded.length, 'is', 'are') + ' counted as neither.'
                  : 'Every hop carries an explicit evidence flag.')),
            F.refused.length ? 't-hot' : '')
        : kpi('Hops that can carry evidence', num(null), readFailed('The attribution link map', m.err));

      const coverageTile = F
        ? kpi('Links that are evidence', `${num(F.asEvidence)} / ${num(F.instances)}`,
            muted(`Counted across the ${num(F.measured.length)} of ${num(F.hops.length)} `
              + `${plural(F.hops.length, 'hop', 'hops')} the engine actually measured. `
              + `${num(F.asRefusal)} of those candidate ${plural(F.asRefusal, 'link is', 'links are')} a recorded `
              + 'refusal rather than a link. '
              + (F.unmeasured.length
                  ? `The other ${num(F.unmeasured.length)} ${plural(F.unmeasured.length, 'hop', 'hops')} report no `
                    + 'coverage at all — UNKNOWN, not 0%, and each says why in its own row below.'
                  : 'Every hop reported a coverage figure.')))
        : kpi('Links that are evidence', num(null), readFailed('The attribution link map', m.err));

      const saleTile = S && S.sales.length
        ? kpi('Hops evidenced on recorded sales', `${num(S.hopsEvidenced)} / ${num(S.hopsTotal)}`,
            muted(`Across ${num(S.sales.length)} recorded ${plural(S.sales.length, 'sale', 'sales')}. `
              + 'Each sale is walked hop by hop further down, with the reason at every one that did not resolve.'))
        : S
          ? kpi('Hops evidenced on recorded sales', 'No sale on file',
              muted('The sale chain holds no row this account can read, so no chain can be walked and none is claimed. '
                + 'An empty ledger, not a broken chain.'))
          : kpi('Hops evidenced on recorded sales', num(null), readFailed('The sale chain', s.err));

      const revenueTile = S && S.confirmed.length
        ? kpi('Confirmed revenue on file', aed(S.revenue),
            muted(`Summed over ${num(S.confirmed.length)} of ${num(S.sales.length)} `
              + `${plural(S.sales.length, 'sale', 'sales')}`
              + (S.unconfirmed
                  ? `, with ${num(S.unconfirmed)} excluded because ${plural(S.unconfirmed, 'its', 'their')} revenue is `
                    + 'not confirmed or carries no amount'
                  : ', with none excluded')
              + '. Confirmed means the amount is a column of the sale record. None of it is attributed to a campaign, '
              + 'a channel or anything this product did.'), 't-won')
        /* Sales on file, none of them admitted. The sum of an empty admitted
           set is zero and must not be printed as money: "AED 0" beside the word
           revenue is read as a trading result, and what is true is that nothing
           qualified. Distinct from the "no sale on file" branch below it — an
           empty ledger and a ledger nothing in which can be confirmed are two
           different findings and each gets its own sentence. */
        : S && S.sales.length
          ? kpi('Confirmed revenue on file', 'Nothing confirmed',
              muted(`${num(S.sales.length)} ${plural(S.sales.length, 'sale is', 'sales are')} on file and not one `
                + 'carries a confirmed amount, so there is nothing to total. An absence, and not a nil.'))
        : S
          ? kpi('Confirmed revenue on file', 'No sale on file',
              muted('No sale record is readable, so there is no confirmed revenue to describe and none is claimed.'))
          : kpi('Confirmed revenue on file', num(null), readFailed('The sale chain', s.err));

      const edgeTile = edges == null
        ? kpi('Candidate links examined', num(null), readFailed('The edge list', e.err))
        : kpi('Candidate links examined', num(edges.length),
            muted(`Every candidate link between two records, the refusals included — that is what makes the missing `
              + 'ones countable instead of invisible. Each carries the basis it was established on, or refused on.'));

      return campaignBanner
        + `<div class="${SX.g5}">${hopTile}${coverageTile}${saleTile}${revenueTile}${edgeTile}</div>

           <div class="${BANNER.info}">
             <span class="${BANNER_ICON}">hub</span>
             <div>
               ${bold('This screen never draws a link the database cannot stand behind.')}
               ${muted('An exact text match is shown as a refusal, not as a link. A column that exists and is empty is '
                 + 'shown as unknown, not as none. A hop whose table does not exist at all is shown as absent, and the '
                 + 'integration that would create it is named beside it. The green and red below are read from the '
                 + `engine&rsquo;s own <span class="${SX.mono}">is_evidence</span> flag; no severity map in this screen has `
                 + 'an opinion about any of these words.')}
             </div>
           </div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P1b · Where the enquiries themselves came from
     ══════════════════════════════════════════════════════════════════════
     The banner above says the campaign hop cannot be answered. This panel is
     the NARROWER question that CAN be: of the enquiries whose arrival NEXUS
     actually recorded, which advertising platform did each come from?

     It reads nexus_lead_attribution_summary() and re-derives nothing. Two
     properties of that function are the reason this panel is safe to show:
     the UNKNOWN bucket is emitted even at zero, so it can never quietly vanish
     from the table; and share_of_known and share_of_all are two different
     numbers, so the flattering one cannot be quoted by mistake.

     Today, on this dealership, it is expected to be almost entirely UNKNOWN,
     and that is the point of putting it on the screen. Every lead here arrived
     before the ingestion layer existed, so nothing recorded an origin for it.
     A screen that hid that would be hiding the reason the campaign hop above is
     unanswerable. ══════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Where the enquiries came from',
    sub: 'Of the enquiries whose arrival was recorded, which platform each came from &mdash; and how many were '
       + 'never recorded at all',
    load: async () => {
      const o = await settle(readOrigins());
      if (o.err) throw o.err;
      return { rows: o.v || [] };
    },
    render: ({ rows }) => {
      if (!rows.length) {
        return `<div class="${BANNER.warm}">
          <span class="${BANNER_ICON}">help</span>
          <div>${bold('Nothing came back, not even an UNKNOWN row.')}
          <div class="${SX.sub}">This function emits the UNKNOWN bucket even when it is
          empty, so an empty answer means the question could not be asked for this account rather than that there
          were no enquiries.</div></div></div>`;
      }
      const known = rows.filter(r => String(r.ad_platform || '').toUpperCase() !== 'UNKNOWN');
      const unknown = rows.find(r => String(r.ad_platform || '').toUpperCase() === 'UNKNOWN');
      const lead = !known.length
        ? `<div class="${BANNER.hot}">
             <span class="${BANNER_ICON}">error</span>
             <div>${bold('Not one enquiry has a recorded platform.')}
             <div class="${SX.sub}">Every lead this dealership holds arrived before NEXUS was
             recording where enquiries come from, so there is nothing to attribute spend against. This is the reason
             the campaign question above cannot be answered, stated as a number.</div></div></div>`
        : '';
      return lead + table([
        { label: 'Platform', render: r => String(r.ad_platform || '').toUpperCase() === 'UNKNOWN'
            ? pill('Unknown', 'unknown', { verbatim: false })
            : pill(String(r.ad_platform), 'ok', { verbatim: true }) },
        { label: 'Enquiries', align: 'r', render: r => n0(r.leads) },
        { label: 'Became a lead', align: 'r', render: r => n0(r.promoted_leads) },
        /* BOTH shares, always, side by side. Printing one would let a reader
           quote 100% of the known slice as though it were 100% of the funnel,
           which is the exact flattery the function was written to prevent. */
        { label: 'Share of those with a known platform', align: 'r',
          render: r => r.share_of_known == null ? muted('n/a') : `${esc(str(r.share_of_known))}%` },
        { label: 'Share of ALL enquiries', align: 'r',
          render: r => r.share_of_all == null ? muted('n/a') : `${esc(str(r.share_of_all))}%` },
        { label: 'What the engine says', render: r => muted(esc(str(r.note))) },
      ], rows) + (unknown
        ? muted('UNKNOWN is a real row, not a rounding remainder. It counts enquiries NEXUS holds and cannot '
              + 'attribute, which is a number worth watching go down rather than one worth hiding.')
        : '');
    },
  });

  /* ══════════════════════════════════════════════════════════════════════
     P2 · Every hop, what is true today, and what would unlock it
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'The chain hop by hop',
    sub: 'Sixteen hops, each with the state it resolves to in this dealership&rsquo;s live data, what that state is '
       + 'based on, how much of it is evidence, and the finding written against the live catalogue',
    load: async () => {
      const [m, b] = await Promise.all([settle(readMap()), settle(readBasis())]);
      if (m.err) throw m.err;
      return { m, b };
    },
    render: ({ m, b }) => {
      const F = mapFacts(m.v);
      const legend = b.err ? new Map() : basisIndex(b.v);
      if (!F.hops.length) {
        return stateEmpty('The link map returned no hops',
          'The chain is described in the database rather than in this screen, so with no rows there is nothing to '
          + 'describe and nothing is asserted about what the chain would have shown.', 'hub');
      }

      /* Tone comes from the engine's boolean, and from nothing else. `true` is
         a link this product may reason from; `false` is one it may only display
         as a refusal; anything else is left grey rather than guessed at. */
      const evidencePill = h => (h.basis_is_evidence === true
        ? pill(str(h.state), 'ok', { verbatim: true })
        : h.basis_is_evidence === false
          ? pill(str(h.state), 'hot', { verbatim: true })
          : pill(str(h.state) || 'UNKNOWN', 'unknown', { verbatim: true }));

      const rows = table([
        { label: 'Hop', strong: true, render: h =>
            wrap(`<div class="${SX.mono}">${esc(str(h.edge))}</div>`)
            + muted(`${esc(str(h.from_node))} &rarr; ${esc(str(h.to_node))}`) },
        { label: 'State', render: h => evidencePill(h)
            + muted(str(h.basis_confidence)
                ? `confidence ${esc(str(h.basis_confidence))}`
                : 'no confidence recorded for this basis') },
        { label: 'Established how', render: h => {
            const L = legend.get(up(h.basis));
            return wrap(`<div>${esc(L ? str(L.label) : str(h.basis))}</div>`)
              + muted(`<span class="${SX.mono}">${esc(str(h.basis))}</span>`
                + (L
                    ? ` &middot; ${L.is_evidence === true ? 'may be reasoned from' : 'display only — never reasoned from'}`
                    : ' &middot; this screen could not read the basis vocabulary, so what it means is not stated here')); } },
        { label: 'Coverage', align: 'r', render: h => (n0(h.coverage_pct) != null
            ? `<div>${esc(pct(h.coverage_pct))}</div>`
              + muted(`${num(h.instances_evidenced)} of ${num(h.instances_total)} `
                + `${plural(h.instances_total, 'link', 'links')}`)
            /* NOT zero. The engine says NULL here on purpose and carries its own
               sentence explaining that nothing was measured; printing 0% would
               turn "nobody counted" into "we counted none". */
            : unknownCell('NOT MEASURED', h.coverage_note)) },
        { label: 'What is true today', render: h => wrap(muted(esc(str(h.finding))
            || 'The engine records no finding for this hop.')) },
      ], F.hops);

      const unlockBlock = F.unlocks.length
        ? `<div class="${SX.note}">
             <div class="${SX.caps}">What would close each break, in the engine&rsquo;s own order of value</div>
             ${table([
               { label: 'Rank', align: 'r', strong: true, render: h => (n0(h.unlock_rank) != null
                   ? num(h.unlock_rank)
                   : `<span class="${SX.dim}">unranked</span>`) },
               { label: 'Hop', render: h => mono(h.edge) },
               { label: 'The integration that would close it', render: h => wrap(esc(str(h.unlocked_by))) },
               { label: 'Where it is measured', render: h => muted(esc(str(h.source_ref))
                   || 'The engine names no source for this hop.') },
             ], F.unlocks)}
             ${muted(`Ordered by the engine&rsquo;s own <span class="${SX.mono}">unlock_rank</span>, which is how much `
               + 'attribution each one buys — not by how easy it is. None of these is a coding task waiting on '
               + 'somebody: each is a system writing down something it already knows at the moment it knows it.')}
           </div>`
        : `<div class="${SX.note}">${muted('No hop names an integration that would unlock it. '
            + 'Either every break is closed or the map records no remedy, and this screen cannot tell those apart.')}</div>`;

      const foot = b.err
        ? `<div class="${SX.note}">${readFailed('The basis vocabulary', b.err)}</div>`
        : '';

      return rows + unlockBlock + foot;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P3 · The recorded sales, walked hop by hop
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Every recorded sale, walked',
    sub: 'Eight hops per sale. Confirmed revenue is a column of the sale record and is never attribution; margin is '
       + 'not computable and that is not the same as zero',
    /* NX1006, 21 Sep 2026. This chain has nothing to walk until a sale exists in
       purchase_history, and the only screen that writes one is Deals (via the
       Leads drawer's new "Mark deal won", or Deals' own "Record a deal"). Linked
       here rather than left implicit, same reasoning as the Inventory link
       beside it. */
    actions: linkBtn('deals', 'Record a deal') + ' ' + linkBtn('inventory', 'Open Inventory'),
    load: async () => {
      const [s, b] = await Promise.all([settle(readSale()), settle(readBasis())]);
      if (s.err) throw s.err;
      return { s, b };
    },
    render: ({ s, b }) => {
      const S = saleFacts(s.v);
      const legend = b.err ? new Map() : basisIndex(b.v);
      if (!S.sales.length) {
        return stateEmpty('No sale is on file',
          'The sale record holds no row this account can read, so there is no chain to walk. That is an empty ledger '
          + 'rather than a broken chain, and nothing is claimed about attribution either way.', 'receipt_long');
      }

      /* The jsonb chain carries a basis per hop, and attribution_link_basis says
         whether that basis is evidence. So the colour on a hop is the same fact,
         read from the same place, as the colour on the hop table above. */
      const hopPill = h => {
        const L = legend.get(up(h.basis));
        if (!L) return pill(str(h.state) || 'UNKNOWN', 'unknown', { verbatim: true });
        return pill(str(h.state) || 'UNKNOWN', L.is_evidence === true ? 'ok' : 'hot', { verbatim: true });
      };

      const detail = S.sales.map(sale => {
        const chain = Array.isArray(sale.chain) ? sale.chain : [];
        const hops = chain.length
          ? `<div class="${SX.timeline}">${chain.map(h => `<div class="${SX.tlItem}">
               <span class="${SX.tlDot}"></span>
               <div class="flex flex-col gap-1 min-w-0">
                 ${bold(`${esc(str(h.hop))} ${hopPill(h)}`)}
                 ${muted(esc(str(h.note)) || 'No note is recorded for this hop.')}
                 ${muted(`established on <span class="${SX.mono}">${esc(str(h.basis) || 'no basis recorded')}</span>`)}
               </div></div>`).join('')}</div>`
          : muted('The view returned no chain for this sale, so no hop can be shown. That is a missing explanation, '
              + 'not an unbroken chain.');

        /* The vehicle refusal, given its own block rather than a table cell.
           It is the most valuable sentence on this screen and the easiest one
           for a reader to skim past inside a row. */
        const vehicle = up(sale.vehicle_state) === 'RESOLVED'
          ? `<div class="${BANNER.info}"><span class="${BANNER_ICON}">directions_car</span>
               <div>${bold('The vehicle on this sale is identified.')}
               ${muted(esc(str(sale.vehicle_note)) || 'The engine records no note for this hop.')}</div></div>`
          : `<div class="${BANNER.warm}"><span class="${BANNER_ICON}">block</span>
               <div>
                 ${bold(`The vehicle hop is refused: ${esc(str(sale.vehicle_state) || 'UNKNOWN')}`)}
                 ${muted(esc(str(sale.vehicle_note)) || 'The engine records no reason for refusing this hop.')}
                 ${muted('A refusal is the product working. '
                   + (n0(sale.vehicle_text_candidates)
                       ? `${num(sale.vehicle_text_candidates)} ${plural(sale.vehicle_text_candidates, 'unit shares', 'units share')} `
                         + 'model words with the text on this sale, and sharing words is not being the same car. '
                       : '')
                   + 'A person can confirm the link, and until one does this stays unknown.')}
               </div></div>`;

        const facts = `<div class="${SX.g3}">
            ${kpi('Revenue', (up(sale.revenue_state) === 'CONFIRMED' && n0(sale.revenue_aed) != null)
              ? aed(sale.revenue_aed)
              : `${unknownPill(str(sale.revenue_state) || 'UNKNOWN')}`,
              muted(esc(str(sale.revenue_note)) || 'The engine records no note about this figure.'),
              (up(sale.revenue_state) === 'CONFIRMED' ? 't-won' : ''))}
            ${kpi('Gross margin', n0(sale.gross_margin_aed) != null
              ? aed(sale.gross_margin_aed)
              : `${unknownPill(str(sale.margin_state) || 'UNKNOWN')}`,
              muted(esc(str(sale.margin_note))
                || 'The engine records no reason for withholding a margin figure, which is itself a gap.'))}
            ${kpi('Hops evidenced', `${num(sale.hops_evidenced)} / ${num(sale.hops_total)}`,
              muted(str(sale.first_break)
                ? `The earliest hop that did not resolve is <span class="${SX.mono}">${esc(str(sale.first_break))}</span>.`
                : 'The engine names no first break on this chain.'))}
          </div>`;

        return `<div class="${SX.note}">
            ${bold(`${esc(maskText(str(sale.customer_name) || 'Customer not named'))} &mdash; ${esc(str(sale.vehicle_text) || 'vehicle not named')}`)}
            ${muted(`Recorded ${esc(dubaiDate(sale.purchase_date))}`
              + (sale.recorded_at ? ` &middot; entered ${esc(dubaiStamp(sale.recorded_at))}` : '')
              + (str(sale.deal_id) ? ` &middot; deal <span class="${SX.mono}">${esc(str(sale.deal_id))}</span>` : ''))}
            ${facts}
            ${vehicle}
            <div class="${SX.caps}">The chain, hop by hop</div>
            ${hops}
          </div>`;
      }).join('');

      const foot = muted(`${num(S.confirmed.length)} of ${num(S.sales.length)} `
        + `${plural(S.sales.length, 'sale carries', 'sales carry')} confirmed revenue, and `
        + (S.withMargin.length
            ? `${num(S.withMargin.length)} ${plural(S.withMargin.length, 'carries', 'carry')} a computable gross margin.`
            : 'not one carries a computable gross margin — the cost sits on an inventory unit no column ties a sale to. '
              + 'Unknown, not zero.'));

      return detail + `<div class="${SX.note}">${foot}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P4 · The same walk, forward from every lead
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Every lead, walked forward',
    sub: 'Campaign → Conversation → Vehicle → Finance → Sale → Revenue. A lead with no sale recorded is a statement '
       + 'about the records, never a statement that the person did not buy',
    actions: linkBtn('leads', 'Open Leads') + ' ' + linkBtn('leadrecovery', 'Open Lead Recovery'),
    load: () => readLeadChain(),
    render: rows => {
      const leads = rows || [];
      if (!leads.length) {
        return stateEmpty('No lead reached this engine',
          'The lead chain returned no rows, so nothing has been walked. That is an empty pipeline or a read that '
          + 'matched nothing, and this screen cannot tell those two apart.', 'person_search');
      }
      const breaks = new Map();
      leads.forEach(l => {
        const k = str(l.first_break) || 'no break recorded';
        breaks.set(k, (breaks.get(k) || 0) + 1);
      });
      const breakLine = [...breaks.entries()]
        .map(([k, n]) => `${num(n)} at <span class="${SX.mono}">${esc(k)}</span>`).join(', ');

      const body = table([
        { label: 'Lead', strong: true, render: l =>
            `<div>${esc(maskText(str(l.lead_name) || ('Lead ' + str(l.lead_id))))}</div>`
            + muted(`#${esc(str(l.lead_id))} &middot; ${esc(str(l.status) || 'no status')} &middot; `
              + `created ${esc(dubaiDate(l.created_at))}`) },
        /* Every one of these columns is written the same way on purpose: the
           engine's word for "this resolved" gets a green pill, and anything
           else gets the engine's own state word plus the engine's own reason.
           A hop that starts resolving tomorrow changes colour with no edit
           here, and one that stops never quietly renders as blank. */
        { label: 'Campaign', render: l => (up(l.campaign_state) === 'RESOLVED'
            ? pill(str(l.campaign_state), 'ok', { verbatim: true })
            : unknownCell(l.campaign_state, l.campaign_note)) },
        { label: 'Conversation', render: l => (up(l.conversation_state) === 'RESOLVED'
            ? pill(str(l.conversation_state), 'ok', { verbatim: true })
              + muted(`${num(l.conversation_messages)} ${plural(l.conversation_messages, 'message', 'messages')} `
                + `(${num(l.messages_in)} in, ${num(l.messages_out)} out)`)
            : unknownCell(l.conversation_state, l.conversation_note)) },
        { label: 'Vehicle', render: l => (up(l.vehicle_state) === 'RESOLVED'
            ? pill(str(l.vehicle_state), 'ok', { verbatim: true })
            : unknownCell(l.vehicle_state, l.vehicle_note)) },
        { label: 'Finance', render: l => (up(l.finance_state) === 'RESOLVED'
            ? pill(str(l.finance_state), 'ok', { verbatim: true })
              + muted(`${num(l.finance_quotes)} ${plural(l.finance_quotes, 'quote', 'quotes')}`)
            : unknownCell(l.finance_state, l.finance_note)) },
        { label: 'Sale', render: l => (up(l.sale_state) === 'RESOLVED'
            ? pill(str(l.sale_state), 'ok', { verbatim: true })
              + muted(`${num(l.sales_recorded)} ${plural(l.sales_recorded, 'sale', 'sales')}, `
                + `${aed(l.revenue_confirmed_aed)} confirmed`
                + (l.last_sale_date ? ` on ${esc(dubaiDate(l.last_sale_date))}` : ''))
            : unknownCell(l.sale_state, l.sale_note)) },
        { label: 'Hops', align: 'r', render: l =>
            `<div>${num(l.hops_evidenced)} / ${num(l.hops_total)}</div>`
            + muted(str(l.first_break)
                ? `breaks at <span class="${SX.mono}">${esc(str(l.first_break))}</span>`
                : 'no break recorded') },
      ], leads);

      const note = muted(`${num(leads.length)} ${plural(leads.length, 'lead', 'leads')} walked. First break: `
        + `${breakLine}. Where every lead breaks at the same hop, that is a fact about the schema rather than about `
        + 'any one customer.');

      /* The free text, shown for what it is. Two of these hold an operator note
         about a wrong number rather than a vehicle at all, and that is exactly
         why the engine refuses to read a unit out of them. */
      const interest = `<div class="${SX.note}">
          <div class="${SX.caps}">What each customer actually wrote, and why it is not a link</div>
          ${table([
            { label: 'Lead', strong: true, render: l => esc(maskText(str(l.lead_name) || ('Lead ' + str(l.lead_id)))) },
            { label: 'Vehicle interest, verbatim', render: l => wrap(str(l.vehicle_interest_text)
                ? muted(esc(str(l.vehicle_interest_text)))
                : muted('No vehicle interest text is recorded on this lead.')) },
            { label: 'Units sharing model words', align: 'r', render: l => (n0(l.vehicle_text_candidates) != null
                ? num(l.vehicle_text_candidates)
                : `<span class="${SX.dim}">not counted</span>`) },
            { label: 'Verdict', render: l => (up(l.vehicle_state) === 'RESOLVED'
                ? pill(str(l.vehicle_state), 'ok', { verbatim: true })
                : pill(str(l.vehicle_state) || 'UNKNOWN', 'hot', { verbatim: true })) },
          ], leads)}
        </div>`;

      return body + `<div class="${SX.note}">${note}</div>` + interest;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P5 · The event stream, including the events that resolve to nobody
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'The event stream',
    sub: 'Every event the graph models, with how each end was established. An event whose customer does not resolve is '
       + 'still here, with the reason — unknown is not none',
    actions: linkBtn('conversations', 'Open Conversations'),
    load: async () => {
      const [ev, b] = await Promise.all([settle(readEvents()), settle(readBasis())]);
      if (ev.err) throw ev.err;
      return { ev, b };
    },
    render: ({ ev, b }) => {
      const events = ev.v || [];
      const legend = b.err ? new Map() : basisIndex(b.v);
      if (!events.length) {
        return stateEmpty('The event stream is empty',
          'No event reached this view, so nothing is described. That is an unused system or a read that matched '
          + 'nothing, and this screen cannot tell those two apart.', 'timeline');
      }

      const unresolved = events.filter(x => x.lead_id == null);
      const withUnit   = events.filter(x => str(x.unit_id));
      const byType = new Map();
      events.forEach(x => {
        const k = str(x.event_type) || 'UNTYPED';
        const c = byType.get(k) || { n: 0, noLead: 0 };
        c.n += 1; if (x.lead_id == null) c.noLead += 1;
        byType.set(k, c);
      });

      const head = `<div class="${SX.g3}">
          ${kpi('Events read', num(events.length),
            muted('Every event this account can read, newest first. The stream is capped at 500 rows; where a '
              + 'dealership has more, the counts beside it describe the rows on this page and say so.'))}
          ${kpi('Events that resolve to no customer', num(unresolved.length),
            muted(unresolved.length
              ? `Of ${num(events.length)} read. Each one carries its own reason — usually a WhatsApp handle that `
                + 'matches no lead. These are conversations this dealership is having that no figure on any screen '
                + 'can see.'
              : 'Every event read resolves to a customer.'),
            unresolved.length ? 't-hot' : '')}
          ${kpi('Events naming a vehicle', num(withUnit.length),
            muted(withUnit.length
              ? `Of ${num(events.length)} read.`
              : 'Not one of the events read. Each carries the engine&rsquo;s own reason in the Vehicle column below, '
                + 'and it is the same missing link that makes gross margin on a sale not computable.'),
            withUnit.length ? '' : 't-hot')}
        </div>`;

      const summary = `<div class="${SX.note}">
          <div class="${SX.caps}">By event type</div>
          ${table([
            { label: 'Event', strong: true, render: r => mono(r.k) },
            { label: 'Read', align: 'r', render: r => num(r.n) },
            { label: 'Resolving to no customer', align: 'r', render: r => (r.noLead
                ? `<span class="${SX.hotTx}">${num(r.noLead)}</span>`
                : num(0)) },
          ], [...byType.entries()].map(([k, c]) => ({ k, n: c.n, noLead: c.noLead })))}
          ${muted('A zero in the right-hand column is a real count of the rows on this page: every event of that type '
            + 'resolved. It is not a claim that no such event is missing — an event nothing emits leaves no row here '
            + 'at all, and this table cannot see one.')}
        </div>`;

      const list = `<div class="${SX.note}">
          <div class="${SX.caps}">The stream, newest first</div>
          ${table([
            { label: 'When', strong: true, render: x =>
                `<div>${esc(dubaiStamp(x.occurred_at))}</div>`
                + muted(`${esc(str(x.event_type))} &middot; ${esc(str(x.actor) || 'actor not recorded')}`) },
            { label: 'Customer', render: x => (x.lead_id != null
                ? `<div>Lead #${esc(str(x.lead_id))}</div>`
                  + muted(`${esc(str(x.lead_basis))}`
                    + (str(x.lead_confidence) ? ` &middot; ${esc(str(x.lead_confidence))}` : ''))
                : unknownCell(x.lead_basis || 'UNRESOLVED', x.lead_note)) },
            { label: 'Vehicle', render: x => (str(x.unit_id)
                ? mono(x.unit_id)
                : unknownCell(x.unit_basis || 'NO_LINK_FIELD', x.unit_note)) },
            { label: 'Amount', align: 'r', render: x => (n0(x.amount_aed) != null
                ? `<div>${aed(x.amount_aed)}</div>` + muted(esc(str(x.amount_kind)))
                : `<span class="${SX.dim}">${esc(str(x.amount_kind) || 'NONE')}</span>`) },
            { label: 'Detail', render: x => wrap(muted(esc(str(x.detail).slice(0, 200))
                || 'No detail is recorded against this event.')) },
          ], events)}
        </div>`;

      const foot = b.err ? `<div class="${SX.note}">${readFailed('The basis vocabulary', b.err)}</div>` : '';
      /* legend is read for the same reason as everywhere else on this screen —
         so the words below come from the database rather than from here. */
      const legendNote = legend.size
        ? muted(`${num(legend.size)} bases are defined in this database, and the panel below prints all of them.`)
        : '';

      return head + summary + list + (legendNote ? `<div class="${SX.note}">${legendNote}</div>` : '') + foot;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P6 · The evidence vocabulary, and the provenance of this page
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'What counts as evidence here',
    sub: 'The closed list of ways a link can be established, and which of them this product is allowed to reason from',
    load: async () => {
      const [b, m, ev] = await Promise.all([settle(readBasis()), settle(readMap()), settle(readEvents())]);
      if (b.err && m.err) throw b.err;
      return { b, m, ev };
    },
    render: ({ b, m, ev }) => {
      const bases = b.err ? null : (b.v || []);
      const F = m.err ? null : mapFacts(m.v);
      const events = ev.err ? null : (ev.v || []);

      const legendTable = bases == null
        ? `<div class="${SX.note}">${readFailed('The basis vocabulary', b.err)}</div>`
        : table([
            { label: 'Basis', strong: true, render: k =>
                wrap(`<div>${esc(str(k.label))}</div>`) + muted(`<span class="${SX.mono}">${esc(str(k.basis))}</span>`) },
            { label: 'Evidence?', render: k => (k.is_evidence === true
                ? pill('May be reasoned from', 'ok', { verbatim: false })
                : k.is_evidence === false
                  ? pill('Display only', 'hot', { verbatim: false })
                  : pill('Not stated', 'unknown', { verbatim: false })) },
            { label: 'Default confidence', render: k => pill(str(k.default_confidence) || 'NONE', '', { verbatim: true }) },
            { label: 'What it means', render: k => wrap(muted(esc(str(k.description))
                || 'No description is recorded for this basis.')) },
          ], bases, {
            empty: stateEmpty('The basis vocabulary is empty',
              'Nothing defines what counts as evidence here, so every state word on this screen is unexplained. That '
              + 'is a missing reference table, not a finding about attribution.', 'menu_book'),
          });

      /* ── The provenance strip ───────────────────────────────────────────
         Evidence, confidence, coverage, unknown, last updated, tenant, action —
         each read from something rather than asserted here. The tenant line
         comes from lib/tenant.js, which reads the caller's own membership in
         the order the database resolves it; RLS is what scopes the rows, and
         this line only names the dealership those rows belong to. */
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

      const latest = events && events.length ? events[0].occurred_at : null;

      const strip = [
        ['Evidence', F
          ? `${num(F.evidenced.length)} of ${num(F.hops.length)} hops can carry evidence at all; `
            + `${num(F.asEvidence)} of ${num(F.instances)} measured candidate links are evidence rather than a `
            + `recorded refusal. Read from <span class="${SX.mono}">The links between actions and sales</span> and `
            + `<span class="${SX.mono}">attribution_link_basis</span>.`
          : 'The link map could not be read, so nothing is claimed about evidence on this page.'],
        ['Confidence', bases && bases.length
          ? `Every link carries the default confidence of its basis: ${esc(bases.map(k => str(k.default_confidence))
              .filter((v, i, a) => v && a.indexOf(v) === i).join(', ') || 'none recorded')}. `
            + 'A basis that is not evidence carries NONE by constraint — nothing is asserted, so no strength can be '
            + 'attached to it.'
          : 'The basis vocabulary could not be read, so the confidence attached to each link is not stated here.'],
        ['Data coverage', F
          ? `${num(F.measured.length)} of ${num(F.hops.length)} hops were measured against live rows. `
            + `The other ${num(F.unmeasured.length)} report coverage UNKNOWN with a reason, never 0%.`
          : 'Not established — the link map could not be read.'],
        ['Unknown', F && F.campaign
          ? 'Which marketing channel produced any of this revenue. There is no campaigns table in this database, so '
            + 'the question has no answer at any confidence and none is offered.'
          : 'Not established on this render.'],
        ['Last updated', latest
          ? `Newest event in the stream: ${esc(dubaiStamp(latest))}. These views are computed on read, so every figure `
            + 'above is as of the moment this panel loaded.'
          : 'No event carries a timestamp on this render, so the freshness of these figures is not stated.'],
        ['Tenant', tenantLine],
        ['Action', F && F.firstUnlock
          ? `Highest-value break to close: <span class="${SX.mono}">${esc(str(F.firstUnlock.edge))}</span> — `
            + esc(str(F.firstUnlock.unlocked_by))
          : 'No unlock is ranked on this render, so no next step is named.'],
      ];

      const stripHtml = `<div class="${SX.note}">
          <div class="${SX.caps}">Where this page stands</div>
          <dl class="${SX.kv}">${strip.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
        </div>`;

      return legendTable + stripHtml;
    },
  }).then(wireGo);

  root.insertAdjacentHTML('beforeend', engineFooter({
    source: 'v_attribution_link_map · v_attribution_sale_chain · v_attribution_lead_chain · v_attribution_events · rpc/nexus_lead_attribution_summary',
    evidence: 'Links drawn only where attribution_link_basis marks the basis as evidence',
  }));
};
