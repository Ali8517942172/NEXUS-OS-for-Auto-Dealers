# STAGE 1.8 — the raw backend error leak in `lib/states.js`

Repo: `/home/claude/repo`, branch `wip/platform-truth-2026-09-01`.
Bundle: `apps/executive-dashboard/`. Date: 5 Sep 2026. No git command was run.

## 1. What the defect was

`lib/states.js:8` rendered whatever it was handed:

```js
const stateError = (what, err, retry) =>
  `<div class="state err">…<h3>Couldn't load ${esc(what)}</h3>
   <p>${esc(err)}</p>…`;
```

and `lib/data.js` handed it the wire's own words. `db()` threw
`` `${res.status} ${res.statusText}${body ? ' — ' + body.slice(0,180) : ''}` ``, so a
PostgREST refusal reached a dealership user's screen as, verbatim:

```
403 Forbidden — {"code":"42501","message":"permission denied for table leads","hint":null}
```

All four PostgREST fields (`message`, `details`, `hint`, `code`) are internal, and the
same string carries table, column, constraint, function and role names. n8n failures
carried node text and status lines the same way.

## 2. Measured reach — the audit's "15 screens" is confirmed, and it undercounts

Counted by `grep -rn "stateError(" lib screens`, excluding import lines and comments:

**48 call sites: 46 in 15 screen files, 2 in `lib/`.**

| file | call sites | file | call sites |
|---|---|---|---|
| `screens/finance.js` | 6 | `screens/conversations.js` | 4 |
| `screens/deals.js` | 5 | `screens/customers.js` | 4 |
| `screens/automation.js` | 5 | `screens/settings.js` | 3 |
| `screens/compliance.js` | 4 | `screens/team.js` | 3 |
| `screens/campaigns.js` | 3 | `screens/overview.js` | 2 |
| `screens/actions.js` | 2 | `screens/inventory.js` | 2 |
| `screens/competitors.js` | 1 | `screens/leads.js` | 1 |
| `screens/ask.js` | 1 | | |
| `lib/nav.js` | 1 | `lib/ui.js` | 1 |

The 15 screen files are exactly: actions, ask, automation, campaigns, competitors,
compliance, conversations, customers, deals, finance, inventory, leads, overview,
settings, team. **So 15 is right as a count of screen files, and it is a floor as a
count of affected surfaces**: `lib/nav.js:247` is the catch-all for any screen whose
module throws (all 20 registered screens, including the five with no `stateError` of
their own — attribution, deal-rescue, lead-recovery, policy, revenue), and
`lib/ui.js:137` is the failure path of `panel()`, which is used by most screens.

There were also **~20 further sites outside `stateError`** that interpolated the same
raw string into screen prose — e.g. `screens/deals.js:663`
`` `purchase_history could not be read (${dealsErr}), so …` `` — plus four that render
it inline (`lib/lead-drawer.js:478`, `screens/actions.js:788`, `screens/ask.js:606`,
`screens/compliance.js:2375`, `app.js:177`). Those are fixed at the source rather than
one by one; see §3.

## 3. What changed

### New: `apps/executive-dashboard/lib/errors.js`
One vocabulary, four cases, imported by both the view layer and the data layer so the
copy has a single derivation:

| case | chosen when | user reads |
|---|---|---|
| `session` | HTTP 401, or the app's own "session expired" latch | "Your session has expired. Sign in again to carry on." |
| `forbidden` | HTTP 403, or SQLSTATE `42501` | "You don't have permission to view this. Ask whoever administers NEXUS for this dealership if you need access." |
| `offline` | the `fetch` itself rejected — no response was produced | "We couldn't reach the server. Check the connection, then try again." |
| `generic` | everything else — 400, 404, 500, unparseable body, a thrown screen bug, `null` | "We couldn't load this information. Try again in a moment. If it keeps happening, report it." |

Deliberately **not** classified: timeouts. A Postgres statement timeout (57014) and a
lost connection read alike in text, and calling one the other is the invented diagnosis
this change exists to refuse. The only network claim made is the one the app can prove:
`fetch` rejected, so no response existed.

`classify()` accepts an Error from `lib/data.js` (which states its case explicitly), a
bare PostgREST object (`status`/`code`), or a plain string — because ~10 screens extract
`r.reason?.message` into a local before `stateError` ever sees it. Legacy raw strings
still classify correctly (defence in depth) and are still never rendered.

### `lib/states.js`
`stateError(what, err, retry, note)`:
- `err` is **never rendered**. It goes to `console.error` with the stable, greppable
  prefix **`[NEXUS error]`**, as the original object — status, SQLSTATE, `.technical`
  and stack all expandable in devtools.
- the user gets the classified sentence plus its next step.
- the heading keeps its exact previous wording, `Couldn't load <what>` — `what` is prose
  the screen wrote about its own subject, not anything a backend said, and
  `QUALITY_GATE.mjs:1870` (and `:3201`) detects the error state by matching `/Couldn.t load/`.
- **no Retry button on an expired session** (it would fail identically every time, and
  the login card is already painted over the app). Every existing retry-wiring call site
  uses `?.` or `querySelectorAll(...).forEach`, so an absent button is safe.
- `note` is a new, separate argument for app-authored explanation. It exists so two
  callers that were passing *their own reviewed prose* through the `err` slot keep it.

### `lib/data.js` — fixed at the source, which is why call sites did not each need editing
The four fetches in this file are the only network calls in the bundle
(`grep -rn "fetch(" lib screens app.js` → `lib/data.js` ×3 and one error-swallowing
`healthz` probe in `lib/integrations.js`). A thrown request failure now carries:
- `.message` — the user-safe **clause** for the case ("you do not have permission",
  "the request failed"). This is what makes the ~20 prose interpolations safe without
  touching them: *"purchase_history could not be read (the request failed), so nothing
  below is a zero — it is an unknown."*
