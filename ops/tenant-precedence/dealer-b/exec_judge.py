#!/usr/bin/env python3
"""Shared n8n-EXECUTION-based verdict engine for the NEXUS tenant-precedence
live harnesses (live_adversarial.py, journeys.py).

WHY THIS EXISTS
  Both harnesses used to grade a case by the webhook's HTTP response. That is
  unsound for any door whose trigger node's responseMode is "onReceived"
  (n8n's default when responseMode is unset): the webhook answers 200 the
  instant the request is received, before the resolver code runs, so a
  refused case and an accepted case are HTTP-indistinguishable. It is also
  unsound for text-matching a refusal: each door's resolver throws its own
  message, and only ever reliably carries a shared prefix
  ("[NEXUS-UNATTRIBUTED] ") on the *description*, not on the concatenated
  message a naive substring search sees.

  This module finds the actual n8n EXECUTION each POST created, polls it to
  a terminal state, and reads the verdict out of the execution's own node
  data:
    * a "must refuse" case only PASSES if some node's thrown error
      description starts with "[NEXUS-UNATTRIBUTED] " (checked against both
      the execution-level resultData.error and every node run's own error --
      confirmed, by direct inspection of live executions 15937/15941/15948/
      15950/etc., to be the one field every patched resolver's error shares,
      regardless of the door's own wording after that prefix) AND Supabase
      has no row for this case's marker under the forbidden tenant.
    * a "must resolve to tenant X" case only PASSES if some node's OUTPUT
      carries {"tenant_id": X} (every patched resolver's output was
      confirmed, across master-router/finance-calc/closed-won/erp-sync/
      lead-escalation, to stamp tenant_id -- and tenant_source where the
      node also sets it -- onto its output item; we take the
      chronologically LAST such node, i.e. the value that actually reached
      the rest of the workflow) AND, if a leads/audit_log row for the
      marker exists at all, that row's tenant_id also equals X. A door that
      never persists a row for a given case is not penalised for that --
      "if the door writes one" in the brief means exactly this.

  The marker match itself is done against the WEBHOOK TRIGGER node's own
  captured request body (always the first node in runData, whatever it is
  named per door -- "Webhook Catch-All", "DripWebhook", "Webhook Trigger",
  "Webhook - New Deal", "ErpSyncWebhook", "EscalationWebhook", ...). That
  node's output is the one place a marker is guaranteed to survive
  regardless of whether the resolver refused, the AI provider rate-limited,
  or the door doesn't otherwise write anything -- it is n8n's own record of
  "this exact HTTP request arrived", independent of what happened next.
"""
import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import wf  # noqa: E402  (../wf.py -- call(method, path) against n8n's public API)

UNATTRIBUTED_PREFIX = "[NEXUS-UNATTRIBUTED] "
TERMINAL_STATUSES = {"success", "error", "failed", "crashed", "canceled", "waiting"}
NONTERMINAL_STATUSES = {"new", "running"}
DEFAULT_TIMEOUT_S = 120
POLL_INTERVAL_S = 3


def n8n_get(path):
    return wf.call("GET", path)


def list_executions_page(workflow_id, cursor=None, limit=50):
    params = {"workflowId": workflow_id, "limit": str(limit)}
    if cursor:
        params["cursor"] = cursor
    return n8n_get("/executions?" + urllib.parse.urlencode(params))


def list_recent_executions(workflow_id, since_iso, max_pages=6, limit=50):
    """Executions for workflow_id, newest first, stopping once we're past
    since_iso (executions are returned newest-first so this is a safe early
    exit, not a filter that could skip a match)."""
    out = []
    cursor = None
    for _ in range(max_pages):
        page = list_executions_page(workflow_id, cursor=cursor, limit=limit)
        rows = page.get("data") or []
        stop = False
        for row in rows:
            if row.get("startedAt") and row["startedAt"] < since_iso:
                stop = True
                break
            out.append(row)
        if stop or not page.get("nextCursor"):
            break
        cursor = page["nextCursor"]
    return out


