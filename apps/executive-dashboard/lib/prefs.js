/* NEXUS OS — lib/prefs.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten.

   22 Sep 2026: gained readFlag()/writeFlag(), the two per-browser switches
   lib/privacy.js owns (Privacy mode, and whether internal test records are
   shown). This file is still the only one that touches localStorage (gate S2),
   and every access is wrapped: a private window, blocked site data or a
   thumbnail capture can make the accessor throw, and a preference that cannot
   be read is simply its default. */

function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); return true; } catch { return false; }
}
const readFlag  = (key, fallback = false) => { const v = readPref(key, null); return v == null ? fallback : v === '1'; };
const writeFlag = (key, on) => writePref(key, on ? '1' : '0');

function applyDensity() {
  document.body.classList.toggle('compact', readPref('nexus.density', 'comfortable') === 'compact');
}

/* ==========================================================================
   Auth + boot
   ========================================================================== */

export { applyDensity, readFlag, writeFlag };
