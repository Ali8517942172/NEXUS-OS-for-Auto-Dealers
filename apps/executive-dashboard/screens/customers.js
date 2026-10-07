/* NEXUS OS — screens/customers.js
   Customer 360.

   THE CORRECTION THIS FILE EXISTS FOR (24 Aug 2026)
   -------------------------------------------------
   This screen used to build its customer list out of v_customer_360 and
   customer_360_profiles. Both are aggregation outputs: they pick up whoever the
   nightly job saw, which includes the people in `whatsapp_contacts` who messaged
   the owner's personal WhatsApp number and were never customers of anything.
   Printing one of them here, in a list with a lifetime-value column, is the same
   class of mistake as sending [KYC-APPROVED] to somebody who sent a greeting
   card. A person reading this screen must not come away believing the dealership
   has a relationship it does not have.

   So the spine of this screen is `v_customer_directory` — leads UNION
   purchase_history, keyed on lower(email). That view is the definition of a
   customer: somebody who enquired, or somebody who bought. Everything else hangs
   off it as enrichment and can never add a person to the list:

     · v_customer_360        — live lifetime value, lead / message counts, phone,
                               and a second copy of the email / Slack touch counts
                               with no sync timestamp against them.
     · customer_360_profiles — the nightly job's own output, and the only source
                               of last_synced_at, which is what makes a touch
                               count readable at all (see below).
     · whatsapp_contacts     — a messaging directory, NOT a customer list. A row
                               here is shown as a customer's WhatsApp channel only
                               when its lead_email matches a directory customer.

   Anything present in those three but absent from the directory is listed at the
   foot of the screen under a heading that says it is not a customer, with the
   reason. Nothing is hidden and nothing is promoted.

   THE SECOND CORRECTION — KEPT ONLY BECAUSE THE PARAGRAPH AFTER IT OVERTURNS
   IT. Everything in the next three paragraphs was believed on 24 Aug 2026; the
   conclusion it reaches is wrong, and the paragraph beginning AND THE SECOND
   CORRECTION says why. It stays because the reasoning is the reasoning the code
   used to embody, and a reader who meets only the correction cannot tell what
   was corrected. Every profile the nightly job has written reports 0 emails and
   0 Slack messages. For days that was not
   what the customers did — it was what the job collected. Customer 360's Gmail
   half authenticates with an OAuth2 credential that had been dead: the Google
   consent screen was left in Testing, and Google expires a Testing app's refresh
   token after seven days, so the token the job held stopped working and every
   run counted nothing.

   That is now repaired. The app has been published to production, the credential
   re-authorised, and a Customer 360 run completed afterwards — later than
   GMAIL_FIXED_AT below — so the single profile in the database carries a
   last_synced_at from a run that could reach the mailbox. Its 0 is therefore a
   counted zero: the mailbox holds no mail for that address. That is a fact about
   the customer, not a gap in the pipeline, and this screen now says so.

   The distinction is kept in code rather than hard-coded to today's answer,
   because the next credential expiry looks identical from the database side: a
   0 written by a run older than the fix means "not counted", a 0 written by a
   run after it means "counted, and it is none". This screen decides between
   those two per profile from that profile's own last_synced_at, and says which
   one it is every single time it prints one of these numbers.

   AND THE SECOND CORRECTION IS ITSELF WRONG — THE DATABASE SAYS SO (1 Sep 2026).
   The paragraph above concludes that a run finishing after GMAIL_FIXED_AT proves
   its zero was counted. Read against audit_log tonight, that does not hold.
   Every Customer 360 run since 26 Aug 22:00 UTC has logged PARTIAL, and the
   newest row naming shabbir53ujjainwala@gmail.com — 28 Aug 22:00, four days
   AFTER the timestamp below — reads "email count UNKNOWN - Gmail read failed …
   Gmail history for this customer - Forbidden - perhaps check your credentials?".
   The consent screen was published and the credential re-authorised; the job
   still cannot read that mailbox. A date typed into this file is therefore not
   evidence about a figure, and it was being rendered as though it were — in
   green, over a number the run itself said it had failed to collect.

   So the verdict moved off the constant and onto the run's own record. Each
   figure is judged by the audit_log row the aggregation wrote BESIDE that
   profile's last_synced_at, classified through lib/health.js — the only module
   allowed to say what a status means — and GMAIL_FIXED_AT is consulted only when
   there is no such row to consult. Where the run says a step did not land, the
   figure it wrote is labelled as coming from a run that went out half-done,
   never as a counted zero.

   "BESIDE" IS LOAD-BEARING, AND IT IS THE THIRD THING THIS FILE GOT WRONG. The
   first pass at the above took the newest run that named a customer, whenever it
   ran, and captioned it "Run that wrote it". The job writes its audit row within
   a second or two of the upsert — Siva's profile is stamped 31 Aug 22:00:11.645
   and his run 22:00:12.400 — but Ali's profile is stamped 31 Aug 22:00:07.125
   while the newest run naming him is 28 Aug 22:00:24, three nights earlier. So
   the pane explained tonight's figures with a run from three days ago, and put
   that run's "Gmail read failed" underneath numbers it had no part in writing.
   A run now has to sit within fifteen minutes of the write to be called its
   author; where none does, the screen says the write is unaccounted for and
   shows the older run only as an older run.

   Live tonight, read on 1 Sep 2026: v_workflow_health has Customer 360 - Data
   Aggregation DEGRADED at 39.1% — 23 qualifying runs in the 30-day window,
   9 outright successes, 2 failures and 12 that went out half-done. Both profile
   rows behind this screen carry last_synced_at 31 Aug 22:00. Only one of them —
   Siva Thangavelu's — has a run logged beside it, one of those twelve, reading
   "email count NOT APPLICABLE - customer has no real email address, Gmail was
   not queried, Slack count UNKNOWN - Slack read failed, previous stored value
   left intact"; that is why his 0 is a value nothing overwrote rather than a
   count. The other profile's total_slack_messages is NULL and no run on record
   was written when it was, so why it is NULL is not knowable from here and this
   screen does not guess.

   THE DUPLICATE THAT WAS: a second customer_360_profiles row (customer_id '25',
   a leftover from the Bitrix era) pointed at the same address as the live one
   and has been deleted. One person is no longer two profiles. The collapse
   handling below stays exactly where it is — two rows for one email is what an
   import does, and it will happen again — but nothing on this screen is
   currently collapsing anything, and the note that reports a collapse only
   renders when there is one.

   THE THIRD CORRECTION: the customer list is read from Supabase and never from
   Bitrix24. Bitrix's crm.* read methods answer 403 on the dealership's current
   plan, so no record here came from Bitrix and none can. Bitrix *writes* do
   work — leads raised and updated by the workflows land there. The screen must
   not compress that into "Bitrix is synced" or into "Bitrix is down"; it is a
   plan restriction on reading, and only on reading.

   AND: purchase_history records the car as a free-text `vehicle` string with no
   reference to an inventory unit. Nothing here joins to inventory and nothing
   here claims to know which stock number a customer drove away in.

   Nothing here is estimated. A count the database did not return is an em dash. */
import { db } from '../lib/data.js';
import { term } from '../lib/vocabulary.js';
import { $, el } from '../lib/dom.js';
import { OUTCOME, healthWords, outcomeOf, outcomeWords, successRate } from '../lib/health.js';
import { expandIdentity, normalizeKey, personFilter, personQuery } from '../lib/identity.js';
import { aed, ago, dubaiDate, dubaiStamp, esc, initials, mins, n0, num, pct, pill, tone } from '../lib/format.js';
import { displayName, maskEmail, maskText } from '../lib/privacy.js';
import { SILENCE_MARKER, silenceCount, splitEvents } from '../lib/comm-events.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { SCREENS, go } from '../lib/nav.js';
import { BTN, comingSoonPanel, emptyState, errorState, skeleton, statusChip, trustFooter } from '../lib/stitch-ui.js';
import { ME } from '../lib/data.js';

const PROFILE_COLS = 'customer_id,name,email,phone,total_emails,total_slack_messages,last_synced_at';
const CONTACT_COLS = 'chat_id,phone,push_name,lead_email,message_count,first_seen,last_seen';
const DIR_LIMIT = 1000;
const VIEW_LIMIT = 500;
const PROFILE_LIMIT = 1000;
const CONTACT_LIMIT = 2000;
const SOURCE_LIMIT = 2000;
const MSG_LIMIT = 50;

/* WHAT COUNTS AS A CONTACT, AND WHY THE NEWEST ROW OFTEN IS NOT ONE
   -------------------------------------------------------------------------
   `communication_logs` is an event log, not a message log. The 12-hour silence
   detector writes a row into it when a lead has stopped answering — it writes
   that row BECAUSE nobody was in touch. This screen took "last contact" from
   the newest row it had read, marker included, so Siva Thangavelu's pane dated
   his last contact from the 26 Aug 19:03 marker while the newest thing actually
   said to or by him was 26 Aug 06:12 — the moment the system recorded that he
   had NOT been contacted, printed as the moment he was. Found by the journey
   regression on 1 Sep 2026; live on shabbir53ujjainwala@gmail.com too (marker
   31 Aug 17:00, newest message 31 Aug 04:37) and invisible there only because
   ago() rounded both to "1 d ago" — and, read again at 19:20 UTC the same
   evening, invisible on Siva as well, because by then both of his rounded to
   "6 d ago". A defect that hides itself for most of every day is still the
   defect.

   The test itself no longer lives in this file. It used to be a local
   `'[SILENCE-'` prefix check, which is one of the three marks an internal row
   can carry and was chosen to line up with the single predicate v_customer_360
   happened to use at the time. Both sides have moved: lib/comm-events.js holds
   the whole taxonomy for the browser, `public.nexus_is_message()` holds it for
   the database, and v_customer_360's message_count and last_contact_at are
   computed with that function as of migration `comm_taxonomy_views_own_the_rule`
   — so the agreement the caption below reports is now an agreement between two
   spellings of one rule rather than between two independent guesses. The
   caption still MEASURES it rather than assuming it, for the same reason it
   always did.

   And since 2 Sep 2026 the count and the timestamp are no longer two answers
   sitting side by side. One source owns both — v_customer_360 where it has the
   customer, this screen's own read of communication_logs where it does not —
   and whichever did not answer is used as a check on the one that did, never
   printed as a rival number. See the MESSAGES block in open(). */
/* v_customer_directory is read with select=* on purpose, and its columns are now
   known rather than guessed: id, name, email, phone, source_records,
   last_seen_at, read off the live database on 24 Aug 2026. They are still not
   named in the select, because this view is the spine of the screen and a future
   rename would answer 42703 and take the entire customer list down with it — a
   missing column read off a `select=*` row is a gap in one cell, which this file
   can render honestly. The read is deliberately unordered for the same reason;
   sorting happens client-side over values that were actually returned.

   The alias lists that used to sit here (`lead_email`, `full_name`,
   `display_name`, …) were guesses at columns this view does not have, and one of
   them was being applied to purchase_history rows, where `vehicle_interest` and
   `model` do not exist either. Both are gone: every column below is one the
   database was observed to return. */
const str  = v => String(v == null ? '' : v).trim();
const norm = v => str(v).toLowerCase();

/* `ilike` is not equality. PostgREST hands the value straight to SQL ILIKE, and
   encodeURIComponent's %25 is decoded back to a literal % before it gets there —
   so `%` and `_` inside a customer's OWN address are wildcards, and the reads
   below matched on `john_smith@x.com` would also return `johnXsmith@x.com`. That
   is one person's leads, purchases, purchase value and lead count appearing
   under another's name, with nothing on screen to say so.

   Two defences, because the first depends on PostgREST's own `*`→`%` rewriting
   staying exactly as it is: the pattern is escaped, and every row that comes
   back is then re-checked against the address in JavaScript, which cannot be
   wrong about it. `ilike` stays rather than `eq` because the directory key is
   lower-cased and the base tables are not. */
const likePattern = s => encodeURIComponent(String(s).replace(/[\\%_]/g, m => '\\' + m));
const sameEmail = (a, b) => !!norm(a) && norm(a) === norm(b);

/* The Customer 360 aggregation, as the database names it. workflow_registry is
   read rather than a name being written here, because audit_log.workflow says
   "Customer 360 Aggregation" while the registry says "Customer 360 - Data
   Aggregation" and there is a third alias besides — matching a run to a workflow
   on a substring would let an unrelated workflow's log explain a customer's
   profile. The `*360*` filter below is only a cheap superset; the exact names
   from the registry row are what actually select the rows. */
const AGG_MATCH = '*360*';
const AGG_LOG_LIMIT = 500;
const HEALTH_COLS = 'name,category,health,runs_30d,successes_30d,failures_30d,partials_30d,'
  + 'no_result_30d,rejected_30d,effective_runs_30d,success_rate_30d,last_run,writes_audit_log,is_active';

/* Neither the aggregation nor the credential behind it can be repaired from the
   browser. Spelled out once so the disabled control and the prose agree. */
const NO_SYNC_HOOK =
  'The customer profiles are written by NEXUS\u2019s own nightly job, which nothing in this browser is allowed to start. ' +
  'There is no way to start that job from here, so it cannot be made to run early. The mail connection ' +
  'behind it has already been repaired in the Google console — that was never something this button could have ' +
  'done — and the figures will change when the next scheduled run completes. This stays disabled until a ' +
  'run-now endpoint exists.';

/* The paragraph that has to travel with every touch count on this screen. It
   states the outage AND its repair, because a reader who is told only "the
   credential is broken" will not know to expect the numbers to change tonight,
   and a reader told only "it is fixed" will trust a zero that is still an
   outage. */
const AGG_ZERO_CAUSE =
  'Customer 360 reads the dealership’s mail through a connection that had stopped working: its consent screen was ' +
  'left in Testing, and Google expires a Testing app’s refresh token after seven days, so the job authenticated ' +
  'with a dead token and counted nothing. The app has since been published and the credential re-authorised — ' +
  'and that did not fix the read. The newest aggregation row naming a customer with a real address, logged ' +
  '28 Aug 2026 and four days after the re-authorisation, still reads “no mail history for this customer - ' +
  'Forbidden - perhaps check your credentials?”. So a figure here is whatever the last run managed to write, a 0 ' +
  'is not evidence that the customer never wrote to us, and the only thing that says which is the run’s own ' +
  'The activity log row, quoted beside each figure. The message counts elsewhere on this screen come from ' +
  'The message history — directly, or through the customer record’s count over that same table — and were never affected.';

/* The paragraph for a run that logged no step it failed to land. This is the
   only wording on the screen that is allowed to call a zero an answer, and it is
   now earned from the run's own record rather than from a date: the previous
   version of this text concluded "the job could reach the mailbox and found
   nothing in it for this address" off a timestamp comparison, and rendered that
   sentence directly beneath a cell correctly reporting that the same run had
   logged "Gmail read failed". */
const AGG_ZERO_SUCCESS =
  'This is an answer, not a gap. The run that wrote these figures logged no step that failed to land, so the job ' +
  'reached its sources and found nothing for this address. A 0 here means no mail, not no count. The message ' +
  'counts elsewhere on this screen come from the message history — directly, or through the customer record’s count over that same table — and were never affected.';

/* And the case that is actually live: the run finished, wrote a profile row, and
   said in its own summary that part of what it claimed did not happen. */
const AGG_ZERO_HALF =
  'The run that wrote these figures did not finish the job it claimed, and its own the activity log row is quoted above. ' +
  'Where that row says a count is UNKNOWN, or that a step did not land, the number stored here is whatever an ' +
  'earlier run left behind rather than something this run counted — the workflow says so itself: “previous ' +
  'stored value left intact”. A 0 under those words is a read that failed, not a customer with no mail. The ' +
  'message counts elsewhere on this screen come from the message history — directly, or through the customer record’s count over that same table — and were never affected.';

/* No audit row sits beside this write, so the only evidence is the timestamp —
   and a timestamp is not a record of what a run collected. Said as the inference
   it is, and deliberately not upgraded to AGG_ZERO_SUCCESS: runs on other
   customers were still logging "Gmail read failed" four days after the
   re-authorisation, so "later than the fix" has been observed not to imply
   "counted".

   It does not say "no audit_log row names this customer", which is a different
   and usually false claim — live on 1 Sep 2026 six rows name Ali; none of them
   was written when his profile was. Nor does it say "this 0": the figures this
   paragraph sits under can be any value, and it was appearing beneath a 1. */
const AGG_ZERO_UNRECORDED =
  'The write that produced these figures landed after the mail connection was restored. That is a ' +
  'timestamp, not a record: the aggregation logged no audit row beside it, so what that run reached is written ' +
  'down nowhere this screen can read, and comparable runs on other customers were still logging “mail read ' +
  'failed” four days after that re-authorisation. Nothing here is therefore being called counted, a 0 included. ' +
  'The message counts elsewhere on this screen come from the message history — directly, or through the customer record’s count over that same table — and were never affected.';

/* When the mail connection was restored, in UTC. This constant used to
   decide every touch count on the screen: written before it meant "not counted",
   written after it meant "counted, and it is none". Both halves of that are gone
   now, and the second half is why — the 24 Aug re-authorisation did not restore
   the read, and runs four days later were still logging "Gmail history for this
   customer - Forbidden". A run's own audit_log row decides a figure; this
   timestamp is consulted only where no such row exists, and where it is
   consulted it is labelled as an inference from a date rather than a record of
   what a run collected.

   The value is written here, not read from the database — nothing in Supabase
   records when a credential was re-authorised — so it is stated as this screen's
   own assumption wherever it decides a number, and it is deliberately set
   earlier in the evening than the repair rather than later: erring early can
   only mislabel a run that straddles the fix, while erring late would call a
   genuinely counted zero an outage and hide a real answer behind a warning. */
const GMAIL_FIXED_AT = '2026-08-24T18:00:00Z';
const GMAIL_FIXED_MS = Date.parse(GMAIL_FIXED_AT);
const syncedAfterFix = ts => {
  const t = Date.parse(str(ts));
  return Number.isNaN(t) ? false : t >= GMAIL_FIXED_MS;
};

