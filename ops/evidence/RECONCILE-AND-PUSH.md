# Reconcile the three builds, then push — 3 Sep 2026

## The problem, in one paragraph

There are **three** builds of the dashboard, not two.

| Where | Nav entries | Provenance |
|---|---|---|
| Production (Vercel, live) | **14** | merge of PR #4, `wip/domain-truth-2026-09-02` |
| PR #5 (open on GitHub) | **15** | adds only the Action Center |
| This container, `wip/platform-truth-2026-09-01` | **20** | five Revenue Recovery screens |

**None of PR #5's thirteen commit ids exist in this repository.** The two
chains share no commits at all. The five Revenue Recovery screens live in
`8eb9cd7`, which is on no GitHub branch — that work exists in one container's
working tree and nowhere else.

**Do not merge PR #5 before the reconciliation below.** Merging it first makes
`main` a chain that this container's 35 commits have never seen, and the next
rebase will look exactly like the PR #4 conflict did.

## Step 1 — get the work off this container first (do this today)

The five screens are unbacked-up. Apply this and push before anything else:

    cd <your repo>
    git checkout -b wip/platform-truth-2026-09-01     # if you do not have it
    git am --3way path\to\nexus-v1-part2.patch
    git push origin wip/platform-truth-2026-09-01

`nexus-v1-part2.patch` carries one commit (`cfa679a`) — the runnable quality
gate and J1's readiness report. It assumes `nexus-engines.patch` and
`nexus-v1.patch` are already applied. If `git am` says "patch does not apply",
that assumption is wrong: use the cumulative file instead —

    git am --3way path\to\nexus-cumulative-2026-09-03.patch

which carries all 35 commits from the last common point. `git am` skips
commits already present by patch-id, so applying it twice is safe.

## Step 2 — decide what PR #5 is for

PR #5 adds the Action Center and nothing else. The local chain already
contains an Action Center (`15e78d9`). Once step 1 is pushed, PR #5 is
redundant: **close it without merging** and open one PR from
`wip/platform-truth-2026-09-01` → `main` instead.

Only if you have work in PR #5 that is not in the local chain does it need
merging — and then it must be merged into the local branch first, resolved
there, and the result pushed as one PR.

## Step 3 — do not deploy yet

J1's verdict is **NOT_READY**. Blocking items, in order:

1. `WAHA_WEBHOOK_SECRET` is unset on the VM — the gate reports `mode:"DORMANT"`.
   Set it with `WAHA_WEBHOOK_ENFORCE=false`, watch for
   `mode=MONITOR, ok=true, header_present=true`, then flip to `true`.
2. All 11 n8n webhooks are `authentication: ABSENT`.
3. `whatsapp-send` hands the sole configured tenant to any signed-in user
   with no membership row. Fix before dealership two.
4. Quality gate is `PASS 26 · FAIL 2 · WARN 2 · NOT RUN 4`, exit 1. The four
   NOT RUN checks need a staging environment; L2 and L9 need your decision.

Nothing in this document changes production. It only gets the work out of a
container that can disappear.
