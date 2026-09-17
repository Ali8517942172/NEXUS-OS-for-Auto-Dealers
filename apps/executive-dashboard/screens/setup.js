/* NEXUS OS — screens/setup.js
   SETUP. The first screen a new dealership needs and the last one anybody
   should ever have to open.

   ═══════════════════════════════════════════════════════════════════════════
   WHAT IT IS FOR
   ═══════════════════════════════════════════════════════════════════════════
   Six things have to be true before NEXUS can do anything for a dealership.
   Until this screen existed, an owner in the middle of setting one up found out
   which of the six were done by opening every other screen and interpreting its
   empty state — and this product's empty states are, correctly, careful about
   NOT claiming that an empty table means an empty business. So the owner was
   told nothing, six times, and had to guess.

   ═══════════════════════════════════════════════════════════════════════════
   WHAT IT REFUSES TO DO
   ═══════════════════════════════════════════════════════════════════════════
   · It computes no state of its own. lib/setup.js owns all six reads and all
     six verdicts; this file paints them. A second place that decides whether
     WhatsApp is connected is a second definition of connected.
   · It never shows a step as done because the others are. Go live is the case
     that matters — nothing in this database records it — and it is rendered as
     NOT KNOWN rather than inferred from the five above it.
   · It never prints a percentage for a question nobody asked. If not one step
     could be measured there is no figure at all, because 0% would read as "you
     have done none of it" when the truth is "nothing was checked".
   · It never shows a secret. The WhatsApp panel shows, per credential, whether
     it is installed and the first eight characters of its fingerprint. The
     fingerprint is the only thing about a credential that exists to be shown;
     the credential itself is not in this bundle, not in any read this app
     makes, and not on any screen.

   ═══════════════════════════════════════════════════════════════════════════
   THE DENOMINATOR IS ON THE SCREEN
   ═══════════════════════════════════════════════════════════════════════════
   The figure is done ÷ 6, stated in those words beside it, with the count of
   steps that could not be measured next to it. A percentage whose denominator a
   reader cannot see is a percentage they cannot check, and this one has a
   second thing worth knowing: one of the six cannot be answered from this
   database at all today, so 83% is the highest it can currently read. That is
   said on the screen rather than left as a puzzle. */
import { el } from '../lib/dom.js';
import { esc, num } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { panel } from '../lib/ui.js';
import { dsCallout, dsChip, dsEvidence, dsIntent, dsNote, dsRowList, dsSectionHead, dsStat, dsStatRow }
  from '../lib/design-system.js';
/* The three words a FIGURE may be labelled with, owned by lib/vocabulary.js and
   never re-declared: the percentage tile carries one exactly as the owner strip
   on Today's Money Leaks does, and for the same reason — a number with no
   account of how it was arrived at is the thing this product does not ship. */
import { TILE_PROVENANCE, UNKNOWN_IS_NOT_ZERO } from '../lib/vocabulary.js';
import { META_CREDENTIAL, SETUP_STATE, metaCredential, readSetup, resetSetupReads } from '../lib/setup.js';

const str = v => String(v == null ? '' : v).trim();
const para = h => `<p>${h}</p>`;
const mono = v => `<span class="ds-mono">${esc(str(v))}</span>`;
const muted = h => `<div class="ds-cell-sub">${h}</div>`;

/* Same shape as the one on Today's Money Leaks, and the same rule: a button for
   a screen this bundle does not contain is a click that does nothing, so it is
   rendered disabled and says why. */
const linkBtn = (id, label) => (SCREENS[id]
  ? `<button class="btn sm" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="btn sm ghost" disabled title="${esc(label)} is not part of this build.">${esc(label)} — not in this build</button>`);
const wireGo = card => {
  card.querySelectorAll('[data-go]').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => go(b.dataset.go));
  });
};

const STATE_ICON = { DONE: 'check', INCOMPLETE: 'alert', UNKNOWN: 'question' };
const stateChip = key => {
  const s = SETUP_STATE[key];
  if (!s) return dsChip('Unstated', 'neutral', { name: 'question' });
  return dsChip(s.label, dsIntent(s.tone), { name: STATE_ICON[key], title: s.blurb });
};

