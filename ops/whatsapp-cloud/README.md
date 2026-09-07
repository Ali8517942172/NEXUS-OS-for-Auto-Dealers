# WhatsApp Cloud API — the receiver is LIVE and refusing everything, by design

Updated 7 September 2026. The earlier version of this file said "NOT DEPLOYED".
That is no longer true, and what changed is worth reading before touching any of
it.

## Where it stands

| piece | state |
|---|---|
| Meta app `NEXUS for AutoDealers` | created, id `1406045581736122` |
| WhatsApp test number | `+1 555 672-4466` |
| `phone_number_id` | `1306545252542419` |
| WABA id | `1098665496068509` |
| Verified recipient `+91 85179 42172` | added — Ali entered the WhatsApp code himself |
| `channel_registry` row, **production** | `9129126e-da78-4340-a89d-ca703b9fc169` → `alba-cars` |
| `channel_registry` row, **staging** | `7f858868-8dd4-4391-a655-89570d9bf45a` → `staging-alpha` |
| n8n receiver `J8MXprxVw1yhjBpp` | built, credentialled, **published** |
| Webhook URL | `https://35.224.126.225.nip.io/webhook/whatsapp-cloud-inbound` |
| `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN` on the VM | **unset** |
| A real customer message carried end to end | **no** |

The last two lines are the honest headline: the road is built and nothing has
driven on it. Everything below the signature check has been exercised only in a
harness and in the database, never by Meta.

## The receiver refuses every request today, and that is the design

    $ curl -sS -X POST .../webhook/whatsapp-cloud-inbound -d '{...}'
    500 APP_SECRET_NOT_CONFIGURED

    $ curl -sS '.../webhook/whatsapp-cloud-inbound?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1'
    500 VERIFY_TOKEN_NOT_CONFIGURED

This is deliberately the opposite of `WAHA Auth Gate`, whose whole defect was
that an unset `WAHA_WEBHOOK_SECRET` made it *pass everything through*. A gate
that goes quiet when it is unconfigured is not a gate. This one goes loud.

**5XX and not 4XX**, on purpose: a 4XX tells Meta not to retry, and for a lead
that means it is gone. Our missing configuration is our failure, so it answers
like one and Meta will redeliver once the secret is set.

## Three things that were measured rather than assumed, and each one changed the build

### 1. `multipleMethods` gives the webhook node one output per method

The first published version wired only output 0. Output 0 is GET. So **every
POST — the only method that carries a message — ran no nodes at all**, and n8n
answered a bare `200` with an empty body. The signature gate was unreachable on
the one path that matters, and from outside it looked like a healthy endpoint.

Found by curling the live URL and reading the execution: `lastNodeExecuted:
"Meta Cloud Webhook"`, `runData: {}`. A gate nothing routes to is worth exactly
as much as a dormant one.

### 2. The n8n Code sandbox has no crypto at all

Not "no `require`". No crypto:

    require('crypto')  ->  throws
    crypto.subtle      ->  "crypto is not defined"

Both routes the receiver shipped with were unavailable on this box. The first
real customer message would have thrown inside the verifier. This was found by a
self-test that runs on the refusal path — it cost nothing to add, and it turned
a go-live outage into a Monday-morning edit.

So the HMAC is implemented in full inside the node
(`ops/n8n-whatsapp-cloud/verify-or-refuse.node.js`, shared with
`hmac-pure.js`). It operates on bytes end to end; the body is never parsed,
re-serialised or round-tripped through a string before hashing.

### 3. The obvious SHA-256 padding is wrong on 1 length in 64

`(l + 9)` rounds up to an extra all-zero block whenever `l % 64 === 55`. RFC 4231
cases 1, 2, 3 and 6 **all pass** with that bug. It was caught by differential-
testing 300 random key/body pairs against `node:crypto`, which found it at body
lengths 55, 119, 183 and 247.

Two of those lengths are now vectors in the self-test that runs on the box, with
a negative control, because a self-test that cannot fail proves nothing. Measured
live in execution `10759`:

    hmac_selftest: { vectors: 3, failed: 0, negative_control_rejects: true, ok: true }

## The trap this whole receiver exists to avoid

