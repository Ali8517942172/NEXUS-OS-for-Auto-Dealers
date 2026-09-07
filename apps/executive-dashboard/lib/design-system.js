/* NEXUS OS — lib/design-system.js
   The component layer that goes with lib/design-system.css.

   Every helper here returns an HTML STRING, because that is how every screen in
   this app already renders: `panel()` assigns `body.innerHTML = render(data)`.
   A component layer that returned elements would need every screen rewritten
   around it, which is not a presentation change.

   ───────────────────────────────────────────────────────────────────────────
   THE ONE RULE THESE HELPERS ENFORCE ON THEIR CALLERS
   ───────────────────────────────────────────────────────────────────────────
   A long explanatory sentence may be DEMOTED. It may not be dropped.

   So `dsStat`, `dsCallout` and `dsCell` all take a `note`, and a note is
   rendered as a <details> that is present in the DOM open or closed. There is
   deliberately no helper that takes a sentence and renders it as a `title=`
   attribute: a tooltip is invisible to browser find, unreachable on a touch
   screen, unselectable, and gone from a screenshot. The sentences on these
   screens exist because this product has rendered a false all-clear seven
   times, and a caveat a reader cannot find is a caveat that is not there.

   Nothing here escapes on the caller's behalf. Every parameter documented as
   HTML is inserted verbatim; every parameter documented as text is escaped
   here. Mixing those two silently is how an XSS gets written, so each helper
   says which it takes, per argument.
   ========================================================================== */
import { esc } from './format.js';
import { icon } from './icons.js';

/* ── tone → intent ────────────────────────────────────────────────────────
   The app's existing tone vocabulary (lib/format.js TONE) is the source of
   truth for what a status MEANS; this maps those words onto the six intents
   this design system paints. It is a translation and never a re-judgement: a
   caller that wants a different colour must pass a different tone upstream, so
   that one status can never be two colours on two screens.

   `unknown` maps to `unknown` and to nothing else, in both directions. That is
   the whole point of the intent existing. */
const TONE_TO_INTENT = {
  hot: 'danger', warm: 'warning', cold: 'info', ok: 'success',
  unknown: 'unknown', won: 'success', dead: 'neutral', open: 'info',
  '': 'neutral',
};
const dsIntent = t => TONE_TO_INTENT[String(t || '').toLowerCase()] || 'neutral';

const INTENTS = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'unknown']);
/* An intent this file does not know is NEUTRAL, never success. A typo must not
   be able to paint an unmeasured thing green. */
const safeIntent = i => (INTENTS.has(i) ? i : 'neutral');

/* Default icon per intent. Shape carries the meaning as well as colour, so the
   set is legible in a greyscale print of the screen and to a reader who does
   not separate the red from the green. */
const INTENT_ICON = {
  neutral: 'info', info: 'info', success: 'check',
  warning: 'alert', danger: 'danger', unknown: 'question',
};

/* ══════════════════════════════════════════════════════════════════════════
   dsNote — the info affordance
   ──────────────────────────────────────────────────────────────────────────
   `body` is HTML and is inserted verbatim: callers pass already-escaped prose,
   often several paragraphs of it, and several pass lists.
   `label` and `a11y` are TEXT and are escaped here.
   ══════════════════════════════════════════════════════════════════════════ */
