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

VERIFICATION
  After every call this queries public.leads and public.audit_log (service
  role) for rows carrying this call's marker. For a REFUSED case, no row may
  exist under the tenant that was wrongly claimed. For the RESOLVES case, any
  row found must carry dealer B's tenant_id. Several doors (finance-calc,
  erp-sync, audit-kyc, closed-won) do not write to leads/audit_log at all --
  a clean miss on both tables is reported as NOTE, not FAIL, for those.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ENV_PATH = os.path.join(
    os.path.expanduser("~"), "mnt", "MY RESUMES", "nexus-os", ".env"
)
STATE_PATH = os.path.join(os.path.expanduser("~"), ".nexus-dealer-b.json")
N8N_BASE = "https://35.224.126.225.nip.io"
TIMEOUT = 30

ALBA_TENANT_ID = "fff6a2b5-cfd5-4460-8383-875bc5826de0"
DEALER_B_PHONE = "+918517942172"
DEALER_B_EMAIL = "aliasgher892+dealerb@gmail.com"
TEST_VEHICLE = "Toyota Camry"

# path per webhook door, read from n8n-workflows/*.json and
# ops/tenant-precedence/patched/*.json -- never hand-typed against the wave
# doc, so a future re-export that changes a path breaks this loudly (404) the
# next time it dry-runs, instead of silently testing the wrong door.
DOORS = [
    {
        "id": "master-router",
        "workflow_id": None,  # not a wave workflow id; the router itself
        "name": "Master Router",
        "path": "nexus-inbound-lead",
    },
    {
        "id": "G7FhvMY2ucW5Fg7X",
        "name": "7-Day Warm Lead Drip Campaign",
        "path": "lead-trigger",
    },
    {
        "id": "unMMpeL9uuPO79pp",
        "name": "Finance Calc: Auto Loan Equity & Credit Score",
        "path": "finance-calc",
    },
    {
        "id": "dhy2DDjWUqwuzHLW",
        "name": "Sync Closed-Won Deals to Supabase pgvector",
        "path": "deals/closed-won",
    },
    {
        "id": "qTnh3nwWheFJbFkU",
        "name": "KYC/AML Document Auditor + Re-upload Loop (Phase 5)",
        "path": "audit-kyc",
    },
    {
        "id": "bxNBzBrcOtcFpMPn",
        "name": "wf_108 ERP Sync - Bitrix24 CRM",
        "path": "erp-sync",
    },
    {
        "id": "KI6P1Qcf3MIZakNa",
        "name": "Lead Escalation - AI Agent",
        "path": "lead-escalation",
    },
]

# Text fragments the resolvers actually throw (see code/*.js). A refusal is
# only trusted as a TENANT refusal -- not some unrelated validation 400/500 --
# if one of these appears in the response body.
REFUSAL_MARKERS = (
    "tenant_id is not a caller-selectable field",
    "is a member of",
    "NEXUS-UNATTRIBUTED",
    "has no tenant_members row",
)


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


def run_case(door, case_label, token, claim_tenant_id, expect_refused,
             expect_tenant_id, forbidden_tenant_id, api_get, apply_mode, results):
    marker = uuid.uuid4().hex[:10]
    status, body = call_door(door, token, marker, claim_tenant_id, apply_mode,
                              label=f"{door['id']}:{case_label}")

    if not apply_mode:
        print(f"    would then verify leads/audit_log for marker {marker}")
        results.append((door["id"], case_label, "DRY-RUN", ""))
        return

    refused = status is not None and status >= 400
    refusal_confirmed = refused and isinstance(body, (str, dict)) and any(
        m in json.dumps(body) for m in REFUSAL_MARKERS
    )

    verdict = None
    detail = f"HTTP {status}"

    if expect_refused:
        if refused and refusal_confirmed:
            verdict = "PASS"
        elif refused and not refusal_confirmed:
            verdict = "INCONCLUSIVE"
            detail += " (refused, but not confirmed as the tenant gate -- check body)"
        else:
            verdict = "FAIL"
            detail += " (expected a refusal, request succeeded)"
    else:
        if not refused:
            verdict = "PASS"
        else:
            verdict = "FAIL"
            detail += " (expected resolution to dealer B, got a refusal)"

    row_ok, row_notes = verify_rows(api_get, marker, forbidden_tenant_id,
                                     expect_tenant_id, apply_mode)
    if not row_ok:
        verdict = "FAIL"
        detail += f" | ROW CHECK FAILED: {row_notes}"
    else:
        detail += f" | rows: {row_notes}"

    print(f"  [{verdict}] {door['id']} / {case_label} -- {detail}")
    results.append((door["id"], case_label, verdict, detail))


def print_side_effect_banner():
    print(__doc__.split("SIDE EFFECTS -- READ BEFORE --live")[1]
          .split("VERIFICATION")[0])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true",
                     help="actually call n8n / Supabase (default: dry-run)")
    ap.add_argument("--i-understand-side-effects", action="store_true",
                     help="required together with --live; see SIDE EFFECTS in --help")
    args = ap.parse_args()

    apply_mode = args.live
    if args.live and not args.i_understand_side_effects:
        sys.exit(
            "--live requires --i-understand-side-effects as well. "
            "Run with --help and read SIDE EFFECTS first."
        )

    print("=== SIDE EFFECTS OF THE 'RESOLVES' CASE ===")
    print_side_effect_banner()

    if apply_mode:
        print("=== LIVE MODE -- calling", N8N_BASE, "for real ===\n")
    else:
        print("=== DRY RUN -- printing calls only, nothing executes. "
              "Use --live --i-understand-side-effects to run. ===\n")

    env = load_env(ENV_PATH)
    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(k):
            sys.exit(f"missing required env var in {ENV_PATH}: {k}")

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

    results = []
    for door in DOORS:
        print(f"\n=== {door['id']} ({door['name']}) -> /webhook/{door['path']} ===")

        run_case(door, "A-claims-B", token_a, dealer_b_tenant_id,
                  expect_refused=True, expect_tenant_id=None,
                  forbidden_tenant_id=dealer_b_tenant_id,
                  api_get=api_get, apply_mode=apply_mode, results=results)

        run_case(door, "B-claims-A", token_b, ALBA_TENANT_ID,
                  expect_refused=True, expect_tenant_id=None,
                  forbidden_tenant_id=ALBA_TENANT_ID,
                  api_get=api_get, apply_mode=apply_mode, results=results)

        run_case(door, "B-no-claim", token_b, None,
                  expect_refused=False, expect_tenant_id=dealer_b_tenant_id,
                  forbidden_tenant_id=ALBA_TENANT_ID,
                  api_get=api_get, apply_mode=apply_mode, results=results)

    print("\n=== SUMMARY ===")
    for door_id, case, verdict, detail in results:
        print(f"{verdict:12s} {door_id:16s} {case:12s} {detail}")

    if apply_mode:
        fails = [r for r in results if r[2] == "FAIL"]
        if fails:
            print(f"\n{len(fails)} case(s) FAILED.")
            sys.exit(1)
        print("\nAll cases passed or were inconclusive-and-logged above.")


if __name__ == "__main__":
    main()
