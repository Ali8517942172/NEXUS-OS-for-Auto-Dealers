/* NEXUS OS — lib/errors.js
   New on 5 Sep 2026, for one defect with a wide blast radius: lib/states.js
   rendered whatever error text it was handed straight onto the screen, and
   fifteen screens hand it a backend error.

   What was reaching a dealership user's screen: a PostgREST body carries
   `message`, `details`, `hint` and `code` — table names, column names,
   constraint names, function signatures and role names, all four internal. A
   Postgres error underneath it carries the same plus SQLSTATEs. An n8n failure
   carries node names and the workflow's own URL. None of that is user copy, and
   a rep reading "permission denied for table leads" learns nothing they can act
   on while learning the shape of the database.

   So there are two audiences and they are separated here rather than at each of
   the ~60 places that touch an error:

   - The USER gets one short sentence from the table below, and where the app
     genuinely knows what to do next, a second one saying it.
   - The DEVELOPER gets the original error object, unaltered, through
     console.error under the stable prefix `[NEXUS error]`. Grep for that.

   The four cases are the ones this app can honestly tell apart, and no more.
   401 is a dead session, 403/42501 is a refusal by authorisation, a rejected
   fetch is the network, and everything else — 400, 404, 500, a parse failure, a
   thrown screen bug — is GENERIC. A guess dressed as a diagnosis ("the server
   is down") would be worse than the admission, so anything unplaceable says the
   generic thing.

   What is deliberately NOT in this table: an absence. "There is nothing to show"
   is not an error and never renders through here — that is stateEmpty(), and
   the two must not be allowed to collapse into one another. A failed read
   rendered as "no data yet" would be this codebase inventing an absence, which
   CLAUDE.md records it doing in six places already.

   ── Two strings per case, on purpose ──────────────────────────────────────
   `line`/`next` are the sentences a panel shows. `phrase` is the same fact as a
   clause, because roughly twenty screens interpolate an error into prose they
   wrote themselves — "purchase_history could not be read (…), so nothing below
   is a zero, it is an unknown." Those sentences are load-bearing honesty copy
   and they read badly with a full sentence dropped into the brackets. So the
   errors this app throws carry `phrase` as their `.message`, which keeps every
   one of those call sites safe without editing it, and `classify()` maps a
   phrase back to its case so a call site that passes `err.message` instead of
   `err` still gets the right sentence rendered. */

const ERROR_CASES = {
  session: {
    phrase: 'your session expired',
    line:   'Your session has expired.',
    next:   'Sign in again to carry on.',
  },
  forbidden: {
    phrase: 'you do not have permission',
    line:   "You don't have permission to view this.",
    next:   'Ask whoever administers NEXUS for this dealership if you need access.',
  },
  offline: {
    phrase: 'the server could not be reached',
    line:   "We couldn't reach the server.",
    next:   'Check the connection, then try again.',
  },
  readOnly: {
    phrase: 'this dealership is read-only until payment is recorded',
    line:   'This dealership is read-only.',
    next:   'Open the Subscription screen to see why, or ask NEXUS to record a payment.',
  },
  generic: {
    phrase: 'the request failed',
    line:   "We couldn't load this information.",
    next:   'Try again in a moment. If it keeps happening, report it.',
  },
};

/* phrase -> case. Built from the table above rather than written out again, so
   the two directions cannot drift apart. */
const CASE_BY_PHRASE = Object.fromEntries(
  Object.entries(ERROR_CASES).map(([k, v]) => [v.phrase, k]));

/* Kept because it is what a caller reads: `throw new Error('Session expired')`
   was this app's wording for a dead session before this file existed, and
   screens/deals.js still matches on it. */
const LEGACY_SESSION_TEXT = 'session expired';

function caseFromStatus(status, code) {
  const s = Number(status);
  if (s === 401) return 'session';
  /* PostgREST answers a Postgres 42501 with 403, but it has answered 401 in
     older versions, so the SQLSTATE is checked in its own right. */
  if (s === 403 || String(code || '') === '42501') return 'forbidden';
  return null;
}

/* Only the shapes we can be sure of. "timeout" is deliberately absent: a
   Postgres statement timeout (57014) reads the same as a network one in text,
   and calling a slow query a lost connection is exactly the invented diagnosis
   this file exists to refuse. The offline case is set at the fetch site in
   lib/data.js, which is the only place that actually knows. */
function caseFromText(text) {
  const t = String(text || '').trim();
  if (!t) return 'generic';
  const known = CASE_BY_PHRASE[t.toLowerCase().replace(/[.\s]+$/, '')];
  if (known) return known;
  if (new RegExp(LEGACY_SESSION_TEXT, 'i').test(t)) return 'session';
  if (/\b401\b|jwt\s*(?:is\s*)?expired|token\s*(?:is\s*)?expired|pgrst30\d/i.test(t)) return 'session';
  if (/\b403\b|\b42501\b|permission denied|insufficient_privilege|not authoris|not authoriz|forbidden/i.test(t)) return 'forbidden';
  if (/failed to fetch|networkerror|network request failed|network error|load failed|err_(?:network|internet_disconnected|connection[a-z_]*)/i.test(t)) return 'offline';
  return 'generic';
}

/* Accepts whatever a call site happens to hold: an Error thrown by lib/data.js
   (which carries the case explicitly), a bare PostgREST object, or the string a
   screen extracted with `r.reason?.message` before this function ever saw it. */
function classify(err) {
  if (err == null) return 'generic';
  if (typeof err === 'object') {
    if (err.nexusErrorCase && ERROR_CASES[err.nexusErrorCase]) return err.nexusErrorCase;
    const byStatus = caseFromStatus(err.status ?? err.statusCode, err.code);
    if (byStatus) return byStatus;
    return caseFromText(err.message != null ? err.message : String(err));
  }
  return caseFromText(err);
}

function describe(err) {
  return ERROR_CASES[classify(err)] || ERROR_CASES.generic;
}

/* The user-safe clause an error carries as its `.message`. */
function phraseFor(kind) {
  return (ERROR_CASES[kind] || ERROR_CASES.generic).phrase;
}

/* The developer's copy. One prefix, everywhere, so a support call can be
   answered with "open the console and grep [NEXUS error]". The original object
   is passed through untouched — console.error does not flatten it, so the
   status, the SQLSTATE and the raw body are all still there to expand. */
function logError(where, err, extra) {
  try {
    if (extra === undefined) console.error(`[NEXUS error] ${where}:`, err);
    else console.error(`[NEXUS error] ${where}:`, err, extra);
  } catch { /* logging must never be the thing that breaks a render */ }
}

/* Builds the error lib/data.js throws. `.message` is safe by construction —
   nothing from the wire reaches it — and the wire's own account of the failure
   goes on `.technical`, which is for the console and for the two callers that
   legitimately parse a response body (screens/finance.js reads a workflow's
   refusal reasons out of it). Anything rendering `.technical` to a user is a
   defect; it is named that way so a reviewer can see it in a diff. */
function requestFailure(kind, { status = null, code = null, technical = '', cause = null } = {}) {
  const k = ERROR_CASES[kind] ? kind : 'generic';
  const e = new Error(phraseFor(k));
  e.nexusErrorCase = k;
  e.status = status;
  e.code = code;
  e.technical = String(technical || '');
  if (cause) e.cause = cause;
  return e;
}

export { ERROR_CASES, classify, describe, phraseFor, caseFromStatus, logError, requestFailure };
