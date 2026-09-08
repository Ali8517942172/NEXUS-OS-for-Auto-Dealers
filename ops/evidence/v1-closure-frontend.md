# V1 release-closure gate — frontend items 1, 13, 14

Run 6 September 2026 against **https://nexus-os-dashboard-six.vercel.app/**, signed in as
Ali Asgher (`senior_rep · owner`), dealership **ALBA CARS**
(`fff6a2b5-cfd5-4460-8383-875bc5826de0`).

Repo: `/home/claude/repo`. Database reads: Supabase `dsvuoovivysszdoiorch`, **read-only**.
No git write ran. No production business data was altered. The n8n box (35.224.126.225)
was not touched.

Verdicts are **PASS / FAIL / BLOCKED / NOT RUN**. Nothing is marked PASS without the
evidence recorded beside it.

---

## Corrections to the brief

Two premises in the task were wrong, and both matter to the gate.

| Brief said | Actually |
|---|---|
| Branch `wip/platform-truth-2026-09-01` | That ref does not exist. HEAD is **`wip/gate-L9-2026-09-03-continued`** @ `3463b03`. |
| Fix commit `6e19a3f` | The commit is **`2765f28`** — "The screen was telling the customer what the database calls its columns". Same title, different sha. |
| "tree identical to what was merged to `main` and deployed" | HEAD is **386 files / ~100,800 insertions ahead of `main`**. `git branch --contains 2765f28` returns **only the wip branch**. `lib/errors.js` **does not exist on `main` or `origin/main`** (`git ls-tree main apps/executive-dashboard/lib/` lists 14 files, no `errors.js`). |
| "deployed from `main` after PR #8" | The deployed bundle is built from the **wip branch HEAD**, not `main` — proven byte-for-byte in Item 13. |

**The live product has never been merged to `main`.** `main` is a strictly older
codebase that lacks the error-vocabulary fix entirely. Whatever governance says the
release is "on main" is not true today.

---

## Item 1 — is the raw-error leak actually closed?

### Method

The fix is in `lib/data.js` (constructs the error) + `lib/errors.js` (the vocabulary)
+ `lib/states.js` (renders it). I reproduced failures rather than reasoning about them:
`window.fetch` was stubbed **on the live site** to intercept every `/rest/v1/` request and
return a real failure, then screens were re-rendered and the **rendered DOM text** read
(`#screen` `innerText`), not the source.

Injected bodies carried exactly what must never surface: `permission denied for table
leads`, SQLSTATE `42501`, `PGRST301`, SQLSTATE `42P01`,
`relation "public.leads" does not exist at character 15`, a `details` naming
`public.v_inventory_profit_sentinel`, and a `hint` naming `public.inventory`.

Rendered text was scanned for: `permission denied`, `42501`, `PGRST301`, `expired
signature`, `42P01`, `relation "public`, `does not exist`, `Perhaps you meant`,
`Failed to fetch`, `Forbidden`, `Internal Server Error`, `SQLSTATE`, `supabase`,
`postgrest`, `bearer`, `statusText`, `TypeError`.

### Results

| Case | Injected | Screens exercised | What the user actually saw | Leaked tokens | Verdict |
|---|---|---|---|---|---|
| **forbidden** | 403 + SQLSTATE 42501, body `permission denied for table leads` | Leads, Inventory, **Team** | "**Couldn't load the team** — You don't have permission to view this. Ask whoever administers NEXUS for this dealership if you need access." Inline prose rendered the clause form: "(you do not have permission)" | **NONE** | **PASS** |
| **generic** | 500 + SQLSTATE 42P01, message/details/hint all naming relations | Overview (9 error panels), Compliance (6), Finance (5), Money Leaks | "We couldn't load this information. Try again in a moment. If it keeps happening, report it." | **NONE** ¹ | **PASS** |
| **offline** | `fetch` rejected with `TypeError: Failed to fetch` | Leads, Conversations, **Competitors** | "**Couldn't load competitor pricing** — We couldn't reach the server. Check the connection, then try again." + Retry button | **NONE** | **PASS** |
| **session** | 401 + `PGRST301` | Leads ² | App hidden, login card painted: "**Your session expired. Please sign in again.**" No Retry offered. | **NONE** | **PASS** |

