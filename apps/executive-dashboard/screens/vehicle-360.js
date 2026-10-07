/* NEXUS OS — screens/vehicle-360.js

   Vehicle 360 — ◐ PARTIAL, opened from Inventory (no sidebar row). Design: design/stitch/vehicle-360-dossier-asset-telemetry--b25c7a.html.

   PLACEHOLDER, registered on 7 Oct 2026 by the foundation pass of the Stitch
   redesign so the route, the navigation entry and the gate's registry checks
   exist before the screen is built. The screen agent replaces the body of the
   render function below with the Stitch layout bound to live data, following
   design/stitch/COMPONENTS.md ("How to migrate a screen"). Until then it reads
   nothing and therefore claims nothing: no number, no empty table that would
   read as "there is none". */
import { SCREENS } from '../lib/nav.js';
import { sectionHeader, card, statusChip } from '../lib/stitch-ui.js';

SCREENS.vehicle360 = async host => {
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">
    ${sectionHeader({ eyebrow: 'Assets', title: 'Vehicle 360', sub: 'One vehicle: cost, days in stock, interest and history.' })}
    ${card({ icon: 'directions_car', title: 'Being rebuilt from its design', actionsHtml: statusChip('partial', 'Partial'),
      bodyHtml: `<p class="font-body-md text-body-md text-on-surface-variant">This screen will show one unit from your inventory in full. It has not been connected yet; open a unit from Inventory in the meantime.</p>` })}
  </div>`;
};
