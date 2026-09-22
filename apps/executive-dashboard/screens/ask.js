/* NEXUS OS — screens/ask.js
   The RAG console. One question box, one honest thread.

   Ask AI is the least reliable surface in this product and the history of this
   file is the history of that: the webhook has been dead behind CORS, dead
   behind a missing Authorization allow-list, and dead behind three OpenRouter
   models that no longer existed. A single retrieval + model round trip on this
   box has been measured at 8.8 s. Since 24 Aug the workflow does have an upper
   bound — every workflow on the instance carries `executionTimeout: 300` — but
   five minutes is far longer than an operator will sit in front of a question,
   so this screen still keeps its own, much shorter, deadline.
   So this screen is built around waiting and failing rather than around the
   happy path:

     · the working state is a live elapsed counter, because a spinner that never
       moves is indistinguishable from a hung tab,
     · a client-side deadline turns "hung forever" into a stated timeout the
       operator can act on — and if the answer arrives afterwards it is still
       rendered, labelled late, because a real answer must never be thrown away,
     · every failure is classified into what actually broke (unreachable host,
       rejected JWT, no webhook registered, workflow error), since "Failed to
       fetch" told nobody anything,
     · the raw payload is one click away on every turn, so an operator can see
       exactly what the workflow returned when it returns something odd.

   Nothing here is fabricated: the answer, the citations, the document count and
   the model name are printed only when the workflow sends them, and the
   knowledge-base counts and the run history come straight from Postgres.

   ── 24 Aug 2026: alerts, and the one thing this screen can get wrong ────────
   Every other screen fails loudly — a lead that did not save throws, a message
   that did not send comes back `status:'error'`. This one fails QUIETLY: a
   confident, fluent, completely ungrounded answer looks exactly like a good
   one. So the alerting here is not mainly about the endpoint being down (that
   is visible the moment you press Ask); it is about whether an answer can be
   trusted at all:

     · an EMPTY knowledge base means every answer is the model guessing, so the
       Ask button is disabled outright rather than left to produce fiction,
     · the FRESHNESS of that knowledge base cannot be established at all.
       `rag_documents` stores no timestamp of any kind — id, doc_title,
       source_file, section, page_number, content, search_vector is the whole
       table — so "nothing has been ingested for months" and "this was updated
       last week" are both sentences this screen is not entitled to say. It says
       the absence instead, in the composer line, the alert strip and under
       every citation list, because an answer drawn confidently from a
       superseded rate sheet is precisely this screen's failure mode,
     · an answer with NO CITATIONS is the model speaking for itself. It gets a
       different border, a different pill and its own banner, because the two
       must never be skim-read as the same thing,
     · the health of the ask-ai workflow is read from `v_workflow_health` rather
       than inferred from one operator's two failed questions.

   The alert strip also reads `v_needs_attention?screen=eq.ask`. That view has
   no branch that targets this screen today, so it returns nothing — the strip
   says that out loud instead of showing a reassuring empty box, because "the
   view found nothing wrong here" and "the view does not look here" are very
   different sentences and only one of them is true.

   It is also why this screen writes nothing to the nav badges. `lib/badges.js`
   owns every `.nav-badge`: it clears them all and repaints them from a single
   read of `v_needs_attention` on boot, every 60 s and on `visibilitychange`.
   A number written here from this screen's own alerts survived a minute at
   most, and could not be reproduced from the view afterwards — the sidebar said
   one thing while Ask AI was open and something else once it had been closed,
   which is how an operator learns to stop reading badges altogether. Almost
   everything this screen knows (an empty knowledge base, a DEGRADED workflow, a
   question that failed in this tab) is invisible to that view anyway, so it is
   stated in the strip below where each row can say where it came from — not
   compressed into a digit in the sidebar that nothing can explain.

   ── 31 Aug 2026: the screen started reading the grounding it was already sent ─
   On 30 Aug the Ask-AI workflow's Format Response node was rewritten to send
   the evidence behind every answer: which of the model's [S#] markers resolved
   to a retrieved section and which named nothing (`invalid_refs`), which numbers
   in the answer appear in none of the text the model was handed
   (`unsupported_figures`), which retrieved sections never reached the prompt
   (`dropped_from_prompt`), which were cut before it saw the end of them
   (`truncated_sources`), and one `state` naming what happened. This screen was
   written on 24 Aug against the older contract and read none of it. Every turn
   still got the same green "N sources cited" pill, including a turn whose own
   payload said a figure in it came from nowhere.

   That is not a hypothetical here. This system has already put a model-invented
   monthly instalment, 26-44% above the real one, in front of a customer. The
   lesson recorded from it was that "the model said something plausible" and
   "the model said something grounded" are different sentences, and only the
   second one is safe to repeat. `unsupported_figures` is the deterministic
   check built to tell them apart; it arrived on the wire and was thrown away.

   So a turn now carries one of FIVE verdicts, and green is the narrowest of
   them. `grounded()` is still the single place that decides — the pill, the
   border, the banners and the alert strip all read it, so they cannot disagree
   about the same answer — and it now reads the whole grounding object rather
   than counting the citation array:

     CLEAN     the workflow said `cited`, at least one marker resolved, and every
               one of its warning lists came back empty. Only this is green.
     DECLINED  the model answered NOT_IN_CONTEXT. `sources` is legitimately
               empty here, and the old code fired "Nothing was cited for this
               answer … do not repeat it" over the single most trustworthy thing
               this screen can produce. A refusal is now its own state, said
               plainly and not dressed up as a failure — the inverse error is
               what teaches an operator to ignore the amber banner.
     DEGRADED  the answer stands on less than the full evidence: no citation
               markers at all, sections retrieved but never sent to the model,
               a section the model saw only part of, or nothing retrieved.
     SEVERE    the answer contains, or claims support from, something the model
               was never given — an unsupported figure, a citation marker naming
               no section, a citation resolving to a section that never reached
               the prompt, or no model tier answering at all. This is the
               instalment failure, and the turn says do not repeat it.
     UNKNOWN   there was no grounding object. Never clean: a workflow that sent
               nothing has not told us the answer was fine, it has told us
               nothing, and an older Format Response is still a thing that can
               be deployed on that box.

   Two of those go past what the workflow itself flags. A [S#] marker is
   resolved upstream against EVERY retrieved section, including the ones that
   never fitted in the 8000-character prompt budget, so a model shown S1-S13 and
   writing [S14] gets a real document title rendered under its answer while that
   section's own `note` reads "The answer cannot have come from this section."
   That is a fabricated citation arriving pre-validated, and it is caught here.
   The other is the count itself: "N sources cited" means N distinct markers the
   MODEL emitted that resolved to a retrieved section. It is a count of the
   model's claims, not of verified support, and the screen now says so where the
   number is printed.

   One thing this screen cannot say, and therefore does not: whether the answer
   came from the primary model tier or the backup one. The workflow's error
   output falls through to a second three-model ladder, and Format Response
   cannot tell which node it was fed by — nothing in the payload marks a
   fallback. `model` names whichever model replied and is printed; a silent
   drop to the backup tier is invisible from here and is stated as unknown
   rather than guessed at from a hard-coded ladder that would drift. */
import { HOOK, db, n8n, onIdentityChange } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { ago, clock, esc, n0, num, pill, tone } from '../lib/format.js';
import { maskText } from '../lib/privacy.js';
import { HEALTH_WORDS, healthWords, isQualifying, isRefusal, isSuccess, outcomeOf, outcomeWords } from '../lib/health.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { panel, table } from '../lib/ui.js';

/* Long enough that a slow-but-working retrieval is not called a failure — the
   slowest verified end-to-end run was 8.8 s — short enough that a genuinely
   stuck request stops pretending. The request itself is not cancellable: n8n()
   owns the connection and exposes no abort, so this deadline reports, it does
   not kill. Anything that arrives later is still shown. */
const DEADLINE_MS = 45000;

/* The server-side bound, set in n8n on 24 Aug 2026: every workflow on the
   instance carries `executionTimeout: 300`, a hard five-minute wall-clock
   ceiling, added after two runaway executions took the instance's API latency
   from 0.34 s to 7.8 s. It matters here for one reason only — it is what
   finally ends a run this screen has already given up waiting for. The two
   numbers are not in competition: the browser stops WAITING at 45 s, n8n stops
   RUNNING at 300 s, and an answer that arrives in between is still rendered and
   marked late. This screen cannot read the setting back — v_workflow_health has
   no timeout column — so it is stated as the policy this build was written
   against rather than as something checked. */
const CEILING_SECONDS = 300;
const CEILING_LINE = `The run is stopped after ${CEILING_SECONDS / 60} minutes at the other end and kept, with its input, as a failed run. So a question that never comes back is bounded there rather than running forever, and what made it slow is still on file for NEXUS to look at.`;

/* Past this the operator has started to wonder whether the tab is dead, so the
   wait is promoted from a counter inside the turn to an alert at the top of the
   screen. Deliberately well above the 8.8 s good run: a normal answer must
   never raise an alert. */
const SLOW_MS = 15000;

/* Bounded reads. Where a cap is hit the screen says the number is a floor
   rather than letting a windowed count read as a total. */
const KB_LIMIT = 1000;
const AUDIT_LIMIT = 200;
const ATTN_LIMIT = 50;
/* Phone lookups are one small request per distinct lead, fired only when the
   run history actually names one. Capped so a busy history cannot turn this
   screen into a burst of requests at a box that has been crashed by load. */
const PHONE_LOOKUPS = 6;

/* History survives navigating to another screen and back, which is what makes
   it useful — it does not survive a reload, and the UI says so. Nothing is
   written to storage. */
const HISTORY = [];
let SEQ = 0;


/* ── Which render owns the screen ─────────────────────────────────────────
   HISTORY and SEQ are module state, which is the whole point: a question still
   in flight when the operator navigates away lands later, and turn ids stay
   stable so the next render of the screen recreates the same `#askE{id}` cards
   and the answer has somewhere to go.

   That is also how this screen used to lock itself solid. Ask a question,
   navigate away, come back inside the 45 s deadline: a NEW closure paints the
   thread and binds its buttons, then the OLD closure's request resolves and its
   `paint` finds the live `#askE1` BY ID, overwrites it, and rebinds every
   button to the old closure's handlers — whose `box` and `thread` are the
   previous render's nodes, detached from the document. "Edit question" then
   typed into a textarea nobody could see. "Ask again" was worse: it read the
   detached box, genuinely sent the question, wrote the new turn's card into the
   detached thread, and `paint` found no `#askE2` to fill — so nothing appeared,
   while `syncControls` (which DID look its controls up live) disabled the
   visible Ask button for 45 s with "A question is already running." A frozen
   screen with no visible cause, until a reload.

   `syncControls` had the right rule and only it followed it: look every node up
   at the moment of use. Two things make the rest follow it. Every node is now
   looked up per call here too — nothing is captured — and one render at a time
   OWNS the screen. A stale closure paints nothing; it hands its finished work
   to whichever render is live through the dispatchers below, so a late answer
   is still rendered, by the render that is actually on screen. */
let ACTIVE = null;
const repaint = e => { if (ACTIVE) ACTIVE.paint(e); };
const rethread = () => { if (ACTIVE) ACTIVE.thread(); };
const resync = () => { if (ACTIVE) { ACTIVE.sync(); ACTIVE.alerts(); } };

/* None of the three may survive a change of who is signed in, and until
   2 Sep 2026 all three did. Sign-out reloads the page, but an EXPIRED token
   does not: lib/data.js paints the login card over the running app and a
   successful sign-in from there re-boots in the same document, so HISTORY —
   questions, and the RAG answers to them — was still here for whoever signed
   in next.

   That is the worst thing on this screen to leave behind. An Ask AI answer is
   retrieved from `rag_documents` and quotes the dealership's own policy
   material; carried into another dealership's session it is one dealership's
   documents rendered inside another's, in a panel that looks exactly like their
   own history. RLS never sees it, because nothing is read — it is already in
   the page.

   SEQ and ACTIVE go with it for the reasons the block above gives: a turn
   counter left running has a new session's first question land in `#askE7`,
   and an ACTIVE left pointing at the previous session's render hands it a late
   answer to paint into a document it no longer owns.

   Registered after the three are declared, not beside HISTORY, so the reset can
   never read one of them before its initialiser has run. */
onIdentityChange(() => { HISTORY.length = 0; SEQ = 0; ACTIVE = null; });

