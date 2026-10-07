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

   6. WHO HAS ACCESS IS A DIFFERENT QUESTION FROM WHO IS ON THE ROSTER, and as
      of 6 Sep 2026 this screen answers both, in two cards, from two sources
      that are not interchangeable.

      `public.users` is the STAFF DIRECTORY — the people the dealership employs,
      what they are called, and whose name goes on a lead. A row there confers
      nothing: it is not a login and it grants no access. `public.tenant_members`
      is ACCESS — one row per Supabase Auth account that may open this
      dashboard, carrying the account role the database's own policies read.
      A person can exist in one and not the other, and both of those are real
      conditions rather than data errors: a staff record with no login is
      somebody who works here and does not use NEXUS; a login with no staff link
      is somebody who can sign in and, under rbac_04, can edit no leads at all.
      The access card names that second case rather than leaving it blank.

      The three tooltips this file used to carry — no invite, no role write, no
      delete — were true until this morning and two of them are not any more.
      Adding a colleague, changing a role and taking access away are live, and
      each goes through a named function that refuses by name: team_02's
      nexus_team_invite, team_03/team_05's nexus_team_set_role,
      nexus_team_link_staff and nexus_team_revoke_access. Every control on the
      access card is gated on lib/data.js's canManageAccess / canGrantOwner,
      which read `tenant_members.role` — THE SAME COLUMN the functions read.
      That is a courtesy, not a control: the refusal happens in the database
      against the same JWT, and PostgREST is reachable without this bundle.

      WHAT IS STILL NOT BUILT, and the card says so where somebody would look
      for it: NEXUS cannot send anybody a sign-in link. It holds no credential
      and must not — the browser carries the anon key, Supabase's own invite
      call needs the service_role key, and this project has no Edge Function to
      put one in. So adding a colleague records the ROLE, and the login is
      Supabase Auth's to create. The two outcomes are rendered differently
      because they are different: MEMBER_ADDED means that address already had a
      NEXUS login and access is live now; PENDING_FIRST_SIGN_IN means the role
      is waiting and somebody still has to give that person a way in.

      Removing a person from `users` is still not offered, for the reason
      NO_DELETE gives — that is the staff directory, and it is unchanged.
      Removing their ACCESS is offered, and is a different act.

   Nothing here is estimated: every number comes off a row — and where a row
   holds something other than what its column is named, item 5 says so and the
   number is withheld rather than printed under the wrong name. A panel whose
   table failed to load says so rather than showing a plausible blank. */
import { canGrantOwner, canManageAccess, db, dbWrite } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, dubaiStamp, esc, initials, mins, n0, num, pct, tone } from '../lib/format.js';
import { displayName, maskText } from '../lib/privacy.js';
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
import { closeDrawer, wireRows } from '../lib/ui.js';
import { BTN, actor, bannerClass, openDrawer, pill, stateEmpty, stateError, stateLoading, table, toneText } from '../lib/admin-kit.js';
import { sectionHeader, trustFooter } from '../lib/stitch-ui.js';

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

/* CONTROL-PLANE.md 5.8. These tooltips said WHY the control was dead in the
   vendor's terms — which table, which role, which policy, and the full list of
   deployed webhook paths. That is an unbuilt-feature disclosure and an
   inventory of the vendor's endpoints, rendered in the dealership's UI.

   Two of them stopped describing an unbuilt feature on 6 Sep 2026 and now point
   at the card that does the job, because a control that says "not built" beside
   a card that does it is worse than either. They still live on the STAFF
   directory row, where the act genuinely is different: giving somebody access
   is done by the address they will sign in with, not by picking a staff record,
   and a staff record is not a login. */
const NO_INVITE =
  'This is a staff record, not a login. Access is granted by the email address the person will sign in with — use "Add a colleague" under Who has access, below.';
/* The same distinction, for the disabled control on the pending-invite alert.
   NO_INVITE is about a staff record not being a login and points at this
   screen's own seat card, which is the right answer there and the wrong one
   here: the seat already exists, and what is missing is the mail. This button
   stays disabled because team.js has no send path — nexus_team_invite records a
   membership and sends nothing — and it names the one that does rather than
   implying nothing does. */
const NO_INVITE_FROM_HERE =
  'This screen records seats; it does not send mail. The invitation email is sent by NEXUS from the Team card on Settings, which an owner opens \u2014 that card, not this button, is the send path.';
const NO_ROLE_WRITE =
  'This is the job title on the staff record, and it grants nothing. The account role that decides what somebody may do is changed under Who has access, below.';
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
  'leads.response_time_minutes is written by one trigger and nothing else: nexus_mark_first_response, AFTER INSERT on the message history, which stamps the minutes between the lead row and the first reply it can attribute to that lead. A null means it never stamped — usually nothing has gone back since the lead row was created, and sometimes the only reply on file predates the lead row, which it declines to measure because that reply belongs to the conversation that produced the lead rather than to answering it. A null is therefore not a statement that nobody replied. Until 31 Aug 2026 a second, BEFORE INSERT trigger on leads clamped that negative interval to 0 and locked this writer out; it has been deleted, and the three live leads read 1 minute, null and 4 minutes (1 Sep 2026). within_sla and breached_sla in the team figures are count(*) FILTER on response_time_minutes at <= 5 and > 5, so a null lead counts in neither and their sum is the number of leads a rep was actually timed on. Wherever this note appears, that sum has nothing behind it in the leads read here, so nobody is scored against the 5-minute rule in either direction.';

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
  ? `<span class="font-label-numeric-sm">${esc(maskText(str(l.phone)))}</span>`
  : '<span class="text-on-surface-variant" title="No phone number is recorded on this lead.">\u2014</span>');

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
  if (!r.status) return `<span class="text-on-surface-variant">No status on file</span>`;
  if (isPending(r)) return pill('Pending invite', 'warm', { verbatim: false });
  return pill(statusLabel(r), hasAccount(r) ? 'ok' : undefined, { verbatim: true });
};

/* The Stitch metric strip (team-showroom-roster-access--bcd2c2, under the
   header): label and value on one line, on a low surface. The sentence each
   figure carries is kept beneath it, clamped to two lines, and in full on
   hover — it is the half of the tile that says what the number is not. */
