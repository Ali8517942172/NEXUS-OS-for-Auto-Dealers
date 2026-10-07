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
/* 7 Oct 2026 — the Stitch layout: design/stitch/setup-dealership-configuration-
   verification--382282.html. Four tiles (steps done of six, confirmed, still
   to do, not measured), the readiness strip, the six numbered configuration
   modules with their state chip and fix button, a right-hand column, and the
   WhatsApp credential table. What the export has and this screen deliberately
   does not draw: "Dry run diagnostics" / "Commit configuration" (no such
   operation exists), "Estimated recovery velocity AED …/month" (no figure in
   NEXUS supports it — CLAUDE.md, never fabricate a monetary impact) and the
   deployment-topology card (infrastructure is the vendor's, not the
   dealership's — CONTROL-PLANE.md). The right-hand "post-setup" column says
   what is true: what each state word means, and that Go live is not recorded
   anywhere. Every state, figure and sentence still comes from lib/setup.js. */
import { ME, SESSION } from '../lib/data.js';
import { dubaiStamp, esc, num } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { BTN, sectionHeader, statusChip, emptyState, errorState, skeleton, trustFooter } from '../lib/stitch-ui.js';
/* The three words a FIGURE may be labelled with, owned by lib/vocabulary.js and
   never re-declared: the percentage tile carries one exactly as the owner strip
   on Today's Money Leaks does, and for the same reason — a number with no
   account of how it was arrived at is the thing this product does not ship. */
import { TILE_PROVENANCE, UNKNOWN_IS_NOT_ZERO } from '../lib/vocabulary.js';
import { META_CREDENTIAL, SETUP_STATE, metaCredential, readSetup, resetSetupReads } from '../lib/setup.js';

const str = v => String(v == null ? '' : v).trim();

/* Same shape as the one on Today's Money Leaks, and the same rule: a button for
   a screen this bundle does not contain is a click that does nothing, so it is
   rendered disabled and says why. */
const linkBtn = (id, label) => (SCREENS[id]
  ? `<button type="button" class="${BTN.secondary}" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button type="button" class="${BTN.secondary}" disabled title="${esc(label)} is not part of this build.">${esc(label)} — not in this build</button>`);

const STATE_CHIP = { DONE: 'live', INCOMPLETE: 'blocked', UNKNOWN: 'not-tested' };
const STATE_WORD = { DONE: 'Confirmed done', INCOMPLETE: 'Attention required', UNKNOWN: 'Not known' };
const stateChip = key => statusChip(STATE_CHIP[key] || 'not-tested', STATE_WORD[key] || 'Unstated');
const PROV_CHIP = { CONFIRMED: 'live', ESTIMATED: 'partial', UNKNOWN: 'not-tested' };
const provChip = key => statusChip(PROV_CHIP[key], TILE_PROVENANCE[key].label);

/* The module card: three looks, each a complete class string. */
const MOD = {
  DONE:       { box: 'rounded-xl bg-surface-container-lowest p-space-md shadow-sm flex gap-space-md', num: 'w-10 h-10 rounded-lg bg-surface-container-low text-primary flex items-center justify-center font-label-numeric-md text-label-numeric-md font-bold shrink-0', miss: 'font-body-sm text-body-sm text-on-surface-variant' },
  INCOMPLETE: { box: 'rounded-xl bg-surface-container-lowest p-space-md shadow-sm flex gap-space-md border-2 border-red-200', num: 'w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center font-label-numeric-md text-label-numeric-md font-bold shrink-0', miss: 'font-body-sm text-body-sm text-red-700' },
  UNKNOWN:    { box: 'rounded-xl bg-surface-container-lowest p-space-md shadow-sm flex gap-space-md border border-dashed border-outline-variant', num: 'w-10 h-10 rounded-lg bg-surface-container text-outline flex items-center justify-center font-label-numeric-md text-label-numeric-md font-bold shrink-0', miss: 'font-body-sm text-body-sm text-on-surface-variant' },
};
const DETAIL = { closed: 'hide', open: 'mt-space-sm pt-space-sm border-t border-outline-variant/30 flex flex-col gap-space-sm' };

