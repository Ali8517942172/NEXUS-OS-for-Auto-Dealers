/* NEXUS OS — lib/ui.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { onIdentityChange } from './data.js';
import { $, el } from './dom.js';
import { esc } from './format.js';
import { stateEmpty, stateError, stateLoading } from './states.js';

function openDrawer(html) {
  $('drawer').innerHTML = html;
  $('drawer').classList.add('open');
  $('scrim').classList.add('open');
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('scrim').classList.remove('open');
}

/* Closing the drawer hides it; it does not empty it. That is deliberate — the
   panel slides out over a transition and blanking it mid-slide looks broken —
   but it means the last customer record opened stays in the document for as
   long as the tab is open: a name, a phone number, an email address and a
   message history, sitting in `#drawer` behind a class.

   With one dealership that was merely untidy. This app re-authenticates without
   discarding the document (see lib/data.js), so with two it is one dealership's
   customer left inside another dealership's session. Emptied on a change of
   signed-in identity, which is not during a transition and cannot look broken.

   Clearing it on every close would be stronger and is the obvious next step;
   it is left alone here because it changes what the panel looks like on the way
   out, and this change is meant to be invisible except in the case it fixes. */
onIdentityChange(() => {
  const d = $('drawer'); if (d) { d.classList.remove('open'); d.innerHTML = ''; }
  /* `#screen` for the same reason and in the same breath. lib/nav.js clears it
     when it renders the next screen, but the login card is painted OVER the
     running app — `#app` is hidden, not emptied — so between a token expiring
     and the next person's first render the previous dealership's screen is
     still in the document. This closes that window rather than relying on the
     render that comes after it. */
  const sc = $('screen'); if (sc) sc.innerHTML = '';
});

/* ── Reusable renderers ──────────────────────────────────────────────────── */
function kpi(label, value, sub, cls = '') {
  /* Long currency values wrapped mid-figure ("AED" on one line, the digits on
     the next). Shrink rather than wrap — a KPI must read as one number. */
  const long = String(value).replace(/<[^>]*>/g, '').length > 12;
  return `<div class="kpi"><div class="label-caps">${esc(label)}</div>
    <div class="kpi-value ${cls}${long ? ' long' : ''}">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

function table(cols, rows, opts = {}) {
  if (!rows.length) return opts.empty || stateEmpty('Nothing here yet', 'No rows matched.');
  const head = cols.map(c => `<th class="${c.align === 'r' ? 'r' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => {
    const tds = cols.map(c => `<td class="${c.align === 'r' ? 'r num' : ''} ${c.strong ? 'strong' : ''}">${c.render(r)}</td>`).join('');
    return `<tr class="${opts.onRow ? 'clickable' : ''}" data-i="${i}">${tds}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function wireRows(host, rows, handler) {
  if (!handler) return;
  host.querySelectorAll('tbody tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => handler(rows[Number(tr.dataset.i)]));
  });
}

/* Renders a card whose body is produced by an async loader. Guarantees the
   loading / error / empty / loaded quartet without repeating it twelve times.

   Signature and resolved value are unchanged: call it as before and await it —
   or `.then()` it — for the card element.

   Retry used to `card.remove()` and build a WHOLE NEW card that no caller ever
   saw. Every caller wires its behaviour onto the card this resolves with
   (`panel(...).then(card => { card.querySelector('[data-act]')…; wireLeadRows(card); })`),
   so after a SUCCESSFUL retry every row and button in the panel was dead — the
   listeners were on a detached card and the visible one had never been through
   any wiring pass. screens/overview.js:669 states the rule that broke: "a click
   that silently does nothing is the one outcome that must not happen." Five
   Overview panels plus panels on Competitors were affected.

   Two things fix it, and both are needed. The card ELEMENT is now stable —
   every attempt re-renders into it rather than replacing it, so the reference a
   caller is holding stays the card that is on screen. And the fulfilment
   handlers registered on the returned thenable are recorded and replayed after
   each retry, so the panel ends up wired exactly once, exactly as it was the
   first time: the whole card (head included) is rebuilt per attempt, which
   drops the previous attempt's listeners, and the replay puts them back. Order
   matters — the replay runs after `render`, so a caller reading state that
   `render` stashed on the card (`card.__rows`) sees the new rows, not the old.

   The consequence for callers: wire in `.then(card => …)`. Wiring written after
   `const card = await panel(...)` cannot be replayed — nothing records the code
   that follows an await — so it is the one form that still goes dead on retry.
   The `.then` form costs nothing extra and survives. Overview and the second
   Competitors block already use it. screens/competitors.js:1097 is the one
   caller left on the await form ("Stock with no market reference", on the
   empty-inventory branch): its rows and its Open Inventory button still stop
   working after a retry there, and no change confined to this file can reach
   them. That is a two-line change in its own file, not a defect in this one. */
function panel(host, { title, sub, actions, load, render, cols = '' }) {
  const card = el('div', 'card flush');
  if (cols) card.style.gridColumn = cols;
  host.appendChild(card);

  const wirings = [];
  /* Each wiring is isolated: these are independent callers' handlers, and one
     of them throwing must not swallow the ones after it — which is how a panel
     would come back from a retry half-wired, the same silent-dead-click this
     whole change exists to prevent. A throw here would also escape as an
     unhandled rejection, since nothing awaits the retry. */
  const rewire = () => {
    for (const fn of wirings) {
      try { fn(card); } catch (e) { console.error('panel: re-wiring failed after retry', e); }
    }
  };

  const attempt = async () => {
    card.innerHTML = `${title ? `<div class="card-head"><div><div class="card-title">${esc(title)}</div>${sub ? `<div class="card-sub">${sub}</div>` : ''}</div><div style="flex:1"></div>${actions || ''}</div>` : ''}<div class="pbody">${stateLoading(4)}</div>`;
    const body = card.querySelector('.pbody');
    try {
      const data = await load();
      body.innerHTML = render(data, card);
    } catch (e) {
      body.innerHTML = stateError(title || 'data', e.message, 'x');
      body.querySelector('[data-retry]')?.addEventListener('click', () => {
        /* Retry calls `load` again — which only retries anything if `load`
           actually re-issues the request. A caller that shares one promise
           between panels (`const p = db(...); panel({load: () => p})`) hands back
           the SAME settled rejection every time, so the button looks like it is
           doing something and can never succeed. If you share a read, drop the
           cached promise on rejection; screens/overview.js has the pattern. */
        attempt().then(rewire);
      });
    }
  };

  const first = attempt().then(() => card);
  /* A thenable, not a plain promise, only so that `then` can remember what the
     caller wants done to the card. It resolves with the same card element the
     async version did, and never rejects — `attempt` reports its own failure
     into the body — so `await`, `.then()` and `Promise.all()` all behave as
     before. Handlers that arrive here from `await` or `Promise.all` are the
     engine's own resolve functions; replaying one is a no-op, because the
     promise it belongs to has already settled. */
  return {
    then(onOk, onErr) {
      if (typeof onOk === 'function') wirings.push(onOk);
      return first.then(onOk, onErr);
    },
    catch(onErr) { return first.catch(onErr); },
    finally(onDone) { return first.finally(onDone); },
  };
}

/* ==========================================================================
   S1 · Overview
   ========================================================================== */

export { openDrawer, closeDrawer, kpi, table, wireRows, panel };
