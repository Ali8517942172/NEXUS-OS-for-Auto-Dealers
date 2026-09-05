/* NEXUS OS — screens/team.js
   The roster and the per-rep scoreboard.

   Two facts drive every decision on this screen.

   1. The roster and the scoreboard are read separately, but they are not
      independent sources and this screen no longer implies they are. `users`
      owns who exists, what role they hold and whether their account is live;
      `v_team_performance` owns what they did — and its live definition is
      `FROM users u LEFT JOIN leads l`, so every performance row IS a users row,
      read through the same policy. Reading both still buys something real: a rep
      who has never touched a lead still appears (with an honest "no activity
      yet" rather than a fabricated zero), and the join is written so that if the
      view is ever rebuilt on another source, a row matching nobody in the
      directory is shown as exactly that instead of being dropped. What it does
      not buy is corroboration — the two reads cannot disagree about who exists —
      so nothing here claims a cross-check between them.

   2. A user is never deletable from this screen, and the reason is not the one
      this comment used to give. `leads_assigned_to_id_fkey` is ON DELETE SET
      NULL — read off the live catalogue, not assumed — so deleting a user cannot
      leave a lead pointing at a row that is gone: Postgres nulls the column and
      those leads become unassigned, which is a condition this screen already
      counts and alerts on. The two true reasons are that the browser could not
      perform the delete at all (`users` carries one policy for `authenticated`,
      a SELECT with USING (true), and nothing that writes), and that the leads
      would lose their owner silently — `leads` stores who owns a lead and
      nothing about how or when the owner got there, so afterwards a lead that
      was never assigned and a lead whose rep was deleted are the same row. The
      drawer states the count that would be handed back to the unassigned queue
      instead of offering the button.

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

   4. THE ROSTER IS ONE PERSON (24 Aug 2026). `users` held four rows; three were
      seeded `sales_rep` records at `pending_invite` with a NULL email — nobody
      was ever invited, because there was no address to invite — and they have
      been deleted. What remains is Ali Asgher, senior_rep, online, and one row
      in `v_team_performance` behind him.

      That changes what this screen is allowed to say, not just what it shows.
      One rep holding all the pipeline is not concentration, it is a roster of
      one; a within-SLA rate over a single measured lead can only be 0% or 100%,
      so the percentage adds authority without adding information; and a bar
      chart of one bar is 100% wide by construction and reads as a full load.
      Each of those is withdrawn below, with one line saying why, rather than
      printed with a caveat under it. The comparisons come back on their own the
      day a second person is on the floor — nothing here is disabled by hand.

      What is kept in full is the branch behaviour: the pending-invite alert, the
      invite control and the pending slice of the roster are all still here and
      all currently empty, and an empty one of them renders as nothing at all
      rather than as a heading with a blank under it. A dealership hires.

   5. ONE COLUMN IS NOT WHAT ITS NAME SAYS. THE OTHER ONE WAS, AND HAS BEEN
      FIXED IN THE DATABASE (2 Sep 2026).

      `v_team_performance.pipeline_aed` WAS `COALESCE(sum(l.budget_aed), 0)` over
      `users LEFT JOIN leads` with no status filter and no time window — every
      lead ever assigned counting towards it forever, disqualified, lost, sold,
      spam, floored at 0 so it could never report an absence. That is what this
      paragraph described, and it stopped being true on 2 Sep 2026. Read off the
      live view definition today, the column is
      `sum(l.budget_aed) FILTER (WHERE nexus_lead_is_open(l.status))`: open leads
      only, no coalesce, and live it reads NULL rather than the 0 it reported
      yesterday. `nexus_lead_is_open` is the database's mirror of the rule
      lib/pipeline.js uses, and it was probed against every status either side
      knows before this paragraph was rewritten — it agreed on all of them.

      The column is nonetheless STILL NOT READ ON THIS SCREEN, and the reason is
      no longer that it answers a different question, because it no longer does.
      Open pipeline is summed here from the leads this screen already reads, over
      the leads whose status is not terminal, using the won/dead tones
      lib/format.js assigns — the same table screens/overview.js reads, so there
      is no second lifecycle vocabulary. What that buys is attribution and
      disclosure: this screen can name the leads behind the figure, and can say
      when its own read was truncated. The view can do neither, and it sums the
      whole table rather than the read window — so where the read truncates, the
      view's figure is the more complete one, not the less. Where the figure
      cannot be computed here it is withheld rather than relabelled: a rep
      holding no open lead says that, rather than reporting AED 0.

      NOT CHANGED HERE: when the leads read fails outright this screen shows no
      pipeline figure at all, even though `perf` may have loaded and now carries
      one on the same rule. That refusal predates the migration and is left
      standing deliberately rather than quietly reversed; it is flagged for
      whoever owns this screen's behaviour, not settled in a comment.

      `leads.response_time_minutes` WAS a manufactured value and is now a
      measurement, and this paragraph said the opposite until the afternoon of
      1 Sep 2026. What it used to describe was real: a BEFORE INSERT trigger on
      `leads` (`trg_leads_backfill_response`) looked for a reply at the instant
      the lead row was created, and because the WhatsApp bot answers the
      conversation before the router mints the lead, it measured a reply that
      predated the row, computed a negative interval, and `greatest(0, …)`
      turned "I measured the wrong thing" into "answered in 0 minutes". The
      writer that would have been correct — AFTER INSERT on
      `communication_logs` — was guarded by `response_time_minutes is null`, and
      `0 is null` is false, so it was locked out permanently.

      That trigger is gone. Read off the live catalogue on 1 Sep 2026, the only
      trigger left on `leads` is `trg_assign_hot_lead`, and the only function in
      `public` that writes the column is `nexus_mark_first_response`, fired
      AFTER INSERT on `communication_logs`. The live column reads 1 minute
      (id 34), NULL (id 35) and 4 minutes (id 38) — taken at 14:17 UTC on
      1 Sep 2026.

      A NULL MEANS NOT MEASURED. It does not mean nobody replied, and nothing on
      this screen may say or imply that it does. Lead 35 is the case that proves
      it and the case this screen got wrong: it WAS answered, by an outbound
      WhatsApp message at 06:40:38.827 on 26 Aug that `nexus_is_reply()`
      accepts, 74 seconds before its own lead row existed. That is inside the
      trigger's 90-second clock-skew allowance, but the guard then finds inbound
      messages already on file from 06:39 and declines to stamp — correctly,
      because that reply belongs to the conversation that produced the lead
      rather than to answering it. It is the normal shape for a WhatsApp lead
      here, not an edge case. (The earlier audit note put id 38 at 81 minutes;
      that is the first message filed under its *real* email address. The reply
      that answered it is at 4 minutes, which is what the column now holds.)

      One consequence of the new writer, before anyone reads a 0 here again:
      0 is now a legitimate value. `nexus_mark_first_response` rounds seconds to
      the nearest minute, so a reply inside 30 seconds stores 0, and so does a
      reply logged up to 90 seconds early with no prior inbound on file. An
      all-zero table is no longer the fingerprint of anything — which is exactly
      what the gate below was built to detect, and why that gate was rewritten
      at the same time as this note.

      `within_sla` is `count(l.id) FILTER (WHERE response_time_minutes <= 5)`
      and `breached_sla` the same over `> 5`, so a NULL lead falls into neither
      and the pair partitions the leads that were measured rather than the whole
      book. Their sum is what this file calls `measured(r)`. `v_needs_attention`
      files its `sla_breach` branch under `screen = 'leads'`, so it could not
      reach this screen in any case.

      What this screen still asks of the column, on every load, is whether the
      trigger has stamped any of the leads it read. Where it has not, every
      rate, ranking, verdict and per-lead "answered in" drawn from it is
      withheld with the reason on it, because there is no input. Today two of
      the three leads read carry a figure, so all of it is shown. Nothing here
      is disabled by hand and nothing waits on a date.

   There is still no endpoint that can invite anybody — `users` is service-role
   only from the browser and none of the deployed n8n webhooks sends an
   invitation — so the invite control stays built and disabled with the reason on
   it. Nothing here is estimated: every number comes off a row — and where a row
   holds something other than what its column is named, item 5 says so and the
   number is withheld rather than printed under the wrong name. A panel whose
   table failed to load says so rather than showing a plausible blank. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, dubaiStamp, esc, initials, mins, n0, num, pct, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
/* Open pipeline, defined once. TERMINAL_TONES and isOpenLead used to be
   declared here AND word for word in screens/overview.js, and the read ceiling
   differed between the two (1000 here, 2000 there) — so the same rule could
   report two totals on a table big enough to truncate. Both now come from
   lib/pipeline.js. The database's own pipeline_aed is still not used and still
   not shown — but as of 2 Sep 2026 it is on the same open-lead rule, so the
   reason is attribution and cap disclosure rather than a disagreement about
   what pipeline means; see DB_PIPELINE_NOTE for the sentence that says so. */
