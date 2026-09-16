/* NEXUS OS — lib/setup.js
   Written 14 September 2026.

   ═══════════════════════════════════════════════════════════════════════════
   WHAT THIS ANSWERS
   ═══════════════════════════════════════════════════════════════════════════
   A dealership has just been created. Six things have to be true before NEXUS
   can do anything for them, and until 14 Sep 2026 nothing in this product said
   which of the six were done. The owner found out by clicking every screen and
   reading its empty state, which is the worst possible way to learn that a
   number is missing rather than nought.

   So: one reader, six steps, three words per step, and every word derived from
   a read that is named on the screen beside it.

       DONE        the read came back and the thing is there.
       INCOMPLETE  the read came back and the thing is NOT there. A finding.
       UNKNOWN     the read did not come back, or could not be made at all.

   ═══════════════════════════════════════════════════════════════════════════
   THE ONE RULE, AND IT IS THE SAME RULE THE REST OF THIS PRODUCT RUNS ON
   ═══════════════════════════════════════════════════════════════════════════
   UNKNOWN IS NOT INCOMPLETE AND IT IS CERTAINLY NOT DONE. A step nobody could
   measure is not a step that failed, and it is not a step that passed. The
   percentage counts DONE over six and nothing else, so an unmeasured step
   depresses the figure exactly as an unfinished one does — which is the right
   way round, because "we could not check" must never read as progress.

   lib/vocabulary.js already owns the three words a FIGURE may be labelled with
   (TILE_PROVENANCE / tileProvenance). They are a different vocabulary from the
   three above — one is about how a number was arrived at, the other about the
   state of a step — and the screen uses BOTH, each for its own job. Neither is
   re-implemented here.

   ═══════════════════════════════════════════════════════════════════════════
   WHY THE READS ARE HERE AND NOT IN THE SCREEN
   ═══════════════════════════════════════════════════════════════════════════
   Two surfaces ask this question: screens/setup.js renders all six, and
   screens/money-leaks.js renders a one-line banner when they are not all done.
   Two copies of "is WhatsApp connected" is two definitions of connected, and
   this codebase has already paid for that once — see the CONNECTION_STATE block
   in lib/vocabulary.js, written the day a green "Connected" pill turned out to
   be a fact about the provider rather than about the dealership.

   ═══════════════════════════════════════════════════════════════════════════
   WHAT EACH STEP IS READ FROM, VERBATIM
   ═══════════════════════════════════════════════════════════════════════════
     Dealership     lib/tenant.js, which holds the account's memberships and the
                    `tenants` row the database itself answers as.
     Team           rpc/nexus_team_roster — the roster the Team screen renders.
     Inventory      inventory, one indexed read.
     WhatsApp       rpc/nexus_meta_onboarding_status — the ONLY route to this
                    answer from a browser. `channel_registry` carries no grant
                    to a signed-in dashboard account at all, so there is no
                    second way to ask, and no way to infer it from anything
                    else. If the call is refused the step is UNKNOWN and says
                    so; it is never rendered as "not connected", which would be
                    a claim about the dealership made from a fact about our own
                    permissions.
     Test enquiry   journey_step, step = MESSAGE. The delivery record itself is
                    denied to every signed-in account by design (it holds raw
                    customer message text), so the journey step that is written
                    when one is recorded is the readable half. The screen says
                    that out loud rather than letting the reader assume the
                    stronger read happened.
     Go live        NOTHING. There is no billing table, no subscription table
                    and no trial table in this database. This step is therefore
                    PERMANENTLY UNKNOWN today and is reported as such, which
                    means at most five of the six can be confirmed. Inventing a
                    "live" flag out of the other five would be this file writing
                    a commercial fact it has no source for. */
import { db, onIdentityChange } from './data.js';
import { loadTenant } from './tenant.js';

/* Six, stated once, exported, and printed on the screen beside the figure. A
   denominator a reader cannot see is a percentage they cannot check. */
export const SETUP_DENOMINATOR = 6;

/* The three words, with the tone each paints in. `tone` is the app's existing
   vocabulary (lib/format.js TONE), so dsIntent() maps it without this file
   knowing anything about colour. */
