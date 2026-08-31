/* NEXUS OS — lib/identity.js
   New on 31 Aug 2026. Shared identity resolver.

   `communication_logs.lead_email` is one text column holding FOUR incompatible
   key shapes for the same human being:

     shabbir53ujjainwala@gmail.com      a real email address
     971501234567@c.us                  a WhatsApp chat id — digits ARE the phone
     158510264357112@lid                a WhatsApp LID — digits are a machine id
     +918517942172@whatsapp.lead        a key the workflows synthesise from a phone

   Lead 38 is already filed under three of them. `v_conversations` reconciles
   this server-side for the inbox and `screens/conversations.js:1220` reads under
   every key the view resolved — which is why that one screen shows the whole of
   a thread. Every other consumer keys on a single value and therefore renders a
   PARTIAL history with no sign that it is partial. That is the more dangerous
   kind of wrong: it looks complete. `screens/customers.js` had exactly this
   defect on its detail pane.

   This module is the shared version of that fix. It is pure: no DOM, no module
   state, no globals. The one function that talks to the database takes `db`
   from `lib/data.js` — imported dynamically so that the pure half of this file
   can be run under plain `node` by `identity.test.mjs`, which cannot resolve
   `@supabase/supabase-js` or `import.meta.env`.

   THE MATCHING RULE IS NOT OURS TO CHOOSE. The n8n node `Resolve Lead Identity`
   (whatsapp_bdc_ai_agent.json) joins a chat to a lead on the LAST NINE DIGITS of
   the phone number and nothing else. Every key written into communication_logs
   was written by a workflow that used that rule, so any front end reading them
   back must use the same one. Diverging from it here would silently split or
   silently merge people, and neither would be visible on screen. */

/* ── Key shapes ──────────────────────────────────────────────────────────── */

const KEY_SHAPE = {
  EMAIL:   'email',
  CUS:     'c.us',
  LID:     'lid',
  WA_LEAD: 'whatsapp.lead',
  WA_NET:  's.whatsapp.net',
  GROUP:   'g.us',
  PHONE:   'phone',
  UNKNOWN: 'unknown',
  NONE:    'none',
};

/* The four shapes above plus the two WAHA also emits. `s.whatsapp.net` is the
   raw WAHA address form of `c.us`; `g.us` is a group and belongs to nobody. */
const HANDLE_RE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;
const EMAIL_RE  = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* Nine, because the backend says nine. Not a tunable. */
const SUFFIX_LEN = 9;

/* Which shapes genuinely carry a dialable number. A LID does not: its digits are
   an opaque machine id, and comparing them as a phone number is how you merge
   two unrelated people. Never add `lid` or `g.us` to this list. */
const PHONE_SHAPES = [KEY_SHAPE.CUS, KEY_SHAPE.WA_NET, KEY_SHAPE.WA_LEAD, KEY_SHAPE.PHONE];

/* Nothing below may throw on a null, a number, an object or a malformed string —
   every one of those really appears in these columns. */
const text = v => (typeof v === 'string'
  ? v
  : (typeof v === 'number' && Number.isFinite(v) ? String(v) : '')).trim();
const digitsOf = v => text(v).replace(/[^0-9]/g, '');

/* The comparison form the backend uses. '' when there are not enough digits to
   apply it — an empty suffix must never compare equal to another empty one. */
function phoneSuffix(v) {
  const d = digitsOf(v);
  return d.length >= SUFFIX_LEN ? d.slice(-SUFFIX_LEN) : '';
}

function isHandle(key) { return HANDLE_RE.test(text(key)); }

function keyShape(key) {
  const raw = text(key);
  if (!raw) return KEY_SHAPE.NONE;
  const low = raw.toLowerCase();
  const at = low.lastIndexOf('@');
  if (at > -1) {
    switch (low.slice(at + 1)) {
      case 'lid':            return KEY_SHAPE.LID;
      case 'c.us':           return KEY_SHAPE.CUS;
      case 's.whatsapp.net': return KEY_SHAPE.WA_NET;
      case 'g.us':           return KEY_SHAPE.GROUP;
      case 'whatsapp.lead':  return KEY_SHAPE.WA_LEAD;
      default:               return EMAIL_RE.test(low) ? KEY_SHAPE.EMAIL : KEY_SHAPE.UNKNOWN;
    }
  }
  /* A bare number is a phone only if it reads as one. `NX-1010` and `null` do
     not, and a four-digit fragment is not enough to identify anybody. */
  if (/^\+?[0-9][0-9\s().+-]*$/.test(raw) && digitsOf(raw).length >= 5) return KEY_SHAPE.PHONE;
  return KEY_SHAPE.UNKNOWN;
}

