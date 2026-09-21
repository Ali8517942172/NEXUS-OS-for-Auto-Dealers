// node --test supabase/functions/api-v1/validate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError, apiPath, mapDbError, parseAuthorization, parseInventoryQuery, parseJsonBody, parseLeadId,
  parseLeadsQuery, parseAppointmentsQuery, requireScope, route, toE164, validateCall,
  validateInventoryBody, validateLeadCreate, validateLeadPatch,
} from './validate.mjs';

const KEY = 'nxk_live_' + 'a1'.repeat(20);
const throwsStatus = (fn, status, code) => assert.throws(fn, e => e instanceof ApiError && e.status === status && (!code || e.code === code));

test('authorization header', () => {
  assert.equal(parseAuthorization(`Bearer ${KEY}`), KEY);
  assert.equal(parseAuthorization(`bearer   ${KEY} `), KEY);
  assert.equal(parseAuthorization(KEY), null);
  assert.equal(parseAuthorization('Bearer nxk_live_short'), null);
  assert.equal(parseAuthorization(`Bearer ${KEY.toUpperCase()}`), null);
  assert.equal(parseAuthorization(undefined), null);
});

test('path and routing', () => {
  assert.equal(apiPath('/functions/v1/api-v1/v1/leads/'), '/v1/leads');
  assert.equal(apiPath('/api-v1/v1/me'), '/v1/me');
  assert.deepEqual(route('GET', '/api-v1/v1/leads/42'), { name: 'leads.get', scope: 'leads:read', params: ['42'] });
  assert.equal(route('PATCH', '/api-v1/v1/leads/42').scope, 'leads:write');
  assert.equal(route('POST', '/api-v1/v1/calls').name, 'calls.create');
  assert.equal(route('GET', '/api-v1/v1/me').scope, null);
  throwsStatus(() => route('DELETE', '/api-v1/v1/leads/1'), 405);
  throwsStatus(() => route('GET', '/api-v1/v1/secrets'), 404);
  throwsStatus(() => route('GET', '/api-v1/v2/leads'), 404);
});

test('scopes', () => {
  requireScope(['leads:read'], 'leads:read');
  requireScope([], null);
  throwsStatus(() => requireScope(['leads:read'], 'leads:write'), 403, 'insufficient_scope');
});

test('lead id', () => {
  assert.equal(parseLeadId('7'), 7);
  for (const bad of ['0', '-1', 'abc', '1.5', '99999999999', '01']) throwsStatus(() => parseLeadId(bad), 404);
});

test('list queries', () => {
  const q = parseLeadsQuery(new URLSearchParams('updated_since=2026-09-01T00:00:00Z&limit=10'));
  assert.equal(q.p_limit, 10);
  assert.equal(q.p_updated_since, '2026-09-01T00:00:00.000Z');
  assert.equal(parseLeadsQuery(new URLSearchParams('')).p_limit, 50);
  throwsStatus(() => parseLeadsQuery(new URLSearchParams('limit=0')), 422);
  throwsStatus(() => parseLeadsQuery(new URLSearchParams('limit=201')), 422);
  throwsStatus(() => parseLeadsQuery(new URLSearchParams('updated_since=yesterday')), 422);
  throwsStatus(() => parseLeadsQuery(new URLSearchParams('tenant_id=x')), 422, 'unknown_parameter');
  throwsStatus(() => parseLeadsQuery(new URLSearchParams("cursor=1'--")), 422);
  assert.equal(parseInventoryQuery(new URLSearchParams('limit=500')).p_limit, 500);
  assert.equal(parseAppointmentsQuery(new URLSearchParams('state=confirmed')).p_state, 'CONFIRMED');
});

test('json body', () => {
  assert.deepEqual(parseJsonBody('{"a":1}'), { a: 1 });
  throwsStatus(() => parseJsonBody(''), 422);
  throwsStatus(() => parseJsonBody('{nope'), 422);
  throwsStatus(() => parseJsonBody('"' + 'x'.repeat(1_000_001) + '"'), 413);
});

test('phone normalisation matches the database rule', () => {
  assert.equal(toE164('+971 50 123 4567'), '+971501234567');
  assert.equal(toE164('00971501234567'), '+971501234567');
  assert.equal(toE164('971501234567'), '+971501234567');
  assert.equal(toE164('0501234567'), '+971501234567');
  assert.equal(toE164('12'), null);
  assert.equal(toE164(''), null);
});

