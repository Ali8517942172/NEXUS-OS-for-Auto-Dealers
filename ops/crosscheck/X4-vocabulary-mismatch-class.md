# X4 — The producer writes one vocabulary, the consumer filters on another

12 September 2026. Production `dsvuoovivysszdoiorch`, **read only**. Repo at
`wip/gate-L9-2026-09-03-continued`.

`ops/f2-tenant-rule/RECONCILIATION.md` found one instance of a shape:

> a producer writes one vocabulary, a consumer filters on another, and the empty
> result is misread as absent data rather than as a mismatch.

I went looking for the rest. **There are five live instances and three latent
ones.** One is a bug. Five is a class, and a class changes what should be built:
the 20260912 held migration is the right fix built once, for one column, when the
thing that needs building is the mechanism.

Every verdict below cites a query with its real result, or `file:line`. Where I
could not establish something I say UNKNOWN and say so as a finding, not a gap.

---

## 1. The class inventory

Ranked by whether a dealer would act on the affected number.

### X4-1 · `competitors.match_quality` → `accepted_market_match_quality` — CONFIRMED (known)

The instance the reconciliation found. Spot-checked today, not re-derived.

| | |
|---|---|
| Producer | live scraper (n8n box) — `exact_year \| model_only \| weak`, + NULL |
| Consumer | `v_inventory_profit_sentinel` via `inventory_profit_settings.accepted_market_match_quality`, default `{exact,strong}` |
| Intersection | **∅** |

```sql
select coalesce(match_quality,'(NULL)') v, count(*) from competitors group by 1;
--  (NULL) 9 | weak 9 | model_only 4     (22 rows — matches RECONCILIATION exactly)
```

Default confirmed still in place in the catalog, not just in a migration file:

```sql
-- pg_attrdef for public.inventory_profit_settings.accepted_market_match_quality
--  ARRAY['exact'::text, 'strong'::text]
```

Dealer impact: **HIGH** — 12 units, zero usable market position, permanently.

---

### X4-2 · `audit_log.workflow` → `nexus_workflow_catalogue()` — CONFIRMED, NEW

The same shape, one layer up: the joining *key* is the vocabulary.

* **Producer:** n8n nodes and DB functions write `audit_log.workflow` as free text.
* **Consumer:** `v_workflow_health` reads
  `FROM nexus_workflow_catalogue() r LEFT JOIN LATERAL (… WHERE l.workflow = r.name OR l.workflow = r.audit_name OR l.workflow = ANY(r.audit_aliases))`.
  The catalogue is the `FROM`, so a name it does not hold has **no row at all**.

```sql
with cat as (select name, audit_name, audit_aliases from nexus_workflow_catalogue()),
     al  as (select workflow, count(*) n from audit_log group by 1)
select 'AUDIT_NAME_NOT_IN_CATALOGUE', al.workflow, al.n from al
 where not exists (select 1 from cat c
        where al.workflow = c.name or al.workflow = c.audit_name
           or al.workflow = any(c.audit_aliases))
union all
select 'CATALOGUE_NEVER_RAN', c.name, null from cat c
 where not exists (select 1 from al
        where al.workflow = c.name or al.workflow = c.audit_name
           or al.workflow = any(c.audit_aliases));

--  AUDIT_NAME_NOT_IN_CATALOGUE | Inventory Action Center          | 8
--  AUDIT_NAME_NOT_IN_CATALOGUE | Example Workflow                | 1
--  CATALOGUE_NEVER_RAN         | WhatsApp Send (Dashboard Reply) | aliases={}
--  CATALOGUE_NEVER_RAN         | NEXUS Retention Purge           | aliases={}
--  CATALOGUE_NEVER_RAN         | NEXUS Infra Health Probe        | aliases={}
--  CATALOGUE_NEVER_RAN         | NEXUS Error Handler             | aliases={}
```

Both directions of the mismatch are live. Nine audit rows describe work that the
health screen cannot see. Four registry rows render `NEVER_RAN` — *"this workflow
has never run"*, a sentence about the dealership's automation — when the
available evidence cannot distinguish that from *"the name on the row and the
name in the log are different strings"*, a sentence about us.