function dsNote(body, { label = '', a11y = 'Show the full explanation', name = 'info', open = false, cls = '' } = {}) {
  if (!body) return '';
  const showsLabel = label !== '';
  return `<details class="ds-note${showsLabel ? '' : ' ds-note--icon'}${cls ? ' ' + cls : ''}"${open ? ' open' : ''}>`
    + `<summary title="${esc(a11y)}" aria-label="${esc(a11y)}">${icon(name, { size: 16 })}`
    + (showsLabel ? `<span class="ds-note__label">${esc(label)}</span>` : '')
    + `</summary><div class="ds-note__body">${body}</div></details>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   dsChip — the visual language for status
   `label` is TEXT. `verbatim` says the label is a value taken from the database
   rather than words the product wrote, which is a claim about provenance the
   caller alone can make — see lib/format.js's pill() for the same distinction
   and why it was moved to the caller.
   ══════════════════════════════════════════════════════════════════════════ */
function dsChip(label, intent = 'neutral', { dot = true, name = '', verbatim = false, title = '', lg = false } = {}) {
  const i = safeIntent(intent);
  return `<span class="ds-chip ds-chip--${i}${verbatim ? ' ds-chip--verbatim' : ''}${lg ? ' ds-chip--lg' : ''}"`
    + (title ? ` title="${esc(title)}"` : '')
    + `>${name ? icon(name, { size: 16 }) : dot ? '<span class="ds-chip__dot"></span>' : ''}${esc(label)}</span>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   dsStat — the stat tile, number first
   ──────────────────────────────────────────────────────────────────────────
   This is the component the brief is really about. The old tile carried a
   four-line paragraph under the figure; four of them filled a 1440px viewport
   and pushed the first row of data below the fold.

   Here: label, figure, ONE terse line, and the paragraph behind an info icon in
   the corner. Nothing is lost — `note` is in the DOM either way.

   `label` and `value` are TEXT unless `valueHtml` is set. `meta` and `note` are
   HTML. `words: true` renders the value at heading size rather than figure size,
   for the case where the value is a phrase ("Not computable") — a phrase set at
   30px reads as a quantity, which is exactly the confusion this product cannot
   afford.
   ══════════════════════════════════════════════════════════════════════════ */
function dsStat({ label, value, valueHtml, meta = '', note = '', noteLabel = '', intent = '', words = false }) {
  const i = intent ? ` ds-stat--${safeIntent(intent)}` : '';
  const painted = valueHtml != null ? valueHtml : esc(String(value == null ? '' : value));
  const plain = String(painted).replace(/<[^>]*>/g, '');
  /* Same reasoning as lib/ui.js's kpi(): a long currency figure must shrink
     rather than wrap, because a KPI that wraps stops reading as one number. */
  const long = !words && plain.length > 11;
  return `<div class="ds-stat${i}">`
    + `<div class="ds-stat__label">${esc(label)}</div>`
    + `<div class="ds-stat__value${words ? ' ds-stat__value--words' : long ? ' ds-stat__value--long' : ''}">${painted}</div>`
    + (meta ? `<div class="ds-stat__meta">${meta}</div>` : '')
    + (note ? `<div class="ds-stat__foot">${dsNote(note, { label: noteLabel, cls: noteLabel ? '' : 'ds-note--corner', a11y: `What "${label}" counts, in full` })}</div>` : '')
    + '</div>';
}

const dsStatRow = html => `<div class="ds-statrow">${html}</div>`;

/* ══════════════════════════════════════════════════════════════════════════
   dsTable — a real data table
   ──────────────────────────────────────────────────────────────────────────
   cols: { label (TEXT), align: 'r' for numeric, className, width, render(row)
           -> HTML, strong }
   rows: whatever the caller has.
   opts: { empty (HTML rendered instead of an empty table), onRow (marks rows
           clickable; the caller wires them, exactly as lib/ui.js's table does),
           caption (TEXT, a screen-reader caption) }

   Numerics get `.ds-num`, which is right-aligned and tabular. The header is
   sticky. There is no zebra striping — a hairline per row is enough at 38px
   and stripes fight with the status chips for the reader's attention.
   ══════════════════════════════════════════════════════════════════════════ */
function dsTable(cols, rows, opts = {}) {
  if (!rows || !rows.length) return opts.empty || '';
  const colgroup = cols.some(c => c.width)
    ? `<colgroup>${cols.map(c => `<col${c.width ? ` style="width:${esc(String(c.width))}"` : ''}>`).join('')}</colgroup>`
    : '';
  const head = cols.map(c => `<th class="${c.align === 'r' ? 'ds-num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => {
    const tds = cols.map(c => {
      const cls = [c.align === 'r' ? 'ds-num' : '', c.strong ? 'ds-cell--strong' : '',
        c.mid ? 'ds-cell--mid' : '', c.prose ? 'ds-cell--prose' : '', c.className || ''].filter(Boolean).join(' ');
      return `<td${cls ? ` class="${cls}"` : ''}>${c.render(r, i)}</td>`;
    }).join('');
    return `<tr class="${opts.onRow ? 'ds-row--clickable' : ''}" data-i="${i}">${tds}</tr>`;
  }).join('');
  return `<div class="ds-tablewrap"><table class="ds-table">`
    + (opts.caption ? `<caption class="sr-only">${esc(opts.caption)}</caption>` : '')
    + `${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* A prose cell. `terse` and `full` are both HTML.

   THE CLAMP AND THE AFFORDANCE ARE ONE DECISION, AND THIS IS WHY.
   A first draft clamped every prose cell to two lines and attached a note only
   when `full` differed from `terse`. That is a caveat shredder: a single long
   sentence has no second sentence to demote, so it got the clamp and no
   affordance — visually truncated with nothing anywhere on the page that would
   open it. "How fast the exposed margin is being eaten, and therefore net
   margin on any unit" rendered as "…and therefore net…" and stopped.

   So the two are tied together. A cell is EITHER clamped and carries the
   affordance, OR it is not clamped and shows everything. Text is never hidden
   without a way to reach it, and a cell that fits gets no decorative icon. The
   cost is that a long single sentence takes three lines instead of two, which
   is the right side to err on. */
function dsCell(terse, full = '', noteA11y = 'Read the full note') {
  const more = full && String(full).trim() !== String(terse).trim();
  return more
    ? `<div class="ds-clamp2">${terse}</div>${dsNote(full, { a11y: noteA11y })}`
    : `<div>${terse}</div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   dsRowList — a data table whose rows expand
   ──────────────────────────────────────────────────────────────────────────
   For records that have one scannable line and a body of evidence behind them.
   Built from <details> so a row opens with no JavaScript at all, which is what
   makes it safe to put a caveat inside one.

   `template` is a CSS grid-template-columns value shared by the head strip and
   every row, so the columns line up as a <table>'s would.
   `head` is an array of TEXT labels (or { label, align }).
   `items` is an array of { cells: [HTML…], detail: HTML, open: bool }.
   ══════════════════════════════════════════════════════════════════════════ */
function dsRowList(head, items, { template = '', caption = '' } = {}) {
  if (!items || !items.length) return '';
  const style = template ? ` style="--ds-rowlist-cols:${esc(template)}"` : '';
  const headCells = head.map(h => {
    const label = typeof h === 'string' ? h : h.label;
    const align = typeof h === 'string' ? '' : h.align;
    return `<div${align === 'r' ? ' style="text-align:right"' : ''}>${esc(label || '')}</div>`;
  }).join('');
  const rows = items.map(it => `<details class="ds-row"${style}${it.open ? ' open' : ''}>`
    + `<summary>${it.cells.join('')}</summary>`
    + (it.detail ? `<div class="ds-row__detail">${it.detail}</div>` : '')
    + '</details>').join('');
  return `<div class="ds-rowlist"${caption ? ` aria-label="${esc(caption)}"` : ''}>`
    + `<div class="ds-rowlist__head"${style}>${headCells}</div>${rows}</div>`;
}

/* The evidence list inside an expanded row. `items` is
   [{ fact: HTML, source: TEXT }] — the source is a relation name and is set in
   mono at a smaller size so the fact reads first and the provenance second.
   The source is never dropped: which view produced a claim is half of what
   makes the claim checkable. */
const dsEvidence = items => `<ul class="ds-evidence">${items.map(e =>
  `<li>${e.fact}${e.source ? `<span class="ds-evidence__src">${esc(e.source)}</span>` : ''}</li>`).join('')}</ul>`;

/* A definition grid for the body of an expanded row. `pairs` is
   [[TEXT label, HTML value]], and a pair with no value is dropped rather than
   rendered as a blank — a blank beside a label reads as "nothing to say here",
   which is the failure this whole screen exists to end. */
const dsDetailGrid = pairs => `<dl class="ds-detail-grid">${pairs.filter(p => p && p[1])
  .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

/* ══════════════════════════════════════════════════════════════════════════
   dsCallout — a banner that is one line by default
   `lede` is TEXT, `body` and `note` are HTML. The lede and body stay visible;
   the note is the demoted paragraph.
   ══════════════════════════════════════════════════════════════════════════ */
function dsCallout({ intent = 'info', lede = '', body = '', note = '', noteLabel = '', name = '' } = {}) {
  const i = safeIntent(intent);
  return `<div class="ds-callout ds-callout--${i}">`
    + `<span class="ds-callout__icon">${icon(name || INTENT_ICON[i], { size: 16 })}</span>`
    + `<div class="ds-callout__body">`
    + (lede ? `<span class="ds-callout__lede">${esc(lede)}</span> ` : '')
    + body
    + (note ? dsNote(note, { label: noteLabel, a11y: lede ? `${lede} — in full` : 'Read this in full' }) : '')
    + '</div></div>';
}

/* ══════════════════════════════════════════════════════════════════════════
   dsEmpty — the one place the generous spacing lives
   `title` and `body` are TEXT; `extra` and `actions` are HTML.
   ══════════════════════════════════════════════════════════════════════════ */
function dsEmpty({ title, body = '', name = 'scan', intent = '', extra = '', actions = '' } = {}) {
  const i = intent ? ` ds-empty--${safeIntent(intent)}` : '';
  return `<div class="ds-empty${i}">`
    + `<div class="ds-empty__icon">${icon(name, { size: 20 })}</div>`
    + `<div class="ds-empty__title">${esc(title)}</div>`
    + (body ? `<div class="ds-empty__body">${esc(body)}</div>` : '')
    + extra
    + (actions ? `<div class="ds-empty__actions">${actions}</div>` : '')
    + '</div>';
}

/* ══════════════════════════════════════════════════════════════════════════
   dsSkeletonTable — a loading state shaped like the thing that is loading
   A generic bar stack tells the reader "something is happening"; a shape that
   matches the table tells them what is about to arrive, and stops the layout
   jumping when it does.
   ══════════════════════════════════════════════════════════════════════════ */
function dsSkeletonTable(rows = 6, widths = [26, 40, 14, 12]) {
  const bar = (w, h = 10) => `<div class="ds-skeleton" style="height:${h}px;width:${w}%"></div>`;
  return `<div class="ds-skeleton-table">`
    + `<div class="ds-skeleton-table__head">${widths.map(w => bar(Math.round(w * .6), 8)).join('')}</div>`
    + Array.from({ length: rows }, (_, i) =>
      `<div class="ds-skeleton-table__row">${widths.map(w => bar(Math.max(8, w - i))).join('')}</div>`).join('')
    + '</div>';
}

/* A section header for use INSIDE a panel body, where the panel's own head is
   already spoken for. `title` is TEXT; `sub` and `actions` are HTML. */
function dsSectionHead({ title, sub = '', actions = '', count = null, note = '' } = {}) {
  return `<div class="ds-sectionhead"><div class="ds-sectionhead__main">`
    + `<div class="ds-sectionhead__title">${esc(title)}`
    + (count != null ? `<span class="ds-count">${esc(String(count))}</span>` : '')
    + (note ? dsNote(note, { a11y: `${title} — in full` }) : '')
    + '</div>'
    + (sub ? `<div class="ds-sectionhead__sub">${sub}</div>` : '')
    + `</div>${actions ? `<div class="ds-sectionhead__actions">${actions}</div>` : ''}</div>`;
}

const dsToolbar = (html, { grow = '' } = {}) =>
  `<div class="ds-toolbar">${grow ? `<div class="ds-toolbar__grow">${grow}</div>` : ''}${html}</div>`;

export {
  icon,
  dsIntent, dsNote, dsChip, dsStat, dsStatRow, dsTable, dsCell,
  dsRowList, dsEvidence, dsDetailGrid, dsCallout, dsEmpty, dsSkeletonTable,
  dsSectionHead, dsToolbar,
};
