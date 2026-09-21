// mr-rules-01 :: Rule-Based Lead Scorer (deterministic, zero-API, LAST tier)
// ---------------------------------------------------------------------------
// Why this file exists: the AI Lead Scoring Agent's Model Ladder tries up to
// 3 OpenRouter :free models (each with a Groq fallback). When OpenRouter's
// DAILY free quota is exhausted AND Groq also fails/is exhausted, the Model
// Ladder code node throws (attempt >= TIERS.length) and, because it has no
// onError handler, the whole execution dies -- the lead is never scored,
// never routed, never persisted. Nothing downstream of scoring ever runs.
//
// This node is the answer: it makes NO network call, needs NO credential and
// NEVER runs out of quota, so a lead is ALWAYS scored even at zero AI budget.
// It is meant to sit as the terminal tier of the ladder (see
// ops/tenant-precedence/patched4/model-ladder.md for exactly where it is
// wired in) and produces the SAME { lead, ai_decision } shape that
// "Parse AI Decision" produces today, so it can feed straight into
// "Intent Switch" + "Persist Lead (deterministic)" unchanged.
//
// score_source is deliberately the literal string 'RULES' (upper-case), NOT
// 'rules'. This matches leads.score_source's live check constraint
// (leads_score_source_is_a_known_label, migration
// 20260914065739_nx920_a_score_now_says_who_decided_it.sql:
// RULES / AI_SCORE_CONFIRMED / AI_SCORE_FALLBACK / AI_SCORE_UNKNOWN) --
// writing lowercase 'rules' to that column would fail the constraint outright.
// `rules_score` is also emitted (== score) because that is the column NX920
// added for it. See ops/ADR-003-who-decides-the-score.md: per that accepted
// (but, as of this file, not yet n8n-implemented) decision, RULES is meant to
// be the AUTHORITATIVE score for every lead today (zero paying dealers, no
// model on the ladder supports structured output) -- this file only wires it
// in as the ladder's last tier per this task's brief, but it is written so
// that promoting it to score-every-lead later is a one-line change in
// whatever calls it, not a rewrite.
//
// Every point added or subtracted is pushed onto `reasons` so the output is
// auditable by a human (or by Slack: Unclassified Lead) -- this is the whole
// point of a rules engine standing in for an LLM: you can see exactly why.
//
// Inputs used (all already on the `lead` object built by
// "Validate & Enrich Input" -- see master-router.Validate-and-Enrich-Input.js):
//   lead.budget_aed        number|null   -- stated budget in AED
//   lead.vehicle_interest  string|null   -- vehicle named AND/OR raw free-text
//                                           message (Validate & Enrich falls
//                                           back to the raw message when no
//                                           explicit vehicle field is sent)
//   lead.message           string|null   -- optional explicit message text,
//                                           scanned in addition to
//                                           vehicle_interest when present
//   lead.source             string|null  -- lead origin channel
//   lead.phone              string|null
//   lead.email               string|null
//   lead.received_at        ISO string   -- used for the time-of-day signal
//
// Output: { intent: 'HOT'|'WARM'|'COLD', score: 0-100, reason: string,
//           budget_aed: number|null, parse_failed: false,
//           score_source: 'RULES', rules_score: number, score_reasons: string[] }
// ---------------------------------------------------------------------------

// Fixed offset: Asia/Dubai is UTC+4 year-round (no DST). Avoids depending on
// ICU/timezone data being present in whatever sandbox this runs in.
const DUBAI_UTC_OFFSET_HOURS = 4;

// ---- keyword dictionaries (lowercased; matched as substrings) -------------
// English
const LUXURY_KEYWORDS = [
  'range rover', 'land rover', 'bentley', 'rolls royce', 'rolls-royce',
  'ferrari', 'lamborghini', 'porsche', 'maserati', 'aston martin',
  'g63', 'g-wagon', 'g wagon', 'g wagen', 'amg', 's-class', 's class',
  '7 series', 'x7', 'gt3', 'mclaren', 'bentayga', 'cullinan', 'mercedes',
];
const URGENCY_KEYWORDS_EN = [
  'today', 'right now', 'asap', 'urgent', 'urgently', 'ready to buy',
  'cash ready', 'this week', 'immediately', 'right away', 'buy now',
  'need it now', 'visit today', 'test drive today', 'ready to purchase',
];
// Arabic (Gulf-dialect friendly) urgency / buying-intent terms
const URGENCY_KEYWORDS_AR = [
  'عاجل', 'اليوم', 'الآن', 'بسرعة', 'جاهز', 'أريد شراء', 'اشتري الان',
];
// Hinglish / Roman Urdu-Hindi urgency / buying-intent terms
const URGENCY_KEYWORDS_HINGLISH = [
  'jaldi', 'abhi', 'turant', 'chahiye', 'kharidna hai', 'abhi chahiye',
];
const BROWSING_KEYWORDS = [
  'just checking', 'just browsing', 'just looking', 'window shopping',
  'no rush', 'not in a hurry', 'someday', 'not sure yet', 'just curious',
];
const SPAM_KEYWORDS = [
  'click here', 'www.', 'http://', 'https://', 'free followers',
  'crypto', 'bitcoin', 'casino', 'loan approved', 'seo services',
  'backlink', 'guaranteed income', 'work from home', 'viagra',
  'subscribe now', '100% free', 'earn money fast', 'act now buy',
];
const REPEAT_KEYWORDS = [
  'second time', 'third time', 'again', 'as i mentioned', 'as mentioned before',
  'previously asked', 'following up', 'follow up on my', 'already contacted',
  'asked before', 'still waiting for a reply', 'still waiting', 'once more',
];
const HIGH_INTENT_SOURCES = /test.?drive|financing|finance.?application|showroom|whatsapp|website.?form/i;
const LOW_INTENT_SOURCES = /cold.?list|scrape|bulk.?import|purchased.?list/i;