**The designed remedy is itself inert.** `workflow_registry.audit_aliases text[]`
exists precisely to absorb name drift. It is `{}` on every row that would need
it — measured above. An allow-list that is empty everywhere is the same defect as
an allow-list naming values nobody emits: it is structurally incapable of
matching. That is X4-1's shape in a different column.

Dealer impact: **HIGH** — `NEVER_RAN` on the automation screen is exactly the
"absent data" misreading the class is named for.

*Precision, so this is not overstated:* `v_needs_attention`'s `workflow_failure`
branch is **not** affected. It groups `audit_log` first and `LEFT JOIN`s the
catalogue only for a label, falling back to `COALESCE(r.name, f.workflow)`. That
branch is built correctly. `v_workflow_health` is the one that drops rows.

---

### X4-3 · `audit_log.summary` prose → `nexus_outcome_class()` 5-phrase regex — CONFIRMED, NEW

The consumer's vocabulary here is not a value set but **five substrings matched
against free prose**.

```sql
-- nexus_outcome_class(p_workflow, p_status, p_summary), production body:
when upper(coalesce(p_status,'')) = 'REJECTED' then
  case when coalesce(p_summary,'') ~* 'unauthor|forbidden|refused by validation|invalid token|not permitted'
       then 'REJECTED_EXPECTED'   -- excluded from effective_runs
       else 'NO_RESULT'           -- COUNTED in effective_runs; drives DEGRADED
  end
```

A rejection the regex recognises is a refusal by design and is excused. A
rejection it does not recognise becomes a run that produced nothing, and counts
against the workflow's health.

```sql
select workflow,
  count(*) filter (where coalesce(summary,'') ~* 'reject|refus|invalid|must be|not allowed|blocked') reads_as_refusal,
  count(*) filter (where coalesce(summary,'') ~* 'unauthor|forbidden|refused by validation|invalid token|not permitted') matched_by_consumer,
  count(*) rejected_rows
from audit_log where upper(coalesce(status,''))='REJECTED' group by 1 order by 4 desc;

--  Competitor Price Scraping |   0 |  0 | 357
--  Finance Calc              |  53 | 40 |  53
--  Ask-AI RAG Query          |   9 |  9 |   9
--  Sync Closed-Won to pgvector|  2 |  2 |   2
--  Inventory Action Center   |   1 |  0 |   1
```

**Measured misclassification: 14 rows.** Finance Calc writes 53 rejections, every
one of which reads as a refusal; the consumer recognises 40. The 13 it misses are
phrased *"Rejected: vehicleValue must be a realistic vehicle valuation of at
least AED 500…"* — a validation refusal in the producer's own words, which is
exactly what `REJECTED_EXPECTED` is for. Inventory Action Center: 1 of 1 missed.

**This is currently masked by X4-2.** Finance Calc and Inventory Action Center are
not in the catalogue, so neither has a `v_workflow_health` row and the
misclassification has no surface. Fix X4-2 alone and Finance Calc appears on the
automation screen as DEGRADED on the strength of 13 correct refusals. The two
defects hide each other; they must be fixed together or in that order.

**Honest negative, stated because it constrains the fix:** Competitor Price
Scraping's 357 rejections genuinely say *"Scrape produced no usable intel for
Toyota Corolla 2.0 XLI 2024 — the page carried no…"*. `NO_RESULT` is the right
class for those, and the resulting verdict is accurate:

```sql
select name, health, runs_30d, no_result_30d, successes_30d, success_rate_30d
  from v_workflow_health where name = 'Competitor Price Scraping';
--  PRODUCING_NOTHING | 382 | 357 | 25 | 6.5
```

That number is not a vocabulary artefact. Do not "fix" it.

---

### X4-4 · `attribution_edge_type.state` → `v_attribution_link_map` — CONFIRMED, NEW

The purest example of the misreading, because the consumer's own sentence is the
misreading.

* **Producer vocabulary** (CHECK `attribution_edge_type_state_check`): eight
  states. Measured:

```sql
select state, count(*) from attribution_edge_type group by 1 order by 2 desc;
--  ABSENT_NO_TABLE 4 | PRESENT_KEYED 3 | ABSENT_NO_FIELD 2 | PRESENT_RESOLVED 2
--  TEXT_ONLY_REFUSED 2 | BLOCKED_BY_UPSTREAM 1 | PRESENT_HUMAN_ONLY 1 | PRESENT_SAME_ROW 1
```

