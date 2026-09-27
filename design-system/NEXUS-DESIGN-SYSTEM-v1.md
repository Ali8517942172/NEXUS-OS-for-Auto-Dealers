# NEXUS OS — Automotive Design System v1.0

**Status: LOCKED.** Every module, every agent, every screen composes from this. A module that invents its own styling is a defect, not a variation.

Reference implementation: the live NEXUS Command Center artifact.
Drop-in stylesheet: `nexus-design-system.css`.

---

## 0. The governing rule

> Less dashboard, more command center. Less data display, more decision support. Less AI theatre, more evidence and action.

Every screen answers, in this order:

```
WHERE AM I  →  WHAT IS HAPPENING  →  WHY  →  WHAT SHOULD I DO  →  DID IT WORK  →  WHAT WAS RECORDED
```

A screen that cannot answer all six is not finished.

**The 3-second test.** Within 3 seconds the user must know where they are, what matters, and what to do. If not, redesign.

**The 1-click test.** The most common action on any object (contact a lead, review a price, confirm an appointment) must be reachable in 1–2 interactions. Never 6.

---

## 1. Tokens

No raw hex anywhere outside `:root`. If a value is not a token, it does not go in the codebase.

### Brand
| Token | Light | Purpose |
|---|---|---|
| `--nx-ink` | `#0B1220` | Sidebar, attention banner, bulk bar |
| `--nx-blue` | `#2563EB` | Primary action, active state, links |
| `--nx-cyan` | `#06B6D4` | Second accent — evidence bars only |

### Surfaces
`--canvas #F5F7FA` · `--surface #FFFFFF` · `--surface-2 #FAFBFD` · `--surface-sunken #F1F4F9` · `--border #E2E8F0` · `--border-strong #CBD5E1`

### Text
`--text #0F172A` · `--muted #64748B` · `--subtle #94A3B8`

### Semantic — information, never branding
`--success #16A34A` · `--warning #D97706` · `--danger #DC2626` · `--info #0EA5E9`
Each has a `-soft` background and `-border` pair. Red means one specific thing: a real failure or a real critical item. Never decoration.

### Dark
`--canvas #070B12` · `--surface #111827` · `--border #263244` · `--text #F8FAFC`
Light is the default for tables, inventory, CRM, finance, reports. Dark is for the command center, AI surfaces, executive mode, wallboard, and personal preference.

### Spacing — 8pt
`4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 64`. Nothing at 19px or 23px.

### Radii
`4` utility · `8` inputs · `10` buttons · `12` cards · `16` panels · `20` major surfaces · pill for status, tags and filters only.

### Elevation
Rest = **no shadow**, 1px border. Hover = `0 4px 16px rgba(11,18,32,.08)`. Popover = `0 12px 32px`. Drawer = `-16px 0 48px`. No glow, no glass, no 3D.

### Motion
| Band | Duration | Used for |
|---|---|---|
| Micro | 140ms | hover, icon, button state |
| Component | 200ms | drawer, modal, dropdown, tooltip, toast |
| Large | 280ms | route-level transitions only |

Easing `cubic-bezier(.2,.7,.3,1)`. `prefers-reduced-motion` disables all non-essential movement. Motion exists for orientation, confirmation, state transition, genuine attention and progress. Nothing else.

### Density
`comfortable` (52px rows, default) · `compact` (40px) · `spacious` (64px). Saved per user. BDC gets compact; owner gets comfortable.

---

## 2. Typography

**Inter** for everything. **JetBrains Mono** for IDs, stock numbers, phone numbers, timestamps, technical audit rows.

| Role | Size / weight |
|---|---|
| Page title | 26–30 / 700, `-0.022em` |
| Section title | 15 / 650 |
| Card value | 30 / 700, `-0.03em` |
| Body | 13–14.5 / 400–550 |
| Table | 13 |
| Metadata | 11.5–12.5 / 500 |
| Overline | 10.5 / 650, `0.11em`, uppercase |

All columnar numbers use `font-variant-numeric: tabular-nums`.

---

## 3. Shell

**Sidebar** 252px, collapses to 72px with tooltips retained. Grouped: Overview / Revenue / Customers / Inventory / Operations / Finance / Admin. Active item = 3px left accent + tinted background, never a giant pill.

