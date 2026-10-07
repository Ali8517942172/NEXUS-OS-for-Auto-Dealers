/* NEXUS OS — scripts/roadmap-layouts.mjs

   Regenerates lib/roadmap-layouts.js from the fifteen roadmap exports in
   design/stitch/ (see that file's header for what is stripped). Run from
   apps/executive-dashboard:  node scripts/roadmap-layouts.mjs
   Needs Playwright's Chromium (PW_CHROMIUM, default /opt/pw-browsers/chromium).
   Network is blocked for the export pages, so nothing is fetched. */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const APP = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(APP + 'package.json');
const { chromium } = require('playwright');
const D = APP + 'design/stitch/';
const MAP = {
  stockmatch: 'stock-to-lead-matching-stalled-inventory-matcher--f0cc94.html',
  dealroom: 'deal-room-transaction-delivery-desk--504ea2.html',
  servicerecovery: 'service-revenue-recovery-aftersales-workshop-leak-desk--cf4df8.html',
  tradein: 'trade-in-desk-appraisal-valuation-engine--5dd9a2.html',
  acquisition: 'acquisition-advisor-inventory-procurement-intelligence--022747.html',
  recon: 'reconditioning-tracker-workshop-frontline-speed--256de8.html',
  marketplace: 'marketplace-performance-portal-roi-ingestion--27d9b0.html',
  ownership360: 'ownership-360-vehicle-lifecycle-relationship-dossier--069a9f.html',
  marketsentinel: 'market-sentinel-competitor-demand-telemetry--c8b236.html',
  eventgraph: 'dealership-event-graph-unified-customer-journey-node-telemetry--a1a5b9.html',
  benchmarking: 'dealer-benchmarking-anonymous-regional-peer-telemetry--39d2e5.html',
  calls: 'calls-voice-telephony-voice-ai--161aef.html',
  customerportal: 'customer-portal-buyer-facing-deal-tracker-vault--242e13.html',
  branches: 'group-branches-multi-entity-management--ed025f.html',
  localization: 'markets-localization-regional-country-packs--1ab4b6.html',
};
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const out = {}, texts = {};
for (const [id, f] of Object.entries(MAP)) {
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + D + f, { waitUntil: 'load' });
  const res = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    main.querySelectorAll('script,style,img,svg,video,canvas,iframe,picture,noscript,link').forEach(n => n.remove());
    main.querySelectorAll('.fixed,.hidden,.absolute.inset-0').forEach(n => { if (n.classList.contains('fixed') || n.classList.contains('hidden')) n.remove(); });
    const it = document.createNodeIterator(main, NodeFilter.SHOW_COMMENT); const cm = []; while (it.nextNode()) cm.push(it.referenceNode); cm.forEach(c => c.remove());
    let box = main; while (box.children.length === 1) box = box.children[0];
    const first = box.children[0];
    const removedHeader = first ? (first.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : '';
    if (first) first.remove();
    main.querySelectorAll('button,a').forEach(n => n.remove());
    main.querySelectorAll('input,textarea,select').forEach(n => {
      const s = document.createElement('span');
      s.className = (n.className || '') + ' flex items-center';
      s.textContent = '—';
      n.replaceWith(s);
    });
    /* Table bodies hold mock RECORDS (a branch, a customer, a unit): every
       cell's text becomes "—"; the header row keeps its labels. */
    main.querySelectorAll('tbody td').forEach(td => {
      const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT); const ns = [];
      while (w.nextNode()) ns.push(w.currentNode);
      ns.forEach(n => { if (n.parentElement && n.parentElement.classList.contains('material-symbols-outlined')) return; if (n.nodeValue.trim()) n.nodeValue = '—'; });
    });
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const texts = [];
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const t of nodes) {
      const p = t.parentElement;
      if (p && p.classList.contains('material-symbols-outlined')) continue;
      let v = t.nodeValue;
      if (!v.trim()) continue;
      v = v.replace(/[+\-−]?\d[\d,.:/%]*\s*(k|K|m|M|km|%|x|h|d|ms|s)?(?![A-Za-z])/g, '—').replace(/\b(Demo Motors(?: LLC)?|Doha Pearl Motors|Muscat Central|Riyadh North Hub|Sheikh Zayed Road|Range Rover|Rolls-Royce|Mercedes-Maybach|Mercedes(?:-Benz)?|BMW|Audi|Bentley|Ferrari|Lamborghini|Porsche)\b/g, '—').replace(/(—\s*)+/g, '— ');
      t.nodeValue = v;
      texts.push(v.replace(/\s+/g, ' ').trim());
    }
    main.querySelectorAll('*').forEach(n => {
      for (const a of [...n.attributes]) if (a.name !== 'class') n.removeAttribute(a.name);
    });
    // drop empty material icon? keep.
    const wrap = main.tagName === 'MAIN' ? main.innerHTML : main.innerHTML;
    return { html: wrap.replace(/\s+/g, ' ').replace(/> </g, '><'), texts, removedHeader, mainCls: main.className };
  });
  out[id] = res.html; texts[id] = { header: res.removedHeader, mainCls: res.mainCls, texts: [...new Set(res.texts)] };
  console.log(id, res.html.length, '| removed:', res.removedHeader);
  await page.close();
}
const js = `/* NEXUS OS — lib/roadmap-layouts.js

   GENERATED, 7 Oct 2026, from the fifteen roadmap exports in design/stitch/
   (MAP.md "Roadmap screens"). Loaded only by screens/roadmap.js, with a dynamic
   import(), so none of this reaches the bundle a working screen loads.

   What the generator did to each export's <main>, so nothing here can be read
   as data: the export's own header block was dropped (screens/roadmap.js draws
   the real one); scripts, styles, images, SVG charts, overlays and comments
   were removed; every button and link was removed (the only actions a roadmap
   screen offers are Notify me / Preview / Learn more, drawn by roadmap.js);
   every input and every table-body cell (mock records) became a "—"; every number, amount, date and percentage in the
   text became "—"; mock dealership, place and vehicle-make names became "—";
   every attribute except class was stripped (inline widths drew mock
   percentages). What is left is Stitch's layout and its labels.

   Do not edit by hand — regenerate with scripts/roadmap-layouts.mjs. */
export const LAYOUTS = ${JSON.stringify(out, null, 0).replace(/\u2028|\u2029/g, '')};
`;
writeFileSync(APP + 'lib/roadmap-layouts.js', js);
await browser.close();