* **Consumer** (`pg_get_viewdef('v_attribution_link_map')`):

```sql
CASE WHEN a.edge IS NULL AND (et.state = ANY (ARRAY['ABSENT_NO_TABLE','ABSENT_NO_FIELD','BLOCKED_BY_UPSTREAM']))
       THEN 'No instances, and none can exist: ' || lower(et.state) || '. Coverage is UNKNOWN, not 0%.'
     WHEN a.edge IS NULL
       THEN 'This hop is not instantiated row-by-row by v_attribution_edges - either nothing has
             happened yet, or the candidate set would be every record against every unit…'
```

`TEXT_ONLY_REFUSED` means *a link exists and is refused as evidence on
principle*. It is missing from the "none can exist" set. Measured, one such edge
with no instances falls through to the else branch:

```sql
select state, count(*), left(string_agg(distinct left(coverage_note,60),' ~ '),200)
  from v_attribution_link_map group by 1;
--  TEXT_ONLY_REFUSED | 2 | '1 candidate(s) exist and NOT ONE is evidence…'
--                          ~ 'This hop is not instantiated row-by-row by v_attribution_edg…'
```

So a hop that was **refused by design** is described to the reader as *"either
nothing has happened yet, or …"*. That is the class verbatim: a deliberate
refusal rendered as possible absence of activity.

Dealer impact: **MEDIUM** — it corrupts the attribution coverage narrative, which
is a story about how much of the pipeline can be evidenced.

---

### X4-5 · `leads.status` → `overview.js` hardcoded trio — CONFIRMED, NEW

`screens/leads.js:969` and `:1001` document the producer situation honestly:

> `leads.status` is written by three different things — HOT/WARM/COLD by the
> Master Router; CONTACTED, QUALIFIED, WON and LOST by the Slack Command Center;
> DISQUALIFIED by the BDC agent.

Measured on production:

```sql
select upper(coalesce(status,'(NULL)')) v, count(*) from leads group by 1;
--  COLD 2 | DISQUALIFIED 2 | NEW 1 | WARM 1        (6 rows)
```

Note `NEW` — lowercase `new` in the table — belongs to **none** of the three
documented vocabularies. A fourth writer exists and is undocumented.

The consumer, `screens/overview.js:1006-1008`:

```js
const hot  = leads.filter(l => up(l.status) === 'HOT').length;
const warm = leads.filter(l => up(l.status) === 'WARM').length;
const cold = leads.filter(l => up(l.status) === 'COLD').length;
```

**3 of 6 leads are counted.** Two DISQUALIFIED and one NEW fall through in
silence. `screens/team.js:544` and `screens/campaigns.js:826` share the same trio.

And the same reversal the reconciliation found for `competitors.js` appears
again: `screens/leads.js:1001` builds its tabs *from the statuses actually
present*, so the detail screen speaks the producer's language while the summary
screen does not. **The KPI row is the surface a dealer acts on.**

Dealer impact: **HIGH**.

---

### X4-6 · `whatsapp_message_usage.policy_rule_verification_status` — LATENT (0 rows)

UNKNOWN ≠ ZERO, so this is reported, not dismissed.

* `wmu_policy_rule_verification_vocabulary` CHECK permits **five** values:
  `VERIFIED, NOT_VERIFIED, UNKNOWN, DISPUTED, NO_RULE_APPLIED`.
* `policy_rule.verification_status` CHECK permits **four** — no `NO_RULE_APPLIED`.
* `v_whatsapp_messaging_usage_monthly` counts
  `u.policy_rule_verification_status = ANY (ARRAY['NOT_VERIFIED','UNKNOWN','DISPUTED'])`.

`NO_RULE_APPLIED` is producible and is counted as neither verified nor
unverified — it silently joins the "fine" bucket. The table is empty today
(`whatsapp_message_usage` returned no distribution), so this is a landmine, not a
live defect. It detonates on the first row.

---

### X4-7 · Three vocabularies for "confidence" — LATENT / CANDIDATE