function toText(lead) {
  return [lead && lead.vehicle_interest, lead && lead.message, lead && lead.name]
    .filter((v) => typeof v === 'string' && v.trim().length)
    .join(' \n ')
    .toLowerCase();
}

function matchAny(text, keywords) {
  return keywords.filter((k) => text.includes(k.toLowerCase()));
}

function dubaiHour(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().getUTCHours();
  const utcHour = d.getUTCHours();
  return (utcHour + DUBAI_UTC_OFFSET_HOURS) % 24;
}

/**
 * Pure, deterministic, zero-API lead scorer.
 * @param {object} lead - lead object as built by Validate & Enrich Input.
 * @param {object} [opts]
 * @param {Date|string} [opts.now] - override "current time" for time-of-day
 *   scoring/testing. Defaults to lead.received_at, then real now.
 * @returns {{intent:string, score:number, reason:string, budget_aed:(number|null),
 *            parse_failed:boolean, score_source:string, score_reasons:string[]}}
 */
function scoreLead(lead, opts) {
  lead = lead || {};
  opts = opts || {};
  const reasons = [];
  let score = 0;
  let forcedIntent = null; // set to override the score->tier mapping entirely

  const text = toText(lead);

  // ---- 1. budget_aed (weight up to 35) -------------------------------
  const rawBudget = Number(lead.budget_aed);
  const budget_aed = Number.isFinite(rawBudget) && rawBudget > 0 ? Math.round(rawBudget) : null;
  if (budget_aed === null) {
    reasons.push('no budget stated (+0)');
  } else if (budget_aed >= 300000) {
    score += 35;
    reasons.push(`budget_aed ${budget_aed} >= 300,000 AED: high-value buyer (+35)`);
  } else if (budget_aed >= 100000) {
    score += 22;
    reasons.push(`budget_aed ${budget_aed} in the 100k-300k AED band: solid buyer (+22)`);
  } else {
    score += 8;
    reasons.push(`budget_aed ${budget_aed} is a modest stated budget, still a real number (+8)`);
  }

  // ---- 2. vehicle / message keyword signals --------------------------
  const luxuryHits = matchAny(text, LUXURY_KEYWORDS);
  const specificVehicle = !luxuryHits.length && lead.vehicle_interest &&
    String(lead.vehicle_interest).trim().length > 3;
  if (luxuryHits.length) {
    score += 15;
    reasons.push(`luxury/high-end vehicle keyword(s) matched: ${luxuryHits.join(', ')} (+15)`);
  } else if (specificVehicle) {
    score += 8;
    reasons.push(`a specific vehicle was named ("${lead.vehicle_interest}"), genuine interest signal (+8)`);
  } else {
    reasons.push('no specific vehicle or luxury signal in the text (+0)');
  }

  // ---- 3. urgency keywords, English + Arabic + Hinglish --------------
  const urgencyHitsEn = matchAny(text, URGENCY_KEYWORDS_EN);
  const urgencyHitsAr = matchAny(text, URGENCY_KEYWORDS_AR);
  const urgencyHitsHi = matchAny(text, URGENCY_KEYWORDS_HINGLISH);
  const urgencyHits = [...urgencyHitsEn, ...urgencyHitsAr, ...urgencyHitsHi];
  if (urgencyHits.length) {
    score += 20;
    reasons.push(`urgency/buy-now language matched (EN/AR/Hinglish aware): ${urgencyHits.join(', ')} (+20)`);
  } else {
    reasons.push('no urgency language detected (+0)');
  }

  // ---- 4. browsing / low-intent language ------------------------------
  const browsingHits = matchAny(text, BROWSING_KEYWORDS);
  if (browsingHits.length) {
    score -= 10;
    reasons.push(`browsing/no-rush language matched: ${browsingHits.join(', ')} (-10)`);
  }

  // ---- 5. repeat / follow-up enquiry -----------------------------------
  const repeatHits = matchAny(text, REPEAT_KEYWORDS);
  if (repeatHits.length) {
    score += 10;
    reasons.push(`repeat/follow-up language matched: ${repeatHits.join(', ')} (+10) -- this person has ` +
      'already contacted us before; rules mode cannot check purchase history (no DB call), so this is a ' +
      'text-only proxy for "engaged, possibly getting impatient" and should be prioritised for a fast human reply');
  }

  // ---- 6. contact completeness (weight up to 8) ------------------------
  const hasPhone = !!(lead.phone && String(lead.phone).trim());
  const hasEmail = !!(lead.email && String(lead.email).trim());
  if (hasPhone) { score += 5; reasons.push('phone on file, directly callable/WhatsApp-able (+5)'); }
  if (hasEmail) { score += 3; reasons.push('email on file (+3)'); }
  if (!hasPhone && !hasEmail) {
    reasons.push('NO phone and NO email on file -- this lead cannot be reached through any channel we have; ' +
      'capping the score and forcing COLD regardless of every other signal, because a highly scored but ' +
      'unreachable lead is worse than a low one (it looks actionable but is not)');
    forcedIntent = 'COLD';
  }

  // ---- 7. source signal (weight up to 5) --------------------------------
  const source = String(lead.source || '');
  if (HIGH_INTENT_SOURCES.test(source)) {
    score += 5;
    reasons.push(`source "${source}" is a high-intent channel (test drive / financing / showroom / whatsapp) (+5)`);
  } else if (LOW_INTENT_SOURCES.test(source)) {
    score -= 10;
    reasons.push(`source "${source}" looks like a bulk/cold/purchased list (-10)`);
  }

  // ---- 8. spam detection (dominant, overrides everything above) ---------
  const spamHits = matchAny(text, SPAM_KEYWORDS);
  if (spamHits.length) {
    reasons.push(`spam-pattern keyword(s) matched: ${spamHits.join(', ')} -- overriding score to near-zero ` +
      'and forcing COLD regardless of any other signal above');
    score = Math.max(0, 10 - spamHits.length * 3);
    forcedIntent = 'COLD';
  }

  // ---- 9. time-of-day (weight +/-5, soft signal only) --------------------
  const hour = dubaiHour(opts.now || lead.received_at);
  const isBusinessHours = hour >= 8 && hour < 20;
  if (isBusinessHours) {
    score += 5;
    reasons.push(`received at ${hour}:00 Asia/Dubai, inside business hours (+5)`);
  } else {
    score -= 5;
    reasons.push(`received at ${hour}:00 Asia/Dubai, outside business hours -- follow-up will likely wait for ` +
      'the next shift, small penalty (-5)');
  }

  // ---- clamp + classify ---------------------------------------------------
  score = Math.max(0, Math.min(100, Math.round(score)));

  let intent;
  if (forcedIntent) {
    intent = forcedIntent;
    // A forced-COLD lead should never carry a score that reads as hot to a
    // human skimming a table, even if the raw signals were strong.
    score = Math.min(score, 15);
  } else if (score >= 70) {
    intent = 'HOT';
  } else if (score >= 40) {
    intent = 'WARM';
  } else {
    intent = 'COLD';
  }

  const topReason = reasons[0] || 'deterministic rule-based score';
  const reason = `Rule-based score ${score}/100 -> ${intent}. No AI quota was available for this lead; ` +
    `every signal is listed in score_reasons. Top factor: ${topReason}`;

  return {
    intent,
    score,
    reason,
    budget_aed,
    parse_failed: false,
    score_source: 'RULES',   // matches leads.score_source's live check constraint (NX920)
    rules_score: score,      // matches leads.rules_score (NX920)
    score_reasons: reasons,
  };
}

// ---- CommonJS export for the standalone test harness ---------------------
// `typeof module` is a safe check even where `module` is never declared (an
// n8n Code node sandbox): `typeof` never throws on an undeclared identifier.
// This line never runs inside n8n in a way that affects the node's output --
// n8n's sandbox has no CommonJS `module`, so the guard is simply false there.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreLead };
}

// ---- n8n Code node glue ----------------------------------------------------
// Only executes inside n8n, where the `$input` global exists. Kept last and
// guarded so this same file can be `require()`d by the test harness (where
// `$input` is undefined) without touching n8n's execution API.
if (typeof $input !== 'undefined') {
  const prev = $input.first().json;
  const lead = prev.lead || prev;
  const ai_decision = scoreLead(lead);
  return [{ json: { lead, ai_decision } }];
}
