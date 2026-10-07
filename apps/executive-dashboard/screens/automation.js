/* NEXUS OS — screens/automation.js
   The workflow health screen. Rebuilt on 20 Aug 2026.

   Until two days ago this screen was quietly wrong: it read the all-time `runs`
   and `failures` columns and called anything with a non-zero failure count
   "Failing" forever, so a workflow that broke once in March and has been clean
   since looked identical to one that is failing right now. `v_workflow_health`
   now carries `runs_30d`, `failures_30d` and `last_failure` beside the all-time
   totals and computes `health` on a rolling 30-day window, so this screen leads
   with the recent window and keeps the all-time figures as context behind it.

   Rebuilt again on 24 Aug 2026 evening, for three backend changes it was
   misrepresenting:

     · Every workflow now carries a hard five-minute `executionTimeout`, with one
       deliberate exception (the 7-Day Warm Lead Drip, which holds Wait nodes).
       That ceiling is stated here rather than left in a config file, because a
       run stopped by it arrives in these counts as a *failure* and would
       otherwise be read as the workflow being broken.
     · A scheduled job that silently stops is invisible to `v_workflow_health` —
       no runs means no failures means nothing to colour red. This screen now
       judges every scheduled workflow against its own cadence, the way
       `scripts/nexus_healthcheck.py` section 7 does server-side, and says
       plainly how much weaker its evidence is.
     · Run history is matched through `workflow_registry.audit_name` and
       `audit_aliases`, never on an exact name, because audit_log names drift
       from n8n workflow names and an unmatched alias reads as "never ran".

   Rebuilt a third time on 31 Aug 2026, and this one was not a refinement.
   Every health figure on this screen — the KPI strip, the banners, the per-row
   rate, the per-category rate, the drawer — was computed from `runs_30d` and
   `failures_30d`, and `failures_30d` counted `status = 'FAILED'` and nothing
   else. The writers also emit PARTIAL, REJECTED and NOT_EXECUTED, so every one
   of those scored here as a success. Counted against the live database on
   1 Sep 2026, this is what that cost:

     · Competitor Price Scraping — 96 runs, 12 of which recorded a price. The
       other 84 wrote REJECTED with "Scrape produced no usable intel … no price
       could be extracted from the page", and all 84 counted as successes. The
       row read HEALTHY at 100.0% while the dealership was getting no competitor
       pricing at all.
     · Finance Calc — 60 runs, 3 outright successes. It read 91.7%. The real
       figure is 11.1%.
     · Customer 360 Aggregation — 12 nightly partials counted as successes, so
       it read 91.3% against a real 39.1%. Worth being exact about this one,
       because it is the case the 31 Aug audit named: it was not showing green.
       Its red came from two unrelated Bitrix24 credential failures logged on
       23 Aug, and when those age out of the window on 22 September the old
       arithmetic would have turned it HEALTHY at 100.0% with the nightly
       partial still happening every night.

   Three other screens had made the same mistake independently, so what a status
   means now lives in exactly one place — `lib/health.js`, which mirrors
   `public.nexus_outcome_class()` in Postgres one-for-one — and this screen
   consumes it. Nothing below decides what a status means; where it needs to
   know, it asks.

   Two decisions that layer encodes, restated here because they change what
   every number on this screen means:

     · A refusal by design is not a fault. REJECTED_EXPECTED — an unauthorised
       call, a quote refused by validation — is left out of the success-rate
       denominator entirely, so it can neither count as a success nor dilute a
       real miss rate. Finance Calc has 33 of them in the window; its rate is
       over the other 27 runs.
     · A partial is not a success. PARTIAL makes a workflow DEGRADED, because
       work left the system half-done. Finance Calc holds five rows whose own
       summary reads "Quote issued | 1 of 1 claimed steps did not land
       [finance_quotes row …]" — the customer was handed a quote that was never
       recorded anywhere.

   The rules this screen holds itself to:

     · The 30-day success rate is `successes_30d` over `effective_runs_30d` —
       the runs the workflow was actually expected to deliver on — computed here
       through `successRate()` rather than read from `success_rate_30d`, so the
       screen and the view can be compared instead of one being taken on trust.
       Where they disagree the drawer says so rather than picking one.
     · A rate with a zero denominator is not 0% and it is not 100%. It is no
       rate, `successRate()` returns null for it, and every place that would
       have printed a number prints which absence it is instead.
     · "No failures" and "nothing is being measured" are opposite findings and
       never share a colour. Most of the registered workflows do not write to
       audit_log; they are NOT_INSTRUMENTED, and a blank health record for those
       is reported as a blind spot, not as good news.
     · Seven health values arrive from the view and each is rendered as itself,
       with its own segment, its own icon and its own place in the sort. None of
       the three that were added is folded into a state it might mean.
       PRODUCING_NOTHING is neither healthy nor degraded — it is a workflow that
       runs without failing and achieves nothing, which is what Competitor Price
       Scraping has been doing all month, and it needs a person as badly as a
       failure does. NO_QUALIFYING_RUNS is the absence of a rate, not a low one,
       and is not an attention state. UNKNOWN_OUTCOME is health that cannot be
       stated at all, which is a finding rather than a pass, so it is.
     · The activity log is filtered and coloured by outcome, not by the status
       word a row happens to hold, because the counts above are — and a filter
       that disagreed with the KPI over the same rows would be worse than no
       filter. Every row still shows the raw status beside the outcome wherever
       the two differ, so a writer mislabelling its own row is visible rather
       than quietly relabelled.
     · A pill whose words come from `lib/health.js` is built here rather than
       through `pill()`, which attaches "this dashboard has no wording for that
       status" to anything grey. On this screen that sentence is false, and the
       31 Aug audit caught the result: a grey PARTIAL pill claiming no wording
       existed, two lines above the sentence that gave it.
     · One exception to that, added 24 Aug 2026: a request/response endpoint the
       dashboard itself calls — whatsapp-send, ask-ai, finance-calc — returns its
       outcome in the HTTP reply and is read by the operator at the moment of the
       call. When such a workflow is registered with writes_audit_log false, the
       missing audit row is the design, not a gap, and this screen says so in a
       neutral voice instead of filing it under "blind spot". It still refuses to
       claim those runs succeeded: no history is kept here, and that is stated.
     · A manual trigger only exists where an n8n webhook in HOOK really exists
       AND can be fired without inventing a subject record. Everything else is a
       disabled button whose title names exactly what is missing. No webhook
       path is guessed, and nothing here writes to a service-role table. */
