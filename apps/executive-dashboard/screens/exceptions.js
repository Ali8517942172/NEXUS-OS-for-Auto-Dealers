/* NEXUS OS — screens/exceptions.js

   Exceptions — ◐ PARTIAL in the navigation. Design: design/stitch/exceptions-operational-errors-system-health--a98152.html.

   PLACEHOLDER, registered on 7 Oct 2026 by the foundation pass of the Stitch
   redesign so the route, the navigation entry and the gate's registry checks
   exist before the screen is built. The screen agent replaces the body of the
   render function below with the Stitch layout bound to live data, following
   design/stitch/COMPONENTS.md ("How to migrate a screen"). Until then it reads
   nothing and therefore claims nothing: no number, no empty table that would
   read as "there is none". */
import { SCREENS } from '../lib/nav.js';
import { sectionHeader, card, statusChip } from '../lib/stitch-ui.js';

SCREENS.exceptions = async host => {
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">
    ${sectionHeader({ eyebrow: 'Operations', title: 'Exceptions', sub: 'What did not run as expected, and what it affects.' })}
    ${card({ icon: 'error_outline', title: 'Being rebuilt from its design', actionsHtml: statusChip('partial', 'Partial'),
      bodyHtml: `<p class="font-body-md text-body-md text-on-surface-variant">This screen will list the automations and deliveries that failed or were refused, in terms of what each one affects. It has not been connected yet, so nothing is listed — that does not mean nothing failed.</p>` })}
  </div>`;
};