**Sidebar badges mean attention, never record count.** `Leads 12` is legal. `Inventory 1,281` is not.

**Navigation is role-aware.** Owner, Sales Manager, BDC, Finance and Admin get different trees *and different densities*. Permissions shape the experience, not just hide menu items.

**Topbar** — command trigger, persistent tenant identity, density, theme, notifications, user. Tenant is always visible: `ALBA CARS · Dubai · Production`. Tenant switching clears filters and results and announces itself. Wrong-tenant actions are an operational risk the UI must design against.

**Context strip** — breadcrumb (`ALBA CARS → Revenue → Money Leaks`) plus freshness (`Live · updated 14 sec ago · Dubai time`, or `Data may be stale · last sync 3h 14m ago`). Never show stale data as current.

---

## 4. Command bar (⌘K / Ctrl+K / `/`)

Three jobs, one input:

1. **Record search** — customers, leads, vehicles, conversations, appointments in one result set.
2. **Natural-language query** — "hot leads with no reply over 24h" returns an answer block with a number, the supporting context and a `Review all` button.
3. **Action request** — "assign all unowned hot leads to BDC" returns a **preview with a confirmation**, never a silent execution.

AI accelerates navigation. It never replaces it, and it never opens as a chatbot screen.

---

## 5. Components

### KPI card
`label → period → value → delta → evidence state → supporting counts → one action`.
A bare number is banned. Every metric carries a time period. Every important number carries an **Explain this number** popover showing the calculation.

### Money Leak card — the signature component
```
SEVERITY STRIPE │ title · who · vehicle │ estimated impact
────────────────────────────────────────────────────────
EVIDENCE (n signals, n% strength)   RECOMMENDED ACTION
 • signal                            what to do and why
 • signal                            [Primary] [Secondary]
```
Evidence first, action second. Impact always tagged `ESTIMATED`. Never a bare "high probability".

### Evidence states — never visually blended
| State | Treatment |
|---|---|
| ESTIMATED | dashed border, neutral, evidence-strength bar |
| ATTRIBUTED | dashed border, neutral, pending note |
| CONFIRMED | solid border, success tint |
| RECOVERED | solid success, linked record count |

Never apply the green "money made" treatment to an estimate.

### Buttons
Primary (blue filled) · Secondary (white + border) · Tertiary (text) · Destructive (red). 40px standard, 46px hero, 32px table-row. Label states the outcome: `Contact now`, `Create quote`, `Confirm appointment`. Never `Submit`, `OK`, `Process`, `Click here`.

### Badges
`LIVE · CONNECTED · RECEIVING · DEGRADED · BLOCKED · NEEDS ATTENTION · PENDING · FAILED · CONFIRMED · NOT BUILT · NOT TESTED`. One semantic colour each, plus a pip and the word. Never twelve badge colours.

### Table
Sticky header, sortable columns, row click opens the **drawer** not a new page, hover reveals the quick action, checkbox bulk selection. Selection and page position survive opening and closing a record. Filters live in the URL so reload, share and back all work.

### Bulk actions
Floating bar: `n selected` + actions. Reversible actions execute immediately and offer **Undo for 7 seconds**. Destructive actions require explicit confirmation and get no undo.

### Detail drawer — the workhorse
`header → why this is ranked → customer & vehicle → journey timeline → recommended action → audit trail → action footer`. No page reload, no lost context. Esc closes, focus returns.

### Journey timeline
Every step: timestamp + source + actor + result. Done / now / not yet, visually distinct.

### Audit trail
Human-readable first: `10:31 — NEXUS raised the score to 92 from 74. Source: Action Engine, 2 new signals.` Technical rows behind `View technical details`.

### Toasts
Confirmation only. `✓ Lead assigned to Ali` with the timestamp. Batch notifications: `17 lead updates`, never 17 toasts.

