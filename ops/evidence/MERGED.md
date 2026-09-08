# NEXUS OS — platform truth pass: merged and verified live
**2026-09-01** · PR [#2](https://github.com/Ali8517942172/autodealer-ai-os/pull/2) merged into `main` · 6 commits, 21 files, +10,617 / −2,316

This supersedes `nexus-RESUME-STATE-2026-09-01.md` and the "still open" section of
`nexus-platform-truth-COMPLETE-2026-09-01.md`, both of which describe the work as unpushed.
It has landed, deployed, and been checked on production.

## Verified on the live site after deploy

| | before | after |
|---|---|---|
| Competitor Price Scraping | green **100.0%**, "Clean, 30 d" | **"No output" · 13.0%** — *108 runs, 14 delivered, 94 produced nothing* |
| Open leads | **3** | **1** — *2 further leads are closed (DISQUALIFIED)* |
| Pipeline value | a large **AED 0** | **—** |
| Awaiting first reply | *"All 3 leads have an outbound message"* | *"All 1 open lead that could be checked has an outbound message sent after it arrived"* |
| Error Handler / Infra Probe | — | *"no rate — nothing is logged for it, so there is nothing to rate"* |

The raw `PRODUCING_NOTHING` enum that leaked into the UI between the database change and
the frontend merge is gone.

## The scraper fix proved itself on its first real run

The 13:00 UTC run wrote the first rows carrying provenance, and immediately caught the case
the fix was built for:

- our unit: `Toyota Corolla 2.0 XLI 2024`
- the page: `Toyota Corolla 2026 for Sale in UAE`
- the offer the price came from: `TOYOTA 1.6L COROLLA 2026`
- `match_quality` = **weak**

Different year, different engine. The old code would have printed `+AED 3,900` as a fact and
a rep could have repriced on it. The screen now refuses to draw a conclusion from a weak match.
The Lexus row is also `weak`, correctly — its price came from the model-extraction fallback,
which cannot say what the figure was for.

## A gap introduced today, and it is mine

Both new rows carry `source_host` NULL and `source_kind` `unknown`. The Apify item had no page
URL, so hostname extraction found nothing, and without it OEM / dealer / marketplace cannot be
told apart — which was one of the reasons the column was added. The row is still written because
the source resolved by another path. This needs a fallback in `Parse AI Price` (the Apify item
exposes other URL fields) or an explicit "source not identifiable" state.

## Still open

- **Fix the writers.** Finance Calc and Master Router write `FAILED` on rows whose own summary
  says *"N of M claimed steps did not land"*. That is why rule 1 exists in `nexus_outcome_class`
  and `lib/health.js`. Fix the writers, then delete the rule from both together.
- **`source_host`** — above.
- **`lib/identity.js`** — `quoteValue` escapes `"` and `\` but not `%` and `_`.
- **`lib/unit-form.js`** — `deriveUnit()` cannot express "unknown" and returns a plausible zero;
  it rewrites 75-day banding on every save; it counts days in the browser's timezone while
  Postgres uses `Asia/Dubai`.
- **Cross-module regression** — Lead → Conversation → Customer 360 → Compliance → Deal.
  A screen rendering is not a pass.
- **J1 remains on hold** until that regression passes.

## For the next session

Start repo work from `claude.ai/code` with `autodealer-ai-os` selected. A session started that
way can push and open PRs directly. This session was linked to the computer rather than the
repository, which is the whole reason today's work had to travel as a patch.

Local scratch: the container branch `wip/platform-truth-2026-09-01` is content-equivalent to
what merged and is tagged `merged-as-pr-2`. It cannot be pushed from here and does not need to be.