export const SETUP_STATE = Object.freeze({
  DONE:       { label: 'Done',       tone: 'ok',
    blurb: 'The read named on this step came back and the thing it looks for is there.' },
  INCOMPLETE: { label: 'Not done',   tone: 'warm',
    blurb: 'The read named on this step came back and the thing it looks for is not there. This is a finding: '
         + 'somebody has to do something.' },
  UNKNOWN:    { label: 'Not known',  tone: 'unknown',
    blurb: 'This step could not be measured, so nothing is claimed in either direction. It is not being shown as '
         + 'done and it is not being shown as outstanding — an unread check is not a clear one.' },
});
export const setupState = v => SETUP_STATE[String(v || '').trim().toUpperCase()] || null;

const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));
const why = e => str(e && e.message) || 'no reason given';

/* Per-render memo, for the same reason screens/money-leaks.js holds one: the
   Setup screen and the Money Leaks banner can both ask within the same second,
   and a stale answer to "are you set up" is worse than a slow one. Cleared by
   resetSetupReads(), which both callers run at the top of a render. */
let INFLIGHT = null;
export const resetSetupReads = () => { INFLIGHT = null; };
/* And on a change of signed-in identity, belt and braces, for the reason
   lib/data.js records: this app re-authenticates without discarding the
   document, so a module that holds an answer across renders can hand the next
   person to sign in the previous dealership's. "Your setup is finished" is a
   particularly bad one to inherit. */
onIdentityChange(resetSetupReads);

/* ── The Meta credential kinds, and the fingerprint ─────────────────────────
   nexus_meta_onboarding_status() returns one row per registered number per
   credential kind, with `state` INSTALLED or MISSING and a `detail` sentence
   the database composes. When a credential IS installed the detail carries the
   installation stamp and the first eight characters of its fingerprint, and
   that fingerprint is the ONLY thing about a credential that exists to be
   shown: the secret itself is never returned by this function, is never in the
   bundle, and must never be on a screen.

   Parsed rather than re-derived because the detail is the database's own
   sentence and this file must not become a second author of it. If the shape
   ever changes the parse returns null and the screen shows the sentence
   itself, which is always true even when the extraction is not. */
const FINGERPRINT_RE = /fingerprint\s+([0-9a-z]{4,64})/i;
const INSTALLED_AT_RE = /installed\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/i;
const credentialFrom = row => {
  const detail = str(row.detail);
  const fp = FINGERPRINT_RE.exec(detail);
  const at = INSTALLED_AT_RE.exec(detail);
  return {
    kind: str(row.credential),
    state: up(row.state) === 'INSTALLED' ? 'INSTALLED' : up(row.state) === 'MISSING' ? 'MISSING' : 'UNSTATED',
    stateRaw: str(row.state),
    fingerprint: fp ? fp[1].slice(0, 8) : null,
    installedAt: at ? at[1] : null,
    detail,
  };
};

/* The dealership's word for each credential. The kind keys are the database's
   and are shown in mono beside the sentence, exactly as every other screen in
   this app shows the column a claim came from — the reader can check it. What
   they must not have to do is work out from the key alone what breaks without
   it, which is the whole of the sentence. */
export const META_CREDENTIAL = Object.freeze({
  meta_app_secret: {
    label: 'App secret',
    matters: 'Every message a customer sends arrives signed. Without this credential NEXUS cannot check that '
           + 'signature, so it refuses the message rather than trusting it — nothing from a customer gets through.' },
  meta_verify_token: {
    label: 'Verify token',
    matters: 'The word typed into Meta’s Verify Token box when the webhook was set up. It is checked once, on the '
           + 'handshake, and without a match Meta never delivers anything at all.' },
  meta_system_user_token: {
    label: 'System user token',
    matters: 'The permanent token that sends on the dealership’s own number. Without it NEXUS can receive and '
           + 'cannot reply.' },
});
export const metaCredential = kind => META_CREDENTIAL[String(kind || '').trim().toLowerCase()] || null;

/* ══════════════════════════════════════════════════════════════════════════
   The six steps
   ══════════════════════════════════════════════════════════════════════════
   Each builder returns one step object and nothing else decides a state. The
   shape is fixed so the screen cannot render a step that is missing its own
   account of itself:

     id        stable key
     title     the dealership's word for the step
     state     DONE | INCOMPLETE | UNKNOWN
     headline  one sentence, always, whatever the state
     missing   one sentence naming exactly what is absent. INCOMPLETE only.
     fix       { screen, label } when a screen in this build fixes it, or
               { outside, where } when it is done somewhere that is not NEXUS.
     evidence  [{ fact, source }] — the read behind the state, named.
   ══════════════════════════════════════════════════════════════════════════ */

