# 01 — `Resolve Tenant`: the documented rollback now means something different — **NOT DEPLOYED**

**Risk: none. This is a note change. No expression, no setting, no behaviour.**
It is first in the order precisely because it costs nothing and it stops the
next person doing the 10-second rollback from silently hiding a day of the
dealership's WhatsApp traffic.

| | |
|---|---|
| workflow | `BiyHk9ZXxJUVGbf6` — WhatsApp BDC AI Agent |
| node | `Resolve Tenant` (`n8n-nodes-base.code`) |
| what changes | the node's **Notes** field, and the sticky note beside it |
| what does not change | `jsCode`, `onError`, `alwaysOutputData`, connections |

## Why

`Resolve Tenant`'s own `jsCode` comment (read live today) still says:

> If it breaks, the 10-second rollback is to disable THIS node in the editor: a
> disabled node passes its input straight through, and `Extract Message & Sender`
> then yields tenant_id null, which is precisely the pre-patch behaviour.

That sentence was true until 5 September 2026. It is now **misleading**, and the
`jsCode` cannot be left as the only description of the rollback.

Migrations `20260905201206` / `20260905201227` / `20260905201337` moved
`tenants.is_unattributed_default` onto a quarantine tenant. Verified live today:

```
id                                    slug              status      is_quarantine  is_unattributed_default
02c86264-6653-4522-b055-1c3f359a82fe  __unattributed__  quarantine  true           true
fff6a2b5-cfd5-4460-8383-875bc5826de0  alba-cars         active      false          false
```

`public.communication_logs.tenant_id` and `public.processed_messages.tenant_id`
both carry `DEFAULT nexus_default_tenant_id()` (confirmed in `pg_attrdef` today),
and both are `NOT NULL`. So with `Resolve Tenant` disabled, a live ALBA WhatsApp
message is written under `02c86264-…` — **retained, but invisible to the
dealership** — instead of under ALBA.

## Exact before / after

**Before** — node Notes: (empty)

**After** — node Notes, verbatim:

```
ROLLBACK WARNING — changed 5 Sep 2026. Disabling this node NO LONGER falls back
to ALBA CARS. public.nexus_default_tenant_id() now returns the UNATTRIBUTED
quarantine tenant (02c86264-6653-4522-b055-1c3f359a82fe), so every row written
while this node is off is retained but INVISIBLE to the dealership until it is
re-attributed. Do not delete those rows.

If you disable this node: note the start time. Afterwards, as service_role, run
  select * from public.nexus_quarantine_census();
and for each table it names
  update public.<table>
     set tenant_id = 'fff6a2b5-cfd5-4460-8383-875bc5826de0'
   where tenant_id = (select id from public.tenants where is_quarantine);

The node's behaviour when ENABLED is correct and unchanged: allowlist on
body.session, fail closed (return []) on an unknown or absent session.
```

Add the same text to the sticky note next to the node so it is readable without
opening the node.

## What breaks if this is applied out of order

Nothing — it changes no behaviour. Applying it **late** is the risk: every hour
this note is missing is an hour in which somebody can perform the documented
rollback and quietly stop the dealership seeing its own messages.

## Verify

Fetch the published version back and confirm the string
`ROLLBACK WARNING — changed 5 Sep 2026` appears in the node's `notes`. There is
no database witness for a note change, and there should not be one.

## Roll back (under a minute)

Clear the Notes field and republish. Nothing else was touched.
