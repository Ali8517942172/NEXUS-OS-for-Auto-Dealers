// node --test supabase/functions/webhook-dispatcher/lib.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { hmacHex, signatureHeader, verifySignature, checkTargetUrl, isBlockedIp,
         buildEnvelope, mapLimit } from './lib.js';

test('hmacHex matches node:crypto and RFC 4231 case 2', async () => {
  assert.equal(await hmacHex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  const s = 'whsec_test', m = '1700000000.{"a":1}';
  assert.equal(await hmacHex(s, m), createHmac('sha256', s).update(m).digest('hex'));
});

test('signatureHeader format and round-trip verify', async () => {
  const body = JSON.stringify({ id: 'x', type: 'ping', data: {} });
  const h = await signatureHeader('sec', body, 1700000000.9);
  assert.match(h, /^t=1700000000,v1=[0-9a-f]{64}$/);
  assert.equal(h.split('v1=')[1], createHmac('sha256', 'sec').update(`1700000000.${body}`).digest('hex'));
  assert.equal(await verifySignature('sec', body, h, 1700000100), true);
  assert.equal(await verifySignature('sec', body + ' ', h, 1700000100), false);
  assert.equal(await verifySignature('other', body, h, 1700000100), false);
  assert.equal(await verifySignature('sec', body, h, 1700001000), false, 'stale timestamp');
});

test('SSRF guard refuses non-https, localhost, private and metadata targets', () => {
  const bad = [
    'http://example.com/hook', 'ftp://example.com', 'not a url',
    'https://localhost/x', 'https://LOCALHOST./x', 'https://api.localhost/x', 'https://printer.local/',
    'https://metadata.google.internal/', 'https://user:pw@example.com/',
    'https://127.0.0.1/', 'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/',
    'https://0.0.0.0/', 'https://10.1.2.3/', 'https://172.16.0.1/', 'https://172.31.255.255/',
    'https://192.168.1.1/', 'https://169.254.169.254/latest/meta-data', 'https://100.64.0.1/',
    'https://224.0.0.1/', 'https://255.255.255.255/',
    'https://[::1]/', 'https://[::]/', 'https://[fd00::1]/', 'https://[fe80::1]/', 'https://[ff02::1]/',
    'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/', 'https://[::ffff:169.254.169.254]/',
    'https://[64:ff9b::a9fe:a9fe]/',
  ];
  for (const u of bad) assert.equal(checkTargetUrl(u).ok, false, u);
  const good = ['https://hooks.zapier.com/hooks/catch/1/abc/', 'https://hook.eu1.make.com/xyz',
                'https://8.8.8.8/x', 'https://172.32.0.1/', 'https://[2606:4700::1111]/', 'https://example.com:8443/h'];
  for (const u of good) assert.equal(checkTargetUrl(u).ok, true, u);
  assert.equal(isBlockedIp('10.0.0.1'), true);
  assert.equal(isBlockedIp('[fc00::]'), true);
  assert.equal(isBlockedIp('1.1.1.1'), false);
});

test('SSRF reason never echoes the URL', () => {
  const r = checkTargetUrl('http://secret-token.example.com/abc123');
  assert.equal(r.reason.includes('secret'), false);
});

test('buildEnvelope wraps raw payloads and passes envelopes through', () => {
  const row = { delivery_id: 'd1', tenant_id: 't1', event: 'lead.created', payload: { lead_id: 'L' } };
  assert.deepEqual(buildEnvelope(row, 'now'),
    { id: 'd1', type: 'lead.created', created_at: 'now', tenant_id: 't1', data: { lead_id: 'L' } });
  const env = { id: 'e1', type: 'ping', created_at: 'c', tenant_id: 't1', data: {} };
  assert.deepEqual(buildEnvelope({ ...row, payload: env }, 'now'), env);
});

test('mapLimit caps concurrency at the limit', async () => {
  let live = 0, peak = 0;
  const r = await mapLimit([...Array(12).keys()], 5, async i => {
    live++; peak = Math.max(peak, live);
    await new Promise(res => setTimeout(res, 5));
    live--; return i * 2;
  });
  assert.equal(peak, 5);
  assert.deepEqual(r, [...Array(12).keys()].map(i => i * 2));
});
