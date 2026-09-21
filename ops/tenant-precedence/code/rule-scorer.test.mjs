// Test harness for ops/tenant-precedence/code/rule-based-scorer.js
// Run with: node ops/tenant-precedence/code/rule-scorer.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { scoreLead } = require(path.join(__dirname, 'rule-based-scorer.js'));

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`PASS - ${name}`);
  } catch (err) {
    fail += 1;
    failures.push({ name, err });
    console.log(`FAIL - ${name}`);
    console.log(`       ${err.message}`);
  }
}

// A fixed "daytime" and "nighttime" instant in Asia/Dubai (UTC+4), so tests
// are not flaky depending on when they happen to run.
const DAY_ISO = '2026-09-20T10:00:00.000Z';   // 14:00 Dubai -- business hours
const NIGHT_ISO = '2026-09-20T23:00:00.000Z'; // 03:00 Dubai -- night

// ---------------------------------------------------------------------
test('1. high budget SUV -> HOT, high score, score_source=RULES', () => {
  const lead = {
    budget_aed: 450000,
    vehicle_interest: 'Range Rover Sport SUV, ready to buy today, cash ready',
    phone: '+971501234567',
    email: 'buyer@example.com',
    source: 'website-form',
    received_at: DAY_ISO,
  };
  const d = scoreLead(lead, { now: DAY_ISO });
  assert.equal(d.score_source, 'RULES');
  assert.equal(d.rules_score, d.score);
  assert.equal(d.parse_failed, false);
  assert.equal(d.intent, 'HOT');
  assert.ok(d.score >= 70, `expected score >= 70, got ${d.score}`);
  assert.equal(d.budget_aed, 450000);
  assert.ok(d.score_reasons.length > 0);
  assert.ok(d.score_reasons.some((r) => /luxury/i.test(r)));
  assert.ok(d.score_reasons.some((r) => /urgency/i.test(r)));
});

// ---------------------------------------------------------------------
test('2. low budget sedan, browsing language -> COLD, low score', () => {
  const lead = {
    budget_aed: 28000,
    vehicle_interest: 'Toyota Corolla',
    message: 'Just checking prices, not in a hurry',
    phone: '+971501111111',
    email: null,
    source: 'facebook',
    received_at: DAY_ISO,
  };
  const d = scoreLead(lead, { now: DAY_ISO });
  assert.equal(d.intent, 'COLD');
  assert.ok(d.score < 40, `expected score < 40, got ${d.score}`);
  assert.equal(d.budget_aed, 28000);
  assert.ok(d.score_reasons.some((r) => /browsing/i.test(r)));
});

// ---------------------------------------------------------------------
test('3. no budget stated, casual question -> COLD (per "no budget, no timeline" rule)', () => {
  const lead = {
    budget_aed: null,
    vehicle_interest: 'Nissan Altima',
    message: 'What colors are available for this model?',
    phone: null,
    email: 'curious@example.com',
    source: 'gmail_parser',
    received_at: DAY_ISO,
  };
  const d = scoreLead(lead, { now: DAY_ISO });
  assert.equal(d.budget_aed, null);
  assert.equal(d.intent, 'COLD');
  assert.ok(d.score_reasons.some((r) => /no budget stated/i.test(r)));
});

// ---------------------------------------------------------------------
test('4. spam-ish message -> COLD, near-zero score, spam reason present', () => {
  const lead = {
    budget_aed: null,
    vehicle_interest: 'Buy cheap followers now, click here www.spam-example.com, 100% free crypto giveaway',
    phone: null,
    email: 'nobody@spamdomain.test',
    source: 'gmail_parser',
    received_at: DAY_ISO,
  };
  const d = scoreLead(lead, { now: DAY_ISO });
  assert.equal(d.intent, 'COLD');
  assert.ok(d.score <= 10, `expected score <= 10, got ${d.score}`);
  assert.ok(d.score_reasons.some((r) => /spam-pattern/i.test(r)));
});

