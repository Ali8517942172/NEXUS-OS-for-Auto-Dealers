# VERIFY — what proves each change worked

**A database fact beats an n8n screenshot every time.** Where a change has no
database witness, that is stated rather than replaced with a screenshot.

Every "before" number below was measured on production `dsvuoovivysszdoiorch` on
**6 September 2026**, before any of these changes was applied.

---

## §01 — `Resolve Tenant` rollback warning

**No database witness, and there should not be one.** A note changes no rows.

Fetch the **published** version back (not the draft) and confirm:

```
jq '.workflow.nodes[] | select(.name=="Resolve Tenant") | .notes' <published>
```

contains `ROLLBACK WARNING — changed 5 Sep 2026`.

Confirm nothing else moved: `jsCode`, `onError`, `alwaysOutputData` and the
connections must be byte-identical to before.

---

## §02 — Closed-Won `Upsert Vector` `on_conflict`

**Before:** `select count(*) from public.deals_embeddings;`  — record the number.

**Test (the real witness):** submit the **same** closed-won deal through the
dashboard **twice**.

```sql
-- exactly one row per deal, not two, and not a 409
select deal_id, count(*) as rows, count(distinct tenant_id) as tenants
  from public.deals_embeddings
 group by deal_id
having count(*) > 1;
-- expected: zero rows
```

And the run must **complete**, which is the half the count cannot show:

```sql
select workflow, status, summary, logged_at
  from public.audit_log
 where workflow ilike '%closed%won%'
 order by logged_at desc limit 5;
```

Before the change, the second submission raises `23505`, `retryOnFail` burns
3 attempts, `onError: null` stops the workflow, and **no `audit_log` row and no
webhook response are produced at all**. After the change there must be an
`audit_log` row for the second submission too.

---

## §03 — `communication_logs.external_message_id` — **the real witness**

**Before, measured today:**

```sql
select count(*) from public.communication_logs;                                   -- 114
select count(*) from public.communication_logs where external_message_id is not null;  -- 0
```

**After.** Send one real WhatsApp message to the session, then:

```sql
select count(*) filter (where external_message_id is not null) as identified,
       count(*)                                                as total
  from public.communication_logs;
```

**`identified` going from 0 to non-zero is the evidence the defect is closed.**
Nothing else is.

Then check the row against the execution — the id must equal the `payload.id` in
that execution's webhook body:

```sql
select direction, channel, external_message_id, left(message, 60), created_at
  from public.communication_logs
 order by created_at desc limit 4;
```

**Inbound must be non-null. Then look at the outbound row from the same
conversation.** If it is `null`, the WAHA send-response path in the expression is
wrong — **fix the expression, do not remove it**. An outbound writer that always
sends `null` has not been fixed, only made honest, and this is the check that
tells the difference.

**Prove the duplicate is actually refused** (the point of the whole change).
Replay the same webhook body:

```sql
-- must stay at one row for that id
select external_message_id, direction, count(*)
  from public.communication_logs
 where external_message_id is not null
 group by 1,2 having count(*) > 1;
-- expected: zero rows
```

**Prove nothing minted got in:**

```sql
select count(*) from public.communication_logs
 where external_message_id ~* '^(nokey:|outreach:|exec-|run-|job-)'
    or external_message_id ~ '^[0-9]+$';
-- expected: 0  (the CHECK should make this impossible; measure it anyway)
```

**Staging first, for step 3 only:** on `wwspuxrbiyagnrnzgate`, POST once with
`on_conflict=tenant_id,channel_key,direction_key,external_message_id`. Record
whether PostgREST accepts `on_conflict` naming `GENERATED ALWAYS … STORED`
columns. If it 400s, ship steps 1 and 2 without it — a 409 still refuses the row.

---

## §04 — `Claim Message Id` stops minting

**Before, measured today:**

```sql
select count(*) from public.processed_messages;                                -- 73
select count(*) from public.processed_messages where message_id like 'nokey:%'; -- 0
```

**After:**

1. Fetch the published version back and confirm `nokey:` appears **nowhere** in
   `Claim Message Id`'s `jsonBody`:
   ```
   jq -r '.workflow.nodes[]|select(.name=="Claim Message Id")|.parameters.jsonBody' <published> | grep -c nokey
   -- expected: 0
   ```
2. Send one WhatsApp message with a normal id. Confirm **exactly one**
   `processed_messages` row and **exactly one** reply.
3. **Replay the same webhook body.** Confirm **no** second row and — the part that
   matters to the customer — **no second reply**:
   ```sql
   select message_id, count(*) from public.processed_messages
    group by 1 having count(*) > 1;   -- expected: zero rows
   ```
   and
   ```sql
   select direction, left(message,60), created_at from public.communication_logs
    where channel = 'whatsapp' order by created_at desc limit 6;
   ```
   Two identical outbound rows means the change did not work.
4. ```sql
   select count(*) from public.processed_messages where message_id like 'nokey:%';
   -- expected: still 0
   ```

---

## §05 — Infra Health Probe published

**n8n side:** fetch back and confirm `activeVersionId` is **no longer `null`**
and equals `versionId`.

**Database witness** — the probe's only durable output is an alarm, so verify by
inducing one, in a window you choose:

```sql
select workflow, status, summary, logged_at
  from public.audit_log
 where logged_at > now() - interval '2 hours'
 order by logged_at desc;
```

A healthy channel writes nothing, which is correct and is also indistinguishable
from a workflow that is not running. **So test the failing case deliberately:**
stop the WAHA container for one 15-minute interval and confirm an `audit_log` row
naming `WAHA HEALTH PROBE FAIL` appears, then restart WAHA and confirm the alarm
clears (`Probe Alarm` resets `wahaConsecutiveFailures` on the next PASS).