def get_execution_full(execution_id):
    return n8n_get(f"/executions/{execution_id}?includeData=true")


# Keys that hold the RAW, untouched webhook request on every trigger-node
# (and passthrough-node) output item: the original caller-supplied body,
# not anything a resolver derived. A malicious case's whole point is that
# the caller's OWN forbidden tenant_id claim sits at body["tenant_id"] --
# so walking into these keys makes every passthrough of the raw request
# look like a node that "resolved" the caller's claim, even when the node
# never read it. See find_resolved_tenant.
_RAW_REQUEST_KEYS = frozenset({"headers", "body", "query", "params"})


def _walk_dicts(obj, skip_keys=frozenset()):
    if isinstance(obj, dict):
        yield obj
        for k, v in obj.items():
            if k in skip_keys:
                continue
            yield from _walk_dicts(v, skip_keys)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_dicts(v, skip_keys)


def _run_data(execution_full):
    return ((execution_full.get("data") or {}).get("resultData") or {}).get(
        "runData"
    ) or {}


def trigger_node_body(execution_full):
    """The first-executed node's (the webhook trigger's) captured request,
    regardless of its per-door name. Returns the parsed body dict, or {}."""
    rd = _run_data(execution_full)
    if not rd:
        return {}
    first_name = next(iter(rd), None)
    if first_name is None:
        return {}
    try:
        runs = rd[first_name]
        item = runs[0]["data"]["main"][0][0]
        return item.get("json", {}).get("body", {}) or {}
    except (KeyError, IndexError, TypeError):
        return {}


def marker_in_execution(execution_full, marker):
    body = trigger_node_body(execution_full)
    if not body:
        return False
    blob = json.dumps(body)
    return marker in blob


def find_resolved_tenant(execution_full):
    """(node_name, tenant_id) from the chronologically LAST node run whose
    output item json carries a 'tenant_id' key anywhere in it, or (None,
    None) if no node ever resolved one."""
    rd = _run_data(execution_full)
    best = None  # (startTime, node_name, tenant_id)
    for node_name, runs in rd.items():
        for run in runs or []:
            start_time = run.get("startTime", 0)
            data = run.get("data") or {}
            for branch in (data.get("main") or []):
                for item in branch or []:
                    j = (item or {}).get("json")
                    if not isinstance(j, dict):
                        continue
                    for d in _walk_dicts(j, skip_keys=_RAW_REQUEST_KEYS):
                        tid = d.get("tenant_id")
                        if tid:
                            if best is None or start_time >= best[0]:
                                best = (start_time, node_name, tid)
    if best is None:
        return None, None
    return best[1], best[2]


def find_unattributed_refusal(execution_full):
    """(node_name, description, message) for the refusal, or None. Checks
    the execution-level error first (what a caller polling only the summary
    would see), then every node run's own error, preferring the
    chronologically LAST errored node (the one that actually threw first in
    a synchronous chain is usually also the only one, but be safe)."""
    top_err = (
        (execution_full.get("data") or {}).get("resultData") or {}
    ).get("error") or {}
    desc = top_err.get("description") or ""
    if desc.startswith(UNATTRIBUTED_PREFIX):
        return (
            execution_full.get("data", {})
            .get("resultData", {})
            .get("lastNodeExecuted"),
            desc,
            top_err.get("message") or "",
        )

    rd = _run_data(execution_full)
    best = None
    for node_name, runs in rd.items():
        for run in runs or []:
            if run.get("executionStatus") != "error":
                continue
            err = run.get("error") or {}
            d = err.get("description") or ""
            if d.startswith(UNATTRIBUTED_PREFIX):
                st = run.get("startTime", 0)
                if best is None or st >= best[0]:
                    best = (st, node_name, d, err.get("message") or "")
    if best is None:
        return None
    return best[1], best[2], best[3]