/* NORMALISE. One value in, one descriptor out.

   `canonical` is the only thing callers should compare on, and it is namespaced
   on purpose: a 15-digit LID whose last nine happen to match a phone must not
   collide with that phone, so `lid:` and `phone:` can never be equal even when
   the digits are.

   `usable:false` means "this value identifies nobody" — an empty string, a null,
   `"@lid"` with no id, a phone-shaped value with no digits in it. Callers must
   drop those rather than querying on them. */
function normalizeKey(key) {
  const raw = text(key);
  const shape = keyShape(raw);
  const out = {
    raw, shape,
    canonical: '',
    digits: '', suffix: '',
    phoneDerived: false,
    opaque: false,
    weak: false,      /* true = comparable only as an exact string, not by the last-9 rule */
    usable: false,
    reason: '',
  };
  if (shape === KEY_SHAPE.NONE) {
    out.reason = 'empty, null, or not a string the database could hold';
    return out;
  }
  const low = raw.toLowerCase();
  const at = low.lastIndexOf('@');
  const local = at > -1 ? low.slice(0, at) : low;

  if (shape === KEY_SHAPE.EMAIL) {
    out.canonical = 'email:' + low;
    out.usable = true;
    out.reason = 'email address';
    return out;
  }
  if (shape === KEY_SHAPE.LID || shape === KEY_SHAPE.GROUP) {
    out.opaque = true;
    const id = digitsOf(local) || local;
    if (!id) {
      out.reason = `"${low}" carries no identifier in front of the suffix`;
      return out;
    }
    out.canonical = (shape === KEY_SHAPE.LID ? 'lid:' : 'group:') + id;
    out.usable = true;
    out.reason = shape === KEY_SHAPE.LID
      ? 'WhatsApp LID handle — its digits are a machine id and are never read as a phone number'
      : 'WhatsApp group id — it belongs to no single person';
    return out;
  }
  if (PHONE_SHAPES.includes(shape)) {
    out.phoneDerived = true;
    out.digits = digitsOf(local);
    if (!out.digits) {
      out.reason = 'phone-shaped, but there are no digits in it';
      return out;
    }
    out.suffix = phoneSuffix(out.digits);
    out.usable = true;
    if (!out.suffix) {
      /* Real case: a lead row holding "0501234" with the country code missing.
         It is still a key, but the backend's rule cannot be applied to it, so it
         may only ever match itself. Saying which of the two happened is the
         whole point of the flag. */
      out.weak = true;
      out.canonical = 'phone-short:' + out.digits;
      out.reason = `only ${out.digits.length} digits — fewer than the ${SUFFIX_LEN} `
        + 'the backend compares on, so this can only be matched as an exact string';
      return out;
    }
    out.canonical = 'phone:' + out.suffix;
    out.reason = shape === KEY_SHAPE.PHONE ? 'phone number' : `WhatsApp address (${shape})`;
    return out;
  }
  out.canonical = 'raw:' + low;
  out.usable = true;
  out.weak = true;
  out.reason = 'unrecognised key shape — compared as an opaque string and nothing else';
  return out;
}

/* Plain-language version of the above, for a title= attribute. Deliberately the
   same vocabulary as conversations.js:262 so the two screens do not describe the
   same handle in two different ways. */
function describeKey(key) {
  const n = normalizeKey(key);
  if (n.shape === KEY_SHAPE.NONE) return 'no key recorded';
  return n.reason || 'thread key';
}

/* Do two values name the same person? Only ever true through `canonical`. */
function sameIdentity(a, b) {
  const A = normalizeKey(a), B = normalizeKey(b);
  return !!(A.usable && B.usable && A.canonical === B.canonical);
}

/* ── Ambiguity ───────────────────────────────────────────────────────────── */

const AMBIGUITY = {
  PHONE_SUFFIX_COLLISION: 'phone_suffix_collision',
  HANDLE_MULTIPLE_OWNERS: 'handle_multiple_owners',
  MULTIPLE_EMAILS:        'multiple_emails',
};

/* ── Expand ──────────────────────────────────────────────────────────────── */

