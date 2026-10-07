<!-- BUSINESS CONTEXT — added 2026-09-02, corrected 2026-09-03, product framing added 2026-09-08 -->
> **This is a commercial product, not a demo.** NEXUS is a **Revenue Recovery &
> Action OS for dealerships** — it sits above the dealership's existing DMS, CRM
> and inventory systems, finds revenue leaks, decides the next best action and
> executes it. It replaces none of them. See `PRODUCT.md` for the thesis and
> `CLAUDE.md` for how to work here. Ali owns NEXUS OS and is selling it to real
> dealerships on a subscription — the UAE market first, then worldwide. It is a
> multi-tenant product by design, not a build for one dealer; **Tenant A is
> tenant #1 and the pilot**, the proving ground rather than the customer it was
> built for. Judge changes by whether they make it sellable and keep it
> sellable. The honest commercial position today is a **controlled
> dealership pilot** — not "enterprise-ready", not "compliant". Never state more
> than the evidence supports; "wired but never fired" is a real answer.
>
> **Correction, 2026-09-03.** This block used to end: *"The blocker before a
> second paying dealership is that the system is single-tenant: every RLS policy
> is `USING (true)`, so tenant two would read tenant one's customers."* That was
> true when it was written and is **no longer true**. Measured today: `public`
> holds 120 policies, of which **25 are tenant-scoped**, and `CLAUDE.md` records
> the tenancy build as complete at the database layer and proven adversarially
> against two synthetic tenants. The blocker before a second dealership is now
> **operational, not structural** — `NEXUS_TENANT_MAP` is unset on the box, and
> one WhatsApp webhook lets the caller choose the dealership. Read `CLAUDE.md`
> for the current position; do not carry this paragraph's old claim forward.

# NEXUS OS Design System

**This file describes `apps/executive-dashboard/styles.css`, which is the entire
design system.** Screens add no CSS — the quality gate's `S2` helper-contract
lint fails any source file under `screens/`, `lib/` or `app.js` that contains an
inline `<style>`, with `styles.css` named as the sole owner of styling. If this
file and `styles.css` disagree, `styles.css` is right and this file is the bug.

Rewritten 2026-09-03. The previous edition specified Deep Indigo `#4F46E5`, Soft
Emerald `#10B981`, a dark theme on `#111827`, "maximum 2–3 colours total", and
8–12px radii. **None of that was ever built.** The shipped system is a light-only
navy-and-slate palette with a graded semantic set, and every colour in it was
contrast-tested rather than chosen for looks.

## Light only. There is no dark theme.

`styles.css` line 4 says so in the file itself: *"Light only; there is no dark
variant."* There is no `prefers-color-scheme` block, no `data-theme` attribute
and no theme toggle. The one user preference that exists is **density**
(`comfortable` / `compact`), held in `localStorage` under `nexus.density` and
applied by `lib/prefs.js` as a `body.compact` class.

Do not write a dark-mode style rule without building dark mode; a half-present
dark theme is worse than none.

## The palette is 50 custom properties on a single `:root`

Everything is a token. No screen may hardcode a hex value.

### Brand and surfaces

| token | value | role |
|---|---|---|
| `--primary` | `#1B3A6B` | deep navy. Primary buttons, active nav, links. **11.3:1 on white** |
| `--primary-hover` | `#16305A` | hover only |
| `--primary-subtle` | `#EAF0F9` | active nav background, VIP pill fill |
| `--vip` | `#8A6A1F` | returning-customer badge only. 6.0:1 |
| `--canvas` | `#F7F8FA` | page background |
| `--surface` | `#FFFFFF` | cards |
| `--surface-sunken` | `#F1F3F7` | inset areas |
| `--surface-hover` | `#F4F6F9` | row and control hover |
| `--border-subtle` | `#E8EAEF` | dividers |
| `--border` | `#D6DAE2` | card and control borders |

### Text — four steps, and the fourth is not for text