const TIMED_OUT = { timedOut: true };
const wait = ms => new Promise(r => setTimeout(r, ms));
const secs = ms => (ms == null ? null : (ms / 1000).toFixed(1) + ' s');
const str = v => String(v == null ? '' : v).trim();
const low = v => str(v).toLowerCase();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* Never rejects, so a read that fails cannot surface as an unhandled rejection
   in the console instead of in the panel that is supposed to report it. */
const settled = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, err: e?.message || String(e) }));

/* A WhatsApp handle. A LID contains no phone digits at all, so it identifies
   nobody — it is rendered as a handle, in mono, and never as a person's name.
   audit_log.lead_name is written by the workflows, and the workflows have
   demonstrably written handles into name columns before now. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;
const isHandle = v => HANDLE.test(str(v));

/* rag_documents was read off the live database on 24 Aug 2026 and its complete
   column list is: id, doc_title, source_file, section, page_number, content,
   search_vector. This screen used to discover those names from a probe row
   because they were not guaranteed; they are now, so the probe is gone and the
   names are selected outright. What the probe cannot bring back is a date
   column, because THERE IS NONE — not created_at, not indexed_at, not
   updated_at. Freshness is not a hard question here, it is an unanswerable one,
   and the honest handling is to say so rather than to order by id and call the
   top row the newest. `content` is several kilobytes per section and
   `search_vector` is larger still; neither is ever displayed, so neither is
   fetched. */
const KB_COLS = 'id,doc_title,source_file,section,page_number';

/* ── Reading the workflow's reply ───────────────────────────────────────────
   The Ask-AI workflow has been rewritten more than once and its Format Response
   node has not always used the same key for the same thing. Read the shapes it
   has actually used and print nothing when none of them is present, rather than
   showing an empty bubble that reads like a broken answer. */
