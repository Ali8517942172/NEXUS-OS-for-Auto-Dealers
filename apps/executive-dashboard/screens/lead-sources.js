/* NEXUS OS — screens/lead-sources.js
   LEAD SOURCES. Where this dealership's enquiries came from, how much of that
   origin NEXUS could actually verify, and what happened to each arrival after
   it landed.

   ═══════════════════════════════════════════════════════════════════════════
   WHY A SCREEN, WHEN LEADS ALREADY EXISTS
   ═══════════════════════════════════════════════════════════════════════════
   screens/leads.js is about PEOPLE — who enquired, who owns them, what state
   they are in. This screen is about the DOOR they came through, and it answers
   three questions no other screen in the app asks:

     1. Did this arrival actually come from who it says it came from?
        A lead authenticated by a secret sitting in the body of a request is not
        the same fact as one carrying a signature computed over the exact bytes
        that were sent. The first proves that somebody knows a secret. The
        second proves who sent it. `origin_strength` is the database's own
        measure of that distance, and rendering 30 and 90 identically is how a
        dashboard turns a guess into evidence. So the attestation is shown
        WHEREVER a source is shown, never as a footnote, and never averaged: a
        source is displayed at its WEAKEST arrival, because an average would
        invent a number no arrival carried and would hide the one that carried
        nothing.

     2. Did anything arrive and then get lost?
        EXPIRED, QUARANTINED and REJECTED are enquiries this dealership HAD.
        Each carries a reason and each is rendered as a loss with that reason
        attached. "0 leads today" and "4 leads arrived and every one of them
        expired" are opposite facts, and a bucket showing zero cannot tell them
        apart.

     3. Which sources produce nothing because they are quiet, and which produce
        nothing because nobody ever connected them?
        This is the whole reason the readiness accessor exists, and until
        7 Sep 2026 this screen got it WRONG in the one direction that misleads.
        It read `lead_source_catalogue.integration_status` and rendered
        AVAILABLE as a green "Connected" pill with the sentence "this source can
        hand NEXUS an enquiry directly, and anything counted under it below
        arrived that way". AVAILABLE answers a COMMERCIAL question — does the
        provider publish a contract somebody could implement — and eight of the
        nine seeded sources carry it. Not one of them was connected: there is no
        receiver of any kind in this product and the endpoint register holds no
        rows on either database. So a paying dealership was shown eight working
        integrations having a quiet week, which is the exact reading this panel
        was built to prevent, printed by the panel itself.

        The state is now computed in the database, per dealership, from what is
        actually registered to it, and this screen RENDERS it rather than
        deriving it: one branch per value, no second path to a positive
        treatment, and no column anywhere else on the screen allowed to produce
        the word "connected". `provider_route` carries the old value and is
        shown as a sentence about the PROVIDER, never as a state and never with
        a tone.

   ═══════════════════════════════════════════════════════════════════════════
   THE FOUR RULES THIS SCREEN IS BUILT AROUND — they are the screen, not
   decoration on it
   ═══════════════════════════════════════════════════════════════════════════
   · TEST TRAFFIC IS NEVER ADDED INTO A HEADLINE. The test-traffic marking
     splits the rows THREE ways, not two: true is simulator output and goes in a
     band of its own, false is business, and an absent marking is neither —
     counting an unclassified arrival as business inflates the number a
     dealership acts on, and counting it as test hides a real enquiry. All three
     counts are stated.

   · AN EMPTY RESULT IS NOT AN ALL-CLEAR. Every panel distinguishes "no enquiry
     arrived" from "nothing could be read", and the second never renders in a
     green state. screens/team.js states the rule this follows: nothing could be
     checked here is not an all-clear.

   · A STATE THIS SCREEN DOES NOT KNOW IS A FAULT, NOT A BLANK. The stage an
     arrival reached and whether NEXUS can receive from its source are closed
     sets the database owns. lib/vocabulary.js returns null for a value outside
     them and the branches below say so out loud, because a state nobody
     recognises decides whether an arrival is a loss, a duplicate or a lead that
     made it through.

   · NO MONEY, ANYWHERE ON THIS SCREEN. Nothing in this database records what an
     enquiry was worth. A currency figure on a lost lead would be fabricated,
     and PRODUCT.md's rule about never inventing a monetary impact does not
     soften because the number would be a sad one.

   ═══════════════════════════════════════════════════════════════════════════
   WHAT IS DELIBERATELY NOT HERE
   ═══════════════════════════════════════════════════════════════════════════
   No endpoint, no key, no signing header, no automation node name, no raw
   payload. The view exposes none of it, and none of it is reintroduced from
   anywhere else: how an arrival is authenticated is NEXUS's mechanism, and the
   dealership's half is how well attested the result is and what that means —
   which is the origin strength and the explanation the view carries, both
   written for exactly this reading. Schema identifiers stay off the screen for
   the reason lib/vocabulary.js exists; the nouns come from there.

   ═══════════════════════════════════════════════════════════════════════════
   WHERE EVERYTHING COMES FROM — nothing below is computed in this file
   ═══════════════════════════════════════════════════════════════════════════
     v_lead_origin            one row per arrival: the source and its display
                              name, the channel family, what stage the arrival
                              reached, the reason if it went no further, whether
                              a signature was checked, how strongly the origin is
                              attested and why, and whether it is test traffic.
     nexus_lead_source_readiness()
                              one row per source set up for this dealership,
                              carrying the CONNECTION STATE computed from what is
                              actually registered to it — so that a source which
                              has produced nothing can be told apart from one
                              nobody ever connected, and so that neither is
                              inferred here. It also carries `provider_route`,
                              which is the provider's half and drives nothing.

   `v_lead_origin.integration_status` is deliberately NOT selected. It is the
   same provider-side value under a name that reads operationally, and the only
   way it stops being read as a connection is for it not to be here.

   Both are tenant-scoped and read as the signed-in user. Nothing here filters
   by dealership — the database refuses another dealership's rows, this file
   does not hide them. */

import { db, dbWrite, onIdentityChange, canManageAccess } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { ago, dubaiStamp, esc, n0, num } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { closeDrawer } from '../lib/ui.js';
/* The Stitch migration (7 Oct 2026, design/stitch/MAP.md: primary
   lead-sources-ingestion-readiness-desk--c3ca1e, also --1ce809). Every renderer
   below — kpi, table, panel, pill, the state panels, openModal — keeps its old
   signature and now answers in the Stitch anatomy; lib/ops-kit.js says why the
   logic was left exactly where it was. */
import {
  actor, B, C, banner, bold, chip, hot, kpi, muted, openModal, panel, pill, readinessChecklist, readinessVerdict,
  stateEmpty, stateError, stateLoading, table, unreadPanel, wrap, openDrawer, DRAWER,
} from '../lib/ops-kit.js';
import { sectionHeader, statusChip, trustFooter } from '../lib/stitch-ui.js';
import {
  CONNECTION_IS_ABOUT_THIS_DEALERSHIP, CONNECTION_STATE_MISSING, CONNECTION_STATE_NOT_KNOWN,
  CONNECTION_STATE_UNREAD, LOSS_IS_NOT_ABSENCE, NO_MONEY_ON_LEAD_SOURCES, NO_REASON_RECORDED,
  ORIGIN_STRENGTH_NOT_STATED, ORIGIN_STRENGTH_SCALE, PROVIDER_ROUTE_IS_NOT_A_CONNECTION,
  PROVIDER_ROUTE_LABEL, SOURCE_IS_AS_ATTESTED_AS_ITS_WEAKEST,
  TEST_TRAFFIC_BAND, TEST_TRAFFIC_EXCLUDED, TEST_TRAFFIC_UNCLASSIFIED,
  CONNECTION_STATE, connectionState, leadPhase, noLeadFeedSentence, originBand, providerRoute,
} from '../lib/vocabulary.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const plural = (c, one, many) => (Number(c) === 1 ? one : many);

/* A read that failed, said where the figure would have been. Never a bare dash:
   a dash beside "Enquiries that arrived" reads as zero, and zero is a finding
   this screen makes on purpose and must be able to make credibly. */
const readFailed = (what, err) =>
  hot(`${esc(what)} could not be read (${esc(str(err && err.message) || 'no reason given')}), so nothing is claimed `
    + 'here and nothing is ruled out. An unread check is not a clear one.');

/* ── The memo is per RENDER, not per page load ─────────────────────────────
   Six panels share two reads. Without a memo one visit issues twelve requests;
   with a module-scoped one that is never cleared, a second visit issues none
   and re-renders the previous answer under a caption saying it was re-read —
   and, worse, lib/data.js records that module state survives the re-auth path
   which does not reload the page, so a second dealership signing in on the same
   machine would be shown the first one's sources. screens/money-leaks.js
   carries the full account of that defect. So the memo lives for one render:
   resetReads() runs at the top of the mount function, and again whenever the
   signed-in identity changes. The two events are not the same and only one of
   them is under this file's control, which is why both are wired. */
const MEMOS = new Set();
const shared = make => {
  let p = null;
  const f = () => {
    if (!p) { p = make(); p.catch(() => { p = null; }); }
    return p;
  };
  MEMOS.add(() => { p = null; });
  return f;
};
const resetReads = () => { MEMOS.forEach(reset => reset()); };
onIdentityChange(resetReads);
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));

const linkBtn = (id, label) => (SCREENS[id]
  ? `<button class="${B.secondary}" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="${B.ghost}" disabled title="${esc(label)} is not part of this build: the navigation offers the screen and no module in this bundle registers it.">${esc(label)} — not in this build</button>`);
const wireGo = card => {
  card.querySelectorAll('[data-go]').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => go(b.dataset.go));
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   Reads
   ══════════════════════════════════════════════════════════════════════════
   The arrivals read is CAPPED, and the cap is a fact about every number on this
   screen rather than an implementation detail: newest first, so what is shown
   is the most recent window and not the whole history. When the cap is reached
   the counts below are floors, and the panel that lists what could not be
   measured says so with the number in it. A screen that silently truncates and
   then prints a total is stating a figure it did not measure.

   Columns are named rather than `*` because this view is a published contract
   and a hand-typed list is what lets the quality gate check every name against
   the live catalogue. */
const ARRIVALS_LIMIT = 1000;
const readOrigin = shared(() => db('v_lead_origin?select=event_id,source_key,source,channel_family,'
  + 'phase,disposition_reason,received_at,occurred_at,lead_id,'
  + 'origin_cryptographically_verified,origin_strength,origin_explanation,is_test_traffic'
  + `&order=received_at.desc&limit=${ARRIVALS_LIMIT}`));

/* WHETHER NEXUS IS RECEIVING, ANSWERED BY THE DATABASE.

   This replaces a read of `lead_source_catalogue`, and the replacement is the
   fix rather than a refactor of it. The catalogue is the PROVIDER register: it
   says what each source publishes, and it is byte-identical at every
   dealership. It cannot answer whether THIS dealership is wired up, and the
   column that was made to answer it — `integration_status` — said AVAILABLE for
   eight sources that were connected to nothing.

   `nexus_lead_source_readiness()` is a SECURITY DEFINER accessor scoped to the
   caller's own dealership(s), because the register it counts is off the dealer
   plane entirely. It returns `connection_state` already computed, precisely so
   that this screen has nothing left to infer — and so there is no longer any
   column on this page from which a connection could be inferred. */
const readReadiness = shared(() => db('rpc/nexus_lead_source_readiness'));

/* ══════════════════════════════════════════════════════════════════════════
   The three-way split on test traffic
   ══════════════════════════════════════════════════════════════════════════
   Two buckets would be a bug. The marking is a boolean that can also be absent,
   and an absent one is not a false: counting it as business inflates the number
   a dealership acts on, and counting it as test hides a real enquiry. Three
   buckets, all three stated, and the headline uses only the first. */
