/* NEXUS OS — screens/leads.js
   Split out of the original monolithic app.js on 17 Aug 2026, reworked on
   19 Aug 2026 into a workable pipeline (filter, sort, search, the two workflow
   actions a rep actually takes), and given an alert strip on 24 Aug 2026.

   What the strip is, and what it deliberately is not:

   `v_needs_attention` is the only source here that speaks for the whole
   database. It emits `lead_unassigned` and `sla_breach` rows with
   `screen = 'leads'` — and today it emits none of them at all. So "nothing
   right now" is the normal case and is written as a sentence rather than as an
   empty box; the day a row does appear it renders on the view's own terms
   (severity, title, detail, how long it has been waiting) and clicking it opens
   that lead here.

   Below the view's rows sit four checks the view does not make. Every one is
   computed from rows this screen had already read, except "never contacted",
   which needs communication_logs and therefore shares one bounded windowed read
   with nothing else on the screen. None of them estimates: each states the
   denominator it counted against, and a check whose read failed is withheld and
   named rather than quietly reported as zero — a zero the operator would trust.

   Identity: a lead's phone number now sits under the name in every place a lead
   is named — the table, the alert strip, the confirm dialog — because "call
   them" is the action almost every alert here resolves to. Where there is no
   number the cell says so with an em dash. A `…@lid` WhatsApp handle is never
   printed as if it were a person's name (see the 24 Aug addendum); leads are not
   supposed to carry one, but the router has written stranger things into `name`
   and a handle rendered as a name is exactly the fault that addendum is about.

   24 Aug 2026, after the clean-out — one lead, and he is a real customer.

   Two consequences, both of which are the reason this file changed today.

   First: n=1 is not a population. Nothing on this screen divides one row by
   another, and the counts that could be mistaken for a distribution — the
   status segments across the top of the table — now carry a sentence saying
   they are the whole table rather than a sample of it. There is no funnel here,
   no conversion rate and no trend, because one row cannot support one.

   Second, and more useful to an owner than any of the above: the only lead on
   file has `response_time_minutes` null. That column is the sole record in this
   database of how long a lead waited for its first answer, so the 5-minute rule
   — the founding promise of this product — currently has nothing measuring it.
   It is also what `v_needs_attention` files `sla_breach` on, which means the
   view's silence about this screen is an unmeasured promise and not a kept one.
   That is stated in the strip and per row, because a blank cell in a response
   column reads as "fast" to everyone who has ever looked at one. */
import { HOOK, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, dubaiStamp, esc, mins, n0, num, pill, tone } from '../lib/format.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { openModal } from '../lib/modal.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { table, wireRows } from '../lib/ui.js';

const up  = s => String(s || '').toUpperCase();
const low = s => String(s || '').trim().toLowerCase();
const str = v => String(v == null ? '' : v).trim();
const ts  = v => { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; };
/* Pinned to Asia/Dubai and labelled, like every other absolute time in this
   build: the workflows that wrote these rows all run on "timezone":
   "Asia/Dubai", and a manager reading the dashboard from London was being shown
   the showroom's day shifted four hours with nothing saying so. */
const when = v => dubaiStamp(v, '');
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
/* null and 0 are different answers here — 0 would be an instant reply, null is
   no measurement at all — so this must not collapse them. n0() returns null for
   null, '' and NaN and keeps a real 0. */
const respOf = l => n0(l.response_time_minutes);

/* Read ceilings. Each one is stated on screen when it is hit, because a count
   drawn from a truncated read is a smaller number, not a wrong-looking one, and
   nothing about the page would otherwise reveal it. */
const LEAD_LIMIT = 1000;
const ATTN_LIMIT = 200;
const COMM_LIMIT = 5000;

/* The "never contacted" check is windowed so it is provably complete rather
   than merely likely: a message to a lead can only be logged at or after that
   lead was created, so reading *every* log line inside the window tells us the
   true contact state of every lead created inside the same window. Reading "the
   newest N log lines" instead would start accusing reps of ignoring leads they
   had answered, the moment the dealership got busy. Leads older than the window
   are therefore not judged by this check at all. */
const CONTACT_WINDOW_DAYS = 30;

/* No contact for this long is stale. Two weeks is the assumption in this
   number — it is not a company policy the database knows about — so the alert
   says "no contact in 14 days" rather than the word "stale" on its own. */
const STALE_DAYS = 14;

/* The router scores 1–100. Where its own Hot cut-off sits is a Make.com prompt,
   not a column we can read, so this threshold is ours and the alert states it
   in full ("scored 70 or higher") instead of claiming the router called them
   hot. */
const HIGH_SCORE = 70;

/* Statuses that mean the lead is finished. A won deal that nobody has touched
   in a month is not a neglected lead, and listing it as one trains people to
   ignore the strip. */
/* DISQUALIFIED was missing until 30 Aug 2026 and it is the one the bot writes:
   the WhatsApp BDC agent and the silence detector both set it and both read it
   back as final. Without it here, a lead the bot had written off stayed "open"
   for this screen forever — named in the "no contact in 14 days" alert every
   day for the rest of time, because nobody was ever going to contact it. */
const TERMINAL = new Set(['WON','LOST','CLOSED','CONVERTED','DELIVERED','DEAD','JUNK','SPAM','UNQUALIFIED','DISQUALIFIED','ARCHIVED']);

/* The 5-minute rule. It is a promise the dealership made, not a column
   constraint, and `leads.response_time_minutes` is the only place in the
   database where it is ever measured. `v_needs_attention` files `sla_breach`
   off that same column, so a lead whose response time was never recorded is
   invisible to the view and to this screen alike — which is a fact worth
   printing, not a silence worth trusting. */
const SLA_MINUTES = 5;

/* At or below this, a set of rows is the whole book rather than a sample of it,
   and the captions say so. The arithmetic does not change — this screen counts
   rows and never divides one by another — but "1 HOT" beside "0 WARM" reads as
   a distribution unless something tells the reader it is one row. */
const THIN = 5;

/* Names shown per alert before it collapses into "+N more". The row itself
   filters the table to the full set, so this is a glance, not the list. */
const PREVIEW = 3;

/* A WhatsApp handle. A LID carries no phone digits at all, so it identifies
   nobody — it is never printed as a name. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;

/* `v_needs_attention.severity` is HOT | WARM | COLD, and TONE covers all three
   (plus an unknown value, which it gives its own 'unknown' tone rather than
   leaving unstyled or filing under COLD).
   So there is no severity map here: the checks below are labelled in the view's
   own vocabulary so that one strip does not speak two of them. */
