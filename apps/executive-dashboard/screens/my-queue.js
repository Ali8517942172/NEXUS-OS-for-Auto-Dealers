/* NEXUS OS — screens/my-queue.js

   My Queue — ◐ PARTIAL in the navigation. Design: design/stitch/my-queue-role-worklists-priority-triage--a1901e.html.

   PLACEHOLDER, registered on 7 Oct 2026 by the foundation pass of the Stitch
   redesign so the route, the navigation entry and the gate's registry checks
   exist before the screen is built. The screen agent replaces the body of the
   render function below with the Stitch layout bound to live data, following
   design/stitch/COMPONENTS.md ("How to migrate a screen"). Until then it reads
   nothing and therefore claims nothing: no number, no empty table that would
   read as "there is none". */
import { SCREENS } from '../lib/nav.js';
import { sectionHeader, card, statusChip } from '../lib/stitch-ui.js';

SCREENS.myqueue = async host => {
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">
    ${sectionHeader({ eyebrow: 'Work', title: 'My Queue', sub: 'Your own worklist, in priority order.' })}
    ${card({ icon: 'inbox', title: 'Being rebuilt from its design', actionsHtml: statusChip('partial', 'Partial'),
      bodyHtml: `<p class="font-body-md text-body-md text-on-surface-variant">This screen will list the leads, conversations and actions assigned to you, most urgent first. It has not been connected to your data yet, so nothing is listed here — that is not the same as your queue being empty.</p>` })}
  </div>`;
};
