#!/usr/bin/env python3
"""NEXUS tenant-precedence wave -- three-dealer (A/B/C) customer journeys.

For each dealer (A/B/C) and each of that dealer's customers in
fixtures.json, pushes the customer through the ONE lead door this harness
tests -- the Master Router (POST /webhook/nexus-inbound-lead) -- using
that dealer's own member JWT (password grant against Supabase Auth, same
mechanism as live_adversarial.py), with NO tenant_id claimed in the body
(the customer journey lets the resolver derive the tenant from the JWT's
tenant_members row, same as live_adversarial's "B-no-claim" / RESOLVES
case). It then asserts, read-only, against Supabase:

  1. TENANT CORRECTNESS  -- each pushed customer's lead row exists under
     the pushing dealer's tenant_id, and only that tenant_id.
  2. SEPARATE VS DEDUPED ROWS -- see "WHAT THE SCHEMA ACTUALLY DOES" below.
  3. CROSS-TENANT PHONE COLLISION -- the c2 customer of every dealer shares
     one phone number (PHONE_INDIA) across three different tenants; this
     asserts three separate, tenant-scoped rows exist (service role can
     see all three; no dealer's own JWT can see another dealer's row --
     folded into check 4).
  4. JWT-SCOPED POSTGREST VISIBILITY -- each dealer's own member JWT,
     calling PostgREST's /rest/v1/leads directly (no service role), sees
     ONLY rows under its own tenant_id, even though NEXUS-TEST rows exist
     for all three dealers with overlapping names/phones.

Prints a PASS/FAIL/DRY-RUN table and writes JOURNEYS-RESULTS.md next to
this script.

WHAT THE SCHEMA ACTUALLY DOES (read before trusting check 2's verdicts)
  public.leads' upsert conflict target is UNIQUE(tenant_id, email) -- see
  supabase/migrations/20260902102629_mt_keys_scope_natural_keys_to_tenant.sql
  and .../20260902112540_mt_keys_drop_leads_email_global_unique.sql. Phone
  number is NOT part of the identity key. So:
    * c1 and c3 of the SAME dealer share a phone (PHONE_DUBAI) but have
      different emails -> the schema does NOT dedupe them. This script
      asserts they land as two SEPARATE rows under that dealer's tenant.
      This is a "household / shared number" case, not a duplicate.
    * c4 of each dealer is pushed TWICE with the IDENTICAL email (and the
      identical run marker, so the payload is byte-for-byte the same both
      times) -> the schema's on_conflict=tenant_id,email upsert SHOULD
      dedupe this to exactly ONE row. This script asserts exactly one row,
      and treats a second row as a FAIL (the upsert not behaving as the
      migration says it does).

    python3 journeys.py                                    # dry run (default)
    python3 journeys.py --live                              # push + verify,
                                                              # but the ONLY
                                                              # network calls
                                                              # made are the
                                                              # read-only
                                                              # check 4 probes
                                                              # -- see
                                                              # --no-side-effects
                                                              # below
    python3 journeys.py --live --allow-side-effects          # actually pushes
                                                              # every customer
                                                              # through the
                                                              # master router
    python3 journeys.py --reverify JOURNEYS-RUN.json          # re-judge a
                                                              # previous
                                                              # --allow-side-
                                                              # effects run's
                                                              # executions;
                                                              # sends nothing

--no-side-effects / --allow-side-effects
  The master router has no test/dry-run switch in the workflow itself (grep
  nexus_master_lead_router_ai_agent.json for test_mode/dry_run finds none) --
  every successful push is a REAL fan-out: it can send a REAL WhatsApp
  welcome message, post to the LIVE #sales-hot-leads Slack channel, sync a
  REAL Bitrix24 CRM lead, and enroll the customer in the REAL 7-day email
  drip (Gmail + WhatsApp), depending on how the AI scores the lead. (This
  mirrors the SIDE EFFECTS section of live_adversarial.py's docstring for
  the same door.) All of it is addressed only to dealer test phones/emails
  and is clearly NEXUS-TEST-marked, but a Slack message in a live channel
  and a row in production Bitrix24 are real regardless of the marker.

  --no-side-effects is ALWAYS the effective default -- there is no way to
  turn it off by omission. With --live and no other flag, this script:
    * still fetches all three dealers' access tokens (read-only auth call)
    * still runs check 4 (JWT-scoped PostgREST visibility) against
      whatever NEXUS-TEST rows already exist in the DB from a previous
      --allow-side-effects run -- useful, harmless, no external sends
    * SKIPS the actual webhook pushes and checks 1-3 (nothing to assert
      against a push that was never sent), printing why
  Only --live --allow-side-effects together perform the real pushes and
  the full check 1-3 sweep. Get sign-off before using that combination,
  same as live_adversarial.py's --i-understand-side-effects.

ASYNC TIMING (why this script no longer verifies right after pushing)
  The Master Lead Router's webhook (`Webhook Catch-All`) uses
  responseMode: onReceived -- it returns HTTP 200 the instant the request
  is received, then processes the lead ASYNCHRONOUSLY (AI scoring via
  OpenRouter/Groq, ERP sync, WhatsApp/Slack/Gmail sends, then the Supabase
  insert). Firing all pushes back-to-back and then immediately running the
  Supabase checks races that async work: with N pushes queued at once and
  n8n draining them 1-2 concurrently at 80s-3min each, the checks can run
  (and print FAIL) against a database several of the pushes haven't
  reached yet. This script now finds each push's own n8n EXECUTION (see
  exec_judge.py -- matched by the run marker inside the webhook trigger
  node's own captured request, which survives regardless of what happens
  downstream) and polls it to a terminal state (timeout 120s per push ->
  that push is flagged INCONCLUSIVE, not silently skipped) BEFORE running
  any of checks 1-4, so the database has always finished catching up with
  every push this run is about to grade.

--reverify JOURNEYS-RUN.json
  Re-judges a previous --live --allow-side-effects run's executions and
  Supabase rows WITHOUT pushing anything new. JOURNEYS-RUN.json is the
  case-map this script writes on every --allow-side-effects run: for each
  customer it records the marker, since_iso floor, and the execution_id(s)
  exec_judge found. If a manifest predates this case-map (reconstructed --
  see reconstruct_legacy_case() below), markers are recomputed deterministically
  from the manifest's recorded run_id (marker = f"{run_id}-{customer_id}",
  exactly how this script has always built them) and matched to executions
  by scanning the recorded time window for the master router's own
  executions whose trigger-node body carries that marker -- no guesswork
  needed, unlike live_adversarial.py's legacy reconstruction (that harness's
  markers were random per call and never saved anywhere, so it has to
  disambiguate by the claimed tenant_id instead).

PREREQUISITE
  ops/tenant-precedence/dealer-b/setup.py --apply must already have run,
  so ~/.nexus-dealer-b.json holds all three dealers' tenant ids and user
  ids/emails/passwords (never printed by this script either).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

import exec_judge

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES_PATH = os.path.join(HERE, "fixtures.json")
RESULTS_PATH = os.path.join(HERE, "JOURNEYS-RESULTS.md")
RUN_MAP_PATH = os.path.join(HERE, "JOURNEYS-RUN.json")
ENV_PATH = os.path.join(
    os.path.expanduser("~"), "mnt", "MY RESUMES", "nexus-os", ".env"
)
STATE_PATH = os.path.join(os.path.expanduser("~"), ".nexus-dealer-b.json")
N8N_BASE = "https://35.224.126.225.nip.io"
MASTER_ROUTER_PATH = "nexus-inbound-lead"
MASTER_ROUTER_WORKFLOW_ID = "JnlZFAVmFAuNXVya"
TIMEOUT = 30
EXEC_POLL_TIMEOUT = 120
# Master Router calls OpenRouter for lead scoring; free-tier is rate-limited
# per key. Keep at least this many seconds between any two live pushes.
MIN_CALL_SPACING_SECONDS = 20
_last_call_at = [None]


def _pace(live):
    if not live:
        return
    now = time.monotonic()
    last = _last_call_at[0]
    if last is not None:
        wait = MIN_CALL_SPACING_SECONDS - (now - last)
        if wait > 0:
            print(f"    (pacing: sleeping {wait:.1f}s before next live push)")
            time.sleep(wait)
    _last_call_at[0] = time.monotonic()

PASSWORD_ENV_OVERRIDE = {
    "a": "NEXUS_DEALER_A_PASSWORD",
    "b": "NEXUS_DEALER_B_PASSWORD",
    "c": "NEXUS_DEALER_C_PASSWORD",
}


def load_fixtures():
    if not os.path.exists(FIXTURES_PATH):
        sys.exit(f"fixtures file not found: {FIXTURES_PATH}")
    with open(FIXTURES_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def load_env(path):
    env = {}
    if not os.path.exists(path):
        sys.exit(f"env file not found: {path}")
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_state():
    if not os.path.exists(STATE_PATH):
        sys.exit(
            f"no state file at {STATE_PATH} -- run "
            f"ops/tenant-precedence/dealer-b/setup.py --apply first"
        )
    with open(STATE_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def http(method, url, headers=None, body=None, live=True, label=""):
    """One HTTP call, or (not live) just a printed description of it. Tokens
    and service keys are always redacted in what gets printed."""
    headers = dict(headers or {})
    printable_headers = dict(headers)
    for h in ("Authorization", "apikey"):
        if h in printable_headers:
            printable_headers[h] = "<redacted>"

    if not live:
        print(f"  [{label}] {method} {url}")
        print(f"    headers: {printable_headers}")
        if body is not None:
            print(f"    body: {json.dumps(body)}")
        return None, None

    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw
        return e.code, parsed


def get_access_token(supabase_url, anon_key, email, password, live, label):
    url = supabase_url.rstrip("/") + "/auth/v1/token?grant_type=password"
    headers = {"apikey": anon_key, "Content-Type": "application/json"}
    status, body = http(
        "POST", url, headers=headers, body={"email": email, "password": password},
        live=live, label=label,
    )
    if not live:
        return "<dry-run: token not fetched>"
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        sys.exit(f"[{label}] password grant failed: HTTP {status}: {body}")
    return body["access_token"]


def rest_get(supabase_url, headers, table, params, live, label):
    url = supabase_url.rstrip("/") + f"/rest/v1/{table}?" + urllib.parse.urlencode(params)
    status, body = http("GET", url, headers=headers, live=live, label=label)
    if not live:
        return []
    if status != 200:
        print(f"    ! GET {table} failed: HTTP {status}: {body}")
        return []
    return body or []


def build_payload(dealer_key, customer, run_marker):
    name = f"{customer['name']} [{run_marker}]"
    return {
        "name": name,
        "full_name": name,
        "email": customer["email"],
        "phone": customer["phone"],
        "whatsapp": customer["phone"],
        "vehicle_interest": customer["vehicle_interest"],
        "vehicleInterest": customer["vehicle_interest"],
        "source": "nexus-three-dealer-journeys-harness",
        "lead_marker": run_marker,
        "message": f"NEXUS-TEST customer journey probe {run_marker}",
    }


def push_customer(token, dealer_key, customer, run_marker, live, call_label):
    url = f"{N8N_BASE}/webhook/{MASTER_ROUTER_PATH}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = build_payload(dealer_key, customer, run_marker)
    _pace(live)
    return http("POST", url, headers=headers, body=body, live=live, label=call_label)


def now_iso_floor(seconds_back=180):
    """since_iso floor for exec_judge's execution search. HARNESS BUG FOUND
    AND FIXED 20 Sep 2026 (see live_adversarial.py's copy of this function
    for the full writeup): this machine's clock runs ~45-50s ahead of the
    n8n host's (measured via a GET response's own Date header), so the old
    5s default let a case's own execution's (n8n-clock-timestamped) startedAt
    land BEFORE since_iso (this-machine-clock-timestamped) -- excluding it
    from every poll, forever, regardless of timeout length. 180s absorbs
    that skew with margin; poll_for_case_execution still filters candidates
    by the request's own marker, so a wider floor doesn't risk a false
    match."""
    t = datetime.now(timezone.utc) - timedelta(seconds=seconds_back)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def check_tenant_correctness(rows_by_marker, marker, expect_tenant_id):
    rows = rows_by_marker.get(marker, [])
    if not rows:
        return "FAIL", "no lead row found for this customer's marker"
    wrong = [r for r in rows if r.get("tenant_id") != expect_tenant_id]
    if wrong:
        return "FAIL", f"{len(wrong)} row(s) under the wrong tenant: {wrong}"
    if len(rows) > 1:
        return "FAIL", f"expected exactly 1 row, found {len(rows)}: {rows}"
    return "PASS", f"1 row, tenant_id={expect_tenant_id}"


def check_separate_rows(rows_by_marker, marker_c1, marker_c3, expect_tenant_id):
    r1 = rows_by_marker.get(marker_c1, [])
    r3 = rows_by_marker.get(marker_c3, [])
    if not r1 or not r3:
        return "FAIL", "missing row(s) for the phone-sharing pair"
    ids1 = {r["id"] for r in r1}
    ids3 = {r["id"] for r in r3}
    if ids1 & ids3:
        return "FAIL", "same-dealer, different-email, shared-phone customers were merged into one row (should stay separate -- key is (tenant_id,email), not phone)"
    if any(r.get("tenant_id") != expect_tenant_id for r in r1 + r3):
        return "FAIL", "one of the pair landed under the wrong tenant"
    return "PASS", f"2 separate rows under tenant_id={expect_tenant_id} (correctly NOT deduped on shared phone)"


def check_dedupe(rows_by_marker, marker):
    rows = rows_by_marker.get(marker, [])
    if not rows:
        return "FAIL", "no row found after pushing twice"
    if len(rows) > 1:
        return "FAIL", f"expected the two identical pushes to dedupe to 1 row (on_conflict=tenant_id,email), found {len(rows)}: {rows}"
    return "PASS", "two identical pushes deduped to exactly 1 row"


def check_cross_tenant_collision(rows_by_marker, markers_by_tenant):
    """markers_by_tenant: {tenant_id: marker} for the c2 customer of each of
    the three dealers, all sharing PHONE_INDIA."""
    seen_tenants = set()
    all_ids = set()
    for tenant_id, marker in markers_by_tenant.items():
        rows = rows_by_marker.get(marker, [])
        if len(rows) != 1:
            return "FAIL", f"tenant {tenant_id}: expected 1 row, found {len(rows)}"
        row = rows[0]
        if row.get("tenant_id") != tenant_id:
            return "FAIL", f"tenant {tenant_id}: row filed under {row.get('tenant_id')} instead"
        if row["id"] in all_ids:
            return "FAIL", "two dealers' rows for the shared phone collapsed into the same row id"
        all_ids.add(row["id"])
        seen_tenants.add(tenant_id)
    if len(seen_tenants) != len(markers_by_tenant):
        return "FAIL", "did not observe a distinct row for every dealer"
    return "PASS", f"{len(all_ids)} distinct tenant-scoped rows for the shared phone, no collapse"


def check_jwt_scoped_visibility(rows, own_tenant_id, other_tenant_ids):
    if not rows:
        return "INCONCLUSIVE", "no NEXUS-TEST rows visible at all via this JWT (RLS may be over-restrictive, or nothing pushed yet)"
    leaked = [r for r in rows if r.get("tenant_id") in other_tenant_ids]
    if leaked:
        return "FAIL", f"{len(leaked)} row(s) from another tenant visible via this dealer's own JWT: {leaked}"
    not_own = [r for r in rows if r.get("tenant_id") != own_tenant_id]
    if not_own:
        return "FAIL", f"{len(not_own)} row(s) with neither own nor a known-other tenant_id: {not_own}"
    return "PASS", f"{len(rows)} row(s) visible, all under own tenant_id={own_tenant_id}"


def check_execution_tenant_resolved(execution_id, expect_tenant_id):
    """New: corroborate check 1 from the n8n execution side, independent of
    the Supabase row -- the resolver's OWN output must carry the expected
    tenant_id. Catches the (very unlikely, but not yet ruled out by any
    other check here) case where a row happens to exist with the right
    tenant_id for some unrelated reason but the resolver that ran for THIS
    marker actually resolved something else."""
    if not execution_id:
        return "INCONCLUSIVE", "no execution_id on file for this push"
    execution = exec_judge.get_execution_full(execution_id)
    node, tenant_id = exec_judge.find_resolved_tenant(execution)
    if tenant_id is None:
        return "INCONCLUSIVE", f"execution {execution_id}: no node ever resolved a tenant_id"
    if tenant_id != expect_tenant_id:
        return "FAIL", f"execution {execution_id} ({node}): resolved tenant_id={tenant_id}, expected {expect_tenant_id}"
    return "PASS", f"execution {execution_id} ({node}) resolved tenant_id={expect_tenant_id}"


def write_results_md(results, live, allow_side_effects, extra_header_lines=None):
    lines = [
        "# NEXUS tenant-precedence -- three-dealer journeys results",
        "",
        f"Mode: {'LIVE + --allow-side-effects (full push + verify)' if (live and allow_side_effects) else 'LIVE, read-only check 4 only (--no-side-effects default)' if live else 'DRY RUN (nothing executed)'}",
        "",
    ]
    if extra_header_lines:
        lines += extra_header_lines + [""]
    has_prev = any(len(r) == 5 for r in results)
    if has_prev:
        lines += ["| Check | Scope | Verdict | Previous harness said | Detail |",
                  "|---|---|---|---|---|"]
    else:
        lines += ["| Check | Scope | Verdict | Detail |", "|---|---|---|---|"]
    for row in results:
        if len(row) == 5:
            check, scope, verdict, detail, prev = row
            detail_md = str(detail).replace("|", "\\|")
            lines.append(f"| {check} | {scope} | {verdict} | {prev} | {detail_md} |")
        else:
            check, scope, verdict, detail = row
            detail_md = str(detail).replace("|", "\\|")
            lines.append(f"| {check} | {scope} | {verdict} | {detail_md} |")
    lines.append("")
    with open(RESULTS_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(f"\nwrote {RESULTS_PATH}")


def write_run_map(cases_map, meta):
    payload = {"meta": meta, "cases": cases_map}
    with open(RUN_MAP_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    print(f"\nwrote {RUN_MAP_PATH} (customer -> execution_id map, for --reverify)")


def reconstruct_legacy_case(run_id, customer_id, candidates):
    """Legacy manifests (a run from before this script saved a case map)
    only recorded run_id + the time window pushes happened in. Unlike
    live_adversarial.py's markers (random per call, never recoverable
    except from the execution itself), this script's markers were always
    deterministic: f"{run_id}-{customer_id}", exactly as build_payload()
    still constructs them below. So reconstruction here is a plain
    substring search, no claim-based disambiguation needed. `candidates`
    is the window's executions, already fetched ONCE by the caller (see
    do_reverify) and reused for every customer -- fetching per customer
    was the original, much slower version of this and could time out a
    single tool call for a 15-customer window."""
    marker = f"{run_id}-{customer_id}"
    matches = [e for e in candidates if exec_judge.marker_in_execution(e, marker)]
    return marker, [e.get("id") for e in matches]


def do_reverify(run_json_path, env):
    with open(run_json_path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    meta = manifest.get("meta", {})
    cases_map = manifest.get("cases", {})
    fixtures = load_fixtures()
    for _custs in fixtures["customers"].values():
        for _c in _custs:
            _c["phone"] = fixtures["phones"][_c["phone_ref"]]

    tenant_ids = meta.get("tenant_ids") or {}
    run_id = meta.get("run_id")
    window = meta.get("window")

    service_headers = {
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
    }

    changed = False
    markers = {}
    needs_reconstruction = any(
        not (cases_map.get(c["id"], {}).get("execution_ids"))
        for d in fixtures["dealers"] for c in fixtures["customers"][d["key"]]
    )
    window_candidates = []
    if needs_reconstruction and window and run_id:
        since_iso, until_iso = window
        print(f"  fetching every master-router execution in the legacy window "
              f"{window} ONCE (reused for all customers below)...")
        window_candidates = exec_judge.executions_in_window(
            MASTER_ROUTER_WORKFLOW_ID, since_iso, until_iso)
        print(f"  found {len(window_candidates)} execution(s) in that window")

    for dealer in fixtures["dealers"]:
        key = dealer["key"]
        for customer in fixtures["customers"][key]:
            cid = customer["id"]
            entry = cases_map.get(cid, {})
            execs = entry.get("execution_ids") or []
            if not execs:
                if not window or not run_id:
                    print(f"  [{cid}] no execution_ids on file and no legacy "
                          f"run_id/window to reconstruct from")
                    continue
                marker, found = reconstruct_legacy_case(run_id, cid, window_candidates)
                entry = {"marker": marker, "execution_ids": found, "reconstructed": True}
                cases_map[cid] = entry
                changed = True
                print(f"  [{cid}] reconstructed marker={marker} -> executions {found}")
            markers[cid] = entry.get("marker") or f"{run_id}-{cid}"

    if changed:
        manifest["cases"] = cases_map
        with open(run_json_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=1)
        print(f"\nrewrote {run_json_path} with reconstructed mapping")

    print("\n=== confirming every push's execution is terminal before re-verifying ===")
    for cid, entry in cases_map.items():
        for eid in entry.get("execution_ids") or []:
            execution = exec_judge.get_execution_full(eid)
            execution = exec_judge.poll_until_terminal(execution, timeout=EXEC_POLL_TIMEOUT, log=print)
            print(f"    {cid}: execution {eid} status={execution.get('status')}")

    print("\n=== verifying (service role) ===")
    all_markers = list(markers.values())
    rows_by_marker = {m: [] for m in all_markers}
    rows = rest_get(env["SUPABASE_URL"], service_headers, "leads",
                     {"select": "id,tenant_id,name,email,phone",
                      "name": "ilike.*NEXUS TEST*"},
                     live=True, label="reverify:leads")
    for row in rows:
        for m in all_markers:
            if f"[{m}]" in (row.get("name") or ""):
                rows_by_marker[m].append(row)

    results = []
    prev_totals_note = manifest.get("meta", {}).get("previous_totals", "unknown")

    for dealer in fixtures["dealers"]:
        key = dealer["key"]
        tenant_id = tenant_ids.get(key)
        customers = {c["id"]: c for c in fixtures["customers"][key]}

        for cid in ("c1", "c2", "c3"):
            full_id = f"{key}-{cid}"
            if full_id not in customers:
                continue
            verdict, detail = check_tenant_correctness(rows_by_marker, markers[full_id], tenant_id)
            results.append((f"1:tenant-correctness:{full_id}", key, verdict, detail, "?"))
            exec_ids = (cases_map.get(full_id) or {}).get("execution_ids") or []
            ev, ed = check_execution_tenant_resolved(exec_ids[0] if exec_ids else None, tenant_id)
            results.append((f"1b:execution-tenant-resolved:{full_id}", key, ev, ed, "n/a (new check)"))

        verdict, detail = check_separate_rows(
            rows_by_marker, markers[f"{key}-c1"], markers[f"{key}-c3"], tenant_id)
        results.append((f"2:same-dealer-shared-phone-not-deduped", key, verdict, detail, "?"))

        verdict, detail = check_dedupe(rows_by_marker, markers[f"{key}-c4"])
        results.append((f"2:double-push-deduped", key, verdict, detail, "?"))

    markers_by_tenant = {tenant_ids[k]: markers[f"{k}-c2"] for k in ("a", "b", "c") if k in tenant_ids}
    verdict, detail = check_cross_tenant_collision(rows_by_marker, markers_by_tenant)
    results.append(("3:cross-tenant-phone-collision", "a+b+c", verdict, detail, "?"))

    print("\n=== REVERIFY SUMMARY ===")
    for check, scope, verdict, detail, prev in results:
        print(f"{verdict:12s} {check:35s} {scope:8s} (was {prev:6s}) {detail}")

    write_results_md(results, True, True, extra_header_lines=[
        f"**--reverify** of `{run_json_path}` -- re-judged from n8n execution data "
        f"and a fresh Supabase read, no new pushes sent. \"Previous harness said\" "
        f"is `?` where the original run's per-row verdict wasn't itself saved in "
        f"the manifest (only its markdown table was); the 3 known-FAIL rows from "
        f"the original run are called out below.",
    ])
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true",
                     help="fetch real tokens and run check 4 (read-only) against Supabase; "
                          "see --allow-side-effects for the full push")
    ap.add_argument("--allow-side-effects", action="store_true",
                     help="together with --live, actually push every customer through the "
                          "master router (real WhatsApp/Slack/Bitrix24/Gmail sends possible)")
    ap.add_argument("--no-side-effects", action="store_true", default=True,
                     help="no-op flag documenting the default -- side effects are always off "
                          "unless --allow-side-effects is also given")
    ap.add_argument("--reverify", metavar="RUN.json",
                     help="re-judge a previous --allow-side-effects run's executions/rows, "
                          "without pushing anything new")
    ap.add_argument("--dealers", metavar="KEY[,KEY...]",
                     help="limit the push phase to these dealer keys (a/b/c), "
                          "comma-separated. Default: all dealers in fixtures.json.")
    args = ap.parse_args()

    live = args.live
    allow_side_effects = args.live and args.allow_side_effects

    env = load_env(ENV_PATH)
    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(k):
            sys.exit(f"missing required env var in {ENV_PATH}: {k}")

    if args.reverify:
        do_reverify(args.reverify, env)
        return

    fixtures = load_fixtures()
    # fixtures.json stores phone_ref ("dubai"/"india") per customer, not
    # the literal number, so the two allowed phone numbers are edited in
    # exactly one place. Resolve to the actual phone once, here.
    for _custs in fixtures["customers"].values():
        for _c in _custs:
            _c["phone"] = fixtures["phones"][_c["phone_ref"]]

    if args.dealers:
        wanted = set(x.strip() for x in args.dealers.split(",") if x.strip())
        fixtures["dealers"] = [d for d in fixtures["dealers"] if d["key"] in wanted]
        if not fixtures["dealers"]:
            sys.exit(f"--dealers: no matching dealer key(s) in fixtures.json "
                      f"(wanted {sorted(wanted)})")
        fixtures["customers"] = {k: v for k, v in fixtures["customers"].items()
                                  if k in wanted}
        print(f"=== --dealers filter: running only "
              f"{[d['key'] for d in fixtures['dealers']]} (checks 3/4 for the "
              f"other dealers are not re-run here; see the previous full run) ===\n")

    if allow_side_effects:
        print("=== LIVE MODE, --allow-side-effects -- full push + verify against",
              N8N_BASE, "and", env["SUPABASE_URL"], "===\n")
    elif live:
        print("=== LIVE MODE, side effects OFF (default) -- read-only check 4 only, "
              "no webhook pushes ===\n")
    else:
        print("=== DRY RUN -- printing calls only, nothing executes. "
              "Use --live (then --live --allow-side-effects for the full run). ===\n")

    state = load_state() if live else {
        "dealers": {
            d["key"]: {
                "tenant_id": d.get("tenant_id") or "<dry-run: from state file>",
                "user": {"email": d["member_email"], "password": None},
            }
            for d in fixtures["dealers"]
        }
    }
    dealers_state = state.get("dealers") or {}

    tokens = {}
    tenant_ids = {}
    for dealer in fixtures["dealers"]:
        key = dealer["key"]
        ds = dealers_state.get(key, {})
        tenant_ids[key] = ds.get("tenant_id") or dealer.get("tenant_id")
        user = ds.get("user") or {}
        email = user.get("email", dealer["member_email"])
        password = user.get("password") or os.environ.get(PASSWORD_ENV_OVERRIDE[key])
        if live and not password:
            sys.exit(
                f"state file has no password on file for dealer {key} -- setup.py only "
                f"stores a password for a user IT created. If the account pre-existed, "
                f"set its password out of band and export {PASSWORD_ENV_OVERRIDE[key]}."
            )
        tokens[key] = get_access_token(
            env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"], email, password, live,
            label=f"token:{key}",
        )

    results = []  # (check, scope, verdict, detail)

    # ---- push phase (only with --allow-side-effects) ----
    # marker -> customer meta, and per-dealer list of (customer, marker)
    markers = {}  # customer_id -> run_marker
    run_id = uuid.uuid4().hex[:8]
    cases_map = {}  # customer_id -> {"marker":..., "since_iso":..., "execution_ids":[...]}

    for dealer in fixtures["dealers"]:
        key = dealer["key"]
        customers = fixtures["customers"][key]
        print(f"\n=== dealer {key} ({dealer['label']}) -- {len(customers)} customer(s) ===")
        for customer in customers:
            marker = f"{run_id}-{customer['id']}"
            markers[customer["id"]] = marker
            times = 2 if customer.get("dedupe_probe") else 1
            since_iso = now_iso_floor() if allow_side_effects else None
            for i in range(times):
                label = f"push:{customer['id']}" + (f":{i+1}" if times > 1 else "")
                if allow_side_effects:
                    status, body = push_customer(tokens[key], key, customer, marker,
                                                  live=True, call_label=label)
                    ok = status is not None and status < 400
                    print(f"  [{'PASS' if ok else 'FAIL'}] push {customer['id']}"
                          f"{' (dedupe pass ' + str(i+1) + ')' if times > 1 else ''} "
                          f"-> HTTP {status}")
                    if not ok:
                        results.append((f"push:{customer['id']}", key, "FAIL",
                                         f"HTTP {status}: {body}"))
                else:
                    push_customer(tokens[key], key, customer, marker, live=False,
                                  call_label=label)
            if allow_side_effects:
                cases_map[customer["id"]] = {"marker": marker, "since_iso": since_iso,
                                              "execution_ids": []}

    if not allow_side_effects:
        print("\n(side effects OFF -- no customer was actually pushed through the "
              "master router; checks 1-3 below are skipped)")

    # ---- wait for every push's async execution to finish BEFORE verifying --
    # this is the fix for the race the harness used to have: verifying right
    # after the HTTP 200s came back, before the Master Router's async AI
    # scoring / persistence had actually run for every push.
    if allow_side_effects:
        print("\n=== waiting for each push's n8n execution to reach a terminal state "
              "(this is what used to race the verification below) ===")
        for cid, entry in cases_map.items():
            execution = exec_judge.poll_for_case_execution(
                MASTER_ROUTER_WORKFLOW_ID, entry["marker"], entry["since_iso"],
                timeout=EXEC_POLL_TIMEOUT, log=print)
            if execution is None:
                print(f"    {cid}: INCONCLUSIVE -- no execution found within "
                      f"{EXEC_POLL_TIMEOUT}s for marker {entry['marker']}")
                results.append((f"0:execution-found:{cid}", cid, "INCONCLUSIVE",
                                 f"no execution found within {EXEC_POLL_TIMEOUT}s"))
                continue
            execution = exec_judge.poll_until_terminal(execution, timeout=EXEC_POLL_TIMEOUT, log=print)
            entry["execution_ids"].append(execution.get("id"))
            print(f"    {cid}: execution {execution.get('id')} status={execution.get('status')}")
            # dedupe_probe customers are pushed twice with the identical
            # marker -- there may be a second, later execution for the same
            # marker; look for one more before moving on.
            customer = next(c for c in fixtures["customers"][cid.split("-")[0]] if c["id"] == cid)
            if customer.get("dedupe_probe"):
                second = exec_judge.poll_for_case_execution(
                    MASTER_ROUTER_WORKFLOW_ID, entry["marker"],
                    since_iso=execution.get("startedAt", entry["since_iso"]),
                    timeout=EXEC_POLL_TIMEOUT, log=print)
                if second and second.get("id") != execution.get("id"):
                    second = exec_judge.poll_until_terminal(second, timeout=EXEC_POLL_TIMEOUT, log=print)
                    entry["execution_ids"].append(second.get("id"))
                    print(f"    {cid}: second push's execution {second.get('id')} "
                          f"status={second.get('status')}")

    # ---- verification phase ----
    service_headers = {
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
    }

    if allow_side_effects:
        print("\n=== verifying (service role) -- now that every push's execution "
              "has reached a terminal state ===")
        all_markers = list(markers.values())
        rows_by_marker = {m: [] for m in all_markers}
        rows = rest_get(env["SUPABASE_URL"], service_headers, "leads",
                         {"select": "id,tenant_id,name,email,phone",
                          "name": "ilike.*NEXUS TEST*"},
                         live=True, label="verify:leads")
        for row in rows:
            for m in all_markers:
                if f"[{m}]" in (row.get("name") or ""):
                    rows_by_marker[m].append(row)

        for dealer in fixtures["dealers"]:
            key = dealer["key"]
            tenant_id = tenant_ids[key]
            customers = {c["id"]: c for c in fixtures["customers"][key]}

            for cid in ("c1", "c2", "c3"):
                full_id = f"{key}-{cid}"
                if full_id not in customers:
                    continue
                verdict, detail = check_tenant_correctness(
                    rows_by_marker, markers[full_id], tenant_id)
                results.append((f"1:tenant-correctness:{full_id}", key, verdict, detail))
                exec_ids = cases_map.get(full_id, {}).get("execution_ids") or []
                ev, ed = check_execution_tenant_resolved(
                    exec_ids[0] if exec_ids else None, tenant_id)
                results.append((f"1b:execution-tenant-resolved:{full_id}", key, ev, ed))

            verdict, detail = check_separate_rows(
                rows_by_marker, markers[f"{key}-c1"], markers[f"{key}-c3"], tenant_id)
            results.append((f"2:same-dealer-shared-phone-not-deduped", key, verdict, detail))

            verdict, detail = check_dedupe(rows_by_marker, markers[f"{key}-c4"])
            results.append((f"2:double-push-deduped", key, verdict, detail))

        _all_keys = ("a", "b", "c")
        _present = [k for k in _all_keys if k in tenant_ids and f"{k}-c2" in markers]
        if len(_present) == len(_all_keys):
            markers_by_tenant = {tenant_ids[k]: markers[f"{k}-c2"] for k in _all_keys}
            verdict, detail = check_cross_tenant_collision(rows_by_marker, markers_by_tenant)
            results.append(("3:cross-tenant-phone-collision", "a+b+c", verdict, detail))
        else:
            results.append(("3:cross-tenant-phone-collision", "a+b+c", "SKIPPED",
                             f"not re-run: --dealers limited this run's pushes to "
                             f"{_present}; see the previous JOURNEYS-RUN.json for the "
                             f"full a+b+c result"))

    # ---- check 4: per-dealer JWT direct PostgREST visibility (always run when --live) ----
    if live:
        print("\n=== verifying (per-dealer member JWT, direct PostgREST) ===")
        other_tenant_ids_by_dealer = {
            k: {tenant_ids[o] for o in tenant_ids if o != k} for k in tenant_ids
        }
        for dealer in fixtures["dealers"]:
            key = dealer["key"]
            headers = {"apikey": env["SUPABASE_ANON_KEY"],
                       "Authorization": f"Bearer {tokens[key]}"}
            rows = rest_get(env["SUPABASE_URL"], headers, "leads",
                             {"select": "id,tenant_id,name", "name": "ilike.*NEXUS TEST*"},
                             live=True, label=f"verify:jwt:{key}")
            verdict, detail = check_jwt_scoped_visibility(
                rows, tenant_ids[key], other_tenant_ids_by_dealer[key])
            results.append(("4:jwt-scoped-postgrest-visibility", key, verdict, detail))
    else:
        for dealer in fixtures["dealers"]:
            print(f"    would GET /rest/v1/leads as dealer {dealer['key']}'s own JWT "
                  f"and assert every row's tenant_id == {dealer['key']}'s own tenant")
            results.append(("4:jwt-scoped-postgrest-visibility", dealer["key"], "DRY-RUN", ""))

    if not allow_side_effects:
        for label in ("1:tenant-correctness", "2:same-dealer-shared-phone-not-deduped",
                      "2:double-push-deduped", "3:cross-tenant-phone-collision"):
            results.append((label, "a/b/c", "SKIPPED",
                             "requires --live --allow-side-effects (not run: side effects off)"
                             if live else "dry-run: would push then assert"))

    print("\n=== SUMMARY ===")
    for check, scope, verdict, detail in results:
        print(f"{verdict:12s} {check:45s} {scope:8s} {detail}")

    write_results_md(results, live, allow_side_effects)

    if allow_side_effects:
        write_run_map(cases_map, {
            "run_id": run_id,
            "tenant_ids": tenant_ids,
        })
        fails = [r for r in results if r[2] == "FAIL"]
        if fails:
            print(f"\n{len(fails)} check(s) FAILED.")
            sys.exit(1)
        print("\nAll checks passed, skipped, or inconclusive-and-logged above.")


if __name__ == "__main__":
    main()
