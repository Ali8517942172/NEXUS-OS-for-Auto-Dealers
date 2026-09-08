# Docs reconciliation, 5 September 2026 — index of what changed

Scope: `.md` files at the repo root, `supabase/README.md`, and two new documents.
**Nothing under `apps/` was touched** (other agents are editing it), and
`AUDIT-2026-09-04.md` was deliberately left byte-for-byte as the dated record it
is. `CLAUDE.md` was not edited either — it is operative and was not in scope;
three discrepancies found in it are listed at the end.

All figures below were measured on 5 September 2026 against production
`dsvuoovivysszdoiorch` through `mcp__Supabase__execute_sql` (read-only), or
computed locally over the repository, or read out of a commit. No migration was
applied and no write was made.

---

## New documents

| file | what it is |
|---|---|
| `STATUS-2026-09-05.md` | What moved since `AUDIT-2026-09-04.md`, item by item against its own 11-row checklist, plus its other open findings, the two places it was wrong, everything still open, and three things that could not be verified either way |
| `VERSIONS.md` | V1→V4 mapped to M0–M8, with every capability stated against four separate columns — implemented / tested / production-proven / commercially validated — and UNKNOWN written where a column is unknown |

## Documents corrected

| file | what was wrong |
|---|---|
| `supabase/README.md` | 255 migrations → **273**; 1,702,345 bytes → **1,809,043**; rollup `3946a4fe…` → **`4f9bd212…`**; restore-path step 4 said "today that is none" and it is now **18 files, 106,698 bytes**; the history-stamp digest `7a5968e5…` could not be reproduced and was replaced with the measured `8d5ecffc…`; the fingerprint table was date-stamped to the baseline version and a current-catalogue paragraph added; known deviation 3 (stale gate snapshot) marked closed |
| `ARCHITECTURE.md` | 40 tables / 33 views → **59 / 39**; gate reading `NOT RUN 4` → **6** with the failing checks named; "a dashboard login is not read-only" → closed, with the `rbac_02`-not-shipped and model-is-inert caveats; "0 of 7 policy rules verified" → **0 of 13**, 0 attestations; the unattributed-default quarantine added; `architecture/README.md`'s "no schema file you can run" superseded by `supabase/` |
| `README.md` | Status table re-measured (114 messages, 742 audit rows, 273 migrations, 0 paying customers, 0 of 13 policy rules verified, messaging layer at 0 rows); known limit 2 rewritten as a role model that exists and is inert; limit 3 rewritten around the quarantine and the census; **Tailwind removed from the tech stack** (it is a stale devDependency, `postcss.config.js` records the removal — this contradicted `ARCHITECTURE.md`); "no role-based access control" corrected; `supabase/` described as holding all 273 migrations |
| `PRODUCT.md` | `communication_logs` 108 → **114** with the "not a message count" caveat; `competitors` 14 → **19**; `policy_rule` 7 → **13**; the 14-vs-20 screen split re-counted on both refs; `purchase_history` row labelled as the owner's test lead, not a customer sale; the competitor run statistics marked as 3 September and not re-measured |
| `NEXUS_INVARIANTS.md` | New dated `Re-check 2026-09-05` section: **seven new enforcement mechanisms** named (three-part role model, the quarantine CHECK, the policy-citation FK, eight composite carrier FKs, the minted-id CHECKs, the delivery `status_key`, gate check `L12`); the two gate checks that tested for a mechanism's *presence* rather than its *effect* recorded; figures that moved; the "two gate checks are FAILING" section corrected (L2 is now one deliberate row, not ten; NOT RUN 4 → 6); "the authoritative schema is nothing in this repository" superseded; a `Last check — 2026-09-05` table appended |
| `CONTROL-PLANE.md` | Part 5 given a status table and each of 5.1–5.9 marked CLOSED / NARROWED / OPEN with what closed it; its own premise ("no role check in the database or the UI") corrected; the eight unpredicted leaks recorded, including raw `audit_log.summary` putting the VM's public IP on a dealership screen; 5.2 kept open with its follow-on "withheld must not render as absent" lesson; Part 7 item 1 marked frontend-done / database-not, with the remainder listed |
| `ROADMAP.md` | The "Now" list items 1–6 each marked closed with what closed it **and what is still open inside it**; item 7 rewritten as the real remaining order; production counts re-measured; a pointer to `VERSIONS.md` for the four-column distinction |
| `LAUNCH.md` | Track A turned into a measured status table; the five revenue-control loops corrected — "each is mostly built already" holds for **two of five**; **"Today's Money Leaks" recorded as not existing on either branch**; Track B recorded as having produced nothing measurable |
| `commercial/WHAT-WE-CLAIM.md` | Version 2.2 header; the "a dashboard login only lets someone look" row rewritten as a role model that exists and has never been used; the multi-tenant row corrected — readiness now reports **zero BLOCKERs** and that still does not make the claim sayable, with the real remaining reasons; unclaimed KYC files no longer fall to the default dealership; message and audit counts re-measured with the "not a count" caveat on `communication_logs`; gate NOT RUN 4 → 6; four new rows in the final verification table (policy rules, the messaging layer, migrations, the quarantine tenant) |