function splitTraffic(rows) {
  const all = Array.isArray(rows) ? rows : [];
  return {
    all,
    business:     all.filter(r => r.is_test_traffic === false),
    test:         all.filter(r => r.is_test_traffic === true),
    unclassified: all.filter(r => r.is_test_traffic !== true && r.is_test_traffic !== false),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Per-source aggregation
   ══════════════════════════════════════════════════════════════════════════
   Everything a source line needs, computed once. Note what is NOT computed: no
   average strength, no percentage of "good" arrivals, no score. The weakest
   arrival and the spread are facts; a mean of them is a number nothing
   produced. */
function bySource(rows) {
  const map = new Map();
  (rows || []).forEach(r => {
    const key = str(r.source_key);
    const id = key || str(r.source) || 'source-with-no-name';
    let a = map.get(id);
    if (!a) {
      a = { id, key, name: str(r.source), channels: new Set(),
            events: 0, phases: new Map(), unknownPhase: 0, promoted: 0, duplicate: 0, lost: 0,
            strengths: [], noStrength: 0, verified: 0, unverified: 0, verifyUnknown: 0,
            explains: new Map(), lastAt: null, leadLinked: 0 };
      map.set(id, a);
    }
    a.events += 1;
    if (!a.name && str(r.source)) a.name = str(r.source);
    if (str(r.channel_family)) a.channels.add(str(r.channel_family));

    /* Partitioned on the vocabulary the database owns. A stage outside it is
       counted as unknown rather than dropped, so it cannot quietly reduce a
       total or, worse, be absorbed into one of the outcomes that reads well. */
    const phaseKey = up(r.phase) || 'NOT RECORDED';
    a.phases.set(phaseKey, (a.phases.get(phaseKey) || 0) + 1);
    const ph = leadPhase(r.phase);
    if (!ph) a.unknownPhase += 1;
    else if (ph.kind === 'LOST') a.lost += 1;
    else if (ph.kind === 'DUPLICATE') a.duplicate += 1;
    else if (up(r.phase) === 'PROMOTED') a.promoted += 1;

    const s = n0(r.origin_strength);
    if (s == null) a.noStrength += 1; else a.strengths.push(s);
    if (r.origin_cryptographically_verified === true) a.verified += 1;
    else if (r.origin_cryptographically_verified === false) a.unverified += 1;
    else a.verifyUnknown += 1;

    /* Explanations are kept against the WEAKEST arrival that carried them, so
       the line a reader sees beside a source explains its worst attestation
       rather than whichever row happened to be read first. 101 is above the
       scale on purpose: an explanation on an arrival with no strength at all
       sorts last and is shown only when nothing better exists. */
    const ex = str(r.origin_explanation);
    if (ex) {
      const at = s == null ? 101 : s;
      const held = a.explains.has(ex) ? a.explains.get(ex) : 102;
      if (at < held) a.explains.set(ex, at);
    }

    if (str(r.lead_id)) a.leadLinked += 1;
    const when = r.received_at || r.occurred_at;
    if (when && (!a.lastAt || Date.parse(when) > Date.parse(a.lastAt))) a.lastAt = when;
  });
  return [...map.values()].sort((x, y) => y.events - x.events);
}

const sourceLabel = a => a.name || a.key || 'A source that arrived without a name';

/* ══════════════════════════════════════════════════════════════════════════
   Attestation — the cell that must never render two different origins alike
   ══════════════════════════════════════════════════════════════════════════ */
function attestationCell(a) {
  if (!a.strengths.length) {
    return pill('Not stated', 'unknown', { verbatim: false })
      + muted(esc(ORIGIN_STRENGTH_NOT_STATED))
      + (a.events > 1 ? muted(`None of the ${num(a.events)} arrivals from this source records one.`) : '');
  }
  const min = Math.min(...a.strengths);
  const max = Math.max(...a.strengths);
  const band = originBand(min);
  /* The weakest explanation the source carried. It is the view's own sentence,
     shown rather than paraphrased — a paraphrase is a second copy of a fact
     that drifts the first time the view is edited. */
  const explains = [...a.explains.entries()].sort((x, y) => x[1] - y[1]);
  const why = explains.length ? explains[0][0] : '';

  const sig = a.verified === a.events
    ? 'Every arrival carried a signature that was checked.'
    : a.verified === 0 && a.verifyUnknown === 0
      ? 'No arrival from this source carried a signature to check.'
      : a.verified === 0
        ? `No arrival from this source carried a checked signature, and ${num(a.verifyUnknown)} `
          + `${plural(a.verifyUnknown, 'does', 'do')} not record whether one was checked.`
        : `${num(a.verified)} of ${num(a.events)} arrivals carried a checked signature`
          + (a.verifyUnknown
              ? `, and ${num(a.verifyUnknown)} ${plural(a.verifyUnknown, 'does', 'do')} not record whether one was checked.`
              : '.');

  return `<div class="font-semibold font-label-numeric-sm" title="${esc(why || band.blurb)}">${esc(String(min))}/100`
    + `${min !== max ? ` <span class="font-body-sm text-body-sm text-on-surface-variant font-normal">weakest, up to ${esc(String(max))}/100</span>` : ''}</div>`
    + `<div class="mt-1">${pill(band.label, band.tone, { verbatim: false })}</div>`
    + muted(esc(why || band.blurb))
    + (min !== max
        ? muted(`Arrivals from this source were not all attested the same way. ${esc(SOURCE_IS_AS_ATTESTED_AS_ITS_WEAKEST)}`)
        : '')
    + muted(esc(sig))
    + (a.noStrength
        ? muted(`${num(a.noStrength)} ${plural(a.noStrength, 'arrival states', 'arrivals state')} no strength at all and `
            + `${plural(a.noStrength, 'is', 'are')} outside the range above — not counted as weak and not as strong.`)
        : '');
}

/* The same fact for a single arrival, small enough to sit inside a loss row. */
function attestationInline(r) {
  const s = n0(r.origin_strength);
  const band = originBand(s);
  if (!band) return pill('Attestation not stated', 'unknown', { verbatim: false });
  const why = str(r.origin_explanation) || band.blurb;
  return `<span title="${esc(why)}">${pill(`${band.label} · ${s}/100`, band.tone, { verbatim: false })}</span>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   What happened to a source's arrivals, as counts nobody has to interpret
   ══════════════════════════════════════════════════════════════════════════
   Rendered from the stage map so that a value outside the vocabulary appears as
   itself, marked, rather than vanishing into a total. */
function phaseCells(a) {
  const known = [];
  const unknown = [];
  [...a.phases.entries()].sort((x, y) => y[1] - x[1]).forEach(([k, c]) => {
    const ph = leadPhase(k);
    if (ph) known.push(`<span title="${esc(ph.blurb)}">${pill(`${ph.label} · ${c}`, ph.tone, { verbatim: false })}</span>`);
    else unknown.push('<span title="This screen has no wording for that stage, so it is shown exactly as recorded and counted as nothing.">'
      + `${pill(`${k} · ${c}`, 'unknown', { verbatim: true })}</span>`);
  });
  return `<div class="flex flex-wrap gap-1.5">${known.concat(unknown).join('')}</div>`
    + (a.unknownPhase
        ? hot(`${num(a.unknownPhase)} ${plural(a.unknownPhase, 'arrival is', 'arrivals are')} at a stage this screen `
            + `does not know. ${plural(a.unknownPhase, 'It is', 'They are')} counted as ${plural(a.unknownPhase, 'an arrival', 'arrivals')} `
            + 'and as nothing else — not as lost, not as duplicates and not as enquiries.')
        : '');
}

/* ══════════════════════════════════════════════════════════════════════════
   Whether NEXUS is receiving from this source — RENDERED, never derived
   ══════════════════════════════════════════════════════════════════════════
   One branch per value of `connection_state`, and no extra branch that guesses.
   The set of values is `CONNECTION_STATE` in lib/vocabulary.js and nothing here
   hardcodes how many there are — that sentence used to say "four", and the day
   the database learned a fifth word it was a caption asserting the opposite of
   the branch it sat in.
   Three things are load-bearing here and each of them is the defect this
   replaces, stated as code:

     · ONLY `CONNECTED` MAY BE POSITIVE. The tone comes from the vocabulary
       entry and nothing else on this screen produces an `ok` tone for a source.
       There is no expression anywhere below of the form "if some other column
       looks encouraging, show green".
     · SIMULATION_ONLY IS NOT A SHADE OF CONNECTED. Different word, different
       tone, and a sentence that says outright that nothing real arrives.
     · NOT_CONNECTED IS NEUTRAL. It is not a warning and not a fault — nobody
       has done anything wrong by not having connected a source yet, and a red
       row would be this screen inventing an alarm.

   A value this screen does not know, or a source absent from the readiness
   answer, is a stated unknown. Neither is filled in from the provider column,
   and an unknown state is deliberately NOT rendered as a neutral or a hopeful
   one: the FAULT row further down names it, because an unreadable state might
   be an unconnected source being shown as working. That is how this screen
   behaves correctly while it is a deploy behind the database. */
function connectionCell(rd) {
  if (!rd) return hot(esc(CONNECTION_STATE_MISSING));
  const st = connectionState(rd.state);
  if (!st) {
    return hot(esc(CONNECTION_STATE_NOT_KNOWN))
      + muted(`The value recorded against it is “${esc(rd.state || 'nothing at all')}”, shown exactly as it stands.`);
  }
  /* A connected source with nothing live registered under it is two facts that
     cannot both be true. It is reported rather than resolved: picking whichever
     one reads better is how a screen starts deciding, which is the whole habit
     being removed here. */
  const contradiction = st.receiving && rd.endpoints === 0
    ? hot('This source is recorded as connected while nothing live is registered under it. Those cannot both be '
        + 'true, so neither is being relied on here.')
    : '';
  return `<div>${pill(st.label, st.tone, { verbatim: false })}`
    + `${st.roadmap ? ' ' + chip('roadmap', 'Not a working connection today. Shown as roadmap so that an empty row under it is never read as a quiet source.') : ''}</div>`
    + muted(esc(st.blurb))
    + contradiction
    /* NOT_CONNECTABLE gets the roadmap sentence INSTEAD of the provider line,
       not as well as: that sentence already says everything the provider line
       would, in wording written for this exact case, and printing both makes a
       reader hunt for the difference between two paragraphs that have none. */
    + (rd.state === 'NOT_CONNECTABLE'
        ? muted(esc(noLeadFeedSentence(rd.name || rd.key)))
        : providerLine(rd));
}

/* The provider's half. A SENTENCE, never a pill, never a tone, and labelled at
   the point of reading so a reader who never saw the banner still cannot take
   it for the state above it. Nothing branches on it. */
function providerLine(rd) {
  const sentence = providerRoute(rd.route);
  if (!sentence) return '';
  return muted(`<span class="font-semibold">${esc(PROVIDER_ROUTE_LABEL)}</span> ${esc(sentence)}`);
}

/* `evidence_note` IS READ AND DELIBERATELY NOT RENDERED, and that is a decision
   rather than an omission. It is free text this screen did not write, produced
   by an accessor over a register that is off the dealer plane entirely — the
   one place in this product where endpoint identifiers, key references and
   environment names live. "No endpoint, no key, no signing header, no
   automation node name" is the rule at the top of this file, and it is not a
   rule that can be enforced by hoping the sentence is tame: `plain()` strips
   suppliers, URLs and schema nouns, and would pass "the production endpoint for
   this source was revoked" through untouched. The state and its own wording say
   everything a dealership can act on. If a note is ever wanted on this screen,
   the honest route is a column whose vocabulary is closed, the way
   `connection_state` is — not this one. It stays on the row object so the next
   reader finds this note rather than the column. */

/* ══════════════════════════════════════════════════════════════════════════
   The readiness answer, read defensively
   ══════════════════════════════════════════════════════════════════════════
   The accessor declares its result type, so the field names are read directly
   rather than guessed at from a list of candidates — that guessing existed
   because the catalogue's shape was undeclared, and it is exactly how a column
   nobody meant to render ended up rendered. A row that yields no source key is
   still reported as a fault rather than dropped: a source nobody can account
   for is the one worth naming. */
function readinessRows(rows) {
  const usable = [];
  let unreadable = 0;
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const key = str(r && r.source_key);
    if (!key) { unreadable += 1; return; }
    usable.push({
      key,
      name: str(r.display_name),
      channel: str(r.channel_family),
      state: up(r.connection_state),
      route: up(r.provider_route),
      endpoints: n0(r.active_endpoints),
      note: str(r.evidence_note),
    });
  });
  return { usable, unreadable, byKey: new Map(usable.map(x => [x.key, x])) };
}

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   Connect your lead sources — owner/admin self-service
   ══════════════════════════════════════════════════════════════════════════
   One card per source from rpc/nexus_lead_source_connections. Every write goes
   through a SECURITY DEFINER RPC that re-checks the role server-side
   (NX_LS_OWNER_ONLY); the disabled buttons here are courtesy, not the gate.
   A secret is shown exactly once — from the connect/rotate response — and is
   never re-read: the list only says whether one exists (has_secret). */
const EMBED_SCRIPT_URL = 'https://nexus-os-dashboard-six.vercel.app/embed/nexus-lead-form.js';
const META_WEBHOOK_URL = 'https://35.224.126.225.nip.io/webhook/meta-lead-ads';
const META_TEST_TOOL = 'https://developers.facebook.com/tools/lead-ads-testing';
const LS_ERRORS = {
  NX_LS_OWNER_ONLY: 'Only an owner or admin of this dealership can connect or change lead sources.',
  NX_LS_PAGE_TAKEN: 'That Facebook Page is already connected to another dealership in NEXUS. If it is yours, contact support.',
  NX_LS_PAGE_ID_REQUIRED: 'A Facebook Page ID is required.',
  NX_LS_DOMAIN_INVALID: 'One of those domains is not valid. Use plain domains like example.ae or www.example.ae — no https:// and no paths.',
  NX_LS_UNKNOWN_SOURCE: 'NEXUS does not recognise that lead source. Refresh the page and try again.',
  NX_LS_PAGE_ON_OTHER_META_SOURCE: 'This Facebook Page is already connected on the other Meta card. Instagram lead ads arrive through your Facebook Page connection, so connect the Page once.',
  NX_LS_TOKEN_REQUIRED: 'Paste the full Page or System User access token (with leads_retrieval) so NEXUS can fetch each lead.',
  NX_LS_NOT_CONNECTED: 'This lead source is not connected yet. Connect it first.',
  NX_LS_NO_CREDENTIAL: 'No key or token is installed for this lead source. Connect it again to install one.',
  NX_LS_NO_TENANT: 'Your account is not a member of an active dealership, so nothing can be connected.',
  NX_LS_KEY_COLLISION: 'NEXUS could not create a unique key for this source. Try again.',
  NX_LS_NO_SECRET_TO_ROTATE: 'Only the Google Ads lead form has a NEXUS key to rotate.',
};
const IG_NOTE = 'Instagram lead ads arrive through your Facebook Page connection.';
const lsErrorText = e => {
  const blob = [e && e.message, e && e.technical, e && e.detail, e && e.code].map(str).join(' ');
  const code = Object.keys(LS_ERRORS).sort((x, y) => y.length - x.length).find(c => blob.includes(c));
  return code ? LS_ERRORS[code] : (str(e && e.message) || 'Something went wrong. Nothing was changed.');
};
const lsFail = (m, e) => m.msg(`<span class="${C.hot}">${esc(lsErrorText(e))}</span>`);
const LS_STATUS = {
  NOT_CONNECTED: ['Not connected', 'unknown'],
  DISABLED: ['Disabled', 'cold'],
  WAITING_FOR_FIRST_LEAD: ['Waiting for first lead', 'warm'],
  RECEIVING: ['Receiving', 'ok'],
};
const lsStatus = r => {
  const s = up(r.status);
  const [label, t] = LS_STATUS[s] || [str(r.status) || 'Unknown', 'unknown'];
  let extra = '';
  if (s === 'RECEIVING') {
    const n = Number(r.events_total) || 0;
    extra = ` — ${num(n)} ${plural(n, 'lead', 'leads')}${r.last_event_at ? `, last at ${dubaiStamp(r.last_event_at)}` : ''}`;
  }
  return pill(label + extra, t, { verbatim: true });
};
/* The glyph on a source card (lead-sources-ingestion-connectivity--1ce809). A
   picture of the kind of door, chosen from the source key; never a state. */
const LS_ICON = {
  walk_in: 'storefront', phone_call: 'call', meta_lead_ads_facebook: 'campaign', meta_lead_ads_instagram: 'photo_camera',
  google_ads_lead_form: 'ads_click', website_form: 'language', whatsapp: 'chat', dubizzle: 'directions_car',
};
const lsIcon = r => LS_ICON[str(r && r.source_key)] || (str(r && r.connect_kind) === 'manual' ? 'edit_note' : 'hub');
const copyBtn = (value, label = 'Copy') =>
  `<button class="${B.secondary}" type="button" data-copy="${esc(value)}">${esc(label)}</button>`;
const copyField = (label, value, copyLabel) => `<div class="${C.field}"><label class="${C.label}">${esc(label)}</label>
    <div class="flex flex-wrap items-start gap-2">
      <code class="${C.code} flex-1 min-w-[220px]">${esc(value)}</code>
      ${copyBtn(value, copyLabel)}</div></div>`;
const wireCopy = root => root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
  const v = b.dataset.copy;
  try { await navigator.clipboard.writeText(v); }
  catch (_) {
    const t = document.createElement('textarea'); t.value = v; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (__) { /* ignore */ } t.remove();
  }
  const old = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = old; }, 1500);
}));
const embedSnippet = key => `<script src="${EMBED_SCRIPT_URL}" data-nexus-key="${key}" async></script>\n<div id="nexus-lead-form"></div>`;
const plainFormSnippet = url => `<form method="POST" action="${url}">\n  <input type="hidden" name="submission_id">\n  <input name="name" placeholder="Name" required>\n  <input name="phone" placeholder="Phone" required>\n  <input name="email" type="email" placeholder="Email">\n  <textarea name="message" placeholder="Which car are you interested in?"></textarea>\n  <button type="submit">Send</button>\n</form>\n<script>document.currentScript.previousElementSibling.submission_id.value = crypto.randomUUID();</script>`;
const GOOGLE_STEPS = `<ol class="list-decimal ml-5 mt-2 space-y-1 font-body-sm text-body-sm text-on-surface">
    <li>In Google Ads open <b>Assets → Lead form</b> and edit your lead form.</li>
    <li>Go to <b>Lead delivery → Webhook integration</b>.</li>
    <li>Paste the <b>Webhook URL</b> and the <b>Key</b> shown here.</li>
    <li>Click <b>Send test data</b> — this card switches to “Receiving” when it lands.</li></ol>`;
const META_HELP = `<div class="font-body-sm text-body-sm text-on-surface-variant mb-3 whitespace-normal">
    Get the token in <b>Meta Business Settings → System users → Generate token</b> with the permissions
    <code>pages_manage_metadata</code>, <code>leads_retrieval</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>.
    The Page must also be subscribed to the NEXUS app (webhook <code>${esc(META_WEBHOOK_URL)}</code>, field <code>leadgen</code>).
    Test with Meta’s Lead Ads Testing Tool:
    <a href="${esc(META_TEST_TOOL)}" target="_blank" rel="noopener noreferrer">${esc(META_TEST_TOOL)}</a></div>`;

function mountSourceConnections(host, onChange) {
  const card = el('section', C.card);
  card.id = 'lsConnect';
  host.appendChild(card);
  const canConnect = canManageAccess();
  const NO_ROLE = ' disabled title="Connecting lead sources is an owner/admin decision at this dealership."';
  const gate = canConnect ? '' : NO_ROLE;
  let rows = null, loadErr = null;
  const head = `<div class="${C.head}"><div class="flex items-start gap-2.5 min-w-0">
      <span class="material-symbols-outlined text-primary text-xl mt-0.5">add_link</span>
      <div class="min-w-0"><h2 class="${C.title}">Connect your lead sources</h2>
      <p class="${C.sub}">Owner/admin only. Connect each place your enquiries come from — leads then arrive in
      NEXUS on their own. Keys and tokens are shown once, or never.</p></div></div></div>`;

  const actions = r => {
    const s = up(r.status), k = str(r.connect_kind), key = esc(r.source_key);
    const connected = s && s !== 'NOT_CONNECTED';
    if (k === 'manual') return '';
    const b = [];
    if (!connected || s === 'DISABLED') b.push(`<button class="${B.primary}" data-ls-connect="${key}"${gate}>Connect source</button>`);
    if (connected && k === 'webhook_key') b.push(`<button class="${B.secondary}" data-ls-rotate="${key}"${gate}>Rotate key</button>`);
    if (connected && k === 'meta_page') b.push(`<button class="${B.secondary}" data-ls-connect="${key}"${gate}>Replace token</button>`);
    if (connected && k === 'embed') b.push(`<button class="${B.secondary}" data-ls-connect="${key}"${gate}>Edit domains</button>`);
    if (connected && s !== 'DISABLED') b.push(`<button class="${B.ghost}" data-ls-disconnect="${key}"${gate}>Disconnect</button>`);
    return `<div class="flex flex-wrap items-center gap-2 pt-3 mt-3 border-t border-outline-variant/30">${b.join('')}</div>`;
  };

  const details = r => {
    const s = up(r.status), k = str(r.connect_kind);
    const connected = s && s !== 'NOT_CONNECTED' && s !== 'DISABLED';
    const igNote = str(r.source_key) === 'meta_lead_ads_instagram' ? `<div class="font-body-sm text-body-sm text-on-surface-variant mb-1.5">${esc(IG_NOTE)}</div>` : '';
    if (k === 'manual') return muted(`Record phone and walk-in enquiries from ${SCREENS.recordlead
      ? '<a class="font-semibold text-primary hover:underline" href="#recordlead" data-go="recordlead">Record a Lead</a>' : 'Record a Lead'}.`);
    if (k === 'email') return muted('Forwarding instructions for marketplace emails come from NEXUS support after you connect.');
    if (!connected) return igNote;
    if (k === 'webhook_key') return (str(r.ingest_url) ? copyField('Webhook URL', str(r.ingest_url)) : '')
      + muted(r.has_secret ? 'A key is installed. It cannot be shown again — use “Rotate key” to issue a new one.' : 'No key is installed.')
      + `<details class="mt-1.5"><summary class="font-body-sm text-body-sm text-primary cursor-pointer">Setup steps in Google Ads</summary>${GOOGLE_STEPS}</details>`;
    if (k === 'embed') return (str(r.public_key) ? copyField('Embed on your website', embedSnippet(str(r.public_key)), 'Copy snippet') : '')
      + (Array.isArray(r.origin_allowlist) && r.origin_allowlist.length
          ? muted(`Allowed domains: ${esc(r.origin_allowlist.join(', '))}`) : '')
      + (str(r.ingest_url) ? `<details class="mt-1.5"><summary class="font-body-sm text-body-sm text-primary cursor-pointer">Alternative: plain HTML form</summary>
          ${copyField('Form posting to NEXUS', plainFormSnippet(str(r.ingest_url)), 'Copy form')}</details>` : '');
    if (k === 'meta_page') return igNote + muted(`Page ID ${esc(str(r.identity_value) || 'not recorded')} · `
      + (r.has_secret ? 'Page access token installed (never displayed).' : 'No Page access token installed.'));
    return '';
  };

  const paint = () => {
    if (loadErr) {
      card.innerHTML = head + `<div class="${C.body}">${stateError('this dealership’s lead source connections', loadErr, null,
        'Connecting a lead source is disabled until this can be read.')}</div>`;
      return;
    }
    const list = Array.isArray(rows) ? rows : [];
    const body = list.length
      ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md">${list.map(r => `
          <div class="p-space-md rounded-lg border border-outline-variant/60 bg-surface-container-lowest flex flex-col min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined text-[20px]">${esc(lsIcon(r))}</span></span>
                ${bold(esc(str(r.label) || str(r.source_key)))}</div>
              ${lsStatus(r)}</div>
            <div class="mt-2 flex-1">${details(r)}</div>${actions(r)}</div>`).join('')}</div>`
      : stateEmpty('No lead sources are available to connect yet', 'Contact NEXUS support.', 'link_off');
    card.innerHTML = head + `<div class="${C.body}">${body}</div>`;
    wireCopy(card);
    card.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); go(a.dataset.go); }));
    const find = k => list.find(r => str(r.source_key) === k);
    card.querySelectorAll('[data-ls-connect]').forEach(b => b.addEventListener('click', () => openConnect(find(b.dataset.lsConnect))));
    card.querySelectorAll('[data-ls-rotate]').forEach(b => b.addEventListener('click', () => rotate(find(b.dataset.lsRotate))));
    card.querySelectorAll('[data-ls-disconnect]').forEach(b => b.addEventListener('click', () => disconnect(find(b.dataset.lsDisconnect))));
  };

  /* `changed` is true after a write: the feeds table above reads the same
     register, so it is told to re-read rather than go on showing the state
     from before the write. */
  const reload = async (changed = false) => {
    card.innerHTML = head + `<div class="${C.body}">${stateLoading(3)}</div>`;
    try { rows = await db('rpc/nexus_lead_source_connections'); loadErr = null; }
    catch (e) { rows = null; loadErr = e; }
    paint();
    if (changed && onChange) onChange();
  };

  const showSecret = (title, r, res, intro) => {
    const secret = str(res && res.secret_once);
    const url = str(res && res.ingest_url) || str(r.ingest_url);
    const m = openModal(title, `${intro || ''}
      ${url ? copyField('Webhook URL', url) : ''}
      ${secret ? copyField('Key', secret) + `<div class="${C.hot} font-semibold my-1">Copy the key now — it won’t be shown again.</div>` : ''}
      ${GOOGLE_STEPS}`, `<button class="${B.primary}" id="lsDone">Done</button>`);
    wireCopy(m.wrap);
    m.wrap.querySelector('#lsDone').addEventListener('click', m.close);
  };

  const openConnect = r => {
    if (!r) return;
    const k = str(r.connect_kind), name = str(r.label) || str(r.source_key);
    let body = '';
    if (k === 'embed') body = `<div class="${C.field}"><label class="${C.label}" for="lsDomains">Allowed website domain(s)</label>
        <input class="${C.input}" id="lsDomains" placeholder="example.ae, www.example.ae" value="${esc(Array.isArray(r.origin_allowlist) ? r.origin_allowlist.join(', ') : '')}" />
        <div class="${C.hint}">Only forms on these domains can send leads with your key. Separate several with commas.</div></div>`;
    else if (k === 'meta_page') body = (str(r.source_key) === 'meta_lead_ads_instagram' ? `<div class="mb-3">${banner('warm', 'info', `${esc(IG_NOTE)} If your Page is already connected on the Facebook card, you do not need to connect it here.`)}</div>` : '') + META_HELP + `<div class="${C.field}"><label class="${C.label}" for="lsPage">Facebook Page ID</label>
        <input class="${C.input}" id="lsPage" inputmode="numeric" placeholder="123456789012345" value="${esc(str(r.identity_value))}" /></div>
        <div class="${C.field}"><label class="${C.label}" for="lsToken">Page access token</label>
        <input class="${C.input}" id="lsToken" type="password" autocomplete="off" placeholder="Paste the system user token" />
        <div class="${C.hint}">Stored securely. It is never displayed again.${r.has_secret ? ' Leave empty to keep the token already installed.' : ''}</div></div>`;
    else if (k === 'email') body = muted('Connecting turns this source on. NEXUS support will send you the forwarding address and instructions.');
    else if (k === 'webhook_key') body = muted('NEXUS will create a Webhook URL and a Key for Google Ads. The key is shown once, right after you connect.');
    const m = openModal(`Connect ${name}`, body,
      `<button class="${B.secondary}" id="lsCancel">Cancel</button><button class="${B.primary}" id="lsSave">Connect</button>`);
    m.wrap.querySelector('#lsCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#lsSave').addEventListener('click', async () => {
      let identity = null, secret = null;
      if (k === 'embed') {
        identity = m.wrap.querySelector('#lsDomains').value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean).join(',');
        if (!identity) return m.msg(`<span class="${C.hot}">Enter at least one domain.</span>`);
      } else if (k === 'meta_page') {
        identity = m.wrap.querySelector('#lsPage').value.replace(/\s/g, '');
        secret = m.wrap.querySelector('#lsToken').value.trim();
        if (!identity) return m.msg(`<span class="${C.hot}">${esc(LS_ERRORS.NX_LS_PAGE_ID_REQUIRED)}</span>`);
        if (!/^\d+$/.test(identity)) return m.msg(`<span class="${C.hot}">A Page ID is numbers only.</span>`);
        if (!secret && !r.has_secret) return m.msg(`<span class="${C.hot}">${esc(LS_ERRORS.NX_LS_TOKEN_REQUIRED)}</span>`);
        if (secret && secret.length < 20) return m.msg(`<span class="${C.hot}">Paste the full Page access token — that is too short to be one.</span>`);
        if (!secret) secret = null;
      }
      const btn = m.wrap.querySelector('#lsSave');
      btn.disabled = true; btn.textContent = 'Connecting…';
      try {
        const res = await dbWrite('POST', 'rpc/nexus_lead_source_connect', {
          p_source_key: str(r.source_key), p_identity_value: identity, p_secret: secret, p_label: null,
        });
        const row = Array.isArray(res) ? res[0] : res;
        m.close();
        if (k === 'webhook_key') showSecret(`${name} connected`, r, row,
          muted('Connected. Paste these into Google Ads now.'));
        else if (k === 'embed' && row && str(row.public_key)) {
          const m2 = openModal(`${name} connected`, copyField('Paste this into your website', embedSnippet(str(row.public_key)), 'Copy snippet')
            + (str(row.ingest_url) ? `<details><summary class="font-body-sm text-body-sm text-primary cursor-pointer">Alternative: plain HTML form</summary>${copyField('Form posting to NEXUS', plainFormSnippet(str(row.ingest_url)), 'Copy form')}</details>` : ''),
            `<button class="${B.primary}" id="lsDone">Done</button>`);
          wireCopy(m2.wrap); m2.wrap.querySelector('#lsDone').addEventListener('click', m2.close);
        }
        reload(true);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Connect';
        lsFail(m, e);
      }
    });
  };

  const confirmAct = (title, text, label, run) => {
    const m = openModal(title, muted(esc(text)),
      `<button class="${B.secondary}" id="lsNo">Cancel</button><button class="${B.primary}" id="lsYes">${esc(label)}</button>`);
    m.wrap.querySelector('#lsNo').addEventListener('click', m.close);
    m.wrap.querySelector('#lsYes').addEventListener('click', async () => {
      const b = m.wrap.querySelector('#lsYes'); b.disabled = true;
      try { await run(m); } catch (e) { b.disabled = false; lsFail(m, e); }
    });
  };

  const rotate = r => r && confirmAct('Rotate key', 'The current key stops working immediately. You must paste the new key into Google Ads, or leads will be refused.', 'Rotate key', async m => {
    const res = await dbWrite('POST', 'rpc/nexus_lead_source_rotate_secret', { p_source_key: str(r.source_key) });
    const secret = typeof res === 'string' ? res : (Array.isArray(res) ? res[0] : res);
    m.close();
    showSecret('New key issued', r, { secret_once: typeof secret === 'string' ? secret : str(secret && (secret.secret_once || secret.nexus_lead_source_rotate_secret)) },
      muted('The old key no longer works. Replace it in Google Ads.'));
    reload(true);
  });

  const disconnect = r => r && confirmAct(`Disconnect ${str(r.label) || str(r.source_key)}`, 'NEXUS will stop accepting leads from this source until you connect it again.', 'Disconnect', async m => {
    await dbWrite('POST', 'rpc/nexus_lead_source_disconnect', { p_source_key: str(r.source_key) });
    m.close();
    reload(true);
  });

  reload();
}

