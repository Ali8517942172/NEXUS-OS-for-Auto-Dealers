#!/usr/bin/env node
/* The WAHA Auth Gate, exercised in all four states it can be in.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This gate is the only control on POST /webhook/whatsapp-inbound, which is the
 * only public path into the workflow that carries ALBA's real WhatsApp traffic.
 * It has never been exercised in any state except DORMANT, because its three
 * states are chosen by container environment variables and the box has always
 * had WAHA_WEBHOOK_SECRET unset.
 *
 * n8n's test_workflow cannot help: it reads the box's real $env, so it can only
 * ever reproduce the state the box is already in. That is precisely the state we
 * do not need proving. So the node body is run here instead, against a faked
 * $env and $input, which is the only way to see MONITOR and ENFORCE before
 * turning them on over a dealership's live channel.
 *
 * THE COST OF GETTING THIS WRONG IS NOT SYMMETRIC. Measured 7 September 2026
 * over 29 executions spread across the day: ONE sender, one WAHA build, one
 * session, one device, and `x-nexus-webhook-secret` ABSENT on all 29. With a
 * single sender, enforcing before that header exists does not degrade the
 * channel -- it silently drops 100% of a dealership's inbound WhatsApp.
 *
 * `node ops/n8n-waha-gate/gate.test.js`
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const BODY = readFileSync(join(__dirname, 'auth-gate.node.js'), 'utf8');

/* The harness. $env and $input are the only globals the node body touches; if
   it ever reaches for another one this throws rather than quietly returning
   undefined, because a gate that silently sees `undefined` where it expected a
   secret is the failure mode this whole file is about. */
function runGate(env, items) {
  const $env = new Proxy({ ...env }, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      return Object.prototype.hasOwnProperty.call(t, k) ? t[k] : undefined;
    },
  });
  const $input = { all: () => items };
  const fn = new Function('$env', '$input', BODY + '\n');
  return fn($env, $input);
}

const req = (headers, extra) => ({ json: Object.assign({ headers: headers || {} }, extra || {}) });
const SECRET = 'a-long-random-string-nobody-guesses';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n      ' + detail : ''}`); }
}

/* ── DORMANT: the state the box is in right now ─────────────────────────────
   Everything passes. This is not a bug and it is not safety: it is the
   env-level rollback, and it is the state in which an unauthenticated caller
   can drive the whole chain. */
{
  const out = runGate({}, [req({}), req({ 'x-nexus-webhook-secret': 'anything' })]);
  check('DORMANT passes a request with no header', out.length === 2);
  check('DORMANT labels itself DORMANT', out.every(i => i.json._gate.mode === 'DORMANT'));
  check('DORMANT reports ok=false even for a header it cannot check',
        out.every(i => i.json._gate.ok === false));
  check('DORMANT still reports header_present truthfully',
        out[0].json._gate.header_present === false && out[1].json._gate.header_present === true);
}

/* ── MONITOR: secret set, enforcement off ───────────────────────────────────
   Nothing is dropped. This exists so the header can be confirmed on real
   traffic before anything starts depending on it. */
{
  const out = runGate({ WAHA_WEBHOOK_SECRET: SECRET }, [
    req({}),
    req({ 'x-nexus-webhook-secret': SECRET }),
    req({ 'x-nexus-webhook-secret': 'wrong' }),
  ]);
  check('MONITOR drops nothing', out.length === 3);
  check('MONITOR labels itself MONITOR', out.every(i => i.json._gate.mode === 'MONITOR'));
  check('MONITOR reports ok correctly per item',
        out[0].json._gate.ok === false && out[1].json._gate.ok === true && out[2].json._gate.ok === false);
  check('MONITOR never reports enforcing', out.every(i => i.json._gate.enforcing === false));
}

