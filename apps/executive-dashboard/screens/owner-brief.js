/* NEXUS OS — screens/owner-brief.js

   Owner Brief — ◐ PARTIAL in the navigation. Design: design/stitch/owner-brief-executive-daily-briefing--6eaf47.html.

   PLACEHOLDER, registered on 7 Oct 2026 by the foundation pass of the Stitch
   redesign so the route, the navigation entry and the gate's registry checks
   exist before the screen is built. The screen agent replaces the body of the
   render function below with the Stitch layout bound to live data, following
   design/stitch/COMPONENTS.md ("How to migrate a screen"). Until then it reads
   nothing and therefore claims nothing: no number, no empty table that would
   read as "there is none". */
import { SCREENS } from '../lib/nav.js';
import { sectionHeader, card, statusChip } from '../lib/stitch-ui.js';

SCREENS.ownerbrief = async host => {
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">
    ${sectionHeader({ eyebrow: 'Work', title: 'Owner Brief', sub: 'The daily briefing for the owner.' })}
    ${card({ icon: 'shield_lock', title: 'Being rebuilt from its design', actionsHtml: statusChip('partial', 'Partial'),
      bodyHtml: `<p class="font-body-md text-body-md text-on-surface-variant">This screen will summarise yesterday's enquiries, deals and money at risk for the owner. It has not been connected to your data yet, so no figure is shown rather than a figure that was not read.</p>` })}
  </div>`;
};
