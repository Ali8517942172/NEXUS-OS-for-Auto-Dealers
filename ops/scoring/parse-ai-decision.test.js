/* Runs the EXACT jsCode body of the Master Router's `Parse AI Decision` node,
 * lifted out of the workflow JSON, in a harness that fakes n8n's $ and $input.
 *
 * Why this file exists: on 13 Sep a free model collapsed into repetition, a
 * regex scraped `000` out of the babble, parseInt made it 0, and the lead was
 * filed WARM/0 as a SUCCESS. A separate path was worse -- an empty `{}` parsed
 * cleanly and became a confident-looking WARM/50. Neither was a verdict, and
 * nothing in the database could tell them from one. There were zero tests on
 * any of it.
 *
 * Every case below is adversarial: it feeds the parser something a real free
 * model has produced or plausibly will, and asserts that the row it would
 * write says who actually decided.
 */
const fs = require('fs');
const path = require('path');

const WF = path.join(__dirname, '..', '..', 'n8n-workflows',
                     'nexus_master_lead_router_ai_agent.json');
const nodes = JSON.parse(fs.readFileSync(WF, 'utf8')).nodes;
const node = nodes.find(n => n.name === 'Parse AI Decision');
if (!node) { console.error('Parse AI Decision node not found in ' + WF); process.exit(1); }
const SRC = node.parameters.jsCode;

function run(lead, modelOutput) {
  const $ = (name) => {
    if (name === 'Validate & Enrich Input') return { first: () => ({ json: { lead } }) };
    throw new Error('unexpected $("' + name + '")');
  };
  const $input = { first: () => ({ json: { output: modelOutput } }) };
  const fn = new Function('$', '$input', '"use strict";' + SRC);
  return fn($, $input)[0].json.ai_decision;
}

let pass = 0, fail = 0;
const ck = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS' : '** FAIL **') + '  ' + label + (cond ? '' : '\n   ' + detail));
};

const HOT_LEAD = { name: 'A', email: 'a@b.com', phone: '+971500000000',
                   vehicle_interest: 'What is the price of the Fortuner? Can I test drive today?',
                   budget_aed: 150000, source: 'web', origin: 'external' };
const COLD_LEAD = { name: 'B', email: 'b@b.com', phone: null,
                    vehicle_interest: 'hi', budget_aed: null, source: 'web', origin: 'external' };

// ── 1. The 13 Sep failure: decoder collapse ────────────────────────────────
{
  const babble = 'The lead is 000 000 000 000 000 000 000 000 000 000 000';
  const d = run(HOT_LEAD, babble);
  ck('decoder babble is never recorded as a model verdict',
     d.score_source === 'RULES' && d.parse_failed === true,
     JSON.stringify(d));
  ck('decoder babble does not score a buying lead 0',
     d.score >= 70 && d.intent === 'HOT',
     'got ' + d.intent + '/' + d.score);
  ck('the raw model text is kept, not discarded',
     typeof d.ai_raw_excerpt === 'string' && d.ai_raw_excerpt.length > 0,
     JSON.stringify(d.ai_raw_excerpt));
}

// ── 2. The quieter failure: an empty object parses "successfully" ──────────
{
  const d = run(HOT_LEAD, '{}');
  ck('`{}` is a fallback, not a WARM/50 verdict',
     d.parse_failed === true && d.ai_score_raw === null && d.ai_intent_raw === null,
     JSON.stringify(d));
  ck('`{}` does not downgrade a buying lead to WARM',
     d.intent === 'HOT', 'got ' + d.intent);
}

// ── 3. Half an object is still not a verdict ──────────────────────────────
[['intent only', '{"intent":"HOT"}'],
 ['score only', '{"score":90}'],
 ['non-numeric score', '{"intent":"HOT","score":"very high"}'],
 ['invented intent', '{"intent":"BOILING","score":90}']
].forEach(([label, out]) => {
  const d = run(HOT_LEAD, out);
  ck('partial JSON (' + label + ') is a fallback',
     d.parse_failed === true && d.ai_structured === false, JSON.stringify(d));
});

// ── 4. A good structured answer is recognised and recorded ────────────────
{
  const d = run(HOT_LEAD, '```json\n{"intent":"HOT","score":92,"reason":"asked for a test drive","budget_aed":150000}\n```');
  ck('fenced valid JSON is recognised as structured',
     d.ai_structured === true && d.parse_failed === false, JSON.stringify(d));
  ck('the model answer is recorded raw',
     d.ai_score_raw === 92 && d.ai_intent_raw === 'HOT', JSON.stringify(d));
  ck('but the rules still decide while AUTHORITY = RULES',
     d.score_source === 'RULES' && d.score === d.rules_score,
     'source=' + d.score_source + ' score=' + d.score + ' rules=' + d.rules_score);
}

// ── 5. Budget is never trusted from prose ─────────────────────────────────
{
  const d = run(HOT_LEAD, 'I think the budget is around 600000 dirhams, phone 971501234567, year 2022');
  ck('prose fallback refuses to invent a budget',
     d.budget_aed === null, 'got ' + d.budget_aed);
}

// ── 6. The rules themselves ───────────────────────────────────────────────
{
  const d = run(COLD_LEAD, '{}');
  ck('a bare greeting with no phone is COLD, not WARM',
     d.intent === 'COLD', d.intent + '/' + d.score + ' ' + d.reason);
}
{
  const d = run({ name: 'C', email: 'c@b.com', phone: '+971500000001',
                  vehicle_interest: null, budget_aed: null, source: 'web', origin: 'external' },
                '{}');
  ck('no enquiry text and no budget goes to a human, not to a temperature',
     d.intent === 'UNKNOWN', d.intent + ' ' + d.reason);
}
{
  const a = run(HOT_LEAD, '{}');
  const b = run(HOT_LEAD, 'total nonsense');
  ck('the rules score is deterministic — same lead, same number',
     a.rules_score === b.rules_score, a.rules_score + ' vs ' + b.rules_score);
}
{
  const d = run(HOT_LEAD, '{"intent":"HOT","score":999}');
  ck('an out-of-range model score is clamped, not stored raw',
     d.ai_score_raw === 100, 'got ' + d.ai_score_raw);
}

// ── 7. The label is always one of the four the database will accept ───────
{
  const allowed = ['RULES', 'AI_SCORE_CONFIRMED', 'AI_SCORE_FALLBACK', 'AI_SCORE_UNKNOWN'];
  const outs = ['{}', 'babble', '{"intent":"HOT","score":80}', '', '[]', 'null'];
  const bad = outs.map(o => run(HOT_LEAD, o).score_source).filter(s => !allowed.includes(s));
  ck('score_source is always a label the CHECK constraint accepts',
     bad.length === 0, 'rejected: ' + JSON.stringify(bad));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
