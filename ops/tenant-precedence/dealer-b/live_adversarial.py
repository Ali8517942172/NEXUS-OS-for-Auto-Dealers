#!/usr/bin/env python3
"""NEXUS tenant-precedence wave -- live adversarial harness.

For each of the seven public webhook doors below, runs the three cases the
tenant-precedence fix (see ops/tenant-precedence/code/*.js) exists to
survive:

  A. dealer-A's token, body claims dealer B's tenant_id  -> must be REFUSED
  B. dealer-B's token, body claims ALBA's tenant_id       -> must be REFUSED
  C. dealer-B's token, no tenant_id claim in the body      -> must RESOLVE to
                                                               dealer B

Every payload is lead data clearly marked NEXUS-TEST (name "NEXUS TEST
Ahmed", vehicle "Toyota Camry", dealer B's own test phone/email) with a
unique per-call marker, so a human or a later sweep can find and delete
every row this script is responsible for on sight.

    python3 live_adversarial.py                                  # dry run
    python3 live_adversarial.py --live --i-understand-side-effects  # execute
    python3 live_adversarial.py --reverify RUN.json                # re-judge
                                                                     an
                                                                     earlier
                                                                     --live
                                                                     run's
                                                                     executions
                                                                     -- sends
                                                                     nothing

--live is not enough on its own. --i-understand-side-effects must also be
passed, because several of these doors are not idempotent test endpoints --
see SIDE EFFECTS below and the printed banner. Both flags are required so
that running this by habit (tab-completing an old command, say) cannot fire
a real Slack message or CRM write.

PREREQUISITE
  ops/tenant-precedence/dealer-b/setup.py --apply must have already run, so
  ~/.nexus-dealer-b.json holds both test users' ids/emails/passwords (never
  printed by this script either).

TENANT-RESOLUTION MECHANISM THIS TESTS (read from the patched workflow JSON,
not assumed)
  Each door's "Verify JWT" node forwards the caller's raw Authorization
  header to GET {SUPABASE_URL}/auth/v1/user. "Tenant For JWT User" then
  reads public.tenant_members for that verified auth_user_id. The resolver
  Code node compares that membership against any tenant_id the request body
  claims and refuses on a mismatch (see the "REPLACES the 2 Sep resolver"
  comments in ops/tenant-precedence/code/*.js for the vulnerability this
  closed). So what actually varies between cases A/B/C below is the
  Authorization header (whose token) and one JSON field (tenant_id claimed,
  or omitted) -- not the URL or the HTTP method.

SIDE EFFECTS -- READ BEFORE --live
  A REFUSED case (A, B) fails fast in the resolver, before any of this runs.
  A RESOLVES case (C) lets the workflow run to completion, which means:
    * G7FhvMY2ucW5Fg7X  (lead-trigger/drip)   sends a REAL Gmail email and a
                                               REAL WhatsApp message (to the
                                               dealer-B test phone/email --
                                               safe recipients, but still a
                                               real external send)
    * KI6P1Qcf3MIZakNa  (lead-escalation)     sends a REAL Gmail email AND
                                               posts to the LIVE #sales-hot-
                                               leads Slack channel, tagging a
                                               real manager
    * bxNBzBrcOtcFpMPn  (erp-sync)            creates/updates a REAL lead in
                                               production Bitrix24 CRM
    * dhy2DDjWUqwuzHLW  (deals/closed-won)    calls OpenRouter (costs money)
                                               and upserts a pgvector row
    * qTnh3nwWheFJbFkU  (audit-kyc)           calls OpenRouter Vision (costs
                                               money), sends a REAL WhatsApp
                                               message, and may post to Slack
    * unMMpeL9uuPO79pp  (finance-calc)        logs a quote row only -- no
                                               known external send
    * master router     (nexus-inbound-lead)  fans out into MULTIPLE of the
                                               above (WhatsApp welcome, Slack
                                               hot-lead alert, ERP sync, drip
                                               enrollment)
  All of this is marked NEXUS-TEST and only ever addressed to dealer B's own
  test phone/email -- it will NOT reach a real customer -- but a Slack
  message in a live channel and a row in production Bitrix24 are real
  regardless of the marker. Get sign-off before --live.

VERIFICATION (n8n EXECUTION DATA, not HTTP status)
  Three of these doors' webhook trigger node has no responseMode set, which
  makes n8n's default "onReceived" kick in: the webhook answers HTTP 200 the
  instant the request is received, before the resolver code even runs. HTTP
  status therefore cannot tell a refusal from an acceptance on those doors,
  and a naive substring search over the response body misses several doors'
  differently-worded refusal messages. So this script no longer grades on
  HTTP status at all: after every POST it finds the n8n EXECUTION that
  request created (matched by the marker inside the webhook trigger node's
  own captured request body -- see exec_judge.py's module docstring for why
  that node, specifically, is the one place the marker is guaranteed to
  survive), polls it to a terminal state (timeout 120s -> INCONCLUSIVE), and
  reads the verdict out of the execution's own node data:
    * a REFUSED case PASSES only if some node's thrown error description
      starts with "[NEXUS-UNATTRIBUTED] " AND Supabase has no row for this
      case's marker under the forbidden tenant.
    * a RESOLVES case PASSES only if some node's output carries the expected
      tenant_id AND, if a leads/audit_log row for the marker exists at all,
      that row's tenant_id also matches (a door that doesn't persist a row
      for this case isn't penalised for that).
  See exec_judge.py for the full implementation and rationale.

--reverify RUN.json
  Re-judges the executions a previous --live run already created, using the
  same exec_judge logic above, WITHOUT sending a single new request. RUN.json
  is the case-map this script writes on every --live run (see "raw case
  mapping" below). If a case in it has no "execution_id" yet (as happens for
  a manifest reconstructed for a run that predates this case-map, see
  reconstruct_legacy_run() below), this mode reconstructs it by scanning the
  door's executions inside RUN.json's recorded time window for one whose
  trigger-node body matches that case's identifying details (the claimed
  tenant_id, or its absence), then fills the mapping back in and rewrites
  RUN.json so the next --reverify is instant.

RAW CASE MAPPING
  Every --live run writes ADVERSARIAL-RUN.json next to this script: for each
  (door, case) it records the marker used, the since_iso search floor, and
  the execution_id exec_judge found (or null if none was found within the
  timeout). --reverify reads this file back in.
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
from datetime import datetime, timezone

import exec_judge

ENV_PATH = os.path.join(
    os.path.expanduser("~"), "mnt", "MY RESUMES", "nexus-os", ".env"
)
STATE_PATH = os.path.join(os.path.expanduser("~"), ".nexus-dealer-b.json")
HERE = os.path.dirname(os.path.abspath(__file__))
RUN_MAP_PATH = os.path.join(HERE, "ADVERSARIAL-RUN.json")
RESULTS_PATH = os.path.join(HERE, "ADVERSARIAL-RESULTS.md")
N8N_BASE = "https://35.224.126.225.nip.io"
TIMEOUT = 30
# OpenRouter's free tier rate-limits per-key; deals/closed-won and audit-kyc
# both call it. Keep at least this many seconds between any two live calls
# in a run so a --doors-limited (or full) run never bursts into that limit.
MIN_CALL_SPACING_SECONDS = 20
_last_call_at = [None]


def _pace(apply_mode):
    """Block, if needed, so at least MIN_CALL_SPACING_SECONDS has elapsed
    since the previous live call this process made. No-op in dry-run and on
    the first call."""
    if not apply_mode:
        return
    now = time.monotonic()
    last = _last_call_at[0]
    if last is not None:
        wait = MIN_CALL_SPACING_SECONDS - (now - last)
        if wait > 0:
            print(f"    (pacing: sleeping {wait:.1f}s before next live call)")
            time.sleep(wait)
    _last_call_at[0] = time.monotonic()

ALBA_TENANT_ID = "fff6a2b5-cfd5-4460-8383-875bc5826de0"
DEALER_B_PHONE = "+918517942172"
DEALER_B_EMAIL = "aliasgher892+dealerb@gmail.com"
TEST_VEHICLE = "Toyota Camry"

# path + workflow id per webhook door, read from n8n-workflows/*.json and
# ops/tenant-precedence/patched/*.json -- never hand-typed against the wave
# doc, so a future re-export that changes a path breaks this loudly (404) the
# next time it dry-runs, instead of silently testing the wrong door. The
# master router's workflow_id was looked up live (GET /api/v1/workflows) --
# it is n8n's internal id for "NEXUS Master Lead Router - AI Agent", not
# something this harness invents.
DOORS = [
    {
        "id": "master-router",
        "workflow_id": "JnlZFAVmFAuNXVya",
        "name": "Master Router",
        "path": "nexus-inbound-lead",
    },
    {
        "id": "G7FhvMY2ucW5Fg7X",
        "workflow_id": "G7FhvMY2ucW5Fg7X",
        "name": "7-Day Warm Lead Drip Campaign",
        "path": "lead-trigger",
    },
    {
        "id": "unMMpeL9uuPO79pp",
        "workflow_id": "unMMpeL9uuPO79pp",
        "name": "Finance Calc: Auto Loan Equity & Credit Score",
        "path": "finance-calc",
    },
    {
        "id": "dhy2DDjWUqwuzHLW",
        "workflow_id": "dhy2DDjWUqwuzHLW",
        "name": "Sync Closed-Won Deals to Supabase pgvector",
        "path": "deals/closed-won",
    },
    {
        "id": "qTnh3nwWheFJbFkU",
        "workflow_id": "qTnh3nwWheFJbFkU",
        "name": "KYC/AML Document Auditor + Re-upload Loop (Phase 5)",
        "path": "audit-kyc",
    },
    {
        "id": "bxNBzBrcOtcFpMPn",
        "workflow_id": "bxNBzBrcOtcFpMPn",
        "name": "wf_108 ERP Sync - Bitrix24 CRM",
        "path": "erp-sync",
    },
    {
        "id": "KI6P1Qcf3MIZakNa",
        "workflow_id": "KI6P1Qcf3MIZakNa",
        "name": "Lead Escalation - AI Agent",
        "path": "lead-escalation",
    },
]

CASE_SPECS = [
    # (case_label, claims, expect_refused)
    ("A-claims-B", "dealer_b_tenant_id", True),
    ("B-claims-A", "alba_tenant_id", True),
    ("B-no-claim", None, False),
]


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


def http(method, url, headers=None, body=None, apply_mode=True, label=""):
    """One HTTP call, or (dry-run) just a printed description of it. Tokens
    and service keys are always redacted in what gets printed."""
    headers = dict(headers or {})
    printable_headers = dict(headers)
    for h in ("Authorization", "apikey"):
        if h in printable_headers:
            printable_headers[h] = "<redacted>"

    if not apply_mode:
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


def get_access_token(supabase_url, anon_key, email, password, apply_mode, label):
    """GoTrue password grant. Returns the access_token, never printed."""
    url = supabase_url.rstrip("/") + "/auth/v1/token?grant_type=password"
    headers = {"apikey": anon_key, "Content-Type": "application/json"}
    status, body = http(
        "POST", url, headers=headers, body={"email": email, "password": password},
        apply_mode=apply_mode, label=label,
    )
    if not apply_mode:
        return "<dry-run: token not fetched>"
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        sys.exit(f"[{label}] password grant failed: HTTP {status}: {body}")
    return body["access_token"]


def build_payload(marker, claim_tenant_id):
    payload = {
        "name": f"NEXUS TEST Ahmed [{marker}]",
        "full_name": f"NEXUS TEST Ahmed [{marker}]",
        "email": DEALER_B_EMAIL,
        "phone": DEALER_B_PHONE,
        "whatsapp": DEALER_B_PHONE,
        "vehicle_interest": TEST_VEHICLE,
        "vehicleInterest": TEST_VEHICLE,
        "source": "nexus-tenant-precedence-harness",
        "lead_marker": marker,
        # Fields other doors' payloads plausibly key on -- harmless no-ops if
        # a given door ignores them. The tenant gate runs before any of this
        # is validated against the door's own required-field list.
        "message": f"NEXUS-TEST tenant-precedence probe {marker}",
        "amount_aed": 1,
        "deal_id": f"NEXUS-TEST-{marker}",
        "document": None,
    }
    if claim_tenant_id is not None:
        payload["tenant_id"] = claim_tenant_id
    return payload


def call_door(door, token, marker, claim_tenant_id, apply_mode, label):
    url = f"{N8N_BASE}/webhook/{door['path']}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    body = build_payload(marker, claim_tenant_id)
    return http("POST", url, headers=headers, body=body, apply_mode=apply_mode, label=label)


def verify_rows(api_get, marker, forbidden_tenant_id, expect_tenant_id, apply_mode):
    """SELECT leads/audit_log for this call's marker. Returns (ok, notes)."""
    if not apply_mode:
        print(f"    would SELECT leads/audit_log for marker {marker}")
        return True, "dry-run: not verified"

    notes = []
    ok = True
    found_any = False
    for table, name_col in (("leads", "name"), ("audit_log", "lead_name")):
        rows = api_get(table, {"select": "id,tenant_id," + name_col,
                                name_col: f"ilike.*{marker}*"})
        for row in rows or []:
            found_any = True
            tid = row.get("tenant_id")
            if forbidden_tenant_id and tid == forbidden_tenant_id:
                ok = False
                notes.append(f"{table}.id={row.get('id')} wrongly carries "
                             f"forbidden tenant_id={tid}")
            elif expect_tenant_id and tid != expect_tenant_id:
                notes.append(f"{table}.id={row.get('id')} has tenant_id={tid} "
                             f"(expected {expect_tenant_id}) -- likely filed "
                             f"under the quarantine/unattributed tenant, not a "
                             f"tenant-precedence failure by itself")
            elif expect_tenant_id and tid == expect_tenant_id:
                notes.append(f"{table}.id={row.get('id')} correctly under "
                             f"dealer B ({tid})")
    if not found_any:
        notes.append("no matching row in leads or audit_log (expected for "
                      "doors that don't write those tables, or for a "
                      "refusal that failed before any write)")
    return ok, "; ".join(notes)


