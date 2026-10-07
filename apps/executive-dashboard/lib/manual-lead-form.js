/* ==========================================================================
   Walk-in and phone-call entry — the surface that made CONNECTED true
   ==========================================================================
   Until 7 September 2026 the Lead Sources screen reported walk_in and
   phone_call as CONNECTED — the only two sources that read connected at all —
   and there was no way for a salesperson to enter one. The endpoints were
   registered, the provenance ladder existed, the promoter existed, and the
   person standing in the showroom had nowhere to type.

   THIS FORM DOES NOT WRITE TO `leads`. It calls
   rpc/nexus_lead_record_manual, which walks the same
   record → hydrate → promote path every provider lead walks, so a walk-in
   arrives with a real origin (`leads.source = walk_in`) and a `lead_event`
   behind it that says who recorded it and when. That matters beyond tidiness:
   a lead created by a direct INSERT would have no arrival, and the Leads screen
   would show it as "No arrival recorded" — the same as the legacy rows this
   whole layer exists to stop producing.

   WHAT THIS FORM DELIBERATELY CANNOT DO
   -------------------------------------
   · CHOOSE THE DEALERSHIP. It sends none. The function takes it from the
     session and refuses if the account belongs to two.
   · CHOOSE A SOURCE THAT ISN'T MANUAL. The picker offers exactly the sources
     whose delivery shape is MANUAL_ENTRY. If it offered Facebook, anybody with
     a login could manufacture attribution, and attribution is what ad spend
     gets judged against. The server refuses it too — this picker is a
     convenience, not the control.
   · SEND A PUBLIC KEY. The endpoint is resolved server-side from (dealership,
     source). A caller-supplied key is how one dealership posts into another's
     pipeline.

   THE REQUEST ID IS GENERATED ONCE, WHEN THE DIALOG OPENS, and re-sent on every
   attempt. A double-click therefore returns the SAME lead rather than making a
   second customer out of one impatient click — proved server-side, not hoped
   for here. It is deliberately NOT regenerated on a failed attempt: a refusal
   the salesperson then corrects is the same act of recording, not a new one.

   Two reps entering the same walk-in produce two leads. That is correct and is
   not a bug to fix here: they are two separate acts of recording, and merging
   two people into one row is identity resolution, a different problem. */

/* STITCH, 7 Oct 2026. The form is the "New Showroom File Intake" panel of
   design/stitch/record-a-lead-manual-floor-intake-history--e75a21.html (the
   source toggle, the three-column contact row, vehicle and budget, notes, Clear
   form / Save lead) and the "Lead successfully recorded" card of
   record-a-lead-form--78385b. It renders two ways from one template: inline on
   the Record a Lead screen (manualLeadForm) and in a dialog from the Leads
   screen (manualLeadDialog). One submit path, one request-id rule, one RPC.

   What the Stitch mocks show and this form does NOT: a live-stock vehicle
   picker (vehicle_interest is free text in the database and nothing matches it
   to a unit), an "SLA timer" (nothing starts one — the first-reply time is
   stamped by a trigger when a reply is logged), and instant desk actions
   (test-drive agreement, WhatsApp welcome pack, trade-in valuation), which are
   shown as COMING SOON on the result card rather than as buttons. */
import { db, dbWrite } from './data.js';
import { esc } from './format.js';
import { BTN, openStitchModal, statusChip } from './stitch-ui.js';

/* The idempotency key for this dialog, and it must come from a CSPRNG.
   This failed CI on main as `S2 · lib/manual-lead-form.js: invented data` —
   the gate bans the arithmetic PRNG in a screen, and the ban catches something
   real here rather than a style preference. This id is what stops a
   double-click, a flaky network or a retried save from putting the same walk-in
   into the funnel twice. The arithmetic generator is seeded per realm, so two
   tabs opened in the same millisecond are a plausible collision — and a
   collision here means two different customers share one key and the second one
   silently gets back the first one's lead.

   crypto.randomUUID() needs a secure context; the dashboard is HTTPS-only, so it
   is there in practice. The fallback is getRandomValues rather than something
   weaker, because a fallback worse than the thing it replaces is how a guarantee
   quietly stops holding on exactly the browsers nobody tests.

   And the banned call is not named literally anywhere above, including in this
   comment: the gate matches SOURCE TEXT, so a comment explaining the rule would
   trip the rule. That is worth knowing before writing the next such note. */
function mintRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;                       /* version 4  */
  b[8] = (b[8] & 0x3f) | 0x80;                       /* variant 10 */
  const h = [...b].map(x => x.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10).join('')}`;
}

/* The picker's options come from the catalogue, filtered to MANUAL_ENTRY, so a
   new manual source appears here the day it is seeded and nothing appears here
   that a person is not entitled to record. */
async function manualSources() {
  const rows = await db('lead_source_catalogue'
    + '?select=source_key,display_name,delivery_shape&delivery_shape=eq.MANUAL_ENTRY'
    + '&order=display_name.asc');
  return rows || [];
}

const FIELD = 'w-full h-10 px-3 rounded-lg bg-surface-container-low border border-outline-variant/50 font-body-md text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary';
const LABEL = 'flex items-center justify-between font-table-header text-table-header uppercase tracking-wider text-outline mb-1.5';
const HELP = 'font-body-sm text-body-sm text-on-surface-variant mt-1';
const SRC_BTN = {
  on:  'flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-container-lowest text-primary font-body-sm text-body-sm font-semibold shadow-sm',
  off: 'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-on-surface-variant hover:text-on-surface font-body-sm text-body-sm font-medium transition-colors',
};
const SRC_ICON = { walk_in: 'directions_walk', phone_call: 'call' };

/* The fields, shared by both renderings. Ids, types, maxlengths and
   placeholders are what the submit handler and the server read. */
const fieldsHtml = () => `
  <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
    <div><label class="${LABEL}" for="mlName"><span>Customer full name</span></label>
      <input id="mlName" type="text" maxlength="120" class="${FIELD}" placeholder="As they gave it">
      <p class="${HELP}">Exactly as the customer gave it.</p></div>
    <div><label class="${LABEL}" for="mlPhone"><span>Mobile phone number</span></label>
      <input id="mlPhone" type="tel" maxlength="32" class="${FIELD}" placeholder="+9715…">
      <p class="${HELP}">Phone or email — one is enough, and one is required.</p></div>
    <div><label class="${LABEL}" for="mlEmail"><span>Email address</span><span class="normal-case tracking-normal">Optional</span></label>
      <input id="mlEmail" type="email" maxlength="160" class="${FIELD}" placeholder="optional">
      <p class="${HELP}">A lead nobody can be contacted on is refused rather than filed and left to rot.</p></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
    <div class="md:col-span-2"><label class="${LABEL}" for="mlVehicle"><span>Vehicle they asked about</span><span class="normal-case tracking-normal">Optional</span></label>
      <input id="mlVehicle" type="text" maxlength="120" class="${FIELD}" placeholder="Model, trim or stock number — free text">
      <p class="${HELP}">Recorded as the customer said it. Linking an enquiry to a stock unit is not available yet.</p></div>
    <div><label class="${LABEL}" for="mlBudget"><span>Budget the customer stated (AED)</span><span class="normal-case tracking-normal">Optional</span></label>
      <input id="mlBudget" type="number" min="0" step="1000" class="${FIELD}" placeholder="optional">
      <p class="${HELP}">The customer's own figure, not a NEXUS calculation.</p></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
    <div><label class="${LABEL}" for="mlRef"><span>Your reference</span><span class="normal-case tracking-normal">Optional</span></label>
      <input id="mlRef" type="text" maxlength="80" class="${FIELD}" placeholder="floor ticket, call log id, anything you use"></div>
    <div class="md:col-span-2"><label class="${LABEL}" for="mlNotes"><span>Showroom notes</span><span class="normal-case tracking-normal">Optional</span></label>
      <textarea id="mlNotes" maxlength="400" rows="2" class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/50 font-body-md text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Trade-in, finance preference, anything the next person needs to know"></textarea></div>
  </div>`;

/* The source toggle. Rendered once the catalogue answers; until then, and if it
   fails, a sentence stands where it would be and the Save button stays off. */
function paintSources(wrap, goBtn, onPick) {
  const box = wrap.querySelector('[data-ml-sources]');
  manualSources().then(rows => {
    if (!rows.length) {
      box.innerHTML = '<span class="t-hot">No source in the catalogue can be recorded by a person, so there is nothing to file '
        + 'this under. Nothing was saved.</span>';
      return;
    }
    box.innerHTML = `<div class="flex items-center p-0.5 bg-surface-container rounded-lg" role="radiogroup" aria-label="How did they reach you">${rows.map((r, i) =>
      `<button type="button" role="radio" data-src="${esc(r.source_key)}" aria-checked="${i === 0}" class="${i === 0 ? SRC_BTN.on : SRC_BTN.off}">
         <span class="material-symbols-outlined text-[16px]">${esc(SRC_ICON[r.source_key] || 'edit_note')}</span>${esc(r.display_name || r.source_key)}</button>`).join('')}</div>`;
    wrap.dataset.source = rows[0].source_key;
    box.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', () => {
      wrap.dataset.source = b.dataset.src;
      box.querySelectorAll('[data-src]').forEach(x => {
        const on = x === b; x.className = on ? SRC_BTN.on : SRC_BTN.off; x.setAttribute('aria-checked', String(on));
      });
      if (onPick) onPick(b.dataset.src);
    }));
    goBtn.disabled = false;
  }).catch(e => {
    /* Named, not swallowed: a disabled button with no sentence beside it reads
       as a broken screen; this reads as a question that could not be asked. */
    box.innerHTML = `<span class="t-hot">The list of sources could not be read (${esc(e.message || String(e))}), so this form
       cannot say what it would be filing. Nothing was saved.</span>`;
  });
}

/* One submit, shared. `requestId()` is read at submit time so a caller can
   re-mint it after a success; it is NOT re-minted after a refusal, because a
   refusal the salesperson then corrects is the same act of recording. */
async function submit(wrap, goBtn, requestId, say, onSaved) {
  const $$ = s => wrap.querySelector(s);
  const budget = ($$('#mlBudget').value || '').trim();
  goBtn.disabled = true;
  say('<span class="t-muted">Recording…</span>');
  try {
    const rows = await dbWrite('POST', 'rpc/nexus_lead_record_manual', {
      p_source_key:         wrap.dataset.source || null,
      p_client_request_id:  requestId(),
      p_full_name:          ($$('#mlName').value || '').trim(),
      p_phone_e164:         ($$('#mlPhone').value || '').trim() || null,
      p_email:              ($$('#mlEmail').value || '').trim() || null,
      p_vehicle_interest:   ($$('#mlVehicle').value || '').trim() || null,
      p_budget_aed:         budget === '' ? null : Number(budget),
      p_operator_reference: ($$('#mlRef').value || '').trim() || null,
      p_notes:              ($$('#mlNotes').value || '').trim() || null,
    });
    const r = Array.isArray(rows) ? rows[0] : rows;
    /* was_duplicate is reported rather than hidden: a rep who clicked twice
       should see that the second click did nothing, not a second "Saved". */
    say(r && r.was_duplicate
      ? `<span class="t-ok">Already recorded — this is lead ${esc(String(r.lead_id))}, not a second one.</span>`
      : `<span class="t-ok">Recorded as lead ${esc(String(r && r.lead_id))}.</span>`);
    if (typeof onSaved === 'function') onSaved(r);
    return r;
  } catch (e) {
    /* The server's refusals are written for a salesperson and carry the next
       step in their own text, so they are shown as they arrive. */
    say(`<span class="t-hot">${esc(e.message || String(e))}</span>`);
    goBtn.disabled = false;
    return null;
  }
}

/* Inline, on the Record a Lead screen. Returns { reset } so the screen can
   clear it. `onSaved(row)` gets { lead_id, was_duplicate, ... } as returned. */
function manualLeadForm(host, { onSaved } = {}) {
  let reqId = mintRequestId();
  host.innerHTML = `<section class="rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm" data-ml-form>
    <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between gap-space-sm flex-wrap">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-9 h-9 rounded-lg bg-primary-container text-on-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">edit_note</span></div>
        <div class="min-w-0">
          <div class="font-headline-md text-headline-md text-on-surface">New walk-in or phone-call record</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant">Recorded as your word that this enquiry happened, with your name and the time on it.</div>
        </div>
      </div>
      <div data-ml-sources class="ds-cell-sub">Loading the sources a person may record…</div>
    </div>
    <div class="p-space-md flex flex-col gap-space-md">
      ${fieldsHtml()}
      <div class="flex items-center justify-between gap-3 flex-wrap pt-space-sm border-t border-outline-variant/30">
        <div class="font-body-sm text-body-sm text-on-surface-variant" data-ml-msg aria-live="polite">It arrives on the Leads screen with a real origin, not as a lead nobody can place.</div>
        <div class="flex items-center gap-2">
          <button type="button" class="${BTN.secondary}" data-ml-clear>Clear form</button>
          <button type="button" class="${BTN.primary}" data-ml-go disabled><span class="material-symbols-outlined text-[18px]">task_alt</span>Save lead</button>
        </div>
      </div>
    </div>
  </section>`;
  const wrap = host.querySelector('[data-ml-form]');
  const goBtn = wrap.querySelector('[data-ml-go]');
  const say = html => { wrap.querySelector('[data-ml-msg]').innerHTML = html; };
  paintSources(wrap, goBtn);
  const reset = () => {
    wrap.querySelectorAll('input,textarea').forEach(i => { i.value = ''; });
    reqId = mintRequestId();      /* a cleared form is a new act of recording */
    goBtn.disabled = !wrap.dataset.source;
  };
  wrap.querySelector('[data-ml-clear]').addEventListener('click', () => { reset(); say('Cleared. Nothing was saved.'); });
  goBtn.addEventListener('click', async () => {
    const r = await submit(wrap, goBtn, () => reqId, say, null);
    if (r) {
      /* Saved: the next person through the door is a new act, so the form is
         emptied and the id re-minted only now, after the database answered. */
      wrap.querySelectorAll('input,textarea').forEach(i => { i.value = ''; });
      reqId = mintRequestId();
      goBtn.disabled = false;
      if (typeof onSaved === 'function') onSaved(r);
    }
  });
  return { reset };
}

/* In a dialog, from the Leads screen. One id for the life of the dialog. */
function manualLeadDialog(onSaved) {
  const requestId = mintRequestId();
  const m = openStitchModal({
    title: 'Record a lead by hand',
    wide: true,
    bodyHtml: `<div class="flex flex-col gap-space-md" data-ml-form>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <p class="font-body-sm text-body-sm text-on-surface-variant max-w-md">For the customer who walked in or telephoned. It is recorded as
          <strong>your word</strong> that this enquiry happened — which is exactly what it is — and it shows on the Leads
          screen with that origin rather than as a lead nobody can place.</p>
        <div data-ml-sources class="ds-cell-sub">Loading the sources a person may record…</div>
      </div>
      ${fieldsHtml()}
    </div>`,
    footHtml: `<button type="button" class="${BTN.secondary}" id="mlCancel">Cancel</button>
      <button type="button" class="${BTN.primary}" id="mlGo" disabled>Record this lead</button>`,
  });
  const wrap = m.wrap.querySelector('[data-ml-form]');
  const goBtn = m.wrap.querySelector('#mlGo');
  m.wrap.querySelector('#mlCancel').addEventListener('click', () => m.close());
  paintSources(wrap, goBtn);
  goBtn.addEventListener('click', () => submit(wrap, goBtn, () => requestId, m.msg, onSaved));
  return m;
}

/* The result card (record-a-lead-form--78385b, right column), for the screen
   to place beside the form. Instant desk actions are COMING SOON. */
function recordedCard(r) {
  if (!r) return '';
  return `<section class="rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm">
    <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between gap-2">
      <div class="flex items-center gap-3">
        <span class="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center"><span class="material-symbols-outlined text-[18px]">check</span></span>
        <div><div class="font-headline-md text-headline-md text-on-surface">${r.was_duplicate ? 'Already on file' : 'Lead recorded'}</div>
          <div class="font-table-header text-table-header uppercase tracking-wider text-outline">${r.was_duplicate ? 'The same request was sent twice — no second lead' : 'Filed with its origin'}</div></div>
      </div>
      <span class="px-2 py-0.5 rounded bg-surface-container-highest font-label-numeric-sm text-label-numeric-sm font-bold text-primary">#${esc(String(r.lead_id))}</span>
    </div>
    <div class="p-space-md flex flex-col gap-3">
      <div class="flex items-center gap-2 flex-wrap">
        <button type="button" class="${BTN.primary}" data-open-recorded="${esc(String(r.lead_id))}"><span class="material-symbols-outlined text-[18px]">open_in_new</span>Open lead</button>
        <button type="button" class="${BTN.secondary}" data-screen-link="leads">Go to Leads</button>
      </div>
      <div class="font-table-header text-table-header uppercase tracking-wider text-outline">Instant desk actions</div>
      <div class="flex flex-col gap-1.5">
        ${['Print test-drive agreement', 'Send WhatsApp welcome pack', 'Start a trade-in valuation'].map(t =>
          `<div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-container-low"><span class="font-body-sm text-body-sm text-on-surface-variant">${esc(t)}</span>${statusChip('coming-soon')}</div>`).join('')}
      </div>
    </div>
  </section>`;
}

export { manualLeadDialog, manualLeadForm, recordedCard };