| Column | Allowed set | Measured |
|---|---|---|
| `policy_rule.confidence` | `{HIGH,MEDIUM,LOW,UNKNOWN}` | `UNKNOWN x13` — **all 13 rows** |
| `policy_platform_attestation.confidence` | `{HIGH,MEDIUM,LOW}` | (no rows) |
| `attribution_link_basis.default_confidence` | `{HIGH,MEDIUM,LOW,NONE}` | 10 rows |

Every policy rule on production carries the one grade that two of the three
vocabularies cannot express, and `NONE` and `UNKNOWN` are two spellings of
adjacent ideas in sibling tables. I did **not** trace a consumer that crosses
them — that trace is NOT RUN. Reported as a candidate on the strength of the
drift alone; do not act on it as confirmed.

---

### X4-8 · Three vocabularies for "role" — LATENT / CANDIDATE

```sql
--  tenant_members.role              owner x1              lowercase enum
--  users.role                       senior_rep x1         snake_case free text
--  inventory_actions.engine_owner_role  'Sales Manager' x3    Title-Case prose
--  inventory_actions.assigned_role      'Sales Manager' x2, NULL x1
--  inventory_action_policy          approver_tenant_roles={owner,admin,manager}, approver_staff_roles={}
```

The engine names an action owner — "Sales Manager" — that exists in neither role
table. Three spellings of one concept.

**The consumer here is built correctly, and that matters.**
`action_approver_context` (`supabase/baseline/00000000000000_baseline.sql:1060-1098`)
case-folds both sides (`lower(v_staff.role) = any (select lower(x) from unnest(v_pol.approver_staff_roles) x)`),
guards the empty allow-list with `array_length(...) is not null`, and renders the
empty case as an explicit sentence — *"none - no job title has been granted
approval here"* — rather than an empty result. That is the correct handling of an
inert allow-list, and it is the pattern X4-2's `audit_aliases` lacks. Not an
instance; included because it is the counter-example that proves the fix shape.

---

### Negative controls — checked, and NOT instances

These matter as much as the findings: they show the right pattern already exists
in this codebase, so the class is a discipline failure, not a capability gap.

| Candidate | Why it is not an instance | Evidence |
|---|---|---|
| `audit_log.status` `FAILED` → health's `FAILURE` | An explicit translator function exists and is total. **0 of 1018 audit rows classify as `UNKNOWN`.** | `select nexus_outcome_class(workflow,status,summary), count(*) from audit_log group by 1` → NO_RESULT 379, SUCCESS 271, FAILURE 262, PARTIAL 53, REJECTED_EXPECTED 51, ESCALATED 2 |
| `competitors.source_kind` | Producer writes `unknown x13 \| NULL x9`; the screen's `KIND` map **has an `unknown` key** with its own sentence. Intersects. | `screens/competitors.js:547-552` |
| `inventory.status = 'Available'` (Title Case) | Consumers case-fold: `lower(u.status) === 'available'`. | `screens/deals.js:811,1449,1846` |
| `deal_rescue_evidence_sources.evidence_tier` | `REFUSED x7 \| STRONG x1 \| WEAK x1` vs `deal_rescue_state()`'s `not in ('STRONG','WEAK')` — REFUSED excluded deliberately. | function body + distribution |

`nexus_outcome_class()` is the model. It is a named, total, `IMMUTABLE` function
that translates one vocabulary into another with an explicit `else`. Everything
in the inventory above is a place where that function was not written and a
literal array was inlined instead.

---

### What five instances change about what should be built

The 20260912 held migration builds, for one column: a catalogue table
(`market_match_quality_kind`), a config-side trigger that rejects a setting
naming a grade nobody writes, and a drift view that surfaces a producer value the
catalogue does not know. **That shape is right.** Its asymmetry — *block config
errors, surface data anomalies* — is right and generalises unchanged.

What the class says is that it should not be built once. The same three pieces
are owed to `audit_aliases`/`workflow_registry.name` (X4-2), to
`nexus_outcome_class`'s refusal phrases (X4-3), to `attribution_edge_type.state`
(X4-4) and to `leads.status` (X4-5). Concretely:

1. **One catalogue, keyed by domain** — `vocabulary_kind(domain, kind, rank,
   is_conclusive, written_by, note)` — rather than one table per column. X4-1's
   three grades are one domain; edge-state is another; lead status a third.
