# The ALTER is safe, and the reason we all gave for why is wrong

12 September 2026. Orchestrator cross-check, run directly after four reviewer
agents were cut off by a weekly rate limit. Production `dsvuoovivysszdoiorch`,
read-only. Every verdict below is from `pg_get_functiondef` or
`information_schema`, re-run by me rather than taken from a sibling's document.

## Claim under review

`ops/data-provenance/` and `ops/f1-test-revenue/` independently concluded that
the owner's refusal to `ALTER TABLE public.purchase_history` rests on a premise
that does not apply to that table. Two agents agreeing is weak evidence when both
may have read the same function the same way, so this was verified from source.

## VERDICT 1 — grant-safe on `purchase_history`. CONFIRMED, high confidence.

`nexus_guard_born_open_grants()` does exactly two things to a table:

```
revoke all on <obj> from anon
revoke insert, update, delete, truncate on <obj> from authenticated
```

And `purchase_history` holds, for those two roles:

```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='purchase_history';
--  authenticated | SELECT      ← the only one
--  postgres      | all 7
--  service_role  | all 7
```

`anon` appears nowhere, at table level or column level. `authenticated` holds
SELECT at table level and SELECT on all ten columns — and nothing else. Both
REVOKEs are no-ops. Adding a column to this table cannot lose a grant, because
there is no revocable grant to lose.

**This does not generalise.** On `inventory` and `leads`, `authenticated` holds
real write privileges, and a table-level `REVOKE INSERT` removes column-level
INSERT too. The owner's instinct was right as a standing rule; it is this one
table that is the exception, and it is the exception by measurement, not by
argument.

## VERDICT 2 — a second event trigger also fires, and nobody mentioned it.

Neither sibling enumerated the event triggers. There are eight; two are ours:

```sql
select evtname, evtevent, evttags::text from pg_event_trigger;
--  nexus_guard_born_open_grants       | ddl_command_end | NULL
--  nexus_guard_security_invoker_views | ddl_command_end | {"CREATE VIEW","ALTER VIEW","ALTER TABLE"}
```

`nexus_guard_security_invoker_views` lists **`ALTER TABLE`** among its tags. So an
`ALTER TABLE public.purchase_history ADD COLUMN` fires the security-invoker gate
as well as the grant guard. Reading its body settles it: the loop filters
`WHERE ddl.object_type = 'view'`, an ALTER TABLE on a plain table reports no view,
`v_bad` stays empty, and no exception is raised. **Harmless — but it was luck that
nobody checked, not design.** A future ALTER TABLE that cascades into a dependent
view will surface that view to this gate, and if the view's `security_invoker`
reloption was reset it will abort the migration with 42501.

## VERDICT 3 — CORRECTED, and the correction lands on me, not on the repo.

The sentence "CREATE TRIGGER does not fire the guard" appears in my briefing to
all five agents today, in the conversation summary I was working from, and in
`ops/data-provenance/MIGRATION-PATTERN.md`. Taken literally it is false.

`nexus_guard_born_open_grants` has `evttags = NULL`, which in Postgres means it
fires on **every** `ddl_command_end`, for every command tag, with no filter.
`CREATE TRIGGER` fires it like everything else. What is true is narrower:
`CREATE TRIGGER` reports `object_type = 'trigger'`, which matches none of the
guard's three branches, so the loop body does nothing. Same outcome, different
reason — which is exactly why the short version survived unchallenged.

**`CLAUDE.md:1085-1093` already says this correctly** and says it was measured on
staging in a rolled-back transaction — 8 column grants before and after, `relacl`
byte-identical. So the repo's own record was right and my compressed restatement
of it was wrong, and I propagated the compressed version to five agents. The
lesson is not about Postgres. It is that a precise finding degrades into a
convenient slogan within days of being written down, and the slogan is what gets
quoted into the next decision.

The difference matters because after the loop the guard runs an **unconditional**
block that re-asserts the schema door:

```
if has_schema_privilege('anon','public','USAGE') then
  revoke usage on schema public from public;  ...
```

That block runs on `CREATE TRIGGER` too. "Doesn't fire the guard" would imply the
schema door is untouched; it is not. Both sibling designs route around the grant
guard by preferring `CREATE TRIGGER`, and that routing is still correct — only
the reason recorded for it needs the precise wording.

## VERDICT 4 — the guard cannot report its own failure. Unflagged by anyone.

Every branch is wrapped `exception when others then null`, and the whole function
ends `exception when others then` a reset and a silent return, commented *"Never
abort somebody else's DDL, including a Supabase platform upgrade."*

That is a defensible choice for a guard that must not break a platform upgrade.
Its cost is that **a REVOKE that fails leaves a grant open and says nothing.** The
guard is named for catching objects that are born open; it can itself fail to
close one, and the only way to find out is to query the ACLs afterwards.

This is the same failure shape as `ops/f2-tenant-rule/RECONCILIATION.md`: a
control whose silent failure is indistinguishable from its silent success. Three
instances now — the empty match-quality filter, the message send that writes no
row, and a grant guard that swallows its own exceptions. It is a class, not a
coincidence: **this system's controls report nothing when they do nothing.**

The migration pattern in `ops/data-provenance/MIGRATION-PATTERN.md` already
verifies the outcome rather than trusting the mechanism, which is the correct
response. That approach should be the rule for every guard-adjacent migration,
and the reason is this verdict.

## Not reviewed — the four agents were cut off

`ops/crosscheck/X2-isolation.md` (H1–H12), `X3-durability-and-identity.md`, and
`X4-match-quality-vocabulary.md` were commissioned and did not complete. Their
targets remain **unreviewed by an independent agent** — in particular the twelve
isolation holes, the `processed_messages` retention-decay finding, and the claim
that no repo file writes `match_quality`. Treat those as single-source until a
reviewer confirms them. NOT RUN is not PASS, and that applies to this wave's own
review as much as to anything it reviewed.