def find_any_error(execution_full):
    """(node_name-or-None, description, message) for whatever DID error,
    for detail strings when it wasn't the tenant gate."""
    top_err = (
        (execution_full.get("data") or {}).get("resultData") or {}
    ).get("error") or {}
    if top_err:
        return (
            execution_full.get("data", {})
            .get("resultData", {})
            .get("lastNodeExecuted"),
            top_err.get("description") or "",
            top_err.get("message") or "",
        )
    rd = _run_data(execution_full)
    last = None
    for node_name, runs in rd.items():
        for run in runs or []:
            if run.get("executionStatus") == "error":
                err = run.get("error") or {}
                st = run.get("startTime", 0)
                if last is None or st >= last[0]:
                    last = (st, node_name, err.get("description") or "", err.get("message") or "")
    if last is None:
        return None, "", ""
    return last[1], last[2], last[3]


def poll_for_case_execution(workflow_id, marker, since_iso, timeout=DEFAULT_TIMEOUT_S,
                             interval=POLL_INTERVAL_S, log=None):
    """Find (and fully fetch) the execution created by this case's POST:
    the one under workflow_id, started at/after since_iso, whose trigger
    node body contains `marker`. Polls up to `timeout` seconds because the
    execution may not even be listed yet immediately after the POST
    returns. Returns the full execution dict, or None on timeout."""
    deadline = time.time() + timeout
    seen_ids = set()
    while True:
        candidates = list_recent_executions(workflow_id, since_iso)
        for row in candidates:
            eid = row.get("id")
            if not eid or eid in seen_ids:
                continue
            full = get_execution_full(eid)
            if marker_in_execution(full, marker):
                return full
            seen_ids.add(eid)
        if time.time() >= deadline:
            if log:
                log(f"    timeout: no execution under workflow {workflow_id} matched "
                    f"marker {marker} within {timeout}s (checked {len(seen_ids)} "
                    f"candidate execution(s) since {since_iso})")
            return None
        time.sleep(interval)


def poll_until_terminal(execution_full, timeout=DEFAULT_TIMEOUT_S,
                         interval=POLL_INTERVAL_S, log=None):
    """Re-fetch this execution until its status is terminal (see
    TERMINAL_STATUSES) or timeout. Returns the last-fetched execution dict
    (which may still be non-terminal if we timed out)."""
    deadline = time.time() + timeout
    eid = execution_full.get("id")
    current = execution_full
    while current.get("status") in NONTERMINAL_STATUSES:
        if time.time() >= deadline:
            if log:
                log(f"    timeout: execution {eid} still status="
                    f"{current.get('status')} after {timeout}s")
            break
        time.sleep(interval)
        current = get_execution_full(eid)
    return current


def executions_in_window(workflow_id, since_iso, until_iso):
    """Full (includeData=true) executions for workflow_id with
    since_iso <= startedAt <= until_iso, oldest first. Used only by the
    legacy-run reconstruction path in --reverify (a real marker was never
    saved for these executions, so time-window + a body-content predicate,
    supplied by the caller, is how they're matched back to a case)."""
    rows = list_recent_executions(workflow_id, since_iso)
    out = []
    for row in rows:
        started = row.get("startedAt") or ""
        if started > until_iso:
            continue
        out.append(get_execution_full(row["id"]))
    out.sort(key=lambda e: e.get("startedAt") or "")
    return out


