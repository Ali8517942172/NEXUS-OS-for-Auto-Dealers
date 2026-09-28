/* NEXUS OS — lib/modal.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { el } from './dom.js';
import { esc } from './format.js';

/* Every `style` attribute and the `style.cssText` line this function used to
   write now live in lib/theme-modal.css, behind the six class names below.
   The overlay was the one surface in the product a stylesheet could not reach:
   inline styles outrank every rule short of `!important`, so the design system
   had to either shout over it or move it, and moving it is the version that
   leaves the cascade intact. Nothing about how the dialog BEHAVES changed with
   it -- `z-index: 60`, `overflow: auto` on the overlay, `align-items:
   flex-start` paired with `margin: auto` on the panel, and the scrim as a
   background rather than a pseudo-element are all carried across to the
   identical value, and theme-modal.css says beside each one why it could not be
   anything else. The panel keeps `card` and `card-head` alongside its new
   names, so theme-shell.css's `#modalWrap > .card` radius, elevation and
   entrance animation still apply.

   What is still owed and is NOT a CSS problem: this dialog has no focus trap
   and does not restore focus to whatever opened it. Tab walks straight out of
   it into the page behind. That is a keyboard defect in this function, it was
   here before this pass, and it is not fixable from a stylesheet. */
function openModal(title, bodyHtml, footHtml) {
  document.getElementById('modalWrap')?.remove();
  const wrap = el('div', 'modal-wrap');
  wrap.id = 'modalWrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `<div class="card modal-panel">
      <div class="card-head modal-head">
        <div class="card-title modal-title">${esc(title)}</div>
        <button class="btn ghost sm" id="mClose" aria-label="Close">
          <span class="material-symbols-outlined">close</span></button>
      </div>
      <div id="modalBody">${bodyHtml}</div>
      <div class="modal-foot">${footHtml || ''}</div>
      <div class="cell-sub modal-msg" id="modalMsg"></div>
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