- `.nexusErrorCase`, `.status`, `.code` — structured, for classification.
- `.technical` — the wire's own account. **Console only**, plus two callers that
  legitimately parse a response body (§4). Nothing renders it.
`db()`, `dbWrite()`, `n8n()` and `signedUrl()` all log through `logError` at the point
of failure with the request label, so a failure that a screen swallows into prose is
still visible to a developer.

### Call sites edited (only where raw text travelled by another path)
| file:line | before | now |
|---|---|---|
| `lib/nav.js:247` | `stateError('this screen', (e && e.message) \|\| String(e))` | passes `e` |
| `lib/ui.js:137` | `stateError(title \|\| 'data', e.message, 'x')` | passes `e` |
| `screens/conversations.js:2625` | authored "no key on this thread…" prose passed as the error | passed as `note`, `err = null` |
| `screens/settings.js:1597` | `` `${s.failsErr}. A broken credential names itself…` `` | error and authored sentence separated |
| `screens/ask.js:1395, 598, 1095` | `diagnose()` parsed `<status> — <body>` out of `.message` | reads `.errTechnical` |
| `screens/finance.js:2555, 2569` | `declineFromError()` parsed the same out of `.message` | reads `.technical`; `stateError` gets `e` |
| 12 sites in competitors/finance/overview/leads/campaigns/inventory | passed `e.message` | pass `e` |

`grep -rn "stateError(" lib screens | grep "\.message"` now returns only a comment.

### The empty/error distinction is preserved
`stateEmpty()` and `noSource()` are untouched, and nothing was added that turns a failed
read into "no data yet" or an empty result into an error. The two branches are the same
branches they were: screens choose `stateEmpty` on `rows.length === 0` and `stateError`
on a rejection. The one case that mixed them — `conversations.js`'s "no key on this
thread, so nothing was queried, and this blank panel is not evidence this person has no
history" — now renders *only* that sentence, with no invented error diagnosis in front
of it.

## 4. Two places that still read the backend's words, on purpose

Both read `.technical`, never `.message`, and neither prints it:
- `screens/finance.js:2555` — the finance workflow answers a refusal with a 4xx whose
  body names the field ("vehicleValue must be … at least AED 5000"). Only strings passing
  `VALIDATION_RE` reach the screen, and they render as a *decline*, not an error. Losing
  this would have turned every validator refusal into "We couldn't load the quote".
- `screens/ask.js:507` — `diagnose()` maps a status code to a sentence **we wrote**.
  Every string it returns is authored copy; no backend text passes through it.

## 5. Build

```
cd /home/claude/repo/apps/executive-dashboard
VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… VITE_N8N_BASE_URL=… npm run build
```
(env set because `lib/env.js` fails the build contract without it — same three vars
`QUALITY_GATE.mjs:1796-1799` sets.)

**Result: success.** `vite v5.4.21`, 87 modules transformed, `✓ built in 3.02s`,
`dist/assets/main-DSw77Uwd.js` 1,366.46 kB. The only warnings are the two pre-existing
ones (data.js both dynamically and statically imported; chunk > 500 kB).
`grep` on the built bundle confirms the new copy is in it and the shipped `dist/` was
rebuilt from this source.

## 6. What was NOT verified — read this before calling the screens fixed

- **No browser was opened. Nothing was visually confirmed on any of the 15 screens.**
  The claim proven here is about what the code renders, not about how it looks.
- **`npm run gate` was not run.** It needs a Playwright Chromium and a live/catalogued
  database, neither available in this container. Two interactions to watch on the next
  gate run: (a) R2 fails a screen on `newErrors > 0`, and `lib/data.js` now emits a
  `console.error` for every non-2xx REST response — in a run where R3 reports 0
  rejections there are none to emit, but a run with a rejection will now show it in R2
  as well; (b) R2's error-state detector matches `/Couldn.t load/`, which the new
  heading deliberately still produces.
- **`npm run probe` was not run** (needs live schema access).
- **No live 401/403/network failure was reproduced against production.** Classification
  was exercised with a local harness over eleven inputs — a 403/42501 object, a 401, a
  rejected fetch, a 500, the bare phrase strings screens thread through `errOf`, a
  legacy raw PostgREST string, `'Unknown error'`, `null`, and a genuine `TypeError` from
  a screen bug — and each produced the intended sentence with the original object logged
  under `[NEXUS error]`. That is a unit-level check, not a live one.
- **Two paths were left alone and are named rather than quietly changed:**
  `app.js:106` renders `supabase.auth.signInWithPassword` error text on the login card
  (Supabase's auth strings are end-user copy: "Invalid login credentials"), and
  `lib/data.js`'s "VITE_N8N_BASE_URL is not set…" configuration error keeps its exact
  wording because `screens/finance.js` and `screens/conversations.js` match on it to show
  a friendly banner. The env-var name is a build fact, not a backend fact.
- **Terse inline write failures.** `lib/lead-drawer.js:478` and `screens/actions.js:788`
  now show "the request failed" where they used to show a status line and body. Safe and
  honest, but thin copy; deliberately not expanded here, because a write-specific
  sentence ("nothing was saved") is a claim this app cannot make — a commit whose
  response was lost is indistinguishable from a refusal at that point.
- **Out of scope, observed:** the Automation and Settings screens render n8n run
  summaries, node names and workflow ids read from `audit_log` / `workflow_registry`.
  That is operator instrumentation inside the customer's product — the finding CLAUDE.md
  already records — and it is a different exposure from this one. Nothing was changed
  there.