def judge_known_execution(execution_id, expect_refused, forbidden_tenant_id,
                           expect_tenant_id, row_check, timeout=DEFAULT_TIMEOUT_S, log=print):
    """Same verdict logic as judge_refusal_case/judge_resolve_case, but
    starting from an execution id already known (from a saved case map, or
    freshly reconstructed) instead of searching for it by marker. Used by
    --reverify so a re-judge never re-sends anything and never re-searches
    once the mapping is in hand."""
    execution = get_execution_full(execution_id)
    execution = poll_until_terminal(execution, timeout, log=log)
    eid = execution.get("id")
    status = execution.get("status")
    db_ok, db_notes = row_check()

    if expect_refused:
        refusal = find_unattributed_refusal(execution)
        resolved_node, resolved_tenant = find_resolved_tenant(execution)
        if not db_ok:
            return "FAIL", f"execution {eid} (status={status}) | ROW CHECK FAILED: {db_notes}", eid
        if refusal:
            node, desc, msg = refusal
            return "PASS", f"execution {eid} refused at {node}: {desc}: {msg} | rows: {db_notes}", eid
        if resolved_tenant == forbidden_tenant_id:
            return "FAIL", (
                f"execution {eid} (status={status}): resolver ({resolved_node}) adopted the "
                f"caller-claimed forbidden tenant_id={forbidden_tenant_id} instead of refusing "
                f"| rows: {db_notes}"
            ), eid
        if status == "success":
            return "FAIL", f"execution {eid}: expected a tenant refusal, execution completed successfully | rows: {db_notes}", eid
        err_node, err_desc, err_msg = find_any_error(execution)
        if status in NONTERMINAL_STATUSES:
            return "INCONCLUSIVE", f"execution {eid} did not reach a terminal state within {timeout}s (status={status})", eid
        return "INCONCLUSIVE", (
            f"execution {eid} ended status={status} without a confirmed [NEXUS-UNATTRIBUTED] "
            f"refusal (last error at {err_node}: {err_desc}: {err_msg}) -- likely an unrelated "
            f"failure, not confirmed as either a tenancy pass or leak | rows: {db_notes}"
        ), eid

    resolved_node, resolved_tenant = find_resolved_tenant(execution)
    if resolved_tenant is None:
        err_node, err_desc, err_msg = find_any_error(execution)
        if not db_ok:
            return "FAIL", f"execution {eid}: no node ever resolved a tenant_id | ROW CHECK FAILED: {db_notes}", eid
        if status in NONTERMINAL_STATUSES:
            return "INCONCLUSIVE", f"execution {eid} did not reach a terminal state within {timeout}s (status={status})", eid
        return "INCONCLUSIVE", (
            f"execution {eid} (status={status}): tenant was never resolved in this "
            f"execution (last error at {err_node}: {err_desc}: {err_msg}) -- cannot confirm "
            f"tenant-precedence behaviour either way | rows: {db_notes}"
        ), eid
    if resolved_tenant != expect_tenant_id:
        return "FAIL", (
            f"execution {eid} ({resolved_node}): resolved tenant_id={resolved_tenant}, "
            f"expected {expect_tenant_id} | rows: {db_notes}"
        ), eid
    if not db_ok:
        return "FAIL", f"execution {eid}: resolver correctly assigned {expect_tenant_id} | ROW CHECK FAILED: {db_notes}", eid
    note = ""
    if status not in ("success", "waiting"):
        err_node, err_desc, err_msg = find_any_error(execution)
        note = (f" (execution ended status={status} after correct resolution -- "
                f"unrelated downstream error at {err_node}: {err_desc}: {err_msg}, "
                f"not a tenancy issue)")
    return "PASS", (
        f"execution {eid} ({resolved_node}) correctly resolved tenant_id={expect_tenant_id}"
        f"{note} | rows: {db_notes}"
    ), eid