const METRIC_VAL = { '': 'text-on-surface', 't-hot': 'text-red-700', 't-warm': 'text-amber-700', 't-ok': 'text-emerald-700' };
function metric(label, value, subHtml, cls = '') {
  const tip = String(subHtml || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return `<div class="flex flex-col gap-1 px-3 py-2.5 rounded-lg bg-surface-container-low min-w-0" title="${esc(tip)}">
    <div class="flex items-baseline justify-between gap-3"><span class="font-label-numeric-sm text-label-numeric-sm uppercase tracking-wider text-on-surface-variant truncate">${esc(label)}</span>
      <span class="font-label-numeric-md text-label-numeric-md font-bold ${METRIC_VAL[cls] || METRIC_VAL['']} whitespace-nowrap">${value}</span></div>
    <div class="font-body-sm text-[12px] leading-snug text-on-surface-variant line-clamp-2">${subHtml}</div></div>`;
}

/* ── Screen ──────────────────────────────────────────────────────────────── */
SCREENS.team = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js and screens/setup.js. */
  /* 7 Oct 2026 — the Stitch layout, design/stitch/team-showroom-roster-access
     --bcd2c2.html: page header, metric strip, attention cards, the roster
     table and "Who has access". The alert strip stays ABOVE the metric strip,
     for the reason given just below; every read, rule and control is unchanged.
     The export's "Export roster" button is not drawn (no export exists); its
     "Invite team member" button is, and it opens the add-a-colleague form in
     Who has access, which is the invite path this screen really has. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);
  const head = el('div');
  head.innerHTML = sectionHeader({ eyebrow: 'Operations · Governance & roster', title: 'Team & Showroom Roster',
    sub: 'Who is on the floor, what they are holding, how fast they answer, and who can open this dealership’s data.',
    actionsHtml: `<button type="button" class="${BTN.primary}" data-team-invite><span class="material-symbols-outlined text-[18px]">person_add</span><span class="whitespace-nowrap">Invite team member</span></button>` });
  root.appendChild(head);
  head.querySelector('[data-team-invite]').addEventListener('click', () => focusAccess(true));

  /* The alert strip sits above the KPI row on purpose. "How many people are on
     the team" is a fact; "a rep is holding nothing while a HOT lead has no
     owner" is a job, and the job must not be the thing you scroll past. */
  const alertHost = el('div'); root.appendChild(alertHost);
  const strip = el('div', 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-space-sm'); strip.innerHTML = stateLoading(2); root.appendChild(strip);
  const body = el('div', 'flex flex-col gap-space-md'); root.appendChild(body);

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
        : `Not one of the ${num(leads.length)} leads read here carries a response_time_minutes: the trigger on the message history has stamped none of them, so there is no measured wait to score anybody on. That is a statement about the record and not about the customers — a lead nobody answered and a lead whose only reply predates its own row are indistinguishable here.`;

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
      metric('Team members', num(roster.length),
        usersErr
          ? '<span class="text-amber-700">Directory unreadable — counted from the performance view</span>'
          /* "0 pending invite" beside a roster of one is a count of a thing that
             is not happening. It appears when there is something to report. */
          : `${num(withAccount.length)} with an account${pending.length ? ` · ${num(pending.length)} pending invite` : ''}`
            + (roster.length === 1 ? '<div class="text-on-surface-variant">The whole floor is one person</div>' : '')),
      /* These two lines said sending an invitation was not built. It is, and it
         ships in this bundle: the Team card on Settings calls the founder-invite
         Edge Function, which returns outcome 'invited' after NEXUS sends the
         mail. What is true of THIS screen is narrower — "Add a colleague" below
         calls nexus_team_invite, which records the seat and the role and sends
         nothing — so that is what these say now. Wording the narrow fact as a
         product limit sent an owner out of the product for a job the product
         does. */
      metric('Awaiting an invite', num(pending.length),
        pending.length
          ? '<span class="text-amber-700">A seat is recorded but no account exists — the invitation mail goes out from the Team card on Settings, which an owner opens</span>'
          : '<span class="text-emerald-700">Nobody is waiting on an invitation</span>'
            + '<div class="text-on-surface-variant">Adding a colleague below records the seat and the role; the invitation mail itself is sent by NEXUS from the Team card on Settings, which an owner opens</div>',
        pending.length ? 't-warm' : ''),
      /* The counts here are within_sla / breached_sla straight off the view, and
         both are count(*) FILTER on response_time_minutes, so their sum is the
         number of leads anyone was actually timed on and a null lead is in
         neither. Where the column has been stamped on nothing the figure is
         withheld rather than printed with a caveat under it: "3 / 3 · 100.0%"
         with an explanation beside it is still read as 100%. */
      metric('Within the 5-minute rule',
        (timingTrusted && measuredTot) ? `${num(withinTot ?? 0)} / ${num(measuredTot)}` : '—',
        !timingTrusted
          ? `<span class="text-amber-700" title="${esc(NO_TIMING)}">Nobody can be scored against the 5-minute rule yet</span>`
            + `<div class="text-on-surface-variant">${esc(timingWhy)}</div>`
          : !measuredTot
            ? '<span class="text-on-surface-variant">No rep row carries a response measurement</span>'
            /* One measured lead is an outcome, not a rate. The count stays — it
               is the fact — and the percentage is withdrawn with the reason. */
            : measuredTot < MIN_RATE_SAMPLE
              ? `<span class="text-on-surface-variant">One lead has been timed, so this is that lead's outcome and not a rate</span>`
                + (teamAvg == null ? '' : `<div class="text-on-surface-variant">Its ${esc(avgLabel)} ${esc(mins(teamAvg))}</div>`)
              : `${pct((withinTot ?? 0) / measuredTot * 100)} · ${esc(avgLabel)} ${esc(mins(teamAvg))}`
                + (measuredTot <= THIN ? `<div><span class="text-amber-700">Over ${num(measuredTot)} measured leads in total — a proportion this small moves a long way on one reply</span></div>` : ''),
        timingTrusted && measuredTot >= MIN_RATE_SAMPLE && (withinTot ?? 0) / measuredTot < 0.5 ? 't-hot' : ''),
      /* Open pipeline, not "pipeline". The label names exactly what is summed:
         budget_aed over the leads read here that are assigned to somebody and
         are not in a won or dead state. v_team_performance.pipeline_aed is not
         used and not shown. Until 2 Sep 2026 the reason was that it counted
         every lead ever assigned, and on today's table would have reported two
         DISQUALIFIED leads as money in play; it no longer does, and the reason
         now is that this figure can be attributed to named leads and can
         disclose its own truncation. */
      metric('Open pipeline in rep hands', pipelineTot == null ? '—' : aed(pipelineTot),
        !leads
          ? `<span class="text-on-surface-variant">Leads could not be read, so open pipeline could not be summed. ${esc(DB_PIPELINE_NOTE)}</span>`
          : pipelineTot == null
            ? (openHeld
                ? `<span class="text-on-surface-variant">${num(openHeld)} open ${plural(openHeld, 'lead is', 'leads are')} held, and not one of them carries a budget_aed — so there is a book here, but no money to total</span>`
                : '<span class="text-on-surface-variant">Nobody on the roster is holding an open lead</span>')
            : (roster.length === 1
                ? 'Held by the only person on the roster'
                : `Held by ${num(withPipeline)} of ${num(roster.length)} on the roster`)
              + `<div class="text-on-surface-variant">Open leads only — won and dead ones are excluded</div>`
              /* Same wording Overview prints on its own pipeline tile, from
                 lib/pipeline.js, so one truncation cannot be disclosed in two
                 strengths on two screens showing the same rule. */
              + (leadsCapped ? `<div class="text-amber-700">${esc(CAP_NOTE(num(LEAD_LIMIT)))}</div>` : '')),
      metric('Unassigned leads', leads ? num(unassigned.length) : '—',
        !leads
          ? `<span class="text-on-surface-variant">Leads could not be read</span>`
          : unassigned.length
            /* Which of them are HOT is the whole point: an unowned COLD lead is
               a queue, an unowned HOT lead is the auto-assign trigger failing. */
            ? `<span class="text-red-700">Nobody owns these</span>${unassignedHot.length ? ` · <span class="text-red-700">${num(unassignedHot.length)} HOT</span>` : ' · none of them HOT'}`
            : '<span class="text-emerald-700">Every lead read here has an owner</span>'
              + (leads.length <= THIN
                  ? `<div class="text-on-surface-variant">That is the whole your leads — ${num(leads.length)} ${plural(leads.length, 'row', 'rows')}, not a sample of it</div>`
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
  /* Assigned when the access card exists, at the bottom of this screen. Until
     then it is a no-op rather than undefined, so a click that lands during the
     first paint does nothing instead of throwing. */
  let focusAccess = () => {};
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
      ? '<span class="text-on-surface-variant">This alert carries no title</span>'
      : HANDLE.test(t)
        ? `<span class="font-label-numeric-sm">${esc(t)}</span> <span class="text-on-surface-variant">— a WhatsApp handle, not a name</span>`
        : esc(t);
    alerts.push({
      source: 'view',
      sev: str(it.severity) || 'WARM',
      /* True only when the word really is the view's; 'WARM' below is ours. */
      sevFromRow: str(it.severity) !== '',
      icon: KIND_ICON[low(it.kind)] || 'rule',
      at: it.at,
      titleHtml,
      detailHtml: (str(it.detail) ? esc(str(it.detail)) : 'The attention list recorded no detail on this row.')
        + (who || it.ref == null ? ''
          : ` <span class="text-on-surface-variant">Raised against <span class="font-label-numeric-sm">${esc(str(it.ref))}</span>, which matches nobody on the roster read here, so there is no row on this screen for it to open.</span>`),
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
        + `${plural(pending.length, 'sits', 'sit')} at <span class="font-label-numeric-sm">pending_invite</span>. They cannot sign in, cannot be alerted when a HOT lead lands and cannot be assigned one, `
        + `so their share of the floor is being carried by whoever else is on it. `
        + (oldest ? `The oldest of these accounts was created ${esc(ago(oldest))}. ` : 'None of these rows carries a creation date, so how long they have been waiting is not knowable. ')
        + 'Adding them here recorded a seat and a role; it sends no mail \u2014 that is all nexus_team_invite does. The invitation itself is sent by NEXUS from the Team card on Settings, which an owner can open, so this stays outstanding until somebody sends it from there rather than until an endpoint is written.',
      act: () => focusRoster('PENDING'),
      actLabel: 'Show them',
      noHook: { label: `Send invite${plural(pending.length, '', 's')}`, why: NO_INVITE_FROM_HERE },
    });
  }

  /* The pairing the auto-assign trigger exists to prevent: money waiting on the
     doorstep and somebody standing in the showroom with nothing to do. */
  if (leads && unassignedHot.length) {
    const shown = unassignedHot.slice(0, 4).map(l =>
      `${esc(str(l.name) ? displayName(str(l.name), l.id) : 'Unnamed lead')} ${leadPhone(l)} <span class="text-on-surface-variant">(${esc(ago(l.created_at))})</span>`).join(' · ');
    add({
      sev: 'HOT', icon: 'person_add_disabled', at: unassignedHot[0].created_at, atLabel: 'oldest arrived',
      titleHtml: `${num(unassignedHot.length)} HOT ${plural(unassignedHot.length, 'lead has', 'leads have')} no owner`
        + (idle.length ? ` while ${num(idle.length)} ${plural(idle.length, 'rep holds', 'reps hold')} nothing` : ''),
      detailHtml: `${shown}${unassignedHot.length > 4 ? ` and ${num(unassignedHot.length - 4)} more` : ''}. `
        + (idle.length ? `${nameList(idle)} ${plural(idle.length, 'has', 'have')} no lead at all against ${plural(idle.length, 'their name', 'their names')}. ` : '')
        + 'The auto-assign trigger is supposed to hand a HOT lead to the least-loaded rep, and these were handed to nobody, so on these rows it did not do its job. '
        + 'Whether it never fired or fired and failed is <em>not</em> readable from here: <span class="font-label-numeric-sm">leads</span> records who owns a lead and carries no record of who set the owner or when — no assigned_by, no assigned_at, no updated_at — so a trigger assignment and a hand assignment look identical afterwards. '
        + 'What can be said is that these rows have no owner of any kind.',
      act: () => go('leads'),
      actLabel: 'Open leads',
    });
  } else if (idle.length) {
    add({
      sev: 'WARM', icon: 'work_off',
      titleHtml: `${num(idle.length)} ${plural(idle.length, 'rep is', 'reps are')} holding no leads at all`,
      detailHtml: `${nameList(idle)} ${plural(idle.length, 'has', 'have')} an active account and no lead against ${plural(idle.length, 'their name', 'their names')} — `
        + `neither in <span class="font-label-numeric-sm">The team figures</span> nor in the ${leads ? `${num(leads.length)} ${plural(leads.length, 'lead', 'leads')} read here` : 'Your leads, which did not load'}. `
        /* This branch runs only when no HOT lead is unassigned, and it used to
           conclude from that alone that "nothing is going unworked". Unowned
           WARM and COLD leads are also work, and on this table there are three
           of them, one scored 65 — so the sentence said the opposite of what the
           KPI two inches above it said. Only what was actually checked is
           claimed, and the unowned leads are named when there are any. */
        + (leads
          ? (unassigned.length
            ? `No HOT lead is unassigned, but ${num(unassigned.length)} ${plural(unassigned.length, 'lead has', 'leads have')} no owner at all${topUnowned ? ` — the highest-scored of them is ${esc(maskText(str(topUnowned.name) || 'an unnamed lead'))} at ${num(topUnowned.ai_score)}` : ''}, so there is unowned work on the floor beside an idle rep. `
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
        + 'not a slow average, no <span class="font-label-numeric-sm">within_sla</span> or <span class="font-label-numeric-sm">breached_sla</span> count at all. That is usually what the view reports when nobody has replied, but it is not proof of it: the trigger also leaves a lead unstamped when its only reply predates the lead row. So this names work nobody has been timed on, not customers nobody has answered. '
        + (untimed != null
          ? `In the ${num(leads.length)} ${plural(leads.length, 'lead', 'leads')} read here, ${num(untimed)} of their ${plural(untimed, 'leads carries', 'leads carry')} no <span class="font-label-numeric-sm">response_time_minutes</span>${leadsCapped ? `, and that read is capped at ${num(LEAD_LIMIT)} so there may be more` : ''}.`
          : !leads
            ? 'Leads could not be read, so this cannot be confirmed lead by lead.'
            : 'It cannot be confirmed lead by lead either: not one lead read here carries a <span class="font-label-numeric-sm">response_time_minutes</span>, so counting the untimed ones would return every lead on the page no matter what happened.'),
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
        `${esc(str(r.name) || 'Unnamed')} <span class="text-red-700">${num(breachedSla(r))}</span>`
        + `${avgResponse(r) == null ? '' : ` <span class="text-on-surface-variant">(${esc(mins(avgResponse(r)))} average)</span>`}`).join(' · ')
        + `${breachers.length > 5 ? ` and ${num(breachers.length - 5)} more` : ''}. `
        + 'Each of these is a lead the view timed at longer than five minutes to a first reply — the window in which the odds of qualifying it drop by about four fifths. '
        + 'These counts come from the view itself and are all-time, not a window computed here. They are only shown at all because <span class="font-label-numeric-sm">leads.response_time_minutes</span> has been stamped on at least one lead read here; where it has been stamped on none, no breach is claimed against anybody.',
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
        + 'The imbalance is measured, not inferred. Its <em>cause</em> is not available: the auto-assign trigger is meant to give each HOT lead to the least-loaded rep, and since <span class="font-label-numeric-sm">leads</span> stores only the finished owner — no assigned_by, no assignment timestamp, not even an updated_at — a lead the trigger placed and a lead a manager placed by hand are indistinguishable on this screen. '
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
      detailHtml: `${nameList(unlinkedReps)} ${plural(unlinkedReps.length, 'appears', 'appear')} in <span class="font-label-numeric-sm">The team figures</span> and ${plural(unlinkedReps.length, 'matches', 'match')} nobody in <span class="font-label-numeric-sm">users</span> by id, email or name. `
        + 'They are shown on the roster below, labelled as unlinked rather than dropped — but they have no account record, so their role and status are unknown and no invite or role control can apply to them.',
      act: () => focusRoster('ALL'),
      actLabel: 'Show roster',
    });
  }

  if (usersErr && perf) {
    add({
      sev: 'WARM', icon: 'person_off',
      atHtml: '<span class="text-on-surface-variant" title="This is the state of this page load, not a stored condition.">this page load</span>',
      titleHtml: 'The user directory could not be read',
      detailHtml: `${esc(usersErr)}. Roles and account status below are whatever <span class="font-label-numeric-sm">The team figures</span> carries, `
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
      ? `<span class="text-amber-700">The attention list could not be read (${esc(attnErr)}), so anything the database had filed against this screen is missing from this strip. It files nothing against this screen as the view is currently defined, so that is likely to be nothing — but it could not be confirmed on this page load. The ${num(derivedCount)} ${plural(derivedCount, 'alert', 'alerts')} above ${plural(derivedCount, 'was', 'were')} derived here.</span>`
      : `${num(viewCount)} ${plural(viewCount, 'row', 'rows')} from the attention list where screen = ${SCREEN_ID}`
        + (viewCount ? '' : ', which is every row it can ever return here: none of its branches emits that screen name, so this is the view filing nothing about the team rather than the view finding nothing wrong with it')
        + `. ${num(derivedCount)} derived here from `
        + `${users ? `${num(users.length)} directory ${plural(users.length, 'row', 'rows')}` : 'no directory rows'}, `
        + `${perf ? `${num(perf.length)} performance ${plural(perf.length, 'row', 'rows')}` : 'no performance rows'} and `
        + `${leads ? `${num(leads.length)} ${plural(leads.length, 'lead', 'leads')}` : 'no leads'}.`,
    perfErr
      ? `<span class="text-amber-700">The performance view did not load (${esc(perfErr)}), so SLA breaches and reps holding leads it has never timed were not checked at all — they are absent from this list, not clear.</span>`
      : '',
    leadsErr
      ? `<span class="text-amber-700">Leads did not load (${esc(leadsErr)}), so unassigned leads, HOT leads with no owner and open pipeline — including its concentration on one rep — were not checked.</span>`
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
      : `<span class="text-amber-700">Nothing in this strip scores anybody against the 5-minute rule, and that is a gap rather than an all-clear. ${esc(timingWhy)} ${esc(NO_TIMING)}</span>`,
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
    return `<span class="text-on-surface-variant" title="${esc(a.source === 'view' ? 'This alert carries no timestamp.' : 'This is a standing condition computed from the current rows; nothing records when it started.')}">no start time</span>`;
  };

  /* The Stitch attention card (team-showroom-roster-access--bcd2c2: "SLA
     Breaches", "Stale Invitation", "Unassigned Leads"): a left rule in the
     severity's colour, an icon tile, the title and its chip, the detail, and
     the action at the foot. The detail is clamped to four lines with a "Read
     all" toggle rather than cut: every sentence in it was written to be read. */
  const CARD_TONE = {
    hot:     'relative rounded-xl bg-surface-container-lowest shadow-sm p-space-md flex flex-col gap-2 border-l-4 border-red-600',
    warm:    'relative rounded-xl bg-surface-container-lowest shadow-sm p-space-md flex flex-col gap-2 border-l-4 border-amber-500',
    cold:    'relative rounded-xl bg-surface-container-lowest shadow-sm p-space-md flex flex-col gap-2 border-l-4 border-sky-600',
    ok:      'relative rounded-xl bg-surface-container-lowest shadow-sm p-space-md flex flex-col gap-2 border-l-4 border-emerald-600',
    unknown: 'relative rounded-xl bg-surface-container-lowest shadow-sm p-space-md flex flex-col gap-2 border-l-4 border-outline',
  };
  const TILE_TONE = {
    hot: 'w-9 h-9 rounded-lg bg-red-50 text-red-700 flex items-center justify-center shrink-0',
    warm: 'w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0',
    cold: 'w-9 h-9 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center shrink-0',
    ok: 'w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0',
    unknown: 'w-9 h-9 rounded-lg bg-surface-container text-outline flex items-center justify-center shrink-0',
  };
  const DETAIL = { clamp: 'font-body-sm text-body-sm text-on-surface-variant line-clamp-4', full: 'font-body-sm text-body-sm text-on-surface-variant' };
  const alertItem = (a, i) => {
    const clickable = typeof a.act === 'function';
    const t = CARD_TONE[tone(a.sev)] ? tone(a.sev) : 'unknown';
    return `<div class="${CARD_TONE[t]}">
      <div class="flex items-start gap-3">
        <div class="${TILE_TONE[t]}"><span class="material-symbols-outlined text-[20px]" aria-hidden="true">${esc(a.icon)}</span></div>
        <div class="min-w-0 flex-1">
          <div class="font-headline-md text-body-lg font-semibold text-on-surface leading-snug">${a.titleHtml}</div>
          <div class="flex items-center gap-1.5 flex-wrap mt-1">${pill(String(a.sev).replace(/_/g, ' '), tone(a.sev), { verbatim: a.sevFromRow === true })}
            ${a.source === 'view' ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="Raised by the attention list, the shared cross-screen alert view, not computed on this screen.">shared</span>' : ''}</div>
        </div>
      </div>
      <div class="${DETAIL.clamp}" data-alert-detail="${i}">${a.detailHtml}</div>
      <button type="button" class="${BTN.tertiary} self-start" data-alert-more="${i}">Read all</button>
      <div class="mt-auto pt-2 border-t border-outline-variant/30 flex items-center justify-between gap-2 font-body-sm text-body-sm">
        <span class="text-on-surface-variant">${waitedHtml(a)}</span>
        <span class="flex items-center gap-2">
          ${a.noHook ? `<button type="button" class="${BTN.secondary}" disabled title="${esc(a.noHook.why)}">${esc(a.noHook.label)}</button>` : ''}
          ${clickable ? `<button type="button" class="${BTN.tertiary}" data-alert="${i}">${esc(a.actLabel || 'Open')}<span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>` : ''}
        </span>
      </div>
    </div>`;
  };

  if (!alerts.length) {
    /* No empty box. "Nothing needs a human" is only worth printing when it names
       what was looked at — otherwise it is indistinguishable from a panel that
       failed to render. v_needs_attention contributes nothing here in any case
       (it has no branch that emits screen = 'team'), so everything this heading
       covers was derived on this screen and the CHECKED line below is the whole
       of it.

       AND THE HEADLINE HAS TO ASK WHETHER THE READS HAPPENED, which until
       6 Sep 2026 it did not. Every derived alert on this strip comes from
       `users`, `v_team_performance` and `leads`. If any of the three failed,
       `alerts` is empty for the same reason an unplugged smoke detector is
       silent — and this card printed a green tick and "Nothing on the team
       screen needs a human right now" over it. Reproduced under an injected
       403 with all three reads failing.

       The qualifying prose underneath was already correct and already named
       each failed read; it was the heading that was wrong, and a heading beats
       a footnote. So an empty strip now has two different headlines, and the
       zero is only called a clear when all three reads came back. */
    const readsFailed = [
      usersErr ? 'the roster' : '',
      perfErr ? 'the performance view' : '',
      leadsErr ? 'leads' : '',
    ].filter(Boolean);

    alertHost.innerHTML = readsFailed.length
      ? `<div class="rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span class="material-symbols-outlined text-amber-700" style="font-size:20px" aria-hidden="true">help</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">Nothing could be checked on this screen — this is not an all-clear</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:6px">Every check in this strip is derived from
            ${esc(readsFailed.join(', '))}, and ${readsFailed.length === 1 ? 'that read' : 'those reads'} did not come
            back. An empty list here means nothing was looked at, not that nothing was found.</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:6px">${notesHtml}</div>
        </div></div></div>`
      : `<div class="rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span class="material-symbols-outlined text-emerald-700" style="font-size:20px" aria-hidden="true">task_alt</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">Nothing on the team screen needs a human right now</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:6px">${esc(CHECKED)}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:6px">${notesHtml}</div>
        </div></div></div>`;
  } else {
    alertHost.innerHTML = `<div class="flex flex-col gap-space-sm">
      <div class="flex items-end justify-between gap-space-sm px-1"><div class="min-w-0">
        <div class="font-headline-md text-headline-md text-on-surface">Needs attention · ${num(alerts.length)}</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(CHECKED)}</div></div></div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-space-md items-start">${alerts.map(alertItem).join('')}</div>
      <div class="flex items-start gap-3 px-space-md py-3 rounded-lg bg-surface-container-low">
        <span class="material-symbols-outlined text-outline text-[18px]" aria-hidden="true">info</span>
        <div class="font-body-sm text-body-sm text-on-surface-variant">${notesHtml}</div></div></div>`;
    const fire = i => { const a = alerts[Number(i)]; if (a && typeof a.act === 'function') a.act(); };
    alertHost.querySelectorAll('[data-alert]').forEach(node => node.addEventListener('click', () => fire(node.dataset.alert)));
    alertHost.querySelectorAll('[data-alert-more]').forEach(b => b.addEventListener('click', () => {
      const d = alertHost.querySelector(`[data-alert-detail="${b.dataset.alertMore}"]`);
      const open = d.className === DETAIL.clamp;
      d.className = open ? DETAIL.full : DETAIL.clamp;
      b.textContent = open ? 'Show less' : 'Read all';
    }));
  }

  if (!users && !perf) return;   /* the strip already carries the failure */

  /* ── Roster & performance ──────────────────────────────────────────────── */
  const card = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); body.appendChild(card);

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

  const notReported = '<span class="text-on-surface-variant">Not reported</span>';
  const cols = [
    { label: 'Name', strong: true, sort: 'name', render: r => `<div style="display:flex;align-items:center;gap:10px">
        <div class="w-9 h-9 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-label-numeric-sm text-label-numeric-sm font-bold shrink-0">${esc(initials(r.name))}</div>
        <div><div>${esc(r.name || 'Unnamed')}</div>
          <div class="font-label-numeric-sm text-[12px] text-outline">${r.email ? esc(r.email) : 'No email on file'}</div>
          ${r.unlinked ? '<div class="font-body-sm text-body-sm text-amber-700 mt-0.5">Not in the user directory</div>' : ''}
        </div></div>` },
    /* Contact, spelled out rather than implied. The phone line is the point of
       this column: every other screen shows a person's number beside their name,
       and a rep is the one kind of person this dashboard cannot do that for. The
       dash is rendered with the reason on it so nobody reads it as "this rep did
       not give us their number" — the column does not exist to be empty. */
    { label: 'Contact', render: r => `        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5 whitespace-nowrap" title="${esc(NO_STAFF_PHONE)}">Phone \u2014 none recorded</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${r.slack
          ? `Slack <span class="font-label-numeric-sm">${esc(r.slack)}</span>`
          : r.unlinked
            ? '<span class="text-on-surface-variant">No directory row, so no Slack id either</span>'
            : '<span class="text-on-surface-variant">No Slack id on file</span>'}</div>` },
    { label: 'Role', sort: 'role', render: r => r.role
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(r.role)}</span>`
        : '<span class="text-on-surface-variant">No role set</span>' },
    { label: 'Account', sort: 'account', render: r => statusPill(r) },
    { label: 'Leads', align: 'r', sort: 'leads', render: r => {
        const n = leadsAssigned(r);
        if (n == null) return notReported;
        const owned = ownedBy(r).length;
        return `${num(n)}${owned && owned !== n ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${num(owned)} in the leads read</div>` : ''}`;
      } },
    { label: 'HOT', align: 'r', sort: 'hot', render: r => {
        const n = hotLeads(r);
        return n == null ? notReported : `<span class="${n > 0 ? 'text-red-700' : 'text-on-surface-variant'}">${num(n)}</span>`;
      } },
    /* avg_response_minutes is round(avg(l.response_time_minutes), 1), and avg
       skips nulls, so it is an average over the leads a rep was timed on and
       not over their book. Where nothing has been stamped at all this cell
       shows the reason instead of a figure: "0m" in a green tone is the single
       most confident lie this screen could print. */
    { label: 'Avg response', align: 'r', sort: 'response', render: r => {
        if (!timingTrusted) return `<span class="text-amber-700" title="${esc(NO_TIMING)}">Not measurable</span>`;
        const a = avgResponse(r);
        if (a == null) return '<span class="text-on-surface-variant">Not measured</span>';
        /* An average of one is that one. The figure is real either way; the word
           "average" is what would be doing the lying. */
        return `<span class="${a > 5 ? 'text-red-700' : 'text-emerald-700'}">${mins(a)}</span>`
          + (measured(r) === 1 ? '<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">one lead, not an average</div>' : '');
      } },
    /* within_sla and breached_sla are both count(*) FILTER on
       response_time_minutes, at <= 5 and > 5, so a lead carrying a null falls
       into neither and the pair partitions the leads that were measured rather
       than the rep's whole book. The denominator here is that measured count
       and never leads_assigned. Where nothing has been stamped the counts are
       withheld rather than captioned — "1 / 1" beside an explanation is still
       read as one for one. */
    { label: 'Within SLA', align: 'r', sort: 'sla', render: r => {
        if (!timingTrusted) return `<span class="text-amber-700" title="${esc(NO_TIMING)}">Not scored</span>`;
        const m = measured(r), w = withinSla(r);
        if (!m) return '<span class="text-on-surface-variant">Nothing measured</span>';
        if (m < MIN_RATE_SAMPLE) {
          return `${num(w ?? 0)} / ${num(m)}<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${w ? 'answered in time' : 'breached'} — one lead, so no rate</div>`;
        }
        const rate = slaRate(r);
        return `${num(w ?? 0)} / ${num(m)}<div class="${rate != null && rate < 50 ? 'font-body-sm text-body-sm text-red-700 mt-0.5' : 'font-body-sm text-body-sm text-on-surface-variant mt-0.5'}">${pct(rate)}</div>`;
      } },
    /* Open pipeline, summed here from the leads read on this screen — not
       v_team_performance.pipeline_aed. That column summed every lead ever
       assigned and COALESCEd to 0 until 2 Sep 2026; it is now filtered to open
       leads on the database's own mirror of this rule and returns NULL for an
       absence. It is still not read here, because this figure can be attributed
       to the leads listed below it and can say when its read was capped. The
       header explains it; the label names what is actually added up. */
    { label: 'Open pipeline', align: 'r', sort: 'pipeline', render: r => {
        if (!leads) return `<span class="text-on-surface-variant" title="Leads could not be read on this page load, so there is nothing here to add up. The performance view's own pipeline_aed is not shown in its place: since 2 Sep 2026 it counts open leads only, on the same rule as this column, but it cannot be attributed to the leads this screen would list, so it is not substituted for a figure this screen could not compute.">Not summable</span>`;
        const p = openPipelineOf(r);
        if (p != null) return aed(p);
        const open = openLeadsOf(r).length;
        return open
          ? `<span class="text-on-surface-variant">No budget on file</span><div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${num(open)} open ${plural(open, 'lead', 'leads')}, none carrying a budget_aed</div>`
          : '<span class="text-on-surface-variant">No open lead held</span>';
      } },
    /* The access column exists only while somebody on the STAFF directory is
       marked pending. Kept in the list rather than deleted — the day a seat is
       created it comes back by itself — but a column of dashes across a roster
       where nobody is pending pushes the columns that carry something off the
       width.

       The button is live now and it does one honest thing: it takes you to the
       card that can actually grant access. It deliberately does NOT pre-fill
       anything, because a `users` row at pending_invite has a NULL email (that
       is why nobody was ever invited) and a control that looked like it knew
       the address would be inventing one. */
    { label: 'Action', align: 'r', render: () => '<span class="material-symbols-outlined text-outline text-[20px]" aria-hidden="true">chevron_right</span>' },
    ...(pending.length ? [{ label: 'Access', align: 'r', render: r => isPending(r)
        ? `<button class="${BTN.secondary}" data-goaccess aria-label="Give ${esc(r.name || 'this team member')} access to NEXUS"
             title="${esc(NO_INVITE)}">Give access</button>`
        : '<span class="text-on-surface-variant">—</span>' }] : []),
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

  card.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm"><div>
      <div class="font-headline-md text-headline-md text-on-surface">Roster &amp; performance</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Who exists comes from the accounts NEXUS holds for this dealership; what they did is
        measured from their own leads and replies. Sort by any column header. Click a row for the full record.
        ${perfErr ? '<span class="text-amber-700">The performance figures could not be read, so only the roster is shown. That is a read that failed, not a team with nothing to show.</span>' : ''}</div>
    </div></div>
    ${oneRow
      /* Nothing at all when the roster is empty — the table's own empty state
         below already says what is missing, and a toolbar above it explaining
         that there is nothing to filter is a second empty box saying the same. */
      ? (roster.length
          ? `<div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40"><div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">${esc('One person is on the roster, so there is nothing to filter or search for: every slice would return the same row. The filters come back when there is a second person to tell apart from the first.')}</div></div>`
          : '')
      : `<div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40">
      <div class="inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-surface-container [&>button]:px-3 [&>button]:py-1 [&>button]:rounded-md [&>button]:font-body-sm [&>button]:text-body-sm [&>button]:font-semibold [&>button]:text-on-surface-variant [&>button:hover]:text-on-surface [&>button.on]:bg-surface-container-lowest [&>button.on]:text-on-surface [&>button.on]:shadow-sm" id="tSegView" role="group" aria-label="Filter the roster">
        ${offeredViews.map((k, i) => `<button data-v="${esc(k)}" class="${i === 0 ? 'on' : ''}">${esc(VIEWS[k].label)} · ${num(counts[k])}</button>`).join('')}
      </div>
      <div class="flex-1 min-w-0"><input type="search" id="tq" class="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary" aria-label="Search the roster" placeholder="Search name, email or role" /></div>
      <div class="text-on-surface-variant font-label-numeric-sm" id="tCount"></div>
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
        ${esc(col.label)}<span class="material-symbols-outlined ${active ? '' : 'text-outline'}"
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
    /* Wired after wireRows, and stopPropagation is load-bearing: the whole row
       opens the drawer, so without it "Give access" would open the drawer AND
       jump the page, and the drawer would win the scroll. */
    th.querySelectorAll('[data-goaccess]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      focusAccess();
    }));
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
  const pair = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-space-md'); body.appendChild(pair);

  const workload = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md'); pair.appendChild(workload);
  const carrying = roster.filter(r => (leadsAssigned(r) ?? 0) > 0)
    .sort((a, b) => leadsAssigned(b) - leadsAssigned(a));
  if (perfErr) {
    workload.innerHTML = `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:12px">Workload by rep</div>
      ${stateError('the performance view', perfErr)}`;
  } else if (!carrying.length) {
    workload.innerHTML = `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:12px">Workload by rep</div>
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
    workload.innerHTML = `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:12px">Workload by rep</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${carrying.map(r => {
          const n = leadsAssigned(r);
          const hot = hotLeads(r);
          return `<div style="display:flex;align-items:center;gap:12px">
            <div style="width:120px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || 'Unnamed')}</div>
            ${spread
              ? `<div class="h-1.5 rounded-full bg-surface-container overflow-hidden" style="flex:1;height:10px"><i class="block h-full rounded-full bg-primary" style="width:${(n / top * 100).toFixed(1)}%"></i></div>`
              : `<div style="flex:1" class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${num(n)} ${plural(n, 'lead', 'leads')} against their name</div>`}
            <div class="text-on-surface-variant font-label-numeric-sm" style="width:88px;text-align:right">${num(n)}${hot ? ` · <span class="text-red-700">${num(hot)} hot</span>` : ''}</div>
          </div>`;
        }).join('')}
      </div>
      ${spread ? '' : `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:10px;white-space:normal">
        ${num(carrying.length)} ${plural(carrying.length, 'rep holds', 'reps hold')} any lead at all, so there is no distribution to chart:
        a single bar is the full width of itself by construction and would read as a rep at capacity. The count above is the whole finding.</div>`}
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:12px;white-space:normal">
        ${num(totalAssigned)} assigned lead${totalAssigned === 1 ? '' : 's'} across ${num(carrying.length)} of ${num(roster.length)} on the roster.
        ${leads ? `${num(unassigned.length)} more ${unassigned.length === 1 ? 'is' : 'are'} unassigned${unassignedHot.length ? `, ${num(unassignedHot.length)} of them HOT` : ''}${leadsCapped ? ` within the ${num(LEAD_LIMIT)} most recent leads read` : ''}.` : 'Leads could not be read, so unassigned leads are not counted here.'}
        ${idle.length ? `${nameList(idle)} ${plural(idle.length, 'holds', 'hold')} nothing at all and so ${plural(idle.length, 'has', 'have')} no bar here.` : ''}
      </div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px;white-space:normal">
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
             and this screen cannot tell you which: <span class="font-label-numeric-sm">leads</span> stores the owner and nothing about how the owner got there (no assigned_by, no assignment timestamp, no updated_at).`
          : `A HOT lead is supposed to be auto-assigned to the least-loaded rep, and with ${num(carrying.length)} ${plural(carrying.length, 'rep', 'reps')} carrying work there is only one place it can go — so nothing about how work is shared out is visible from here either way.
             <span class="font-label-numeric-sm">leads</span> would not answer it in any case: it stores the owner and nothing about how the owner got there (no assigned_by, no assignment timestamp, no updated_at).`}
        The one thing it can settle is whether the trigger is placing HOT work at all, which is the unassigned-HOT count above.
      </div>`;
  }

  const sla = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md'); pair.appendChild(sla);
  const timed = timingTrusted ? roster.filter(r => (measured(r) ?? 0) > 0) : [];
  if (perfErr) {
    sla.innerHTML = `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:12px">The 5-minute rule</div>
      ${stateError('the performance view', perfErr)}`;
  } else if (!timingTrusted) {
    /* Not an empty state and not an error: the counters exist, they simply have
       no input. Everything below the headline — the split bar, both
       percentages, the breach ranking, the one-lead sentence — is a statement
       about the 5-minute rule, so the panel says why it cannot make one instead
       of drawing a green bar over it. Nothing here is switched off by hand or
       by date: the moment the trigger on communication_logs stamps any lead
       read here, this whole panel renders again. */
    sla.innerHTML = `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:12px">The 5-minute rule</div>
      <div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm mb-space-sm">
        <span class="material-symbols-outlined">timer_off</span>
        <div>
          <div style="font-weight:500">Nobody can be scored against the 5-minute rule yet</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:6px">${esc(timingWhy)}</div>
        </div>
      </div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:12px;white-space:normal">${esc(NO_TIMING)}</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:10px;white-space:normal">
        The ${num(roster.length)} ${plural(roster.length, 'person', 'people')} on the roster ${plural(roster.length, 'is', 'are')} neither passing nor
        failing this rule here — they are unscored, which is a third state and the only true one while no lead read here has been timed at all.
        An untimed lead is not a slow one and not a fast one, and it is not evidence that nobody answered it: the trigger declines to measure a
        reply that predates the lead row, which is the ordinary shape of a WhatsApp lead in this system. This panel is not disabled by hand and
        carries no date: it comes back by itself on the first lead the trigger stamps.</div>`;
  } else if (!timed.length) {
    sla.innerHTML = `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:12px">The 5-minute rule</div>
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
    sla.innerHTML = `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:12px">The 5-minute rule · ${num(m)} measured lead${m === 1 ? '' : 's'}</div>
      ${rateable
        ? `<div class="flex h-2.5 rounded-full overflow-hidden bg-surface-container">
        <i class="block h-full" style="width:${(w / m * 100).toFixed(1)}%;background:var(--ok)"></i>
        <i class="block h-full" style="width:${(breach / m * 100).toFixed(1)}%;background:var(--hot)"></i>
      </div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span>
          <span style="font-weight:500">Answered within 5 min</span><span class="text-on-surface-variant font-label-numeric-sm">${num(w)} · ${pct(w / m * 100)}</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--hot)"></span>
          <span style="font-weight:500">Breached</span><span class="text-on-surface-variant font-label-numeric-sm">${num(breach)} · ${pct(breach / m * 100)}</span></div>
      </div>
      ${m <= THIN ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:10px;white-space:normal"><span class="text-amber-700">These proportions are ${num(m)} leads in total — one more reply moves them by ${esc(pct(100 / m))}.</span></div>` : ''}`
        : `<div style="margin-top:4px">
             <span class="${breach ? 'text-red-700' : 'text-emerald-700'}" style="font-weight:500">${breach
               ? 'The one lead anyone has been timed on waited longer than five minutes for its first reply.'
               : 'The one lead anyone has been timed on was answered inside five minutes.'}</span>
             ${only ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:6px">${esc(str(only.name) || 'The rep it is assigned to')} — ${esc(avgResponse(only) == null ? 'no response time on their row' : mins(avgResponse(only)) + ' to first reply')}.</div>` : ''}
           </div>
           <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:10px;white-space:normal">No percentage, split bar or breach ranking is drawn from it: over a single lead the only figures that exist are 0% and 100%, and neither says anything the sentence above does not. They come back at ${num(MIN_RATE_SAMPLE)} measured leads.</div>`}
      ${rateable
        ? (worst.length ? `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin:16px 0 8px">Most breaches</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${worst.map(r => `<div style="display:flex;align-items:center;gap:12px">
            <div style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || 'Unnamed')}</div>
            <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${mins(avgResponse(r))} average</div>
            <div class="text-red-700 font-label-numeric-sm" style="width:64px;text-align:right">${num(breachedSla(r))}</div>
          </div>`).join('')}
        </div>` : '<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:12px">Nobody on the roster has a breach against their name.</div>')
        : ''}
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:12px;white-space:normal">
        ${num(timed.length)} of ${num(roster.length)} on the roster ${plural(timed.length, 'has', 'have')} been timed on a lead. ${roster.length > timed.length
          ? 'The rest carry no measurement, which is not the same as being fast.'
          : 'Nobody on the roster is unmeasured.'}</div>`;
  }

  /* ── Who has access ───────────────────────────────────────────────────────
     Built 6 Sep 2026. The role model landed on 5 September — column grants,
     RESTRICTIVE RLS and a trigger, proved against 37 adversarial cases — and
     its own closing note was that it had no product surface, so a dealership
     could not add a colleague, see who had access, change a role, or take
     access away when a rep left. That last one is not a nicety: a dealership
     that cannot revoke a departed employee's access does not pass its own
     procurement review.

     WHY THIS IS A SEPARATE READ FROM THE ROSTER ABOVE. `public.tenant_members`
     is not readable from the browser as a table — its only `authenticated`
     policy is `auth_user_id = auth.uid()`, so a signed-in owner sees exactly
     one row, their own — and `auth.users`, which holds the address a colleague
     signs in with, is not readable at all. Both are deliberate and neither was
     widened. `rpc/nexus_team_roster` is a SECURITY DEFINER projection scoped by
     `nexus_current_tenant_ids()`, the same key every tenant policy uses; it is
     the same pattern `nexus_workflow_catalogue()` set that morning, and it is
     what lets a column be absent by construction rather than by whichever
     grant nobody revoked.

     EVERY CONTROL IS GATED ON THE SAME AUTHORITY THE DATABASE ENFORCES —
     `tenant_members.role`, read through lib/data.js's canManageAccess and
     canGrantOwner. Not on `users.role`, which is a job title and confers
     nothing. Two sources would drift, and the one that lost would be this one.
     None of it is a security control: the refusal happens in the database
     against the same JWT and PostgREST is reachable without this bundle.
     Unknown authority shows the control, for the reason lib/data.js gives.

     AND A WRITE THAT COMES BACK EMPTY IS NOT A SAVE. Every handler below checks
     what came back before it says anything happened — the lesson lib/unit-form.js
     and lib/lead-drawer.js were both fixed for. These particular writes are RPCs
     that raise on refusal rather than returning [], so an empty array here means
     something unexpected; it is still reported as "nothing was saved" rather
     than as success, because the alternative is telling somebody their rep is
     locked out when they are not. */
  const access = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); body.appendChild(access);
  focusAccess = toForm => {
    const target = (toForm && access.querySelector('#acEmail')) || access;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (toForm) access.querySelector('#acEmail')?.focus({ preventScroll: true });
  };

  /* The vocabulary the database enforces, in the dealership's words. The
     database is the authority — these are migrations rbac_02/rbac_04/rbac_05 —
     and this is a description of them, not a second copy of the rule: nothing
     on this screen decides anything from these strings. */
  const ROLE_ORDER = ['owner', 'admin', 'manager', 'sales', 'technician', 'member'];
  const ROLE_WHAT = {
    owner:      'Everything, including cost price, deleting a vehicle, and who else has access.',
    admin:      'Everything an owner can do, except that only an owner may grant or remove the owner role.',
    manager:    'Edit vehicles and their asking price, and reassign any lead. Not cost price, not adding or deleting a vehicle.',
    sales:      'Their own leads only. Vehicles are read-only.',
    technician: 'Read-only. No lead and no vehicle can be changed.',
    member:     'The floor, and what a new account gets if nobody chooses: their own leads only, vehicles read-only.',
  };
  /* Every role gets an EXPLICIT tone. pill() falls back to tone(label) when
     none is given, and tone() guesses from the words it knows about leads and
     deals — 'sales' is not one of them and a wrong guess would colour an
     account role as though it were a lead temperature. */
  const ROLE_TONE = { owner: 'vip', admin: 'vip', manager: 'cold', sales: 'unknown', technician: 'unknown', member: 'unknown' };
  const roleChip = k => pill(k || 'unknown', ROLE_TONE[k] || 'unknown');

  /* Said wherever somebody would look for "send them an invitation". NEXUS
     holds no credential and must not: the browser carries the anon key,
     Supabase's own invite call needs the service_role key, and there is no
     server-side place in this deployment to put one. */
  const NO_CREDENTIAL =
    'NEXUS cannot send a sign-in link and never handles a password or an invitation token. Recording somebody here decides their role; creating their login is Supabase Auth’s job, and whoever administers the NEXUS account has to invite the address there or give them a sign-in route another way.';
  const REVOKE_MEANS =
    'Removing access deletes this person’s membership of the dealership, so every screen and every row goes to nothing for them immediately. It does NOT delete their NEXUS login — that is Supabase Auth’s and NEXUS holds no credential — so they can still sign in and will see an empty product. It does not touch their staff record and it does not reassign their leads.';

  /* Only an NX001 refusal carrying a machine code this screen recognises is
     shown to the user; anything else falls back to the user-safe clause
     lib/errors.js wrote. `.technical` is read rather than `.message` for the
     same reason screens/finance.js reads it: since 5 Sep 2026 `.message` is a
     generic sentence, and the refusal a person needs is inside the wire body.
     Nothing else in that body reaches the screen. */
  const TEAM_CODE = /^NX_TEAM_[A-Z_]+$/;
  function accessRefusal(e) {
    const raw = String(e && e.technical || '');
    const i = raw.indexOf('{');
    if (i < 0) return null;
    try {
      const j = JSON.parse(raw.slice(i));
      if (!j || j.code !== 'NX001' || !TEAM_CODE.test(String(j.details || ''))) return null;
      return { line: String(j.message || ''), next: String(j.hint || '') };
    } catch { return null; }
  }
  const accessError = e => {
    const r = accessRefusal(e);
    return r ? `${r.line}${r.next ? ' ' + r.next : ''}` : String(e && e.message || 'The change did not go through.');
  };

  /* Nulls, not empty arrays, until a read has answered: a directory that failed
     and a dealership with nobody in it are opposite statements, and this card
     must never render the second when the first is true. */
  let acRows = null, acRowsErr = null, acPend = null, acPendErr = null;
  let acMsg = '', acMsgTone = 'ok', acConfirm = null, acBusy = false;

  const acLeadsFor = staffId => (staffId && leads)
    ? leads.filter(l => String(l.assigned_to_id || '') === String(staffId)).length
    : null;

  async function acLoad() {
    const [rosterR, pendR] = await Promise.allSettled([
      db('rpc/nexus_team_roster'),
      db('rpc/nexus_team_pending'),
    ]);
    acRows = rosterR.status === 'fulfilled' ? rosterR.value : null;
    acRowsErr = rosterR.status === 'rejected' ? rosterR.reason : null;
    acPend = pendR.status === 'fulfilled' ? pendR.value : null;
    acPendErr = pendR.status === 'rejected' ? pendR.reason : null;
    acDraw();
  }

  function acRoleCell(r, mayManage, mayOwner) {
    const roleWord = roleChip(r.account_role);
    if (!mayManage) {
      return `${roleWord}<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">${esc(ROLE_WHAT[r.account_role] || 'This role is not one this screen has words for; the database is the authority on what it allows.')}</div>`;
    }
    /* An admin may set any role below owner, their own included, and may not
       set or remove owner. That is team_05's NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY,
       which tests the roles rather than the people — so the option is dropped
       rather than shown and refused, and the sentence under the control says
       why it is missing. */
    const opts = ROLE_ORDER
      .filter(k => mayOwner || (k !== 'owner' && r.account_role !== 'owner'))
      .map(k => `<option value="${esc(k)}"${k === r.account_role ? ' selected' : ''}>${esc(k)}</option>`).join('');
    if (!opts) {
      return `${roleWord}<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">Only an account owner may change an owner’s role.</div>`;
    }
    return `<select class="px-2 py-1 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-on-surface" data-acrole="${esc(r.auth_user_id)}" aria-label="Account role for ${esc(r.email || 'this person')}">${opts}</select>
      <button class="${BTN.secondary}" data-acsave="${esc(r.auth_user_id)}">Save role</button>
      ${mayOwner ? '' : '<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">The owner role is not on this list because only an account owner may grant or remove it.</div>'}`;
  }

  function acStaffCell(r, mayManage) {
    const linked = r.staff_user_id
      ? `${esc(r.staff_name || 'a staff record with no name on it')}${r.staff_job_title ? ` <span class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">· ${esc(r.staff_job_title)}</span>` : ''}`
      : '<span class="text-amber-700">Not linked to a staff record</span>';
    /* The unlinked case is rbac open item 4 and it is a working defect, not a
       cosmetic gap: leads.assigned_to_id points at the STAFF id, so a sales
       login with no link matches no lead and can edit none of them. It presents
       as "the product is broken" unless something says otherwise, so something
       does. */
    const why = r.staff_user_id ? '' :
      `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal"><span class="text-amber-700">This account can sign in but is not connected to anybody on the staff directory.</span>
         Leads are filed against a staff record, so ${esc(r.account_role === 'sales' || r.account_role === 'member' ? 'this person can currently edit no leads at all' : 'nothing on this screen can attribute work to them')}.</div>`;
    if (!mayManage) return linked + why;
    const opts = ['<option value="">Not linked</option>'].concat(
      (users || []).map(u => `<option value="${esc(u.id)}"${String(u.id) === String(r.staff_user_id || '') ? ' selected' : ''}>${esc(u.name || u.email || u.id)}</option>`)).join('');
    return `${linked}${why}
      <div style="margin-top:6px">
        <select class="px-2 py-1 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-on-surface" data-acstaff="${esc(r.auth_user_id)}" aria-label="Staff record for ${esc(r.email || 'this person')}">${opts}</select>
        <button class="${BTN.secondary}" data-aclink="${esc(r.auth_user_id)}">Link</button>
        ${usersErr ? '<div class="font-body-sm text-body-sm text-amber-700 mt-0.5" style="white-space:normal">The staff directory could not be read on this page load, so this list is empty rather than short.</div>' : ''}
      </div>`;
  }

  function acDraw() {
    const mayManage = canManageAccess();
    const mayOwner = canGrantOwner();
    const rows = acRows || [];
    const pend = acPend || [];

    const head = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Who has access</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Every NEXUS login that can open this dealership’s data, and what the database lets each of them do.
          This is not the staff directory above: a staff record is not a login and grants nothing.
          ${mayManage ? '' : 'Changing any of this is an owner or admin decision, so the controls are not offered on this account.'}</div>
      </div></div>`;

    const msg = acMsg
      ? `<div style="padding:0 20px 12px"><div class="${bannerClass(acMsgTone === 'ok' ? 'ok' : 'hot')}">
           <span class="material-symbols-outlined">${acMsgTone === 'ok' ? 'check_circle' : 'error'}</span>
           <div style="white-space:normal">${esc(acMsg)}</div></div></div>`
      : '';

    let list;
    if (acRowsErr) {
      list = stateError('who has access', acRowsErr, null,
        'Nobody has been removed and nothing has changed — this is a read that failed, not an empty dealership.');
    } else if (!rows.length) {
      /* Structurally almost impossible: the caller is reading through their own
         membership, so a successful read returns at least themselves. Said as
         what it is rather than as "no team". */
      list = stateEmpty('No access records came back',
        'The read succeeded and returned nobody — not even the account you are signed in as, which should always appear. Nothing has been changed; report this rather than acting on it.', 'help');
    } else {
      /* The Stitch "Who Has Access" table: one row per login, the role and the
         staff-record link as inline controls, the approval state, and the
         action at the end. A removal being confirmed opens a full-width row
         under its own. */
      const TH = 'py-3 px-4 text-left align-bottom';
      list = `<div class="overflow-x-auto"><table class="w-full text-left border-collapse">
        <thead><tr class="bg-surface-container-low border-b border-outline-variant/30 text-outline font-table-header text-table-header uppercase">
          <th class="${TH}">User</th><th class="${TH}">Email</th><th class="${TH}">Role</th><th class="${TH}">Staff record</th><th class="${TH}">Last sign-in</th><th class="${TH}">Approver</th><th class="py-3 px-4 text-right align-bottom">Actions</th></tr></thead>
        <tbody class="divide-y divide-outline-variant/20 font-body-sm text-body-sm text-on-surface">${rows.map(r => {
        const n = acLeadsFor(r.staff_user_id);
        const confirming = acConfirm === r.auth_user_id;
        return `<tr class="hover:bg-surface-container-low transition-colors align-top">
          <td class="py-3 px-4"><div class="font-semibold">${esc(r.staff_name || r.email || 'Unnamed account')}${r.is_self ? ' <span class="font-body-sm text-body-sm text-on-surface-variant">· you</span>' : ''}</div>
            <div class="font-body-sm text-[12px] text-outline">Added ${esc(dubaiStamp(r.member_since))}</div></td>
          <td class="py-3 px-4 font-label-numeric-sm text-label-numeric-sm">${esc(r.email || 'no address on the account')}</td>
          <td class="py-3 px-4 min-w-[220px]">${acRoleCell(r, mayManage, mayOwner)}</td>
          <td class="py-3 px-4 min-w-[220px]">${acStaffCell(r, mayManage)}</td>
          <td class="py-3 px-4 font-label-numeric-sm text-label-numeric-sm whitespace-nowrap">${r.last_sign_in_at ? esc(ago(r.last_sign_in_at)) : '<span class="text-on-surface-variant">Never signed in</span>'}</td>
          <td class="py-3 px-4 min-w-[150px]">
              ${/* NULL is not false. No inventory_action_policy row means nobody
                    has STATED who may approve, which is a different answer from
                    "this person may not". */''}
              ${r.is_approver === true
                ? `${pill('Can approve', 'ok')}<div class="font-body-sm text-[12px] text-on-surface-variant">by their account role</div>`
                : r.is_approver === false
                  ? '<span class="text-on-surface-variant">Not an approver</span>'
                  : '<span class="text-on-surface-variant" title="This dealership has no approval policy on file, so who may approve an inventory action has never been decided. That is not the same as nobody being allowed.">Not stated</span>'}</td>
          <td class="py-3 px-4 text-right">
              ${mayManage && !confirming
                ? `<button type="button" class="${BTN.tertiary}" data-acrevoke="${esc(r.auth_user_id)}"><span class="material-symbols-outlined text-[16px]">person_remove</span>Remove access</button>`
                : mayManage ? '' : '<span class="text-on-surface-variant">—</span>'}</td>
        </tr>
        ${confirming ? `<tr><td colspan="7" class="px-4 pb-3"><div class="${bannerClass('hot')}">
            <span class="material-symbols-outlined">warning</span>
            <div>
              <div class="font-semibold">Remove ${esc(r.email || r.staff_name || 'this account')} from ${esc(r.tenant_name || 'this dealership')}?</div>
              <div class="mt-1.5">${esc(REVOKE_MEANS)}</div>
              <div class="mt-1.5">${n == null
                ? 'They are not linked to a staff record, so no lead on this screen is filed against them.'
                : `${num(n)} of the ${num((leads || []).length)} leads read on this screen ${n === 1 ? 'is' : 'are'} assigned to their staff record and will stay assigned${leadsCapped ? ', and that read is capped so there may be more' : ''}.`}</div>
              <div class="mt-2.5 flex gap-2">
                <button type="button" class="${BTN.destructive}" data-acrevokeyes="${esc(r.auth_user_id)}">Confirm removal</button>
                <button type="button" class="${BTN.secondary}" data-acrevokeno>Cancel</button>
              </div>
            </div></div></td></tr>` : ''}`;
      }).join('')}</tbody></table></div>`;
    }

    /* Pending is its own list because a pending person is NOT a member: they
       hold no role in the database yet and appear nowhere above. Rendering them
       in the same list would say somebody has access who does not. */
    const pendBox = acPendErr
      ? `<div style="padding:0 20px 16px">${stateError('who is waiting to join', acPendErr, null,
          'This is the pending list only; the access list above is unaffected.')}</div>`
      : pend.length
        ? `<div style="border-top:1px solid var(--line)">
            <div style="padding:14px 20px 4px"><div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Waiting for a first sign-in</div>
              <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">${esc(NO_CREDENTIAL)}</div></div>
            ${pend.map(p => `<div style="padding:10px 20px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
              <div style="flex:2;min-width:220px"><span class="font-label-numeric-sm">${esc(p.email)}</span>
                <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Recorded ${esc(ago(p.recorded_at))} as ${roleChip(p.account_role)}${
                  p.staff_name ? ` · to be linked to ${esc(p.staff_name)}` : ''}</div>
                ${p.has_login ? `<div class="font-body-sm text-body-sm text-amber-700 mt-0.5" style="white-space:normal">A NEXUS login already exists for this address but the role has not been taken up. That should not happen through this screen; report it rather than re-adding them.</div>` : ''}
              </div>
              ${mayManage ? `<div><button class="${BTN.tertiary}" data-accancel="${esc(p.email)}">Cancel</button></div>` : ''}
            </div>`).join('')}
          </div>`
        : '';

    /* The add form is rendered only where it can be used. On an account that
       may not manage access it is left out entirely rather than shown disabled:
       the card subtitle already says whose decision this is, and a dead form is
       a worse way to say the same thing than a sentence. */
    const staffOpts = ['<option value="">Link to a staff record later</option>'].concat(
      (users || []).map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email || u.id)}</option>`)).join('');
    const addBox = !mayManage ? '' : `<div style="border-top:1px solid var(--line);padding:16px 20px">
        <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:8px">Add a colleague</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:2;min-width:240px">
            <input type="email" id="acEmail" class="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary" placeholder="the address they will sign in with" aria-label="Email address" style="width:100%" />
          </div>
          <div>
            <select id="acAddRole" class="px-2 py-1 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-on-surface" aria-label="Account role">
              ${ROLE_ORDER.filter(k => mayOwner || k !== 'owner')
                .map(k => `<option value="${esc(k)}"${k === 'sales' ? ' selected' : ''}>${esc(k)}</option>`).join('')}
            </select>
          </div>
          <div><select id="acAddStaff" class="px-2 py-1 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-on-surface" aria-label="Staff record">${staffOpts}</select></div>
          <div><button class="${BTN.primary}" id="acAdd">Add</button></div>
        </div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:12px">
          ${ROLE_ORDER.filter(k => mayOwner || k !== 'owner')
            .map(k => `<div style="margin-bottom:4px">${roleChip(k)} ${esc(ROLE_WHAT[k])}</div>`).join('')}
        </div>
        ${mayOwner ? '' : '<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:6px">The owner role is not on this list because only an account owner may grant it.</div>'}
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:10px">${esc(NO_CREDENTIAL)}</div>
      </div>`;

    access.innerHTML = head + msg + list + pendBox + addBox;
    acWire();
  }

  function acSay(text, tone) { acMsg = text; acMsgTone = tone || 'hot'; acDraw(); }

  async function acCall(path, body, onRow) {
    if (acBusy) return;
    acBusy = true;
    try {
      const back = await dbWrite('POST', path, body);
      /* An RPC that did nothing still answers 200. Check the payload before
         claiming anything happened — the rule lib/unit-form.js and
         lib/lead-drawer.js were both fixed for. */
      if (!Array.isArray(back) || !back.length) {
        acMsg = 'Nothing came back from that change, so nothing is claimed to have happened. Reload the screen before trying again.';
        acMsgTone = 'hot';
      } else {
        onRow(back[0]);
      }
    } catch (e) {
      acMsg = accessError(e);
      acMsgTone = 'hot';
    } finally {
      acBusy = false;
      acConfirm = null;
      await acLoad();
  const foot = el('div');
  foot.innerHTML = trustFooter({ source: 'users · v_team_performance · leads · nexus_team_roster', asOf: dubaiStamp(new Date().toISOString()),
    evidence: `${num(roster.length)} on the roster${leads ? ` · ${num(leads.length)} leads read` : ''}`, actor: actor() });
  root.appendChild(foot);
    }
  }

  function acWire() {
    access.querySelectorAll('[data-acsave]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.acsave;
      /* The id is an auth.users uuid — hex and hyphens only — and it sits
         inside a quoted attribute selector, so nothing here needs escaping.
         CSS.escape is deliberately not used: it is not present in every
         environment this bundle is rendered in, and a missing global would take
         the whole card down rather than one lookup. */
      const sel = access.querySelector(`[data-acrole="${id}"]`);
      if (!sel) return;
      acCall('rpc/nexus_team_set_role', { p_auth_user_id: id, p_role: sel.value }, row => {
        acMsg = row.changed === false
          ? `${row.email || 'That account'} was already ${row.new_role}, so nothing changed.`
          : `${row.email || 'That account'} is now ${row.new_role} — they were ${row.previous_role}.`;
        acMsgTone = 'ok';
      });
    }));
    access.querySelectorAll('[data-aclink]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.aclink;
      const sel = access.querySelector(`[data-acstaff="${id}"]`);
      if (!sel) return;
      acCall('rpc/nexus_team_link_staff', { p_auth_user_id: id, p_staff_user_id: sel.value || null }, row => {
        acMsg = row.staff_user_id
          ? `${row.email || 'That account'} is now linked to ${row.staff_name || 'that staff record'}.`
          : `${row.email || 'That account'} is no longer linked to a staff record, so no lead can be filed against them.`;
        acMsgTone = 'ok';
      });
    }));
    access.querySelectorAll('[data-acrevoke]').forEach(b => b.addEventListener('click', () => {
      acConfirm = b.dataset.acrevoke; acMsg = ''; acDraw();
    }));
    access.querySelectorAll('[data-acrevokeno]').forEach(b => b.addEventListener('click', () => {
      acConfirm = null; acDraw();
    }));
    access.querySelectorAll('[data-acrevokeyes]').forEach(b => b.addEventListener('click', () => {
      acCall('rpc/nexus_team_revoke_access', { p_auth_user_id: b.dataset.acrevokeyes }, row => {
        acMsg = `${row.email || 'That account'} no longer has access to this dealership. Their NEXUS login still exists — removing it is done in the NEXUS account, not here — and ${
          row.leads_still_assigned ? `${row.leads_still_assigned} lead${row.leads_still_assigned === 1 ? '' : 's'} remain assigned to their staff record` : 'no lead was left pointing at them'}.`;
        acMsgTone = 'ok';
      });
    }));
    access.querySelectorAll('[data-accancel]').forEach(b => b.addEventListener('click', () => {
      acCall('rpc/nexus_team_cancel_invite', { p_email: b.dataset.accancel }, row => {
        acMsg = `${row.email} is no longer waiting to join. If they sign in now they will see nothing.`;
        acMsgTone = 'ok';
      });
    }));
    const add = access.querySelector('#acAdd');
    if (add) add.addEventListener('click', () => {
      const email = (access.querySelector('#acEmail')?.value || '').trim();
      const role = access.querySelector('#acAddRole')?.value || 'member';
      const staff = access.querySelector('#acAddStaff')?.value || null;
      if (!email) { acSay('Enter the email address this person will sign in with. It is the only thing that links the role you are granting to the login they will eventually have.', 'hot'); return; }
      acCall('rpc/nexus_team_invite', { p_email: email, p_role: role, p_staff_user_id: staff || null }, row => {
        /* The two outcomes are different facts and are said differently. The
           function's own `detail` is the sentence about what NEXUS did and did
           not do, and it is rendered rather than paraphrased. */
        acMsg = row.outcome === 'MEMBER_ADDED'
          ? `${row.email} has access now, as ${row.role}. ${row.detail}`
          : `${row.email} is recorded as ${row.role}. ${row.detail}`;
        acMsgTone = 'ok';
      });
    });
  }

  access.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Who has access</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Reading the accounts that can open this dealership’s data.</div></div></div>${stateLoading(3)}`;
  await acLoad();

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
      ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Leads could not be read (${esc(leadsErr || 'unknown error')}), so this rep's book cannot be listed.</div>`
      : !r.id
        ? '<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">This person has no user id on the roster, so no lead can be matched to them.</div>'
        : !owned.length
          ? stateEmpty('No leads on this rep',
              leadsCapped
                ? `Nothing in the ${LEAD_LIMIT} most recent leads is assigned to them; older leads are not on this page.`
                : 'No lead in the table names them as owner.', 'person_search')
          : `<div>${owned.slice(0, 10).map(l => `<div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default">
              <div style="flex:1;min-width:0">
                <div style="font-weight:500;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
                  ${esc(maskText(l.name || 'Unnamed lead'))} ${leadPhone(l)}</div>
                <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(l.vehicle_interest || 'No vehicle noted')} · ${esc(ago(l.created_at))}
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
                    ? ` · <span class="text-amber-700" title="${esc(NO_TIMING)}">reply time not measurable</span>`
                    : rtOf(l) == null
                      ? ` · <span class="text-amber-700" title="${esc(NULL_RT)}">no first reply timed</span>`
                      : ` · answered in ${esc(mins(l.response_time_minutes))}`}
                  ${l.escalated_at ? ` · <span class="text-amber-700">escalated ${esc(ago(l.escalated_at))}</span>` : ''}</div>
              </div>
              ${l.status ? pill(l.status, undefined, { verbatim: true }) : ''}
              <div class="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant mt-0.5">${n0(l.budget_aed) == null ? '' : aed(l.budget_aed)}</div>
            </div>`).join('')}
            ${owned.length > 10 ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="padding:8px 0">and ${num(owned.length - 10)} more.</div>` : ''}</div>`;

    openDrawer(`
      <div class="px-space-lg py-space-md flex items-start justify-between gap-space-sm bg-surface-container-lowest shadow-sm shrink-0">
        <div class="w-9 h-9 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-label-numeric-sm text-label-numeric-sm font-bold shrink-0">${esc(initials(r.name))}</div>
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(r.name || 'Unnamed')}</h2>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(r.role || 'No role set')} · ${esc(r.email || 'No email on file')}</div>
          <div class="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant mt-0.5">${esc(r.id ?? 'no user id')}</div>
        </div>
        <button class="${BTN.tertiary}" id="tClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="flex-1 overflow-y-auto p-space-md space-y-space-md bg-surface-container-low/40">
        <div class="flex flex-col gap-1">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Identity &amp; contact</div>
          <dl class="grid grid-cols-[minmax(120px,180px)_1fr] gap-x-4 gap-y-2.5 font-body-sm text-body-sm [&>dt]:font-table-header [&>dt]:text-table-header [&>dt]:uppercase [&>dt]:tracking-wider [&>dt]:text-outline [&>dt]:font-semibold [&>dt]:pt-0.5 [&>dd]:text-on-surface [&>dd]:min-w-0" style="margin-top:8px">
            <dt>Email</dt><dd>${r.email ? esc(r.email) : '<span class="text-on-surface-variant">No email on file</span>'}</dd>
            <dt>Phone</dt><dd><span class="text-on-surface-variant" title="${esc(NO_STAFF_PHONE)}">\u2014 no column to hold one</span></dd>
            <dt>Slack</dt><dd>${r.slack ? `<span class="font-label-numeric-sm">${esc(r.slack)}</span>` : '<span class="text-on-surface-variant">No Slack id on file</span>'}</dd>
            <dt>User id</dt><dd class="font-label-numeric-sm">${esc(r.id ?? 'none')}</dd>
            <dt>Account created</dt><dd>${r.created_at ? `${esc(ago(r.created_at))} <span class="text-on-surface-variant">(${esc(dt(r.created_at))})</span>` : '<span class="text-on-surface-variant">Not recorded on this row</span>'}</dd>
          </dl>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:12px;white-space:normal">${esc(NO_STAFF_PHONE)}
            Their leads below each show their own number, because <span class="font-label-numeric-sm">The phone number on the lead record</span> does exist.</div>
        </div>

        <div class="flex flex-col gap-1">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Account</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${statusPill(r)}${r.unlinked ? pill('Not in the user directory', 'warm', { verbatim: false }) : ''}
          </div>
          ${isPending(r) ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm mb-space-sm" style="margin-top:12px">
            <span class="material-symbols-outlined">mark_email_unread</span>
            <div>This person cannot sign in, cannot be alerted and cannot be assigned a lead until the account exists.
            This screen recorded the seat and the role, and sends no mail. The invitation itself is sent by NEXUS from the Team card on Settings.</div></div>` : ''}
          ${r.unlinked ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:12px;white-space:normal">
            This row came from <span class="font-label-numeric-sm">The team figures</span> and matched nobody in <span class="font-label-numeric-sm">users</span> by id,
            email or name. They have activity against their name but no account record.</div>` : ''}
        </div>

        <div class="flex flex-col gap-1">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Performance</div>
          <dl class="grid grid-cols-[minmax(120px,180px)_1fr] gap-x-4 gap-y-2.5 font-body-sm text-body-sm [&>dt]:font-table-header [&>dt]:text-table-header [&>dt]:uppercase [&>dt]:tracking-wider [&>dt]:text-outline [&>dt]:font-semibold [&>dt]:pt-0.5 [&>dd]:text-on-surface [&>dd]:min-w-0" style="margin-top:8px">
            <dt>Leads assigned</dt><dd class="font-label-numeric-sm">${leadsAssigned(r) == null ? notReported : num(leadsAssigned(r))}</dd>
            <dt>HOT leads</dt><dd class="font-label-numeric-sm">${hotLeads(r) == null ? notReported : num(hotLeads(r))}</dd>
            <dt>Avg response</dt><dd class="font-label-numeric-sm">${!timingTrusted
              ? `<span class="text-amber-700" title="${esc(NO_TIMING)}">Not measurable</span>`
              : avgResponse(r) == null
                ? '<span class="text-on-surface-variant">Not measured</span>'
                : `<span class="${avgResponse(r) > 5 ? 'text-red-700' : 'text-emerald-700'}">${mins(avgResponse(r))}</span>${m === 1 ? ' <span class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">· one lead, not an average</span>' : ''}`}</dd>
            <dt>Within 5 min</dt><dd class="font-label-numeric-sm">${!timingTrusted
              ? `<span class="text-amber-700" title="${esc(NO_TIMING)}">Not scored</span>`
              : !m
                ? '<span class="text-on-surface-variant">Nothing measured</span>'
                : m < MIN_RATE_SAMPLE
                  ? `${num(w ?? 0)} / ${num(m)} <span class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">· one lead, so no percentage</span>`
                  : `${num(w ?? 0)} / ${num(m)} · ${pct(slaRate(r))}`}</dd>
            <dt>Breached</dt><dd class="font-label-numeric-sm">${!timingTrusted
              ? `<span class="text-amber-700" title="${esc(NO_TIMING)}">Not scored</span>`
              : b == null ? notReported : `<span class="${b > 0 ? 'text-red-700' : ''}">${num(b)}</span>`}</dd>
            <dt>Open pipeline</dt><dd class="font-label-numeric-sm">${!leads
              ? '<span class="text-on-surface-variant">Leads could not be read, so open pipeline could not be summed</span>'
              : openPipelineOf(r) != null
                ? aed(openPipelineOf(r))
                : openLeadsOf(r).length
                  ? `<span class="text-on-surface-variant">No budget on file across ${num(openLeadsOf(r).length)} open ${plural(openLeadsOf(r).length, 'lead', 'leads')}</span>`
                  : '<span class="text-on-surface-variant">No open lead held</span>'}</dd>
          </dl>
          ${/* Said in the drawer as well as the header, because this is where a
                manager checks one person's number against what they believe. */''}
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:12px;white-space:normal">Open pipeline is <span class="font-label-numeric-sm">budget_aed</span> summed over the
            leads read on this screen that are assigned to this person and are not in a won or dead state${leadsCapped ? `, within the ${num(LEAD_LIMIT)} most recent leads` : ''}.
            the team's own pipeline figure is not shown in its place. Until 2 Sep 2026 it summed every lead ever assigned,
            disqualified and lost ones included; it now counts open leads only, on the same rule as the figure above. It is still not the number shown
            here, because this one can be traced to the leads listed below and says when its read was capped.</div>
          ${!r.perf ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:12px;white-space:normal">
            ${perfErr ? `The performance view could not be read (${esc(perfErr)}).`
                      : 'The performance view has no row for this person, so nothing has been recorded against them yet.'}</div>` : ''}
        </div>

        <div class="flex flex-col gap-1">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Their leads</div>
          <div style="margin-top:8px">${leadList}</div>
        </div>

        <div class="flex flex-col gap-1">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Why there is no delete</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px;white-space:normal">
            ${esc(NO_DELETE)}${strandBits.length
              ? ` They have ${strandBits.join(' and ')} — every one of those would be handed back to the unassigned queue, with nothing on the row to say it had ever had an owner.`
              : ''}
          </div>
        </div>
      </div>
      <div class="p-space-md bg-surface-container-lowest flex flex-wrap items-center gap-space-sm shrink-0 border-t border-outline-variant/40">
        <button class="${BTN.primary}" id="tGoAccessDrawer" title="${esc(isPending(r) ? NO_INVITE : NO_ROLE_WRITE)}">Manage access</button>
        <button class="${BTN.secondary}" id="tGoLeadsDrawer">Open the leads screen</button>
      </div>`);
    $('tClose').addEventListener('click', closeDrawer);
    /* One button, because "send invite" and "change role" were two dead
       controls for one live card. It closes the drawer first: scrolling a card
       into view behind an open drawer moves something the reader cannot see. */
    $('tGoAccessDrawer').addEventListener('click', () => { closeDrawer(); focusAccess(); });
    $('tGoLeadsDrawer').addEventListener('click', () => go('leads'));
  }
};
