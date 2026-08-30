# RISKS — CRM synchronisation fix

Apply order is **not optional**: `migration.sql` → `OPERATIONS_erpsync.json` →
`OPERATIONS_customer360.json`. Both operation files reference columns and
defaults the migration establishes.

---

## 1. What could break — `wf_108 ERP Sync`

| Risk | Why it could happen | What it looks like | Mitigation / response |
|---|---|---|---|
| **`crm.duplicate.findbycomm` is also behind the plan wall** | The portal currently answers `403 FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN` on the CRM write (P6, carried in the J1 runbook §6/A3). Whether the *duplicate-control* method is gated on the same tier is **not verifiable from files**. | Every run audits FAILED with `Bitrix duplicate lookup did not answer`. | This is the fix behaving correctly — it refuses to create blind. But it means **nothing syncs at all** until the plan is raised, where before the plan wall at least the (broken) create was attempted. Decide explicitly whether that is acceptable; if not, the workflow must stay off rather than be loosened. |
| **`entity_type: 'LEAD'` is the wrong casing/keyword for this portal** | `crm.duplicate.findbycomm` accepts `LEAD` / `CONTACT` / `COMPANY`; the response key is `result.LEAD`. Not testable offline. | Probes return `{result: []}` for a customer who *is* in Bitrix → the run creates a duplicate anyway. | **Highest-priority post-apply check** — see §3, check 1. Verify against a lead you know exists before enabling for the backlog. |
| **Bitrix rate limiting** (~2 req/s per webhook) | Up to 3 REST calls per lead × 100 leads. | `QUERY_LIMIT_EXCEEDED` in `audit_log` summaries; run approaches the 300 s `executionTimeout`. | Lower `limit` on `Fetch HOT Leads from Supabase` from 100 to 25–50. The watermark means the remainder is simply picked up on the next invocation. |
| **`or=()` watermark syntax** | PostgREST `or=(crm_synced_at.is.null,crm_synced_at.lt."…")` — the quoted ISO timestamp is correct PostgREST but was not executed. | HTTP 400 from PostgREST; the node throws (`onError: stopWorkflow`) and the run dies loudly. | Loud failure is the intended behaviour for a broken fetch. Test the URL once with curl before enabling — see §3, check 0. |
| **`leads.email` is not unique / `Link Back to Supabase` patches several rows** | The crosswalk PATCH keys on `email=eq.…`. `create_missing_tables.sql` creates `leads_email_key` as a partial unique index, so this should be safe. | Several leads share one `bitrix_lead_id`. | Verify the index exists before applying. If it does not, change the PATCH to key on `id=eq.` and carry `_lead_id` (already emitted by `Map Lead to Bitrix24 Lead`) — but note the sub-workflow path may not supply `lead.id`, which is exactly why email was chosen. |
| **`Called by Master Router` payload lacks `bitrix_lead_id` / `crm_synced_at`** | The sub-workflow path passes a lead object assembled by the router, not a full `leads` row. | Hot-path syncs always fall through to the phone probe (correct, just one extra call) and never suppress the OPPORTUNITY fill on a human-touched record. | Acceptable. If the router is later extended, adding those two keys to its payload restores both optimisations with no change here. |
| **Bitrix `DATE_MODIFY` timezone** | Bitrix returns portal-local ISO; `crm_synced_at` is UTC. A portal set to Asia/Dubai with no offset in the string would read as 4 hours in the future. | `touchedSinceUs` is true more often than it should be. | Failure mode is **conservative** — it only suppresses the fill-if-empty OPPORTUNITY write. Nothing is overwritten either way. Confirm the format once in the first execution's `Fetch Existing Bitrix Lead` output. |
| **`Verify JWT` still carries a hardcoded anon JWT in the node body** | Pre-existing; untouched by this fix. | — | Out of scope, flagged. |

## 2. What could break — `Customer 360`

| Risk | Why | Response |
|---|---|---|
| **PostgREST insert with an omitted column** | The whole "omit rather than zero" mechanism assumes PostgREST builds its column list from the request body. True for a **single JSON object**, which is what the HTTP node sends per item. Sending an **array** with heterogeneous keys would raise `All object keys must match`. | Do not change `Supabase - Upsert Profile` to batch items. |
| **`Normalise Customers` now drops rows without an `id`** | `v_customer_directory`'s definition is **not in any file read** — it is a live view. If it can emit rows with a null `id`, those customers silently stop being profiled. | Run §3 check 5. If such rows exist, fix the view; do not reintroduce the email fallback. |
| **`mail_email` is a new field** | Every consumer downstream of `Normalise Customers` in this workflow was updated. If any other workflow reads that node's output, it is unaffected — n8n nodes are not shared. | None. |
| **Gmail sentinel still costs an API call per emailless customer** | Deliberate: a branch would make `$('Gmail - Get Emails')` throw in two Code nodes. | Accept, or add a Gmail-side quota alert. |
| **`Get Customer Directory` has no explicit `limit`** | Pre-existing. On a 958 MB box a large directory is a memory risk, bounded only by PostgREST's `max-rows`. | Not changed, because an unannounced `limit` silently drops customers. Check `select count(*) from v_customer_directory` and set `db-max-rows` deliberately if it is large. |
| **`Delivery Report` may be deferred past the loop** | `Supabase - Upsert Profile` fans out to `Split In Batches` and `Delivery Report`, both at y=304; `executionOrder: v1` orders fan-out by canvas y-position, so the tie is resolved by internal ordering, not by intent. | Pre-existing and **unchanged**. The J8/J10 runbooks observe one `audit_log` row per customer, so it currently interleaves correctly. Moving `Delivery Report` to a distinct y would make it deterministic — deliberately not done here, to keep this change set to the three defects. |