### Vehicle card
Image establishes identity (stock # and days-in-stock overlaid); the lower half establishes operational context (margin risk, price position, matched leads) and one action. Grid and List are both available and the choice is remembered.

---

## 6. State completeness

Every screen ships **all seven**:

| State | Rule |
|---|---|
| Loading | Skeleton at the final layout's dimensions. No layout shift. Never "Loading…" |
| Empty | Explain what was reviewed and why nothing appeared, plus a next step. Never "No data" |
| Error | What failed, when it last worked, what to do. Never "Something went wrong" |
| Partial | Some checks passed, some **have not run**. Verdict stays PARTIAL |
| Not run | A dash and the words "Not run". Never a green tick |
| Permission | Explain the restriction and who has access. Don't silently hide |
| Success | Confirm what happened and what was recorded |

**"Nothing happened" is a finding.** `No confirmed revenue leaks — NEXUS reviewed 1,284 leads, 342 conversations, 118 vehicles. No leak met the confirmation threshold.` That builds trust; a zero does not.

---

## 7. Truth rules the UI must enforce

- Estimated, attributed, confirmed and recovered are four different words with four different treatments.
- No false precision. `~AED 84K` when it is an estimate, not `AED 83,742.13`.
- AI content carries provenance: *"AI summary generated from 14 conversation events."* AI suggests, the user decides, the system executes.
- High-impact actions get a human approval surface showing the suggestion, the reason, the evidence and Approve / Reject.
- Download, activation, active dealership and paying subscription are four separate metrics and never share a card.
- A dealership never sees another dealership, platform revenue, global AI cost, credentials, internal prompts or cross-tenant health.

---

## 8. Accessibility — first-class, not an audit

Visible focus ring on everything. Full keyboard path: Tab, Shift+Tab, Enter, Esc, arrows in tables and menus. Focus trapped in drawer and modal, returned on close. Minimum target 24×24 (WCAG 2.2) — NEXUS standard is 32–40. Colour never alone. Accessible names on every icon-only control. `prefers-reduced-motion` respected.

Shortcuts: `⌘K` search · `/` search · `G L` leads · `G I` inventory · `G C` conversations · `Esc` close.

---

## 9. Responsive

| Width | Behaviour |
|---|---|
| 1440+ | 3–4 column dashboard, split views available |
| 1024 | 2 column |
| 768 | 1 column, sidebar becomes an overlay drawer |
| 390 | Action-priority: attention → revenue → actions → alerts → search. Two large action buttons per record. Not a shrunken table |

Build RTL-safe from the start — UAE means Arabic eventually. No hardcoded currency or date formats. Timezone always explicit on appointments, lead age, automation runs and channel events.

---

## 10. Modes

- **Executive** — big signals, minimal tables. Laptop or TV.
- **Operations** — dense: unanswered, hot, callbacks, appointments, tasks. BDC and sales.
- **Focus** — everything hidden except the priority actions, one at a time.
- **Wallboard** `/command-center` — no sidebar, no dense tables, auto-refresh, showroom monitor.

Same product, same components, different composition.

---

## 11. How agents work on this

```
Design-system agent  (owns nexus-design-system.css — the ONLY file that defines style)
        ↓
Component library    (owns the component markup contracts)
        ↓
Module agents        (compose only; zero new CSS)
        ↓
Visual QA agent      (rejects any module that fails the checklist)
```

Never four agents each building their own UI. That produces four products.

### Acceptance checklist — every module, every PR

**Visual** — tokens only, no raw hex; 8pt spacing; components reused; responsive at 1440/1024/768/390; no overflow; no layout shift.
**Interaction** — hover, focus, active, disabled, loading, success, error, empty, skeleton all present.
**Operational** — correct tenant; correct permissions; correct action; audit row generated; no cross-tenant exposure.
**Truth** — estimated vs confirmed separated; not-run never shown as passed; provenance on AI content; time period on every metric.
**Accessibility** — keyboard path, visible focus, target size, contrast, reduced motion.

Add visual regression screenshots per screen at all four widths. That is how one agent is stopped from quietly breaking another's screen.

---

## 12. What NEXUS must never look like

No permanent gradients. No glassmorphism. No neon glow. No always-animating charts. No pills on every button. No shadows on everything. No 15 KPI cards above the fold. No chart without a decision attached. No red everywhere. No AI chat floating over every screen. No page navigation for what a drawer handles. No modal for what an undo handles. No generic SaaS dashboard with a car icon dropped on it.

**Formula: 70% neutral · 20% brand blue/cyan · 10% semantic.**
