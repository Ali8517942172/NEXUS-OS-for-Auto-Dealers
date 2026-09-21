#!/usr/bin/env python3
"""NX1007-cloud: give the tenant-scoped BDC candidate (LTBExI7QzFeANeFg) a
WhatsApp Cloud inbound door alongside its existing WAHA door, and make it
reply on the SAME channel a message arrived on.

Design (see ops/bdc-cloud-send/DESIGN.md for the full writeup):
  - Cloud inbound arrives via the already-live, HMAC-verified receiver
    (J8MXprxVw1yhjBpp) calling this workflow with Execute Workflow, AFTER the
    receiver has verified the Meta signature, resolved the tenant from
    channel_registry, and recorded the customer service window. The BDC
    candidate itself never re-implements HMAC verification -- there is
    exactly one place that trusts a raw Meta payload, and it already existed.
  - The WAHA door (WAHA Webhook -> Resolve Tenant From WAHA Session -> WAHA
    Session Registered? -> Verify WAHA Origin Or Refuse) is untouched.
  - Tenant Context gains a third source (Require Cloud Context From
    Receiver) but is still the ONE place the dealership is decided, and it
    still refuses (throws) when nothing resolves a tenant.
  - A new Extract Cloud Message & Sender node produces the exact item shape
    Extract Message & Sender already produces, so every downstream node
    (Reply Eligibility, Model Ladder, the agent, Log Incoming Message, ...)
    is unmodified. Two nodes that referenced 'Extract Message & Sender' BY
    NAME (Resolve Lead Identity, Resolve Lead Id (Tenant Scoped)) get a
    fallback to the Cloud extractor.
  - Reply Channel Is Cloud? branches AFTER Guard Reply (the AI's output is
    already quality-gated) on inbound_channel. WAHA/outreach keep the
    existing Resolve WAHA Send Channel -> Send Reply via WAHA HTTP API path,
    byte-for-byte unchanged. Cloud gets a new path that:
      1. asks the authoritative whatsapp_policy_decision() SQL function
         (NOT reimplemented here) whether a free-form SERVICE_REPLY is
         allowed right now for this tenant/customer -- the 24h customer
         service window rule, templates explicitly out of scope;
      2. on BLOCKED/TEMPLATE_REQUIRED, refuses the send and logs why to
         audit_log with tenant_id -- no message goes out;
      3. on FREEFORM_ALLOWED, reveals the tenant's own Cloud token
         server-side (nexus_channel_secret_reveal) and POSTs to
         graph.facebook.com/v21.0/{the SAME phone_number_id the inbound
         message arrived on}/messages;
      4. classifies the Graph response (2xx + a real wamid, matching the
         house pattern in Channel Test Send) instead of trusting a 2xx with
         no message id;
      5. on success, rejoins the EXISTING Log Conversation -> Delivery
         Report -> Audit Log -> New Lead Worth Scoring? chain, so the Cloud
         reply is logged and a brand-new Cloud lead still gets scored,
         exactly like a WAHA reply.
  - Every new external call: timeout <=15s, retried at most twice where a
    retry is safe (never on the send itself), and its failure path writes
    audit_log with tenant_id explicitly -- not left to the global error
    workflow, which cannot see which tenant an in-flight item belonged to.
  - The revealed Cloud token is referenced ONLY inside the Authorization
    header expression of the Graph POST node. No Set/Code node here ever
    copies `.secret` into a field that gets logged, and no failure-audit
    node interpolates it -- the reveal node's own failure path fires before
    the secret exists, and the send's failure path logs the Graph API's
    response body, which never contains the token we sent.

Never writes to n8n. Read-only source: ops/bdc-cloud-send/live/*.json
(fetched via wf.py fetch). Output: ops/bdc-cloud-send/patched/*.json
"""
import json, uuid, os, re

SUPA = "https://dsvuoovivysszdoiorch.supabase.co"
LIVE = "ops/bdc-cloud-send/live"
OUT = "ops/bdc-cloud-send/patched"


