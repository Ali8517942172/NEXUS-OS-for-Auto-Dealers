/* NEXUS OS — lib/ui.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
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
   loading / error / empty / loaded quartet without repeating it twelve times. */
async function panel(host, { title, sub, actions, load, render, cols = '' }) {
  const card = el('div', 'card flush');
  if (cols) card.style.gridColumn = cols;
  card.innerHTML = `${title ? `<div class="card-head"><div><div class="card-title">${esc(title)}</div>${sub ? `<div class="card-sub">${sub}</div>` : ''}</div><div style="flex:1"></div>${actions || ''}</div>` : ''}<div class="pbody">${stateLoading(4)}</div>`;
  host.appendChild(card);
  const body = card.querySelector('.pbody');
  try {
    const data = await load();
    body.innerHTML = render(data, card);
  } catch (e) {
    body.innerHTML = stateError(title || 'data', e.message, 'x');
    body.querySelector('[data-retry]')?.addEventListener('click', () => {
      card.remove();
      /* Retry calls `load` again — which only retries anything if `load`
         actually re-issues the request. A caller that shares one promise
         between panels (`const p = db(...); panel({load: () => p})`) hands back
         the SAME settled rejection every time, so the button looks like it is
         doing something and can never succeed. If you share a read, drop the
         cached promise on rejection; screens/overview.js has the pattern. */
      panel(host, { title, sub, actions, load, render, cols });
    });
  }
  return card;
}

/* ==========================================================================
   S1 · Overview
   ========================================================================== */

export { openDrawer, closeDrawer, kpi, table, wireRows, panel };