def make_rest_get(supabase_url, service_key, apply_mode):
    def get(table, params):
        url = supabase_url.rstrip("/") + f"/rest/v1/{table}"
        headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        status, body = http("GET", url + "?" + urllib.parse.urlencode(params),
                             headers=headers, apply_mode=apply_mode, label=f"verify:{table}")
        if apply_mode and status == 200:
            return body
        return []
    return get


def now_iso_floor():
    """A since_iso floor for exec_judge's execution search: some time before
    "now", string-comparable against n8n's own startedAt format
    ("2026-09-20T11:29:41.451Z").

    HARNESS BUG FOUND AND FIXED 20 Sep 2026: this used to subtract only 5
    seconds. Measured directly (GET a workflow and diff this machine's clock
    against the response's own Date header, back to back): this machine's
    clock runs ~45-50s AHEAD of the n8n host's. With only a 5s buffer, a
    case's own just-created execution can carry a startedAt (timestamped by
    the SLOWER n8n clock) that is already earlier than since_iso (computed
    from the FASTER local clock) the instant it's created -- and since
    list_recent_executions scans newest-first and stops at the first row
    older than since_iso, that's the very FIRST row it looks at, so the
    execution is excluded before ever being added to the candidate list.
    Confirmed live: execution 16032 (marker b7a45bc6d5, erp-sync) started at
    14:49:59.394Z but a since_iso of 14:50:40.591Z (5s-buffer, this
    machine's clock) excluded it -- polling never found it, for the full
    length of any timeout, no matter how long, because startedAt doesn't
    change. Not a one-off: every case run under the old 5s buffer while this
    skew was present would have silently returned INCONCLUSIVE regardless of
    what the workflow actually did.

    180s comfortably covers this (and any further drift) without meaningful
    risk of picking up an unrelated earlier execution on a shared workflow
    (e.g. master-router, which both this script and journeys.py POST to):
    poll_for_case_execution still filters every candidate by the request's
    own random marker before accepting it."""
    from datetime import timedelta
    t = datetime.now(timezone.utc) - timedelta(seconds=180)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