import { CAP_NOTE, DB_PIPELINE_NOTE, LEAD_LIMIT, isOpenLead, sumBudget } from '../lib/pipeline.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* Leads are read to answer three questions the view cannot: which leads have no
   owner at all, what a given rep is actually holding, and how much of that is
   still open money — the last of these because a figure summed from the rows
   read here can be attributed lead by lead and can carry its own cap warning,
   which the view's pipeline_aed cannot. It is no longer because the view
   answers a different question: since 2 Sep 2026 it does not (item 5 above). It is no
   longer read to look for assignments pointing at a user who no longer exists:
   the FK is ON DELETE SET NULL and `users` is fully readable by `authenticated`,
   so that condition cannot arise. The read is capped, and where a count depends
   on the cap the screen says the cap was hit rather than letting a windowed
   number read as a total. That cap is LEAD_LIMIT, imported from
   lib/pipeline.js: it was 1000 here and 2000 on Overview until 1 Sep 2026, and
   the two screens now read the same window because they publish the same
   figure. Live 1 Sep 2026 `leads` holds 3 rows, so raising it changes nothing
   on screen today. */

/* CONTROL-PLANE.md 5.8. These three tooltips said WHY the control is dead in
   the vendor's terms — which table, which role, which policy, and the full list
   of deployed webhook paths. That is an unbuilt-feature disclosure and an
   inventory of the vendor's endpoints, rendered in the dealership's UI. The
   control still shows and is still refused, which is the part that matters:
   hiding it would teach the operator the feature does not exist. What it says
   now is the fact and who owns it. */
const NO_INVITE =
  'Inviting somebody is not built yet. Ask NEXUS to add the account and it will appear here.';
const NO_ROLE_WRITE =
  'Roles cannot be changed from this dashboard yet. Ask NEXUS to change it and it will appear here.';
const NO_DELETE =
  'Removing a person is deliberately not offered here, and the reason is not that their leads would be orphaned — those would simply become unassigned. It is that the record of who owned a lead carries nothing about how or when they got it, so after a removal a lead that was never assigned and a lead whose rep was removed would be indistinguishable. Ask NEXUS to remove somebody and it can be done without losing that.';

/* Said wherever a figure derived from leads.response_time_minutes is withheld.
   The mechanism is named rather than summarised, because "the data is bad" is
   the kind of sentence that gets ignored until somebody re-derives the number.
   Rewritten 1 Sep 2026: the previous text described the BEFORE INSERT clamp as
   a live trigger and asserted that every lead carried 0, both of which stopped
   being true that morning. It is now about what a missing measurement is,
   which is the only thing this constant is ever shown for. */
const NO_TIMING =
  'leads.response_time_minutes is written by one trigger and nothing else: nexus_mark_first_response, AFTER INSERT on communication_logs, which stamps the minutes between the lead row and the first reply it can attribute to that lead. A null means it never stamped — usually nothing has gone back since the lead row was created, and sometimes the only reply on file predates the lead row, which it declines to measure because that reply belongs to the conversation that produced the lead rather than to answering it. A null is therefore not a statement that nobody replied. Until 31 Aug 2026 a second, BEFORE INSERT trigger on leads clamped that negative interval to 0 and locked this writer out; it has been deleted, and the three live leads read 1 minute, null and 4 minutes (1 Sep 2026). within_sla and breached_sla in v_team_performance are count(*) FILTER on response_time_minutes at <= 5 and > 5, so a null lead counts in neither and their sum is the number of leads a rep was actually timed on. Wherever this note appears, that sum has nothing behind it in the leads read here, so nobody is scored against the 5-minute rule in either direction.';

/* Said on a lead whose response_time_minutes is null. Deliberately the same
   account leads.js, lib/lead-drawer.js and screens/customers.js give for the
   same null: four surfaces render this column, and a maintainer who reads two
   of them should not find two meanings. */
const NULL_RT =
  'nexus_mark_first_response stamps this column for the first reply it can attribute to the lead, and it has not stamped this one. Usually that means nothing has gone back since the lead row was created; it can also mean the only reply on file predates the lead row, which the trigger declines to measure. Either way there is no measured wait here — it is not a fast reply and not a slow one — and the 5-minute rule cannot be applied to this lead at all.';

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

/* Below this many measured leads a rate is not a rate. Over a single lead the
   only percentages that exist are 0% and 100%, and printing one of them turns
   one outcome into a score for the team; between two and THIN it is a real
   proportion but a tiny one, and it is captioned as such rather than withdrawn.
   The same two thresholds decide the SLA panel and the KPI beside it, so the
   headline figure and the panel under it can never disagree about what counts. */
const MIN_RATE_SAMPLE = 2;
const THIN = 5;

/* Open or finished is lib/pipeline.js's isOpenLead, imported above. "Deliberately
   identical to the two lines screens/overview.js uses" is what the comment here
   used to say, and two files agreeing by inspection is not the same as one
   rule: it is what makes "pipeline" mean open money on this screen and
   something else on the next one the moment somebody edits one copy. */

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
/* Asia/Dubai, labelled — a rep's last activity is a moment in their shift. */
const dt = ts => dubaiStamp(ts, '');
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
  if (isPending(r)) return pill('Pending invite', 'warm', { verbatim: false });
  return pill(statusLabel(r), hasAccount(r) ? 'ok' : undefined, { verbatim: true });
};

