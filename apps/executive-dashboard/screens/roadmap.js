/* NEXUS OS — screens/roadmap.js

   The fifteen roadmap routes the Stitch navigation carries under each group's
   "+N coming soon" row (lib/nav.js, `roadmap:` entries). One module, fifteen
   registrations, each written out as `SCREENS.<id> = …` because
   QUALITY_GATE.mjs S1 reads the registry from that literal form.

   PLACEHOLDER, registered on 7 Oct 2026 by the foundation pass of the Stitch
   redesign. MAP.md says what each becomes: its Stitch layout with every number,
   name and amount replaced by "—", the COMING SOON / PLANNED badge, one honest
   sentence and a prerequisite line. Until a screen agent builds that, each
   renders the canonical coming-soon panel with the same sentence and
   prerequisite. No route here reads any data, so none can claim any. The
   prerequisites are facts recorded in CLAUDE.md and PRODUCT.md (no service
   table, no reconditioning-cost column, no Dubizzle leads feed, messages joined
   by email address), not estimates. */
import { SCREENS } from '../lib/nav.js';
import { sectionHeader, comingSoonPanel } from '../lib/stitch-ui.js';

const roadmap = (title, kind, icon, design, body, prerequisite) => async host => {
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md" data-stitch-design="${design}">
    ${sectionHeader({ eyebrow: kind === 'planned' ? 'Planned' : 'Coming soon', title, sub: 'Not part of this build yet. Nothing on this screen reads your data.' })}
    ${comingSoonPanel({ kind, icon, title, body, prerequisite })}
  </div>`;
};

SCREENS.stockmatch = roadmap('Stock-to-Lead Matching', 'coming-soon', 'join_inner', 'stock-to-lead-matching-stalled-inventory-matcher--f0cc94.html',
  'Matches ageing stock to the people who asked about similar cars.',
  'Enough leads with a recorded vehicle of interest to match against.');
SCREENS.dealroom = roadmap('Deal Room', 'coming-soon', 'meeting_room', 'deal-room-transaction-delivery-desk--504ea2.html',
  'One place to carry a deal from agreement to delivery.',
  'Deal stages recorded beyond closed-won.');
SCREENS.servicerecovery = roadmap('Service Revenue Recovery', 'planned', 'car_repair', 'service-revenue-recovery-aftersales-workshop-leak-desk--cf4df8.html',
  'Finds customers who are due back in the workshop and have not booked.',
  'A service and appointment history from the workshop system — NEXUS holds none today.');
SCREENS.tradein = roadmap('Trade-In Desk', 'planned', 'sync_alt', 'trade-in-desk-appraisal-valuation-engine--5dd9a2.html',
  'Records a trade-in appraisal alongside the deal it belongs to.',
  'A trade-in appraisal record, which does not exist yet.');
SCREENS.acquisition = roadmap('Acquisition Advisor', 'planned', 'shopping_cart', 'acquisition-advisor-inventory-procurement-intelligence--022747.html',
  'Suggests which vehicles to buy next from what is selling.',
  'Market prices for vehicles the dealership does not yet own.');
SCREENS.recon = roadmap('Reconditioning Tracker', 'planned', 'build_circle', 'reconditioning-tracker-workshop-frontline-speed--256de8.html',
  'Tracks each unit from purchase to front line, and what it cost to get there.',
  'A reconditioning cost per unit — inventory has no such column today.');
SCREENS.marketplace = roadmap('Marketplace Performance', 'planned', 'storefront', 'marketplace-performance-portal-roi-ingestion--27d9b0.html',
  'Shows which listing portals bring enquiries that turn into sales.',
  'Enquiries delivered from the portals; Dubizzle has no public leads feed.');
SCREENS.ownership360 = roadmap('Ownership 360', 'planned', 'manage_history', 'ownership-360-vehicle-lifecycle-relationship-dossier--069a9f.html',
  'Follows a sold vehicle and its owner after the sale.',
  'A service history linked to each sold vehicle.');
SCREENS.marketsentinel = roadmap('Market Sentinel', 'planned', 'radar', 'market-sentinel-competitor-demand-telemetry--c8b236.html',
  'Watches competitor pricing and local demand together.',
  'Demand data beyond the current competitor price checks.');
SCREENS.eventgraph = roadmap('Dealership Event Graph', 'planned', 'schema', 'dealership-event-graph-unified-customer-journey-node-telemetry--a1a5b9.html',
  "Draws one customer's whole journey across every channel.",
  'A lead reference on every message and audit row; today some are joined by email address only.');
SCREENS.benchmarking = roadmap('Dealer Benchmarking', 'planned', 'leaderboard', 'dealer-benchmarking-anonymous-regional-peer-telemetry--39d2e5.html',
  'Compares your figures with anonymised dealerships like yours.',
  'Several dealerships agreeing to share anonymised figures.');
SCREENS.calls = roadmap('Calls & Voice', 'planned', 'call', 'calls-voice-telephony-voice-ai--161aef.html',
  'Brings phone calls into NEXUS as enquiries and history.',
  "A connection to the dealership's phone system.");
SCREENS.customerportal = roadmap('Customer Portal', 'planned', 'person_pin', 'customer-portal-buyer-facing-deal-tracker-vault--242e13.html',
  'Lets a buyer follow their own deal and documents.',
  "A buyer sign-in that is separate from the dealership's.");
SCREENS.branches = roadmap('Group & Branches', 'planned', 'account_tree', 'group-branches-multi-entity-management--ed025f.html',
  'Runs several rooftops under one dealership group.',
  'More than one rooftop per account; this build answers as one dealership.');
SCREENS.localization = roadmap('Markets & Localization', 'planned', 'translate', 'markets-localization-regional-country-packs--1ab4b6.html',
  'Adds country packs beyond the UAE.',
  'A second market to localise for.');