function stepDealership(t) {
  const base = { id: 'dealership', title: 'Dealership', fix: { screen: 'settings', label: 'Open Settings' } };
  if (!t || !t.ok) {
    return { ...base, state: 'UNKNOWN',
      headline: 'Which dealership this account belongs to could not be read, so whether the dealership record exists '
              + 'is not known.',
      evidence: [{ fact: `The membership read failed: ${why({ message: t && t.error })}`, source: 'tenant_members, tenants' }] };
  }
  const a = t.active;
  if (!a) {
    return { ...base, state: 'INCOMPLETE',
      headline: 'This account is not attached to any dealership.',
      missing: 'There is no membership row joining this sign-in to a dealership, so every table in NEXUS reads back '
             + 'empty for it. Whoever set the account up has to attach it.',
      evidence: [{ fact: 'The membership read succeeded and returned no row', source: 'tenant_members' }] };
  }
  const name = str(a.name) || str(a.slug);
  const status = up(a.status);
  if (!name && !status) {
    return { ...base, state: 'UNKNOWN',
      headline: 'This account is attached to a dealership and the dealership’s own record could not be read, so '
              + 'nothing can be said about it.',
      evidence: [{ fact: 'A membership exists; the dealership row behind it did not come back', source: 'tenants' }] };
  }
  if (!name) {
    return { ...base, state: 'INCOMPLETE',
      headline: 'The dealership record exists and has no name.',
      missing: 'Nothing on any screen can name this dealership until a name is set on its record.',
      evidence: [{ fact: `Status is ${status || 'not recorded'}; no name and no short name`, source: 'tenants.name, tenants.slug' }] };
  }
  if (status && status !== 'ACTIVE') {
    return { ...base, state: 'INCOMPLETE',
      headline: `${name} exists and its record is marked ${status.toLowerCase()} rather than active.`,
      missing: 'A dealership that is not active is not a dealership NEXUS will work for. This is changed on the '
             + 'record itself, not from any screen in this build.',
      evidence: [{ fact: `tenants.status reads ${status}`, source: 'tenants.status' }] };
  }
  return { ...base, state: 'DONE',
    headline: `${name} exists${status ? ' and its record is active' : ''}, and it is the dealership every figure on `
            + 'every screen is scoped to.',
    evidence: [{ fact: `Name ${name}${status ? `, status ${status.toLowerCase()}` : ''}`, source: 'tenants' }] };
}

function stepTeam(r, tenantId) {
  const base = { id: 'team', title: 'Team', fix: { screen: 'team', label: 'Open Team' } };
  if (r.err) {
    return { ...base, state: 'UNKNOWN',
      headline: 'The staff list could not be read, so how many people this dealership has on NEXUS is not known.',
      evidence: [{ fact: `The read failed: ${why(r.err)}`, source: 'rpc/nexus_team_roster' }] };
  }
  const all = Array.isArray(r.v) ? r.v : [];
  /* Scoped to the dealership the database answers as, when that is known. The
     roster is a projection over this account's own memberships, so on a single
     membership the filter changes nothing — it is here for the account that has
     two, where an unfiltered count would report the other dealership's staff. */
  const rows = tenantId ? all.filter(x => String(x.tenant_id) === String(tenantId)) : all;
  const n = rows.length;
  /* THE RULE, STATED SO IT CANNOT BE MISTAKEN FOR A MEASUREMENT OF ANYTHING
     ELSE: more than one account means somebody has been added. One account is
     the person who set the dealership up, alone. This is a definition, not a
     finding, and the screen prints it next to the count. */
  if (n > 1) {
    return { ...base, state: 'DONE',
      headline: `${n} people have a NEXUS account at this dealership.`,
      evidence: [{ fact: `${n} accounts on the roster`, source: 'rpc/nexus_team_roster' }] };
  }
  return { ...base, state: 'INCOMPLETE',
    headline: n === 1
      ? 'One person has a NEXUS account at this dealership — whoever set it up.'
      : 'Nobody has a NEXUS account at this dealership.',
    missing: 'Nothing routes to a colleague who does not have an account: a hot lead has nobody to go to and no '
           + 'reply can be attributed to anybody. Counted as done at more than one account, because one account is '
           + 'the person who set the dealership up on their own.',
    evidence: [{ fact: `${n} ${n === 1 ? 'account' : 'accounts'} on the roster`, source: 'rpc/nexus_team_roster' }] };
}

