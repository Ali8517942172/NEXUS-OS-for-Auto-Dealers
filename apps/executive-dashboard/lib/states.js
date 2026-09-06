/* NEXUS OS — lib/states.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten — except stateError(), which was
   rewritten on 5 Sep 2026 because it rendered raw backend error text to the
   user on fifteen screens. lib/errors.js holds the reasoning and the wording. */
import { classify, describe, logError } from './errors.js';
import { esc } from './format.js';

const stateEmpty = (title, body, icon = 'inbox') =>
  `<div class="state"><span class="material-symbols-outlined">${icon}</span><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;

/* `err` is the failure itself and is NEVER rendered — it goes to the console
   for a developer and nowhere else. What the user reads is one of the four
   sentences in lib/errors.js, chosen from the case this app can actually prove:
   a dead session, a refusal, an unreachable server, or "something failed and we
   are not going to guess which".

   `what` is unchanged and is still shown: it is prose a screen wrote about its
   own subject ("closed-won deals", "the KYC register"), not anything the
   backend said, and it is the difference between a panel that failed and a page
   that failed. The heading keeps its exact wording for a second reason —
   QUALITY_GATE.mjs detects a screen in the error state by matching
   /Couldn.t load/ on the rendered HTML.

   `note` is the escape hatch, and it is deliberately a separate argument rather
   than a licence to pass error text again: some callers have something true and
   specific to add that the app knows first-hand — screens/conversations.js can
   say that no key on a thread could be matched, so nothing was queried and the
   blank panel is not evidence the customer has no history. That sentence is
   ours, it is reviewed, and it must survive. Where a note is given without an
   error, the generic "try again" line is dropped: the note is the honest
   account, and inviting a retry against a permanent condition is not.

   No retry button on an expired session. The button would fail identically
   every time, and lib/data.js has already painted the login card over the app
   by the time this renders. */
const stateError = (what, err, retry, note) => {
  const noteOnly = err == null && note;
  if (!noteOnly) logError(`could not load ${what}`, err);
  const c = describe(err);
  const said = noteOnly
    ? `<p>${esc(note)}</p>`
    : `<p>${esc(c.line)} ${esc(c.next)}</p>${note ? `<p>${esc(note)}</p>` : ''}`;
  const canRetry = retry && (noteOnly || classify(err) !== 'session');
  return `<div class="state err"><span class="material-symbols-outlined">error</span><h3>Couldn't load ${esc(what)}</h3>
   ${said}${canRetry ? `<button class="btn" data-retry="${esc(retry)}">Retry</button>` : ''}</div>`;
};

const stateLoading = (rows = 5) =>
  `<div style="padding:20px">${Array.from({length:rows}, (_,i) =>
    `<div class="skeleton" style="height:16px;margin-bottom:12px;width:${95 - i*7}%"></div>`).join('')}</div>`;
const noSource = msg =>
  `<div class="state"><span class="material-symbols-outlined">link_off</span><h3>No data source yet</h3><p>${esc(msg)}</p></div>`;

/* ── Data access ─────────────────────────────────────────────────────────── */

export { stateEmpty, stateError, stateLoading, noSource };