**Registry reconciled:**

```sql
select id, name, is_active, trigger_type, trigger_detail
  from public.workflow_registry where id = '57QpbNQGwlFKb0q3';
-- trigger_type should now read 'schedule'
```

---

## §06 — Edge JWT validation

**No database witness — this is an edge control, and pretending otherwise would
be worse than saying so.** Verify by observation, from outside the VM:

```bash
# a dashboard path, no token -> 401 FROM CADDY, and no n8n execution
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://35.224.126.225.nip.io/webhook/whatsapp-send -d '{}'
# expected: 401

# the WhatsApp path must be UNAFFECTED -- this is the check that matters most
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://35.224.126.225.nip.io/webhook/whatsapp-inbound -d '{}'
# expected: 200  (it must NOT be 401)
```

**The n8n-side witness is the absence of executions.** Before the change, an
unauthenticated POST to `whatsapp-send` creates an execution row. After it,
`search_executions --workflowId yx6m55p1Kj8V7koR` must show **no new execution**
for that request. That absence is the whole benefit.

Then confirm a real signed-in dashboard user can still send a WhatsApp reply —
otherwise you have proved the lock works by locking the customer out too.

---

## §07 — WAHA gate armed

**MONITOR (before enforcing).** Read saved executions of `BiyHk9ZXxJUVGbf6` —
`saveDataSuccessExecution` is `"all"`, so every one is inspectable. On the
`WAHA Auth Gate` output:

```json
"_gate": { "mode": "MONITOR", "ok": true, "header_present": true, "enforcing": false }
```

**Required from every source address you intend to keep.** Cross-check the source
on the same execution:

```
headers['x-forwarded-for']   -> 35.224.126.225   (the box)
headers['x-forwarded-for']   -> 2.50.10.149      (the second host, if kept)
```

Any `header_present: false` is a host you have not configured. **Do not enforce
until you have seen `ok: true` on at least one genuine 1:1 customer message** —
in the 9 hours sampled on 6 Sep there were none, all 51 messages were group /
`status@broadcast` / `@newsletter`.

**ENFORCE.** `_gate.mode == "ENFORCE"`, `enforcing: true`.

**The only test that matters:** send one WhatsApp message from a real handset to
the dealership number and confirm a reply arrives. The gate drops silently and
WAHA keeps seeing 200 — a broken rollout is indistinguishable from a quiet day
without this test.

**Database witness that traffic is still landing:**

```sql
select count(*), max(created_at) from public.communication_logs
 where channel = 'whatsapp' and created_at > now() - interval '1 hour';
```

`max(created_at)` going stale after enforcing is the alarm.

---

## §08 — Phase 6 published

**n8n side:** `activeVersionId` no longer `null`.

**Database witness — this table has never had a row of this shape:**

```sql
select count(*) from public.communication_logs where direction = 'internal';
-- before: 0   (measured 6 Sep 2026)
```

After the first run that finds a silent lead, this must be non-zero, and each row
must carry a real `tenant_id`, not the quarantine one:

```sql
select c.lead_email, left(c.message, 80), c.created_at, t.slug
  from public.communication_logs c
  join public.tenants t on t.id = c.tenant_id
 where c.direction = 'internal'
 order by c.created_at desc limit 10;
-- slug must be 'alba-cars', never '__unattributed__'
```

And the run must have reported honestly:

```sql
select workflow, status, summary, logged_at
  from public.audit_log
 where workflow = 'Phase 6 Silence Detector'
 order by logged_at desc limit 10;
```

**A `SUCCESS` row with a `[SILENCE-ESCALATED]` marker but no Slack message is the
failure mode this workflow was rebuilt to prevent** — `Escalation Landed?` gates
the marker on `escalated === true`, so a marker without a delivered escalation
means that gate regressed.

---

## §09 — `channel_registry` cutover

**Before:** live executions show `tenant_source: "waha_session"` (measured today,
execution 10323).

**After:** the same field must read `tenant_source: "channel_registry"`, and
`tenant_id` must still be `fff6a2b5-cfd5-4460-8383-875bc5826de0`.

**Database witness — nothing may fall into quarantine:**

```sql
select * from public.nexus_quarantine_census();
-- before: zero rows (measured 6 Sep 2026)
-- after:  must still be zero rows
```

**Prove the fail-closed branch, which is the point of the node.** Send a request
with a session that is not in `channel_registry` (e.g. `"session":"nope"`) and
confirm:

- the execution ends at `Resolve Tenant` with **zero items**,
- **no** new `processed_messages` row,
- **no** new `communication_logs` row,
- **no** reply sent.

Then confirm a real message on session `default` still works end to end.

---

## Standing check, all changes

Run after every change window, as `service_role`:

```sql
select * from public.nexus_quarantine_census();   -- expect zero rows
select * from public.nexus_tenancy_readiness();   -- expect zero BLOCKERs
```

**Measured 6 September 2026, before this bundle:** census **empty**; readiness
returns **zero BLOCKERs** — two INFO lines and two WARNs, both on `policy_rule` /
`policy_rule_event` `tenant_id` being nullable by design (platform scope).

**Read the empty census narrowly.** It means no row has been written *without*
`tenant_id` since the 5 September cutover. It does **not** prove all 21 workflows
stamp one — a workflow that has not fired since the cutover writes nothing and so
implicates nothing. `dhy2DDjWUqwuzHLW`, `JnlZFAVmFAuNXVya` and `yx6m55p1Kj8V7koR`
all have **zero retained executions**, and `B3TcpfzOMWj8oWgF` has never been
published at all. Keep running it daily.
