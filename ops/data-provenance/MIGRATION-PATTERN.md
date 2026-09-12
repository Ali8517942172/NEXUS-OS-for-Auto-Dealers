# The exact shape a provenance migration must take

Two event triggers are live on production and both fire on this work. Neither
can be worked around; both can be survived, in a specific order. Measured
definitions and current state in `MEASUREMENTS.md` §6.

```sql
select evtname, evtevent, evtenabled, evttags from pg_event_trigger order by 1;
-- nexus_guard_born_open_grants       | ddl_command_end | O | (null)
-- nexus_guard_security_invoker_views | ddl_command_end | O | {CREATE VIEW,ALTER VIEW,ALTER TABLE}
```

---

## 1. The two traps, stated as mechanics

### Trap A — `nexus_guard_born_open_grants` strips write grants

No tag filter, so it fires on **every** `ddl_command_end`. For any reported
object of type `table`, from its own body:

```sql
revoke all on <table> from anon;
revoke insert, update, delete, truncate on <table> from authenticated;
```

`SELECT` is untouched. `service_role` is untouched. A table-level `REVOKE` of a
privilege also removes that privilege's **column-level** grants, so column ACLs
go with it. `CREATE TRIGGER` reports `object_type = 'trigger'`, which is not in
the guard's list, so **`CREATE TRIGGER` costs nothing** — that is why every
constraint in this contract that can be a trigger, is one.

What each wave-1 table actually stands to lose (measured today):

| table | `authenticated` loses on any `ALTER TABLE` |
|---|---|
| `inventory` | table `DELETE`; `INSERT` on 9 cols; `UPDATE` on 8 cols |
| `leads` | `UPDATE` on 8 cols |
| `purchase_history` | **nothing** — `SELECT` only |

### Trap B — `nexus_require_security_invoker_views` fires before the next statement

It runs at `ddl_command_end` of the `CREATE VIEW` itself. A following
`ALTER VIEW … SET (security_invoker = on)` is too late: the `CREATE` has already
been rejected with **42501**. `security_invoker` must be **inlined**. And from
the guard's own `HINT`: *"CREATE OR REPLACE VIEW resets reloptions to NULL, so
the option must be restated on every replace."*

```sql
-- correct, the only correct form
create or replace view public.v_x with (security_invoker = on) as
select …;

-- rejected, 42501
create or replace view public.v_x as select …;
alter view public.v_x set (security_invoker = on);
```

Its tag list includes `ALTER TABLE`, which matters because Postgres accepts
`ALTER TABLE <view> SET (…)`; that path is checked too. It accepts any truthy
spelling — `on`, `true`, `yes`, `1`.

---

## 2. Statement order

One migration file. Stages in this order, and the order is load-bearing.

```
 0. MEASURE the ACL, in a comment, before anything                (SELECT)
 1. reference tables + attestation ledger, if not already present (CREATE TABLE)
 2. ALTER TABLE … ADD COLUMN — all four columns, ONE statement per table
 3. CREATE INDEX                                                  (no grant cost)
 4. CREATE TRIGGER for every invariant that would otherwise be
    ALTER TABLE … ADD CONSTRAINT                                  (no grant cost)
 5. RE-ASSERT every grant measured in step 0, per altered table
 6. named downward attestations, by primary key, with cited evidence
 7. a DO block that RAISES if 5 or 6 did not land
 8. views, if any, with (security_invoker = on) INLINED
 9. re-run step 5 and step 7 if step 8 touched a table
```

Everything additive. No column is dropped, no value rewritten, no view's
output changed in the same migration that adds the columns (`CONTRACT.md` §6).

---

## 3. The `ADD COLUMN` block

All four columns in **one** `ALTER TABLE`. Four separate statements fire the
guard four times, which costs nothing extra once step 5 exists, but it also
gives four chances for a partial apply.

```sql
alter table public.<t>
  add column data_origin        text not null default 'UNKNOWN'
    references public.data_origin_kind(origin)   on delete restrict,
  add column test_run_id        uuid
    references public.data_test_run(test_run_id) on delete restrict,
  add column origin_source_kind text
    references public.data_origin_source(source_kind) on delete restrict,
  add column origin_recorded_by text;
```