2. **One generic drift view** over registered `(table, column, domain)` pairs,
   so a producer emitting an unknown value is visible everywhere, not only for
   `competitors`.
3. **A standing check that no consumer inlines a literal set** for a column that
   has a registered domain. Every instance above is an inlined literal array; the
   sweep that produced this document (`pg_get_viewdef` + `pg_get_functiondef`
   over all views and functions, regexed for `= ANY (ARRAY[…])`, `<> ALL`, `IN
   (…)`, `@>`) is cheap enough to run in CI.
4. **The `else` branch is the tell.** X4-4 is a defect purely because its `CASE`
   has a fall-through that asserts something ("nothing has happened yet") instead
   of refusing ("this state is not one this view classifies"). `nexus_outcome_class`
   gets this right with `else 'UNKNOWN'`.

---

## 2. The open UNKNOWN, settled

The reconciliation left this open, correctly marked UNKNOWN rather than zero:
*can the scraper emit `exact_year` at all?*

### The writer is not in this repo, and I can say where it must be

I swept all file types at any depth, not just `--include=*.json`:

```
$ grep -rl "match_quality" .            # excluding node_modules and .git
ops/…  (11 analysis docs)               supabase/migrations/…  (7 migrations)
supabase/baseline/…  supabase/sentinel/…  architecture/schema.sql
ops/demo/seed_demo_tenant.sql           apps/executive-dashboard/.gate/*.json (4 fixtures)
```

No workflow file, no Make.com blueprint, no `workflows_dump.json`. The only
candidate writer is the scraper workflow, and **it cannot write the column**:

```
$ # n8n-workflows/competitor_price_scraping_supabase_update.json — the ONLY repo
$ # file whose n8n nodes carry "tableId": "competitors"
   match_quality: 0     listing_title: 0     source_kind: 0
   offer_name:    0     offer_condition: 0   match_note:   0
   competitor:   20     model:          29
```

This file predates the 1 September 2026 provenance columns entirely. It writes
none of them.

**Production disproves that this file is the live writer.** Thirteen rows carry a
non-null `match_quality` and thirteen carry `source_kind = 'unknown'`:

```sql
select coalesce(source_kind,'(NULL)'), count(*) from competitors group by 1;
--  unknown 13 | (NULL) 9
```

Something wrote those. Therefore the deployed `Competitor Price Scraping`
workflow on the n8n box is **newer than the repo copy**, and the repo copy is
stale. Per the hard rules I did not touch n8n's API, and I did not need to in
order to state the conclusion:

> **`exact_year` is not emittable by anything in this repository, and the repo's
> own scraper cannot emit `match_quality` at all. The writer must live in the
> deployed `Competitor Price Scraping` workflow on the n8n instance and nowhere
> else. This UNKNOWN cannot be closed from the repo; closing it requires reading
> that deployed node.**

What production *does* prove about the live writer: it has emitted `model_only`
(4) and `weak` (9) and never `exact_year` (0 of 22). The grade ladder is
implemented at least to its middle rung. Whether the top rung exists in the
deployed code remains **UNKNOWN, not zero** — and it is now a one-file question
rather than an open search.

A second, stronger reason to go read that node: it writes `source_kind='unknown'`
on 13 of 13 classified rows and never `oem`, `marketplace` or `dealer`, on hosts
including `toyota.ae` and Land Rover UAE which are unambiguously OEM. A
classifier that returns its own fallback 100% of the time is the same failure
mode as a match-rater that never reaches its top grade. They are probably the
same bug.

### Where staging's single `strong` row came from — FOUND, and it is patient zero

`ops/demo/seed_demo_tenant.sql`. Two lines, and together they explain the whole
defect:

```sql
-- line 201-204: the settings row
   min_model_token_overlap, accepted_market_match_quality, market_max_age_days)
values ('dddddddd-…', …, 2, array['exact','strong'], 14);

-- line 409, 433-434: a seeded competitors row
   scraped_at, listing_title, source_host, source_kind, offer_condition, match_quality, match_note)
values …
  ('Example Motors LLC (demo)', 'Toyota Land Cruiser VXR 2022', 272000, 279000, 25,
   'strong', 'Same trim and a comparable mileage band — but captured 25 days ago.', …)
```

Measured vocabulary across the seed's competitor rows:
`model_only x3 | strong x1 | weak x4`.