const PROV_ICON = { CONFIRMED: 'check', ESTIMATED: 'alert', UNKNOWN: 'question' };
const provChip = key => {
  const p = TILE_PROVENANCE[key];
  return dsChip(p.label, dsIntent(p.tone), { name: PROV_ICON[key], title: p.blurb });
};

/* ══════════════════════════════════════════════════════════════════════════
   The strip
   ══════════════════════════════════════════════════════════════════════════ */
function strip(s) {
  const measured = s.done + s.incomplete;
  /* THE GATE, and it is the same one ownerTile() carries on Today's Money
     Leaks: a provenance of NOT KNOWN may not be given a figure, and least of
     all a nought. Nothing measured means no percentage — words, at heading
     size, so nothing in the slot can be misread as a quantity. */
  const pctTile = measured === 0
    ? dsStat({ label: 'Setup complete', value: 'Not known', words: true, intent: 'unknown',
        meta: provChip('UNKNOWN'),
        note: para(esc(UNKNOWN_IS_NOT_ZERO))
          + para('Not one of the six steps could be measured on this load, so there is no figure to show. Each step '
            + 'below says what it tried to read and why it could not.') })
    : dsStat({ label: 'Setup complete', value: `${s.pct}%`,
        intent: s.pct === 100 ? 'success' : s.done ? 'warning' : 'danger',
        meta: provChip('CONFIRMED')
          + `<span>${num(s.done)} of ${num(s.denominator)} steps done — the denominator is ${num(s.denominator)}</span>`,
        note: para(`The figure is the number of steps confirmed done divided by ${esc(String(s.denominator))}, and `
            + 'nothing else. No step is weighted, no step counts twice and no step earns part marks, so counting the '
            + 'ticks below gives the same answer.')
          + para('A step nobody could measure is not counted as done. It lowers this figure exactly as an unfinished '
            + 'one does, which is the right way round: "we could not check" must never read as progress.') });

  const doneTile = dsStat({ label: 'Confirmed done', value: num(s.done),
    intent: s.done ? 'success' : 'neutral',
    meta: `<span>of ${num(s.denominator)}</span>`,
    note: para('Each of these came back from the read named on the step itself.') });

  const openTile = dsStat({ label: 'Still to do', value: num(s.incomplete),
    intent: s.incomplete ? 'warning' : 'success',
    meta: `<span>of ${num(s.denominator)}</span>`,
    note: para('The read came back and the thing it looks for is not there. Each one names what is missing and '
      + 'where it is fixed.') });

  const unknownTile = dsStat({ label: 'Not measured', value: num(s.unknown),
    intent: s.unknown ? 'unknown' : 'success',
    meta: `<span>of ${num(s.denominator)}</span>`,
    note: para('Neither done nor outstanding: these are the steps this dashboard could not check at all. They are '
        + 'shown so that the gap is visible rather than resolved into whichever answer looks tidier.')
      + para(esc(UNKNOWN_IS_NOT_ZERO)) });

  return dsStatRow(pctTile + doneTile + openTile + unknownTile);
}

/* ══════════════════════════════════════════════════════════════════════════
   One step
   ══════════════════════════════════════════════════════════════════════════ */
