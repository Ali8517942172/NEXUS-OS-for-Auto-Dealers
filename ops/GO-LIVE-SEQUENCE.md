# The locked sequence, with the exact check for each step

**Written 7 September 2026.** Everything below needs Ali: a laptop, a Vercel
dashboard, the VM, or a Meta account. None of it can be done from a container.

The order is not a preference. Two steps are dangerous out of order and both are
marked. After each step there is a **check** — run it, or ask me to; a step is
not done because it was performed, it is done because the check passed.

---

## 1 · Push, PR, merge

```powershell
cd "C:\Users\user\Desktop\MY RESUMES\nexus-os"
git push origin wip/gate-L9-2026-09-03
```

Then open the PR and merge. **19 commits**, tree `b582313…`.

> **Why before anything else:** every security fix from today lives only on this
> laptop and in a container that will be reclaimed. If the WhatsApp rollout goes
> first and something has to be rolled back, there is nothing to roll back *to*.

**Check** — `git log origin/main --oneline -1` shows the merge, and
`git status -sb` no longer says `ahead`.

---

## 2 · Deploy the dashboard

Vercel builds from the merged branch. Nothing to configure.

**Check, against the DEPLOYED bundle, not the repo** — open the site, then in
devtools' Network tab or by fetching the JS asset, confirm all four:

| must be present | why |
|---|---|
| `rpc/nexus_lead_record_manual` | the Add-a-lead path exists |
| `rpc/nexus_lead_assign_owner` | owner assignment goes through the audited RPC |
| `rpc/nexus_lead_attribution` | the Leads screen reads real origins |
| `leads?id=eq` **absent** | the direct PATCH is gone |

If any of the first three is missing, **stop** — step 3 asserts something that
would then be false.

---

## 3 · Flip production readiness · ⚠️ ORDER MATTERS

Only after step 2's check passes:

```sql
-- supabase/migrations/20260907230000_the_entry_path_exists_so_connected_is_true_again.sql
update public.lead_source_catalogue
   set manual_entry_surface = 'apps/executive-dashboard/lib/manual-lead-form.js'
 where delivery_shape = 'MANUAL_ENTRY';
```

> **Why not earlier:** the column records a fact about the *shipped* bundle.
> Setting it before the deploy puts the green "Connected" pill back while the
> deployed dashboard still has no button — which is precisely the defect
> `20260907200000` removed, re-introduced by its own fix.

**Check** — as an ALBA session, `nexus_lead_source_readiness()` shows `walk_in`
and `phone_call` as **CONNECTED**, and the Lead Sources screen shows them green
with no "unknown state" FAULT row.

---

## 4 · Production smoke test — the first deliberate lead

Do these in the deployed dashboard, as yourself:

1. **Add a walk-in.** Name, phone, no email. Note the lead number.
2. **Click Save twice** (or reopen and save the same dialog). It must say
   *"Already recorded — this is lead N, not a second one."*
3. **Assign an owner**, with a reason typed in.
4. Open the **Leads** screen and find the lead.

**Check** — one query answers all four:

```sql
select l.id, l.source, l.name,
       (select count(*) from public.lead_event e where e.lead_id = l.id)          as arrivals,
       (select count(*) from public.audit_log a where a.workflow = 'ingest:'||l.source
          and a.summary like '%Lead '||l.id||' %')                                as ingest_audit,
       (select count(*) from public.lead_owner_events o where o.lead_id = l.id)   as owner_events,
       (select o.reason from public.lead_owner_events o where o.lead_id = l.id
         order by o.at desc limit 1)                                              as reason_recorded
  from public.leads l where l.id = <the lead number>;
```

Expected: `source = walk_in`, `arrivals = 1`, `ingest_audit = 1`,
`owner_events = 1`, and the reason you typed. On the Leads screen the "Came
from" cell must show the walk-in origin, **not** "No arrival recorded".

---

## 5 · The WhatsApp door · ⚠️ ORDER MATTERS MOST HERE

Today the gate is `DORMANT` and **29 of 29 sampled requests carry no secret**.
There is one sender. Enforcing before the header exists drops **100%** of a
dealership's inbound WhatsApp, silently, and the only symptom is the bot going
quiet.

**5a.** On the VM: `WAHA_WEBHOOK_SECRET=<a long random string>`. **Nothing
else.** Restart n8n.
→ *Check:* any new execution's `WAHA Auth Gate` output shows
`_gate.mode = "MONITOR"`. Nothing is dropped in this state.

**5b.** Configure the WAHA session to send header `x-nexus-webhook-secret` with
that value on its webhook to `/webhook/whatsapp-inbound`.
→ *Check:* a new execution shows `_gate.header_present: true` **and**
`_gate.ok: true`.

