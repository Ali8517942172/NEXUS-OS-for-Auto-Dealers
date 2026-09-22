#!/usr/bin/env python3
import json, os

REPO = os.path.expanduser("~/nexus-work")
AUDIT = os.path.join(REPO, "ops", "audit-2026-09-21", "n8n-audit.json")
OUT = os.path.join(REPO, "ops", "audit-2026-09-21", "N8N-AUDIT.md")
rows = json.load(open(AUDIT))

def trig_str(triggers):
    parts = []
    for t in triggers:
        if t["kind"] == "webhook":
            parts.append(f"webhook {t.get('method')} /{t.get('path')} ({t.get('responseMode')})")
        elif t["kind"] == "schedule":
            rule = t.get("rule", {})
            iv = rule.get("interval", [{}])
            f = iv[0] if iv else {}
            if f.get("field") == "cronExpression":
                parts.append(f"cron `{f.get('expression')}`")
            elif "minutesInterval" in f:
                parts.append(f"every {f['minutesInterval']}min")
            elif "triggerAtHour" in f:
                parts.append(f"daily {f.get('triggerAtHour')}:{f.get('triggerAtMinute',0):02d}")
            else:
                parts.append(f"schedule {f.get('field','hours')}")
        elif t["kind"] == "executeWorkflowTrigger":
            parts.append("executeWorkflowTrigger")
        elif t["kind"] == "errorTrigger":
            parts.append("errorTrigger")
    return "; ".join(parts) if parts else "none"

def exec_str(d):
    if not d:
        return "0"
    return ", ".join(f"{k}:{v}" for k, v in sorted(d.items()))

lines = []
lines.append("# NEXUS OS n8n Workflow Audit -- 2026-09-21\n")
lines.append("Read-only audit. Source: fresh export via `scripts/export_workflows.py` against the live n8n public API. "
              "7-day execution window: 2026-09-14 -> 2026-09-21 (UTC).\n")

by_v = {}
for r in rows:
    by_v.setdefault(r["verdict"], []).append(r)
lines.append("## Verdict totals\n")
for v in ("READY", "NEEDS_FIX", "BLOCKED", "NOT_TESTED"):
    lines.append(f"- **{v}**: {len(by_v.get(v, []))}")
lines.append("")

lines.append("## Full table\n")
header = ["Name", "id", "active", "published", "nodes", "triggers", "save(ok/err)",
          "errorWorkflow", "timeout(s)", "tenant source", "single-tenant sinks",
          "ext no-timeout", "ext no-onError", "execs (7d)", "ever ran", "VERDICT", "reason"]
lines.append("| " + " | ".join(header) + " |")
lines.append("|" + "---|" * len(header))
for r in sorted(rows, key=lambda x: x["name"]):
    row = [
        r["name"],
        r["id"],
        "yes" if r["active"] else "no",
        "yes" if r["published"] else "no",
        str(r["nodes"]),
        trig_str(r["triggers"]),
        f"{r.get('save_success')}/{r.get('save_error')}",
        r.get("errorWorkflow") or "none",
        str(r.get("executionTimeout")),
        ", ".join(r.get("tenant_sources") or []) or "NONE FOUND",
        ", ".join(r.get("single_tenant_sinks") or []) or "-",
        str(len(r.get("ext_nodes_no_timeout") or [])),
        str(len(r.get("ext_nodes_no_onerror") or [])),
        exec_str(r.get("executions_7d")),
        "yes" if r.get("ever_ran") else "NEVER",
        r["verdict"],
        r["verdict_reason"],
    ]
    row = [c.replace("|", "\\|") for c in row]
    lines.append("| " + " | ".join(row) + " |")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print("wrote", OUT)
