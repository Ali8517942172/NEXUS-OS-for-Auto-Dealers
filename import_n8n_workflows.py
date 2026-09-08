#!/usr/bin/env python3
"""
NEXUS OS — n8n Workflow Importer
=========================================
Ye script n8n mein existing workflows check karta hai,
phir sirf wahi import karta hai jo missing hain.

Usage:
  python import_n8n_workflows.py <YOUR_N8N_API_KEY>

n8n kahan chal raha hai:
  Default base URL: https://35.224.126.225.nip.io  (GCP VM `nexus-vm`)
  Kisi aur instance pe chalana ho to N8N_BASE_URL env var set kar do, e.g.
      N8N_BASE_URL=https://35.224.126.225.nip.io python import_n8n_workflows.py <API_KEY>

n8n API key kaise banayein:
  1. https://35.224.126.225.nip.io open karo (already logged in ho)
  2. Bottom-left mein apna naam → Settings click karo
  3. "n8n API" section mein jao
  4. "Create an API key" click karo
  5. Key copy karo aur yahan paste karo
"""

import sys
import json
import os
import urllib.request
import urllib.error

# n8n base URL. Defaults to the GCP VM `nexus-vm`; override with N8N_BASE_URL.
DEFAULT_N8N_BASE = "https://35.224.126.225.nip.io"
N8N_BASE = os.environ.get("N8N_BASE_URL", DEFAULT_N8N_BASE).rstrip("/")
WORKFLOWS_DIR = os.path.join(os.path.dirname(__file__), "n8n-workflows")

# 8 workflow files jinhe import karna hai
WORKFLOW_FILES = [
    "customer_360.json",
    "document_auditor.json",
    "dynamic_pricing.json",
    "finance_calc.json",
    "marketing_drip.json",
    "rag_sync.json",
    "slack_router.json",
    "whatsapp_bdc.json",
]

def api_request(method, path, api_key, data=None):
    url = f"{N8N_BASE}{path}"
    headers = {
        "X-N8N-API-KEY": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as ex:
        return 0, {"error": str(ex)}

def get_existing_workflows(api_key):
    status, data = api_request("GET", "/api/v1/workflows?limit=100", api_key)
    if status != 200:
        print(f"❌ API Error {status}: {data}")
        sys.exit(1)
    return {w["name"]: w["id"] for w in data.get("data", [])}

def import_workflow(api_key, filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        wf_data = json.load(f)

    # n8n import format needs 'name' + 'nodes' + 'connections' + 'settings'
    payload = {
        "name": wf_data.get("name", os.path.basename(filepath)),
        "nodes": wf_data.get("nodes", []),
        "connections": wf_data.get("connections", {}),
        "settings": wf_data.get("settings", {}),
        "staticData": wf_data.get("staticData", None),
    }

    status, resp = api_request("POST", "/api/v1/workflows", api_key, payload)
    return status, resp

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("❌ API key nahi diya. Usage: python import_n8n_workflows.py <API_KEY>")
        sys.exit(1)

    api_key = sys.argv[1].strip()

    print("=" * 60)
    print("  NEXUS OS — n8n Workflow Importer")
    print("=" * 60)

    # Step 1: Existing workflows fetch karo
    print("\n📋 Existing workflows check kar raha hoon...")
    existing = get_existing_workflows(api_key)

    if existing:
        print(f"\n✅ Already exist karne wale workflows ({len(existing)}):")
        for name, wid in existing.items():
            print(f"   • [{wid}] {name}")
    else:
        print("   (koi workflow nahi mila — fresh install)")

    # Step 2: Compare karo aur decide karo
    print(f"\n📂 Import folder: {WORKFLOWS_DIR}")

    to_import = []
    to_skip = []

    for filename in WORKFLOW_FILES:
        filepath = os.path.join(WORKFLOWS_DIR, filename)
        if not os.path.exists(filepath):
            print(f"   ⚠️  File not found: {filename}")
            continue

        with open(filepath, "r", encoding="utf-8") as f:
            wf = json.load(f)
        wf_name = wf.get("name", filename)

        if wf_name in existing:
            to_skip.append((filename, wf_name))
        else:
            to_import.append((filename, wf_name, filepath))

    print(f"\n⏭️  Skip honge (already exist): {len(to_skip)}")
    for fname, wname in to_skip:
        print(f"   • {wname}  ({fname})")

    print(f"\n📥 Import honge (missing): {len(to_import)}")
    for fname, wname, _ in to_import:
        print(f"   • {wname}  ({fname})")

    if not to_import:
        print("\n🎉 Sab workflows already import hain! Kuch karne ki zaroorat nahi.")
        return

    # Step 3: Import karo
    print("\n🚀 Import shuru ho raha hai...")
    success = []
    failed = []

    for filename, wf_name, filepath in to_import:
        print(f"   ⏳ Importing: {wf_name}...", end="", flush=True)
        status, resp = import_workflow(api_key, filepath)
        if status in (200, 201):
            wf_id = resp.get("id", "?")
            print(f" ✅  (ID: {wf_id})")
            success.append((wf_name, wf_id))
        else:
            err = resp.get("message", str(resp))
            print(f" ❌  Error: {err}")
            failed.append((wf_name, err))

    # Step 4: Summary
    print("\n" + "=" * 60)
    print("  IMPORT SUMMARY")
    print("=" * 60)
    print(f"  ✅ Successfully imported: {len(success)}")
    for name, wid in success:
        print(f"     • {name} → ID: {wid}")

    if to_skip:
        print(f"  ⏭️  Skipped (duplicates): {len(to_skip)}")
        for _, name in to_skip:
            print(f"     • {name}")

    if failed:
        print(f"  ❌ Failed: {len(failed)}")
        for name, err in failed:
            print(f"     • {name}: {err}")

    print(f"\n🎉 Done! n8n → {N8N_BASE}/home/workflows pe check karo.")

if __name__ == "__main__":
    main()