function stepInventory(r) {
  const base = { id: 'inventory', title: 'Inventory', fix: { screen: 'inventory', label: 'Open Inventory' } };
  if (r.err) {
    return { ...base, state: 'UNKNOWN',
      headline: 'The stock list could not be read, so whether this dealership has any vehicles on NEXUS is not known.',
      evidence: [{ fact: `The read failed: ${why(r.err)}`, source: 'inventory' }] };
  }
  const rows = Array.isArray(r.v) ? r.v : [];
  if (!rows.length) {
    return { ...base, state: 'INCOMPLETE',
      headline: 'No vehicle is on file.',
      missing: 'Every margin figure, every ageing alert and every recommendation NEXUS makes is computed from the '
             + 'stock list. With none on file those screens are not empty of findings — they are empty of subjects.',
      evidence: [{ fact: 'The read succeeded and returned no row', source: 'inventory' }] };
  }
  const capped = rows.length >= 500;
  return { ...base, state: 'DONE',
    headline: `${capped ? '500 or more' : rows.length} ${rows.length === 1 ? 'vehicle is' : 'vehicles are'} on file.`,
    evidence: [{ fact: capped ? 'At least 500 rows; this read stops at 500' : `${rows.length} rows`, source: 'inventory' }] };
}

function stepWhatsApp(r, tenantId) {
  /* NOT a screen in this build, and saying so is half the value of the step.
     A dealership's WhatsApp is set up inside Meta — their Business account,
     their number, their app — and the three credentials it produces are
     installed by NEXUS. There is no form anywhere in this dashboard that does
     either half, so offering a button here would be the navigation lying. */
  const base = { id: 'whatsapp', title: 'WhatsApp', fix: { outside: true, where: 'Meta, with NEXUS support' } };
  if (r.err) {
    return { ...base, state: 'UNKNOWN', credentials: null,
      headline: 'Whether WhatsApp is connected could not be read from this dashboard, so nothing is claimed about it.',
      note: 'A signed-in dashboard account is not permitted to run this check or to read the messaging setup '
          + 'directly, and there is no other read anywhere in NEXUS that answers the question. That is a permission '
          + 'this installation has not granted — it is not evidence that WhatsApp is unconnected, and it is not '
          + 'evidence that it is connected.',
      evidence: [{ fact: `The check was refused: ${why(r.err)}`, source: 'rpc/nexus_meta_onboarding_status' }] };
  }
  if (!tenantId) {
    return { ...base, state: 'UNKNOWN', credentials: null,
      headline: 'The WhatsApp check answered and which of its rows belong to this dealership is not known, so '
              + 'nothing is claimed about it.',
      note: 'The check reports every number it can see with the dealership each one belongs to. Which dealership '
          + 'this account belongs to could not be read on this load, so the rows cannot be narrowed to it — and '
          + 'reading another dealership’s number as this one’s is the one mistake that must not be made here.',
      evidence: [{ fact: 'The check succeeded; the dealership to filter it by is unknown', source: 'rpc/nexus_meta_onboarding_status' }] };
  }
  const rows = (Array.isArray(r.v) ? r.v : []).filter(x => String(x.tenant_id) === String(tenantId));
  if (!rows.length) {
    return { ...base, state: 'INCOMPLETE', credentials: [],
      headline: 'No WhatsApp number is registered for this dealership.',
      missing: 'Until a number is registered and its three credentials are installed, nothing a customer sends on '
             + 'WhatsApp reaches NEXUS and nothing can be sent from it. The number and the credentials come from the '
             + 'dealership’s own Meta Business account; NEXUS installs them.',
      evidence: [{ fact: 'The check returned no active number for this dealership', source: 'rpc/nexus_meta_onboarding_status' }] };
  }
  /* One group per registered number, because the credentials belong to the
     number and not to the dealership: two numbers, one fully installed and one
     not, is a real state and a single merged list would hide it. */
  const byNumber = new Map();
  rows.forEach(row => {
    const id = str(row.phone_number_id) || 'unnamed number';
    if (!byNumber.has(id)) byNumber.set(id, []);
    byNumber.get(id).push(credentialFrom(row));
  });
  const numbers = [...byNumber.entries()].map(([phoneNumberId, credentials]) => ({
    phoneNumberId,
    credentials,
    missing: credentials.filter(c => c.state !== 'INSTALLED'),
  }));
  const complete = numbers.filter(nmb => nmb.credentials.length && !nmb.missing.length);
  if (complete.length) {
    return { ...base, state: 'DONE', numbers,
      headline: `${complete.length === numbers.length && numbers.length === 1
        ? 'The registered WhatsApp number has all of its credentials installed'
        : `${complete.length} of ${numbers.length} registered WhatsApp numbers have all of their credentials installed`}.`,
      evidence: [{ fact: `${numbers.length} active ${numbers.length === 1 ? 'number' : 'numbers'}, `
        + `${complete.length} fully installed`, source: 'rpc/nexus_meta_onboarding_status' }] };
  }
  const shortest = numbers.reduce((a, b) => (a.missing.length <= b.missing.length ? a : b));
  return { ...base, state: 'INCOMPLETE', numbers,
    headline: `A WhatsApp number is registered and ${shortest.missing.length === 1 ? 'one credential is' : `${shortest.missing.length} credentials are`} not installed.`,
    missing: `Not installed: ${shortest.missing.map(c => (metaCredential(c.kind) || {}).label || c.kind).join(', ')}. `
           + 'Each one is created in the dealership’s own Meta Business account and installed by NEXUS; nothing in '
           + 'this dashboard can install one.',
    evidence: [{ fact: `${numbers.length} active ${numbers.length === 1 ? 'number' : 'numbers'}, none with a full set `
      + 'of credentials', source: 'rpc/nexus_meta_onboarding_status' }] };
}

