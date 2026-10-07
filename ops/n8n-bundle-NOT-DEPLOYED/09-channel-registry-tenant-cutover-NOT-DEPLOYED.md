# 09 — `Resolve Tenant`: cut over from `NEXUS_TENANT_MAP` to `channel_registry` — **NOT DEPLOYED**

**Last, because it changes how the live WhatsApp path resolves a dealership, and
because it is only worth doing once the door in front of it is shut (change 07).**

## The cutover has its input field — confirmed on live traffic today

`Resolve Tenant` keys off `body.session`, which is **caller-supplied**. That was
the objection. Two facts, both measured today:

- **`body.session` is present on every real inbound delivery**, value `"default"`.
  Read from the `WAHA Webhook (POST)` output on all sampled executions, from both
  WAHA hosts.
- **`Resolve Tenant` emits `tenant_source: "waha_session"` on live messages.**
  From execution 10323, node `Is Real Inbound?` input:

  ```json
  { "message_id": "false_120363165659692968@newsletter_AC874C00A1326B38BFF0BD48E3BA3E46",
    "sender": "120363165659692968@newsletter",
    "direction": "inbound",
    "is_real_inbound": false,
    "tenant_id": "fff6a2b5-cfd5-4460-8383-875bc5826de0",
    "tenant_source": "waha_session",
    "waha_session": "default" }
  ```

**The old rollback contingency "WAHA sends no session" is dead. Retire it.**

## And the registry row it needs already exists

`public.channel_registry`, read today (one row, the whole table):

```
integration_id  75d67b05-1cd4-4f81-8afd-3c2186f25590
tenant_id       fff6a2b5-cfd5-4460-8383-875bc5826de0   (Tenant A)
channel_type    whatsapp_waha_session
external_identifier  'default'
status          active
credential_ref  (present, withheld — authenticated holds no grant on this column)
```

`external_identifier = 'default'` is exactly the value live traffic carries.

## What the change is

| | |
|---|---|
| workflow | `BiyHk9ZXxJUVGbf6` — WhatsApp BDC AI Agent |
| node | `Resolve Tenant` (`n8n-nodes-base.code`) |
| what changes | the tenant lookup moves from an **env var** to a **database row** |
| what does not change | the signal (`body.session`), the allowlist behaviour, fail-closed on no match |

Today the node parses `$env.NEXUS_TENANT_MAP` and falls back to a hardcoded
`BUILTIN = { 'default': 'fff6a2b5-…' }`. After the cutover the map comes from
`channel_registry` via `nexus_resolve_channel_tenant(text, text)` — a
`SECURITY DEFINER` function owned by `postgres`, `service_role`-only
(`proacl: postgres=X/postgres, service_role=X/postgres`, confirmed today), which
returns a **set**: unresolved is **zero rows**, and an n8n branch halts on it.

**Shape of the change** (a new HTTP node before `Resolve Tenant`, or an
`executeQuery`; either is fine — what matters is the semantics):

```
POST https://dsvuoovivysszdoiorch.supabase.co/rest/v1/rpc/nexus_resolve_channel_tenant
body: { "p_channel_type": "whatsapp_waha_session",
        "p_external_identifier": "<body.session>" }
```

then in `Resolve Tenant`: if the response is empty **return []** (fail closed,
exactly as the env-map miss does today); otherwise stamp `tenant_id` from the row
and set `tenant_source: 'channel_registry'`.

**Do not remove the fail-closed branch.** It is the whole point of the node:
"we only have one dealership so it must be theirs" is precisely the reasoning that
turns an unidentified message into a real customer's record.

## Why this is last, and what it does and does not fix

`body.session` is still caller-supplied after the cutover. Moving the map into the
database does **not** authenticate the caller — it only means the mapping is
operational data with an owner rather than an env var, and that onboarding
dealership two is a row rather than a container restart.

**The thing that authenticates the caller is change 07.** Until the gate enforces,
anyone who can reach `POST /webhook/whatsapp-inbound` can type any session they
like, and with two dealerships configured one JSON field would choose whose data
is written — and n8n writes as `service_role`, which is `BYPASSRLS`, so nothing in
the database filters it. **Every tenant control proven this month sits behind
that door.** Do 07 first.

## What breaks if applied out of order

- **Before 07:** you have made the tenant map authoritative without making the
  caller authentic. That is a worse state than today, because it *looks* finished.
- **Before `NEXUS_TENANT_MAP` is rehearsed on staging:** `CLAUDE.md` records that
  the moment that var holds two keys, roughly fifteen code paths switch from "the
  only dealership" to "unresolved" at once. This change removes one of those
  fifteen; it does not remove the other fourteen, and it must not be sold as
  "multi-tenant now works".
- **Note the staging rehearsal is weaker than it looks:** production carries seven
  **column-level** grants on `channel_registry` and staging carries none — and
  `channel_registry` is the table this change makes the resolver read. Rehearsing
  there proves less than it appears to.

## Verify

See `VERIFY.md` §09.

## Roll back (under a minute)

Disable the new lookup node and restore the `$env.NEXUS_TENANT_MAP` /
`BUILTIN` body in `Resolve Tenant`, then republish.

**Do NOT roll back by disabling `Resolve Tenant` itself.** Since 5 September that
sends live Tenant A traffic to the quarantine tenant, where the dealership cannot see
it — see file 01.