**The seed writes a mixed vocabulary** — three grades in the producer's spelling
and one in the consumer's — and pairs it with an accepted set that only the
invented grade satisfies. That is why `{exact,strong}` looked verified when it
was written: in the demo tenant it *did* admit exactly one row. The demo proved
the filter worked. It proved it against data authored to make it work.

Staging's `strong` row, `scraped_at 2026-08-12`, is this seed. That retires the
last of the 20260908120000 "positive control" claim, which the reconciliation had
already half-retracted: the surviving staging row is not merely "seed data", it
is seed data from a file in this repository, and the file is the origin of the
`exact`/`strong` vocabulary itself.

**Consequence for the fix:** the 20260912 migration corrects the *setting* and
adds a config trigger, but `ops/demo/seed_demo_tenant.sql:204` still seeds
`array['exact','strong']` and `:434` still seeds a `'strong'` competitor row.
After the trigger lands, **seeding a demo tenant will raise `23514`**. The seed
must be corrected in the same change, or demo provisioning breaks. Neither held
file mentions it.

---

## 3. The judgement call — is `unrated → concludes: true` defensible?

`screens/competitors.js:531-533`:

```js
unrated: {
  chip: 'match never rated', tone: 'warm', concludes: true,
```

`:858` coerces any unrecognised grade to `unrated`; `:900` and `:905` gate
`concludable` and `deltaPct` on `concludes`. Nine of 22 production rows are
NULL-quality, so this decides the majority treatment of 41% of the table.

### The case for (the screen is right)

1. **`unrated` is the absence of a grade, not a grade.** The file argues this at
   `:510` and `:1820`, and it is correct. Rows before 1 Sep 2026 carry NULL
   because the column did not exist — not because the match was judged and found
   wanting. Rendering "we never asked" as "the answer was no" invents a verdict,
   which is the precise sin this codebase is otherwise disciplined about.