---

## The corrected counts, in one place

| | value | how |
|---|---|---|
| migration versions, production | 273 | `count(*)` on `supabase_migrations.schema_migrations` |
| migration files, repository | 273 | `ls supabase/migrations/*.sql` |
| total bytes, both sides | 1,809,043 | `sum(octet_length(statements[1]))` / `find -printf %s` |
| rollup, both sides | `4f9bd21234f8cfe6079184432d6120ad` | `md5` over `version:md5(body)`, newline-joined, no trailing newline, version order |
| max version, both sides | `20260905211435` | |
| baseline version | `20260904142907` | the baseline's own first line |
| migrations after the baseline | 18 files, 106,698 bytes | |
| history stamp, both sides | `8d5ecffc85e7d8c12848cf9c2b092a49` over 255 pairs | `md5` over `version\|name`, newline-joined, version order |
| baseline file | `334b0b1cbfa15fe0e27c1f424323f1b4`, 777,711 bytes | unchanged from what the README claims |
| catalogue | 59 tables, 39 views (39/39 `security_invoker`), 269 functions, 374 constraints, 169 indexes, 163 policies, RLS 59/59 | |
| rows | leads 3 · inventory 12 · `communication_logs` 114 (0 external ids) · `processed_messages` 73 · `purchase_history` 1 · `audit_log` 742 · `kyc_documents` 3 (all REJECTED) · `competitors` 19 · `rag_documents` 15 · `finance_quotes` 0 (25 ins / 15 del) · `workflow_registry` 18 · `channel_registry` 1 · every other messaging table 0 · tenants 2 (1 active) · `tenant_members` 1 · users 1 | |
| policy | 13 rules, 0 verified, 0 attestations | |
| `nexus_tenancy_readiness()` | 0 BLOCKER, 2 WARN, 2 INFO | |
| `nexus_quarantine_census()` | 0 rows | |
| screens | `origin/main` 14, branch 20 | `lib/nav.js` on both refs |
| gate, last full-lane run | PASS 26 · FAIL 2 · WARN 2 · NOT RUN 6, exit 1, 2026-09-05T21:01Z | `/home/claude/out/gate-2026-09-05.md` |

## Constraints verified present in production

`channel_send_directive.policy_applied_rule_id → policy_rule(id)` (1) ·
composite FKs to `channel_registry(integration_id, tenant_id)` (**8**) ·
`communication_logs_external_identity_key` ·
`tenants_unattributed_default_must_be_quarantine` ·
6 RESTRICTIVE policies on `inventory`/`leads` ·
`tenant_members.role` CHECK with the six-value vocabulary ·
trigger `inventory_guard_cost_change` ·
`workflow_registry` readable by `authenticated` on 7 of 10 columns
(`id`, `trigger_type`, `trigger_detail` withheld) ·
no table in `public` grants `authenticated` a table-level UPDATE.

