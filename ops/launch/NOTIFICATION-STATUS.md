# NEXUS OS — Notification Status (NX996)

**18 September 2026.** What the notification outbox does, what it deliberately does not do,
and exactly what a website enquiry can and cannot expect today.

Status words, and only these: **LIVE · PARTIAL · BLOCKED · NOT_TESTED · NOT_READY**

---

## The one-line answer

A website enquiry is **stored durably and nobody is told.** After NX996 it is stored durably
**and the fact that somebody needs to be told is also stored durably.** Nothing sends it.
That is the honest state, and this document exists so that a screen reading `2 PENDING`
is never mistaken for progress.

---

## The problem this closed

| | |
|---|---|
| Measured | 18 Sep 2026, production `dsvuoovivysszdoiorch` |
| `POST /api/lead` | `200 {"ok":true,"stored":true,"notified":false}` |
| `nexus_sales_lead` rows | 4 |
| Rows with `contacted_at IS NULL` | 4 |
| Tables matching `outbox\|notification\|queue` before NX996 | 0 |

The only thing that was ever going to tell a human was a live HTTP call to a mail provider
inside the request (`apps/marketing-site/api/lead.js`, lines 29-33 and 179-213). That call
has not worked since the Resend account was removed. The receiver answers `notified: false`
honestly and then forgets, in the same breath, that anybody needs telling.

**Storing the lead** and **telling somebody** were one concern. NX996 makes them two.

---

## The board

| Concern | Status | Evidence | Blocker |
|---|---|---|---|
| Lead is stored durably | **LIVE** | NX974. 4 rows on production. Untouched by NX996. | — |
| "Somebody must be told" is stored durably | **PARTIAL** | NX996 outbox row written by an `AFTER INSERT` trigger; staging `wwspuxrbiyagnrnzgate` | Not yet applied to production |
| The 4 stranded leads are queued | **NOT_READY** | The migration's backfill enqueues every lead with `contacted_at IS NULL` | Runs when NX996 is applied to production |
| A notification failure can lose a lead | **PARTIAL** | It cannot: the enqueue trigger swallows every error and raises a warning, and the lead `INSERT` still commits. Proven on staging | Not yet applied to production |
| Attempts, errors and backoff are recorded | **PARTIAL** | `attempt_count` / `last_error_code` / `next_attempt_at`, exercised on staging | Not yet applied to production |
| Delivery history is tamper-evident | **PARTIAL** | `notification_attempt`; `UPDATE` refused outright, `DELETE`/`TRUNCATE` behind the NX900 guard | Not yet applied to production |
| Anything actually sends a notification | **NOT_READY** | No transport exists. No mail provider, no WhatsApp call, no Slack webhook, no key, no column that could hold one | A transport has to be chosen and paid for |
| Anything drains the queue | **NOT_READY** | No cron, no scheduler, no worker. `PENDING` rows wait forever | A worker has to be written and run somewhere |
| A screen shows this | **NOT_READY** | `nexus_notification_status()` exists and is `service_role` only. Nothing calls it | An owner-side console |

---

## What is in the database

Four tables, five write verbs, one read accessor.

| Object | What it is |
|---|---|
| `notification_state` | Lookup. Five words, each with the plain sentence it means. |
| `notification_transition` | The state machine, as data. Seven legal moves. Refusals quote it. |
| `nexus_notification_outbox` | One row per "somebody needs to be told about this enquiry". |
| `notification_attempt` | Append-only history. Every enqueue, claim, send, failure and acknowledgement. |
| `nexus_notification_enqueue` | Queue one. Idempotent while a live notification exists for that lead and channel. |
| `nexus_notification_claim` | Lease due rows to a named worker. `FOR UPDATE SKIP LOCKED`. |
| `nexus_notification_mark_sent` | A sender reported handing it to a transport. |
| `nexus_notification_mark_failed` | One attempt failed. `RETRYING` with backoff, or `FAILED` once attempts are spent. |
| `nexus_notification_acknowledge` | A named human confirmed they actually got it. |
| `nexus_notification_status` | The honest board. Counts, ages, last error, and the sentence "no sender is wired to this queue". |

### The five words

| State | Means |
|---|---|
| `PENDING` | Written down and waiting. Nobody has tried to send it. Today nobody ever will. |
| `RETRYING` | A send failed and attempts remain. `next_attempt_at` says when it may be claimed again. |
| `SENT` | A sender *reported* handing it to a transport. The sender's word, not a receipt. |
| `FAILED` | Every attempt spent, none worked. Terminal. A person has to read `last_error_detail`. |
| `ACKNOWLEDGED` | A named human confirmed receipt. The only state in which somebody definitely knows. |

`NO_NOTIFICATION` also appears in `nexus_notification_status()`. It is **not** a state: it counts
sales leads with no outbox row at all, which is what a swallowed enqueue failure looks like from
the outside — the one failure mode the queue cannot report about itself.

---

## Boundaries this holds

