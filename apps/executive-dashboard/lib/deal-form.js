/* NEXUS OS — lib/deal-form.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { HOOK, n8n } from './data.js';
import { $ } from './dom.js';
import { esc } from './format.js';
/* The shared contact rule. This file used to ask `l.email` — a truthy test on a
   text column — which is not the same question as "do we know who this is". See
   pickableLeads() below. Nothing about identity is decided here; the three
   imports are the whole of it. */
import { KEY_SHAPE, expandIdentity, keyShape } from './identity.js';
import { modalError, openModal } from './modal.js';

/* ── Who the picker may offer, and under what key ──────────────────────────
   1 Sep 2026. The list was built as `leads.filter(l => l.email)`.

   Counted live against the database before this was written, not inferred:

     select id, name, email, phone from leads   ->  3 rows
       34  Siva Thangavelu      +971547484167@whatsapp.lead   +971547484167
       35  Effco Contracting llc  ''  (the EMPTY STRING)       +971505433953
       38  Ali                  shabbir53ujjainwala@gmail.com  +918517942172

   Lead 35 holds `''`, not null. `''` is falsy, so a real customer with a real
   number was dropped from the picker with nothing on screen to say a lead had
   been withheld. And lead 34 was being OFFERED as though its column held an
   email address, which it does not — `+971547484167@whatsapp.lead` is a key the
   workflows synthesise from a phone number. One test got both wrong in opposite
   directions, because a non-empty string is not evidence of anything.

   The test is now the shared one: does lib/identity.js resolve this row to a
   person, and what is the strongest key it is filed under. `expandIdentity`
   returns the real address where there is one and, where there is not, the
   `@whatsapp.lead` spelling of the known number — the shape the WORKFLOWS write
   and the shape identity.js resolves back to the same person by the
   last-nine-digits rule the n8n `Resolve Lead Identity` node uses. Nothing here
   invents a key; every value comes out of `id.keys`.

   screens/deals.js is the only caller today and already hands over a list it
   built this same way, so this is a no-op for it — deliberately: the rule is
   idempotent (feeding an anchor back in yields the same anchor, asserted in the
   scratch run against all three live rows) and the next caller will not be able
   to hand this form a raw `leads` array and quietly lose somebody.

   Refusals are returned rather than swallowed. A lead this rule cannot key is a
   lead the form cannot offer, and the count of them is said out loud below. */
function pickableLeads(leads) {
  const offered = [], refused = [];
  (Array.isArray(leads) ? leads : []).forEach(l => {
    if (!l || typeof l !== 'object') return;
    const id = expandIdentity({ leadId: l.id, email: l.email, keys: [l.phone].filter(Boolean) });
    /* `id.email` rather than `l.email`: the raw column can hold a handle and
       identity.js is what knows the difference. The WhatsApp form is taken from
       the keys identity.js expanded, never assembled here. */
    const wa = (id.keys || []).find(k => keyShape(k) === KEY_SHAPE.WA_LEAD) || '';
    const anchor = id.ok ? (id.email || wa) : '';
    if (anchor) offered.push({ lead: l, anchor });
    else refused.push(l);
  });
  return { offered, refused };
}