## 3. Post-apply checks, in order

0. **Before enabling anything**, curl the new fetch URL by hand and confirm a
   200 and a bounded row set:
   `.../leads?select=id,email,phone,bitrix_lead_id,crm_synced_at&status=eq.HOT&or=(crm_synced_at.is.null,crm_synced_at.lt."2026-08-30T00:00:00.000Z")&order=created_at.desc&limit=5`
1. **Prove the phone probe matches a lead you know exists.** POST
   `crm.duplicate.findbycomm.json` with
   `{"entity_type":"LEAD","type":"PHONE","values":["+9715…","0 5…","5…"]}`
   for a customer already in Bitrix, and confirm `result.LEAD` contains the id.
   **If this returns empty, stop** — every run will create duplicates.
2. **Run once against a single known-existing phone-only lead**, and check the
   `audit_log` row says `updated (ID …) via Bitrix phone duplicate index`.
   Confirm in the Bitrix UI that **no new lead appeared**.
3. **Paste a note into that lead's COMMENTS in Bitrix, by hand.** Re-run.
   Confirm the note survives verbatim above the `[NEXUS-SYNC:BEGIN]` block, and
   that `OPPORTUNITY` and `TITLE` are unchanged.
4. **Re-run a third time with nothing changed.** Expect
   `not attempted: nothing to change`, status SUCCESS, and an unchanged
   Bitrix `DATE_MODIFY`.
5. **Directory integrity:**
   `select count(*) from v_customer_directory where id is null;` → expect 0.
6. **Customer 360, honest zero:** temporarily point Gmail at a broken
   credential, run one customer whose stored `total_emails` is non-zero, and
   confirm the value is **unchanged** in `customer_360_profiles` and that the
   `audit_log` summary says `email count UNKNOWN`.
7. **`audit_log` sweep** after the first full run:
   ```sql
   select status, count(*) from audit_log
   where workflow = 'wf_108 ERP Sync - Bitrix24'
     and logged_at > now() - interval '1 day'
   group by 1;
   ```

## 4. Cleaning up duplicates that already exist

**The fix stops new duplicates. It does not undo old ones, and it never deletes
anything in Bitrix.** Three steps.

### 4a. Detection is now automatic

`Decide Update or Create` collects **every** id both probes matched. When there
is more than one, `Build Audit Row` writes it into `audit_log`:

```
… | DUPLICATES IN BITRIX: lead ids 412,517,690 all match this customer; kept 412, merge the rest
```

The lowest id is kept — the oldest record, the one reps have been typing into.
Harvest the backlog with:

```sql
select lead_email, lead_name, summary, logged_at
from audit_log
where workflow = 'wf_108 ERP Sync - Bitrix24'
  and summary like '%DUPLICATES IN BITRIX%'
order by logged_at desc;
```

To build the list without waiting for a natural run, invoke the workflow with
the watermark widened (temporarily raise `limit`, or clear `crm_synced_at` for a
batch). Every lead is probed before anything is written, so a **detection-only
pass is inherently safe**: pointing `BITRIX24_WEBHOOK_URL` at a read-only
webhook (one whose permission scope excludes `crm.lead.add`/`update`) makes the
pass provably non-mutating — the writes fail, the audit rows still carry the
duplicate lists.

### 4b. Independent detection straight from Bitrix

Do not rely only on our own audit trail — it only sees customers that are still
`HOT` in Supabase.

* `crm.duplicate.findbycomm` per known phone (as in check 1) — authoritative,
  because it is Bitrix's own index.
* Or page `crm.lead.list` with
  `select: ["ID","TITLE","PHONE","EMAIL","DATE_CREATE","COMMENTS"]`, `start`
  paging in 50s, and group client-side on the **normalised** phone (strip
  non-digits, compare the last 9). Expect clusters whose `TITLE` and
  `DATE_CREATE` differ only by run.
* The signature of a machine-minted duplicate specifically: `COMMENTS` consisting
  *only* of the NEXUS lines (`AI score: …` / `Synced automatically from NEXUS OS`),
  with no human text, and `SOURCE_DESCRIPTION` matching the original.

