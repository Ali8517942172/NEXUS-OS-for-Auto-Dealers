# Stitch components — how to build a migrated screen

The foundation for re-skinning the dealer dashboard from the Google Stitch
exports in this folder (7 Oct 2026). Read `MAP.md` first: it says which export
is the visual reference for which route, and the owner's rule that nothing is
invented outside these files.

## What is in place

| piece | file | what it does |
|---|---|---|
| Tailwind theme | `design/stitch/theme.json` ← `scripts/stitch-theme.mjs` | Read out of the exports' own `tailwind.config` script. 78 of 81 exports are identical to it; 3 (`ask-ai--bb752c`, `customer-360-unified-intelligence--dc1622`, `finance-desk--331d24`) only omit `on-background`. `npm run build` re-checks every export. |
| Tailwind build | `tailwind.config.js`, `postcss.config.js`, `lib/stitch.css` | Compiled at build time. Preflight is **off**; a copy of it applies only inside `.nx-stitch`. Every utility compiles as `.nx-tw .x` (`nx-tw` is on `<html>`), so it out-ranks the legacy element rules. |
| Purge guard | `scripts/stitch-classes.mjs` (in `npm run build`), `QUALITY_GATE.mjs` R8 | Fails the build on a class glued to an interpolation (`bg-${x}`, `'text-' + y`), and on any Tailwind class from the source missing from the built CSS. R8 does the same for every class on every rendered screen. |
| App shell | `index.html`, `lib/nav.js`, `lib/shell.js` | Sidebar, topbar, scope menu, freshness chip, health popover, notifications drawer, shortcuts. |
| Components | `lib/stitch-ui.js` | Everything below. |
| Command palette | `lib/command-palette.js` | `openCommandPalette()` stub — already wired to the search box and Ctrl K. |

The legacy stylesheets (`styles.css`, `lib/theme-*.css`, `lib/design-system.css`)
still load, so a screen that has not been migrated looks as it did.

## The three rules

1. **Class strings are literal.** Tailwind only generates a class it can read in
   a source file. Pick a variant from a map of *complete* strings:

   ```js
   const ROW = { idle: 'h-11 px-4 hover:bg-surface-container-low', on: 'h-11 px-4 bg-primary-container text-on-primary' };
   el.className = on ? ROW.on : ROW.idle;      // yes
   el.className = `h-11 px-4 bg-${tone}`;      // no — the build fails
   ```
   Arbitrary values (`text-[11px]`, `bg-[#FDECEA]`) are fine when written out.
2. **Escape everything; mask customers.** `esc()` from `lib/format.js` for any
   value. A customer's name, phone or email goes through `displayName` /
   `maskPhone` / `maskEmail` from `lib/privacy.js` first (gate S13).
3. **Unknown is not zero.** `null` renders `—` and a sentence, never `0`.
   Stitch's numbers, names and statuses are layout placeholders — none of them
   is data. Estimated, attributed, confirmed and recovered are four words, and
   the money tile prints the word.

## `lib/stitch-ui.js`

All return an HTML string unless noted. Parameters ending in `Html` are trusted
markup you built and escaped; every other string is escaped inside.

| function | signature | source in the exports |
|---|---|---|
| `statusChip` | `(kind, label?)` — kind ∈ `CHIP_KINDS`: `live connected receiving partial blocked failed pending not-tested degraded restricted coming-soon planned`; an unknown kind renders as *not tested* | states-components §1 |
| `tempChip` | `(value)` — `HOT WARM COLD WON LOST OPEN`, anything else neutral | leads-*, deals-pipeline-* |
| `BTN` | `{ primary, secondary, tertiary, destructive, icon }` — class strings for `<button class="${BTN.primary}">` | overview--af6246, states-components §4 |
| `kpiTile` | `({ label, value, sub, href, linkLabel='View', info })` — `value` pre-formatted, `null` → `—`; `href` is a screen id (`data-screen-link`) | states-components §3 |
| `moneyTile` | `({ kind: 'estimated'│'attributed'│'confirmed'│'recovered', label, amount, sub, unknownWhy, footLeft, footRight })` — `amount` in AED or `null` | states-components §2 |
| `card` | `({ icon, title, sub, actionsHtml, bodyHtml, flush, id })` | overview--af6246 "Priority actions" |
| `sectionHeader` | `({ eyebrow, title, sub, actionsHtml })` — the page header | overview--af6246 |
| `dataTable` | `({ columns: [{ label, align }], rows: [[cellHtml…]], rowAttrs(i), emptyHtml, clickable })` — 44px rows | states-components §4, §6 |
| `emptyState` | `({ icon, title, body })` | states-components §5.1 |
| `errorState` | `({ what, err, retry })` — never prints the backend's words; heading keeps "Couldn't load" (the gate looks for it); `retry` → `data-retry` | states-components §5.3 |
| `skeleton` | `({ rows })` — carries `data-skeleton`, which gate R2 treats as stuck loading | states-components §5.2 |
| `comingSoonPanel` | `({ kind: 'coming-soon'│'planned', icon, title, body, prerequisite, actionsHtml })` | states-components §5.6 |
| `trustFooter` | `({ source, asOf, evidence, actor })` — blanks print `—` | states-components §7 |
| `drawerShell` | `({ icon, title, sub, bodyHtml, footHtml })` | notifications-drawer--ef7a40 |
| `openStitchDrawer` | `(opts)` → the `#drawer` element. Uses `lib/ui.js openDrawer()`, so the scrim, Escape and identity wiping still work | — |
| `openStitchModal` | `({ title, bodyHtml, footHtml, wide })` → `{ wrap, close, msg }`, the same contract as `lib/modal.js openModal()` | command-palette--2e7ab4 overlay |

## How to migrate a screen (recipe)

1. Open the route's **primary** export (MAP.md) next to `screens/<file>.js`; list
   every section from *all* its exports, and the live query that feeds each.
2. Keep the module's registration line (`SCREENS.<id> = async host => {…}`) and
   its existing reads, privacy calls and refusal handling — only the markup changes.
3. Make the root `<div class="nx-stitch flex flex-col gap-space-md">` — `nx-stitch`
   turns on the scoped reset the Stitch classes were designed against.
4. Start with `sectionHeader()`; paint `skeleton()` while reads are in flight.
5. Copy each section's markup from the export; replace every mock value with the
   live value through `esc()` / `lib/format.js`, or `—` plus a sentence when unknown.
6. Use the `lib/stitch-ui.js` helpers for chips, tiles, cards, tables and states
   rather than re-copying them, so the same thing looks the same everywhere.
7. Variants come from maps of complete class strings, never `${}` inside a class.
8. A section with no data source yet: `comingSoonPanel()` or `emptyState()` with
   the honest reason — never the mock's numbers.
9. End data screens with `trustFooter()` (source view/table, `dubaiStamp()` of the
   read, row count as evidence, the signed-in actor).
10. `npm run build` (theme check + class guard) and
    `node QUALITY_GATE.mjs --no-db` (R1–R8 must stay green); screenshot at
    1440×900 beside the export.

Shell hooks a screen may use: `go(id)` from `lib/nav.js`; any element with
`data-screen-link="<id>"` inside the shell overlays routes itself; the freshness
chip times itself from your `db()` reads automatically (pass
`db(path, { background: true })` for a read no reader is waiting on).
