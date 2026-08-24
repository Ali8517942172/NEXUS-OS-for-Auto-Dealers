/* NEXUS OS — screens/team.js
   The roster and the per-rep scoreboard.

   Two facts drive every decision on this screen.

   1. The roster and the scoreboard are different tables. `users` owns who exists,
      what role they hold and whether their account is live; `v_team_performance`
      owns what they did. They are read separately and joined here, so a rep who
      has never touched a lead still appears (with an honest "no activity yet"
      rather than a fabricated zero), and a performance row that matches nobody
      in the directory is shown as exactly that instead of being dropped.

   2. A user is never deletable from this screen. `leads.assigned_to_id`
      references `users.id`; removing a row silently orphans every lead that
      person owned, and an orphaned lead has no owner, no escalation path and no
      one the 5-minute rule applies to. The drawer states the count that would be
      orphaned instead of offering the button.

   3. Nothing on this screen can show a member of staff's phone number, because
      nothing in the database holds one. `users` has id, name, email, role,
      status, slack_user_id and created_at — and no phone column. The absence is
      rendered where the number would go, with the reason, rather than the
      column being quietly dropped: a blank cell reads as "this rep left it
      empty", which would be a lie. Leads are the opposite case — `leads.phone`
      does exist, so every lead named on this screen is shown with it.

   The alert strip at the top holds two kinds of row: what the database filed
   against `screen = 'team'` in `v_needs_attention`, and the conditions only
   this screen can see, each derived from the three reads it already makes. No
   alert costs an extra round-trip, and a read that failed removes the alerts
   that depended on it and says so, rather than leaving a shorter list to read
   as a quieter dealership.

   Three users sit at status `pending_invite`. There is no endpoint that can
   invite them — `users` is service-role only from the browser and none of the
   deployed n8n webhooks sends an invitation — so the invite control is built,
   surfaced prominently as outstanding work, and left disabled with the reason
   on it. Nothing here is estimated: every number comes off a row, and a panel
   whose table failed to load says so rather than showing a plausible blank. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, initials, mins, n0, num, pct, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* Leads are read only to answer three questions the view cannot: who owns
   nothing, which assignments point at a user that no longer exists, and what a
   given rep is actually holding. The read is capped, and where a count depends
   on the cap the screen says the cap was hit rather than letting a windowed
   number read as a total. */
const LEAD_LIMIT = 1000;

const NO_INVITE =
  'No invite endpoint exists yet. The users table is service-role only from the browser, so RLS would reject the write, and none of the deployed n8n webhooks (ask-ai, finance-calc, lead-trigger, deals/closed-won, audit-kyc, erp-sync, lead-escalation) sends an invitation. Creating the account and emailing the link has to be built before this button can do anything.';
const NO_ROLE_WRITE =
  'Changing a role means writing to the users table, which is service-role only — the browser would be rejected by RLS — and no workflow accepts a role change either.';
const NO_DELETE =
  'Removing a user is deliberately not offered anywhere on this screen: leads.assigned_to_id points at users.id, so deleting the row would leave their leads with an owner that does not exist.';

/* `users` has no phone column. Verified against the live schema on 24 Aug 2026,
   not assumed: asking for one returns PostgREST 42703, and a 42703 does not blank
   a field, it rejects the whole request — which is exactly how this screen lost
   every per-rep lead count and its pipeline once already, by selecting
   `leads.lead_score`, a column that has never existed either. So the number is
   not fetched. Its absence is rendered where the number would go, because
   "this rep has no phone on file" and "this system has nowhere to keep a rep's
   phone" are different statements and only the second one is true. */
const NO_STAFF_PHONE =
  'No phone number is stored for any member of staff. The users table has no phone column at all, so there is nothing to show — this is a gap in what the database records, not a field this person left blank. Slack (slack_user_id) is the only staff handle the directory carries.';

/* This screen's id in `v_needs_attention.screen`. */
const SCREEN_ID = 'team';
const ATTN_LIMIT = 200;

/* Pipeline concentration. An even split across the reps who hold any pipeline is
   1/N, so on a small team somebody is always "above average" — the alert needs a
   floor as well as a multiple, and needs enough carriers for a share to mean
   anything at all. Two reps 60/40 is not a finding; one rep in five holding 62%
   of the money is. */
const CONCENTRATION_FLOOR = 0.40;
const MIN_CARRIERS = 3;

/* A WhatsApp handle. `v_needs_attention.title` is written by whichever branch
   raised the row, and on the conversations branch that column carries a display
   name which falls back to the raw chat id — so a handle can reach this screen.
   A LID contains no phone digits and identifies nobody; it is never rendered as
   a person's name. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;

const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const dt = ts => (ts && !Number.isNaN(Date.parse(ts)) ? new Date(ts).toLocaleString('en-GB', { hour12: false }) : '');
const nameList = (rows, n = 4) => {
  const names = rows.map(r => str(r.name)).filter(Boolean);
  if (!names.length) return '';
  const shown = names.slice(0, n).map(esc).join(', ');
  return names.length > n ? `${shown} and ${num(names.length - n)} more` : shown;
};

/* A lead's phone, beside their name. `leads.phone` exists, so a missing one here
   really is a lead we hold no number for — rendered as a dash that says so, not
   as an empty cell and never as a placeholder number. */
const leadPhone = l => (str(l?.phone)
  ? `<span class="mono">${esc(str(l.phone))}</span>`
  : '<span class="t-muted" title="No phone number is recorded on this lead.">\u2014</span>');

const low = v => String(v ?? '').trim().toLowerCase();
const valOf = r => (r.status === 'fulfilled' ? r.value : null);
const errOf = r => (r.status === 'rejected' ? (r.reason?.message || 'Unknown error') : null);

/* Sum a column across rows, returning null — not 0 — when no row carries it.
   "AED 0 of pipeline" and "the view does not report pipeline" are different
   statements and only one of them is true. */
function sumOf(rows, key) {
  let total = null;
  rows.forEach(r => { const x = n0(r?.[key]); if (x != null) total = (total ?? 0) + x; });
  return total;
}

/* ── One rep, as this screen sees them ───────────────────────────────────── */
const perfNum = (r, k) => n0(r.perf?.[k]);
const leadsAssigned = r => perfNum(r, 'leads_assigned');
const hotLeads      = r => perfNum(r, 'hot_leads');
const avgResponse   = r => perfNum(r, 'avg_response_minutes');
const withinSla     = r => perfNum(r, 'within_sla');
const breachedSla   = r => perfNum(r, 'breached_sla');
const pipelineOf    = r => perfNum(r, 'pipeline_aed');
/* Measured = the leads this rep was actually timed on. Null when neither
   counter exists, which is not the same as having been timed on none. */
const measured = r => {
  const w = withinSla(r), b = breachedSla(r);
  return (w == null && b == null) ? null : (w ?? 0) + (b ?? 0);
};
const slaRate = r => {
  const m = measured(r), w = withinSla(r);
  return (!m || w == null) ? null : (w / m) * 100;
};

const isPending    = r => low(r.status) === 'pending_invite';
const hasAccount   = r => !!r.status && !isPending(r);
const statusLabel  = r => {
  if (!r.status) return 'No status on file';
  if (isPending(r)) return 'Pending invite';
  return String(r.status).replace(/_/g, ' ');
};
const statusPill = r => {
  if (!r.status) return `<span class="t-muted">No status on file</span>`;
  if (isPending(r)) return pill('Pending invite', 'warm');
  return pill(statusLabel(r), hasAccount(r) ? 'ok' : undefined);
};