---

## Could not be verified either way — listed, not decided

1. **The history-stamp digest `7a5968e5668b6b64a1ebe255a3773bdc`** previously
   published in `supabase/README.md`. Not reproducible from the stamp file or
   from production under any separator tried, over either 243 or 255 pairs. The
   measured value is recorded; the old one is marked unverified.
2. **Staging parity after the eighteen migrations of 5 September.** It held on
   4 September. Two of tonight's proofs ran on staging, so it is not stale — but
   no fingerprint comparison was run. **UNKNOWN.**
3. **Which n8n workflows omit `tenant_id`.** Unanswerable from this repository:
   `n8n-workflows/*.json` is a 30 August export with zero occurrences of the
   column. The quarantine census is the only instrument and reads zero so far.
4. **Whether any production row ever arrived via the unattributed default.**
   Structurally unknowable with one dealership.
5. **Why `processed_messages` fell from 100 (2 Sep) to 76 (3 Sep) to 73
   (5 Sep).** A teardown is the obvious explanation and nothing records it.
6. **Every workflow run statistic** quoted in `README.md`, `PRODUCT.md` and
   `commercial/WHAT-WE-CLAIM.md` (65 finance runs, 168 competitor runs, 8 drip
   runs, 27 Customer 360 runs, the `v_workflow_health` gradings). These come
   from the n8n box and `v_workflow_health`, neither of which this pass read.
   They carry their 3 September date and were **not** re-measured.
7. **Whether the finance calculator works today.** The fix to the constraint
   that broke it is nine minutes younger than the last failure and has not been
   exercised since.

## The ghost-stack sweep

Make.com, Zapier, MongoDB, Odoo, FastAPI, React, Socket.io, OpenAI. **No
document in the repository describes any of them as being in the live path.**
Every hit is a denial: `ARCHITECTURE.md` §"Not in the stack",
`docs/MASTER_ROUTER.md` ("Make.com and Zapier are empty"),
`apps/automation-engine/README.md` ("fully removed"),
`apps/executive-dashboard/README.md` ("no framework and no Tailwind"),
`architecture/diagrams/System_Architecture.md` ("None of those exists").
`docs/AI_Development_Workflow.md` names "Codex (OpenAI)" as a *development
tool*, which is a different claim. `PRODUCT.md`'s only hit is the substring
`react` inside `CUSTOMER_REACTIVATION`.

**The one document that still describes that architecture as real is the
project's own blueprint** — the AutoDealer AI OS Master Blueprint held as the
claude.ai project instructions, which describes Make.com as the master router,
Zapier catchers, MongoDB as a data lake, Odoo ERP, a FastAPI RAG service and a
Node.js/Socket.io dashboard, and instructs the reader to import blueprints into
Make.com and Zapier. A replacement already exists at
`/home/claude/out/BLUEPRINT-REPLACEMENT.md` and as project doc
`claude/nexus-BLUEPRINT-REPLACEMENT-paste-into-project-instructions.md`. **It has
not been pasted in.** It is outside this repository and outside this pass's
scope, and it is the first thing a reader of the project sees.

## Three discrepancies found in `CLAUDE.md` — reported, not edited

`CLAUDE.md` was out of scope for this pass. Flagged so the next agent can
measure rather than inherit:

1. **`finance_quotes` "shows 16 inserts and 13 deletes".** Live
   `pg_stat_all_tables` reads **25 inserts and 15 deletes**, which is what
   `NEXUS_INVARIANTS.md` has recorded since 3 September.
2. **"`nexus_quarantine_census()` … which it now surfaces as a WARN."** The
   function's output on production carries **2 WARNs and neither is the census**
   — the census is named inside an INFO row's detail text.
3. **"`whatsapp_customer_message_seen` … defeated by the live `nokey:` shape."**
   True when written; a CHECK added 5 September (`23514`) means it is not
   defeatable that way now. The commit says so; the file has not been updated.