def nid():
    return uuid.uuid4().hex[:8]


def code_node(name, code, x, y, mode="runOnceForAllItems"):
    return {
        "id": nid(), "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2,
        "position": [x, y],
        "parameters": {"mode": mode, "language": "javaScript", "jsCode": code},
    }


def if_node(name, left_expr, right_value, x, y, op_type="string", op="equals", combinator="and"):
    return {
        "id": nid(), "name": name, "type": "n8n-nodes-base.if", "typeVersion": 2,
        "position": [x, y],
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                "combinator": combinator,
                "conditions": [{
                    "id": nid(), "leftValue": left_expr, "rightValue": right_value,
                    "operator": {"type": op_type, "operation": op},
                }],
            },
            "options": {},
        },
    }


def http_node(name, method, url, body_expr, x, y, timeout=10000, retry=False,
              on_error=None, extra_headers=None, never_error=False, prefer=None):
    headers = list(extra_headers or [])
    if prefer:
        headers.append({"name": "Prefer", "value": prefer})
    headers.append({"name": "Content-Type", "value": "application/json"})
    params = {
        "method": method,
        "url": url,
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "supabaseApi",
        "sendHeaders": True,
        "headerParameters": {"parameters": headers},
        "options": {"timeout": timeout},
    }
    if body_expr is not None:
        params["sendBody"] = True
        params["specifyBody"] = "json"
        params["jsonBody"] = body_expr
    if never_error:
        params["options"]["response"] = {"response": {"neverError": True, "fullResponse": True}}
    n = {
        "id": nid(), "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": [x, y], "parameters": params,
    }
    if retry:
        n["retryOnFail"] = True
        n["maxTries"] = 2
        n["waitBetweenTries"] = 1000
    if on_error:
        n["onError"] = on_error
    return n


def supabase_http(name, url, x, y, **kw):
    # Non-Supabase-REST-credentialed node (Graph API) needs its own auth.
    return http_node(name, "POST", url, None, x, y, **kw)


def add_nodes(w, nodes):
    w["nodes"].extend(nodes)


def connect(conns, src, out_index, targets):
    conns.setdefault(src, {"main": []})
    while len(conns[src]["main"]) <= out_index:
        conns[src]["main"].append([])
    conns[src]["main"][out_index] = [{"node": t, "type": "main", "index": 0} for t in targets]


def redirect_target(conns, src, out_index, old_target, new_target):
    """Point one edge at a different node, leaving other edges on that output alone."""
    outs = conns[src]["main"][out_index]
    for o in outs:
        if o["node"] == old_target:
            o["node"] = new_target


