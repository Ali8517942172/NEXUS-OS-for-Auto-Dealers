/* Canonical workflow-outcome semantics for the frontend.
 *
 * This module is the ONLY place in the dashboard that is allowed to decide what
 * an audit_log status means. It mirrors public.nexus_outcome_class() in Postgres
 * one-for-one; if the two ever disagree the database wins and this file is wrong.
 *
 * The rule it exists to enforce: no screen may write `status === 'FAILED'` and
 * call the remainder a success. Four screens did that independently, and the
 * result was Competitor Price Scraping showing a green "Clean, 30 d - 100.0%"
 * pill while 73 of its 84 runs produced no price at all.
 *
 * Prefer the columns v_workflow_health already computes (failures_30d,
 * partials_30d, no_result_30d, rejected_30d, successes_30d, effective_runs_30d,
 * success_rate_30d, health). Classify a raw audit_log row here only when you are
 * reading audit_log directly and the view cannot answer the question.
 */

/* The closed vocabulary. Nothing outside this set is a valid outcome. */
export const OUTCOME = {
  SUCCESS:           'SUCCESS',
  PARTIAL:           'PARTIAL',
  FAILURE:           'FAILURE',
  NO_RESULT:         'NO_RESULT',
  REJECTED_EXPECTED: 'REJECTED_EXPECTED',
  ESCALATED:         'ESCALATED',
  UNKNOWN:           'UNKNOWN',
};

const REFUSED_BY_DESIGN =
  /unauthor|forbidden|refused by validation|invalid token|not permitted/i;

/* Mirrors nexus_outcome_class(workflow, status, summary).
 *
 * Rule 1 is a deliberate writer correction, not a heuristic dressed up as one.
 * Finance Calc and Master Router both write FAILED on rows whose own summary
 * reads "... | N of M claimed steps did not land" - a quote that reached the
 * customer while its record did not. That is a partial delivery. The structured
 * phrase the writers already emit outranks the status they mislabel it with.
 * Both writers were fixed on the box on 2026-09-01 and neither can emit FAILED
 * any more, so rule 1 has nothing new to correct. It is kept because six
 * historical rows still carry the old spelling: deleting it reclassifies them to
 * FAILURE and empties the Finance Desk's "quote issued, record lost" panel,
 * which reads them with no time window, and rewriting the rows would destroy the
 * record that the writers were once wrong.
 *
 * It is NOT time-bounded, and that is the cost being accepted: a future writer
 * regression emitting FAILED with this phrase would be silently downgraded to
 * PARTIAL rather than surfacing as a failure. Bounding it needs the row's
 * logged_at passed in on both sides - see the Postgres migration
 * correct_rule_1_comment_it_is_not_time_bounded for the exact shape. */
export function outcomeOf(row) {
  const status  = String((row && row.status)  || '').toUpperCase();
  const summary = String((row && row.summary) || '');

  if (/did not land/i.test(summary) && (status === 'FAILED' || status === 'SUCCESS'))
                                          return OUTCOME.PARTIAL;
  if (status === 'ESCALATED')             return OUTCOME.ESCALATED;
  if (status === 'PARTIAL')               return OUTCOME.PARTIAL;
  if (status === 'NOT_EXECUTED')          return OUTCOME.NO_RESULT;
  if (status === 'REJECTED') {
    return REFUSED_BY_DESIGN.test(summary)
      ? OUTCOME.REJECTED_EXPECTED
      : OUTCOME.NO_RESULT;          /* ran, produced nothing usable */
  }
  if (status === 'FAILED')                return OUTCOME.FAILURE;
  if (status === 'SUCCESS')               return OUTCOME.SUCCESS;
  return OUTCOME.UNKNOWN;
}

/* Did this run do the job it was started to do? Only SUCCESS answers yes.
 * A PARTIAL did some of it, which is not the same thing and must never be
 * counted as one. */
export const isSuccess    = row => outcomeOf(row) === OUTCOME.SUCCESS;
/* Something went wrong operationally, or went out half-done. Both are the
 * dealership's problem, so both make a workflow DEGRADED. */
