#!/usr/bin/env python3
"""NX1007 per-dealer send channel patcher.
Builds patched n8n workflow JSON (Drip, KYC, Dashboard Reply) that resolve
the outbound WhatsApp channel from channel_registry per tenant, preferring
whatsapp_cloud_phone_number_id over legacy whatsapp_waha_session, and fail
closed (throw -> workflow's configured errorWorkflow / Error Handler logs it)
when the tenant has no active channel. Never writes to n8n. Read-only source:
ops/per-dealer-send/live/*.json (fetched via wf.py fetch). Output:
ops/per-dealer-send/patched/*.json
"""
import json, uuid, copy, sys, os

SUPA = "https://dsvuoovivysszdoiorch.supabase.co"

def nid():
    return uuid.uuid4().hex[:8]

def fetch_channel_node(name, tenant_expr, x, y):
    return {
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
        "retryOnFail": True,
        "maxTries": 2,
        "waitBetweenTries": 1000,
        "parameters": {
            "method": "GET",
            "url": f"{SUPA}/rest/v1/channel_registry",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "supabaseApi",
            "sendQuery": True,
            "queryParameters": {
                "parameters": [
                    {"name": "select", "value": "channel_type,external_identifier,credential_ref"},
                    {"name": "tenant_id", "value": "=eq.{{ " + tenant_expr + " }}"},
                    {"name": "channel_type", "value": "in.(whatsapp_cloud_phone_number_id,whatsapp_waha_session)"},
                    {"name": "status", "value": "eq.active"},
                    {"name": "order", "value": "channel_type.asc"},
                ]
            },
            "options": {"timeout": 10000},
        },
    }

def resolve_channel_node(name, tenant_label_expr, carry_from_node, x, y):
    js = (
        "// NX1007 -- per-dealer send channel resolution. FAIL CLOSED.\n"
        "// Prefers WhatsApp Cloud (phone_number_id) over legacy WAHA session, per\n"
        "// the channel_registry binding decision. No default, no shared session.\n"
        "// An unresolved channel THROWS -- this workflow's errorWorkflow\n"
        "// (iYJkh1kztWxZXDbT, NEXUS Error Handler) records it to audit_log. No send\n"
        "// happens and the refusal is durable, not silent.\n"
        "let rows = $input.all().map(i => i.json).filter(Boolean);\n"
        "// PostgREST GET returns a JSON array; n8n normally splits it into one item\n"
        "// per row, but defend the single-item-holding-an-array shape too.\n"
        "if (rows.length === 1 && Array.isArray(rows[0])) rows = rows[0];\n"
        "const cloud = rows.find(r => r.channel_type === 'whatsapp_cloud_phone_number_id');\n"
        "const waha  = rows.find(r => r.channel_type === 'whatsapp_waha_session');\n"
        "const picked = cloud || waha;\n"
        f"const tenantForLog = {tenant_label_expr};\n"
        "if (!picked || !picked.external_identifier) {\n"
        "  throw new Error('NX1007_NO_ACTIVE_CHANNEL: tenant ' + tenantForLog + ' has no active ' +\n"
        "    'WhatsApp channel (Cloud or WAHA) in channel_registry. Refusing to send from a shared ' +\n"
        "    'or default number. Register a channel via nexus_channel_secret_put / channel_registry ' +\n"
        "    'before this dealership can receive outbound WhatsApp.');\n"
        "}\n"
        "let wahaKeyEnv = null;\n"
        "if (picked.channel_type === 'whatsapp_waha_session') {\n"
        "  const ref = String(picked.credential_ref || '');\n"
        "  const m = ref.match(/^env:([A-Za-z0-9_]+)/);\n"
        "  wahaKeyEnv = m ? m[1] : null;\n"
        "  if (!wahaKeyEnv || !$env[wahaKeyEnv]) {\n"
        "    throw new Error('NX1007_NO_ACTIVE_CHANNEL: tenant ' + tenantForLog + ' has a WAHA channel ' +\n"
        "      'registered (' + picked.external_identifier + ') but its credential_ref (' + ref + ') does ' +\n"
        "      'not resolve to a configured secret. Refusing to send.');\n"
        "  }\n"
        "}\n"
        f"const base = $('{carry_from_node}').first().json;\n"
        "return [{ json: Object.assign({}, base, {\n"
        "  send_provider: picked.channel_type,\n"
        "  send_identifier: picked.external_identifier,\n"
        "  waha_api_key_env: wahaKeyEnv\n"
        "}) }];"
    )
    return {
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [x, y],
        "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": js},
    }

def if_cloud_node(name, x, y):
    return {
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.if",
        "typeVersion": 2,
        "position": [x, y],
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                "combinator": "and",
                "conditions": [{
                    "id": nid(),
                    "leftValue": "={{ $json.send_provider }}",
                    "rightValue": "whatsapp_cloud_phone_number_id",
                    "operator": {"type": "string", "operation": "equals"},
                }],
            },
            "options": {},
        },
    }