def main():
    w = json.load(open(f"{LIVE}/LTBExI7QzFeANeFg.json"))
    nodes = w["nodes"]
    conns = w["connections"]
    by_name = {n["name"]: n for n in nodes}

    # ------------------------------------------------------------------
    # 0. settings: make the same-owner trust boundary the code already
    #    documents (Tenant Context's comment on Require Tenant From Caller)
    #    actually hold, for BOTH existing callers (Master Router) and the
    #    new one (Cloud receiver). Unset today -- see ops/bdc-cloud-send/
    #    DESIGN.md finding F1.
    # ------------------------------------------------------------------
    w["settings"]["callerPolicy"] = "workflowsFromSameOwner"

    # ------------------------------------------------------------------
    # 1. Cloud inbound door: trigger -> validate/shape -> dedupe -> join
    #    the WAHA/outreach pipeline at Tenant Context.
    # ------------------------------------------------------------------
    trig = {
        "id": nid(), "name": "Called by Cloud Receiver",
        "type": "n8n-nodes-base.executeWorkflowTrigger", "typeVersion": 1.1,
        "position": [0, 1024],
        "parameters": {"inputSource": "passthrough"},
        "notes": (
            "Fed by the WhatsApp Cloud Inbound Receiver (J8MXprxVw1yhjBpp) via Execute "
            "Workflow, AFTER it has HMAC-verified the Meta signature over the raw body, "
            "resolved the tenant from channel_registry, and recorded the customer service "
            "window. This is the ONLY thing that can reach this trigger -- callerPolicy is "
            "workflowsFromSameOwner, same boundary as 'Called by Master Router'. Nothing "
            "here re-verifies a Meta signature; there is exactly one place in NEXUS that "
            "does, and it is upstream of this node, not in it."
        ),
    }

    require_cloud_ctx = code_node(
        "Require Cloud Context From Receiver",
        (
            "/* Defense in depth: callerPolicy restricts WHO can invoke this trigger to\n"
            " * same-owner workflows, but it says nothing about WHAT they pass. This node\n"
            " * is the shape check -- it refuses (throws) rather than continuing with a\n"
            " * half-formed identity, the same fail-closed posture as Require Tenant From\n"
            " * Caller on the outreach door. */\n"
            "const it = $input.first().json || {};\n"
            "const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;\n"
            "const tenantId = String(it.tenant_id || '');\n"
            "const integrationId = String(it.integration_id || '');\n"
            "const phoneNumberId = String(it.phone_number_id || '').trim();\n"
            "const customerWaId = String(it.customer_wa_id || '').trim();\n"
            "const messageId = String(it.message_id || '').trim();\n"
            "const problems = [];\n"
            "if (!UUID.test(tenantId)) problems.push('tenant_id is not a UUID');\n"
            "if (!UUID.test(integrationId)) problems.push('integration_id is not a UUID');\n"
            "if (!phoneNumberId) problems.push('phone_number_id is missing');\n"
            "if (!customerWaId) problems.push('customer_wa_id is missing');\n"
            "if (!messageId) problems.push('message_id is missing');\n"
            "if (problems.length) {\n"
            "  throw new Error('BDC_CLOUD_CONTEXT_INCOMPLETE: the calling workflow did not '\n"
            "    + 'pass a usable identity (' + problems.join('; ') + '). NEXUS will not guess '\n"
            "    + 'a dealership or a customer for a WhatsApp Cloud message.');\n"
            "}\n"
            "// message_kind other than 'text' is in scope to ACKNOWLEDGE, not to process --\n"
            "// downloading/interpreting Cloud media (image/audio/document) is explicitly out\n"
            "// of scope for this pass (WAHA keeps that capability; Cloud does not yet).\n"
            "const kind = String(it.message_kind || 'text').trim() || 'text';\n"
            "const rawText = (it.text === null || it.text === undefined) ? '' : String(it.text).trim();\n"
            "const text = rawText || (kind === 'text' ? '' : ('[Customer sent a ' + kind + ' message '\n"
            "  + '\\u2014 WhatsApp Cloud media is not yet supported by NEXUS, only text]'));\n"
            "return [{ json: {\n"
            "  tenant_id: tenantId,\n"
            "  tenant_slug: String(it.tenant_slug || '') || null,\n"
            "  integration_id: integrationId,\n"
            "  cloud_phone_number_id: phoneNumberId,\n"
            "  cloud_customer_wa_id: customerWaId,\n"
            "  cloud_message_id: messageId,\n"
            "  cloud_message_kind: kind,\n"
            "  cloud_message_text: text,\n"
            "  cloud_occurred_at: it.occurred_at || null,\n"
            "  cloud_customer_display_name: it.customer_display_name || null,\n"
            "  tenant_origin: 'cloud_receiver_verified'\n"
            "} }];"
        ),
        -240, 1024,
    )

    claim_cloud = http_node(
        "Claim Message Id (Cloud)", "POST", f"{SUPA}/rest/v1/processed_messages",
        (
            "={{ JSON.stringify({ tenant_id: $json.tenant_id, message_id: $json.cloud_message_id, "
            "source: 'whatsapp_cloud', chat_id: $json.cloud_customer_wa_id }) }}"
        ),
        -480, 1024, timeout=10000, prefer="resolution=ignore-duplicates,return=representation",
    )
    claim_cloud["parameters"]["sendQuery"] = True
    claim_cloud["parameters"]["queryParameters"] = {"parameters": [{"name": "on_conflict", "value": "tenant_id,message_id"}]}

    is_new_cloud = if_node(
        "Is New Cloud Message?", "={{ !!$json.message_id }}", "", -720, 1024,
        op_type="boolean", op="true",
    )
    # Mirror 'Is New Message?': also let a genuine DB error through rather than
    # silently dropping a message because the idempotency table hiccupped.
    is_new_cloud["parameters"]["conditions"]["combinator"] = "or"
    is_new_cloud["parameters"]["conditions"]["conditions"].append({
        "id": nid(), "leftValue": "={{ !!$json.error }}", "rightValue": "",
        "operator": {"type": "boolean", "operation": "true", "singleValue": True},
    })

    add_nodes(w, [trig, require_cloud_ctx, claim_cloud, is_new_cloud])
    connect(conns, "Called by Cloud Receiver", 0, ["Require Cloud Context From Receiver"])
    connect(conns, "Require Cloud Context From Receiver", 0, ["Claim Message Id (Cloud)"])
    connect(conns, "Claim Message Id (Cloud)", 0, ["Is New Cloud Message?"])
    connect(conns, "Is New Cloud Message?", 0, ["Tenant Context"])  # true only; false = drop (redelivery)

    # ------------------------------------------------------------------
    # 2. Tenant Context: add the third source. Still one place, still
    #    refuses when nothing resolves -- only the fallback chain grows.
    # ------------------------------------------------------------------
    tc = by_name["Tenant Context"]
    old = "if (!t) { try { const r = $('Require Tenant From Caller').first().json; if (r && r.tenant_id) { t = r; origin = 'master_router_input'; } } catch (e) {} }"
    assert old in tc["parameters"]["jsCode"]
    new = old + (
        "\nif (!t) { try { const r = $('Require Cloud Context From Receiver').first().json; "
        "if (r && r.tenant_id) { t = r; origin = 'cloud_receiver_verified'; } } catch (e) {} }"
    )
    tc["parameters"]["jsCode"] = tc["parameters"]["jsCode"].replace(old, new)
    old2 = (
        "return [{ json: Object.assign({}, it, {\n"
        "  tenant_id: t.tenant_id,\n"
        "  tenant_slug: t.tenant_slug || null,\n"
        "  integration_id: t.integration_id || null,\n"
        "  waha_session: t.external_identifier || null,\n"
        "  waha_credential_ref: t.credential_ref || null,\n"
        "  tenant_origin: origin\n"
        "}) }];"
    )
    assert old2 in tc["parameters"]["jsCode"]
    new2 = (
        "const isCloud = origin === 'cloud_receiver_verified';\n"
        "return [{ json: Object.assign({}, it, {\n"
        "  tenant_id: t.tenant_id,\n"
        "  tenant_slug: t.tenant_slug || null,\n"
        "  integration_id: t.integration_id || null,\n"
        "  waha_session: t.external_identifier || null,\n"
        "  waha_credential_ref: t.credential_ref || null,\n"
        "  tenant_origin: origin,\n"
        "  // Which door this message came in, and (Cloud only) which exact number --\n"
        "  // 'Reply Channel Is Cloud?' branches on this, and the Graph POST replies on\n"
        "  // cloud_phone_number_id UNCHANGED, i.e. the same number the message arrived on.\n"
        "  inbound_channel: isCloud ? 'whatsapp_cloud' : 'whatsapp_waha',\n"
        "  cloud_phone_number_id: isCloud ? t.cloud_phone_number_id : null\n"
        "}) }];"
    )
    tc["parameters"]["jsCode"] = tc["parameters"]["jsCode"].replace(old2, new2)

    # ------------------------------------------------------------------
    # 3. Extract step: branch on inbound_channel right after Tenant Policy,
    #    leaving the WAHA extractor byte-for-byte unchanged.
    # ------------------------------------------------------------------
    inbound_is_cloud = if_node(
        "Inbound Is Cloud?", "={{ $('Tenant Context').first().json.inbound_channel }}",
        "whatsapp_cloud", 2050, -260,
    )

    extract_cloud = code_node(
        "Extract Cloud Message & Sender",
        (
            "// Cloud analogue of `Extract Message & Sender`. Produces the SAME item shape\n"
            "// so every downstream node (Reply Eligibility, Model Ladder, the agent, Log\n"
            "// Incoming Message, Skip Duplicate Outreach, New Lead Worth Scoring?, ...) needs\n"
            "// no changes at all. Text only in this pass -- is_document/is_voice are always\n"
            "// false; Cloud media (image/audio/document) is a named future gap, not silently\n"
            "// dropped (see Require Cloud Context From Receiver's placeholder text).\n"
            "const c = $('Require Cloud Context From Receiver').first().json;\n"
            "const digits = String(c.cloud_customer_wa_id || '').replace(/[^0-9]/g, '');\n"
            "return [{ json: {\n"
            "  message_id: c.cloud_message_id,\n"
            "  message: c.cloud_message_text,\n"
            "  is_document: false,\n"
            "  document_url: null,\n"
            "  is_voice: false,\n"
            "  audio_url: null,\n"
            "  audio_seconds: 0,\n"
            "  audio_mime: null,\n"
            "  sender: c.cloud_customer_wa_id,\n"
            "  sender_phone: digits,\n"
            "  push_name: c.cloud_customer_display_name,\n"
            "  lead_email: null,\n"
            "  direction: 'inbound'\n"
            "} }];"
        ),
        2050, -60,
    )

    add_nodes(w, [inbound_is_cloud, extract_cloud])
    # Tenant Policy currently points straight at Extract Message & Sender.
    connect(conns, "Tenant Policy", 0, ["Inbound Is Cloud?"])
    connect(conns, "Inbound Is Cloud?", 0, ["Extract Cloud Message & Sender"])
    connect(conns, "Inbound Is Cloud?", 1, ["Extract Message & Sender"])
    connect(conns, "Extract Cloud Message & Sender", 0, ["Is Voice Note?"])
    # 'Extract Message & Sender -> Is Voice Note?' already exists and is untouched.

    # ------------------------------------------------------------------
    # 4. Two nodes that named 'Extract Message & Sender' directly need a
    #    fallback to the Cloud extractor (it is a different node, so a
    #    hardcoded $('Extract Message & Sender') throws 'did not run on
    #    this branch' for every Cloud message otherwise).
    # ------------------------------------------------------------------
    def add_cloud_fallback(code):
        old = "const ex = $('Extract Message & Sender').first().json;"
        assert old in code, "expected node to read Extract Message & Sender directly"
        new = (
            "const ex = (() => { try { const v = $('Extract Message & Sender').first().json; "
            "if (v) return v; } catch (e) {} return $('Extract Cloud Message & Sender').first().json; })();"
        )
        return code.replace(old, new)

    rli = by_name["Resolve Lead Identity"]
    rli["parameters"]["jsCode"] = add_cloud_fallback(rli["parameters"]["jsCode"])

    rlid = by_name["Resolve Lead Id (Tenant Scoped)"]
    old = "const ex = $('Extract Message & Sender').first().json || {};"
    assert old in rlid["parameters"]["jsonBody"]
    new = (
        "const ex = (() => { try { const v = $('Extract Message & Sender').first().json; "
        "if (v) return v; } catch (e) {} return $('Extract Cloud Message & Sender').first().json; })() || {};"
    )
    rlid["parameters"]["jsonBody"] = rlid["parameters"]["jsonBody"].replace(old, new)

    # ------------------------------------------------------------------
    # 5. Reply door: branch after Guard Reply. WAHA/outreach path
    #    (Resolve WAHA Send Channel -> Send Reply via WAHA HTTP API) is
    #    completely untouched -- only its inbound edge moves from
    #    Guard Reply to the IF's false output.
    # ------------------------------------------------------------------
    reply_is_cloud = if_node(
        "Reply Channel Is Cloud?", "={{ $('Tenant Context').first().json.inbound_channel }}",
        "whatsapp_cloud", 4300, -900,
    )

    check_window = http_node(
        "Check Cloud Service Window", "POST", f"{SUPA}/rest/v1/rpc/whatsapp_policy_decision",
        (
            "={{ JSON.stringify({ p_tenant_id: $('Tenant Context').first().json.tenant_id, "
            "p_integration_id: $('Tenant Context').first().json.integration_id, "
            "p_customer_wa_id: $('Require Cloud Context From Receiver').first().json.cloud_customer_wa_id, "
            "p_intent: 'SERVICE_REPLY' }) }}"
        ),
        4520, -1000, timeout=10000, retry=True, on_error="continueErrorOutput",
    )

    window_decision = code_node(
        "Cloud Window Decision",
        (
            "// whatsapp_policy_decision() is the ONE authority for whether NEXUS may send\n"
            "// a free-form reply right now (see supabase/migrations/\n"
            "// 20260904024807_wapolicy_03_decision_function_writers_and_view.sql). This node\n"
            "// does not compute the 24h rule itself -- it only reads what the function said,\n"
            "// because that function is deterministic SQL with no model in the path and can\n"
            "// be re-verified independently of whatever this workflow does.\n"
            "const row = ($input.all().map(i => i.json).filter(Boolean))[0] || {};\n"
            "return [{ json: {\n"
            "  window_decision: row.decision || 'BLOCKED',\n"
            "  window_reason: row.reason || 'whatsapp_policy_decision returned no row',\n"
            "  window_state: row.window_state || 'UNKNOWN'\n"
            "} }];"
        ),
        4740, -1000,
    )

    window_open = if_node("Cloud Window Open?", "={{ $json.window_decision }}", "FREEFORM_ALLOWED", 4960, -1000)

    reveal_token = http_node(
        "Reveal Cloud Token (BDC)", "POST", f"{SUPA}/rest/v1/rpc/nexus_channel_secret_reveal",
        (
            "={{ JSON.stringify({ p_phone_number_id: $('Tenant Context').first().json.cloud_phone_number_id, "
            "p_kind: 'meta_system_user_token', p_reason: 'NEXUS BDC AI agent reply (inbound WhatsApp "
            "Cloud, tenant-scoped, within customer service window)' }) }}"
        ),
        5180, -1120, timeout=10000, retry=True, on_error="continueErrorOutput",
    )

    graph_post = http_node(
        "POST Graph Messages (BDC Cloud)", "POST",
        "={{ 'https://graph.facebook.com/v21.0/' + $('Tenant Context').first().json.cloud_phone_number_id + '/messages' }}",
        (
            "={{ JSON.stringify({ messaging_product: 'whatsapp', "
            "to: $('Require Cloud Context From Receiver').first().json.cloud_customer_wa_id, "
            "type: 'text', text: { body: $('Guard Reply').first().json.output } }) }}"
        ),
        5400, -1120, timeout=15000, never_error=True,
        extra_headers=[{"name": "Authorization", "value": "={{ 'Bearer ' + $('Reveal Cloud Token (BDC)').first().json.secret }}"}],
    )
    # This node uses the Graph API, not Supabase -- no Supabase credential.
    del graph_post["parameters"]["authentication"]
    del graph_post["parameters"]["nodeCredentialType"]
    graph_post["notes"] = (
        "The revealed token is used ONLY in this node's Authorization header expression. "
        "No Set/Code node anywhere in this patch copies Reveal Cloud Token (BDC)'s .secret "
        "field into anything that gets logged (Log Conversation, Audit Log, Delivery Report "
        "all read Guard Reply's .output and Tenant Context's ids -- never the token). "
        "neverError+fullResponse is deliberate: a non-2xx or a 2xx with no wamid must be "
        "classified and logged, not thrown into the generic error workflow which cannot "
        "attribute a tenant to an in-flight item."
    )

    classify_send = code_node(
        "Classify Cloud Send Result",
        (
            "// Same falsifiability rule as Channel Test Send's 'Classify Graph Response':\n"
            "// a 2xx with no messages[0].id is not treated as sent.\n"
            "const r = $input.first().json || {};\n"
            "const status = r.statusCode ?? r.status ?? null;\n"
            "const body = r.body ?? r;\n"
            "const wamid = body && body.messages && body.messages[0] && body.messages[0].id;\n"
            "const ok = Number(status) >= 200 && Number(status) < 300 && !!wamid;\n"
            "return [{ json: { ok, status, wamid: wamid || null, error_body: ok ? null : body } }];"
        ),
        5620, -1120,
    )

    send_accepted = if_node("Cloud Send Accepted?", "={{ $json.ok }}", "", 5840, -1120, op_type="boolean", op="true")

    note_window_check_failed = code_node(
        "Note: Cloud Window Check Failed",
        (
            "const e = ($input.first().json || {}).error || {};\n"
            "return [{ json: { status: 'FAILED', summary: 'Cloud service-window check '\n"
            "  + '(whatsapp_policy_decision) failed before any reply was attempted: '\n"
            "  + String(e.message || e.description || 'unknown error') } }];"
        ),
        4740, -800,
    )
    note_window_closed = code_node(
        "Note: Cloud Window Closed",
        (
            "const d = $input.first().json || {};\n"
            "const reason = d.window_reason || 'no reason given';\n"
            "return [{ json: { status: 'BLOCKED', summary: 'Refused to send a WhatsApp Cloud reply: '\n"
            "  + 'decision=' + (d.window_decision || 'BLOCKED') + ', reason=' + reason\n"
            "  + '. Templates are out of scope for this pass, so no message was sent.' } }];"
        ),
        4960, -800,
    )
    note_reveal_failed = code_node(
        "Note: Cloud Token Reveal Failed",
        (
            "const e = ($input.first().json || {}).error || {};\n"
            "const pnid = (() => { try { return $('Tenant Context').first().json.cloud_phone_number_id; } "
            "catch (err) { return 'unknown'; } })();\n"
            "return [{ json: { status: 'FAILED', summary: 'Could not reveal the WhatsApp Cloud token for '\n"
            "  + 'phone_number_id ' + pnid + ': ' + String(e.message || e.description || 'unknown error')\n"
            "  + '. No token was exposed and no message was sent.' } }];"
        ),
        5180, -900,
    )
    note_send_failed = code_node(
        "Note: Cloud Send Failed",
        (
            "const r = $input.first().json || {};\n"
            "return [{ json: { status: 'FAILED', summary: 'WhatsApp Cloud send failed, status '\n"
            "  + (r.status ?? 'unknown') + ': ' + JSON.stringify(r.error_body || {}).slice(0, 400) } }];"
        ),
        5840, -900,
    )

    audit_cloud = http_node(
        "Audit Log (Cloud BDC Send)", "POST", f"{SUPA}/rest/v1/audit_log",
        (
            "={{ JSON.stringify({ tenant_id: $('Tenant Context').first().json.tenant_id, "
            "workflow: 'WhatsApp BDC Agent (Cloud reply)', status: $json.status, "
            "summary: String($json.summary || '').substring(0, 900), logged_at: $now.toISO() }) }}"
        ),
        6060, -800, timeout=15000, prefer="return=minimal",
    )

    add_nodes(w, [
        reply_is_cloud, check_window, window_decision, window_open, reveal_token,
        graph_post, classify_send, send_accepted,
        note_window_check_failed, note_window_closed, note_reveal_failed, note_send_failed,
        audit_cloud,
    ])

    # Guard Reply currently points at Resolve WAHA Send Channel; insert the IF ahead of it.
    connect(conns, "Guard Reply", 0, ["Reply Channel Is Cloud?"])
    connect(conns, "Reply Channel Is Cloud?", 0, ["Check Cloud Service Window"])
    connect(conns, "Reply Channel Is Cloud?", 1, ["Resolve WAHA Send Channel"])

    connect(conns, "Check Cloud Service Window", 0, ["Cloud Window Decision"])
    connect(conns, "Check Cloud Service Window", 1, ["Note: Cloud Window Check Failed"])
    connect(conns, "Cloud Window Decision", 0, ["Cloud Window Open?"])
    connect(conns, "Cloud Window Open?", 0, ["Reveal Cloud Token (BDC)"])
    connect(conns, "Cloud Window Open?", 1, ["Note: Cloud Window Closed"])
    connect(conns, "Reveal Cloud Token (BDC)", 0, ["POST Graph Messages (BDC Cloud)"])
    connect(conns, "Reveal Cloud Token (BDC)", 1, ["Note: Cloud Token Reveal Failed"])
    connect(conns, "POST Graph Messages (BDC Cloud)", 0, ["Classify Cloud Send Result"])
    connect(conns, "Classify Cloud Send Result", 0, ["Cloud Send Accepted?"])
    connect(conns, "Cloud Send Accepted?", 0, ["Log Conversation"])  # rejoin the existing success chain
    connect(conns, "Cloud Send Accepted?", 1, ["Note: Cloud Send Failed"])

    for note in ["Note: Cloud Window Check Failed", "Note: Cloud Window Closed",
                 "Note: Cloud Token Reveal Failed", "Note: Cloud Send Failed"]:
        connect(conns, note, 0, ["Audit Log (Cloud BDC Send)"])

    # ------------------------------------------------------------------
    # 6. Delivery Report: pick the claim node that actually ran for this
    #    branch, so a successful Cloud send isn't reported PARTIAL/FAILED
    #    just because 'Send Reply via WAHA HTTP API' never executed.
    # ------------------------------------------------------------------
    dr = by_name["Delivery Report"]
    old = (
        "const CLAIMED = [\n"
        "  { node: 'Send Reply via WAHA HTTP API', what: 'WhatsApp reply to the customer', critical: true },\n"
        "  { node: 'Log Conversation',             what: 'communication_logs row for the reply', critical: false },\n"
        "  { node: 'Claim Message Id',             what: 'idempotency claim in processed_messages', critical: false },\n"
        "];"
    )
    assert old in dr["parameters"]["jsCode"], "Delivery Report CLAIMED block not found verbatim"
    new = (
        "const usedCloud = (() => {\n"
        "  try { return $('Tenant Context').first().json.inbound_channel === 'whatsapp_cloud'; }\n"
        "  catch (e) { return false; }\n"
        "})();\n"
        "const CLAIMED = [\n"
        "  { node: usedCloud ? 'POST Graph Messages (BDC Cloud)' : 'Send Reply via WAHA HTTP API',\n"
        "    what: 'WhatsApp reply to the customer', critical: true },\n"
        "  { node: 'Log Conversation',             what: 'communication_logs row for the reply', critical: false },\n"
        "  { node: usedCloud ? 'Claim Message Id (Cloud)' : 'Claim Message Id',\n"
        "    what: 'idempotency claim in processed_messages', critical: false },\n"
        "];"
    )
    dr["parameters"]["jsCode"] = dr["parameters"]["jsCode"].replace(old, new)

    os.makedirs(OUT, exist_ok=True)
    outp = f"{OUT}/LTBExI7QzFeANeFg.json"
    json.dump(w, open(outp, "w"), indent=1)
    print("wrote", outp, "nodes=", len(w["nodes"]))


if __name__ == "__main__":
    main()