function dealForm(leads, onDone) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const f = (id, label, input, hint) => `<div class="field"><label for="${id}">${label}</label>${input}
    ${hint ? `<div class="cell-sub">${hint}</div>` : ''}</div>`;

  const { offered, refused } = pickableLeads(leads);
  const pickerHint = [
    'Picking a lead fills the rest in. You can still edit any field.',
    /* Said, not swallowed. The old truthy test dropped these silently. */
    refused.length
      ? `${refused.length} lead${refused.length === 1 ? ' has' : 's have'} no email, no phone and no WhatsApp address on file, so ${
          refused.length === 1 ? 'it is' : 'they are'} not offered here — there is no key to record a deal against.`
      : '',
    /* INV-002 closed 2 Sep 2026. The deal now carries the lead's row id as well
       as the contact key. See the write-path note on the save handler below for
       what carries it and the one case that drops it. */
    'Picking a lead links the deal to that lead’s row. Editing the Email field afterwards drops the link — the deal is then recorded against the contact key alone.',
  ].filter(Boolean).join(' ');

  const m = openModal('Record a closed-won deal', `
    ${f('dLead', 'Lead', `<select id="dLead">
        <option value="">— pick a lead, or type the details below —</option>
        ${offered.map(({ lead: l, anchor }) =>
          `<option value="${esc(anchor)}" data-lead-id="${esc(l.id)}" data-name="${esc(l.name || '')}" data-veh="${esc(l.vehicle_interest || '')}"
            data-budget="${esc(l.budget_aed || '')}">${esc(l.name || anchor)} — ${esc(l.vehicle_interest || 'no vehicle noted')}</option>`).join('')}
      </select>`, pickerHint)}
    <div class="grid g2">
      ${f('dName', 'Customer name', `<input id="dName" placeholder="Vikram Malhotra" />`)}
      ${f('dEmail', 'Email', `<input type="email" id="dEmail" placeholder="name@example.com" />`,
          'Used with the close date to build a stable deal id, so re-recording the same deal updates its vector instead of duplicating it.')}
    </div>
    <div class="grid g2">
      ${f('dVeh', 'Vehicle', `<input id="dVeh" placeholder="Toyota Land Cruiser 2024" />`)}
      ${f('dPhone', 'Phone (optional)', `<input id="dPhone" placeholder="+971…" />`)}
    </div>
    <div class="grid g2">
      ${f('dPrice', 'Sale price (AED)', `<input type="number" min="1" id="dPrice" placeholder="290000" />`)}
      ${f('dDate', 'Closed on', `<input type="date" id="dDate" value="${iso}" max="${iso}" />`)}
    </div>`,
    `<button class="btn primary" id="dSave">Record deal</button>
     <button class="btn" id="dCancel">Cancel</button>`);

  /* The lead the form was filled from, and the anchor it was filled with. Not
     read off the <select> at save time: the operator may retype the Email box
     after picking, and a lead id is only worth writing while it still agrees
     with the contact key being recorded. Cleared back to null when they pick
     the blank option. */
  let picked = null;

  $('dLead').addEventListener('change', e => {
    const o = e.target.selectedOptions[0];
    if (!o || !o.value) { picked = null; return; }
    const leadId = Number(o.dataset.leadId);
    picked = Number.isInteger(leadId) ? { id: leadId, anchor: o.value } : null;
    $('dEmail').value = o.value;
    $('dName').value = o.dataset.name || '';
    $('dVeh').value = o.dataset.veh || '';
    if (o.dataset.budget && !$('dPrice').value) $('dPrice').value = o.dataset.budget;
  });

  m.wrap.querySelector('#dCancel').addEventListener('click', m.close);
  m.wrap.querySelector('#dSave').addEventListener('click', async () => {
    /* ── What a recorded sale carries: leads.id ────────────────────────────
       INV-002. Until 2 Sep 2026 this was BLOCKED and the comment here said so.
       Three things had to change together, and all three now have. Verified
       against the live database and the live workflow on 2 Sep 2026, not
       against the repo copy:

       1. purchase_history.lead_id — migration inv002_purchase_history_lead_id.
          `integer` (matching leads.id, which is integer/serial — NOT bigint),
          NULLABLE, no default, FK purchase_history_lead_id_fkey -> leads(id)
          ON DELETE SET NULL, index purchase_history_lead_id_idx. Confirmed by
          reading information_schema and pg_constraint back after applying.
       2. `Format Deal Text` (workflow dhy2DDjWUqwuzHLW, node id 2) now reads a
          posted lead_id and copies it into its returned object. It coerces to
          an integer and yields null on anything else, so a junk value becomes
          "not recorded" rather than a failed insert.
       3. `Record Purchase` (node 263e6e0c) now names lead_id in the body it
          POSTs to /rest/v1/purchase_history.

       The link is only as good as the agreement between the id and the contact
       key, so it is posted only while `picked.anchor` still equals the Email
       box. If the operator picks Ali and then retypes the address, the id is
       dropped rather than filed against a key it no longer matches — NULL there
       means "provenance not recorded", which is the column's documented
       meaning, and is honest. A hand-typed deal posts no lead_id at all.

       What is still REFUSED, unchanged: encoding anything into `deal_id`. Its
       derived shape is `auto:<contact key>|<close date>` and it is the dedupe
       key on both sides — pgvector upserts on_conflict=deal_id, and
       purchase_history has a partial unique index purchase_history_deal_id_key
       on it which is what makes the `Prefer: resolution=ignore-duplicates` on
       Record Purchase idempotent. Changing its shape would give the same sale
       two different ids before and after this change, so two vector rows, and
       would break the exact promise the Email hint on this form makes to the
       operator. `notes` is likewise still refused: it reaches only the embedded
       TEXT of the deal, so it would put "lead 35" into the RAG corpus and into
       no column at all. The relational join is the column, not the key. */
    const v = {
      lead_email: $('dEmail').value.trim(),
      /* Only while the picked lead still agrees with the contact key on screen.
         Omitted entirely otherwise, so the workflow's own null-coercion never
         has to guess. */
      ...(picked && picked.anchor === $('dEmail').value.trim() ? { lead_id: picked.id } : {}),
      lead_name: $('dName').value.trim(),
      phone: $('dPhone').value.trim(),
      vehicle: $('dVeh').value.trim(),
      sale_price_aed: $('dPrice').value,
      closed_at: $('dDate').value,
    };
    if (!v.lead_email) return m.msg('<span class="t-hot">An email address is required — the deal id is derived from it.</span>');
    if (!v.lead_name)  return m.msg('<span class="t-hot">A customer name is required.</span>');
    if (!v.vehicle)    return m.msg('<span class="t-hot">A vehicle is required — it is most of what gets embedded.</span>');
    if (!v.sale_price_aed || Number(v.sale_price_aed) <= 0)
      return m.msg('<span class="t-hot">A sale price above zero is required.</span>');
    if (!v.closed_at)  return m.msg('<span class="t-hot">A close date is required.</span>');

    const btn = m.wrap.querySelector('#dSave');
    const reset = () => { btn.disabled = false; btn.textContent = 'Record deal'; };
    btn.disabled = true; btn.textContent = 'Recording…';

    let res;
    try {
      res = await n8n(HOOK.closedWon, v);
    } catch (e) {
      /* The transport failed or the workflow answered a non-2xx. n8n() throws on
         both, and neither is an outcome this form has to interpret. */
      reset();
      modalError(m, e);
      return;
    }

    /* ── The body decides, never the status code ──────────────────────────
       2 Sep 2026. Until now this was `await n8n(...); m.close(); onDone();` —
       any 2xx closed the modal and reloaded the screen, and the response was
       read by nothing. screens/conversations.js states the rule this broke, for
       the sibling whatsapp-send webhook: "The workflow answers 200 for its own
       failures too, so the body decides the outcome — never the status code, and
       never optimism." A rep therefore saw a clean success followed by an empty
       Deals table, with nothing on screen connecting the two.

       WHAT SHAPE IS ASSUMED, AND WHY. This webhook has never completed a run —
       `purchase_history` holds ZERO rows and there is no recorded execution — so
       the shape is taken from the workflow's OWN last node rather than from an
       observed response. `Delivery Report` (the last Code node in
       n8n-workflows/sync_closed_won_deals_to_supabase_pgvector.json, the
       workflow serving path `deals/closed-won`) returns:

         { dealId, customer_name, email, …,
           delivery: { status: 'SUCCESS' | 'PARTIAL' | 'FAILED',
                       verified: [], dropped: [], not_verified: [], note } }

       `delivery.status` is therefore the only field in any known body that
       asserts an outcome, and it is the only field trusted here.

       WHY EVERYTHING ELSE IS "UNKNOWN" AND NOT "SUCCESS". The repo copy of that
       workflow's Webhook node carries NO `responseMode`, which in n8n means
       `onReceived`: it answers 200 with `{"message":"Workflow was started"}`
       BEFORE a single node runs. That body is a receipt for the request, not a
       report on the deal, and it is the most likely thing this handler will
       actually be handed on the first real close. The live workflow was edited
       on 2 Sep and may or may not still be configured that way — which cannot be
       checked from here — so an unrecognised body is reported as unknown and
       NEVER closed on. Optimism is what this fix removes; it is not reintroduced
       as a fallback.

       WHAT EVEN 'SUCCESS' DOES NOT PROVE, stated because the workflow states it:
       `Delivery Report` runs on the pgvector branch and lists the
       `purchase_history` write under `not_verified` ("parallel branch, not yet
       run at this point"). So SUCCESS means the vector upsert landed, not that
       the deal row did. `onDone()` re-reads the Deals screen, and that read —
       not this response — is what actually shows the deal.

       RETRYING IS SAFE, so the button is re-enabled on every non-success branch.
       `deal_id` is derived deterministically as `auto:<contact key>|<close date>`
       and both writes are keyed on it: `Record Purchase` POSTs with
       `Prefer: resolution=ignore-duplicates` against the partial unique index
       purchase_history_deal_id_key, and the vector write uses
       `on_conflict=deal_id` with `resolution=merge-duplicates`. Re-posting the
       same deal updates or ignores; it does not duplicate. */
    const body = Array.isArray(res) ? res[0] : res;
    const delivery = (body && typeof body === 'object') ? body.delivery : null;
    const status = String((delivery && delivery.status) || '').trim().toUpperCase();
    const dropped = (delivery && Array.isArray(delivery.dropped))
      ? delivery.dropped.map(d => String(d)).filter(Boolean) : [];
    const reasons = dropped.length
      ? `<ul style="margin:6px 0 0;padding-left:18px">${dropped.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`
      : '';

    if (status === 'SUCCESS') {
      m.close(); onDone();
      return;
    }

    if (status === 'PARTIAL' || status === 'FAILED') {
      /* The workflow reporting its own failure, in its own words. The modal
         stays open so the figures the operator typed are still on screen and the
         deal is not silently lost between a closed dialog and an empty table. */
      reset();
      m.msg(`<span class="t-hot">The deal was NOT recorded${status === 'PARTIAL' ? ' in full' : ''} — the closed-won workflow reported `
        + `<span class="mono">${esc(status)}</span>.</span>${reasons}`
        + `<div class="cell-sub" style="margin-top:6px;white-space:normal">${esc(
          (delivery && delivery.note ? delivery.note + '. ' : '')
          + 'Nothing here is retried automatically. Recording the same deal again is safe — the deal id is derived from the email and close date, so a repeat updates that deal rather than adding a second one.')}</div>`);
      return;
    }

    /* Unknown. It may or may not have been recorded, and guessing either way is
       how a real sale gets typed in twice or lost entirely. The body is shown
       verbatim (truncated) because it is the only evidence there is. */
    reset();
    const ack = body && typeof body === 'object' && /workflow was started/i.test(String(body.message || ''));
    let raw;
    try { raw = JSON.stringify(res); } catch { raw = String(res); }
    m.msg(`<span class="t-warm">${esc(ack
      ? 'The workflow accepted the request and answered before doing any of the work, so whether the deal was recorded cannot be told from here.'
      : 'The closed-won workflow answered without a delivery status, so whether the deal was recorded cannot be told from here.')}</span>`
      + `<div class="cell-sub" style="margin-top:6px;white-space:normal">${esc(
        'Check the Deals screen — the deal is recorded only if it appears there. Recording it again is safe: the deal id is derived from the email and close date, so a repeat updates that deal rather than adding a second one.')}`
      + ` It answered: <span class="mono">${esc(String(raw).slice(0, 200))}</span></div>`);
  });
}

/* ==========================================================================
   S11 · Automation
   ========================================================================== */

/* `pickableLeads` is exported for the scratch run that checks it against the
   three live lead rows; the screens use `dealForm`. */
export { dealForm, pickableLeads };
