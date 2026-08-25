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


def api(path, timeout=60, method='GET'):
    # After [1] has established the API is not answering, stop making every
    # later section wait out its own timeout — that turned a slow box into a
    # five-minute run that still said nothing useful.
    if not globals().get('API_OK', True):
        raise RuntimeError('n8n API was unreachable in [1]; not retried')
    """n8n's public API does have POST /executions/{id}/stop, contrary to what
    this file used to advise. The old note said to use the n8n UI because DELETE
    on a running execution returns 400 — true, but DELETE was the wrong verb.
    Stopping is what clears a zombie, and it is one call."""
    r = urllib.request.Request(N8N + '/api/v1' + path, headers=H, method=method)
    with urllib.request.urlopen(r, timeout=timeout) as x:
        body = x.read().decode()
        return json.loads(body) if body else {}


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

# One sample is not a measurement on a 1-vCPU box. At 01:18 on 25 Aug this
# reported 13.11s and blamed stuck executions; there were zero, and the very
# next samples were 0.33-0.77s. What had actually happened was the Competitor
# scraper running eighteen minutes earlier — an Apify call and an LLM call,
# which peg the single core. A checker that cries wolf gets skimmed, and the
# whole point of this file is to be believed the day it is right.
#
# So: sample up to three times, spaced, and report the BEST. A box that is
# genuinely wedged is slow on all three; a box that is merely busy is not.
latency = []
try:
    for i in range(3):
        t0 = time.time()
        api('/workflows?limit=1', timeout=90)
        latency.append(time.time() - t0)
        if latency[-1] < API_SLOW_SECONDS:
            break                      # fast once is fast enough; stop poking it
        time.sleep(3)
    dt = min(latency)
    if dt < API_SLOW_SECONDS:
        ok(f'API answered in {dt:.2f}s'
           + (f' (best of {len(latency)}; slowest {max(latency):.2f}s — something '
              f'was running)' if len(latency) > 1 else ''))
    else:
        bad(f'API answered in {dt:.2f}s on the best of {len(latency)} attempts '
            f'— over {API_SLOW_SECONDS}s and not a passing spike')
except Exception as e:
    # Do not give up here. At 05:24 on 25 Aug this exited on the first timeout,
    # so sections [2]-[7] never ran and the one thing it reported was the one
    # thing it could not explain. A minute of hand-checking established what
    # this should have: /webhook/privacy answered 200 in 16s while the API timed
    # out — n8n was alive and executing, the box was merely crawling — and ten
    # minutes later the same API call took 1.4s with nothing running at all.
    #
    # So: prove whether n8n is alive by a route that does not touch the API, say
    # which of the two is true, and let the remaining sections run and fail on
    # their own terms rather than being skipped by an early exit.
    bad(f'API did not answer in time: {str(e)[:100]}')
    API_OK = False
    try:
        # NOTE: this costs one n8n execution. /webhook/privacy is a workflow, not
        # a static file, so probing it is real work on a box that is short of
        # exactly that. It runs only here, in the branch where the API has
        # already failed and the answer is worth the cost.
        t0 = time.time()
        urllib.request.urlopen(N8N + '/webhook/privacy', timeout=60).read()
        print(f'         but /webhook/privacy answered in {time.time()-t0:.1f}s — n8n IS '
              'running and executing workflows. The box is slow, not down.')
        print('         Measured 25 Aug 09:40 UTC while this was happening: TCP connect '
              '0.0005s (the network is fine), TLS handshake 1.67s, first byte 3.7s. A TLS '
              'handshake is pure CPU, so a slow one on an idle box means the CPU is not '
              'there — not the network, not n8n, not the database.')
        print('         nexus-vm is an e2-micro: a SHARED-CORE burstable instance. Once '
              'its CPU credits are spent it is throttled to a fraction of a core until '
              'they rebuild, which looks exactly like this and recovers on its own.')
        print('         Check CPU utilisation and CPU credit balance on the instance in '
              'GCP before concluding anything is wedged.')
    except Exception:
        print('         and /webhook/privacy did not answer either — n8n itself is down, '
              'or the box is unreachable. Check the VM is running in GCP.')
    print('         Continuing; the sections that need the API will say so.')
else:
    API_OK = True

# --stop actually cancels what [2] finds. Off by default: cancelling somebody
# else's in-flight run is not a thing a health CHECK should do unasked.
STOP = '--stop' in sys.argv

