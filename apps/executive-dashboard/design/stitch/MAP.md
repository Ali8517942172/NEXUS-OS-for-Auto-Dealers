# Stitch design map — the only source of visual truth for the dashboard

Every file in this folder was generated in **Google Stitch** (project
`661582960945403288`, "Nexus Dealership Revenue OS") on 7 October 2026 and
exported verbatim through Stitch's own `DownloadFile` RPC. `index.json` lists
each export with its Stitch screen id, title, canvas size and the prompt that
produced it.

**Rule set by the owner, 7 Oct 2026:** the frontend is designed in Stitch and
nowhere else. Integration code may translate a Stitch layout into a live,
data-bound screen; it may not invent a section, a visual style or a layout
that is not in one of these files. If a needed section is missing here, it is
generated in Stitch first and exported into this folder, then built.

**Honesty rules still win over a Stitch mock.** Stitch filled its mocks with
sample numbers, names and statuses. Those are placeholders for layout only:
every value on a live screen comes from the database or reads as an honest
empty state ("No data yet", "—", "Not connected"), never a number copied from a
mock. Estimated / attributed / confirmed money stay three separate words.

## How to read a screen with several versions

Stitch regenerates a whole screen on every update, so a later version can
drop a section an earlier one had. For each route: the **primary** file is the
visual reference (layout, components, spacing); every section listed in **any**
of its files is in scope.

| route (screens/*.js id) | primary | also covers sections from |
|---|---|---|
| App shell (index.html, lib/nav.js, topbar) | `app-shell-master-specification-navigation-hierarchy--2b6343.html` | `app-shell-scope-menu-active-latency-warning--068c5d.html`, `app-shell-system-health-popover-active--cb7e59.html`, `app-shell-notifications-drawer-active--ef7a40.html` |
| money-leaks | `today-s-money-leaks-landing-command-center--30144a.html` | `--012119` |
| overview | `overview-revenue-command-center--af6246.html` | `--99a45c`, `--74e5c2` |
| leads (+ lib/lead-drawer.js) | `leads-saved-views-board-inspector-drawer--088011.html` | `leads-pipeline-audit-drawer--0e162f`, `leads-pipeline-inspector--*` |
| record-lead (+ lib/manual-lead-form.js) | `record-a-lead-manual-floor-intake-history--*.html` | `record-a-lead-form--*` |
| lead-sources | `lead-sources-ingestion-readiness-desk--c3ca1e.html` | `--1ce809` |
| channels | `channels-readiness-status-engine--54b35c.html` | `--dec649` |
| integrations | `integrations-connected-ecosystem-api-keys--*.html` | |
| conversations | `conversations-omnichannel-dealership-inbox--*.html` | |
| appointments | `appointments-showroom-visits-contextual-drawer--5a2c6d.html` | `--a539b3`, `--43862a` |
| compliance | `compliance-kyc-register-regulatory-telemetry--*.html` | |
| revenue | `revenue-recovery-money-leaks-engine--467051.html` | `--a2b2bd` |
| lead-recovery | `lead-recovery-stalled-inquiries-engine--b14f62.html` | `--c6f82d`, `--be9936` |
| deal-rescue | `deal-rescue-at-risk-deals-desk--497bb5.html` | `--c58152` |
| attribution | `attribution-multi-channel-revenue-engine--*.html` | |
| policy | `policy-revenue-governance-rule-engine--*.html` | |
| inventory (+ lib/unit-form.js) | `inventory-assets-profit-sentinel--3fd9e5.html` | `--a81092` |
| vehicle-360 (NEW, PARTIAL) | `vehicle-360-dossier-asset-telemetry--*.html` | |
| competitors | `competitors-market-intelligence-scraping-sentinel--*.html` | |
| ask | `ask-ai-grounded-knowledge-base--*.html` | |
| finance | `finance-desk-underwriting-quotations--*.html` | |
| customers | `customer-360-3-panel-unified-dossier--31a9aa.html` | `customer-360-unified-intelligence--dc1622` |
| actions | `action-center-next-best-actions-queue--be8f47.html` | `--31efb6`, `--b76b17` |
| campaigns | `campaigns-7-day-drip-outbound-telemetry--*.html` | |
| deals (+ lib/deal-form.js) | `deals-pipeline-deal-360-desk--80d495.html` | `--5c884c`, `--fd31c9` |
| automation | `automation-action-engine-pipeline-drawer--9c8237.html` | `--4539d7` |
| team | `team-showroom-roster-access--*.html` | |
| setup | `setup-dealership-configuration-verification--*.html` | |
| subscription | `subscription-plan-capabilities-billing--1818da.html` | `--aa3177` |
| settings | `settings-workspace-governance-preferences--7e840f.html` | `--137c0f` |
| login card (app.js boot) | `sign-in-nexus-os-dealership-authentication--*.html` | |
| founder console (founder/) | `founder-console-nexus-platform-administration--a38ee6.html` | `--d6c87c` |
| my-queue (NEW, PARTIAL) | `my-queue-role-worklists-priority-triage--*.html` | |
| owner-brief (NEW, PARTIAL) | `owner-brief-executive-daily-briefing--*.html` | |
| exceptions (NEW, PARTIAL) | `exceptions-operational-errors-system-health--*.html` | |
| whats-coming (NEW) | `what-s-coming-where-nexus-is-going--*.html` | |
| command palette (global overlay) | `command-palette-shortcuts-global-quick-actions--*.html` | |
| design reference only | `states-components-design-system-specification--*.html`, `mobile-tablet-responsive-viewports-showcase--*.html` | |

### Roadmap screens — COMING SOON / PLANNED, no live data

`trade-in-desk-…`, `acquisition-advisor-…`, `stock-to-lead-matching-…`,
`marketplace-performance-…`, `service-revenue-recovery-…`, `ownership-360-…`,
`market-sentinel-…`, `calls-voice-…`, `deal-room-…`,
`dealership-event-graph-…`, `dealer-benchmarking-…`, `customer-portal-…`,
`group-branches-…`, `markets-localization-…`, `reconditioning-tracker-…`.

Each renders its Stitch layout with every number, name and amount replaced by
`—`, a COMING SOON / PLANNED badge, one honest sentence, a prerequisite line,
and only Notify me / Preview / Learn more buttons.
