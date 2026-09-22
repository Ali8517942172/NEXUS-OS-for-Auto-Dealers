#!/usr/bin/env python3
import json, glob, os, sys, re
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.expanduser("~/nexus-work/ops/tenant-precedence"))
import wf  # has call()

REPO = os.path.expanduser("~/nexus-work")
WFDIR = os.path.join(REPO, "n8n-workflows")
CUTOFF = datetime.now(timezone.utc) - timedelta(days=7)

index = json.load(open(os.path.join(WFDIR, "_index.json")))["workflows"]

TENANT_PATTERNS = [
    ("jwt_membership", re.compile(r"membership|jwt|auth0|req_tenant|x-tenant-id|requesterTenant", re.I)),
    ("env_map", re.compile(r"NEXUS_TENANT_MAP|\$env\.[A-Z_]*TENANT", re.I)),
    ("signed_input", re.compile(r"hmac|signature|signed_?payload|verifySignature", re.I)),
    ("per_row_lookup", re.compile(r"tenant_id.*from|select.*tenant_id|dealership_id", re.I)),
]

SINK_PATTERNS = [
    ("waha_session_hardcode", re.compile(r'"session"\s*:\s*"default"|session=default|/api/sendText.*default', re.I)),
    ("slack_channel_hardcode", re.compile(r'"channel"\s*:\s*"C0[A-Z0-9]{8,}"|#sales-hot-leads', re.I)),
    ("gmail_recipient_hardcode", re.compile(r'"sendTo"\s*:\s*"[^{][^"]*@[^"]*"', re.I)),
    ("bitrix_hardcode", re.compile(r"bitrix24\.com/rest|crm\.lead\.add", re.I)),
]

EXTERNAL_HTTP_TYPES = {"n8n-nodes-base.httpRequest"}
LLM_TYPES = {"@n8n/n8n-nodes-langchain.agent", "@n8n/n8n-nodes-langchain.openAi",
             "@n8n/n8n-nodes-langchain.lmChatOpenAi", "@n8n/n8n-nodes-langchain.chainLlm"}

def analyze(fname, meta):
    d = json.load(open(os.path.join(WFDIR, fname)))
    nodes = d["nodes"]
    settings = d.get("settings", {})
    full_text = json.dumps(d)

    triggers = []
    for n in nodes:
        t = n.get("type", "")
        p = n.get("parameters", {}) or {}
        if t == "n8n-nodes-base.webhook":
            triggers.append({
                "kind": "webhook", "name": n.get("name"),
                "path": p.get("path"), "method": p.get("httpMethod", "GET"),
                "responseMode": p.get("responseMode"),
            })
        elif t == "n8n-nodes-base.scheduleTrigger":
            rule = p.get("rule", {})
            triggers.append({"kind": "schedule", "name": n.get("name"), "rule": rule})
        elif t == "n8n-nodes-base.executeWorkflowTrigger":
            triggers.append({"kind": "executeWorkflowTrigger", "name": n.get("name")})
        elif t == "n8n-nodes-base.errorTrigger":
            triggers.append({"kind": "errorTrigger", "name": n.get("name")})

    tenant_sources = sorted({label for label, pat in TENANT_PATTERNS if pat.search(full_text)})
    sinks = sorted({label for label, pat in SINK_PATTERNS if pat.search(full_text)})

    ext_no_timeout = []
    ext_no_onerror = []
    for n in nodes:
        t = n.get("type", "")
        p = n.get("parameters", {}) or {}
        if t in EXTERNAL_HTTP_TYPES or t in LLM_TYPES:
            timeout = None
            if isinstance(p.get("options"), dict):
                timeout = p["options"].get("timeout")
            if t in EXTERNAL_HTTP_TYPES and timeout is None:
                ext_no_timeout.append(n.get("name"))
            if not n.get("onError"):
                ext_no_onerror.append(n.get("name"))

    return {
        "id": meta["id"], "name": meta["name"], "file": fname,
        "active": meta["active"], "nodes": meta["nodes"],
        "published": meta["published"],
        "triggers": triggers,
        "save_success": settings.get("saveDataSuccessExecution"),
        "save_error": settings.get("saveDataErrorExecution"),
        "errorWorkflow": settings.get("errorWorkflow"),
        "executionTimeout": settings.get("executionTimeout"),
        "tenant_sources": tenant_sources,
        "single_tenant_sinks": sinks,
        "ext_nodes_no_timeout": ext_no_timeout,
        "ext_nodes_no_onerror": ext_no_onerror,
    }

def executions_7d(wid):
    counts = {}
    cursor = None
    total_seen = 0
    for _ in range(30):
        path = f"/executions?workflowId={wid}&limit=100"
        if cursor:
            path += f"&cursor={cursor}"
        try:
            r = wf.call("GET", path)
        except Exception as e:
            return {"error": str(e)}
        data = r.get("data", [])
        if not data:
            break
        stop = False
        for e in data:
            started = e.get("startedAt")
            if not started:
                continue
            ts = datetime.fromisoformat(started.replace("Z", "+00:00"))
            total_seen += 1
            if ts < CUTOFF:
                stop = True
                continue
            st = e.get("status", "unknown")
            counts[st] = counts.get(st, 0) + 1
        cursor = r.get("nextCursor")
        if not cursor or stop:
            break
    return {"counts_7d": counts, "ever_ran": total_seen > 0}

results = []
for meta in index:
    row = analyze(meta["file"], meta)
    ex = executions_7d(meta["id"])
    row["executions_7d"] = ex.get("counts_7d", {})
    row["ever_ran"] = ex.get("ever_ran", False)
    if "error" in ex:
        row["executions_error"] = ex["error"]
    results.append(row)
    print(f"done {meta['name']} ever_ran={row['ever_ran']} 7d={row['executions_7d']}")

out_dir = os.path.join(REPO, "ops", "audit-2026-09-21")
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, "n8n-audit.json"), "w") as f:
    json.dump(results, f, indent=2, default=str)
print("WROTE", os.path.join(out_dir, "n8n-audit.json"))
