#!/usr/bin/env python3
"""NEXUS tenant-precedence wave helper.

  python3 wf.py fetch <workflowId> <out.json>     # live copy (GET), for editing
  python3 wf.py apply <workflowId> <patched.json> # diff, PUT, re-GET, verify

Reads N8N_API_KEY from ../../.env or the environment. Never prints it.
Only the orchestrator runs `apply`. Sub-agents run `fetch` and edit the file.
"""
import json, os, sys, urllib.request, difflib

BASE = os.environ.get("N8N_BASE_URL", "https://35.224.126.225.nip.io") + "/api/v1"
HERE = os.path.dirname(os.path.abspath(__file__))

def key():
    k = os.environ.get("N8N_API_KEY")
    if k: return k.strip()
    for p in (os.path.join(HERE, "..", "..", ".env"),
              os.path.expanduser("~/mnt/MY RESUMES/nexus-os/.env")):
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                if line.startswith("N8N_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("N8N_API_KEY not found")

def call(method, path, body=None):
    r = urllib.request.Request(BASE + path, method=method,
        headers={"X-N8N-API-KEY": key(), "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None)
    return json.load(urllib.request.urlopen(r, timeout=60))

PUTKEYS = ("name", "nodes", "connections", "settings")

def fetch(wid, out):
    w = call("GET", "/workflows/" + wid)
    json.dump(w, open(out, "w"), indent=1)
    print(f"fetched {wid} active={w.get('active')} nodes={len(w['nodes'])} -> {out}")

def nodemap(w):
    return {n["name"]: n for n in w["nodes"]}

def apply(wid, path, expect=None):
    live = call("GET", "/workflows/" + wid)
    new = json.load(open(path))
    a, b = nodemap(live), nodemap(new)
    added = sorted(set(b) - set(a)); removed = sorted(set(a) - set(b))
    changed = [n for n in sorted(set(a) & set(b))
               if json.dumps(a[n], sort_keys=True) != json.dumps(b[n], sort_keys=True)]
    print(f"live nodes={len(a)} patched nodes={len(b)}")
    print(f"ADDED   : {added}")
    print(f"REMOVED : {removed}")
    print(f"CHANGED : {changed}")
    if removed:
        sys.exit("REFUSING: patch removes nodes. Review by hand.")
    if not (added or changed):
        sys.exit("REFUSING: patch is a no-op.")
    if expect is not None:
        want = set(x for x in expect.split(",") if x)
        got = set(added) | set(changed)
        if got != want:
            sys.exit(f"REFUSING: touched {sorted(got)} but expected {sorted(want)}. Live drifted or patch is wider than reviewed.")
    for n in changed:
        oc = (a[n].get("parameters") or {}).get("jsCode")
        nc = (b[n].get("parameters") or {}).get("jsCode")
        if oc and nc:
            d = list(difflib.unified_diff(oc.splitlines(), nc.splitlines(), lineterm="", n=0))
            print(f"  {n}: jsCode {len(oc)} -> {len(nc)} bytes, {len(d)} diff lines")
    if live.get("connections") != new.get("connections"):
        print("  connections: CHANGED")
    body = {k: new[k] for k in PUTKEYS if k in new}
    call("PUT", "/workflows/" + wid, body)
    back = call("GET", "/workflows/" + wid)
    bb = nodemap(back)
    ok = all(json.dumps(bb.get(n), sort_keys=True) == json.dumps(b[n], sort_keys=True)
             for n in (added + changed))
    print(f"PUT done. active={back.get('active')} nodes={len(back['nodes'])} VERIFIED={ok}")
    if not ok: sys.exit("VERIFY FAILED: live does not match the patch.")


def verify(wid, path):
    """Read-only: GET live, compare every node in patched vs live (ignore key order), print MATCH/MISMATCH per node + connections. Never PUTs."""
    live = call("GET", "/workflows/" + wid)
    new = json.load(open(path))
    a, b = nodemap(live), nodemap(new)
    all_names = sorted(set(a) | set(b))
    any_mismatch = False
    for n in all_names:
        if n not in a:
            print(f"MISMATCH {n}: missing on live")
            any_mismatch = True
        elif n not in b:
            print(f"(not in patched, skipping) {n}")
        else:
            same = json.dumps(a[n], sort_keys=True) == json.dumps(b[n], sort_keys=True)
            print(f"{'MATCH' if same else 'MISMATCH'} {n}")
            if not same:
                any_mismatch = True
    conn_same = live.get("connections") == new.get("connections")
    print(f"{'MATCH' if conn_same else 'MISMATCH'} connections")
    if not conn_same:
        any_mismatch = True
    if any_mismatch:
        sys.exit("VERIFY: MISMATCH found")
    print("VERIFY: all touched nodes + connections MATCH")

if __name__ == "__main__":
    c = sys.argv[1]
    if c == "apply":
        apply(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
    elif c == "fetch":
        fetch(sys.argv[2], sys.argv[3])
    elif c == "verify":
        verify(sys.argv[2], sys.argv[3])
    elif c == "drift":
        import glob
        for f in sorted(glob.glob(os.path.join(HERE, "patched", "*.json"))):
            wid = os.path.basename(f)[:-5]; p = json.load(open(f))
            lv = call("GET", "/workflows/" + wid)
            print(f"{wid} fetched={p.get('updatedAt')} live={lv.get('updatedAt')} DRIFT={p.get('updatedAt') != lv.get('updatedAt')}")