function stepRow(step) {
  const s = SETUP_STATE[step.state];
  const fix = step.fix || {};
  /* Three ways a step tells the reader where it is fixed, and the third is the
     one this screen was careful to get right: a step whose work does not happen
     in NEXUS says where it DOES happen, by name, rather than offering a button
     that goes nowhere or saying nothing at all. */
  const fixHtml = step.state === 'DONE'
    ? (fix.screen ? linkBtn(fix.screen, fix.label || 'Open') : '')
    : fix.outside
      ? muted(`This step is not done in NEXUS. It is done in ${esc(str(fix.where) || 'a system that is not NEXUS')}.`)
      : fix.screen
        ? linkBtn(fix.screen, fix.label || 'Open')
        : '';

  const detail = para(esc(str(step.headline)))
    + (step.missing ? para(`<strong>What is missing.</strong> ${esc(str(step.missing))}`) : '')
    + (step.note ? para(esc(str(step.note))) : '')
    + (Array.isArray(step.evidence) && step.evidence.length
        ? dsEvidence(step.evidence.map(e => ({ fact: esc(str(e.fact)), source: str(e.source) })))
        : '')
    + (fixHtml ? `<div style="margin-top:10px">${fixHtml}</div>` : '')
    + (s ? dsNote(para(esc(s.blurb)), { label: 'What this state means' }) : '');

  return {
    cells: [
      `<div class="ds-cell--strong">${esc(str(step.title))}</div>`,
      `<div>${stateChip(step.state)}</div>`,
      `<div class="ds-clamp2">${esc(str(step.headline))}</div>`,
    ],
    detail,
    /* Open on arrival when there is something to do about it, closed when there
       is not. A reader who has three steps left should not have to click three
       times to find out what they are. */
    open: step.state === 'INCOMPLETE',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   The WhatsApp credentials
   ══════════════════════════════════════════════════════════════════════════
   The step that actually blocks a dealership, so it gets a panel of its own.

   Per registered number, per credential kind: installed or missing, and when
   installed the first eight characters of the fingerprint. The fingerprint is
   shown because it is the ONE thing that makes two installations
   distinguishable from the outside — it is how NEXUS support and a dealership
   can agree, over the phone, that the credential in the system is the one that
   was created — and it is all that exists to show. Nothing here has access to
   a secret: the read that produces this panel does not return one. */
function credentialPanel(step) {
  if (!step) return '';
  if (step.state === 'UNKNOWN') {
    return dsCallout({ intent: 'unknown', lede: 'Not known.',
      body: esc(str(step.headline)),
      note: (step.note ? para(esc(str(step.note))) : '')
        + (Array.isArray(step.evidence) ? dsEvidence(step.evidence.map(e => ({ fact: esc(str(e.fact)), source: str(e.source) }))) : ''),
      noteLabel: 'Why this could not be checked' });
  }
  const numbers = Array.isArray(step.numbers) ? step.numbers : [];
  if (!numbers.length) {
    return dsCallout({ intent: 'warning', lede: 'No number is registered.',
      body: esc(str(step.missing) || str(step.headline)),
      note: para('The three credentials below cannot exist until a number does, so none of them is shown as missing '
        + '— there is nothing for them to be missing from.')
        + `<ul>${Object.entries(META_CREDENTIAL).map(([kind, c]) =>
            `<li>${mono(kind)} — ${esc(c.label)}. ${esc(c.matters)}</li>`).join('')}</ul>`,
      noteLabel: 'What the three credentials are' });
  }
  return numbers.map(nmb => {
    const rows = nmb.credentials.map(c => {
      const known = metaCredential(c.kind);
      const installed = c.state === 'INSTALLED';
      const chip = installed
        ? dsChip('Installed', 'success', { name: 'check', title: 'This credential is installed for this number.' })
        : c.state === 'MISSING'
          ? dsChip('Missing', 'danger', { name: 'danger', title: 'This credential is not installed for this number.' })
          : dsChip(c.stateRaw || 'Unstated', 'unknown', { name: 'question', verbatim: true,
              title: 'The check reported a state this screen has no wording for, so nothing is claimed about it.' });
      return {
        cells: [
          `<div class="ds-cell--strong">${esc((known && known.label) || c.kind)}</div>`,
          `<div>${chip}</div>`,
          `<div>${installed
            ? (c.fingerprint
                ? mono(c.fingerprint)
                : `<span class="ds-cell-sub">no fingerprint in the answer</span>`)
            : '<span class="ds-cell-sub">—</span>'}</div>`,
        ],
        detail: para(mono(c.kind))
          + (known ? para(esc(known.matters)) : '')
          + (installed
              ? para(c.fingerprint
                  ? `Installed${c.installedAt ? ` on ${esc(c.installedAt)}` : ''}, fingerprint `
                    + `${mono(c.fingerprint)}. The fingerprint is eight characters derived from the credential and `
                    + 'is not the credential: it cannot be used to send, receive or sign anything. It is here so '
                    + 'that the installation in NEXUS can be matched against the one created in Meta without either '
                    + 'side reading a secret aloud.'
                  : 'This credential is installed and the answer carried no fingerprint, so none is shown rather '
                    + 'than a placeholder.')
              : para('This credential is not installed. It is created in the dealership’s own Meta Business '
                  + 'account and installed by NEXUS; nothing in this dashboard installs one, and nothing here can '
                  + 'work around its absence.'))
          + para(`<span class="ds-cell-sub">${esc(c.detail)}</span>`),
        open: !installed,
      };
    });
    const missing = nmb.missing.length;
    return dsSectionHead({
      title: `Number ${nmb.phoneNumberId}`,
      sub: missing
        ? `<span class="ds-t-danger">${num(missing)} of ${num(nmb.credentials.length)} credentials not installed</span>`
        : `All ${num(nmb.credentials.length)} credentials installed`,
      note: para('The identifier above is the number’s own id in Meta, not a phone number. It is shown because it '
        + 'is what the dealership sees in their own Meta account, so the two can be matched.'),
    }) + dsRowList(['Credential', 'State', 'Fingerprint'], rows,
      { template: 'minmax(180px,1fr) 160px minmax(120px,1fr)', caption: `Credentials for number ${nmb.phoneNumberId}` });
  }).join('');
}

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.setup = async host => {
  /* Every visit re-reads, for the reason screens/money-leaks.js records at
     length: a remembered answer to "are you set up yet" is the one answer that
     is guaranteed to be wrong the moment somebody acts on it. */
  resetSetupReads();

  const root = el('div', 'ds-screen');
  host.appendChild(root);

  panel(root, {
    title: 'Where setup stands',
    sub: 'Six steps. A step is done when the read named on it came back and found the thing; it is not done when the '
       + 'read came back and did not; and it is not known when the read could not be made at all',
    load: () => readSetup(),
    render: s => `<div style="padding:16px">${strip(s)}`
      + dsCallout({ intent: s.unknown ? 'unknown' : 'info',
          lede: `${num(s.done)} of ${num(s.denominator)} done.`,
          body: `${num(s.incomplete)} still to do and ${num(s.unknown)} that could not be measured.`,
          note: para(`The denominator is ${esc(String(s.denominator))} and it is fixed: Dealership, Team, Inventory, `
              + 'WhatsApp, Test enquiry, Go live.')
            + para('One of the six — Go live — cannot be answered from this database at all today, because nothing '
              + 'here records whether a dealership has been switched on commercially. Five of six, or 83%, is '
              + 'therefore the highest this figure can currently read, and that ceiling is a gap in what NEXUS '
              + 'records rather than work left undone by the dealership.'),
          noteLabel: 'What the six are, and why 100% is not reachable today' })
      + '</div>',
  });

  panel(root, {
    title: 'The six steps',
    sub: 'Each one says what was read, what it found, and — where there is one — the screen it is fixed on. Where '
       + 'there is not, it names where the work actually happens',
    load: () => readSetup(),
    render: s => `<div style="padding:16px">`
      + dsRowList(['Step', 'State', 'What this read found'], s.steps.map(stepRow),
          { template: 'minmax(140px,1fr) 150px minmax(240px,3fr)', caption: 'The six setup steps' })
      + '</div>',
  }).then(wireGo);

  panel(root, {
    title: 'WhatsApp',
    sub: 'The step that blocks a dealership. A number is registered in the dealership’s own Meta Business account '
       + 'and three credentials are installed against it; until all three are in, messages do not flow',
    load: () => readSetup(),
    render: s => {
      const step = s.steps.find(x => x.id === 'whatsapp');
      return `<div style="padding:16px">${credentialPanel(step)}</div>`;
    },
  }).then(wireGo);
};