/* Which paragraph a given figure has earned, decided by the run that wrote it —
   and by the run's own record wherever there is one. `run` is the newest
   audit_log row the aggregation logged about this customer. */
const aggNote = (syncedAt, run) => {
  if (run) return outcomeOf(run) === OUTCOME.SUCCESS ? AGG_ZERO_SUCCESS : AGG_ZERO_HALF;
  return syncedAfterFix(syncedAt) ? AGG_ZERO_UNRECORDED : AGG_ZERO_CAUSE;
};

/* Where this screen's customers come from, and — just as important — where they
   do not. Both halves are stated, because "the CRM sync is down" and "the CRM
   is synced" are each half-true and both misleading.

   Rewritten 5 Sep 2026. It named the CRM product, its API method family and
   the HTTP status its plan returns, four times in four sentences. Which CRM a
   dealership runs is theirs to know; that NEXUS integrates with it through a
   supplier's API, on a plan whose read methods are refused, is NEXUS's
   implementation and changes with the contract. The dealership's half is the
   one thing that decides whether they can trust this screen: the records here
   are NEXUS's own, the flow outward works and the flow inward does not, and
   this screen is therefore not a mirror of their CRM. */
const CRM_NOTE =
  'Every customer on this screen is NEXUS’s own record. Nothing here was read back from your CRM, and nothing ' +
  'here can be: the sync runs one way only. Leads and updates NEXUS raises do reach your CRM, so the outward ' +
  'direction is working — but a record created or edited in the CRM itself will not appear on this screen, and ' +
  'this screen is not a picture of what the CRM holds. Restoring the inward direction is NEXUS’s to arrange.';

/* Said wherever a purchase is shown, because the obvious next question is "which
   car?" and the honest answer is a string somebody typed. */
const NO_INVENTORY_LINK =
  'The recorded sales stores the car as free text in `vehicle` and carries no reference to an inventory unit, so a ' +
  'purchase cannot be tied to a stock number. Which unit was sold, what it cost us and how long it sat are not ' +
  'answerable from here — and inventory records no sale date either, so they are not answerable from that side.';

/* A touch count is never rendered bare, and never as a number whose meaning
   depends on something the reader cannot see from where the number is.

   `run` is the audit_log row the aggregation logged BESIDE this write, already
   classified by lib/health.js at the call site, and null when no run sits there.
   It outranks the date comparison completely: a run that logged "Gmail read
   failed" wrote a 0 that counted nothing, whatever the clock said when it
   finished. The GMAIL_FIXED_AT branch below survives only as the fallback for a
   write no run accounts for, and says out loud that it is inferring from a
   timestamp rather than reading a record.

   A figure ABOVE zero gets the same treatment. It used to be printed bare
   whenever no run could be attributed to it, on the unexamined assumption that a
   number greater than zero speaks for itself. It does not: live on 1 Sep 2026
   the Ali profile carries total_emails 1 written 31 Aug 22:00:07 with no run
   logged beside it, and a bare "1" in a column fed by a job that is DEGRADED at
   39.1% is a provenance claim made by omission. */
function touchCell(v, syncedAt, run) {
  const x = n0(v);
  if (x == null) return '<span class="t-muted">— not reported by the aggregation</span>';
  const o = run ? outcomeOf(run) : null;
  const half = !!o && o !== OUTCOME.SUCCESS;
  const why = run ? ` title="${esc(str(run.summary) || 'This run logged no summary.')}"` : '';
  const when = ` title="Inferred by comparing this row's last_synced_at against ${esc(GMAIL_FIXED_AT)}, a timestamp written into this screen and not read from the database. The aggregation logged no audit row beside this write, so there is no record of what the run actually collected."`;
  const unaccounted = str(syncedAt)
    ? `<span class="t-warm"${when}>· which run collected this is not recorded — the aggregation logged nothing beside the write, only that it landed ${syncedAfterFix(syncedAt) ? 'after' : 'before'} the mail connection was restored</span>`
    : '<span class="t-warm">· which run collected this is not recorded — this source carries no sync timestamp either, so nothing places it against a run</span>';
  if (x > 0) {
    /* A number greater than zero is still only as good as the run that wrote it:
       "previous stored value left intact" means the figure on screen is whatever
       an older run collected, not what this one found. */
    if (!run) return `<span class="num">${num(x)}</span> ${unaccounted}`;
    return `<span class="num">${num(x)}</span>${half
      ? ` <span class="t-warm"${why}>· written by a run that ${esc(outcomeWords(o).label.toLowerCase())} — it may be a value an earlier run left behind</span>`
      : ''}`;
  }
  if (run) {
    return half
      ? `<span class="num">0</span> <span class="t-hot"${why}>· not counted — the run that wrote it ${esc(outcomeWords(o).label.toLowerCase())}: ${esc(str(run.summary).slice(0, 180))}</span>`
      : `<span class="num">0</span> <span class="t-muted"${why}>· counted — the run that wrote it (${esc(ago(run.logged_at))}) logged no step that failed to land</span>`;
  }
  if (str(syncedAt) && !syncedAfterFix(syncedAt)) {
    return `<span class="num">0</span> <span class="t-warm"${when}>· not counted — the run that wrote this finished before the mail connection was restored</span>`;
  }
  return `<span class="num">0</span> ${unaccounted}`;
}

/* A rejected sub-fetch must reach the section that needed it rather than
   vanishing into an empty list that reads as "this customer has no purchases".
   Every sub-fetch on this screen now goes through one of the two re-checking
   wrappers below instead, which keep the same contract and add `foreign`.

   The second half of the ilike defence. `foreign` is the number of rows the
   database returned that do not belong to this customer — always 0 unless the
   escaping above has been defeated, and reported on screen rather than trusted
   to be 0, because a silent wildcard match is the failure this exists to catch. */
const grabExact = (promise, addr) => promise.then(rows => {
  const kept = (rows || []).filter(r => sameEmail(r.email, addr));
  return { rows: kept, foreign: (rows || []).length - kept.length };
}, e => ({ err: e.message }));
const val = r => (r.status === 'fulfilled' ? r.value : null);
const err = r => (r.status === 'rejected' ? (r.reason && r.reason.message) || 'Unknown error' : null);

/* ── The spine ───────────────────────────────────────────────────────────── */
/* One entry per customer, keyed on lower(email) exactly as the view is. Rows
   sharing an email collapse and the collapse is reported, never hidden. */
function spineFromDirectory(rows) {
  const map = new Map();
  rows.forEach((r, i) => {
    const email = str(r.email);
    const key = norm(email) || `dir:${i}`;
    const cur = map.get(key);
    if (cur) {
      cur.dupes++;
      if (!cur.name)  cur.name  = str(r.name);
      if (!cur.phone) cur.phone = str(r.phone);
      return;
    }
    map.set(key, {
      key, email,
      id: r.id == null ? '' : String(r.id),
      name: str(r.name),
      phone: str(r.phone),
      /* Kept as the view returned it. This screen reports the value and says
         whose it is; it does not decide what the view meant by it. */
      sourceRecords: r.source_records == null ? null : r.source_records,
      lastSeen: r.last_seen_at || null,
      dupes: 0,
    });
  });
  return map;
}

/* Used only when v_customer_directory cannot be read. The view is defined as
   leads UNION purchase_history keyed on lower(email), so this rebuilds exactly
   that from the two base tables rather than falling back to the aggregation
   outputs — falling back to those would put non-customers in the list again,
   which is the bug this screen was rewritten to remove. */
function spineFromSources(leads, purchases) {
  const map = new Map();
  const add = (email, name, phone, at) => {
    const key = norm(email);
    if (!key) return;
    const cur = map.get(key);
    if (cur) {
      if (!cur.name && name) cur.name = str(name);
      if (!cur.phone && phone) cur.phone = str(phone);
      if (at && (!cur.lastSeen || String(at) > String(cur.lastSeen))) cur.lastSeen = at;
      return;
    }
    map.set(key, { key, id: '', email: str(email), name: str(name), phone: str(phone),
                   sourceRecords: null, lastSeen: at || null, dupes: 0 });
  };
  /* leads.phone and purchase_history.phone both exist, so the rebuilt spine
     carries numbers too and the fallback is not a downgrade in reachability.
     purchase_history's name column is `customer_name`, not `name`. */
  (leads || []).forEach(l => add(l.email, l.name, l.phone, l.created_at));
  (purchases || []).forEach(p => add(p.email, p.customer_name, p.phone, p.purchase_date || p.created_at));
  return map;
}

const nameOf = c => { const n = c.name || (c.view && str(c.view.name)) || (c.profile && str(c.profile.name)); return n ? displayName(n) : (c.email ? maskEmail(c.email) : 'Unnamed customer'); };

/* The phone, and where it was found. Five sources this screen reads carry one —
   v_customer_directory, v_customer_360, customer_360_profiles, purchase_history
   and whatsapp_contacts — so a customer with nothing here has no number anywhere
   the dashboard can see, which is a fact about this dealership's records and is
   said as one rather than left as a blank cell. */
function phoneOf(c) {
  /* `from` is RENDERED — "found on <from>" — so it holds the dealership's word
     for the place, taken from lib/vocabulary.js rather than typed here. Five
     relation names used to reach the screen through this one object. */
  if (str(c.phone)) return { phone: str(c.phone), from: term('v_customer_directory') };
  if (c.view && str(c.view.phone)) return { phone: str(c.view.phone), from: term('v_customer_directory') };
  if (c.profile && str(c.profile.phone)) return { phone: str(c.profile.phone), from: term('The customer profiles') };
  const bought = (c.purchases || []).map(p => str(p.phone)).filter(Boolean)[0];
  if (bought) return { phone: bought, from: term('purchase_history') };
  const wa = (c.contacts || []).map(x => str(x.phone)).filter(Boolean)[0];
  if (wa) return { phone: wa, from: term('whatsapp_contacts') };
  return { phone: '', from: '' };
}
const phoneStr = c => phoneOf(c).phone;
const NO_PHONE_LONG =
  'No phone number on the customer list row, on the customer record, on the unified profile, on any purchase ' +
  'row or on any linked WhatsApp contact. This customer cannot be called from anything the dashboard reads.';

/* `whatsapp_contacts.message_count` is a counter on the contact row, and it is
   not a count of that person's messages. Read on 1 Sep 2026 it is 0 on all ten
   rows in the table, including `76703921635478@lid`, under which
   communication_logs holds 23 messages, and `111948809162873@lid`, under which
   it holds 10. Whatever maintains it has not been maintaining it.

   So it is never printed as a bare "0 msgs" — that is a plausible zero standing
   in front of a real conversation, which is the one thing this screen may not
   do. A 0 is rendered as the dead counter it is; a real figure is rendered with
   the column it came from named; a NULL is an em dash. The honest count for
   these people is in communication_logs, which this screen reads per customer
   and Conversations reads per thread. */
const waCount = w => {
  const n = n0(w.message_count);
  if (n == null) return '<span class="t-muted">no message count on this contact row</span>';
  if (n === 0) return '<span class="t-muted" title="The counter on this contact\u2019s saved details. On 1 Sep 2026 this column was 0 on every row in the table, including chats that hold messages in the message history, so a 0 here is not evidence that nothing was said.">The saved contact details.message_count is 0 — not a message count</span>';
  return `${num(n)} <span class="t-muted">on this contact\u2019s saved details</span>`;
};

/* How a WhatsApp row is allowed to be labelled. Never the chat id — a LID
   handle contains no phone digits and is not a name. */
function contactLabel(c) {
  const push = str(c.push_name);
  if (push) return { name: push, basis: 'WhatsApp profile name — the name this person set on WhatsApp' };
  const phone = str(c.phone);
  if (phone) return { name: phone, basis: 'Phone number only — no profile name was captured' };
  return { name: '', basis: 'Unidentified — no profile name and no phone number was ever stored for this chat' };
}

/* ── Stitch vocabulary (complete, literal class strings) ───────────────────
   From customer-360-3-panel-unified-dossier--31a9aa and
   customer-360-unified-intelligence--dc1622 in design/stitch/. */
const SECTION = 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm';
const SEG = {
  on:  'px-2.5 py-1 rounded-md bg-surface-container-lowest text-primary font-body-sm text-[12px] font-semibold shadow-sm',
  off: 'px-2.5 py-1 rounded-md text-on-surface-variant hover:text-on-surface font-body-sm text-[12px] font-medium transition-colors disabled:text-outline disabled:cursor-not-allowed',
};
const LIST = {
  on:  'flex items-center gap-3 p-3 rounded-lg bg-secondary-fixed/40 border border-primary/40 cursor-pointer',
  off: 'flex items-center gap-3 p-3 rounded-lg bg-surface-container-low hover:bg-surface-container border border-transparent cursor-pointer transition-colors',
};
const CAT = {
  on:   'flex items-center gap-2.5 px-3 py-2 rounded-lg bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold',
  off:  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-on-surface hover:bg-surface-container-low font-body-sm text-body-sm transition-colors',
  soon: 'flex items-center gap-2.5 px-3 py-2 rounded-lg text-outline bg-surface-container-low/60 font-body-sm text-body-sm',
};
const TL_DOT = {
  ok: 'bg-emerald-600', won: 'bg-emerald-600', hot: 'bg-red-600', warm: 'bg-amber-500', cold: 'bg-sky-600',
  open: 'bg-violet-600', dead: 'bg-zinc-400', unknown: 'bg-zinc-400', neutral: 'bg-outline',
};
const tlItem = (dot, metaHtml, textHtml, subHtml = '') => `<div class="flex gap-3">
    <div class="flex flex-col items-center pt-1.5"><span class="w-2.5 h-2.5 rounded-full shrink-0 ${dot}"></span><span class="flex-1 w-px bg-outline-variant/50 mt-1"></span></div>
    <div class="pb-3 min-w-0 flex-1">
      <div class="flex items-center gap-2 flex-wrap font-label-numeric-sm text-label-numeric-sm text-outline">${metaHtml}</div>
      <div class="font-body-sm text-body-sm text-on-surface mt-0.5" style="white-space:pre-wrap;word-break:break-word">${textHtml}</div>${subHtml}
    </div></div>`;
const NOTE = {
  info: 'flex items-start gap-2.5 p-3 rounded-lg border border-blue-200 bg-blue-50/60 text-blue-950 font-body-sm text-body-sm',
  warm: 'flex items-start gap-2.5 p-3 rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm',
  hot:  'flex items-start gap-2.5 p-3 rounded-lg border border-red-200 bg-red-50/60 text-red-950 font-body-sm text-body-sm',
};
const note = (t, icon, html) =>
  `<div class="${NOTE[t] || NOTE.info}"><span class="material-symbols-outlined text-[18px] shrink-0">${esc(icon)}</span><div class="min-w-0 flex-1">${html}</div></div>`;
const quiet = (icon, title, body) => `<div class="flex items-start gap-3 p-space-md rounded-lg bg-surface-container-low">
    <span class="material-symbols-outlined text-[20px] text-outline">${esc(icon)}</span>
    <div><div class="font-body-md text-body-sm font-semibold text-on-surface">${esc(title)}</div>
    <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(body)}</p></div></div>`;
/* A KPI tile whose sub-line is trusted markup this screen built — every
   customer figure here carries a provenance sentence with its own tone. */
const tile = (label, value, subHtml) => `<div class="bg-surface-container-lowest p-space-md rounded-xl border border-outline-variant/40 shadow-sm flex flex-col gap-2 min-w-0">
    <span class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold">${esc(label)}</span>
    <span class="font-label-numeric-lg text-[1.75rem] leading-none font-bold text-on-surface tracking-tight">${value}</span>
    <div class="font-body-sm text-[12px] leading-snug text-on-surface-variant" style="white-space:normal">${subHtml}</div></div>`;
const actorName = () => String((ME && (ME.name || ME.email)) || 'Signed-in user');

