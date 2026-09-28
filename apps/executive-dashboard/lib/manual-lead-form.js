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
import { db, dbWrite } from './data.js';
import { esc } from './format.js';
import { openModal } from './modal.js';

/* The picker's options come from the catalogue, filtered to MANUAL_ENTRY, so a
   new manual source appears here the day it is seeded and nothing appears here
   that a person is not entitled to record. */
async function manualSources() {
  const rows = await db('lead_source_catalogue'
    + '?select=source_key,display_name,delivery_shape&delivery_shape=eq.MANUAL_ENTRY'
    + '&order=display_name.asc');
  return rows || [];
}

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

function manualLeadDialog(onSaved) {
  /* One id for the life of this dialog. See the note above about why it is not
     regenerated after a refusal. */
  const requestId = mintRequestId();

  /* `.form-stack` / `.frow` / `.field` come from lib/theme-forms.css. Every
     `style="…"` this template used to carry lives there now; the ids, the
     types, the maxlengths and the placeholders are untouched, because those are
     what the submit handler and the server read. */
  const m = openModal('Add a lead by hand', `
    <div class="form-stack">
      <div class="cell-sub">
        For the customer who walked in or telephoned. It is recorded as
        <strong>your word</strong> that this enquiry happened — which is exactly what it is — and it will show on the
        Leads screen with that origin rather than as a lead nobody can place.
      </div>
      <div id="mlSourceWrap" class="field cell-sub">Loading the sources a person may record…</div>
      <div class="field">
        <label for="mlName">Name</label>
        <input id="mlName" type="text" maxlength="120" placeholder="As they gave it">
      </div>
      <div class="frow">
        <div class="field">
          <label for="mlPhone">Phone</label>
          <input id="mlPhone" type="tel" maxlength="32" placeholder="+9715…">
        </div>
        <div class="field">
          <label for="mlEmail">Email</label>
          <input id="mlEmail" type="email" maxlength="160" placeholder="optional">
        </div>
        <div class="cell-sub frow-note">
          One of the two is enough, and one of the two is required — a lead nobody can be contacted on is refused rather
          than filed and left to rot.
        </div>
      </div>
      <div class="frow">
        <div class="field">
          <label for="mlVehicle">Vehicle they asked about</label>
          <input id="mlVehicle" type="text" maxlength="120" placeholder="optional">
        </div>
        <div class="field">
          <label for="mlBudget">Budget (AED)</label>
          <input id="mlBudget" type="number" min="0" step="1000" placeholder="optional">
        </div>
      </div>
      <div class="field">
        <label for="mlRef">Your reference (optional)</label>
        <input id="mlRef" type="text" maxlength="80" placeholder="floor ticket, call log id, anything you use">
      </div>
      <div class="field">
        <label for="mlNotes">Notes (optional)</label>
        <input id="mlNotes" type="text" maxlength="400">
      </div>
    </div>
  `, `<button class="btn primary" id="mlGo" disabled>Record this lead</button>
      <button class="btn" id="mlCancel">Cancel</button>`);

  const $$ = id => m.wrap.querySelector(id);
  $$('#mlCancel').addEventListener('click', () => m.close());

  manualSources().then(rows => {
    if (!rows.length) {
      $$('#mlSourceWrap').innerHTML =
        '<span class="t-hot">No source in the catalogue can be recorded by a person, so there is nothing to file '
        + 'this under. Nothing was saved.</span>';
      return;
    }
    $$('#mlSourceWrap').innerHTML =
      `<label for="mlSource">How did they reach you</label>
       <select id="mlSource">${rows.map(r =>
         `<option value="${esc(r.source_key)}">${esc(r.display_name || r.source_key)}</option>`).join('')}</select>`;
    $$('#mlGo').disabled = false;
  }).catch(e => {
    /* Named, not swallowed. A disabled button with no sentence beside it reads
       as a broken screen; this reads as a question that could not be asked. */
    $$('#mlSourceWrap').innerHTML =
      `<span class="t-hot">The list of sources could not be read (${esc(e.message || String(e))}), so this form
       cannot say what it would be filing. Nothing was saved.</span>`;
  });

  $$('#mlGo').addEventListener('click', async () => {
    const go = $$('#mlGo');
    const budget = ($$('#mlBudget').value || '').trim();
    go.disabled = true;
    m.msg('Recording…');
    try {
      const rows = await dbWrite('POST', 'rpc/nexus_lead_record_manual', {
        p_source_key:         $$('#mlSource') ? $$('#mlSource').value : null,
        p_client_request_id:  requestId,
        p_full_name:          ($$('#mlName').value || '').trim(),
        p_phone_e164:         ($$('#mlPhone').value || '').trim() || null,
        p_email:              ($$('#mlEmail').value || '').trim() || null,
        p_vehicle_interest:   ($$('#mlVehicle').value || '').trim() || null,
        p_budget_aed:         budget === '' ? null : Number(budget),
        p_operator_reference: ($$('#mlRef').value || '').trim() || null,
        p_notes:              ($$('#mlNotes').value || '').trim() || null,
      });
      const r = Array.isArray(rows) ? rows[0] : rows;
      /* was_duplicate is reported rather than hidden. A rep who clicked twice
         should see that the second click did nothing, not a second "Saved". */
      m.msg(r && r.was_duplicate
        ? `<span class="t-ok">Already recorded — this is lead ${esc(String(r.lead_id))}, not a second one.</span>`
        : `<span class="t-ok">Recorded as lead ${esc(String(r && r.lead_id))}.</span>`);
      if (typeof onSaved === 'function') onSaved(r);
    } catch (e) {
      /* The server's refusals are written for a salesperson and carry the next
         step in their own text, so they are shown as they arrive rather than
         being re-worded here. */
      m.msg(`<span class="t-hot">${esc(e.message || String(e))}</span>`);
      go.disabled = false;
    }
  });

  return m;
}

export { manualLeadDialog };