/* ══════════════════════════════════════════════════════════════════════════
   Configured lead feeds, the ingestion states, and the readiness drawer
   ══════════════════════════════════════════════════════════════════════════
   lead-sources-ingestion-readiness-desk--c3ca1e: a legend of ingestion states, a
   filter, one row per source set up for this dealership, and a drawer with a
   five-gate checklist and a verdict. Nothing here is a new read: the rows are
   the readiness answer, joined to the connection register and to the arrivals
   this screen already reads. What the export shows that NEXUS does not record
   is left out rather than imitated — there is no gateway latency, no parsing
   reliability percentage and no payload sample on this screen (the rule at the
   top of the file: no endpoint, no key, no raw payload).

   THE CHECKLIST. Each gate is PASSED, FAILED or NOT TESTED from a fact this
   dealership's records hold, and the rule the export prints is the rule here:
   one NOT TESTED keeps the verdict at PARTIAL; it is never green on
   configuration alone. A registered endpoint is a fact about setup, not about
   delivery — the gates that ask "does it work" pass only on an arrival. */
const readConnections = shared(() => db('rpc/nexus_lead_source_connections'));
const resetConnections = () => { MEMOS.forEach(reset => reset()); };

/* Status chip for a feed row, by connection state. RECEIVING (the export's
   "event < 24h") is earned only by a real arrival in the last 24 hours on a
   source that is CONNECTED; everything else is the state's own word. A state
   this screen does not know never borrows a healthy colour. */
