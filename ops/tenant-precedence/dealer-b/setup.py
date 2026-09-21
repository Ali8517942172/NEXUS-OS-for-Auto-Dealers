#!/usr/bin/env python3
"""NEXUS tenant-precedence wave -- three-dealer (A/B/C) fixture provisioning.

Generalised from the original two-dealer (A/B) version of this script.
Reads ops/tenant-precedence/dealer-b/fixtures.json for who to create --
this file no longer hardcodes dealer C, customer lists, or emails; edit
fixtures.json instead.

Creates:
  * tenant "NEXUS TEST DEALER B" (slug test-dealer-b) -- if fixtures.json
    marks a dealer is_existing_tenant=false and it does not already exist
  * tenant "NEXUS TEST DEALER C" (slug test-dealer-c) -- same
  * one auth user per dealer (A/B/C), each a member of exactly that
    dealer's tenant. Dealer A's tenant is the REAL ALBA tenant
    (fff6a2b5-cfd5-4460-8383-875bc5826de0, from fixtures.json) -- this
    script never creates or touches that tenant row itself, only the test
    member user + membership on it, exactly as the original dealer-b
    script did.

    python3 setup.py                 # dry run (default) -- prints the calls
    python3 setup.py --apply         # executes them

WHY status='active'
  public.tenants.status has no "test" value (checked: active|suspended|
  archived -- see supabase/migrations/20260902084409_nexus_mt_01_tenant_core.sql).
  nexus_current_tenant_ids() -- which every "Tenant For JWT User" resolver
  node depends on -- joins tenants ON status='active', so a suspended test
  tenant would never resolve for that dealer's user and the whole fixture
  would be useless for what it exists to test. Each test tenant is
  therefore marked as test ONLY through its name ("NEXUS TEST DEALER B" /
  "...C") and slug -- there is no schema column for it.

  Read ops/pilot-isolation/ONBOARD-TENANT-2.md before --apply: activating
  a SECOND active, non-quarantine tenant in production is not cosmetic,
  and this fixture activates a THIRD (dealer C) on top of that. Per that
  doc, nexus_scoped_tenant_id() and everything built on it (Ask AI, the
  workflow catalogue guard, etc.) branches on "exactly one active tenant".
  Re-check which of gates G1-G9 there are still open before --apply
  against production, and re-check again before adding a fourth.

IDEMPOTENCY / STATE
  Every create is guarded by a lookup first (by slug, by email). What this
  run actually created -- as opposed to what it found already there -- is
  recorded in ~/.nexus-dealer-b.json (chmod 600, outside the repo, same
  path and format the original two-dealer script used, extended with a
  "dealers" map so teardown.py and journeys.py can find dealer C too).
  Generated passwords are the only place either credential is ever
  written. teardown.py reads that file and removes exactly the
  rows/users it recorded as created_by_setup, never a row this script
  found pre-existing.

BACKWARD COMPATIBILITY
  ops/tenant-precedence/dealer-b/live_adversarial.py (the original
  two-dealer, seven-door adversarial harness) reads this same state file
  by its original top-level keys (tenant, dealer_b_user, dealer_a_user,
  dealer_b_tenant_id, alba_tenant_id, ...). This script still writes all
  of those, so live_adversarial.py keeps working unmodified. Dealer C and
  the generalised per-dealer view are additive, under "dealers".

SECRETS
  SUPABASE_SERVICE_ROLE_KEY is read from the env file and used only in
  Authorization headers. It is never printed, never logged, never put in
  the state file. Generated passwords are never printed; they go straight
  from secrets.token_urlsafe() into the admin-API request body and the
  state file.
"""
import argparse
import json
import os
import secrets
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES_PATH = os.path.join(HERE, "fixtures.json")
ENV_PATH = os.path.join(
    os.path.expanduser("~"), "mnt", "MY RESUMES", "nexus-os", ".env"
)
STATE_PATH = os.path.join(os.path.expanduser("~"), ".nexus-dealer-b.json")
TIMEOUT = 20


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


def require_env(env, *names):
    missing = [n for n in names if not env.get(n)]
    if missing:
        sys.exit(f"missing required env var(s) in {ENV_PATH}: {', '.join(missing)}")