| token | value | contrast | use |
|---|---|---|---|
| `--text` | `#0F1729` | 17.9:1 | body |
| `--text-2` | `#4A5468` | 7.6:1 | secondary |
| `--text-muted` | `#68718A` | 4.9:1 | **the lowest value still safe for real text** |
| `--text-disabled` | `#8A93A5` | 3.1:1 | decorative only — never readable text |

### Semantic families

Each family carries three values: `-solid` for dots, bars and icons, `-text` for
type, `-fill` for pill backgrounds. They are not interchangeable, and the reason
is written into the file: **`--warm` `#B26A00` is only 4.2:1, so amber text uses
`--warm-text` `#96570A` instead.** Using the solid as text is the recurring bug
this split exists to prevent.

`--hot` · `--warm` · `--cold` · `--ok` · `--neutral`

### Lead lifecycle — four states, graded against their own fills

`leads.status` carries eight values and only three of them had ever been graded,
so WON was painted in the COLD blue: a closed sale and a lead that never replied
were the same swatch.

| token | fill / text | contrast | meaning |
|---|---|---|---|
| `--won` | `#157A5B` / `#FFFFFF` | 5.3:1 | **the only solid pill in the system** — a sale is the one state worth being unmistakable |
| `--dead` | `#E4E6EC` / `#3F4757` | 7.5:1 | finished and lost; a darker grey than an unknown value |
| `--open` | `#F1EAFA` / `#5B2E8C` | 8.1:1 | still being worked. Violet is the one hue not already spoken for |
| `--unknown` | `#F1F3F7` / `#4A5468` | 7.0:1 | a status nobody taught this build about — reads as unclassified, not as neutral |

**`unknown` is a design requirement, not a fallback.** A figure or a state the
system cannot establish must be visibly unestablished. See INV-007 in
`NEXUS_INVARIANTS.md`: no record is not proof that nothing happened, and the
styling must not let an absence look like a pass.

## Typography

Loaded from Google Fonts in `index.html`:

- **Inter** 400/500/600/700 — everything.
- **JetBrains Mono** 400/500 — `.mono`, 12px. Ids, VINs, keys, timestamps.
- **Material Symbols Outlined** — every icon. There is no icon SVG set.

## Shape, depth, motion

```
--radius-control  6px      buttons, inputs, nav items
--radius-card    10px      cards
--shadow-1  0 1px 2px  rgba(15,23,41,.06)     resting
--shadow-2  0 8px 24px rgba(15,23,41,.10)     drawers, modals
--dur-micro 120ms   --dur-panel 200ms   --ease cubic-bezier(.16,1,.3,1)
```

## Components

- **Cards** — `--surface` on a 1px `--border`, `--radius-card`, 20px padding.
  Subtle border, no heavy drop shadow. `.card.flush` removes padding for tables.
- **Buttons** — default is a bordered light control. `.btn.primary` is solid
  `--primary` with white text; `.btn.ghost` is borderless; `.btn.danger` is a
  `--hot` outline on white, never a solid red fill. `:disabled` is `opacity .5`
  and stays visible — see below.
- **Pills** — `lib/format.js`'s `pill()` owns the markup. A pill whose label is
  not a word the tone table knows carries a title explaining that it is shown
  exactly as the database holds it. INV-008 tracks the call sites that still
  leave that decision to the fallback.
- **Sidebar** — 240px, Material icons at 20px in `--text-2`; the active item
  takes `--primary-subtle` background, `--primary` text and a 3px
  `--primary` left border.
- **Data visualisation** — inline SVG in the screen that needs it. Use the
  semantic families and `--primary`; do not introduce a chart palette.

## Two rules the styling has to hold up

1. **Authorisation is shown and disabled, never hidden.** A control the signed-in
   user may not use renders greyed with a `title` naming the refusal. The gate's
   `R7` check asserts this against a served `may_decide=false /
   NOT_AN_APPROVER` and expects the disabled controls and the refusal sentence to
   appear.
2. **Every panel has four states — loading, error, empty, loaded — and they must
   not look alike.** "Failed to load" and "nothing here" are opposite findings.
   `lib/states.js` owns all four.
