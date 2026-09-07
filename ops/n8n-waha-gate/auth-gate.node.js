// WAHA Auth Gate
// -----------------------------------------------------------------------------
// Sits on the ONLY public path into this workflow: POST /webhook/whatsapp-inbound.
// Before this node existed, ANY caller on the internet who knew that URL could
// drive the whole chain below: make the dealership's own WhatsApp number send a
// message to any phone number it chose (`Send Reply via WAHA HTTP API` sends to
// `body.payload.from`, which is caller-supplied), burn OpenRouter and Groq
// credits, and write rows into communication_logs, whatsapp_contacts,
// processed_messages and leads.
//
// The other entry point, `Called by Master Router` (executeWorkflowTrigger ->
// Extract Message & Sender), does NOT pass through here and is unchanged.
//
// WHAT THIS DOES NOT DO: `WAHA Webhook (POST)` responds onReceived, so the HTTP
// 200 is already on the wire before this node runs. An unauthorised caller still
// gets a 200. What the gate buys is that NOTHING HAPPENS for that caller: no
// WhatsApp send, no model call, no database write. Do not describe it as
// returning 401. It is also why a misconfigured secret can never make WAHA think
// the endpoint is broken and back off -- WAHA keeps seeing 200 either way.
//
// THREE STATES, all driven by container env vars (the established $env pattern
// here; N8N_BLOCK_ENV_ACCESS_IN_NODE=false):
//
//   WAHA_WEBHOOK_SECRET unset/empty  -> DORMANT. Every item passes, exactly as
//                                        before this node existed. This is the
//                                        env-level rollback. THIS IS THE STATE
//                                        THE BOX IS IN UNTIL ALI SETS THE VAR,
//                                        AND IT IS NOT A SAFE RESTING STATE.
//   secret set, WAHA_WEBHOOK_ENFORCE != 'true'
//                                    -> MONITOR. Every item passes, tagged, so
//                                        you can confirm in the execution list
//                                        that WAHA is really sending the header
//                                        BEFORE you enforce.
//   secret set, WAHA_WEBHOOK_ENFORCE == 'true'
//                                    -> ENFORCE. Items without a matching header
//                                        are dropped (return [] -> nothing
//                                        downstream runs). No throw, so an
//                                        attacker generates no error-workflow
//                                        alert storm.
//
// 3 Sep 2026 -- TWO CHANGES, both about being able to SEE what state this is in.
//
// 1. `_gate` IS NOW EMITTED IN EVERY STATE, and carries `mode`.
//    The previous version returned the items untouched when dormant, so the way
//    to tell DORMANT from MONITOR was the ABSENCE of the `_gate` key. That is a
//    terrible signal: absence is also what you get from a node that did not run,
//    a node that was disabled, and an older published version. An audit on 3 Sep
//    had to run the workflow with a payload that dies before any write purely to
//    observe that absence. Read `_gate.mode` instead. `ok`, `header_present` and
//    `enforcing` are kept with their old meanings so nothing that reads them
//    breaks.
//
// 2. ENFORCE WITHOUT A SECRET NOW FAILS CLOSED.
//    Previously the dormant check came first, so `WAHA_WEBHOOK_ENFORCE=true`
//    with an empty/typo'd/commented-out `WAHA_WEBHOOK_SECRET` passed EVERYTHING
//    -- an operator who had explicitly asked for enforcement silently got an
//    open endpoint. That is the worst possible direction for a misconfiguration
//    to fail. It now drops everything instead. The failure is then loud in the
//    only way that matters commercially (the bot stops replying, Ali notices in
//    minutes) rather than silent and open.
//
// The `_gate` key it adds is inert: `Prefilter` is a Set node in assignments
// mode with includeOtherFields off, so it emits only its four assignments and
// _gate never reaches anything else. `Extract Message & Sender` reaches back
// with $('WAHA Webhook (POST)') by name, which is unaffected by this insertion.
//
// FASTEST ROLLBACK (no restart, no env change, ~10 seconds): open this workflow
// in the n8n editor, right-click this node, "Deactivate"/disable it, save. A
// disabled node passes its input straight through to its output, so the channel
// is instantly back to its pre-patch behaviour.
const EXPECTED = String($env.WAHA_WEBHOOK_SECRET || '');
const ENFORCE  = String($env.WAHA_WEBHOOK_ENFORCE || '').trim().toLowerCase() === 'true';
const HEADER   = 'x-nexus-webhook-secret';

const items = $input.all();

// MISCONFIGURED ENFORCE -> fail closed. See note 2 above. Nothing downstream
// runs; the saved execution shows this node emitting zero items, which is the
// evidence that the secret is missing rather than the header being wrong.
if (ENFORCE && !EXPECTED) {
  return [];
}

const MODE = !EXPECTED ? 'DORMANT' : (ENFORCE ? 'ENFORCE' : 'MONITOR');

// Length-independent-ish constant-time compare. Not a defence against a remote
// timing attack over the public internet (network jitter dwarfs it) -- it is
// here because comparing secrets with === is a habit worth not having.
function sameSecret(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const out = [];
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const headers = (item.json && item.json.headers) || {};

  // Node lower-cases inbound header names, but do not rely on it.
  let got = '';
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === HEADER) { got = String(headers[k] == null ? '' : headers[k]); break; }
  }

  const present = got !== '';
  const ok = present && !!EXPECTED && sameSecret(got, EXPECTED);

  // ENFORCE and not ok -> silently dropped. No throw, no log, no cost.
  if (MODE === 'ENFORCE' && !ok) continue;

  out.push({
    json: Object.assign({}, item.json, {
      _gate: { mode: MODE, ok: ok, header_present: present, enforcing: MODE === 'ENFORCE' }
    }),
    binary: item.binary,
    pairedItem: { item: i }
  });
}

return out;