SCREENS.customers = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/leads.js, screens/overview.js, screens/money-leaks.js,
     screens/setup.js, screens/inventory.js and screens/conversations.js. */
  /* Stitch layout, 7 Oct 2026: `nx-stitch` on a wrapper this screen appends,
     never on `#screen`. Every read and every provenance sentence below is the
     one this file already wrote; the panels are the Stitch dossier. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);
  const readAt = new Date();
  let activeCat = 'identity';

  const head = el('div');
  head.innerHTML = `<div class="flex flex-col md:flex-row md:items-end justify-between gap-space-sm">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-table-header text-table-header uppercase tracking-wider text-outline">Intelligence</span>
          <span class="font-table-header text-table-header text-outline-variant">/</span>
          <span class="font-table-header text-table-header uppercase tracking-wider text-primary font-semibold">Customer 360</span>
        </div>
        <h1 class="font-headline-lg text-headline-lg text-on-surface mt-1">Customer 360</h1>
        <p class="font-body-md text-body-md text-on-surface-variant mt-0.5 max-w-3xl">Everyone who enquired or bought, with every key their messages are filed under — and, kept apart below, everyone in the system who is not a customer.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button type="button" class="${BTN.secondary}" disabled title="${esc(NO_SYNC_HOOK)}"><span class="material-symbols-outlined text-[18px]">sync</span>Re-run sync</button>
        <button type="button" class="${BTN.secondary}" disabled title="Coming soon — merging two records of one person is identity resolution, and no merge path exists yet."><span class="material-symbols-outlined text-[18px]">merge</span>Run deduplication (coming soon)</button>
      </div>
    </div>`;
  root.appendChild(head);

  const strip = el('div', 'grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-space-md');
  strip.innerHTML = skeleton({ rows: 1 });
  root.appendChild(strip);

  const noteHost = el('div', 'flex flex-col gap-2');
  root.appendChild(noteHost);

  const grid = el('div');
  grid.innerHTML = skeleton({ rows: 4 });
  root.appendChild(grid);

  const otherHost = el('div');
  otherHost.innerHTML = skeleton({ rows: 3 });
  root.appendChild(otherHost);
  const footHost = el('div');
  root.appendChild(footHost);

  /* Every source is read independently. "The aggregation is down" and "the
     customer list is down" are different events and the screen stays useful
     under either, so nothing here is allowed to reject the whole render. */
  /* The last three are the aggregation's own record. Every email and Slack
     figure on this screen is that job's output, and until they were read this
     screen could not tell a figure a run collected from a figure a run failed to
     collect and left standing. It states the health in the view's words and the
     per-customer verdict from the run's own audit row; it does not classify a
     status itself. */
  const [dirR, viewR, profR, waR, leadR, buyR, regR, healthR, auditR] = await Promise.allSettled([
    db(`v_customer_directory?select=*&limit=${DIR_LIMIT}`),
    db(`v_customer_360?select=*&order=lifetime_value_aed.desc,lead_count.desc&limit=${VIEW_LIMIT}`),
    db(`customer_360_profiles?select=${PROFILE_COLS}&order=last_synced_at.desc.nullslast&limit=${PROFILE_LIMIT}`),
    db(`whatsapp_contacts?select=${CONTACT_COLS}&limit=${CONTACT_LIMIT}`),
    db(`leads?select=id,name,email,phone,created_at&limit=${SOURCE_LIMIT}`),
    db(`purchase_history?select=*&limit=${SOURCE_LIMIT}`),
    db(`rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases,writes_audit_log&name=ilike.${AGG_MATCH}`),
    db(`v_workflow_health?select=${HEALTH_COLS}&name=ilike.${AGG_MATCH}`),
    db(`audit_log?select=status,summary,logged_at,lead_email,workflow&workflow=ilike.${AGG_MATCH}&order=logged_at.desc&limit=${AGG_LOG_LIMIT}`),
  ]);

  const dirRows  = val(dirR),  dirErr  = err(dirR);
  const viewRows = val(viewR) || [], viewErr = err(viewR);
  const profiles = val(profR) || [], profErr = err(profR);
  const contacts = val(waR)   || [], waErr   = err(waR);
  const leadRows = val(leadR), leadErr = err(leadR);
  const buyRows  = val(buyR),  buyErr  = err(buyR);
  const regRows    = val(regR)    || [], regErr    = err(regR);
  const healthRows = val(healthR) || [], healthErr = err(healthR);
  const auditRows  = val(auditR)  || [], auditErr  = err(auditR);

  /* ── The aggregation, identified rather than assumed ───────────────────── */
  /* One registry row or nothing. Two rows matching "360" would mean this screen
     cannot say which job wrote its figures, and the honest response to that is
     to say so, not to pick one. */
  const aggReg = regRows.length === 1 ? regRows[0] : null;
  const aggAmbiguous = regRows.length > 1;
  const aggNames = aggReg
    ? new Set([aggReg.name, aggReg.audit_name, ...(Array.isArray(aggReg.audit_aliases) ? aggReg.audit_aliases : [])]
        .filter(Boolean).map(norm))
    : null;
  /* Ordered logged_at.desc by the read, so [0] is the newest run anywhere on
     this list and aggRowsFor()[0] is the newest run about one customer. Newest
     is all that means: which run WROTE a given profile row is decided by
     runThatWrote() below, and it is frequently not [0]. */
  const aggLog = aggNames ? auditRows.filter(r => aggNames.has(norm(r.workflow))) : [];
  /* The registry row is the authority on identity, but it is not the only thing
     that can identify this job: one v_workflow_health row matching “360” names
     it just as unambiguously, and holding the health verdict back because
     workflow_registry answered 403 would suppress a true statement for want of a
     second opinion. Two health rows, like two registry rows, means the screen
     cannot tell which and says nothing. */
  const aggHealth = aggReg
    ? healthRows.find(h => String(h.id) === String(aggReg.id)) || null
    : (healthRows.length === 1 ? healthRows[0] : null);
  const aggRate = aggHealth ? successRate(aggHealth.successes_30d, aggHealth.effective_runs_30d) : null;
  const aggLogErr = regErr || auditErr;

  /* Which aggregation rows are about THIS person. audit_log.lead_email holds the
     same four key shapes communication_logs does — the row explaining Siva's
     profile is filed under `+971547484167@whatsapp.lead`, not under a name — so
     it is matched through the identity resolver and not on the address alone. */
  const aggRowsFor = ident => {
    if (!ident || !ident.ok || !aggLog.length) return [];
    const canon = new Set(ident.keys.map(k => normalizeKey(k).canonical).filter(Boolean));
    if (!canon.size) return [];
    return aggLog.filter(r => {
      const c = normalizeKey(r.lead_email).canonical;
      return !!c && canon.has(c);
    });
  };

  /* The same match for a customer_360_profiles row, which the screen-wide
     banners need before any customer has been opened. This used to compare the
     profile's email canonical against audit_log.lead_email directly, on the
     grounds that "a profile's email IS one of the four key shapes" — true of the
     two rows in the database tonight and not a rule. audit_log.lead_email is
     written by the same resolver communication_logs is, so the same expansion
     applies: a profile carrying a real address whose run logged under
     `+digits@whatsapp.lead` matched nothing at all. The profile row carries a
     phone, so it can be expanded exactly like a directory row. */
  const aggRowsForProfile = p => aggRowsFor(
    expandIdentity({ email: p && p.email, phone: p && p.phone, name: p && p.name }, {}));

  /* WHICH RUN WROTE THIS ROW — and the answer is often "none of the ones on
     record". The aggregation logs within a second or two of the upsert: read on
     1 Sep 2026, Siva's profile carries last_synced_at 31 Aug 22:00:11.645 and
     its audit row is stamped 22:00:12.400. Ali's profile carries 31 Aug
     22:00:07.125 and the newest audit row naming him is 28 Aug 22:00:24 — three
     nights earlier. Taking the newest run that names a customer and captioning
     it "Run that wrote it" therefore explained a figure with a run that did not
     produce it, and put that run's "Gmail read failed" summary under a number
     written three days later by a run that logged nothing about him at all.
     Attribution now requires the run to sit next to the write; where none does,
     the screen says the write is unaccounted for rather than borrowing the
     nearest story. */
  const RUN_WINDOW_MS = 15 * 60 * 1000;
  const runThatWrote = (runs, syncedAt) => {
    const t = Date.parse(str(syncedAt));
    if (!runs.length || Number.isNaN(t)) return null;
    return runs.find(r => {
      const rt = Date.parse(str(r.logged_at));
      return !Number.isNaN(rt) && Math.abs(rt - t) <= RUN_WINDOW_MS;
    }) || null;
  };

  const profileRuns = profiles.map(p => runThatWrote(aggRowsForProfile(p), p.last_synced_at));
  const runSuccess = profileRuns.filter(r => r && outcomeOf(r) === OUTCOME.SUCCESS).length;
  const runHalf    = profileRuns.filter(r => r && outcomeOf(r) !== OUTCOME.SUCCESS).length;
  const runUnknown = profileRuns.filter(r => !r).length;

  /* ── Build the customer list ───────────────────────────────────────────── */
  let spine = null, spineSource = '', spineNote = '';
  if (dirRows) {
    spine = spineFromDirectory(dirRows);
    spineSource = term('v_customer_directory');
    spineNote = 'A row exists here for every address with a lead or a purchase behind it.';
  } else if (leadRows || buyRows) {
    spine = spineFromSources(leadRows, buyRows);
    spineSource = 'leads + the recorded sales';
    spineNote = 'Rebuilt from the two tables the customer list is defined over, because the view itself could not be read.';
  }

  const customers = spine ? [...spine.values()] : [];
  customers.forEach(c => { c.view = null; c.profile = null; c.contacts = []; c.leads = []; c.purchases = []; });

  /* ── Hang the enrichment off it. None of this may create a customer. ───── */
  const others = new Map();
  const other = (key, seed) => {
    let o = others.get(key);
    if (!o) { o = { key, name: '', email: '', phone: '', chatId: '', basis: '', sources: new Set(), messages: null, lastSeen: null }; others.set(key, o); }
    if (seed) Object.keys(seed).forEach(k => { if (seed[k] && !o[k]) o[k] = seed[k]; });
    return o;
  };

  viewRows.forEach((r, i) => {
    const key = norm(r.email) || `view:${i}`;
    const hit = spine && spine.get(key);
    if (hit) { if (!hit.view) hit.view = r; return; }
    const o = other(key, { name: str(r.name), email: str(r.email), phone: str(r.phone) });
    o.sources.add('The customer record');
    if (!o.basis) o.basis = 'In the customer record but with no lead and no purchase behind the address, so the directory does not carry it.';
  });

  profiles.forEach((p, i) => {
    const key = norm(p.email) || `profile:${i}`;
    const hit = spine && spine.get(key);
    if (hit) { if (!hit.profile) hit.profile = p; return; }
    const o = other(key, { name: str(p.name), email: str(p.email), phone: str(p.phone) });
    o.sources.add('The customer profiles');
    if (!o.basis) o.basis = 'The nightly aggregation wrote a profile for this address, but there is no lead and no purchase behind it.';
  });

  /* WHETHER A CONTACT IN THE LIST BELOW IS ACTUALLY A LEAD — and lead 35 is why
     this check exists. v_customer_directory and v_customer_360 both start from
     `WHERE email IS NOT NULL AND email <> ''` (pg_get_viewdef, read 1 Sep 2026),
     so a lead whose email column holds the empty string is in neither view and
     this screen's spine cannot carry them. Lead 35, Effco Contracting llc
     (+971505433953), is that row: DISQUALIFIED in `leads`, ten messages in
     communication_logs under 111948809162873@lid, rendered on Leads in the same
     session, and absent from Customers altogether — the KPI reads "Customers 2"
     where three people exist.

     Repairing that means changing the views, which is not this file's to do.
     What IS this file's is what it says meanwhile. His whatsapp_contacts row
     falls through to the list below, which gave as its reason "There is no lead
     and no purchase for them, so they are not a customer" under a column headed
     "Why this is not a customer" — a flat assertion about somebody the Leads
     screen calls a lead four clicks away. A screen may be missing a customer; it
     may not deny that they are one. The leads read is already on this page, so
     the claim is checked before it is made.

     Matched on the same last-nine-digit rule the rest of the screen uses. Where
     two leads answer to the same nine digits the row says that instead of naming
     one: a suffix collision is what lib/identity.js refuses for, and it is not
     going to be settled here. */
  const leadByKey = new Map();
  const leadClash = new Set();
  (leadRows || []).forEach(l => {
    [l.email, l.phone].forEach(val => {
      const n = normalizeKey(val);
      if (!n.usable || n.weak) return;
      const seen = leadByKey.get(n.canonical);
      if (!seen) leadByKey.set(n.canonical, l);
      else if (str(seen.id) !== str(l.id)) leadClash.add(n.canonical);
    });
  });
  const leadFor = (...vals) => {
    for (const val of vals) {
      const n = normalizeKey(val);
      if (!n.usable || n.weak) continue;
      if (leadClash.has(n.canonical)) return { ambiguous: true };
      const l = leadByKey.get(n.canonical);
      if (l) return { lead: l };
    }
    return null;
  };

  contacts.forEach((w, i) => {
    const linked = norm(w.lead_email);
    const hit = linked && spine ? spine.get(linked) : null;
    if (hit) { hit.contacts.push(w); return; }
    const key = linked || norm(w.chat_id) || `wa:${i}`;
    const lab = contactLabel(w);
    const o = other(key, { name: lab.name, email: str(w.lead_email), phone: str(w.phone), chatId: str(w.chat_id) });
    o.sources.add('whatsapp_contacts');
    const asLead = leadRows ? leadFor(w.lead_email, w.phone, w.chat_id) : null;
    const leadEmail = asLead && asLead.lead ? norm(asLead.lead.email) : '';
    const leadInList = !!(leadEmail && spine && spine.get(leadEmail));
    o.leadRef = asLead || null;
    o.basis = !leadRows
      ? 'Messaged this WhatsApp number. Your leads could not be read here, so whether a lead exists for them is not known and nothing is claimed about it.'
      : asLead && asLead.ambiguous
        ? 'Messaged this WhatsApp number. More than one lead answers to the last nine digits of this number, so which lead this is — or whether it is any of them — cannot be told from here, and no claim either way is made.'
        : !asLead
          ? 'Messaged this WhatsApp number. There is no lead and no purchase for them, so they are not a customer.'
          : !leadEmail
            ? `A lead IS on file for this number — lead ${str(asLead.lead.id) || '(no id)'}${str(asLead.lead.name) ? ', ' + str(asLead.lead.name) : ''}, whose email column is empty. The customer list and the customer record both require an email address on the lead, so the customer list cannot carry them and they arrive here instead. They are not on this list because they are not a customer; they are on it because a view drops a lead with no email address.`
            : leadInList
              ? `A lead IS on file for this number — lead ${str(asLead.lead.id) || '(no id)'} under ${leadEmail} — and that address is a customer in the list above. This messaging row carries no email address of its own, so it could not be attached to them; it is the same person's WhatsApp channel, shown here only because the link is missing on the row.`
              : `A lead IS on file for this number — lead ${str(asLead.lead.id) || '(no id)'} under ${leadEmail} — and that address is not in the customer list above. Why it is not is not answerable from this screen, and no claim is made that this person is not a customer.`;
    o.idBasis = lab.basis;
    const m = n0(w.message_count);
    if (m != null) o.messages = (o.messages || 0) + m;
    if (w.last_seen && (!o.lastSeen || String(w.last_seen) > String(o.lastSeen))) o.lastSeen = w.last_seen;
  });

  (leadRows || []).forEach(l => { const hit = spine && spine.get(norm(l.email)); if (hit) hit.leads.push(l); });
  (buyRows  || []).forEach(p => { const hit = spine && spine.get(norm(p.email)); if (hit) hit.purchases.push(p); });

  const buyers  = buyRows ? customers.filter(c => c.purchases.length).length : null;
  const purchaseRows = buyRows ? customers.reduce((a, c) => a + c.purchases.length, 0) : null;
  const purchaseValue = (() => {
    if (!buyRows) return null;
    const vals = customers.flatMap(c => c.purchases.map(p => n0(p.amount_aed))).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  })();
  const withProfile = customers.filter(c => c.profile).length;
  /* Leads the spine is structurally unable to carry: `leads.email` empty or
     null, which both v_customer_directory and v_customer_360 filter out. Counted
     from the leads read this screen already issues, so the KPI can say how many
     people it is not showing instead of presenting its total as everybody. */
  const emailLessLeads = leadRows ? leadRows.filter(l => !str(l.email)).length : 0;
  /* A profile row that belongs to nobody in the directory is the aggregation
     having built a "customer" out of somebody who never was one. Counted and
     stated next to the total rather than quietly averaged away. */
  const orphanProfiles = spine ? profiles.filter(p => !spine.get(norm(p.email))).length : null;
  const otherList = [...others.values()];
  /* Not a stranger. A row in the list below whose number IS a lead is a customer
     the two views dropped on the `email <> ''` guard — lead 35 tonight — and the
     count is stated on the card rather than left for a reader to find one row at
     a time. */
  const otherWithLead = otherList.filter(o => o.leadRef && o.leadRef.lead).length;
  const linkedContacts = customers.reduce((a, c) => a + c.contacts.length, 0);
  const collapsed = customers.reduce((a, c) => a + c.dupes, 0);
  /* Counted after every source has been hung off the spine, so it is the number
     of customers this dealership genuinely cannot phone, not the number missing
     one particular column. */
  const withPhone = customers.filter(c => phoneStr(c)).length;
  const noPhone = customers.length - withPhone;
  /* Every read on this screen carries a limit. If one came back full, rows were
     almost certainly left behind, so anything counted off it is a floor rather
     than a total and is never printed as a total. Only the two base tables were
     checked for this before, which left the customer count itself — the largest
     number on the screen and the one read against the largest table — able to
     print a capped page as a total. */
  const leadsCapped = !!leadRows && leadRows.length >= SOURCE_LIMIT;
  const buysCapped  = !!buyRows  && buyRows.length  >= SOURCE_LIMIT;
  const dirCapped   = !!dirRows  && dirRows.length  >= DIR_LIMIT;
  const profCapped  = profiles.length >= PROFILE_LIMIT;
  const waCapped    = contacts.length >= CONTACT_LIMIT;
  const logCapped   = auditRows.length >= AGG_LOG_LIMIT;
  const CAPPED = n => `<div><span class="t-warm">This read came back at its ${num(n)}-row limit, so the figure is a floor, not a total.</span></div>`;

  /* ── Aggregation health ────────────────────────────────────────────────── */
  const synced = profiles.map(p => p.last_synced_at).filter(Boolean).sort();
  const newest = synced.length ? synced[synced.length - 1] : null;
  const oldest = synced.length ? synced[0] : null;
  const reported = profiles.map(p => ({ e: n0(p.total_emails), s: n0(p.total_slack_messages) }));
  /* `null || 0` is 0, and that one coercion turned "the aggregation reported
     nothing" into "the aggregation reported zero" — the exact distinction
     touchCell() exists to keep, contradicted by the banner three lines above the
     cell that keeps it. A figure counts as a touch only if it is a number above
     zero, and as a reported zero only if it is a number equal to zero.

     Not hypothetical: read on 1 Sep 2026, shabbir53ujjainwala@gmail.com carries
     total_emails 1 and total_slack_messages NULL, because the run that wrote it
     logged "Slack count UNKNOWN - Slack read failed, previous stored value left
     intact". A NULL here is a read that failed, not a customer with no Slack. */
  const anyTouch = reported.some(r => (r.e != null && r.e > 0) || (r.s != null && r.s > 0));
  const zeroProfiles = reported.filter(r => r.e === 0 && r.s === 0).length;
  const unreported = reported.filter(r => r.e == null || r.s == null).length;
  /* The question every zero on this screen turns on: has the aggregation run at
     all since the Gmail credential was repaired? Until it has, none of these
     numbers has been collected by a job that could reach the mailbox. */
  const postFix = profiles.filter(p => syncedAfterFix(p.last_synced_at)).length;
  const noStamp = profiles.filter(p => !str(p.last_synced_at)).length;

  /* The KPI sub-line used to read, in green, "Ran after the Gmail credential was
     fixed, so the zeros below were counted" — computed from one profile's
     timestamp against a date constant and then asserted about every zero on the
     screen. Both halves failed: the claim is per-profile, and the evidence is
     the run's own record, which on 28 Aug said the Gmail read was Forbidden four
     days after that constant. It now reports what the newest logged run did, and
     nothing about what any figure means. */
  const newestRun = aggLog[0] || null;
  const newestOutcome = newestRun ? outcomeOf(newestRun) : null;
  const aggRunSub = (() => {
    if (aggLogErr) {
      return `<span class="t-warm">The aggregation's own log could not be read (${esc(aggLogErr)}), so nothing is claimed about the run that wrote these figures</span>`;
    }
    if (aggAmbiguous) {
      return `<span class="t-warm">${esc(String(regRows.length))} entries in the automation register match “360”, so which job wrote these profiles cannot be told from here</span>`;
    }
    if (!aggReg) {
      return '<span class="t-muted">No the automation register row matches the Customer 360 aggregation, so its runs cannot be looked up</span>';
    }
    if (!aggLog.length) {
      return '<span class="t-muted">The aggregation has written no activity-log row under any of its registered names, so what its runs did is not recorded</span>';
    }
    const w = outcomeWords(newestOutcome);
    return newestOutcome === OUTCOME.SUCCESS
      ? `<span class="t-ok">Newest logged run succeeded outright · ${esc(ago(newestRun.logged_at))}</span>`
      : `<span class="t-hot">Newest logged run ${esc(w.label.toLowerCase())} · ${esc(ago(newestRun.logged_at))}</span>
         <div class="ds-cell-sub" style="white-space:normal">${esc(w.blurb)}</div>`;
  })();

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!spine) {
    strip.className = '';
    strip.innerHTML = errorState({ what: 'the customer list', err: dirErr || leadErr || buyErr || 'Unknown error' });
  } else {
    strip.innerHTML = [
      tile('Customers', num(customers.length),
        /* spineNote was computed in both branches and rendered in neither, so
           the one sentence that says what the list IS — and, in the fallback
           branch, that it was rebuilt rather than read — was being thrown away
           by a screen whose whole argument is that provenance travels with the
           figure. It travels here. */
        `<span class="t-muted" title="${esc(spineNote)}">${esc(spineSource)} · a lead or a purchase on file</span>
         ${emailLessLeads
            /* The sub-line read "a lead or a purchase on file" flat, and it is
               not: both views the spine is built from require
               `email IS NOT NULL AND email <> ''`, so a lead with no email
               address is on file and not on this screen. Live 1 Sep 2026 that is
               lead 35, and this figure is the count that stops "Customers 2"
               being read as "two people have ever enquired". */
            ? `<div><span class="t-warm">${num(emailLessLeads)} lead${emailLessLeads === 1 ? '' : 's'} on file ${emailLessLeads === 1 ? 'is' : 'are'} not counted here — ${emailLessLeads === 1 ? 'its' : 'their'} email column is empty and both views require <span class="mono">email &lt;&gt; ''</span>. ${emailLessLeads === 1 ? 'It is' : 'They are'} listed at the foot of this page instead.</span></div>`
            : ''}
         <div>${noPhone
            ? `<span class="t-warm">${num(noPhone)} with no phone number on any source</span>`
            : customers.length === 1
              ? '<span class="t-ok">The one customer on file has a phone number</span>'
              : `<span class="t-ok">All ${num(withPhone)} reachable by phone</span>`}</div>
         ${dirCapped ? CAPPED(DIR_LIMIT) : ''}`),
      tile('Recorded purchase value', aed(purchaseValue),
        buyErr
          ? '<span class="t-warm">The recorded sales could not be read</span>'
          : purchaseRows
            ? `<span class="t-muted">Summed over ${num(purchaseRows)} recorded purchase${purchaseRows === 1 ? '' : 's'} from ${num(buyers)} customer${buyers === 1 ? '' : 's'}</span>${buysCapped
                ? `<div><span class="t-warm">The recorded sales came back at the ${num(SOURCE_LIMIT)}-row read limit, so this is a floor, not the total</span></div>`
                : ''}`
            : '<span class="t-muted">No purchase recorded against any customer</span>'),
      tile('Contacts who are not customers', waErr && !otherList.length ? '—' : num(otherList.length),
        waErr
          ? '<span class="t-warm">The saved contact details could not be read, so this is incomplete</span>'
          : `<span class="t-muted">${num(contacts.length)} saved contact record${contacts.length === 1 ? '' : 's'} read · ${num(linkedContacts)} linked to a customer</span>`
            /* The tile's own label is a claim about every row it counts, and on
               1 Sep 2026 one of them is lead 35. The count that contradicts the
               label travels with it rather than being left in the table below
               for whoever scrolls that far. */
            + (otherWithLead
                ? `<div><span class="t-warm">${num(otherWithLead)} of ${otherList.length === 1 ? 'it' : 'them'} ${otherWithLead === 1 ? 'has' : 'have'} a lead on file and ${otherWithLead === 1 ? 'is' : 'are'} here only because both customer views require <span class="mono">leads.email &lt;&gt; ''</span></span></div>`
                : '')
            + (otherList.length
                ? ''
                /* Worth saying out loud rather than leaving as a bare 0: the 136
                   messages from the owner's personal phone book that used to
                   fill this list were deleted, and this is the count that proves
                   none of them is being carried as a customer. */
                : '<div><span class="t-ok">Nobody in the messaging or aggregation tables is being presented as a customer</span></div>')
            + (waCapped ? CAPPED(CONTACT_LIMIT) : '')),
      tile('Unified profiles', profErr ? '—' : num(profiles.length),
        profErr
          ? '<span class="t-warm">The customer profiles could not be read</span>'
          : `<span class="t-muted">${num(withProfile)} of ${num(customers.length)} customer${customers.length === 1 ? '' : 's'} ${withProfile === 1 ? 'has' : 'have'} one${orphanProfiles ? ` · ${num(orphanProfiles)} belong${orphanProfiles === 1 ? 's' : ''} to somebody who is not a customer` : ''}</span>`
            + (profCapped ? CAPPED(PROFILE_LIMIT) : '')),
      tile('Last aggregation run', profErr ? '—' : ago(newest),
        profErr
          ? '<span class="t-warm">Unknown — the profile table could not be read</span>'
          : newest
            /* `oldest !== newest` compares timestamps; ago() renders minutes
               apart as the same phrase, so this printed "11 h ago · oldest 11 h
               ago" and invented a spread that is not there. Only shown when the
               two actually read differently. */
            ? `<span class="t-muted">Newest run${oldest && ago(oldest) !== ago(newest) ? ` · oldest ${esc(ago(oldest))}` : ''}</span>
               <div>${aggRunSub}</div>`
            : '<span class="t-muted">No profile carries a last_synced_at value, so when this last ran is not knowable</span>'),
    ].join('');
  }

  /* ── Banners. Each one names the exact source that is missing or wrong. ── */
  const notes = [];
  /* The job's health belongs at the top of this screen because every email and
     Slack figure below is its output, and a profile built by a run that went out
     half-done holds whatever that run managed to collect. Stated in the view's
     own words through lib/health.js — a rate with no qualifying runs is neither
     0% nor 100% and successRate() returns null for it, which is why the sentence
     branches on effective_runs_30d rather than printing pct() regardless. */
  /* These two used to be arms of one if/else, so a 500 on audit_log took the
     DEGRADED verdict off the screen with it even though v_workflow_health had
     answered perfectly. They are different facts — "which run wrote this figure"
     and "how this job has been doing for thirty days" — and losing one is not a
     reason to withhold the other. */
  if (aggLogErr) {
    notes.push(`<div class="${NOTE.warm}"><span class="material-symbols-outlined">warning</span>
      <div>The Customer 360 aggregation's own run log could not be read (${esc(aggLogErr)}), so this
      screen cannot say whether the run behind each email and Slack figure below completed or went out half-done.
      The figures are shown exactly as the customer profiles holds them, with no claim about how they were
      collected.</div></div>`);
  } else if (aggAmbiguous) {
    notes.push(`<div class="${NOTE.warm}"><span class="material-symbols-outlined">warning</span>
      <div>${esc(String(regRows.length))} rows in the automation register match “360”, so which job writes the email and
      Slack figures on this screen cannot be determined from here. No run is attributed to any figure below.</div></div>`);
  }
  if (healthErr) {
    notes.push(`<div class="${NOTE.warm}"><span class="material-symbols-outlined">warning</span>
      <div>The automation health figures could not be read (${esc(healthErr)}), so how the Customer 360 aggregation has been
      doing over the last thirty days is not stated on this screen — neither well nor badly.</div></div>`);
  } else if (aggHealth && String(aggHealth.health || '').toUpperCase() !== 'HEALTHY') {
    const hw = healthWords(aggHealth.health);
    const eff = n0(aggHealth.effective_runs_30d), succ = n0(aggHealth.successes_30d);
    const parts = n0(aggHealth.partials_30d), fails = n0(aggHealth.failures_30d);
    notes.push(`<div class="${NOTE.warm}"><span class="material-symbols-outlined">rule</span>
      <div><strong>The job behind every email and Slack figure on this screen is ${esc(hw.label.toLowerCase())}.</strong>
      ${esc(hw.blurb)} ${eff
        ? `The automation health figures reports ${esc(String(succ))} of ${esc(String(eff))} qualifying run${eff === 1 ? '' : 's'}
           succeeded outright in the last 30 days (${esc(pct(aggRate))})${parts ? `, ${esc(String(parts))} went out half-done` : ''}${fails ? `, ${esc(String(fails))} failed` : ''}.`
        : 'No run in the 30-day window counted toward a rate, so there is no success rate to report — that is not 0% and not 100%.'}
      A run that went out half-done still writes a profile row, holding whatever it managed to collect and leaving
      the rest at whatever an earlier run left there. Each figure below says which run wrote it and what that run
      logged.</div></div>`);
  }
  if (dirErr && spine) {
    notes.push(`<div class="${NOTE.warm}"><span class="material-symbols-outlined">warning</span>
      <div>The customer list could not be read (${esc(dirErr)}), so this list was rebuilt from leads and
      the recorded sales — the two tables that view is defined over. It should match, but it has not been
      confirmed against the view. Nothing from the aggregation tables was used to fill the gap.</div></div>`);
  }
  if (profErr) {
    notes.push(`<div class="${NOTE.warm}"><span class="material-symbols-outlined">warning</span>
      <div>The customer profiles could not be read (${esc(profErr)}), so no email or Slack touch counts and no
      sync times are shown. Identity, leads, purchases and messages below are read live and are current.</div></div>`);
  } else if (profiles.length && !anyTouch) {
    /* Which of these zeros is an answer is decided by the runs that wrote them,
       not by their timestamps. This branch used to conclude, in a green-adjacent
       info banner, that the mailbox was genuinely empty and nothing was waiting
       on another run — reached entirely from last_synced_at against a date
       constant, and contradicted on 28 Aug by a run whose own summary says the
       Gmail read was Forbidden. postFix is now consulted only for profiles whose
       write no run accounts for — which is the only question a timestamp can
       answer, and it answers only "when", never "what was collected". */
    const verdict = runHalf ? 'half' : runSuccess === profiles.length ? 'counted' : 'unrecorded';
    const TONE_OF = { half: 'hot', counted: 'info', unrecorded: 'warm' };
    notes.push(`<div class="${NOTE[TONE_OF[verdict]]}">
      <span class="material-symbols-outlined">${verdict === 'counted' ? 'mark_email_read' : 'sync_problem'}</span>
      <div><strong>${verdict === 'counted'
        ? 'Every email and Slack touch count on this screen is zero — and every run that wrote one logged no step that failed to land.'
        : verdict === 'half'
          ? 'Every email and Slack touch count on this screen is zero, and at least one was written by a run that went out half-done.'
          : 'Every email and Slack touch count on this screen is zero, and nothing on record says whether they were counted.'}</strong>
      ${profiles.length === 1
        ? 'The one profile the nightly Customer 360 job has written reports'
        : `All ${esc(String(profiles.length))} profiles written by the nightly Customer 360 job report`}
      no email and no Slack touch above zero.
      ${unreported
        ? `${esc(String(unreported))} of them ${unreported === 1 ? 'leaves' : 'leave'} at least one of the two counters NULL, which is not a
           reported zero at all — it is a counter the job never wrote, and those are shown as an em dash below rather than as a 0.`
        : ''}
      ${runHalf || runSuccess
        ? `<strong>${esc(String(runHalf))} of ${esc(String(profiles.length))}</strong> ${runHalf === 1 ? 'was' : 'were'} written by a run that
           went out half-done, ${esc(String(runSuccess))} by a run that logged no failed step, and
           ${esc(String(runUnknown))} by a run the aggregation logged nothing about — no audit row sits next to when that
           profile was written, so what produced its figures is not recorded.`
        : ''}
      ${verdict === 'counted' ? esc(AGG_ZERO_SUCCESS)
        : verdict === 'half' ? esc(AGG_ZERO_HALF)
        : `${esc(AGG_ZERO_CAUSE)} ${postFix
            ? `<strong>${esc(String(postFix))} of ${esc(String(profiles.length))}</strong> ${postFix === 1 ? 'was' : 'were'}
               written after the credential was re-authorised, which dates ${postFix === 1 ? 'it' : 'them'} and nothing more.`
            : 'No profile has been written since the credential was re-authorised.'}`}
      ${noStamp ? `${esc(String(noStamp))} profile${noStamp === 1 ? ' carries' : 's carry'} no last_synced_at at all, so which run wrote ${noStamp === 1 ? 'it' : 'them'} is unknown.` : ''}</div></div>`);
  } else if (zeroProfiles) {
    /* This banner said "report a counted 0", and on 1 Sep 2026 it was saying it
       about Siva Thangavelu, whose 0 was written by a run whose own summary
       reads "Slack count UNKNOWN - Slack read failed, previous stored value left
       intact" — and it said it three lines above the cell that correctly renders
       that same 0 as "not counted". The word "counted" is a claim about how a
       figure was produced, and nothing but the run's own record can support it,
       so the banner now reads the same evidence the cells do instead of taking
       a zero at face value. */
    const zeroRuns = profiles
      .map((p, i) => ({ p, run: profileRuns[i] }))
      .filter(({ p }) => n0(p.total_emails) === 0 && n0(p.total_slack_messages) === 0);
    const zeroHalf = zeroRuns.filter(z => z.run && outcomeOf(z.run) !== OUTCOME.SUCCESS).length;
    const zeroOk   = zeroRuns.filter(z => z.run && outcomeOf(z.run) === OUTCOME.SUCCESS).length;
    const zeroNone = zeroRuns.length - zeroHalf - zeroOk;
    notes.push(`<div class="${zeroHalf ? NOTE.hot : NOTE.warm}"><span class="material-symbols-outlined">sync_problem</span>
      <div>${esc(String(zeroProfiles))} of ${esc(String(profiles.length))} profiles report 0 for both emails and Slack
      messages, while others report figures.${zeroHalf
        ? ` <strong>${esc(String(zeroHalf))} of those ${zeroHalf === 1 ? 'zeros was' : 'zeros were'} written by a run that
           went out half-done</strong>, so ${zeroHalf === 1 ? 'it is' : 'they are'} a read that failed rather than a customer
           with nothing on file.`
        : ''}${zeroOk
        ? ` ${esc(String(zeroOk))} ${zeroOk === 1 ? 'was' : 'were'} written by a run that logged no failed step, which is the
           only case in which a 0 here is an answer.`
        : ''}${zeroNone
        ? ` ${esc(String(zeroNone))} ${zeroNone === 1 ? 'has' : 'have'} no audit row beside the write that produced ${zeroNone === 1 ? 'it' : 'them'},
           so whether ${zeroNone === 1 ? 'that zero was' : 'those zeros were'} counted is not recorded anywhere this screen can read.`
        : ''}${unreported
        ? ` A further ${esc(String(unreported))} ${unreported === 1 ? 'leaves' : 'leave'} one of the two counters NULL,
           which is a counter the job never wrote and is not counted as a zero here.`
        : ''}
      ${esc(AGG_ZERO_CAUSE)} Each profile below names the run logged beside its write, or says that none was.</div></div>`);
  } else if (!profiles.length) {
    notes.push(`<div class="${NOTE.info}"><span class="material-symbols-outlined">schedule</span>
      <div>The nightly Customer 360 aggregation has not written a single profile row, so there are no email or
      Slack touch counts anywhere on this screen. Everything else is read live.</div></div>`);
  }
  if (viewErr) {
    notes.push(`<div class="${NOTE.warm}"><span class="material-symbols-outlined">warning</span>
      <div>The customer record could not be read (${esc(viewErr)}), so no lifetime value, VIP flag or aggregate count
      comes from it. Where the same figure can be rebuilt from a table this screen reads directly — leads,
      the recorded sales, the message history — the detail pane does that and says so on the figure itself; where it
      cannot, it shows an em dash rather than a guess. The customer list itself is unaffected.</div></div>`);
  }
  noteHost.innerHTML = notes.join('');

  /* ── Customer list ─────────────────────────────────────────────────────── */
  if (!spine) {
    grid.innerHTML = errorState({ what: 'customers', err: dirErr || leadErr || buyErr || 'Unknown error' });
  } else if (!customers.length) {
    grid.innerHTML = emptyState({ icon: 'contacts', title: 'No customers yet', body:
      `${spineSource} returned no rows. A person appears here as soon as a lead or a purchase is recorded ` +
      'against their email address. Somebody messaging the WhatsApp number does not make them a customer, ' +
      'and contacts who have only done that are listed further down this page.' });
  } else {
    renderList();
  }

  /* THE THREE PANELS (customer-360-3-panel-unified-dossier--31a9aa), with the
     client directory of customer-360-unified-intelligence--dc1622 as the
     first column: who (directory) → this person and their categories → the
     category's detail. */
  function renderList() {
    grid.className = 'grid grid-cols-1 xl:grid-cols-[300px_260px_minmax(0,1fr)] gap-space-md items-start';
    grid.innerHTML = `
      <section class="${SECTION} flex flex-col min-w-0">
        <div class="px-space-md pt-space-md pb-2 flex items-center justify-between">
          <span class="font-headline-md text-headline-md text-on-surface">Client directory</span>
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline">${num(customers.length)} ${customers.length === 1 ? 'customer' : 'customers'}</span>
        </div>
        <div class="px-space-md pb-2">
          <label class="sr-only" for="cq">Search customers</label>
          <div class="relative"><span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[16px]">search</span>
            <input type="search" id="cq" placeholder="Search name, email or phone" class="w-full h-9 pl-8 pr-3 rounded-lg bg-surface-container-low border border-outline-variant/40 font-body-sm text-body-sm focus:outline-none focus:ring-2 focus:ring-primary" /></div>
        </div>
        <div class="px-space-md pb-2">
          <div class="flex items-center p-0.5 bg-surface-container rounded-lg flex-wrap" id="cSeg" role="group" aria-label="Filter customers">
            <button type="button" data-f="all" class="${SEG.on}" aria-pressed="true">All ${num(customers.length)}</button>
            <button type="button" data-f="buyers" class="${SEG.off}" aria-pressed="false" ${buyErr || !buyers ? 'disabled' : ''}
              title="${buyErr
                ? esc('The recorded sales could not be read (' + buyErr + '), so buyers cannot be separated from enquiries.')
                : buyers ? 'Customers with at least one row in the recorded sales.'
                         : 'No customer has a purchase recorded, so this filter would come back empty.'}">Buyers ${buyErr ? '—' : num(buyers)}</button>
            <button type="button" data-f="enquiry" class="${SEG.off}" aria-pressed="false" ${buyErr || customers.length === buyers ? 'disabled' : ''}
              title="${buyErr
                ? esc('The recorded sales could not be read (' + buyErr + '), so buyers cannot be separated from enquiries.')
                : customers.length === buyers ? 'Every customer on file has bought, so this filter would come back empty.'
                                              : 'Customers with a lead on file but no purchase recorded.'}">Enquiries ${buyErr ? '—' : num(customers.length - buyers)}</button>
            <button type="button" data-f="nophone" class="${SEG.off}" aria-pressed="false" ${noPhone ? '' : 'disabled'}
              title="${esc(noPhone ? 'Customers with no phone number on the customer list, the customer record, the customer profiles, the recorded sales or the saved contact details — nothing the dashboard reads can call them.' : 'Every customer has a phone number on at least one source, so there is nothing to filter to.')}">No phone ${num(noPhone)}</button>
          </div>
        </div>
        <div id="custList" class="flex flex-col gap-1.5 px-2 pb-2 overflow-y-auto max-h-[720px]"></div>
        <div class="px-space-md py-3 border-t border-outline-variant/30 flex flex-col gap-2">
          <div class="ds-cell-sub" style="white-space:normal">${esc(CRM_NOTE)}</div>
          <button type="button" class="${BTN.secondary}" disabled title="${esc(NO_SYNC_HOOK)}">Re-run sync</button>
        </div>
      </section>
      <div class="flex flex-col gap-space-md min-w-0" id="custSide"></div>
      <div class="flex flex-col gap-space-md min-w-0" id="custPane"></div>`;
  }

  let q = '', filter = 'all', selected = null;

  const visible = () => customers.filter(c => {
    if (filter === 'buyers' && !c.purchases.length) return false;
    if (filter === 'enquiry' && c.purchases.length) return false;
    if (filter === 'nophone' && phoneStr(c)) return false;
    if (!q) return true;
    return `${nameOf(c)} ${c.email} ${phoneStr(c)}`.toLowerCase().includes(q);
  }).sort((a, b) => {
    const av = n0(a.view && a.view.lifetime_value_aed) || 0;
    const bv = n0(b.view && b.view.lifetime_value_aed) || 0;
    if (av !== bv) return bv - av;
    return nameOf(a).localeCompare(nameOf(b));
  });

  function drawList() {
    const rows = visible();
    const foot = collapsed
      ? `<div class="flex items-start gap-2 p-2">
           <span class="material-symbols-outlined text-[18px] text-outline">info</span>
           <div class="ds-cell-sub" style="white-space:normal">${esc(String(collapsed))} further
           ${collapsed === 1 ? 'row' : 'rows'} from ${esc(spineSource)} shared an email address with a customer
           above and ${collapsed === 1 ? 'was' : 'were'} collapsed into it, because leads and purchases are keyed
           on email. Messages are not — they are read under every key the person is filed under.</div>
         </div>`
      : '';

    $('custList').innerHTML = (rows.length
      ? rows.map(c => {
          const ltv = n0(c.view && c.view.lifetime_value_aed);
          /* Until 1 Sep 2026 v_customer_360 COALESCE’d its sum to 0, so an
             enquiry-only customer arrived in this money column as "AED 0" —
             indistinguishable from a real sale at no charge, and on that morning
             that was every row on the screen. The view now returns null instead,
             so the coercion is gone at source; the hasPurchase guard stays,
             because a 0 arriving here again from any source must still not be
             printed as money somebody spent. */
          const ltvCount = n0(c.view && c.view.purchase_count);
          const hasPurchase = ltvCount != null ? ltvCount > 0 : c.purchases.length > 0;
          const basis = buyErr
            ? '<span class="t-warm">purchase state unknown</span>'
            : c.purchases.length
              ? `${esc(String(c.purchases.length))} purchase${c.purchases.length === 1 ? '' : 's'}`
              : leadErr || leadsCapped
                ? '<span class="t-muted">no purchase on file</span>'
                : `<span class="t-muted">${esc(String(c.leads.length))} enquir${c.leads.length === 1 ? 'y' : 'ies'}, no purchase</span>`;
          const ph = phoneOf(c);
          return `<div class="${c.key === selected ? LIST.on : LIST.off}" role="button" tabindex="0" data-k="${esc(c.key)}">
            <div class="w-10 h-10 rounded-full bg-primary-container text-on-primary font-bold text-[12px] flex items-center justify-center shrink-0">${esc(initials(nameOf(c)))}</div>
            <div class="flex-1 min-w-0">
              <div class="font-body-md text-body-sm font-semibold text-on-surface truncate">${esc(nameOf(c))}
                ${c.view && c.view.is_vip
                  ? '<span class="pill vip" title="is_vip is set on this customer’s v_customer_360 row. The view decides the rule; this screen does not know what it is."><span class="dot"></span>VIP</span>'
                  : ''}</div>
              <div class="ds-cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ph.phone
                ? `<span class="mono" title="${esc('From ' + ph.from)}">${esc(maskText(ph.phone))}</span>`
                : '<span class="t-warm">No phone on any source</span>'}
                · ${esc(maskText(c.email || 'No email on the directory row'))}</div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-label-numeric-sm text-label-numeric-sm font-semibold">${ltv == null || !hasPurchase ? '' : aed(ltv)}</div>
              <div class="ds-cell-sub">${basis}</div>
            </div>
          </div>`;
        }).join('')
      : emptyState({ icon: 'search_off', title: 'No match', body: 'No customer matches this search and filter.' })) + foot;

    $('custList').querySelectorAll('[data-k]').forEach(n => {
      const openIt = () => open(n.dataset.k);
      n.addEventListener('click', openIt);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); }
      });
    });
  }

  /* ── Detail pane ──────────────────────────────────────────────────────── */
  async function open(key) {
    const c = customers.find(x => x.key === key);
    if (!c) return;
    selected = key;
    $('custList').querySelectorAll('[data-k]').forEach(n => { n.className = n.dataset.k === key ? LIST.on : LIST.off; });

    const pane = $('custPane');
    pane.innerHTML = skeleton({ rows: 4 });
    $('custSide').innerHTML = skeleton({ rows: 3 });
    const email = c.email;
    const qs = email ? likePattern(email) : null;

    /* Every linked read keys on email. A directory row without one is listed but
       cannot be cross-referenced, and saying so is the only honest option.

       Messages are the exception, and they have to be. `communication_logs.lead_email`
       holds four incompatible key shapes for one person — a real email, a
       `@c.us` chat id, a `@lid` handle and a synthesised `@whatsapp.lead` key —
       and reading under the email alone returned a truncated history rendered as
       if it were the whole of it. lib/identity.js expands the person into every
       key their rows can be filed under, using the same last-nine-digit rule the
       n8n `Resolve Lead Identity` node matched on when it wrote them. */
    const ident = expandIdentity(
      { email, phone: phoneStr(c), name: c.name },
      { links: c.contacts || [], leads: c.leads || [] });
    /* The message read is no longer gated on the email. A directory row without
       one still has a phone and often a linked WhatsApp contact, and those are
       exactly the keys the history is filed under — refusing to read because the
       email is missing would be the same truncation arriving from the other
       side. personQuery returns '' when nothing about this person is safe to
       query on; issuing that path would read the whole table, so the read is
       skipped and the section says why. */
    const commsFilter = personFilter(ident, { column: 'lead_email' });
    /* `lead_email` is selected although nothing displays it, because it is the
       only column that can prove a returned row belongs to this person.

       The widened read has the same wildcard hole the email reads had, arriving
       from a different direction: lib/identity.js builds the filter with `ilike`
       and quotes each key through quoteValue(), which escapes `"` and `\` and
       neither `%` nor `_`. A customer whose address contains an underscore is
       therefore sent to PostgREST as a LIKE pattern, and a near-neighbour's
       messages come back inside their history — the same defect as F4 on the
       leads read, which likePattern() and grabExact() already close. The module
       is not mine to change and its assertions pass — 305 of them as of 1 Sep
       2026, after this afternoon's suffix-collision fix; the read is defended
       here instead, by re-testing every row against the same canonical rule the
       filter was built from, and by saying on screen when a row had to be
       dropped rather than assuming none ever will be. */
    const commsPath = personQuery('communication_logs', ident,
      { select: 'lead_email,channel,direction,message,created_at', order: 'created_at.desc', limit: MSG_LIMIT });
    const ownCanon = new Set(commsFilter.keys.map(k => normalizeKey(k).canonical).filter(Boolean));
    /* The suffix patterns match by construction rather than by key, so the
       canonical they resolve to has to be admitted explicitly — otherwise the
       re-check would throw away exactly the rows the widening exists to find. */
    if (commsFilter.patterns.length && /^[0-9]{9}$/.test(str(ident.suffix))) ownCanon.add('phone:' + ident.suffix);
    const grabOwn = promise => promise.then(rows => {
      const all = rows || [];
      const kept = all.filter(r => {
        const n = normalizeKey(r.lead_email);
        return n.usable && ownCanon.has(n.canonical);
      });
      return { rows: kept, raw: all.length, foreign: all.length - kept.length };
    }, e => ({ err: e.message }));
    /* select=*,users(id,name) so the row handed to leadDrawer() is the same
       shape leads.js hands it — including response_time_minutes, which was a
       permanent 0 until it was repaired today and which the drawer renders as
       "no first reply timed" when it is null rather than as fast. */
    const [leads, purch, comms] = await Promise.all([
      email
        ? grabExact(db(`leads?select=*,users(id,name)&email=ilike.${qs}&order=created_at.desc`), email)
        : Promise.resolve({ rows: null }),
      email
        ? grabExact(db(`purchase_history?select=*&email=ilike.${qs}&order=purchase_date.desc`), email)
        : Promise.resolve({ rows: null }),
      commsPath ? grabOwn(db(commsPath)) : Promise.resolve({ rows: null, noKey: true }),
    ]);
    /* Every aggregation run that names this person, by any of their keys —
       newest first, because the read is ordered logged_at.desc.

       `custRun` is not custRuns[0]. It is the run that sits beside the write
       this pane is showing, and it is null when no run does. Live on 1 Sep 2026
       that is Ali's case: his profile was written 31 Aug 22:00:07 and the newest
       run naming him is 28 Aug 22:00:24, so the pane used to caption a
       three-day-old "Gmail read failed" as the run that produced tonight's
       figures. `custLatestRun` is kept separately so the pane can still say what
       the aggregation last managed to log about him — clearly labelled as an
       older run, and never as the source of a number. */
    const custRuns = aggRowsFor(ident);
    const custRun = runThatWrote(custRuns, c.profile && c.profile.last_synced_at);
    const custLatestRun = custRuns[0] || null;

    /* Guard against a slower earlier click landing after a newer one. */
    if (selected !== key) return;

    const v = c.view || {};
    const noEmailNote = '<div class="ds-cell-sub">This directory row carries no email address, and leads and purchases are keyed on email — so neither can be matched to it. Messages are read separately, under every key this person is filed under.</div>';
    const section = (title, res, empty, body, nullNote) => {
      if (res.err) return errorState({ what: title.toLowerCase(), err: res.err, retry: 'x' });
      if (res.rows == null) return nullNote || noEmailNote;
      if (!res.rows.length) return `<div class="ds-cell-sub">${esc(empty)}</div>`;
      return body(res.rows);
    };

    const ph = phoneOf(c);

    /* Never expected to fire. It fires only if PostgREST's ILIKE handling has
       changed under the escaping in likePattern(), and a silent wildcard match
       putting another customer's records in this pane is precisely the thing
       that must not pass unremarked. */
    const foreignNote = res => (res.foreign
      ? ` <span class="t-warm">· ${esc(String(res.foreign))} row${res.foreign === 1 ? '' : 's'} returned by the database belonged to a different address and ${res.foreign === 1 ? 'was' : 'were'} dropped — the email filter is matching more than this customer</span>`
      : '');

    /* "The view has no row for this person" and "the view has a row and left
       that column null" are different facts and lead to different next steps.
       Every substitution below names the one that actually happened. */
    const viewGap = c.view
      ? 'The customer record has a row for this customer but no value in that column'
      : 'The customer record has no row for this customer';

    /* v_customer_360 is the preferred source for these three because it counts
       across everything, not just the capped page just read. When it has no row
       for this customer the same figure is derived from the rows that were read,
       and the substitution is named — an operator who cannot tell which of the
       two produced a number cannot tell how much to trust it. */
    const viewLeads = n0(v.lead_count);
    const leadCount = viewLeads != null ? viewLeads : (leads.rows ? leads.rows.length : null);
    /* The same courtesy the lifetime value and the message count now get. The
       leads read below is unlimited and its foreign rows have already been
       dropped, so if it and the view disagree the pane is about to print "Leads
       3" directly above "Leads on file 1" and say nothing about it. Which of the
       two is right is not knowable from here, and the screen does not pick. */
    const leadSub = viewLeads != null
      ? (v.latest_status ? pill(v.latest_status, undefined, { verbatim: true }) : '<span class="t-muted">No status on the latest lead</span>')
        + (leads.rows && leads.rows.length !== viewLeads
            ? `<div><span class="t-warm">The customer record counts ${esc(String(viewLeads))}; your leads returned ${esc(String(leads.rows.length))} for this address. The two disagree and this screen cannot say which is right.</span></div>`
            : '')
      : leads.rows
        ? `<span class="t-warm">Counted from your leads — ${esc(viewGap)}</span>`
        : leads.err
          ? '<span class="t-warm">Neither the customer record nor your leads could be read</span>'
          : '<span class="t-muted">Not countable — this directory row has no email to match on</span>';

    const viewScore = n0(v.best_ai_score);
    const leadScores = (leads.rows || []).map(l => n0(l.ai_score)).filter(x => x != null);
    const bestScore = viewScore != null ? viewScore : (leadScores.length ? Math.max(...leadScores) : null);
    const scoreSub = viewScore != null
      ? (leadCount === 1
          /* A maximum over one row is that row. Calling it "highest across their
             leads" dresses a single score up as a comparison. */
          ? '<span class="t-muted">The score on their only lead · the customer record</span>'
          : '<span class="t-muted">Highest score across this customer’s leads · the customer record</span>')
      : leadScores.length
        ? `<span class="t-warm">${leadScores.length === 1 ? 'The ai_score on the one lead read here' : 'Highest ai_score on the leads read here'} — ${esc(viewGap)}</span>`
        : '<span class="t-muted">No lead of this customer’s carries an ai_score</span>';

    /* MESSAGES — ONE FIGURE, ONE DERIVATION (INV-008, closed 2 Sep 2026)
       ---------------------------------------------------------------------
       Until tonight this pane derived a customer's message count TWICE and
       printed both. The KPI was `comms.rows.length` — every row the widened read
       returned, internal notes included — and the sub-line under it then printed
       v_customer_360.message_count as a second number with a paragraph
       explaining why the two differed. Read live on 2 Sep 2026 that gave Ali
       (shabbir53ujjainwala@gmail.com) "Messages logged 29" over "v_customer_360
       reports 28, 1 below the figure above", and Siva Thangavelu
       (+971547484167@whatsapp.lead) "8" over "reports 7". Disclosing a gap is
       better than hiding it, but a caption is not an invariant: one figure has
       one derivation, and a reader handed two numbers for "how many messages"
       has been handed the reconciliation to do themselves.

       The gap was never a disagreement about the RULE. Both sides spell one
       predicate — public.nexus_is_message() in the database, lib/comm-events.js
       here, mirrored line for line. The count simply was not being taken over
       the messages: it was taken over the EVENTS, markers included, on the
       grounds that those are the rows the Recent messages section below lists.
       So the message figure was already derivable here; it was just not the one
       being printed. splitEvents() returns both halves in one pass and the count
       now comes off `.count`, which is the messages.

       WHICH SOURCE OWNS THE FIGURE: v_customer_360, wherever it has a count for
       this customer. It counts across the whole table while this read stops at
       MSG_LIMIT, and since `comm_taxonomy_views_own_the_rule` it expands the
       same key shapes and applies the same predicate — the two reasons it used
       to be the worse answer are both gone.

       IT DOES NOT HAVE EVERY CUSTOMER, so the fallback is not optional. The
       view's spine is `leads UNION purchase_history WHERE email <> ''`, keyed on
       lower(btrim(email)) where v_customer_directory keys on lower(email); this
       screen's read of it is capped at VIEW_LIMIT where the directory read is
       capped at DIR_LIMIT; and it can fail on its own. Where there is no row, or
       a row carrying no message_count, the figure is counted here from the rows
       that were read, under the same predicate — and the sub-line names which of
       the two answered, every time. It is never both.

       THE LAST-CONTACT TIME TRAVELS WITH THE COUNT, from the same source. A
       total and a timestamp drawn from two different populations is precisely
       the defect the other half of this pane carried until 1 Sep 2026, and
       taking the count from the view while dating the contact from the read
       would rebuild it in a new place.

       The derivation that does not own the figure becomes a CHECK. Two spellings
       of one rule over two key expansions ought to agree, and a disagreement is
       reported as the fault it would be rather than explained away as a
       population difference — that explanation was the old caption and it is
       gone with the gap. Live 2 Sep 2026 there is nothing to report: the view
       says 28 and 7, this read counts 28 messages out of 29 rows and 7 out of 8.

       LEAD 35 IS WHY THE FALLBACK CANNOT BE DROPPED, and also why the database
       was NOT changed to close this. Effco Contracting llc's email column holds
       the empty string, so he is in neither view, and communication_logs holds
       10 messages for him under 111948809162873@lid. But he does not reach this
       pane at all: the spine is v_customer_directory, which excludes him for the
       same reason, so widening v_customer_360 to cover empty-email leads would
       not give him a customer pane — it would only add a row to the "not a
       customer" list at the foot of this screen carrying the basis line "In
       v_customer_360 but with no lead and no purchase behind the address", which
       is false about him. Whether an email-less lead is a customer is a question
       about the SPINE, it changes the Customers count on every screen that reads
       these views, and it is not settled inside a message-count fix. See the
       leadByKey block above, which already refuses to call him a non-customer. */
    const viewMsgs = n0(v.message_count);
    const viewLast = str(v.last_contact_at) || null;
    /* One pass over the rows that were read, split by the browser's mirror of
       nexus_is_message(). `.count` is the messages; `.internal` is the
       dealership's own bookkeeping, which the section below lists and which is
       not a message, not a reply, and never a contact. */
    const events = comms.rows ? splitEvents(comms.rows) : null;
    const readMsgs = events ? events.count : null;
    const readLast = events ? events.lastContactAt : null;
    const markerRows = events ? events.internal : [];
    const rowsRead = comms.rows ? comms.rows.length : null;
    /* The cap is on what the DATABASE returned, not on what survived the
       ownership re-check. Testing the kept count would under-report the cap on
       any read where a foreign row was dropped, and a capped read presented as a
       total is the failure this flag exists to prevent. */
    const msgCapped = comms.raw != null && comms.raw >= MSG_LIMIT;

    /* THE RULE, in one place. The view answers when it has a count for this
       customer; otherwise the read does. Nothing else on this pane prints a
       message count, and the timestamp comes from whichever answered. */
    const msgSource = viewMsgs != null ? 'view' : readMsgs != null ? 'read' : null;
    const msgCount    = msgSource === 'view' ? viewMsgs : msgSource === 'read' ? readMsgs : null;
    const lastContact = msgSource === 'view' ? viewLast : msgSource === 'read' ? readLast : null;
    const msgDisplay  = num(msgCount);
    /* Never expected to fire, and reported rather than assumed to be 0 for the
       same reason foreignNote() is: a silent wildcard match putting somebody
       else's messages into this history is the failure the re-check exists to
       catch, and a defence nobody can see is a defence nobody can trust. */
    const commsForeign = comms.foreign
      ? `<div><span class="t-warm">${esc(String(comms.foreign))} row${comms.foreign === 1 ? '' : 's'} returned by the database ${comms.foreign === 1 ? 'is' : 'are'} filed under a key that is not this person's and ${comms.foreign === 1 ? 'was' : 'were'} dropped — the message filter is matching more than this customer.</span></div>`
      : '';
    /* Printed in full rather than summarised as a count. An operator who is told
       "matched on 4 keys" cannot check it; one who is shown the four keys can
       see at a glance whether a handle belonging to somebody else has been swept
       in, which is the one way this widening can go wrong. */
    const identKeyLine = commsFilter.ok
      ? `Keys: ${commsFilter.keys.join(', ')}${commsFilter.patterns.length
          ? ` — and any WhatsApp address whose number ends ${ident.suffix}`
          : ''}.`
      : '';
    /* The rows are ordered created_at.desc by the read and the ownership
       re-check preserves that order, so [0] is the newest row of ANY kind. It is
       kept only so the caption can name the row it is not dating the contact
       from — dropping a day off a figure a rep read yesterday without saying so
       would be its own small dishonesty. Compared against `readLast`, the newest
       MESSAGE among the same rows, because this sentence is about the list below
       and not about whichever source owns the figure. */
    const newestRow = (comms.rows && comms.rows.length && comms.rows[0].created_at) || null;
    const datedFromInternal = !!(newestRow
      && (readLast == null || Date.parse(readLast) !== Date.parse(newestRow)));
    /* How many of the excluded rows are silence escalations specifically. A row
       can be internal by its channel or its direction with an ordinary body —
       nothing on file is today, and the caption below has to be able to say so
       rather than calling every excluded row a silence marker, which is the
       claim that would be false the first time one is not. */
    const silenceRows = silenceCount(markerRows);
    const otherInternal = markerRows.length - silenceRows;
    const contactNote = (() => {
      const bits = [];
      let bad = false;
      if (markerRows.length) {
        /* Named by what they actually are. `silenceRows` are the detector's
           escalations; anything left over is internal by its channel or its
           direction and this screen does not know what wrote it, so it says
           that instead of guessing. */
        const what = otherInternal === 0
          ? `the 12-hour silence detector’s own ${esc(SILENCE_MARKER)} ${markerRows.length === 1 ? 'marker' : 'markers'}, written because nobody was in touch`
          : silenceRows === 0
            ? 'the dealership’s own internal notes — written on the system channel or with direction ‘internal’, never sent to anybody'
            : `internal — ${esc(String(silenceRows))} the silence detector’s ${esc(SILENCE_MARKER)} ${silenceRows === 1 ? 'marker' : 'markers'}, written because nobody was in touch, and ${esc(String(otherInternal))} on the system channel or with direction ‘internal’`;
        bits.push(`${esc(String(markerRows.length))} of the ${esc(String(rowsRead))} rows read here ${markerRows.length === 1 ? 'is' : 'are'} ${what}. `
          + `${markerRows.length === 1 ? 'It is' : 'They are'} listed below but ${markerRows.length === 1 ? 'is' : 'are'} not counted in the figure above and ${markerRows.length === 1 ? 'does' : 'do'} not date the last contact`
          + (datedFromInternal
              ? `: the newest row read is one of them, stamped ${esc(dubaiStamp(newestRow))}, which would read ${esc(ago(newestRow))}`
              : '')
          + '.');
      } else if (datedFromInternal) {
        /* Cannot happen while the only thing filtered out is an internal row.
           Reported rather than assumed away, for the same reason commsForeign
           is. */
        bad = true;
        bits.push('The newest row read is not a message, and nothing about it reads as one of the dealership’s internal notes — something else is being excluded and this screen cannot say what.');
      }
      /* THE CHECK. The derivation that did not answer is compared against the
         one that did, and only ever as a check: the number it produces is never
         offered as a rival figure. */
      if (viewMsgs != null && readMsgs != null) {
        if (msgCapped) {
          bits.push(`The history read here stopped at its ${esc(String(MSG_LIMIT))}-row cap, so the ${esc(String(readMsgs))} message${readMsgs === 1 ? '' : 's'} in it are a floor and cannot be checked against the figure above.`);
        } else if (viewMsgs === readMsgs) {
          bits.push(`The ${esc(String(readMsgs))} message${readMsgs === 1 ? '' : 's'} read here under this browser’s mirror of NEXUS’s own test for what counts as a message — come to the same number, so both spellings of the rule select the same rows.`);
        } else {
          bad = true;
          bits.push(`The history read here counts ${esc(String(readMsgs))} message${readMsgs === 1 ? '' : 's'} under the same predicate, ${esc(String(Math.abs(readMsgs - viewMsgs)))} ${readMsgs > viewMsgs ? 'more' : 'fewer'} than the figure above. One rule, two key expansions, and they are not selecting the same rows — this screen cannot say which set is right.`);
        }
      }
      /* The timestamp gets its own check, because two sets can be the same size
         and still not be the same rows. */
      if (msgSource === 'view' && readLast && viewLast
          && Date.parse(readLast) !== Date.parse(viewLast)) {
        bad = true;
        bits.push(`The newest message read here is ${esc(dubaiStamp(readLast))}, not the moment above. Both sides exclude internal rows with the same predicate, so that is not the reason, and this screen cannot say what is.`);
      } else if (msgSource === 'view' && viewLast == null && msgCount) {
        bad = true;
        bits.push(`The customer record reports ${esc(String(msgCount))} message${msgCount === 1 ? '' : 's'} for this customer but carries no last_contact_at, which its own definition should not allow — the two are computed from one subquery over one predicate.`);
      }
      if (!bits.length) return '';
      return `<div><span class="${bad ? 't-warm' : 't-muted'}">${bits.join(' ')}</span></div>`;
    })();
    /* A history that could not be read is said so under the figure. The figure
       itself still stands when the view owns it — the view is not a stand-in
       here, it is the source — but it has not been checked against the rows, and
       an empty Recent messages section below means "not read", not "nothing was
       said". */
    const msgReadNote = msgSource === 'view' && comms.rows == null
      ? (comms.err
          ? `<div><span class="t-warm">The message history could not be read — ${esc(comms.err)} — so the figure above could not be checked against the rows themselves, and the section below is empty for that reason and not because nothing was said.</span></div>`
          : `<div><span class="t-warm">No history was read: ${esc(commsFilter.note)} So the figure above could not be checked against the rows themselves.</span></div>`)
      : '';
    const msgSub = msgSource == null
      ? (comms.err
          ? `<span class="t-warm">The message history could not be read — ${esc(comms.err)}</span>`
            + `<div><span class="t-muted">${esc(viewGap)}, so there is no second source to fall back to and no figure is shown.</span></div>`
          : `<span class="t-muted">Not countable — ${esc(commsFilter.note)} ${esc(viewGap)}.</span>`)
      : `<span class="${msgSource === 'view' ? 't-muted' : 't-warm'}">${msgSource === 'view'
            ? 'Every message on file, counted with NEXUS’s own test for what counts as a message'
            : `Counted here from the message history across ${esc(String(commsFilter.keys.length))} recorded key${commsFilter.keys.length === 1 ? '' : 's'}${commsFilter.patterns.length ? ' and the last-nine-digit rule the backend matches on' : ''} — ${esc(viewGap)}${msgCapped ? `, and the read stops at ${esc(String(MSG_LIMIT))} rows, so this is a floor` : ''}`}${
            lastContact
              ? ` · last contact ${esc(ago(lastContact))}`
              : msgCount === 0
                ? ' · nothing on record was said to or by this customer'
                : ''}</span>`
        + contactNote
        + msgReadNote
        + commsForeign;

    /* LIFETIME VALUE, and what the view's figure actually is.

       Until the 1 Sep 2026 rebuild, v_customer_360 computed it as
       `COALESCE(sum(DISTINCT p.amount_aed), 0)` over a join that fans out across
       leads as well as purchases. The DISTINCT was not gratuitous — it stopped a
       customer with three leads having each purchase counted three times — but it
       de-duplicated by AMOUNT rather than by purchase, so two purchases at the
       same price collapsed into one while the `count(DISTINCT p.id)` printed
       beside it counted both. And the COALESCE mattered as much: a customer with
       no purchase at all came back as 0, not null, so "has never bought" and
       "bought and it came to nothing" arrived here as the same AED 0 in a
       currency column.

       Neither is true any more, and this file said both until tonight.
       pg_get_viewdef read 1 Sep 2026 19:0x UTC: lifetime_value_aed is now a
       correlated subquery, `(SELECT sum(p2.amount_aed) FROM purchase_history p2
       WHERE lower(btrim(p2.email)) = i.email)` — outside the fan-out entirely, a
       plain sum over every purchase row filed under the address, and null rather
       than 0 when there are none. `purchase_count` is still
       `count(DISTINCT p.id)` off the fanned-out join. Live on 1 Sep 2026 both
       v_customer_360 rows report lifetime_value_aed **null** with purchase_count
       0, because purchase_history holds no rows at all — the old comment here
       said they reported 0.

       The row-level sum this screen computes for itself is still preferred over
       the view's, because it is the sum of rows this pane can also show. */
    const purchAmounts = (purch.rows || []).map(x => n0(x.amount_aed));
    const withAmount = purchAmounts.filter(x => x != null);
    const purchTotal = withAmount.length ? withAmount.reduce((a, b) => a + b, 0) : null;
    const noAmount = purch.rows ? purch.rows.length - withAmount.length : 0;
    const ltvFromView = n0(v.lifetime_value_aed);
    const viewPurchases = n0(v.purchase_count);
    /* Until 1 Sep 2026 v_customer_360 summed DISTINCT amount_aed, so two
       purchases at the same price counted once and the view reported the sum of
       a customer's distinct PRICES rather than what they had spent. Since the
       rebuild it sums every purchase row on file in a correlated subquery — no
       DISTINCT, no join fan-out — so a disagreement no longer has that
       explanation and this screen must not offer it. The wording below said
       "distinct purchase rows", which was a third thing the view has never done.
       What is left is the read window: this screen sums the rows it fetched, the
       view sums all of them. */
    const DISTINCT_CAVEAT =
      'The view now sums every purchase row filed under this address, with no DISTINCT and no join fan-out, so this gap is not the old DISTINCT-amount defect. '
      + 'The likeliest cause is the read: this screen sums only the purchase rows it fetched, while the view sums every row on file.';

    let ltvValue, ltvSub;
    if (purch.rows && !purch.rows.length) {
      ltvValue = '—';
      ltvSub = `<span class="t-muted">No purchase recorded for this customer, so there is no lifetime value to state.</span>`
        /* The branches were the wrong way round. This one runs when purchase_history
           returned NO row for the address and the view reports a figure anyway —
           which is a disagreement, and was captioned "which is why both sides
           agree". Since the 1 Sep 2026 rebuild the view sums purchase_history
           directly, so a number here means it matched rows this read did not
           (`lower(btrim(email))` against this screen's escaped ilike), and the
           honest statement is that the two are not over the same set. The
           agreement is the null case, and it is now the one that says so. */
        + (ltvFromView != null
            ? `<div><span class="t-warm">The customer record reports ${esc(aed(ltvFromView))} for this customer and the recorded sales returned no row for the address this screen read, so the two are not over the same set of rows and this screen cannot say which set is right.</span></div>`
            : c.view
              ? `<div><span class="t-muted">The customer record leaves lifetime_value_aed null for this customer too. Until 1 Sep 2026 it COALESCE’d its sum to zero, so somebody who had never bought and somebody who bought at no charge were the same AED 0 to it; the two sides agree here because it no longer does that.</span></div>`
              : '');
    } else if (purchTotal != null) {
      ltvValue = aed(purchTotal);
      ltvSub = `<span class="t-muted">Summed from the ${esc(String(withAmount.length))} purchase row${withAmount.length === 1 ? '' : 's'} read here${noAmount ? `, ${esc(String(noAmount))} more carrying no amount_aed` : ''}</span>`
        + (ltvFromView == null
            ? `<div><span class="t-muted">${esc(viewGap)}</span></div>`
            : ltvFromView === purchTotal
              ? '<div><span class="t-muted">The customer record agrees</span></div>'
              : `<div><span class="t-warm">The customer record reports ${esc(aed(ltvFromView))}. ${esc(DISTINCT_CAVEAT)}</span></div>`);
    } else if (purch.rows) {
      ltvValue = '—';
      ltvSub = `<span class="t-warm">${esc(String(purch.rows.length))} purchase row${purch.rows.length === 1 ? '' : 's'} on file, none carrying an amount_aed, so there is nothing to sum</span>`;
    } else if (ltvFromView != null) {
      ltvValue = aed(ltvFromView);
      ltvSub = `<span class="t-warm">Every purchase amount on file, summed · the customer record${viewPurchases == null ? '' : ` · ${num(viewPurchases)} purchase${viewPurchases === 1 ? '' : 's'}`} — The recorded sales could not be read here, so it could not be checked against the rows themselves</span>`
        + `<div class="ds-cell-sub" style="white-space:normal">${esc(DISTINCT_CAVEAT)}</div>`;
    } else {
      ltvValue = '—';
      ltvSub = `<span class="t-muted">No purchase amount recorded, and ${esc(viewGap.replace('that column', 'lifetime_value_aed'))}</span>`;
    }

    const waHtml = waErr
      ? `<div class="ds-cell-sub" style="white-space:normal">The saved contact details could not be read (${esc(waErr)}), so any WhatsApp channel for this customer cannot be shown.</div>`
      : c.contacts.length
        ? `<div class="flex flex-col gap-2">${c.contacts.map(w => {
            const lab = contactLabel(w);
            return `<div class="flex items-start gap-3 p-3 rounded-lg bg-surface-container-low">
              <span class="material-symbols-outlined text-[18px] text-outline">chat</span>
              <div class="flex-1 min-w-0">
                <div class="font-body-sm text-body-sm font-semibold">${lab.name ? esc(maskText(lab.name)) : '<span class="t-muted">No name captured on this chat</span>'}</div>
                <div class="ds-cell-sub" style="white-space:normal">${esc(lab.basis)} · linked to this customer by the email on the lead record.</div>
                <div class="ds-cell-sub mono" style="word-break:break-all">${esc(str(w.chat_id) || 'no chat id')}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="ds-cell-sub">${str(w.phone) ? `<span class="mono">${esc(maskText(str(w.phone)))}</span>` : '<span class="t-muted">no phone stored</span>'}</div>
                <div class="ds-cell-sub">${waCount(w)} · ${esc(ago(w.last_seen))}</div>
              </div>
            </div>`;
          }).join('')}</div>`
        : '<div class="ds-cell-sub" style="white-space:normal">No saved contact details row is linked to this email. Most of the WhatsApp contacts in this system are not customers, so the absence of one here is normal.</div>';

    /* ── Panel 2: this person, and their categories ──────────────────────── */
    const isBuyer = !buyErr && c.purchases.length;
    const purchCount = purch.rows ? purch.rows.length : null;
    const interests = [...new Set((leads.rows || []).map(l => str(l.vehicle_interest)).filter(Boolean))];
    /* Journey: the rows this pane already holds, in one time order — a lead
       arriving, a purchase, a message. Nothing is inferred between them. */
    const journey = [
      ...(leads.rows || []).map(l => ({ at: l.created_at, kind: 'Lead', icon: 'person_add', text: `Lead #${str(l.id)} created${l.vehicle_interest ? ` — asked about ${str(l.vehicle_interest)}` : ''}`, sub: str(l.status) ? `Status ${str(l.status)}` : '' })),
      ...(purch.rows || []).map(x => ({ at: x.purchase_date, kind: 'Purchase', icon: 'handshake', text: `Bought ${str(x.vehicle) || 'a vehicle with no name recorded'}${n0(x.amount_aed) == null ? '' : ` · ${aed(x.amount_aed)}`}`, sub: x.deal_id ? `Deal ${String(x.deal_id)}` : '' })),
      ...(comms.rows || []).map(m => ({ at: m.created_at, kind: str(m.channel) || 'message', icon: norm(m.direction) === 'inbound' ? 'south_west' : 'north_east', text: String(m.message || '').slice(0, 200), sub: str(m.direction) })),
    ].filter(e => e.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const CATS = [
      { k: 'identity', icon: 'badge', label: 'Identity', badge: v.is_vip ? 'VIP' : (isBuyer ? 'Buyer' : 'Enquiry') },
      { k: 'leads', icon: 'person_search', label: 'Leads', badge: leads.rows ? `${num(leads.rows.length)}` : '—' },
      { k: 'conversations', icon: 'forum', label: 'Conversations', badge: msgDisplay },
      { k: 'vehicles', icon: 'directions_car', label: 'Vehicles & garage', badge: `${num(purchCount == null ? 0 : purchCount)} owned · ${num(interests.length)} asked` },
      { k: 'appointments', icon: 'event', label: 'Appointments & test drives', badge: 'Open' },
      { k: 'deals', icon: 'contract', label: 'Deals & contracts', badge: purchCount == null ? '—' : num(purchCount) },
      { k: 'service', icon: 'build', label: 'Service & aftersales', badge: 'Needs DMS', soon: true },
      { k: 'revenue', icon: 'payments', label: 'Revenue', badge: ltvValue },
      { k: 'journey', icon: 'timeline', label: 'Journey timeline', badge: `${num(journey.length)} events` },
      { k: 'audit', icon: 'receipt_long', label: 'Aggregation record', badge: `${num(custRuns.length)} runs` },
    ];
    if (!CATS.some(x => x.k === activeCat)) activeCat = 'identity';

    const tileHtml = (label, value, subHtml) => `<div class="p-3 rounded-lg bg-surface-container-low flex flex-col gap-1 min-w-0">
        <span class="font-table-header text-table-header uppercase tracking-wider text-outline">${esc(label)}</span>
        <span class="font-label-numeric-md text-label-numeric-md font-bold text-on-surface">${value}</span>
        <div class="font-body-sm text-[12px] leading-snug text-on-surface-variant" style="white-space:normal">${subHtml}</div>
      </div>`;

    $('custSide').innerHTML = `
      <section class="${SECTION} p-space-md flex flex-col gap-3">
        <div class="flex items-start gap-3">
          <div class="w-12 h-12 rounded-lg bg-primary-container text-on-primary font-bold flex items-center justify-center shrink-0">${esc(initials(nameOf(c)))}</div>
          <div class="min-w-0 flex-1">
            <div class="font-headline-md text-headline-md text-on-surface leading-tight">${esc(nameOf(c))}</div>
            <div class="flex items-center gap-1.5 flex-wrap mt-1">
              ${v.is_vip ? '<span class="pill vip" title="is_vip is set on this customer’s v_customer_360 row. The view decides the rule; this screen does not know what it is."><span class="dot"></span>VIP</span>' : ''}
              ${buyErr ? '' : c.purchases.length ? pill('Buyer', 'ok', { verbatim: false }) : '<span class="chip">Enquiry — no purchase on file</span>'}
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-1.5 font-body-sm text-body-sm">
          <div class="flex items-center gap-2"><span class="material-symbols-outlined text-[16px] text-outline">call</span>${ph.phone
            ? `<span class="font-label-numeric-sm">${esc(maskText(ph.phone))}</span> <span class="ds-cell-sub">· ${esc(ph.from)}</span>`
            : '<span class="t-warm">No phone number on any source</span>'}</div>
          <div class="flex items-center gap-2 min-w-0"><span class="material-symbols-outlined text-[16px] text-outline">mail</span><span class="truncate">${esc(maskText(c.email || 'No email on the directory row'))}</span></div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${leads.rows && leads.rows.length
            ? `<button type="button" class="${BTN.primary}" data-act="lead"><span class="material-symbols-outlined text-[18px]">open_in_new</span>Open ${leads.rows.length === 1 ? 'this lead' : 'newest lead'}</button>`
            : ''}
          <button type="button" class="${BTN.secondary}" data-act="conv"><span class="material-symbols-outlined text-[18px]">forum</span>Conversations</button>
        </div>
      </section>
      <section class="${SECTION} py-2">
        <div class="px-space-md py-2 flex items-center justify-between"><span class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Categories</span>
          <span class="font-label-numeric-sm text-label-numeric-sm text-primary">${CATS.length} modules</span></div>
        <div class="flex flex-col px-2 gap-0.5" role="tablist" aria-label="Customer categories">
          ${CATS.map(x => `<button type="button" role="tab" data-cat="${x.k}" aria-selected="${x.k === activeCat}" class="${x.k === activeCat ? CAT.on : (x.soon ? CAT.soon : CAT.off)}">
            <span class="material-symbols-outlined text-[18px]">${x.icon}</span><span class="flex-1 text-left">${esc(x.label)}</span>
            ${x.soon ? statusChip('coming-soon', 'Needs DMS') : `<span class="font-label-numeric-sm text-[11px] ${x.k === activeCat ? 'text-on-primary' : 'text-outline'}">${x.badge}</span>`}</button>`).join('')}
        </div>
      </section>
      <section class="${SECTION} p-space-md flex flex-col gap-2">
        <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Financial &amp; relationship footprint</div>
        <div class="grid grid-cols-1 gap-2">
          ${tileHtml('Lifetime value', ltvValue, ltvSub)}
          ${tileHtml('Leads', num(leadCount), leadSub)}
          ${tileHtml('Best AI score', num(bestScore), scoreSub)}
          ${tileHtml('Messages logged', msgDisplay, msgSub)}
        </div>
      </section>`;

    /* ── Panel 3: the category's detail ────────────────────────────────────── */
    const KV = 'grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-2 font-body-sm text-body-sm';
    const identityHtml = `
        <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Why this person is a customer</div>
        <dl class="${KV}">
          <dt class="text-outline">Directory</dt><dd>${dirErr
            ? '<span class="t-warm">Rebuilt from leads and the recorded sales — The customer list could not be read</span>'
            : 'In the customer list <span class="t-ok">· leads UNION the recorded sales</span>'}</dd>
          <dt class="text-outline">Leads on file</dt><dd>${leads.err
            ? `<span class="t-warm">Could not be read — ${esc(leads.err)}</span>`
            : leads.rows == null
              ? '<span class="t-muted">Cannot be matched without an email address</span>'
              : `${esc(String(leads.rows.length))}${foreignNote(leads)}`}</dd>
          <dt class="text-outline">Purchases on file</dt><dd>${purch.err
            ? `<span class="t-warm">Could not be read — ${esc(purch.err)}</span>`
            : purch.rows == null
              ? '<span class="t-muted">Cannot be matched without an email address</span>'
              : `${esc(String(purch.rows.length))}${foreignNote(purch)}`}</dd>
          <dt class="text-outline">Directory row</dt><dd>${c.id
            ? `<span class="mono">${esc(c.id)}</span> <span class="ds-cell-sub">· their id in the customer list</span>`
            : '<span class="t-muted">Rebuilt from leads and the recorded sales — there is no directory row behind it</span>'}</dd>
          <dt class="text-outline">Underlying records</dt><dd>${dirErr
            ? '<span class="t-muted">Not available — the view that reports it could not be read</span>'
            : c.sourceRecords == null
              ? '<span class="t-muted">The customer list returned no source_records value for this address</span>'
              : n0(c.sourceRecords) != null
                ? `${num(c.sourceRecords)} <span class="ds-cell-sub">source_records, as the customer list counts them</span>`
                : `<span class="mono">${esc(String(c.sourceRecords))}</span> <span class="ds-cell-sub">source_records, exactly as the customer list reports it</span>`}</dd>
          <dt class="text-outline">Last seen</dt><dd>${c.lastSeen
            ? `${esc(ago(c.lastSeen))} <span class="ds-cell-sub">· the newest last_seen_at on this address</span>`
            : '<span class="t-muted">No last_seen_at on this row</span>'}</dd>
          <dt class="text-outline">Email key</dt><dd class="mono" style="word-break:break-all">${esc(maskText(c.email || '—'))}</dd>
          <dt class="text-outline">Message keys</dt><dd>${commsFilter.ok
            ? `<span class="mono" style="word-break:break-all">${esc(commsFilter.keys.join(', '))}</span>
               <div class="ds-cell-sub" style="white-space:normal">${esc(commsFilter.note)} The key each message is filed under holds four incompatible key shapes for one person, so a history read under the address alone is a fragment of itself. ${ident.keyDetail.some(k => k.synthetic) ? 'The derived keys are the exact spellings the workflows write for a known phone number; they are queried whether or not a contact row exists for them.' : ''}</div>`
            : `<span class="t-warm">None</span>
               <div class="ds-cell-sub" style="white-space:normal">${esc(commsFilter.note)}</div>`}</dd>
          <dt class="text-outline">Phone</dt><dd>${ph.phone
            ? `<span class="mono">${esc(maskText(ph.phone))}</span> <span class="ds-cell-sub">· found on ${esc(ph.from)}</span>`
            : `<span class="t-warm">Not recorded</span>
               <div class="ds-cell-sub" style="white-space:normal">${esc(NO_PHONE_LONG)}</div>`}</dd>
          <dt class="text-outline">Source system</dt><dd>NEXUS <span class="t-muted">· not your CRM</span>
            <div class="ds-cell-sub" style="white-space:normal">${esc(CRM_NOTE)}</div></dd>
        </dl>
        <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">WhatsApp channel</div>
        ${waHtml}
        <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Unified profile · the customer profiles</div>
        ${profErr
          ? `<div class="ds-cell-sub" style="white-space:normal">The profile table could not be read (${esc(profErr)}).</div>`
          : c.profile
            ? `<dl class="${KV}">
                 <dt class="text-outline">Customer ID</dt><dd class="mono">${esc(c.profile.customer_id == null ? '—' : String(c.profile.customer_id))}</dd>
                 <dt class="text-outline">Email touches</dt><dd>${touchCell(c.profile.total_emails, c.profile.last_synced_at, custRun)}</dd>
                 <dt class="text-outline">Slack messages</dt><dd>${touchCell(c.profile.total_slack_messages, c.profile.last_synced_at, custRun)}</dd>
                 <dt class="text-outline">Last synced</dt><dd>${esc(ago(c.profile.last_synced_at))}${c.profile.last_synced_at
                   ? ` <span class="ds-cell-sub">· ${syncedAfterFix(c.profile.last_synced_at)
                        ? 'after the mail connection was restored'
                        : 'before the mail connection was restored'}</span>`
                   : ' <span class="t-muted">(the row exists but carries no timestamp, so which run wrote it is unknown)</span>'}</dd>
                 <dt class="text-outline">Name on profile</dt><dd>${esc(maskText(str(c.profile.name) || '—'))}</dd>
                 <dt class="text-outline">Phone on profile</dt><dd>${str(c.profile.phone)
                   ? `<span class="mono">${esc(maskText(str(c.profile.phone)))}</span>`
                   : '<span class="t-muted">None on this profile row</span>'}</dd>
               </dl>
               <div class="ds-cell-sub" style="white-space:normal">${esc(aggNote(c.profile.last_synced_at, custRun))} Which run wrote it is under Aggregation record.</div>`
            : (n0(v.total_emails) != null || n0(v.total_slack_messages) != null)
              ? `<div class="ds-cell-sub" style="white-space:normal">The nightly job has written no customer profile for this customer.
                   The customer record carries the same two counters for them and they are shown here — but it records no time of
                   collection, so when these were counted, and therefore whether they predate the mail connection being restored, cannot be told from it.</div>
                 <dl class="${KV}">
                   <dt class="text-outline">Email touches</dt><dd>${touchCell(v.total_emails, null, custRun)}</dd>
                   <dt class="text-outline">Slack messages</dt><dd>${touchCell(v.total_slack_messages, null, custRun)}</dd>
                 </dl>
                 <div class="ds-cell-sub" style="white-space:normal">${esc(AGG_ZERO_CAUSE)}</div>`
              : quiet('link_off', 'No data source yet', 'The nightly Customer 360 aggregation has not written a row for this customer, and the customer record reports no touch counts for them either, so there are no email or Slack figures to show and no last_synced_at. Identity, phone, leads, purchases and logged messages on this screen are read live and are current.')}`;

    const purchaseList = rows => `<div class="flex flex-col gap-2">${rows.map(x => {
        const vehicle = str(x.vehicle);
        const rowPhone = str(x.phone);
        return `<div class="p-3 rounded-lg bg-surface-container-low flex items-start gap-3">
          <span class="w-9 h-9 rounded-lg bg-surface-container-lowest text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">directions_car</span></span>
          <div class="flex-1 min-w-0">
            <div class="font-body-md text-body-sm font-semibold">${vehicle ? esc(vehicle) : '<span class="t-muted">No vehicle recorded on this purchase</span>'}</div>
            <div class="ds-cell-sub">${x.purchase_date
              ? `${esc(dubaiDate(x.purchase_date, str(x.purchase_date)))} · ${esc(ago(x.purchase_date))}`
              : 'No purchase date recorded'}${x.deal_id ? ` · deal ${esc(String(x.deal_id))}` : ''}</div>
            <div class="ds-cell-sub">Recorded as ${esc(maskText(str(x.customer_name) || nameOf(c)))} ·
              ${rowPhone ? `<span class="mono">${esc(maskText(rowPhone))}</span>` : '<span class="t-muted">no phone on this purchase row</span>'}</div>
          </div>
          <div class="font-label-numeric-md text-label-numeric-md font-bold text-on-surface shrink-0">${n0(x.amount_aed) == null ? '<span class="ds-t-tertiary">—</span>' : aed(x.amount_aed)}</div>
        </div>`;
      }).join('')}
      ${purchTotal == null ? '' : `<div class="ds-cell-sub num">${esc(String(rows.length))} purchase${rows.length === 1 ? '' : 's'} · ${aed(purchTotal)} total</div>`}
      <div class="ds-cell-sub" style="white-space:normal">${esc(NO_INVENTORY_LINK)}</div></div>`;

    const leadsHtml = section('Leads', leads, 'No lead recorded for this customer.', rows => `
        <div class="flex flex-col">${rows.map(l => tlItem(TL_DOT[tone(l.status)] || TL_DOT.neutral,
          `${esc(ago(l.created_at))}${l.source ? ' · ' + esc(l.source) : ''}${n0(l.ai_score) == null ? '' : ' · score ' + num(l.ai_score)}
            · ${str(l.phone) ? `<span class="mono">${esc(maskText(str(l.phone)))}</span>` : '<span class="t-muted">no phone on this lead</span>'}
            · ${n0(l.response_time_minutes) == null
                 /* The wording is lib/lead-drawer.js's: a null means nothing was
                    timed, never a fast reply. */
                 ? '<span class="t-warm" title="nexus_mark_first_response stamps this column for the first reply it can attribute to the lead. It has not stamped this one — usually because nothing has gone back since the lead row was created, sometimes because the conversation started before the lead existed, which it will not measure. Either way there is no measured wait here, and it is not a fast reply.">no first reply timed</span>'
                 : `${esc(mins(l.response_time_minutes))} to first reply ${Number(l.response_time_minutes) > 5
                      ? '<span class="t-hot">· breaches the 5-minute rule</span>'
                      : '<span class="t-ok">· within SLA</span>'}`}`,
          `${esc(str(l.vehicle_interest) || 'No vehicle recorded')} ${pill(l.status || 'NEW', undefined, { verbatim: !!l.status })}`,
          n0(l.budget_aed) == null ? '' : `<div class="ds-cell-sub">Budget ${aed(l.budget_aed)}</div>`)).join('')}</div>`);

    const messagesHtml = section('Recent messages', comms,
        `No message is logged under any of the ${commsFilter.keys.length} key${commsFilter.keys.length === 1 ? '' : 's'} this customer is filed under${commsFilter.patterns.length ? ', nor under any WhatsApp address ending in the last nine digits of their number' : ''}.`,
        rows => `
        <div class="flex flex-col">${rows.slice(0, 10).map(m => tlItem(TL_DOT.neutral,
          `<span class="chip">${esc(str(m.channel) || 'unknown channel')}</span> ${esc(str(m.direction))} · ${esc(ago(m.created_at))}`,
          esc(String(m.message || '').slice(0, 240)))).join('')}</div>
        <div class="ds-cell-sub" style="white-space:normal">${rows.length > 10 ? `Showing the newest 10 of ${esc(String(rows.length))} rows read${rows.length >= MSG_LIMIT ? ` (capped at ${esc(String(MSG_LIMIT))}, so there are more)` : ''}. ` : ''}${events && events.internalCount
          /* This list is EVENTS and the figure is MESSAGES, so the two will not
             tally whenever an internal note is among the rows — said here. */
          ? `${esc(String(events.count))} of the rows read here ${events.count === 1 ? 'is a message' : 'are messages'} and ${esc(String(events.internalCount))} ${events.internalCount === 1 ? 'is one of the dealership’s own internal notes' : 'are the dealership’s own internal notes'}, listed here because the read returned them and not counted in the message figure. `
          : ''}These come from the message history and are counted independently of the aggregation's email and Slack figures.
        ${esc(commsFilter.note)} ${esc(identKeyLine)}</div>
        ${ident.ambiguity.length ? ident.ambiguity.map(a => note('warm', 'warning', esc(a.message))).join('') : ''}`,
        comms.noKey
          ? `<div class="ds-cell-sub" style="white-space:normal">${esc(commsFilter.note)} No read was issued: a query with no key would have matched every message in the table rather than none, and returning that as this customer's history is the failure this section exists to avoid.</div>`
          : undefined);

    const auditHtml = `
        <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Run that wrote the profile</div>
        <div class="font-body-sm text-body-sm">${aggLogErr
          ? `<span class="t-warm">Unknown — the aggregation's log could not be read (${esc(aggLogErr)})</span>`
          : !aggReg
            ? '<span class="t-muted">Unknown — no entry in the automation register identifies the aggregation</span>'
            : custRun
              ? `${pill(outcomeWords(outcomeOf(custRun)).label, outcomeWords(outcomeOf(custRun)).tone, { verbatim: false })}
                 <span class="ds-cell-sub">· ${esc(ago(custRun.logged_at))} · logged beside this profile’s last_synced_at</span>
                 <div class="ds-cell-sub" style="white-space:normal">${esc(str(custRun.summary) || 'The run logged no summary.')}</div>`
              : custLatestRun
                ? `<span class="t-warm">Not recorded</span>
                   <div class="ds-cell-sub" style="white-space:normal">No activity log row was written within ${esc(String(RUN_WINDOW_MS / 60000))} minutes of this profile’s last_synced_at, so which run produced its figures is not on record. The newest run naming this customer is older than the profile row and did not write it.</div>`
                : `<span class="t-warm">No activity log row names this customer</span>
                   <div class="ds-cell-sub" style="white-space:normal">The aggregation has logged ${esc(String(aggLog.length))}${logCapped ? ' or more' : ''} run${aggLog.length === 1 ? '' : 's'}${logCapped ? ` — the activity log read came back at its ${esc(String(AGG_LOG_LIMIT))}-row limit, so older runs were not read` : ''}, none of them under any key this customer is filed under.</div>`}</div>
        <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Every run naming this customer</div>
        ${custRuns.length ? `<div class="flex flex-col">${custRuns.slice(0, 20).map(r => {
            const w = outcomeWords(outcomeOf(r));
            return tlItem(TL_DOT[w.tone] || TL_DOT.neutral,
              `<span class="t-${esc(w.tone)}">${esc(w.label)}</span> · ${esc(dubaiStamp(r.logged_at))} · ${esc(ago(r.logged_at))}`,
              esc(maskText(str(r.summary) || 'The run logged no summary.')));
          }).join('')}</div>`
          : '<div class="ds-cell-sub">No Customer 360 aggregation run on record names this customer. Only the aggregation’s own rows are read on this screen; the per-lead audit trail is on the lead drawer’s Timeline.</div>'}`;

    const DETAIL = {
      identity: { title: 'Identity', sub: 'Why this person is on the customer list, every key they are filed under, and the unified profile', html: identityHtml },
      leads: { title: 'Leads', sub: 'Every lead on file under this address', html: leadsHtml },
      conversations: { title: 'Conversations', sub: 'The newest messages under every key this person is filed under', html: messagesHtml },
      vehicles: { title: 'Vehicles & garage', sub: 'What they bought, and what they asked about',
        html: `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Asked about</div>
          ${interests.length ? `<div class="flex flex-wrap gap-1.5">${interests.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>`
            : `<div class="ds-cell-sub">${leads.rows ? 'No lead of theirs names a vehicle.' : 'Not knowable — no lead could be read for this customer.'}</div>`}
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Bought</div>
          ${section('Purchase history', purch, 'No purchase recorded for this customer.', purchaseList)}` },
      appointments: { title: 'Appointments & test drives', sub: 'Showroom visits attached to this customer’s leads', html: `<div data-cust-appts>${skeleton({ rows: 2 })}</div>` },
      deals: { title: 'Deals & contracts', sub: 'Every recorded sale under this address', html: section('Purchase history', purch, 'No purchase recorded for this customer.', purchaseList) },
      service: { title: 'Service & aftersales', sub: '', html: comingSoonPanel({ icon: 'build', title: 'Service & aftersales history',
        body: 'Workshop visits, repair orders and service-due dates for the vehicles this customer owns.',
        prerequisite: 'Your DMS connected. NEXUS has no service, repair-order or appointment-in-workshop table to read.' }) },
      revenue: { title: 'Revenue', sub: 'What this customer has spent, from recorded purchases only',
        html: `<div class="p-space-md rounded-lg bg-surface-container-low"><div class="font-table-header text-table-header uppercase tracking-wider text-outline">Lifetime value · recorded purchases</div>
            <div class="font-label-numeric-lg text-[1.75rem] font-bold text-on-surface">${ltvValue}</div><div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${ltvSub}</div></div>
          ${comingSoonPanel({ icon: 'percent', title: 'Gross margin per customer', body: 'What the dealership made on this customer, not only what they paid.',
            prerequisite: 'A cost on each purchase row; purchase_history records the sale price and nothing about cost.' })}` },
      journey: { title: 'Journey timeline', sub: 'Leads, purchases and messages in one time order — nothing inferred between them',
        html: journey.length ? `<div class="flex flex-col">${journey.slice(0, 40).map(e => tlItem(TL_DOT.neutral,
            `<span class="material-symbols-outlined text-[14px]">${esc(e.icon)}</span> <span class="chip">${esc(e.kind)}</span> ${esc(dubaiStamp(e.at))}`,
            esc(maskText(e.text)), e.sub ? `<div class="ds-cell-sub">${esc(e.sub)}</div>` : '')).join('')}</div>
            ${journey.length > 40 ? `<div class="ds-cell-sub">Showing the newest 40 of ${num(journey.length)} events.</div>` : ''}`
          : quiet('timeline', 'Nothing dated to place on a timeline', 'No lead, purchase or message for this customer came back with a date on this read.') },
      audit: { title: 'Aggregation record', sub: 'What the nightly Customer 360 job logged about this customer', html: auditHtml },
    };

    const paintDetail = () => {
      const d = DETAIL[activeCat] || DETAIL.identity;
      pane.innerHTML = `<section class="${SECTION}">
          <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between gap-2">
            <div class="min-w-0"><div class="font-headline-md text-headline-md text-on-surface">Category detail: ${esc(d.title)}</div>
              ${d.sub ? `<div class="font-body-sm text-body-sm text-on-surface-variant">${esc(d.sub)}</div>` : ''}</div>
          </div>
          <div class="p-space-md flex flex-col gap-3">${d.html}</div>
        </section>
        ${comingSoonPanel({ icon: 'bolt', title: 'Next best action for this customer',
          body: 'A recommended next step for this person, with the evidence behind it.',
          prerequisite: 'Per-customer recommendations from the action engine; today recommendations exist per lead and per unit, on Money Leaks and the Action Center.' })}`;
      pane.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => open(key)));
      if (activeCat === 'appointments') paintAppointments();
    };

    /* Visits attached to this customer's leads, read through the same accessor
       the Appointments screen uses. That accessor answers a WINDOW — the next
       few days plus anything still open or unresolved — so this list is not
       the customer's whole history, and says so. */
    const paintAppointments = async () => {
      const box = pane.querySelector('[data-cust-appts]');
      if (!box) return;
      const ids = new Set((leads.rows || []).map(l => String(l.id)));
      if (!ids.size) {
        box.innerHTML = `<div class="ds-cell-sub" style="white-space:normal">${leads.rows ? 'No lead is on file for this customer, and every visit belongs to a lead.' : 'No lead could be matched to this customer, so no visit can be attached to them.'}</div>`;
        return;
      }
      let rows;
      try { rows = await db('rpc/nexus_appointment_status?p_days=7') || []; }
      catch (e) { box.innerHTML = errorState({ what: 'this customer’s visits', err: e }); return; }
      if (selected !== key || !box.isConnected) return;
      const mine = rows.filter(r => r.lead_id != null && ids.has(String(r.lead_id)));
      box.innerHTML = (mine.length
        ? `<div class="flex flex-col gap-2">${mine.map(r => `<div class="p-3 rounded-lg bg-surface-container-low flex items-start justify-between gap-3">
            <div><div class="font-body-sm text-body-sm font-semibold">${r.starts_at ? esc(dubaiStamp(r.starts_at)) : 'No time proposed yet'}</div>
              <div class="ds-cell-sub">${esc(str(r.vehicle_model) || 'No vehicle attached')} · ${esc(str(r.assigned_to_name) || 'No salesperson assigned')}</div>
              ${str(r.evidence) ? `<div class="ds-cell-sub" style="white-space:normal">${esc(str(r.evidence))}</div>` : ''}</div>
            ${pill(str(r.state) || 'NO STATE', undefined, { verbatim: true })}</div>`).join('')}</div>`
        : '<div class="ds-cell-sub">No visit in the diary window is attached to this customer’s leads.</div>')
        + '<div class="ds-cell-sub" style="white-space:normal">Read from the diary window (yesterday to seven days ahead, plus anything still requested, offered or unresolved). An older, closed visit is not listed here — that is the window, not an absence.</div>';
    };

    paintDetail();
    $('custSide').querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      activeCat = b.dataset.cat;
      $('custSide').querySelectorAll('[data-cat]').forEach(x => {
        const on = x.dataset.cat === activeCat;
        const cat = CATS.find(y => y.k === x.dataset.cat);
        x.className = on ? CAT.on : (cat && cat.soon ? CAT.soon : CAT.off);
        x.setAttribute('aria-selected', String(on));
      });
      paintDetail();
    }));

    /* The record is the lead drawer, opened with the lead row this screen
       already holds — lib/nav.js go() takes a screen id and nothing else, so a
       "deep link" into Leads cannot be performed. Rows are created_at.desc, so
       [0] is the newest lead. */
    const leadBtn = $('custSide').querySelector('[data-act="lead"]');
    if (leadBtn) leadBtn.addEventListener('click', () => leadDrawer(leads.rows[0]));
    $('custSide').querySelector('[data-act="conv"]')?.addEventListener('click', () => go('conversations'));
  }

  if (spine && customers.length) {
    $('cq').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); drawList(); });
    $('cSeg').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        filter = b.dataset.f;
        $('cSeg').querySelectorAll('button').forEach(x => {
          const on = x === b;
          x.className = on ? SEG.on : SEG.off;
          x.setAttribute('aria-pressed', String(on));
        });
        drawList();
      });
    });
    drawList();
    await open(customers[0].key);
  }

  /* ── Everyone who is NOT a customer ────────────────────────────────────── */
  /* This section is the point of the rewrite. These people are in the system —
     most of them because they messaged the owner's personal WhatsApp number —
     and they must be visible, because pretending they are not there is how one
     of them ends up being treated as a customer. They are just never counted as
     one, never given a lifetime value, and never given an action. */
  const otherSorted = otherList.slice().sort((a, b) => (n0(b.messages) || 0) - (n0(a.messages) || 0));
  const allOtherSourcesDown = !!waErr && !!profErr && !!viewErr;

  const otherCols = [
    { label: 'Contact', strong: true, render: o => o.name
      ? `${esc(displayName(o.name))}<div class="ds-cell-sub" style="white-space:normal">${esc(o.idBasis || 'Name as recorded by the source table')}</div>`
      : `<span class="mono t-muted" style="word-break:break-all">${esc(maskText(o.chatId || o.email || o.key))}</span>
         <div class="ds-cell-sub t-warm" style="white-space:normal">${esc(o.idBasis || 'No name on record — this is an identifier, not a person’s name')}</div>` },
    /* Headed for what the column can actually establish. "Why this is not a
       customer" asserted the conclusion in the heading, so a row whose reason is
       "a view dropped a lead with no email address" was filed under a title that
       contradicted it. */
    { label: 'Why this row is not in the customer list', render: o => `<span class="ds-cell-sub" style="white-space:normal">${esc(o.basis)}</span>` },
    { label: 'Phone', render: o => o.phone
      ? `<span class="mono">${esc(maskText(o.phone))}</span>`
      : '<span class="t-muted">Not stored on any row for this contact</span>' },
    { label: 'Where it appears', render: o => [...o.sources].map(s => `<span class="chip">${esc(s)}</span>`).join(' ') },
    /* Headed for the column it is rather than for the thing a reader would
       assume it is. The value is whatsapp_contacts.message_count summed over
       this contact's rows, and on 1 Sep 2026 that column was 0 on all ten rows
       in the table while communication_logs held between 1 and 23 messages under
       the same chat ids. A column headed "Messages" showing 0 for a person with
       23 of them is an absence rendered as a fact, so the heading names the
       counter and the cell says when the counter is empty. */
    { label: 'Messages on the contact record', align: 'r', render: o => o.messages == null
      ? '<span class="t-muted">—</span>'
      : o.messages === 0
        ? '<span class="t-muted" title="Not a count of this contact’s messages. The message history is where those are, and Conversations reads it per thread.">0 — the counter, not the conversation</span>'
        : num(o.messages) },
    { label: 'Last seen', align: 'r', render: o => esc(ago(o.lastSeen)) },
  ];

  /* dc1622's "Omnichannel inquiries pending identity resolution" table, with
     this screen's honest heading: these rows are NOT customers, and nothing
     here merges or promotes them — no merge path exists, so the Stitch "Merge"
     and "Promote to file" buttons are not offered. Rows open Conversations. */
  const TH = 'px-4 py-2.5 font-table-header text-table-header uppercase tracking-wider text-outline';
  const otherTable = otherSorted.length
    ? `<div class="overflow-x-auto"><table class="w-full border-collapse">
        <thead><tr class="bg-surface-container-low border-b border-outline-variant/30">${otherCols.map(c2 =>
          `<th class="${TH} ${c2.align === 'r' ? 'text-right' : 'text-left'}">${esc(c2.label)}</th>`).join('')}</tr></thead>
        <tbody class="divide-y divide-outline-variant/20">${otherSorted.map((o, i) => `<tr class="hover:bg-surface-container-low cursor-pointer transition-colors" data-oi="${i}">${otherCols.map(c2 =>
          `<td class="px-4 py-2.5 align-top font-body-sm text-body-sm ${c2.align === 'r' ? 'text-right' : 'text-left'}">${c2.render(o)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`
    : `<div class="p-space-md">${emptyState({ icon: 'done_all', title: 'Nothing outside the customer list',
        body: 'Every row in the saved contact details, the customer profiles and the customer record matches a customer in the directory, so nothing is being presented as a customer that is not one. A row appears here the moment somebody messages the WhatsApp number, or the nightly job writes a profile, for an address with no lead and no purchase behind it.' })}</div>`;

  otherHost.innerHTML = `<section class="${SECTION}">
    <div class="px-space-md py-3 border-b border-outline-variant/30 flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap"><span class="font-headline-md text-headline-md text-on-surface">Contacts who are not customers</span>
          <span class="px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-label-numeric-sm text-label-numeric-sm font-semibold">${num(otherList.length)} not in the customer list</span></div>
        <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">Everyone who appears in the saved contact details, the customer profiles or the customer record
        and not in the customer list above. Most are people who messaged the owner's WhatsApp number and have
        neither a lead nor a purchase. None of them has a lifetime value or can be actioned from here. Read the reason on each row before treating
        it as a stranger: ${otherWithLead
          ? `<strong>${esc(String(otherWithLead))} of these ${otherWithLead === 1 ? 'rows has' : 'rows have'} a lead on file</strong> and ${otherWithLead === 1 ? 'is' : 'are'} here because
             v_customer_directory and v_customer_360 require <span class="mono">leads.email &lt;&gt; ''</span> — a
             database defect that loses a real customer from this screen, not a finding about the person`
          : 'every one of them is a contact with no lead and no purchase behind it'}. Rows open Conversations.</div>
      </div>
      <button type="button" class="${BTN.secondary}" disabled title="Coming soon — there is no merge path that files a contact under a customer.">Merge (coming soon)</button>
    </div>
    ${allOtherSourcesDown
      ? `<div class="p-space-md">${errorState({ what: 'the contact directory', err: waErr })}</div>`
      : `${waErr ? `<div class="px-space-md pt-space-md">${note('warm', 'warning', `The saved contact details could not be read (${esc(waErr)}), so WhatsApp-only contacts are missing from this list.`)}</div>` : ''}${otherTable}`}
  </section>`;
  otherHost.querySelectorAll('tr[data-oi]').forEach(tr => tr.addEventListener('click', () => go('conversations')));

  footHost.innerHTML = trustFooter({
    source: 'v_customer_directory · v_customer_360 · customer_360_profiles · whatsapp_contacts · leads · purchase_history',
    asOf: dubaiStamp(readAt),
    evidence: spine ? `${num(customers.length)} ${customers.length === 1 ? 'customer' : 'customers'} · ${num(otherList.length)} non-customer ${otherList.length === 1 ? 'contact' : 'contacts'}` : 'The customer list could not be read',
    actor: actorName(),
  });
};

/* ==========================================================================
   S11 · Team
   ========================================================================== */
