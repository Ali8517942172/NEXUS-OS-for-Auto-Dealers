/* NEXUS OS — lib/badges.js
   Added 24 Aug 2026.

   The nav badges existed in the markup from the beginning — `lib/nav.js` puts a
   `<span class="nav-badge hide" id="badge-<screen>">` inside every nav button —
   but only one screen ever filled one in, and only while it was open. So the
   sidebar was decorative: an operator sitting on Inventory had no way to learn
   that a customer had been waiting three days for a reply on Conversations, and
   the only screen that could have told them was the one they were not looking
   at. Four separate agents flagged this in the same round and each correctly
   said it was not theirs to fix, because a badge on someone else's nav item is
   nobody's screen and everybody's problem.

   This module owns all of them, and it owns them for one reason: the counts have
   to agree. `v_needs_attention` already decides what needs a human and which
   screen it belongs to — it emits `screen` on every row — so one read, grouped
   by that column, produces every badge from a single snapshot. If each screen
   counted its own badge on render, two badges would be answers to the same
   question asked at different times, and the sidebar would quietly disagree with
   itself.

   Deliberately NOT here:
     · No second source. A badge counts exactly the rows in the view and nothing
       else, so "why does it say 3" always has the same answer: open the screen
       and there are the three rows.
     · No local heuristics. A screen that finds something the view does not know
       about (an expired quote, a drifting ageing band) shows it in its own alert
       strip. Promoting those to the sidebar would make the badge a number no
       single query can reproduce.
     · Overview is the exception and says so below. */
import { db } from './data.js';
import { $ } from './dom.js';

/* Cold items are things to know, not things to do. A permanent "5" over
   Competitors for a price gap nobody intends to act on today is how a badge
   stops being read at all — and once it is unread it cannot warn anyone about
   the HOT item that arrives tomorrow. Only HOT and WARM count. */
const COUNTS = new Set(['HOT', 'WARM']);

let LAST = { at: null, rows: null, error: null, homeless: 0 };

function paintOne(screen, n, title) {
  const badge = $(`badge-${screen}`);
  if (!badge) return;                       // a screen id with no nav item
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.classList.toggle('hide', !n);
  if (title) badge.title = title;
}

/* Clearing every badge first is what makes a resolved item disappear. Painting
   only the screens present in the new snapshot would leave yesterday's number
   sitting over a screen that is now clean — a badge that can go up but never
   down is worse than no badge, because it teaches the operator to ignore it. */
function clearAll() {
  document.querySelectorAll('.nav-badge').forEach(b => {
    b.textContent = '';
    b.classList.add('hide');
    b.title = '';
  });
}

/* On a failed read the badges are wiped rather than left showing the last known
   numbers. Stale counts are indistinguishable from current ones at a glance, and
   an operator who trusts a badge that is actually four hours old is worse off
   than one who sees nothing and goes looking. The connection pill in the topbar
   is where "we cannot reach the database" belongs. */
async function refreshBadges() {
  try {
    const rows = await db('v_needs_attention?select=kind,severity,ref,screen&limit=500');
    LAST = { at: new Date().toISOString(), rows, error: null, homeless: 0 };

    const bySeverity = new Map();
    /* A row the view files against no screen used to be dropped here and was
       therefore invisible in the sidebar entirely — including in the Overview
       grand total, which is supposed to be everything. It is still not paintable
       on a nav item (there is no nav item to paint), but it MUST be counted, and
       Overview's badge title has to admit it exists so the number can be
       explained. Silently uncounted is how an attention item goes unseen. */
    let homeless = 0;
    rows.forEach(r => {
      if (!COUNTS.has(String(r.severity || '').toUpperCase())) return;
      const s = String(r.screen || '').trim();
      if (!s) { homeless += 1; return; }
      if (!bySeverity.has(s)) bySeverity.set(s, { hot: 0, total: 0, kinds: new Set() });
      const e = bySeverity.get(s);
      e.total += 1;
      if (String(r.severity).toUpperCase() === 'HOT') e.hot += 1;
      if (r.kind) e.kinds.add(r.kind);
    });

    clearAll();
    let grand = 0;
    bySeverity.forEach((e, screen) => {
      grand += e.total;
      const kinds = [...e.kinds].join(', ');
      paintOne(screen, e.total,
        `${e.total} item${e.total === 1 ? '' : 's'} need attention here`
        + (e.hot ? ` — ${e.hot} urgent` : '')
        + (kinds ? ` (${kinds})` : ''));
    });

    /* Overview carries the grand total, because Overview is the screen that
       lists every attention item regardless of which screen it belongs to.
       It is a sum of the others, not a category of its own — so it is set here
       and then deliberately left alone: when Overview renders it recomputes its
       own badge from the same view plus the KYC archive gaps it can see and the
       view cannot, and that number is a superset of this one. Two writers, one
       direction: this one is the floor, Overview's is the refinement. Anything
       else and the badge changes when you navigate, which reads as a bug. */
    grand += homeless;
    paintOne('overview', grand,
      grand
        ? `${grand} item${grand === 1 ? '' : 's'} across all screens`
          + (homeless ? ` — ${homeless} of them belong to no screen and can only be seen here` : '')
        : '');

    LAST.homeless = homeless;
    return { ok: true, grand, homeless, screens: bySeverity.size };
  } catch (e) {
    LAST = { at: new Date().toISOString(), rows: null, error: e.message };
    clearAll();
    return { ok: false, error: e.message };
  }
}

/* Sixty seconds is chosen against what the numbers are made of, not by feel.
   The slowest input is the hourly Silence Detector; the fastest is an inbound
   WhatsApp message becoming an `unanswered_chat` the moment it lands. A minute
   means an operator with the tab open learns about a waiting customer inside a
   minute, at the cost of one small indexed read per minute per open tab.

   The visibility check is the part that matters on a dealership floor, where
   this dashboard sits open on a screen nobody is looking at for hours: a hidden
   tab stops polling entirely and refreshes once when it comes back, so a forgotten
   tab costs nothing and is never wrong the moment someone glances at it. */
let timer = null;
let onVisible = null;
function startBadges(intervalMs = 60000) {
  stopBadges();
  refreshBadges();
  timer = setInterval(() => { if (!document.hidden) refreshBadges(); }, intervalMs);
  onVisible = () => { if (!document.hidden) refreshBadges(); };
  document.addEventListener('visibilitychange', onVisible);
  return timer;
}

/* Stopping matters more than starting, and it was the half that was missing.

   The poll outlives the session: once the token is gone every refreshBadges()
   is a 401, db() calls sessionEnded(), and the login screen is re-rendered from
   scratch — wiping whatever was in the email and password fields. A minute
   later it happens again. Anyone who types slowly, or steps away mid-login,
   loses the password they were halfway through, on a clock, with no visible
   cause. app.js stops the poller as part of ending the session, and the
   visibilitychange listener goes with it: a hidden tab that is brought back
   after the session ended must not fire one more 401 either. */
function stopBadges() {
  if (timer) { clearInterval(timer); timer = null; }
  if (onVisible) { document.removeEventListener('visibilitychange', onVisible); onVisible = null; }
}

/* COUNTS is exported because screens/overview.js has to apply the same
   severity rule to compute its refinement floor. It was mirrored there as a
   literal with a comment pointing here, which is a coupling nothing can check —
   the day one side gains COLD the badge silently disagrees with the panel
   under it. Importing it makes the two provably the same set. */
export { refreshBadges, startBadges, stopBadges, LAST, COUNTS };