/* ── Screen ──────────────────────────────────────────────────────────────── */
SCREENS.team = async host => {
  /* The alert strip sits above the KPI row on purpose. "How many people are on
     the team" is a fact; "a rep is holding nothing while a HOT lead has no
     owner" is a job, and the job must not be the thing you scroll past. */
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
  const leadsCapped = !!leads && leads.length >= LEAD_LIMIT;
  /* There is deliberately no "leads pointing at a user who is not on the roster"
     check here any more. It read as the damage a delete would do, and it was two
     things at once that could never happen: leads_assigned_to_id_fkey is
     ON DELETE SET NULL, so a deleted user leaves unassigned leads rather than a
     dangling id, and `users` is readable in full by `authenticated`
     (USING (true)), so the roster this screen holds can never be missing an id
     that leads.assigned_to_id carries. A permanently unreachable branch that
     appears in a "checked" list is worse than no check: it is a claim. */

  /* ── Open pipeline, computed here rather than read ───────────────────────
     v_team_performance.pipeline_aed USED TO sum budget_aed over
     `users LEFT JOIN leads` with no status filter and no time window, COALESCEd
     to 0 so it could never say "no figure". As of 2 Sep 2026 it is
     `sum(l.budget_aed) FILTER (WHERE nexus_lead_is_open(l.status))` with no
     coalesce — the same open-lead rule as the sum below, and NULL where nothing
     carries a budget. What is summed here instead is budget_aed over the leads
     this screen already read that are assigned to the rep and not in a terminal
     state. That is now the same DEFINITION as the view's, over a narrower
     population: open money inside the LEAD_LIMIT window, which this screen can
     name row by row and can warn about when the read truncates. It is null, not
     zero, when there is nothing to add up — a rep holding no open lead and a rep
     whose open leads carry no budget are both "no figure", and both are
     different from AED 0. */
  const openLeadsOf = r => ownedBy(r).filter(isOpenLead);
  /* sumBudget, not the local sumOf: the null-not-zero convention and the column
     it sums are part of the shared definition, so Overview and this screen
     cannot end up disagreeing about what an empty book totals. sumOf stays for
     within_sla and breached_sla, which are this screen's own columns. */
  const openPipelineOf = r => ((leads && r.id) ? sumBudget(openLeadsOf(r)) : null);
  const sumOpen = rows => {
    let t = null;
    rows.forEach(r => { const x = openPipelineOf(r); if (x != null) t = (t ?? 0) + x; });
    return t;
  };

  /* ── Has leads.response_time_minutes been stamped on anything here? ──────
     See item 5 in the header. This gate was written on 31 Aug against a
     different column — one a since-deleted BEFORE INSERT trigger clamped to 0
     on every row — where the useful question was "does this column take any
     value other than exactly 0", and all-zero-with-no-nulls was the clamp's
     fingerprint. Both halves of that test are now wrong, and the reasons are
     worth keeping rather than leaving the shape in place:

     — 0 is no longer a fingerprint. nexus_mark_first_response rounds to the
       nearest minute and reserves 0 for a genuine sub-30-second reply, so a
       floor that answered everything fast would trip the old test, and this
       screen would withhold every real figure while blaming a trigger that no
       longer exists.
     — A NULL is not evidence that the column grades anything; it is the
       absence of a measurement. The old test counted nulls towards `rtGraded`,
       so a table where NOTHING had been stamped read as trustworthy — and that
       is what licensed the untimed-lead count below to speak about every lead
       on it.

     The question that survives both is simply whether the writer has stamped
     any of the leads read here. One non-null value is a measurement; no
     non-null value is no input, and no rate, ranking or per-rep verdict is
     drawn from a column nothing has written to. Live at 14:17 UTC on
     1 Sep 2026: id 34 → 1, id 35 → NULL, id 38 → 4, so two of three are
     measured and this is true.

     A leads read that failed leaves this false: not because the column is known
     to be unwritten, but because it could not be checked, and an unverified SLA
     figure on the screen whose founding promise is the 5-minute rule is the one
     number nobody should be shown on trust. */
  const rtOf = l => n0(l.response_time_minutes);
  const rtMeasured = (leads || []).filter(l => rtOf(l) != null).length;
  const timingTrusted = !!leads && rtMeasured > 0;
  /* Why it is false, in the words of whichever case applies. */
  const timingWhy = timingTrusted ? ''
    : !leads
      ? `Leads could not be read here (${leadsErr || 'unknown error'}), so nothing could be checked against the response-time column and nothing derived from it is claimed.`
      : !leads.length
        ? 'No lead was read here at all, so there was nothing to check the response-time column against.'
        : `Not one of the ${num(leads.length)} leads read here carries a response_time_minutes: the trigger on communication_logs has stamped none of them, so there is no measured wait to score anybody on. That is a statement about the record and not about the customers — a lead nobody answered and a lead whose only reply predates its own row are indistinguishable here.`;

  const pending = roster.filter(isPending);
  const withAccount = roster.filter(hasAccount);

  /* ── The conditions this screen raises itself ──────────────────────────────
     All of them come out of the three reads above. None adds a round-trip, and
     each one is null-safe in the same way the rest of this file is: a figure the
     view did not report is not a zero, so it never counts as evidence. */
  const unassignedHot = unassigned.filter(l => up(l.status) === 'HOT');
  /* The best-scored lead nobody owns, HOT or not. Named in the idle-rep alert so
     "no HOT lead is unassigned" cannot be read as "nothing is waiting". */
  const topUnowned = unassigned.slice()
    .sort((a, b) => (n0(b.ai_score) ?? -1) - (n0(a.ai_score) ?? -1))
    .find(l => n0(l.ai_score) != null) || null;

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

  /* Leads against their name and not one of them timed. This is not "slow", and
     since 1 Sep 2026 this comment no longer says it is "no response recorded"
     either: within_sla and breached_sla are count(*) FILTER on
     response_time_minutes, so a rep whose every lead carries a null is reported
     exactly like a rep the trigger has never stamped for any other reason.
     Usually that does mean nothing has gone back; it is also what the view
     reports for a lead whose only reply predates its own row. Kept separate
     from "no activity" (which means no leads either), because a rep sitting on
     work is a different problem from a rep with none. */
  const stalled = r => (leadsAssigned(r) ?? 0) > 0 && !(measured(r) > 0) && avgResponse(r) == null;
  const stalledReps = roster.filter(stalled);
  /* Their book, as the leads read sees it: leads carrying no
     response_time_minutes. This was `untouchedOf` until 1 Sep 2026, under a
     comment that read "a lead with no response_time_minutes has never been
     answered" — the false premise the whole screen was built on, and lead 35 is
     the counter-example: answered 74 seconds before its own lead row existed.
     What the count supports is that nothing was timed on those leads. It is
     taken only where the column has been stamped on something, so a column
     nothing has written to can never be read as a floor of unanswered
     customers. */
  const untimedOf = r => (timingTrusted ? ownedBy(r).filter(l => rtOf(l) == null) : []);

  /* Breaches are read from the view's breached_sla, which is
     count(l.id) FILTER (WHERE response_time_minutes > 5). A null does not
     satisfy that filter, so nobody is ever counted as breaching on a wait that
     was never measured. No breach is claimed against anybody while the leads
     read shows the column stamped on nothing at all. */
  const breachers = timingTrusted
    ? roster.filter(r => (breachedSla(r) ?? 0) > 0).sort((a, b) => breachedSla(b) - breachedSla(a))
    : [];
  const breachTotal = breachers.reduce((a, r) => a + breachedSla(r), 0);

  /* Pipeline concentration. Measured against the reps who hold any open pipeline
     at all, not against the whole roster — including people with none would make
     every team look concentrated — and over open money, so this can no longer be
     a ranking of who is holding the most dead leads. */
  const carriers = roster.filter(r => (openPipelineOf(r) ?? 0) > 0)
    .sort((a, b) => openPipelineOf(b) - openPipelineOf(a));
  const carriedTot = sumOpen(carriers);
  let concentration = null;
  if (carriers.length >= MIN_CARRIERS && carriedTot) {
    const even = 1 / carriers.length;
    const share = openPipelineOf(carriers[0]) / carriedTot;
    if (share >= Math.max(CONCENTRATION_FLOOR, even * 2)) {
      concentration = { rep: carriers[0], share, even, total: carriedTot };
    }
  }

  /* Rows the performance view has activity for that match nobody in the
     directory. Only meaningful when the directory actually loaded — and, on the
     view as deployed today, structurally empty: v_team_performance is
     `FROM users u LEFT JOIN leads l`, so every performance row is a users row
     and there is nothing for it to fail to match. The branch is kept because it
     costs nothing and is the correct behaviour the day the view is rebuilt on
     another source; it is NOT counted as a check that was run, which is what it
     used to be listed as. */
  const unlinkedReps = users ? roster.filter(r => r.unlinked) : [];

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!users && !perf) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('the team', usersErr || perfErr);
  } else {
    const withinTot   = sumOf(roster.map(r => r.perf).filter(Boolean), 'within_sla');
    const breachedTot = sumOf(roster.map(r => r.perf).filter(Boolean), 'breached_sla');
    const measuredTot = (withinTot == null && breachedTot == null) ? null : (withinTot ?? 0) + (breachedTot ?? 0);
    const pipelineTot = sumOpen(roster);
    const withPipeline = roster.filter(r => (openPipelineOf(r) ?? 0) > 0).length;
    /* How many open leads are held at all, so "no figure" can say which kind it
       is: nobody holding an open lead, or open leads that carry no budget. */
    const openHeld = roster.reduce((a, r) => a + openLeadsOf(r).length, 0);

    /* One team-wide response figure, weighted by how many leads each rep was
       actually timed on. An unweighted mean of per-rep means would let someone
       with a single fast lead cancel out someone carrying forty slow ones. */
    let weightSum = 0, weighted = 0, timedReps = 0;
    roster.forEach(r => {
      const a = avgResponse(r), m = measured(r);
      if (a != null && m) { weighted += a * m; weightSum += m; timedReps++; }
    });
    const teamAvg = weightSum ? weighted / weightSum : null;
    /* What that figure honestly is. Weighting across one rep is that rep's own
       average, and across one lead it is that lead's first reply — calling
       either a team average would be a claim about a team. */
    const avgLabel = teamAvg == null ? ''
      : weightSum < MIN_RATE_SAMPLE ? 'first reply took'
        : timedReps < 2 ? 'their average is'
          : 'weighted average';

    strip.innerHTML = [
      kpi('Team members', num(roster.length),
        usersErr
          ? '<span class="t-warm">Directory unreadable — counted from the performance view</span>'
          /* "0 pending invite" beside a roster of one is a count of a thing that
             is not happening. It appears when there is something to report. */
          : `${num(withAccount.length)} with an account${pending.length ? ` · ${num(pending.length)} pending invite` : ''}`
            + (roster.length === 1 ? '<div class="t-muted">The whole floor is one person</div>' : '')),
      kpi('Awaiting an invite', num(pending.length),
        pending.length
          ? '<span class="t-warm">No account, and nothing here can send one yet</span>'
          : '<span class="t-ok">Nobody is waiting on an invitation</span>'
            + '<div class="t-muted">Sending one is not built either, so the first hire has to be added outside this dashboard</div>',
        pending.length ? 't-warm' : ''),
      /* The counts here are within_sla / breached_sla straight off the view, and
         both are count(*) FILTER on response_time_minutes, so their sum is the
         number of leads anyone was actually timed on and a null lead is in
         neither. Where the column has been stamped on nothing the figure is
         withheld rather than printed with a caveat under it: "3 / 3 · 100.0%"
         with an explanation beside it is still read as 100%. */
      kpi('Within the 5-minute rule',
        (timingTrusted && measuredTot) ? `${num(withinTot ?? 0)} / ${num(measuredTot)}` : '—',
        !timingTrusted
          ? `<span class="t-warm" title="${esc(NO_TIMING)}">Nobody can be scored against the 5-minute rule yet</span>`
            + `<div class="t-muted">${esc(timingWhy)}</div>`
          : !measuredTot
            ? '<span class="t-muted">No rep row carries a response measurement</span>'
            /* One measured lead is an outcome, not a rate. The count stays — it
               is the fact — and the percentage is withdrawn with the reason. */
            : measuredTot < MIN_RATE_SAMPLE
              ? `<span class="t-muted">One lead has been timed, so this is that lead's outcome and not a rate</span>`
                + (teamAvg == null ? '' : `<div class="t-muted">Its ${esc(avgLabel)} ${esc(mins(teamAvg))}</div>`)
              : `${pct((withinTot ?? 0) / measuredTot * 100)} · ${esc(avgLabel)} ${esc(mins(teamAvg))}`
                + (measuredTot <= THIN ? `<div><span class="t-warm">Over ${num(measuredTot)} measured leads in total — a proportion this small moves a long way on one reply</span></div>` : ''),
        timingTrusted && measuredTot >= MIN_RATE_SAMPLE && (withinTot ?? 0) / measuredTot < 0.5 ? 't-hot' : ''),
      /* Open pipeline, not "pipeline". The label names exactly what is summed:
         budget_aed over the leads read here that are assigned to somebody and
         are not in a won or dead state. v_team_performance.pipeline_aed is not
         used and not shown. Until 2 Sep 2026 the reason was that it counted
         every lead ever assigned, and on today's table would have reported two
         DISQUALIFIED leads as money in play; it no longer does, and the reason
         now is that this figure can be attributed to named leads and can
         disclose its own truncation. */
      kpi('Open pipeline in rep hands', pipelineTot == null ? '—' : aed(pipelineTot),
        !leads
          ? `<span class="t-muted">Leads could not be read, so open pipeline could not be summed. ${esc(DB_PIPELINE_NOTE)}</span>`
          : pipelineTot == null
            ? (openHeld
                ? `<span class="t-muted">${num(openHeld)} open ${plural(openHeld, 'lead is', 'leads are')} held, and not one of them carries a budget_aed — so there is a book here, but no money to total</span>`
                : '<span class="t-muted">Nobody on the roster is holding an open lead</span>')
            : (roster.length === 1
                ? 'Held by the only person on the roster'
                : `Held by ${num(withPipeline)} of ${num(roster.length)} on the roster`)
              + `<div class="t-muted">Open leads only — won and dead ones are excluded</div>`
              /* Same wording Overview prints on its own pipeline tile, from
                 lib/pipeline.js, so one truncation cannot be disclosed in two
                 strengths on two screens showing the same rule. */
              + (leadsCapped ? `<div class="t-warm">${esc(CAP_NOTE(num(LEAD_LIMIT)))}</div>` : '')),
      kpi('Unassigned leads', leads ? num(unassigned.length) : '—',
        !leads
          ? `<span class="t-muted">Leads could not be read</span>`
          : unassigned.length
            /* Which of them are HOT is the whole point: an unowned COLD lead is
               a queue, an unowned HOT lead is the auto-assign trigger failing. */
            ? `<span class="t-hot">Nobody owns these</span>${unassignedHot.length ? ` · <span class="t-hot">${num(unassignedHot.length)} HOT</span>` : ' · none of them HOT'}`
            : '<span class="t-ok">Every lead read here has an owner</span>'
              + (leads.length <= THIN
                  ? `<div class="t-muted">That is the whole leads table — ${num(leads.length)} ${plural(leads.length, 'row', 'rows')}, not a sample of it</div>`
                  : ''),
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
     it has not been taught to its own 'unknown' tone rather than to the empty
     string — which is what used to make an unknown severity render as a neutral
     note, and to COLD, which filed it under a state nobody gave it. Five screens
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
      /* True only when the word really is the view's; 'WARM' below is ours. */
      sevFromRow: str(it.severity) !== '',
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
        /* This branch runs only when no HOT lead is unassigned, and it used to
           conclude from that alone that "nothing is going unworked". Unowned
           WARM and COLD leads are also work, and on this table there are three
           of them, one scored 65 — so the sentence said the opposite of what the
           KPI two inches above it said. Only what was actually checked is
           claimed, and the unowned leads are named when there are any. */
        + (leads
          ? (unassigned.length
            ? `No HOT lead is unassigned, but ${num(unassigned.length)} ${plural(unassigned.length, 'lead has', 'leads have')} no owner at all${topUnowned ? ` — the highest-scored of them is ${esc(str(topUnowned.name) || 'an unnamed lead')} at ${num(topUnowned.ai_score)}` : ''}, so there is unowned work on the floor beside an idle rep. `
            : 'Every lead read here has an owner, so there is no unowned work waiting on them. ')
          : '')
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
    const untimed = (leads && timingTrusted) ? worst.reduce((a, r) => a + untimedOf(r).length, 0) : null;
    add({
      sev: 'WARM', icon: 'hourglass_disabled',
      titleHtml: `${num(stalledReps.length)} ${plural(stalledReps.length, 'rep is', 'reps are')} holding ${num(held)} ${plural(held, 'lead', 'leads')} with no first reply timed`,
      detailHtml: `${nameList(worst)} ${plural(stalledReps.length, 'has', 'have')} leads assigned and no measured response against ${plural(stalledReps.length, 'that name', 'those names')} — `
        + 'not a slow average, no <span class="mono">within_sla</span> or <span class="mono">breached_sla</span> count at all. That is usually what the view reports when nobody has replied, but it is not proof of it: the trigger also leaves a lead unstamped when its only reply predates the lead row. So this names work nobody has been timed on, not customers nobody has answered. '
        + (untimed != null
          ? `In the ${num(leads.length)} ${plural(leads.length, 'lead', 'leads')} read here, ${num(untimed)} of their ${plural(untimed, 'leads carries', 'leads carry')} no <span class="mono">response_time_minutes</span>${leadsCapped ? `, and that read is capped at ${num(LEAD_LIMIT)} so there may be more` : ''}.`
          : !leads
            ? 'Leads could not be read, so this cannot be confirmed lead by lead.'
            : 'It cannot be confirmed lead by lead either: not one lead read here carries a <span class="mono">response_time_minutes</span>, so counting the untimed ones would return every lead on the page no matter what happened.'),
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
        + 'Each of these is a lead the view timed at longer than five minutes to a first reply — the window in which the odds of qualifying it drop by about four fifths. '
        + 'These counts come from the view itself and are all-time, not a window computed here. They are only shown at all because <span class="mono">leads.response_time_minutes</span> has been stamped on at least one lead read here; where it has been stamped on none, no breach is claimed against anybody.',
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
      titleHtml: `${esc(str(c.rep.name) || 'One rep')} is holding ${esc(pct(c.share * 100))} of the open pipeline`,
      detailHtml: `${esc(aed(openPipelineOf(c.rep)))} of the ${esc(aed(c.total))} held across the ${num(carriers.length)} reps who carry any open pipeline at all — `
        + `budget_aed summed over the leads assigned to them that are not won or dead${leadsCapped ? `, within the ${num(LEAD_LIMIT)} most recent leads read` : ''}. `
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
    /* An empty partition is reported as what it is. v_needs_attention is seven
       UNION ALL branches whose `screen` literal is one of 'leads' (twice),
       'inventory', 'competitors', 'automation', 'compliance' and
       'conversations' — verified against the live definition, 31 Aug 2026.
       Neither 'team' nor anything else this screen could ask for is ever
       emitted, so a zero here is not the database looking at the team and
       finding it clean. Note in particular that the view's own sla_breach
       branch is filed under screen = 'leads', so a rep breaching the 5-minute
       rule cannot reach this strip through the view no matter what the column
       holds. */
    attnErr
      ? `<span class="t-warm">v_needs_attention could not be read (${esc(attnErr)}), so anything the database had filed against this screen is missing from this strip. It files nothing against this screen as the view is currently defined, so that is likely to be nothing — but it could not be confirmed on this page load. The ${num(derivedCount)} ${plural(derivedCount, 'alert', 'alerts')} above ${plural(derivedCount, 'was', 'were')} derived here.</span>`
      : `${num(viewCount)} ${plural(viewCount, 'row', 'rows')} from v_needs_attention where screen = ${SCREEN_ID}`
        + (viewCount ? '' : ', which is every row it can ever return here: none of its branches emits that screen name, so this is the view filing nothing about the team rather than the view finding nothing wrong with it')
        + `. ${num(derivedCount)} derived here from `
        + `${users ? `${num(users.length)} directory ${plural(users.length, 'row', 'rows')}` : 'no directory rows'}, `
        + `${perf ? `${num(perf.length)} performance ${plural(perf.length, 'row', 'rows')}` : 'no performance rows'} and `
        + `${leads ? `${num(leads.length)} ${plural(leads.length, 'lead', 'leads')}` : 'no leads'}.`,
    perfErr
      ? `<span class="t-warm">The performance view did not load (${esc(perfErr)}), so SLA breaches and reps holding leads it has never timed were not checked at all — they are absent from this list, not clear.</span>`
      : '',
    leadsErr
      ? `<span class="t-warm">Leads did not load (${esc(leadsErr)}), so unassigned leads, HOT leads with no owner and open pipeline — including its concentration on one rep — were not checked.</span>`
      : '',
    leadsCapped
      ? `The leads read stopped at ${num(LEAD_LIMIT)} rows, so every lead-derived count in this strip is a floor rather than a total.`
      : '',
    /* Why an absent alert is absent. A check that cannot mean anything on a
       roster this size is skipped, and skipped is not the same as clear. */
    roster.length < 2
      ? `The roster is ${num(roster.length)} ${plural(roster.length, 'person', 'people')}, so the checks that compare reps with each other — open-pipeline concentration, workload spread, the SLA ranking — were skipped rather than run over a set of one: one person holding all of the open money is a roster of one, not a concentration. They return on their own when a second person is on the floor.`
      /* Concentration is computed from the leads read, not from the performance
         view, so the guard is on `leads` — it was on `perf`, which was correct
         only while pipeline_aed was the source. */
      : (leads && carriers.length < MIN_CARRIERS)
        ? `Pipeline concentration was not checked: ${num(carriers.length)} ${plural(carriers.length, 'rep carries', 'reps carry')} any open pipeline at all, and a share of the money says nothing spread across fewer than ${num(MIN_CARRIERS)}.`
        : '',
    timingTrusted
      ? ''
      : `<span class="t-warm">Nothing in this strip scores anybody against the 5-minute rule, and that is a gap rather than an all-clear. ${esc(timingWhy)} ${esc(NO_TIMING)}</span>`,
    `Staff phone numbers appear nowhere in this strip because they appear nowhere in the database: ${esc(NO_STAFF_PHONE)} Leads named above carry their own number, or an explicit dash where we hold none.`,
  ].filter(Boolean);
  const notesHtml = notes.join('<br>');

  /* Only the checks that were actually run are claimed. Listing concentration
     here on a one-rep roster would be claiming a check this screen deliberately
     did not make. */
  /* Two entries were removed from this list rather than reworded, because both
     named branches that cannot fire and a check that cannot fire is not a check,
     it is a claim: "leads whose assignment points at a user who is not on the
     roster" (the FK is ON DELETE SET NULL and `users` reads in full under
     USING (true), so there is no dangling id to find — the branch itself is
     gone) and "performance rows with no account behind them"
     (v_team_performance is FROM users u LEFT JOIN leads l, so every performance
     row is a users row; that branch is kept in the code for the day the view is
     rebuilt elsewhere, but it is not listed here as something that was run).
     The SLA entry is conditional for the same reason: where nothing has been
     stamped into response_time_minutes, nobody was scored. */
  const CHECKED = 'Checked: seats still at pending_invite, '
    + 'reps holding no leads while HOT leads sit unassigned, reps holding leads the performance view has never timed, '
    + (carriers.length >= MIN_CARRIERS ? 'one rep carrying a disproportionate share of the open pipeline, ' : '')
    + 'and leads with no owner at all'
    + (timingTrusted
      ? ', including reps with an SLA breach.'
      : '. Nobody was checked against the 5-minute rule: no measured response_time_minutes was found in the leads read here, so there was no wait to score any rep against, in either direction.');

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
          ${a.titleHtml}${pill(String(a.sev).replace(/_/g, ' '), tone(a.sev), { verbatim: a.sevFromRow === true })}
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
       failed to render. v_needs_attention contributes nothing here in any case
       (it has no branch that emits screen = 'team'), so everything this heading
       covers was derived on this screen and the CHECKED line below is the whole
       of it. */
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

  /* "No activity yet" asks the same questions the columns answer, or the slice
     and the table disagree about the same person. `measured(r)` stays in even
     where nothing has been stamped into the response column: every term here
     only ever removes somebody from the quiet slice, so a counter with no input
     cannot put anyone into it who does not belong. Pipeline is asked of the open figure computed on
     this screen, not of the view's pipeline_aed — see item 5 in the header. */
  const noActivity = r => !r.perf
    || (!(leadsAssigned(r) > 0) && !(hotLeads(r) > 0) && !(measured(r) > 0)
        && !(openPipelineOf(r) > 0) && ownedBy(r).length === 0);

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
    /* Gated on the same test as the breach alert. breached_sla is
       count(*) FILTER (WHERE response_time_minutes > 5), so it is empty
       wherever the column has been stamped on nothing and the segment is not
       offered at all; if the column were unreadable the segment would still be
       an SLA claim, so it is withheld there too rather than shown against a
       figure the strip above has already declined to use. */
    BREACHED: { label: 'Breached SLA',           match: r => timingTrusted && (breachedSla(r) ?? 0) > 0 },
    QUIET:    { label: 'No activity yet',        match: noActivity },
  };
  /* Seven segments do not fit a toolbar, and every slice below the first two is
     only offered when it contains somebody — an always-empty filter is
     furniture, and a filter that is present and empty invites the reading that
     it was checked and came back clean, which is the alert strip's job to say.
     PENDING was in this always-shown set until the three seeded pending_invite
     rows were deleted, at which point it became a permanent "Pending invite · 0"
     next to a roster where nobody is pending — exactly the furniture this
     comment warns about. It is conditional now like the rest, and it reappears
     with the first real invite. */
  const ALWAYS_SHOWN = new Set(['ALL', 'ACCOUNT']);
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
    /* Both response keys are withheld where nothing has been stamped into
       leads.response_time_minutes — item 5 in the header. A sort is a ranking,
       and ranking the team on a column no row of which has been written puts
       somebody at the top of an order the data does not contain. Null sinks the
       row into the name order the sorter already uses for rows it cannot speak
       about. */
    response: { type: 'num',  get: r => (timingTrusted ? avgResponse(r) : null), dir: -1 },
    /* The cell prints "one lead, so no rate" below MIN_RATE_SAMPLE, and this key
       used to rank on exactly that suppressed number — a rep at 1/1 sorted above
       a rep at 40/50 on a hidden 100%, with nothing on the row to explain it.
       The key is now the same figure the cell is willing to show: null wherever
       no rate is claimed. */
    sla:      { type: 'num',  get: r => ((timingTrusted && measured(r) >= MIN_RATE_SAMPLE) ? slaRate(r) : null), dir: 1  },
    pipeline: { type: 'num',  get: openPipelineOf,       dir: -1 },
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
    /* avg_response_minutes is round(avg(l.response_time_minutes), 1), and avg
       skips nulls, so it is an average over the leads a rep was timed on and
       not over their book. Where nothing has been stamped at all this cell
       shows the reason instead of a figure: "0m" in a green tone is the single
       most confident lie this screen could print. */
    { label: 'Avg response', align: 'r', sort: 'response', render: r => {
        if (!timingTrusted) return `<span class="t-warm" title="${esc(NO_TIMING)}">Not measurable</span>`;
        const a = avgResponse(r);
        if (a == null) return '<span class="t-muted">Not measured</span>';
        /* An average of one is that one. The figure is real either way; the word
           "average" is what would be doing the lying. */
        return `<span class="${a > 5 ? 't-hot' : 't-ok'}">${mins(a)}</span>`
          + (measured(r) === 1 ? '<div class="cell-sub">one lead, not an average</div>' : '');
      } },
    /* within_sla and breached_sla are both count(*) FILTER on
       response_time_minutes, at <= 5 and > 5, so a lead carrying a null falls
       into neither and the pair partitions the leads that were measured rather
       than the rep's whole book. The denominator here is that measured count
       and never leads_assigned. Where nothing has been stamped the counts are
       withheld rather than captioned — "1 / 1" beside an explanation is still
       read as one for one. */
    { label: 'Within SLA', align: 'r', sort: 'sla', render: r => {
        if (!timingTrusted) return `<span class="t-warm" title="${esc(NO_TIMING)}">Not scored</span>`;
        const m = measured(r), w = withinSla(r);
        if (!m) return '<span class="t-muted">Nothing measured</span>';
        if (m < MIN_RATE_SAMPLE) {
          return `${num(w ?? 0)} / ${num(m)}<div class="cell-sub">${w ? 'answered in time' : 'breached'} — one lead, so no rate</div>`;
        }
        const rate = slaRate(r);
        return `${num(w ?? 0)} / ${num(m)}<div class="cell-sub ${rate != null && rate < 50 ? 't-hot' : ''}">${pct(rate)}</div>`;
      } },
    /* Open pipeline, summed here from the leads read on this screen — not
       v_team_performance.pipeline_aed. That column summed every lead ever
       assigned and COALESCEd to 0 until 2 Sep 2026; it is now filtered to open
       leads on the database's own mirror of this rule and returns NULL for an
       absence. It is still not read here, because this figure can be attributed
       to the leads listed below it and can say when its read was capped. The
       header explains it; the label names what is actually added up. */
    { label: 'Open pipeline', align: 'r', sort: 'pipeline', render: r => {
        if (!leads) return `<span class="t-muted" title="Leads could not be read on this page load, so there is nothing here to add up. The performance view's own pipeline_aed is not shown in its place: since 2 Sep 2026 it counts open leads only, on the same rule as this column, but it cannot be attributed to the leads this screen would list, so it is not substituted for a figure this screen could not compute.">Not summable</span>`;
        const p = openPipelineOf(r);
        if (p != null) return aed(p);
        const open = openLeadsOf(r).length;
        return open
          ? `<span class="t-muted">No budget on file</span><div class="cell-sub">${num(open)} open ${plural(open, 'lead', 'leads')}, none carrying a budget_aed</div>`
          : '<span class="t-muted">No open lead held</span>';
      } },
    /* The invite column exists only while somebody is waiting on one. Kept in
       the list rather than deleted — the day a seat is created it comes back by
       itself — but a column of dashes across a roster where nobody is pending is
       a control that looks available and is not, and it pushes the columns that
       carry something off the width. */
    ...(pending.length ? [{ label: 'Invite', align: 'r', render: r => isPending(r)
        ? `<button class="btn sm" disabled aria-label="Send an invite to ${esc(r.name || 'this team member')}"
             title="${esc(NO_INVITE)}">Invite</button>`
        : '<span class="t-muted">—</span>' }] : []),
  ];

  const counts = {};
  VIEW_KEYS.forEach(k => { counts[k] = roster.filter(VIEWS[k].match).length; });
  const offeredViews = VIEW_KEYS.filter(k => ALWAYS_SHOWN.has(k) || counts[k] > 0);
  /* Filters and a search box over a single row are furniture: every slice is
     either that one person or nobody, and a segment reading "Pending invite · 0"
     next to them invites the reading that somebody was found and filtered out.
     The controls are not built at all in that case, and the line below says why
     rather than leaving the toolbar mysteriously missing. */
  const oneRow = roster.length < 2;

  card.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Roster &amp; performance</div>
      <div class="card-sub">Who exists comes from <span class="mono">users</span>; what they did comes from
        <span class="mono">v_team_performance</span>. Sort by any column header. Click a row for the full record.
        ${perfErr ? `<span class="t-warm">The performance view could not be read (${esc(perfErr)}), so only the roster is shown.</span>` : ''}</div>
    </div></div>
    ${oneRow
      /* Nothing at all when the roster is empty — the table's own empty state
         below already says what is missing, and a toolbar above it explaining
         that there is nothing to filter is a second empty box saying the same. */
      ? (roster.length
          ? `<div class="toolbar"><div class="cell-sub" style="white-space:normal">${esc('One person is on the roster, so there is nothing to filter or search for: every slice would return the same row. The filters come back when there is a second person to tell apart from the first.')}</div></div>`
          : '')
      : `<div class="toolbar">
      <div class="seg" id="tSegView" role="group" aria-label="Filter the roster">
        ${offeredViews.map((k, i) => `<button data-v="${esc(k)}" class="${i === 0 ? 'on' : ''}">${esc(VIEWS[k].label)} · ${num(counts[k])}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="tq" aria-label="Search the roster" placeholder="Search name, email or role" /></div>
      <div class="t-muted num" id="tCount"></div>
    </div>`}
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
      if (countEl) countEl.textContent = '';
      th.innerHTML = stateEmpty('Nobody on the team yet',
        'The users table has no rows and the performance view returned none either, so there is no roster to report on.', 'groups');
      return;
    }
    const rows = sortRows(visible());
    if (countEl) countEl.textContent = `${rows.length} of ${roster.length}`;
    th.innerHTML = table(cols, rows, {
      onRow: true,
      /* The empty state names the reason it is empty. "Everyone has activity" is
         only true when the quiet slice itself is empty — say it while a search
         box is also filtering and it is a claim about the wrong set. */
      empty: (f.view === 'QUIET' && !f.q.trim())
        ? stateEmpty('Everyone has activity',
            'Every person on the roster has leads, a response the view counted, or open pipeline against their name.', 'task_alt')
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
  /* Absent on a one-row roster, by design above — not a missing element. */
  card.querySelector('#tq')?.addEventListener('input', e => { f.q = e.target.value; draw(); });

  /* The pending-invite banner hands over the exact set it counted, search
     cleared, so the list under the toolbar can never disagree with the number
     in the banner above it. */
  focusRoster = view => {
    f.view = view; f.q = '';
    const box = card.querySelector('#tq');
    if (box) box.value = '';
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
    /* The bars are drawn against the busiest rep, so with one carrier the only
       bar is full — which reads as "at capacity" when it means "the only one".
       Below two carriers the counts are printed on their own and the missing
       chart is explained, rather than a chart being drawn that says something
       nobody measured. */
    const spread = carrying.length >= 2;
    workload.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Workload by rep</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${carrying.map(r => {
          const n = leadsAssigned(r);
          const hot = hotLeads(r);
          return `<div style="display:flex;align-items:center;gap:12px">
            <div style="width:120px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || 'Unnamed')}</div>
            ${spread
              ? `<div class="bar" style="flex:1;height:10px"><i style="width:${(n / top * 100).toFixed(1)}%"></i></div>`
              : `<div style="flex:1" class="cell-sub">${num(n)} ${plural(n, 'lead', 'leads')} against their name</div>`}
            <div class="num t-muted" style="width:88px;text-align:right">${num(n)}${hot ? ` · <span class="t-hot">${num(hot)} hot</span>` : ''}</div>
          </div>`;
        }).join('')}
      </div>
      ${spread ? '' : `<div class="cell-sub" style="margin-top:10px;white-space:normal">
        ${num(carrying.length)} ${plural(carrying.length, 'rep holds', 'reps hold')} any lead at all, so there is no distribution to chart:
        a single bar is the full width of itself by construction and would read as a rep at capacity. The count above is the whole finding.</div>`}
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${num(totalAssigned)} assigned lead${totalAssigned === 1 ? '' : 's'} across ${num(carrying.length)} of ${num(roster.length)} on the roster.
        ${leads ? `${num(unassigned.length)} more ${unassigned.length === 1 ? 'is' : 'are'} unassigned${unassignedHot.length ? `, ${num(unassignedHot.length)} of them HOT` : ''}${leadsCapped ? ` within the ${num(LEAD_LIMIT)} most recent leads read` : ''}.` : 'Leads could not be read, so unassigned leads are not counted here.'}
        ${idle.length ? `${nameList(idle)} ${plural(idle.length, 'holds', 'hold')} nothing at all and so ${plural(idle.length, 'has', 'have')} no bar here.` : ''}
      </div>
      <div class="cell-sub" style="margin-top:8px;white-space:normal">
        ${concentration
          ? `${esc(str(concentration.rep.name) || 'The top rep')} holds ${esc(pct(concentration.share * 100))} of the open pipeline against an even share of ${esc(pct(concentration.even * 100))}. `
          : carriers.length >= MIN_CARRIERS
            ? 'No single rep holds twice an even share of the open pipeline. '
            /* Not "the pipeline is evenly held" — nothing was measured. A share
               needs somebody to hold the other part of it. Open pipeline is
               budget_aed over the non-terminal leads read here, not
               v_team_performance.pipeline_aed — which is on the same rule since
               2 Sep 2026 but is not what this share is computed from. See item 5
               in the header. */
            : `Concentration is not measured here: ${num(carriers.length)} ${plural(carriers.length, 'rep carries', 'reps carry')} any open pipeline, and one person holding all of the money is a roster of one rather than a concentration. `}
        ${spread
          ? `A HOT lead is supposed to be auto-assigned to the least-loaded rep, so an uneven bar chart is either that trigger not firing or assignments made by hand around it —
             and this screen cannot tell you which: <span class="mono">leads</span> stores the owner and nothing about how the owner got there (no assigned_by, no assignment timestamp, no updated_at).`
          : `A HOT lead is supposed to be auto-assigned to the least-loaded rep, and with ${num(carrying.length)} ${plural(carrying.length, 'rep', 'reps')} carrying work there is only one place it can go — so nothing about how work is shared out is visible from here either way.
             <span class="mono">leads</span> would not answer it in any case: it stores the owner and nothing about how the owner got there (no assigned_by, no assignment timestamp, no updated_at).`}
        The one thing it can settle is whether the trigger is placing HOT work at all, which is the unassigned-HOT count above.
      </div>`;
  }

  const sla = el('div', 'card'); pair.appendChild(sla);
  const timed = timingTrusted ? roster.filter(r => (measured(r) ?? 0) > 0) : [];
  if (perfErr) {
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule</div>
      ${stateError('the performance view', perfErr)}`;
  } else if (!timingTrusted) {
    /* Not an empty state and not an error: the counters exist, they simply have
       no input. Everything below the headline — the split bar, both
       percentages, the breach ranking, the one-lead sentence — is a statement
       about the 5-minute rule, so the panel says why it cannot make one instead
       of drawing a green bar over it. Nothing here is switched off by hand or
       by date: the moment the trigger on communication_logs stamps any lead
       read here, this whole panel renders again. */
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule</div>
      <div class="banner warm">
        <span class="material-symbols-outlined">timer_off</span>
        <div>
          <div style="font-weight:500">Nobody can be scored against the 5-minute rule yet</div>
          <div class="cell-sub" style="white-space:normal;margin-top:6px">${esc(timingWhy)}</div>
        </div>
      </div>
      <div class="cell-sub" style="margin-top:12px;white-space:normal">${esc(NO_TIMING)}</div>
      <div class="cell-sub" style="margin-top:10px;white-space:normal">
        The ${num(roster.length)} ${plural(roster.length, 'person', 'people')} on the roster ${plural(roster.length, 'is', 'are')} neither passing nor
        failing this rule here — they are unscored, which is a third state and the only true one while no lead read here has been timed at all.
        An untimed lead is not a slow one and not a fast one, and it is not evidence that nobody answered it: the trigger declines to measure a
        reply that predates the lead row, which is the ordinary shape of a WhatsApp lead in this system. This panel is not disabled by hand and
        carries no date: it comes back by itself on the first lead the trigger stamps.</div>`;
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
    /* Everything below the headline count is a proportion, and a proportion over
       one lead is that lead wearing a percent sign: 100% within SLA and 0%
       breached is the same statement as "the one lead was answered in time", but
       it looks like a record. Under MIN_RATE_SAMPLE the split bar, both
       percentages and the breach ranking are withdrawn and the outcome is
       written as the sentence it is. The counts themselves are never withdrawn —
       they are what actually happened. */
    const rateable = m >= MIN_RATE_SAMPLE;
    const only = timed.length === 1 ? timed[0] : null;
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule · ${num(m)} measured lead${m === 1 ? '' : 's'}</div>
      ${rateable
        ? `<div class="stackbar">
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
      ${m <= THIN ? `<div class="cell-sub" style="margin-top:10px;white-space:normal"><span class="t-warm">These proportions are ${num(m)} leads in total — one more reply moves them by ${esc(pct(100 / m))}.</span></div>` : ''}`
        : `<div style="margin-top:4px">
             <span class="${breach ? 't-hot' : 't-ok'}" style="font-weight:500">${breach
               ? 'The one lead anyone has been timed on waited longer than five minutes for its first reply.'
               : 'The one lead anyone has been timed on was answered inside five minutes.'}</span>
             ${only ? `<div class="cell-sub" style="margin-top:6px">${esc(str(only.name) || 'The rep it is assigned to')} — ${esc(avgResponse(only) == null ? 'no response time on their row' : mins(avgResponse(only)) + ' to first reply')}.</div>` : ''}
           </div>
           <div class="cell-sub" style="margin-top:10px;white-space:normal">No percentage, split bar or breach ranking is drawn from it: over a single lead the only figures that exist are 0% and 100%, and neither says anything the sentence above does not. They come back at ${num(MIN_RATE_SAMPLE)} measured leads.</div>`}
      ${rateable
        ? (worst.length ? `<div class="label-caps" style="margin:16px 0 8px">Most breaches</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${worst.map(r => `<div style="display:flex;align-items:center;gap:12px">
            <div style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || 'Unnamed')}</div>
            <div class="cell-sub">${mins(avgResponse(r))} average</div>
            <div class="num t-hot" style="width:64px;text-align:right">${num(breachedSla(r))}</div>
          </div>`).join('')}
        </div>` : '<div class="cell-sub" style="margin-top:12px">Nobody on the roster has a breach against their name.</div>')
        : ''}
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${num(timed.length)} of ${num(roster.length)} on the roster ${plural(timed.length, 'has', 'have')} been timed on a lead. ${roster.length > timed.length
          ? 'The rest carry no measurement, which is not the same as being fast.'
          : 'Nobody on the roster is unmeasured.'}</div>`;
  }

  /* ── One rep, in full ──────────────────────────────────────────────────── */
  function openRep(r) {
    const owned = ownedBy(r);
    const m = measured(r), w = withinSla(r), b = breachedSla(r);
    /* What a delete would unassign — not strand: the FK is ON DELETE SET NULL,
       so the leads survive with a null owner. Stated from both sources rather
       than one, because the view's figure is all-time while the leads read here
       is a capped window, and quoting only the window would let "0 leads" appear
       next to a rep the view credits with nine. */
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
                  ${/* A null here is NOT "nobody answered". This printed
                        ' · no reply recorded' in HOT red until 1 Sep 2026 — a
                        claim about a customer, made by a screen that only knows
                        whether a trigger stamped a column. It was unreachable
                        while every lead carried 0 (timingTrusted was false, so
                        every lead took the arm above), and the database repair
                        that morning switched it on; the only thing still hiding
                        it is that no lead carries assigned_to_id, so ownedBy()
                        is empty for the one rep on the roster. Lead 35 is what
                        it would have printed against first: answered 74 seconds
                        before its own lead row existed, which the trigger will
                        not measure. The wording and the warm tone are
                        leads.js's, lib/lead-drawer.js's and customers.js's, so
                        the four surfaces that render this column say one
                        thing. */''}${!timingTrusted
                    ? ` · <span class="t-warm" title="${esc(NO_TIMING)}">reply time not measurable</span>`
                    : rtOf(l) == null
                      ? ` · <span class="t-warm" title="${esc(NULL_RT)}">no first reply timed</span>`
                      : ` · answered in ${esc(mins(l.response_time_minutes))}`}
                  ${l.escalated_at ? ` · <span class="t-warm">escalated ${esc(ago(l.escalated_at))}</span>` : ''}</div>
              </div>
              ${l.status ? pill(l.status, undefined, { verbatim: true }) : ''}
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
            <dt>Phone</dt><dd><span class="t-muted" title="${esc(NO_STAFF_PHONE)}">\u2014 no column to hold one</span></dd>
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
            ${statusPill(r)}${r.unlinked ? pill('Not in the user directory', 'warm', { verbatim: false }) : ''}
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
            <dt>Avg response</dt><dd class="num">${!timingTrusted
              ? `<span class="t-warm" title="${esc(NO_TIMING)}">Not measurable</span>`
              : avgResponse(r) == null
                ? '<span class="t-muted">Not measured</span>'
                : `<span class="${avgResponse(r) > 5 ? 't-hot' : 't-ok'}">${mins(avgResponse(r))}</span>${m === 1 ? ' <span class="cell-sub">· one lead, not an average</span>' : ''}`}</dd>
            <dt>Within 5 min</dt><dd class="num">${!timingTrusted
              ? `<span class="t-warm" title="${esc(NO_TIMING)}">Not scored</span>`
              : !m
                ? '<span class="t-muted">Nothing measured</span>'
                : m < MIN_RATE_SAMPLE
                  ? `${num(w ?? 0)} / ${num(m)} <span class="cell-sub">· one lead, so no percentage</span>`
                  : `${num(w ?? 0)} / ${num(m)} · ${pct(slaRate(r))}`}</dd>
            <dt>Breached</dt><dd class="num">${!timingTrusted
              ? `<span class="t-warm" title="${esc(NO_TIMING)}">Not scored</span>`
              : b == null ? notReported : `<span class="${b > 0 ? 't-hot' : ''}">${num(b)}</span>`}</dd>
            <dt>Open pipeline</dt><dd class="num">${!leads
              ? '<span class="t-muted">Leads could not be read, so open pipeline could not be summed</span>'
              : openPipelineOf(r) != null
                ? aed(openPipelineOf(r))
                : openLeadsOf(r).length
                  ? `<span class="t-muted">No budget on file across ${num(openLeadsOf(r).length)} open ${plural(openLeadsOf(r).length, 'lead', 'leads')}</span>`
                  : '<span class="t-muted">No open lead held</span>'}</dd>
          </dl>
          ${/* Said in the drawer as well as the header, because this is where a
                manager checks one person's number against what they believe. */''}
          <div class="cell-sub" style="margin-top:12px;white-space:normal">Open pipeline is <span class="mono">budget_aed</span> summed over the
            leads read on this screen that are assigned to this person and are not in a won or dead state${leadsCapped ? `, within the ${num(LEAD_LIMIT)} most recent leads` : ''}.
            <span class="mono">v_team_performance.pipeline_aed</span> is not shown in its place. Until 2 Sep 2026 it summed every lead ever assigned,
            disqualified and lost ones included; it now counts open leads only, on the same rule as the figure above. It is still not the number shown
            here, because this one can be traced to the leads listed below and says when its read was capped.</div>
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
              ? ` They have ${strandBits.join(' and ')} — every one of those would be handed back to the unassigned queue, with nothing on the row to say it had ever had an owner.`
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