class Api:
    """Thin urllib wrapper for the Supabase REST (PostgREST) and Auth Admin
    APIs. Every call goes through here so dry-run and apply share one code
    path -- dry-run just prints instead of opening the connection."""

    def __init__(self, base_url, service_key, apply_mode):
        self.base = base_url.rstrip("/")
        self.key = service_key
        self.apply = apply_mode

    def _headers(self, extra=None):
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def _describe(self, method, url, headers, body):
        redacted = dict(headers)
        if "Authorization" in redacted:
            redacted["Authorization"] = "Bearer <service-role-key redacted>"
        if "apikey" in redacted:
            redacted["apikey"] = "<redacted>"
        printable_body = None
        if body is not None:
            printable_body = json.loads(json.dumps(body))
            if isinstance(printable_body, dict) and "password" in printable_body:
                printable_body["password"] = "<redacted>"
        print(f"  {method} {url}")
        print(f"    headers: {redacted}")
        if printable_body is not None:
            print(f"    body: {json.dumps(printable_body)}")

    def call(self, method, path, params=None, body=None, extra_headers=None):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = self._headers(extra_headers)

        if not self.apply:
            self._describe(method, url, headers, body)
            return None  # dry-run: no data to act on

        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, method=method, headers=headers, data=data)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {raw}") from None


def rest_get_one(api, table, **eq_filters):
    params = {"select": "*", "limit": "1"}
    for k, v in eq_filters.items():
        params[k] = f"eq.{v}"
    rows = api.call("GET", f"/rest/v1/{table}", params=params)
    if api.apply is False:
        return None
    return rows[0] if rows else None


def admin_find_user_by_email(api, email):
    """GoTrue admin list, filtered client-side. Bounded to 10 pages of 200 --
    this fixture's dealer accounts are early in any real tenant's user base,
    and an unbounded scan is exactly the kind of thing that turns a
    "dry-run default" script into a slow production scan."""
    if not api.apply:
        api._describe(
            "GET",
            f"{api.base}/auth/v1/admin/users?page=1&per_page=200",
            api._headers(),
            None,
        )
        print(f"    (then filter client-side for email == {email})")
        return None
    for page in range(1, 11):
        resp = api.call(
            "GET",
            "/auth/v1/admin/users",
            params={"page": str(page), "per_page": "200"},
        )
        users = (resp or {}).get("users", resp if isinstance(resp, list) else [])
        for u in users:
            if str(u.get("email", "")).lower() == email.lower():
                return u
        if len(users) < 200:
            break
    return None


def admin_create_user(api, email, password):
    body = {"email": email, "password": password, "email_confirm": True}
    return api.call("POST", "/auth/v1/admin/users", body=body)


def ensure_tenant(api, dealer):
    """Returns (tenant_id, created_by_setup). Dealer A is pre-existing and
    is never inserted or looked up here -- its tenant_id comes straight
    from fixtures.json."""
    if dealer["is_existing_tenant"]:
        print(f"[tenant:{dealer['key']}] pre-existing (ALBA), not created: "
              f"{dealer['tenant_id']}")
        return dealer["tenant_id"], False

    tenant_body = {
        "slug": dealer["slug"],
        "name": dealer["name"],
        "status": "active",
        "is_unattributed_default": False,
    }
    existing = rest_get_one(api, "tenants", slug=dealer["slug"])
    if not api.apply:
        print(f"[tenant:{dealer['key']}] would look up tenants?slug=eq.{dealer['slug']}")
        print(f"[tenant:{dealer['key']}] would INSERT if not found:")
        api._describe(
            "POST",
            f"{api.base}/rest/v1/tenants",
            api._headers({"Prefer": "return=representation"}),
            tenant_body,
        )
        return "<dry-run: unknown tenant id>", None

    if existing:
        print(f"[tenant:{dealer['key']}] found existing {dealer['slug']}: {existing['id']}")
        return existing["id"], False

    created = api.call(
        "POST",
        "/rest/v1/tenants",
        body=tenant_body,
        extra_headers={"Prefer": "return=representation"},
    )
    row = created[0] if isinstance(created, list) else created
    print(f"[tenant:{dealer['key']}] created {dealer['slug']}: {row['id']}")
    return row["id"], True


