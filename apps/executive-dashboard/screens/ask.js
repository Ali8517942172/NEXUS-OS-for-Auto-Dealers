/* NEXUS OS — screens/ask.js
   The RAG console. One question box, one honest thread.

   Ask AI is the least reliable surface in this product and the history of this
   file is the history of that: the webhook has been dead behind CORS, dead
   behind a missing Authorization allow-list, and dead behind three OpenRouter
   models that no longer existed. A single retrieval + model round trip on this
   box has been measured at 8.8 s and the workflow has no upper bound of its own.
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
   compressed into a digit in the sidebar that nothing can explain. */
import { HOOK, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { ago, clock, esc, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { panel, table } from '../lib/ui.js';

/* Long enough that a slow-but-working retrieval is not called a failure — the
   slowest verified end-to-end run was 8.8 s — short enough that a genuinely
   stuck request stops pretending. The request itself is not cancellable: n8n()
   owns the connection and exposes no abort, so this deadline reports, it does
   not kill. Anything that arrives later is still shown. */
const DEADLINE_MS = 45000;

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
function sourcesOf(res) {
  const raw = res && Array.isArray(res.sources) ? res.sources
    : res && Array.isArray(res.citations) ? res.citations : [];
  return raw.map(s => {
    if (typeof s === 'string') return { title: s, unknown: false };
    if (!s || typeof s !== 'object') return { unknown: true, blob: String(s) };
    const norm = {
      title:   s.title ?? s.doc_title ?? s.document ?? null,
      section: s.section ?? null,
      page:    s.page_number ?? s.page ?? null,
      file:    s.source_file ?? s.file ?? null,
      snippet: typeof s.content === 'string' ? s.content
             : typeof s.chunk === 'string' ? s.chunk
             : typeof s.text === 'string' ? s.text : null,
    };
    /* An unrecognised citation shape is shown verbatim rather than silently
       dropped — a citation the operator cannot see is a citation they cannot
       check. */
    if (!norm.title && !norm.file && !norm.section) return { unknown: true, blob: JSON.stringify(s) };
    return norm;
  });
}

/* One place decides whether a turn is grounded, so the border, the pill, the
   banner and the alert strip can never disagree about the same answer. */
function grounded(e) {
  if (!e || e.status !== 'ok') return null;
  const src = sourcesOf(e.res);
  return { src, cited: src.length, uncited: !!e.answer && src.length === 0, zeroDocs: docCount(e.res) === 0 };
}

/* ── Failure classification ─────────────────────────────────────────────────
   db()/n8n() format transport errors as "<status> — <body>", and the browser
   reports a blocked or unreachable request as "Failed to fetch". Each of those
   means something different to whoever has to fix it. */
function diagnose(msg) {
  const m = String(msg || '');
  if (/VITE_N8N_BASE_URL/.test(m))
    return 'This build has no n8n base URL compiled into it, so no workflow can be called from the browser at all.';
  if (/Session expired/i.test(m))
    return 'The Supabase session ended. Sign in again and re-ask.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m))
    return 'The browser never got a reply from the n8n host. That is the request being blocked or the host being unreachable — a CORS allow-list that is missing Authorization has caused exactly this before — not the workflow declining to answer.';
  const code = (m.match(/^(\d{3})\b/) || [])[1];
  if (code === '401' || code === '403')
    return 'The workflow rejected this request as unauthorised. Its JWT guard did not accept the session token this dashboard sent.';
  if (code === '404')
    return 'n8n has no webhook registered at this path right now, which normally means the Ask-AI workflow is not active.';
  if (code === '429')
    return 'The workflow or its model provider is rate-limiting. Wait and re-ask.';
  if (code && code.startsWith('5'))
    return 'The workflow ran and failed inside n8n. The execution log there will name the node that threw.';
  return '';
}

/* ── Answer formatting ──────────────────────────────────────────────────────
   The model returns plain text with paragraphs, bullets and the occasional
   **bold**. Escape first, then re-introduce only that small set of marks — the
   string is model output and is treated as hostile. Deliberately not rendered
   in a .bubble: that class is pre-wrap, which would also honour the whitespace
   in this generated markup. */
function inlineMarks(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
}
function answerHtml(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return blocks.map(b => {
    const rows = b.split('\n');
    if (rows.length === 1 && /^#{1,6}\s+/.test(rows[0]))
      return `<div class="label-caps" style="margin:14px 0 6px">${inlineMarks(rows[0].replace(/^#{1,6}\s+/, ''))}</div>`;
    const bulleted = rows.every(r => /^\s*([-*•]|\d+[.)])\s+/.test(r));
    if (bulleted) return `<div style="margin:0 0 10px">${rows.map(r => {
      const marker = r.match(/^\s*(\d+[.)])\s+/);
      const body = r.replace(/^\s*([-*•]|\d+[.)])\s+/, '');
      return `<div style="display:flex;gap:8px;margin-bottom:4px"><span class="t-muted" style="flex-shrink:0">${marker ? esc(marker[1]) : '•'}</span><span>${inlineMarks(body)}</span></div>`;
    }).join('')}</div>`;
    return `<div style="margin:0 0 10px">${inlineMarks(b).replace(/\n/g, '<br>')}</div>`;
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
    const hint = isTimeout ? '' : diagnose(e.err);
    return head + `<div class="banner hot" style="margin-bottom:0">
        <span class="material-symbols-outlined" style="font-size:20px">${isTimeout ? 'hourglass_disabled' : 'error'}</span>
        <div><div style="font-weight:500">${isTimeout
            ? `No reply after ${Math.round(DEADLINE_MS / 1000)} seconds`
            : 'The Ask-AI workflow did not answer'}</div>
          <div style="margin-top:4px">${isTimeout
            ? 'The request was not cancelled — this dashboard cannot cancel it. If it lands, the answer will appear here and be marked late.'
            : esc(e.err || 'Unknown error')}</div>
          ${hint ? `<div style="margin-top:6px">${esc(hint)}</div>` : ''}</div>
      </div>
      <div class="cell-sub" style="margin-top:10px">Asked at ${esc(clock(e.at))}${e.ms != null ? (isTimeout ? ' · stopped waiting after ' : ' · failed after ') + esc(secs(e.ms)) : ''}</div>`
      + foot(e.rawText);
  }

  /* Answered. */
  const g = grounded(e);
  const src = g.src;
  const dc = docCount(e.res);
  const model = typeof e.res?.model === 'string' ? e.res.model : null;

  /* The grounding verdict leads the meta line rather than trailing it. An
     operator skims the first thing under an answer, and whether anything was
     cited is the single fact that decides if the answer may be repeated to a
     customer. */
  const verdict = e.answer
    ? (src.length
        ? pill(`${num(src.length)} source${plural(src.length, '', 's')} cited`, 'ok')
        : pill('No sources cited', 'warm'))
    : '';
  const meta = [
    e.ms != null ? `Answered in ${esc(secs(e.ms))}` : null,
    e.late ? '<span class="t-warm">arrived after the timeout</span>' : null,
    `asked at ${esc(clock(e.at))}`,
    dc != null ? `${esc(num(dc))} document section${dc === 1 ? '' : 's'} consulted` : null,
    model ? `model ${esc(model)}` : null,
  ].filter(Boolean).join(' · ');

  const body = e.answer
    ? answerHtml(e.answer)
    : `<div class="banner warm" style="margin-bottom:0">
         <span class="material-symbols-outlined" style="font-size:20px">help_center</span>
         <div>The workflow replied, but the reply carried no answer text. The raw response below is exactly what it sent.</div></div>`;

  const zeroDocs = dc === 0 ? `<div class="banner warm" style="margin:14px 0 0">
      <span class="material-symbols-outlined" style="font-size:20px">search_off</span>
      <div>Nothing in the knowledge base matched this question, so whatever is above is not grounded in your documents. Asking in a full sentence, with the words the document itself uses, is what makes retrieval fire.</div></div>` : '';

  /* An uncited answer is the model speaking for itself and must not be skimmed
     as a sourced one, so it gets a banner of its own on top of the pill and the
     border. Suppressed where the workflow already reported consulting nothing,
     because the banner above says the same thing better. */
  const uncited = (g.uncited && dc !== 0) ? `<div class="banner warm" style="margin:14px 0 0">
      <span class="material-symbols-outlined" style="font-size:20px">unpublished</span>
      <div><div style="font-weight:500">Nothing was cited for this answer</div>
        <div style="margin-top:4px">The workflow returned no citation list, so there is no document to check this against — treat it as the model's own words${dc != null ? `, even though it reported consulting ${esc(num(dc))} section${dc === 1 ? '' : 's'}` : ''}. Do not repeat it to a customer without opening the source document yourself.</div></div></div>` : '';

  const sources = src.length ? `<div style="margin-top:18px">
      <div class="label-caps" style="margin-bottom:8px">Sources</div>
      ${src.map((s, i) => s.unknown
        ? `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="chip">${i + 1}</span>
             <div class="mono cell-sub" style="flex:1;min-width:0;white-space:normal;word-break:break-word">${esc(s.blob)}</div></div>`
        : `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="chip">${i + 1}</span>
             <div style="flex:1;min-width:0">
               <div style="font-weight:500">${esc(s.title || s.file || 'Untitled document')}</div>
               <div class="cell-sub">${[
                  s.section ? esc(s.section) : null,
                  s.page != null ? 'p. ' + esc(s.page) : null,
                  s.file && s.file !== s.title ? esc(s.file) : null,
                ].filter(Boolean).join(' · ') || 'No section recorded'}</div>
               ${s.snippet ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">${esc(s.snippet.length > 320 ? s.snippet.slice(0, 320) + '…' : s.snippet)}</div>` : ''}
             </div></div>`).join('')}
      <div class="cell-sub" style="white-space:normal;margin-top:8px">A citation says which indexed section an answer came from. It cannot say how old that section is: rag_documents stores no ingest date, so a cited answer is grounded but of unknown vintage. Open the document itself before quoting a rate, a term or a policy to a customer.</div>
    </div>` : '';

  return head + body + zeroDocs + uncited + sources
    + `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">${verdict}<span class="cell-sub">${meta}</span></div>`
    + foot(e.rawText);
}

/* The left edge of a turn card carries its verdict, so a thread of six answers
   can be read for trustworthiness without opening any of them. */
function turnEdge(e) {
  if (e.status === 'pending') return '3px solid var(--neutral)';
  if (e.status === 'error' || e.status === 'timeout') return '3px solid var(--hot)';
  const g = grounded(e);
  if (!g) return '';
  if (!e.answer || g.uncited || g.zeroDocs) return '3px solid var(--warm)';
  return '3px solid var(--ok)';
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

  const thread = $('askThread');
  const box = $('askQ');
  const goBtn = $('askGo');

  /* ── Availability. A control that cannot work is disabled and says why. ── */
  let blocked = N8N_BASE
    ? ''
    : 'VITE_N8N_BASE_URL is not set in this build, so the ask-ai webhook cannot be called from the browser.';

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
             table. `tone()` maps an unknown value to 'cold' and a blank to no
             tone at all, which is what not knowing actually looks like. */
          tone: tone(it.severity),
          icon: 'priority_high',
          durable: true,
          title: str(it.title) || str(it.kind) || 'Needs attention',
          badge: str(it.kind),
          detail: esc(str(it.detail) || 'v_needs_attention recorded no detail for this row.'),
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
        title: 'v_needs_attention did not load',
        detail: `${esc(attnState.err)}<br>Anything that view would have raised for this screen is missing from the list below. The knowledge-base and workflow checks under it are unaffected — they read different tables.`,
        target: 'askAlerts',
      });
    }

    /* 2 · The bundle itself. Nothing on this screen can work without it. */
    if (!N8N_BASE) {
      out.push({
        id: 'env', tone: 'hot', icon: 'link_off', durable: true,
        title: 'This build cannot reach n8n at all',
        detail: 'VITE_N8N_BASE_URL is empty in the bundle that is running, so the ask-ai webhook has no address to post to. Ask is disabled rather than left to fail on every press. This is a deployment variable — nothing in the dashboard can set it.',
        target: 'askComposer',
      });
    }

    /* 3 · Is the knowledge base worth asking? */
    if (kbState?.err) {
      out.push({
        id: 'kb-failed', tone: 'warm', icon: 'quiz', durable: true,
        title: 'The knowledge base could not be counted',
        detail: `${esc(kbState.err)}<br>So this screen cannot say how many sections Ask AI can reach, or which documents they came from. When they were ingested was never knowable — rag_documents keeps no date — so that much is unchanged. Ask is deliberately left enabled: a failed read here says nothing about whether the workflow works. Judge each answer by its citations instead.`,
        target: 'askComposer', settings: true,
      });
    } else if (kbState) {
      if (!kbState.count) {
        out.push({
          id: 'kb-empty', tone: 'hot', icon: 'folder_off', durable: true,
          title: 'The knowledge base is empty',
          detail: 'rag_documents holds no rows, so retrieval can return nothing and every answer would be the model guessing from its training data. Ask is disabled until a document is ingested — an ungrounded answer that looks grounded is worse than no answer at all.',
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
          detail: `<span class="mono">rag_documents</span> stores no timestamp of any kind — the table is <span class="mono">id, doc_title, source_file, section, page_number, content, search_vector</span> and none of those records when a section was ingested. So the ${esc(num(kbState.count))} indexed section${plural(kbState.count, '', 's')} below could have been written last night or two years ago, and this screen will not guess: row order is insertion order at best and arbitrary at worst, so "the newest document" is not a thing that can be computed here. Every answer on this screen is therefore grounded in documents of unknown vintage. Before repeating a finance rate, a warranty term or a policy to a customer, open the cited document and check its own date.`,
          foot: 'Fixing this needs a timestamp column on rag_documents and a re-ingest. Nothing in the browser can add one, and no webhook accepts a document.',
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
        detail: `${esc(healthState.err)}<br>v_workflow_health is what says whether ask-ai is active and whether it has been failing, so none of that is known right now. The Ask button is unaffected: pressing it is still the direct test.`,
        target: 'askComposer',
      });
    } else if (healthState && !healthState.row) {
      out.push({
        id: 'wf-missing', tone: 'warm', icon: 'search_off', durable: true,
        title: 'No registered workflow matches ask-ai',
        detail: `v_workflow_health returned ${esc(num(healthState.rows.length))} workflow${plural(healthState.rows.length, '', 's')} and none names the <span class="mono">${esc(HOOK.askAi)}</span> webhook in its trigger detail or mentions Ask AI. So nothing here can report this endpoint's health, and its absence from workflow_registry is itself worth fixing.`,
        target: 'askComposer',
      });
    } else if (healthState?.row) {
      const w = healthState.row;
      const h = str(w.health).toUpperCase();
      const r30 = n0(w.runs_30d) || 0;
      const f30 = n0(w.failures_30d) || 0;
      if (w.is_active === false) {
        out.push({
          id: 'wf-inactive', tone: 'hot', icon: 'toggle_off', durable: true,
          title: `"${str(w.name) || 'The Ask-AI workflow'}" is registered as inactive`,
          detail: 'An inactive workflow has no live webhook in n8n, so a question posted from here comes back 404 however it is worded. Activating it in n8n is what fixes this; the dashboard cannot.',
          target: 'askComposer',
        });
      }
      if (h === 'DEGRADED') {
        out.push({
          id: 'wf-degraded', tone: 'hot', icon: 'error', durable: true,
          title: 'The Ask-AI workflow is DEGRADED',
          detail: `v_workflow_health reports ${esc(num(f30))} failure${plural(f30, '', 's')} out of ${esc(num(r30))} run${plural(r30, '', 's')} in the last 30 days. An answer that does come back is still worth reading — the failures are the runs that never produced one.`,
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
          detail: 'The registry says this workflow should write an audit row and v_workflow_health has none from it. It could be running perfectly or failing every time; from here the two are indistinguishable.',
          target: 'askRuns',
        });
      } else if (h !== 'HEALTHY') {
        /* Anything that is not one of the four documented values falls to here,
           including an empty one. Without this branch such a row raised no
           alert at all, and the all-clear underneath then claimed the workflow
           "is not reporting failures" — which is not what an unknown says. Cold
           on purpose: not knowing is not a fault, so it is stated and not
           dressed up as one. */
        out.push({
          id: 'wf-unreported', tone: 'cold', icon: 'help', durable: true,
          title: h ? `Unrecognised workflow health: ${h}` : 'The registry reports no health for this workflow',
          detail: h
            ? `v_workflow_health returned <span class="mono">${esc(h)}</span> for <span class="mono">${esc(str(w.name) || 'this workflow')}</span>, which is not one of the four values this build knows how to read (HEALTHY, DEGRADED, NEVER_RAN, NOT_INSTRUMENTED). It is printed verbatim above rather than mapped to a verdict it may not mean.`
            : `v_workflow_health matched <span class="mono">${esc(str(w.name) || 'this workflow')}</span> but left its <span class="mono">health</span> column empty, so whether ask-ai is healthy or failing is not known from here. Pressing Ask remains the direct test.`,
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
        detail: `Waiting <span id="askAlertAge" class="num">${esc(secs(Date.now() - slow.at))}</span> for the workflow to answer, against about 9 s on a good run. The tab is not hung — the request is genuinely still open — and this screen stops waiting on it at ${Math.round(DEADLINE_MS / 1000)} s.`,
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
          ? `The most recent stopped being waited on after ${Math.round(DEADLINE_MS / 1000)} s, with the request still open.`
          : `${esc(str(newest.err) || 'Unknown error')}${diagnose(newest.err) ? `<br>${esc(diagnose(newest.err))}` : ''}`,
        target: `askE${newest.id}`,
      });
    }
    const uncited = HISTORY.filter(e => grounded(e)?.uncited);
    if (uncited.length) {
      const zero = uncited.filter(e => grounded(e).zeroDocs).length;
      out.push({
        id: 'turn-uncited', tone: 'warm', icon: 'unpublished', durable: false,
        title: `${num(uncited.length)} answer${plural(uncited.length, '', 's')} in this session cited nothing`,
        detail: `An answer with no citation is not attributable to any indexed document — it is the model's own words, and on screen it reads exactly like a sourced one.${zero ? ` ${esc(num(zero))} of them came back reporting zero document sections consulted, meaning retrieval found nothing at all.` : ''} Open each one and check it before repeating it to anybody.`,
        target: `askE${uncited[0].id}`,
      });
    }
    return out.sort((a, b) => (SEV_RANK[a.tone] ?? 3) - (SEV_RANK[b.tone] ?? 3));
  }

  function renderAlerts() {
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
      attnState?.rows ? `v_needs_attention: ${num(attnState.rows.length)} row${plural(attnState.rows.length, '', 's')} for this screen`
        : attnState?.err ? 'v_needs_attention: unreadable' : 'v_needs_attention: still reading',
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
        ? 'v_needs_attention has no branch that targets this screen today, so an empty result from it is expected rather than evidence that nothing is wrong. Everything else above is computed here, from reads this screen already makes.'
        : '',
      `${num(durable.length)} of the ${num(alerts.length)} row${plural(alerts.length, '', 's')} above ${plural(durable.length, 'is', 'are')} durable and worth acting on — a fact about the system, read from v_needs_attention, the knowledge base or v_workflow_health, that will still be true after a reload. The rest are shown and deliberately not counted: session alerts (a question that failed, an answer that cited nothing) exist only in this tab and vanish when it reloads, and informational rows state something that cannot be fixed from here.`,
      'The sidebar badge over Ask AI is not this number and is not written by this screen. Nav badges are painted centrally from v_needs_attention alone, and that view has no branch that files anything against this screen — so the sidebar is silent here even when the list above is not, and this strip is the only place these are reported.',
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
        ? `${num(kbState.count)}${kbState.capped ? '+' : ''} indexed section${plural(kbState.count, '', 's')} in the knowledge base, of unknown vintage — rag_documents keeps no ingest date, so nothing here can say whether they are current.`
        : '',
      healthState?.row
        ? `v_workflow_health reports the ask-ai workflow ${str(healthState.row.health) || 'with no health value'}.`
        : '',
      attnState?.rows ? 'v_needs_attention returned no row filed against this screen.' : '',
      HISTORY.length
        ? `All ${num(HISTORY.length)} question${plural(HISTORY.length, '', 's')} asked in this session came back answered, and every answer cited at least one document.`
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
        ${a.settings ? `<button class="btn sm ghost" data-goto="settings" title="Settings lists every indexed document and the columns rag_documents actually returned.">Knowledge base</button>` : ''}
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
    const node = document.getElementById(`askE${e.id}`);
    stopTicker(e.id);
    if (!node) return;
    node.innerHTML = entryBody(e);
    node.style.borderLeft = turnEdge(e);
    if (e.status === 'pending') {
      tickers.set(e.id, setInterval(() => {
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
    if (act === 'edit') { box.value = e.q; box.focus(); syncControls(); return; }
    if (act === 'again') { box.value = e.q; syncControls(); submit(); return; }
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
    if (!HISTORY.length) {
      thread.innerHTML = `<div class="card">${stateEmpty('Nothing asked yet',
        'Answers appear here newest first and stay for as long as this tab is open. They are not saved anywhere.',
        'auto_awesome')}</div>`;
      return;
    }
    thread.innerHTML = HISTORY.map(e => `<div class="card" id="askE${e.id}" style="margin-bottom:14px"></div>`).join('');
    HISTORY.forEach(paint);
  }

  /* ── Asking ─────────────────────────────────────────────────────────────── */
  async function submit() {
    if (blocked) return;
    const q = box.value.trim();
    if (!q) return;
    if (HISTORY.some(e => e.status === 'pending')) return;

    const e = { id: ++SEQ, q, at: Date.now(), status: 'pending', ms: null, showRaw: false, slow: false };
    HISTORY.unshift(e);
    box.value = '';
    renderThread();
    syncControls();
    renderAlerts();

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
        e.rawText = '';
      }
      paint(e);
      syncControls();
      renderAlerts();
    };

    const winner = await Promise.race([settle, wait(DEADLINE_MS).then(() => TIMED_OUT)]);
    if (winner !== TIMED_OUT) { finish(winner); return; }

    e.status = 'timeout';
    e.ms = DEADLINE_MS;
    e.slow = false;
    paint(e);
    syncControls();
    renderAlerts();
    /* The connection is still open. If it lands, the turn is rewritten with the
       real answer and flagged late — an answer that arrived is an answer. */
    settle.then(out => { e.late = true; finish(out); });
  }

  goBtn.addEventListener('click', submit);
  box.addEventListener('input', syncControls);
  box.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit(); }
  });
  $('askReset').addEventListener('click', () => { box.value = ''; box.focus(); syncControls(); });
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
  const healthP = settled(db('v_workflow_health?select=id,name,category,trigger_type,trigger_detail,description,is_active,writes_audit_log,runs,failures,success_rate,last_run,runs_30d,failures_30d,last_failure,health&limit=200'));
  const auditP  = settled(db(`audit_log?select=workflow,status,lead_name,lead_email,intent,summary,logged_at&order=logged_at.desc&limit=${AUDIT_LIMIT}`));
  const regP    = settled(db('workflow_registry?select=id,name,audit_name,audit_aliases'));

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
      ? `${esc(kb.capped ? 'At least ' : '')}${esc(num(kb.count))} indexed section${plural(kb.count, '', 's')} across ${esc(num(kb.titles.length))} document${plural(kb.titles.length, '', 's')} · answers are drawn only from these · <span class="t-muted">rag_documents records no ingest date, so how current they are cannot be known from here</span>`
      : 'No documents are indexed';

    if (!kb.count) {
      blocked = 'rag_documents is empty, so the ask-ai workflow has nothing to answer from. Add a document to the knowledge base first.';
      $('askChips').innerHTML = stateEmpty('The knowledge base is empty',
        'Ask AI answers only from indexed documents, and there are none. Settings lists what is indexed.', 'description');
    } else if (kb.titles.length) {
      $('askChips').innerHTML = `<div class="label-caps" style="margin-bottom:8px">Start from an indexed document</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${kb.titles.slice(0, 8).map(t =>
          `<button class="btn sm" data-chip="${esc(t)}" title="Ask about ${esc(t)}">${esc(t)}</button>`).join('')}
        </div>`;
      $('askChips').querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
        box.value = `What does the ${b.dataset.chip} say?`;
        box.focus();
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
      if (line) line.innerHTML = `<span class="t-warm">${esc('Workflow health unknown — v_workflow_health did not load')}</span>`;
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
        const bits = [
          `<span class="mono">${esc(HOOK.askAi)}</span>`,
          pill(h || 'UNREPORTED', tone(h)),
          w.is_active === false ? '<span class="t-hot">registered inactive</span>' : '',
          n0(w.runs_30d) != null
            ? `${esc(num(w.runs_30d))} run${plural(w.runs_30d, '', 's')} in 30 d, ${esc(num(n0(w.failures_30d) || 0))} failed`
            : '',
          w.last_run ? `last run ${esc(ago(w.last_run))}` : 'no run ever recorded',
        ].filter(Boolean);
        line.innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap">${bits.join('<span class="t-muted">·</span>')}</span>`;
        line.title = m.how || '';
      }
    }
    renderAlerts();
  });

  /* ── This workflow's own track record ───────────────────────────────────
     Only n8n writes audit_log. The earlier version of this panel filtered on
     `workflow=ilike.*ask*ai*`, which quietly assumed the workflow logs under a
     name containing both words: if it logs as "RAG Query" that filter returns
     nothing and the panel reports "no runs" for a workflow that runs fine. The
     newest AUDIT_LIMIT rows are read once instead and matched here against the
     names workflow_registry actually records for it. */
  panel($('askRuns'), {
    title: 'Ask-AI run history',
    sub: 'Rows the workflow itself wrote to audit_log — the dashboard cannot write these',
    load: async () => {
      const [audit, reg, health] = await Promise.all([auditP, regP, healthP]);
      if (!audit.ok) throw new Error(audit.err);
      const healthRow = health.ok ? matchAsk(health.v).row : null;

      /* The registry is what ties an n8n workflow to the string it writes into
         audit_log. Without it this falls back to matching the display name,
         which is a weaker join, so the difference is stated rather than hidden
         behind a suspiciously short history. */
      const names = new Set();
      let regRow = null;
      if (reg.ok) {
        regRow = (reg.v || []).find(r => healthRow && String(r.id) === String(healthRow.id))
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
        `Matched against the newest ${num(scanned)} audit_log row${plural(scanned, '', 's')}${scanned >= AUDIT_LIMIT ? ' — the read is capped there, so an older run is outside this window rather than absent' : ''}.`,
        regFailed
          ? 'workflow_registry did not load, so matching fell back to the workflow name alone. A run logged under an alias is missing from this list.'
          : regRow
            ? `Registry names matched on: ${names.length ? names.join(', ') : 'none recorded'}.`
            : 'No workflow_registry row could be tied to Ask AI, so matching fell back to the workflow name alone.',
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
          'No audit_log row inside the window described below matches an Ask-AI workflow.', 'history') + foot;
      }

      const ok = rows.filter(r => str(r.status).toUpperCase() === 'SUCCESS').length;
      const head = `<div class="cell-sub" style="padding:14px 20px 0">${esc(num(ok))} of the ${esc(num(rows.length))} matched run${plural(rows.length, '', 's')} succeeded${rows[0]?.logged_at ? ' · most recent ' + esc(ago(rows[0].logged_at)) : ''}</div>`;

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
        if (rec && rec.found) phoneHtml = rec.phone ? `<span class="mono">${esc(rec.phone)}</span>` : '— no phone on the lead';
        else if (rec) phoneHtml = '— no lead row matches this email';
        else if (!em) phoneHtml = '— no email to look a number up by';
        else if (phoneErr) phoneHtml = '<span class="t-warm">phone lookup failed</span>';
        else phoneHtml = '— not looked up';
        return `<div>${nameHtml}</div><div class="cell-sub">${phoneHtml}${em ? ` · ${esc(em)}` : ''}</div>`;
      };

      return head + table([
        { label: 'When', render: r => `<span class="t-muted">${esc(ago(r.logged_at))}</span>` },
        { label: 'Status', render: r => pill(str(r.status) || 'UNKNOWN') },
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