def reveal_token_node(name, x, y):
    return {
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
        "retryOnFail": True,
        "maxTries": 2,
        "waitBetweenTries": 1000,
        "parameters": {
            "method": "POST",
            "url": f"{SUPA}/rest/v1/rpc/nexus_channel_secret_reveal",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "supabaseApi",
            "sendHeaders": True,
            "headerParameters": {"parameters": [{"name": "Content-Type", "value": "application/json"}]},
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": (
                "={{ JSON.stringify({ p_phone_number_id: $json.send_identifier, "
                "p_kind: 'meta_system_user_token', "
                "p_reason: 'outbound WhatsApp send (NX1007 per-dealer channel)' }) }}"
            ),
            "options": {"timeout": 10000},
        },
    }

def graph_post_node(name, chat_id_expr, text_expr, x, y, onerror=None, retry=None):
    n = {
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
        "parameters": {
            "method": "POST",
            "url": "={{ 'https://graph.facebook.com/v20.0/' + $('__RESOLVE__').first().json.send_identifier + '/messages' }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "Authorization", "value": "={{ 'Bearer ' + $('__REVEAL__').first().json.secret }}"},
                    {"name": "Content-Type", "value": "application/json"},
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": (
                "={{ JSON.stringify({ messaging_product: 'whatsapp', to: "
                + chat_id_expr + ", type: 'text', text: { body: " + text_expr + " } }) }}"
            ),
            "options": {"timeout": 15000},
        },
    }
    if onerror:
        n["onError"] = onerror
    if retry:
        n.update(retry)
    return n

def set_conn(conns, src, idx_list):
    conns.setdefault(src, {"main": []})
    conns[src]["main"] = idx_list

def patch_send_site(w, send_node_name, tenant_expr, tenant_label_expr, carry_from, suffix,
                     chat_id_expr_waha_to_graph, text_expr_ref):
    """Insert Fetch/Resolve/IF/Cloud-branch ahead of an existing WAHA send node,
    rewrite the WAHA node's session + api-key to be dynamic, and reconnect both
    branches to the WAHA node's original downstream target(s)."""
    nodes = w["nodes"]
    conns = w["connections"]
    by_name = {n["name"]: n for n in nodes}
    send_node = by_name[send_node_name]
    x, y = send_node.get("position", [0, 0])

    fetch_n = fetch_channel_node(f"Fetch Send Channel ({suffix})", tenant_expr, x - 700, y - 120)
    resolve_n = resolve_channel_node(f"Resolve Send Channel ({suffix})", tenant_label_expr, carry_from, x - 500, y - 120)
    if_n = if_cloud_node(f"Send Channel Is Cloud? ({suffix})", x - 300, y - 120)
    reveal_n = reveal_token_node(f"Reveal Cloud Token ({suffix})", x - 100, y - 220)
    reveal_n["parameters"]["jsonBody"] = reveal_n["parameters"]["jsonBody"]
    graph_n = graph_post_node(
        f"POST Graph Messages ({suffix})",
        chat_id_expr_waha_to_graph, text_expr_ref, x + 120, y - 220,
        onerror=send_node.get("onError"),
        retry={k: send_node[k] for k in ("retryOnFail", "maxTries", "waitBetweenTries") if k in send_node},
    )
    graph_n["parameters"]["url"] = graph_n["parameters"]["url"].replace("__RESOLVE__", resolve_n["name"])
    graph_n["parameters"]["headerParameters"]["parameters"][0]["value"] = (
        graph_n["parameters"]["headerParameters"]["parameters"][0]["value"].replace("__REVEAL__", reveal_n["name"])
    )

    # Rewrite the original WAHA send node: dynamic session + dynamic api key env.
    body = send_node["parameters"]["jsonBody"]
    assert "session: 'default'" in body, f"expected literal default session in {send_node_name}"
    body = body.replace("session: 'default'", f"session: $('{resolve_n['name']}').first().json.send_identifier")
    send_node["parameters"]["jsonBody"] = body
    hp = send_node["parameters"]["headerParameters"]["parameters"]
    for h in hp:
        if h["name"] == "X-Api-Key":
            h["value"] = "={{ $env[$('%s').first().json.waha_api_key_env] }}" % resolve_n["name"]

    nodes.extend([fetch_n, resolve_n, if_n, reveal_n, graph_n])

    # Find who currently feeds send_node, and repoint them at fetch_n instead.
    for src, v in conns.items():
        for outs in v.get("main", []):
            for o in outs:
                if o["node"] == send_node_name:
                    o["node"] = fetch_n["name"]

    set_conn(conns, fetch_n["name"], [[{"node": resolve_n["name"], "type": "main", "index": 0}]])
    set_conn(conns, resolve_n["name"], [[{"node": if_n["name"], "type": "main", "index": 0}]])
    set_conn(conns, if_n["name"], [
        [{"node": reveal_n["name"], "type": "main", "index": 0}],   # true -> cloud
        [{"node": send_node_name, "type": "main", "index": 0}],     # false -> waha (existing node, now dynamic)
    ])
    set_conn(conns, reveal_n["name"], [[{"node": graph_n["name"], "type": "main", "index": 0}]])

    # Cloud branch must land wherever the WAHA node's outputs already go.
    orig_outs = conns.get(send_node_name, {}).get("main", [[]])
    graph_conn_outs = copy.deepcopy(orig_outs)
    set_conn(conns, graph_n["name"], graph_conn_outs)
    return w