const KIND_ICON = { lead_unassigned:'person_alert', sla_breach:'timer' };

/* ── The two workflows this screen may trigger ────────────────────────────────
   Both already exist in n8n and both verify the caller's Supabase JWT, which
   n8n() attaches. Nothing here writes to the database: escalation and the drip
   are n8n's job, and the row keeps whatever status and owner it had. The field
   vocabularies below are not free choices — a dashboard/workflow mismatch is
   what kept the drip at zero successful runs before, so `drip` posts exactly
   what the Campaigns screen posts, and `escalate` posts the identity fields the
   Lead Escalation agent resolves its session on (email → lead_email → name)
   plus `reason`, which is the field that routes the alert to
   #escalation-alerts rather than the hot-lead channel. */
const ACTIONS = {
  escalate: {
    key: 'escalate',
    hook: HOOK.escalation,
    label: 'Escalate',
    title: 'Escalate this lead',
    confirm: 'Escalate now',
    done: 'Escalated',
    blurb: 'Hands the lead to the Lead Escalation workflow, which posts a briefing into Slack for a human to pick up. '
         + 'Nothing on this screen changes — the lead keeps its current status and owner.',
    blocker: l => (!l.email && !l.name)
      ? 'This lead has neither a name nor an email address, so the alert would arrive unidentifiable.'
      : null,
    payload: l => ({
      email: l.email || null,
      lead_email: l.email || null,
      name: l.name || null,
      lead_name: l.name || null,
      phone: l.phone || null,
      vehicle_interest: l.vehicle_interest || null,
      /* A field name in the escalation webhook's payload, not a column: the
         workflow reads `lead_score`, and the leads table has no such column
         (selecting one is what blanked team.js in production). The value is
         ai_score, which is the score the table actually stores. */
      lead_score: n0(l.ai_score),
      status: l.status || null,
      reason: 'Escalated by hand from the Leads screen',
    }),
  },
  drip: {
    key: 'drip',
    hook: HOOK.warmDrip,
    label: 'Start drip',
    title: 'Enrol in the 7-day warm drip',
    confirm: 'Start the drip',
    done: 'Drip started',
    blurb: 'Day 1 welcome, day 3 follow-up, day 7 final offer — sent by n8n over the following week, not by this browser. '
         + 'Starting it twice enrols the lead twice.',
    blocker: l => !l.email
      ? 'The drip is addressed by email and this lead has no email address on record.'
      : null,
    payload: l => ({
      lead_email: l.email,
      lead_name: l.name || '',
      vehicle_interest: l.vehicle_interest || '',
    }),
  },
};

const SORTS = {
  new:   'Newest first',
  old:   'Oldest first',
  score: 'Highest AI score',
  low:   'Lowest AI score',
};

/* A 2xx from the webhook is the only thing we actually know. Echo whatever the
   workflow said if it said anything; never dress up silence as a result. */
function replyNote(res) {
  const t = res && typeof res === 'object' ? (res.status || res.message || res.raw) : null;
  return typeof t === 'string' && t.trim()
    ? `The workflow replied: ${t.trim().slice(0, 160)}`
    : 'The workflow accepted the request.';
}

/* Resolve to [value, null] or [null, error] so one failed read cannot abort the
   others through Promise.all, and so every failure arrives as a fact the strip
   can print rather than as a rejection somebody has to catch again. */
const settle = p => p.then(v => [v, null], e => [null, e]);

/* Identity, in one place, so the table, the strip and the dialog cannot drift
   apart on what a nameless lead looks like. */
function leadName(l) {
  const n = str(l.name);
  if (!n) return '<span class="t-warm">Unnamed lead</span>';
  /* A chat handle is not a name. Leads should never carry one, but the router
     has written worse into this column, and the whole point of the 24 Aug
     addendum is that a handle printed as a name misleads whoever reads it. */
  if (HANDLE.test(n)) {
    return '<span class="t-warm">Unnamed lead</span> '
      + `<span class="chip mono" title="This is a WhatsApp chat handle stored in the name column, not a person's name. A LID contains no phone digits and identifies nobody.">${esc(n)}</span>`;
  }
  return esc(n);
}
const phoneText = l => str(l.phone)
  ? `<span class="mono">${esc(str(l.phone))}</span>`
  : '<span class="t-muted" title="No phone number on this lead">—</span>';
/* Name and number on one line, for the places that have no second line. */
const nameAndPhone = l => `${leadName(l)} <span class="t-muted">·</span> ${phoneText(l)}`;

