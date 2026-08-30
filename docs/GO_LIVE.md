# Go-live: the database step

**Replaces "Step 1: Deploy Supabase Schema" in the project blueprint.**

---

## Do not run `architecture/supabase_schema.sql`

The blueprint tells you to open `architecture/supabase_schema.sql`, paste it into the
Supabase SQL editor and hit RUN. **Do not do that.** Not now, not later, not "just to
be safe".

Two things would happen the moment you did.

1. **Your buy prices become public.** The file adds a rule that lets *anyone* read the
   `inventory` table — including `cost_aed`, what you paid for each car, and the margin
   on it. Not just your staff. Anyone who opens the dashboard in a browser can get the
   key needed to read it. This has been tested and confirmed.
2. **Your dashboard stops being able to save anything.** The file adds two hidden rules
   to `leads` and `inventory` that refer to a column those tables do not have. After
   that, assigning a lead, changing a lead's status, editing a car, and the nightly
   ageing/holding-cost calculation all fail with an error. Also tested and confirmed.

`architecture/database_schema.sql` is likewise not to be run. It describes a completely
different database — seven tables the system has never used, and an `audit_log` in a
shape that would break every workflow's logging.

Both files are historical. They were written before the system existed and were never
updated. See `DRIFT.md` for the full list of what they get wrong.

---

## What to do instead

**Your database is already deployed.** Project `dsvuoovivysszdoiorch` is live and
correct: 16 tables, 6 views, 9 functions, 3 triggers, 30 security rules, one nightly
scheduled job and one private storage bucket. There is nothing to paste and nothing to
run. Skip the step entirely and go to the Make.com step.

### If you only want to check it is healthy

1. Open the Supabase dashboard for project `dsvuoovivysszdoiorch`.
2. Go to **Table Editor**. You should see 16 tables, including `leads`,
   `communication_logs`, `inventory`, `kyc_documents` and `rag_documents`.
3. Go to **Storage**. There should be one bucket, `kyc-documents`, marked **private**.
   If it ever shows as public, make it private immediately — it holds customers'
   identity documents.

### If you are ever setting up a *new* Supabase project (staging, or a rebuild)

1. Open the new project's **SQL editor**.
2. Paste the whole of **`fixes/schema/schema.sql`** — that file and no other — and RUN.
3. In the SQL editor, run this one line to start the nightly metrics snapshot:

   ```
   select cron.schedule('nexus-daily-metrics', '50 19 * * *',
                        $$select public.capture_daily_metrics();$$);
   ```

4. Go to **Storage → New bucket**, name it `kyc-documents`, and leave "Public bucket"
   **OFF**.
5. Copy the new project's URL and keys into n8n and into the dashboard.

`schema.sql` is safe to run twice — running it against a database that already has
everything changes nothing.

---

## One thing that does need a developer, soon

There is a fault in the live database, unrelated to these files, found while checking
them: a function used when logging replies has the wrong data type, so **the next
WhatsApp or email reply sent to a customer who is already in the system will fail to
save**. It is a one-word fix, but it is a code change, not a click. Details are in
`DRIFT.md` under "Live defects found during introspection", item A. Get it done before
the next customer conversation.

---

## The rest of go-live is unchanged

Make.com blueprint import, Zapier catchers, n8n workflow imports and credentials — all
as written in the blueprint. Only the database step changes.
