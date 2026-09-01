/* NEXUS OS — lib/pipeline.js
   What "open" means, and what "open pipeline" sums, in one place.

   WHY THIS FILE EXISTS (1 Sep 2026)
   ---------------------------------
   Open pipeline value had three derivations and no owner:

     screens/overview.js   TERMINAL_TONES + isOpenLead declared locally,
                           LEAD_LIMIT 2000, summed over every open lead.
     screens/team.js       TERMINAL_TONES + isOpenLead declared again, verbatim,
                           LEAD_LIMIT 1000, summed over the open leads assigned
                           to somebody on the roster.
     the database          v_team_performance.pipeline_aed and
                           capture_daily_metrics().pipeline_aed both
                           `coalesce(sum(budget_aed), 0)` with NO status filter
                           and no window at all.

   The two screens agreed on the rule and disagreed on the window; the database
   agrees with neither and uses the same word. Two verbatim copies of a
   predicate are one edit away from being two different predicates, and the
   LEAD_LIMIT split meant the same rule could already return two answers on a
   large enough table without either screen being wrong about anything it said.

   THE DATABASE'S DEFINITION IS NOT THE CANONICAL ONE HERE, AND THAT IS
   DELIBERATE. It answers a different question — every lead ever assigned,
   disqualified and lost ones included, floored at 0 so it can never say "no
   figure". Both screens refuse it in words rather than quietly averaging it in.
   Changing it belongs to whoever owns the SQL; nothing in this file touches it.

   LEAD_LIMIT is 2000, the higher of the two former values. The lower one would
   have made Team truncate first and Overview second, so the same rule could
   report two different totals with neither screen able to see it. The higher
   value is also strictly the safer direction: it can only add rows the lower
   one was already dropping. Truncation is still possible and is still a lie if
   it goes unsaid, so both screens must render their cap warning on the tile
   that carries the pipeline figure, not merely somewhere on the page.
   Live 1 Sep 2026: `leads` holds 3 rows, so neither limit truncates anything
   today and this choice changes no figure now. It is a choice about what
   happens at row 1001. */

import { n0, tone } from './format.js';

/* The read ceiling for every lead-derived figure that has to agree across
   Overview and Team. Other screens keep their own (leads.js and deals.js read
   1000, finance.js 500); they are not summing this figure and are not bound by
   it. */
export const LEAD_LIMIT = 2000;

/* Open or finished, taken straight out of the TONE table in lib/format.js so
   no screen grows a second lead-lifecycle vocabulary. Three writers fill
   leads.status — the Master Router writes HOT/WARM/COLD, the Slack Command
   Center writes CONTACTED/QUALIFIED/WON/LOST through an unconstrained $fromAI,
   the BDC agent and the silence detector write DISQUALIFIED — and format.js is
   where those words are already mapped to 'won', 'dead' and 'open'.
   A status nobody has taught that table about tones to 'unknown' and is counted
   as OPEN here: a lead is not finished because a word was not recognised. */
export const TERMINAL_TONES = new Set(['won', 'dead']);
export const isOpenLead = l => !TERMINAL_TONES.has(tone(l && l.status));
/* Named for the other half so a caller counting closed leads does not write
   `!isOpenLead` and invite the next reader to wonder whether the two are the
   same test. They are, by construction. */
export const isTerminalLead = l => !isOpenLead(l);

/* Sum budget_aed over rows, returning null — not 0 — when nothing carries it.
   "AED 0 of pipeline" and "no pipeline figure exists" are different statements
   and only one of them is ever true; `reduce(…, 0)` printed the first one under
   captions asserting the second. Callers pass leads they have ALREADY filtered
   with isOpenLead: this function does not filter, because Overview sums every
   open lead and Team sums only the open leads a rep holds, and folding the
   status test in here would hide which of those two a call site is doing. */
export function sumBudget(rows) {
  let total = null;
  (rows || []).forEach(r => { const x = n0(r && r.budget_aed); if (x != null) total = (total ?? 0) + x; });
  return total;
}

/* The whole derivation in one call, for the callers that want all four numbers
   and must not compute any of them a second way. `leads` is the rows as read;
   `capped` is the caller's own `leads.length >= LEAD_LIMIT`, passed in rather
   than computed here so a caller reading a filtered subset cannot accidentally
   report it as uncapped. */
export function openPipeline(leads, capped = false) {
  const open = (leads || []).filter(isOpenLead);
  const withBudget = open.filter(l => n0(l && l.budget_aed) != null);
  return {
    open,
    openCount: open.length,
    terminalCount: (leads || []).length - open.length,
    withBudget,
    value: sumBudget(withBudget),
    capped: !!capped,
  };
}

/* The sentence every consumer of a capped read owes its reader. Kept here so
   the two screens cannot disclose the same truncation in two different
   strengths — or, as Overview did until now, disclose it on the lead-count tile
   and not on the pipeline tile computed from the same truncated read. */
export const CAP_NOTE = limit =>
  `The leads read stopped at ${limit} rows, so this is the pipeline inside that window and not the whole table. It can only be too low, never too high.`;

/* Why the database's own pipeline_aed is never shown in place of the figures
   above. Said in one voice on both screens. */
export const DB_PIPELINE_NOTE =
  'v_team_performance.pipeline_aed and daily_metrics.pipeline_aed both sum budget_aed with no status filter and no window, and coalesce the result to 0 — so they count disqualified and lost leads as money in play and report "none recorded" as AED 0. They answer a different question under the same name and are deliberately not substituted for the figure above.';
