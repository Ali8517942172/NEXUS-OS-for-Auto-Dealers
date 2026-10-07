/* NEXUS OS — screens/channels.js
   CHANNELS. Every door a customer could come through, and which of the three
   different things that could be true of it is actually true today.

   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS SCREEN EXISTS
   ═══════════════════════════════════════════════════════════════════════════
   The back end for the lead channels has been built for months. There has never
   been a front end for any of it — least of all for WhatsApp Business Cloud,
   which is the one channel that has actually carried a real customer into this
   database. Until this screen, the only way to find that out was to read SQL.

   The whole screen turns on one distinction that the product kept collapsing,
   and collapsing it is how a dashboard tells a dealership it is covered when it
   is not. There are THREE different sentences here, not one:

     REGISTERED  — somebody wrote down where this channel would arrive. An
                   endpoint exists. It is switched OFF. A delivery today would
                   be refused at the door. This is paperwork, not a connection.

     CONNECTED   — the endpoint exists and is switched on. A delivery today
                   would be accepted. Nothing says one has ever been made, and
                   for some channels (a phone call, a walk-in) nothing ever
                   will be on its own, because a person types those in and there
                   is no wire to fire.

     RECEIVING   — something actually arrived and this database recorded it,
                   with a time on it and a statement of how the origin was
                   attested. This is the only column that has ever carried a
                   real customer.

   And a fourth, which is not a lesser version of the others:

     NOT_BUILT   — no endpoint is registered for this dealership at all. Nothing
                   to switch on. A zero here is not a quiet week.

   Rendering REGISTERED and RECEIVING with the same green tick is not a cosmetic
   defect. It is the dashboard stating that a switched-off webhook is a working
   lead channel, which is the single most expensive false statement this product
   could make: a dealership reading it would stop checking, and the enquiries
   would go on being refused at a door nobody opened.

   So: the state is never averaged, never rolled up into a health score, never
   reduced to a percentage, and never rendered as a two-way on/off. Four states,
   four tones, four separate counts, and the word itself shown verbatim.

   ═══════════════════════════════════════════════════════════════════════════
   WHERE THE ANSWER COMES FROM
   ═══════════════════════════════════════════════════════════════════════════
   `public.nexus_channel_status()` — one SECURITY DEFINER accessor, scoped to
   the caller's own dealership(s) by `nexus_current_tenant_ids()`, EXECUTE
   granted to `authenticated` so the browser can call it as the signed-in user.
   It returns `state` and `evidence` ALREADY COMPUTED. That matters: this file
   infers nothing. There is no column on this page from which a screen could
   derive a connection, and therefore no way for a later edit to quietly start
   deriving one wrongly. If the database's account of a channel changes, this
   screen changes with it and no code here has to be found and corrected.

   `received_count` counts what reached THIS DATABASE. It is not a count of what
   a customer sent. The two are the same number only when nothing was dropped
   between the customer and here, and nothing in this database can see that gap.
   The last panel says so out loud rather than leaving it implied.

   Nothing here filters by dealership. The database refuses another
   dealership's rows; this file does not hide them. */

import { db, dbWrite, n8n, HOOK, onIdentityChange, canManageAccess } from '../lib/data.js';
import { ago, dubaiDate, dubaiStamp, esc, n0 } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { $, el } from '../lib/dom.js';
import { closeDrawer } from '../lib/ui.js';
/* The Stitch migration (7 Oct 2026, design/stitch/MAP.md: primary
   channels-readiness-status-engine--54b35c, also --dec649). kpi, table, panel,
   pill, the state panels and openModal keep their signatures and answer in the
   Stitch anatomy — lib/ops-kit.js says why the logic was left where it was. */
import {
  actor, B, C, DRAWER, banner, bold, chip, hot, kpi, modalError, muted, openDrawer, openModal, panel, pill,
  readinessChecklist, readinessVerdict, stateEmpty, stateError, stateLoading, table, warm, wrap,
} from '../lib/ops-kit.js';
import { sectionHeader, statusChip, trustFooter } from '../lib/stitch-ui.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const plural = (c, one, many) => (Number(c) === 1 ? one : many);

/* Counts are small integers straight out of a bigint column. A null is not a
   zero and is never printed as one — "no figure was returned" and "nothing
   arrived" are different facts and only the second is a finding. */
const count = v => { const x = n0(v); return x == null ? '—' : String(x); };

/* ── The four states, and nothing else ────────────────────────────────────
   The order is the order of the argument: what is actually receiving, then what
   would accept a delivery, then what would refuse one, then what does not exist.
   A state this file has never heard of sorts last and is rendered `unknown`
   rather than being guessed into one of the four — a new state invented in the
   database must show up here as unrecognised, not as a silent promotion. */
const STATE = {
  RECEIVING:  { rank: 0, tone: 'ok' },
  CONNECTED:  { rank: 1, tone: 'warm' },
  REGISTERED: { rank: 2, tone: 'cold' },
  NOT_BUILT:  { rank: 3, tone: 'unknown' },
};
const stateOf = row => STATE[up(row && row.state)] || { rank: 4, tone: 'unknown' };
const isState = (rows, key) => (rows || []).filter(r => up(r.state) === key);

const WHATSAPP_CLOUD = 'whatsapp_cloud';

/* ── The memo is per RENDER, not per page load ─────────────────────────────
   Four panels share one read. Module state survives the re-auth path, which
   does not reload the page — so a memo that is never cleared would show a
   second dealership signing in on the same machine the FIRST one's channels,
   under a caption saying they had just been read. resetReads() therefore runs
   at the top of the mount function AND on every identity change. The two events
   are not the same and only one of them is under this file's control, which is
   why both are wired. screens/lead-sources.js carries the full account. */
const MEMOS = new Set();
const shared = make => {
  let p = null;
  const f = () => {
    if (!p) { p = make(); p.catch(() => { p = null; }); }
    return p;
  };
  MEMOS.add(() => { p = null; });
  return f;
};
const resetReads = () => { MEMOS.forEach(reset => reset()); };
onIdentityChange(resetReads);
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));

const linkBtn = (id, label) => (SCREENS[id]
  ? `<button class="${B.secondary}" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="${B.ghost}" disabled title="${esc(label)} is not part of this build: the navigation offers the screen and no module in this bundle registers it.">${esc(label)} — not in this build</button>`);