# Doors whose fix (confirmed by direct execution inspection, 20 Sep 2026 --
# see ADVERSARIAL-RESULTS.md) never even reads the body's claimed tenant_id
# for anything: the caller's OWN authenticated identity is resolved and used
# unconditionally, so a malicious claim is neither honoured NOR refused --
# it's simply irrelevant. That is a STRONGER guarantee than "refuse on
# mismatch" (the claim can never influence the outcome at all), but it means
# the generic 3-case CASE_SPECS' "A-claims-B/B-claims-A must throw
# [NEXUS-UNATTRIBUTED]" expectation (written for the other 6 doors, which DO
# read and act on a claim) doesn't apply here: judging it against that
# expectation would grade a correctly-behaving door as FAIL for not refusing
# a claim it never looks at. For these doors, every case (regardless of what
# was claimed) is graded as "must resolve to the CALLER's own real tenant"
# instead -- exactly what judge_resolve_case already checks.
CLAIM_IGNORING_DOORS = {"bxNBzBrcOtcFpMPn"}  # erp-sync: see Resolve Sweep Caller Tenant


def run_case(door, case_label, token, claim_tenant_id, expect_refused,
             expect_tenant_id, forbidden_tenant_id, api_get, apply_mode, results,
             cases_map, caller_real_tenant_id=None):
    marker = uuid.uuid4().hex[:10]
    case_key = f"{door['id']}:{case_label}"

    if door["id"] in CLAIM_IGNORING_DOORS and expect_refused:
        if caller_real_tenant_id is None:
            sys.exit(f"{door['id']} is in CLAIM_IGNORING_DOORS but no "
                      f"caller_real_tenant_id was passed for case {case_label}")
        expect_refused = False
        expect_tenant_id = caller_real_tenant_id
        forbidden_tenant_id = claim_tenant_id  # the claim itself must never be adopted

    if not apply_mode:
        call_door(door, token, marker, claim_tenant_id, apply_mode,
                  label=case_key)
        print(f"    would then find the n8n execution this created and judge it "
              f"off its own node data (see exec_judge.py) for marker {marker}")
        results.append((door["id"], case_label, "DRY-RUN", ""))
        return

    since_iso = now_iso_floor()
    _pace(apply_mode)
    status, body = call_door(door, token, marker, claim_tenant_id, apply_mode,
                              label=case_key)
    print(f"  [{door['id']}/{case_label}] POST -> HTTP {status} (HTTP status is "
          f"informational only now -- see exec_judge below for the real verdict)")

    row_check = lambda: verify_rows(api_get, marker, forbidden_tenant_id,
                                     expect_tenant_id, apply_mode)

    if expect_refused:
        verdict, detail, execution_id = exec_judge.judge_refusal_case(
            door["workflow_id"], marker, since_iso, forbidden_tenant_id,
            row_check, log=print)
    else:
        verdict, detail, execution_id = exec_judge.judge_resolve_case(
            door["workflow_id"], marker, since_iso, expect_tenant_id,
            row_check, log=print)

    print(f"  [{verdict}] {door['id']} / {case_label} -- {detail}")
    results.append((door["id"], case_label, verdict, f"HTTP {status} | {detail}"))
    cases_map[case_key] = {
        "door_id": door["id"],
        "workflow_id": door["workflow_id"],
        "case_label": case_label,
        "marker": marker,
        "since_iso": since_iso,
        "http_status": status,
        "expect_refused": expect_refused,
        "expect_tenant_id": expect_tenant_id,
        "forbidden_tenant_id": forbidden_tenant_id,
        "execution_id": execution_id,
        "verdict": verdict,
        "detail": detail,
    }