/* Which fields of a linking row we read. `whatsapp_contacts` and
   `v_conversations` are the two tables that tie a handle to an email; both are
   accepted here, in either their snake_case or camelCase spelling, because
   screens hold them in both. */
const LINK_HANDLE_FIELDS = ['chat_id', 'chatId', 'thread_key', 'threadKey'];
const LINK_EMAIL_FIELDS  = ['lead_email', 'leadEmail', 'email'];
const LINK_NAME_FIELDS   = ['lead_name', 'leadName', 'display_name', 'displayName', 'push_name', 'pushName', 'name'];

const IDENT_RANK = { unidentified: 0, phone_only: 1, whatsapp_profile: 2, lead: 3 };

/* A name may never be a machine handle. This is the rule that stopped the inbox
   printing "163188003877036@lid" where a person's name goes. */
const usableName = v => {
  const s = text(v);
  if (!s || isHandle(s) || EMAIL_RE.test(s)) return '';
  if (keyShape(s) === KEY_SHAPE.PHONE) return '';
  return s;
};

/* EXPAND. A person in, every key their rows could be filed under out.

   seed:  a lead row, a directory row, or any one of
          { leadId } | { email } | { phone } | { chatId } | { key } | { keys: [] }
          — or a bare string, which is treated as one key.

   opts.links:  rows from whatsapp_contacts / v_conversations. These are the ONLY
                thing that can attach a `@lid` to a person: a LID contains no
                phone digits, so it can never be derived, only looked up.
   opts.leads:  candidate lead rows, used both to pick up a phone we did not have
                and to DETECT COLLISIONS. Two different people whose numbers end
                in the same nine digits is a real possibility, and this function
                reports it instead of merging them.
   opts.synthesize: default true. Builds the `@c.us` / `@whatsapp.lead` /
                `@s.whatsapp.net` forms of a known full phone number, because the
                workflows write those keys whether or not a contact row exists.

   Never throws. An unusable seed comes back with ok:false and a reason. */