function stepTestEnquiry(r, tenantId) {
  const base = { id: 'testenquiry', title: 'Test enquiry', fix: { screen: 'conversations', label: 'Open Conversations' } };
  /* The sentence that must travel with this step in every state. The delivery
     record holds raw customer message text and is denied to every signed-in
     account, dashboards included; what a signed-in account CAN read is the
     journey step written the moment a message is recorded. That is a weaker
     read and the reader is told so rather than left to assume the stronger
     one happened. */
  const note = 'Read from the journey trail rather than from the delivery record itself: the delivery record holds '
             + 'what customers actually wrote and no signed-in account may read it, dashboards included. A journey '
             + 'step is written the moment a message is recorded, so its presence is evidence that one arrived — but '
             + 'it is the trail being read here, not the message.';
  if (!tenantId) {
    return { ...base, state: 'UNKNOWN', note,
      headline: 'Whether a message has ever arrived could not be checked, because which dealership to check for is '
              + 'not known.',
      evidence: [{ fact: 'No dealership to scope the read to; nothing was read', source: 'journey_step' }] };
  }
  if (r.err) {
    return { ...base, state: 'UNKNOWN', note,
      headline: 'Whether a message has ever arrived could not be read, so nothing is claimed about it.',
      evidence: [{ fact: `The read failed: ${why(r.err)}`, source: 'journey_step' }] };
  }
  const rows = Array.isArray(r.v) ? r.v : [];
  if (!rows.length) {
    return { ...base, state: 'INCOMPLETE', note,
      headline: 'No message has ever been recorded for this dealership.',
      missing: 'Nothing has come down the wire yet. Send one WhatsApp message to the dealership’s own number from '
             + 'a phone: if the setup is right it appears here within seconds, and if it does not, the credentials '
             + 'above are where it stopped.',
      evidence: [{ fact: 'The trail holds no message step for this dealership', source: 'journey_step, step = MESSAGE' }] };
  }
  const at = str(rows[0].at);
  return { ...base, state: 'DONE', note,
    headline: 'A message has been recorded, so the path from a customer’s phone into NEXUS works.',
    evidence: [{ fact: at ? `Most recent message step recorded ${at}` : 'A message step exists',
                 source: 'journey_step, step = MESSAGE' }] };
}