**No tenant, anywhere.** `nexus_sales_lead` is NEXUS's own vendor pipeline and sits outside the
tenant model (NX974). A dealership owner enquiring about buying NEXUS is a prospect for the vendor,
never a car buyer belonging to a dealership. The outbox has no `tenant_id`, no reference to
`tenants`, and no path to `leads`, `lead_event`, `appointment` or any other tenant table. The
migration's verify block fails and rolls back if either new table ever grows a tenant column.
The day a *dealership's* own notifications need a queue, that is a deliberate new table with its
own tenancy and its own RLS — not a quiet `ALTER` here.

**No second copy of the prospect.** The outbox holds no name, no phone number, no email address
and no message body. It points at the lead. Whatever eventually sends reads the details from
`nexus_sales_lead` at send time. A queue that is also a mailing list is a second thing to leak.

**No secrets.** No credential, endpoint, token or key is stored by any object in NX996.
Whoever wires a sender must keep them out of `notification_attempt.error_detail` too — an error
log is not a place for an authorization header.

**No browser role.** `anon` and `authenticated` have zero grants on all four tables and cannot
execute any of the six functions, read accessor included. Staging, 18 Sep:

| Role | outbox INSERT | outbox SELECT | enqueue | claim | mark_sent | acknowledge | status |
|---|---|---|---|---|---|---|---|
| `anon` | false | false | false | false | false | false | false |
| `authenticated` | false | false | false | false | false | false | false |
| `service_role` | true | true | true | true | true | true | true |

`set local role authenticated; insert into public.nexus_notification_outbox ...` →
`ERROR: 42501: permission denied for table nexus_notification_outbox`.

---

## Staging proof, 18 Sep 2026 (`wwspuxrbiyagnrnzgate`)

| Step | Result |
|---|---|
| Backfill of 2 pre-existing leads | 2 outbox rows, `PENDING`, `attempt_count 0` |
| New lead inserted | Outbox row created by the trigger, `PENDING` |
| `claim('nx996-staging-rig','EMAIL',1,300)` | `attempt_no 1`, `lease_expires_at 15:32:12Z` |
| `mark_failed(..., 'SMTP_NO_TRANSPORT', ...)` | `RETRYING`, `attempts_left 4`, next attempt `15:28:19Z` (1 min backoff) |
| Backoff holds the row | `claimable_now = false` while inside the backoff window |
| Re-claim after backoff | `attempt_no 2` |
| `mark_sent` | `SENT` at `15:29:03Z`, attempt 2 |
| `acknowledge(..., 'Ali (staging rig)')` | `ACKNOWLEDGED` at `15:29:09Z` |
| Exhausted row (`max_attempts 1`) | `FAILED`, `attempts_left 0` |
| Re-enqueue after `FAILED` | New `PENDING` row; the failed one stays |
| Second enqueue while live | `was_duplicate true` — one enquiry, one notification |

### Refusals, verbatim

```
NX996 REFUSED: nexus_notification_acknowledge cannot move notification
f4a8e01a-... from RETRYING to ACKNOWLEDGED. Legal moves from RETRYING:
FAILED (via nexus_notification_mark_failed), RETRYING (via
nexus_notification_mark_failed), SENT (via nexus_notification_mark_sent).
```

```
NX996 REFUSED: nexus_notification_mark_sent cannot move notification
ddfa4f86-... from FAILED to SENT. Legal moves from FAILED: none -- FAILED
is where a notification stops.
```

```
NX996 REFUSED: this notification was never claimed, so nothing can have
sent it. Claim it first.
```

```
NX996 APPEND_ONLY_REFUSED: notification_attempt records what happened, so
it cannot be edited into something else.
```

```
NX900 DESTRUCTIVE_WRITE_REFUSED: public.nexus_notification_outbox is
evidence, not scratch.
```

---

## What still cannot be done

1. **Nobody is told.** NX996 builds the queue, not the sender. A `PENDING` row is a promise to
   tell somebody, not a message. Until a transport exists, every enquiry is still answered by
   silence — the difference is that the silence is now counted and dated.
2. **Nothing runs.** There is no cron, no scheduler and no worker process. `nexus_notification_claim`
   is a function waiting to be called by something that does not exist.
3. **No screen.** `nexus_notification_status()` is `service_role` only and nothing calls it.
   It is deliberately not granted to `authenticated`: a dealership's signed-in staff have no
   business reading who else is thinking about buying NEXUS.
4. **`SENT` is a claim, not a receipt.** Delivery, opens and bounces are unknown to this schema.
   Only `ACKNOWLEDGED` — typed by a named human — means the prospect is genuinely known about.
5. **`/api/lead` still answers `notified: false`.** It is telling the truth and should keep
   telling it. Wiring the response to say "queued" is a separate, deliberate change to
   `apps/marketing-site/api/lead.js`, and it must not claim `notified: true` until something sends.
6. **Not applied to production.** NX996 is tested on staging only. Production
   `dsvuoovivysszdoiorch` is `SELECT` only from this session.

---

## The next honest step

Choose a transport and pay for it. Then write one worker that calls `claim`, sends, and calls
`mark_sent` or `mark_failed`. The queue, the backoff, the history and the refusals are already
here and already tested; the worker is thin. Nothing else about this design should change to
accommodate it.