function expandIdentity(seed, opts = {}) {
  const links = Array.isArray(opts.links) ? opts.links : [];
  const pool  = Array.isArray(opts.leads) ? opts.leads : [];
  const synthesize = opts.synthesize !== false;

  const id = {
    ok: false,
    personKey: '', personKeyBasis: '',
    displayName: '',
    email: '', phone: '', digits: '', suffix: '',
    leadIds: [], chatIds: [], threadKey: '',
    keys: [], keyDetail: [],
    identified: 'unidentified',
    ambiguous: false, ambiguity: [], ambiguityCodes: [], warnings: [],
    counts: { expected: null, fetched: null },
    partial: false,
  };

  const s = (seed && typeof seed === 'object' && !Array.isArray(seed)) ? seed : { key: seed };
  if (Array.isArray(seed)) s.keys = seed;

  /* anchors: canonical -> 'strong' | 'phone'. A strong anchor is an exact
     identity (an email, a LID, a chat id). A phone anchor is the last-9 rule,
     which is the only one that can be wrong. Keeping them apart is what lets us
     absorb a link confidently or refuse to. */
  const anchors = new Map();
  const observed = new Map();   /* raw key -> provenance note */
  const emailsSeen = new Map(); /* email canonical -> raw */
  /* Exact handle strings we have already seen. A chat id shared verbatim by two
     rows is a far stronger statement than two numbers ending in the same nine
     digits, and conflating the two mislabels a shared WhatsApp account as a
     suffix collision. `anchors` cannot carry this because a c.us handle
     canonicalises down to its phone suffix by design. */
  const exactKeys = new Set();

  const anchor = (v, strength) => {
    const n = normalizeKey(v);
    if (!n.usable) return n;
    const prev = anchors.get(n.canonical);
    if (prev !== 'strong') anchors.set(n.canonical, strength);
    return n;
  };
  const observe = (v, via) => {
    const n = normalizeKey(v);
    /* A group id is a room, not a person. Never query a person's history on it. */
    if (!n.usable || n.shape === KEY_SHAPE.GROUP) return n;
    if (!observed.has(n.raw)) observed.set(n.raw, via);
    exactKeys.add(n.raw.toLowerCase());
    return n;
  };
  /* A second, DIFFERENT email address is recorded and flagged but never becomes
     a query key. Adopting it would pull a second person's email-keyed history
     into this pane, which is the exact failure this module exists to prevent;
     dropping it silently would hide that there is a second person at all. */
  const takeEmail = (v, via) => {
    const n = normalizeKey(v);
    if (!n.usable) return n;
    if (n.shape !== KEY_SHAPE.EMAIL) return observe(v, via);
    if (!emailsSeen.has(n.canonical)) emailsSeen.set(n.canonical, n.raw.toLowerCase());
    if (id.email && normalizeKey(id.email).canonical !== n.canonical) return n;
    if (!id.email) id.email = n.raw.toLowerCase();
    anchor(n.raw, 'strong');
    observe(n.raw, via);
    return n;
  };
  const takePhone = (v) => {
    const n = normalizeKey(v);
    if (!n.phoneDerived || !n.digits) return n;
    anchor(n.raw, 'phone');
    if (!id.phone) { id.phone = n.raw; id.digits = n.digits; id.suffix = n.suffix; }
    if (!id.suffix && n.suffix) { id.suffix = n.suffix; id.digits = n.digits; }
    return n;
  };

  /* ── the seed ─────────────────────────────────────────────────────────── */
  const seedLeadId = text(s.leadId ?? s.lead_id ?? s.id);
  if (seedLeadId) id.leadIds.push(seedLeadId);

  takeEmail(s.email ?? s.lead_email ?? s.leadEmail, 'seed');
  takePhone(s.phone);

  const seedHandles = []
    .concat(s.chatId ?? s.chat_id ?? [])
    .concat(s.threadKey ?? s.thread_key ?? [])
    .concat(s.key ?? [])
    .concat(Array.isArray(s.keys) ? s.keys : (s.keys ? [s.keys] : []));
  const seedChat = text(s.chatId ?? s.chat_id);
  if (seedChat) id.chatIds.push(seedChat);
  const seedThread = text(s.threadKey ?? s.thread_key);
  if (seedThread) id.threadKey = seedThread;

  seedHandles.forEach(h => {
    const n = observe(h, 'seed');
    if (!n.usable) return;
    /* A phone-derived seed key gives us the person's number for free; an email
       seed key is an email; a LID is an exact anchor and nothing more. */
    if (n.shape === KEY_SHAPE.EMAIL) takeEmail(n.raw, 'seed');
    else if (n.phoneDerived) { anchor(n.raw, 'phone'); takePhone(n.raw); }
    else anchor(n.raw, 'strong');
  });

  const seedName = usableName(s.name ?? s.lead_name ?? s.display_name ?? s.customer_name);
  if (seedName) id.displayName = seedName;

  /* ── the lead pool: absorb, or report a collision ──────────────────────── */
  const emailCanon = id.email ? normalizeKey(id.email).canonical : '';
  const suffixHits = id.suffix
    ? pool.filter(l => l && phoneSuffix(l.phone) === id.suffix)
    : [];
  const owners = new Map();
  suffixHits.forEach(l => {
    const n = normalizeKey(l.email);
    if (n.usable && n.shape === KEY_SHAPE.EMAIL) owners.set(n.canonical, n.raw.toLowerCase());
  });
  const foreign = [...owners.entries()].filter(([c]) => c !== emailCanon);

  /* Two people, one suffix. The backend's rule cannot separate them and neither
     can we — so say so, and absorb neither. A caller that merges anyway is
     merging two customers' histories into one pane. */
  if ((emailCanon && foreign.length) || (!emailCanon && owners.size > 1)) {
    id.ambiguous = true;
    id.ambiguityCodes.push(AMBIGUITY.PHONE_SUFFIX_COLLISION);
    id.ambiguity.push({
      code: AMBIGUITY.PHONE_SUFFIX_COLLISION,
      message: `More than one lead has a phone number ending ${id.suffix} — `
        + [...owners.values()].join(', ')
        + '. The last-9 rule the backend matches on cannot tell them apart, so no '
        + 'key was inferred from the phone number alone.',
      keys: [...owners.values()],
    });
  } else {
    pool.forEach(l => {
      if (!l) return;
      const hitById    = seedLeadId && text(l.id) === seedLeadId;
      const hitByEmail = emailCanon && normalizeKey(l.email).canonical === emailCanon;
      const hitByPhone = id.suffix && phoneSuffix(l.phone) === id.suffix;
      if (!hitById && !hitByEmail && !hitByPhone) return;
      const lid = text(l.id);
      if (lid && !id.leadIds.includes(lid)) id.leadIds.push(lid);
      takeEmail(l.email, 'leads');
      takePhone(l.phone);
      if (!id.displayName) id.displayName = usableName(l.name);
      id.identified = IDENT_RANK[id.identified] >= IDENT_RANK.lead ? id.identified : 'lead';
    });
  }

  /* ── the links: transitive closure, one pass per link at most ──────────── */
  const linkFields = row => {
    const handles = LINK_HANDLE_FIELDS.map(f => row[f]).filter(v => text(v));
    const emails  = LINK_EMAIL_FIELDS.map(f => row[f]).filter(v => text(v));
    return { handles, emails, phone: row.phone };
  };
  const pending = links.filter(Boolean);
  const absorbed = new Set();
  const linkOwners = new Map();
  for (let pass = 0; pass <= pending.length; pass++) {
    let grew = false;
    pending.forEach((row, i) => {
      if (absorbed.has(i)) return;
      const f = linkFields(row);
      const cands = [...f.handles, ...f.emails].map(normalizeKey).filter(n => n.usable);
      const phoneN = normalizeKey(f.phone);
      let strength = '';
      cands.forEach(n => {
        if (anchors.get(n.canonical) === 'strong' || exactKeys.has(n.raw.toLowerCase())) strength = 'strong';
      });
      if (!strength) {
        const phoneMatch = cands.some(n => anchors.get(n.canonical) === 'phone')
          || (phoneN.usable && anchors.has(phoneN.canonical));
        if (phoneMatch) strength = 'phone';
      }
      if (!strength) return;

      /* A link reached only through the last-9 rule may not introduce a second
         email — that is the same collision as above, arriving from the other
         side. Record it and leave the row alone. */
      const linkEmail = f.emails.map(normalizeKey).find(n => n.usable && n.shape === KEY_SHAPE.EMAIL);
      if (strength === 'phone' && linkEmail && emailCanon && linkEmail.canonical !== emailCanon) {
        if (!id.ambiguityCodes.includes(AMBIGUITY.PHONE_SUFFIX_COLLISION)) {
          id.ambiguous = true;
          id.ambiguityCodes.push(AMBIGUITY.PHONE_SUFFIX_COLLISION);
          id.ambiguity.push({
            code: AMBIGUITY.PHONE_SUFFIX_COLLISION,
            message: `A WhatsApp contact whose number ends ${id.suffix} is filed under `
              + `${linkEmail.raw.toLowerCase()}, not ${id.email}. The two were not merged.`,
            keys: [linkEmail.raw.toLowerCase()],
          });
        }
        absorbed.add(i);
        return;
      }

      absorbed.add(i);
      grew = true;
      f.handles.forEach(h => {
        const n = observe(h, 'link');
        if (!n.usable) return;
        if (n.phoneDerived) { anchor(n.raw, 'phone'); takePhone(n.raw); }
        else anchor(n.raw, 'strong');
      });
      f.emails.forEach(e => {
        const n = takeEmail(e, 'link');
        if (n.usable && n.shape === KEY_SHAPE.EMAIL) linkOwners.set(n.canonical, n.raw.toLowerCase());
      });
      takePhone(f.phone);

      const chat = text(row.chat_id ?? row.chatId);
      if (chat && !id.chatIds.includes(chat)) id.chatIds.push(chat);
      const thread = text(row.thread_key ?? row.threadKey);
      if (thread && !id.threadKey) id.threadKey = thread;
      if (!id.displayName) {
        for (const fld of LINK_NAME_FIELDS) {
          const nm = usableName(row[fld]);
          if (nm) { id.displayName = nm; break; }
        }
      }
      const declared = text(row.identified);
      if (declared && IDENT_RANK[declared] != null
          && IDENT_RANK[declared] > IDENT_RANK[id.identified]) id.identified = declared;
      else if (LINK_NAME_FIELDS.some(fld => usableName(row[fld]))
          && IDENT_RANK.whatsapp_profile > IDENT_RANK[id.identified]) id.identified = 'whatsapp_profile';
    });
    if (!grew) break;
  }

  /* One handle filed under two different emails is not a suffix collision — it
     is a genuinely shared or reassigned WhatsApp account, and it means the two
     people's histories are already interleaved in communication_logs. */
  if (emailsSeen.size > 1) {
    id.ambiguous = true;
    id.ambiguityCodes.push(AMBIGUITY.MULTIPLE_EMAILS);
    id.ambiguity.push({
      code: AMBIGUITY.MULTIPLE_EMAILS,
      message: 'The records reached from this person carry more than one email address ('
        + [...emailsSeen.values()].join(', ')
        + `). Only ${id.email} was read under; the others were not merged in. They may be `
        + 'one person with two addresses or two people sharing a WhatsApp account, and '
        + 'nothing in the database says which.',
      keys: [...emailsSeen.values()],
    });
  }
  if (id.chatIds.length > 1 && linkOwners.size > 1) {
    id.ambiguous = true;
    id.ambiguityCodes.push(AMBIGUITY.HANDLE_MULTIPLE_OWNERS);
    id.ambiguity.push({
      code: AMBIGUITY.HANDLE_MULTIPLE_OWNERS,
      message: 'More than one WhatsApp address here resolves to a different lead email.',
      keys: [...linkOwners.values()],
    });
  }

  /* ── synthesise the phone-derived shapes ──────────────────────────────── */
  const synthetic = new Set();
  if (synthesize && !id.ambiguityCodes.includes(AMBIGUITY.PHONE_SUFFIX_COLLISION)) {
    const digitSets = new Set();
    if (id.digits.length >= SUFFIX_LEN) digitSets.add(id.digits);
    observed.forEach((_via, raw) => {
      const n = normalizeKey(raw);
      if (n.phoneDerived && n.digits.length >= SUFFIX_LEN) digitSets.add(n.digits);
    });
    digitSets.forEach(d => {
      /* The exact three spellings the workflows write. `@c.us` and
         `@s.whatsapp.net` carry bare digits; `@whatsapp.lead` carries a leading
         plus. Getting the plus wrong is the difference between finding a
         customer's history and not. */
      synthetic.add(`${d}@c.us`);
      synthetic.add(`${d}@s.whatsapp.net`);
      synthetic.add(`+${d}@whatsapp.lead`);
    });
  }

  /* ── assemble, in a deterministic order ───────────────────────────────── */
  const seen = new Set();
  const push = (raw, via, kind) => {
    const k = text(raw);
    if (!k || seen.has(k.toLowerCase())) return;
    seen.add(k.toLowerCase());
    id.keys.push(k);
    id.keyDetail.push({ key: k, shape: keyShape(k), via, synthetic: kind === 'synthetic', describe: describeKey(k) });
  };
  const obs = [...observed.entries()];
  const sortRaw = (a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1);
  obs.filter(([k]) => keyShape(k) === KEY_SHAPE.EMAIL).sort(sortRaw).forEach(([k, v]) => push(k, v, 'observed'));
  obs.filter(([k]) => keyShape(k) !== KEY_SHAPE.EMAIL).sort(sortRaw).forEach(([k, v]) => push(k, v, 'observed'));
  [...synthetic].sort().forEach(k => push(k, 'derived from the phone number', 'synthetic'));

  id.ok = id.keys.length > 0;
  if (!id.ok) {
    id.warnings.push('Nothing in this seed identifies a person: no email, no phone, no WhatsApp address.');
  }
  if (id.suffix === '' && id.digits) {
    id.warnings.push(`The phone on file has only ${id.digits.length} digits, so the last-${SUFFIX_LEN} `
      + 'rule the backend matches on cannot be applied to it.');
  }

  id.personKey = id.email
    || id.threadKey
    || id.chatIds[0]
    || (id.suffix ? `phone:${id.suffix}` : '')
    || id.keys[0] || '';
  id.personKeyBasis = id.email ? 'lower(email)'
    : id.threadKey ? 'v_conversations.thread_key'
    : id.chatIds[0] ? 'v_conversations.chat_id'
    : id.suffix ? `the last ${SUFFIX_LEN} digits of the phone number`
    : id.keys[0] ? 'the only key this person is filed under' : '';
  /* `phone_only` is the view's word for "we have a number and nothing else". It
     is a floor, never a downgrade — a lead row or a WhatsApp profile name
     outranks it and is set above. */
  if (id.suffix && IDENT_RANK[id.identified] < IDENT_RANK.phone_only) id.identified = 'phone_only';
  if (!id.displayName) id.displayName = id.email || '';
  return id;
}

