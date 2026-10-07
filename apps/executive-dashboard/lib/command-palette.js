/* NEXUS OS — lib/command-palette.js

   The global command palette ("Search or ask NEXUS", Ctrl K), designed in
   design/stitch/command-palette-shortcuts-global-quick-actions--2e7ab4.html.

   STUB. The shell (lib/shell.js) already calls openCommandPalette() from the
   topbar search box and from Ctrl K / Cmd K, so the entry points exist and are
   wired; this function is where the palette itself gets built. Until then it
   does nothing and says nothing, on purpose: a palette that opens with no
   results would read as "NEXUS found nothing", which is a claim about the data
   rather than about this file.

   Contract for whoever implements it:
     - openCommandPalette({ query }) opens the overlay, optionally pre-filled.
     - It is idempotent: a second call while open focuses the input.
     - Navigation goes through go() from lib/nav.js; reads through db() from
       lib/data.js; every customer field through lib/privacy.js.
     - closeCommandPalette() closes it; Escape must too. */

function openCommandPalette(_opts = {}) {
  /* intentionally empty — see the header */
}

function closeCommandPalette() {
  /* intentionally empty — see the header */
}

export { openCommandPalette, closeCommandPalette };