function stepGoLive() {
  /* PERMANENTLY UNKNOWN, and the only honest state available. There is no
     billing table, no subscription table and no trial table in this database:
     nothing records whether a dealership has been switched on commercially,
     when a trial started or whether one ended. The other five steps say
     nothing about it either — a dealership can be fully configured and not
     trading, and computing "live" from the five would be this file inventing a
     commercial fact and dressing it as a measurement.

     The consequence is stated on the screen rather than hidden here: at most
     five of the six steps can be confirmed today. */
  return {
    id: 'golive', title: 'Go live', state: 'UNKNOWN',
    fix: { outside: true, where: 'NEXUS support' },
    headline: 'Whether this dealership has gone live is recorded nowhere in this database, so it cannot be answered.',
    note: 'There is no billing, subscription or trial record of any kind here — not an empty one, none at all. '
        + 'Nothing says when a trial began, whether one ended, or whether anybody has switched this dealership on '
        + 'commercially. It is shown as not known rather than derived from the five steps above, because a '
        + 'dealership can be perfectly configured and not trading, and the two facts are not the same fact.',
    evidence: [{ fact: 'No table in this database answers this', source: 'nothing — there is no read to name' }],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   The reader
   ══════════════════════════════════════════════════════════════════════════
   Never rejects. Every read is settled, and a read that failed produces an
   UNKNOWN step carrying its own reason — which is the whole point: a screen
   that throws here would render "could not load setup", and the one thing an
   owner in the middle of setting up must not be told is nothing at all. */
export function readSetup() {
  if (INFLIGHT) return INFLIGHT;
  INFLIGHT = (async () => {
    const t = await loadTenant().catch(() => null);
    const tenantId = t && t.ok && t.active ? String(t.active.id || '') : '';

    const [roster, inv, meta, journey] = await Promise.all([
      settle(db('rpc/nexus_team_roster')),
      settle(db('inventory?select=id&limit=500')),
      settle(db('rpc/nexus_meta_onboarding_status')),
      /* NO tenant_id FILTER HERE, AND THAT IS THE FIX, NOT AN OMISSION.
         This read used to carry `tenant_id=eq.${tenantId}`, and the gate's
         check S4 exists to forbid exactly that: a filter the browser applies
         is a filter an operator can remove in devtools. Chasing why it was
         here found the real defect -- customer, conversation and journey_step
         were created by NX960 with row security OFF and `authenticated` able
         to SELECT, so one dealership could read another's customers and their
         whole evidence trail. NX982 closed all three. The scoping now happens
         where the tenant pill has always claimed it happens: in the database,
         which refuses the rows rather than the browser hiding them.
         tenantId is still read, because the steps below use it to say WHICH
         dealership is being set up -- labelling, not scoping. */
      settle(db('journey_step?select=id,at,status&step=eq.MESSAGE&order=id.desc&limit=1')),
    ]);

    const steps = [
      stepDealership(t),
      stepTeam(roster, tenantId),
      stepInventory(inv),
      stepWhatsApp(meta, tenantId),
      stepTestEnquiry(journey, tenantId),
      stepGoLive(),
    ];

    const done       = steps.filter(s => s.state === 'DONE').length;
    const incomplete = steps.filter(s => s.state === 'INCOMPLETE').length;
    const unknown    = steps.filter(s => s.state === 'UNKNOWN').length;
    /* Simply done over six. No weighting, no partial credit, no step counted
       twice — so a reader who counts the ticks on the screen gets the same
       number, which is the only test a percentage like this has to pass. */
    const pct = Math.round((done / SETUP_DENOMINATOR) * 100);

    return {
      steps, done, incomplete, unknown, pct,
      denominator: SETUP_DENOMINATOR,
      /* The banner's gate. Something was measured AND not everything is done.
         The first half matters: with every read failing, "setup is incomplete"
         would itself be a claim nothing supports — and an owner whose database
         is unreachable does not need a setup nag on top of it. */
      prompt: done + incomplete > 0 && done < SETUP_DENOMINATOR,
    };
  })();
  INFLIGHT.catch(() => { INFLIGHT = null; });
  return INFLIGHT;
}
