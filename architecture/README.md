# `architecture/` — read this first

## Which file is authoritative

**`fixes/schema/schema.sql`** is the schema of record. It was generated on 2026-08-30
by reading the live catalogue of Supabase project `dsvuoovivysszdoiorch` directly —
every table, column, constraint, index, view, function, trigger, RLS policy and grant —
and it was verified by building an empty PostgreSQL 16 database from it and comparing
the result object-by-object with the live project. They match. It is safe to run against
the live project: it is a no-op.

Each table in it carries a comment explaining what it is FOR in this business. If you
change the database, change that file and say why.

## The two files in this folder are historical. Do not run either.

### `supabase_schema.sql` — **dangerous**

Running it against the live project would (1) make the `inventory` table, including
`cost_aed` — what the dealership paid for each car — readable by anyone holding the
publishable anon key, and (2) install two triggers referring to a column that does not
exist, after which every update to `leads` and `inventory` fails. Both effects were
reproduced and confirmed on a local replica of the live schema.

It also describes a `leads` table with columns this system has never had
(`first_name`, `last_name`, `phone_number`, `company`) and a status CHECK that would
reject every status the system actually uses (HOT / WARM / COLD / DISQUALIFIED).

### `database_schema.sql` — wrong, but inert

It defines seven tables no component references (`customers`, `vehicles`, `deals`,
`campaigns`, `roles`, `user_profiles`, `document_embeddings`) and an `audit_log` in a
shape incompatible with the `{workflow, status, summary}` rows every workflow posts.
Because it uses bare `CREATE TABLE`, it aborts on the first existing table, so pasting
it into the Supabase editor applies nothing.

## Where to look

* `fixes/schema/schema.sql` — what the database actually is.
* `fixes/schema/DRIFT.md` — itemised: what these two files claim, what is live, and
  every contradiction. Also lists two live defects found while checking.
* `fixes/schema/GO_LIVE.md` — the replacement for "Step 1: Deploy Supabase Schema" in
  the project blueprint, written for a non-developer.

Keep these two `.sql` files if you want the history. Do not paste them into a SQL editor.