const wireGo = card => {
  card.querySelectorAll('[data-go]').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => go(b.dataset.go));
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   The read
   ══════════════════════════════════════════════════════════════════════════
   One accessor, no arguments, no cap. The register of channels is a short list
   by construction — it is the set of doors that exist, not the traffic through
   them — so there is no window here and no count on this screen is a floor. */
const readChannels = shared(() => db('rpc/nexus_channel_status'));

/* A read that failed says where the figure would have been. Never a bare dash:
   a dash beside "Channels receiving" reads as zero, and zero is a finding this
   screen makes on purpose and must be able to make credibly. */
const readFailed = err =>
  hot('The channel register could not be read ('
    + esc(str(err && err.message) || 'no reason given')
    + '), so nothing is claimed here and nothing is ruled out. An unread check is not a clear one.');

/* Sort: by state, then most recent arrival first within a state. A channel that
   received something an hour ago and one that received something in March are
   both RECEIVING, and the order is the only thing on the table that says which
   is which. Channels with no arrival at all sort after those that have one. */
const orderRows = rows => (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
  const ra = stateOf(a).rank, rb = stateOf(b).rank;
  if (ra !== rb) return ra - rb;
  const ta = Date.parse(a.last_received_at || 0) || 0;
  const tb = Date.parse(b.last_received_at || 0) || 0;
  if (ta !== tb) return tb - ta;
  return str(a.display_name).localeCompare(str(b.display_name));
});

/* ══════════════════════════════════════════════════════════════════════════
   The readiness drawer — channels-readiness-status-engine--54b35c
   ══════════════════════════════════════════════════════════════════════════
   Five gates, each PASSED / FAILED / NOT TESTED from a fact the register or the
   owner's WhatsApp Cloud registry holds. Nothing here is computed beyond reading
   those facts: `registered`, `connected`, `received_count`, `origin_attested`
   from nexus_channel_status(), and the WhatsApp Cloud number's own status from
   nexus_channel_registry_for_owner() (ACTIVE is set on the server only after
   Meta accepted a real test send — see P1.5). One NOT TESTED keeps the verdict
   at PARTIAL; configuration alone never passes a gate that asks whether
   something works. */
const readOwnerRegistry = shared(() => db('rpc/nexus_channel_registry_for_owner'));

const CHANNEL_ICON = {
  whatsapp_cloud: 'chat', whatsapp: 'chat', walk_in: 'storefront', phone_call: 'phone_in_talk', sms: 'sms',
  email: 'mail', website_form: 'language', meta_lead_ads_facebook: 'campaign', meta_lead_ads_instagram: 'photo_camera',
  google_ads_lead_form: 'ads_click',
};
const channelIcon = r => CHANNEL_ICON[str(r && r.channel_key)] || 'hub';
/* A channel a person types in has no wire, so a webhook gate does not apply to
   it. The register says so through its family or plane; nothing else is read. */
const isManualChannel = r => /manual|floor|walk|phone_call/i.test(`${str(r.family)} ${str(r.plane)} ${str(r.channel_key)}`);

function channelGates(r, cloud, regErr) {
  const c = n0(r.received_count) || 0;
  const isCloud = str(r.channel_key) === WHATSAPP_CLOUD;
  const numbers = isCloud && Array.isArray(cloud) ? cloud : [];
  const active = numbers.filter(x => up(x.status) === 'ACTIVE');
  const gates = [];

  if (str(r.origin_attested) && c) {
    gates.push({ gate: 'Authentication', state: 'passed', detail: esc(`${count(c)} ${plural(c, 'arrival was', 'arrivals were')} attested: ${str(r.origin_attested)}.`) });
  } else if (active.length) {
    gates.push({ gate: 'Authentication', state: 'passed', detail: esc('Meta accepted a test send made with the stored token, so the token works.') });
  } else {
    gates.push({ gate: 'Authentication', state: 'not-tested', detail: esc('Nothing has arrived or been sent through this channel, so no credential has been exercised.') });
  }

  if (r.registered === true) {
    gates.push({ gate: 'Dealership mapping', state: 'passed', detail: esc(str(r.registered_detail) || 'An endpoint is registered to this dealership.') });
  } else {
    gates.push({ gate: 'Dealership mapping', state: 'not-tested', detail: esc(r.registered === false
      ? 'No endpoint is registered for this dealership, so there is nothing to map yet.'
      : 'Nothing is recorded about whether an endpoint exists for this channel.') });
  }

  if (isManualChannel(r)) {
    gates.push({ gate: 'Webhook', state: 'n/a', detail: esc('No webhook by design: a person records these, so there is no wire to fire.') });
  } else if (r.connected === false) {
    gates.push({ gate: 'Webhook', state: 'failed', detail: esc(str(r.connected_detail) || 'Switched off — a delivery today would be refused at the door.') });
  } else if (r.connected === true && c) {
    gates.push({ gate: 'Webhook', state: 'passed', detail: esc(`Switched on, and it accepted ${count(c)} ${plural(c, 'delivery', 'deliveries')}.`) });
  } else if (r.connected === true) {
    gates.push({ gate: 'Webhook', state: 'not-tested', detail: esc('Switched on, so a delivery would be accepted — but none has been made, so it is not proven.') });
  } else {
    gates.push({ gate: 'Webhook', state: 'not-tested', detail: esc('Nothing is recorded about whether this channel would accept a delivery today.') });
  }

  gates.push(c
    ? { gate: 'Inbound test', state: 'passed', detail: esc(`${count(c)} ${plural(c, 'arrival', 'arrivals')} reached this database${r.last_received_at ? `, the newest ${ago(r.last_received_at)}` : ''}.`) }
    : { gate: 'Inbound test', state: 'not-tested', detail: esc('Nothing has arrived through this channel that this database recorded.') });

  if (isCloud && regErr) {
    gates.push({ gate: 'Outbound test', state: 'not-tested', detail: esc('The WhatsApp Cloud number register could not be read, so whether a test send succeeded is unknown.') });
  } else if (active.length) {
    gates.push({ gate: 'Outbound test', state: 'passed', detail: esc(`${count(active.length)} ${plural(active.length, 'number is', 'numbers are')} ACTIVE — set on the server only after Meta accepted a real test send.`) });
  } else if (numbers.length) {
    gates.push({ gate: 'Outbound test', state: 'not-tested', detail: esc('A number is connected and still PENDING_VERIFY: no test send has succeeded. Use “Send test message”.') });
  } else {
    gates.push({ gate: 'Outbound test', state: 'not-tested', detail: esc('NEXUS records no outbound test for this channel.') });
  }
  return gates;
}