// ---------------------------------------------------------------------
test('5. Arabic/Hinglish urgent text -> urgency detected cross-language, WARM+', () => {
  const lead = {
    budget_aed: 200000,
    vehicle_interest: 'السلام عليكم، عايز اشتري سيارة عاجل اليوم. mujhe gaadi abhi chahiye, jaldi.',
    phone: '+971509999999',
    email: null,
    source: 'typeform_catch',
    received_at: DAY_ISO,
  };
  const d = scoreLead(lead, { now: DAY_ISO });
  assert.notEqual(d.intent, 'COLD');
  assert.ok(d.score >= 40, `expected score >= 40 (WARM+), got ${d.score}`);
  assert.ok(
    d.score_reasons.some((r) => /urgency\/buy-now language matched/i.test(r)),
    'expected an urgency reason citing the Arabic/Hinglish keywords',
  );
});

// ---------------------------------------------------------------------
test('6. missing contact (no phone, no email) -> forced COLD despite hot signals', () => {
  const lead = {
    budget_aed: 300000,
    vehicle_interest: 'Bentley Continental GT, ready now, cash ready',
    phone: null,
    email: null,
    source: 'website-form',
    received_at: DAY_ISO,
  };
  const d = scoreLead(lead, { now: DAY_ISO });
  assert.equal(d.intent, 'COLD');
  assert.ok(d.score <= 15, `expected score <= 15 (forced cap), got ${d.score}`);
  assert.ok(d.score_reasons.some((r) => /NO phone and NO email/.test(r)));
});

// ---------------------------------------------------------------------
test('7. night-time receipt scores lower than the identical daytime lead', () => {
  const baseLead = {
    budget_aed: 120000,
    vehicle_interest: 'BMW X5, looking to buy this week',
    phone: '+971502222222',
    email: 'nightowl@example.com',
    source: 'website-form',
  };
  const dayResult = scoreLead({ ...baseLead, received_at: DAY_ISO }, { now: DAY_ISO });
  const nightResult = scoreLead({ ...baseLead, received_at: NIGHT_ISO }, { now: NIGHT_ISO });
  assert.ok(
    nightResult.score < dayResult.score,
    `expected night score (${nightResult.score}) < day score (${dayResult.score})`,
  );
  assert.ok(nightResult.score_reasons.some((r) => /outside business hours/i.test(r)));
  assert.ok(dayResult.score_reasons.some((r) => /inside business hours/i.test(r)));
});

// ---------------------------------------------------------------------
test('8. repeat enquiry -> repeat-language bonus applied and flagged for priority', () => {
  const lead = {
    budget_aed: 180000,
    vehicle_interest: 'Following up again on my previous enquiry about the Mercedes GLE, still waiting for a reply',
    phone: '+971503333333',
    email: 'patient@example.com',
    source: 'website-form',
    received_at: DAY_ISO,
  };
  const d = scoreLead(lead, { now: DAY_ISO });
  assert.notEqual(d.intent, 'COLD');
  assert.ok(d.score_reasons.some((r) => /repeat\/follow-up language matched/i.test(r)));
  assert.ok(d.score_reasons.some((r) => /prioritised for a fast human reply/i.test(r)));
});

// ---------------------------------------------------------------------
// Extra coverage beyond the required 8, kept because they are cheap and
// catch regressions on the "always scores, never throws" guarantee.
test('9. empty/garbage lead never throws and always returns a structured decision', () => {
  const d = scoreLead({}, { now: DAY_ISO });
  assert.equal(typeof d.score, 'number');
  assert.ok(['HOT', 'WARM', 'COLD'].includes(d.intent));
  assert.equal(d.score_source, 'RULES');
  assert.equal(d.rules_score, d.score);
  assert.equal(d.parse_failed, false);
});

test('10. score is always clamped to [0, 100]', () => {
  const d = scoreLead({
    budget_aed: 999999999,
    vehicle_interest: 'range rover bentley rolls royce ferrari today now asap urgent',
    phone: '1', email: 'a@b.com', source: 'test-drive',
  }, { now: DAY_ISO });
  assert.ok(d.score >= 0 && d.score <= 100);
});

console.log(`\n${pass} PASS, ${fail} FAIL (of ${pass + fail} total)`);
if (fail > 0) {
  process.exitCode = 1;
}