const tile = (label, icon, iconCls, valueHtml, unit, subHtml, footHtml) => `<div class="rounded-xl bg-surface-container-lowest p-space-md shadow-sm flex flex-col gap-space-sm">
    <div class="flex items-center justify-between"><span class="font-table-header text-table-header uppercase tracking-wider text-on-surface-variant font-semibold">${label}</span>
      <span class="material-symbols-outlined text-[22px] ${iconCls}">${icon}</span></div>
    <div class="flex items-baseline gap-2"><span class="font-label-numeric-lg text-[2.25rem] leading-none font-bold text-on-surface">${valueHtml}</span>${unit ? `<span class="font-label-numeric-md text-label-numeric-md text-on-surface-variant">${unit}</span>` : ''}</div>
    <div class="font-body-sm text-body-sm text-on-surface-variant">${subHtml}</div>
    ${footHtml || ''}
  </div>`;

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
    ? tile('Setup complete', 'help', 'text-outline', 'Not known', '', `${esc(UNKNOWN_IS_NOT_ZERO)} Not one of the six steps could be measured on this load.`, `<div>${provChip('UNKNOWN')}</div>`)
    : tile('Core progress', 'task_alt', 'text-primary', esc(String(s.done)), `/ ${esc(String(s.denominator))} steps`,
        `${esc(String(s.pct))}% — steps confirmed done divided by ${esc(String(s.denominator))}, nothing else. A step nobody could measure is not counted as done.`,
        `<div class="flex items-center gap-2">${provChip('CONFIRMED')}</div>`);
  return `<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
    ${pctTile}
    ${tile('Confirmed done', 'verified', 'text-[#157a5b]', esc(num(s.done)), `of ${esc(num(s.denominator))}`, 'Each of these came back from the read named on the step itself.')}
    ${tile('Still to do', 'warning', s.incomplete ? 'text-red-700' : 'text-outline', esc(num(s.incomplete)), `of ${esc(num(s.denominator))}`, 'The read came back and the thing it looks for is not there. Each one names what is missing and where it is fixed.')}
    ${tile('Not measured', 'history', 'text-outline', esc(num(s.unknown)), `of ${esc(num(s.denominator))}`, 'Neither done nor outstanding: steps this dashboard could not check at all, shown so the gap stays visible.')}
  </div>`;
}