/* Record what a read actually returned against what the view says exists.
   Pure — returns a new identity, does not mutate. `partial` is the flag the
   IA contract requires every consumer to render rather than swallow. */
function withCounts(identity, { expected, fetched } = {}) {
  const base = identity || {};
  const exp = expected == null ? (base.counts ? base.counts.expected : null) : Number(expected);
  const got = fetched == null ? (base.counts ? base.counts.fetched : null) : Number(fetched);
  const bad = n => n == null || Number.isNaN(n);
  return {
    ...base,
    counts: { expected: bad(exp) ? null : exp, fetched: bad(got) ? null : got },
    partial: !bad(exp) && !bad(got) && got < exp,
  };
}

/* ── Query helpers ───────────────────────────────────────────────────────── */

/* PostgREST wants a double-quoted value. The quotes are written as %22 and the
   value is percent-encoded on its own, so the commas, quotes and parentheses
   that delimit a filter survive as delimiters whatever the key contains.
   encodeURIComponent leaves !'()*~ alone and every one of those is structural
   inside an or=(), so they are encoded here too. */
function quoteValue(v) {
  const escaped = String(v).replace(/["\\]/g, m => '\\' + m);
  return '%22'
    + encodeURIComponent(escaped).replace(/[!'()*~]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())
    + '%22';
}

function toIdentity(source, opts) {
  if (source && typeof source === 'object' && Array.isArray(source.keys) && 'ambiguous' in source) return source;
  return expandIdentity(source, opts);
}

/* BUILD THE FILTER for "every row belonging to this person".

   `ilike` and not `in.()` on purpose: the column is free text written by three
   different systems and the same address appears in more than one casing.
   customers.js was already reading with `ilike`, and narrowing that to a
   case-sensitive in-list while claiming to widen the read would have traded one
   silent truncation for another.

   The suffix patterns are the last-9 rule expressed as a query. They are built
   ONLY from nine digits and appended ONLY to the shapes that really carry a
   phone number — never `@lid`, whose digits are a machine id.

   Returns { ok, filter, keys, patterns, note }. `ok:false` means there is
   nothing safe to query on; the caller must not fall back to a bare email. */
function personFilter(source, options = {}) {
  const column = options.column || 'lead_email';
  const id = toIdentity(source, options);
  const collision = (id.ambiguityCodes || []).includes(AMBIGUITY.PHONE_SUFFIX_COLLISION);
  const wantSuffix = options.suffix !== false && !collision;

  const patterns = [];
  if (wantSuffix && /^[0-9]{9}$/.test(id.suffix || '')) {
    /* Anchored on the suffix so a prefix of any length matches — this is what
       finds `918517942172@c.us` when all the dashboard holds is `8517942172`. */
    patterns.push(`*${id.suffix}@c.us`, `*${id.suffix}@s.whatsapp.net`, `*${id.suffix}@whatsapp.lead`);
  }
  const keys = (id.keys || []).filter(k => !patterns.some(p => p.slice(1) === String(k).slice(-p.length + 1)));
  const terms = keys.map(k => `${column}.ilike.${quoteValue(k)}`)
    .concat(patterns.map(p => `${column}.ilike.${p}`));

  const note = collision
    ? `Matched on exact keys only. ${id.suffix} is shared by more than one lead, so the `
      + 'last-nine-digit patterns were left out rather than merging two people.'
    : patterns.length
      ? `Matched on ${keys.length} recorded ${keys.length === 1 ? 'key' : 'keys'} plus the `
        + `last-${SUFFIX_LEN}-digit rule the backend uses.`
      : `Matched on ${keys.length} recorded ${keys.length === 1 ? 'key' : 'keys'}.`;

  if (!terms.length) {
    return {
      ok: false, column, keys: [], patterns: [], filter: '',
      note: 'No usable key: this person cannot be matched to any row in that table.',
      identity: id,
    };
  }
  const filter = terms.length === 1
    ? `${column}=ilike.${terms[0].slice(column.length + '.ilike.'.length)}`
    : `or=(${terms.join(',')})`;
  return { ok: true, column, keys, patterns, filter, note, identity: id };
}

/* The PostgREST path, ready for db(). Returns '' when there is nothing safe to
   query on, so a caller can render "we could not match this person" rather than
   issue a query that quietly matches everybody. */
function personQuery(table, source, options = {}) {
  const f = personFilter(source, options);
  if (!f.ok) return '';
  const parts = [];
  if (options.select) parts.push('select=' + options.select);
  parts.push(f.filter);
  if (options.order) parts.push('order=' + options.order);
  if (options.limit != null) parts.push('limit=' + options.limit);
  return `${table}?${parts.join('&')}`;
}

/* Read every row belonging to this person.

   `db` is imported lazily rather than at the top of the file: lib/data.js pulls
   in @supabase/supabase-js and import.meta.env, neither of which exists under
   plain `node`, and identity.test.mjs has to be able to import the pure half of
   this module. Passing options.db also lets a test assert the exact path this
   would have issued without a network. */
async function fetchPersonRows(table, source, options = {}) {
  const path = personQuery(table, source, options);
  if (!path) throw new Error(`No usable identity key, so ${table} cannot be read for this person.`);
  const read = options.db || (await import('./data.js')).db;
  return read(path);
}

/* ── resolveIdentity — the async form from IA-SPEC §3.3 ──────────────────── */

const CONV_COLS = 'thread_key,chat_id,phone,push_name,lead_email,lead_name,display_name,identified,message_count';
const CONTACT_COLS = 'chat_id,phone,push_name,lead_email';

/* seed: { leadId } | { email } | { chatId } | { phone }, in the order IA-SPEC
   §3.3 lays out — cheapest and most authoritative read first.

   Every read is settled independently and its outcome recorded in `sources`. A
   consumer may not assert an absence whose source is 'err'; that rule is already
   right in lib/lead-drawer.js:66-131 and is the reason this returns a per-source
   verdict instead of an empty array. */
async function resolveIdentity(seed, options = {}) {
  const read = options.db || (await import('./data.js')).db;
  const s = (seed && typeof seed === 'object') ? seed : { key: seed };
  const enc = v => encodeURIComponent(text(v));

  const chatId  = text(s.chatId ?? s.chat_id);
  const leadId  = text(s.leadId ?? s.lead_id ?? s.id);
  const email   = text(s.email ?? s.lead_email).toLowerCase();
  const phone   = text(s.phone);
  const digits  = digitsOf(phone);

  const plan = [];
  if (chatId) plan.push(['conversations', `v_conversations?select=${CONV_COLS}&chat_id=eq.${enc(chatId)}&limit=1`]);
  if (leadId) plan.push(['leads', `leads?select=*,users(id,name)&id=eq.${enc(leadId)}&limit=1`]);
  if (email) {
    plan.push(['directory', `v_customer_directory?select=*&email=eq.${enc(email)}&limit=1`]);
    plan.push(['conversations', `v_conversations?select=${CONV_COLS}&lead_email=eq.${enc(email)}&limit=50`]);
    plan.push(['leads', `leads?select=id,name,email,phone,status&email=eq.${enc(email)}&limit=50`]);
  }
  if (digits.length >= SUFFIX_LEN) {
    plan.push(['contacts', `whatsapp_contacts?select=${CONTACT_COLS}&phone=eq.${enc(digits)}&limit=50`]);
  }

  const sources = { leads: 'absent', conversations: 'absent', directory: 'absent', contacts: 'absent' };
  const errors = {};
  const links = [];
  const leadRows = [];
  let directoryRow = null;

  const settled = await Promise.allSettled(plan.map(([, path]) => read(path)));
  settled.forEach((r, i) => {
    const [kind] = plan[i];
    if (r.status === 'rejected') {
      sources[kind] = 'err';
      errors[kind] = (r.reason && r.reason.message) || String(r.reason);
      return;
    }
    const rows = Array.isArray(r.value) ? r.value : (r.value ? [r.value] : []);
    if (sources[kind] !== 'err') sources[kind] = 'ok';
    if (kind === 'conversations' || kind === 'contacts') links.push(...rows);
    if (kind === 'leads') leadRows.push(...rows);
    if (kind === 'directory' && rows.length) directoryRow = rows[0];
  });

  const conv = links.find(r => r && r.message_count != null);
  const base = {
    leadId, email: email || (directoryRow ? text(directoryRow.email) : ''),
    phone: phone || (directoryRow ? text(directoryRow.phone) : ''),
    chatId, name: directoryRow ? text(directoryRow.name) : '',
  };
  const id = withCounts(
    expandIdentity(base, { links, leads: leadRows, synthesize: options.synthesize !== false }),
    { expected: conv ? Number(conv.message_count) : null },
  );
  return { ...id, sources, errors };
}

export {
  KEY_SHAPE, AMBIGUITY, SUFFIX_LEN,
  keyShape, isHandle, normalizeKey, describeKey, sameIdentity, phoneSuffix,
  expandIdentity, withCounts,
  personFilter, personQuery, fetchPersonRows, resolveIdentity,
};