/* ── ENFORCE: the state we are working towards ──────────────────────────── */
{
  const out = runGate({ WAHA_WEBHOOK_SECRET: SECRET, WAHA_WEBHOOK_ENFORCE: 'true' }, [
    req({}),
    req({ 'x-nexus-webhook-secret': SECRET }),
    req({ 'x-nexus-webhook-secret': 'wrong' }),
    req({ 'X-Nexus-Webhook-Secret': SECRET }),          // header case must not matter
    req({ 'x-nexus-webhook-secret': SECRET + ' ' }),    // trailing space is a different secret
    req({ 'x-nexus-webhook-secret': '' }),              // present but empty is absent
  ]);
  check('ENFORCE keeps exactly the two items with the right secret', out.length === 2,
        `kept ${out.length}`);
  check('ENFORCE is case-insensitive about the header NAME',
        out.length === 2 && out.every(i => i.json._gate.ok === true));
  check('ENFORCE labels itself ENFORCE', out.every(i => i.json._gate.mode === 'ENFORCE'));
  check('ENFORCE marks the survivors enforcing', out.every(i => i.json._gate.enforcing === true));
}

/* ── ENFORCE with no secret: the misconfiguration that must fail CLOSED ─────
   An operator who typo'd the variable name, or commented it out, has explicitly
   asked for enforcement. Passing everything would be an open endpoint held open
   by the very setting meant to close it. */
{
  for (const [label, env] of [
    ['unset',        { WAHA_WEBHOOK_ENFORCE: 'true' }],
    ['empty string', { WAHA_WEBHOOK_SECRET: '', WAHA_WEBHOOK_ENFORCE: 'true' }],
  ]) {
    const out = runGate(env, [req({}), req({ 'x-nexus-webhook-secret': SECRET })]);
    check(`ENFORCE with the secret ${label} drops EVERYTHING`, out.length === 0,
          `kept ${out.length} — this would be an open endpoint held open by the setting meant to close it`);
  }
}

/* ── What actually counts as "on" ──────────────────────────────────────────
   The node does .trim().toLowerCase(), so 'TRUE', 'True' and ' true ' all
   enforce, while '1', 'yes' and 'on' do not. Pinned here as MEASURED, not as
   preferred: the first draft of this comment said the spelling was exact and
   the assertions below said otherwise, which is the caption-contradicts-branch
   defect this repo keeps finding. If the tolerance is ever narrowed, this block
   goes red and the runbook's wording has to change with it. */
{
  for (const v of ['TRUE', ' true ', '1', 'yes', 'on', 'True']) {
    const out = runGate({ WAHA_WEBHOOK_SECRET: SECRET, WAHA_WEBHOOK_ENFORCE: v }, [req({})]);
    const expectEnforce = v.trim().toLowerCase() === 'true';
    check(`WAHA_WEBHOOK_ENFORCE=${JSON.stringify(v)} -> ${expectEnforce ? 'ENFORCE' : 'MONITOR'}`,
          expectEnforce ? out.length === 0 : (out.length === 1 && out[0].json._gate.mode === 'MONITOR'));
  }
}

/* ── Replay: the gate is stateless and must not pretend otherwise ──────────
   The same authenticated request sent five times passes five times. That is
   correct and it is worth pinning, because "we added a secret" is often heard
   as "and duplicates are handled". They are not: the claim on
   processed_messages is what absorbs a redelivery, and this gate says nothing
   about it. */
{
  const one = req({ 'x-nexus-webhook-secret': SECRET }, { payload: { id: 'ABC123' } });
  const out = runGate({ WAHA_WEBHOOK_SECRET: SECRET, WAHA_WEBHOOK_ENFORCE: 'true' },
                      [one, one, one, one, one]);
  check('a valid request replayed five times passes five times (the gate is not a dedupe)',
        out.length === 5);
}

/* ── Shape: what the gate adds must stay inert ─────────────────────────────
   Prefilter is a Set node with includeOtherFields off, so _gate never travels
   further. If the gate ever started rewriting the payload itself, that
   assumption would quietly stop holding. */
{
  const body = { headers: { 'x-nexus-webhook-secret': SECRET }, session: 'default',
                 payload: { id: 'X', from: '971500000000@c.us' }, event: 'message' };
  const out = runGate({ WAHA_WEBHOOK_SECRET: SECRET }, [{ json: body }]);
  const got = out[0].json;
  check('the gate adds _gate and changes nothing else',
        got.session === 'default' && got.event === 'message' &&
        got.payload.id === 'X' && got.payload.from === '971500000000@c.us' &&
        Object.keys(got).length === Object.keys(body).length + 1);
  check('the gate does not mutate the item it was given', body._gate === undefined);
  check('pairedItem is set, so n8n can still trace an item back',
        out[0].pairedItem && out[0].pairedItem.item === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
