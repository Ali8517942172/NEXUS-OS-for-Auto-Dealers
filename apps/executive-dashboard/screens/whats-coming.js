/* NEXUS OS — screens/whats-coming.js

   What's Coming. Design: design/stitch/what-s-coming-where-nexus-is-going--b970d9.html.

   PLACEHOLDER, registered on 7 Oct 2026 by the foundation pass of the Stitch
   redesign. It lists the roadmap items the navigation already carries (the
   `roadmap` entries in lib/nav.js), so the two cannot disagree; the screen
   agent replaces this body with the Stitch layout. Nothing here is a date or a
   promise: COMING SOON and PLANNED are the only two words used, and neither is
   a delivery commitment. */
import { SCREENS, flatNav } from '../lib/nav.js';
import { esc } from '../lib/format.js';
import { sectionHeader, card, statusChip } from '../lib/stitch-ui.js';

SCREENS.whatscoming = async host => {
  const items = flatNav().filter(i => i.roadmap);
  const row = i => `<a class="h-11 px-space-md flex items-center justify-between hover:bg-surface-container-low transition-colors" href="#${esc(i.id)}">
      <span class="flex items-center gap-space-sm"><span class="material-symbols-outlined text-[18px] text-outline">${esc(i.icon)}</span>
        <span class="font-body-sm text-body-sm font-semibold text-on-surface">${esc(i.title)}</span></span>
      ${i.roadmap === 'soon' ? statusChip('coming-soon') : statusChip('planned')}</a>`;
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">
    ${sectionHeader({ eyebrow: 'Roadmap', title: "What's coming", sub: 'Where NEXUS is going next. None of these screens reads your data yet.' })}
    ${card({ icon: 'rocket_launch', title: 'On the roadmap', sub: `${items.length} screens`, flush: true,
      bodyHtml: `<div class="divide-y divide-outline-variant/20">${items.map(row).join('')}</div>` })}
  </div>`;
};