`not null default 'UNKNOWN'` backfills every existing row without an `UPDATE`
and without a table rewrite (Postgres 11+ stores the default in the catalogue).
On production that is 5 `leads`, 12 `inventory`, 1 `purchase_history` rows —
but the same statement must be correct on a tenant with 400,000 rows.

The FK is the vocabulary enforcement of `CONTRACT.md` §5.1. `on delete restrict`
means a value cannot be retired out from under existing rows.

---

## 4. Constraints as triggers, not as `ALTER TABLE`

The symmetry rule of `CONTRACT.md` §7 needs a subquery, so it cannot be a
`CHECK` anyway — which is convenient, because the trigger form is also the one
that costs no grants.

```sql
create or replace function public.nexus_guard_data_origin()
returns trigger language plpgsql
set search_path to 'pg_catalog','public' as $$
declare k public.data_origin_kind%rowtype;
begin
  select * into k from public.data_origin_kind where origin = new.data_origin;
  -- the FK guarantees k is found; if it is not, fail rather than assume
  if not found then
    raise exception 'data_origin % is not in data_origin_kind', new.data_origin
      using errcode = '23503';
  end if;

  if k.requires_test_run and new.test_run_id is null then
    raise exception '% requires a registered test_run_id', new.data_origin
      using errcode = '23514',
            hint = 'Register the run in data_test_run first; it is what makes teardown provable.';
  end if;
  if not k.requires_test_run and new.test_run_id is not null then
    raise exception '% must not carry a test_run_id', new.data_origin
      using errcode = '23514';
  end if;

  -- REAL is never reachable by an ordinary writer, service_role included.
  if k.requires_attestation
     and coalesce(current_setting('nexus.attesting', true), 'off') <> 'on' then
    raise exception 'data_origin % may only be set by nexus_attest_data_origin()',
      new.data_origin
      using errcode = '42501',
            detail = 'Default is UNKNOWN. REAL requires an attestation event, '
                     'not the absence of a test marker.',
            hint   = 'call public.nexus_attest_data_origin(...)';
  end if;
  return new;
end $$;

create trigger <t>_data_origin_guard
  before insert or update of data_origin, test_run_id on public.<t>
  for each row execute function public.nexus_guard_data_origin();
```

`CREATE FUNCTION` **does** fire the ACL guard (object type `function`), which
runs `revoke all on function … from anon`. That is a no-op here and is not a
grant this contract wants. `CREATE TRIGGER` fires the guard and matches none of
its object types.

---

## 5. Grant re-assertion — the block, and the reason

**The reason, in one paragraph.** On 6 September 2026, migration
`20260906065739` ran two `ALTER TABLE`s against `public.inventory`. The guard
fired and stripped, silently, with no grant-shaped diff to review, the table
`DELETE` and the nine `INSERT` / eight `UPDATE` column grants the unit form
needs. `apps/executive-dashboard/lib/unit-form.js` would have returned 42501 on
save. It was repaired the same day by
`supabase/migrations/20260906071310_restore_inventory_write_grants_the_acl_guard_stripped_on_alter.sql`,
whose own header says the guard *"is not changed here, deliberately"* and that
*"EVERY future ALTER TABLE against public.inventory or public.leads silently
deletes the dashboard's write grants."* This is that file's instruction, carried
out.

**Step 0 — measure, and paste the result into the migration as a comment.**
Never re-assert from memory or from this document; the ACL is the source.

```sql
select table_name, grantee, privilege_type,
       string_agg(column_name, ', ' order by column_name) cols
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('leads','inventory','purchase_history')
  and grantee in ('authenticated','anon')
group by 1,2,3 order by 1,2,3;

select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('leads','inventory','purchase_history')
group by 1,2 order by 1,2;
```

**Step 5 — re-assert exactly that, no more.** Measured 9 Sep 2026:

```sql
-- inventory: table DELETE + 9 INSERT columns + 8 UPDATE columns
grant delete on public.inventory to authenticated;
grant insert (id, model, vin, status, price_aed, cost_aed,
              ai_recommendation, acquired_at, tenant_id)
   on public.inventory to authenticated;
grant update (id, model, vin, status, price_aed, cost_aed,
              ai_recommendation, acquired_at)
   on public.inventory to authenticated;

-- leads: 8 UPDATE columns, no table-level write
grant update (assigned_to, assigned_to_id, budget_aed, email,
              name, phone, status, vehicle_interest)
   on public.leads to authenticated;

-- purchase_history: nothing to re-assert. SELECT only, and SELECT is not revoked.
```