test('lead create', () => {
  const ok = validateLeadCreate({ name: 'Aisha', phone: '050 123 4567', budget_aed: 90000, tenant_id: 'evil' }, 'dms-123');
  assert.equal(ok.externalId, 'dms-123');
  assert.equal(ok.payload.phone, '+971501234567');
  assert.equal(ok.payload.tenant_id, undefined, 'tenant never travels from the body');
  assert.equal(validateLeadCreate({ name: 'A', email: 'a@b.co', external_id: 'x1' }).externalId, 'x1');
  throwsStatus(() => validateLeadCreate({ name: 'A', email: 'a@b.co', external_id: 'x1' }, 'x2'), 422, 'idempotency_conflict');
  throwsStatus(() => validateLeadCreate({ email: 'a@b.co' }), 422, 'name_required');
  throwsStatus(() => validateLeadCreate({ name: 'A' }), 422, 'contact_required');
  throwsStatus(() => validateLeadCreate({ name: 'A', email: 'nope' }), 422, 'invalid_email');
  throwsStatus(() => validateLeadCreate({ name: 'A', phone: '123' }), 422, 'invalid_phone');
  throwsStatus(() => validateLeadCreate({ name: 'A', email: 'a@b.co', budget_aed: '9000' }), 422, 'invalid_budget');
  throwsStatus(() => validateLeadCreate({ name: 'A', email: 'a@b.co' }, 'has space'), 422);
  throwsStatus(() => validateLeadCreate([]), 422);
});

test('lead patch', () => {
  assert.ok(validateLeadPatch({ status: 'WON', notes: 'Delivered' }));
  assert.ok(validateLeadPatch({ assigned_to_id: null }));
  throwsStatus(() => validateLeadPatch({}), 422);
  throwsStatus(() => validateLeadPatch({ tenant_id: 'x' }), 422, 'field_not_updatable');
  throwsStatus(() => validateLeadPatch({ status: 'DROP TABLE;' }), 422, 'invalid_status');
  throwsStatus(() => validateLeadPatch({ assigned_to_id: 'bob' }), 422, 'invalid_assignee');
});

test('inventory', () => {
  assert.equal(validateInventoryBody({ stock_number: 'S1', model: 'Patrol' }).length, 1);
  assert.equal(validateInventoryBody(Array.from({ length: 500 }, (_, i) => ({ vin: 'JN1TANY62U000000' + (i % 10) }))).length, 500);
  throwsStatus(() => validateInventoryBody(Array.from({ length: 501 }, () => ({ vin: 'X' }))), 422, 'invalid_batch_size');
  throwsStatus(() => validateInventoryBody([]), 422);
  throwsStatus(() => validateInventoryBody([{ model: 'no key' }]), 422, 'vehicle_key_required');
});

test('calls', () => {
  assert.ok(validateCall({ external_call_id: 'c-1', direction: 'inbound', from_number: '+971501234567', to_number: '+97142000000', duration_sec: 30 }));
  assert.ok(validateCall({ external_call_id: 'c-2', direction: 'outbound', to_number: '0501234567' }));
  throwsStatus(() => validateCall({ external_call_id: 'c-3', direction: 'inbound', to_number: '+971501234567' }), 422, 'invalid_customer_phone');
  throwsStatus(() => validateCall({ external_call_id: 'c-4', direction: 'sideways', from_number: '+971501234567' }), 422, 'invalid_direction');
  throwsStatus(() => validateCall({ direction: 'inbound', from_number: '+971501234567' }), 422);
  throwsStatus(() => validateCall({ external_call_id: 'c', direction: 'inbound', from_number: '+971501234567', recording_url: 'http://x' }), 422);
  throwsStatus(() => validateCall({ external_call_id: 'c', direction: 'inbound', from_number: '+971501234567', duration_sec: -1 }), 422);
});

test('database errors never leak internals', () => {
  assert.equal(mapDbError({ details: 'NX_API_NOT_FOUND', message: 'No such lead.' }).status, 404);
  assert.equal(mapDbError({ details: 'NORMALIZED_PHONE_MUST_BE_E164', message: 'x' }).status, 422);
  const e = mapDbError({ code: '42P01', message: 'relation "secret_table" does not exist' });
  assert.equal(e.status, 500);
  assert.ok(!e.message.includes('secret_table'));
});
