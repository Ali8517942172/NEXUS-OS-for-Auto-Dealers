// node --test supabase/functions/lead-intake-website/validate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmission, originAllowed, MAX_BODY_BYTES } from './validate.mjs';

const SID = '3f2c1a9e-5b7d-4c1e-9a2b-1234567890ab';
const J = 'application/json';

test('valid json with phone', () => {
  const r = parseSubmission(J, JSON.stringify({ name: ' Ali ', phone: '050 123 4567', submission_id: SID, tenant_id: 'evil' }));
  assert.equal(r.ok, true); assert.equal(r.honeypot, false);
  assert.equal(r.fields.name, 'Ali'); assert.equal(r.fields.tenant_id, undefined);
});
test('form-urlencoded with email', () => {
  const r = parseSubmission('application/x-www-form-urlencoded; charset=utf-8', `name=A&email=a%40b.co&submission_id=${SID}`);
  assert.equal(r.ok, true); assert.equal(r.fields.email, 'a@b.co');
});
test('needs phone or email', () => {
  assert.equal(parseSubmission(J, JSON.stringify({ name: 'A', submission_id: SID })).error, 'contact_required');
});
test('needs uuid submission_id', () => {
  assert.equal(parseSubmission(J, JSON.stringify({ name: 'A', phone: '+971501234567', submission_id: 'nokey:1' })).error, 'submission_id_required');
});
test('honeypot filled is silently discarded', () => {
  const r = parseSubmission(J, JSON.stringify({ name: 'A', phone: '+971501234567', submission_id: SID, website: 'x' }));
  assert.equal(r.ok, true); assert.equal(r.honeypot, true);
});
test('size limit', () => {
  const r = parseSubmission(J, JSON.stringify({ message: 'x'.repeat(MAX_BODY_BYTES) }));
  assert.equal(r.status, 413);
});
test('bad json, arrays, content type', () => {
  assert.equal(parseSubmission(J, '{').error, 'bad_json');
  assert.equal(parseSubmission(J, '[]').error, 'bad_payload');
  assert.equal(parseSubmission('text/plain', 'x').status, 415);
});
test('origin allowlist is exact', () => {
  const al = ['https://dealer.ae', 'https://www.dealer.ae'];
  assert.equal(originAllowed('https://www.dealer.ae', al), true);
  assert.equal(originAllowed('https://dealer.ae/', al), true);
  assert.equal(originAllowed('https://evil-dealer.ae', al), false);
  assert.equal(originAllowed('https://dealer.ae.evil.com', al), false);
  assert.equal(originAllowed('null', al), false);
  assert.equal(originAllowed('', al), false);
});