/* ── Screen ──────────────────────────────────────────────────────────────── */
SCREENS.team = async host => {
  /* The alert strip sits above the KPI row on purpose. "How many people are on
     the team" is a fact; "one rep is holding nothing while four HOT leads have
     no owner" is a job, and the job must not be the thing you scroll past. */
  const alertHost = el('div'); alertHost.style.marginBottom = '16px'; host.appendChild(alertHost);
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);

  /* allSettled, not catch(() => []): a directory that failed to read and a
     directory with nobody in it are opposite answers, and on this screen the
     second one would quietly imply the dealership has no staff. */
  const [usersR, perfR, leadsR, attnR] = await Promise.allSettled([
    /* Every column here was read off the live table. `slack_user_id` is the only
       contact handle the directory carries; there is deliberately no `phone` in
       this list because there is no such column — see NO_STAFF_PHONE. */
    db('users?select=id,name,email,role,status,slack_user_id,created_at&order=name.asc'),
    db('v_team_performance?select=*'),
    /* `lead_score` is NOT a column on leads — the score lives in ai_score alone.
       Asking for both made PostgREST reject the entire request with 42703, which
       took the roster's per-rep lead counts and pipeline down with it. Verified
       against the live schema, not the gate's stub, which happily serves a
       lead_score and so reported the broken query as clean.
       `phone` is on this list because leads really do carry one and every lead
       named on this screen shows it; `response_time_minutes` and `escalated_at`
       are what make "assigned but nothing has happened" answerable per lead
       rather than only per rep. */
    db('leads?select=id,name,email,phone,status,ai_score,source,vehicle_interest,budget_aed,'
       + `assigned_to,assigned_to_id,response_time_minutes,escalated_at,created_at&order=created_at.desc&limit=${LEAD_LIMIT}`),
    /* The shared alert view. Its failure costs the centrally-raised rows, not the
       screen, so it is settled alongside the rest rather than awaited first. */
    db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
       + `&screen=eq.${SCREEN_ID}&order=at.desc&limit=${ATTN_LIMIT}`),
  ]);

  const users = valOf(usersR), usersErr = errOf(usersR);
  const perf  = valOf(perfR),  perfErr  = errOf(perfR);
  const leads = valOf(leadsR), leadsErr = errOf(leadsR);
  const attn  = valOf(attnR),  attnErr  = errOf(attnR);

  /* ── Join the directory to the scoreboard ──────────────────────────────── */
  /* The view's key column is not guaranteed, so the match is tried on user id,
     then on email, then on name — in that order, because a name is the only one
     of the three two people can share. Unmatched rows on either side are kept
     and labelled; none is invented and none is thrown away. */
  const perfById = new Map(), perfByEmail = new Map(), perfByName = new Map();
  (perf || []).forEach(p => {
    const id = low(p.user_id ?? p.id); if (id && !perfById.has(id)) perfById.set(id, p);
    const em = low(p.email);           if (em && !perfByEmail.has(em)) perfByEmail.set(em, p);
    const nm = low(p.name);            if (nm && !perfByName.has(nm)) perfByName.set(nm, p);
  });
  const matched = new Set();
  const matchPerf = u => {
    const p = perfById.get(low(u.id)) || perfByEmail.get(low(u.email)) || perfByName.get(low(u.name)) || null;
    if (p) matched.add(p);
    return p;
  };

  const fromUsers = (users || []).map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
    /* The two contact fields the directory actually has. There is no third one:
       `users` holds no phone number, which the Contact column states rather than
       leaving a gap where a number would have gone. */
    slack: u.slack_user_id, created_at: u.created_at,
    perf: matchPerf(u), unlinked: false,
  }));
  const fromView = (perf || []).filter(p => !matched.has(p)).map(p => ({
    id: p.user_id ?? p.id ?? null, name: p.name, email: p.email, role: p.role, status: p.status,
    /* v_team_performance carries no Slack id and no created_at, so these stay
       null and render as "not in the directory" rather than as "none set". */
    slack: null, created_at: null,
    perf: p, unlinked: !!users,
  }));
  const roster = fromUsers.concat(fromView);

  /* ── What the leads table says about ownership ─────────────────────────── */
  const byOwner = new Map();
  (leads || []).forEach(l => {
    const k = low(l.assigned_to_id);
    if (!k) return;
    if (!byOwner.has(k)) byOwner.set(k, []);
    byOwner.get(k).push(l);
  });
  const ownedBy = r => (r.id ? (byOwner.get(low(r.id)) || []) : []);
  const unassigned = (leads || []).filter(l => !l.assigned_to_id);
  const rosterIds = new Set(roster.map(r => low(r.id)).filter(Boolean));
  /* An assignment pointing at an id nobody on the roster holds is the exact
     damage the missing delete button prevents. Only claimed when both sides
     were readable, otherwise it is an artefact of a failed read. */
  const orphaned = (leads && users)
    ? (leads || []).filter(l => l.assigned_to_id && !rosterIds.has(low(l.assigned_to_id)))
    : [];
  const leadsCapped = !!leads && leads.length >= LEAD_LIMIT;

  const pending = roster.filter(isPending);
  const withAccount = roster.filter(hasAccount);

  /* ── The conditions this screen raises itself ──────────────────────────────
     All of them come out of the three reads above. None adds a round-trip, and
     each one is null-safe in the same way the rest of this file is: a figure the
     view did not report is not a zero, so it never counts as evidence. */
  const unassignedHot = unassigned.filter(l => up(l.status) === 'HOT');

  /* "Holds nothing" is only claimable about someone who could hold something. A
     pending_invite seat has no account to assign to and is a different alert, and
     a rep the view never reported on has not been shown to be empty — only a
     reported nought, or an absent performance row plus a leads read that names
     them nowhere, is evidence of an idle rep. */
  const holdsNothing = r => {
    if (!hasAccount(r)) return false;
    if (ownedBy(r).length > 0) return false;
    const n = leadsAssigned(r);
    if (n == null) return !r.perf && !!leads && !!r.id;
    return n === 0;
  };
  const idle = roster.filter(holdsNothing);

  /* Leads against their name and not one of them timed. This is not "slow" — it
     is no response recorded at all, which is what the view reports when nobody
     ever replied. Kept separate from "no activity" (which means no leads either),
     because a rep sitting on work is a different problem from a rep with none. */
  const stalled = r => (leadsAssigned(r) ?? 0) > 0 && !(measured(r) > 0) && avgResponse(r) == null;
  const stalledReps = roster.filter(stalled);
  /* Their book, as the leads read sees it: a lead with no response_time_minutes
     has never been answered. Only counted where the leads read succeeded. */
  const untouchedOf = r => ownedBy(r).filter(l => n0(l.response_time_minutes) == null);

  const breachers = roster.filter(r => (breachedSla(r) ?? 0) > 0)
    .sort((a, b) => breachedSla(b) - breachedSla(a));
  const breachTotal = breachers.reduce((a, r) => a + breachedSla(r), 0);

  /* Pipeline concentration. Measured against the reps who hold any pipeline at
     all, not against the whole roster — including people with none would make
     every team look concentrated. */
  const carriers = roster.filter(r => (pipelineOf(r) ?? 0) > 0)
    .sort((a, b) => pipelineOf(b) - pipelineOf(a));
  const carriedTot = sumOf(carriers.map(r => r.perf), 'pipeline_aed');
  let concentration = null;
  if (carriers.length >= MIN_CARRIERS && carriedTot) {
    const even = 1 / carriers.length;
    const share = pipelineOf(carriers[0]) / carriedTot;
    if (share >= Math.max(CONCENTRATION_FLOOR, even * 2)) {
      concentration = { rep: carriers[0], share, even, total: carriedTot };
    }
  }

  /* Rows the performance view has activity for that match nobody in the
     directory. Only meaningful when the directory actually loaded. */
  const unlinkedReps = users ? roster.filter(r => r.unlinked) : [];

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!users && !perf) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('the team', usersErr || perfErr);
  } else {
    const withinTot   = sumOf(roster.map(r => r.perf).filter(Boolean), 'within_sla');
    const breachedTot = sumOf(roster.map(r => r.perf).filter(Boolean), 'breached_sla');
    const measuredTot = (withinTot == null && breachedTot == null) ? null : (withinTot ?? 0) + (breachedTot ?? 0);
    const pipelineTot = sumOf(roster.map(r => r.perf).filter(Boolean), 'pipeline_aed');
    const withPipeline = roster.filter(r => (pipelineOf(r) ?? 0) > 0).length;

    /* One team-wide response figure, weighted by how many leads each rep was
       actually timed on. An unweighted mean of per-rep means would let someone
       with a single fast lead cancel out someone carrying forty slow ones. */
    let weightSum = 0, weighted = 0;
    roster.forEach(r => {
      const a = avgResponse(r), m = measured(r);
      if (a != null && m) { weighted += a * m; weightSum += m; }
    });
    const teamAvg = weightSum ? weighted / weightSum : null;

    strip.innerHTML = [
      kpi('Team members', num(roster.length),
        usersErr
          ? '<span class="t-warm">Directory unreadable — counted from the performance view</span>'
          : `${num(withAccount.length)} with an account · ${num(pending.length)} pending invite`),
      kpi('Awaiting an invite', num(pending.length),
        pending.length
          ? '<span class="t-warm">No account, and nothing here can send one yet</span>'
          : '<span class="t-ok">Everyone on the roster has an account</span>',
        pending.length ? 't-warm' : ''),
      kpi('Within the 5-minute rule',
        measuredTot ? `${num(withinTot ?? 0)} / ${num(measuredTot)}` : '—',
        measuredTot
          ? `${pct((withinTot ?? 0) / measuredTot * 100)} · weighted average ${mins(teamAvg)}`
          : '<span class="t-muted">No rep row carries a response measurement</span>',
        measuredTot && (withinTot ?? 0) / measuredTot < 0.5 ? 't-hot' : ''),
      kpi('Pipeline in rep hands', pipelineTot == null ? '—' : aed(pipelineTot),
        pipelineTot == null
          ? '<span class="t-muted">The performance view reports no pipeline figure</span>'
          : `Held by ${num(withPipeline)} of ${num(roster.length)} on the roster`),
      kpi('Unassigned leads', leads ? num(unassigned.length) : '—',
        !leads
          ? `<span class="t-muted">Leads could not be read</span>`
          : unassigned.length
            /* Which of them are HOT is the whole point: an unowned COLD lead is
               a queue, an unowned HOT lead is the auto-assign trigger failing. */
            ? `<span class="t-hot">Nobody owns these</span>${unassignedHot.length ? ` · <span class="t-hot">${num(unassignedHot.length)} HOT</span>` : ' · none of them HOT'}`
            : '<span class="t-ok">Every lead read here has an owner</span>',
        leads && unassigned.length ? 't-hot' : ''),
    ].join('');
  }

  /* ── Alerts ───────────────────────────────────────────────────────────────
     One strip, holding both halves of "what on this screen needs a human": the
     rows the database filed against screen = 'team' in v_needs_attention, and
     the conditions only this screen can see. Every derived alert is computed
     from users / v_team_performance / leads, all three of which were read above
     regardless — no alert here costs a round-trip of its own.

     Severity colour goes through tone() in lib/format.js. That table now covers
     HOT / WARM / COLD, PENDING_INVITE, DEGRADED and the rest, and maps anything
     it has not been taught to 'cold' rather than to the empty string — which is
     what used to make an unknown severity render as a neutral note. Five screens
     had grown a private severity map to work around that; this one does not add
     a sixth. */
  let focusRoster = () => {};
  const alerts = [];
  const add = a => alerts.push({ source: 'local', ...a });

  const KIND_ICON = {
    sla_breach: 'timer_off', unassigned_lead: 'person_add_disabled',
    pending_invite: 'mark_email_unread', rep_idle: 'work_off',
    workflow_failure: 'error', escalation: 'priority_high',
  };

  /* The view's `ref` for a team row could be a user id, an email or a name. All
     three are tried, in that order, for the same reason the roster join uses it:
     a name is the only one of the three that two people can share. */
  const findRep = ref => {
    const k = low(ref);
    if (!k) return null;
    return roster.find(r => low(r.id) === k)
      || roster.find(r => low(r.email) === k)
      || roster.find(r => low(r.name) === k) || null;
  };

  (attn || []).forEach(it => {
    const who = findRep(it.ref);
    const t = str(it.title);
    const titleHtml = !t
      ? '<span class="t-muted">This alert carries no title</span>'
      : HANDLE.test(t)
        ? `<span class="mono">${esc(t)}</span> <span class="t-muted">— a WhatsApp handle, not a name</span>`
        : esc(t);
    alerts.push({
      source: 'view',
      sev: str(it.severity) || 'WARM',
      icon: KIND_ICON[low(it.kind)] || 'rule',
      at: it.at,
      titleHtml,
      detailHtml: (str(it.detail) ? esc(str(it.detail)) : 'v_needs_attention recorded no detail on this row.')
        + (who || it.ref == null ? ''
          : ` <span class="t-muted">Raised against <span class="mono">${esc(str(it.ref))}</span>, which matches nobody on the roster read here, so there is no row on this screen for it to open.</span>`),
      act: who ? () => openRep(who) : null,
      actLabel: 'Open rep',
    });
  });

  /* An invite nobody accepted is a seat nobody is covering. It is not an
     administrative loose end — it is a person the router cannot route to. */
  if (pending.length) {
    const oldest = pending.map(r => r.created_at).filter(Boolean).sort()[0] || null;
    add({
      sev: 'PENDING_INVITE', icon: 'mark_email_unread', at: oldest, atLabel: 'oldest seat made',
      titleHtml: `${num(pending.length)} ${plural(pending.length, 'seat is', 'seats are')} held by an invite nobody accepted`,
      detailHtml: `${nameList(pending) || `${num(pending.length)} ${plural(pending.length, 'person', 'people')}`} `
        + `${plural(pending.length, 'sits', 'sit')} at <span class="mono">pending_invite</span>. They cannot sign in, cannot be alerted when a HOT lead lands and cannot be assigned one, `
        + `so their share of the floor is being carried by whoever else is on it. `
        + (oldest ? `The oldest of these accounts was created ${esc(ago(oldest))}. ` : 'None of these rows carries a creation date, so how long they have been waiting is not knowable. ')
        + 'Sending the invitation is not built, so this stays outstanding until the endpoint exists.',
      act: () => focusRoster('PENDING'),
      actLabel: 'Show them',
      noHook: { label: `Send invite${plural(pending.length, '', 's')}`, why: NO_INVITE },
    });
  }

  /* The pairing the auto-assign trigger exists to prevent: money waiting on the
     doorstep and somebody standing in the showroom with nothing to do. */
  if (leads && unassignedHot.length) {
    const shown = unassignedHot.slice(0, 4).map(l =>
      `${esc(str(l.name) || 'Unnamed lead')} ${leadPhone(l)} <span class="t-muted">(${esc(ago(l.created_at))})</span>`).join(' · ');
    add({
      sev: 'HOT', icon: 'person_add_disabled', at: unassignedHot[0].created_at, atLabel: 'oldest arrived',
      titleHtml: `${num(unassignedHot.length)} HOT ${plural(unassignedHot.length, 'lead has', 'leads have')} no owner`
        + (idle.length ? ` while ${num(idle.length)} ${plural(idle.length, 'rep holds', 'reps hold')} nothing` : ''),
      detailHtml: `${shown}${unassignedHot.length > 4 ? ` and ${num(unassignedHot.length - 4)} more` : ''}. `
        + (idle.length ? `${nameList(idle)} ${plural(idle.length, 'has', 'have')} no lead at all against ${plural(idle.length, 'their name', 'their names')}. ` : '')
        + 'The auto-assign trigger is supposed to hand a HOT lead to the least-loaded rep, and these were handed to nobody, so on these rows it did not do its job. '
        + 'Whether it never fired or fired and failed is <em>not</em> readable from here: <span class="mono">leads</span> records who owns a lead and carries no record of who set the owner or when — no assigned_by, no assigned_at, no updated_at — so a trigger assignment and a hand assignment look identical afterwards. '
        + 'What can be said is that these rows have no owner of any kind.',
      act: () => go('leads'),
      actLabel: 'Open leads',
    });
  } else if (idle.length) {
    add({
      sev: 'WARM', icon: 'work_off',
      titleHtml: `${num(idle.length)} ${plural(idle.length, 'rep is', 'reps are')} holding no leads at all`,
      detailHtml: `${nameList(idle)} ${plural(idle.length, 'has', 'have')} an active account and no lead against ${plural(idle.length, 'their name', 'their names')} — `
        + `neither in <span class="mono">v_team_performance</span> nor in the ${leads ? `${num(leads.length)} ${plural(leads.length, 'lead', 'leads')} read here` : 'leads table, which did not load'}. `
        + (leads ? 'No HOT lead is unassigned right now, so nothing is going unworked because of it. ' : '')
        + 'A rep with nothing is new, away, or being skipped by the auto-assign trigger, and this screen cannot tell those three apart: the only thing stored is the finished assignment, never who made it.',
      act: () => focusRoster('IDLE'),
      actLabel: 'Show them',
    });
  }

  /* Assigned, and nothing has happened. Distinct from a slow rep — the view has
     not timed them on a single lead, which is what it reports when nobody ever
     replied at all. */
  if (stalledReps.length) {
    const worst = stalledReps.slice().sort((a, b) => (leadsAssigned(b) ?? 0) - (leadsAssigned(a) ?? 0));
    const held = worst.reduce((a, r) => a + (leadsAssigned(r) ?? 0), 0);
    const untouched = leads ? worst.reduce((a, r) => a + untouchedOf(r).length, 0) : null;
    add({
      sev: 'WARM', icon: 'hourglass_disabled',
      titleHtml: `${num(stalledReps.length)} ${plural(stalledReps.length, 'rep is', 'reps are')} holding ${num(held)} ${plural(held, 'lead', 'leads')} with no response recorded`,
      detailHtml: `${nameList(worst)} ${plural(stalledReps.length, 'has', 'have')} leads assigned and no measured response against ${plural(stalledReps.length, 'that name', 'those names')} — `
        + 'not a slow average, no <span class="mono">within_sla</span> or <span class="mono">breached_sla</span> count at all, which is what the view reports when nobody replied. '
        + (untouched != null
          ? `In the ${num(leads.length)} ${plural(leads.length, 'lead', 'leads')} read here, ${num(untouched)} of their ${plural(untouched, 'leads carries', 'leads carry')} no <span class="mono">response_time_minutes</span>${leadsCapped ? `, and that read is capped at ${num(LEAD_LIMIT)} so there may be more` : ''}.`
          : 'Leads could not be read, so this cannot be confirmed lead by lead.'),
      act: () => focusRoster('STALLED'),
      actLabel: 'Show them',
    });
  }

  /* The 5-minute rule, per rep. The team-wide figure is in the KPI strip; this
     names the people it is made of, because "62% within SLA" is not something
     anyone can act on and "Farah has nine breaches" is. */
  if (breachers.length) {
    add({
      sev: 'HOT', icon: 'timer_off',
      titleHtml: `${num(breachTotal)} ${plural(breachTotal, 'lead', 'leads')} breached the 5-minute rule across ${num(breachers.length)} ${plural(breachers.length, 'rep', 'reps')}`,
      detailHtml: breachers.slice(0, 5).map(r =>
        `${esc(str(r.name) || 'Unnamed')} <span class="t-hot">${num(breachedSla(r))}</span>`
        + `${avgResponse(r) == null ? '' : ` <span class="t-muted">(${esc(mins(avgResponse(r)))} average)</span>`}`).join(' · ')
        + `${breachers.length > 5 ? ` and ${num(breachers.length - 5)} more` : ''}. `
        + 'Each of these is a lead that waited longer than five minutes for a first reply — the window in which the odds of qualifying it drop by about four fifths. '
        + 'These counts come from the view itself and are all-time, not a window computed here.',
      act: () => focusRoster('BREACHED'),
      actLabel: 'Show them',
    });
  }

  /* One rep holding most of the money. Reported as a fact about the data and
     explicitly not as a diagnosis, because the data cannot support one. */
  if (concentration) {
    const c = concentration;
    add({
      sev: 'WARM', icon: 'balance',
      titleHtml: `${esc(str(c.rep.name) || 'One rep')} is holding ${esc(pct(c.share * 100))} of the pipeline`,
      detailHtml: `${esc(aed(pipelineOf(c.rep)))} of the ${esc(aed(c.total))} held across the ${num(carriers.length)} reps who carry any pipeline at all. `
        + `An even split would be ${esc(pct(c.even * 100))} each. `
        + `${leadsAssigned(c.rep) == null ? '' : `They are credited with ${num(leadsAssigned(c.rep))} ${plural(leadsAssigned(c.rep), 'lead', 'leads')}${hotLeads(c.rep) ? `, ${num(hotLeads(c.rep))} of them HOT` : ''}. `}`
        + 'The imbalance is measured, not inferred. Its <em>cause</em> is not available: the auto-assign trigger is meant to give each HOT lead to the least-loaded rep, and since <span class="mono">leads</span> stores only the finished owner — no assigned_by, no assignment timestamp, not even an updated_at — a lead the trigger placed and a lead a manager placed by hand are indistinguishable on this screen. '
        + (unassignedHot.length
          ? `What is visible is that ${num(unassignedHot.length)} HOT ${plural(unassignedHot.length, 'lead', 'leads')} ${plural(unassignedHot.length, 'has', 'have')} no owner at all, which the trigger should have prevented — so it is demonstrably not covering everything.`
          : leads
            ? 'What is visible is that every HOT lead read here does have an owner, so the trigger is placing work; the concentration is therefore either its input — only these reps eligible — or assignment done around it, and this screen cannot tell which.'
            : 'Leads could not be read, so whether any HOT lead is sitting unassigned could not be checked.'),
      act: () => openRep(c.rep),
      actLabel: 'Open rep',
    });
  }

  /* The exact damage the missing delete button prevents. */
  if (orphaned.length) {
    const shown = orphaned.slice(0, 3).map(l =>
      `${esc(str(l.name) || 'Unnamed lead')} ${leadPhone(l)}`).join(' · ');
    add({
      sev: 'HOT', icon: 'link_off', at: orphaned[0].created_at, atLabel: 'oldest arrived',
      titleHtml: `${num(orphaned.length)} ${plural(orphaned.length, 'lead points', 'leads point')} at a user who is not on the roster`,
      detailHtml: `${shown}${orphaned.length > 3 ? ` and ${num(orphaned.length - 3)} more` : ''}. `
        + 'Their <span class="mono">assigned_to_id</span> matches no row in <span class="mono">users</span>, so nobody is on the hook for them, nobody is alerted about them and the 5-minute rule applies to no one. '
        + 'This is what deleting a user does, which is why this screen never offers it.',
      act: () => go('leads'),
      actLabel: 'Open leads',
    });
  }

  /* Unassigned leads that are not HOT. Counted separately so the HOT alert above
     stays a statement about HOT leads and this one cannot double-count them. */
  const unassignedRest = unassigned.length - unassignedHot.length;
  if (leads && unassignedRest > 0) {
    const rest = unassigned.filter(l => up(l.status) !== 'HOT');
    add({
      sev: 'WARM', icon: 'inbox',
      at: rest[0]?.created_at || null, atLabel: 'oldest arrived',
      titleHtml: `${num(unassignedRest)} further ${plural(unassignedRest, 'lead has', 'leads have')} no owner`,
      detailHtml: `Not scored HOT, so ${plural(unassignedRest, 'it is', 'they are')} not in the alert above. `
        + `The newest arrived ${esc(ago(rest[0]?.created_at))}. Assignment happens on the lead itself, not here`
        + `${leadsCapped ? `, and this count comes from the ${num(LEAD_LIMIT)} most recent leads only, so it is a floor` : ''}.`,
      act: () => go('leads'),
      actLabel: 'Open leads',
    });
  }

  /* Activity with no account behind it. Low severity because nothing is going
     unworked — but the directory is wrong, and every count on this screen that
     starts from `users` is short by exactly this many people. */
  if (unlinkedReps.length) {
    add({
      sev: 'COLD', icon: 'person_search',
      titleHtml: `${num(unlinkedReps.length)} ${plural(unlinkedReps.length, 'person has', 'people have')} activity but no row in the user directory`,
      detailHtml: `${nameList(unlinkedReps)} ${plural(unlinkedReps.length, 'appears', 'appear')} in <span class="mono">v_team_performance</span> and ${plural(unlinkedReps.length, 'matches', 'match')} nobody in <span class="mono">users</span> by id, email or name. `
        + 'They are shown on the roster below, labelled as unlinked rather than dropped — but they have no account record, so their role and status are unknown and no invite or role control can apply to them.',
      act: () => focusRoster('ALL'),
      actLabel: 'Show roster',
    });
  }

  if (usersErr && perf) {
    add({
      sev: 'WARM', icon: 'person_off',
      atHtml: '<span class="t-muted" title="This is the state of this page load, not a stored condition.">this page load</span>',
      titleHtml: 'The user directory could not be read',
      detailHtml: `${esc(usersErr)}. Roles and account status below are whatever <span class="mono">v_team_performance</span> carries, `
        + 'anyone with no leads at all is missing from this page entirely, and pending invites cannot be counted at all.',
    });
  }

  /* ── Ordering and rendering ─────────────────────────────────────────────── */
  /* Order is taken from tone(), not from a private list of severity names. A
     second table here would be free to disagree with the colour on the same row —
     an alert painted cold and sorted as if it were warm — and the shared view is
     free to emit a severity nobody here has seen, which tone() already resolves. */
  const TONE_RANK = { hot: 0, warm: 1, ok: 1, cold: 2 };
  const rank = a => (TONE_RANK[tone(a.sev)] ?? 2);
  alerts.sort((a, b) => rank(a) - rank(b)
    || ((Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0)));

  const derivedCount = alerts.filter(a => a.source === 'local').length;
  const viewCount = (attn || []).length;

  /* Every count in this strip has to be explainable, and the two things that are
     not visible from the list itself are why it is this long and what is missing
     from it. A read that failed removes alerts; saying which read failed is the
     difference between a quiet screen and a screen that cannot see. */
  const notes = [
    attnErr
      ? `<span class="t-warm">v_needs_attention could not be read (${esc(attnErr)}), so anything the database filed against this screen — including any SLA branch it raises centrally — is missing from this strip. The ${num(derivedCount)} ${plural(derivedCount, 'alert', 'alerts')} above ${plural(derivedCount, 'was', 'were')} derived here.</span>`
      : `${num(viewCount)} ${plural(viewCount, 'row', 'rows')} from v_needs_attention where screen = ${SCREEN_ID}${viewCount ? '' : ' (it returned none today)'}, and ${num(derivedCount)} derived here from `
        + `${users ? `${num(users.length)} directory ${plural(users.length, 'row', 'rows')}` : 'no directory rows'}, `
        + `${perf ? `${num(perf.length)} performance ${plural(perf.length, 'row', 'rows')}` : 'no performance rows'} and `
        + `${leads ? `${num(leads.length)} ${plural(leads.length, 'lead', 'leads')}` : 'no leads'}.`,
    perfErr
      ? `<span class="t-warm">The performance view did not load (${esc(perfErr)}), so SLA breaches, pipeline concentration and reps holding unworked leads were not checked at all — they are absent from this list, not clear.</span>`
      : '',
    leadsErr
      ? `<span class="t-warm">Leads did not load (${esc(leadsErr)}), so unassigned leads, HOT leads with no owner and assignments pointing at a missing user were not checked.</span>`
      : '',
    leadsCapped
      ? `The leads read stopped at ${num(LEAD_LIMIT)} rows, so every lead-derived count in this strip is a floor rather than a total.`
      : '',
    `Staff phone numbers appear nowhere in this strip because they appear nowhere in the database: ${esc(NO_STAFF_PHONE)} Leads named above carry their own number, or an explicit dash where we hold none.`,
  ].filter(Boolean);
  const notesHtml = notes.join('<br>');

  const CHECKED = 'Checked: every row v_needs_attention filed against this screen, seats still at pending_invite, '
    + 'reps holding no leads while HOT leads sit unassigned, reps holding leads with no response recorded against a single one, '
    + 'one rep carrying a disproportionate share of the pipeline, reps with an SLA breach, leads whose assignment points at a user who is not on the roster, '
    + 'and performance rows with no account behind them.';

  const waitedHtml = a => {
    if (a.atHtml) return a.atHtml;
    if (a.at && !Number.isNaN(Date.parse(a.at))) {
      /* The label matters as much as the figure. A view row carries the moment
         the condition was recorded, so it was "raised" then; a derived row is
         timed off the oldest thing it is about, and calling that "raised" would
         claim a clock this screen does not have. */
      return `<span title="${esc(dt(a.at))}">${esc(a.atLabel || (a.source === 'view' ? 'raised' : 'oldest'))} ${esc(ago(a.at))}</span>`;
    }
    /* No clock is invented for a condition that has no moment attached. "How long
       has one rep held 62% of the pipeline" is not a question v_team_performance
       can answer — it reports a state, not when the state began. */
    return `<span class="t-muted" title="${esc(a.source === 'view' ? 'This alert carries no timestamp.' : 'This is a standing condition computed from the current rows; nothing records when it started.')}">no start time</span>`;
  };

  const alertItem = (a, i) => {
    const clickable = typeof a.act === 'function';
    return `<div class="list-item"${clickable ? ` role="button" tabindex="0" data-alert="${i}"` : ' style="cursor:default"'}>
      <span class="material-symbols-outlined t-${esc(tone(a.sev))}" style="font-size:20px" aria-hidden="true">${esc(a.icon)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${a.titleHtml}${pill(String(a.sev).replace(/_/g, ' '), tone(a.sev))}
          ${a.source === 'view' ? '<span class="chip" title="Raised by v_needs_attention, the shared cross-screen alert view, not computed on this screen.">shared</span>' : ''}
        </div>
        <div class="cell-sub" style="white-space:normal">${a.detailHtml}</div>
      </div>
      <div style="text-align:right;flex-shrink:0" class="cell-sub">${waitedHtml(a)}
        ${clickable ? `<div class="t-muted">${esc(a.actLabel || 'Open')}</div>` : ''}</div>
      ${a.noHook ? `<button class="btn sm" disabled title="${esc(a.noHook.why)}">${esc(a.noHook.label)}</button>` : ''}
      ${clickable ? '<span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">chevron_right</span>' : ''}
    </div>`;
  };

  if (!alerts.length) {
    /* No empty box. "Nothing needs a human" is only worth printing when it names
       what was looked at — otherwise it is indistinguishable from a panel that
       failed to render, and v_needs_attention genuinely returns nothing for this
       screen today, so this is the branch that runs. */
    alertHost.innerHTML = `<div class="card">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span class="material-symbols-outlined t-ok" style="font-size:20px" aria-hidden="true">task_alt</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">Nothing on the team screen needs a human right now</div>
          <div class="cell-sub" style="white-space:normal;margin-top:6px">${esc(CHECKED)}</div>
          <div class="cell-sub" style="white-space:normal;margin-top:6px">${notesHtml}</div>
        </div></div></div>`;
  } else {
    alertHost.innerHTML = `<div class="card flush">
      <div class="card-head"><div style="min-width:0">
        <div class="card-title">Needs attention · ${num(alerts.length)}</div>
        <div class="card-sub" style="white-space:normal">${esc(CHECKED)}</div></div></div>
      <div>${alerts.map(alertItem).join('')}</div>
      <div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
        <div class="cell-sub" style="white-space:normal">${notesHtml}</div></div></div>`;
    const fire = i => { const a = alerts[Number(i)]; if (a && typeof a.act === 'function') a.act(); };
    alertHost.querySelectorAll('[data-alert]').forEach(node => {
      node.addEventListener('click', () => fire(node.dataset.alert));
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(node.dataset.alert); }
      });
    });
  }

  if (!users && !perf) return;   /* the strip already carries the failure */

  /* ── Roster & performance ──────────────────────────────────────────────── */
  const card = el('div', 'card flush'); body.appendChild(card);

  const noActivity = r => !r.perf
    || (!(leadsAssigned(r) > 0) && !(hotLeads(r) > 0) && !(measured(r) > 0)
        && !(pipelineOf(r) > 0) && ownedBy(r).length === 0);

  /* Each alert in the strip above hands the roster the exact set it counted, so
     the list under the toolbar can never disagree with the number in the alert.
     That is only true if every alert has a slice to land in — hence IDLE,
     STALLED and BREACHED, which exist to be the destination of a specific
     alert rather than as browsing filters. */
  const VIEWS = {
    ALL:      { label: 'All',                    match: () => true },
    ACCOUNT:  { label: 'With an account',        match: hasAccount },
    PENDING:  { label: 'Pending invite',         match: isPending },
    IDLE:     { label: 'Holding nothing',        match: holdsNothing },
    STALLED:  { label: 'Leads, no response',     match: stalled },
    BREACHED: { label: 'Breached SLA',           match: r => (breachedSla(r) ?? 0) > 0 },
    QUIET:    { label: 'No activity yet',        match: noActivity },
  };
  /* Seven segments do not fit a toolbar. The three condition slices are only
     offered when they contain somebody — an always-empty filter is furniture,
     and a filter that is present and empty invites the reading that it was
     checked and came back clean, which is the alert strip's job to say. */
  const ALWAYS_SHOWN = new Set(['ALL', 'ACCOUNT', 'PENDING', 'QUIET']);
  const VIEW_KEYS = Object.keys(VIEWS);

  /* Sorting. Every key sinks the rows it cannot speak about to the bottom
     regardless of direction — a rep the view never reported on is not the
     fastest responder on the team, and putting them at the top of an ascending
     response sort would say exactly that. */
  const SORTS = {
    name:     { type: 'text', get: r => r.name,          dir: 1  },
    role:     { type: 'text', get: r => r.role,          dir: 1  },
    account:  { type: 'text', get: r => statusLabel(r),  dir: 1  },
    leads:    { type: 'num',  get: leadsAssigned,        dir: -1 },
    hot:      { type: 'num',  get: hotLeads,             dir: -1 },
    response: { type: 'num',  get: avgResponse,          dir: -1 },
    sla:      { type: 'num',  get: slaRate,              dir: 1  },
    pipeline: { type: 'num',  get: pipelineOf,           dir: -1 },
  };
  const f = { view: 'ALL', q: '', sort: 'leads', dir: SORTS.leads.dir };

  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  function sortRows(rows) {
    const s = SORTS[f.sort];
    if (s.type === 'text') {
      const has = r => !!String(s.get(r) ?? '').trim();
      return rows.filter(has)
        .sort((a, b) => f.dir * String(s.get(a)).localeCompare(String(s.get(b))) || byName(a, b))
        .concat(rows.filter(r => !has(r)).sort(byName));
    }
    return rows.filter(r => s.get(r) != null)
      .sort((a, b) => f.dir * (s.get(a) - s.get(b)) || byName(a, b))
      .concat(rows.filter(r => s.get(r) == null).sort(byName));
  }

  const notReported = '<span class="t-muted">Not reported</span>';
  const cols = [
    { label: 'Name', strong: true, sort: 'name', render: r => `<div style="display:flex;align-items:center;gap:10px">
        <div class="avatar">${esc(initials(r.name))}</div>
        <div><div>${esc(r.name || 'Unnamed')}</div>
          ${r.unlinked ? '<div class="cell-sub t-warm">Not in the user directory</div>' : ''}
        </div></div>` },
    /* Contact, spelled out rather than implied. The phone line is the point of
       this column: every other screen shows a person's number beside their name,
       and a rep is the one kind of person this dashboard cannot do that for. The
       dash is rendered with the reason on it so nobody reads it as "this rep did
       not give us their number" — the column does not exist to be empty. */
    { label: 'Contact', render: r => `
        <div class="cell-sub">${r.email ? esc(r.email) : '<span class="t-muted">No email on file</span>'}</div>
        <div class="cell-sub">Phone <span class="t-muted" title="${esc(NO_STAFF_PHONE)}">\u2014 not recorded anywhere</span></div>
        <div class="cell-sub">${r.slack
          ? `Slack <span class="mono">${esc(r.slack)}</span>`
          : r.unlinked
            ? '<span class="t-muted">No directory row, so no Slack id either</span>'
            : '<span class="t-muted">No Slack id on file</span>'}</div>` },
    { label: 'Role', sort: 'role', render: r => r.role
        ? `<span class="chip">${esc(r.role)}</span>`
        : '<span class="t-muted">No role set</span>' },
    { label: 'Account', sort: 'account', render: r => statusPill(r) },
    { label: 'Leads', align: 'r', sort: 'leads', render: r => {
        const n = leadsAssigned(r);
        if (n == null) return notReported;
        const owned = ownedBy(r).length;
        return `${num(n)}${owned && owned !== n ? `<div class="cell-sub">${num(owned)} in the leads read</div>` : ''}`;
      } },
    { label: 'HOT', align: 'r', sort: 'hot', render: r => {
        const n = hotLeads(r);
        return n == null ? notReported : `<span class="${n > 0 ? 't-hot' : 't-muted'}">${num(n)}</span>`;
      } },
    { label: 'Avg response', align: 'r', sort: 'response', render: r => {
        const a = avgResponse(r);
        if (a == null) return '<span class="t-muted">Not measured</span>';
        return `<span class="${a > 5 ? 't-hot' : 't-ok'}">${mins(a)}</span>`;
      } },
    { label: 'Within SLA', align: 'r', sort: 'sla', render: r => {
        const m = measured(r), w = withinSla(r);
        if (!m) return '<span class="t-muted">Nothing measured</span>';
        const rate = slaRate(r);
        return `${num(w ?? 0)} / ${num(m)}<div class="cell-sub ${rate != null && rate < 50 ? 't-hot' : ''}">${pct(rate)}</div>`;
      } },
    { label: 'Pipeline', align: 'r', sort: 'pipeline', render: r => {
        const p = pipelineOf(r);
        return p == null ? notReported : aed(p);
      } },
    { label: 'Invite', align: 'r', render: r => isPending(r)
        ? `<button class="btn sm" disabled aria-label="Send an invite to ${esc(r.name || 'this team member')}"
             title="${esc(NO_INVITE)}">Invite</button>`
        : '<span class="t-muted">—</span>' },
  ];

  const counts = {};
  VIEW_KEYS.forEach(k => { counts[k] = roster.filter(VIEWS[k].match).length; });
  const offeredViews = VIEW_KEYS.filter(k => ALWAYS_SHOWN.has(k) || counts[k] > 0);

  card.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Roster &amp; performance</div>
      <div class="card-sub">Who exists comes from <span class="mono">users</span>; what they did comes from
        <span class="mono">v_team_performance</span>. Sort by any column header. Click a row for the full record.
        ${perfErr ? `<span class="t-warm">The performance view could not be read (${esc(perfErr)}), so only the roster is shown.</span>` : ''}</div>
    </div></div>
    <div class="toolbar">
      <div class="seg" id="tSegView" role="group" aria-label="Filter the roster">
        ${offeredViews.map((k, i) => `<button data-v="${esc(k)}" class="${i === 0 ? 'on' : ''}">${esc(VIEWS[k].label)} · ${num(counts[k])}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="tq" aria-label="Search the roster" placeholder="Search name, email or role" /></div>
      <div class="t-muted num" id="tCount"></div>
    </div>
    <div id="tTable"></div>`;

  const th = card.querySelector('#tTable');
  const countEl = card.querySelector('#tCount');

  const visible = () => {
    const q = f.q.trim().toLowerCase();
    return roster.filter(r => {
      if (!VIEWS[f.view].match(r)) return false;
      if (!q) return true;
      return [r.name, r.email, r.role, r.status].some(v => low(v).includes(q));
    });
  };

  /* table() escapes its column labels, so the sort affordance is attached after
     render: each sortable header becomes a real button (keyboard reachable,
     with its own label) that inherits the header's own type, and the th carries
     aria-sort so a screen reader is told the order it is reading. */
  function decorateHeaders() {
    const cells = th.querySelectorAll('thead th');
    cells.forEach((cell, i) => {
      const col = cols[i];
      if (!col?.sort) return;   /* the invite column is not a measure of anything */
      const active = f.sort === col.sort;
      const asc = f.dir === 1;
      const icon = active ? (asc ? 'arrow_upward' : 'arrow_downward') : 'unfold_more';
      cell.setAttribute('aria-sort', active ? (asc ? 'ascending' : 'descending') : 'none');
      cell.innerHTML = `<button type="button" data-sort="${esc(col.sort)}"
        aria-label="Sort by ${esc(col.label)}${active ? (asc ? ', currently ascending' : ', currently descending') : ''}"
        style="background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;letter-spacing:inherit;
               text-transform:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
        ${esc(col.label)}<span class="material-symbols-outlined ${active ? '' : 't-muted'}"
          style="font-size:14px;opacity:${active ? 1 : .5}">${icon}</span></button>`;
      cell.querySelector('button').addEventListener('click', () => {
        if (f.sort === col.sort) f.dir = -f.dir;
        else { f.sort = col.sort; f.dir = SORTS[col.sort].dir; }
        draw();
      });
    });
  }

  function draw() {
    if (!roster.length) {
      countEl.textContent = '';
      th.innerHTML = stateEmpty('Nobody on the team yet',
        'The users table has no rows and the performance view returned none either, so there is no roster to report on.', 'groups');
      return;
    }
    const rows = sortRows(visible());
    countEl.textContent = `${rows.length} of ${roster.length}`;
    th.innerHTML = table(cols, rows, {
      onRow: true,
      /* The empty state names the reason it is empty. "Everyone has activity" is
         only true when the quiet slice itself is empty — say it while a search
         box is also filtering and it is a claim about the wrong set. */
      empty: (f.view === 'QUIET' && !f.q.trim())
        ? stateEmpty('Everyone has activity',
            'Every person on the roster has leads, a measured response or pipeline against their name.', 'task_alt')
        : stateEmpty('Nobody matches these filters',
            'Clear the search or pick another slice of the roster.', 'filter_alt_off'),
    });
    decorateHeaders();
    wireRows(th, rows, openRep);
  }

  card.querySelectorAll('#tSegView button').forEach(b => b.addEventListener('click', () => {
    card.querySelectorAll('#tSegView button').forEach(x => x.classList.toggle('on', x === b));
    f.view = b.dataset.v; draw();
  }));
  card.querySelector('#tq').addEventListener('input', e => { f.q = e.target.value; draw(); });

  /* The pending-invite banner hands over the exact set it counted, search
     cleared, so the list under the toolbar can never disagree with the number
     in the banner above it. */
  focusRoster = view => {
    f.view = view; f.q = '';
    card.querySelector('#tq').value = '';
    card.querySelectorAll('#tSegView button').forEach(x => x.classList.toggle('on', x.dataset.v === view));
    draw();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  draw();

  /* ── Workload and the 5-minute rule ────────────────────────────────────── */
  const pair = el('div', 'grid g2'); pair.style.marginTop = '16px'; body.appendChild(pair);

  const workload = el('div', 'card'); pair.appendChild(workload);
  const carrying = roster.filter(r => (leadsAssigned(r) ?? 0) > 0)
    .sort((a, b) => leadsAssigned(b) - leadsAssigned(a));
  if (perfErr) {
    workload.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Workload by rep</div>
      ${stateError('the performance view', perfErr)}`;
  } else if (!carrying.length) {
    workload.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Workload by rep</div>
      ${stateEmpty('No leads assigned to anyone',
        'The performance view reports no assigned leads against a single person on the roster.', 'person_off')}`;
  } else {
    const top = leadsAssigned(carrying[0]) || 1;
    const totalAssigned = carrying.reduce((a, r) => a + leadsAssigned(r), 0);
    workload.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Workload by rep</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${carrying.map(r => {
          const n = leadsAssigned(r);
          const hot = hotLeads(r);
          return `<div style="display:flex;align-items:center;gap:12px">
            <div style="width:120px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || 'Unnamed')}</div>
            <div class="bar" style="flex:1;height:10px"><i style="width:${(n / top * 100).toFixed(1)}%"></i></div>
            <div class="num t-muted" style="width:88px;text-align:right">${num(n)}${hot ? ` · <span class="t-hot">${num(hot)} hot</span>` : ''}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${num(totalAssigned)} assigned lead${totalAssigned === 1 ? '' : 's'} across ${num(carrying.length)} of ${num(roster.length)} on the roster.
        ${leads ? `${num(unassigned.length)} more ${unassigned.length === 1 ? 'is' : 'are'} unassigned${unassignedHot.length ? `, ${num(unassignedHot.length)} of them HOT` : ''}${leadsCapped ? ` within the ${num(LEAD_LIMIT)} most recent leads read` : ''}.` : 'Leads could not be read, so unassigned leads are not counted here.'}
        ${idle.length ? `${nameList(idle)} ${plural(idle.length, 'holds', 'hold')} nothing at all and so ${plural(idle.length, 'has', 'have')} no bar here.` : ''}
      </div>
      <div class="cell-sub" style="margin-top:8px;white-space:normal">
        ${concentration
          ? `${esc(str(concentration.rep.name) || 'The top rep')} holds ${esc(pct(concentration.share * 100))} of the pipeline against an even share of ${esc(pct(concentration.even * 100))}. `
          : 'No single rep holds twice an even share of the pipeline. '}
        A HOT lead is supposed to be auto-assigned to the least-loaded rep, so an uneven bar chart is either that trigger not firing or assignments made by hand around it —
        and this screen cannot tell you which: <span class="mono">leads</span> stores the owner and nothing about how the owner got there (no assigned_by, no assignment timestamp, no updated_at).
        The one thing it can settle is whether the trigger is placing HOT work at all, which is the unassigned-HOT count above.
      </div>`;
  }

  const sla = el('div', 'card'); pair.appendChild(sla);
  const timed = roster.filter(r => (measured(r) ?? 0) > 0);
  if (perfErr) {
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule</div>
      ${stateError('the performance view', perfErr)}`;
  } else if (!timed.length) {
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule</div>
      ${stateEmpty('No response times measured yet',
        'No row in the performance view carries a within_sla or breached_sla count, so nobody can be scored against the 5-minute rule.', 'timer')}`;
  } else {
    const w = timed.reduce((a, r) => a + (withinSla(r) ?? 0), 0);
    const m = timed.reduce((a, r) => a + measured(r), 0);
    const breach = m - w;
    const worst = timed.filter(r => (breachedSla(r) ?? 0) > 0)
      .sort((a, b) => breachedSla(b) - breachedSla(a)).slice(0, 5);
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule · ${num(m)} measured lead${m === 1 ? '' : 's'}</div>
      <div class="stackbar">
        <i style="width:${(w / m * 100).toFixed(1)}%;background:var(--ok)"></i>
        <i style="width:${(breach / m * 100).toFixed(1)}%;background:var(--hot)"></i>
      </div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span>
          <span style="font-weight:500">Answered within 5 min</span><span class="t-muted num">${num(w)} · ${pct(w / m * 100)}</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--hot)"></span>
          <span style="font-weight:500">Breached</span><span class="t-muted num">${num(breach)} · ${pct(breach / m * 100)}</span></div>
      </div>
      ${worst.length ? `<div class="label-caps" style="margin:16px 0 8px">Most breaches</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${worst.map(r => `<div style="display:flex;align-items:center;gap:12px">
            <div style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || 'Unnamed')}</div>
            <div class="cell-sub">${mins(avgResponse(r))} average</div>
            <div class="num t-hot" style="width:64px;text-align:right">${num(breachedSla(r))}</div>
          </div>`).join('')}
        </div>` : '<div class="cell-sub" style="margin-top:12px">Nobody on the roster has a breach against their name.</div>'}
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${num(timed.length)} of ${num(roster.length)} on the roster have been timed on a lead. The rest carry no measurement,
        which is not the same as being fast.</div>`;
  }

  /* ── One rep, in full ──────────────────────────────────────────────────── */
  function openRep(r) {
    const owned = ownedBy(r);
    const m = measured(r), w = withinSla(r), b = breachedSla(r);
    /* What a delete would strand, stated from both sources rather than one.
       The view's figure is all-time; the leads read here is a capped window, so
       quoting only the window would let "0 leads would be stranded" appear next
       to a rep the view credits with nine. */
    const strandBits = [];
    if (leadsAssigned(r) != null) {
      strandBits.push(`${num(leadsAssigned(r))} lead${leadsAssigned(r) === 1 ? '' : 's'} against their name in the performance view`);
    }
    if (leads && r.id) {
      strandBits.push(`${num(owned.length)} of the ${num(leads.length)} most recent leads read here pointing at their id${leadsCapped ? ', and that read is capped so there may be more' : ''}`);
    }

    const leadList = !leads
      ? `<div class="cell-sub">Leads could not be read (${esc(leadsErr || 'unknown error')}), so this rep's book cannot be listed.</div>`
      : !r.id
        ? '<div class="cell-sub">This person has no user id on the roster, so no lead can be matched to them.</div>'
        : !owned.length
          ? stateEmpty('No leads on this rep',
              leadsCapped
                ? `Nothing in the ${LEAD_LIMIT} most recent leads is assigned to them; older leads are not on this page.`
                : 'No lead in the table names them as owner.', 'person_search')
          : `<div>${owned.slice(0, 10).map(l => `<div class="list-item" style="cursor:default">
              <div style="flex:1;min-width:0">
                <div style="font-weight:500;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
                  ${esc(l.name || 'Unnamed lead')} ${leadPhone(l)}</div>
                <div class="cell-sub">${esc(l.vehicle_interest || 'No vehicle noted')} · ${esc(ago(l.created_at))}
                  ${n0(l.response_time_minutes) == null
                    ? ' · <span class="t-hot">no reply recorded</span>'
                    : ` · answered in ${esc(mins(l.response_time_minutes))}`}
                  ${l.escalated_at ? ` · <span class="t-warm">escalated ${esc(ago(l.escalated_at))}</span>` : ''}</div>
              </div>
              ${l.status ? pill(l.status) : ''}
              <div class="num cell-sub">${n0(l.budget_aed) == null ? '' : aed(l.budget_aed)}</div>
            </div>`).join('')}
            ${owned.length > 10 ? `<div class="cell-sub" style="padding:8px 0">and ${num(owned.length - 10)} more.</div>` : ''}</div>`;

    openDrawer(`
      <div class="drawer-head">
        <div class="avatar">${esc(initials(r.name))}</div>
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(r.name || 'Unnamed')}</h2>
          <div class="cell-sub">${esc(r.role || 'No role set')} · ${esc(r.email || 'No email on file')}</div>
          <div class="cell-sub mono">${esc(r.id ?? 'no user id')}</div>
        </div>
        <button class="btn ghost sm" id="tClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Identity &amp; contact</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Email</dt><dd>${r.email ? esc(r.email) : '<span class="t-muted">No email on file</span>'}</dd>
            <dt>Phone</dt><dd><span class="t-muted">\u2014</span></dd>
            <dt>Slack</dt><dd>${r.slack ? `<span class="mono">${esc(r.slack)}</span>` : '<span class="t-muted">No Slack id on file</span>'}</dd>
            <dt>User id</dt><dd class="mono">${esc(r.id ?? 'none')}</dd>
            <dt>Account created</dt><dd>${r.created_at ? `${esc(ago(r.created_at))} <span class="t-muted">(${esc(dt(r.created_at))})</span>` : '<span class="t-muted">Not recorded on this row</span>'}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:12px;white-space:normal">${esc(NO_STAFF_PHONE)}
            Their leads below each show their own number, because <span class="mono">leads.phone</span> does exist.</div>
        </div>

        <div class="section">
          <div class="label-caps">Account</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${statusPill(r)}${r.unlinked ? pill('Not in the user directory', 'warm') : ''}
          </div>
          ${isPending(r) ? `<div class="banner warm" style="margin-top:12px">
            <span class="material-symbols-outlined">mark_email_unread</span>
            <div>This person cannot sign in, cannot be alerted and cannot be assigned a lead until the account exists.
            Sending the invitation is not built yet.</div></div>` : ''}
          ${r.unlinked ? `<div class="cell-sub" style="margin-top:12px;white-space:normal">
            This row came from <span class="mono">v_team_performance</span> and matched nobody in <span class="mono">users</span> by id,
            email or name. They have activity against their name but no account record.</div>` : ''}
        </div>

        <div class="section">
          <div class="label-caps">Performance</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Leads assigned</dt><dd class="num">${leadsAssigned(r) == null ? notReported : num(leadsAssigned(r))}</dd>
            <dt>HOT leads</dt><dd class="num">${hotLeads(r) == null ? notReported : num(hotLeads(r))}</dd>
            <dt>Avg response</dt><dd class="num">${avgResponse(r) == null ? '<span class="t-muted">Not measured</span>' : `<span class="${avgResponse(r) > 5 ? 't-hot' : 't-ok'}">${mins(avgResponse(r))}</span>`}</dd>
            <dt>Within 5 min</dt><dd class="num">${m ? `${num(w ?? 0)} / ${num(m)} · ${pct(slaRate(r))}` : '<span class="t-muted">Nothing measured</span>'}</dd>
            <dt>Breached</dt><dd class="num">${b == null ? notReported : `<span class="${b > 0 ? 't-hot' : ''}">${num(b)}</span>`}</dd>
            <dt>Pipeline</dt><dd class="num">${pipelineOf(r) == null ? notReported : aed(pipelineOf(r))}</dd>
          </dl>
          ${!r.perf ? `<div class="cell-sub" style="margin-top:12px;white-space:normal">
            ${perfErr ? `The performance view could not be read (${esc(perfErr)}).`
                      : 'The performance view has no row for this person, so nothing has been recorded against them yet.'}</div>` : ''}
        </div>

        <div class="section">
          <div class="label-caps">Their leads</div>
          <div style="margin-top:8px">${leadList}</div>
        </div>

        <div class="section">
          <div class="label-caps">Why there is no delete</div>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">
            ${esc(NO_DELETE)}${strandBits.length
              ? ` They have ${strandBits.join(' and ')} — every one of those would be left ownerless.`
              : ''}
          </div>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" disabled title="${esc(NO_INVITE)}">${isPending(r) ? 'Send invite' : 'Resend invite'}</button>
        <button class="btn" disabled title="${esc(NO_ROLE_WRITE)}">Change role</button>
        <button class="btn ghost" id="tGoLeadsDrawer">Open the leads screen</button>
      </div>`);
    $('tClose').addEventListener('click', closeDrawer);
    $('tGoLeadsDrawer').addEventListener('click', () => go('leads'));
  }
};
