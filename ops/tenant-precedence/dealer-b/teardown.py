#!/usr/bin/env python3
"""NEXUS tenant-precedence wave -- three-dealer (A/B/C) fixture teardown.

Generalised from the original two-dealer teardown. Removes exactly what
setup.py --apply created (tenants B/C, member users A/B/C, memberships),
read back from ~/.nexus-dealer-b.json, plus every NEXUS-TEST lead and
audit_log row journeys.py wrote for dealers B and C's test tenants, and
every NEXUS-TEST lead/audit_log row filed under dealer A's tenant (the
real Tenant A tenant -- teardown never deletes the tenant or dealer A's own
membership row unless setup created it, but it always cleans up the
NEXUS-TEST rows journeys.py put there, since those are never
pre-existing data).

Anything setup found already existing (a pre-existing Tenant A membership for
dealer A, say) is left alone -- tenants/users/memberships are only
deleted when their *_created_by_setup / *membership_created flag is true
in the state file. NEXUS-TEST leads/audit_log rows are always deleted
regardless of who created the tenant, because journeys.py is the only
thing that could have written them and they are always safe to remove by
the NEXUS-TEST marker in the row's own text.

    python3 teardown.py            # dry run (default) -- prints what would go
    python3 teardown.py --apply    # executes

Order matters: NEXUS-TEST leads/audit_log rows first (nothing else
depends on them), then memberships (FK to both tenants and auth.users),
then the test tenant rows (B/C only -- dealer A/Tenant A is never dropped),
then the auth users last, matching create order in reverse. On success
with --apply the state file itself is removed.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ENV_PATH = os.path.join(
    os.path.expanduser("~"), "mnt", "MY RESUMES", "nexus-os", ".env"
)
STATE_PATH = os.path.join(os.path.expanduser("~"), ".nexus-dealer-b.json")
TIMEOUT = 20

# Any row (leads.name / audit_log.lead_name, whichever the table has)
# containing this literal substring was written by journeys.py and is
# always safe to delete, regardless of which dealer's tenant it landed
# under -- this is the ONLY thing that identifies a row as ours, since
# dealer A is a real, shared production tenant.
NEXUS_TEST_MARKER = "NEXUS TEST"


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


class Api:
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

    def call(self, method, path, params=None, extra_headers=None):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = self._headers(extra_headers)
        redacted = dict(headers)
        redacted["Authorization"] = "Bearer <service-role-key redacted>"
        redacted["apikey"] = "<redacted>"

        if not self.apply:
            print(f"  {method} {url}")
            print(f"    headers: {redacted}")
            return None

        req = urllib.request.Request(url, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {raw}") from None


def delete_nexus_test_rows(api, table, name_col):
    print(f"[rows] deleting {table} where {name_col} ilike *{NEXUS_TEST_MARKER}*")
    api.call(
        "DELETE",
        f"/rest/v1/{table}",
        params={name_col: f"ilike.*{NEXUS_TEST_MARKER}*"},
    )


def delete_membership(api, label, tenant_id, user_id):
    if not tenant_id or not user_id:
        print(f"[member:{label}] no id on file, skipping")
        return
    print(f"[member:{label}] deleting tenant_members "
          f"tenant_id={tenant_id} auth_user_id={user_id}")
    api.call(
        "DELETE",
        "/rest/v1/tenant_members",
        params={"tenant_id": f"eq.{tenant_id}", "auth_user_id": f"eq.{user_id}"},
    )


def delete_tenant(api, tenant_id):
    if not tenant_id:
        return
    print(f"[tenant] deleting tenants id={tenant_id}")
    api.call("DELETE", "/rest/v1/tenants", params={"id": f"eq.{tenant_id}"})


def delete_user(api, label, user_id):
    if not user_id:
        return
    print(f"[user:{label}] deleting auth user id={user_id}")
    api.call("DELETE", f"/auth/v1/admin/users/{user_id}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="execute (default: dry-run)")
    args = ap.parse_args()

    if not os.path.exists(STATE_PATH):
        sys.exit(f"no state file at {STATE_PATH} -- nothing to tear down "
                  f"(setup.py --apply was not run, or was already torn down)")

    with open(STATE_PATH, encoding="utf-8") as fh:
        state = json.load(fh)

    env = load_env(ENV_PATH)
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(k):
            sys.exit(f"missing required env var in {ENV_PATH}: {k}")

    if args.apply:
        print("=== APPLY MODE -- this will delete from Supabase at", env["SUPABASE_URL"], "===\n")
    else:
        print("=== DRY RUN -- printing calls only, nothing executes. Use --apply to run. ===\n")

    api = Api(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], args.apply)

    dealers = state.get("dealers") or {}
    # Fall back to the original two-dealer top-level keys if "dealers" is
    # missing (state file from before this generalisation, or a partial
    # apply) so teardown still works against an old-format state file.
    if not dealers:
        dealers = {}
        if state.get("dealer_a_user"):
            dealers["a"] = {
                "tenant_id": state.get("alba_tenant_id"),
                "tenant_created_by_setup": False,
                "user": state.get("dealer_a_user"),
                "membership_created": state.get("dealer_a_membership_created"),
            }
        if state.get("dealer_b_user"):
            dealers["b"] = {
                "tenant_id": (state.get("tenant") or {}).get("id")
                or state.get("dealer_b_tenant_id"),
                "tenant_created_by_setup": (state.get("tenant") or {}).get("created_by_setup"),
                "user": state.get("dealer_b_user"),
                "membership_created": state.get("dealer_b_membership_created"),
            }

    print("\n--- NEXUS-TEST leads/audit_log rows (all dealers, including Tenant A) ---")
    delete_nexus_test_rows(api, "leads", "name")
    delete_nexus_test_rows(api, "audit_log", "lead_name")

    print("\n--- memberships ---")
    for key, d in dealers.items():
        if d.get("membership_created"):
            delete_membership(api, key, d.get("tenant_id"), (d.get("user") or {}).get("id"))
        else:
            print(f"[member:{key}] not created by setup (or already removed), skipping")

    print("\n--- test tenants (dealer A / Tenant A is never dropped) ---")
    for key, d in dealers.items():
        if d.get("tenant_created_by_setup"):
            delete_tenant(api, d.get("tenant_id"))
        else:
            print(f"[tenant:{key}] not created by setup, skipping")

    print("\n--- test users ---")
    for key, d in dealers.items():
        user = d.get("user") or {}
        if user.get("created_by_setup"):
            delete_user(api, key, user.get("id"))
        else:
            print(f"[user:{key}] not created by setup, skipping")

    if args.apply:
        os.remove(STATE_PATH)
        print(f"\nDone. {STATE_PATH} removed.")
    else:
        print(f"\nDry run complete. Nothing was deleted. {STATE_PATH} left in place.")


if __name__ == "__main__":
    main()