function healthBanner(s) {
  const measured = s.done + s.incomplete;
  const pct = measured === 0 ? null : s.pct;
  return `<div class="rounded-xl bg-surface-container-lowest p-space-md shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
    <div class="flex items-start gap-space-md">
      <div class="w-12 h-12 rounded-xl bg-primary-container/10 text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[26px]">speed</span></div>
      <div><div class="flex items-center gap-2 flex-wrap"><span class="font-headline-md text-headline-md font-semibold text-on-surface">Where setup stands</span>
          <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container text-primary font-bold">${esc(num(s.done))} OF ${esc(num(s.denominator))} DONE</span></div>
        <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(num(s.incomplete))} still to do and ${esc(num(s.unknown))} that could not be measured. The six are fixed: Dealership, Team, Inventory, WhatsApp, Test enquiry, Go live. Go live cannot be answered from this database at all today, so 5 of 6 (83%) is the highest this can currently read — a gap in what NEXUS records, not work left undone.</p></div>
    </div>
    <div class="w-full lg:w-72 shrink-0">
      <div class="flex items-center justify-between font-label-numeric-sm text-label-numeric-sm text-on-surface"><span>Steps done</span><span class="text-primary font-bold">${pct == null ? '—' : `${esc(String(pct))}%`}</span></div>
      <div class="mt-1 h-2 rounded-full bg-surface-container overflow-hidden flex">${Array.from({ length: s.denominator }, (_, i) => `<div class="${i < s.done ? 'flex-1 bg-primary border-r border-surface-container-lowest' : 'flex-1 border-r border-surface-container-lowest'}"></div>`).join('')}</div>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   One step
   ══════════════════════════════════════════════════════════════════════════ */
function stepCard(step, i) {
  const s = SETUP_STATE[step.state];
  const m = MOD[step.state] || MOD.UNKNOWN;
  const fix = step.fix || {};
  /* Three ways a step tells the reader where it is fixed, and the third is the
     one this screen was careful to get right: a step whose work does not happen
     in NEXUS says where it DOES happen, by name, rather than offering a button
     that goes nowhere or saying nothing at all. */
  const fixHtml = step.state === 'DONE'
    ? (fix.screen ? linkBtn(fix.screen, fix.label || 'Open') : '')
    : fix.outside
      ? `<span class="font-body-sm text-body-sm text-on-surface-variant max-w-[14rem]">Done outside NEXUS, in ${esc(str(fix.where) || 'a system that is not NEXUS')}.</span>`
      : fix.screen
        ? `<button type="button" class="${BTN.primary}" data-go="${esc(fix.screen)}"${SCREENS[fix.screen] ? '' : ' disabled'}>${esc(fix.label || 'Open')}</button>`
        : '';
  const evidence = Array.isArray(step.evidence) ? step.evidence : [];
  /* Open on arrival when there is something to do about it, closed when there
     is not. A reader who has three steps left should not have to click three
     times to find out what they are. */
  const open = step.state === 'INCOMPLETE';
  return `<div class="${m.box}">
    <div class="${m.num}">${String(i + 1).padStart(2, '0')}</div>
    <div class="flex-1 min-w-0">
      <div class="flex items-start justify-between gap-space-md">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap"><span class="font-headline-md text-headline-md font-semibold text-on-surface">${esc(str(step.title))}</span>${stateChip(step.state)}</div>
          <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(str(step.headline))}</p>
          ${step.missing ? `<p class="${m.miss} mt-1">Missing: ${esc(str(step.missing))}</p>` : ''}
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">${fixHtml}
          <button type="button" class="${BTN.tertiary}" data-detail="${i}" aria-expanded="${open}">${open ? 'Hide detail' : 'Show detail'}</button></div>
      </div>
      <div class="${open ? DETAIL.open : DETAIL.closed}" data-detail-body="${i}">
        ${step.note ? `<p class="font-body-sm text-body-sm text-on-surface">${esc(str(step.note))}</p>` : ''}
        ${evidence.length ? `<div class="flex flex-col gap-1">${evidence.map(e => `<div class="flex flex-wrap items-baseline gap-x-2 font-body-sm text-body-sm"><span class="text-on-surface">${esc(str(e.fact))}</span><span class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(str(e.source))}</span></div>`).join('')}</div>` : ''}
        ${s ? `<p class="font-body-sm text-body-sm text-on-surface-variant"><span class="font-semibold text-on-surface">What this state means.</span> ${esc(s.blurb)}</p>` : ''}
      </div>
    </div>
  </div>`;
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
const CRED_ROW = { ok: 'h-11 hover:bg-surface-container-low transition-colors', bad: 'h-11 bg-red-50/40 hover:bg-red-50 transition-colors' };
function credentialPanel(step) {
  if (!step) return emptyState({ icon: 'chat', title: 'The WhatsApp step was not returned', body: 'lib/setup.js answered without a WhatsApp step, so nothing is claimed about the credentials.' });
  if (step.state === 'UNKNOWN') {
    return `<div class="p-space-md flex items-start gap-3"><span class="material-symbols-outlined text-outline">help</span><div class="flex flex-col gap-1">
      <span class="font-body-md text-body-md font-semibold text-on-surface">Not known. ${esc(str(step.headline))}</span>
      ${step.note ? `<span class="font-body-sm text-body-sm text-on-surface-variant">${esc(str(step.note))}</span>` : ''}
      ${(Array.isArray(step.evidence) ? step.evidence : []).map(e => `<span class="font-body-sm text-body-sm text-on-surface-variant">${esc(str(e.fact))} <span class="font-label-numeric-sm text-outline">${esc(str(e.source))}</span></span>`).join('')}</div></div>`;
  }
  const numbers = Array.isArray(step.numbers) ? step.numbers : [];
  if (!numbers.length) {
    return `<div class="p-space-md flex flex-col gap-space-sm">
      <div class="flex items-start gap-3"><span class="material-symbols-outlined text-amber-700">warning</span><div>
        <div class="font-body-md text-body-md font-semibold text-on-surface">No number is registered.</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(str(step.missing) || str(step.headline))} The three credentials below cannot exist until a number does, so none of them is shown as missing — there is nothing for them to be missing from.</div></div></div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-space-sm">${Object.entries(META_CREDENTIAL).map(([kind, c]) => `<div class="p-space-sm rounded-lg bg-surface-container-low">
        <div class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(kind)}</div><div class="font-body-sm text-body-sm font-semibold text-on-surface">${esc(c.label)}</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(c.matters)}</div></div>`).join('')}</div></div>`;
  }
  const rows = numbers.flatMap(nmb => nmb.credentials.map(c => {
    const known = metaCredential(c.kind);
    const installed = c.state === 'INSTALLED';
    const chip = installed ? statusChip('live', 'Installed')
      : c.state === 'MISSING' ? statusChip('blocked', 'Missing')
        : statusChip('not-tested', c.stateRaw || 'Unstated');
    return `<tr class="${installed ? CRED_ROW.ok : CRED_ROW.bad}" title="${esc(c.detail || '')}">
      <td class="px-4 font-label-numeric-sm text-label-numeric-sm text-on-surface">${esc(nmb.phoneNumberId)}</td>
      <td class="px-4"><div class="font-body-sm text-body-sm font-semibold text-on-surface">${esc((known && known.label) || c.kind)}</div><div class="font-label-numeric-sm text-[11px] text-outline">${esc(c.kind)}</div></td>
      <td class="px-4">${chip}</td>
      <td class="px-4 font-label-numeric-sm text-label-numeric-sm">${installed ? (c.fingerprint ? esc(c.fingerprint) : '<span class="text-outline">no fingerprint in the answer</span>') : '—'}</td>
      <td class="px-4 font-body-sm text-body-sm text-on-surface-variant">${installed ? esc(c.installedAt || '—') : 'Created in the dealership’s Meta account, installed by NEXUS'}</td></tr>`;
  })).join('');
  return `<div class="overflow-x-auto"><table class="w-full text-left border-collapse">
    <thead><tr class="bg-surface-container-low border-b border-outline-variant/30 text-outline font-table-header text-table-header uppercase">
      <th class="py-3 px-4">Number id (Meta)</th><th class="py-3 px-4">Credential</th><th class="py-3 px-4">State</th><th class="py-3 px-4">Fingerprint</th><th class="py-3 px-4">Installed</th></tr></thead>
    <tbody class="divide-y divide-outline-variant/20 font-body-sm text-body-sm text-on-surface">${rows}</tbody></table></div>
    <div class="px-space-md py-2.5 bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined text-[16px] text-outline">shield</span>
      The id is the number’s own id in Meta, not a phone number. A fingerprint is eight characters derived from a credential, never the credential: it cannot send, receive or sign anything.</div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.setup = async host => {
  /* Every visit re-reads, for the reason screens/money-leaks.js records at
     length: a remembered answer to "are you set up yet" is the one answer that
     is guaranteed to be wrong the moment somebody acts on it. */
  resetSetupReads();
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">
    ${sectionHeader({ eyebrow: 'Account · Setup', title: 'Dealership Setup & Onboarding',
      sub: 'Six steps. A step is done when the read named on it came back and found the thing; not done when the read came back and did not; and not known when the read could not be made at all.',
      actionsHtml: `<button type="button" class="${BTN.secondary}" data-recheck><span class="material-symbols-outlined text-[18px]">refresh</span><span class="whitespace-nowrap">Re-check all six</span></button>` })}
    <div data-s="body">${skeleton({ rows: 4 })}</div>
  </div>`;
  const root = host.firstElementChild;
  root.querySelector('[data-recheck]').addEventListener('click', () => go('setup'));
  const slot = root.querySelector('[data-s="body"]');

  let s;
  try { s = await readSetup(); } catch (e) {
    slot.innerHTML = errorState({ what: 'setup', err: e, retry: 'setup' });
    slot.querySelector('[data-retry]')?.addEventListener('click', () => go('setup'));
    return;
  }
  const steps = Array.isArray(s.steps) ? s.steps : [];
  const wa = steps.find(x => x.id === 'whatsapp');
  const golive = steps.find(x => x.id === 'golive' || /go live/i.test(str(x.title)));
  slot.innerHTML = `<div class="flex flex-col gap-space-md">
    ${strip(s)}
    ${healthBanner(s)}
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-space-md">
      <div class="xl:col-span-8 flex flex-col gap-space-sm">
        <div class="flex items-center justify-between px-1"><div class="flex items-center gap-2"><span class="font-headline-md text-headline-md font-semibold text-on-surface">Configuration steps</span>
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(num(s.denominator))} STEP PROTOCOL</span></div></div>
        ${steps.map(stepCard).join('')}
      </div>
      <div class="xl:col-span-4 flex flex-col gap-space-md">
        <div class="rounded-xl bg-surface-container-lowest p-space-md shadow-sm flex flex-col gap-space-sm">
          <div class="flex items-center gap-2"><div class="w-8 h-8 rounded-lg bg-primary-container text-on-primary flex items-center justify-center"><span class="material-symbols-outlined text-[18px]">shield</span></div>
            <div><div class="font-headline-md text-headline-md font-semibold text-on-surface">After setup</div><div class="font-body-sm text-body-sm text-outline">What is and is not recorded</div></div></div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">Go live — the dealership being switched on commercially — is not recorded anywhere in this database, so this screen can never show it as done. It is shown as ${golive ? esc(STATE_WORD[golive.state] || 'not known').toLowerCase() : 'not known'} rather than inferred from the steps above it.</p>
          ${Object.entries(SETUP_STATE).map(([k, v]) => `<div class="p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1"><div>${stateChip(k)}</div><span class="font-body-sm text-body-sm text-on-surface-variant">${esc(v.blurb)}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <section class="rounded-xl bg-surface-container-lowest shadow-sm overflow-hidden">
      <div class="px-space-md py-3 flex items-start justify-between gap-space-sm">
        <div><div class="flex items-center gap-2 flex-wrap"><span class="font-headline-md text-headline-md font-semibold text-on-surface">WhatsApp Business numbers — credential install state</span>
          ${wa ? stateChip(wa.state) : ''}</div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">The step that blocks a dealership. A number is registered in the dealership’s own Meta Business account and three credentials are installed against it; until all three are in, messages do not flow.</p></div>
      </div>
      ${credentialPanel(wa)}
    </section>
    ${trustFooter({ source: 'lib/setup.js — six reads', asOf: dubaiStamp(new Date().toISOString()), evidence: `${num(s.done)} done · ${num(s.incomplete)} to do · ${num(s.unknown)} not measured`,
      actor: (ME && (ME.name || ME.email)) || (SESSION && SESSION.user && SESSION.user.email) || null })}
  </div>`;
  slot.querySelectorAll('[data-go]').forEach(b => { if (!b.disabled) b.addEventListener('click', () => go(b.dataset.go)); });
  slot.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => {
    const body = slot.querySelector(`[data-detail-body="${b.dataset.detail}"]`);
    const open = body.className === DETAIL.closed;
    body.className = open ? DETAIL.open : DETAIL.closed;
    b.textContent = open ? 'Hide detail' : 'Show detail';
    b.setAttribute('aria-expanded', String(open));
  }));
};