# 2. stuck executions — the check the old watchdog did not have ---------------
print('\n[2] stuck and queued executions')
try:
    # 90s, not the default. At 01:18 this read timed out on a box that was
    # merely busy, and reported "could not read running executions" — a failure
    # caused by the slowness it exists to explain. When the answer matters most
    # is exactly when the box is slowest, so it has to wait longer than usual.
    running = api('/executions?status=running&limit=100', timeout=90)['data']
    stuck = [(e['id'], age_minutes(e.get('startedAt')), e.get('workflowId'))
             for e in running]
    stuck = [s for s in stuck if s[1] is not None and s[1] > STUCK_MINUTES]
    if stuck:
        bad(f'{len(stuck)} execution(s) running longer than {STUCK_MINUTES} min '
            f'— these are zombies and they degrade the whole instance')
        for eid, mins, wf in stuck[:6]:
            print(f'         id {eid}  {mins/60:.1f}h  {wf}')
        print('         FIX: run this script with --stop to cancel them.')
        if STOP:
            for eid, _m, _w in stuck:
                try:
                    api(f'/executions/{eid}/stop', method='POST')
                    print(f'         stopped {eid}')
                except Exception as e:
                    print(f'         could not stop {eid}: {str(e)[:80]}')
            print('         Re-run to confirm latency recovered — the API was '
                  '7.8s with two zombies and 1.2s without them.')
    else:
        note = f'{len(running)} running, none over {STUCK_MINUTES} min'
        if latency and min(latency) >= API_SLOW_SECONDS:
            note += (' — so the slow API above is NOT zombies. Look at what else '
                     'was running: the scraper, the drip and the BDC all call an '
                     'LLM, and this box has one core.')
        ok(note)
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

# 7. the scheduled jobs — a cron that silently stops is the quiet failure ------
#
# [3] only proves that SOMETHING completed, and the hourly Silence Detector is
# frequent enough to satisfy it alone. That is exactly how a nightly job can
# stop for a week unnoticed: the loudest heartbeat masks the missing one. Each
# job is checked against its OWN cadence.
#
# The source here is n8n executions, deliberately NOT audit_log. audit_log
# records what a workflow FOUND, not that it RAN — the Silence Detector writes a
# row only when somebody is actually silent, so on a quiet week an audit_log
# check would report a perfectly healthy job as dead. Executions answer the
# question actually being asked.
print('\n[7] scheduled jobs — each against its own cadence')
SCHEDULED = (
    ('Inventory Ageing Recompute',        26),   # 00:15 Dubai, daily
    ('NEXUS Retention Purge',             26),   # 03:00 Dubai, daily
    ('Customer 360 - Data Aggregation',   26),   # nightly
    ('Competitor Price Scraping',         26),   # cron 0 5 * * * in Asia/Dubai = 01:00 UTC
    ('Phase 6 - 12-Hour Silence Detector',  2),  # hourly
)
try:
    wfs = {w['name']: w for w in api('/workflows?limit=250')['data']}
    for name, max_h in SCHEDULED:
        wf = next((w for n, w in wfs.items() if n.startswith(name[:22])), None)
        if not wf:
            bad(f'{name}: no such workflow in n8n')
            continue
        wid = wf['id']
        try:
            runs = api(f'/executions?workflowId={wid}&status=success&limit=1')['data']
        except Exception as e:
            bad(f'{name}: could not read executions — {str(e)[:60]}')
            continue
        if not runs:
            bad(f'{name}: no successful run on record — it has never completed')
            continue
        age = age_minutes(runs[0].get('stoppedAt') or runs[0].get('startedAt'))
        if age is None:
            bad(f'{name}: unreadable timestamp on its last run')
        elif age / 60 > max_h:
            # A schedule that was edited after its last run has not "missed" one —
            # its clock restarted. Reporting that as a failure is how a watchdog
            # teaches you to ignore it, and then it cannot tell you about the real
            # thing. This is not hypothetical: the Competitor Price Scraping cron
            # was changed today at 17:0x and the next fire is 05:00 UTC, so the
            # bare FAIL would have stood for twelve hours saying nothing true.
            edited = age_minutes(wf.get('updatedAt'))
            if edited is not None and edited < age:
                ok(f'{name}: last success {age/60:.1f}h ago, but its schedule was '
                   f'changed {edited/60:.1f}h ago — the clock restarted, so nothing '
                   f'has been missed yet. Due within {max_h}h of the change.')
            else:
                bad(f'{name}: last success {age/60:.1f}h ago — it should run at least '
                    f'every {max_h}h, so it has missed a run')
        else:
            ok(f'{name}: {age/60:.1f}h ago')
except Exception as e:
    bad('could not check scheduled jobs: ' + str(e)[:100])

print('\n' + ('HEALTHY — nothing needs attention' if not problems
              else f'{len(problems)} PROBLEM(S):\n  - ' + '\n  - '.join(problems)))
sys.exit(0 if not problems else 1)