const DAY_MS = 24 * 3600 * 1000;
function feedChip(rd, agg, cn) {
  const st = connectionState(rd.state);
  if (!st) return statusChip('degraded', 'State not recognised');
  if (rd.state === 'CONNECTED') {
    const recent = agg && agg.lastAt && (Date.now() - Date.parse(agg.lastAt)) < DAY_MS;
    if (recent) return statusChip('receiving', 'Receiving');
    return statusChip('connected', str(cn && cn.connect_kind) === 'manual' ? 'Manual · connected' : 'Connected');
  }
  if (rd.state === 'NOT_CONNECTABLE') return statusChip('planned', 'Roadmap');
  if (rd.state === 'NOT_CONNECTED') return statusChip('not-tested', 'Not connected');
  return statusChip('partial', st.label);
}

const LEGEND = [
  ['receiving', 'Receiving', 'Connected, and a real enquiry arrived in the last 24 hours'],
  ['connected', 'Connected', 'Registered and switched on; nothing in the last 24 hours'],
  ['partial', 'Set up, not usable', 'Registered, but nothing real can arrive through it yet'],
  ['not-tested', 'Not connected', 'Nothing registered for this dealership — not a fault'],
  ['planned', 'Roadmap', 'No feed exists to connect to'],
];

function sourceGates(rd, cn, agg, testAgg) {
  const kind = str(cn && cn.connect_kind);
  const manual = kind === 'manual';
  const cs = up(cn && cn.status);
  const arrivals = (agg ? agg.events : 0);
  const tests = (testAgg ? testAgg.events : 0);
  const any = arrivals + tests;
  const gates = [];

  /* 1 · Authentication — proven by an accepted delivery, never by a stored key. */
  if (any) {
    const signed = (agg ? agg.verified : 0) + (testAgg ? testAgg.verified : 0);
    gates.push({ gate: 'Authentication', state: 'passed', detail: esc(manual
      ? `${num(any)} ${plural(any, 'arrival was', 'arrivals were')} recorded by a signed-in member of this dealership — the session is the authentication.`
      : `${num(any)} ${plural(any, 'delivery was', 'deliveries were')} accepted from this source; ${num(signed)} carried a signature that was checked.`) });
  } else if (!manual && cn && (kind === 'webhook_key' || kind === 'meta_page') && cs && cs !== 'NOT_CONNECTED' && cs !== 'DISABLED' && !cn.has_secret) {
    gates.push({ gate: 'Authentication', state: 'failed', detail: esc('Connected, but no key or token is installed, so a delivery cannot be authenticated. Connect it again to install one.') });
  } else {
    gates.push({ gate: 'Authentication', state: 'not-tested', detail: esc(cn && cn.has_secret
      ? 'A key or token is installed. No delivery has used it yet, so it is not proven to work.'
      : 'Nothing has arrived from this source, so no authentication has been exercised.') });
  }

  /* 2 · Dealership mapping — the readiness answer is scoped to this dealership. */
  const ep = n0(rd.endpoints);
  if (!connectionState(rd.state)) {
    gates.push({ gate: 'Dealership mapping', state: 'not-tested', detail: esc(CONNECTION_STATE_NOT_KNOWN) });
  } else if (ep && ep > 0) {
    gates.push({ gate: 'Dealership mapping', state: 'passed', detail: esc(`${num(ep)} live ${plural(ep, 'endpoint is', 'endpoints are')} registered to this dealership for this source.`) });
  } else {
    gates.push({ gate: 'Dealership mapping', state: 'not-tested', detail: esc('Nothing live is registered to this dealership for this source yet.') });
  }

  /* 3 · Webhook — for a manual source there is none; the entry path is a screen. */
  if (manual) {
    gates.push(rd.state === 'REGISTERED_NO_ENTRY_PATH'
      ? { gate: 'Webhook', state: 'failed', detail: esc('No webhook by design, and no screen to enter one by hand either — nothing can arrive through this source.') }
      : { gate: 'Webhook', state: 'n/a', detail: esc('No webhook by design: a person enters these on the Record a Lead screen.') });
  } else if (rd.state === 'NOT_CONNECTABLE') {
    gates.push({ gate: 'Webhook', state: 'n/a', detail: esc(noLeadFeedSentence(rd.name || rd.key)) });
  } else if (cs === 'DISABLED') {
    gates.push({ gate: 'Webhook', state: 'failed', detail: esc('Switched off — a delivery today would be refused at the door.') });
  } else if (any) {
    gates.push({ gate: 'Webhook', state: 'passed', detail: esc(`The endpoint accepted ${num(any)} ${plural(any, 'delivery', 'deliveries')}${agg && agg.lastAt ? `, the newest ${ago(agg.lastAt)}` : ''}.`) });
  } else {
    gates.push({ gate: 'Webhook', state: 'not-tested', detail: esc(rd.state === 'CONNECTED'
      ? 'Registered and switched on. No delivery has reached it, so it is not proven to accept one.'
      : 'No endpoint is accepting deliveries for this source yet.') });
  }

  /* 4 · Inbound test — something actually arrived and reached a stage. */
  if (agg && agg.promoted) {
    gates.push({ gate: 'Inbound test', state: 'passed', detail: esc(`${num(agg.promoted)} real ${plural(agg.promoted, 'enquiry', 'enquiries')} arrived and became ${plural(agg.promoted, 'a lead', 'leads')}.`) });
  } else if (tests) {
    gates.push({ gate: 'Inbound test', state: 'passed', detail: esc(`${num(tests)} test ${plural(tests, 'delivery', 'deliveries')} arrived. Test traffic proves the door; it is counted nowhere as business.`) });
  } else if (arrivals && agg && agg.lost === arrivals) {
    gates.push({ gate: 'Inbound test', state: 'failed', detail: esc(`${num(arrivals)} ${plural(arrivals, 'enquiry', 'enquiries')} arrived and every one was lost — see the list below for the reasons.`) });
  } else if (arrivals) {
    gates.push({ gate: 'Inbound test', state: 'passed', detail: esc(`${num(arrivals)} ${plural(arrivals, 'enquiry', 'enquiries')} arrived; none has become a new lead yet (already held, or still in progress).`) });
  } else {
    gates.push({ gate: 'Inbound test', state: 'not-tested', detail: esc('No delivery, real or test, has arrived from this source in what was read.') });
  }

  /* 5 · Outbound test — nothing in NEXUS records one for a lead source. */
  gates.push({ gate: 'Outbound test', state: 'not-tested', detail: esc('NEXUS records no reply or acknowledgement test for this source, so this gate cannot pass yet.') });
  return gates;
}