2. **The alternative deletes information.** Suppressing the delta on 9 of 22 rows
   removes figures nobody has shown to be wrong. The screen already labels each
   one (`:1030`, *"Match never rated — this comparison predates the 1 Sep
   provenance fix"*) and raises its own WARM/HOT alert when unrated rows dominate
   (`:1828-1843`). A stated-and-caveated number carries more than a withheld one.
3. **It is consistent with how `weak` is treated.** `weak` is a *positive
   assertion by the producer* that nothing on the page ties the price to our car.
   That is evidence of a bad match and earns suppression. NULL is not that, and
   collapsing the two would make an unrated row indistinguishable on screen from
   a row the scraper actively condemned.
4. **UNKNOWN ≠ ZERO cuts this way too.** Two different epistemic states should
   not render identically.

### The case against (the reconciliation missed something)

1. **`concludes` does not gate visibility — it gates the conclusion.** At `:900`
   and `:905` it is the switch on `concludable` and on `deltaPct`, i.e. on the
   market position and the percentage. The file's own doctrine at `:901` —
   *"a percentage IS the conclusion"* — is applied to `weak` and then not applied
   to `unrated`. The argument for showing the row is strong; it is not an
   argument for drawing a position from it.
2. **The base rate is knowable and it is bad.** The unrated rows were written by
   the scraper generation with no provenance discipline at all. Its successor
   rates its own matches `weak` 9 times and `model_only` 4 times out of 13, and
   classifies 13 of 13 pages as `unknown`. That is **0% exact_year, 31%
   model_only, 69% weak.** Applied to 9 unrated rows, roughly six would be `weak`
   had they been rated. `concludes: true` is, on the evidence this system already
   holds, wrong about the majority of the rows it admits.
3. **It is about to contradict the database.** The 20260912 held migration sets
   the accepted set to `{exact_year}`, and 20260908120000's branch says
   explicitly: *"A row whose match was never rated (NULL) is not a rated match and
   never passes: unknown is not a verdict."* Once both land, the sentinel and
   Needs Attention exclude NULL while the screen still draws positions from it.
   That is a **fourth** answer to the one question — reintroduced by the very
   fixes meant to remove the third.
4. **The excuse has no expiry.** "Predates the 1 Sep fix" weakens as those rows
   age. Nothing in the code retires `concludes: true` when the legacy rows do.
5. **The coercion at `:858` compounds it.** Any unfamiliar grade becomes
   `unrated` and inherits `concludes: true`. Combined with 20260912's deliberate
   choice to *surface* rather than reject unknown producer grades, a scraper that
   starts writing `exact_trim` would silently acquire full conclusive authority on
   this screen. The two decisions are coupled and the reconciliation does not say so.

### Verdict

**The screen is right about the epistemics and wrong about the gate — and yes,
the reconciliation missed it.**

The reconciliation graded `competitors.js` on its *vocabulary*, where it is
genuinely the only correct surface, and did not examine what `concludes`
actually controls. `unrated` truly is not `weak`, and the refusal to call an
unrated row bad is correct. But that refusal is bought by granting an unrated row
the same authority as `exact_year`, and authority — the market position and the
percentage — is the thing at stake, not the row's visibility.

The defensible position is a third state the `QUALITY` table does not currently
have:

> **show the row and the absolute gap; withhold the percentage and the market
> position; keep the "never rated" caveat.**

Mechanically that is `concludes: false` with a distinct reason string from
`weak`'s — *"not rated"* rather than *"rated bad"* — which preserves the
distinction the file is right to insist on while removing the unearned
conclusion. It also aligns the screen with what the database is about to do,
instead of stranding it as a fourth answer.

**This changes RECONCILIATION's fix order, item 3.** When the screen is finally
made to read the setting, `unrated` must get its own branch and must *not* be
folded into the accepted set. Otherwise the screen starts publishing exactly the
positions the database has just been taught to refuse.

---

## 4. The held migrations

### `ops/migrations-held/20260908120000_the_alert_ignored_the_match_quality_it_selected.sql`

Verified against the live definition (`pg_get_viewdef('public.v_needs_attention', true)`).

* ✅ **`security_invoker = on` is inlined in the CREATE.** The stated reason
  checks out: `nexus_require_security_invoker_views()` exists on production and
  tests `NOT IN ('on','true','yes','1')`, so `= on` is accepted and a trailing
  `ALTER VIEW` would indeed arrive after the `ddl_command_end` gate has already
  fired 42501.
* ✅ **The `DISTINCT ON` fix is right.** Live is
  `DISTINCT ON (c2.competitor, c2.model) … ORDER BY c2.competitor, c2.model, c2.scraped_at DESC`
  — `tenant_id` genuinely absent, so the described cross-tenant suppression is
  real. The rewrite's `DISTINCT ON (c2.tenant_id, c2.competitor, c2.model)` with
  `ORDER BY c2.tenant_id, c2.competitor, c2.model, c2.scraped_at DESC` has a
  matching leading prefix. Correct.
* ⚠️ **"Verbatim" is true of the other branches, not of this one.** The live
  subquery selects 15 columns; the rewrite selects 7, dropping `price_aed`,
  `our_price_aed`, `ai_recommendation`, `listing_title`, `source_host`,
  `source_kind`, `offer_name`, `offer_condition`, `match_note`. None are
  referenced by the outer SELECT, so behaviour is unchanged — but the header
  should say the changed branch was trimmed, since a reader diffing it will see
  nine columns vanish.
* 🔴 **It hard-codes the dead vocabulary as its own fallback.** The new predicate:

  ```sql
  and lower(coalesce(c.match_quality,'')) = any (
        select lower(q) from unnest(
          coalesce(ips.accepted_market_match_quality, array['exact','strong'])) q )
  ```

  `ips` is a `LEFT JOIN`, so a tenant with no `inventory_profit_settings` row
  falls back to **`{exact,strong}`** — the exact set the 20260912 migration
  exists to abolish. That migration changes the column DEFAULT and UPDATEs
  existing rows; **neither reaches a literal inside a view body.** Applying the
  two in either order leaves the dead vocabulary alive inside
  `v_needs_attention`. Change the literal to `array['exact_year']`, or better:
  make a tenant with no settings row produce no undercut alerts rather than
  silently inheriting a product default, since "this dealership has not chosen"
  and "this dealership chose the default" are different facts and this codebase
  usually says so.
* ℹ️ Nothing beyond the intended branch changes. `lead_unassigned`, `sla_breach`,
  `inventory_aging`, `workflow_failure` and `kyc_archive_gap` match the live
  definition.

### `ops/f2-tenant-rule/held/20260912_the_accepted_set_named_two_grades_that_are_never_written.sql`

* ✅ **Statement order is safe.** The `UPDATE` in step 2 runs before the
  validating trigger is created, so it cannot block itself.
* ✅ **`@> array['exact']` will not false-positive on `{exact_year}`.** Array
  containment compares whole elements, so the UPDATE is correctly scoped.
* ✅ **`v_market_match_quality_drift` inlines `security_invoker = on`** — the
  lesson from the sibling file was carried across.
* ⚠️ **`market_match_quality_kind` is created with no RLS and no explicit
  grants.** Per `ops/crosscheck/X1-the-guard-fires-on-everything.md:20-21` the
  born-open guard revokes `all` from `anon` and only DML from `authenticated`,
  so `authenticated` should retain `SELECT` and the security_invoker drift view
  should be readable by a dashboard user — **but this is NOT RUN**, and the
  migration's own verify block (a) re-asserts grants for
  `inventory_profit_settings` only. Add the same grant check for the new table,
  and settle what the tenancy-readiness gate expects of a public table carrying
  no RLS policy. A catalogue with no tenant column arguably needs none; that
  should be an explicit decision in the file, not an omission.
* ⚠️ **Case handling is asymmetric between the trigger and the view.** The
  trigger compares `k.kind = q` (no fold); the drift view compares
  `k.kind = lower(c.match_quality)`. So a config of `{Exact_Year}` is rejected
  while a scrape of `Exact_Year` is merely reported as an unknown grade. That may
  be intended — config is meant to be strict — but the sentinel's own comparison
  is `lower(...)`, so making the trigger `lower(q)` would make all three agree
  and lose nothing.
* 🔴 **It will break demo provisioning.** `ops/demo/seed_demo_tenant.sql:204`
  seeds `array['exact','strong']` into the very column the new trigger guards.
  After this migration lands, seeding a demo tenant raises
  `23514: accepted_market_match_quality names grade(s) exact, strong that are
  never written`. Line 434's `'strong'` competitor row should move to
  `model_only` or `exact_year` at the same time. Fix the seed in this migration
  or immediately alongside it.
* ✅ **The asymmetry doctrine is the best thing in either file** — block a
  configuration naming a grade nobody writes, surface a scrape carrying a grade
  we do not recognise — and it is what should generalise to X4-2 through X4-5.

---

## Appendix — how the sweep was run

```sql
-- consumers with inlined literal sets, across every view and every function
select c.relname, pg_get_viewdef(c.oid,true) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('v','m')
   and (pg_get_viewdef(c.oid,true) ilike '%= any (array%'
     or pg_get_viewdef(c.oid,true) ilike '%<> all (array%'
     or pg_get_viewdef(c.oid,true) ilike '% in (%');        -- 11 views, 9 with hits

select p.proname, regexp_matches(pg_get_functiondef(p.oid),
  '(\w+\s*(?:=\s*ANY\s*\(\s*ARRAY\[[^]]{0,200}\]|<>\s*ALL\s*\(\s*ARRAY\[[^]]{0,200}\]
     |\s+IN\s*\(\s*''[^)]{0,200}\)|\s*@>\s*ARRAY\[[^]]{0,200}\]))','gi')
  from pg_proc p …;                                          -- 60 hits across 40 functions

-- every CHECK naming a value set, and every text[] allow-list with its default
-- (pg_constraint contype='c'; pg_attribute where format_type in ('text[]','varchar[]'))

-- what is ACTUALLY stored, per vocabulary column, via query_to_xml so one
-- statement measures every table:
select tbl, col, (xpath('/row/c/text()', query_to_xml(format(
  'select string_agg(t.v||'' x''||t.n,'' | '' order by t.n desc) c
     from (select coalesce(%I::text,''(NULL)'') v, count(*) n from public.%I group by 1) t',
  col,tbl), false,true,'')))[1]::text from cols;
```

Two passes were needed: the first filtered column names on `_(kind|type|status|
state|quality|source|tier|level|…)$` and **missed every bare-named column**
(`state`, `status`, `kind`, `role`, `title`). X4-4, X4-5 and X4-8 are all in the
second pass. Anyone repeating this sweep should match bare names too.