function openChannelDrawer(r, cloud, regErr) {
  const gates = channelGates(r, cloud, regErr);
  const s = stateOf(r);
  const metric = (k, v, sub) => `<div class="p-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest">
      <div class="${C.caps}">${esc(k)}</div><div class="font-label-numeric-md text-label-numeric-md font-bold text-on-surface mt-1">${v}</div>
      ${sub ? `<div class="font-body-sm text-body-sm text-on-surface-variant">${sub}</div>` : ''}</div>`;
  const isCloud = str(r.channel_key) === WHATSAPP_CLOUD;
  const pending = isCloud && Array.isArray(cloud) ? cloud.filter(x => up(x.status) === 'PENDING') : [];
  openDrawer(`<div class="${DRAWER.head}">
      <div class="flex items-start gap-3 min-w-0">
        <span class="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined">${esc(channelIcon(r))}</span></span>
        <div class="min-w-0"><div class="flex items-center gap-2 flex-wrap"><h2 class="font-headline-md text-headline-md font-bold text-on-surface">${esc(str(r.display_name) || str(r.channel_key))}</h2>${pill(str(r.state) || 'NO STATE RECORDED', s.tone)}</div>
          <div class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(str(r.channel_key))}${str(r.family) ? ` · ${esc(str(r.family))}` : ''}</div></div>
      </div>
      <button type="button" aria-label="Close" data-ch-close class="${B.icon}"><span class="material-symbols-outlined text-[20px]">close</span></button>
    </div>
    <div class="${DRAWER.body}">
      ${readinessChecklist(gates)}
      <div class="mt-space-md"><div class="${C.caps} mb-2">Recorded so far</div>
        <div class="grid grid-cols-2 gap-2">
          ${metric('Newest arrival', r.last_received_at ? esc(ago(r.last_received_at)) : '—', r.last_received_at ? esc(dubaiStamp(r.last_received_at)) : 'Nothing recorded')}
          ${metric('Arrivals recorded', esc(count(r.received_count)), 'What reached this database, not what a customer sent')}
        </div></div>
      <div class="mt-space-md"><div class="${C.caps} mb-2">What the register says</div>
        ${muted(esc(str(r.evidence) || 'The database recorded no explanation for this channel’s state.'))}</div>
    </div>
    <div class="${DRAWER.foot}">
      ${pending.length ? `<button class="${B.primary}" data-ch-test><span class="material-symbols-outlined text-[18px]">send</span>Send test message</button>` : ''}
      ${SCREENS.conversations ? `<button class="${B.secondary}" data-ch-go="conversations">Open Conversations</button>` : ''}
    </div>`);
  const d = document.getElementById('drawer');
  if (!d) return;
  d.querySelector('[data-ch-close]')?.addEventListener('click', closeDrawer);
  d.querySelector('[data-ch-go]')?.addEventListener('click', () => { closeDrawer(); go('conversations'); });
  /* The test send itself lives in the WhatsApp Cloud card; the drawer takes the
     operator there rather than carrying a second copy of that flow. */
  d.querySelector('[data-ch-test]')?.addEventListener('click', () => {
    closeDrawer();
    const btn = document.querySelector('#cwCard [data-test]');
    if (btn) btn.click(); else document.getElementById('cwCard')?.scrollIntoView({ behavior: 'smooth' });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.channels = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js, screens/conversations.js and screens/setup.js. */
  /* Since 7 Oct 2026 the wrapper is the Stitch root (`nx-stitch` turns on the
     scoped reset), still a wrapper this screen appends for the reason above. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);
  /* The page order is the Stitch order — c3ca1e's header, state tiles and
     touchpoint register, then --dec649's WhatsApp Cloud card, number setup,
     templates, usage and limits — with one slot per region so the panels can
     stay declared in the order they always were. */
  const slot = () => { const d = el('div', 'flex flex-col gap-space-md'); root.appendChild(d); return d; };
  const headSlot = slot(), kpiSlot = slot(), regSlot = slot(), waSlot = slot(), cloudSlot = slot(), restSlot = slot(), footSlot = slot();
  headSlot.innerHTML = sectionHeader({
    eyebrow: 'Operations / Channels',
    title: 'Channels — readiness & customer touchpoints',
    sub: 'Every door a customer could come through, and which of registered, switched on or actually receiving is true '
       + 'of it today. Inspect a channel for its five-gate readiness check.',
    actionsHtml: linkBtn('leadsources', 'Lead Sources') + linkBtn('conversations', 'Conversations')
      + (canManageAccess() ? `<button class="${B.primary}" data-cw-jump><span class="material-symbols-outlined text-[18px]">add_circle</span>Add channel</button>` : ''),
  });
  wireGo(headSlot);
  headSlot.querySelector('[data-cw-jump]')?.addEventListener('click', () => document.getElementById('cwCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  /* Every visit re-reads. See the note on `shared` above for what this repairs
     and why a stale channel register is worse than a slow one. */
  resetReads();

  /* Throws on failure, so the three panels that report on channels get the
     standard unread card rather than inventing an empty list. */
  const load = () => readChannels();

  /* The same read, and this one never throws. It is for the last panel, whose
     entire job is to state what this screen cannot tell you: handing it a
     "couldn't load" card would silence the one panel that is still true when
     the read fails. */
  const loadSoft = () => settle(readChannels());

  /* ────────────────────────────────────────────────────────────────────────
     P1 · The answer, in four numbers
     ──────────────────────────────────────────────────────────────────────── */
  panel(kpiSlot, {
    title: 'Every channel, counted by what is actually true of it', icon: 'sensors',
    sub: 'Four separate figures, never added together and never rolled into a score. A channel that is switched off '
       + 'and a channel that is carrying customers are opposite facts, and only one of these four columns has ever '
       + 'carried a real one',
    actions: linkBtn('leadsources', 'Open Lead Sources') + ' ' + linkBtn('conversations', 'Open Conversations'),
    load,
    render: rows => {
      const all = Array.isArray(rows) ? rows : [];
      const receiving = isState(all, 'RECEIVING');
      const connected = isState(all, 'CONNECTED');
      const registered = isState(all, 'REGISTERED');
      const notBuilt = isState(all, 'NOT_BUILT');
      const unrecognised = all.filter(r => !STATE[up(r.state)]);

      const arrivals = receiving.reduce((s, r) => s + (n0(r.received_count) || 0), 0);

      const receivingTile = kpi('Receiving', count(receiving.length),
        muted(receiving.length
          ? `Something arrived through ${plural(receiving.length, 'this channel', 'these channels')} and this database `
            + `recorded it — ${esc(count(arrivals))} ${plural(arrivals, 'arrival', 'arrivals')} in total, each with a `
            + 'time on it and a statement of how its origin was attested. This is the only figure on the screen that '
            + 'describes a real customer.'
          : 'Nothing has arrived through any channel that this database recorded. That is not a statement that no '
            + 'customer tried — only that nothing reached here.'),
        receiving.length ? 't-ok' : 't-hot');

      const connectedTile = kpi('Connected, and silent', count(connected.length),
        muted(connected.length
          ? `Switched on, so a delivery today would be accepted, and nothing has ever come through `
            + `${plural(connected.length, 'it', 'them')}. Some of these have no wire to fire at all — a person types `
            + 'them in — so waiting for one to start receiving on its own would be waiting forever. The reason is on '
            + 'each row below.'
          : 'No channel is switched on and silent. Every channel is either carrying something or is not switched on '
            + 'at all.'),
        connected.length ? 't-warm' : '');

      const registeredTile = kpi('Registered, switched off', count(registered.length),
        muted(registered.length
          ? `An endpoint exists for ${plural(registered.length, 'this channel', 'these channels')} and it is disabled. `
            + 'A delivery today would be refused at the door. This is paperwork, not a connection, and it is the one '
            + 'state most easily mistaken for being live.'
          : 'No channel is registered and switched off, so nothing would be refused at the door today.'),
        registered.length ? 't-hot' : '');

      const notBuiltTile = kpi('Not built', count(notBuilt.length),
        muted(notBuilt.length
          ? `No endpoint is registered for ${plural(notBuilt.length, 'this channel', 'these channels')} at this `
            + 'dealership, so there is nothing to switch on and nothing to wait for. A zero against one of these is '
            + 'not a quiet week — it is a channel that does not exist yet.'
          : 'Every channel in the register has at least an endpoint recorded against this dealership.'));

      const odd = unrecognised.length
        ? `<div class="mt-space-md">${banner('hot', 'report', `${bold('Some channels came back in a state this screen does not recognise.')}
               ${muted(esc(count(unrecognised.length)) + ' of ' + esc(count(all.length))
                 + ` ${plural(all.length, 'entry', 'entries')} carries a state that is none of the four this screen `
                 + 'knows how to read. They are listed below at face value and are counted in none of the four figures '
                 + 'above. They are reported rather than dropped: a channel nobody can account for is exactly the one '
                 + 'worth naming.')}`)}</div>`
        : '';

      const rule = `<div class="mt-space-md">${banner('info', 'info', `${bold('Registered, connected and receiving are three different things.')}
            ${muted('Registered means somebody wrote down where a delivery would arrive and then switched it off, so a '
              + 'delivery today would be refused. Connected means it would be accepted. Receiving means something '
              + 'actually arrived and this database recorded it — and only that first column has ever carried a real '
              + 'customer.')}`)}</div>`;

      return `<div class="${C.grid4}">${receivingTile}${connectedTile}${registeredTile}${notBuiltTile}</div>` + odd + rule;
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P1.5 · Connect / verify this dealership's own WhatsApp Cloud number
     ─────────────────────────────────────────────────────────────────────
     NX1007 (21 Sep 2026). Everything above this panel READS the channel
     register. This is the one place on the whole screen that WRITES to it —
     the owner-facing path onto `channel_registry` that did not exist before:
     the only prior way to add a row was a manual SQL INSERT run by an
     operator.

     Two separate actions, two separate authorities, and this panel keeps them
     apart rather than collapsing "connect" and "go live" into one click:

       CONNECT   `nexus_channel_register_cloud_number` (owner/admin only).
                 Stores the access token in Vault — never in a column this
                 browser could read back — and leaves the channel
                 PENDING_VERIFY. Claiming a number is not the same fact as the
                 number working, and this screen does not conflate them.

       VERIFY    "Send test message" calls the `channel-test-send` n8n
                 webhook, which sends one real WhatsApp message through the
                 Graph API and only THEN calls `nexus_channel_mark_active` —
                 server-side, after a real provider accept, never on this
                 browser's say-so. A channel nobody has tested stays
                 PENDING_VERIFY indefinitely, which is the correct state for
                 an unverified claim. */
  {
    const card = el('section', C.card);
    card.id = 'cwCard';
    cloudSlot.appendChild(card);
    let rows = null;
    let loadErr = null;

    const canConnect = canManageAccess();
    const cwHead = actionsHtml => `<div class="${C.head}">
        <div class="flex items-start gap-2.5 min-w-0 flex-1"><span class="material-symbols-outlined text-primary text-xl mt-0.5">chat</span>
          <div class="min-w-0"><h2 class="${C.title}">Connect a WhatsApp Cloud number</h2>
            <p class="${C.sub}">Owner/admin only. The access token is stored in Vault and this screen never reads it back —
            only a fingerprint the database already printed to the audit log. “Send test message” is the only way a number
            becomes ACTIVE, and it is decided on the server after Meta accepts a real send.</p></div></div>
        ${actionsHtml ? `<div class="flex items-center gap-space-sm shrink-0">${actionsHtml}</div>` : ''}</div>`;
    /* The test send calls the channel-test-send automation. When that automation
       is not switched on, the webhook answers 404 and NOTHING was sent — Meta was
       not contacted and the channel did not fail a test, it was never given one.
       Said in those words, because "WhatsApp rejected it" would be false. */
    const testSendFailed = (m, e) => {
      const status = e && e.status;
      const line = status === 404
        ? 'The test-send automation is not switched on, so no message was sent and Meta was not contacted. '
          + 'The channel stays PENDING_VERIFY — it has not failed a test, it has not been given one.'
        : `${esc((e && e.message) || 'The test could not be sent.')} No message is known to have been sent; the channel stays PENDING_VERIFY.`;
      m.msg(`<span class="${C.hot}">${line}</span>`);
    };

    const rowActions = r => {
      const s = up(r.status);
      if (s === 'ACTIVE') return muted('Verified and sending from this number.');
      if (s !== 'PENDING') return muted(`Status is ${esc(str(r.status) || 'unknown')}.`);
      return `<button class="${B.primary}" data-test="${esc(r.integration_id)}"><span class="material-symbols-outlined text-[18px]">send</span>Send test message</button>`;
    };

    const paint = () => {
      if (loadErr) {
        card.innerHTML = cwHead('')
          + `<div class="${C.body}">${stateError('this dealership’s WhatsApp Cloud channels', loadErr, null,
              'Connecting a new number is disabled until this can be read.')}</div>`;
        return;
      }
      const list = Array.isArray(rows) ? rows : [];
      const body = list.length
        ? table([
            { label: 'Number', strong: true, render: r => wrap(bold(esc(str(r.display_number) || 'No display name given'))
                + muted(`phone_number_id ${esc(str(r.external_identifier))}`)) },
            { label: 'WABA id', render: r => wrap(str(r.waba_id) ? esc(str(r.waba_id)) : muted('Not recorded')) },
            { label: 'Status', render: r => pill(up(r.status) === 'ACTIVE' ? 'ACTIVE' : up(r.status) === 'PENDING' ? 'PENDING_VERIFY' : (str(r.status) || 'UNKNOWN'),
                up(r.status) === 'ACTIVE' ? 'ok' : up(r.status) === 'PENDING' ? 'warm' : 'cold') },
            { label: '', align: 'r', render: rowActions },
          ], list)
        : stateEmpty('No WhatsApp Cloud number is connected for this dealership yet',
            'Use “Connect WhatsApp Cloud number” below to register one. It starts PENDING_VERIFY — nothing sends '
            + 'from it until a test message actually goes through Meta’s API.', 'link_off');

      card.innerHTML = cwHead(`<button class="${B.secondary}" id="cwConnect"${canConnect ? '' : ' disabled title="Connecting a WhatsApp Cloud number is an owner/admin decision at this dealership."'}><span class="material-symbols-outlined text-[18px]">add_link</span>Connect WhatsApp Cloud number</button>`)
        + `<div class="${C.body}">${body}</div>`;

      card.querySelector('#cwConnect')?.addEventListener('click', openConnectModal);
      card.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', () => openTestModal(b.dataset.test)));
    };

    const reload = async () => {
      card.innerHTML = cwHead('') + `<div class="${C.body}">${stateLoading(2)}</div>`;
      try { rows = await db('rpc/nexus_channel_registry_for_owner'); loadErr = null; }
      catch (e) { rows = null; loadErr = e; }
      paint();
    };

    const openConnectModal = () => {
      const m = openModal('Connect WhatsApp Cloud number', `
        <div class="${C.hint} mb-3">These come from your own Meta Business Manager — WhatsApp
          Business API settings for the app you registered. NEXUS never holds a WhatsApp asset of its own; every
          dealership brings its own number.</div>
        <div class="${C.field}"><label class="${C.label}" for="cwDisplay">Display number (optional)</label>
          <input class="${C.input}" id="cwDisplay" placeholder="+971 4 xxx xxxx" /></div>
        <div class="${C.field}"><label class="${C.label}" for="cwPnid">Phone number ID</label>
          <input class="${C.input}" id="cwPnid" placeholder="1306545252542419" />
          <div class="${C.hint}">The numeric id from WhatsApp Business API settings — not the phone number itself.</div></div>
        <div class="${C.field}"><label class="${C.label}" for="cwWaba">WABA id (optional)</label>
          <input class="${C.input}" id="cwWaba" placeholder="Numeric WhatsApp Business Account id" /></div>
        <div class="${C.field}"><label class="${C.label}" for="cwToken">System user access token</label>
          <textarea class="${C.input}" id="cwToken" rows="3" placeholder="Scope: whatsapp_business_messaging"></textarea>
          <div class="${C.hint}">Stored in Vault. This screen will never display it again — only a short fingerprint
            so you can confirm which token is installed.</div></div>`,
        `<button class="${B.secondary}" id="cwCancel">Cancel</button><button class="${B.primary}" id="cwSave"><span class="material-symbols-outlined text-[18px]">link</span>Connect</button>`);
      m.wrap.querySelector('#cwCancel').addEventListener('click', m.close);
      m.wrap.querySelector('#cwSave').addEventListener('click', async () => {
        const display = $('cwDisplay').value.trim();
        const pnid = $('cwPnid').value.trim();
        const waba = $('cwWaba').value.trim();
        const token = $('cwToken').value.trim();
        if (!pnid) return m.msg(`<span class="${C.hot}">Phone number ID is required.</span>`);
        if (!token || token.length < 8) return m.msg(`<span class="${C.hot}">A real access token is required — that is too short to be one.</span>`);
        const btn = m.wrap.querySelector('#cwSave');
        btn.disabled = true; btn.textContent = 'Connecting…';
        try {
          const res = await dbWrite('POST', 'rpc/nexus_channel_register_cloud_number', {
            p_display_number: display || null, p_phone_number_id: pnid,
            p_waba_id: waba || null, p_access_token: token,
          });
          const row = Array.isArray(res) ? res[0] : res;
          m.msg(`<span class="${C.ok}">Connected — status PENDING_VERIFY. Token fingerprint ${esc(str(row && row.fingerprint))}. `
            + 'Click “Send test message” below once this closes to go live.</span>');
          setTimeout(() => { m.close(); reload(); }, 1400);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Connect';
          modalError(m, e);
        }
      });
    };

    const openTestModal = integrationId => {
      const m = openModal('Send a test message', `
        <div class="${C.hint} mb-3">One real WhatsApp message is sent through Meta’s API to the
          number below. If it is accepted, this channel is marked ACTIVE immediately — that happens on the server,
          only after a real send succeeds, never on this form alone.</div>
        <div class="${C.field}"><label class="${C.label}" for="cwRecipient">Send the test to (WhatsApp number)</label>
          <input class="${C.input}" id="cwRecipient" placeholder="9715xxxxxxxx" /></div>`,
        `<button class="${B.secondary}" id="cwTestCancel">Cancel</button><button class="${B.primary}" id="cwSend"><span class="material-symbols-outlined text-[18px]">send</span>Send test message</button>`);
      m.wrap.querySelector('#cwTestCancel').addEventListener('click', m.close);
      m.wrap.querySelector('#cwSend').addEventListener('click', async () => {
        const recipient = $('cwRecipient').value.replace(/[^0-9]/g, '');
        if (recipient.length < 8) return m.msg(`<span class="${C.hot}">A WhatsApp number to send the test to is required.</span>`);
        const btn = m.wrap.querySelector('#cwSend');
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const res = await n8n(HOOK.channelTestSend, { integration_id: integrationId, recipient_phone: recipient });
          if (res && res.status === 'active') {
            m.msg(`<span class="${C.ok}">${esc(str(res.message) || 'Accepted — the channel is now ACTIVE.')}</span>`);
            setTimeout(() => { m.close(); reload(); }, 1400);
          } else {
            m.msg(`<span class="${C.hot}">${esc(str(res && res.error) || 'WhatsApp did not accept the test message. The channel stays PENDING_VERIFY.')}</span>`);
            btn.disabled = false; btn.textContent = 'Send test message';
          }
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Send test message';
          testSendFailed(m, e);
        }
      });
    };

    reload();
  }


  /* ────────────────────────────────────────────────────────────────────────
     P2 · The register itself
     ──────────────────────────────────────────────────────────────────────── */
  panel(regSlot, {
    title: 'Configured touchpoints — every channel, and what is actually true of it', icon: 'router',
    sub: 'Receiving first, then switched on, then switched off, then not built. Within a state, the most recent '
       + 'arrival first. Every line carries the database’s own account of why it is in the state it is in',
    load: async () => {
      const rows = await readChannels();
      const reg = await settle(readOwnerRegistry());
      return { rows, reg };
    },
    render: ({ rows, reg }, card) => {
      const ordered = orderRows(rows);
      if (!ordered.length) {
        return stateEmpty('No channel is registered for this dealership at all',
          'The register returned nothing. That is not a failure and it is not an all-clear either: it means there is '
          + 'no door on record for this dealership, so there is nothing that could be receiving and nothing that could '
          + 'be switched off. Nothing is being ruled out about enquiries arriving by other means.',
          'inbox');
      }
      const cloud = reg.err || !Array.isArray(reg.v) ? null : reg.v;
      card.__rows = ordered.map(r => ({ r, cloud, regErr: reg.err }));
      return table([
        { label: 'Channel', strong: true, render: r => `<div class="flex items-start gap-3 min-w-[220px]">
            <span class="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined text-[20px]">${esc(channelIcon(r))}</span></span>
            <div class="min-w-0">${bold(esc(str(r.display_name) || str(r.channel_key) || 'A channel with no name recorded'))}
            <div class="mt-0.5 flex flex-wrap gap-1">${[str(r.family), str(r.plane)].filter(Boolean).map(x => chip(x)).join('')
                || muted('No family or plane recorded against this channel.')}</div></div></div>` },
        { label: 'State', render: r => {
            const s = stateOf(r);
            const label = str(r.state) || 'NO STATE RECORDED';
            return `<div>${pill(label, s.tone)}</div>`
              + (STATE[up(r.state)] ? '' : muted('This screen does not recognise that state, so it is shown exactly as '
                  + 'the database returned it and is counted in none of the figures above.'));
          } },
        { label: 'Last activity', render: r => {
            const c = n0(r.received_count);
            const when = r.last_received_at;
            return (when
                ? `<div class="font-label-numeric-sm" title="${esc(dubaiStamp(when))}">${esc(ago(when))}</div>${muted(esc(dubaiStamp(when)))}`
                : muted(c === 0 ? 'Nothing yet' : 'No time is recorded against the most recent arrival.'));
          } },
        { label: 'Arrived', align: 'r', render: r => esc(count(r.received_count)) },
        { label: 'Registered · switched on', render: r => wrap((str(r.registered_detail)
            ? esc(str(r.registered_detail))
            : muted('Nothing is recorded about whether an endpoint exists for this channel.'))
          + (str(r.connected_detail)
            ? muted(esc(str(r.connected_detail)))
            : muted('Nothing is recorded about whether this channel would accept a delivery today.'))) },
        { label: 'Attested · what this means', render: r => wrap((str(r.origin_attested)
            ? esc(str(r.origin_attested))
            : muted('Nothing has arrived through this channel, so nothing has been attested. This is not a weak '
                + 'attestation — it is the absence of anything to attest.'))
          + (str(r.evidence)
            ? muted(esc(str(r.evidence)))
            : warm('The database recorded no explanation for this channel’s state, so none is being invented '
                + 'here.'))) },
        { label: 'Readiness', render: r => {
            const v = readinessVerdict(channelGates(r, cloud, reg.err));
            const k = v.key === 'failed' ? 'failed' : v.key === 'partial' ? 'partial' : 'live';
            return `<div class="flex items-center gap-2 whitespace-nowrap">${statusChip(k, `${v.passed}/${v.applicable}`)}`
              + `<button type="button" class="${B.ghost}" data-ch-inspect="${esc(str(r.channel_key))}">Inspect<span class="material-symbols-outlined text-[16px]">chevron_right</span></button></div>`;
          } },
      ], ordered);
    },
  }).then(card => {
    wireGo(card);
    card.querySelectorAll('[data-ch-inspect]').forEach(b => b.addEventListener('click', () => {
      const hit = (card.__rows || []).find(x => str(x.r.channel_key) === b.dataset.chInspect);
      if (hit) openChannelDrawer(hit.r, hit.cloud, hit.regErr);
    }));
  });

  /* ────────────────────────────────────────────────────────────────────────
     P3 · WhatsApp Business Cloud, on its own
     ──────────────────────────────────────────────────────────────────────
     This is the channel that has carried real customers into this database, and
     it is the one Ali asked for by name. A row in a table of ten cannot say
     that. What this panel must NOT do is dress it up: if the state is anything
     other than RECEIVING, it says plainly that nothing has arrived, in the same
     place and the same size it would have said the opposite. */
  panel(waSlot, {
    title: 'WhatsApp Business Cloud', icon: 'chat',
    sub: 'The official WhatsApp Cloud API channel, shown on its own because it is the one channel that has actually '
       + 'carried a customer into this database rather than merely being configured to',
    actions: linkBtn('conversations', 'Open Conversations'),
    load,
    render: rows => {
      const all = Array.isArray(rows) ? rows : [];
      const w = all.find(r => str(r.channel_key) === WHATSAPP_CLOUD);
      if (!w) {
        return stateEmpty('WhatsApp Business Cloud is not in this dealership’s channel register',
          'The register was read and returned '
          + (all.length
              ? `${all.length} ${plural(all.length, 'channel', 'channels')}, and WhatsApp Business Cloud is not among `
                + 'them. '
              : 'nothing at all. ')
          + 'That is not the same as the channel being switched off: there is no entry to be switched off. Nothing '
          + 'here says whether messages are reaching this dealership by some other route.',
          'search_off');
      }

      const s = up(w.state);
      const c = n0(w.received_count);
      const receiving = s === 'RECEIVING';

      const idTile = kpi('Registered as', str(w.registered_detail) ? esc(str(w.registered_detail)) : 'Not recorded',
        muted(str(w.registered_detail)
          ? 'This is where the register says deliveries for this dealership would arrive. It says nothing on its own '
            + 'about whether the door is open.'
          : 'No registration detail is recorded, so nobody can say from here where a delivery would arrive.'));

      const onTile = kpi('Switched on', w.connected === true ? 'Yes' : w.connected === false ? 'No' : 'Not recorded',
        muted(str(w.connected_detail)
          ? esc(str(w.connected_detail)) + ' Switched on means a delivery today would be accepted. It is not a claim '
            + 'that one has ever been made.'
          : 'Nothing is recorded about whether a delivery today would be accepted.'),
        w.connected === true ? 't-ok' : w.connected === false ? 't-hot' : '');

      const inboundTile = kpi('Inbound messages recorded', count(c),
        muted(c
          ? `${plural(c, 'This message', 'These messages')} reached this database and ${plural(c, 'was', 'were')} `
            + 'recorded against this dealership. That is a count of what arrived here, not of what a customer sent.'
          : 'Nothing has arrived through this channel that this database recorded.'),
        c ? 't-ok' : 't-warm');

      const newestTile = kpi('Newest arrival', w.last_received_at ? esc(ago(w.last_received_at)) : 'None',
        muted(w.last_received_at
          ? esc(dubaiStamp(w.last_received_at)) + ', Dubai time.'
          : 'No arrival has a time against it, because no arrival has been recorded.'));

      const attestTile = kpi('How the origin was attested',
        str(w.origin_attested) ? esc(str(w.origin_attested)) : 'Nothing to attest',
        muted(str(w.origin_attested)
          ? 'This is the mechanism the database recorded for proving the arrival came from who it says it came from. '
            + 'A signature computed over the exact bytes sent is a stronger fact than a shared secret in the body, and '
            + 'this names which one it was rather than averaging them.'
          : 'Nothing has arrived, so nothing has been attested. That is the absence of anything to verify, not a '
            + 'failed verification.'),
        str(w.origin_attested) ? 't-ok' : '');

      const stateLine = receiving
        ? `<div class="mt-space-md">${banner('info', 'check_circle', `${bold('This channel is receiving.')}
               ${muted(str(w.evidence) ? esc(str(w.evidence)) : 'The database recorded no further explanation.')}
               ${muted('What that covers is arrival and recording. It says nothing about whether anybody replied, and '
                 + 'nothing about whether a reply would be delivered.')}`)}</div>`
        : `<div class="mt-space-md">${banner('warm', 'warning', `${bold('Nothing has arrived through WhatsApp Business Cloud yet.')}
               ${muted('Its state is ' + esc(str(w.state) || 'not recorded') + '. '
                 + (str(w.evidence) ? esc(str(w.evidence)) : 'The database recorded no further explanation.'))}
               ${muted('It is being said plainly rather than shown as a configured channel with a zero beside it: a '
                 + 'zero next to a green tick is how a dashboard tells a dealership it is covered when it is not.')}`)}</div>`;

      return `<div class="${C.grid3}">${idTile}${onTile}${inboundTile}</div>`
        + `<div class="${C.grid2} mt-space-md">${newestTile}${attestTile}</div>`
        + stateLine
        /* channels-omnichannel-whatsapp-cloud--dec649 prints the 24-hour customer
           service window on this card. It is Meta's rule, stated as Meta's rule;
           whether a particular send is allowed is decided by the message policy
           engine per conversation, never by this card. */
        + `<div class="mt-space-md">${banner('info', 'schedule', `${bold('The 24-hour customer service window is Meta’s rule.')}`
          + muted('A free-form reply is allowed only within 24 hours of the customer’s last message; outside that window '
            + 'only an approved template may be sent. Whether a given send is allowed is decided per conversation by '
            + 'NEXUS’s message policy — this card does not decide it and does not show it as decided.'))}</div>`
        + `<div class="mt-space-md flex flex-wrap gap-space-sm"><button class="${B.secondary}" data-cw-scroll><span class="material-symbols-outlined text-[18px]">send</span>Send test message</button></div>`;
    },
  }).then(card => {
    wireGo(card);
    card.querySelector('[data-cw-scroll]')?.addEventListener('click', () => {
      const btn = document.querySelector('#cwCard [data-test]');
      if (btn) btn.click(); else document.getElementById('cwCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ────────────────────────────────────────────────────────────────────────
     P3b · Message templates — v_whatsapp_template_registry
     ──────────────────────────────────────────────────────────────────────
     Added 7 Oct 2026. NEXUS's record of a template is a CACHE of what the
     provider last said, not an approval. So no provider status is printed
     without the age of the answer behind it, and status_confidence =
     NEVER_OBSERVED (no provider opinion at all) is said in those words. The
     view's own `what_this_row_claims` sentence is shown on every row. Read
     only: templates are registered on the provider side, not here. */
  panel(restSlot, {
    title: 'Message templates', icon: 'drafts',
    sub: 'The WhatsApp templates NEXUS has on record for this dealership, and how old the provider&rsquo;s answer about '
       + 'each one is. A status with no date behind it is not an approval',
    load: () => db('v_whatsapp_template_registry?select=template_id,template_name:name,language,category,nexus_state,provider_status,'
      + 'provider_status_observed_at,status_confidence,provider_rejected_reason,what_this_row_claims'
      + '&order=name.asc&limit=200'),
    render: rows => {
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        return stateEmpty('No message template is on record',
          'NEXUS holds no WhatsApp template for this dealership. A message outside the 24-hour customer window '
          + 'needs an approved template, so until one is registered and observed none of those can be sent.', 'article');
      }
      return table([
        { label: 'Template', strong: true, render: t => `<div class="${C.mono}">${esc(str(t.template_name))}</div>`
            + muted(`${esc(str(t.language) || 'no language')} &middot; ${esc(str(t.category) || 'no category')}`) },
        { label: 'In NEXUS', render: t => pill(str(t.nexus_state) || 'NOT RECORDED', '', { verbatim: true }) },
        { label: 'Provider said', render: t => (str(t.provider_status)
            ? pill(str(t.provider_status), '', { verbatim: true })
              + muted(t.provider_status_observed_at
                  ? `observed ${esc(ago(t.provider_status_observed_at))}`
                  : 'no observation time recorded')
            : pill('NEVER OBSERVED', 'unknown', { verbatim: false })
              + muted('NEXUS has no answer from the provider about this template at all.'))
            + (str(t.provider_rejected_reason) ? warm(esc(str(t.provider_rejected_reason))) : '') },
        { label: 'Confidence', render: t => pill(str(t.status_confidence) || 'NOT STATED', '', { verbatim: true }) },
        { label: 'What this row claims', render: t => wrap(muted(esc(str(t.what_this_row_claims))
            || 'The registry states no claim for this row.')) },
      ], list);
    },
  });

  /* ────────────────────────────────────────────────────────────────────────
     P3c · Messaging usage — v_whatsapp_messaging_usage_monthly
     ──────────────────────────────────────────────────────────────────────
     Added 7 Oct 2026. Counts, never money. NEXUS holds no WhatsApp rate card,
     so the view has no total column and this panel has no cost figure — the
     cost column is the view's own `cost_answer` sentence, verbatim. A month with
     messages awaiting a provider report is NOT a free month and is never shown
     as zero cost. */
  panel(restSlot, {
    title: 'Messaging usage', icon: 'analytics',
    sub: 'Outbound WhatsApp messages by month and category. These are counts of what NEXUS recorded sending; what '
       + 'they cost is the provider&rsquo;s to say, and NEXUS does not know it',
    load: () => db('v_whatsapp_messaging_usage_monthly?select=month,message_category,messages,provider_billable_messages,'
      + 'provider_not_billable_messages,awaiting_provider_report,reported_without_pricing,template_messages,'
      + 'failed_messages,no_status_reported,cost_answer&order=month.desc&limit=120'),
    render: rows => {
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        return stateEmpty('No outbound WhatsApp message is on the usage ledger',
          'NEXUS has recorded no outbound WhatsApp message for this dealership through the ledger. That is not a '
          + 'statement that nothing was ever sent — a send that bypassed the ledger would not be counted here — and '
          + 'it is not a statement about cost.', 'chat');
      }
      return table([
        { label: 'Month', strong: true, render: u => esc(dubaiDate(u.month)) },
        { label: 'Category', render: u => pill(str(u.message_category) || 'UNKNOWN', '', { verbatim: true }) },
        { label: 'Messages', align: 'r', render: u => esc(count(u.messages)) },
        { label: 'Provider: billable / not', align: 'r', render: u => `${esc(count(u.provider_billable_messages))} / ${esc(count(u.provider_not_billable_messages))}` },
        { label: 'Awaiting provider report', align: 'r', render: u => esc(count(u.awaiting_provider_report)) },
        { label: 'Failed / no status', align: 'r', render: u => `${esc(count(u.failed_messages))} / ${esc(count(u.no_status_reported))}` },
        { label: 'What it cost', render: u => wrap(muted(esc(str(u.cost_answer))
            || 'Not known. NEXUS holds no rate card, so it states no cost.')) },
      ], list) + `<div class="${C.section}">${muted('No cost figure appears on this screen by design: Meta prices by '
        + 'country, category and date, and NEXUS holds no rate card. Billable means the provider reported the message '
        + 'as billable — it is a count, not a charge.')}</div>`;
    },
  });

  /* ────────────────────────────────────────────────────────────────────────
     P4 · The limits of this screen
     ──────────────────────────────────────────────────────────────────────
     Fixed rows. They are true whether or not the read above succeeded, which is
     why this panel takes the soft load: a screen whose job is to state what it
     cannot tell you must not go blank at exactly the moment it knows least. */
  panel(restSlot, {
    title: 'What this screen cannot tell you', icon: 'privacy_tip',
    sub: 'Four things that are outside what the database can answer. They are listed because a dashboard that only '
       + 'shows what it knows reads as though it knows everything',
    load: loadSoft,
    render: ({ v, err }) => {
      const all = err ? null : (Array.isArray(v) ? v : []);
      const connected = all ? isState(all, 'CONNECTED') : null;

      const rows = [
        { limit: 'It reads the database, not the automation box.',
          why: 'Everything on this screen comes from what was written down in this database. Whether a workflow on '
             + 'the n8n box is switched on, erroring, or deleted is invisible from here. A channel can read as '
             + 'CONNECTED while the workflow behind it has been off for a week, and nothing on this page would change.' },
        { limit: 'It says nothing about outbound.',
          why: 'Every figure here is about messages and enquiries ARRIVING. Whether a reply sent from this dealership '
             + 'would actually be delivered to the customer is a different question, answered by a different system, '
             + 'and no green pill on this screen is evidence about it.' },
        { limit: 'The count is what reached this database, not what a customer sent.',
          why: 'If a message was sent and something between the customer and here dropped it, this database never saw '
             + 'it and this screen cannot count it. The two numbers are the same only when nothing was lost in '
             + 'between, and nothing here can see that gap.' },
        { limit: 'Connected is not receiving, and most of the rows above are connected.',
          why: 'A channel can be switched on and accept deliveries and still never receive anything — because nobody '
             + 'sent one, or because a person has to type it in by hand and there is no wire to fire at all. '
             + (connected == null
                  ? 'The register could not be read on this visit, so no count of those channels is being stated here.'
                  : connected.length
                    ? `${connected.length} of the ${all.length} ${plural(all.length, 'channel', 'channels')} above `
                      + `${plural(connected.length, 'is', 'are')} in exactly that position right now.`
                    : 'No channel above is in that position right now.') },
      ];

      const head = err
        ? `<div class="mt-space-md">${banner('warm', 'warning', `${bold('The channel register could not be read on this visit.')}
               ${muted(esc(str(err.message) || 'No reason was given.')
                 + ' The four limits below are true regardless, so they are still shown. The panels above are unread '
                 + 'rather than empty — no channel is being cleared and none is being blamed.')}`)}</div>`
        : '';

      return head + table([
        { label: 'What it cannot tell you', strong: true, render: r => wrap(esc(r.limit)) },
        { label: 'Why', render: r => wrap(esc(r.why)) },
      ], rows);
    },
  }).then(wireGo);

  /* Trust footer (states-components §7). */
  settle(readChannels()).then(({ v, err }) => {
    footSlot.innerHTML = trustFooter({
      source: 'Channel register for this dealership',
      asOf: dubaiStamp(new Date()),
      evidence: err ? 'The register could not be read' : `${count(Array.isArray(v) ? v.length : 0)} channels read`,
      actor: actor(),
    });
  });
};