import { HOOK, canManageAccess, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { dealerText as vocabDealerText } from '../lib/vocabulary.js';
import { N8N_BASE } from '../lib/env.js';
import { ago, clock, esc, n0, num, pct } from '../lib/format.js';
import { maskText } from '../lib/privacy.js';
import {
  OUTCOME, OUTCOME_WORDS, healthWords, isIncomplete, outcomeOf, outcomeWords, successRate,
} from '../lib/health.js';
import { renderIntegrations } from '../lib/integrations.js';
import { readFlag, writeFlag } from '../lib/prefs.js';
import { SCREENS, go } from '../lib/nav.js';
import { closeDrawer, wireRows } from '../lib/ui.js';
/* The Stitch migration (7 Oct 2026, design/stitch/MAP.md: primary
   automation-action-engine-pipeline-drawer--9c8237, also --4539d7). kpi, table,
   panel, pill, openModal, openDrawer and the state panels keep their signatures
   and answer in the Stitch anatomy — lib/ops-kit.js says why the logic was left
   where it was. */
import {
  actor, kpi, modalError, openDrawer, openModal, panel, pill, stateEmpty, stateError, stateLoading, table,
} from '../lib/ops-kit.js';
import { sectionHeader, statusChip, trustFooter } from '../lib/stitch-ui.js';

/* Bounded read. Where the cap is actually hit the screen says so — an activity
   log that looks complete but is a window is the same class of lie this screen
   was rebuilt to stop telling. */
const AUDIT_LIMIT = 500;
/* Same shape of bound on the lead read used only to put a phone number next to a
   customer's name. Where the email is not found the row says so rather than
   showing a blank. */
const LEAD_LIMIT = 2000;

/* The n8n execution URL the Error Handler writes into audit_log.summary.

   Until 5 Sep 2026 this screen parsed it out and rendered it as a working deep
   link into the vendor's n8n, on every failed run — a workflow id, an
   execution id and a host handed to the dealership, all three in
   CONTROL-PLANE.md Part 4's table. The pattern is kept, and it is now used to
   REMOVE that text on the way to the screen rather than to link to it. See
   dealerSummary. Matching the execution-URL shape specifically, rather than
   any URL, is retained for the same reason it was written: it is the precise
   thing being taken out. */
const EXEC_URL_RE = /https?:\/\/[^\s·"'<>]+\/workflow\/[A-Za-z0-9_-]+\/executions\/\d+/g;

const low = s => String(s || '').trim().toLowerCase();
const up  = s => String(s || '').trim().toUpperCase();

/* ── The vendor boundary, and the one thing it must not be allowed to say ──
   5 Sep 2026. `workflow_registry.id`, `.trigger_type` and `.trigger_detail`
   are withheld from `authenticated` by column grant, and `v_workflow_health`
   was rebuilt without them — migration
   20260905194717_workflow_registry_ids_and_crons_off_the_dealer_plane,
   CONTROL-PLANE.md 5.2 and Part 4. Those three are the n8n workflow id, the
   cron expressions and the webhook paths: where the job lives and how it is
   reached. A dealership is entitled to know its automation is broken; the
   address of the job is the vendor's.

   So every read of `w.trigger_detail` on this screen now finds nothing, and
   the only question left is which sentence that produces. Until this change it
   produced “trigger not recorded” on every row and, on the Scheduled jobs
   card, an invitation to go and record a cron expression in
   `workflow_registry.trigger_detail`. Both were false. The cadence IS
   recorded — this login is not allowed to read it — and there is nothing
   here for a dealership to fix. CLAUDE.md: a missing row is not proof the
   event did not happen; unknown is not none. Telling a customer their data is
   absent when it exists and is merely not theirs to see is the same lie in the
   other direction.

   `triggerReadable` is measured per row rather than assumed, so the day a
   tenant-scoped view restores these columns the cadence panel lights up again
   instead of going on saying “not available”. It tests key PRESENCE, not
   truthiness: a row that carries `trigger_type: null` is a registry that
   genuinely recorded nothing, which is a different finding from a column this
   session may not select, and the two must not collapse. */
const triggerReadable = w => w != null && ('trigger_type' in w || 'trigger_detail' in w);

const TRIGGER_NOT_AVAILABLE =
  'NEXUS operates the trigger and the schedule for every workflow here, and this dashboard is not permitted to read either. That is a boundary, not a gap: the cadence is on file, it is simply on the vendor\u2019s side of it. Nothing on this screen is waiting for you to enter one.';

/* audit_log.summary is written by the workflows for whoever is on call, and
   whoever is on call is the vendor. The Error Handler puts the execution's own
   n8n URL, the failing node's name and the execution id into it —

     “… · Failed at node: Model Ladder · Execution 3213 ·
      https://…/workflow/BiyHk9ZXxJUVGbf6/executions/3213”

   — which is a workflow id, an execution id, a node name and a host, all four
   in CONTROL-PLANE.md Part 4's table. The run itself is the dealership's news
   and stays; the location is removed on the way to the screen. Only the
   RENDERED text goes through here. Every classifier below — looksTimedOut,
   looksGuardRejected, missedCustomer, and nexus_outcome_class's own rule 1 in
   lib/health.js — reads the raw column, because redacting the evidence a
   verdict is computed from would change the verdict. */
/* One redactor, held in lib/vocabulary.js — this screen, Compliance and
   Campaigns each carried their own copy until 5 Sep 2026, and all three
   stripped WHERE a run stopped while leaving WHO we buy from standing in the
   sentence: a failing mail credential printed the supplier's name and its API
   host to a dealership that can act on neither. EXEC_URL_RE still runs first;
   the shared function removes any URL, but this screen also classifies on that
   match, so the constant stays. */
const dealerSummary = (text) => vocabDealerText(String(text || '').replace(EXEC_URL_RE, ''));

/* ── Health vocabulary ─────────────────────────────────────────────────────
   The label, the tone and the sentence under it all come from lib/health.js,
   which mirrors nexus_outcome_class() in Postgres. This screen contributes only
   what is its own business: an icon and a sort order. Until 31 Aug 2026 it held
   its own four-state table, so the three states the view gained —
   PRODUCING_NOTHING, UNKNOWN_OUTCOME, NO_QUALIFYING_RUNS — would have arrived
   here as "Unrecognised" while the workflows inside them ran on.

   `rank` orders the list worst-first. NOT_INSTRUMENTED deliberately sorts above
   HEALTHY: an unmeasured workflow is a worse position to be in than a measured
   clean one, even though it cannot be coloured red. PRODUCING_NOTHING sorts
   immediately under DEGRADED, because a workflow that runs cleanly and achieves
   nothing needs a person just as badly as one that is failing — it simply never
   announces itself. */
const HEALTH_ICON = {
  DEGRADED: 'error', PRODUCING_NOTHING: 'do_not_disturb_on', UNKNOWN_OUTCOME: 'help',
  NEVER_RAN: 'schedule', NO_QUALIFYING_RUNS: 'block', NOT_INSTRUMENTED: 'visibility_off',
  HEALTHY: 'check_circle',
};
const HEALTH_RANK = {
  DEGRADED: 0, PRODUCING_NOTHING: 0.5, UNKNOWN_OUTCOME: 1, NEVER_RAN: 2,
  NO_QUALIFYING_RUNS: 2.5, NOT_INSTRUMENTED: 3, HEALTHY: 4,
};
const healthState = k => {
  const w = healthWords(k);
  return {
    label: w.label, tone: w.tone, detail: w.blurb,
    icon: HEALTH_ICON[k] || 'help',
    rank: HEALTH_RANK[k] == null ? 1 : HEALTH_RANK[k],
  };
};
const HEALTH = Object.fromEntries(Object.keys(HEALTH_RANK).map(k => [k, healthState(k)]));
/* The states that mean somebody has to look. Kept as one list because the
   "needs attention" count, the green all-clear banner and the classifications
   below all have to agree about it: a screen that says "nothing is failing" in
   green while a workflow produces nothing at all is the exact failure this
   rebuild removed. */
const NEEDS_ATTENTION = ['DEGRADED', 'PRODUCING_NOTHING', 'UNKNOWN_OUTCOME'];

/* A health value the view returns that lib/health.js has no entry for. Shown
   verbatim beside this sentence rather than folded into a state it might mean. */
const UNKNOWN_HEALTH = {
  ...healthState('UNKNOWN_OUTCOME'),
  detail: 'The automation health figures returned a health state that neither this screen nor NEXUS knows how to describe. It is shown verbatim rather than folded into one of the states it might mean.',
};

/* A pill whose words come from the canonical layer (lib/health.js), carrying
   that layer's own sentence as its hover text.

   This used to re-emit pill()'s markup by hand, for one reason: pill() attached
   "This dashboard has no wording for that status" to anything it rendered in
   the unknown tone, and on these labels that sentence is false — lib/health.js
   has wording for every outcome and every health value, including the neutral
   ones. The 31 Aug audit caught the result: a grey pill claiming no wording
   exists, two lines above the sentence that gives it.

   pill() now takes `{ verbatim: false }` for exactly that, so the markup is the
   shared helper's again and only the difference is left here: pill() can attach
   no title but its own, and these need the canonical blurb. That is carried on
   a wrapper, which is how overview.js, settings.js and ask.js already do it.
   `verbatim: false` is right even where `label` is a health word straight off
   the view: the wrapper is already saying where it came from, in words written
   for this case, and pill()'s generic sentence would only cover that up. */
const wordPill = (label, tone, why) =>
  (why ? `<span title="${esc(why)}">${pill(label, tone, { verbatim: false })}</span>`
       : pill(label, tone, { verbatim: false }));

/* One logged run's outcome, in the canonical layer's words, with the raw status
   the writer actually wrote kept beside it rather than replaced by it. Both
   halves earn their place: the words are what every count on this screen is
   built from, and the raw value is what is really in the column — and for the
   five Finance Calc rows that say FAILED over a quote that reached the customer,
   the two disagree. An operator should be able to see that disagreement. The
   chip is dropped where the status and the class are the same word, because
   printing "SUCCESS" next to "Succeeded" says nothing. */
const outcomePill = a => {
  const words = outcomeWords(outcomeOf(a));
  const raw = up(a.status);
  const same = raw === up(outcomeOf(a));
  return `${wordPill(words.label, words.tone, words.blurb)}${
    raw && !same
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="${esc(`This run was recorded as "${a.status}". NEXUS’s own rule for what a run achieved reads it as ${words.label}, classifying from the summary as well as the status word.`)}">${esc(a.status)}</span>`
      : ''}`;
};

/* ── Endpoints that answer their caller ────────────────────────────────────
   A workflow with no Audit Log node is normally a blind spot: it may be running
   perfectly or failing every time and nothing here can tell. That reading is
   wrong for the handful of webhooks the dashboard itself calls and waits on. A
   request/response endpoint hands its outcome straight back to the caller, and
   the screen that made the call shows it to the operator there and then. For
   those, no audit row is the correct design, not a missing one.

   The entries below are facts about this bundle, not about the database: each
   one is a HOOK path some screen in this build posts to and reads a reply from.
   The classification only ever applies when the registry itself says the
   workflow writes no audit log — this screen never overrides what the database
   reported, it only refuses to call a deliberate choice a fault.

   What it does NOT claim: that those runs succeeded. There is no history for
   them here, and every surface below says so plainly. */
const RESPONDS_TO_CALLER = {
  [HOOK.whatsappSend]: {
    answer: "{ status: 'sent' | 'error' }",
    where: 'Conversations',
    line: 'Replies sent from Conversations post here and wait for the answer, so the operator is told at that moment whether the message actually went out.',
  },
  [HOOK.askAi]: {
    answer: 'the answer and the documents it consulted',
    where: 'Ask AI',
    line: 'Ask AI posts the question and renders whatever comes back, so a failure is visible in the reply rather than after the fact.',
  },
  [HOOK.finance]: {
    answer: 'the calculated quote',
    where: 'Finance Desk',
    line: 'The Finance Desk posts the figures and renders the quote it gets back, so a failure is visible in the reply rather than after the fact.',
  },
};
/* hookFor is declared further down; this is only ever called at render time. */
const respondsToCaller = w =>
  w.writes_audit_log === false && !!RESPONDS_TO_CALLER[hookFor(w)];
const callerInfo = w => RESPONDS_TO_CALLER[hookFor(w)] || null;

/* ── Three of the workflows on this instance are web pages ─────────────────
   `NEXUS Public — Home`, `— Privacy` and `— Terms` are published and active in
   n8n and are not dealership automation at all. Google's OAuth consent screen
   will not publish an app to production without a home page, a privacy policy
   and a terms URL, and it rejects `vercel.app` because that is a public suffix;
   `nip.io` was the only registrable domain available, so n8n itself serves the
   three pages at /webhook/nexus, /webhook/privacy and /webhook/terms. Getting
   that consent screen published is what stopped Gmail's refresh tokens expiring
   every seven days.

   They will never log a run and they never should — a page that nobody opened
   has nothing to report. Counting them as un-instrumented blind spots would put
   three static pages inside a list of automations "nobody can see inside", which
   is the sentence this screen exists to make trustworthy. So they are labelled
   rather than hidden: hiding a live workflow because it is inconvenient is the
   other way to make this list lie. */
const PUBLIC_PAGE_RE = /nexus\s*public/i;
/* The webhook-path arm of this test is gone: `trigger_detail` is control plane
   and no longer reaches this screen (see triggerReadable above). The name test
   is what remains, and it is the half that never depended on the registry's
   address column. */
const isPublicPage = w =>
  PUBLIC_PAGE_RE.test(String(w.name || ''))
  || /^\s*[—-]\s*(?:privacy|terms)\s*$/i.test(String(w.name || ''));

const PUBLIC_PAGE = {
  label: 'Public web page', tone: '', icon: 'public', rank: 4.6,
  detail: 'This is not an automation. It is a published web page NEXUS serves, so it has nothing to run and nothing to report: a page view is not a workflow run. Its silence is correct rather than a blind spot, which is why it is labelled here instead of being counted as one.',
};

const RETURNS_RESULT = {
  label: 'Answers the caller', tone: '', icon: 'sync_alt', rank: 4.5,
  detail: 'This endpoint is called by the dashboard and answers in the reply, so the screen that called it shows the outcome immediately. It is registered as writing no audit row, and for a request/response endpoint that is the right design rather than a gap. The trade-off is real and worth knowing: no run history is kept, so nothing here can tell you how it behaved yesterday.',
};

/* The state a workflow is presented under. Everything except the two
   classifications below is the view's own `health` value, unchanged.

   NEEDS_ATTENTION is checked first and can never be masked by a classification.
   A request/response endpoint or a public page that is actually failing is still
   failing, and the previous version of this line would have quietly relabelled a
   degraded whatsapp-send as "answers the caller" and dropped it out of the
   degraded banner it belongs in. Since 31 Aug that guard covers all three
   attention states rather than DEGRADED alone: an endpoint whose every run
   produces nothing is producing nothing whoever it answers to. */
const STATES = { ...HEALTH, RETURNS_RESULT, PUBLIC_PAGE };
const stateKey = w => {
  const h = up(w.health);
  if (NEEDS_ATTENTION.includes(h)) return h;
  if (isPublicPage(w)) return 'PUBLIC_PAGE';
  if (respondsToCaller(w)) return 'RETURNS_RESULT';
  return h;
};
const healthOf = w => STATES[stateKey(w)] || UNKNOWN_HEALTH;
const healthLabel = w => (STATES[stateKey(w)] ? STATES[stateKey(w)].label : (w.health || 'Unrecognised'));

/* The 30-day rate, and the only definition of one on this screen: successes
   over effective runs, where effective runs leaves out what was refused by
   design and what was handed to a person on purpose. It is computed here from
   the count columns through successRate() rather than read from
   success_rate_30d, so the screen and the view can be compared instead of one
   being taken on trust — the drawer says so where they disagree.

   What this replaced was (runs_30d - failures_30d) / runs_30d, which counted
   every partial, every refusal and every run that produced nothing at all as a
   success, and printed 100.0% over a workflow that had delivered nothing since
   the window opened. */
const rate30 = w => successRate(w.successes_30d, w.effective_runs_30d);
/* All-time has no successes column in the view, so there is nothing here to
   compute from: success_rate is the view's own figure over the same definition
   (successes over effective runs, all-time), and it is reported as the view's
   rather than recomputed. It is null when nothing qualified, like every other
   rate on this screen. */
const rateAll = w => n0(w.success_rate);

/* Failed plus went out half-done. Both are the dealership's problem and both
   make a workflow DEGRADED, so the two are added wherever one number is wanted
   and split wherever there is room to name them. */
const incomplete30 = w => (n0(w.failures_30d) || 0) + (n0(w.partials_30d) || 0);

/* Why there is no rate, in this workflow's own terms. A zero denominator is not
   0% and not 100%, and the three ways of arriving at one are different findings:
   nothing is logged at all, nothing ran, or everything that ran was refused by
   design or escalated and so counted toward nothing. */
const noRateWhy = w => {
  if (!w.writes_audit_log) return 'nothing is logged for it, so there is nothing to rate';
  if (!(n0(w.runs_30d) || 0)) return 'no run was logged inside the window';
  return 'every run in the window was refused by design or handed to a person, so none of them counted toward a rate';
};

/* The window as it actually happened, in the view's own outcome columns. The bar
   this replaced had two segments — ok and failed — so a partial, a refusal and a
   run that produced nothing were all painted in the same green as a delivered
   run. Failures and partials share the hot colour because both are the same
   class of problem; the partial segment is dimmed so the two can still be told
   apart at a glance, and every segment names its own count on hover. */
const MIX = [
  ['successes_30d', 'var(--ok)',      '1',   'succeeded'],
  ['failures_30d',  'var(--hot)',     '1',   'failed'],
  ['partials_30d',  'var(--hot)',     '.55', 'went out half-done'],
  ['no_result_30d', 'var(--unknown)', '1',   'ran and produced nothing usable'],
  ['rejected_30d',  'var(--cold)',    '1',   'were refused by design, and are left out of the rate'],
  ['escalated_30d', 'var(--warm)',    '1',   'were handed to a person on purpose, and are left out of the rate'],
  ['unknown_30d',   'var(--unknown)', '.5',  'logged a status this system does not define'],
];
const runBar = w => {
  const total = MIX.reduce((a, [k]) => a + (n0(w[k]) || 0), 0);
  if (!total) return '';
  return `<div class="flex h-2.5 rounded-full overflow-hidden bg-surface-container" style="height:6px;max-width:220px;margin-top:8px">
    ${MIX.map(([k, colour, alpha, why]) => {
      const c = n0(w[k]) || 0;
      return c
        ? `<i style="width:${(c / total * 100).toFixed(1)}%;background:${colour};opacity:${alpha}" title="${esc(`${c} of ${total} logged runs ${why}`)}"></i>`
        : '';
    }).join('')}
  </div>`;
};

/* ── Manual triggers ───────────────────────────────────────────────────────
   HOOK is the complete list of webhooks this bundle knows about. A workflow
   earns a live "Run now" only when its registry trigger_detail names one of
   those paths AND the workflow can be started without a subject record. Every
   other button is rendered and disabled with the specific reason, because
   "there is no button" and "the button is not built yet" read very differently
   to whoever is standing in front of a broken workflow. */
const HOOK_PATHS = Object.values(HOOK).slice().sort((a, b) => b.length - a.length);
/* This mapping was `trigger_detail` contains a HOOK path. That column is now
   control plane (see triggerReadable), so on a dealership login there is
   nothing left to match on and this returns null for every workflow — which
   is why every manual trigger below is disabled and says why. Guessing the
   endpoint from a workflow's NAME was considered and refused: a name is not an
   address, and a wrong guess posts a real payload at a real webhook. */
const hookFor = w => {
  if (!triggerReadable(w)) return null;
  const d = low(w.trigger_detail);
  if (!d) return null;
  return HOOK_PATHS.find(p => d.includes(p)) || null;
};

/* The one webhook that means something with no subject attached: an ERP sync is
   a batch job over whatever Odoo and Supabase currently hold. */
const NO_SUBJECT_HOOKS = { [HOOK.erpSync]: 'Sync now' };

/* Hooks that exist, are reachable, and still must never be fired from here.
   whatsapp-send puts a message on the owner's real WhatsApp number: it needs a
   chat_id and the text, and with neither attached it would either send nothing
   or send something nobody wrote. The composer that owns both lives on
   Conversations, so that is where the button belongs. */
const NO_MANUAL_RUN = {
  [HOOK.whatsappSend]:
    'This screen deliberately offers no manual run for whatsapp-send. It sends a WhatsApp message to a real person and needs a WhatsApp address and the message text; firing it with an empty body would accomplish nothing. It is driven from the Conversations screen, which holds the thread, supplies both fields and shows whether the message left.',
};

const NEEDS_SUBJECT = {
  [HOOK.askAi]:      'a question to answer. Ask AI is the screen that supplies one.',
  [HOOK.finance]:    'a vehicle value, a payoff amount and a credit score. The Finance Desk screen supplies them.',
  [HOOK.warmDrip]:   'a specific lead to enrol. Campaigns and Leads both start it against a chosen customer.',
  [HOOK.closedWon]:  'a specific closed deal. The Deals screen records one.',
  [HOOK.kyc]:        'a specific uploaded document to audit. Compliance holds the register it reads from.',
  [HOOK.escalation]: 'a specific lead to escalate. The Leads screen picks one.',
};
const SUBJECT_SCREEN = {
  [HOOK.askAi]:      { id: 'ask',        title: 'Ask AI' },
  [HOOK.finance]:    { id: 'finance',    title: 'Finance Desk' },
  [HOOK.warmDrip]:   { id: 'campaigns',  title: 'Campaigns' },
  [HOOK.closedWon]:  { id: 'deals',      title: 'Deals' },
  [HOOK.kyc]:        { id: 'compliance', title: 'Compliance' },
  [HOOK.escalation]: { id: 'leads',      title: 'Leads' },
  [HOOK.whatsappSend]: { id: 'conversations', title: 'Conversations' },
};

/* The variable's NAME is deployment configuration and belongs to whoever
   deploys this bundle, not to the dealership reading the tooltip. The fact
   that manual runs are unavailable, and that it is a NEXUS-side setting rather
   than anything the dealership can do, is the whole of what is theirs. */
const NO_N8N_BASE =
  'Manual runs are not available in this deployment: it is not configured to call the automation host. That is a NEXUS-side setting — there is nothing to change from here.';

function triggerState(w) {
  /* A page has no run to trigger. Saying so is shorter and truer than the
     generic "no webhook in HOOK maps to it", which invites someone to go looking
     for a webhook that would be meaningless if it existed. */
  if (isPublicPage(w)) {
    return { hook: null, can: false, label: 'Run now',
      why: 'This is a published web page, not an automation. Opening it is the only thing that "runs" it, and there is nothing here to fire — the dashboard has no reason to request a page it does not display.' };
  }
  const hook = hookFor(w);
  if (!hook) {
    /* This used to read “Its trigger is not recorded in workflow_registry”
       whenever trigger_type was empty. Since 5 Sep that column is never
       readable from a dealership session, so the sentence fired on every
       workflow and told the dealership a record was missing that in fact
       exists. See TRIGGER_NOT_AVAILABLE. */
    const how = triggerReadable(w) && !w.trigger_type
      ? 'Its trigger is not recorded in the automation register'
      : 'Which endpoint starts it is configuration NEXUS operates and this dashboard cannot read';
    return { hook: null, can: false, label: 'Run now',
      why: `No manual trigger exists for this workflow. ${how}, so there is no address here to call and inventing one would post into the void. NEXUS support can start it by hand if you need it run.` };
  }
  if (!N8N_BASE) return { hook, can: false, label: 'Run now', why: NO_N8N_BASE };
  if (NO_MANUAL_RUN[hook]) return { hook, can: false, label: 'Run now', why: NO_MANUAL_RUN[hook] };
  if (NO_SUBJECT_HOOKS[hook]) return { hook, can: true, label: NO_SUBJECT_HOOKS[hook], why: '' };
  return { hook, can: false, label: 'Run now',
    why: `The ${hook} webhook exists, but it needs ${NEEDS_SUBJECT[hook] || 'a subject record this screen does not have'} Firing it from here with nothing attached would either fail or act on the wrong record.` };
}

/* ── The five-minute execution ceiling ─────────────────────────────────────
   Set on the n8n side on 24 Aug 2026: every workflow on the instance carries
   `executionTimeout: 300`. It was added because two WhatsApp BDC executions ran
   for 1.1 hours each and dragged the whole instance's API latency from 0.34 s to
   7.8 s — a run that hangs is not a private problem, it taxes every other
   workflow on the box.

   Two things follow that this screen has to say out loud, because neither is
   visible in the data:

     · A run the ceiling stops arrives here as a FAILURE. n8n keeps it with
       `saveDataErrorExecution: 'all'`, so the row and its input survive. That is
       the ceiling working, not the workflow being broken, and the two must not
       be read as the same finding.
     · The ceiling is n8n configuration. `v_workflow_health` has no timeout
       column, so this screen cannot verify the setting per workflow — it states
       the policy it was built against and says that it is stating it. */
const CEILING_SECONDS = 300;
const CEILING = {
  chip: '5-min ceiling',
  why: `Every workflow on this instance carries executionTimeout: ${CEILING_SECONDS} — a hard five-minute wall-clock ceiling, set on 24 Aug 2026 after two WhatsApp BDC executions ran for 1.1 hours each and took the instance's API latency from 0.34 s to 7.8 s.`,
  onTimeout: 'A run the ceiling stops is not lost. It is kept with its input intact and lands in the failure counts here. Read it as the ceiling doing its job — the run was cut off at five minutes — rather than as the workflow itself failing. What made that run slow is something NEXUS can look at; it is not visible from here.',
  provenance: 'The ceiling is NEXUS deployment configuration and this dashboard cannot read each workflow’s real setting back, so this screen states the policy the build was written against. If NEXUS changes it, that change will not show up here.',
};

/* The single deliberate exception, and the reason it is on screen rather than
   buried in a config file: the next person to add a Wait node needs to know that
   the ceiling exists and that an exemption is a decision somebody has to make. */
const CEILING_EXEMPT = [
  {
    test: w => /warm\s*lead\s*drip/.test(low(w.name)),
    chip: 'No ceiling — Wait nodes',
    why: 'This is the one workflow deliberately exempt from the five-minute ceiling. It holds Wait nodes at Day 1, Day 3, Day 5 and Day 7, so one execution is meant to stay open for a week; a wall-clock timeout would cut it off partway and the customer would receive half a campaign. Any new workflow with a Wait node needs the same exemption made explicitly, or its run will be stopped at five minutes.',
  },
];
const exemptFrom = w => CEILING_EXEMPT.find(e => e.test(w)) || null;

/* ── The scraper's own guard ───────────────────────────────────────────────
   Since 24 Aug an IF node — `Is This Real Intel?` — sits between the scraper's
   `Parse AI Price` node and the `competitors` insert, because the scrape had
   been storing bot-detection pages ("Pardon Our Interruption") and the literal
   string "null" as rival dealerships, and every "undercut" alert built on those
   rows was fabricated. A scrape that fails that gate is written to audit_log as
   REJECTED instead of being inserted.

   So a REJECTED row from that workflow is the guard doing its job — the run
   completed and refused to write rubbish. It is matched on the workflow name and
   the run's outcome class, because audit_log has no reason column, and it is
   worded as a reading of those two fields rather than as something the database
   asserted.

   The outcome it matches on is NO_RESULT, not REJECTED. nexus_outcome_class
   splits a REJECTED row two ways — refused by design where the summary says the
   caller was unauthorised, otherwise "ran and produced nothing usable" — and all
   84 of the scraper's refusals land in the second half. That is the right half:
   the gate working and the dealership having competitor pricing are two
   different things, and it is these runs that put this workflow in
   PRODUCING_NOTHING. So the label below explains them without excusing them. */
const SCRAPE_GUARD_RE = /competitor|scrap/i;
const looksGuardRejected = a =>
  outcomeOf(a) === OUTCOME.NO_RESULT && SCRAPE_GUARD_RE.test(String(a.workflow || ''));
const GUARD_NOTE = 'Read as the Is This Real Intel? gate refusing a scrape rather than the workflow breaking: since 24 Aug the scraper checks what Parse AI Price produced before inserting it, and writes a REJECTED audit row instead of storing a bot-detection page or the string \u201cnull\u201d as a rival dealership. The run completed. It is still a run that produced no price and is counted as one \u2014 the gate working correctly and the dealership having competitor intel are two different findings. The activity log has no reason column, so this is read off the workflow name and the run\u2019s outcome class \u2014 the summary above is the thing that says what was refused.';

/* A run whose summary reads like the ceiling stopping it. Matched on the summary
   text because audit_log has no separate reason column — so this is worded as a
   reading of the text, never as a fact the database asserted. Gated to the two
   outcomes a ceiling stop can arrive as: n8n aborts the execution, so it lands
   either as a failure or as a run that finished holding nothing. A run that
   succeeded and merely mentions a timeout in its summary is not one. */
const TIMEOUT_RE = /\btimed?\s*-?\s*out\b|\btimeout\b|execution time(?: limit)? exceeded|exceeded the (?:maximum )?execution|max(?:imum)? execution time|ETIMEDOUT/i;
const looksTimedOut = a =>
  [OUTCOME.FAILURE, OUTCOME.NO_RESULT].includes(outcomeOf(a))
  && TIMEOUT_RE.test(String(a.summary || ''));

/* ── PARTIAL is not a success ──────────────────────────────────────────────
   PARTIAL has one meaning throughout this system: the run finished, but a step
   it was about to claim did not land — and in these workflows that step is
   almost always the message to the customer. The BDC agent writes PARTIAL when
   `Send Reply via WAHA HTTP API` swallowed an error; the KYC auditor writes it
   when the re-upload request never reached the customer's phone.

   Until 30 Aug 2026 this screen did not know the word at all: PARTIAL fell
   through to "Other", was left out of the failure count, and its timeline dot
   took a bare `: 'ok'` branch and was painted the same green as a clean run.

   What changed on 31 Aug is where the word is understood. This screen used to
   read `audit_log.status` itself, including hand-splitting the compound
   `'ESCALATED_' + delivery.status` vocabulary the KYC escalation logger can
   write. It no longer does either. A second reading of that column is a second
   definition of it, and two definitions is how this screen went wrong the first
   time: `outcomeOf` is now the only thing here that looks at a status, it is a
   mirror of the Postgres function the view counts with, and so a number in the
   KPI strip and the colour of a dot in the drawer cannot drift apart.

   Two consequences, stated rather than smoothed over:

     · The writers mislabel their own rows, and the canonical layer corrects them
       from the structured phrase rather than from the status word. Five Finance
       Calc rows say FAILED and read "Quote issued | 1 of 1 claimed steps did not
       land [finance_quotes row …]" — a customer holding a quote that nobody
       recorded — and they class as PARTIAL. That correction is made once, in
       nexus_outcome_class and its mirror. Nothing in this file re-makes it.
     · nexus_outcome_class has no case for ESCALATED_PARTIAL or ESCALATED_FAILED,
       so either would class as UNKNOWN and render here as "Unrecognised" rather
       than as a missed delivery. No row carries one today: counted against the
       live table on 1 Sep 2026 the entire status vocabulary in audit_log is
       SUCCESS, FAILED, PARTIAL, REJECTED, NOT_EXECUTED and ESCALATED. If a
       compound value does appear, the fix is a case in the SQL function and its
       mirror — not a private split re-grown here. */
const missedCustomer = a => outcomeOf(a) === OUTCOME.PARTIAL;
const PARTIAL_NOTE = 'A run is recorded as partly landed when it completed but a step it was about to claim did not land — in these workflows that is normally the WhatsApp message to the customer. It is not a success: somebody was waiting for a reply and did not get one. Some runs are labelled a failure instead, and are re-read as partly landed from the “did not land” phrase in their own summary, because the label was wrong; that correction is made once, by NEXUS’s own rule for what a run achieved, which is what every count on this screen is built from. Which step it was is not recorded separately, so it is only in the summary text.';

/* The colour of one run's dot in the history timeline, taken from the same table
   that words its pill so that the two can never say different things about the
   same row. The version this replaced ended in a bare `: 'ok'`, which is how
   PARTIAL came to be painted as a clean run; there is no default branch here
   that can paint an unrecognised status green, because outcomeWords() falls back
   to UNKNOWN and UNKNOWN is grey. */
const runDot = a => outcomeWords(outcomeOf(a)).tone || 'unknown';

/* ── Schedule cadence: has a scheduled job silently stopped? ────────────────
   `v_workflow_health.health` cannot answer this, and the 31 Aug rebuild did not
   change that — it is a gap in the evidence, not in the arithmetic. A workflow
   that stops firing logs no runs and therefore logs nothing bad, so it keeps
   whatever health its last few in-window runs earned it: HEALTHY for as long as
   any of them survive the 30-day window, then NO_QUALIFYING_RUNS, which is grey
   and says "there is nothing to rate" rather than "this job has stopped". At no
   point does it turn red. That is exactly what Competitor Price Scraping did:
   its n8n trigger was an "every 24 hours" *interval*, which counts from the last
   activation rather than from the clock, so every VM restart silently moved its
   fire time and after the 19 Aug outage it stopped landing altogether — one run
   in 36 hours, and nothing on this screen went red. It is now on a cron.

   So the check here is the one `scripts/nexus_healthcheck.py` section 7 makes
   server-side: judge each scheduled job against its OWN cadence rather than
   against "did anything run recently". The grace period matches that script —
   an hourly job is late after 2 h, a daily job after 26 h.

   The one honest difference, stated wherever this is rendered: the script reads
   n8n executions, this screen only has `last_run`, which comes from audit_log
   and records runs that COMPLETED AND WROTE A ROW. For a workflow that writes a
   row only when it finds something — the Silence Detector writes when somebody
   is actually silent — a quiet week looks the same as a stopped schedule. So
   "overdue" here means "worth confirming in n8n", not "proven dead". It is still
   the only warning this dashboard can give for a failure mode nothing else on
   the screen can see. */
const HOUR_MS = 3600000;

/* Number of values a single cron field fires on. Returns null when the field is
   not something this parser understands, and an unparsed field means no cadence
   claim is made at all — a wrong cadence would produce a false "overdue". */
function cronFieldCount(f, span) {
  if (f === '*') return span;
  let total = 0;
  for (const part of String(f).split(',')) {
    const [rangeRaw, stepRaw] = part.split('/');
    const step = stepRaw == null ? 1 : Number(stepRaw);
    if (!Number.isFinite(step) || step <= 0) return null;
    let lo, hi;
    if (rangeRaw === '*' || rangeRaw === '') { lo = 0; hi = span - 1; }
    else if (rangeRaw.includes('-')) {
      const [a, b] = rangeRaw.split('-').map(Number); lo = a; hi = b;
    } else {
      const a = Number(rangeRaw); lo = a; hi = stepRaw == null ? a : span - 1;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) return null;
    hi = Math.min(hi, span - 1);
    total += Math.floor((hi - lo) / step) + 1;
  }
  return total > 0 ? total : null;
}

/* Five- or six-field cron, found inside whatever prose trigger_detail holds. */
const CRON_RE = /(?:^|[\s:=("'])((?:[\d*/,-]+\s+){4,5}[\d*/,-]+)(?=$|[\s)"'.,])/;

function cronHours(expr) {
  let f = String(expr).trim().split(/\s+/);
  if (f.length === 6) f = f.slice(1);          // leading seconds field
  if (f.length !== 5) return null;
  const [m, h, dom, , dow] = f;
  const perDay = (cronFieldCount(m, 60) || 0) * (cronFieldCount(h, 24) || 0);
  if (!perDay) return null;
  let dayFactor = 1;
  if (dow !== '*') { const d = cronFieldCount(dow, 7); if (!d) return null; dayFactor = 7 / d; }
  else if (dom !== '*') { const d = cronFieldCount(dom, 31); if (!d) return null; dayFactor = 30 / d; }
  return (24 / perDay) * dayFactor;
}

const PHRASES = [
  [/every\s+(\d+)\s*h(?:ou)?rs?\b/i,   m => Number(m[1])],
  [/every\s+(\d+)\s*min(?:ute)?s?\b/i, m => Number(m[1]) / 60],
  [/every\s+(\d+)\s*days?\b/i,         m => Number(m[1]) * 24],
  [/\b(?:hourly|every hour)\b/i,       () => 1],
  [/\b(?:daily|nightly|every night|every day|once a day)\b/i, () => 24],
  [/\b(?:weekly|every week)\b/i,       () => 168],
];

const SCHEDULEY = /schedul|cron|timer|interval|hourly|daily|nightly|weekly|every\s/i;

/* Grace on top of the cadence, matching nexus_healthcheck.py section 7:
   hourly → late at 2 h, daily → late at 26 h. */
const allowanceFor = hours => hours + (hours <= 1 ? 1 : 2);

const fmtHours = h =>
  h == null ? '—'
    : h < 1 ? `${Math.round(h * 60)} min`
    : h < 48 ? `${Number.isInteger(h) ? h : h.toFixed(1)} h`
    : `${(h / 24).toFixed(h % 24 ? 1 : 0)} days`;

function cadenceOf(w) {
  /* A webhook-triggered workflow has no cadence to miss: it runs when something
     calls it, and silence means nobody called, not that a schedule broke. */
  if (hookFor(w)) return null;
  const detail = String(w.trigger_detail || '');
  const text = `${w.trigger_type || ''} ${detail}`;
  if (!SCHEDULEY.test(text)) return null;

  const cron = (detail.match(CRON_RE) || text.match(CRON_RE) || [])[1];
  if (cron) {
    const hours = cronHours(cron);
    if (hours) return { hours, allowance: allowanceFor(hours), kind: 'cron', expr: cron.trim(), drifts: false };
  }
  for (const [re, calc] of PHRASES) {
    const m = text.match(re);
    if (!m) continue;
    const hours = calc(m);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    /* "every N hours" with no clock time in it is how an n8n *interval* is
       described, and an interval counts from the last activation, so a restart
       moves it. That is the fault Competitor Price Scraping had. */
    const interval = /interval/i.test(text) || /every\s+\d+\s*(?:h|m|d)/i.test(text);
    return {
      hours, allowance: allowanceFor(hours),
      kind: interval ? 'interval' : 'phrase', expr: m[0].trim(), drifts: interval,
    };
  }
  return null;
}

/* ── A changed schedule has restarted its clock ────────────────────────────
   A workflow edited more recently than its last run has not "missed" a run: the
   next fire is measured from the change, not from the last thing it logged.
   `scripts/nexus_healthcheck.py` section 7 makes exactly this allowance and says
   why — a watchdog that cries about a schedule somebody just fixed is a watchdog
   people learn to ignore, and then it cannot tell them about the real thing.

   That script reads n8n's `updatedAt`. Nothing this dashboard can read carries
   it: `v_workflow_health` has no such column and neither does
   `workflow_registry`, and the n8n Admin API is not callable from the browser
   bundle. So the allowance is made from a table of the changes this build was
   told about, each with its timestamp, and every cadence verdict carries
   EDIT_BLIND saying that the general case cannot be seen from here.

   An entry costs nothing once the job has run under its new setting: the branch
   only fires while `last_run` is still older than the change. */
const SCHEDULE_CHANGED = [
  {
    test: w => /competitor\s*price\s*scraping/.test(low(w.name)),
    at: '2026-08-24T17:05:00Z',
    what: 'moved off a rolling \u201cevery 24 hours\u201d timer onto a fixed daily time \u2014 05:00 UTC',
  },
];
const scheduleChange = w => SCHEDULE_CHANGED.find(c => c.test(w)) || null;

const SCHED = {
  OVERDUE:     { tone: 'hot',  icon: 'alarm', label: 'Overdue' },
  NO_RUN:      { tone: 'warm', icon: 'alarm', label: 'Never logged a run' },
  CLOCK_RESET: { tone: '',     icon: 'restart_alt', label: 'Clock restarted' },
  ON_TIME:     { tone: 'ok',   icon: 'schedule', label: 'On cadence' },
  UNCHECKABLE: { tone: '',     icon: 'visibility_off', label: 'Cannot be checked' },
};

/* The verdict for one scheduled workflow. Deliberately conservative: anything it
   cannot stand behind comes back UNCHECKABLE with the reason, not as a pass. */
function scheduleOf(w) {
  const c = cadenceOf(w);
  if (!c) return null;
  if (!w.writes_audit_log) {
    return { c, state: 'UNCHECKABLE', ageH: null,
      why: `This job is on a ${fmtHours(c.hours)} cadence but writes nothing to the activity log, so there is no last run to measure and this screen cannot tell whether it is still firing. Only NEXUS can answer it, from the automation host itself.` };
  }
  const t = w.last_run ? Date.parse(w.last_run) : NaN;
  if (Number.isNaN(t)) {
    return { c, state: 'NO_RUN', ageH: null,
      why: `Nothing has ever been logged for this job, so a ${fmtHours(c.hours)} schedule has produced no evidence of firing at all. A schedule that never fires raises no failures, which is why nothing else on this screen calls it unhealthy.` };
  }
  const ageH = (Date.now() - t) / HOUR_MS;
  if (ageH > c.allowance) {
    /* Before calling it overdue: was the schedule itself changed since that last
       run? If so the clock restarted and the job is waiting, not stopped. */
    const chg = scheduleChange(w);
    const chgH = chg ? (Date.now() - Date.parse(chg.at)) / HOUR_MS : null;
    if (chgH != null && Number.isFinite(chgH) && chgH >= 0 && chgH < ageH) {
      if (chgH <= c.allowance) {
        return { c, ageH, changedH: chgH, state: 'CLOCK_RESET',
          why: `Last logged run ${fmtHours(ageH)} ago, which is past the ${fmtHours(c.allowance)} a ${fmtHours(c.hours)} cadence allows — but its schedule was changed ${fmtHours(chgH)} ago (${chg.what}), and a changed schedule restarts the clock. Nothing has been missed: the first run under the new setting is due within ${fmtHours(c.allowance)} of that change, and the gap before it is the old schedule's, not evidence about the new one.` };
      }
      return { c, ageH, changedH: chgH, state: 'OVERDUE',
        why: `Last logged run ${fmtHours(ageH)} ago. Its schedule was changed ${fmtHours(chgH)} ago (${chg.what}), which restarted the clock — but measured from the change it should still have logged a run within ${fmtHours(c.allowance)}, so it has missed one under the new setting too. That is the case worth reporting to NEXUS.` };
    }
    return { c, ageH, state: 'OVERDUE',
      why: `Last logged run ${fmtHours(ageH)} ago. On a ${fmtHours(c.hours)} cadence it should have logged one within ${fmtHours(c.allowance)}, so it has missed at least one. A stopped schedule produces no failures and no degraded health — this gap is the only signal it gives.` };
  }
  return { c, ageH, state: 'ON_TIME',
    why: `Last logged run ${fmtHours(ageH)} ago, inside the ${fmtHours(c.allowance)} this ${fmtHours(c.hours)} cadence allows.` };
}
const OVERDUE_STATES = ['OVERDUE', 'NO_RUN'];

/* Said wherever a cadence verdict is shown, because the evidence is indirect. */
const EDIT_BLIND = 'One thing this check cannot see: when a workflow was last edited. A schedule changed since its last run has had its clock restarted and has missed nothing, but nothing this dashboard can read records when a workflow was changed. The only change this build knows about is the Competitor Price Scraping schedule on 24 Aug, which it allows for by name. So treat an \u201cOverdue\u201d as \u201cworth asking NEXUS about\u201d rather than as proof a job has stopped.';

const CADENCE_CAVEAT = 'The last run shown is the last run that completed and wrote a record — not every fire of the trigger. A job that only writes a record when it finds something (the Silence Detector writes when somebody is actually silent) looks overdue on a quiet week. Treat this as "worth confirming", not as proof. NEXUS checks the same thing against the automation host itself, which is the stronger source.';

SCREENS.automation = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js and screens/setup.js. */
  /* Since 7 Oct 2026 the wrapper is the Stitch root (`nx-stitch` turns on the
     scoped reset). It is still a wrapper this screen appends, for the reason
     above. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);

  /* BUSINESS VIEW / TECHNICAL VIEW — automation-action-engine-pipeline-drawer
     --9c8237. The business view is the default and is what every role sees:
     the figures, one card per automation in plain words, the schedule check,
     the activity log and the writers nobody registered. The technical view adds
     the health-by-category register and the connectivity checks, and is offered
     to owners and admins only. Nothing is removed from a role that had it: every
     workflow's full record opens from its card in either view. The choice is a
     per-browser convenience, so it is remembered through lib/prefs.js (the one
     module that touches localStorage), and a failure to read or write it
     changes nothing but the default. */
  const canTech = canManageAccess();
  let view = 'business';
  if (canTech && readFlag('nexus.automation.technical', false)) view = 'technical';
  const SEGB = { off: 'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md font-body-sm text-body-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors disabled:text-outline disabled:cursor-not-allowed',
                 on:  'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md font-body-sm text-body-sm font-semibold bg-surface-container-lowest text-on-surface shadow-sm' };
  const head = el('div');
  root.appendChild(head);
  const paintHead = () => {
    head.innerHTML = sectionHeader({
      eyebrow: 'Settings / Automation',
      title: 'Automation — action engine',
      sub: 'What each automation is meant to do, whether it did it, and the record behind every run. Nothing on this '
         + 'screen starts, stops or retries a workflow.',
      actionsHtml: `<div class="inline-flex gap-0.5 p-0.5 rounded-lg bg-surface-container" role="group" aria-label="View">
          <button type="button" data-view="business" class="${view === 'business' ? SEGB.on : SEGB.off}" aria-pressed="${view === 'business'}"><span class="material-symbols-outlined text-[18px]">view_quilt</span>Business view</button>
          <button type="button" data-view="technical" class="${view === 'technical' ? SEGB.on : SEGB.off}" aria-pressed="${view === 'technical'}"${canTech ? '' : ' disabled title="The technical view is for owners and admins at this dealership."'}><span class="material-symbols-outlined text-[18px]">terminal</span>Technical view${canTech ? '' : ' (admins only)'}</button>
        </div>`,
    });
    head.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      view = b.dataset.view;
      writeFlag('nexus.automation.technical', view === 'technical');
      paintHead(); applyView();
    }));
  };

  const strip = el('div', 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-space-md'); strip.innerHTML = stateLoading(2); root.appendChild(strip);
  const banners = el('div', 'flex flex-col gap-space-sm empty:hidden'); root.appendChild(banners);
  const bizCard = el('section', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); root.appendChild(bizCard);
  bizCard.innerHTML = stateLoading(4);
  const healthCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); root.appendChild(healthCard);
  healthCard.innerHTML = stateLoading(6);
  const schedCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); root.appendChild(schedCard);
  schedCard.innerHTML = stateLoading(3);
  const logCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); root.appendChild(logCard);
  logCard.innerHTML = stateLoading(5);
  const intg = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md'); root.appendChild(intg);
  /* The technical-only regions. `hidden` is the Tailwind utility; the element
     keeps its content so switching back is instant and nothing is re-read. */
  const applyView = () => {
    [healthCard, intg].forEach(n => n.classList.toggle('hidden', view !== 'technical'));
  };
  paintHead(); applyView();

  /* allSettled, not a shared catch: "the health view is down" and "the audit log
     is down" are different sentences and each panel is entitled to the right
     one. Swallowing either into an empty array would render a green screen over
     a dead system, which is the exact failure this screen exists to prevent. */
  const [healthR, auditR, regR, leadR] = await Promise.allSettled([
    db('v_workflow_health?select=*'),
    db(`audit_log?select=workflow,status,lead_name,lead_email,lead_score,intent,summary,logged_at&order=logged_at.desc&limit=${AUDIT_LIMIT}`),
    /* rpc/nexus_workflow_catalogue, not the workflow_registry table. 6 Sep 2026:
       the register is a vendor table and `authenticated` now holds no privilege
       on it at all — reading it returns 42501, not 0 rows. The accessor is the
       vendor-owned door and returns only the dealer-safe naming projection
       (name, audit_name, audit_aliases, category, description, is_active,
       writes_audit_log); it can never return the n8n id, the trigger kind or the
       cron. It returns nothing at all to a session that belongs to no
       dealership, so an empty result here is "not yours to see", which the
       existing registry-unavailable wording already covers. */
    db('rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases'),
    /* audit_log holds a customer's name and email but no phone. `leads.phone`
       is where the number lives, so it is joined here on email — a person shown
       with no way to reach them is half a record. There is deliberately no staff
       phone anywhere on this screen: `users` has no phone column, so a number
       for whoever owns a workflow is not recorded anywhere the dashboard reads. */
    db(`leads?select=name,email,phone&limit=${LEAD_LIMIT}`),
  ]);

  const health = healthR.status === 'fulfilled' ? healthR.value : null;
  const healthErr = healthR.status === 'rejected' ? (healthR.reason?.message || 'Unknown error') : null;
  const audit = auditR.status === 'fulfilled' ? auditR.value : null;
  const auditErr = auditR.status === 'rejected' ? (auditR.reason?.message || 'Unknown error') : null;
  const registry = regR.status === 'fulfilled' ? regR.value : null;

  const leadsOk = leadR.status === 'fulfilled';
  const phoneByEmail = new Map();
  if (leadsOk) {
    (leadR.value || []).forEach(l => { if (l && l.email) phoneByEmail.set(low(l.email), l.phone || null); });
  }
  /* Four distinct answers, never collapsed into one dash: we have a number, the
     lead exists and carries none, no lead matches this email at all, or the lead
     table could not be read. */
  const phoneLine = email => {
    if (!email) return '<span class="text-outline">no email on the run, so no number to look up</span>';
    if (!leadsOk) return '<span class="text-outline">leads could not be read, so no phone</span>';
    if (!phoneByEmail.has(low(email))) return '<span class="text-outline">no lead record for this email, so no phone</span>';
    const p = phoneByEmail.get(low(email));
    return p ? `<span class="font-label-numeric-sm">${esc(p)}</span>` : '<span class="text-outline">no phone on the lead record</span>';
  };

  /* The registry is what ties an n8n workflow to the string it writes into
     audit_log. Without it the drawer falls back to matching on the display
     name, which is a weaker join, so the difference is stated rather than
     hidden behind a suspiciously short history. */
  /* Keyed on `name`, not on the n8n workflow id: `workflow_registry.id` and
     `trigger_detail` are control-plane columns and `authenticated` no longer
     holds SELECT on either (CONTROL-PLANE.md 5.2), so neither side of this join
     carries an id any more. `name` is the registry's other unique key — 18 rows,
     18 distinct names, measured — and v_workflow_health.name IS r.name, so the
     join is exact rather than a loosening. */
  const regByName = new Map((registry || []).map(r => [low(r.name), r]));
  const namesFor = w => {
    const r = regByName.get(low(w.name));
    const s = new Set();
    [w.name, r?.name, r?.audit_name, ...(Array.isArray(r?.audit_aliases) ? r.audit_aliases : [])]
      .filter(Boolean).forEach(n => s.add(low(n)));
    return s;
  };
  const auditFor = w => {
    const names = namesFor(w);
    return (audit || []).filter(a => names.has(low(a.workflow)));
  };

  /* Worst first. The tie-break after the rate is the count of runs that failed
     or went out half-done, not failures alone — sorting on failures would have
     put Competitor Price Scraping, which has never failed once and has produced
     nothing 84 times, at the bottom of its own category. A workflow with no rate
     sorts after every workflow that has one (101 is deliberately off the scale):
     "we cannot say" is not a good score and it is not a bad one either. */
  const rows = (health || []).slice().sort((a, b) =>
    (healthOf(a).rank - healthOf(b).rank)
    || ((rate30(a) ?? 101) - (rate30(b) ?? 101))
    || (incomplete30(b) - incomplete30(a))
    || String(a.name || '').localeCompare(String(b.name || '')));

  const degraded = rows.filter(w => stateKey(w) === 'DEGRADED');
  /* Everything a person has to look at, in one list, because three different
     things below have to agree about what that means: the KPI, the banner, and
     the green all-clear that must never appear while one of these is non-empty.
     DEGRADED is failing or half-delivering; PRODUCING_NOTHING runs cleanly and
     achieves nothing; UNKNOWN_OUTCOME logged a word this system cannot read. All
     three need a human and none of them is a success. */
  const attention = rows.filter(w => NEEDS_ATTENTION.includes(stateKey(w)));
  const producingNothing = rows.filter(w => stateKey(w) === 'PRODUCING_NOTHING');
  const unknownOutcome = rows.filter(w => stateKey(w) === 'UNKNOWN_OUTCOME');
  /* Not attention states: these are the absences. A workflow every one of whose
     runs was refused by design has no rate, which is a different sentence from a
     bad one, and it is not evidence of anything being wrong. */
  const noQualifying = rows.filter(w => stateKey(w) === 'NO_QUALIFYING_RUNS');
  /* Split deliberately: a workflow that answers its caller is not part of the
     blind-spot count and must not inflate it. */
  const blind = rows.filter(w => stateKey(w) === 'NOT_INSTRUMENTED');
  const byDesign = rows.filter(w => stateKey(w) === 'RETURNS_RESULT');
  /* Web pages n8n happens to serve. Split out of `blind` for the same reason
     `byDesign` is: they are not automations and they are not unmonitored — there
     is nothing about them to monitor. */
  const pages = rows.filter(w => stateKey(w) === 'PUBLIC_PAGE');
  const auditCapped = (audit || []).length >= AUDIT_LIMIT;

  /* Is the cadence knowable on this login at all? Measured off the rows the
     view actually returned rather than assumed from the migration, so this
     answers itself again if a tenant-scoped trigger column is ever restored.
     `rows.length && !rows.some(...)` matters: an empty result set is a health
     view with nothing in it, which is a different finding from a column that
     was withheld, and it must not be reported as the vendor boundary. */
  const triggerVisible = rows.length > 0 && rows.some(triggerReadable);

  /* Cadence verdicts, computed once. `sched` is null for anything without a
     recognisable schedule, and the scheduled set is ordered worst-first. */
  const schedOf = new Map(rows.map(w => [w, scheduleOf(w)]));
  const scheduled = rows.filter(w => schedOf.get(w));
  const schedRank = { OVERDUE: 0, NO_RUN: 1, CLOCK_RESET: 2, UNCHECKABLE: 3, ON_TIME: 4 };
  scheduled.sort((a, b) =>
    (schedRank[schedOf.get(a).state] - schedRank[schedOf.get(b).state])
    || ((schedOf.get(b).ageH || 0) - (schedOf.get(a).ageH || 0))
    || String(a.name || '').localeCompare(String(b.name || '')));
  const overdue = scheduled.filter(w => OVERDUE_STATES.includes(schedOf.get(w).state));
  const drifting = scheduled.filter(w => schedOf.get(w).c.drifts);
  /* Schedules whose clock was restarted by a change more recent than their last
     run: waiting for their first fire under a new setting, not stopped. Named
     separately so the distinction stays visible instead of being folded into a
     pass — the operator who made the change is the one person who can confirm
     it, and the screen is telling them what it assumed. */
  const restarted = scheduled.filter(w => schedOf.get(w).state === 'CLOCK_RESET');
  /* An interval this build has been told was migrated to a cron. The cadence
     here is read from workflow_registry, and the registry is a description of
     n8n rather than n8n itself — so the two can disagree, and when they do it is
     the registry row that is stale, not a job at risk of drifting. Naming a
     fixed workflow in a drift warning is how the warning stops being read. */
  const staleInterval = drifting.filter(w => scheduleChange(w));
  const trulyDrifting = drifting.filter(w => !scheduleChange(w));
  const isOverdue = w => OVERDUE_STATES.includes(schedOf.get(w)?.state);

  /* The ceiling is the same policy for every row, so the chip is short and the
     whole explanation — including that this is n8n configuration the dashboard
     cannot read back — lives in its title. */
  const ceilingChip = w => {
    const ex = exemptFrom(w);
    return ex
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="${esc(`${ex.why} ${CEILING.provenance}`)}">${esc(ex.chip)}</span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="${esc(`${CEILING.why} ${CEILING.onTimeout} ${CEILING.provenance}`)}">${esc(CEILING.chip)}</span>`;
  };

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!health) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('workflow health', healthErr);
  } else if (!rows.length) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateEmpty('No workflows registered',
      'The automation health figures returned no rows, so there is nothing to report on. The automation register is what populates it.', 'account_tree');
  } else {
    /* Every figure in this strip is a sum of the view's own outcome columns. The
       version this replaced summed runs_30d and failures_30d and divided one by
       the other, which across the fleet turned 199 failures, 13 partials, 103
       runs that produced nothing and 36 refusals into a single number that said
       most of it had gone fine. */
    const sum = k => rows.reduce((a, w) => a + (n0(w[k]) || 0), 0);
    const runs30 = sum('runs_30d');
    const ok30 = sum('successes_30d');
    const fails30 = sum('failures_30d');
    const partials30 = sum('partials_30d');
    const bad30 = fails30 + partials30;
    const none30 = sum('no_result_30d');
    const refused30 = sum('rejected_30d');
    const esc30in = sum('escalated_30d');
    const unknown30 = sum('unknown_30d');
    const eff30 = sum('effective_runs_30d');
    const escAll = sum('escalations');
    const active = rows.filter(w => w.is_active !== false).length;
    const logged = rows.filter(w => w.writes_audit_log).length;
    /* last_incomplete is the newest failure OR partial, which is the question
       this line is actually asking. last_failure alone would have said "none
       recorded, ever" over a workflow that half-delivered this morning. */
    const newest = k => rows.map(w => w[k]).filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
    const lastBad = newest('last_incomplete');
    const r30 = successRate(ok30, eff30);
    /* There is deliberately no all-time counterpart to r30. The view exposes
       success_rate per workflow but no all-time successes column, and a fleet
       rate cannot be built by averaging per-workflow percentages — a workflow
       with two runs would weigh the same as one with 286. So the strip states
       the 30-day figure and says nothing about all-time rather than inventing
       one out of runs minus failures, which is the arithmetic this rebuild
       removed. */

    const attentionSub = () => {
      if (attention.length) {
        const names = attention.slice(0, 2).map(w => w.name).filter(Boolean).join(', ');
        const kinds = [...new Set(attention.map(w => healthOf(w).label))].join(' · ');
        return `<span class="text-red-700">${esc(names)}${attention.length > 2 ? ` +${attention.length - 2} more` : ''}</span>
          <br><span class="text-outline">${esc(kinds)}</span>`;
      }
      if (!logged) return '<span class="text-outline">Nothing writes to the activity log, so nothing can be measured</span>';
      /* Three separate ways this can be a true statement and still not mean
         "everything is fine", each said out loud rather than left to the green.
         A stopped schedule fails nothing by definition; a workflow with no
         qualifying runs has produced no evidence either way. */
      const caveats = [
        overdue.length ? `${num(overdue.length)} scheduled job${overdue.length === 1 ? ' has' : 's have'} not run on cadence` : '',
        noQualifying.length ? `${num(noQualifying.length)} ${noQualifying.length === 1 ? 'has' : 'have'} no qualifying run to rate` : '',
      ].filter(Boolean);
      return `<span class="text-emerald-700">No workflow is failing, half-delivering or logging a word this system cannot read</span>${
        caveats.length ? `<br><span class="text-amber-700">but ${esc(caveats.join(', and '))}</span>` : ''}`;
    };

    strip.innerHTML = [
      kpi('Workflows registered', num(rows.length),
        `${active} active · ${logged} of ${rows.length} write to the activity log${
          byDesign.length ? ` · ${num(byDesign.length)} answer${byDesign.length === 1 ? 's' : ''} the caller instead` : ''}${
          pages.length ? ` · ${num(pages.length)} ${pages.length === 1 ? 'is a web page' : 'are web pages'}, not automations` : ''}`),
      /* "Degraded now" until 31 Aug, which could only ever count one of the three
         states that need a person. A workflow producing nothing scored zero here
         while producing nothing. */
      kpi('Needs attention now', num(attention.length), attentionSub(),
        attention.length ? 't-hot' : ''),
      kpi('Runs · last 30 days', num(runs30),
        runs30
          ? `<span class="text-outline">${num(ok30)} delivered · ${num(bad30)} failed or half-done · ${num(none30)} produced nothing${
              refused30 || esc30in ? ` · ${num(refused30 + esc30in)} refused or escalated, left out of the rate` : ''}${
              unknown30 ? ` · ${num(unknown30)} unreadable` : ''}</span>`
          : '<span class="text-outline">No run logged inside the window</span>'),
      /* Failures and partials in one number because both are the same finding —
         work that did not land — and split in the sub-line because they are not
         the same repair. */
      kpi('Failed or half-done · 30 days', num(bad30),
        bad30
          ? `<span class="text-red-700">${num(fails30)} failed · ${num(partials30)} went out half-done</span>
             <br><span class="text-outline">most recent ${esc(ago(lastBad))}</span>`
          : (none30
              ? `<span class="text-amber-700">None — but ${num(none30)} run${none30 === 1 ? '' : 's'} produced nothing usable, which is not the same as none</span>`
              : '<span class="text-outline">None logged inside the window</span>'),
        bad30 ? 't-hot' : ''),
      /* A zero denominator prints its reason, never a number. Green is reserved
         for a rate with nothing failed, nothing half-done and nothing produced
         empty behind it — the old tile went green on failures alone. */
      kpi('Success rate · 30 days', r30 == null ? 'no rate' : pct(r30),
        r30 == null
          ? `<span class="text-outline">${eff30 === 0 && runs30 > 0
              ? `every one of the ${num(runs30)} logged run${runs30 === 1 ? '' : 's'} was refused by design or handed to a person, so none of them counted toward a rate`
              : 'nothing was logged inside the window, so there is no denominator'}</span>`
          : `${num(ok30)} of ${num(eff30)} qualifying run${eff30 === 1 ? '' : 's'} succeeded outright${
              refused30 || esc30in ? ` · ${num(refused30 + esc30in)} of the ${num(runs30)} logged runs are excluded as refused by design or escalated` : ''}${
              escAll ? ` · ${num(escAll)} escalation${escAll === 1 ? '' : 's'} all-time` : ''}`,
        r30 == null ? '' : (bad30 || none30 || unknown30 ? 't-hot' : 't-ok')),
    ].join('');
  }

  /* ── Banners ───────────────────────────────────────────────────────────── */
  /* Each banner states a count and then hands over the exact set it counted.
     A degraded workflow must be impossible to miss and impossible to lose. */
  let focusHealth = () => {};
  let focusLog = () => {};
  let focusSched = () => {};

  if (degraded.length) {
    /* rows are already worst-first, so the first degraded entry is the one with
       the lowest 30-day success rate. The count it quotes is failures plus
       partials: a run that half-delivered did not fail, and saying "N failed"
       over a workflow whose whole problem is twelve nightly partials sends
       whoever reads it looking for a crash that is not there. */
    const worst = degraded[0];
    const wr = rate30(worst);
    const bad = incomplete30(worst);
    const runs = n0(worst.runs_30d) || 0;
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-red-200 bg-red-50/40 text-red-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">error</span>
      <div style="flex:1">
        <strong>${num(degraded.length)} workflow${degraded.length === 1 ? ' is' : 's are'} degraded right now.</strong>
        ${esc(worst.name || 'One workflow')} is the worst of them${
          wr == null ? ` — and has no rate at all, because ${esc(noRateWhy(worst))}` : ` at ${esc(pct(wr))} success`}
        over the last 30 days — ${num(bad)} of ${num(runs)} logged run${runs === 1 ? '' : 's'}
        ${(n0(worst.partials_30d) || 0) ? 'failed or went out half-done' : 'failed'}${
          worst.last_incomplete ? `, most recently ${esc(ago(worst.last_incomplete))}` : ''}.
      </div>
      <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowDegraded">Show ${degraded.length === 1 ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowDegraded').addEventListener('click', () => focusHealth('DEGRADED'));
  }

  /* The state that had no banner, no KPI and no colour until 31 Aug, because
     nothing on the screen could express it. Competitor Price Scraping ran 96
     times in the window and recorded a price 12 times; the other 84 runs wrote
     REJECTED with "no price could be extracted" and were counted as successes,
     so the row sat at a green 100.0% for the whole month while the dealership
     had no competitor pricing. It is not degraded — nothing failed — and it is
     emphatically not healthy, so it gets its own sentence rather than being
     folded into either. */
  if (producingNothing.length) {
    const one = producingNothing.length === 1;
    const worst = producingNothing[0];
    const wr = rate30(worst);
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-red-200 bg-red-50/40 text-red-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">do_not_disturb_on</span>
      <div style="flex:1">
        <strong>${num(producingNothing.length)} workflow${one ? '' : 's'} run${one ? 's' : ''} without failing and produce${one ? 's' : ''} nothing usable.</strong>
        ${esc(worst.name || 'One workflow')} logged ${num(n0(worst.runs_30d) || 0)} run${(n0(worst.runs_30d) || 0) === 1 ? '' : 's'} in the window and
        ${num(n0(worst.successes_30d) || 0)} of them produced a result${wr == null ? '' : ` — ${esc(pct(wr))}`}. The rest completed and had nothing to show for it.
        <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">Nothing here is red: these runs did not crash, they finished. That is exactly why this state needs its own banner — a workflow achieving nothing raises no failure for anything else on this screen to notice.</div>
      </div>
      <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowNothing">Show ${one ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowNothing').addEventListener('click', () => focusHealth('PRODUCING_NOTHING'));
  }

  /* A workflow logging a status neither Postgres nor lib/health.js defines. The
     honest reading is that its health is not known, which is a finding and not a
     pass — so it is named here rather than left to sort quietly mid-list. */
  if (unknownOutcome.length) {
    const one = unknownOutcome.length === 1;
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">help</span>
      <div style="flex:1">
        <strong>${num(unknownOutcome.length)} workflow${one ? '' : 's'} logged a status this system does not define.</strong>
        ${esc(unknownOutcome.map(w => w.name).filter(Boolean).join(', ') || (one ? 'It' : 'They'))} wrote a value
        <span class="font-label-numeric-sm">NEXUS’s own rule for what a run achieved</span> has no case for, so ${one ? 'its' : 'their'} health cannot be stated either way and no rate is claimed for ${one ? 'it' : 'them'}.
        <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">Adding the value to <span class="font-label-numeric-sm">NEXUS’s own rule for what a run achieved</span> and to <span class="font-label-numeric-sm">NEXUS</span> together is what resolves this. Guessing at it on the screen is what this rebuild removed.</div>
      </div>
      <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowUnknown">Show ${one ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowUnknown').addEventListener('click', () => focusHealth('UNKNOWN_OUTCOME'));
  }

  /* The all-clear, and the one banner on this screen with the most power to
     mislead. It used to say "no instrumented workflow has failed", which was
     true of Competitor Price Scraping every day it produced nothing. It now
     covers all three attention states, and it still refuses to generalise past
     the workflows that are actually instrumented. */
  if (!attention.length && health && rows.length && rows.some(w => w.writes_audit_log)) {
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">check_circle</span>
      <div>No instrumented workflow failed, went out half-done, produced nothing usable or logged an unreadable status inside the 30-day window.
      This statement only covers the ${num(rows.filter(w => w.writes_audit_log).length)} of ${num(rows.length)} workflows that write to the activity log${
        noQualifying.length ? `, and ${num(noQualifying.length)} of those had no qualifying run in the window, so ${noQualifying.length === 1 ? 'it is' : 'they are'} covered by the sentence without being evidence for it` : ''}.</div>`;
    banners.appendChild(b);
  }

  /* The silent one. A schedule that has stopped firing raises no failures and no
     DEGRADED health, so without this banner nothing on the screen would mention
     it at all. The wording carries its own evidence limit rather than claiming
     more than last_run can support. */
  if (overdue.length) {
    const worst = overdue[0];
    const s = schedOf.get(worst);
    const hard = overdue.some(w => {
      const x = schedOf.get(w);
      return x.state === 'NO_RUN' || (x.ageH != null && x.ageH > x.c.allowance * 2);
    });
    const b = el('div', `banner ${hard ? 'hot' : 'warm'}`);
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">alarm</span>
      <div style="flex:1"><strong>${num(overdue.length)} scheduled job${overdue.length === 1 ? ' has' : 's have'} not logged a run inside ${overdue.length === 1 ? 'its' : 'their'} own cadence.</strong>
      ${esc(worst.name || 'One job')} is on a ${esc(fmtHours(s.c.hours))} schedule and ${
        s.state === 'NO_RUN'
          ? 'has never logged a run at all'
          : `last logged one ${esc(fmtHours(s.ageH))} ago, past the ${esc(fmtHours(s.c.allowance))} that cadence allows`}.
      A schedule that stops firing produces no failures and no degraded health, so this is the only place it shows up.
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">${esc(CADENCE_CAVEAT)}</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">${esc(EDIT_BLIND)}</div></div>
      <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowOverdue">Show ${overdue.length === 1 ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowOverdue').addEventListener('click', () => focusSched('LATE'));
  }

  /* The half of that judgement that is easy to get wrong in the other direction.
     A job whose schedule was changed after its last run looks exactly like a
     stopped one from audit_log alone, and calling it overdue is how a watchdog
     trains people to ignore it. Said out loud, with the assumption on show. */
  if (restarted.length) {
    const one = restarted.length === 1;
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">restart_alt</span>
      <div style="flex:1"><strong>${num(restarted.length)} scheduled job${one ? ' has' : 's have'} not logged a run inside ${one ? 'its' : 'their'} cadence, and ${one ? 'is' : 'are'} not overdue.</strong>
      ${esc(restarted.map(w => w.name).filter(Boolean).join(', ') || (one ? 'It' : 'They'))} had ${one ? 'its' : 'their'} schedule changed more recently than
      ${one ? 'that' : 'those'} last run, which restarts the clock — the gap belongs to the old schedule and says nothing about the new one.
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">${esc(EDIT_BLIND)}</div></div>
      <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowRestarted">Show ${one ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowRestarted').addEventListener('click', () => focusSched('ALL'));
  }

  /* Not a fault — a policy, and one that changes how a failure below should be
     read. Stated once, at the top, because it applies to every row on the page. */
  if (rows.length) {
    const exempt = rows.filter(w => exemptFrom(w));
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">timer</span>
      <div style="flex:1"><strong>Every workflow is capped at ${CEILING_SECONDS / 60} minutes of wall-clock time.</strong>
      ${esc(CEILING.why)}
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">${esc(CEILING.onTimeout)}</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">${
        exempt.length
          ? `One deliberate exception: <strong>${esc(exempt.map(w => w.name).join(', '))}</strong> carries no ceiling. ${esc(exempt.map(w => exemptFrom(w).why)[0])}`
          : 'The one workflow exempt from it — the 7-Day Warm Lead Drip, whose Wait nodes hold an execution open for a week — is not in this list, so nothing on screen is currently exempt.'}
      </div>
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">${esc(CEILING.provenance)}</div></div>`;
    banners.appendChild(b);
  }

  if (blind.length) {
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">visibility_off</span>
      <div style="flex:1"><strong>${num(blind.length)} workflow${blind.length === 1 ? '' : 's'} write${blind.length === 1 ? 's' : ''} nothing to the activity log.</strong>
      ${blind.length === 1 ? 'It' : 'They'} may be running perfectly or failing every time — the dashboard cannot tell, because there is no Audit Log node to read.
      Only NEXUS can close that gap, by instrumenting the workflow.</div>
      <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowBlind">Show ${blind.length === 1 ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowBlind').addEventListener('click', () => focusHealth('NOT_INSTRUMENTED'));
  }

  /* Not a warning. These are request/response endpoints: the caller is told the
     outcome in the reply, so the absence of an audit row is the design. The
     banner still names the one thing it costs — no history — rather than
     presenting it as free. */
  if (byDesign.length) {
    const one = byDesign.length === 1;
    const names = byDesign.map(w => w.name).filter(Boolean);
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">sync_alt</span>
      <div style="flex:1"><strong>${num(byDesign.length)} workflow${one ? '' : 's'} answer${one ? 's' : ''} the caller instead of writing to the activity log.</strong>
      ${names.length ? `${esc(names.join(', '))} ${names.length === 1 ? 'is' : 'are'}` : `${one ? 'It is' : 'They are'}`} called by the dashboard and read on the spot,
      so ${one ? 'the' : 'each'} outcome is shown by the screen that made the call. For a request/response endpoint that is the right design,
      so ${one ? 'it is' : 'they are'} not counted as a blind spot above. It does mean no run history is kept here — this screen cannot tell you
      how ${one ? 'it' : 'they'} behaved yesterday, only the calling screen can, as it happens.</div>
      <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowByDesign">Show ${one ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowByDesign').addEventListener('click', () => focusHealth('RETURNS_RESULT'));
  }

  /* Not automation at all, and unlabelled it reads as three dead workflows. */
  if (pages.length) {
    const one = pages.length === 1;
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">public</span>
      <div style="flex:1"><strong>${num(pages.length)} of these ${one ? 'is a web page, not an automation' : 'are web pages, not automations'}.</strong>
      ${esc(pages.map(w => w.name).filter(Boolean).join(', ') || (one ? 'It' : 'They'))} ${one ? 'is a page NEXUS publishes' : 'are pages NEXUS publishes'}, not ${one ? 'an automation' : 'automations'} of yours.
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">${one ? 'It' : 'They'} will never log a run — a page view is not a workflow run — so ${one ? 'it is' : 'they are'} not counted as a blind spot above, and a silent one here is correct rather than suspicious.</div></div>
      <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowPages">Show ${one ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowPages').addEventListener('click', () => focusHealth('PUBLIC_PAGE'));
  }

  /* Names that show up in audit_log but match no registered workflow. Those runs
     are real work nobody is holding a health record for, and the count above
     silently excludes them. */
  if (audit && rows.length) {
    const known = new Set();
    rows.forEach(w => namesFor(w).forEach(n => known.add(n)));
    const orphans = [...new Set((audit || []).map(a => a.workflow).filter(w => w && !known.has(low(w))))];
    if (orphans.length) {
      const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm');
      /* Each unmatched name is a button that filters the log to it, so the claim
         hands over the exact runs it is about rather than leaving someone to
         search for them. */
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">help</span>
        <div style="flex:1"><strong>${num(orphans.length)} name${orphans.length === 1 ? '' : 's'} in the activity log match no registered workflow.</strong>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          ${orphans.slice(0, 6).map(n => `<button class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" data-orphan="${esc(n)}">${esc(n)}</button>`).join('')}
          ${orphans.length > 6 ? `<span class="font-body-sm text-body-sm text-on-surface-variant">and ${orphans.length - 6} more</span>` : ''}
        </div>
        <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">Runs logged under ${orphans.length === 1 ? 'that name' : 'those names'} are not counted in any health figure above until
        the automation register records ${orphans.length === 1 ? 'it' : 'them'} as an <span class="font-label-numeric-sm">audit_name</span> or in <span class="font-label-numeric-sm">audit_aliases</span> —
        which is the join every figure on this screen uses, precisely because the name a run logs under can drift from the name the workflow is registered with.</div></div>`;
      banners.appendChild(b);
      b.querySelectorAll('[data-orphan]').forEach(btn =>
        btn.addEventListener('click', () => focusLog('ALL', btn.dataset.orphan)));
    }
  }

  if (!registry) {
    const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">warning</span>
      <div>The automation register could not be read (${esc(regR.status === 'rejected' ? (regR.reason?.message || 'Unknown error') : 'no rows')}),
      so a workflow's run history is matched on its display name alone. A workflow that logs under an alias will look quieter than it is.</div>`;
    banners.appendChild(b);
  }

  /* ── Scheduled jobs, each against its own cadence ──────────────────────── */
  /* The check v_workflow_health cannot make. Its `health` column needs runs to
     judge, and a job that has stopped firing has none — so it holds HEALTHY
     until its last in-window run ages out and then goes to NO_QUALIFYING_RUNS,
     neither of which is a warning that anything stopped. This card asks a
     different question: given what this job's own trigger says its cadence is,
     is a run overdue? */
  if (!health) {
    schedCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Scheduled jobs</div></div></div>
      ${stateError('workflow health', healthErr)}`;
  } else if (!triggerVisible) {
    /* THE FALSE ABSENCE THIS BRANCH EXISTS TO END. Until 5 Sep 2026 the branch
       below ran instead, and it told the dealership that none of their
       workflows records a cadence and that "recording the real cron expression
       in workflow_registry.trigger_detail is what turns this panel on". Every
       one of them records a cadence. The registry holds it; this login may not
       read it. Reporting that as a missing record, and then asking the customer
       to go and supply it, is the system inventing an absence and then billing
       the customer for it. */
    schedCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Scheduled jobs</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Not checked from this dashboard.</div>
      </div></div>
      ${stateEmpty('Schedules are operated by NEXUS',
        `${TRIGGER_NOT_AVAILABLE} So this screen cannot tell you whether a scheduled job is overdue, and it will not guess: the ${num(rows.length)} workflows below still report every run they logged, and a job that fails or half-delivers is still coloured and counted above. What is not covered is the quiet case — a schedule that simply stops firing raises no failure — and NEXUS watches for that on its side.`,
        'visibility_off')}`;
  } else if (!scheduled.length) {
    schedCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Scheduled jobs</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Cadence is read from the trigger recorded in the automation register.</div>
      </div></div>
      ${stateEmpty('No schedule this screen can read',
        `None of the ${rows.length} registered workflows records a cadence this screen can parse — a cron expression, or wording like "every 6 hours" or "nightly". Without one there is nothing to measure the last logged run against, so a stopped schedule would go unnoticed here.`, 'schedule')}`;
  } else {
    let sf = 'ALL';
    const lateCount = overdue.length;
    schedCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Scheduled jobs — each against its own cadence</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${num(scheduled.length)} of ${num(rows.length)} registered workflows run on a schedule this screen can read. A job that quietly stops firing raises no failures and no degraded health, so it is checked against its own interval instead: hourly is late after 2 h, daily after 26 h — the same thresholds <span class="font-label-numeric-sm">scripts/nexus_healthcheck.py</span> section 7 uses.</div>
      </div></div>
      <div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40">
        <div class="seg inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-surface-container" id="aSegSched" role="group" aria-label="Filter scheduled jobs">
          <button data-s="ALL" class="on">All · ${num(scheduled.length)}</button>
          ${lateCount ? `<button data-s="LATE">Overdue · ${num(lateCount)}</button>` : ''}
        </div>
        <div class="flex-1 min-w-[160px]"></div>
        <div class="font-label-numeric-sm text-outline" id="aSchedCount"></div>
      </div>
      <div id="aSchedList"></div>
      <div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40" style="background:var(--surface-sunken)">
        <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal;flex:1">
          <strong>How this is judged, and how far it can be trusted.</strong> ${esc(CADENCE_CAVEAT)}
          <div style="margin-top:6px">${esc(EDIT_BLIND)}</div>
        </div>
      </div>
      <div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40" style="background:var(--surface-sunken)">
        <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal;flex:1">
          <strong>An interval is not a fixed clock.</strong> An “every N hours” interval counts from when the workflow was last started rather than from the clock, so a restart of the host moves its fire time — and after the 19 Aug outage Competitor Price Scraping stopped landing altogether, one run in 36 hours, and its health record stayed green the whole time. (It reads <span class="font-label-numeric-sm">No output</span> today for an unrelated reason — its scrapes are landing and finding no price — so the green is gone but the blind spot is not: a schedule that stops still turns nothing red.) It is on <span class="font-label-numeric-sm">0 5 * * *</span> now — 05:00 UTC, on the clock, unmoved by a restart. ${
            trulyDrifting.length
              ? `<span class="text-amber-700">${num(trulyDrifting.length)} job${trulyDrifting.length === 1 ? ' still records its trigger as an interval' : 's still record their triggers as intervals'}: ${esc(trulyDrifting.map(w => w.name).join(', '))}. Worth asking NEXUS whether ${trulyDrifting.length === 1 ? 'it is' : 'they are'} a real interval rather than a fixed clock.</span>`
              : 'No job in this list records an interval this screen has reason to warn about.'}${
            staleInterval.length
              ? ` <span class="text-outline">${esc(staleInterval.map(w => w.name).join(', '))} still reads as an interval in the automation register, but ${staleInterval.length === 1 ? 'that trigger has' : 'those triggers have'} since been moved onto a fixed clock — the register is the stale half, and NEXUS keeps it.</span>`
              : ''}
        </div>
      </div>`;

    const schedList = schedCard.querySelector('#aSchedList');
    const schedCount = schedCard.querySelector('#aSchedCount');

    const schedRow = (w, i) => {
      const s = schedOf.get(w);
      const v = SCHED[s.state];
      return `<div class="block w-full text-left px-space-md py-3 border-b border-outline-variant/30 hover:bg-surface-container-low transition-colors" data-sched="${i}" role="button" tabindex="0"
        aria-label="Open ${esc(w.name || 'workflow')} — ${esc(v.label)}" style="align-items:flex-start">
        <span class="material-symbols-outlined ${v.tone === 'hot' ? 't-hot' : v.tone === 'ok' ? 't-ok' : 't-muted'}"
          style="margin-top:2px">${esc(v.icon)}</span>
        <div style="flex:1;min-width:0">
          <div class="wf-head">
            <span style="font-weight:500">${esc(w.name || 'Unnamed workflow')}</span>
            ${pill(v.label, v.tone || undefined, { verbatim: false })}
            ${w.is_active === false ? pill('Inactive', 'warm', { verbatim: false }) : ''}
            ${(() => {
              const chg = scheduleChange(w);
              /* Three different things the chip can be saying, and the stale one
                 must not be dressed as a risk: a registry row that still
                 describes an interval after the trigger was moved to a cron is
                 out of date, not drifting. */
              const title = s.c.kind === 'cron'
                ? `Fixed clock schedule as recorded in the automation register: ${s.c.expr}`
                : s.c.kind === 'interval'
                  ? (chg
                      ? `The automation register still records this as an interval (${s.c.expr}), but the trigger was ${chg.what}. The register is the stale half; the cadence below is judged from what it says.`
                      : `Recorded as an interval (${s.c.expr}). An interval counts from when the workflow was last started, so a restart moves the fire time.`)
                  : `Recorded as “${s.c.expr}”. Whether that is a fixed clock or an interval is not written down, so the mechanism — and whether a restart moves it — is unknown here.`;
              const suffix = !s.c.drifts ? '' : chg ? ' · the register says interval, the schedule is fixed' : ' · interval, drifts';
              return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="${esc(title)}">${esc(s.c.kind === 'cron' ? `cron ${s.c.expr}` : s.c.expr)}${suffix}</span>`;
            })()}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">expects a run every ${esc(fmtHours(s.c.hours))}</span>
          </div>
          <div class="ds-cell-sub ${s.state === 'OVERDUE' ? 't-hot' : ''}" style="margin-top:6px;white-space:normal">${esc(s.why)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="font-body-sm text-body-sm text-on-surface-variant">${w.last_run ? 'last logged run' : ''}</div>
          <div class="font-label-numeric-sm" style="font-weight:500">${w.last_run
            ? `<span class="${s.state === 'OVERDUE' ? 't-hot' : ''}">${esc(ago(w.last_run))}</span>`
            : '<span class="text-outline">never</span>'}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant">late after ${esc(fmtHours(s.c.allowance))}</div>
        </div>
      </div>`;
    };

    function drawSched() {
      const vis = sf === 'LATE' ? scheduled.filter(isOverdue) : scheduled;
      schedCount.textContent = `${vis.length} of ${scheduled.length}`;
      schedList.innerHTML = vis.length
        ? vis.map(w => schedRow(w, scheduled.indexOf(w))).join('')
        /* Names go in unescaped on purpose: stateEmpty() escapes its own body,
           and escaping here would render an ampersand as &amp; on screen. */
        : stateEmpty('Nothing overdue',
            restarted.length
              ? `Every scheduled job has logged a run inside its own cadence, except ${restarted.length === 1 ? 'one whose' : `${restarted.length} whose`} schedule was changed more recently than its last run — ${restarted.map(w => w.name).filter(Boolean).join(', ')} — which restarts the clock rather than missing a run.`
              : 'Every scheduled job has logged a run inside its own cadence.', 'schedule');
      schedList.querySelectorAll('[data-sched]').forEach(node => {
        const open = () => openWorkflow(scheduled[Number(node.dataset.sched)]);
        node.addEventListener('click', open);
        node.addEventListener('keydown', ev => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault(); open();
        });
      });
    }

    schedCard.querySelectorAll('#aSegSched button').forEach(b => b.addEventListener('click', () => {
      schedCard.querySelectorAll('#aSegSched button').forEach(x => x.classList.toggle('on', x === b));
      sf = b.dataset.s; drawSched();
    }));

    focusSched = (state = 'ALL') => {
      sf = state;
      schedCard.querySelectorAll('#aSegSched button').forEach(x => x.classList.toggle('on', x.dataset.s === state));
      drawSched();
      schedCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    drawSched();
  }

  /* ── Workflow health, grouped by category ──────────────────────────────── */
  if (!health) {
    healthCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Workflow health</div></div></div>
      ${stateError('workflow health', healthErr)}`;
  } else if (!rows.length) {
    healthCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Workflow health</div></div></div>
      ${stateEmpty('No workflows registered', 'The automation register is empty, so the automation health figures has nothing to report.', 'account_tree')}`;
  } else {
    const f = { health: 'ALL', q: '' };
    const hCount = k => rows.filter(w => stateKey(w) === k).length;
    /* SCHED_LATE is not a health state and is not presented as one — it is a
       filter over the same list for the condition `health` cannot express. */
    /* One segment per state the view can return, in worst-first order, so that
       every health value is reachable as itself. Three of them had no segment
       before 31 Aug — a PRODUCING_NOTHING workflow could not be filtered to at
       all, which is a quiet way of saying the screen could not show you the
       thing that was wrong with it. A segment with a zero count is dropped
       rather than shown empty. */
    const segs = [['ALL', rows.length],
                  ['DEGRADED', hCount('DEGRADED')],
                  ['PRODUCING_NOTHING', hCount('PRODUCING_NOTHING')],
                  ['UNKNOWN_OUTCOME', hCount('UNKNOWN_OUTCOME')],
                  ['SCHED_LATE', overdue.length],
                  ['HEALTHY', hCount('HEALTHY')],
                  ['NO_QUALIFYING_RUNS', hCount('NO_QUALIFYING_RUNS')],
                  ['NEVER_RAN', hCount('NEVER_RAN')], ['NOT_INSTRUMENTED', hCount('NOT_INSTRUMENTED')],
                  ['RETURNS_RESULT', hCount('RETURNS_RESULT')], ['PUBLIC_PAGE', hCount('PUBLIC_PAGE')]]
      .filter(([k, c]) => k === 'ALL' || c > 0);
    const segLabel = k => k === 'ALL' ? 'All'
      : k === 'SCHED_LATE' ? 'Schedule overdue'
      : STATES[k] ? STATES[k].label : k;

    healthCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Workflow health by category</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">This list is the register of the automations NEXUS runs for you. The run figures beside each row are counted from this dealership's own record, so a workflow reading “never logged a run” here has never run for you. A handful of entries are pages NEXUS publishes rather than automations, and they are labelled where they appear. Headline figures are the rolling 30-day window from <span class="font-label-numeric-sm">The automation health figures</span>, and every one of them is a count of run <em>outcomes</em> rather than of the status word a workflow wrote: a rate here is outright successes over the runs the workflow was expected to deliver on, with anything refused by design or handed to a person left out of the denominator entirely. A run that finished half-done is not in the numerator. The all-time totals sit underneath as context and are labelled where the two appear together. Click a workflow for its full record and recent runs. The dashboard starts, stops and retries nothing: the only live control anywhere on this screen posts to a workflow's own webhook, and every other button is disabled with the reason in its tooltip.</div>
      </div></div>
      <div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40">
        <div class="seg inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-surface-container" id="aSegHealth" role="group" aria-label="Filter workflows by health">
          ${/* Each segment carries the canonical layer's own sentence about the
                state it filters to, so the definition is on the control rather
                than only in a banner somebody may have scrolled past. */ ''}
          ${segs.map(([k, c], i) => {
            const title = k === 'SCHED_LATE'
              ? 'Not a health state — these are scheduled jobs whose last logged run is older than their own cadence allows. The automation health figures cannot express this: a job that stops firing logs no failures.'
              : (STATES[k] ? STATES[k].detail : '');
            return `<button data-h="${esc(k)}" class="px-3 py-1 rounded-md font-body-sm text-body-sm font-semibold text-on-surface-variant${i === 0 ? ' on' : ''}"${
              title ? ` title="${esc(title)}"` : ''
              }>${esc(segLabel(k))} · ${num(c)}</button>`;
          }).join('')}
        </div>
        <div class="flex-1 min-w-[160px]"><input type="search" id="aWfQ" aria-label="Search workflows"
          placeholder="Search workflow, category or description" /></div>
        <div class="font-label-numeric-sm text-outline" id="aWfCount"></div>
      </div>
      <div id="aWfList"></div>`;

    const listHost = healthCard.querySelector('#aWfList');
    const countEl = healthCard.querySelector('#aWfCount');

    const visible = () => {
      const q = f.q.trim().toLowerCase();
      return rows.filter(w => {
        if (f.health === 'SCHED_LATE') { if (!isOverdue(w)) return false; }
        else if (f.health !== 'ALL' && stateKey(w) !== f.health) return false;
        if (!q) return true;
        return [w.name, w.category, w.description, healthLabel(w)]
          .some(v => low(v).includes(q));
      });
    };

    const wfRow = (w, i) => {
      const h = healthOf(w);
      const r30 = rate30(w), rAll = rateAll(w);
      const runs30 = n0(w.runs_30d);
      const bad30 = incomplete30(w);
      const none30 = n0(w.no_result_30d) || 0;
      const t = triggerState(w);
      const answers = respondsToCaller(w) ? callerInfo(w) : null;
      /* The line under the run count, built from what actually happened rather
         than from one number and the word "failed". "none failed" was true of
         every workflow in PRODUCING_NOTHING on the day this was rebuilt. */
      const mixLine = [
        `${num(n0(w.successes_30d) || 0)} delivered`,
        bad30 ? `<span class="text-red-700">${num(bad30)} failed or half-done</span>` : '',
        none30 ? `<span class="text-amber-700">${num(none30)} produced nothing</span>` : '',
        (n0(w.rejected_30d) || 0) ? `<span class="text-outline">${num(n0(w.rejected_30d) || 0)} refused by design, left out of the rate</span>` : '',
        (n0(w.escalated_30d) || 0) ? `<span class="text-outline">${num(n0(w.escalated_30d) || 0)} escalated, left out of the rate</span>` : '',
        (n0(w.unknown_30d) || 0) ? `<span class="text-zinc-600">${num(n0(w.unknown_30d) || 0)} logged a status this system cannot read</span>` : '',
      ].filter(Boolean).join(' · ');
      return `<div class="block w-full text-left px-space-md py-3 border-b border-outline-variant/30 hover:bg-surface-container-low transition-colors" data-wf="${i}" role="button" tabindex="0"
        aria-label="Open ${esc(w.name || 'workflow')} — ${esc(healthLabel(w))}" style="align-items:flex-start">
        <span class="material-symbols-outlined ${h.tone === 'hot' ? 't-hot' : h.tone === 'ok' ? 't-ok' : 't-muted'}"
          style="margin-top:2px">${esc(h.icon)}</span>
        <div style="flex:1;min-width:0">
          <div class="wf-head">
            <span style="font-weight:500">${esc(w.name || 'Unnamed workflow')}</span>
            ${wordPill(healthLabel(w), h.tone, h.detail)}
            ${w.is_active === false ? pill('Inactive', 'warm', { verbatim: false }) : ''}
            ${/* The trigger chip carried trigger_type and trigger_detail — the
                 kind of trigger and, for a schedule, the cron expression or the
                 webhook path. Both are control plane now, and a chip reading
                 “trigger not recorded” on every row was the screen asserting an
                 absence it could not see. The one sentence about that is said
                 once, on the Scheduled jobs card, not eighteen times here. */ ''}
            ${ceilingChip(w)}
          </div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:4px;white-space:normal">${esc(w.description || 'No description in the automation register.')}</div>
          ${runBar(w)}
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">
            ${runs30 == null || runs30 === 0
              ? (w.writes_audit_log
                  ? 'No runs logged in the last 30 days.'
                  : answers
                    ? `Answers its caller in the reply instead of logging, so there is no run count here by design — ${esc(answers.where)} reports each call as it happens.`
                    : 'Not instrumented — nothing reaches the activity log, so no run can be counted.')
              : `${num(runs30)} run${runs30 === 1 ? '' : 's'} in the window · ${mixLine}`}
            ${w.runs ? ` · <span class="text-outline">all-time ${num(w.runs)} run${(n0(w.runs) || 0) === 1 ? '' : 's'}, ${num(n0(w.failures) || 0)} failed${
              rAll == null ? ', no all-time rate' : ` (${pct(rAll)} of the runs that qualified)`}</span>` : ''}
          </div>
          ${/* last_incomplete, not last_failure: a run that went out half-done is
                the same finding and the old line said "none recorded" over it. */ ''}
          ${w.last_incomplete ? `<div class="font-body-sm text-body-sm text-red-700" style="margin-top:2px">Last failed or half-done run ${esc(ago(w.last_incomplete))}</div>` : ''}
          ${(() => {
            const s = schedOf.get(w);
            if (!s) return '';
            const late = OVERDUE_STATES.includes(s.state);
            return `<div class="ds-cell-sub ${late ? 't-hot' : ''}" style="margin-top:2px;white-space:normal">
              <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">alarm</span>
              ${esc(SCHED[s.state].label)} · every ${esc(fmtHours(s.c.hours))}, late after ${esc(fmtHours(s.c.allowance))}${
                late ? ` — ${esc(s.state === 'NO_RUN' ? 'no run has ever been logged' : `nothing logged for ${fmtHours(s.ageH)}`)}` : ''}${
                s.state === 'CLOCK_RESET' ? ` — ${esc(`its schedule changed ${fmtHours(s.changedH)} ago, so the clock restarted and nothing has been missed`)}` : ''}
            </div>`;
          })()}
        </div>
        <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          ${/* A rate with a zero denominator is not 0% and it is not 100%. The
                dash it used to print was read as "nothing to see"; the words
                below say which absence it is instead, and the row is only green
                when nothing failed, nothing went half-done and nothing came back
                empty — a workflow can hold a rate of 12.5% with no failure on
                it at all. */ ''}
          <div class="font-label-numeric-sm" style="font-weight:500;font-size:16px"
            ><span class="${r30 == null ? 't-unknown' : (bad30 || none30) ? 't-hot' : 't-ok'}">${
              r30 == null ? 'no rate' : esc(pct(r30))}</span></div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal;max-width:190px">${
            r30 == null
              ? (answers
                  ? 'no rate is kept here — this endpoint answers its caller instead of logging'
                  : esc(noRateWhy(w)))
              : `30-day success, over ${num(n0(w.effective_runs_30d) || 0)} qualifying run${(n0(w.effective_runs_30d) || 0) === 1 ? '' : 's'}`}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant">${w.last_run
            ? 'ran ' + esc(ago(w.last_run))
            : (answers ? 'no run log kept' : 'never logged a run')}</div>
          <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" data-run="${i}" ${t.can ? '' : 'disabled'}
            aria-label="${esc(t.label)} — ${esc(w.name || 'workflow')}"
            title="${esc(t.can ? `POSTs to the ${t.hook} webhook with your session token.` : t.why)}">${esc(t.label)}</button>
        </div>
      </div>`;
    };

    function drawWf() {
      const vis = visible();
      countEl.textContent = `${vis.length} of ${rows.length}`;
      if (!vis.length) {
        listHost.innerHTML = stateEmpty('No workflow matches these filters',
          'Clear the search or pick another health state.', 'filter_alt_off');
        return;
      }
      /* Grouped by category, categories ordered by the worst workflow inside
         them so the section that needs attention is the one you land on. */
      const groups = new Map();
      vis.forEach(w => {
        const k = w.category || 'Uncategorised';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(w);
      });
      const ordered = [...groups.entries()].sort((a, b) =>
        (Math.min(...a[1].map(w => healthOf(w).rank)) - Math.min(...b[1].map(w => healthOf(w).rank)))
        || a[0].localeCompare(b[0]));

      listHost.innerHTML = ordered.map(([cat, list]) => {
        /* The category rate is the sum of successes over the sum of qualifying
           runs, not an average of percentages and not runs-minus-failures. The
           pill counts every state that needs a person, so a category holding one
           workflow that produces nothing can no longer show a bare workflow
           count and a green rate beside it. */
        const catBad = list.filter(w => NEEDS_ATTENTION.includes(stateKey(w)));
        const catSum = k => list.reduce((a, w) => a + (n0(w[k]) || 0), 0);
        const catRuns = catSum('runs_30d');
        const catEff = catSum('effective_runs_30d');
        const cr = successRate(catSum('successes_30d'), catEff);
        return `<div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40" style="background:var(--surface-sunken)">
            <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="flex:1">${esc(cat)}</div>
            ${catBad.length ? pill(`${catBad.length} need${catBad.length === 1 ? 's' : ''} attention`, 'hot', { verbatim: false }) : ''}
            <span class="font-body-sm text-body-sm text-on-surface-variant">${list.length} workflow${list.length === 1 ? '' : 's'}${
              catRuns
                ? ` · ${num(catRuns)} run${catRuns === 1 ? '' : 's'} in 30 days · ${
                    cr == null
                      ? 'no rate — every one of them was refused by design or escalated'
                      : `${esc(pct(cr))} success over ${num(catEff)} qualifying`}`
                : ' · no runs logged in 30 days'}</span>
          </div>
          ${list.map(w => wfRow(w, rows.indexOf(w))).join('')}`;
      }).join('');

      listHost.querySelectorAll('[data-wf]').forEach(node => {
        const open = () => openWorkflow(rows[Number(node.dataset.wf)]);
        node.addEventListener('click', ev => {
          if (ev.target.closest('[data-run]')) return;
          open();
        });
        /* The row is a div because it carries a nested button, and a button
           inside a button is invalid. Giving it the button role without the key
           handling would announce it as operable to a screen reader and then
           ignore every keystroke, which is worse than leaving it a div. */
        node.addEventListener('keydown', ev => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          if (ev.target.closest('[data-run]')) return;
          ev.preventDefault();
          open();
        });
      });
      listHost.querySelectorAll('[data-run]').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          confirmRun(rows[Number(btn.dataset.run)]);
        });
      });
    }

    healthCard.querySelectorAll('#aSegHealth button').forEach(b => b.addEventListener('click', () => {
      healthCard.querySelectorAll('#aSegHealth button').forEach(x => x.classList.toggle('on', x === b));
      f.health = b.dataset.h; drawWf();
    }));
    healthCard.querySelector('#aWfQ').addEventListener('input', e => { f.q = e.target.value; drawWf(); });

    /* Banner hand-off. The search box is cleared on purpose: a leftover query
       silently hiding half the set the banner just counted is the drift this
       exists to prevent. */
    focusHealth = state => {
      f.health = state; f.q = '';
      healthCard.querySelector('#aWfQ').value = '';
      healthCard.querySelectorAll('#aSegHealth button').forEach(x => x.classList.toggle('on', x.dataset.h === state));
      drawWf();
      healthCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    drawWf();
  }

  /* ── One workflow, in full ─────────────────────────────────────────────── */
  function openWorkflow(w) {
    if (!w) return;
    const h = healthOf(w);
    const r30 = rate30(w), rAll = rateAll(w);
    /* The comparison this drawer makes, and the one it used to make, are not the
       same question. It used to guess which window `success_rate` belonged to by
       seeing which of two locally computed rates it landed nearest, because the
       view documented neither. The view now publishes both windows explicitly —
       `success_rate_30d` and `success_rate`, each successes over effective runs —
       so there is nothing left to guess. What is worth checking is whether this
       screen's arithmetic and the view's arithmetic agree over the same window
       and the same columns; where they do not, one of the two has drifted from
       nexus_outcome_class and the number on screen should not be trusted until
       somebody says which. It is reported, never silently resolved. */
    const viewRate30 = n0(w.success_rate_30d);
    const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.6;
    const drift = (r30 == null) !== (viewRate30 == null)
      || (r30 != null && viewRate30 != null && !near(r30, viewRate30));
    const sched = schedOf.get(w) || null;
    const exempt = exemptFrom(w);
    const t = triggerState(w);
    const history = auditFor(w);
    const known = registry ? 'The automation register aliases' : 'the display name only';
    const answers = respondsToCaller(w) ? callerInfo(w) : null;

    openDrawer(`
      <div class="px-space-lg py-space-md flex items-start justify-between gap-space-sm bg-surface-container-lowest shadow-sm shrink-0">
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(w.name || 'Unnamed workflow')}</h2>
          <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(w.category || 'Uncategorised')}</div>
        </div>
        <button class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="flex-1 overflow-y-auto p-space-md space-y-space-md bg-surface-container-low/40">
        <div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Health</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${wordPill(healthLabel(w), h.tone, h.detail)}
            ${w.is_active === false ? pill('Inactive', 'warm', { verbatim: false }) : pill('Active', 'ok', { verbatim: false })}
            ${w.writes_audit_log ? '' : (answers ? pill('Answers the caller', 'cold', { verbatim: false }) : pill('No audit node', 'warm', { verbatim: false }))}
          </div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${esc(h.detail)}</div>
          ${answers ? `<div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">It replies with <span class="font-label-numeric-sm">${esc(answers.answer)}</span>. ${esc(answers.line)}</div>` : ''}
          ${w.description ? `<div class="p-3 rounded-lg bg-surface-container-low border-l-4 border-outline-variant font-body-sm text-body-sm text-on-surface whitespace-pre-wrap break-words" style="margin-top:12px">${esc(w.description)}</div>` : ''}
        </div>

        <div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Execution ceiling</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${/* Neither of these is a fault, so neither is coloured as one — the
                 words carry the difference. */ ''}
            ${exempt ? pill(exempt.chip, 'cold', { verbatim: false }) : pill(`${CEILING_SECONDS / 60} minutes`, 'cold', { verbatim: false })}
          </div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${esc(exempt ? exempt.why : CEILING.why)}</div>
          ${exempt ? '' : `<div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${esc(CEILING.onTimeout)}</div>`}
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${esc(CEILING.provenance)}</div>
        </div>

        ${sched ? `<div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Schedule</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${pill(SCHED[sched.state].label, SCHED[sched.state].tone || undefined, { verbatim: false })}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(sched.c.kind === 'cron' ? `cron ${sched.c.expr}` : sched.c.expr)}</span>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">every ${esc(fmtHours(sched.c.hours))}</span>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">late after ${esc(fmtHours(sched.c.allowance))}</span>
          </div>
          <div class="ds-cell-sub ${sched.state === 'OVERDUE' ? 't-hot' : ''}" style="margin-top:8px;white-space:normal">${esc(sched.why)}</div>
          ${sched.c.drifts ? `<div class="banner ${scheduleChange(w) ? 'info' : 'warm'}" style="margin-top:12px"><span class="material-symbols-outlined">restart_alt</span>
            <div>This trigger is recorded as an interval rather than a fixed clock. An interval counts from when the workflow was last started, not from the clock,
            so every restart of the host quietly moves when it fires — which is how Competitor Price Scraping went from daily to one run in 36 hours after the
            19 Aug outage without anything turning red. A cron expression fires on the clock and survives a restart.${
              scheduleChange(w)
                ? ` <strong>This one has already been fixed:</strong> the trigger was ${esc(scheduleChange(w).what)}. The automation register still describes it as an interval, and every cadence figure in this drawer is read from that description, so it lags the change.`
                : ''}</div></div>` : ''}
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${esc(CADENCE_CAVEAT)}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${esc(EDIT_BLIND)}</div>
        </div>` : ''}

        <div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Last 30 days</div>
          ${runBar(w) || `<div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${
            answers
              ? 'Nothing is logged for this endpoint at all, so there is no bar to draw and the figures below stay empty. That is expected here — it is not evidence that it did or did not run.'
              : 'Nothing logged in the window, so there is no bar to draw.'}</div>`}
          ${/* Every outcome the window holds, named, in the order they matter.
                The list this replaced had two rows — Runs and Failures — under
                which a workflow that half-delivered twelve times and produced
                nothing eighty-four more looked identical to a clean one. Each
                line carries the canonical layer's own sentence about what that
                outcome means, so the definition is one hover away from the
                count. */ ''}
          <dl class="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2 font-body-sm text-body-sm [&_dt]:text-outline" style="margin-top:12px">
            <dt>Runs logged</dt><dd class="font-label-numeric-sm">${w.runs_30d == null ? '<span class="text-outline">—</span>' : num(w.runs_30d)}</dd>
            ${[[OUTCOME.SUCCESS, 'successes_30d', ''],
               [OUTCOME.FAILURE, 'failures_30d', 't-hot'],
               [OUTCOME.PARTIAL, 'partials_30d', 't-hot'],
               [OUTCOME.NO_RESULT, 'no_result_30d', 't-warm'],
               [OUTCOME.REJECTED_EXPECTED, 'rejected_30d', 't-muted'],
               [OUTCOME.ESCALATED, 'escalated_30d', 't-muted'],
               [OUTCOME.UNKNOWN, 'unknown_30d', 't-unknown']].map(([o, col, cls]) => {
              const c = n0(w[col]) || 0;
              const words = outcomeWords(o);
              /* A zero is shown for every outcome rather than hidden, because
                 "no partials" is a finding and a missing row is not. */
              return `<dt title="${esc(words.blurb)}">${esc(words.label)}</dt>
                <dd class="num ${c ? cls : 't-muted'}" title="${esc(words.blurb)}">${num(c)}</dd>`;
            }).join('')}
            <dt title="Runs the workflow was expected to deliver on: everything except what was refused by design or handed to a person on purpose. This is the denominator of the rate below.">Qualifying runs</dt>
            <dd class="font-label-numeric-sm">${num(n0(w.effective_runs_30d) || 0)}</dd>
            <dt>Success rate</dt><dd class="font-label-numeric-sm">${
              r30 == null
                ? `<span class="text-zinc-600">no rate</span><div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${esc(noRateWhy(w))}</div>`
                : `${esc(pct(r30))}<div class="font-body-sm text-body-sm text-on-surface-variant">${num(n0(w.successes_30d) || 0)} outright successes over ${num(n0(w.effective_runs_30d) || 0)} qualifying runs</div>`}</dd>
            <dt>Last failure</dt><dd>${w.last_failure ? `<span class="text-red-700">${esc(ago(w.last_failure))}</span>` : '<span class="text-outline">none recorded</span>'}</dd>
            <dt title="A run that finished but left a claimed step undone. Tracked separately because it is not a failure and the workflow will not tell you about it.">Last half-delivered</dt>
            <dd>${w.last_partial ? `<span class="text-red-700">${esc(ago(w.last_partial))}</span>` : '<span class="text-outline">none recorded</span>'}</dd>
            <dt>Last success</dt><dd>${w.last_success ? esc(ago(w.last_success)) : '<span class="text-outline">none recorded</span>'}</dd>
          </dl>
          ${drift ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm" style="margin-top:12px"><span class="material-symbols-outlined">warning</span>
            <div>This screen and the view disagree about this workflow's 30-day rate. The view reports
            <span class="font-label-numeric-sm">The success rate it publishes</span> ${esc(viewRate30 == null ? 'null' : pct(viewRate30))}; the same arithmetic run here over
            <span class="font-label-numeric-sm">successes_30d</span> and <span class="font-label-numeric-sm">effective_runs_30d</span> gives ${esc(r30 == null ? 'no rate' : pct(r30))}.
            Both are meant to be successes over qualifying runs, so one of them has drifted from <span class="font-label-numeric-sm">NEXUS’s own rule for what a run achieved</span>.
            Neither figure should be relied on until somebody says which — the difference is shown rather than resolved, because picking one silently
            is what this screen was rebuilt to stop doing.</div></div>` : ''}
        </div>

        <div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">All time</div>
          <dl class="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2 font-body-sm text-body-sm [&_dt]:text-outline" style="margin-top:8px">
            <dt>Runs</dt><dd class="font-label-numeric-sm">${w.runs == null ? '<span class="text-outline">—</span>' : num(w.runs)}</dd>
            <dt title="${esc(OUTCOME_WORDS.FAILURE.blurb)}">Failures</dt><dd class="font-label-numeric-sm">${w.failures == null ? '<span class="text-outline">—</span>' : num(w.failures)}</dd>
            <dt title="${esc(OUTCOME_WORDS.ESCALATED.blurb)}">Escalations</dt><dd class="font-label-numeric-sm">${w.escalations == null ? '<span class="text-outline">—</span>' : num(w.escalations)}</dd>
            ${/* All-time is the view's own figure and is labelled as such. There
                  is no all-time successes column to recompute it from, and this
                  screen does not fabricate one out of runs minus failures — that
                  subtraction is the exact arithmetic the 31 Aug rebuild removed,
                  and all-time is precisely where nobody would notice it. */ ''}
            <dt>Success rate</dt><dd class="font-label-numeric-sm">${
              rAll == null
                ? '<span class="text-zinc-600">no rate</span><div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">nothing has qualified for one — every logged run was refused by design or escalated, or nothing was logged at all</div>'
                : `${esc(pct(rAll))}<div class="font-body-sm text-body-sm text-on-surface-variant">reported by the view as <span class="font-label-numeric-sm">success_rate</span>, over the same definition as the 30-day figure. There is no all-time successes column, so this one is not recomputed here and the two cannot be cross-checked.</div>`}</dd>
            <dt>Last run</dt><dd>${w.last_run ? esc(ago(w.last_run)) : '<span class="text-outline">never logged</span>'}</dd>
          </dl>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">All-time counts start from the day each workflow gained an Audit Log node, not from the day it was built, so they understate anything older than instrumentation.</div>
        </div>

        <div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Recent logged runs</div>
          ${auditErr
            ? stateError('this workflow’s run history', auditErr)
            : history.length
              ? `<div class="flex flex-col gap-space-sm" style="margin-top:8px">${history.slice(0, 25).map(a => `
                  <div class="flex gap-3">
                    <span class="w-2 h-2 rounded-full bg-outline mt-1.5 shrink-0" style="background:var(--${runDot(a)})"></span>
                    <div class="flex-1 min-w-0">
                      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        ${a.status ? outcomePill(a) : pill('No status written', 'unknown', { verbatim: false })}
                        <span class="font-body-sm text-body-sm text-on-surface-variant">${esc(ago(a.logged_at))}</span>
                        ${a.lead_name ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(maskText(a.lead_name))}</span>` : ''}
                      </div>
                      <div class="font-label-numeric-sm text-[11px] text-outline" style="white-space:normal">${esc(String(a.summary || 'No summary written.').slice(0, 240))}</div>
                    </div>
                  </div>`).join('')}</div>
                 <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:10px;white-space:normal">${num(history.length)} run${history.length === 1 ? '' : 's'} for this workflow inside the ${num(AUDIT_LIMIT)} most recent audit rows, matched on ${esc(known)}.</div>`
              : (w.writes_audit_log
                  ? stateEmpty('No runs in the loaded window',
                      `This workflow writes to the activity log but none of the ${AUDIT_LIMIT} most recent rows belong to it.`, 'history')
                  : answers
                    ? stateEmpty('No history, by design',
                        `This endpoint returns its result to whoever called it rather than logging, so it will never appear in the activity log. ${answers.where} shows the outcome of each call at the moment it is made; nothing is retained for it here, and this screen cannot say how it has been behaving.`, 'sync_alt')
                    : stateEmpty('Not instrumented',
                        'This workflow has no Audit Log node, so it will never appear in the activity log no matter how often it runs.', 'visibility_off'))}
        </div>
      </div>
      <div class="p-space-md bg-surface-container-lowest flex flex-wrap items-center gap-space-sm shrink-0 border-t border-outline-variant/40">
        <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold transition-colors shadow-sm whitespace-nowrap disabled:bg-outline-variant/40 disabled:text-outline disabled:cursor-not-allowed disabled:shadow-none" id="aRunDrawer" ${t.can ? '' : 'disabled'}
          title="${esc(t.can ? 'Starts this automation the same way it normally starts itself, signed in as you. The dashboard is not reaching around it — it is doing what the caller would do.' : t.why)}">${esc(t.label)}</button>
        <button class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" disabled
          title="The dashboard cannot stop a run that is already going. Starting one is the only thing it can do; nothing in it can stop or retry one, and that is a deliberate limit rather than a missing button — stopping a run needs a credential that would have to be shipped into this browser to be used here, and anything shipped to a browser is public. Ask NEXUS support to stop a run.">Stop a run</button>
        ${t.hook && !t.can && SUBJECT_SCREEN[t.hook]
          ? `<button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aGoSubject">Open ${esc(SUBJECT_SCREEN[t.hook].title)}</button>`
          : ''}
      </div>`);
    $('aClose').addEventListener('click', closeDrawer);
    if (t.can) $('aRunDrawer').addEventListener('click', () => confirmRun(w));
    if (t.hook && !t.can && SUBJECT_SCREEN[t.hook]) {
      $('aGoSubject').addEventListener('click', () => go(SUBJECT_SCREEN[t.hook].id));
    }
  }

  /* ── Firing a workflow by hand ─────────────────────────────────────────── */
  /* The dialog names the exact path and the exact body before the irreversible
     click, and afterwards it says plainly that nothing on this screen will move
     until the workflow writes an audit row — a confirmation that implied the
     list had updated would be the same kind of lie this rebuild removed. */
  function confirmRun(w) {
    const t = triggerState(w);
    if (!t.can) return;
    const m = openModal(`${t.label} — ${w.name || 'workflow'}`, `
      <div class="flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950 font-body-sm text-body-sm">
        <span class="material-symbols-outlined">bolt</span>
        <div>This starts <span class="font-label-numeric-sm">${esc(w.name || t.hook)}</span>, signed in as you.
        The automation decides what it does; this dashboard does not choose records for it.</div>
      </div>
      <dl class="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2 font-body-sm text-body-sm [&_dt]:text-outline">
        <dt>Workflow</dt><dd>${esc(w.name || '—')}</dd>
        <dt>Category</dt><dd>${esc(w.category || 'Uncategorised')}</dd>
        <dt>Webhook</dt><dd class="font-label-numeric-sm">${esc(t.hook)}</dd>
        <dt>Body</dt><dd class="font-label-numeric-sm">{}</dd>
        <dt>Last run</dt><dd>${w.last_run ? esc(ago(w.last_run)) : 'never logged'}</dd>
        <dt>30-day health</dt><dd>${esc(healthLabel(w))}<div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${esc(healthOf(w).detail)}</div></dd>
        <dt>30-day success rate</dt><dd>${(() => {
          const r = rate30(w);
          return r == null
            ? `<span class="text-zinc-600">no rate</span><div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${esc(noRateWhy(w))}</div>`
            : `${esc(pct(r))}<div class="font-body-sm text-body-sm text-on-surface-variant">${num(n0(w.successes_30d) || 0)} of ${num(n0(w.effective_runs_30d) || 0)} qualifying runs succeeded outright</div>`;
        })()}</dd>
      </dl>
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:12px;white-space:normal">
        The counts on this screen come from the activity log. They will not change until the workflow writes a row and the screen is reloaded.
      </div>
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">
        This run is capped at ${CEILING_SECONDS / 60} minutes of wall-clock time like every other execution on the instance. If it hits that ceiling it is stopped
        and recorded as a failure with its data saved — the dashboard cannot stop it early, and there is no endpoint here that could.
      </div>`,
      `<button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold transition-colors shadow-sm whitespace-nowrap disabled:bg-outline-variant/40 disabled:text-outline disabled:cursor-not-allowed disabled:shadow-none" id="aGo">${esc(t.label)}</button>
       <button class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aCancel">Cancel</button>`);

    m.wrap.querySelector('#aCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#aGo').addEventListener('click', async ev => {
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = 'Running…';
      m.msg('<span class="text-outline">Waiting for the workflow to answer…</span>');
      try {
        const res = await n8n(t.hook, {});
        const line = res && typeof res === 'object'
          ? String(res.message || res.status || res.raw || 'accepted')
          : 'accepted';
        m.msg(`<span class="text-emerald-700">${esc(t.hook)} answered: ${esc(String(line).slice(0, 200))}</span>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px">Reload this screen once the workflow has written its audit row to see the counts move.</div>`);
        btn.textContent = 'Ran';
      } catch (e) {
        modalError(m, e);
        btn.disabled = false; btn.textContent = t.label;
      }
    });
  }

  /* ── Activity log ──────────────────────────────────────────────────────── */
  if (!audit) {
    logCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Activity log</div></div></div>
      ${stateError('the activity log', auditErr)}`;
  } else {
    /* The log is filtered by outcome, not by the status word a workflow happened
       to write. That is the same change the counts above went through and it has
       to be the same here, or the filters would disagree with the KPI over the
       same rows: five Finance Calc runs say FAILED and are partial deliveries,
       and a "FAILED" segment would put them somewhere the numbers above do not.
       The old segment list was a hand-kept table of status words with an "Other"
       bucket at the end, and PARTIAL sat in Other counting toward nothing for
       weeks. There is no Other any more — UNKNOWN is a defined outcome and it is
       filed as one. */
    const OUTCOME_ORDER = [OUTCOME.SUCCESS, OUTCOME.PARTIAL, OUTCOME.FAILURE, OUTCOME.NO_RESULT,
                           OUTCOME.REJECTED_EXPECTED, OUTCOME.ESCALATED, OUTCOME.UNKNOWN];
    const oCount = o => audit.filter(a => a.status && outcomeOf(a) === o).length;
    const unset = audit.filter(a => !a.status).length;
    /* The red banner below counts failures and partials together, because both
       are runs whose work did not land. It is named that way rather than
       "failed", so it cannot be read as a crash count. */
    const incomplete = audit.filter(a => a.status && isIncomplete(a));
    /* Runs whose summary reads like the five-minute ceiling stopping them rather
       than the workflow itself breaking. Since 24 Aug those executions are saved
       rather than discarded, so they arrive here in full. */
    const timedOut = audit.filter(looksTimedOut);
    /* Runs that completed without reaching the customer. */
    const undelivered = audit.filter(missedCustomer);

    const wfNames = [...new Set(audit.map(a => a.workflow).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));

    const segs = [['ALL', audit.length],
                  ...OUTCOME_ORDER.map(o => [o, oCount(o)]).filter(([, c]) => c > 0)];
    if (timedOut.length) segs.push(['TIMEOUT', timedOut.length]);
    if (unset) segs.push(['NONE', unset]);

    const lf = { status: 'ALL', wf: 'ALL', q: '' };

    logCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Activity log</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Every row <span class="font-label-numeric-sm">The activity log</span> holds for the ${num(AUDIT_LIMIT)} most recent runs, newest first. A run stopped by the ${CEILING_SECONDS / 60}-minute ceiling arrives here as a failure with its data kept, so failures on this list are two different findings and are labelled as such.${
          auditCapped ? ` <span class="text-amber-700">This read is capped at ${num(AUDIT_LIMIT)} rows, so anything older is not on this page.</span>` : ''}</div>
      </div></div>
      <div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40">
        <div class="seg inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-surface-container" id="aSegStatus" role="group" aria-label="Filter runs by status">
          ${/* Each segment is labelled and explained by lib/health.js, so the
                filter, the pill in the row and the count in the KPI strip above
                all use one vocabulary. */ ''}
          ${segs.map(([k, c], i) => {
            const known = OUTCOME_ORDER.includes(k);
            const label = k === 'ALL' ? 'All'
              : k === 'NONE' ? 'No status'
              : k === 'TIMEOUT' ? 'Hit the ceiling'
              : outcomeWords(k).label;
            const title = k === 'TIMEOUT'
              ? `Runs whose summary text reads as the ${CEILING_SECONDS / 60}-minute ceiling stopping them. The activity log has no reason column, so this is a reading of the summary, not something the database asserts. They also appear under their own outcome.`
              : k === 'NONE' ? 'Rows where the activity log holds no status at all. Nothing is claimed about these runs — a missing status is not a pass.'
              : known ? outcomeWords(k).blurb : '';
            return `<button data-s="${esc(k)}" class="px-3 py-1 rounded-md font-body-sm text-body-sm font-semibold text-on-surface-variant${i === 0 ? ' on' : ''}"${
              title ? ` title="${esc(title)}"` : ''}>${esc(label)} · ${num(c)}</button>`;
          }).join('')}
        </div>
        <div class="flex-1 min-w-[160px]"><input type="search" id="aLogQ" aria-label="Search the activity log"
          placeholder="Search workflow, customer, intent or summary" /></div>
        <select id="aLogWf" aria-label="Filter runs by workflow" style="width:auto">
          <option value="ALL">All workflows · ${num(audit.length)}</option>
          ${wfNames.map(n => `<option value="${esc(n)}">${esc(n)} · ${num(audit.filter(a => a.workflow === n).length)}</option>`).join('')}
        </select>
        <div class="font-label-numeric-sm text-outline" id="aLogCount"></div>
      </div>
      <div id="aLogTable"></div>`;

    /* Runs somebody has to look at. A refusal by design is deliberately not one:
       an unauthorised caller being turned away is the system working. A run that
       produced nothing usable IS one, which is the change — the version this
       replaced treated every REJECTED row as a fault and every PARTIAL that had
       been mislabelled FAILED as a crash. */
    const NEEDS_LOOKING_AT = [OUTCOME.FAILURE, OUTCOME.PARTIAL, OUTCOME.NO_RESULT, OUTCOME.UNKNOWN];
    const isBad = a => !!a.status && NEEDS_LOOKING_AT.includes(outcomeOf(a));

    const cols = [
      { label: 'Logged', render: a => `<span class="font-label-numeric-sm text-outline">${esc(clock(a.logged_at))}</span>
          <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(ago(a.logged_at))}</div>` },
      { label: 'Outcome', render: a => a.status
          ? `${outcomePill(a)}${
              looksTimedOut(a)
                ? `<div class="font-body-sm text-body-sm text-on-surface-variant" title="${esc(CEILING.onTimeout)}">Reads as the ${CEILING_SECONDS / 60}-minute ceiling stopping the run, not the workflow breaking</div>`
                : looksGuardRejected(a)
                  ? `<div class="font-body-sm text-body-sm text-on-surface-variant" title="${esc(GUARD_NOTE)}">Reads as the scrape guard refusing bad intel — the run completed, and it still produced no price</div>`
                  : missedCustomer(a)
                    ? `<div class="font-body-sm text-body-sm text-red-700" title="${esc(PARTIAL_NOTE)}">The run finished; the customer-facing step did not land</div>`
                    : isBad(a) ? '<div class="font-body-sm text-body-sm text-red-700">Needs investigation</div>' : ''}`
          : '<span class="text-outline">No status written — nothing is claimed about this run</span>' },
      { label: 'Workflow', strong: true, render: a => `${esc(a.workflow || 'Unnamed')}
          ${a.intent ? `<div class="font-body-sm text-body-sm text-on-surface-variant">${esc(a.intent)}</div>` : ''}` },
      /* Name, then the number to reach them on, then the email. The phone comes
         from `leads.phone` matched on the run's lead_email — audit_log itself
         carries no phone — and every way that lookup can come up empty is
         spelled out rather than rendered as a dash. */
      { label: 'Customer', render: a => a.lead_name || a.lead_email
          ? `${esc(maskText(a.lead_name || 'Name not recorded on this run'))}
             <div class="font-body-sm text-body-sm text-on-surface-variant">${phoneLine(a.lead_email)}</div>
             <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(maskText(a.lead_email || 'no email on the row'))}</div>`
          : '<span class="text-outline">Not a per-customer run</span>' },
      { label: 'Score', align: 'r', render: a => n0(a.lead_score) == null ? '<span class="text-outline">—</span>' : num(a.lead_score) },
      { label: 'Summary', render: a => a.summary
          ? `<span class="${looksGuardRejected(a) ? 't-warm' : isBad(a) ? 't-hot' : ''}" style="white-space:normal">${esc(dealerSummary(a.summary).slice(0, 200))}</span>`
          : '<span class="text-outline">No summary written</span>' },
    ];

    const th = logCard.querySelector('#aLogTable');
    const cnt = logCard.querySelector('#aLogCount');

    const visibleLog = () => {
      const q = lf.q.trim().toLowerCase();
      return audit.filter(a => {
        if (lf.status === 'NONE') { if (a.status) return false; }
        else if (lf.status === 'TIMEOUT') { if (!looksTimedOut(a)) return false; }
        /* Every remaining filter is an outcome, matched through the canonical
           layer rather than against the raw status word — so filtering to
           "Partly landed" catches the five Finance Calc rows that say FAILED,
           which is the whole reason the segments were changed. */
        else if (lf.status !== 'ALL') { if (!a.status || outcomeOf(a) !== lf.status) return false; }
        if (lf.wf !== 'ALL' && a.workflow !== lf.wf) return false;
        if (!q) return true;
        /* The redacted summary, not the raw one: a search that matched text the
           reader cannot see would return rows for no visible reason. */
        return [a.workflow, a.lead_name, a.lead_email, a.intent, dealerSummary(a.summary), a.status]
          .some(v => low(v).includes(q));
      });
    };

    function drawLog() {
      if (!audit.length) {
        cnt.textContent = '';
        th.innerHTML = stateEmpty('No runs logged yet',
          'Only workflows with an Audit Log node write here. Until one runs, this stays empty — an empty log is not evidence that nothing ran.', 'receipt_long');
        return;
      }
      const vis = visibleLog();
      cnt.textContent = `${vis.length} of ${audit.length}`;
      th.innerHTML = table(cols, vis, {
        onRow: true,
        empty: stateEmpty('No run matches these filters',
          'Clear the search or pick another status or workflow.', 'filter_alt_off'),
      });
      wireRows(th, vis, openRun);
    }

    logCard.querySelectorAll('#aSegStatus button').forEach(b => b.addEventListener('click', () => {
      logCard.querySelectorAll('#aSegStatus button').forEach(x => x.classList.toggle('on', x === b));
      lf.status = b.dataset.s; drawLog();
    }));
    logCard.querySelector('#aLogQ').addEventListener('input', e => { lf.q = e.target.value; drawLog(); });
    logCard.querySelector('#aLogWf').addEventListener('change', e => { lf.wf = e.target.value; drawLog(); });

    focusLog = (status = 'ALL', wf = 'ALL') => {
      lf.status = status; lf.wf = wf; lf.q = '';
      logCard.querySelector('#aLogQ').value = '';
      logCard.querySelector('#aLogWf').value = wf;
      logCard.querySelectorAll('#aSegStatus button').forEach(x => x.classList.toggle('on', x.dataset.s === status));
      drawLog();
      logCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    /* The failure banner is placed after the log is wired so its button can hand
       over a filter that really exists. Its count is the failures actually
       loaded here, which is a narrower claim than the 30-day KPI above and is
       worded that way. */
    if (incomplete.length) {
      const failed = incomplete.filter(a => outcomeOf(a) === OUTCOME.FAILURE).length;
      const half = incomplete.length - failed;
      const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-red-200 bg-red-50/40 text-red-950 font-body-sm text-body-sm');
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">report</span>
        <div style="flex:1"><strong>${num(incomplete.length)} logged run${incomplete.length === 1 ? '' : 's'} did not land.</strong>
        ${num(failed)} failed outright and ${num(half)} finished with a claimed step undone.
        Counted across the ${num(audit.length)} most recent audit rows loaded here, not the 30-day window used by the health figures above.
        ${timedOut.length
          ? `<div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal"><strong>${num(timedOut.length)} of them read as the ${CEILING_SECONDS / 60}-minute ceiling stopping the run</strong> rather than the workflow breaking. Filter to “Hit the ceiling” below to see them. The activity log records no reason, so this is read off the summary text; NEXUS can confirm it against the run itself.</div>`
          : ''}</div>
        <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowFailed">Show the failures</button>`;
      banners.appendChild(b);
      b.querySelector('#aShowFailed').addEventListener('click', () => focusLog(OUTCOME.FAILURE));
    }

    /* Separate from the banner above, and red rather than amber, because a
       customer who was promised something and never got it is not a milder
       finding than a crash — it is the finding this screen used to paint green.
       The two are split because they are different repairs, not different
       severities. */
    if (undelivered.length) {
      const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-red-200 bg-red-50/40 text-red-950 font-body-sm text-body-sm');
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">forward_to_inbox</span>
        <div style="flex:1"><strong>${num(undelivered.length)} logged run${undelivered.length === 1 ? '' : 's'} completed without reaching the customer.</strong>
        ${esc(PARTIAL_NOTE)}
        Counted across the ${num(audit.length)} most recent audit rows loaded here, not the 30-day window used by the health figures above.</div>
        <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowPartial">Show them</button>`;
      banners.appendChild(b);
      b.querySelector('#aShowPartial').addEventListener('click', () => focusLog(OUTCOME.PARTIAL));
    }

    /* The third banner this section needed and did not have. A run that produced
       nothing usable is neither a failure nor a delivery, so before 31 Aug it
       appeared nowhere on the screen at all except as an unremarked row in the
       log — 84 of the 96 Competitor Price Scraping runs in the window are this. */
    const nothing = audit.filter(a => a.status && outcomeOf(a) === OUTCOME.NO_RESULT);
    if (nothing.length) {
      const one = nothing.length === 1;
      const b = el('div', 'flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm');
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">do_not_disturb_on</span>
        <div style="flex:1"><strong>${num(nothing.length)} logged run${one ? '' : 's'} finished and produced nothing usable.</strong>
        ${esc(OUTCOME_WORDS.NO_RESULT.blurb)} Nothing excuses these from the rate: they count against it in full. A refusal by design is left out of the denominator because the workflow was never expected to deliver; a run that simply came back empty was.
        Counted across the ${num(audit.length)} most recent audit rows loaded here, not the 30-day window used by the health figures above.</div>
        <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aShowNoResult">Show ${one ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#aShowNoResult').addEventListener('click', () => focusLog(OUTCOME.NO_RESULT));
    }

    drawLog();
  }

  /* ── Integration probes ────────────────────────────────────────────────── */
  /* Real probes only. A hardcoded green dot next to a dead WhatsApp session is
     the one component on this screen that can cause a worse outcome than having
     no screen at all. Anything we cannot probe says so. */
  intg.innerHTML = `<div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:12px">Integration status</div><div id="intgRow">${stateLoading(1)}</div>`;
  renderIntegrations($('intgRow'));

  /* ── Writers not registered ──────────────────────────────────────────────
     Added 7 Oct 2026, from v_audit_unregistered_writers. Every health figure
     above is driven by the automation register, so a workflow that writes to
     the activity log under a name the register does not know is invisible to
     all of them — its failures are counted nowhere. This lists those names
     rather than registering them: a register row must carry a real workflow,
     and inventing one to make the list empty would put a fabricated row into
     the one table whose value is that it mirrors what is deployed. The
     `disposition` column is the view's own account of each and is printed
     verbatim. Fixing one is NEXUS's job; this panel is how a dealership sees it. */
  panel(root, {
    title: 'Writers not registered', icon: 'shield_lock',
    sub: 'Names that appear in the activity log but not in the automation register, so no health figure on this '
       + 'screen counts them',
    load: () => db('v_audit_unregistered_writers?select=workflow_written_in_audit_log,audit_rows,audit_rows_30d,'
      + 'first_written_at,last_written_at,statuses_seen,disposition&order=last_written_at.desc&limit=100'),
    render: rows => {
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        return stateEmpty('Every writer to the activity log is registered',
          'Every name in this dealership’s activity log matches a workflow in the automation register, so the health '
          + 'figures above count all of them.', 'task_alt');
      }
      return table([
        { label: 'Name in the activity log', strong: true, render: w => `<span class="font-label-numeric-sm">${esc(String(w.workflow_written_in_audit_log || '(empty)'))}</span>` },
        { label: 'Rows (30 days / all)', align: 'r', render: w => `${esc(num(w.audit_rows_30d))} / ${esc(num(w.audit_rows))}` },
        { label: 'Last written', render: w => `<span title="first ${esc(String(w.first_written_at || 'not recorded'))}">${esc(ago(w.last_written_at))}</span>` },
        { label: 'Statuses seen', render: w => (Array.isArray(w.statuses_seen) && w.statuses_seen.length
            ? w.statuses_seen.map(x => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(String(x))}</span>`).join(' ')
            : '<span class="text-outline">none recorded</span>') },
        { label: 'What this is', render: w => `<div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${esc(String(w.disposition || 'The view records no disposition for this name.'))}</div>` },
      ], list) + `<div class="font-body-sm text-body-sm text-on-surface-variant" style="padding:12px 16px;white-space:normal">These are not errors on their own.
        They are runs whose outcome nothing on this screen measures. Quote the name to NEXUS support to have it
        registered or retired.</div>`;
    },
  });

  /* ── Business view: one card per automation, in plain words ──────────────
     automation-action-engine-pipeline-drawer--9c8237 "rule cards". Every figure
     on a card is a column of v_workflow_health for this dealership's own
     record; the export's "Evaluated / Actions / Exceptions" are NOT copied,
     because nothing records an evaluation or an action separately from a run —
     the card says runs, successes and failed-or-partial, which are measured.
     Public pages NEXUS serves are not automations and are left off the cards
     (they stay in the technical register). */
  const plainName = w => String(w.name || 'Unnamed automation')
    .replace(/^wf_\d+\s*/i, '').replace(/\s+-\s+AI Agent$/i, '').replace(/\s+—\s+NOT LIVE \(candidate\)$/i, '')
    .replace(/\s*\((?:Phase \d+|WhatsApp Cloud|Meta|Dashboard Reply)\)\s*$/i, '').replace(/^NEXUS\s+/, '').trim();
  const notLive = w => /NOT LIVE|candidate/i.test(String(w.name || ''));
  const AUTO_ICON = { Lead: 'person_search', Comms: 'chat', CRM: 'corporate_fare', AI: 'smart_toy', Finance: 'calculate',
    Compliance: 'badge', Marketing: 'campaign', Pricing: 'price_change', Assets: 'directions_car', Ops: 'settings' };
  const cardRows = rows.filter(w => stateKey(w) !== 'PUBLIC_PAGE');
  const metricCell = (k, v, cls) => `<div class="flex flex-col"><span class="font-table-header text-[10px] uppercase tracking-wider text-outline font-semibold">${esc(k)}</span>`
    + `<span class="font-label-numeric-md text-label-numeric-md font-bold ${cls || 'text-on-surface'}">${v}</span></div>`;
  const paintBiz = () => {
    const headHtml = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm">
        <div class="flex items-start gap-2.5 min-w-0"><span class="material-symbols-outlined text-primary text-xl mt-0.5">bolt</span>
          <div class="min-w-0"><h2 class="font-headline-md text-headline-md text-on-surface">Automations</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">What each one does for this dealership, and what its last 30 days of runs show. Open a card for its pipeline.</p></div></div>
        <span class="font-label-numeric-sm text-label-numeric-sm text-outline">${health ? `${num(cardRows.length)} automations` : ''}</span></div>`;
    if (!health) { bizCard.innerHTML = headHtml + `<div class="p-space-md">${stateError('the automations', healthErr)}</div>`; return; }
    if (!cardRows.length) {
      bizCard.innerHTML = headHtml + `<div class="p-space-md">${stateEmpty('No automation is registered', 'The automation health figures returned no automation for this dealership, so there is nothing to show here.', 'account_tree')}</div>`;
      return;
    }
    bizCard.innerHTML = headHtml + `<div class="p-space-md grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md">${cardRows.map((w, i) => {
      const h = healthOf(w);
      const r30 = rate30(w);
      const inc = incomplete30(w);
      return `<div class="p-space-md rounded-lg border border-outline-variant/60 bg-surface-container-lowest flex flex-col gap-3 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined text-[20px]">${esc(AUTO_ICON[w.category] || 'bolt')}</span></span>
            <div class="min-w-0"><div class="font-body-md text-body-md font-semibold text-on-surface">${esc(plainName(w))}</div>
              <div class="font-label-numeric-sm text-[11px] text-outline">${esc(w.category || 'Uncategorised')}${notLive(w) ? ' · not live' : ''}</div></div></div>
          <span class="shrink-0">${wordPill(healthLabel(w), h.tone, h.detail)}</span></div>
        <div class="p-2.5 rounded bg-surface-container-low"><div class="font-table-header text-[10px] uppercase tracking-wider text-outline font-semibold">What it does</div>
          <div class="font-body-sm text-body-sm text-on-surface mt-0.5">${esc(dealerSummary(w.description) || 'The automation register holds no description for this one.')}</div></div>
        <div class="grid grid-cols-3 gap-2">
          ${metricCell('Runs · 30d', n0(w.runs_30d) == null ? '—' : num(w.runs_30d))}
          ${metricCell('Succeeded', n0(w.successes_30d) == null ? '—' : num(w.successes_30d), 'text-emerald-700')}
          ${metricCell('Failed / partial', num(inc), inc ? 'text-red-700' : 'text-on-surface')}
        </div>
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/30">
          <span class="font-body-sm text-body-sm text-on-surface-variant">${r30 == null ? 'No success rate — nothing qualified' : `${esc(pct(r30))} succeeded`}${w.last_run ? ` · last ${esc(ago(w.last_run))}` : ' · never ran'}</span>
          <button type="button" data-biz="${i}" class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors whitespace-nowrap">View pipeline<span class="material-symbols-outlined text-[16px]">chevron_right</span></button>
        </div></div>`;
    }).join('')}</div>`;
    bizCard.querySelectorAll('[data-biz]').forEach(b => b.addEventListener('click', () => openPipeline(cardRows[Number(b.dataset.biz)])));
  };

  /* The pipeline drawer: Trigger → Eligibility → Action → Outbound → Result →
     Audit, with a count ONLY where a column measures that step. Action and
     Outbound are not recorded separately from the run anywhere this dealership
     can read, so they say "not recorded" rather than borrowing the run count —
     a step that shows the same number as the one before it is a step nobody
     measured. */
  function openPipeline(w) {
    if (!w) return;
    const h = healthOf(w);
    const v = x => (n0(x) == null ? null : num(x));
    const steps = [
      { name: 'Trigger', count: v(w.runs_30d), unit: 'runs started in 30 days',
        why: 'Counted from this dealership’s activity log: one row per run.' },
      { name: 'Eligibility', count: v(w.effective_runs_30d), unit: 'runs expected to deliver',
        why: `Runs refused by design (${v(w.rejected_30d) ?? '—'}) and handed to a person on purpose (${v(w.escalated_30d) ?? '—'}) are left out.` },
      { name: 'Action', count: null, unit: '', why: 'Not recorded separately from the run. No figure is shown rather than one copied from the step above.' },
      { name: 'Outbound', count: null, unit: '', why: 'Whether a message or update left NEXUS is not recorded per run on a surface this screen can read.' },
      { name: 'Result', count: v(w.successes_30d), unit: 'succeeded',
        why: `Failed ${v(w.failures_30d) ?? '—'} · partial ${v(w.partials_30d) ?? '—'} · produced nothing ${v(w.no_result_30d) ?? '—'} · outcome unreadable ${v(w.unknown_30d) ?? '—'}.` },
      { name: 'Audit', count: w.writes_audit_log === false ? null : v(w.runs_30d), unit: 'activity-log rows',
        why: w.writes_audit_log === false ? 'This automation does not write to the activity log, so nothing here is evidence about it.' : 'Every run above is a row in the activity log, readable from the activity panel on this screen.' },
    ];
    openDrawer(`
      <div class="px-space-lg py-space-md flex items-start justify-between gap-space-sm bg-surface-container-lowest shadow-sm shrink-0">
        <div class="min-w-0"><div class="flex items-center gap-2 flex-wrap">${wordPill(healthLabel(w), h.tone, h.detail)}<span class="font-label-numeric-sm text-[11px] text-outline">${esc(w.category || 'Uncategorised')}</span></div>
          <h2 class="font-headline-md text-headline-md font-bold text-on-surface mt-1">Automation pipeline — ${esc(plainName(w))}</h2>
          <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(dealerSummary(w.description) || 'No description in the automation register.')}</div>
          <div class="font-label-numeric-sm text-[11px] text-outline mt-1">${w.last_run ? `Last run ${esc(ago(w.last_run))} · ${esc(clock(w.last_run))}` : 'Never ran for this dealership'}</div></div>
        <button type="button" id="aPipeClose" aria-label="Close" class="w-8 h-8 rounded-lg hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors"><span class="material-symbols-outlined text-[20px]">close</span></button>
      </div>
      <div class="flex-1 overflow-y-auto p-space-md space-y-space-md bg-surface-container-low/40">
        <div class="flex items-center justify-between"><span class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Sequential pipeline steps</span>
          <span class="font-label-numeric-sm text-[11px] text-outline">${steps.filter(x => x.count != null).length} of ${steps.length} measured</span></div>
        <ol class="flex flex-col gap-2">${steps.map((x, i) => `<li class="flex items-start gap-3 p-3 rounded-lg border ${x.count == null ? 'border-outline-variant/40 bg-surface-container-lowest' : 'border-outline-variant/70 bg-surface-container-lowest'}">
          <span class="w-6 h-6 rounded-full ${x.count == null ? 'bg-surface-container text-outline' : 'bg-primary text-on-primary'} flex items-center justify-center font-label-numeric-sm text-[12px] font-bold shrink-0">${i + 1}</span>
          <div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-2"><span class="font-body-sm text-body-sm font-semibold text-on-surface">${x.name}</span>
            <span class="font-label-numeric-sm text-[12px] ${x.count == null ? 'text-outline' : 'text-on-surface font-bold'}">${x.count == null ? 'Not recorded' : `${x.count} ${esc(x.unit)}`}</span></div>
            <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(x.why)}</div></div></li>`).join('')}</ol>
      </div>
      <div class="p-space-md bg-surface-container-lowest flex flex-wrap items-center gap-space-sm shrink-0 border-t border-outline-variant/40">
        <button type="button" id="aPipeFull" class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold transition-colors shadow-sm whitespace-nowrap"><span class="material-symbols-outlined text-[18px]">receipt_long</span>Full record & recent runs</button>
        <button type="button" disabled title="Nothing on this screen edits, simulates or re-runs an automation. Changing one is NEXUS's, on the automation host." class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed">Edit workflow parameters</button>
      </div>`);
    $('aPipeClose')?.addEventListener('click', closeDrawer);
    $('aPipeFull')?.addEventListener('click', () => openWorkflow(w));
  }
  paintBiz();

  /* Trust footer (states-components §7). */
  const trust = el('div');
  trust.innerHTML = trustFooter({
    source: 'Automation health figures · activity log',
    asOf: clock(Date.now()),
    evidence: health ? `${num(rows.length)} automations · ${audit ? `${num(audit.length)} log rows read${auditCapped ? ' (cap reached)' : ''}` : 'activity log unread'}` : 'Health figures unread',
    actor: actor(),
  });
  root.appendChild(trust);

  /* ── One logged run, in full ───────────────────────────────────────────── */
  function openRun(a) {
    if (!a) return;
    const outcome = outcomeOf(a);
    const words = outcomeWords(outcome);
    const guarded = looksGuardRejected(a);
    /* The red "this run did not complete" banner belongs only to a run that
       really did not complete. A scrape the guard refused completed and declined
       to write rubbish; a partial completed and left a step undone — both get
       their own banner below, saying the thing that is actually true of them. */
    const bad = outcome === OUTCOME.FAILURE;
    const undelivered = missedCustomer(a);
    const ceilingHit = looksTimedOut(a);
    const wf = (health || []).find(w => namesFor(w).has(low(a.workflow))) || null;
    openDrawer(`
      <div class="px-space-lg py-space-md flex items-start justify-between gap-space-sm bg-surface-container-lowest shadow-sm shrink-0">
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(a.workflow || 'Unnamed workflow')}</h2>
          <div class="font-body-sm text-body-sm text-on-surface-variant">Logged ${esc(ago(a.logged_at))} · ${esc(clock(a.logged_at))}</div>
        </div>
        <button class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aRunClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="flex-1 overflow-y-auto p-space-md space-y-space-md bg-surface-container-low/40">
        <div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Outcome</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${a.status ? outcomePill(a) : pill('No status written', 'unknown', { verbatim: false })}
            ${a.intent ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(a.intent)}</span>` : ''}
          </div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${
            a.status
              ? esc(words.blurb)
              : 'The activity log holds no status for this run, so nothing is claimed about it either way. A blank status is not a pass.'}</div>
          <div class="p-3 rounded-lg bg-surface-container-low border-l-4 border-outline-variant font-body-sm text-body-sm text-on-surface whitespace-pre-wrap break-words" style="margin-top:12px;white-space:pre-wrap">${esc(dealerSummary(a.summary) || 'The workflow wrote no summary for this run.')}</div>
          ${guarded ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm" style="margin-top:12px"><span class="material-symbols-outlined">shield</span>
            <div><strong>This run refused a scrape rather than failing — and came away with no price.</strong> ${esc(GUARD_NOTE)}</div></div>` : ''}
          ${ceilingHit ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm" style="margin-top:12px"><span class="material-symbols-outlined">timer_off</span>
            <div><strong>This reads as the ${CEILING_SECONDS / 60}-minute ceiling stopping the run.</strong> ${esc(CEILING.onTimeout)}
            <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">The activity log records a status and a summary but no reason code, so this is read off the summary text above.
            The execution itself is the place that says for certain.</div></div></div>` : ''}
          ${undelivered ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-red-200 bg-red-50/40 text-red-950 font-body-sm text-body-sm" style="margin-top:12px"><span class="material-symbols-outlined">forward_to_inbox</span>
            <div><strong>This run completed, but its customer-facing step did not land.</strong> ${esc(PARTIAL_NOTE)}${
              up(a.status) !== outcome
                ? `<div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px;white-space:normal">This row's own status says <span class="font-label-numeric-sm">${esc(a.status)}</span>. It is counted as a partial delivery because its summary states which claimed steps did not land, and that structured phrase is the more specific evidence. The classification is made once, by NEXUS’s own rule for what a run achieved, so the counts above and this drawer cannot disagree about it.</div>`
                : ''}</div></div>` : ''}
          ${bad ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-red-200 bg-red-50/40 text-red-950 font-body-sm text-body-sm" style="margin-top:12px"><span class="material-symbols-outlined">error</span>
            <div>This run did not complete. What it was trying to do, and what did not get done, is above. Where inside the automation it stopped is NEXUS's to diagnose and is not shown here — report the run by its workflow and time and NEXUS can find it.</div></div>` : ''}
        </div>
        <div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Subject</div>
          <dl class="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2 font-body-sm text-body-sm [&_dt]:text-outline" style="margin-top:8px">
            <dt>Customer</dt><dd>${a.lead_name ? esc(maskText(a.lead_name)) : '<span class="text-outline">not a per-customer run</span>'}</dd>
            <dt>Phone</dt><dd>${phoneLine(a.lead_email)}</dd>
            <dt>Email</dt><dd>${a.lead_email ? esc(maskText(a.lead_email)) : '<span class="text-outline">—</span>'}</dd>
            <dt>Lead score</dt><dd class="font-label-numeric-sm">${n0(a.lead_score) == null ? '<span class="text-outline">—</span>' : num(a.lead_score)}</dd>
          </dl>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">The phone number is read from <span class="font-label-numeric-sm">The phone number on the lead record</span> matched on this run's email — The activity log carries no phone of its own.
          No member of staff appears here at all: <span class="font-label-numeric-sm">users</span> has no phone column, so whoever owns this workflow has no number recorded anywhere the dashboard can read.</div>
        </div>
        <div class="mb-space-md">
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Workflow</div>
          ${wf
            ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
                 ${wordPill(healthLabel(wf), healthOf(wf).tone, healthOf(wf).detail)}
                 <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(wf.category || 'Uncategorised')}</span>
               </div>
               <div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">${esc(wf.description || 'No description in the automation register.')}</div>`
            : `<div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:8px;white-space:normal">No registered workflow claims the name
               <span class="font-label-numeric-sm">${esc(a.workflow || '')}</span>, so this run is not counted in any health figure on this screen.</div>`}
        </div>
      </div>
      <div class="p-space-md bg-surface-container-lowest flex flex-wrap items-center gap-space-sm shrink-0 border-t border-outline-variant/40">
        ${wf ? '<button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" id="aOpenWf">Open workflow</button>' : ''}
        <button class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" disabled
          title="The dashboard cannot re-run this. Nothing here can start, stop or retry a workflow run on your behalf — retrying is NEXUS's, on the automation host.">Retry this run</button>
        ${/* Was a deep link into the vendor's n8n whenever the summary carried
              an execution URL. Removed 5 Sep 2026: CONTROL-PLANE.md 5.4. The
              control stays visible and refused rather than disappearing, so
              nobody is left wondering whether it exists. */ ''}
        <button class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors whitespace-nowrap disabled:text-outline disabled:cursor-not-allowed" disabled
          title="Inspecting the run inside the automation is NEXUS's, not this dashboard's. Quote the workflow name and the time above to NEXUS support and they can open it.">Inspect this run</button>
      </div>`);
    $('aRunClose').addEventListener('click', closeDrawer);
    if (wf) $('aOpenWf').addEventListener('click', () => openWorkflow(wf));
  }
};
