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

PREREQUISITE
  ops/tenant-precedence/dealer-b/setup.py --apply must already have run,
  so ~/.nexus-dealer-b.json holds all three dealers' tenant ids and user
  ids/emails/passwords (never printed by this script either).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES_PATH = os.path.join(HERE, "fixtures.json")
RESULTS_PATH = os.path.join(HERE, "JOURNEYS-RESULTS.md")
ENV_PATH = os.path.join(
    os.path.expanduser("~"), "mnt", "MY RESUMES", "nexus-os", ".env"
)
STATE_PATH = os.path.join(os.path.expanduser("~"), ".nexus-dealer-b.json")
N8N_BASE = "https://35.224.126.225.nip.io"
MASTER_ROUTER_PATH = "nexus-inbound-lead"
TIMEOUT = 30

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
    return http("POST", url, headers=headers, body=body, live=live, label=call_label)


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


def write_results_md(results, live, allow_side_effects):
    lines = [
        "# NEXUS tenant-precedence -- three-dealer journeys results",
        "",
        f"Mode: {'LIVE + --allow-side-effects (full push + verify)' if (live and allow_side_effects) else 'LIVE, read-only check 4 only (--no-side-effects default)' if live else 'DRY RUN (nothing executed)'}",
        "",
        "| Check | Scope | Verdict | Detail |",
        "|---|---|---|---|",
    ]
    for check, scope, verdict, detail in results:
        detail_md = str(detail).replace("|", "\\|")
        lines.append(f"| {check} | {scope} | {verdict} | {detail_md} |")
    lines.append("")
    with open(RESULTS_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(f"\nwrote {RESULTS_PATH}")


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
    args = ap.parse_args()

    live = args.live
    allow_side_effects = args.live and args.allow_side_effects

    fixtures = load_fixtures()
    # fixtures.json stores phone_ref ("dubai"/"india") per customer, not
    # the literal number, so the two allowed phone numbers are edited in
    # exactly one place. Resolve to the actual phone once, here.
    for _custs in fixtures["customers"].values():
        for _c in _custs:
            _c["phone"] = fixtures["phones"][_c["phone_ref"]]
    env = load_env(ENV_PATH)
    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(k):
            sys.exit(f"missing required env var in {ENV_PATH}: {k}")

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
    pushes_by_dealer = {}

    for dealer in fixtures["dealers"]:
        key = dealer["key"]
        customers = fixtures["customers"][key]
        pushes_by_dealer[key] = customers
        print(f"\n=== dealer {key} ({dealer['label']}) -- {len(customers)} customer(s) ===")
        for customer in customers:
            marker = f"{run_id}-{customer['id']}"
            markers[customer["id"]] = marker
            times = 2 if customer.get("dedupe_probe") else 1
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

    if not allow_side_effects:
        print("\n(side effects OFF -- no customer was actually pushed through the "
              "master router; checks 1-3 below are skipped)")

    # ---- verification phase ----
    service_headers = {
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
    }

    if allow_side_effects:
        print("\n=== verifying (service role) ===")
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

            verdict, detail = check_separate_rows(
                rows_by_marker, markers[f"{key}-c1"], markers[f"{key}-c3"], tenant_id)
            results.append((f"2:same-dealer-shared-phone-not-deduped", key, verdict, detail))

            verdict, detail = check_dedupe(rows_by_marker, markers[f"{key}-c4"])
            results.append((f"2:double-push-deduped", key, verdict, detail))

        markers_by_tenant = {tenant_ids[k]: markers[f"{k}-c2"] for k in ("a", "b", "c")}
        verdict, detail = check_cross_tenant_collision(rows_by_marker, markers_by_tenant)
        results.append(("3:cross-tenant-phone-collision", "a+b+c", verdict, detail))

    # ---- check 4: per-dealer JWT direct PostgREST visibility (always run when --live) ----
    if live:
        print("\n=== verifying (per-dealer member JWT, direct PostgREST) ===")
        other_tenant_ids_by_dealer = {
            k: {tenant_ids[o] for o in ("a", "b", "c") if o != k} for k in ("a", "b", "c")
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
        fails = [r for r in results if r[2] == "FAIL"]
        if fails:
            print(f"\n{len(fails)} check(s) FAILED.")
            sys.exit(1)
        print("\nAll checks passed, skipped, or inconclusive-and-logged above.")


if __name__ == "__main__":
    main()