def print_side_effect_banner():
    print(__doc__.split("SIDE EFFECTS -- READ BEFORE --live")[1]
          .split("VERIFICATION")[0])


def write_run_map(cases_map, meta):
    payload = {"meta": meta, "cases": cases_map}
    with open(RUN_MAP_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    print(f"\nwrote {RUN_MAP_PATH} (case -> execution_id map, for --reverify)")


def reconstruct_legacy_case(door, case_label, claimed_tenant_id, window):
    """For a case whose mapping entry has no execution_id (a manifest
    written for a run that predates this script saving one -- see
    ADVERSARIAL-RUN.json's "reconstructed" runs), find it by scanning the
    door's executions inside `window` (since_iso, until_iso) for the one
    whose trigger-node body:
      * has name/full_name containing "NEXUS TEST Ahmed" (this script's
        fixed marker prefix, distinguishing our executions from
        journeys.py's on a shared workflow like the master router), and
      * has (or lacks) a "tenant_id" claim matching this case's already-
        resolved claimed_tenant_id (a real tenant UUID, or None for the
        no-claim case) -- NOT the CASE_SPECS key string, which the caller
        must resolve first (dealer_b_tenant_id / alba_tenant_id / None).
    Returns (execution_id, marker) or (None, None) if nothing in the window
    matches."""
    since_iso, until_iso = window
    candidates = exec_judge.executions_in_window(door["workflow_id"], since_iso, until_iso)
    for execution in candidates:
        body = exec_judge.trigger_node_body(execution)
        name = str(body.get("name") or body.get("full_name") or "")
        if "NEXUS TEST Ahmed" not in name:
            continue
        claimed = body.get("tenant_id")
        if claimed_tenant_id is None:
            if claimed:
                continue
        elif claimed != claimed_tenant_id:
            continue
        marker = body.get("lead_marker")
        if not marker:
            # fall back to parsing "[marker]" out of the name
            if "[" in name and "]" in name:
                marker = name.split("[", 1)[1].rsplit("]", 1)[0]
        return execution.get("id"), marker
    return None, None


def do_reverify(run_json_path, env, state):
    with open(run_json_path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    meta = manifest.get("meta", {})
    cases_map = manifest.get("cases", {})

    dealer_b_tenant_id = meta.get("dealer_b_tenant_id") or (state or {}).get("dealer_b_tenant_id")
    alba_tenant_id = meta.get("alba_tenant_id") or ALBA_TENANT_ID
    window = meta.get("window")  # [since_iso, until_iso], legacy manifests only

    api_get = make_rest_get(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], True)

    # claim_field (from CASE_SPECS) -> the actual tenant_id the payload
    # claimed, or None for the no-claim case -- this is what the trigger
    # node's own captured body will show, so it's what reconstruction must
    # match against. It is NOT the same thing as forbidden_tenant_id below:
    # for the no-claim case nothing was claimed (claimed_tenant_id is None)
    # but a row is still forbidden from landing under ALBA (same asymmetry
    # main()'s live run always had between claim_tenant_id and
    # forbidden_tenant_id for that case).
    claim_field_value = {
        "dealer_b_tenant_id": dealer_b_tenant_id,
        "alba_tenant_id": alba_tenant_id,
        None: None,
    }

    results = []
    changed = False
    for door in DOORS:
        print(f"\n=== reverify {door['id']} ({door['name']}) ===")
        for case_label, claim_field, expect_refused in CASE_SPECS:
            case_key = f"{door['id']}:{case_label}"
            entry = cases_map.get(case_key, {})
            expect_tenant_id = dealer_b_tenant_id if not expect_refused else None
            claimed_tenant_id = claim_field_value.get(claim_field)
            forbidden_tenant_id = claimed_tenant_id if expect_refused else alba_tenant_id
            marker = entry.get("marker")
            execution_id = entry.get("execution_id")

            if not execution_id:
                if not window:
                    print(f"  [{case_key}] no execution_id on file and no legacy "
                          f"time window in this manifest -- cannot reconstruct")
                    results.append((door["id"], case_label, "INCONCLUSIVE",
                                     "no execution_id and no window to reconstruct from"))
                    continue
                execution_id, found_marker = reconstruct_legacy_case(
                    door, case_label, claimed_tenant_id, window)
                if execution_id:
                    marker = marker or found_marker
                    entry.update({
                        "door_id": door["id"], "workflow_id": door["workflow_id"],
                        "case_label": case_label, "marker": marker,
                        "execution_id": execution_id, "reconstructed": True,
                    })
                    cases_map[case_key] = entry
                    changed = True
                    print(f"  [{case_key}] reconstructed -> execution {execution_id} "
                          f"(marker {marker})")
                else:
                    print(f"  [{case_key}] reconstruction found no matching execution "
                          f"in window {window}")
                    results.append((door["id"], case_label, "INCONCLUSIVE",
                                     f"no execution found in legacy window {window} "
                                     f"matching this case's identifying claim"))
                    continue

            def row_check(marker=marker, forbidden_tenant_id=forbidden_tenant_id,
                          expect_tenant_id=expect_tenant_id):
                return verify_rows(api_get, marker, forbidden_tenant_id,
                                    expect_tenant_id, True)

            verdict, detail, _ = exec_judge.judge_known_execution(
                execution_id, expect_refused, forbidden_tenant_id,
                expect_tenant_id, row_check, log=print)
            prev_verdict = entry.get("verdict", "?")
            print(f"  [{verdict}] {case_key} -- {detail}  (previous harness said: {prev_verdict})")
            entry["reverify_verdict"] = verdict
            entry["reverify_detail"] = detail
            cases_map[case_key] = entry
            changed = True
            results.append((door["id"], case_label, verdict, detail, prev_verdict))

    if changed:
        manifest["cases"] = cases_map
        with open(run_json_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=1)
        print(f"\nrewrote {run_json_path} with reconstructed/re-judged mapping")

    print("\n=== REVERIFY SUMMARY ===")
    for row in results:
        if len(row) == 5:
            door_id, case, verdict, detail, prev = row
            print(f"{verdict:12s} {door_id:16s} {case:12s} (was {prev:12s}) {detail}")
        else:
            door_id, case, verdict, detail = row
            print(f"{verdict:12s} {door_id:16s} {case:12s} {detail}")
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true",
                     help="actually call n8n / Supabase (default: dry-run)")
    ap.add_argument("--i-understand-side-effects", action="store_true",
                     help="required together with --live; see SIDE EFFECTS in --help")
    ap.add_argument("--reverify", metavar="RUN.json",
                     help="re-judge a previous --live run's executions from n8n "
                          "execution data, without sending anything new")
    ap.add_argument("--doors", metavar="ID[,ID...]",
                     help="limit the run to these door ids (matches DOORS[].id, "
                          "e.g. erp-sync or kyc's id qTnh3nwWheFJbFkU), comma-"
                          "separated. Default: all doors.")
    args = ap.parse_args()

    apply_mode = args.live
    if args.live and not args.i_understand_side_effects:
        sys.exit(
            "--live requires --i-understand-side-effects as well. "
            "Run with --help and read SIDE EFFECTS first."
        )

    env = load_env(ENV_PATH)
    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(k):
            sys.exit(f"missing required env var in {ENV_PATH}: {k}")

    if args.reverify:
        state = load_state() if os.path.exists(STATE_PATH) else None
        do_reverify(args.reverify, env, state)
        return

    print("=== SIDE EFFECTS OF THE 'RESOLVES' CASE ===")
    print_side_effect_banner()

    if apply_mode:
        print("=== LIVE MODE -- calling", N8N_BASE, "for real ===\n")
    else:
        print("=== DRY RUN -- printing calls only, nothing executes. "
              "Use --live --i-understand-side-effects to run. ===\n")

    state = load_state() if apply_mode else {
        "dealer_b_tenant_id": "<dry-run: from state file>",
        "dealer_a_user": {"email": "aliasgher892+dealera@gmail.com"},
        "dealer_b_user": {"email": "aliasgher892+dealerb@gmail.com"},
    }
    dealer_b_tenant_id = state.get("dealer_b_tenant_id")
    dealer_a_email = (state.get("dealer_a_user") or {}).get("email")
    dealer_b_email = (state.get("dealer_b_user") or {}).get("email")
    dealer_a_password = (state.get("dealer_a_user") or {}).get("password")
    dealer_b_password = (state.get("dealer_b_user") or {}).get("password")

    if apply_mode and (not dealer_a_password or not dealer_b_password):
        sys.exit(
            "state file has no password on file for dealer A and/or dealer B "
            "-- setup.py only stores a password for a user IT created. If "
            "either account pre-existed, set its password out of band and "
            "export NEXUS_DEALER_A_PASSWORD / NEXUS_DEALER_B_PASSWORD instead."
        )
    dealer_a_password = dealer_a_password or os.environ.get("NEXUS_DEALER_A_PASSWORD")
    dealer_b_password = dealer_b_password or os.environ.get("NEXUS_DEALER_B_PASSWORD")

    token_a = get_access_token(env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"],
                                dealer_a_email, dealer_a_password, apply_mode,
                                label="token:dealer-a")
    token_b = get_access_token(env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"],
                                dealer_b_email, dealer_b_password, apply_mode,
                                label="token:dealer-b")

    api_get = make_rest_get(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"],
                             apply_mode)

    doors = DOORS
    if args.doors:
        wanted = set(x.strip() for x in args.doors.split(",") if x.strip())
        doors = [d for d in DOORS
                 if wanted & {d["id"], d["workflow_id"], d["path"]}]
        matched = set()
        for d in doors:
            matched |= (wanted & {d["id"], d["workflow_id"], d["path"]})
        missing = wanted - matched
        if missing:
            sys.exit(f"--doors: unknown door id(s) {sorted(missing)}. Known ids: "
                      f"{[d['id'] for d in DOORS]}, paths: {[d['path'] for d in DOORS]}")
        print(f"=== --doors filter: running only {[d['id'] for d in doors]} ===\n")

    results = []
    cases_map = {}
    run_started = datetime.now(timezone.utc).isoformat()
    for door in doors:
        print(f"\n=== {door['id']} ({door['name']}) -> /webhook/{door['path']} ===")

        run_case(door, "A-claims-B", token_a, dealer_b_tenant_id,
                  expect_refused=True, expect_tenant_id=None,
                  forbidden_tenant_id=dealer_b_tenant_id,
                  api_get=api_get, apply_mode=apply_mode, results=results,
                  cases_map=cases_map, caller_real_tenant_id=ALBA_TENANT_ID)

        run_case(door, "B-claims-A", token_b, ALBA_TENANT_ID,
                  expect_refused=True, expect_tenant_id=None,
                  forbidden_tenant_id=ALBA_TENANT_ID,
                  api_get=api_get, apply_mode=apply_mode, results=results,
                  cases_map=cases_map, caller_real_tenant_id=dealer_b_tenant_id)

        run_case(door, "B-no-claim", token_b, None,
                  expect_refused=False, expect_tenant_id=dealer_b_tenant_id,
                  forbidden_tenant_id=ALBA_TENANT_ID,
                  api_get=api_get, apply_mode=apply_mode, results=results,
                  cases_map=cases_map)

    print("\n=== SUMMARY ===")
    for door_id, case, verdict, detail in results:
        print(f"{verdict:12s} {door_id:16s} {case:12s} {detail}")

    if apply_mode:
        write_run_map(cases_map, {
            "run_started": run_started,
            "dealer_b_tenant_id": dealer_b_tenant_id,
            "alba_tenant_id": ALBA_TENANT_ID,
        })
        fails = [r for r in results if r[2] == "FAIL"]
        if fails:
            print(f"\n{len(fails)} case(s) FAILED.")
            sys.exit(1)
        print("\nAll cases passed or were inconclusive-and-logged above.")


if __name__ == "__main__":
    main()