def judge_refusal_case(workflow_id, marker, since_iso, forbidden_tenant_id,
                        row_check, timeout=DEFAULT_TIMEOUT_S, log=print):
    """row_check() -> (db_ok: bool, db_notes: str), same contract as the
    harnesses' existing verify_rows() against Supabase, called regardless of
    what the execution shows (a resolver that refuses AFTER a write already
    landed is still a leak)."""
    execution = poll_for_case_execution(workflow_id, marker, since_iso, timeout, log=log)
    if execution is None:
        return "INCONCLUSIVE", f"no matching execution found under workflow {workflow_id} within {timeout}s", None
    execution = poll_until_terminal(execution, timeout, log=log)
    eid = execution.get("id")
    status = execution.get("status")

    db_ok, db_notes = row_check()

    refusal = find_unattributed_refusal(execution)
    resolved_node, resolved_tenant = find_resolved_tenant(execution)

    if not db_ok:
        return "FAIL", f"execution {eid} (status={status}) | ROW CHECK FAILED: {db_notes}", eid

    if refusal:
        node, desc, msg = refusal
        return "PASS", f"execution {eid} refused at {node}: {desc}: {msg} | rows: {db_notes}", eid

    if resolved_tenant == forbidden_tenant_id:
        return "FAIL", (
            f"execution {eid} (status={status}): resolver ({resolved_node}) adopted the "
            f"caller-claimed forbidden tenant_id={forbidden_tenant_id} instead of refusing "
            f"| rows: {db_notes}"
        ), eid

    if status == "success":
        return "FAIL", f"execution {eid}: expected a tenant refusal, execution completed successfully | rows: {db_notes}", eid

    err_node, err_desc, err_msg = find_any_error(execution)
    if status in NONTERMINAL_STATUSES:
        return "INCONCLUSIVE", f"execution {eid} did not reach a terminal state within {timeout}s (status={status})", eid
    return "INCONCLUSIVE", (
        f"execution {eid} ended status={status} without a confirmed [NEXUS-UNATTRIBUTED] "
        f"refusal (last error at {err_node}: {err_desc}: {err_msg}) -- likely an unrelated "
        f"failure, not confirmed as either a tenancy pass or leak | rows: {db_notes}"
    ), eid


def judge_resolve_case(workflow_id, marker, since_iso, expect_tenant_id,
                        row_check, timeout=DEFAULT_TIMEOUT_S, log=print):
    execution = poll_for_case_execution(workflow_id, marker, since_iso, timeout, log=log)
    if execution is None:
        return "INCONCLUSIVE", f"no matching execution found under workflow {workflow_id} within {timeout}s", None
    execution = poll_until_terminal(execution, timeout, log=log)
    eid = execution.get("id")
    status = execution.get("status")

    db_ok, db_notes = row_check()

    resolved_node, resolved_tenant = find_resolved_tenant(execution)

    if resolved_tenant is None:
        err_node, err_desc, err_msg = find_any_error(execution)
        if not db_ok:
            return "FAIL", f"execution {eid}: no node ever resolved a tenant_id | ROW CHECK FAILED: {db_notes}", eid
        if status in NONTERMINAL_STATUSES:
            return "INCONCLUSIVE", f"execution {eid} did not reach a terminal state within {timeout}s (status={status})", eid
        return "INCONCLUSIVE", (
            f"execution {eid} (status={status}): tenant was never resolved in this "
            f"execution (last error at {err_node}: {err_desc}: {err_msg}) -- cannot confirm "
            f"tenant-precedence behaviour either way | rows: {db_notes}"
        ), eid

    if resolved_tenant != expect_tenant_id:
        return "FAIL", (
            f"execution {eid} ({resolved_node}): resolved tenant_id={resolved_tenant}, "
            f"expected {expect_tenant_id} | rows: {db_notes}"
        ), eid

    if not db_ok:
        return "FAIL", f"execution {eid}: resolver correctly assigned {expect_tenant_id} | ROW CHECK FAILED: {db_notes}", eid

    note = ""
    if status not in ("success", "waiting"):
        err_node, err_desc, err_msg = find_any_error(execution)
        note = (f" (execution ended status={status} after correct resolution -- "
                f"unrelated downstream error at {err_node}: {err_desc}: {err_msg}, "
                f"not a tenancy issue)")
    return "PASS", (
        f"execution {eid} ({resolved_node}) correctly resolved tenant_id={expect_tenant_id}"
        f"{note} | rows: {db_notes}"
    ), eid
