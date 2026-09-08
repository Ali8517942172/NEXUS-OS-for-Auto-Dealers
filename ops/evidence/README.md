# ops/evidence — the measurements this repository's claims rest on

Every file here was written by a session that had a live database in front of
it, and every one of them until 8 September 2026 lived **only** in an ephemeral
cloud container under `/home/claude/out/`. `CLAUDE.md`, `CONTROL-PLANE.md`,
`OWNER-ACTIONS.md`, `README.md`, `V1-RELEASE-CLOSURE.md`, `ops/DEMO.md` and the
two `STATUS-*.md` files cited **ten** of them by that absolute container path.

That is a real defect, and it is the reason this folder exists. A container is
reclaimed after a period of inactivity. The moment that happened, this
repository would have gone on asserting things like *"proved adversarially,
evidence in `/home/claude/out/unattributed-default-evidence.md`"* while the
named file existed nowhere on Earth — a citation that reads like proof and
resolves to nothing. Everything cited was moved here and every citation was
rewritten to point at the repository path.

**The rule that follows: evidence for a claim in a tracked file must itself be
tracked.** If a measurement is worth citing, it is worth committing. A path
under `/home/claude`, `/tmp`, or any other session-local directory is not a
citation.

## What is here

- `*-evidence.md`, `*-proof-*.md` — measured results, usually inside
  transactions that ended in `ROLLBACK`, with the positive controls stated.
- `*-NOT-DEPLOYED.md` — changes that were written, reasoned about, and
  deliberately **not** applied. Read the preconditions before applying one.
- `v1-closure-*.md`, `PLATFORM-TRUTH-*.md`, `RESUME-STATE.md`, `MERGED.md` —
  the closure and handover records of earlier passes.

## What is deliberately NOT here

- **The catalogue dumps** (`catalogue.prod.*.json`, ~400 KB each). They are
  regenerable in one statement — `node apps/executive-dashboard/QUALITY_GATE.mjs
  --print-sql` emits the SQL that produces one — and a stale committed catalogue
  is worse than no catalogue, because the gate's whole staleness discipline
  exists to stop exactly that being trusted.
- **The gate reports** (`gate-*.md`, `gate-report-*.md`). Same reason: a report
  is the output of a run, and the run is the artefact. CI uploads its own.
- **Transfer patches.** `OWNER-ACTIONS.md` and `STATUS-2026-09-06.md` still name
  `/home/claude/out/nexus-M0-M1-2026-09-06.patch`; that sentence is a historical
  measurement of a moment on 6 September, not an instruction, and the commits it
  carried have since reached `main`. It is left as written rather than rewritten
  into a path that never existed here.

## What these files do NOT establish

They are measurements against **staging and production databases**, and several
were taken inside rolled-back transactions. None of them is evidence about a
real customer, a real dealership using the product, or recovered revenue.
`CLAUDE.md`'s own distinctions hold here unchanged: registered is not connected,
connected is not received, received is not attributed, and attributed is not
recovered.