**5c.** Send **one genuine 1:1 message** from another phone. Not a group, not a
broadcast — all 29 sampled executions were groups, broadcasts and newsletters,
**zero customer conversations**, so this path has never actually been observed
carrying a customer.
→ *Check:* `_gate.ok true`, a `processed_messages` row, a `communication_logs`
row, and a reply received on the handset.

**5d.** Only now: `WAHA_WEBHOOK_ENFORCE=true`. Restart.
→ *Check:* send another real message — it still arrives. Then `curl -XPOST` the
webhook with no header and confirm **nothing happens**: no new
`processed_messages` row, no send. (It will still answer `200`; the webhook
responds `onReceived`, so the 200 is on the wire before the gate runs. That is
expected and is not a failure.)

**Rollback, ~10 seconds, no restart:** open the workflow, disable the
`WAHA Auth Gate` node, save. A disabled node passes its input straight through.

---

## 6 · The website form

Vercel project `nexus-for-autodealers` → environment variables:

```
RESEND_API_KEY
NEXUS_NOTIFY_FROM
```

Redeploy.

**Check** — submit the real form once, then submit **the same thing again**.
Expected: a `lead_event` with `source_key = website_form`, one `leads` row, one
`ingest:website_form` audit row, a notification email, and the second submission
producing **no second customer**.

---

## 7 · Meta Lead Ads — wire and fire, do not build

The receiver is **already built, live, fail-closed, 49 tests passing**. Nothing
to write.

1. Create the **Facebook Page** and a lead form on it.
2. On the VM: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`,
   `META_PAGE_ACCESS_TOKEN` (a System User token — the short-lived Page token
   expires). Restart n8n.
3. Meta app → subscribe the Page to **`leadgen`**, callback
   `https://35.224.126.225.nip.io/webhook/meta-lead-ads`. Keep it distinct from
   the WhatsApp callback; crossing them is refused by name but wastes a day.
4. Register the Page and re-enable the endpoint:

```sql
insert into public.lead_ingest_provider_identity
  (endpoint_id, source_key, provider, identity_kind, identity_value, label)
values ('4d4f5cf2-f966-4d4e-9d9e-605757c615b7', 'meta_lead_ads_facebook',
        'meta', 'facebook_page_id', '<the Page id>', 'ALBA CARS page');

update public.lead_ingest_endpoint set status = 'active'
 where public_key = 'alba-prod-meta-leadads-facebook';
```

5. Fire Meta's **Lead Ads Testing Tool** — a real webhook, free.

**Check** — a `lead_event` that goes `RECEIVED` → `HYDRATED` → `PROMOTED`, a
`leads` row with `source = meta_lead_ads_facebook`, one `ingest:` audit row, and
the Leads screen showing the platform with **"The platform told us"**.

> Until step 4 the endpoint is `disabled`, and that is a real lock: measured with
> a positive control, a disabled page identity, a disabled endpoint and a
> suspended dealership each resolve to **zero rows**.

---

## 8 · Instagram — only after a real Facebook lead

Do not implement anything first. Fire a real Facebook lead, read what the Graph
response actually contains, and only then decide whether Instagram origin can be
established independently.

**The line that must not move:** `lead_event_identity_key` is
`UNIQUE (tenant_id, source_key, external_event_id)`. Encoding Instagram into
`source_key` would make Meta's redelivery of the same `leadgen_id` look new and
hand the dealership **two leads for one customer**. Attribution is additive and
lives elsewhere; it never touches the identity.

---

## Two things that are NOT in this sequence, on purpose

**Backfilling the four legacy leads.** Production holds five leads and one
`lead_event`. Leads 34, 35, 38 and 122 carry `source = nexus-master-router`,
which is not in the catalogue, so they are correctly invisible to the arrival
model rather than counted as orphans — measured, `nexus_lead_ingest_invariants()`
returns **0 FAIL** today. Writing arrival rows for them would be manufacturing
evidence that a webhook fired. They stay as they are, and the Leads screen says
"No arrival recorded" about them, which is true.

**Revoking `authenticated`'s UPDATE on `leads`.** The migration is written and
**deliberately unapplied** —
`20260908090000_the_grant_that_no_longer_has_a_screen_behind_it.sql`. It carries
a preflight that refuses to run today, and the reason is worth reading before
scheduling it: `nexus_lead_assign_owner` is **SECURITY INVOKER**, so the UPDATE
inside it runs as the caller and needs that same grant. Revoking the grants would
break the owner-assignment screen *through the RPC* instead of through the PATCH.
Closing it properly means converting that function to `SECURITY DEFINER` with its
own copy of the `leads_role_update` predicate — a second copy of a rule that was
deliberately not created today. That is a design decision for its own pass, not a
REVOKE bolted onto a deploy.