function answerText(res) {
  if (!res || typeof res !== 'object') return '';
  for (const k of ['answer', 'output', 'text', 'message', 'raw']) {
    const v = res[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}
function docCount(res) {
  if (!res || typeof res !== 'object') return null;
  for (const k of ['documents_consulted', 'doc_count', 'documents']) {
    const v = res[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
/* `sources` means ONE thing in the current contract, and the workflow's own
   comment is explicit about it: the blocks the model itself marked. Everything
   retrieval returned moved to `retrieved_sources` under a different key
   precisely so no renderer could mistake it for a citation. `citations` is the
   older key and is still read, because this screen cannot see which build of
   the workflow answered it.

   Every field the workflow records ABOUT a citation is carried through, not
   just the ones that print a title. `included_in_prompt` and `truncated` are
   how a citation gets checked rather than counted: a section the model never
   saw, or saw half of, is still a real document with a real page number and
   reads on screen exactly like a section it read end to end. */
function sourcesOf(res) {
  const raw = res && Array.isArray(res.sources) ? res.sources
    : res && Array.isArray(res.citations) ? res.citations : [];
  return raw.map(s => {
    /* The empty-string case used to take this branch and become a counted,
       titled citation rendered as "Untitled document". The current Format
       Response cannot emit one — `cited_refs` only holds refs that resolved —
       but an older build on that box is not something this screen can rule
       out, and a citation with no content in it is not a citation. */
    if (typeof s === 'string') return str(s) ? { title: str(s), unknown: false } : { unknown: true, blob: JSON.stringify(s) };
    if (!s || typeof s !== 'object') return { unknown: true, blob: String(s) };
    const norm = {
      title:   s.title ?? s.doc_title ?? s.document ?? null,
      section: s.section ?? null,
      page:    s.page_number ?? s.page ?? null,
      file:    s.source_file ?? s.file ?? null,
      snippet: typeof s.content === 'string' ? s.content
             : typeof s.chunk === 'string' ? s.chunk
             : typeof s.text === 'string' ? s.text : null,
      /* Provenance, all of it optional. `shown` is deliberately tri-state:
         false means the workflow SAID this section never reached the model,
         null means it did not say, and those are not the same claim. */
      ref:        str(s.ref) || null,
      shown:      typeof s.included_in_prompt === 'boolean' ? s.included_in_prompt : null,
      cut:        typeof s.truncated === 'boolean' ? s.truncated : null,
      charsFed:   n0(s.chars_fed),
      charsTotal: n0(s.chars_total),
      note:       str(s.note) || null,
    };
    /* An unrecognised citation shape is shown verbatim rather than silently
       dropped — a citation the operator cannot see is a citation they cannot
       check. */
    if (!norm.title && !norm.file && !norm.section) return { unknown: true, blob: JSON.stringify(s) };
    return norm;
  });
}

/* The grounding block, read defensively. Every field is optional and every one
   is allowed to arrive as the wrong type: this screen is talking to a workflow
   it cannot see the version of, and a payload that is half the current contract
   must degrade into "unknown", never into "clean". */
const EMPTY_GROUNDING = {
  present: false, state: '', method: '',
  citedRefs: [], invalidRefs: [], dropped: [], truncated: [], sentToModel: [],
  figures: [], retrievedCount: null,
};
const refList = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
function groundingOf(res) {
  const g = res && typeof res === 'object' ? res.grounding : null;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return EMPTY_GROUNDING;
  return {
    present: true,
    state: low(g.state),
    method: str(g.method),
    citedRefs:      refList(g.cited_refs),
    invalidRefs:    refList(g.invalid_refs),
    dropped:        refList(g.dropped_from_prompt),
    truncated:      refList(g.truncated_sources),
    sentToModel:    refList(g.sent_to_model),
    figures:        refList(g.unsupported_figures),
    retrievedCount: n0(g.retrieved_count),
  };
}

/* The five states this screen is prepared to say about an answer, worst first.
   `rank` orders them; `edge` is the left border of the turn card. Colour is
   never the only carrier — every one of these puts its verdict in words in the
   pill, and the two that matter put it in a banner as well. */
const VERDICTS = {
  severe:   { rank: 0, tone: 'hot',     edge: 'var(--hot)' },
  degraded: { rank: 1, tone: 'warm',    edge: 'var(--warm)' },
  unknown:  { rank: 2, tone: 'unknown', edge: 'var(--neutral)' },
  declined: { rank: 3, tone: 'cold',    edge: 'var(--neutral)' },
  clean:    { rank: 4, tone: 'ok',      edge: 'var(--ok)' },
};
const KNOWN_STATES = ['cited', 'uncited', 'declined', 'no_documents', 'model_unavailable'];

/* One place decides whether a turn is grounded, so the border, the pill, the
   banner and the alert strip can never disagree about the same answer.

   The rule, and why it is drawn where it is. SEVERE is reserved for evidence
   that the answer contains — or claims support from — something that was not in
   the text the model was handed. Those four checks are the ones that would have
   caught the invented instalment: a number nowhere in the retrieved text, a
   marker naming no section, a marker resolving to a section that never reached
   the prompt, and no model tier having answered at all. Each is a positive
   finding, not an absence, which is why each is worth the words "do not repeat
   this to a customer".

   DEGRADED is the opposite shape: nothing here says the answer is wrong, only
   that it rests on less than the whole record — no markers at all, sections
   dropped for budget, a section cut mid-way, or nothing retrieved. That is a
   warning and not a prohibition, and conflating the two would make the
   prohibition worthless inside a week.

   DECLINED outranks DEGRADED but not SEVERE. A model that says NOT_IN_CONTEXT
   has done the right thing and its empty `sources` is the correct value, so it
   is not warned about — but a declined turn whose markers were fabricated is
   still severe, because a fabricated marker is a fabricated marker. */
function grounded(e) {
  if (!e || e.status !== 'ok') return null;
  const src = sourcesOf(e.res);
  const g = groundingOf(e.res);
  const modelError = str(e.res?.model_error);
  const dc = docCount(e.res);

  /* A citation the model was never shown. Format Response resolves [S#] against
     every retrieved section, dropped ones included, so this is a fabricated
     marker that arrives already validated. Read from the citation's own
     `included_in_prompt` first — the workflow states it per source — and fall
     back to the dropped list for a payload that carries one but not the other. */
  const droppedSet = new Set(g.dropped.map(r => r.toUpperCase()));
  const unseen = src.filter(s => s.shown === false
    || (s.shown == null && s.ref && droppedSet.has(s.ref.toUpperCase())));
  const cutSet = new Set(g.truncated.map(r => r.toUpperCase()));
  const citedCut = src.filter(s => s.cut === true
    || (s.cut == null && s.ref && cutSet.has(s.ref.toUpperCase())));

  /* A citation entry with nothing identifying in it — an empty string, a bare
     number, an object with no title, file or section. `sourcesOf` shows it
     verbatim rather than dropping it, which is right, but it must not be
     COUNTED: "2 sources cited" over two unreadable blobs is a green claim made
     out of nothing. The count is readable citations only, and the blobs get a
     row of their own saying the count cannot be trusted. */
  const readable = src.filter(x => !x.unknown);
  const unreadable = src.filter(x => x.unknown);

  const reasons = [];
  const add = (sev, kind, title, detail) => reasons.push({ sev, kind, title, detail });

  if (g.figures.length)
    add('severe', 'figures',
      `${num(g.figures.length)} figure${plural(g.figures.length, '', 's')} in this answer ${plural(g.figures.length, 'is', 'are')} in none of the retrieved text`,
      'The workflow diffs every number in the answer against the numbers actually present in the sections the model was handed. These matched nothing, so each is either arithmetic the model did or a number it invented. A monthly instalment invented this way has already reached a customer of this dealership.');
  if (g.invalidRefs.length)
    add('severe', 'invalid',
      `${num(g.invalidRefs.length)} citation marker${plural(g.invalidRefs.length, '', 's')} name${plural(g.invalidRefs.length, 's', '')} no retrieved section`,
      'The answer text cites these markers and no section with that number was retrieved. They are marked in the answer above. A sentence carrying one of them is not attributable to anything.');
  if (unseen.length)
    add('severe', 'unseen',
      `${num(unseen.length)} cited section${plural(unseen.length, '', 's')} ${plural(unseen.length, 'was', 'were')} never sent to the model`,
      'These were retrieved by the search but did not fit the prompt budget, so the model never read them. It cited them anyway. The section is listed under Sources with a real title and page number and the answer cannot have come from it.');
  if (modelError || g.state === 'model_unavailable')
    add('severe', 'model',
      'No model answered this question',
      'No answer was produced, so the text above is the system reporting that rather than an answer. Nothing in it comes from your documents.');

  if (unreadable.length)
    add('degraded', 'unreadable',
      `${num(unreadable.length)} citation entr${plural(unreadable.length, 'y', 'ies')} could not be read`,
      'The reply listed something under sources with no title, file or section in it. It is printed verbatim below because a citation nobody can see is a citation nobody can check, and it is left out of the count above.');
  /* `cited_refs` naming markers that resolved, next to an EMPTY citation list,
     is the reply contradicting itself. There is no honest count to print. */
  if (g.present && g.citedRefs.length && !readable.length)
    add('degraded', 'mismatch',
      `The reply says ${num(g.citedRefs.length)} marker${plural(g.citedRefs.length, '', 's')} resolved but sent no citation to show`,
      `Its grounding block lists ${g.citedRefs.join(', ')} as having matched a retrieved section, and its sources list is empty. The two halves of the same reply disagree, so what this answer rests on cannot be stated from here.`);
  if (g.state === 'uncited' || (!src.length && !!e.answer && !g.citedRefs.length && g.state !== 'declined' && g.state !== 'no_documents' && g.state !== 'model_unavailable'))
    add('degraded', 'uncited',
      'Nothing was cited for this answer',
      'The model marked no sentence with a source, so there is no document to check this against. Treat it as the model\'s own words.');
  if (g.state === 'no_documents' || dc === 0)
    add('degraded', 'nodocs',
      'Retrieval matched nothing',
      'No indexed section matched this question, so whatever is above is not grounded in your documents.');
  if (g.dropped.length)
    add('degraded', 'dropped',
      `${num(g.dropped.length)} retrieved section${plural(g.dropped.length, '', 's')} never reached the model`,
      `Only the top matches fit the prompt budget. ${g.dropped.length === 1 ? 'That section' : 'Those sections'} may hold the part of the answer that matters, and the model did not see ${plural(g.dropped.length, 'it', 'them')}.`);
  if (g.truncated.length || citedCut.length)
    add('degraded', 'truncated',
      `${num(Math.max(g.truncated.length, citedCut.length))} section${plural(Math.max(g.truncated.length, citedCut.length), ' was', 's were')} cut before the end`,
      'The model was handed the opening of these sections and not the rest, so it answered — and cited — text it had only partly read.');

  const worst = reasons.some(r => r.sev === 'severe') ? 'severe'
    : reasons.length ? 'degraded' : null;

  let verdict;
  if (!g.present) verdict = 'unknown';
  else if (worst === 'severe') verdict = 'severe';
  else if (g.state === 'declined') verdict = 'declined';
  else if (worst === 'degraded') verdict = 'degraded';
  else if (!KNOWN_STATES.includes(g.state)) verdict = 'unknown';
  else if (g.state === 'cited' && readable.length) verdict = 'clean';
  /* `cited` with nothing readable under it is the reply contradicting itself.
     It is not clean, and calling it degraded would imply this screen understood
     what it got. It did not. */
  else verdict = 'unknown';

  return {
    src, g, dc, modelError, reasons, unseen, citedCut, verdict, readable, unreadable,
    /* The count the pill prints, and the one thing it is allowed to mean:
       readable citations, which is distinct markers the model emitted that
       resolved to a section the search returned. */
    cited: readable.length,
  };
}

/* ── Failure classification ─────────────────────────────────────────────────
   n8n() records the transport failure as "<status> — <body>" on the error's
   `.technical`, and the browser reports a blocked or unreachable request as
   "Failed to fetch". Each of those means something different to whoever has to
   fix it. Read `.technical`, never `.message`: since 5 Sep 2026 `.message` is
   the user-safe clause and carries no status code at all (lib/errors.js), and
   nothing the backend said may be printed. Every string this returns is one we
   wrote. */
function diagnose(msg) {
  const m = String(msg || '');
  if (/VITE_N8N_BASE_URL/.test(m))
    return 'This deployment is not configured to reach the automation service, so nothing here can be asked at all. NEXUS sets that when it deploys the dashboard.';
  if (/Session expired/i.test(m))
    return 'Your session ended. Sign in again and re-ask.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m))
    return 'The browser never got a reply at all. That is the request being blocked or the service being unreachable, not the workflow declining to answer. It is one for NEXUS.';
  const code = (m.match(/^(\d{3})\b/) || [])[1];
  if (code === '401' || code === '403')
    return 'The workflow refused this request as unauthorised — it did not accept the session this dashboard is signed in with. Signing in again is worth one try; after that it is one for NEXUS.';
  if (code === '404')
    return 'Nothing is listening for this request right now, which normally means Ask AI is switched off. Only NEXUS can switch it back on.';
  if (code === '429')
    return 'Ask AI is being rate-limited. Wait and re-ask.';
  if (code && code.startsWith('5'))
    return 'The workflow ran and failed. Where it failed is not visible from here — quote the time above to NEXUS and they can find it.';
  return '';
}

/* ── Answer formatting ──────────────────────────────────────────────────────
   The model returns plain text with paragraphs, bullets and the occasional
   **bold**. Escape first, then re-introduce only that small set of marks — the
   string is model output and is treated as hostile. Deliberately not rendered
   in a .bubble: that class is pre-wrap, which would also honour the whitespace
   in this generated markup. */
/* The same two marker spellings Format Response parses. A model that wrote
   [Source 2] instead of [S2] has still named a source, and the workflow refuses
   to punish the formatting; this has to read the answer the same way it did or
   the two would disagree about which markers are in the text. */
const MARKER_RE = /\[\s*(?:S|SOURCE)?\s*(\d{1,2})\s*\]|\(\s*SOURCE\s*(\d{1,2})\s*\)/gi;

/* A marker naming no retrieved section is a fabricated citation, and it stays
   in the prose: `[S7]` is not markup, so it renders literally in the middle of
   the sentence it is vouching for. Counting it in a banner underneath is not
   enough — the operator reads the sentence, not the footnote — so it is called
   out where it sits. Not by colour alone: it carries a dotted underline and the
   words "no such source" after it. */
function markInvalid(html, invalid) {
  if (!invalid || !invalid.size) return html;
  return html.replace(MARKER_RE, (whole, a, b) => {
    const ref = 'S' + (a || b);
    if (!invalid.has(ref)) return whole;
    return `<span class="mono t-hot" style="border-bottom:2px dotted currentColor" title="The workflow found no retrieved section with this number. This marker is the model claiming a source that does not exist.">${esc(whole)}</span><span class="t-hot" style="font-size:11px;font-weight:600;white-space:nowrap"> no such source</span>`;
  });
}
function inlineMarks(s, invalid) {
  return markInvalid(esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="mono">$1</span>'), invalid);
}
function answerHtml(text, invalid) {
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return blocks.map(b => {
    const rows = b.split('\n');
    if (rows.length === 1 && /^#{1,6}\s+/.test(rows[0]))
      return `<div class="label-caps" style="margin:14px 0 6px">${inlineMarks(rows[0].replace(/^#{1,6}\s+/, ''), invalid)}</div>`;
    const bulleted = rows.every(r => /^\s*([-*•]|\d+[.)])\s+/.test(r));
    if (bulleted) return `<div style="margin:0 0 10px">${rows.map(r => {
      const marker = r.match(/^\s*(\d+[.)])\s+/);
      const body = r.replace(/^\s*([-*•]|\d+[.)])\s+/, '');
      return `<div style="display:flex;gap:8px;margin-bottom:4px"><span class="t-muted" style="flex-shrink:0">${marker ? esc(marker[1]) : '•'}</span><span>${inlineMarks(body, invalid)}</span></div>`;
    }).join('')}</div>`;
    return `<div style="margin:0 0 10px">${inlineMarks(b, invalid).replace(/\n/g, '<br>')}</div>`;
  }).join('') || `<div class="t-muted">Empty answer.</div>`;
}

/* ── One turn ───────────────────────────────────────────────────────────── */
function entryBody(e) {
  const head = `<div class="bubble out" style="max-width:100%;margin-bottom:14px">${esc(e.q)}</div>`;

  if (e.status === 'pending') {
    return head + `<div style="display:flex;align-items:center;gap:10px">
        <div class="skeleton" style="width:18px;height:18px;border-radius:50%;flex-shrink:0"></div>
        <div><div>Searching the knowledge base, then asking the model…</div>
        <div class="cell-sub">Waiting <span id="askT${e.id}" class="num">${esc(secs(Date.now() - e.at))}</span> · this workflow has taken 9 s on a good run · giving up at ${Math.round(DEADLINE_MS / 1000)} s</div></div>
      </div>
      <div class="skeleton" style="height:14px;margin-top:16px;width:92%"></div>
      <div class="skeleton" style="height:14px;margin-top:10px;width:78%"></div>`;
  }

  const foot = raw => `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
      <button class="btn sm" data-act="again" data-id="${e.id}">Ask again</button>
      <button class="btn sm ghost" data-act="edit" data-id="${e.id}">Edit question</button>
      ${raw ? `<button class="btn sm ghost" data-act="raw" data-id="${e.id}" aria-expanded="${e.showRaw ? 'true' : 'false'}">${e.showRaw ? 'Hide' : 'Show'} raw response</button>` : ''}
      ${e.answer ? `<button class="btn sm ghost" data-act="copy" data-id="${e.id}">Copy answer</button>` : ''}
    </div>
    ${raw && e.showRaw ? `<div class="mono cell-sub" style="margin-top:12px;padding:12px;background:var(--surface-sunken);border-radius:8px;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto">${esc(raw)}</div>` : ''}`;

  if (e.status === 'error' || e.status === 'timeout') {
    const isTimeout = e.status === 'timeout';
    const hint = isTimeout ? '' : diagnose(e.errTechnical || e.err);
    return head + `<div class="banner hot" style="margin-bottom:0">
        <span class="material-symbols-outlined" style="font-size:20px">${isTimeout ? 'hourglass_disabled' : 'error'}</span>
        <div><div style="font-weight:500">${isTimeout
            ? `No reply after ${Math.round(DEADLINE_MS / 1000)} seconds`
            : 'The Ask-AI workflow did not answer'}</div>
          <div style="margin-top:4px">${isTimeout
            ? `This screen stopped waiting; the request was not cancelled and this dashboard cannot cancel it. If it lands, the answer will appear here and be marked late. ${esc(CEILING_LINE)}`
            : esc(e.err || 'Unknown error')}</div>
          ${hint ? `<div style="margin-top:6px">${esc(hint)}</div>` : ''}</div>
      </div>
      <div class="cell-sub" style="margin-top:10px">Asked at ${esc(clock(e.at))}${e.ms != null ? (isTimeout ? ' · stopped waiting after ' : ' · failed after ') + esc(secs(e.ms)) : ''}</div>`
      + foot(e.rawText);
  }

  /* Answered. */
  const g = grounded(e);
  const src = g.src;
  const gr = g.g;
  const dc = g.dc;
  const model = typeof e.res?.model === 'string' ? e.res.model : null;
  const invalidSet = new Set(gr.invalidRefs.map(r => r.toUpperCase()));

  /* The grounding verdict leads the meta line rather than trailing it. An
     operator skims the first thing under an answer, and whether it may be
     repeated to a customer is the single fact that decides what to do next.
     Every one of these says its verdict in words: the pill is read by people
     who cannot tell the amber from the green. */
  const nWarn = g.reasons.length;
  const verdict = {
    clean:    () => pill(`${num(g.cited)} source${plural(g.cited, '', 's')} cited, no problems found`, 'ok', { verbatim: false }),
    declined: () => pill('Answered nothing — the documents do not cover this', 'cold', { verbatim: false }),
    degraded: () => pill(`Partly grounded — ${num(nWarn)} problem${plural(nWarn, '', 's')} found`, 'warm', { verbatim: false }),
    severe:   () => pill(`Not safe to repeat — ${num(nWarn)} problem${plural(nWarn, '', 's')} found`, 'hot', { verbatim: false }),
    unknown:  () => pill('Grounding not reported', 'unknown', { verbatim: false }),
  }[g.verdict]();

  /* "N sections consulted" was the old wording and it overclaimed: the number
     is everything RETRIEVAL returned, and the workflow drops whatever does not
     fit an 8000-character prompt budget. A section the model never saw was not
     consulted by anything. Retrieved and sent are now two numbers. */
  const sent = gr.present && gr.sentToModel.length ? gr.sentToModel.length : null;
  const retrieved = gr.retrievedCount != null ? gr.retrievedCount : dc;
  const meta = [
    e.ms != null ? `Answered in ${esc(secs(e.ms))}` : null,
    e.late ? '<span class="t-warm">arrived after the timeout</span>' : null,
    `asked at ${esc(clock(e.at))}`,
    retrieved != null
      ? `${esc(num(retrieved))} section${retrieved === 1 ? '' : 's'} retrieved${sent != null ? `, ${esc(num(sent))} sent to the model` : ''}`
      : null,
    /* WAS `model ${model}`. CONTROL-PLANE.md 5.6: the dealership needs to know
       how much to trust this answer, which the verdict pill beside this line
       computes and states in words. Which model produced it is the vendor's
       mechanism, and naming it also tells a reader what to try to steer. */
    null,
  ].filter(Boolean).join(' · ');

  const body = e.answer
    ? answerHtml(e.answer, invalidSet)
    : `<div class="banner warm" style="margin-bottom:0">
         <span class="material-symbols-outlined" style="font-size:20px">help_center</span>
         <div>The workflow replied, but the reply carried no answer text. The raw response below is exactly what it sent.</div></div>`;

  /* Every problem the verdict was built from, named, with the offending values
     printed. A count on its own cannot be checked; "the figures 3.49 and 60
     appear in no retrieved section" can be, in about ten seconds, against the
     documents listed underneath. */
  const reasonList = list => list.map(r => `<div style="margin-top:8px">
      <div style="font-weight:500">${esc(r.title)}</div>
      <div style="margin-top:2px">${esc(r.detail)}</div>
      ${r.kind === 'figures' ? `<div class="mono" style="margin-top:6px;word-break:break-word">${gr.figures.map(f => esc(f)).join('   ')}</div>` : ''}
      ${r.kind === 'invalid' ? `<div class="mono" style="margin-top:6px;word-break:break-word">${gr.invalidRefs.map(f => esc(f)).join('   ')}</div>` : ''}
      ${r.kind === 'unseen' ? `<div class="mono" style="margin-top:6px;word-break:break-word">${g.unseen.map(u => esc(`${u.ref || '?'} ${u.title || u.file || 'untitled'}`)).join(' · ')}</div>` : ''}
      ${r.kind === 'dropped' ? `<div class="mono" style="margin-top:6px;word-break:break-word">${gr.dropped.map(f => esc(f)).join('   ')}</div>` : ''}
      ${r.kind === 'truncated' ? `<div class="mono" style="margin-top:6px;word-break:break-word">${(gr.truncated.length ? gr.truncated : g.citedCut.map(c => c.ref || '?')).map(f => esc(f)).join('   ')}</div>` : ''}
      ${r.kind === 'model' && g.modelError ? `<div class="mono cell-sub" style="margin-top:6px;white-space:normal;word-break:break-word">${esc(g.modelError.slice(0, 300))}</div>` : ''}
    </div>`).join('');

  const severeList = g.reasons.filter(r => r.sev === 'severe');
  const warnList = g.reasons.filter(r => r.sev === 'degraded');

  /* The two treatments that matter. SEVERE says the sentence an operator needs
     to read before they open WhatsApp; DEGRADED says what the answer is missing
     without pretending it is wrong. Neither relies on its colour: both lead
     with a heading that carries the whole instruction in words. */
  const severeBanner = severeList.length ? `<div class="banner hot" style="margin:14px 0 0;align-items:flex-start">
      <span class="material-symbols-outlined" style="font-size:20px">dangerous</span>
      <div><div style="font-weight:600">Do not repeat this answer to a customer</div>
        <div style="margin-top:4px">Something in it is not in the documents it was drawn from. Check every one of these against the source before any part of this leaves the building.</div>
        ${reasonList(severeList)}</div></div>` : '';

  const warnBanner = warnList.length ? `<div class="banner warm" style="margin:14px 0 0;align-items:flex-start">
      <span class="material-symbols-outlined" style="font-size:20px">unpublished</span>
      <div><div style="font-weight:500">This answer rests on less than the full evidence</div>
        <div style="margin-top:4px">Nothing here says it is wrong. It says the model did not have, or did not use, everything the search found — so open the documents before quoting it.</div>
        ${reasonList(warnList)}</div></div>` : '';

  /* A refusal is the most trustworthy output this screen can produce and used
     to be the one that got the amber "nothing was cited" banner, because its
     `sources` list is correctly empty. Warning an operator off the one honest
     answer is how they learn to ignore every warning on the screen. */
  const declinedBanner = g.verdict === 'declined' ? `<div class="banner info" style="margin:14px 0 0;align-items:flex-start">
      <span class="material-symbols-outlined" style="font-size:20px">rule</span>
      <div><div style="font-weight:500">The model declined to answer, which is the correct outcome here</div>
        <div style="margin-top:4px">It was instructed to refuse rather than answer from its own training data, and it did. Nothing above is a claim about company policy. The sections the search returned are listed below in case one of them should have covered this.</div></div></div>` : '';

  /* Absence is not the clean path. A reply with no grounding block is a reply
     from a build of the workflow this screen does not recognise, and the
     evidence that would separate a sourced answer from an invented one is
     simply not in it. */
  const unknownBanner = g.verdict === 'unknown' ? `<div class="banner warm" style="margin:14px 0 0;align-items:flex-start">
      <span class="material-symbols-outlined" style="font-size:20px">help</span>
      <div><div style="font-weight:500">${gr.present ? 'The workflow reported a grounding state this screen does not know' : 'This reply carried no grounding information at all'}</div>
        <div style="margin-top:4px">${gr.present
          ? `Its <span class="mono">grounding.state</span> was <span class="mono">${esc(gr.state || 'empty')}</span>, which is not one of ${esc(KNOWN_STATES.join(', '))}. It is printed as it arrived rather than mapped to a verdict it may not mean.`
          : 'Since 30 Aug 2026 the Ask-AI workflow sends a <span class="mono">grounding</span> block with every answer — which markers resolved, which named nothing, which numbers appear in no retrieved text. This reply has none, so an older build answered it, or something else did. That is not the same as the answer being fine: the checks that would have found an invented figure did not run, or did not report.'}</div>
        <div style="margin-top:4px">Treat it as unverified and open the raw response below to see exactly what was sent.</div></div></div>` : '';

  const sources = src.length ? `<div style="margin-top:18px">
      <div class="label-caps" style="margin-bottom:8px">Sources the model cited</div>
      ${src.map((s, i) => s.unknown
        ? `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="chip">${i + 1}</span>
             <div class="mono cell-sub" style="flex:1;min-width:0;white-space:normal;word-break:break-word">${esc(s.blob)}</div></div>`
        : `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="chip">${esc(s.ref || String(i + 1))}</span>
             <div style="flex:1;min-width:0">
               <div style="font-weight:500">${esc(s.title || s.file || 'Untitled document')}</div>
               <div class="cell-sub">${[
                  s.section ? esc(s.section) : null,
                  s.page != null ? 'p. ' + esc(s.page) : null,
                  s.file && s.file !== s.title ? esc(s.file) : null,
                ].filter(Boolean).join(' · ') || 'No section recorded'}</div>
               ${s.shown === false ? `<div class="t-hot" style="font-size:13px;font-weight:600;margin-top:4px">Never sent to the model — the answer cannot have come from this section</div>` : ''}
               ${s.cut === true ? `<div class="t-warm" style="font-size:13px;font-weight:600;margin-top:4px">Cut short${s.charsFed != null && s.charsTotal != null ? ` — the model was given ${esc(num(s.charsFed))} of its ${esc(num(s.charsTotal))} characters` : ''}</div>` : ''}
               ${s.note ? `<div class="cell-sub" style="white-space:normal;margin-top:4px">${esc(s.note)}</div>` : ''}
               ${s.snippet ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">${esc(s.snippet.length > 320 ? s.snippet.slice(0, 320) + '…' : s.snippet)}</div>` : ''}
             </div></div>`).join('')}
      <div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(`This list is ${g.cited} distinct [S#] marker${plural(g.cited, '', 's')} the MODEL emitted that named a section the search really returned${g.unreadable.length ? `, plus ${g.unreadable.length} entr${plural(g.unreadable.length, 'y', 'ies')} printed verbatim because nothing in ${plural(g.unreadable.length, 'it', 'them')} could be read as a document` : ''}. It is a count of the model's claims, not proof that any sentence came from the section it points at — the workflow's own note says so: a marker is the model claiming a source. What is checked deterministically is the figures, and that check is reported above.`)}</div>
      <div class="cell-sub" style="white-space:normal;margin-top:6px">A citation also cannot say how old the section is: Your documents stores no ingest date, so a cited answer is grounded but of unknown vintage. Open the document itself before quoting a rate, a term or a policy to a customer.</div>
    </div>` : '';

  /* Printed on every answered turn that carried grounding, whatever the
     verdict. It is the audit trail for the pill: the numbers the verdict was
     computed from, in one place, so a clean turn can be checked as easily as a
     failing one. */
  const evidence = gr.present ? `<div class="cell-sub" style="white-space:normal;margin-top:10px">${esc([
      `Grounding state ${gr.state || 'empty'}`,
      `${retrieved == null ? 'unknown' : num(retrieved)} retrieved`,
      `${sent == null ? 'unknown' : num(sent)} sent to the model`,
      `${num(gr.citedRefs.length)} marker${plural(gr.citedRefs.length, '', 's')} resolved`,
      `${num(gr.invalidRefs.length)} named nothing`,
      `${num(gr.dropped.length)} dropped for budget`,
      `${num(gr.truncated.length)} truncated`,
      `${num(gr.figures.length)} unsupported figure${plural(gr.figures.length, '', 's')}`,
    ].join(' · '))}</div>
    ${/* WAS a sentence naming the model that replied and disclosing that a
          backup ladder exists behind it. The epistemics were right — the screen
          refused to guess which tier answered — but the refusal itself
          described the architecture. CONTROL-PLANE.md 5.6. What survives is the
          only part that changes what a reader should do: the answer carries no
          marker saying how it was produced, so nothing here can confirm it came
          from the intended path. */ ''}
    <div class="cell-sub" style="white-space:normal;margin-top:4px">${esc('The reply carries no marker saying how it was produced, so this screen cannot confirm the answer came from the intended path. Judge it on the grounding above, which is checked rather than claimed.')}</div>` : '';

  return head + body + severeBanner + warnBanner + declinedBanner + unknownBanner + sources
    + `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">${verdict}<span class="cell-sub">${meta}</span></div>`
    + evidence
    + foot(e.rawText);
}

/* The left edge of a turn card carries its verdict, so a thread of six answers
   can be read for trustworthiness without opening any of them. */
function turnEdge(e) {
  if (e.status === 'pending') return '3px solid var(--neutral)';
  if (e.status === 'error' || e.status === 'timeout') return '3px solid var(--hot)';
  const g = grounded(e);
  if (!g) return '';
  /* The edge is the verdict and nothing else, so it can never disagree with the
     pill next to it. An answered turn with no answer text in it is not a state
     the verdict knows about, and it is not green. */
  if (!e.answer && g.verdict === 'clean') return `3px solid ${VERDICTS.degraded.edge}`;
  return `3px solid ${VERDICTS[g.verdict].edge}`;
}

SCREENS.ask = async host => {
  const wrap = el('div');
  wrap.style.maxWidth = '900px';
  wrap.style.margin = '0 auto';
  host.appendChild(wrap);

  wrap.innerHTML = `
    <div class="card flush" id="askAlerts" style="margin-bottom:16px">
      <div class="card-head"><div>
        <div class="card-title">Alerts</div>
        <div class="card-sub" id="askAlertSub">Checking the knowledge base, the workflow's health and v_needs_attention…</div>
      </div></div>
      <div id="askAlertBody"><div class="cell-sub" style="padding:16px 20px">Reading…</div></div>
    </div>
    <div class="card" id="askComposer">
      <div class="card-title" style="margin-bottom:4px">Ask the knowledge base</div>
      <div class="card-sub" id="askKb" style="margin-bottom:4px">Counting indexed documents…</div>
      <div class="card-sub" id="askEndpoint" style="margin-bottom:14px">Reading the workflow's health…</div>
      <div class="field">
        <label for="askQ">Your question</label>
        <textarea id="askQ" rows="3" placeholder="Ask in a full sentence — &quot;what is the trade-in appraisal process?&quot;"></textarea>
        <div class="hint">Retrieval is full-text search over the indexed sections, so the words the document uses find it fastest. Enter sends, Shift+Enter adds a line. Questions under three characters return nothing by design.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px">
        <button class="btn primary" id="askGo"><span class="material-symbols-outlined">send</span>Ask</button>
        <button class="btn ghost" id="askReset">Clear box</button>
        <div style="flex:1"></div>
        <button class="btn ghost sm" id="askWipe" title="Discards this session's questions and answers from the screen.">Clear history</button>
      </div>
      <div id="askChips" style="margin-top:16px">${stateLoading(1)}</div>
    </div>
    <div id="askThread" style="margin-top:16px"></div>
    <div id="askRuns" style="margin-top:16px"></div>`;

  /* This invocation's claim on the screen. Anything that outlives it — a
     ticker, an in-flight request, a promise continuation — checks `live()`
     before it touches the DOM, and routes through the module dispatchers when
     it has real work to hand over. */
  const self = {};
  ACTIVE = self;
  const live = () => ACTIVE === self;

  /* Never captured. `nav.go()` empties #screen without cancelling anything, so
     these are allowed to be absent as well as replaced, and every caller
     null-guards. */
  const qBox = () => $('askQ');
  const goBtn = $('askGo');

  /* ── Availability. A control that cannot work is disabled and says why. ── */
  let blocked = N8N_BASE
    ? ''
    : 'This deployment is not configured to reach Ask AI, so no question can be sent from here. Only NEXUS can change that.';

  /* Every control is looked up per call, and every one is allowed to be absent.

     HISTORY is module state, so a question still in flight when the operator
     navigates away lands later — in whichever render of this screen is on
     screen by then, which is why paint() targets the live card by id rather
     than a captured node. The controls have to follow the same rule: a captured
     reference would re-enable the Ask button on a detached node and leave the
     visible one stuck on "a question is already running" forever.

     The absent case is the other half, and it is the one that bit. Navigate
     away with a question open and these nodes are simply gone — nav.go() empties
     #screen without cancelling anything — so `wipe.disabled` threw inside a
     promise continuation, where there was nothing to catch it and the operator
     saw only a screen that had stopped updating. */
  function syncControls() {
    /* `blocked` is this render's state — it is set when THIS render's knowledge
       base read comes back empty — so a superseded render must not use it to
       disable a button belonging to the render that replaced it. */
    if (!live()) return;
    const goNode = $('askGo'), boxNode = $('askQ'), wipe = $('askWipe'), reset = $('askReset');
    const inFlight = HISTORY.some(e => e.status === 'pending');
    const typed = boxNode ? boxNode.value.trim() : '';
    if (goNode) {
      goNode.disabled = !!blocked || inFlight || !typed;
      goNode.title = blocked
        || (inFlight ? 'A question is already running. This workflow is answered one at a time so the answers cannot interleave.' : 'Send this question to the ask-ai workflow');
    }
    if (wipe) wipe.disabled = HISTORY.length === 0;
    if (reset) reset.disabled = !(boxNode && boxNode.value);
  }

  /* ══ Alerts ═══════════════════════════════════════════════════════════════
     Two sources, kept distinguishable on screen: rows Postgres produced in
     v_needs_attention, and conditions computed here out of reads this screen
     was making anyway. Nothing below issues a request of its own. */
  let attnState = null;   /* { rows } | { err } */
  let kbState = null;     /* { count, capped, titles } | { err } — no date: see KB_COLS */
  let healthState = null; /* { row, how, rows } | { err } */

  const reveal = id => {
    const node = document.getElementById(id);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    /* Re-adding the class alone does not restart an animation that is already
       running; reading offsetWidth between the remove and the add forces the
       reflow that does, so clicking the same alert twice flashes twice. */
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 800);
  };

  /* Ranks tones for ordering; it is not a severity map. The severity map — the
     one that turns HOT/CRITICAL/DEGRADED/NEVER_RAN into a colour — is `tone()`
     in lib/format.js and there is exactly one of it. */
  const SEV_RANK = { hot: 0, warm: 1, cold: 2, ok: 2, '': 3 };

  /* `durable` marks an alert that is a fact about the system rather than about
     this browser tab, and it is what gates the "this session" chip. A failed or
     uncited question is real and is shown here, but it exists only in this tab
     and is gone on reload, so it is labelled that way rather than presented
     alongside a DEGRADED workflow as if the two had the same standing. A cold
     row — a read that was capped, a table with no ingest date, an endpoint that
     keeps no history by design — is a durable fact worth stating and not a
     thing to go and fix, so it carries no chip either. Nothing here feeds a nav
     badge: those are painted centrally by lib/badges.js from v_needs_attention
     and this screen writes to none of them. */
  function computeAlerts() {
    const out = [];

    /* 1 · Straight from the view. */
    if (attnState?.rows) {
      for (const it of attnState.rows) {
        out.push({
          id: `view-${str(it.kind)}-${str(it.ref)}`,
          /* A private VIEW_TONE table used to sit here. Every value it listed
             agreed with `tone()`, so it bought nothing — but it fell back to
             'warm' for anything it did not list, which meant an unrecognised
             severity, and an empty one, were painted amber: a claim that
             something needs a human, made out of a word nobody had taught the
             table. `tone()` maps an unknown value to its own 'unknown' tone —
             legible, and visibly not one of the graded states — and a blank to
             no tone at all, which is what not knowing actually looks like. */
          tone: tone(it.severity),
          icon: 'priority_high',
          durable: true,
          title: str(it.title) || str(it.kind) || 'Needs attention',
          badge: str(it.kind),
          detail: esc(str(it.detail) || 'The attention list recorded no detail for this row.'),
          /* No jump target on purpose. The view emits nothing for this screen
             today, so what its `ref` would point at here is unknown — a chevron
             that scrolled back to this same strip would be an affordance that
             does nothing. The ref is printed instead, which is what an operator
             would need to find the row it names. */
          foot: `${it.at ? `Waiting ${esc(ago(it.at))}` : 'The view recorded no timestamp, so how long this has waited is unknown.'}${
            str(it.ref) ? ` · ref <span class="mono">${esc(str(it.ref))}</span>` : ''}`,
        });
      }
    } else if (attnState?.err) {
      out.push({
        id: 'view-failed', tone: 'warm', icon: 'cloud_off', durable: true,
        title: 'The attention list did not load',
        detail: `${esc(attnState.err)}<br>Anything that view would have raised for this screen is missing from the list below. The knowledge-base and workflow checks under it are unaffected — they read different tables.`,
        target: 'askAlerts',
      });
    }

    /* 2 · The bundle itself. Nothing on this screen can work without it. */
    if (!N8N_BASE) {
      out.push({
        id: 'env', tone: 'hot', icon: 'link_off', durable: true,
        title: 'This deployment cannot reach the automation service at all',
        detail: 'Ask AI has nowhere to send a question, so it is disabled rather than left to fail on every press. This is set when NEXUS deploys the dashboard — nothing here can change it.',
        target: 'askComposer',
      });
    }

    /* 3 · Is the knowledge base worth asking? */
    if (kbState?.err) {
      out.push({
        id: 'kb-failed', tone: 'warm', icon: 'quiz', durable: true,
        title: 'The knowledge base could not be counted',
        detail: `${esc(kbState.err)}<br>So this screen cannot say how many sections Ask AI can reach, or which documents they came from. When they were ingested was never knowable — Your documents keeps no date — so that much is unchanged. Ask is deliberately left enabled: a failed read here says nothing about whether the workflow works. Judge each answer by its citations instead.`,
        target: 'askComposer', settings: true,
      });
    } else if (kbState) {
      if (!kbState.count) {
        out.push({
          id: 'kb-empty', tone: 'hot', icon: 'folder_off', durable: true,
          title: 'The knowledge base is empty',
          detail: 'Your documents holds no rows, so retrieval can return nothing and every answer would be the model guessing from its training data. Ask is disabled until a document is ingested — an ungrounded answer that looks grounded is worse than no answer at all.',
          target: 'askComposer', settings: true,
        });
      } else {
        /* Permanent, and stated every single time the knowledge base is not
           empty, because it is a permanent property of the table rather than a
           condition that comes and goes. Cold on purpose: an operator cannot
           fix it and there is nothing here to go and do, so it must not sit in
           the same colour as a workflow that is down. It is still said out
           loud, every time, because the alternative is a screen that quietly
           implies its documents are current. */
        out.push({
          id: 'kb-undated', tone: 'cold', icon: 'help', durable: true,
          title: 'We cannot know when this knowledge base was last updated',
          detail: `<span class="mono">Your documents</span> stores no timestamp of any kind — the table is <span class="mono">id, doc_title, source_file, section, page_number, content, search_vector</span> and none of those records when a section was ingested. So the ${esc(num(kbState.count))} indexed section${plural(kbState.count, '', 's')} below could have been written last night or two years ago, and this screen will not guess: row order is insertion order at best and arbitrary at worst, so "the newest document" is not a thing that can be computed here. Every answer on this screen is therefore grounded in documents of unknown vintage. Before repeating a finance rate, a warranty term or a policy to a customer, open the cited document and check its own date.`,
          foot: 'Fixing this needs a timestamp column on your documents and a re-ingest. Nothing in the browser can add one, and no webhook accepts a document.',
          target: 'askComposer', settings: true,
        });
      }
      if (kbState.capped) {
        out.push({
          id: 'kb-capped', tone: 'cold', icon: 'filter_alt', durable: true,
          title: 'The section count is a floor, not a total',
          detail: `This screen read ${esc(num(KB_LIMIT))} sections and stopped. There are at least that many and possibly more, so the count above is a floor, and the document list offered as starting points is drawn from that window rather than from everything indexed.`,
          target: 'askComposer',
        });
      }
    }

    /* 4 · Is the endpoint itself healthy? Read from the view, never inferred
       from one operator's two failed questions. */
    if (healthState?.err) {
      out.push({
        id: 'wf-failed', tone: 'warm', icon: 'cloud_off', durable: true,
        title: "The workflow's health could not be read",
        detail: `${esc(healthState.err)}<br>The automation health figures is what says whether ask-ai is active and whether it has been failing, so none of that is known right now. The Ask button is unaffected: pressing it is still the direct test.`,
        target: 'askComposer',
      });
    } else if (healthState && !healthState.row) {
      out.push({
        id: 'wf-missing', tone: 'warm', icon: 'search_off', durable: true,
        title: 'No registered workflow matches ask-ai',
        detail: `The automation health figures returned ${esc(num(healthState.rows.length))} workflow${plural(healthState.rows.length, '', 's')} and none names the <span class="mono">${esc(HOOK.askAi)}</span> webhook in its trigger detail or mentions Ask AI. So nothing here can report this endpoint's health, and its absence from the automation register is itself worth fixing.`,
        target: 'askComposer',
      });
    } else if (healthState?.row) {
      const w = healthState.row;
      const h = str(w.health).toUpperCase();
      const r30 = n0(w.runs_30d) || 0;
      const f30 = n0(w.failures_30d) || 0;
      const p30 = n0(w.partials_30d) || 0;
      const eff30 = n0(w.effective_runs_30d);
      const rej30 = n0(w.rejected_30d) || 0;
      if (w.is_active === false) {
        out.push({
          id: 'wf-inactive', tone: 'hot', icon: 'toggle_off', durable: true,
          title: `"${str(w.name) || 'The Ask-AI workflow'}" is registered as inactive`,
          detail: 'A workflow that is switched off has nothing listening for a question, so anything asked from here comes back refused however it is worded. Only NEXUS can switch it back on; the dashboard cannot.',
          target: 'askComposer',
        });
      }
      if (h === 'DEGRADED') {
        out.push({
          id: 'wf-degraded', tone: 'hot', icon: 'error', durable: true,
          title: 'The Ask-AI workflow is DEGRADED',
          /* Failures and partials together, over the effective denominator. A
           half-landed run is not a success and a refusal-by-design is not a
           miss; lib/health.js is the only thing allowed to draw either line. */
        detail: `The automation health figures reports ${esc(num(f30 + p30))} run${plural(f30 + p30, '', 's')} that failed or went out half-done${eff30 != null ? ` out of the ${esc(num(eff30))} rated run${plural(eff30, '', 's')}` : ` out of ${esc(num(r30))} logged run${plural(r30, '', 's')}`} in the last 30 days${rej30 ? `, with ${esc(num(rej30))} further request${plural(rej30, '', 's')} refused by design and deliberately not counted against it` : ''}. An answer that does come back is still worth reading — the failures are the runs that never produced one.`,
          foot: w.last_failure ? `Last recorded failure ${esc(ago(w.last_failure))}` : '',
          target: 'askRuns',
        });
      } else if (h === 'NEVER_RAN') {
        out.push({
          id: 'wf-never', tone: 'warm', icon: 'not_started', durable: true,
          title: 'The Ask-AI workflow has never recorded a run',
          detail: 'No run of this workflow has been logged, so there is no evidence it works and the first question asked here is the test. Expected on a fresh deployment; worth investigating on an old one.',
          target: 'askRuns',
        });
      } else if (h === 'NOT_INSTRUMENTED' && w.writes_audit_log === false) {
        out.push({
          id: 'wf-blind-by-design', tone: 'cold', icon: 'sync_alt', durable: true,
          title: 'This endpoint keeps no run history, by design',
          detail: 'ask-ai answers its caller: the question is posted from this screen and the outcome comes back in the reply, which is why the registry records it as writing no audit row. The trade-off is real — nothing here can tell you how it behaved yesterday, only how it behaves when you press Ask.',
          target: 'askRuns',
        });
      } else if (h === 'NOT_INSTRUMENTED') {
        out.push({
          id: 'wf-blind', tone: 'warm', icon: 'visibility_off', durable: true,
          title: 'The Ask-AI workflow is not instrumented',
          detail: 'The registry says this workflow should write an audit row and the automation health figures has none from it. It could be running perfectly or failing every time; from here the two are indistinguishable.',
          target: 'askRuns',
        });
      } else if (h !== 'HEALTHY') {
        /* Everything the view's vocabulary can return that is not one of the
           branches above, plus everything it cannot. That vocabulary GREW when
           v_workflow_health was rebuilt on nexus_outcome_class — PRODUCING_NOTHING,
           NO_QUALIFYING_RUNS and UNKNOWN_OUTCOME did not exist when this branch
           was written and it called all three "not one of the four values this
           build knows how to read", which was this screen being out of date and
           blaming the database for it. lib/health.js holds the closed set and
           the wording for each; a value inside it is spoken about properly, and
           only a value outside it is printed verbatim as unrecognised. */
        const known = Object.prototype.hasOwnProperty.call(HEALTH_WORDS, h);
        const hw = healthWords(h);
        out.push({
          id: 'wf-unreported', tone: known ? hw.tone : 'cold', icon: 'help', durable: true,
          title: h
            ? (known ? `The Ask-AI workflow is ${h}: ${hw.label}` : `Unrecognised workflow health: ${h}`)
            : 'The registry reports no health for this workflow',
          detail: h
            ? (known
                ? `${esc(hw.blurb)} An answer that does come back is still worth reading on its own citations — that verdict is computed per turn in the thread below and does not depend on this.`
                : `The automation health figures returned <span class="mono">${esc(h)}</span> for <span class="mono">${esc(str(w.name) || 'this workflow')}</span>, which is not in the closed set NEXUS defines. It is printed verbatim above rather than mapped to a verdict it may not mean.`)
            : `The automation health figures matched <span class="mono">${esc(str(w.name) || 'this workflow')}</span> but left its <span class="mono">health</span> column empty, so whether ask-ai is healthy or failing is not known from here. Pressing Ask remains the direct test.`,
          target: 'askComposer',
        });
      }
    }

    /* 5 · This session. Not durable — these exist only in this tab and vanish
       on reload, and each one carries a chip saying so rather than sitting in
       the list as though it were a standing fact about the system. */
    const slow = HISTORY.find(e => e.status === 'pending' && Date.now() - e.at >= SLOW_MS);
    if (slow) {
      out.push({
        id: 'turn-slow', tone: 'warm', icon: 'hourglass_top', durable: false,
        title: 'A question has been running a long time',
        detail: `Waiting <span id="askAlertAge" class="num">${esc(secs(Date.now() - slow.at))}</span> for the workflow to answer, against about 9 s on a good run. The tab is not hung — the request is genuinely still open — and this screen stops waiting on it at ${Math.round(DEADLINE_MS / 1000)} s. ${esc(CEILING_LINE)}`,
        target: `askE${slow.id}`,
      });
    }
    const failed = HISTORY.filter(e => e.status === 'error' || e.status === 'timeout');
    if (failed.length) {
      const newest = failed[0];
      out.push({
        id: 'turn-failed', tone: 'hot', icon: 'error', durable: false,
        title: `${num(failed.length)} question${plural(failed.length, '', 's')} in this session got no answer`,
        detail: newest.status === 'timeout'
          ? `The most recent stopped being waited on after ${Math.round(DEADLINE_MS / 1000)} s, with the request still open. ${esc(CEILING_LINE)}`
          : (() => { const d = diagnose(newest.errTechnical || newest.err);
              return `${esc(str(newest.err) || 'Unknown error')}${d ? `<br>${esc(d)}` : ''}`; })(),
        target: `askE${newest.id}`,
      });
    }
    /* The three verdicts worth raising, each on its own row. They were one row
       — "N answers cited nothing" — which put a fabricated figure and a model
       that simply did not mark its sentences in the same amber sentence. */
    const byVerdict = v => HISTORY.filter(e => grounded(e)?.verdict === v);

    const severeTurns = byVerdict('severe');
    if (severeTurns.length) {
      /* Every distinct problem across those turns, so the row says what is
         wrong rather than only how many turns are. */
      const kinds = [...new Set(severeTurns.flatMap(e => grounded(e).reasons.filter(r => r.sev === 'severe').map(r => r.kind)))];
      const WORDS = {
        figures: 'a figure that appears in none of the retrieved text',
        invalid: 'a citation marker naming no retrieved section',
        unseen:  'a citation resolving to a section the model was never sent',
        model:   'nothing having answered at all',
      };
      out.push({
        id: 'turn-severe', tone: 'hot', icon: 'dangerous', durable: false,
        title: `${num(severeTurns.length)} answer${plural(severeTurns.length, '', 's')} in this session must not be repeated to a customer`,
        detail: `The workflow's own checks found ${esc(kinds.map(k => WORDS[k] || k).join('; '))}. Each of those is the answer containing, or claiming support from, something the model was never given — the same shape as the invented monthly instalment this system has already quoted to a buyer. Open each turn: the offending figures and markers are printed on it.`,
        target: `askE${severeTurns[0].id}`,
      });
    }

    const degradedTurns = byVerdict('degraded');
    if (degradedTurns.length) {
      const kinds = [...new Set(degradedTurns.flatMap(e => grounded(e).reasons.map(r => r.kind)))];
      const WORDS = {
        uncited:   'no citation markers at all',
        nodocs:    'nothing retrieved',
        dropped:   'sections retrieved but never sent to the model',
        truncated: 'sections the model saw only part of',
      };
      out.push({
        id: 'turn-degraded', tone: 'warm', icon: 'unpublished', durable: false,
        title: `${num(degradedTurns.length)} answer${plural(degradedTurns.length, '', 's')} in this session rest${plural(degradedTurns.length, 's', '')} on less than the full evidence`,
        detail: `Across ${plural(degradedTurns.length, 'it', 'them')}: ${esc(kinds.map(k => WORDS[k] || k).join('; '))}. None of that says the answer is wrong; it says the model did not have, or did not use, everything the search found. On screen such an answer reads exactly like a fully sourced one, which is why it is listed here.`,
        target: `askE${degradedTurns[0].id}`,
      });
    }

    const ungroundedTurns = byVerdict('unknown');
    if (ungroundedTurns.length) {
      out.push({
        id: 'turn-ungrounded', tone: 'warm', icon: 'help', durable: false,
        title: `${num(ungroundedTurns.length)} answer${plural(ungroundedTurns.length, '', 's')} came back with no usable grounding report`,
        detail: 'Since 30 Aug 2026 the Ask-AI workflow sends a grounding block with every answer, naming which markers resolved and which numbers appear in no retrieved text. These replies carried none, or carried a state this build does not recognise. That is not the same as the answer being fine — it means the checks that would have found an invented figure did not report, so nothing on screen can tell a sourced answer from an invented one. Worth reconciling against the workflow actually deployed on that box.',
        target: `askE${ungroundedTurns[0].id}`,
      });
    }
    return out.sort((a, b) => (SEV_RANK[a.tone] ?? 3) - (SEV_RANK[b.tone] ?? 3));
  }

  function renderAlerts() {
    /* A superseded render's attnState/kbState/healthState are its own reads,
       and repainting the live strip from them showed the previous visit's
       answers under the current visit's questions. */
    if (!live()) return;
    const bodyHost = $('askAlertBody');
    if (!bodyHost) return; /* navigated away while a read was in flight */
    const alerts = computeAlerts();
    const durable = alerts.filter(a => a.durable && (a.tone === 'hot' || a.tone === 'warm'));

    /* No badge is written from here. lib/badges.js owns every .nav-badge and
       repaints all of them from one read of v_needs_attention, so a count
       written from this screen was overwritten inside a minute and, until it
       was, disagreed with the only query that can explain it. `durable` still
       earns its keep: it is the count this strip reports about itself, in the
       footer, where there is room to say what it is made of. */

    /* What was actually checked, and what could not be. A screen that quietly
       drops a failed read reports fewer alerts and looks healthier for it. */
    const checked = [
      attnState?.rows ? `The attention list: ${num(attnState.rows.length)} row${plural(attnState.rows.length, '', 's')} for this screen`
        : attnState?.err ? 'The attention list: unreadable' : 'The attention list: still reading',
      kbState?.err ? 'knowledge base: unreadable'
        : kbState ? `knowledge base: ${num(kbState.count)}${kbState.capped ? '+' : ''} section${plural(kbState.count, '', 's')}`
        : 'knowledge base: still reading',
      healthState?.err ? 'workflow health: unreadable'
        : healthState?.row ? `workflow health: ${str(healthState.row.health) || 'unreported'}`
        : healthState ? 'workflow health: no matching workflow'
        : 'workflow health: still reading',
    ];
    const subNode = $('askAlertSub');
    if (subNode) subNode.textContent = checked.join(' · ');

    /* Reads still in flight. An all-clear printed before the answers are back
       is the most confident lie this strip could tell, so until every check has
       landed it says it is still checking instead. */
    const waiting = [attnState, kbState, healthState].filter(s => s == null).length;

    const notes = [
      attnState?.rows && !attnState.rows.length
        ? 'The attention list has no branch that targets this screen today, so an empty result from it is expected rather than evidence that nothing is wrong. Everything else above is computed here, from reads this screen already makes.'
        : '',
      `${num(durable.length)} of the ${num(alerts.length)} row${plural(alerts.length, '', 's')} above ${plural(durable.length, 'is', 'are')} durable and worth acting on — a fact about the system, read from the attention list, the knowledge base or the automation health figures, that will still be true after a reload. The rest are shown and deliberately not counted: session alerts (a question that failed, an answer that cited nothing) exist only in this tab and vanish when it reloads, and informational rows state something that cannot be fixed from here.`,
      'The sidebar badge over Ask AI is not this number and is not written by this screen. Nav badges are painted centrally from the attention list alone, and that view has no branch that files anything against this screen — so the sidebar is silent here even when the list above is not, and this strip is the only place these are reported.',
      waiting ? `${num(waiting)} of the three checks ${plural(waiting, 'has', 'have')} not finished reading, so this list is not final yet.` : '',
    ].filter(Boolean);
    const foot = `<div class="list-item" style="cursor:default;align-items:flex-start">
      <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
      <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`;

    /* The all-clear used to be one fixed sentence asserting three things at
       once. It outlived its own conditions more than once — it still claimed the
       knowledge base "has been added to recently" on a build where the freshness
       check had been skipped, and still claimed the workflow "is not reporting
       failures" where v_workflow_health had simply returned no health value. So
       it is derived from the same state the alerts are: each line is a thing
       that was actually read, quoting what it said. */
    const cleared = [
      kbState && !kbState.err
        ? `${num(kbState.count)}${kbState.capped ? '+' : ''} indexed section${plural(kbState.count, '', 's')} in the knowledge base, of unknown vintage — Your documents keeps no ingest date, so nothing here can say whether they are current.`
        : '',
      healthState?.row
        ? `The automation health figures reports the ask-ai workflow ${str(healthState.row.health) || 'with no health value'}.`
        : '',
      attnState?.rows ? 'The attention list returned no row filed against this screen.' : '',
      /* This sentence asserted that every answer "came back answered" and
         "cited at least one document" without consulting a single turn, so a
         turn with status ok and an empty answer would have been covered by it.
         It is derived now, like everything else in this list. The branch is in
         practice unreachable — `kb-undated` is pushed on every settled non-empty
         knowledge base, by design, so `alerts` is never empty — but an
         unreachable sentence that would be false if it ran is still a false
         sentence sitting in the file. */
      HISTORY.length
        ? (() => {
            const done = HISTORY.filter(e => e.status === 'ok');
            const cleanTurns = done.filter(e => grounded(e).verdict === 'clean').length;
            return `${num(done.length)} of the ${num(HISTORY.length)} question${plural(HISTORY.length, '', 's')} asked in this session came back answered, and ${num(cleanTurns)} of those carried citations with no grounding problem reported.`;
          })()
        : 'No question has been asked in this session yet, so there is no answer here to judge.',
    ].filter(Boolean);

    if (!alerts.length) {
      bodyHost.innerHTML = (waiting
        ? `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="material-symbols-outlined t-muted" style="font-size:20px">hourglass_top</span>
             <div><div style="font-weight:500">Still checking</div>
               <div class="cell-sub" style="white-space:normal">Nothing has been found yet, which is not the same as nothing being wrong — ${esc(num(waiting))} of the three checks ${plural(waiting, 'is', 'are')} still reading.</div></div>
           </div>`
        : `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="material-symbols-outlined t-ok" style="font-size:20px">task_alt</span>
             <div><div style="font-weight:500">Nothing on this screen needs a human</div>
               <div class="cell-sub" style="white-space:normal">${cleared.map(esc).join('<br>')}</div></div>
           </div>`) + foot;
      return;
    }

    bodyHost.innerHTML = alerts.map(a => `
      <div class="list-item" style="align-items:flex-start${a.target ? '' : ';cursor:default'}"${a.target ? ` role="button" tabindex="0" data-target="${esc(a.target)}"` : ''}>
        <span class="material-symbols-outlined t-${esc(a.tone)}" style="font-size:20px">${esc(a.icon)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${esc(a.title)}
            ${a.badge ? `<span class="chip">${esc(a.badge)}</span>` : ''}
            ${a.durable ? '' : '<span class="chip" title="Computed from this browser session. It is stored nowhere and disappears when the tab reloads.">this session</span>'}</div>
          <div class="cell-sub" style="white-space:normal">${a.detail}</div>
          ${a.foot ? `<div class="cell-sub">${a.foot}</div>` : ''}
        </div>
        ${a.settings ? `<button class="btn sm ghost" data-goto="settings" title="Settings lists every indexed document and the columns your documents actually returned.">Knowledge base</button>` : ''}
        ${a.target ? '<span class="material-symbols-outlined t-muted" style="font-size:18px">chevron_right</span>' : ''}
      </div>`).join('') + foot;

    /* An alert nobody can act on is a decoration. Every row jumps to the thing
       it is about, from the keyboard as well — the row is the only way in, so a
       mouse-only affordance would strand anyone navigating by key. */
    bodyHost.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      go(b.dataset.goto);
    }));
    bodyHost.querySelectorAll('[data-target]').forEach(n => {
      const jump = () => reveal(n.dataset.target);
      n.addEventListener('click', jump);
      n.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); jump(); }
      });
    });
  }

  /* ── Thread painting ─────────────────────────────────────────────────────
     Each turn owns one card. Repainting a turn never touches the composer, so
     the operator can type the next question while one is still running. */
  const tickers = new Map();
  function stopTicker(id) {
    const t = tickers.get(id);
    if (t) { clearInterval(t); tickers.delete(id); }
  }
  function paint(e) {
    if (!live()) { stopTicker(e.id); return; }
    const node = document.getElementById(`askE${e.id}`);
    stopTicker(e.id);
    if (!node) return;
    node.innerHTML = entryBody(e);
    node.style.borderLeft = turnEdge(e);
    if (e.status === 'pending') {
      tickers.set(e.id, setInterval(() => {
        /* A ticker from a superseded render drives the same `askT{id}` node by
           id, so two of them counted the same wait against two different start
           states. The stale one stands down. */
        if (!live()) { stopTicker(e.id); return; }
        const t = document.getElementById(`askT${e.id}`);
        if (!t) { stopTicker(e.id); return; }
        const elapsed = Date.now() - e.at;
        t.textContent = secs(elapsed);
        /* Two lifetimes on one tick. The counter inside the turn updates every
           time; the alert strip is repainted only when the wait crosses the
           threshold that makes it an alert — repainting it twice a second would
           drop focus out of whichever row the operator had tabbed to. */
        const isSlow = elapsed >= SLOW_MS;
        if (isSlow !== !!e.slow) { e.slow = isSlow; renderAlerts(); }
        const age = document.getElementById('askAlertAge');
        if (age) age.textContent = secs(elapsed);
      }, 500));
    }
    node.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => onEntryAct(b, e)));
    syncControls();
  }
  function onEntryAct(btn, e) {
    const act = btn.dataset.act;
    if (act === 'raw') { e.showRaw = !e.showRaw; paint(e); return; }
    if (act === 'edit') { const b = qBox(); if (b) { b.value = e.q; b.focus(); } syncControls(); return; }
    if (act === 'again') { const b = qBox(); if (b) b.value = e.q; syncControls(); submit(); return; }
    if (act === 'copy') {
      const clip = navigator.clipboard;
      if (!clip || typeof clip.writeText !== 'function') {
        btn.disabled = true;
        btn.title = 'This browser exposes no clipboard API to the page.';
        return;
      }
      clip.writeText(e.answer || '').then(
        () => { btn.textContent = 'Copied'; },
        () => { btn.textContent = 'Copy blocked'; btn.title = 'The browser refused clipboard access for this page.'; });
    }
  }
  function renderThread() {
    if (!live()) return;
    const threadNode = $('askThread');
    if (!threadNode) return;
    if (!HISTORY.length) {
      threadNode.innerHTML = `<div class="card">${stateEmpty('Nothing asked yet',
        'Answers appear here newest first and stay for as long as this tab is open. They are not saved anywhere.',
        'auto_awesome')}</div>`;
      return;
    }
    threadNode.innerHTML = HISTORY.map(e => `<div class="card" id="askE${e.id}" style="margin-bottom:14px"></div>`).join('');
    HISTORY.forEach(paint);
  }

  /* Registered only once the four are defined, and after `syncControls` above,
     so a dispatcher can never reach a half-built render. */
  self.paint = paint;
  self.thread = renderThread;
  self.sync = syncControls;
  self.alerts = renderAlerts;

  /* ── Asking ─────────────────────────────────────────────────────────────── */
  async function submit() {
    if (blocked) return;
    const b = qBox();
    const q = b ? b.value.trim() : '';
    if (!q) return;
    if (HISTORY.some(e => e.status === 'pending')) return;

    const e = { id: ++SEQ, q, at: Date.now(), status: 'pending', ms: null, showRaw: false, slow: false };
    HISTORY.unshift(e);
    b.value = '';
    /* Through the dispatchers from here on. The awaits below can outlast this
       render by minutes — the deadline alone is 45 s and a late answer is still
       rendered — so every paint after one of them goes to whichever render is
       on screen when it lands, not to this closure's nodes. */
    rethread();
    resync();

    const call = n8n(HOOK.askAi, { question: q });
    const settle = call.then(r => ({ ok: true, r }), err => ({ ok: false, err }));
    const finish = out => {
      e.ms = Date.now() - e.at;
      e.slow = false;
      if (out.ok) {
        e.status = 'ok';
        e.res = out.r;
        e.answer = answerText(out.r);
        e.rawText = (() => { try { return JSON.stringify(out.r, null, 2); } catch { return String(out.r); } })();
      } else {
        e.status = 'error';
        e.err = out.err?.message || String(out.err);
        /* The wire's own words, for diagnose() only. `e.err` is what the screen
           prints and lib/data.js keeps it user-safe; the status line and the
           body that explain WHICH failure this was live on `.technical` and are
           never rendered — diagnose() turns them into a sentence we wrote. */
        e.errTechnical = out.err?.technical || '';
        e.rawText = '';
      }
      repaint(e);
      resync();
    };

    const winner = await Promise.race([settle, wait(DEADLINE_MS).then(() => TIMED_OUT)]);
    if (winner !== TIMED_OUT) { finish(winner); return; }

    e.status = 'timeout';
    e.ms = DEADLINE_MS;
    e.slow = false;
    repaint(e);
    resync();
    /* The connection is still open. If it lands, the turn is rewritten with the
       real answer and flagged late — an answer that arrived is an answer. */
    settle.then(out => { e.late = true; finish(out); });
  }

  goBtn.addEventListener('click', submit);
  qBox().addEventListener('input', syncControls);
  qBox().addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit(); }
  });
  $('askReset').addEventListener('click', () => { const b = qBox(); if (b) { b.value = ''; b.focus(); } syncControls(); });
  $('askWipe').addEventListener('click', () => {
    /* A running turn is kept — dropping it would leave a request in flight with
       nowhere to land. */
    const keep = HISTORY.filter(x => x.status === 'pending');
    HISTORY.length = 0;
    keep.forEach(k => HISTORY.push(k));
    renderThread();
    syncControls();
    renderAlerts();
  });

  renderThread();
  syncControls();
  renderAlerts();

  /* ── The reads, all in flight at once ───────────────────────────────────
     Four independent questions — what does the view say, what is in the
     knowledge base, is the endpoint healthy, and what has it logged — so a
     failure of any one is reported on its own terms instead of collapsing the
     screen into a single error. None is retried automatically: a retry aimed at
     a box that is already struggling is how a slow dashboard becomes a dead
     one. */
  const attnP   = settled(db(`v_needs_attention?select=kind,severity,ref,title,detail,at,screen&screen=eq.ask&order=at.desc&limit=${ATTN_LIMIT}`));
  /* The 30-day columns are the graded ones and they are what this screen reads.
     `runs_30d` counts everything the workflow logged; `effective_runs_30d`
     counts only what it was expected to deliver on, with refusals-by-design
     taken out of the denominator. Ask-AI logs both — its JWT guard writes a
     REJECTED row every time an unauthenticated caller is turned away — so the
     two numbers differ here and quoting the wrong one turns a workflow the
     database calls HEALTHY into a 79% one on screen. lib/health.js owns that
     distinction; this screen only reads the columns it publishes. */
  const healthP = settled(db('v_workflow_health?select=name,category,description,is_active,writes_audit_log,runs,failures,success_rate,last_run,runs_30d,failures_30d,partials_30d,no_result_30d,rejected_30d,successes_30d,effective_runs_30d,success_rate_30d,last_failure,health&limit=200'));
  const auditP  = settled(db(`audit_log?select=workflow,status,lead_name,lead_email,intent,summary,logged_at&order=logged_at.desc&limit=${AUDIT_LIMIT}`));
  const regP    = settled(db('rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases'));

  /* One round trip, no probe, no order-by. The probe existed to discover the
     column names and a date column; the names are now known (KB_COLS) and the
     date column does not exist, so both halves of it are gone. There is
     deliberately no `order=` here either: any ordering this could pick would
     be presented on screen as meaning something, and none of them would. */
  const kbP = settled((async () => {
    const rows = await db(`rag_documents?select=${KB_COLS}&limit=${KB_LIMIT}`);
    const titles = [...new Set(rows.map(r => str(r.doc_title)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    return { count: rows.length, capped: rows.length >= KB_LIMIT, titles };
  })());

  /* ── What the knowledge base actually contains ──────────────────────────
     The chips are not invented example questions: every one names a document
     that is really indexed, so a chip can never ask about something the
     retrieval cannot find. */
  kbP.then(res => {
    if (!$('askKb')) return;
    if (!res.ok) {
      kbState = { err: res.err };
      /* A failed read here says nothing about whether the workflow works, so
         the Ask button is deliberately left enabled. */
      $('askKb').textContent = 'Could not read the knowledge base index';
      $('askChips').innerHTML = stateError('the knowledge base index', res.err);
      renderAlerts();
      syncControls();
      return;
    }
    const kb = res.v;
    kbState = kb;
    /* The freshness clause is not conditional and never will be: rag_documents
       has no timestamp, so this line can only ever say that it does not know.
       It is said next to the count rather than only in the alert strip, because
       the count is the number an operator reads just before deciding to trust
       an answer. */
    $('askKb').innerHTML = kb.count
      ? `${esc(kb.capped ? 'At least ' : '')}${esc(num(kb.count))} indexed section${plural(kb.count, '', 's')} across ${esc(num(kb.titles.length))} document${plural(kb.titles.length, '', 's')} · answers are drawn only from these · <span class="t-muted">Your documents records no ingest date, so how current they are cannot be known from here</span>`
      : 'No documents are indexed';

    if (!kb.count) {
      blocked = 'Your documents is empty, so the ask-ai workflow has nothing to answer from. Add a document to the knowledge base first.';
      $('askChips').innerHTML = stateEmpty('The knowledge base is empty',
        'Ask AI answers only from indexed documents, and there are none. Settings lists what is indexed.', 'description');
    } else if (kb.titles.length) {
      $('askChips').innerHTML = `<div class="label-caps" style="margin-bottom:8px">Start from an indexed document</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${kb.titles.slice(0, 8).map(t =>
          `<button class="btn sm" data-chip="${esc(t)}" title="Ask about ${esc(t)}">${esc(t)}</button>`).join('')}
        </div>`;
      $('askChips').querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
        const q = qBox();
        if (!q) return;
        q.value = `What does the ${b.dataset.chip} say?`;
        q.focus();
        syncControls();
      }));
    } else {
      $('askChips').innerHTML = `<div class="cell-sub">${esc(num(kb.count))} indexed section${plural(kb.count, '', 's')}, none of them titled, so there is nothing to offer as a starting point.</div>`;
    }
    renderAlerts();
    syncControls();
  });

  attnP.then(res => {
    attnState = res.ok ? { rows: res.v || [] } : { err: res.err };
    renderAlerts();
  });

  /* ── Which registered workflow is this screen talking to? ────────────────
     trigger_detail carrying the webhook path is the strong match — it is the
     same string n8n routes on. A mention in the name or description is a weaker
     one, and is labelled as a guess rather than presented as a fact. */
  const matchAsk = rows => {
    const byHook = (rows || []).find(w => low(w.trigger_detail).includes(HOOK.askAi));
    if (byHook) return { row: byHook, how: `Matched on trigger_detail naming the ${HOOK.askAi} webhook.` };
    const byName = (rows || []).find(w => /ask[\s._-]?ai|\brag\b/i.test(`${str(w.name)} ${str(w.description)}`));
    if (byName) return { row: byName, how: 'Matched on its name or description mentioning Ask AI. No registered trigger_detail names the webhook path, so this match is a guess.' };
    return { row: null, how: null };
  };

  healthP.then(res => {
    const line = $('askEndpoint');
    if (!res.ok) {
      healthState = { err: res.err };
      if (line) line.innerHTML = `<span class="t-warm">${esc('Workflow health unknown — The automation health figures did not load')}</span>`;
      renderAlerts();
      return;
    }
    const rows = res.v || [];
    const m = matchAsk(rows);
    healthState = { row: m.row, how: m.how, rows };
    if (line) {
      if (!m.row) {
        line.innerHTML = `<span class="t-warm">${esc(`No registered workflow names the ${HOOK.askAi} webhook, so this endpoint's health is unknown`)}</span>`;
      } else {
        const w = m.row;
        const h = str(w.health).toUpperCase();
        /* Was an inline HEALTHY/DEGRADED/NEVER_RAN ternary, which painted
           NEVER_RAN amber. A workflow that has never run is the absence of
           evidence, not a warning, and amber here made it shout louder than a
           workflow that is genuinely failing two doors down. `tone()` gives it
           'cold' — and gives DEGRADED 'hot', which is the value that was
           settled centrally after four screens each decided it privately.
           A blank health falls through tone('') === '' to pill()'s own
           fallback, which reads the UNREPORTED label and lands on 'cold'. */
        /* The counts used to read "N runs in 30 d, M failed" straight off
           runs_30d/failures_30d. For this workflow that is 14 and 0 — and the
           three of those 14 that are its JWT guard turning away an
           unauthenticated caller are not runs it was expected to deliver on.
           Printing them in the denominator next to a HEALTHY pill is the same
           defect lib/health.js was written to end, one step milder: a number
           that disagrees with the verdict beside it. Refusals are named
           separately, and never folded into a rate. */
        const eff = n0(w.effective_runs_30d);
        const succ = n0(w.successes_30d);
        const rej = n0(w.rejected_30d) || 0;
        const hw = healthWords(h);
        const bits = [
          `<span class="mono">${esc(HOOK.askAi)}</span>`,
          h ? pill(h, Object.prototype.hasOwnProperty.call(HEALTH_WORDS, h) ? hw.tone : tone(h), { verbatim: true }) : pill('UNREPORTED', tone(''), { verbatim: false }),
          w.is_active === false ? '<span class="t-hot">registered inactive</span>' : '',
          eff != null && succ != null
            ? `${esc(num(succ))} of ${esc(num(eff))} rated run${plural(eff, '', 's')} succeeded in 30 d`
            : n0(w.runs_30d) != null
              ? `${esc(num(w.runs_30d))} run${plural(w.runs_30d, '', 's')} logged in 30 d, no rated breakdown`
              : '',
          rej ? `${esc(num(rej))} refused by design, not rated` : '',
          w.last_run ? `last run ${esc(ago(w.last_run))}` : 'no run ever recorded',
        ].filter(Boolean);
        line.innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap">${bits.join('<span class="t-muted">·</span>')}</span>`;
        line.title = [m.how, h ? `${h}: ${hw.blurb}` : ''].filter(Boolean).join(' ');
      }
    }
    renderAlerts();
  });

  /* ── This workflow's own track record ───────────────────────────────────
     Only n8n writes the Ask-AI rows in audit_log. (That used to read "only n8n
     writes audit_log" full stop, and stopped being true on 2 Sep 2026: the
     Action Center's action_* functions write rows under the workflow name
     'Inventory Action Center'. They are not registered in workflow_registry and
     never match an Ask-AI name, so they cannot reach this panel — but the
     sentence was a claim about the whole table and the whole table changed.)
     The earlier version of this panel filtered on
     `workflow=ilike.*ask*ai*`, which quietly assumed the workflow logs under a
     name containing both words: if it logs as "RAG Query" that filter returns
     nothing and the panel reports "no runs" for a workflow that runs fine. The
     newest AUDIT_LIMIT rows are read once instead and matched here against the
     names workflow_registry actually records for it.

     The three reads are shared with the alert strip, and `panel()`'s own
     comment names exactly what that costs: a `load` that awaits an already
     settled promise hands back the SAME rejection every time, so its Retry
     button looks like it is working and can never succeed. So the first attempt
     uses the reads already in flight and every attempt after it issues fresh
     ones. */
  let runsAttempt = 0;
  panel($('askRuns'), {
    title: 'Ask-AI run history',
    sub: 'Rows the workflow itself wrote to the activity log — no screen in this dashboard writes an Ask-AI row',
    load: async () => {
      const first = runsAttempt++ === 0;
      const [audit, reg, health] = first
        ? await Promise.all([auditP, regP, healthP])
        : await Promise.all([
            settled(db(`audit_log?select=workflow,status,lead_name,lead_email,intent,summary,logged_at&order=logged_at.desc&limit=${AUDIT_LIMIT}`)),
            settled(db('rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases')),
            healthP,
          ]);
      if (!audit.ok) throw new Error(audit.err);
      const healthRow = health.ok ? matchAsk(health.v).row : null;

      /* The registry is what ties an n8n workflow to the string it writes into
         audit_log. Without it this falls back to matching the display name,
         which is a weaker join, so the difference is stated rather than hidden
         behind a suspiciously short history. */
      const names = new Set();
      let regRow = null;
      if (reg.ok) {
        regRow = (reg.v || []).find(r => healthRow && low(r.name) === low(healthRow.name))
          || (reg.v || []).find(r => /ask[\s._-]?ai|\brag\b/i.test(`${str(r.name)} ${str(r.audit_name)}`));
        if (regRow) {
          [regRow.name, regRow.audit_name, ...(Array.isArray(regRow.audit_aliases) ? regRow.audit_aliases : [])]
            .filter(Boolean).forEach(n => names.add(low(n)));
        }
      }
      if (healthRow?.name) names.add(low(healthRow.name));
      const rows = (audit.v || []).filter(a =>
        names.has(low(a.workflow)) || /ask[\s._-]?ai|\brag\b/i.test(str(a.workflow)));

      /* Identity, only where there is one to resolve. audit_log carries a name
         and an email and no phone number, so the number is looked up per lead —
         and only when a run actually names one, which for a request/response
         endpoint is usually never, so this costs nothing on the normal path. */
      const emails = [...new Set(rows.map(r => low(r.lead_email)).filter(Boolean))];
      const wanted = emails.slice(0, PHONE_LOOKUPS);
      const phones = new Map();
      let phoneErr = false;
      if (wanted.length) {
        const got = await Promise.all(wanted.map(em =>
          settled(db(`leads?select=name,email,phone&email=eq.${encodeURIComponent(em)}&limit=1`))));
        got.forEach((g, i) => {
          if (!g.ok) { phoneErr = true; return; }
          const lead = (g.v || [])[0];
          phones.set(wanted[i], lead ? { found: true, phone: str(lead.phone) } : { found: false });
        });
      }
      return {
        rows, names: [...names], regRow, healthRow, phones, phoneErr,
        skipped: emails.length - wanted.length,
        scanned: (audit.v || []).length,
        regFailed: !reg.ok,
      };
    },
    render: d => {
      const { rows, names, regRow, healthRow, phones, phoneErr, skipped, scanned, regFailed } = d;

      /* Every count on this panel names the window it came from. "No runs" out
         of a 200-row scan is a different statement from "no runs, ever". */
      const provenance = [
        `Matched against the newest ${num(scanned)} activity-log row${plural(scanned, '', 's')}${scanned >= AUDIT_LIMIT ? ' — the read is capped there, so an older run is outside this window rather than absent' : ''}.`,
        regFailed
          ? 'The automation register did not load, so matching fell back to the workflow name alone. A run logged under an alias is missing from this list.'
          : regRow
            ? `Registry names matched on: ${names.length ? names.join(', ') : 'none recorded'}.`
            : 'No the automation register row could be tied to Ask AI, so matching fell back to the workflow name alone.',
        healthRow && healthRow.writes_audit_log === false
          ? 'The registry records this workflow as writing no audit row — it answers its caller instead, and this dashboard shows that answer in the thread above. An empty list here is the design rather than a gap; the cost is that nothing can tell you how it behaved yesterday.'
          : '',
        phoneErr ? 'At least one phone-number lookup failed, so a lead below may show no number when one exists.' : '',
        skipped > 0
          ? `Phone numbers were looked up for the first ${num(PHONE_LOOKUPS)} leads only; ${num(skipped)} further lead${plural(skipped, '', 's')} ${plural(skipped, 'shows', 'show')} no number for that reason alone.`
          : '',
      ].filter(Boolean);
      const foot = `<div class="list-item" style="cursor:default;align-items:flex-start">
        <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
        <div class="cell-sub" style="white-space:normal">${provenance.map(esc).join('<br>')}</div></div>`;

      if (!rows.length) {
        return stateEmpty('No Ask-AI runs recorded',
          'No the activity log row inside the window described below matches an Ask-AI workflow.', 'history') + foot;
      }

      /* `rows.filter(status === 'SUCCESS').length / rows.length` is what stood
         here, and on live data it prints "11 of the 14 matched runs succeeded"
         directly beneath a pill reading HEALTHY. Both were right about their own
         arithmetic and the screen still contradicted itself, because the other
         three rows are this workflow's JWT guard rejecting an unauthenticated
         caller — refused by design, and excluded from the rate by the same
         Postgres function v_workflow_health uses. lib/health.js mirrors that
         function and is the only thing in the frontend allowed to decide what a
         status means, so the count is built from it: successes over qualifying
         runs, refusals named separately, and a partial never quietly counted as
         either. */
      const rated = rows.filter(isQualifying);
      const ok = rated.filter(isSuccess).length;
      const refused = rows.filter(isRefusal).length;
      const head = `<div class="cell-sub" style="padding:14px 20px 0">${esc(num(ok))} of the ${esc(num(rated.length))} rated run${plural(rated.length, '', 's')} succeeded${
        refused ? ` · ${esc(num(refused))} further request${plural(refused, '', 's')} refused by design and not rated` : ''}${
        rows.length !== rated.length + refused ? ` · ${esc(num(rows.length - rated.length - refused))} handed to a person on purpose` : ''}${
        rows[0]?.logged_at ? ' · most recent ' + esc(ago(rows[0].logged_at)) : ''}</div>`;

      /* A person, with their phone number beside their name — and an absent
         number rendered as an absence, never as a blank. A workflow has written
         a raw WhatsApp handle into a name column before now, so a handle is
         shown as one: mono, labelled, never as somebody's name. */
      const who = r => {
        const nm = str(r.lead_name);
        const em = low(r.lead_email);
        if (!nm && !em) return '<span class="t-muted">—</span>';
        const rec = em ? phones.get(em) : null;
        const nameHtml = !nm
          ? '<span class="t-muted">No name recorded</span>'
          : isHandle(nm)
            ? `<span class="mono" title="A WhatsApp chat handle, not a name. A LID contains no phone digits and identifies nobody on its own.">${esc(nm)}</span> <span class="chip">chat handle</span>`
            : esc(nm);
        let phoneHtml;
        if (rec && rec.found) phoneHtml = rec.phone ? `<span class="mono">${esc(maskText(rec.phone))}</span>` : '— no phone on the lead';
        else if (rec) phoneHtml = '— no lead row matches this email';
        else if (!em) phoneHtml = '— no email to look a number up by';
        else if (phoneErr) phoneHtml = '<span class="t-warm">phone lookup failed</span>';
        else phoneHtml = '— not looked up';
        return `<div>${nameHtml}</div><div class="cell-sub">${phoneHtml}${em ? ` · ${esc(em)}` : ''}</div>`;
      };

      return head + table([
        { label: 'When', render: r => `<span class="t-muted">${esc(ago(r.logged_at))}</span>` },
        /* The raw status is not the outcome. Finance Calc and Master Router
           both write FAILED on rows whose own summary says some claimed step did
           not land, and that correction lives in lib/health.js beside the SQL it
           mirrors — not in a per-screen ternary. The database's own word is kept
           in the hover so nothing is hidden by the translation. */
        { label: 'Outcome', render: r => {
            const w = outcomeWords(outcomeOf(r));
            return `<span title="${esc(`This run was recorded as ${str(r.status) || 'having no status'}. ${w.blurb}`)}">${pill(w.label, w.tone, { verbatim: false })}</span>`;
          } },
        { label: 'Workflow', render: r => esc(str(r.workflow) || '—') },
        { label: 'Lead', render: who },
        { label: 'Summary', render: r => `${esc(str(r.summary) || '—')}${r.intent ? `<div class="cell-sub">${esc(r.intent)}</div>` : ''}` },
      ], rows) + foot;
    },
  });
};

/* ==========================================================================
   S7 · Finance Desk
   ========================================================================== */