SCREENS.leads = async host => {
  const alertCard = el('div', 'card flush'); host.appendChild(alertCard);
  alertCard.innerHTML = `<div class="card-head"><div><div class="card-title">Needs attention</div>
    <div class="card-sub">v_needs_attention for this screen, plus four checks this screen runs on the leads it just read</div></div></div>
    <div class="pbody">${stateLoading(2)}</div>`;

  const card = el('div', 'card flush'); card.style.marginTop = '16px'; host.appendChild(card);
  card.innerHTML = stateLoading(8);

  /* The strip's two extra reads are started before the leads read is awaited, so
     the whole screen costs one round of requests rather than one per alert. */
  const since = new Date(Date.now() - CONTACT_WINDOW_DAYS * 86400000).toISOString();
  const attnRead = db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
    + `&screen=eq.leads&limit=${ATTN_LIMIT}`);
  const commRead = db('communication_logs?select=lead_email,direction,created_at'
    + `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${COMM_LIMIT}`);
  /* Marked handled now: both are awaited later, and an early rejection would
     otherwise surface in the console instead of in the strip that reports it. */
  attnRead.catch(() => {});
  commRead.catch(() => {});

  let all = [];
  let leadsErr = null;
  try {
    // `users(id,name)` and not `users:assigned_to_id(...)` — the colon form is an
    // alias, not an FK hint, and PostgREST would look for a table called
    // `assigned_to_id`. leads has exactly one FK to users, so this is unambiguous.
    all = await db(`leads?select=*,users(id,name)&order=created_at.desc&limit=${LEAD_LIMIT}`);
  } catch (e) { leadsErr = e; }

  const [attn, attnErr] = await settle(attnRead);
  const [comms, commsErr] = await settle(commRead);

  const byId = new Map(all.map(l => [String(l.id), l]));
  const byEmail = new Map(all.filter(l => low(l.email)).map(l => [low(l.email), l]));

  /* ── The view's own rows ─────────────────────────────────────────────────
     `ref` is whatever the view chose to key the item on. Match it to a loaded
     lead by id and then by email; if neither hits, the row is still shown — it
     is a real item — but it is not made clickable, and it says why, because a
     click that silently does nothing is worse than a row that admits it cannot
     be opened from here. */
  const viewItems = (attn || []).slice().sort((a, b) => ts(b.at) - ts(a.at));
  const matchRef = ref => byId.get(str(ref)) || byEmail.get(low(ref)) || null;

  /* Refs the view already reported, so a check below does not repeat an item
     the operator has just read three lines higher up. Kept per kind: only
     `lead_unassigned` asks the same question as one of our checks. */
  const unassignedRefs = new Set(viewItems.filter(i => i.kind === 'lead_unassigned')
    .flatMap(i => [str(i.ref), low(i.ref)]).filter(Boolean));
  const listedUnassigned = l => unassignedRefs.has(String(l.id)) || (low(l.email) && unassignedRefs.has(low(l.email)));

  /* ── The four checks ────────────────────────────────────────────────────── */
  const nowMs = Date.now();
  const windowStart = nowMs - CONTACT_WINDOW_DAYS * 86400000;
  const staleCut = nowMs - STALE_DAYS * 86400000;
  const leadsCapped = all.length >= LEAD_LIMIT;
  const commsCapped = !!comms && comms.length >= COMM_LIMIT;

  const hot = all.filter(l => up(l.status) === 'HOT');
  const hotNoRepAll = hot.filter(l => !l.assigned_to_id && !str(l.users?.name));
  const hotNoRep = hotNoRepAll.filter(l => !listedUnassigned(l));
  const hotNoRepDup = hotNoRepAll.length - hotNoRep.length;

  const inWindow = all.filter(l => ts(l.created_at) >= windowStart);
  /* communication_logs is keyed on lead_email. A lead with no email cannot be
     matched to it in either direction, so it is neither contacted nor
     uncontacted as far as this screen can prove: it is excluded here and
     counted in the notes, not silently folded into the alert. */
  const windowWithEmail = inWindow.filter(l => low(l.email));
  const loggedAny = new Set((comms || []).map(c => low(c.lead_email)).filter(Boolean));
  const loggedOut = new Set((comms || []).filter(c => low(c.direction) === 'outbound')
    .map(c => low(c.lead_email)).filter(Boolean));
  /* Withheld when the log read failed or hit its ceiling: with a partial log,
     "never contacted" would name leads that were in fact answered. */
  const contactUsable = !!comms && !commsErr && !commsCapped;
  const neverContacted = contactUsable
    ? windowWithEmail.filter(l => !loggedAny.has(low(l.email))).sort((a, b) => ts(a.created_at) - ts(b.created_at))
    : [];
  const inboundOnly = contactUsable
    ? windowWithEmail.filter(l => loggedAny.has(low(l.email)) && !loggedOut.has(low(l.email)))
    : [];

  /* What is measuring the 5-minute rule, counted rather than averaged.
     `measured` is the denominator of every sentence this screen writes about
     reply speed, and it is printed in all of them. No mean is taken here at any
     size: an average over a handful of measurements is not a performance figure,
     and over none of them it is not a figure at all. */
  const measured = all.filter(l => respOf(l) != null);
  const breached = measured.filter(l => Number(respOf(l)) > SLA_MINUTES);

  const scored = all.filter(l => n0(l.ai_score) != null);
  const hotButNew = scored.filter(l => Number(l.ai_score) >= HIGH_SCORE
    && (up(l.status) === 'NEW' || !str(l.status)))
    .sort((a, b) => Number(b.ai_score) - Number(a.ai_score));

  /* Staleness, measured from something that exists.

     `leads` has no updated_at column at all — probed live on 24 Aug — so this
     table carries no row-modified timestamp, and an earlier draft of this check
     read `l.updated_at` and got `undefined` on every single row. That does not
     throw and it does not look wrong: it quietly collapses into "created more
     than 14 days ago", i.e. an age, while the caption still talks about
     staleness. Age is not staleness. A lead created three months ago and
     phoned yesterday is not neglected.

     So it is measured from the events themselves: the newest communication_logs
     row for the lead's email, and `escalated_at` on the row. That is a better
     signal than a row-modified stamp would have been — it is a last *contact*
     time, not a last-edited time — at the cost of one honest complication. The
     log read covers a 30-day window, so a lead with nothing logged inside it is
     one of two different things that look identical: never contacted (provable
     when the lead is younger than the window), or last contacted before the
     window opened, in which case the date is unknown and only "at least 30 days
     ago" is known. Those two are counted apart and named, because an unknown
     last contact is not an old one.

     Leads with no email cannot be matched to communication_logs in either
     direction, so they are excluded here and counted in the notes rather than
     declared quiet. */
  const lastLogged = new Map();
  for (const c of (comms || [])) {
    const em = low(c.lead_email); if (!em) continue;
    const t = ts(c.created_at);
    if (t > (lastLogged.get(em) || 0)) lastLogged.set(em, t);
  }
  const staleTouch = l => Math.max(lastLogged.get(low(l.email)) || 0, ts(l.escalated_at));
  const openLeads = all.filter(l => !TERMINAL.has(up(l.status)));
  const openWithEmail = openLeads.filter(l => low(l.email));
  const openNoEmail = openLeads.length - openWithEmail.length;
  /* Counted while filtering, so the breakdown is the same pass as the list and
     the two cannot disagree. */
  const staleParts = { measured: 0, never: 0, beforeWindow: 0 };
  const staleLeads = (!contactUsable ? [] : openWithEmail.filter(l => {
    const touch = staleTouch(l);
    if (touch) { if (touch >= staleCut) return false; staleParts.measured++; return true; }
    /* Nothing logged and never escalated. A lead cannot have been contacted
       before it existed, so one younger than the threshold is new, not
       neglected — that is the trap the old created_at fallback fell into. */
    const born = ts(l.created_at);
    if (!born || born >= staleCut) return false;
    if (born >= windowStart) staleParts.never++; else staleParts.beforeWindow++;
    return true;
  })).sort((a, b) => (staleTouch(a) || ts(a.created_at)) - (staleTouch(b) || ts(b.created_at)));
  const oldestMeasured = staleLeads.map(staleTouch).filter(Boolean).sort((a, b) => a - b)[0] || null;

  const checks = [
    {
      key: 'unassigned',
      sev: 'HOT',
      icon: 'person_alert',
      title: `${num(hotNoRep.length)} HOT ${plural(hotNoRep.length, 'lead has', 'leads have')} no assigned rep`,
      detail: `${num(hotNoRep.length)} of the ${num(hot.length)} HOT ${plural(hot.length, 'lead', 'leads')} read here `
        + `${plural(hotNoRep.length, 'carries', 'carry')} neither an assigned_to_id nor a rep on the joined users row. `
        + 'Nobody owns the follow-up.'
        + (hotNoRepDup ? ` ${num(hotNoRepDup)} further unassigned HOT ${plural(hotNoRepDup, 'lead is', 'leads are')} already listed above by v_needs_attention and ${plural(hotNoRepDup, 'is', 'are')} not counted twice here.` : ''),
      leads: hotNoRep,
    },
    {
      key: 'nocontact',
      sev: 'HOT',
      icon: 'phone_missed',
      title: `${num(neverContacted.length)} ${plural(neverContacted.length, 'lead has', 'leads have')} no logged contact attempt`,
      detail: `Of the ${num(windowWithEmail.length)} ${plural(windowWithEmail.length, 'lead', 'leads')} created in the last `
        + `${CONTACT_WINDOW_DAYS} days with an email address, ${num(neverContacted.length)} ${plural(neverContacted.length, 'has', 'have')} `
        + 'no row in communication_logs at all — inbound or outbound. '
        + `The oldest arrived ${ago(neverContacted[0]?.created_at)}. `
        + `Leads created before that ${CONTACT_WINDOW_DAYS}-day window are not judged by this check, because the log read covers the window only.`,
      leads: neverContacted,
      skip: !contactUsable,
    },
    {
      key: 'untriaged',
      sev: 'WARM',
      icon: 'rocket_launch',
      title: `${num(hotButNew.length)} high-scoring ${plural(hotButNew.length, 'lead is', 'leads are')} still NEW`,
      detail: `${num(hotButNew.length)} of the ${num(scored.length)} scored ${plural(scored.length, 'lead', 'leads')} `
        + `${plural(hotButNew.length, 'was', 'were')} scored ${HIGH_SCORE} or higher by the router, but the status on the row is still NEW — `
        + 'the score arrived and nobody triaged it.'
        /* Said only when there are unscored leads: this check can say nothing
           at all about them, and silence about that is what makes the count
           look like it covered the whole table. */
        + (all.length - scored.length
          ? ` ${num(all.length - scored.length)} ${plural(all.length - scored.length, 'lead', 'leads')} on this screen ${plural(all.length - scored.length, 'has', 'have')} no score at all and cannot be checked this way.`
          : ''),
      leads: hotButNew,
    },
    {
      key: 'stale',
      sev: 'WARM',
      icon: 'hourglass_empty',
      title: `${num(staleLeads.length)} open ${plural(staleLeads.length, 'lead has', 'leads have')} had no contact in ${STALE_DAYS} days`,
      detail: `${num(staleLeads.length)} of the ${num(openWithEmail.length)} open ${plural(openWithEmail.length, 'lead', 'leads')} with an email address `
        + `${plural(staleLeads.length, 'has', 'have')} had no logged message and no escalation for ${STALE_DAYS} days `
        + `(${[...TERMINAL].slice(0, 4).join(', ')}… count as finished and are not open). `
        + 'The leads table has no updated_at column at all, so this is measured from real events — the newest communication_logs row for the '
        + 'lead\'s email, and escalated_at on the row — and never from a row-modified timestamp, which does not exist here. '
        + (staleParts.measured
          ? `${num(staleParts.measured)} of them ${plural(staleParts.measured, 'has', 'have')} a real last-contact date; the ${plural(staleParts.measured, 'only one', 'oldest')} was last touched ${ago(oldestMeasured)}. `
          : '')
        + (staleParts.never
          ? `${num(staleParts.never)} ${plural(staleParts.never, 'has', 'have')} never been contacted at all — ${plural(staleParts.never, 'it was', 'they were')} created inside the ${CONTACT_WINDOW_DAYS}-day log window, so nothing was missed by reading only that window. `
          : '')
        + (staleParts.beforeWindow
          ? `${num(staleParts.beforeWindow)} ${plural(staleParts.beforeWindow, 'was', 'were')} created before that window with nothing logged inside it: ${plural(staleParts.beforeWindow, 'its', 'their')} last contact is unknown rather than old — all that can be said is that there has been none for at least ${CONTACT_WINDOW_DAYS} days.`
          : ''),
      leads: staleLeads,
      skip: !contactUsable,
    },
  ].filter(c => !c.skip && c.leads.length);

  const checkByKey = new Map(checks.map(c => [c.key, c]));
  checks.forEach(c => { c.ids = new Set(c.leads.map(l => String(l.id))); });

  /* Everything the strip cannot claim, said out loud. An operator reading a
     count needs to know which reads it rests on; a count quietly computed from
     a failed or truncated read is the failure mode this whole file is written
     against. */
  const stripNotes = [
    leadsErr
      ? `The leads read failed (${leadsErr.message}), so none of this screen's own checks could run. Only what v_needs_attention returned is shown above.`
      : '',
    attnErr
      ? `v_needs_attention could not be read (${attnErr.message}), so anything the database would have listed for this screen is missing from this strip. The checks below still ran.`
      : '',
    leadsCapped
      ? `The leads read stopped at ${num(LEAD_LIMIT)} rows, so every count below covers those ${num(LEAD_LIMIT)} leads and not necessarily the whole table.`
      : '',
    commsErr
      ? `communication_logs could not be read (${commsErr.message}), so neither the "no logged contact attempt" check nor the staleness check ran. The leads table has no updated_at column, so those logs are the only record of a lead being touched — both checks are missing from this strip rather than shown as zero.`
      : '',
    commsCapped
      ? `The contact-log read hit its ${num(COMM_LIMIT)}-row ceiling, so a message may be missing from it. The contact and staleness checks are withheld rather than accusing a rep who did in fact reply.`
      : '',
    contactUsable && openNoEmail
      ? `${num(openNoEmail)} open ${plural(openNoEmail, 'lead', 'leads')} ${plural(openNoEmail, 'has', 'have')} no email address. communication_logs is keyed on lead_email, so ${plural(openNoEmail, 'it', 'they')} cannot be matched to it in either direction and ${plural(openNoEmail, 'sits', 'sit')} outside both the contact and the staleness check — ${plural(openNoEmail, 'it is', 'they are')} in no count above.`
      : '',
    contactUsable && inboundOnly.length
      ? `${num(inboundOnly.length)} further ${plural(inboundOnly.length, 'lead', 'leads')} in that window ${plural(inboundOnly.length, 'has', 'have')} inbound messages logged but no outbound one — the customer wrote and nothing went back. They are not counted above, which counts only leads with no log line at all.`
      : '',
    checks.length > 1
      ? 'A lead can satisfy more than one check, so these counts overlap and do not add up to a total.'
      : '',
    /* The absence an owner should be told about rather than shown as a blank
       cell. It is stated here and nowhere else on this screen at the table
       level, so there is one sentence about it and not two that can drift. */
    !leadsErr && all.length && !measured.length
      ? `response_time_minutes is null on ${plural(all.length, 'the only lead on file', `all ${num(all.length)} leads on file`)}. `
        + `That column is the only record this database keeps of how long a lead waited for its first answer, so the ${SLA_MINUTES}-minute rule is currently being measured by nothing: `
        + `v_needs_attention can raise an sla_breach only against a lead that carries one, no average response time anywhere in this dashboard has an input, and the quiet from both is an unmeasured promise rather than a kept one. `
        + 'It is the router that would have to write the figure; nothing in this browser can supply it.'
      : '',
    !leadsErr && measured.length && measured.length < all.length
      ? `${num(all.length - measured.length)} of the ${num(all.length)} ${plural(all.length, 'lead', 'leads')} read here ${plural(all.length - measured.length, 'carries', 'carry')} no response_time_minutes, so the ${SLA_MINUTES}-minute rule cannot be applied to ${plural(all.length - measured.length, 'it', 'them')} at all — ${plural(all.length - measured.length, 'it is', 'they are')} unmeasured, not fast.`
      : '',
    !leadsErr && measured.length
      ? `${num(breached.length)} of the ${num(measured.length)} ${plural(measured.length, 'lead', 'leads')} that do carry a first-reply time ${plural(breached.length, 'is', 'are')} over ${SLA_MINUTES} minutes.`
        + (measured.length <= THIN
          ? ` ${num(measured.length)} ${plural(measured.length, 'measurement is', 'measurements are')} not a performance figure, so no average is taken from ${plural(measured.length, 'it', 'them')} on this screen.`
          : '')
      : '',
  ].filter(Boolean);

  const previewOf = ls => {
    const shown = ls.slice(0, PREVIEW).map(l =>
      `<button type="button" class="chip" style="border:0;cursor:pointer;font-family:inherit" data-lead="${esc(l.id)}"
        title="Open this lead">${nameAndPhone(l)}</button>`).join(' ');
    const rest = ls.length - Math.min(ls.length, PREVIEW);
    return `${shown}${rest ? ` <span class="t-muted">+${num(rest)} more</span>` : ''}`;
  };

  const viewRows = viewItems.map(it => {
    const lead = matchRef(it.ref);
    const icon = KIND_ICON[it.kind] || 'warning';
    const sev = str(it.severity);
    const openable = !!lead;
    const idLine = lead
      ? `<div class="cell-sub">${nameAndPhone(lead)}</div>`
      : `<div class="cell-sub t-muted">Refers to ${esc(str(it.ref) || 'no ref')}, which is not among the ${num(all.length)} ${plural(all.length, 'lead', 'leads')} loaded here, so it cannot be opened from this screen.</div>`;
    return `<div class="list-item"${openable
        ? ` role="button" tabindex="0" data-open-lead="${esc(lead.id)}" title="Open this lead"`
        : ' style="cursor:default"'}>
      <span class="material-symbols-outlined t-${esc(tone(sev) || 'muted')}" style="font-size:20px">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${sev ? pill(sev) : ''}${esc(str(it.title) || str(it.kind) || 'Attention item')}
          <span class="chip">${esc(str(it.kind) || 'item')}</span>
        </div>
        <div class="cell-sub">${esc(str(it.detail))}</div>
        ${idLine}
        <div class="cell-sub t-muted">${it.at
          ? `Waiting since ${esc(when(it.at))} — ${esc(ago(it.at))}`
          : 'The view gave this item no timestamp, so how long it has been waiting is unknown.'}</div>
      </div>
      ${openable ? '<span class="material-symbols-outlined t-muted" style="font-size:18px">chevron_right</span>' : ''}
    </div>`;
  }).join('');

  const checkRows = checks.map(c => `
    <div class="list-item" role="button" tabindex="0" data-focus="${esc(c.key)}"
      title="Show these ${esc(String(c.leads.length))} leads in the table below">
      <span class="material-symbols-outlined t-${esc(tone(c.sev))}" style="font-size:20px">${c.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${pill(c.sev)}${esc(c.title)}
        </div>
        <div class="cell-sub">${esc(c.detail)}</div>
        <div class="cell-sub" style="margin-top:4px">${previewOf(c.leads)}</div>
      </div>
      <span class="material-symbols-outlined t-muted" style="font-size:18px">filter_alt</span>
    </div>`).join('');

  /* The honest empty case, which today is the only case. Not a box with nothing
     in it, and not one run-on sentence either: one line per check, each naming
     the denominator it counted against, so "no alerts" reads as a result an
     operator can audit rather than as a panel that failed to load.

     The last line is the one that stops this reading as an all-clear. Six of
     these checks passing says nothing about reply speed, because the column
     reply speed lives in is empty — and a strip that looked identical either
     way is exactly how an unmeasured promise gets mistaken for a kept one. */
  const nLeads = `${num(all.length)} ${plural(all.length, 'lead', 'leads')}`;
  const nothingLines = [
    `v_needs_attention returned no row with screen = 'leads'. Its two branches here are lead_unassigned, which fires on a lead with no owner, and sla_breach, which fires on a first reply outside the ${SLA_MINUTES}-minute rule — neither is filed against anything in the leads table right now.`,
    leadsErr
      ? ''
      : !all.length
      ? 'The leads table is empty, so the four checks this screen runs of its own had nothing to weigh — none of them passed, they simply did not apply.'
      : `Checked here, against the ${nLeads} read from the table: `
        + (hot.length
            ? `${plural(hot.length, 'the one HOT lead has', `all ${num(hot.length)} HOT leads have`)} a rep on the row; `
            : 'no lead is HOT, so that check had nothing to weigh; ')
        + (scored.length
            ? `no lead scored ${HIGH_SCORE} or higher by the router is still sitting at NEW (${num(scored.length)} of ${nLeads} ${plural(scored.length, 'carries', 'carry')} a score); `
            : 'no lead carries a router score at all, so nothing could be untriaged by that check; ')
        + (contactUsable
            ? `${plural(windowWithEmail.length, 'the one lead', `each of the ${num(windowWithEmail.length)} leads`)} created in the last ${CONTACT_WINDOW_DAYS} days with an email address has at least one line in communication_logs; and no open lead with an email address has gone ${STALE_DAYS} days without a logged message or an escalation (${num(openWithEmail.length)} checked).`
            : `the contact and staleness checks could not run this time, so nothing was checked about who has been spoken to — see the note below.`),
    !leadsErr && all.length && !measured.length
      ? `None of that is a statement about how fast anyone was answered: response_time_minutes is null on ${plural(all.length, 'the only lead here', 'every lead here')}, so the sla_breach branch above has nothing to fire on and neither does this screen. The note below says what that leaves unmeasured.`
      : '',
  ].filter(Boolean);

  const nothing = `<div class="list-item" style="cursor:default">
    <span class="material-symbols-outlined t-ok" style="font-size:20px">task_alt</span>
    <div style="flex:1;min-width:0">
      <div style="font-weight:500">Nothing on this screen needs attention right now</div>
      <div class="cell-sub" style="white-space:normal">${nothingLines.map(esc).join('<br>')}</div>
    </div>
  </div>`;

  const notesRow = stripNotes.length ? `<div class="list-item" style="cursor:default">
    <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
    <div class="cell-sub" style="white-space:normal">${stripNotes.map(esc).join('<br>')}</div>
  </div>` : '';

  alertCard.querySelector('.pbody').innerHTML =
    (viewItems.length || checks.length ? viewRows + checkRows : nothing) + notesRow;

  if (leadsErr) {
    /* The strip above still says what the view reported and why the checks are
       missing; the table is the thing that is actually broken. */
    card.innerHTML = stateError('leads', leadsErr.message);
    return;
  }

  /* Two secondary reads. Neither is allowed to take the screen down, but a
     failure is not allowed to look like an answer either: with no purchase
     history no VIP badge is shown *and no lead is claimed to be a first-timer*,
     and with no audit log the workflow-history line is withheld rather than
     rendered as "never run". Both say so in a banner. */
  let vipSet = null, hist = null;
  const notes = [];
  try {
    const purchases = await db('purchase_history?select=email');
    vipSet = new Set(purchases.map(p => low(p.email)));
  } catch (e) {
    notes.push(`Purchase history is unavailable (${e.message}), so returning customers are not flagged.`);
  }
  try {
    const audit = await db('audit_log?select=workflow,status,lead_email,logged_at&order=logged_at.desc&limit=1000');
    hist = new Map();
    for (const a of audit) {
      const em = low(a.lead_email); if (!em) continue;
      const slot = /drip/i.test(a.workflow || '') ? 'drip'
                 : /escalat/i.test(a.workflow || '') ? 'escalate' : null;
      if (!slot) continue;
      const cur = hist.get(em) || {};
      if (!cur[slot]) { cur[slot] = a; hist.set(em, cur); }   // rows arrive newest first
    }
  } catch (e) {
    notes.push(`The audit log is unavailable (${e.message}), so previous escalations and drips are not shown.`);
  }

  const sources = [...new Set(all.map(l => l.source).filter(Boolean))].sort();
  const reps = [...new Set(all.map(l => l.users?.name).filter(Boolean))].sort();

  /* Actions fired in this browser session. Recorded only after a 2xx, and
     labelled as this session's doing — it is our own receipt, not a DB row. */
  const sent = new Map();

  const f = { status: 'ALL', q: '', source: 'ALL', rep: 'ALL', sort: 'new', alert: null };

  function filtered() {
    const focus = f.alert ? checkByKey.get(f.alert) : null;
    return all.filter(l => {
      if (focus && !focus.ids.has(String(l.id))) return false;
      if (f.status === NO_STATUS) { if (str(l.status)) return false; }
      else if (f.status !== 'ALL' && up(l.status) !== f.status) return false;
      if (f.source !== 'ALL' && l.source !== f.source) return false;
      if (f.rep === '__none' && l.assigned_to_id) return false;
      if (f.rep !== 'ALL' && f.rep !== '__none' && l.users?.name !== f.rep) return false;
      if (f.q) {
        const hay = [l.name, l.email, l.phone, l.vehicle_interest].join(' ').toLowerCase();
        if (!hay.includes(f.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  /* Leads with no AI score are not zero-scored — the router simply never scored
     them. They sort to the bottom of both score orders, newest first among
     themselves, rather than pretending to be the worst leads in the pipeline. */
  function sorted(rows) {
    if (f.sort === 'new') return rows.slice().sort((a, b) => ts(b.created_at) - ts(a.created_at));
    if (f.sort === 'old') return rows.slice().sort((a, b) => ts(a.created_at) - ts(b.created_at));
    const dir = f.sort === 'low' ? 1 : -1;
    const scoredRows = rows.filter(r => n0(r.ai_score) != null)
      .sort((a, b) => dir * (Number(a.ai_score) - Number(b.ai_score)));
    const unscored = rows.filter(r => n0(r.ai_score) == null)
      .sort((a, b) => ts(b.created_at) - ts(a.created_at));
    return scoredRows.concat(unscored);
  }

  /* The tabs are built from the statuses that are actually in the table, not
     from the router's three.

     `leads.status` is written by three different things — HOT/WARM/COLD by the
     Master Router, CONTACTED/QUALIFIED/WON/LOST by the Slack Command Center
     through an unconstrained $fromAI, DISQUALIFIED by the BDC agent — and this
     toolbar knew only the first three. A lead the sales manager marked WON in
     Slack was then reachable from no tab at all: not in HOT, WARM or COLD, and
     visible only in All, where the four counts underneath silently stopped
     adding up to it. Nothing on screen explained the gap, so the arithmetic
     just looked wrong.

     Every status present gets a tab, in lifecycle order, with anything this
     build has never seen appended after them rather than dropped — $fromAI can
     invent a word tomorrow and it will appear here the day it does. Rows with
     no status at all get the last tab. So the tabs sum to All, exactly, by
     construction. */
  const SEG_ORDER = ['HOT','WARM','COLD','NEW','CONTACTED','QUALIFIED','WON','LOST','DISQUALIFIED'];
  const NO_STATUS = '__nostatus';
  const segCounts = new Map();
  all.forEach(l => {
    const k = str(l.status) ? up(l.status) : NO_STATUS;
    segCounts.set(k, (segCounts.get(k) || 0) + 1);
  });
  const segKnown = SEG_ORDER.filter(k => segCounts.has(k));
  const segNovel = [...segCounts.keys()]
    .filter(k => k !== NO_STATUS && !SEG_ORDER.includes(k)).sort();
  const segs = [['ALL', all.length], ...[...segKnown, ...segNovel].map(k => [k, segCounts.get(k)])]
    .concat(segCounts.has(NO_STATUS) ? [[NO_STATUS, segCounts.get(NO_STATUS)]] : []);
  const segLabel = k => k === 'ALL' ? 'All' : k === NO_STATUS ? 'No status' : k;
  /* Said only when there is something to explain. With the router's three
     statuses and nothing else, the toolbar reads as it always did. */
  const segNote = segNovel.length
    ? `${num(segNovel.length)} of the tabs above (${segNovel.join(', ')}) ${plural(segNovel.length, 'is a status', 'are statuses')} this dashboard has no wording for — shown exactly as the database holds ${plural(segNovel.length, 'it', 'them')}, not folded into one of the router's three.`
    : segs.length > 4
      ? 'The tabs are the statuses actually in the table, not just the router\'s three, so they add up to All. HOT, WARM and COLD are written by the Master Router; CONTACTED, QUALIFIED, WON and LOST by the Slack Command Center; DISQUALIFIED by the BDC agent.'
      : '';

  card.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="segStatus" role="group" aria-label="Filter by status">
        ${segs.map(([k, c], i) => `<button data-v="${esc(k)}" class="${i === 0 ? 'on' : ''}">${esc(segLabel(k))} · ${num(c)}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="q" aria-label="Search leads"
        placeholder="Search name, email, phone or vehicle" /></div>
      <select id="fSource" aria-label="Filter by source" style="width:auto"><option value="ALL">All sources</option>${sources.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="fRep" aria-label="Filter by assigned rep" style="width:auto"><option value="ALL">All reps</option><option value="__none">Unassigned</option>${reps.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="fSort" aria-label="Sort leads" style="width:auto">${Object.entries(SORTS)
        .map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('')}</select>
      <div class="t-muted num" id="resultCount"></div>
    </div>
    ${all.length && all.length <= THIN ? `<div class="cell-sub" style="padding:12px 20px 0;white-space:normal">${esc(
      `Those counts are the whole leads table — ${num(all.length)} ${plural(all.length, 'row', 'rows')}, not a sample of it. `
      + `${plural(all.length, 'One row', `${num(all.length)} rows`)} cannot carry a share, a conversion rate or a trend, so this screen prints none: every figure on it is a count of the rows above, and the segments are a tally rather than a distribution.`)}</div>` : ''}
    ${segNote ? `<div class="cell-sub" style="padding:10px 20px 0;white-space:normal">${esc(segNote)}</div>` : ''}
    <div id="focusNote" style="padding:0 20px"></div>
    ${notes.length ? `<div style="padding:14px 20px 0">${notes.map(n => `<div class="banner warm">
      <span class="material-symbols-outlined">warning</span><div>${esc(n)}</div></div>`).join('')}</div>` : ''}
    <div id="leadTable"></div>`;

  function actionCell(r) {
    const buttons = [ACTIONS.escalate, ACTIONS.drip].map(a => {
      const blocked = !N8N_BASE
        ? 'VITE_N8N_BASE_URL is not set in this build, so no n8n workflow can be called from the browser.'
        : a.blocker(r);
      return `<button class="btn sm" data-act="${a.key}" data-id="${esc(r.id)}"
        aria-label="${esc(a.label)} — ${esc(r.name || r.email || 'this lead')}"
        title="${esc(blocked || a.title)}"${blocked ? ' disabled' : ''}>${esc(a.label)}</button>`;
    }).join('');

    const lines = [];
    for (const a of [ACTIONS.escalate, ACTIONS.drip]) {
      const at = sent.get(`${r.id}|${a.key}`);
      if (at) lines.push(`<span class="t-ok">${esc(a.done)} ${ago(at)} · this session</span>`);
      const past = hist?.get(low(r.email))?.[a.key];
      if (past) lines.push(`${esc(past.workflow)} · ${esc(past.status || '')} · ${ago(past.logged_at)}`);
    }
    return `<div style="display:flex;gap:6px;justify-content:flex-end">${buttons}</div>
      ${lines.length ? `<div class="cell-sub" style="text-align:right;margin-top:4px">${lines.join('<br>')}</div>` : ''}`;
  }

  const cols = [
    { label:'Status', render: r => pill(r.status || 'NEW') },
    /* Name and phone in one cell, because every alert on this screen resolves to
       somebody picking up a phone, and a number two columns away is a number
       nobody reads out. */
    { label:'Lead', strong: true, render: r =>
        `${leadName(r)}${vipSet?.has(low(r.email)) ? ' <span class="pill vip"><span class="dot"></span>VIP</span>' : ''}
         <div class="cell-sub">${phoneText(r)}</div>` },
    { label:'Email', render: r => esc(r.email) || '<span class="t-muted">—</span>' },
    { label:'Vehicle interest', render: r => `<span class="t-2">${esc(r.vehicle_interest || '—')}</span>` },
    /* budget_aed is NULL for router-created leads because the Master Router does
       not capture it. Rendering 0 would understate the pipeline silently. */
    { label:'Budget', align:'r', render: r => n0(r.budget_aed) == null ? '<span class="t-muted">—</span>' : aed(r.budget_aed) },
    { label:'AI score', align:'r', render: r => {
        const s = n0(r.ai_score); if (s == null) return '<span class="t-muted">—</span>';
        /* Straight from tone(), because every tone it can return now has a
           solid colour token behind it. The old three-way ternary painted a WON
           lead's score bar in the COLD blue. */
        const c = tone(r.status) || 'cold';
        return `<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
          <div class="bar" style="width:44px"><i style="width:${s}%;background:var(--${c})"></i></div>
          <span style="font-weight:500;min-width:22px;text-align:right">${s}</span></div>`;
      }},
    { label:'Source', render: r => `<span class="chip nowrap" title="${esc(r.source || '')}">${esc(r.source || '—')}</span>` },
    { label:'Assigned', render: r => r.users?.name
        ? esc(r.users.name)
        : `<span class="pill warm"><span class="dot"></span>Unassigned</span>` },
    { label:'Age', render: r => `<span class="t-muted" title="${esc(when(r.created_at))}">${ago(r.created_at)}</span>` },
    /* An empty response-time cell reads as "answered instantly" to anyone who
       glances at it. It means nobody measured, which is a different fact and a
       worse one, so the cell says which of the two it is in words. */
    { label:'First reply', align:'r', render: r => {
        const m = respOf(r);
        if (m == null) return `<span class="t-warm" title="${esc(
          `response_time_minutes is null on this row, so how long this customer waited for a first answer was never recorded. This is not a fast reply and not a slow one — the ${SLA_MINUTES}-minute rule cannot be applied to this lead at all, and v_needs_attention cannot raise an sla_breach for it either.`)}">Not measured</span>`;
        return `<span class="${m > SLA_MINUTES ? 't-hot' : 't-ok'}" title="${esc(
          `response_time_minutes on this row. The ${SLA_MINUTES}-minute rule is the dealership's own promise, not a database constraint.`)}">${esc(mins(m))}</span>`;
      }},
    { label:'Actions', align:'r', render: actionCell },
  ];

  /* One confirm step, then one unambiguous outcome. The dialog stays open on
     failure with the error verbatim, because "it didn't work" without the
     reason sends the operator to n8n's execution list to guess. */
  function confirmAction(a, lead) {
    const m = openModal(a.title, `
      <p class="t-2" style="margin:0 0 16px">${esc(a.blurb)}</p>
      <dl class="kv">
        <dt>Lead</dt><dd>${leadName(lead)}</dd>
        <dt>Phone</dt><dd>${phoneText(lead)}</dd>
        <dt>Email</dt><dd>${esc(lead.email) || '<span class="t-muted">—</span>'}</dd>
        <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
        <dt>Status</dt><dd>${pill(lead.status || 'NEW')}</dd>
        <dt>AI score</dt><dd>${n0(lead.ai_score) == null ? '<span class="t-muted">Not scored</span>' : num(lead.ai_score)}</dd>
      </dl>`,
      `<button class="btn primary" id="actGo">${esc(a.confirm)}</button>
       <button class="btn" id="actCancel">Cancel</button>`);

    const go = m.wrap.querySelector('#actGo');
    const cancel = m.wrap.querySelector('#actCancel');
    go.focus();
    cancel.addEventListener('click', m.close);
    go.addEventListener('click', async () => {
      const label = go.textContent;
      go.disabled = true; cancel.disabled = true; go.textContent = 'Sending…';
      m.msg('<span class="t-muted">Calling the workflow…</span>');
      try {
        const res = await n8n(a.hook, a.payload(lead));
        sent.set(`${lead.id}|${a.key}`, Date.now());
        m.msg(`<span class="t-ok">${esc(a.done)}. ${esc(replyNote(res))}</span>`);
        go.textContent = 'Done';
        cancel.disabled = false; cancel.textContent = 'Close';
        draw();
      } catch (e) {
        go.disabled = false; cancel.disabled = false; go.textContent = label;
        m.msg(`<span class="t-hot">Nothing was sent — ${esc(e.message)}</span>`);
      }
    });
  }

  function draw() {
    card.querySelectorAll('#segStatus button').forEach(b =>
      b.classList.toggle('on', b.dataset.v === f.status));
    const focus = f.alert ? checkByKey.get(f.alert) : null;
    const rows = sorted(filtered());
    $('resultCount').textContent = `${rows.length} of ${all.length} ${plural(all.length, 'lead', 'leads')}`;

    const note = $('focusNote');
    note.innerHTML = focus
      ? `<div class="banner info" style="margin-top:14px"><span class="material-symbols-outlined">filter_alt</span>
         <div style="flex:1">Showing only the ${num(focus.leads.length)} ${plural(focus.leads.length, 'lead', 'leads')} behind
         “${esc(focus.title)}”. The status, source, rep and search filters were cleared so that set is not hidden by them.</div>
         <button class="btn sm" id="focusClear">Show all leads</button></div>`
      : '';
    note.querySelector('#focusClear')?.addEventListener('click', () => { f.alert = null; draw(); });
    alertCard.querySelectorAll('[data-focus]').forEach(n =>
      n.classList.toggle('on', n.dataset.focus === f.alert));

    const host2 = $('leadTable');
    host2.innerHTML = all.length
      ? table(cols, rows, {
          onRow: true,
          empty: stateEmpty('No leads match these filters', 'Try clearing the search or widening the status filter.', 'search_off'),
        })
      : stateEmpty('No leads yet', 'They appear here the moment the router webhook receives one.', 'inbox');
    wireRows(host2, rows, leadDrawer);
    host2.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', ev => {
      /* The row itself opens the drawer; an action button must not do both. */
      ev.stopPropagation();
      const lead = rows.find(r => String(r.id) === b.dataset.id);
      const a = ACTIONS[b.dataset.act];
      if (lead && a) confirmAction(a, lead);
    }));
  }

  /* An alert that only describes a problem is a poster. Clicking a check filters
     the table to exactly its leads — and clears the other filters first, because
     a focus that lands inside a HOT-only or searched view would show a shorter
     list than the alert just promised, which reads as the alert lying. */
  function focusCheck(key) {
    f.alert = key; f.status = 'ALL'; f.source = 'ALL'; f.rep = 'ALL'; f.q = '';
    $('q').value = ''; $('fSource').value = 'ALL'; $('fRep').value = 'ALL';
    draw();
    $('leadTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openLead(id) {
    const lead = byId.get(String(id));
    if (lead) leadDrawer(lead);
  }

  alertCard.querySelectorAll('[data-focus]').forEach(n => {
    const run = () => focusCheck(n.dataset.focus);
    n.addEventListener('click', run);
    /* Keyboard-operable, because this row is the only route from the alert to
       the leads it is about. */
    n.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
    });
  });
  alertCard.querySelectorAll('[data-open-lead]').forEach(n => {
    const run = () => openLead(n.dataset.openLead);
    n.addEventListener('click', run);
    n.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
    });
  });
  alertCard.querySelectorAll('[data-lead]').forEach(b => b.addEventListener('click', ev => {
    /* The chip sits inside a row that filters the table; opening one lead and
       filtering to all of them at once would be two answers to one click. */
    ev.stopPropagation();
    openLead(b.dataset.lead);
  }));

  card.querySelectorAll('#segStatus button').forEach(b => b.addEventListener('click', () => {
    f.status = b.dataset.v; draw();
  }));
  $('q').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('fSource').addEventListener('change', e => { f.source = e.target.value; draw(); });
  $('fRep').addEventListener('change', e => { f.rep = e.target.value; draw(); });
  $('fSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
  draw();
};