def load(p):
    return json.load(open(p))

def save(w, p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(w, open(p, "w"), indent=1)
    print("wrote", p, "nodes=", len(w["nodes"]))

if __name__ == "__main__":
    base = "ops/per-dealer-send"

    # ---- Drip (G7FhvMY2ucW5Fg7X) ----
    w = load(f"{base}/live/drip.json")
    patch_send_site(
        w, "WhatsApp: Welcome",
        tenant_expr="$('Resolve Tenant').first().json.tenant_id",
        tenant_label_expr="($('Resolve Tenant').first().json.tenant_id || 'UNKNOWN')",
        carry_from="Resolve Tenant",  # already executed on both Day1/Day5 paths; drip's own body refs are name-based
        suffix="Day1",
        chat_id_expr_waha_to_graph=(
            "String((() => { const pick = (n) => { try { const v = $(n).first().json.phone; "
            "return v ? String(v).trim() : null; } catch (e) { return null; } }; "
            "return pick('Lead State (Day 5)') || pick('Lead State (Day 1)') || pick('Normalize Lead Input'); "
            "})() || '').replace(/[^0-9]/g,'')"
        ),
        text_expr_ref=(
            "'Hi ' + ($('Normalize Lead Input').first().json.name || 'there') + "
            "', thanks for contacting NEXUS OS! We have just emailed you details about the ' + "
            "$('Normalize Lead Input').first().json.vehicle_interest + "
            "'. Reply here any time and our team will help you directly.'"
        ),
    )
    patch_send_site(
        w, "WhatsApp: Check-in",
        tenant_expr="$('Resolve Tenant').first().json.tenant_id",
        tenant_label_expr="($('Resolve Tenant').first().json.tenant_id || 'UNKNOWN')",
        carry_from="Resolve Tenant",
        suffix="Day5",
        chat_id_expr_waha_to_graph=(
            "String((() => { const pick = (n) => { try { const v = $(n).first().json.phone; "
            "return v ? String(v).trim() : null; } catch (e) { return null; } }; "
            "return pick('Lead State (Day 5)') || pick('Lead State (Day 1)') || pick('Normalize Lead Input'); "
            "})() || '').replace(/[^0-9]/g,'')"
        ),
        text_expr_ref=(
            "'Hi ' + ($('Normalize Lead Input').first().json.name || 'there') + "
            "', our weekend specials are live at NEXUS OS. Want me to book you a test drive for the ' + "
            "$('Normalize Lead Input').first().json.vehicle_interest + '?'"
        ),
    )
    save(w, f"{base}/patched/drip.G7FhvMY2ucW5Fg7X.json")

    # ---- KYC (qTnh3nwWheFJbFkU) ----
    w = load(f"{base}/live/kyc.json")
    patch_send_site(
        w, "WhatsApp: Request Re-upload",
        tenant_expr="$('Prepare Document').first().json.tenant_id",
        tenant_label_expr="($('Prepare Document').first().json.tenant_id || 'UNKNOWN')",
        carry_from="Within Retry Limit?",
        suffix="Reask",
        chat_id_expr_waha_to_graph="String($json.chat_id || '').replace(/@c\\.us$/,'').replace(/[^0-9]/g,'')",
        text_expr_ref="$json.text",
    )
    patch_send_site(
        w, "WhatsApp: KYC Approved",
        tenant_expr="$('Prepare Document').first().json.tenant_id",
        tenant_label_expr="($('Prepare Document').first().json.tenant_id || 'UNKNOWN')",
        carry_from="Approved",
        suffix="Approved",
        chat_id_expr_waha_to_graph="String($json.chat_id || '').replace(/@c\\.us$/,'').replace(/[^0-9]/g,'')",
        text_expr_ref=(
            "'Hi ' + ($json.lead_name || 'there') + ', good news - your document has been verified "
            "successfully. We are moving your application to the next step.'"
        ),
    )
    save(w, f"{base}/patched/kyc.qTnh3nwWheFJbFkU.json")

    # ---- Dashboard Reply (yx6m55p1Kj8V7koR) ----
    w = load(f"{base}/live/dashreply.json")
    patch_send_site(
        w, "Send via WAHA",
        tenant_expr="$json.tenant_id",
        tenant_label_expr="($json.tenant_id || 'UNKNOWN')",
        carry_from="Has chat_id and text?",
        suffix="DashReply",
        chat_id_expr_waha_to_graph="String($json.chat_id || '').replace(/@c\\.us$/,'').replace(/[^0-9]/g,'')",
        text_expr_ref="$json.text",
    )
    save(w, f"{base}/patched/dashreply.yx6m55p1Kj8V7koR.json")

    print("OK")