export const isIncomplete = row => {
  const o = outcomeOf(row);
  return o === OUTCOME.FAILURE || o === OUTCOME.PARTIAL;
};
/* Refused by design. Not a fault, and excluded from any success denominator so
 * an auth rejection cannot dilute a real miss rate. */
export const isRefusal    = row => outcomeOf(row) === OUTCOME.REJECTED_EXPECTED;
/* Counts toward a rate: everything the workflow was actually expected to
 * deliver on. */
export const isQualifying = row => {
  const o = outcomeOf(row);
  return o !== OUTCOME.REJECTED_EXPECTED && o !== OUTCOME.ESCALATED;
};

/* How each outcome should be spoken about. `tone` maps onto the pill classes the
 * rest of the app already uses; `neutral` outcomes are deliberately NOT green -
 * a run that produced nothing is not a success, and saying so in grey rather
 * than red is the honest middle. */
export const OUTCOME_WORDS = {
  SUCCESS:           { label: 'Succeeded',      tone: 'ok',      blurb: 'The workflow did the job it was started to do.' },
  PARTIAL:           { label: 'Partly landed',  tone: 'hot',     blurb: 'Some claimed step did not land. Work left the system half-done.' },
  FAILURE:           { label: 'Failed',         tone: 'hot',     blurb: 'The workflow could not complete.' },
  NO_RESULT:         { label: 'No result',      tone: 'unknown', blurb: 'It ran and produced nothing usable. Not a crash, and not a success either.' },
  REJECTED_EXPECTED: { label: 'Refused',        tone: 'unknown', blurb: 'Refused by design - an unauthorised or invalid request. Not counted against the workflow.' },
  ESCALATED:         { label: 'Escalated',      tone: 'unknown', blurb: 'Handed to a person on purpose.' },
  UNKNOWN:           { label: 'Unrecognised',   tone: 'unknown', blurb: 'The status on this row is not one this system defines, so nothing is claimed about it.' },
};

/* Health values v_workflow_health can return, and what each is allowed to say.
 * Note that only HEALTHY is green. NOT_INSTRUMENTED and NEVER_RAN are absences
 * of evidence, and PRODUCING_NOTHING is a workflow that runs cleanly and
 * achieves nothing - the state Competitor Price Scraping has been in all month. */
export const HEALTH_WORDS = {
  HEALTHY:            { label: 'Clean, 30 d',    tone: 'ok',      blurb: 'Every qualifying run in the window succeeded outright.' },
  DEGRADED:           { label: 'Degraded',       tone: 'hot',     blurb: 'At least one run failed or went out half-done in the last 30 days.' },
  PRODUCING_NOTHING:  { label: 'No output',      tone: 'hot',     blurb: 'It runs without failing, but more than half its runs produce nothing usable.' },
  UNKNOWN_OUTCOME:    { label: 'Unrecognised',   tone: 'unknown', blurb: 'It logged a status this system does not define, so its health cannot be stated.' },
  NO_QUALIFYING_RUNS: { label: 'Nothing to rate',tone: 'unknown', blurb: 'Every run in the window was refused by design, so there is no rate to report.' },
  NOT_INSTRUMENTED:   { label: 'Not logged',     tone: 'unknown', blurb: 'This workflow does not write to the audit log, so its health is unknown - not good.' },
  NEVER_RAN:          { label: 'No runs yet',    tone: 'unknown', blurb: 'Nothing has been logged for it, so there is nothing to report.' },
};

export const healthWords = h =>
  HEALTH_WORDS[String(h || '').toUpperCase()] || HEALTH_WORDS.UNKNOWN_OUTCOME;
export const outcomeWords = o =>
  OUTCOME_WORDS[String(o || '').toUpperCase()] || OUTCOME_WORDS.UNKNOWN;

/* A rate may only be shown when something qualified. Zero qualifying runs is not
 * 0% and it is not 100%; it is no rate at all, and the caller must render the
 * reason rather than a number. */
export function successRate(successes, effectiveRuns) {
  const s = Number(successes), n = Number(effectiveRuns);
  if (!Number.isFinite(s) || !Number.isFinite(n) || n <= 0) return null;
  return (s / n) * 100;
}
