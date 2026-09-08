# J1 on a 958 MB box — run it in chunks, on purpose

The dealership stays on the GCP e2-micro free tier. That is a deliberate choice, not an
oversight, so the journey is paced to fit the box instead of hoping the box keeps up.

## Why this file exists

On 30–31 Aug the box stopped three times. The symptoms differed each time — zombie
executions holding both concurrency slots, a 24-deep webhook queue, then swap thrash — but
the cause was one thing: **21 workflows, 4 AI agents and a live WhatsApp channel on one
shared vCPU and 958 MB of RAM.** At the worst point `free -m` showed 108 MB available and a
load average of 5.07 on a single core: work arriving five times faster than it could leave.

J1's remaining steps are the heaviest in the system — KYC image analysis, RAG retrieval and
an embedding call. Run them back to back and the box stops again.

## Paused for the duration of the run

| Workflow | Schedule | Why |
|---|---|---|
| `B3TcpfzOMWj8oWgF` Phase 6 — 12-Hour Silence Detector | hourly | Took 2m30s at 19:00 on 30 Aug and holds a slot for its whole loop. The J1 runbook also lists it under MUST NOT RUN. |
| `57QpbNQGwlFKb0q3` NEXUS Infra Health Probe | every 15 min | Cheap per run, but it queues behind everything else and its alarm node throws into the error workflow, which spawns a second execution per failure. |

**Restore both when the run is finished** — they are real safety nets, not noise:

    KEY=$(grep -m1 '^N8N_API_KEY=' .env | cut -d= -f2- | tr -d '\r\n "')
    B=https://35.224.126.225.nip.io/api/v1
    for id in B3TcpfzOMWj8oWgF 57QpbNQGwlFKb0q3; do
      curl -s -X POST -H "X-N8N-API-KEY: $KEY" "$B/workflows/$id/activate" | head -c 120; echo
    done

Left running deliberately: Inventory Ageing (00:15), Customer 360 (02:00) and Retention
Purge (03:00) have already fired today, and Competitor Scraping next runs at 13:00 — none
of them collides with a run starting now.

## The chunks

Three or four steps, then let the box breathe. Between chunks, run the gate below.

| Chunk | Steps | What it exercises |
|---|---|---|
| A | 1–4 | First contact, lead creation, the email backfill, the escalation re-fire |
| B | 5–8 | Negotiation, intent to buy, the Emirates ID image, the KYC sub-workflow |
| C | 9–12 | Dashboard assignment, the rep's reply, compliance view, closed-won deal |
| D | 13–16 | Inventory write, Ask-AI citation, Customer 360, final health check |

Chunk B is the expensive one: a base64 image through a vision model on a box with ~230 MB
free. Expect it to be slow, and do not send anything else while it runs.

## The gate between chunks

Do not start the next chunk until all four are true.

    # 1 + 2. queue must be empty, both counts zero
    for s in new running; do printf "%s: " $s; \
      curl -s -H "X-N8N-API-KEY: $KEY" "$B/executions?status=$s&limit=50" \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))"; done

    # 3. available memory must be over 150 MB, load under 2.0
    gcloud compute ssh nexus-vm --zone=us-central1-a --quiet --command='free -m; uptime'

    # 4. n8n must answer quickly
    curl -s -o /dev/null -w "%{http_code} in %{time_total}s\n" \
      https://35.224.126.225.nip.io/healthz

If available memory is under 150 MB or load is above 3, restart n8n and wait 90 seconds:

    gcloud compute ssh nexus-vm --zone=us-central1-a --quiet \
      --command='cd /opt/nexus && sudo docker compose -f docker-compose.single.yml restart n8n'

> **Note added 8 September 2026: that `-f docker-compose.single.yml` is probably
> wrong, and the command is deliberately left as it stands.**
> `GET https://35.224.126.225.nip.io/rest/settings` on the live VM returns
> `executionMode: "queue"`, concurrency 2. `docker-compose.single.yml` states in
> its own comments that it runs in the default `regular` mode with no worker and
> no redis, so queue mode can only come from `docker-compose.yml`. Both files'
> headers have been corrected to say what is measured and what is inferred —
> read them before touching the VM.
>
> **Nobody has run `docker compose ps` on the box**, so the command above is not
> being changed on an inference. Settle it there first. If the box really is in
> queue mode, this line restarts the wrong process for anything env-related: the
> **worker** executes workflows, so a Code node reading `$env` runs in
> `n8n-worker`, and recreating `n8n` alone leaves the stale value where it is
> actually used. That is exactly how the WAHA gate sat at
> `header_present: true, ok: false` on 8 September. For a memory-pressure restart
> during a J1 run the distinction is minor; for anything touching `.env` it is
> the whole defect.

A restart takes about 90 seconds to answer again and costs nothing — the published workflow
version and all data survive it. It is a normal part of this plan, not a failure.

## Message spacing

**At least 20 seconds between customer messages, without exception.** `processed_messages`
was emptied by the teardown, so WAHA's duplicate protection has no history for this chat: a
redelivery inside that window creates a second execution, and two executions fill both
production slots. That is exactly how the 24-deep queue formed on 30 Aug.

## The one number to watch

`free -m` → **available**. Above 200 MB the box is fine. Below 150 MB it is already
swapping and every request is slower than it looks. That single figure predicted all three
stoppages better than any n8n metric.

## If the box stops anyway

It is recoverable every time, and none of it is data loss:

1. Cancel anything stuck in `running` — the public API refuses, so use the n8n UI's own
   endpoint from a logged-in browser tab: `POST /rest/executions/{id}/stop`.
2. Delete anything queued in `new` via `DELETE /api/v1/executions/{id}`.
3. Restart n8n as above.
4. Re-check the gate before resuming.

Messages sent while the box was stopped are **lost, not delayed** — `Claim Message Id`
writes the idempotency row before the reply chain runs, so a redelivery is treated as a
duplicate and dropped. Three messages were lost this way on 30 Aug. Resend them.
