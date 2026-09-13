# Screens that are written but must not register yet

These are complete screen modules that the navigation does not offer, and that
is deliberate rather than an oversight. They live here instead of in `screens/`
because the quality gate's S1 check parses every file in `screens/` for a
`SCREENS.<id> =` assignment and fails when one registers an id the navigation
never offers. It is right to fail: a screen that registers but is unreachable is
dead code, and a screen that is reachable before its data exists is worse.

## `held-enquiries.js`

Reads `v_enquiry_held`, `v_enquiry_held_all` and `v_enquiry_classification_health`,
and calls `nexus_enquiry_promote_held`, `nexus_enquiry_dismiss_held` and
`nexus_enquiry_request_context`.

**None of those six objects exist.** The gate says so without hedging: they are
absent from the 2026-09-07 schema snapshot *and* no migration in
`supabase/migrations/` newer than that anchor creates them, so snapshot staleness
does not explain it. Registering this screen would put a navigation entry in front
of a dealership that returns an error on every panel.

It moves back to `screens/` in the same change that creates those views and
functions — not before, and not by adding a nav entry and hoping.

## `system-truth.js`

Renders the refusal ledger — SQLSTATE, constraint, the writer that raised it. Its
queries were not flagged by the gate's S3 check, so its relations are believed to
exist, but it is parked alongside its sibling for a different reason: it has never
been rendered against live data, and the screen's whole purpose is to be believed.
A screen about truth-telling is the last one that should ship unverified.

To bring it back: add its id to `lib/nav.js`, move the file to `screens/`, and let
the gate's R2 lane render it. If it renders real content with no page errors, it
belongs in the product.

## Why parked and not deleted

Both are working code and both answer a real question. Deleting them would mean
rewriting them later from a worse memory of what they were for. This folder is the
same idea as `ops/migrations-held/`: finished work whose preconditions have not
landed, kept where it can be found, and explicitly not pretending to be live.
