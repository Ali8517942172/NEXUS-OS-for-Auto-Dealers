/* NEXUS OS — lib/modal.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { el } from './dom.js';
import { esc } from './format.js';

function openModal(title, bodyHtml, footHtml) {
  document.getElementById('modalWrap')?.remove();
  const wrap = el('div');
  wrap.id = 'modalWrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;'
    + 'justify-content:center;padding:40px 16px;overflow:auto;background:rgba(15,23,41,.45)';
  wrap.innerHTML = `<div class="card" style="width:100%;max-width:720px;margin:auto">
      <div class="card-head" style="margin-bottom:4px">
        <div class="card-title" style="flex:1">${esc(title)}</div>
        <button class="btn ghost sm" id="mClose" aria-label="Close">
          <span class="material-symbols-outlined">close</span></button>
      </div>
      <div id="modalBody">${bodyHtml}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:20px;flex-wrap:wrap">${footHtml || ''}</div>
      <div class="cell-sub" id="modalMsg" style="margin-top:12px"></div>
    </div>`;
  document.body.appendChild(wrap);
  /* The listener is removed by close(), not by the Escape branch that added it.
     It used to detach itself only when Escape was the thing that closed the
     dialog — so closing with the X or a click on the backdrop left it attached
     to `document` forever, holding `wrap` alive with it. A rep confirming
     twenty escalations across a shift accumulated twenty of them, every one
     still listening, and pressing Escape once then ran close() on twenty
     already-removed dialogs. One dialog, one listener, removed on every path
     out. */
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', onKey); wrap.remove(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('#mClose').addEventListener('click', close);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelector('input,select,textarea')?.focus();
  return { wrap, close, msg: t => { wrap.querySelector('#modalMsg').innerHTML = t; } };
}
function modalError(m, e) { m.msg(`<span class="t-hot">${esc(e.message || String(e))}</span>`); }

/* ==========================================================================
   S4 · Inventory
   ========================================================================== */

/* Every money column on this screen is derived, not entered. These constants were
   reverse-engineered from the twelve seeded units and reproduce all of them exactly.
   The one soft edge: the HEALTHY/WARNING boundary is only pinned to somewhere
   between 62 and 82 days by that data — 75 is the assumption. CRITICAL at 120 is
   exact (121 was CRITICAL, 97 was WARNING). */

export { openModal, modalError };
