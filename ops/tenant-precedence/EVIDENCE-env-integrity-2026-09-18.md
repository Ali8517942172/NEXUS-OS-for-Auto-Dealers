# Priority 1 — `/opt/nexus/.env` integrity, measured 18 Sep 2026

Run in GCP Console SSH-in-browser on `nexus-vm` (project `nexus-os-backend`,
zone `us-central1-a`), as `aliasgher892@nexus-vm`:

```
echo SEC=$(grep -c '^WAHA_WEBHOOK_SECRET=' /opt/nexus/.env) ENF=$(grep -c '^WAHA_WEBHOOK_ENFORCE=' /opt/nexus/.env)
```

Result:

```
SEC=1 ENF=1
```

**No duplicate.** The rollback risk described in `ops/launch/WAHA-GATE-MEASURED-2026-09-18.md`
F2 — a second `WAHA_WEBHOOK_SECRET=` line flipping the expected value on the next
container recreate and dropping every customer message silently — **does not exist
on this box.** `grep -c` returns counts only; no secret value was displayed, typed
or transcribed.

Status: **CLOSED.**