**The four new columns are deliberately absent from every list above.** They are
readable — table-level `SELECT` covers columns added later — and not writable by
`authenticated` (`CONTRACT.md` §4, mechanism 1). Adding them to the `UPDATE`
list would hand the dashboard the ability to mark its own data real.

**Does the re-asserting `GRANT` itself survive the guard?** `GRANT` also fires
`ddl_command_end`, and the guard's `nexus.acl_guard` re-entry flag is
`is_local = true`, so it does not suppress the guard across statements
(`ops/channel-events/WIRING-SPEC.md:724`). Measured answer: **yes** — `inventory`
holds all of the above on production today, restored by exactly this kind of
GRANT-only migration whose own `DO` block would have raised otherwise. The
mechanism (a `GRANT` reports no `object_identity`, so the guard's `format()`
yields `NULL`, `execute NULL` raises, and its `exception when others then null`
swallows it) is **INFERRED, NOT MEASURED** — I ran no DDL on either project.

**Which is why step 7 exists and is not optional.** The pattern does not rely on
the mechanism; it verifies the outcome.

```sql
do $$
declare
  inv_delete boolean := has_table_privilege('authenticated','public.inventory','DELETE');
  inv_ins    integer := (select count(*) from pg_attribute a
                          where a.attrelid='public.inventory'::regclass
                            and a.attnum>0 and not a.attisdropped
                            and a.attacl is not null);
  lead_upd   boolean := has_any_column_privilege('authenticated','public.leads','UPDATE');
  anon_any   boolean := exists (
                 select 1 from information_schema.role_table_grants
                  where table_schema='public' and grantee='anon');
begin
  if not inv_delete or inv_ins < 9 or not lead_upd then
    raise exception
      'ACL guard ate the dashboard write grants: inventory.delete=% inventory.column_acls=% leads.update=%',
      inv_delete, inv_ins, lead_upd;
  end if;
  if anon_any then
    raise exception 'anon holds a table grant in public after this migration; it held none before';
  end if;
end $$;
```

A migration that reports success over a broken save screen is worse than one
that fails.

---

## 6. Views

Any view that surfaces provenance must inline the option and must join
`data_origin_kind` rather than name a value (`CONTRACT.md` §5.4):

```sql
create or replace view public.v_lead_provenance with (security_invoker = on) as
select l.tenant_id, l.id as lead_id,
       l.data_origin, k.counts_as_real, k.is_test, k.description as origin_meaning,
       l.test_run_id, r.label as test_run_label,
       l.origin_source_kind, l.origin_recorded_by
from public.leads l
join public.data_origin_kind k on k.origin = l.data_origin
left join public.data_test_run r on r.test_run_id = l.test_run_id;

grant select on public.v_lead_provenance to authenticated;
```

The `join` (not `left join`) on `data_origin_kind` is deliberate: a row whose
origin is not in the registry should make the row **disappear from a provenance
view**, loudly, rather than render with a blank grade. The FK should make that
unreachable; invariant I4 in `CONTRACT.md` §5.3 checks that it is.

If step 8 alters a table, run step 5 and step 7 again afterwards.

---

## 7. Worked example

`held/20260909_purchase_history_provenance.sql` — **held deliberately outside
`supabase/migrations/`.** It is not queued for apply and its filename carries no
migration timestamp prefix that the CLI would pick up.

`purchase_history` is the worked table because it is the one the owner was right
to hesitate over, and because measurement changes the answer: it has **no
`authenticated` write grants to lose**, so the grant fear does not apply there.
The fear is correct for `inventory` and `leads`. The file re-asserts anyway, and
says why in a comment — the re-assertion block is cheap and the day it stops
being a no-op is the day someone grants the dashboard a write path.

Its one row is the AED 585,000 sale. The file does **not** attest it. It cannot:
`MEASUREMENTS.md` §5.4 shows the row's `deal_id` names a different email from
its own `customer_name` and from the lead it points at, and no query settles
whether it is ALBA's sale or a setup artefact. It becomes `UNKNOWN`, and the
open question goes to the owner.
