# NEXUS OS — Automotive Design System v1.0

The locked design system for **NEXUS OS**, a Revenue Recovery & Action OS for auto dealerships.
This repository is the single source of truth for how every NEXUS surface looks and behaves.

**Live reference:** deployed on Vercel (see the project's deployment URL).

## What is in here

| File | What it is |
|---|---|
| `index.html` | The reference implementation. A working shell — command palette, tables, drawer, all UI states. Sample data, not production data. |
| `nexus-design-system.css` | The drop-in stylesheet. The only file in the whole product allowed to define style. |
| `NEXUS-DESIGN-SYSTEM-v1.md` | The written spec: tokens, components, state rules, agent workflow, PR acceptance checklist. |

## The rules

1. No raw hex outside the `:root` token blocks.
2. No feature-specific CSS. Missing a component? Add it to the system first, then use it.
3. Brand colour is identity. Semantic colour is information. Never swap them.
4. Every interactive element ships all states: default, hover, active, focus-visible, disabled, loading.
5. Colour never carries meaning alone — colour plus text plus icon.
6. ESTIMATED, ATTRIBUTED, CONFIRMED and RECOVERED never share a visual treatment.
7. A check that has not run renders as "Not run", never as a green tick.

Full detail, including the per-PR acceptance checklist, is in `NEXUS-DESIGN-SYSTEM-v1.md`.

## Using it in a module

```html
<link rel="stylesheet" href="nexus-design-system.css">
```

Then compose from the component classes. Module code contributes markup, never style.

## Screens in the reference

- **Command Center** — attention banner, KPI cards with Explain-this-number, Today's Money Leaks
- **Money Leaks** — the signature evidence-first card
- **Lead Recovery** — dense table, saved views, bulk actions with undo, detail drawer
- **Profit Sentinel** — vehicle cards with margin risk, grid and list
- **Channel Health** — PARTIAL and NOT RUN as first-class states
- **Deal Rescue** — loading, error and permission states
- **Conversations** — split view with AI provenance
- **Focus Mode** — one action at a time

Keyboard: `⌘K` or `/` opens the command bar, `Esc` closes.

## Status

v1.0 — LOCKED. Changes go through the design-system owner, not through module PRs.
