# "Couldn't register with n8n's sign-in service" — measured, 17 September 2026

Claude's custom connector refuses to register against this n8n instance
(`ofid_921f11e2c773de0b`). The cause is not Claude and not a broken n8n. It is
one line of configuration.

## What was measured

Both OAuth discovery documents are served over the public address and both
return 200:

    GET https://35.224.126.225.nip.io/.well-known/oauth-authorization-server
    GET https://35.224.126.225.nip.io/.well-known/oauth-protected-resource/mcp-server/http

And both name a DIFFERENT host than the one they were fetched from:

    "issuer":                "https://desktop-l3an0ma.tail2141f7.ts.net"
    "registration_endpoint": "https://desktop-l3an0ma.tail2141f7.ts.net/mcp-oauth/register"
    "authorization_endpoint":"https://desktop-l3an0ma.tail2141f7.ts.net/mcp-oauth/authorize"
    "token_endpoint":        "https://desktop-l3an0ma.tail2141f7.ts.net/mcp-oauth/token"
    "authorization_servers": ["https://desktop-l3an0ma.tail2141f7.ts.net"]

`*.ts.net` is a **Tailscale** name. It resolves only inside Ali's own tailnet.
Claude's servers are not on that tailnet, so every one of those URLs is
unreachable to them.

The endpoints themselves are fine. Proof — the PUBLIC registration endpoint
accepts a spec-compliant RFC 7591 registration and returns **201** with a
`client_id`:

    POST https://35.224.126.225.nip.io/mcp-oauth/register   ->  201
    {"client_id":"<uuid>","token_endpoint_auth_method":"none", ...}

So: Claude fetches the metadata successfully, then follows it to a private
address it cannot reach, and reports the only thing it can — that registration
failed. Nothing is wrong with the MCP server. n8n is announcing the wrong
address for itself.

Instance: n8n **2.32.7**. `/mcp-server/http` answers **401** over the public
address, which is correct for an unauthenticated request — the door is there.

## The fix

n8n builds the URLs in its discovery documents from its own configured base
URL. On the box, set it to the address the outside world actually uses, then
restart n8n:

    N8N_HOST=35.224.126.225.nip.io
    N8N_PROTOCOL=https
    N8N_EDITOR_BASE_URL=https://35.224.126.225.nip.io/
    WEBHOOK_URL=https://35.224.126.225.nip.io/
    N8N_PROXY_HOPS=1

**`WEBHOOK_URL` is safe to set to this value, and was checked before saying so.**
Every production receiver already registered with an outside provider uses the
nip.io host, not the tailnet host:

    https://35.224.126.225.nip.io/webhook/whatsapp-cloud-inbound   (Meta WhatsApp Cloud, live)
    https://35.224.126.225.nip.io/webhook/meta-lead-ads
    https://35.224.126.225.nip.io/webhook/google-ads-lead
    https://35.224.126.225.nip.io/webhook/site-enquiry

Setting `WEBHOOK_URL` to the nip.io host makes n8n agree with what Meta is
already calling. It does not move a live webhook. If any of those values is
changed to something else later, the Meta webhook registration has to move with
it, or inbound WhatsApp stops arriving.

## Verifying the fix, before touching Claude

    curl -s https://35.224.126.225.nip.io/.well-known/oauth-authorization-server

Every URL in the response must now start with `https://35.224.126.225.nip.io`.
If any still says `ts.net`, n8n did not pick the change up — the restart did not
happen, or the value is being overridden somewhere later in the chain.

Then in Claude: add the custom connector with

    https://35.224.126.225.nip.io/mcp-server/http

and leave the OAuth Client ID field EMPTY. Dynamic registration will now reach a
public endpoint and there is nothing to paste by hand.

## If it still fails after the base URL is correct

There is a known bug in Claude's connector where it POSTs to `/register`
relative to the base URL instead of the discovered `registration_endpoint`, and
falls back to `/authorize` instead of the discovered `authorization_endpoint`.
The workaround is to register a client by hand and paste its id:

    curl -X POST https://35.224.126.225.nip.io/mcp-oauth/register \
      -H 'Content-Type: application/json' \
      -d '{"client_name":"Claude MCP",
           "redirect_uris":["https://claude.ai/api/mcp/auth_callback"],
           "grant_types":["authorization_code"],
           "response_types":["code"],
           "token_endpoint_auth_method":"none"}'

Paste the returned `client_id` into the connector's OAuth Client ID field and
leave the secret empty (`token_endpoint_auth_method` is `none`, so there is no
secret to hold).

## What this document does not claim

The fix has NOT been applied. Nobody in this session touched the n8n box, typed
its password, or restarted it. Everything above is a read of two public URLs and
one registration probe that created a throwaway client. Until the env change is
made and the `curl` above shows nip.io, the connector will keep failing.
