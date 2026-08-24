#!/usr/bin/env python3
"""NEXUS OS health check — the one that would have caught what the last one missed.

WHY THIS EXISTS
---------------
The previous watchdog looked at `executions?limit=20` (newest first) and at
audit_log. Both said "healthy" while six executions had been stuck in `running`
for up to 26 hours and 89 orphaned rows sat in `new`. Neither check could see
them:

  * newest-first hides a row that started 26 hours ago and never finished;
  * audit_log only records runs that COMPLETE, so an execution that never ends
    is invisible to it by construction.

Meanwhile the n8n API had degraded to 35 s per call and the editor UI would not
load. Clearing the zombies took it back to 0.27 s.

So the rule this encodes: **do not measure only what finished.** Measure what is
stuck, what is queued, how slow the API is, and how long since anything
completed.

Exit code 0 = healthy, 1 = something needs attention. Every check prints its own
verdict so a failure names itself.

    NEXUS_ENV=/path/to/.env python3 nexus_healthcheck.py
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

N8N = 'https://35.224.126.225.nip.io'
ENV_PATH = os.environ.get('NEXUS_ENV', '/tmp/nexus.env')

# thresholds, with the reasoning attached
STUCK_MINUTES      = 30    # a BDC reply takes seconds; 30 min means wedged
QUEUE_WARN         = 20    # orphans accumulate in the hundreds, real bursts do not
API_SLOW_SECONDS   = 10.0  # it sat at 35 s when the UI would not load
IDLE_WARN_MINUTES  = 95    # the Silence Detector runs hourly; 95 min = a miss

env = {}
for line in open(ENV_PATH):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()
H = {'X-N8N-API-KEY': env['N8N_API_KEY']}
SK, SUPA = env['SUPABASE_SERVICE_ROLE_KEY'], env['SUPABASE_URL']

problems = []


def ok(msg):   print('  ok   ' + msg)
def bad(msg):  print('  FAIL ' + msg); problems.append(msg)


def api(path, timeout=60):
    r = urllib.request.Request(N8N + '/api/v1' + path, headers=H)
    with urllib.request.urlopen(r, timeout=timeout) as x:
        return json.loads(x.read().decode())


def supa(path):
    r = urllib.request.Request(SUPA + '/rest/v1/' + path,
                               headers={'apikey': SK, 'Authorization': 'Bearer ' + SK})
    with urllib.request.urlopen(r, timeout=45) as x:
        return json.loads(x.read().decode())


def age_minutes(ts):
    if not ts:
        return None
    t = datetime.fromisoformat(ts.replace('Z', '+00:00'))
    return (datetime.now(timezone.utc) - t).total_seconds() / 60


print('NEXUS OS health check —', datetime.now(timezone.utc).isoformat(timespec='seconds'))

# 1. is it up, and how fast ---------------------------------------------------
print('\n[1] reachability and API latency')
try:
    t0 = time.time()
    urllib.request.urlopen(N8N + '/healthz', timeout=30).read()
    ok(f'healthz answered in {time.time()-t0:.2f}s')
except Exception as e:
    bad(f'healthz unreachable: {str(e)[:120]}')

try:
    t0 = time.time()
    api('/workflows?limit=1', timeout=90)
    dt = time.time() - t0
    (ok if dt < API_SLOW_SECONDS else bad)(
        f'API answered in {dt:.2f}s' + ('' if dt < API_SLOW_SECONDS
                                        else f' — over {API_SLOW_SECONDS}s, usually stuck executions'))
except Exception as e:
    bad(f'API unreachable: {str(e)[:120]}')
    print('\nCannot continue without the API.')
    sys.exit(1)

# 2. stuck executions — the check the old watchdog did not have ---------------
print('\n[2] stuck and queued executions')
try:
    running = api('/executions?status=running&limit=100')['data']
    stuck = [(e['id'], age_minutes(e.get('startedAt')), e.get('workflowId'))
             for e in running]
    stuck = [s for s in stuck if s[1] is not None and s[1] > STUCK_MINUTES]
    if stuck:
        bad(f'{len(stuck)} execution(s) running longer than {STUCK_MINUTES} min '
            f'— these are zombies and they degrade the whole instance')
        for eid, mins, wf in stuck[:6]:
            print(f'         id {eid}  {mins/60:.1f}h  {wf}')
        print('         FIX: n8n UI -> Executions -> Stop all. The public API '
              'returns 400 on a running execution.')
    else:
        ok(f'{len(running)} running, none over {STUCK_MINUTES} min')
except Exception as e:
    bad('could not read running executions: ' + str(e)[:100])

try:
    queued = api('/executions?status=new&limit=250')['data']
    if len(queued) > QUEUE_WARN:
        ids = [int(e['id']) for e in queued]
        bad(f'{len(queued)} queued executions (ids {min(ids)}..{max(ids)})')
        print('         A WIDE id range means orphans from past crashes, not a '
              'real backlog — they can be DELETEd over the API.')
    else:
        ok(f'{len(queued)} queued')
except Exception as e:
    bad('could not read queued executions: ' + str(e)[:100])

# 3. has anything finished lately ---------------------------------------------
print('\n[3] liveness — something must be completing')
try:
    succ = api('/executions?status=success&limit=1')['data']
    if not succ:
        bad('no successful execution on record at all')
    else:
        mins = age_minutes(succ[0].get('stoppedAt') or succ[0].get('startedAt'))
        (ok if mins is not None and mins < IDLE_WARN_MINUTES else bad)(
            f'last success {mins:.0f} min ago (id {succ[0]["id"]})'
            + ('' if mins is not None and mins < IDLE_WARN_MINUTES
               else f' — the Silence Detector runs hourly, so over {IDLE_WARN_MINUTES} min means stalled'))
except Exception as e:
    bad('could not read successful executions: ' + str(e)[:100])

# 4. workflows all on ----------------------------------------------------------
print('\n[4] workflows')
try:
    wfs = api('/workflows?limit=100')['data']
    inactive = [w['name'] for w in wfs if not w.get('active')]
    drafts = [w['name'] for w in wfs if w.get('versionId') != w.get('activeVersionId')]
    (ok if not inactive else bad)(f'{len(wfs)} workflows, {len(wfs)-len(inactive)} active'
                                  + ('' if not inactive else ' — inactive: ' + ', '.join(inactive)))
    (ok if not drafts else bad)('all published' if not drafts
                                else 'unpublished drafts: ' + ', '.join(drafts))
except Exception as e:
    bad('could not read workflows: ' + str(e)[:100])

# 5. is the BDC failing on the runner again -----------------------------------
print('\n[5] the cascade — BDC failures on the task runner')
try:
    rows = supa("audit_log?select=workflow,status,summary,logged_at"
                "&logged_at=gte." + (datetime.now(timezone.utc).isoformat()[:10]) +
                "&order=logged_at.desc&limit=200")
    bdc_fail = [r for r in rows
                if 'BDC' in (r.get('workflow') or '') and r.get('status') == 'FAILED']
    runner = [r for r in bdc_fail
              if any(s in (r.get('summary') or '')
                     for s in ('Extract Message & Sender', 'Model Ladder',
                               'runner became unresponsive', 'Task request timed out'))]
    if runner:
        bad(f'{len(runner)} BDC failure(s) today on the task runner — THE PREFILTER '
            f'HAS NOT HELD, investigate before anything else')
        for r in runner[:3]:
            print('        ', r['logged_at'][11:19], (r.get('summary') or '')[:100])
    else:
        ok(f'no task-runner failures today ({len(bdc_fail)} BDC failures of any kind)')
except Exception as e:
    bad('could not read audit_log: ' + str(e)[:100])

# 6. the data the dashboard reads ----------------------------------------------
print('\n[6] data')
for label, path in (('leads', 'leads?select=id'),
                    ('purchase_history', 'purchase_history?select=id'),
                    ('deals_embeddings', 'deals_embeddings?select=id'),
                    ('customer_360_profiles', 'customer_360_profiles?select=id'),
                    ('kyc archive gaps', 'kyc_documents?select=id&storage_path=is.null'
                                         '&purged_at=is.null&created_at=gt.2026-08-17T16:01:48Z')):
    try:
        n = len(supa(path))
        if label == 'kyc archive gaps':
            (ok if n == 0 else bad)(f'{label}: {n}')
        else:
            ok(f'{label}: {n}')
    except Exception as e:
        bad(f'{label}: unreadable — {str(e)[:80]}')

print('\n' + ('HEALTHY — nothing needs attention' if not problems
              else f'{len(problems)} PROBLEM(S):\n  - ' + '\n  - '.join(problems)))
sys.exit(0 if not problems else 1)
