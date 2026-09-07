/* NEXUS OS — lib/icons.js
   The icon set, as inline SVG.

   ───────────────────────────────────────────────────────────────────────────
   WHY NOT THE ICON FONT THIS APP ALREADY LOADS
   ───────────────────────────────────────────────────────────────────────────
   index.html pulls Material Symbols from fonts.googleapis.com, and every icon
   in the product is a LIGATURE — the markup literally contains the word
   `water_drop`, and the font turns it into a droplet. That has three costs a
   dealership pays and nobody in the office sees:

     · If the font does not arrive — a slow showroom connection, a blocked CDN,
       a corporate proxy, an offline tablet on the forecourt — the ligature
       falls back to its own NAME. The screen does not lose its icons; it prints
       `water_drop`, `directions_car`, `logout` in the middle of the interface.
       That is not a degraded experience, it is a broken-looking product, and it
       is exactly what this repository's own render harness photographs when the
       font is stubbed.
     · It is a third-party request on every load of a product sold on the claim
       that it does not leak the dealership's data anywhere it does not have to.
     · A ligature has no accessible name, so a screen reader announces the word.

   Inline SVG has none of those. It ships in the bundle, it paints in
   currentColor so a chip's icon is automatically the chip's colour, and it is
   `aria-hidden` by default because in this product every icon sits beside text
   that already says the thing.

   ───────────────────────────────────────────────────────────────────────────
   THE SET
   ───────────────────────────────────────────────────────────────────────────
   Deliberately small and deliberately one style: 24-unit grid, 1.6 stroke,
   round caps and joins, no fills. A mixed-weight icon set is one of the
   loudest amateur signals there is, so a new icon must be drawn on this grid or
   it does not go in.
   ========================================================================== */

/* Each entry is the INNER markup of a 24×24 viewBox. */
const PATHS = {
  /* status and severity */
  info:        '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.75h.01"/>',
  alert:       '<path d="M10.3 4.3 2.8 17a1.9 1.9 0 0 0 1.7 2.9h15a1.9 1.9 0 0 0 1.7-2.9L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>',
  danger:      '<path d="M8.6 3h6.8L20 7.6v6.8L15.4 19H8.6L4 14.4V7.6Z"/><path d="M12 8v4.5"/><path d="M12 15.8h.01"/>',
  check:       '<circle cx="12" cy="12" r="9"/><path d="m8.4 12.2 2.5 2.5 4.7-4.9"/>',
  question:    '<circle cx="12" cy="12" r="9"/><path d="M9.7 9.4a2.4 2.4 0 0 1 4.6.8c0 1.6-2.3 2.4-2.3 2.4"/><path d="M12 16.3h.01"/>',
  cross:       '<circle cx="12" cy="12" r="9"/><path d="m9.4 9.4 5.2 5.2"/><path d="m14.6 9.4-5.2 5.2"/>',
  /* subjects on this screen */
  droplet:     '<path d="M12 3.2c3.1 3.2 6 6 6 9.3a6 6 0 0 1-12 0c0-3.3 2.9-6.1 6-9.3Z"/>',
  coins:       '<ellipse cx="12" cy="6.6" rx="7" ry="2.9"/><path d="M5 6.6v10.8c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.6"/><path d="M5 12c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9"/>',
  scan:        '<circle cx="11" cy="11" r="6.2"/><path d="m20 20-4.6-4.6"/>',
  clock:       '<circle cx="12" cy="12" r="9"/><path d="M12 7.4V12l3 1.9"/>',
  gauge:       '<path d="M3.6 17a9 9 0 1 1 16.8 0"/><path d="m12 12.6 3.6-3.4"/><circle cx="12" cy="14" r="1.4"/>',
  ledger:      '<path d="M5.5 3.8h10.2L19 7.1v13.1H5.5Z"/><path d="M15.3 3.8v3.5H19"/><path d="M8.6 12.4h6.9"/><path d="M8.6 16h4.6"/>',
  route:       '<circle cx="6.2" cy="6.2" r="2.4"/><circle cx="17.8" cy="17.8" r="2.4"/><path d="M8.6 6.2h5a4 4 0 0 1 0 8h-3a4 4 0 0 0 0 7.6"/>',
  /* structure and controls */
  chevron:     '<path d="m9.5 5.8 6.2 6.2-6.2 6.2"/>',
  chevronDown: '<path d="m5.8 9.5 6.2 6.2 6.2-6.2"/>',
  arrowOut:    '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 12 12"/><path d="M18.4 14v4.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4V7.2a1.6 1.6 0 0 1 1.6-1.6H10"/>',
  bellOff:     '<path d="M9.1 4.9A5.5 5.5 0 0 1 17.5 9.6c0 1.6.3 2.9.7 3.9"/><path d="M6.5 8.4v1.2c0 3.4-1.5 4.6-1.5 5.9h11.6"/><path d="M10.2 19.2a2 2 0 0 0 3.6 0"/><path d="m3.5 3.5 17 17"/>',
  linkOff:     '<path d="M9.4 14.6 8 16a3.7 3.7 0 0 1-5.2-5.2l1.7-1.7"/><path d="m14.6 9.4 1.7-1.7A3.7 3.7 0 0 1 21.5 13l-1.4 1.4"/><path d="m3.5 3.5 17 17"/>',
  build:       '<path d="M14.2 6.6a3.9 3.9 0 0 0 5 5l-8.6 8.6a2.3 2.3 0 0 1-3.3-3.3Z"/><path d="m5.3 5.3 3.4 3.4"/>',
  shield:      '<path d="M12 3.4 5 6v5.4c0 4 2.9 7.4 7 8.6 4.1-1.2 7-4.6 7-8.6V6Z"/><path d="m9.2 12 2 2 3.6-3.7"/>',
  db:          '<ellipse cx="12" cy="6.2" rx="6.8" ry="2.8"/><path d="M5.2 6.2v11.6c0 1.5 3 2.8 6.8 2.8s6.8-1.3 6.8-2.8V6.2"/><path d="M5.2 12c0 1.5 3 2.8 6.8 2.8s6.8-1.3 6.8-2.8"/>',
};

/* `title` is the ONE way this helper produces an accessible name. Without it
   the icon is aria-hidden, which is right for the common case: in this product
   every icon sits next to text that already says the thing, and a second
   announcement of the same word is noise. */
function icon(name, { size = 16, title = '', cls = '' } = {}) {
  const d = PATHS[name];
  /* An unknown name renders NOTHING rather than a placeholder glyph. A
     placeholder in an icon slot is a small lie about the state of the row. */
  if (!d) return '';
  const sizeCls = size === 20 ? ' ds-icon--20' : size === 24 ? ' ds-icon--24' : '';
  const a11y = title
    ? ` role="img" aria-label="${String(title).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}"`
    : ' aria-hidden="true" focusable="false"';
  return `<svg class="ds-icon${sizeCls}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none"`
    + ` stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${a11y}>${d}</svg>`;
}

const ICON_NAMES = Object.keys(PATHS);

export { icon, ICON_NAMES };