def ensure_user(api, dealer, email):
    """Returns a dict: {id, email, created_by_setup, password}."""
    existing = admin_find_user_by_email(api, email)
    if not api.apply:
        password = "<generated in-process, never printed>"
        print(f"[user:{dealer['key']}] would look up auth.users by email={email}")
        print(f"[user:{dealer['key']}] would create if not found (password: {password}):")
        api._describe(
            "POST",
            f"{api.base}/auth/v1/admin/users",
            api._headers(),
            {"email": email, "password": password, "email_confirm": True},
        )
        return {"id": "<dry-run: unknown user id>", "email": email,
                "created_by_setup": None, "password": None}

    if existing:
        print(f"[user:{dealer['key']}] found existing {email}: {existing['id']}")
        # No password on file for a pre-existing user -- setup did not set
        # it and must not guess or overwrite it.
        return {"id": existing["id"], "email": email,
                "created_by_setup": False, "password": None}

    password = secrets.token_urlsafe(24)
    created = admin_create_user(api, email, password)
    uid = created["id"] if isinstance(created, dict) and "id" in created else created.get("user", {}).get("id")
    print(f"[user:{dealer['key']}] created {email}: {uid}")
    return {"id": uid, "email": email, "created_by_setup": True, "password": password}


def ensure_membership(api, dealer, tenant_id, user_id, role="member"):
    """Returns True if a membership row was created by this run, False
    otherwise (already existed, or dry-run)."""
    if not api.apply:
        print(f"[member:{dealer['key']}] would look up tenant_members "
              f"tenant_id=eq.{tenant_id}&auth_user_id=eq.{user_id}")
        print(f"[member:{dealer['key']}] would INSERT if not found:")
        api._describe(
            "POST",
            f"{api.base}/rest/v1/tenant_members",
            api._headers({"Prefer": "return=representation"}),
            {"tenant_id": tenant_id, "auth_user_id": user_id, "role": role},
        )
        return None

    existing = rest_get_one(
        api, "tenant_members", tenant_id=tenant_id, auth_user_id=user_id
    )
    if existing:
        print(f"[member:{dealer['key']}] already linked")
        return False

    api.call(
        "POST",
        "/rest/v1/tenant_members",
        body={"tenant_id": tenant_id, "auth_user_id": user_id, "role": role},
        extra_headers={"Prefer": "return=representation"},
    )
    print(f"[member:{dealer['key']}] linked (role={role})")
    return True


def save_state(state):
    with open(STATE_PATH, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
    os.chmod(STATE_PATH, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    print(f"\nstate written to {STATE_PATH} (chmod 600)")


def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    return {}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="execute (default: dry-run)")
    args = ap.parse_args()

    fixtures = load_fixtures()
    env = load_env(ENV_PATH)
    require_env(env, "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")

    if args.apply:
        print("=== APPLY MODE -- this will write to Supabase at", env["SUPABASE_URL"], "===\n")
    else:
        print("=== DRY RUN -- printing calls only, nothing executes. Use --apply to run. ===\n")

    api = Api(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], args.apply)
    state = load_state() if args.apply else {}

    dealers_out = {}
    for dealer in fixtures["dealers"]:
        key = dealer["key"]
        print(f"\n--- dealer {key} ({dealer['label']}) ---")
        tenant_id, tenant_created = ensure_tenant(api, dealer)
        user = ensure_user(api, dealer, dealer["member_email"])
        membership_created = ensure_membership(
            api, dealer, tenant_id, user["id"], role="member"
        )
        dealers_out[key] = {
            "tenant_id": tenant_id,
            "tenant_created_by_setup": tenant_created,
            "is_existing_tenant": dealer["is_existing_tenant"],
            "user": user,
            "membership_created": membership_created,
        }

    if not args.apply:
        print("\nDry run complete. Nothing was written. Re-run with --apply to execute.")
        print(f"(state would be written to {STATE_PATH}, chmod 600)")
        return

    state["dealers"] = dealers_out
    state["alba_tenant_id"] = fixtures["alba_tenant_id"]

    # --- backward-compat top-level keys for live_adversarial.py ---
    b = dealers_out.get("b", {})
    a = dealers_out.get("a", {})
    state["tenant"] = {"id": b.get("tenant_id"),
                        "created_by_setup": b.get("tenant_created_by_setup")}
    state["dealer_b_user"] = b.get("user")
    state["dealer_a_user"] = a.get("user")
    state["dealer_b_membership_created"] = bool(b.get("membership_created"))
    state["dealer_a_membership_created"] = bool(a.get("membership_created"))
    state["dealer_b_tenant_id"] = b.get("tenant_id")
    state["dealer_b_phone"] = fixtures["phones"]["india"]

    save_state(state)
    print("\nDone. Passwords are in the state file only -- never printed above.")


if __name__ == "__main__":
    main()