function openSourceDrawer(row) {
  const { rd, cn, agg, testAgg } = row;
  const gates = sourceGates(rd, cn, agg, testAgg);
  const metric = (k, v, sub) => `<div class="p-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest">
      <div class="${C.caps}">${esc(k)}</div><div class="font-label-numeric-md text-label-numeric-md font-bold text-on-surface mt-1">${v}</div>
      ${sub ? `<div class="font-body-sm text-body-sm text-on-surface-variant">${sub}</div>` : ''}</div>`;
  const signedOf = agg && agg.events ? `${num(agg.verified)} of ${num(agg.events)}` : '—';
  openDrawer(`<div class="${DRAWER.head}">
      <div class="flex items-start gap-3 min-w-0">
        <span class="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined">${esc(lsIcon(cn || { source_key: rd.key }))}</span></span>
        <div class="min-w-0"><div class="flex items-center gap-2 flex-wrap"><h2 class="font-headline-md text-headline-md font-bold text-on-surface">${esc(rd.name || rd.key)}</h2>${feedChip(rd, agg, cn)}</div>
          <div class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(rd.key)}${rd.channel ? ` · ${esc(rd.channel)}` : ''}</div></div>
      </div>
      <button type="button" aria-label="Close" data-ls-close class="${B.icon}"><span class="material-symbols-outlined text-[20px]">close</span></button>
    </div>
    <div class="${DRAWER.body}">
      ${readinessChecklist(gates)}
      <div class="mt-space-md"><div class="${C.caps} mb-2">Recorded so far, in the window read</div>
        <div class="grid grid-cols-2 gap-2">
          ${metric('Newest arrival', agg && agg.lastAt ? esc(ago(agg.lastAt)) : '—', agg && agg.lastAt ? esc(dubaiStamp(agg.lastAt)) : 'No real enquiry has arrived')}
          ${metric('Real enquiries', agg ? num(agg.events) : '0', agg ? `${num(agg.promoted)} became leads` : 'None in what was read')}
          ${metric('Lost after arriving', agg ? num(agg.lost) : '0', 'Each is listed with its reason below')}
          ${metric('Signed at source', signedOf, 'Checked signatures over real arrivals')}
          ${metric('Test arrivals', testAgg ? num(testAgg.events) : '0', 'Counted nowhere as business')}
          ${metric('Live endpoints', rd.endpoints == null ? '—' : num(rd.endpoints), 'Registered to this dealership')}
        </div></div>
      <div class="mt-space-md"><div class="${C.caps} mb-2">Whether NEXUS is receiving from it</div>${connectionCell(rd)}</div>
    </div>
    <div class="${DRAWER.foot}">
      ${str(cn && cn.connect_kind) === 'manual' && SCREENS.recordlead
        ? `<button class="${B.primary}" data-ls-go="recordlead"><span class="material-symbols-outlined text-[18px]">edit_note</span>Record a lead</button>` : ''}
      <button class="${B.secondary}" data-ls-connectcard><span class="material-symbols-outlined text-[18px]">settings</span>Connection settings</button>
    </div>`);
  const d = document.getElementById('drawer');
  if (!d) return;
  d.querySelector('[data-ls-close]')?.addEventListener('click', closeDrawer);
  d.querySelector('[data-ls-go]')?.addEventListener('click', () => { closeDrawer(); go('recordlead'); });
  d.querySelector('[data-ls-connectcard]')?.addEventListener('click', () => {
    closeDrawer();
    document.getElementById('lsConnect')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function mountFeeds(host) {
  host.innerHTML = '';
  let family = '';
  const box = el('div', 'flex flex-col gap-space-md');
  host.appendChild(box);
  box.innerHTML = stateLoading(4);
  Promise.all([settle(readOrigin()), settle(readReadiness()), settle(readConnections())]).then(([o, d, c]) => {
    const legend = `<div class="bg-surface-container-low border border-outline-variant/40 rounded-xl px-space-md py-3 flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2"><span class="${C.caps}">Ingestion states:</span>
          ${LEGEND.map(([k, label, why]) => `<span class="inline-flex items-center gap-1.5" title="${esc(why)}">${statusChip(k, label)}<span class="font-label-numeric-sm text-[11px] text-outline">${esc(why)}</span></span>`).join('')}</div>
      </div>`;
    if (d.err) {
      box.innerHTML = legend + unreadPanel('Couldn’t load which sources are set up for this dealership',
        [esc(CONNECTION_STATE_UNREAD), 'Without it no source can be listed as configured, and none is being listed from anywhere else.']);
      return;
    }
    const R = readinessRows(d.v);
    const T = o.err ? null : splitTraffic(o.v);
    const aggs = new Map((T ? bySource(T.business) : []).map(a => [a.key, a]));
    const tests = new Map((T ? bySource(T.test) : []).map(a => [a.key, a]));
    const conns = new Map((c.err || !Array.isArray(c.v) ? [] : c.v).map(r => [str(r.source_key), r]));
    const rows = R.usable.map(rd => ({ rd, cn: conns.get(rd.key) || null, agg: aggs.get(rd.key) || null, testAgg: tests.get(rd.key) || null }));
    const families = [...new Set(rows.map(r => r.rd.channel).filter(Boolean))].sort();

    const paint = () => {
      const shown = family ? rows.filter(r => r.rd.channel === family) : rows;
      const filter = `<label class="inline-flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant">Filter:
          <select data-ls-family class="px-2 py-1 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface font-body-sm text-body-sm">
            <option value="">All sources (${num(rows.length)})</option>
            ${families.map(f => `<option value="${esc(f)}"${f === family ? ' selected' : ''}>${esc(f)} (${num(rows.filter(r => r.rd.channel === f).length)})</option>`).join('')}
          </select></label>`;
      const tbl = table([
        { label: 'Lead source & type', strong: true, render: r => `<div class="flex items-center gap-3 min-w-[220px]">
            <span class="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined text-[20px]">${esc(lsIcon(r.cn || { source_key: r.rd.key }))}</span></span>
            <div class="min-w-0">${bold(esc(r.rd.name || r.rd.key))}<div class="mt-0.5 flex flex-wrap items-center gap-1.5"><span class="font-label-numeric-sm text-[11px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">${esc(r.rd.key)}</span>${r.rd.channel ? `<span class="font-body-sm text-body-sm text-outline">${esc(r.rd.channel)}</span>` : ''}</div></div></div>` },
        { label: 'Status', render: r => feedChip(r.rd, r.agg, r.cn) },
        { label: 'Last received', render: r => (r.agg && r.agg.lastAt
            ? `<div class="font-label-numeric-sm">${esc(ago(r.agg.lastAt))}</div>${muted(esc(dubaiStamp(r.agg.lastAt)))}`
            : muted(T ? 'Never, in what was read' : 'Arrivals unread')) },
        { label: 'Arrivals', align: 'r', render: r => (T ? num(r.agg ? r.agg.events : 0) : '—') },
        { label: 'Lost', align: 'r', render: r => (T ? (r.agg && r.agg.lost ? `<span class="${C.hot}">${num(r.agg.lost)}</span>` : '0') : '—') },
        { label: 'Readiness', render: r => {
            const v = readinessVerdict(sourceGates(r.rd, r.cn, r.agg, r.testAgg));
            const chipKind = v.key === 'failed' ? 'failed' : v.key === 'partial' ? 'partial' : 'live';
            return `<div class="flex items-center gap-2 whitespace-nowrap">${statusChip(chipKind, `${v.passed}/${v.applicable}`)}<button type="button" class="${B.ghost}" data-ls-inspect="${esc(r.rd.key)}">Inspect<span class="material-symbols-outlined text-[16px]">chevron_right</span></button></div>`;
          } },
      ], shown, { empty: stateEmpty('No source is set up for this dealership yet',
        'The readiness answer was read and lists no source for this filter. Use “Connect your lead sources” below to set one up.', 'hub') });
      box.innerHTML = legend + `<section class="${C.card}">
          <div class="${C.head}">
            <div class="flex items-start gap-2.5 min-w-0"><span class="material-symbols-outlined text-primary text-xl mt-0.5">hub</span>
              <div class="min-w-0"><h2 class="${C.title}">Configured lead feeds & connectors</h2>
                <p class="${C.sub}">${num(rows.length)} ${plural(rows.length, 'source', 'sources')} set up for this dealership. Inspect a row for its five-gate readiness check.</p></div></div>
            ${filter}
          </div>
          ${o.err ? `<div class="px-space-md pt-3">${banner('warm', 'warning', 'The arrivals record could not be read, so the last-received, arrivals and lost columns are unread rather than empty, and every readiness check below is missing its delivery evidence.')}</div>` : ''}
          ${c.err ? `<div class="px-space-md pt-3">${banner('warm', 'warning', 'The connection register could not be read, so whether a key is installed is unknown and the authentication gate cannot fail or pass on it.')}</div>` : ''}
          ${tbl}
        </section>`;
      box.querySelector('[data-ls-family]')?.addEventListener('change', e => { family = e.target.value; paint(); });
      box.querySelectorAll('[data-ls-inspect]').forEach(b => b.addEventListener('click', () => {
        const r = rows.find(x => x.rd.key === b.dataset.lsInspect);
        if (r) openSourceDrawer(r);
      }));
    };
    paint();
  });
}

SCREENS.leadsources = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto another screen and restyle one nobody converted. A wrapper
     cannot leak — go() removes it with the rest of the subtree. Same pattern as
     screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js and screens/setup.js. */
  /* Since 7 Oct 2026 the wrapper is the Stitch root: `nx-stitch` turns on the
     scoped reset the Stitch classes were designed against, and it is still a
     wrapper this screen appends, for the reason above. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);

  /* Every visit re-reads. See the note on `shared` above for what this repairs
     and why a stale source register is worse than a slow one. */
  resetReads();

  /* The page order is the Stitch order (c3ca1e, then the sections only --1ce809
     carries): header, the four figures, the ingestion states and the feeds
     table, the connect cards, then the per-source panels. Each region gets its
     own slot so the panels below can be declared in the order they always were. */
  const slot = () => { const d = el('div', 'flex flex-col gap-space-md'); root.appendChild(d); return d; };
  const headSlot = slot(), kpiSlot = slot(), feedSlot = slot(), connectSlot = slot(), restSlot = slot(), footSlot = slot();

  headSlot.innerHTML = sectionHeader({
    eyebrow: 'Operations / Lead Sources',
    title: 'Lead Sources — ingestion & readiness',
    sub: 'Every door an enquiry can come through, whether NEXUS is actually receiving from it, how well each arrival '
       + 'is attested, and what happened to it after it landed.',
    actionsHtml: (SCREENS.recordlead ? `<button class="${B.secondary}" data-go="recordlead"><span class="material-symbols-outlined text-[18px]">edit_note</span>Record a lead</button>` : '')
      + `<button class="${B.primary}" data-ls-jump><span class="material-symbols-outlined text-[18px]">add_circle</span>Add lead source</button>`,
  });
  wireGo(headSlot);
  headSlot.querySelector('[data-ls-jump]')?.addEventListener('click', () => {
    document.getElementById('lsConnect')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const feeds = () => mountFeeds(feedSlot);
  mountSourceConnections(connectSlot, () => { resetConnections(); feeds(); });
  feeds();

  const loadBoth = async () => {
    const [o, d] = await Promise.all([settle(readOrigin()), settle(readReadiness())]);
    if (o.err && d.err) throw o.err;
    return { o, d };
  };

  /* The same two reads, and this one never throws. It is for the register at
     the bottom, whose entire job is to say what could not be checked: handing
     that panel the standard "couldn't load" card when both reads fail would
     silence the one panel on the screen that exists to report exactly that. */
  const loadBothSoft = async () => {
    const [o, d] = await Promise.all([settle(readOrigin()), settle(readReadiness())]);
    return { o, d };
  };

  /* ────────────────────────────────────────────────────────────────────────
     P1 · The answer, in four numbers
     ──────────────────────────────────────────────────────────────────────── */
  panel(kpiSlot, {
    title: 'Where your enquiries came from', icon: 'insights',
    sub: 'Every arrival NEXUS recorded, the door it came through, and how much of that origin could actually be '
       + 'verified. Test traffic is counted nowhere in these four figures',
    actions: linkBtn('leads', 'Open Leads') + ' ' + linkBtn('attribution', 'Open Attribution'),
    load: loadBoth,
    render: ({ o, d }) => {
      const T = o.err ? null : splitTraffic(o.v);
      const rd = d.err ? null : readinessRows(d.v);
      const sources = T ? bySource(T.business) : null;

      const arrivalsTile = T == null
        ? kpi('Enquiries that arrived', num(null), readFailed('The arrivals record', o.err))
        : kpi('Enquiries that arrived', num(T.business.length),
            muted(esc(TEST_TRAFFIC_EXCLUDED)
              + (T.unclassified.length
                  ? ` ${num(T.unclassified.length)} ${plural(T.unclassified.length, 'arrival does not say which it is', 'arrivals do not say which they are')} `
                    + `and ${plural(T.unclassified.length, 'is', 'are')} counted in neither figure.`
                  : ''))
              + muted(T.all.length >= ARRIVALS_LIMIT
                  ? `Over the ${num(ARRIVALS_LIMIT)} most recent arrivals, which is as many as this screen reads — `
                    + 'the cap was reached, so every count here is a floor rather than a total.'
                  : `Over all ${num(T.all.length)} ${plural(T.all.length, 'arrival', 'arrivals')} the record returned, `
                    + `within the ${num(ARRIVALS_LIMIT)} most recent this screen reads.`),
            T.business.length ? '' : 't-warm');

      const sourceTile = sources == null
        ? kpi('Sources they came through', num(null), readFailed('The arrivals record', o.err))
        : kpi('Sources they came through', num(sources.length),
            muted(rd
              ? (rd.usable.length
                  ? `${num(rd.usable.length)} ${plural(rd.usable.length, 'source is', 'sources are')} set up for this `
                    + `dealership and NEXUS is receiving from ${num(rd.usable.filter(x => (connectionState(x.state) || {}).receiving).length)} `
                    + 'of them. The ones that produced nothing are listed below, and a source nobody connected is not '
                    + 'the same as a source that had a quiet week.'
                  : 'No source is set up for this dealership at all, so there is nothing to compare this against — and '
                    + 'no source can be reported as silent.')
              : esc(CONNECTION_STATE_UNREAD)
                + ` (${esc(str(d.err && d.err.message) || 'no reason given')})`));

      /* Signed at source, over the arrivals that state a strength at all. The
         denominator is the measurable set, never the whole set: claiming a
         share of arrivals that were never assessed is the same defect as a zero
         without a denominator. */
      const stated = T ? T.business.filter(r => n0(r.origin_strength) != null) : null;
      const signed = stated ? stated.filter(r => (originBand(r.origin_strength) || {}).key === 'SIGNED') : null;
      const unstated = T ? T.business.length - (stated ? stated.length : 0) : 0;
      /* Three branches, because two would put a sentence about arrivals on a
         screen that read none. "Nothing was attested" and "nothing arrived" are
         different facts and only the first is about attestation at all. */
      const attestTile = stated == null
        ? kpi('Signed at source', num(null), readFailed('The arrivals record', o.err))
        : !T.business.length
          ? kpi('Signed at source', 'Nothing to attest',
              muted('No arrival from a real customer was read, so nothing here is well attested and nothing is '
                + 'poorly attested. This is not a statement about any source.'))
          : kpi('Signed at source', stated.length ? `${num(signed.length)} of ${num(stated.length)}` : 'Not stated',
              muted(stated.length
                ? esc(ORIGIN_STRENGTH_SCALE)
                  + ` The other ${num(stated.length - signed.length)} are not fakes — they are arrivals NEXUS could `
                  + 'verify less about, and each one says how much less.'
                  + (unstated
                      ? ` ${num(unstated)} ${plural(unstated, 'arrival records', 'arrivals record')} no strength at all `
                        + `and ${plural(unstated, 'is', 'are')} outside this ratio.`
                      : '')
                : `None of the ${num(T.business.length)} ${plural(T.business.length, 'arrival', 'arrivals')} read `
                  + `${plural(T.business.length, 'records', 'record')} an origin strength. ` + esc(ORIGIN_STRENGTH_NOT_STATED)),
              stated.length && signed.length === stated.length ? 't-ok' : '');

      const lost = T ? T.business.filter(r => (leadPhase(r.phase) || {}).kind === 'LOST') : null;
      const lostTile = lost == null
        ? kpi('Arrived and then lost', num(null), readFailed('The arrivals record', o.err))
        : kpi('Arrived and then lost', num(lost.length),
            muted(esc(LOSS_IS_NOT_ABSENCE)
              + (lost.length
                  ? ' Each one is listed below with the reason recorded against it.'
                  : T.business.length
                    ? ` Measured over ${num(T.business.length)} ${plural(T.business.length, 'arrival', 'arrivals')} from `
                      + 'real customers in the window read.'
                    : ' No arrival from a real customer was read, so this zero counts nothing and is not a clear.')),
            lost.length ? 't-hot' : (T.business.length ? 't-ok' : ''));

      const caveat = banner('info', 'info', `${bold('What these figures are, and what they are not.')}
            ${muted(esc(CONNECTION_IS_ABOUT_THIS_DEALERSHIP))}
            ${muted(esc(PROVIDER_ROUTE_IS_NOT_A_CONNECTION))}
            ${muted(esc(NO_MONEY_ON_LEAD_SOURCES))}
            ${muted(esc(ORIGIN_STRENGTH_SCALE))}
            ${muted('An arrival is an enquiry reaching NEXUS. It is not a customer, not a sale and not a valuation, '
              + 'and nothing on this screen adds any of those together.')}`);

      return `<div class="${C.grid4}">${arrivalsTile}${sourceTile}${attestTile}${lostTile}</div><div class="mt-space-md">${caveat}</div>`;
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P2 · Every source that produced something
     ──────────────────────────────────────────────────────────────────────── */
  panel(restSlot, {
    title: 'Sources that produced enquiries', icon: 'stars',
    sub: 'Busiest first. Every line carries how well its origin is attested, because a source that proves who it is '
       + 'and one that merely says who it is must never look the same',
    load: loadBoth,
    render: ({ o, d }) => {
      if (o.err) {
        return unreadPanel(`Couldn't load the arrivals record`, [`The record of where enquiries came from could not be read, so this list is not empty — it is unread. Nothing is being claimed about which sources are producing and which are not, and no source is being ruled out.`]);
      }
      const T = splitTraffic(o.v);
      /* Null when the readiness read failed, and the column below then says so
         once per row. It does NOT fall back to anything: the arrivals carry a
         provider-side status of their own and reading it here is precisely the
         substitution that put eight green pills on this screen. */
      const rd = d.err ? null : readinessRows(d.v);
      const sources = bySource(T.business);
      if (!sources.length) {
        return stateEmpty(
          T.all.length
            ? 'No enquiry from a real customer arrived in what was read'
            : 'No enquiry has arrived at all in what was read',
          T.all.length
            ? `The arrivals record was read and returned ${num(T.all.length)} ${plural(T.all.length, 'row', 'rows')}, `
              + 'and every one of them is either test traffic or does not say which it is. That is a measured answer '
              + 'over rows that exist, not a failure — and it is not a claim that this dealership received no '
              + 'enquiries by phone, in person, or through a source nobody has connected.'
            : 'The arrivals record was read successfully and holds nothing. That is a measured emptiness rather than a '
              + 'failed read — but it says only that no enquiry reached NEXUS through a connected source. Enquiries '
              + 'arriving by phone, in person, or through a source nobody has connected are not in this record and '
              + 'are not being counted as zero.',
          'inbox');
      }

      return table([
        { label: 'Source', strong: true, render: a => wrap(
            bold(esc(sourceLabel(a)))
            + (a.name ? '' : muted('No display name came with these arrivals, so the source is shown by the name it gave for itself.'))
            + (a.channels.size
                ? `<div class="mt-1 flex flex-wrap gap-1">${[...a.channels].map(x => chip(x, 'The kind of road these enquiries travelled, as the record states it.')).join(' ')}</div>`
                : '')) },
        { label: 'Is NEXUS receiving from it', render: a => wrap(
            rd ? connectionCell(a.key ? rd.byKey.get(a.key) : null) : hot(esc(CONNECTION_STATE_UNREAD))) },
        { label: 'How well the origin is attested', render: a => wrap(attestationCell(a)) },
        { label: 'Arrivals', align: 'r', render: a => `<div class="font-semibold">${num(a.events)}</div>`
            + muted(`${num(a.promoted)} became ${plural(a.promoted, 'an enquiry', 'enquiries')}`)
            + (a.duplicate ? muted(`${num(a.duplicate)} already held`) : '')
            + (a.lost ? hot(`${num(a.lost)} lost`) : '') },
        { label: 'What happened to them', render: a => wrap(phaseCells(a)) },
        { label: 'Newest arrival', render: a => (a.lastAt
            ? `<span title="${esc(dubaiStamp(a.lastAt))}">${esc(ago(a.lastAt))}</span>`
            : muted('No arrival from this source carries a time, so how recent it is cannot be said.')) },
      ], sources);
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P3 · Enquiries that arrived and were lost
     ──────────────────────────────────────────────────────────────────────── */
  panel(restSlot, {
    title: 'Enquiries that arrived and were then lost', icon: 'trending_down',
    sub: 'Refused, held back, or left until the time to act ran out. Each is a customer this dealership had, shown '
       + 'with the reason recorded against it — never as an absence, and never with a price on it',
    actions: linkBtn('leadrecovery', 'Open Lead Recovery'),
    load: loadBoth,
    render: ({ o }) => {
      if (o.err) {
        return unreadPanel(`Couldn't load the arrivals record`, [`This list is unread, not empty. No enquiry is being reported as lost and none is being ruled out — nothing was looked at.`]);
      }
      const T = splitTraffic(o.v);
      const lost = T.business.filter(r => (leadPhase(r.phase) || {}).kind === 'LOST');
      if (!lost.length) {
        /* A zero over nothing is not a finding, and the green tick is the part
           that would say otherwise. Only the branch that actually counted
           something gets it. */
        return T.business.length
          ? stateEmpty('No arrival in what was read was refused, held back or left to expire',
              `Measured over ${num(T.business.length)} ${plural(T.business.length, 'arrival', 'arrivals')} from real `
              + 'customers, within the most recent window this screen reads. That is a zero with a denominator, which '
              + 'is a finding — it says nothing about enquiries that never reached NEXUS at all, and it does not cover '
              + 'the arrivals whose stage this screen could not recognise, which are listed further down.',
              'check_circle')
          : stateEmpty('Nothing could be checked for a loss here — this is not an all-clear',
              'No arrival from a real customer was read, so there was nothing to examine. An empty list here means '
              + 'nothing was looked at rather than nothing was found, and no enquiry is being ruled out.',
              'inbox');
      }
      /* Newest first: a loss recorded an hour ago is recoverable in a way one
         from three weeks ago is not, and the order is the only thing on this
         table that says so. */
      const rows = lost.slice().sort((a, b) =>
        Date.parse(b.occurred_at || b.received_at || 0) - Date.parse(a.occurred_at || a.received_at || 0));
      return table([
        { label: 'What happened', strong: true, render: r => {
            const ph = leadPhase(r.phase);
            return wrap(`<div>${pill(ph.label, ph.tone, { verbatim: false })}</div>` + muted(esc(ph.blurb)));
          } },
        { label: 'Source', render: r => wrap(
            bold(esc(str(r.source) || str(r.source_key) || 'A source that arrived without a name'))
            + `<div class="mt-1 flex flex-wrap gap-1">${attestationInline(r)}</div>`
            + (str(r.origin_explanation) ? muted(esc(str(r.origin_explanation))) : '')) },
        { label: 'The reason recorded', render: r => wrap(str(r.disposition_reason)
            ? esc(str(r.disposition_reason))
            : hot(esc(NO_REASON_RECORDED))) },
        { label: 'Is there a lead record', render: r => wrap(muted(str(r.lead_id)
            ? 'Yes — a lead record exists for this arrival, so there is something to reopen.'
            : 'No lead record was created from this arrival, so nothing about it is on the Leads screen.')) },
        { label: 'When', render: r => {
            const when = r.occurred_at || r.received_at;
            return when
              ? `<span title="${esc(dubaiStamp(when))}">${esc(ago(when))}</span>`
              : muted('No time is recorded against this arrival.');
          } },
      ], rows);
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P4 · Sources that are set up and produced nothing
     ──────────────────────────────────────────────────────────────────────── */
  panel(restSlot, {
    title: 'Sources set up that produced nothing', icon: 'cloud_off',
    sub: 'A source nobody ever connected and a source having a quiet week are opposite facts. This is the only place '
       + 'in the product that tells them apart',
    load: loadBoth,
    render: ({ o, d }) => {
      /* THE BRANCH THAT MUST NOT BECOME A FALLBACK. There is a second list of
         sources in this database — the provider catalogue — and rendering it
         here when the readiness read fails would restore the whole defect: the
         same nine rows, the same column, the same eight green pills, under a
         panel whose subtitle promises to tell connected from unconnected. The
         honest output when this read fails is that nothing could be checked. */
      if (d.err) {
        return unreadPanel(`Nothing could be checked — whether NEXUS is receiving from each source could not be read`, [`${esc(CONNECTION_STATE_UNREAD)}`, `${esc(str(d.err.message) || 'No reason was given.')}`, `Without it, a source that is connected and silent cannot be told from one that was never connected, so neither is being reported. This panel is unread, not empty — no source is being cleared and none is being blamed.`]);
      }
      const { usable, unreadable, byKey } = readinessRows(d.v);
      const shapeFault = unreadable
        ? `<div class="mb-space-md">${banner('hot', 'report', `${bold('Part of the readiness answer came back in a shape this screen cannot read.')}
               ${muted(`${num(unreadable)} of ${num(usable.length + unreadable)} entries carry nothing this screen can `
                 + 'match against an arrival, so they are neither listed below nor counted as producing. They are '
                 + 'reported rather than dropped: a source nobody can account for is exactly the one worth naming.')}`)}</div>`
        : '';

      if (o.err) {
        return shapeFault + unreadPanel(`Couldn't load the arrivals record`, [`${num(usable.length)} sources are set up for this dealership, and whether each has produced anything cannot be answered without the arrivals record, which did not come back. Listing every configured source as silent would be reporting a failed read as a finding.`]);
      }

      const T = splitTraffic(o.v);
      const producingSources = bySource(T.business);
      const producing = new Set(producingSources.map(a => a.key).filter(Boolean));
      const testOnly = new Set(bySource(T.test).map(a => a.key).filter(Boolean));
      const silent = usable.filter(s => !producing.has(s.key));

      /* The mirror image, and a fault rather than a note: something is producing
         enquiries that this dealership's own readiness answer does not contain. */
      const unlisted = producingSources.filter(a => a.key && !byKey.has(a.key));
      const unlistedFault = unlisted.length
        ? `<div class="mb-space-md">${banner('warm', 'warning', `${bold('Enquiries arrived from a source that is not on this dealership’s list.')}
               ${muted(`${esc(unlisted.map(sourceLabel).join(', '))}. The arrivals are real and are counted above; what `
                 + 'is missing is the entry describing the source, so nothing here can say how it is meant to be '
                 + 'connected or what it ought to be attested by.')}`)}</div>`
        : '';

      if (!usable.length) {
        /* The vacuous all-clear this branch used to print — "all 0 sources on
           the list appear in the 0 arrivals read here", under a green tick — is
           the exact shape CLAUDE.md forbids: a clear nobody earned. */
        return shapeFault + unlistedFault + stateEmpty(
          'No source is set up for this dealership, so nothing could be compared',
          unreadable
            ? 'The list was read and every entry in it came back in a shape this screen cannot match against an '
              + 'arrival, so this is not a claim that no source exists — it is a claim that none could be read.'
            : 'The list was read and holds nothing. Until a source is set up, this panel cannot tell a source that '
              + 'is silent from one that was never connected, and it is not reporting either.',
          'inbox');
      }

      if (!silent.length) {
        return shapeFault + unlistedFault + stateEmpty('Every source set up for this dealership has produced something',
          `All ${num(usable.length)} ${plural(usable.length, 'source', 'sources')} on the list appear in the `
          + `${num(T.business.length)} ${plural(T.business.length, 'arrival', 'arrivals')} read here. Measured over the `
          + 'most recent window rather than over all time, which is the only claim the read supports.', 'check_circle');
      }

      return shapeFault + unlistedFault + table([
        { label: 'Source', strong: true, render: s => wrap(bold(esc(s.name || s.key))
            + (s.channel ? `<div class="mt-1 flex flex-wrap gap-1">${chip(s.channel)}</div>` : '')) },
        { label: 'Is NEXUS receiving from it', render: s => wrap(connectionCell(s)) },
        { label: 'What the silence means', render: s => {
            const st = connectionState(s.state);
            /* Order matters, and it was wrong for one render: the test-traffic
               branch is MORE SPECIFIC than the state one and has to be asked
               first. A source with only a simulator attached is also a source
               that produced simulator output, and printing the general sentence
               while a test arrival from it sits in the band below is a caption
               contradicting the page it is printed on.

               Below that, the meaning of silence comes from `connection_state`
               and from nothing else, one sentence per value, held in
               lib/vocabulary.js beside the state it belongs to — so a state and
               its explanation cannot drift apart. There is no final `else` that
               says "connected": the connected sentence is reachable only from
               the CONNECTED entry. */
            if (testOnly.has(s.key)) {
              return wrap(hot('The only arrivals recorded under this source are test traffic. Nothing from a real '
                + 'customer has come through it, and simulator output is not counted as production anywhere on this '
                + 'screen.'));
            }
            if (!st) return wrap(hot(esc(CONNECTION_STATE_NOT_KNOWN)));
            return wrap(muted(esc(st.silence)));
          } },
      ], silent);
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P5 · Test traffic, in a band of its own
     ──────────────────────────────────────────────────────────────────────── */
  panel(restSlot, {
    title: 'Test traffic — counted nowhere above', icon: 'science',
    sub: 'Simulator output, shown because hiding it would be its own kind of lie, and separated because a dealership '
       + 'must never be shown one of these as business',
    load: loadBoth,
    render: ({ o }) => {
      if (o.err) {
        return unreadPanel(`Couldn't load the arrivals record`, [`Whether any test traffic is present could not be checked. An empty band here would mean nothing was looked at, so none is shown.`]);
      }
      const T = splitTraffic(o.v);
      const note = T.unclassified.length
        ? `<div class="mb-space-md">${banner('warm', 'warning', `${bold(`${num(T.unclassified.length)} ${plural(T.unclassified.length, 'arrival does not say whether it is', 'arrivals do not say whether they are')} test traffic.`)}
               ${muted(esc(TEST_TRAFFIC_UNCLASSIFIED))}`)}</div>`
        : '';
      if (!T.test.length) {
        return note + (T.all.length
          ? stateEmpty('No arrival in what was read is marked as test traffic',
              `Measured over ${num(T.all.length)} ${plural(T.all.length, 'arrival', 'arrivals')} — a zero with a `
              + 'denominator, over the window this screen reads. It says nothing about traffic outside that window, '
              + 'and nothing about arrivals that carry no marking either way.', 'science')
          : stateEmpty('Nothing was read, so no test traffic could be found',
              'The arrivals record came back empty. That is not a statement that no simulator output exists — it is a '
              + 'statement that nothing was there to examine.', 'inbox'));
      }
      return note + `<div class="mb-space-md">${banner('info', 'science', `${bold('Everything below is test traffic.')}${muted(esc(TEST_TRAFFIC_BAND))}`)}</div>`
        + table([
          { label: 'Source', strong: true, render: a => wrap(bold(esc(sourceLabel(a)))
              + (a.channels.size ? `<div class="mt-1 flex flex-wrap gap-1">${[...a.channels].map(x => chip(x)).join(' ')}</div>` : '')) },
          { label: 'How well the origin is attested', render: a => wrap(attestationCell(a)) },
          { label: 'Arrivals', align: 'r', render: a => `<div class="font-semibold">${num(a.events)}</div>` },
          { label: 'What happened to them', render: a => wrap(phaseCells(a)) },
          { label: 'Newest', render: a => (a.lastAt
              ? `<span title="${esc(dubaiStamp(a.lastAt))}">${esc(ago(a.lastAt))}</span>`
              : muted('No time recorded.')) },
        ], bySource(T.test));
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P6 · What this screen could not check
     ──────────────────────────────────────────────────────────────────────── */
  panel(restSlot, {
    title: 'What this screen could not check — unknown is not zero', icon: 'visibility_off',
    sub: 'Every gap above, named, with what it would take to close it. The last line is permanent and is here so the '
       + 'promise is on the screen rather than only in a document',
    load: loadBothSoft,
    render: ({ o, d }) => {
      const rows = [];
      const T = o.err ? null : splitTraffic(o.v);

      if (o.err) {
        rows.push({ what: 'Anything at all about where enquiries came from',
          detail: `The arrivals record could not be read (${str(o.err.message) || 'no reason given'})`,
          why: 'Every panel on this screen rests on that one read, so a failure here is not a partial picture — it is '
             + 'no picture. Nothing above is a zero; it is an unknown.',
          unlock: 'Whatever is refusing the read. Until it succeeds, no absence on this screen may be read as a clear.',
          kind: 'UNREAD' });
      }

      if (T && T.all.length >= ARRIVALS_LIMIT) {
        rows.push({ what: 'How many enquiries arrived in total, and everything derived from that',
          detail: `The ${num(ARRIVALS_LIMIT)} most recent arrivals were read and the cap was reached`,
          why: 'Every count on this screen is over that window. They are floors, not totals, and a source whose last '
             + 'enquiry falls outside the window is indistinguishable here from one that never produced.',
          unlock: 'A date range on this screen, so the window is chosen deliberately rather than by a row cap.',
          kind: 'WINDOW' });
      }

      if (T) {
        const unknownPhase = T.all.filter(r => !leadPhase(r.phase));
        if (unknownPhase.length) {
          const words = [...new Set(unknownPhase.map(r => up(r.phase) || 'nothing recorded'))];
          rows.push({ what: 'FAULT — what happened to some arrivals after they landed',
            detail: `${num(unknownPhase.length)} of ${num(T.all.length)} arrivals `
                  + `${plural(unknownPhase.length, 'is', 'are')} at a stage this screen does not know: ${words.join(', ')}`,
            why: 'The stage decides whether an arrival is a lead that made it through, one already held, or one this '
               + 'dealership lost. A value outside the vocabulary is counted as none of them, so those arrivals are '
               + 'missing from the losses above rather than absent from the dealership.',
            unlock: 'Reconcile the wording. Either the record gained a stage or this screen fell behind one, and the '
                  + 'two cannot be told apart from here.',
            kind: 'FAULT' });
        }

        const noStrength = T.business.filter(r => n0(r.origin_strength) == null);
        if (noStrength.length) {
          rows.push({ what: 'How well some arrivals are attested',
            detail: `${num(noStrength.length)} of ${num(T.business.length)} arrivals from real customers `
                  + `${plural(noStrength.length, 'records', 'record')} no origin strength`,
            why: 'They are counted as arrivals and are excluded from every attestation figure. Not weak, not strong — '
               + 'unmeasured, and reported here rather than folded into either.',
            unlock: 'An origin strength on every arrival, which is a property of how a source is received rather than '
                  + 'anything a dealership does.',
            kind: 'DATA' });
        }

        if (T.unclassified.length) {
          rows.push({ what: 'Whether some arrivals are business or test traffic',
            detail: `${num(T.unclassified.length)} of ${num(T.all.length)} arrivals `
                  + `${plural(T.unclassified.length, 'says', 'say')} neither`,
            why: 'Counting them as business would inflate a figure this dealership acts on; counting them as test '
               + 'would hide a real enquiry. They are in neither figure.',
            unlock: 'The marking set on every arrival at the point it is recorded.',
            kind: 'DATA' });
        }
      }

      if (d.err) {
        rows.push({ what: 'Whether NEXUS is receiving from any source at all, and which sources are set up',
          detail: `The readiness answer could not be read (${str(d.err.message) || 'no reason given'})`,
          why: 'Without it, a source nobody connected cannot be told from one that had a quiet week, and neither is '
             + 'being reported. No source above is shown as connected and none is shown as unconnected — and the '
             + 'provider register, which lists the same sources and would have rendered without complaint, is '
             + 'deliberately not being substituted for it: it answers whether a provider publishes a contract, not '
             + 'whether this dealership is wired up, and reading it as the second is the defect this screen was '
             + 'repaired for on 7 September 2026.',
          unlock: 'Whatever is refusing that read.',
          kind: 'UNREAD' });
      } else {
        const R = readinessRows(d.v);
        const unknownState = R.usable.filter(x => !connectionState(x.state));
        if (unknownState.length) {
          const words = [...new Set(unknownState.map(x => x.state || 'nothing recorded'))];
          rows.push({ what: 'FAULT — whether NEXUS is receiving from some of these sources',
            detail: `${num(unknownState.length)} of ${num(R.usable.length)} sources record a connection state outside `
                  + `the ${num(Object.keys(CONNECTION_STATE).length)} this screen knows: ${words.join(', ')}`,
            why: 'A state that cannot be read might be an unconnected source being shown as working, which is the one '
               + 'direction that misleads. Nothing is claimed about those sources in either direction.',
            unlock: 'Reconcile the wording. Either the record gained a state or this screen fell behind one, and the '
                  + 'two cannot be told apart from here.',
            kind: 'FAULT' });
        }
        const receiving = R.usable.filter(x => (connectionState(x.state) || {}).receiving);
        if (!receiving.length && R.usable.length) {
          rows.push({ what: 'Everything about enquiries that were sent to a source NEXUS is not receiving from',
            detail: `NEXUS is receiving from none of the ${num(R.usable.length)} `
                  + `${plural(R.usable.length, 'source', 'sources')} set up for this dealership`,
            why: 'Every count on this screen is over what reached NEXUS. With nothing connected, those counts measure '
               + 'the connections rather than the market: a zero here is not evidence that nobody enquired, and it '
               + 'must not be read as one.',
            unlock: 'A live connection registered for at least one source. Until then the arrival counts describe '
                  + 'this product rather than this dealership.',
            kind: 'UNREAD' });
        }
      }

      /* Permanent, and stated on every render whatever the data says. It is the
         single largest thing a reader would assume a screen like this covers,
         and an absent line would read as a capability. */
      rows.push({ what: 'What any of these enquiries, or any of the lost ones, was worth',
        detail: 'Never measured, on any day',
        why: 'No enquiry in this database carries a value, and nothing links one to a vehicle at a price. There is '
           + 'therefore no honest way to put money on a source or on a lost lead, and a figure here would be invented '
           + 'rather than measured.',
        unlock: 'A value on an enquiry, or a link from an enquiry to the unit it is about. Until one of those exists '
              + 'this stays a roadmap line and is never rendered as a zero.',
        kind: 'ROADMAP' });

      return table([
        { label: 'What is not known', strong: true, render: x => wrap(esc(x.what)) },
        { label: 'How much / since when', render: x => wrap(muted(esc(x.detail))) },
        { label: 'Why it matters', render: x => wrap(muted(esc(x.why))) },
        { label: 'What would close it', render: x => wrap(`<div class="${C.warm}">${esc(x.unlock)}</div>`) },
        { label: 'Kind', render: x => pill(x.kind, x.kind === 'FAULT' || x.kind === 'UNREAD' ? 'hot' : 'unknown', { verbatim: true }) },
      ], rows);
    },
  }).then(wireGo);

  /* The trust footer (states-components §7): what this screen read, when, how
     much, and as whom. Plain words rather than schema names, for the reason the
     top of this file gives. */
  Promise.all([settle(readOrigin()), settle(readReadiness())]).then(([o, d]) => {
    const n = o.err || !Array.isArray(o.v) ? null : o.v.length;
    footSlot.innerHTML = trustFooter({
      source: 'Arrivals record · source readiness for this dealership',
      asOf: dubaiStamp(new Date()),
      evidence: o.err && d.err ? 'Nothing could be read'
        : `${n == null ? 'Arrivals unread' : `${num(n)} ${plural(n, 'arrival', 'arrivals')} read${n >= ARRIVALS_LIMIT ? ' (cap reached)' : ''}`}`
          + `${d.err ? ' · readiness unread' : ` · ${num(readinessRows(d.v).usable.length)} sources set up`}`,
      actor: actor(),
    });
  });
};