Meta computes `X-Hub-Signature-256` over **the exact bytes it sent**, in an
escaped-unicode form. Parse the JSON and re-serialise it to hash, and you get
different bytes — except, most of the time, for pure ASCII, where you get the
same bytes by luck.

| customer name | raw-bytes verifier | re-serialising verifier |
|---|---|---|
| `Ahmed` | accepts | **also accepts** |
| `محمد` | accepts | **rejects a genuine Meta delivery** |

An ASCII-only test suite passes with the broken implementation and proves
nothing. In Dubai the Arabic name is not an edge case, it is Tuesday, and the
failure is silent: Meta's deliveries are refused, no error appears anywhere, and
the dealership simply stops receiving leads.

`verify-signature.test.mjs` demonstrates that on the standalone verifier (12
tests). `ops/n8n-whatsapp-cloud/verify-or-refuse.test.js` runs the **deployed
node body** through a harness that fakes `$input`/`$env` and reaches every branch
the live box cannot: 26 tests, including both wire forms of an Arabic name, a
forged secret, a body tampered after signing, a `sha1=` prefix, a truncated
digest, uppercase hex, and two messages in one delivery.

Total: 9 HMAC tests, 26 node tests, 12 standalone verifier tests, all passing.

## What the tenant comes from

`metadata.phone_number_id` — **Meta's own field, in a body we have
cryptographically verified** — looked up in `channel_registry`. Compare
`POST /webhook/whatsapp-inbound`, which takes its tenant from `body.session`, a
field the *caller* supplies, and then writes as `service_role`, which is
`BYPASSRLS`. That is the shape this replaces.

Measured on production: the registered id resolves to `alba-cars`; one digit off
resolves to nothing; the right id under the WAHA namespace resolves to nothing.
Unresolved is zero rows, and the workflow branches on that rather than guessing —
it answers Meta `200`, writes nothing, and throws into the error workflow so the
miss lands in `audit_log` instead of disappearing.

## What is left, and only Ali can do the first two

1. **On the GCP VM**, set two environment variables and restart n8n:

       META_APP_SECRET=<App settings -> Basic -> App secret, click Show>
       META_WEBHOOK_VERIFY_TOKEN=<any long random string you invent>

   Never in a workflow node, never in this repo. Until both are set the receiver
   refuses every request, which is safe but useless.

2. **In the Meta app**, WhatsApp -> Configuration -> Webhook: set the callback
   URL to `https://35.224.126.225.nip.io/webhook/whatsapp-cloud-inbound` and the
   verify token to the same string, then subscribe to the `messages` field.
   Meta will `GET` the URL immediately; a `200` echoing the challenge means the
   handshake worked.

3. **Then prove it**: send a WhatsApp message from `+91 85179 42172` to the test
   number and check, in order —
   - an n8n execution with `verdict: ACCEPT` and `hmac_route` present,
   - a row in `channel_message_events` for integration `9129126e…`,
   - `whatsapp_conversation_state` showing a window open,
   - `whatsapp_policy_decision_for_channel(...)` turning from
     `TEMPLATE_REQUIRED / CONVERSATION_NOT_MEASURED` into a window-open answer.

   Until that sequence has actually run, nothing here may be described as
   working.

## Two constraints that have not changed

**The production number cannot simply be pointed at Cloud API.** Read from Meta
Business Suite on 7 September: the WhatsApp account `311007628770691` owned by
`bharmalmarketing` is type **"WhatsApp Business app"**, not Cloud API. A phone
number lives on one or the other, never both, so `+971526647253` would have to be
deleted from that app first — losing its chat history — and WAHA is driving the
same number today, which makes three claims on one line. Prove the pipeline on
the free test number first; decide the production number deliberately afterwards,
and a new business line is usually the better answer than migrating the number
the owner answers personally.

**The test number's own limits.** It messages only recipients explicitly
verified (five maximum), and the token the developer UI hands out expires in
24 hours. A non-expiring token needs a System User, which is a separate setup and
is the owner's to create.

## Still unresolved, and older than this work

Every conversation in production returns `TEMPLATE_REQUIRED /
WINDOW_RULE_NOT_VERIFIED`, because the 24-hour window rule is seeded
`NOT_VERIFIED` and only a named human with the Meta account can attest it. Cloud
API does not change that. The rule still has to be checked against Meta's own
documentation and recorded through `policy_platform_verify_rule()`.
