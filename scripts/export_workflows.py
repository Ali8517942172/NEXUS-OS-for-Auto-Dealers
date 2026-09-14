#!/usr/bin/env python3
"""Export every live n8n workflow into n8n-workflows/ so the repo matches reality.

Run from the repo root:

    N8N_API_KEY=... python3 scripts/export_workflows.py

Falls back to reading N8N_API_KEY from ./.env. Exports carry credential
*references* (id + name) only — no secret material — plus the Supabase anon key
where a workflow embeds it, which is publishable by design. Nothing here is a
secret, so the output is safe to commit.

Without this, `n8n-workflows/*.json` drifts from what is deployed, and there is
no diffable record of what actually changed — which is most of why workflows
appear to break for no reason.
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("N8N_BASE_URL", "https://35.224.126.225.nip.io") + "/api/v1"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "n8n-workflows")


def api_key():
    k = os.environ.get("N8N_API_KEY")
    if k:
        return k
    env_path = os.path.join(os.path.dirname(OUT), ".env")
    if os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            line = line.strip().lstrip("﻿")
            if line.startswith("N8N_API_KEY="):
                return line.split("=", 1)[1].strip()
    sys.exit("N8N_API_KEY not set and not found in .env")


HEADERS = {"X-N8N-API-KEY": api_key()}


def get(path):
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for w in sorted(get("/workflows?limit=100")["data"], key=lambda x: x["name"]):
        d = get("/workflows/" + w["id"])
        slug = re.sub(r"[^a-z0-9]+", "_", d["name"].lower()).strip("_")
        doc = {k: d[k] for k in ("name", "nodes", "connections", "settings") if k in d}
        doc["_exported_from"] = {
            "id": d["id"], "active": d["active"], "updatedAt": d["updatedAt"],
            # False means the n8n UI is showing an orange Publish button: the
            # draft on screen differs from the version actually running.
            # A workflow that was never published has activeVersionId = null.
            # `None == None` is True, so the naive equality reported exactly the
            # workflows this check exists to catch as published. Require the id
            # to exist before comparing.
            "published": bool(d.get("activeVersionId"))
                         and d.get("versionId") == d.get("activeVersionId"),
        }
        with open(os.path.join(OUT, slug + ".json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
        index.append({"file": slug + ".json", "id": d["id"], "name": d["name"],
                      "active": d["active"], "nodes": len(d["nodes"]),
                      "published": doc["_exported_from"]["published"]})
        print("%3d nodes  %s.json" % (len(d["nodes"]), slug))

    with open(os.path.join(OUT, "_index.json"), "w", encoding="utf-8") as f:
        json.dump({"exported_at": datetime.now(timezone.utc).isoformat(),
                   "source": BASE,
                   "note": "Live export via the n8n public API. Credential references "
                           "only, no secret material. Regenerate with "
                           "scripts/export_workflows.py.",
                   "workflows": index}, f, indent=2)
    print("\nwrote %d files to %s" % (len(index) + 1, OUT))


if __name__ == "__main__":
    main()