### 4c. Merging

**Merge in the Bitrix UI, do not delete via the API.** Bitrix's own
duplicate-control merge preserves activities, timeline entries and attachments;
`crm.lead.delete` destroys them, and a rep's call history is the most valuable
thing on a duplicate record. Order of work:

1. Sort each cluster by ID ascending. The lowest is the survivor — it matches
   what our sync will resolve to from now on.
2. Before merging, read each duplicate's `COMMENTS` for human text. Machine-only
   comments can be discarded; anything a rep typed must be carried into the
   survivor **by hand**, because Bitrix's merge does not concatenate text fields.
3. After merging, write the survivor's id back so the crosswalk short-circuits
   future probes:
   ```sql
   update public.leads
      set bitrix_lead_id = '412', crm_synced_at = null
    where email = '+971501234567@whatsapp.lead';
   ```
   `crm_synced_at = null` deliberately re-queues the lead so the next run
   confirms the link.
4. Re-run check 2 for that customer and confirm `via stored crosswalk`.

### 4d. Customer 360 profile rows written under the wrong key

```sql
-- Rows keyed by an email address instead of a directory UUID, plus the
-- single shared row every id-less, email-less customer collapsed onto.
select customer_id, name, email, phone, total_emails, last_synced_at
from public.customer_360_profiles
where customer_id = ''
   or customer_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

These will never be updated again (nothing writes an email key any more), so
they are inert but misleading. Reconcile the real counts into the UUID-keyed row
for the same person, then delete the orphan. **Do not** bulk-delete before
checking: a UUID-keyed row may not exist yet for that customer, in which case
the orphan holds the only history. The `customer_id = ''` row in particular is a
blend of many customers and its counts should be treated as garbage, not merged.

Also worth a look — rows a failed read already zeroed:

```sql
select customer_id, email, total_emails, total_slack_messages, last_synced_at
from public.customer_360_profiles
where coalesce(total_emails, 0) = 0 and coalesce(total_slack_messages, 0) = 0;
```

Given P3 (Gmail and Slack credentials failing since before 28 Aug), assume
**every** such zero is fabricated rather than measured. Setting them to `NULL`
is the honest reset; the next successful run repopulates them:

```sql
update public.customer_360_profiles
   set total_emails = null, total_slack_messages = null
 where total_emails = 0 and total_slack_messages = 0;
```

## 5. What I could not verify from the files, and what is knowingly left undone

**Could not verify (no live access; offline task):**

1. Whether `crm.duplicate.findbycomm` is available on this Bitrix plan, and
   whether its response shape here is `{result:{LEAD:[…]}}`. Both probes are
   coded to treat a missing `result` key as a *failure*, not as "not found", so
   an unexpected shape blocks writes rather than duplicating — but it blocks
   *all* writes. This is the single biggest unknown.
2. The definition of `v_customer_directory` — whether `id` is always present,
   always a UUID, and always the same identity as `leads.id`.
3. Whether `leads` actually has the columns the Map node reads
   (`vehicle_interest`, `budget_aed`, `ai_score`, `source`). They are used by
   the existing code and appear in the J1 runbook's `select`, so they are
   assumed present; `bitrix_lead_id` and `crm_synced_at` are added by the
   migration.
4. Whether `leads.updated_at` exists. It is referenced nowhere in the runbooks,
   which is why the staleness comparison uses `crm_synced_at` vs Bitrix
   `DATE_MODIFY` rather than a NEXUS-side row timestamp.
5. Exact PostgREST behaviour of `Prefer: resolution=merge-duplicates` on this
   version for omitted columns. The design depends on it; check 6 tests it
   directly, and it should be run before trusting the change.
6. Whether Bitrix `COMMENTS` on this portal is BB-code or HTML. Plain-text
   markers were chosen to survive either, but confirm the block renders sanely
   in the UI after the first update (check 3).

**Knowingly left undone:**

7. **The reverse path.** Leads that exist only in Bitrix are still invisible to
   NEXUS. Designed but not implemented — see DESIGN.md, "What is not fixed".
   Building it into `wf_108` would put a pull bug in the same workflow as the
   push, which is how this class of defect arises.
8. **Contacts and Deals.** Only `crm.lead.*` is touched. A customer promoted to
   a Contact or Deal in Bitrix will still be matched as a Lead duplicate — or
   not matched at all, and re-created as a Lead. Extending the probes with
   `entity_type: 'CONTACT'` is the obvious next step and is deliberately not
   bundled here.
9. **The 20-item cap** on Gmail and Slack reads is now *disclosed* rather than
   *fixed*; `total_emails` still cannot exceed 20.
10. **`Customer 360`'s fan-out ordering** (§2, last row) and the hardcoded anon
    JWT in `Verify JWT` are pre-existing issues left untouched.