¹ The scanner flagged `does not exist` once on Money Leaks. Inspected: it is product prose
— *"the customer half of a true 'revenue at risk' does not exist at any confidence"*. Not
the injected error. False positive.

² The 401 path is global, not per-screen: `lib/data.js` calls `sessionEnded()` and `app.js`
paints the login card over the whole app, so there is one code path and no per-screen
variation to test. Verified `sessionEnded()` does **not** call `supabase.auth.signOut()`,
so the owner's real session was not disturbed (page reload restored it).

### The other half — technical detail must still reach the console

`console.error` was hooked and every `[NEXUS error]` line inspected structurally.

| Check | Result | Verdict |
|---|---|---|
| Lines carry the stable `[NEXUS error]` prefix | 5 / 5 | **PASS** |
| Line carries the HTTP status | 5 / 5 | **PASS** |
| Line carries the error code / SQLSTATE | 5 / 5 | **PASS** |
| Line carries the raw `technical` body | 5 / 5 | **PASS** |
| `.message` is one of the four safe phrases (never wire text) | 5 / 5 | **PASS** |

Across the whole run 12 / 54 / 17 / 5 `[NEXUS error]` lines were emitted for the four
cases. The error is neither leaked nor swallowed.

### Static confirmation of the guarantee

The design puts the safe clause on `.message` so that ~40 call sites which interpolate
`err.message` into their own prose stay safe without edits. That holds only if every error
reaching them comes from `lib/data.js`. Verified:

- Every read funnels through `lib/data.js`; the only direct `supabase.*` uses outside it are
  four `supabase.auth.*` calls in `app.js` (sign-in / session / sign-out), which render
  login copy.
- Every throw in `lib/data.js` is either `requestFailure(...)` (safe by construction) or a
  hand-written sentence of our own (`'No storage path on this record.'` etc.).
- No `stateError()` call site passes error text through the `note` escape hatch
  (54 call sites checked).

### Finding 1-A — the literal acceptance criterion is not met, for a different reason

Item 1 required that a dealership user *"never sees … a relation or column name, a schema
name, a hostname, or a supplier name in rendered text."* **The error path meets that.
The product as a whole does not** — deliberately, in its provenance copy.

Visible to a signed-in dealership user, in normal healthy operation:

- **Today's Money Leaks** prints source citations under every evidence line:
  `v_inventory_action_queue`, `rpc/sentinel_inventory_actions`, `v_inventory_profit_sentinel`,
  `v_inventory_action_queue.decided_at, decided_by_name, decided_by_authority`,
  `v_inventory_action_queue.executed_at`, `v_inventory_action_queue.is_live`.
- **Team** prints, in explanatory prose: `leads.response_time_minutes`, the trigger name
  `nexus_mark_first_response`, `AFTER INSERT`, `within_sla` / `breached_sla`,
  `count(*) FILTER`, "the `users` table has no phone column", `slack_user_id`.
- **Deal Rescue** prints `public.deals: does not exist`, `public.appointments: does not
  exist`, `0 unit-link column(s) on purchase_history`.

This is clearly intentional — it is the "cite the source" trust posture the product sells,
and it is *not* error text. But it is exactly the class of string the criterion prohibits,
so the criterion cannot be marked PASS as written.

**Verdict: error-path leak — PASS. Literal "no internal identifiers on screen" criterion —
FAIL (by design).** This is an owner decision, not a bug to fix silently: either the
criterion is narrowed to "no *error* internals", or the provenance labels get a
human-readable alias layer. It should not be left ambiguous at a release gate.

---

## Item 13 — is the deployed build exactly the merged product?

### What was proven

Deployed asset names taken from the live `index.html`:
`/assets/main-DIW2ulL9.js`, `/assets/main-BkBRVy6q.css`.

A **clean export of HEAD** (`git archive HEAD apps/executive-dashboard`, i.e. committed
tree only — no working-tree contamination) was rebuilt with the production env values read
out of the deployed bundle itself:

```
VITE_SUPABASE_URL       https://dsvuoovivysszdoiorch.supabase.co
VITE_SUPABASE_ANON_KEY  sb_publishable_… (publishable, not secret)
VITE_N8N_BASE_URL       https://35.224.126.225.nip.io
```

Vite emitted **`main-DIW2ulL9.js`** — the deployed filename — and:

```
6c77478a01c0ee55f0faf32a78040ef1e29baea1790fb29c24996af190002b1f  rebuilt main-DIW2ulL9.js
6c77478a01c0ee55f0faf32a78040ef1e29baea1790fb29c24996af190002b1f  live main-DIW2ulL9.js
dad061b377a8224ee5282fbd2eee8dacee5cbe02d02d12ab3d60d394dd1ff97a  rebuilt main-BkBRVy6q.css
dad061b377a8224ee5282fbd2eee8dacee5cbe02d02d12ab3d60d394dd1ff97a  live main-BkBRVy6q.css
```

`cmp` reports **JS, CSS and index.html all byte-identical**.

(The repo's checked-in `dist/main-CcX2bS3k.js` differs from the deployed asset in exactly
three substrings — the gate's stub env values. Substituting them makes it byte-equal too.
That is a stale local gate build, not a discrepancy in the product.)

| Check | Evidence | Verdict |
|---|---|---|
| Deployed JS is byte-identical to a clean rebuild of repo HEAD | sha256 match + `cmp` | **PASS** |
| Deployed CSS byte-identical | sha256 match + `cmp` | **PASS** |
| Deployed index.html byte-identical | `cmp` | **PASS** |
| 21 screen ids from `lib/nav.js` present in the deployed bundle | all 21 found | **PASS** |
| `screens/money-leaks.js` content present | four money words, `MARGIN_EXPOSED`, header copy all present and rendering live | **PASS** |
| `lib/vocabulary.js` present | present in bundle (byte equality) | **PASS** |
| `lib/errors.js` present | `[NEXUS error]` ×2, `nexusErrorCase` ×4, all four sentences present; proven live | **PASS** |
| Four team RPCs present | **seven** `nexus_team_*` RPCs in bundle: `roster`, `pending`, `invite`, `set_role`, `link_staff`, `revoke_access`, `cancel_invite` | **PASS** |
| Deployed build corresponds to `main` | It does **not** — `main` has no `lib/errors.js` | **FAIL** |
| Deployment metadata (commit sha, PR #8, build log) from Vercel | The connected Vercel account (`team_N1QEfFKiLznKhmZsheKS8mmB`, hobby) lists **zero projects**; `get_deployment` on the hostname returns 404 not_found | **BLOCKED** — needs the owner's Vercel account |

**Net:** the deployed artefact is provably, byte-for-byte, the repo at
`wip/gate-L9-2026-09-03-continued` @ `3463b03`. What is *not* provable from here is the
deployment's own git metadata, and what is disproved is that it came from `main`.

---

## Item 14 — production smoke test, all 21 V1 screens

Walked in one clean browser session, no stubbing. Per screen: rendered chars, error-state
panels, empty/unknown-state panels, console errors, failed REST requests, uncaught
exceptions. (An earlier pass in a tab contaminated by the 401 test showed spurious
failures; that tab was discarded and the sweep re-run clean. Recorded here because the
contaminated numbers are not evidence of anything.)

| # | Screen | Title rendered | Chars | Err panels | Empty/unknown panels | Console errors | Failed REST | Uncaught | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Today's Money Leaks | Today's Money Leaks | 18,501 | 0 | 0 | 0 | 0 | 0 | **PASS** ¹ |
| 2 | Overview | Overview | 18,278 | 0 | 2 | 0 | 0 | 0 | **PASS** |
| 3 | Leads | Leads | 3,643 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| 4 | Conversations | Conversations | 9,688 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| 5 | Compliance | Compliance | 11,579 | 0 | 4 | 0 | 0 | 0 | **PASS** |
| 6 | Revenue Recovery | Revenue Recovery | 23,076 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| 7 | Lead Recovery | Lead Recovery | 13,664 | 0 | 1 | 0 | 0 | 0 | **PASS** |
| 8 | Deal Rescue | Deal Rescue | 21,149 | 0 | 1 | 0 | 0 | 0 | **PASS** ² |
| 9 | Attribution | Attribution | 63,537 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| 10 | Policy | Policy | 37,335 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| 11 | Inventory | Inventory | 5,141 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| 12 | Competitors | Competitors | 13,452 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| 13 | Ask AI | Ask AI | 3,597 | 0 | 1 | 0 | 0 | 0 | **PASS** |
| 14 | Finance Desk | Finance Desk | 32,178 | 0 | 2 | 0 | 0 | 0 | **PASS** |
| 15 | Customer 360 | Customer 360 | 13,346 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| 16 | Action Center | Action Center | 5,352 | 0 | 1 | 0 | 0 | 0 | **PASS** |
| 17 | Campaigns | Campaigns | 12,147 | 0 | 2 | 0 | 0 | 0 | **PASS** |
| 18 | Deals | Deals | 7,290 | 0 | 1 | 0 | 0 | 0 | **PASS** |
| 19 | Automation | Automation | 144,524 | 0 | 1 | 0 | 0 | 0 | **PASS** |
| 20 | Team | Team | 5,591 | 0 | 0 | 0 | 0 | 0 | **PASS** ³ |
| 21 | Settings | Settings | 21,558 | 0 | 0 | 0 | 0 | 0 | **PASS** |

**All 21 render. Zero console errors, zero failed network requests, zero uncaught
exceptions across the entire sweep.**

¹ Renders correctly, but see Defect D1 — it renders from a permanent cache.
² Renders an honest "not computable": 9 of 9 prerequisites unmet, each naming its blocker.
Per the gate's own rule that is a PASS, not a failure.
³ Healthy state is honest ("Needs attention · 1", and open-pipeline shown as `—` not `0`).
See Defect D2 for its failure state.

### Empty/unknown states audited — no fabricated zeros

Spot-checked the panels that render a zero or a dash. Every one names its denominator or
states it is unknown rather than nil, e.g. Team's `OPEN PIPELINE IN REP HANDS —`
("Nobody on the roster is holding an open lead"), Money Leaks' `Not computable` holding
cost, Deal Rescue's "empty of subjects, not empty of findings". **No plausible-zero-it-
cannot-support was found in the healthy state.**

### Cross-screen figure reconciliation (checked, cleared)

Team shows `WITHIN THE 5-MINUTE RULE 1 / 1 … first reply took 1 min`; Money Leaks shows
the open-enquiry SLA check clear on a different lead. This looked like a contradiction.
Database: lead 34 (assigned, 1 min, DISQUALIFIED), lead 35 (unassigned, null), lead 38
(unassigned, 4 min, WARM/open). Team measures *assigned* leads → 1/1 at 1 min. Money
Leaks measures the *open* enquiry → lead 38 at 4 min, inside the dealership's own 5-minute
target (`sla_first_response_minutes = 5`). Both correct, both name their denominator.
**Not a defect.**

---

## Today's Money Leaks — four header figures verified against the database

| Figure | Screen says | Database says | Verdict |
|---|---|---|---|
| **Leaks today** | `2` | `v_inventory_action_queue`: 3 rows — 1 `APPROVED`/live, 1 `EXECUTION_FAILED`, 1 `REJECTED`. Leaks = approved-not-executed (1) + failed-execution (1) = **2**. `REJECTED` correctly excluded. | **PASS** |
| **Gross margin behind them** | `AED 66,000` | NX-1010 Range Rover: 395,000 − 352,000 = **43,000**; NX-1008 Ford Explorer: 178,000 − 155,000 = **23,000**. Sum **66,000**. Matches `engine_impact_aed` and `engine_gross_margin_aed` on both rows; kind `MARGIN_EXPOSED`. The excluded REJECTED unit's 16,000 is correctly *not* added. | **PASS** |
| **Checks that came back clear** | `8` | All 8 rows enumerated on screen and each denominator verified: 3 action records (none awaiting / none escalated / none past deferral); 1 live action, engine re-agrees; `sentinel_inventory_actions()` = 9 HOLD + 3 REPRICE = 12 units, 3 flagged & all 3 raised; 1 open enquiry of 3 (`leads_with_a_recommended_action = 0`); 1 of 1 open enquiry checkable against the 5-minute target. | **PASS** |
| **Checks that could not run** | `9` | All 9 rows enumerated and verified against `v_lead_recovery_coverage` and `v_deal_rescue_readiness`: silence detector `STALE` (last success 2026-08-26 19:03:30Z = 23:03:30 GST ✓ "10 d ago"); 12/12 net margin NOT_COMPUTABLE; 12/12 market position unknown; enquiry coverage insufficient; identity 51/113 = 45.1% with 9 unresolved handles (113−51 = 62 ✓ the engine's own clause); Lead Recovery's verbatim `what_this_engine_cannot_tell_you`; Deal Rescue 0 of 9 prerequisites (all `met_now = false`); 16 of 18 automations unhealthy (`v_workflow_health`: 18 rows, 2 HEALTHY); service/appointments/recon never measured. | **PASS** |

Also verified: `1 recorded sale on file, 0 attributed to anything NEXUS did` matches
`leads_with_a_confirmed_sale = 1`, `confirmed_revenue_aed = 585000`,
`sales_attributed_to_a_recovery_action = 0`.

**No fabricated figure and no false clear was found on Today's Money Leaks.** The
previously-reported false CLEAR (the unmatchable SLA state) does not reproduce: the
open-enquiry SLA check is genuinely evaluable (lead 38, 4 min, target 5 min) and its
"Clear" is earned.

---

## Defects found

### D1 — Today's Money Leaks renders from a permanent cache and its Refresh button is dead — **FAIL**

`screens/money-leaks.js:153-159` defines

```js
const shared = make => { let p = null; return () => { if (!p) { p = make(); p.catch(() => { p = null; }); } return p; }; };
```

and applies it at **module scope** (lines 264-290) to all eight reads — `readEngine`,
`readQueue`, `readLane`, `readLeads`, `readCoverage`, `readReadiness`, `readAttention`,
`readWorkflows`. `p` is cleared only on *rejection*. Once the screen loads successfully,
the promise is memoised for the life of the page.

Measured live:

- Navigating away to Policy and back to Money Leaks: **0 REST requests issued**, 18,501
  chars rendered, 0 error panels.
- With every `/rest/v1/` read stubbed to return **HTTP 500**, Money Leaks still rendered
  the full screen with the identical `2 / AED 66,000 / 8 / 9` figures and **no error state
  at all** — because it made no request to fail.
- Pressing the topbar **Refresh** button while on Money Leaks issued **1** REST call —
  that is `refreshBadges()`, not the screen. The screen re-read **nothing**.

Consequences, worst first:

1. **Cross-dealership exposure risk (code-proven, not reproduced live).** `lib/data.js`
   documents this exact hazard: the app re-authenticates **without a page reload** when a
   token expires, so "every module-level array, snapshot and memo from the PREVIOUS session
   is still there … with two [dealerships] it means one dealership's rows rendered inside
   another's session." The remedy is `onIdentityChange()`. It is registered by
   `lib/badges.js`, `lib/tenant.js`, `lib/ui.js`, `lib/unit-form.js`, `screens/actions.js`
   and `screens/ask.js` — and **not by `screens/money-leaks.js`**. On a shared showroom
   machine, a token expiry followed by a different user signing in leaves the flagship
   screen holding the previous dealership's leak register. I could not reproduce this live
   (it needs a second dealership credential nobody here holds), so it is marked as a
   **code-proven risk, not a live-verified leak**.
2. The screen prints freshness claims that become false: *"re-read on this load"*,
   *"Measured on this read, 6 Sept 2026, 17:27:24 GST"*, *"the engine still makes the same
   recommendation today"* — none of which happened after the first render.
3. During a backend outage the flagship screen shows confident money figures and a green
   check register instead of an error.
4. Refresh does not refresh.

`screens/attribution.js` and `screens/deal-rescue.js` use the same `shared` helper but
construct the memos **inside** the screen function, so they are per-render and correct.
Money Leaks is the only screen with the module-level form. It shipped yesterday.

### D2 — Team renders a green all-clear when its reads have failed — **FAIL**

`screens/team.js:1068-1081`: `if (!alerts.length)` renders a green `task_alt` and
"**Nothing on the team screen needs a human right now**". The condition is not gated on
whether the reads that *produce* alerts succeeded.

Reproduced live under the injected 403: the attention list, the performance view and the
leads read all failed, the roster came back as 0 people, `alerts.length === 0`, and the
screen printed the green all-clear. The qualifying prose underneath does say each read
failed, which mitigates it — and the code comment shows the author considered the problem
and chose to print the `CHECKED` line rather than suppress the heading. But the headline
and the green tick still assert an all-clear the screen cannot support, which is the
gate's definition of a FAIL. Healthy-state behaviour is correct.

### D3 — Icon ligature names visible during font load — **cosmetic, low**

Before `Material Symbols Outlined` finishes loading, the sidebar and controls render the
raw ligature identifiers as words: `water_drop`, `dashboard`, `person_search`,
`chevron_right`, `refresh`, `logout`. Confirmed transient — `document.fonts.status`
reaches `loaded` and the icons resolve. It is a FOUT, not a build defect, but a dealership
user does briefly see internal icon names. Fix is `font-display` / preload if it matters.

---

## Summary of verdicts

| Item | Check | Verdict |
|---|---|---|
| 1 | Session (401) renders safe copy | **PASS** |
| 1 | Forbidden (403 / 42501) renders safe copy | **PASS** |
| 1 | Offline (network rejection) renders safe copy | **PASS** |
| 1 | Generic (500 / 42P01 + relation names + hint) renders safe copy | **PASS** |
| 1 | No PostgREST / SQLSTATE / relation / schema / host text in any rendered error | **PASS** |
| 1 | Technical detail still reaches console under `[NEXUS error]` | **PASS** |
| 1 | Literal criterion "no relation or column name in rendered text", product-wide | **FAIL** (deliberate provenance copy — owner decision) |
| 13 | Deployed JS/CSS/HTML byte-identical to clean rebuild of repo HEAD | **PASS** |
| 13 | 21 screens, money-leaks, vocabulary, errors, team RPCs all in deployed bundle | **PASS** |
| 13 | Deployed build corresponds to `main` | **FAIL** (`main` has no `lib/errors.js`) |
| 13 | Vercel deployment git metadata / PR #8 confirmation | **BLOCKED** (account cannot see the project) |
| 14 | All 21 screens render | **PASS** |
| 14 | No console errors / failed requests / uncaught exceptions | **PASS** |
| 14 | Money Leaks four header figures match the database | **PASS** |
| 14 | No fabricated figure or false clear in the healthy state | **PASS** |
| 14 | Money Leaks re-reads its data / Refresh works / tenant-safe memo | **FAIL** (D1) |
| 14 | Team does not assert a clear it cannot support | **FAIL** (D2) |

### BLOCKED / NOT RUN, and why

- **Vercel deployment metadata (Item 13)** — **BLOCKED**. The connected Vercel account
  (`ali8517942172's projects`, hobby) lists no projects and `get_deployment` on the
  hostname returns 404. Byte equality was proven instead, which is stronger evidence about
  *what* is deployed; only the deployment's own commit/PR record is unavailable.
- **D1's cross-dealership consequence** — **NOT RUN** as a live test. Reproducing it needs
  a second dealership's credentials plus the token-expiry re-auth path. The memo's
  persistence and the missing `onIdentityChange` registration are both proven; the
  cross-tenant render is inferred from `lib/data.js`'s own documented mechanism.
- **401 across three screens** — **NOT APPLICABLE**. The 401 path is global (login card
  over the whole app); there is one code path, tested once.
