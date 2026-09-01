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
    /* The deal carries a contact key and nothing else. See the write-path note
       on the save handler below: leads.id cannot travel with it. */
    'Picking a lead does not link the deal to that lead’s row — nothing in a recorded sale can hold a lead id.',
  ].filter(Boolean).join(' ');

  const m = openModal('Record a closed-won deal', `
    ${f('dLead', 'Lead', `<select id="dLead">
        <option value="">— pick a lead, or type the details below —</option>
        ${offered.map(({ lead: l, anchor }) =>
          `<option value="${esc(anchor)}" data-name="${esc(l.name || '')}" data-veh="${esc(l.vehicle_interest || '')}"
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

  $('dLead').addEventListener('change', e => {
    const o = e.target.selectedOptions[0];
    if (!o || !o.value) return;
    $('dEmail').value = o.value;
    $('dName').value = o.dataset.name || '';
    $('dVeh').value = o.dataset.veh || '';
    if (o.dataset.budget && !$('dPrice').value) $('dPrice').value = o.dataset.budget;
  });

  m.wrap.querySelector('#dCancel').addEventListener('click', m.close);
  m.wrap.querySelector('#dSave').addEventListener('click', async () => {
    /* ── What a recorded sale cannot carry: leads.id ────────────────────────
       Asked and answered against the live write path on 1 Sep 2026. It is
       BLOCKED, and nothing is smuggled through to pretend otherwise.

       The path is: this POST -> n8n webhook `deals/closed-won` (workflow
       "Sync Closed-Won Deals to Supabase pgvector", id dhy2DDjWUqwuzHLW,
       read live, not from the repo copy) -> `Verify JWT` -> `Format Deal Text`
       -> two branches, `Record Purchase` (POST /rest/v1/purchase_history) and
       the embedding chain (POST /rest/v1/deals_embeddings).

       Three walls, any one of which is enough:

       1. `Format Deal Text` is a Code node that ends in a CLOSED object
          literal: { dealId, dealText, customer_name, email, phone, vehicle,
          amount_aed, purchase_date }. It reads the posted body into `d` and
          copies those fields out by name. A `lead_id` added to the payload
          below would be read into `d` and then simply not copied — it dies in
          that node, silently, having reached no storage at all.
       2. `Record Purchase` posts an explicitly enumerated body —
          JSON.stringify({ deal_id, customer_name, email, phone, vehicle,
          amount_aed, purchase_date }) — so even a field that survived step 1
          would have to be named there too.
       3. There is nowhere to put it. Re-probed live: purchase_history has nine
          columns (id, customer_name, email, phone, vehicle, purchase_date,
          amount_aed, created_at, deal_id) and deals_embeddings has four
          (id, deal_id, content, embedding, created_at). Neither holds a
          lead_id, customer_id or any foreign key; the only two foreign keys in
          the whole public schema are leads.assigned_to_id and
          kyc_documents.reviewed_by, and neither touches a purchase.

       To carry it, THREE things must change together and none of them is this
       file: a `lead_id` column on purchase_history (a migration), the
       `Format Deal Text` node (add lead_id to its returned object), and the
       `Record Purchase` node (add lead_id to its JSON body).

       The one channel that does reach storage without a workflow edit is
       `deal_id` — `Format Deal Text` accepts a supplied `d.deal_id` verbatim
       instead of deriving one. Encoding the lead id into it is REFUSED here,
       and deliberately: deal_id is the pgvector dedupe key (upsert
       on_conflict=deal_id) and the purchase_history de-duplication key, and its
       derived shape is `auto:<contact key>|<close date>`. Changing the shape
       means the same sale recorded before and after this change gets two
       different ids and therefore two vector rows, which breaks the exact
       promise the Email hint on this form makes to the operator. That is not
       carrying an id, it is overloading a key nothing joins on with a value
       nothing can read back. `notes` is likewise refused: it reaches only the
       embedded TEXT of the deal, so it would put "lead 35" into the RAG corpus
       and into no column at all.

       So: a sale recorded here is anchored on a contact key by construction,
       and loses the lead row it came from. The form says so under the picker
       rather than letting the operator assume the link was made. */
    const v = {
      lead_email: $('dEmail').value.trim(),
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
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      await n8n(HOOK.closedWon, v);
      m.close(); onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Record deal';
      modalError(m, e);
    }
  });
}

/* ==========================================================================
   S11 · Automation
   ========================================================================== */

/* `pickableLeads` is exported for the scratch run that checks it against the
   three live lead rows; the screens use `dealForm`. */
export { dealForm, pickableLeads };
