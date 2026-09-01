/* NEXUS OS — lib/identity.test.mjs
   Plain node, no framework: this repo has none and adding one to prove a
   200-line pure module would be the larger change.

       node lib/identity.test.mjs

   The cases below are the real ones. Lead 38 — the demo customer — is filed in
   communication_logs under three different key shapes, and every number here
   (+918517942172, 158510264357112@lid) is the shape that actually appears in
   that column, not an invented example. */

import {
  KEY_SHAPE, AMBIGUITY,
  keyShape, isHandle, normalizeKey, describeKey, sameIdentity, phoneSuffix,
  expandIdentity, withCounts,
  personFilter, personQuery, fetchPersonRows, resolveIdentity,
} from './identity.js';

let pass = 0; const failures = [];
function ok(what, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(`${what}${detail ? ' — ' + detail : ''}`);
}
function eq(what, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(what, g === w, `got ${g}, wanted ${w}`);
}
function noThrow(what, fn) {
  try { fn(); pass++; } catch (e) { failures.push(`${what} threw ${e && e.message}`); }
}
async function noThrowAsync(what, fn) {
  try { await fn(); pass++; } catch (e) { failures.push(`${what} threw ${e && e.message}`); }
}

/* Lead 38, as the database holds him. */
const L38_EMAIL = 'shabbir53ujjainwala@gmail.com';
const L38_PHONE = '+918517942172';
const L38_CUS   = '918517942172@c.us';
const L38_LID   = '158510264357112@lid';
const L38_WA    = '+918517942172@whatsapp.lead';

const lead38 = { id: '38', name: 'Shabbir Ujjainwala', email: L38_EMAIL, phone: L38_PHONE };
/* The two rows that tie the handles to the email. A LID contains no phone
   digits, so this link is the ONLY thing that can attach it to a person. */
const links38 = [
  { chat_id: L38_CUS, phone: '918517942172', lead_email: L38_EMAIL, push_name: 'Shabbir' },
  { chat_id: L38_LID, thread_key: L38_EMAIL, lead_email: L38_EMAIL, phone: '', identified: 'lead' },
];

/* ── 1. keyShape / isHandle — the four shapes and the two WAHA extras ────── */

eq('keyShape email',        keyShape(L38_EMAIL), KEY_SHAPE.EMAIL);
eq('keyShape c.us',         keyShape(L38_CUS),   KEY_SHAPE.CUS);
eq('keyShape lid',          keyShape(L38_LID),   KEY_SHAPE.LID);
eq('keyShape whatsapp.lead',keyShape(L38_WA),    KEY_SHAPE.WA_LEAD);
eq('keyShape s.whatsapp.net', keyShape('918517942172@s.whatsapp.net'), KEY_SHAPE.WA_NET);
eq('keyShape g.us',         keyShape('120363043211234567@g.us'), KEY_SHAPE.GROUP);
eq('keyShape bare phone',   keyShape(L38_PHONE), KEY_SHAPE.PHONE);
eq('keyShape junk',         keyShape('Pardon Our Interruption'), KEY_SHAPE.UNKNOWN);
eq('keyShape empty',        keyShape(''), KEY_SHAPE.NONE);

ok('isHandle lid',   isHandle(L38_LID));
ok('isHandle c.us',  isHandle(L38_CUS));
ok('isHandle not email', !isHandle(L38_EMAIL));
ok('isHandle not whatsapp.lead', !isHandle(L38_WA),
   '@whatsapp.lead is synthesised from a phone, not a WhatsApp address');

/* ── 2. normalise: last-9 matching across +91, 00 and bare digits ────────── */

eq('suffix from +91',  phoneSuffix('+918517942172'),   '517942172');
eq('suffix from 0091', phoneSuffix('00918517942172'),  '517942172');
eq('suffix from bare', phoneSuffix('8517942172'),      '517942172');
eq('suffix from spaced', phoneSuffix('+91 85179 42172'), '517942172');

ok('+91 == 00 prefix',   sameIdentity('+918517942172', '00918517942172'));
ok('+91 == bare digits', sameIdentity('+918517942172', '8517942172'));
ok('+91 == c.us handle', sameIdentity('+918517942172', L38_CUS));
ok('c.us == whatsapp.lead', sameIdentity(L38_CUS, L38_WA));
ok('c.us == s.whatsapp.net', sameIdentity(L38_CUS, '918517942172@s.whatsapp.net'));

/* Two different people. 971501234567 is the other seeded number. */
ok('two different phones do NOT collide', !sameIdentity(L38_PHONE, '+971501234567'));
ok('different c.us handles do NOT collide', !sameIdentity(L38_CUS, '971501234567@c.us'));
eq('other number has its own suffix', phoneSuffix('+971501234567'), '501234567');

/* A LID's digits are a machine id. If they were compared as a phone number this
   would be true, and two unrelated people would be merged. */
ok('lid digits are never a phone number',
   !sameIdentity(L38_LID, '+158510264357112'),
   'a LID must not compare equal to the phone number spelled by its own digits');
ok('lid is opaque', normalizeKey(L38_LID).opaque);
ok('lid carries no phone suffix', normalizeKey(L38_LID).suffix === '');
ok('c.us is phone-derived', normalizeKey(L38_CUS).phoneDerived);

/* Canonical forms are namespaced so a 9-digit tail can never cross shapes. */
eq('canonical email', normalizeKey('  Shabbir53Ujjainwala@Gmail.com ').canonical, 'email:' + L38_EMAIL);
eq('canonical c.us',  normalizeKey(L38_CUS).canonical,  'phone:517942172');
eq('canonical lid',   normalizeKey(L38_LID).canonical,  'lid:158510264357112');

/* A number too short for the backend's rule is flagged, not silently matched. */
const short = normalizeKey('0501234');
ok('short phone is weak', short.weak && short.usable);
ok('short phone says why', /fewer than the 9/.test(short.reason), short.reason);
ok('short phones do not all match each other', !sameIdentity('0501234', '0509999'));

/* ── 3. null / empty / malformed never throw ─────────────────────────────── */

const junk = [null, undefined, '', '   ', 0, NaN, {}, [], true, '@lid', '@c.us', '@', 'null',
              'not an email@', '+', '@@@', 'NX-1010', { toString() { throw new Error('boom'); } }];
junk.forEach(v => {
  noThrow(`keyShape(${String(v && v.toString ? '<obj>' : v)})`, () => keyShape(v));
  noThrow('normalizeKey(junk)', () => normalizeKey(v));
  noThrow('describeKey(junk)', () => describeKey(v));
  noThrow('sameIdentity(junk, junk)', () => sameIdentity(v, v));
  noThrow('expandIdentity(junk)', () => expandIdentity(v));
  noThrow('personFilter(junk)', () => personFilter(v));
  noThrow('personQuery(junk)', () => personQuery('communication_logs', v));
});
ok('empty never equals empty', !sameIdentity('', ''));
ok('null never equals null', !sameIdentity(null, null));
ok('"@lid" is unusable', !normalizeKey('@lid').usable);
ok('empty seed is not ok', !expandIdentity(null).ok);
ok('empty seed says why', /identifies a person/.test(expandIdentity(null).warnings[0] || ''));
ok('empty seed builds no filter', personFilter(null).ok === false);
eq('empty seed builds no query', personQuery('communication_logs', null), '');

/* ── 4. expand: all four shapes for lead 38 resolve together ─────────────── */

const id38 = expandIdentity(lead38, { links: links38, leads: [lead38] });
ok('lead 38 resolves', id38.ok);
eq('lead 38 personKey', id38.personKey, L38_EMAIL);
eq('lead 38 personKey basis', id38.personKeyBasis, 'lower(email)');
eq('lead 38 displayName is a name', id38.displayName, 'Shabbir Ujjainwala');
eq('lead 38 suffix', id38.suffix, '517942172');
eq('lead 38 identified', id38.identified, 'lead');

const k38 = id38.keys;
ok('email key present',        k38.includes(L38_EMAIL), k38.join(' '));
ok('c.us key present',         k38.includes(L38_CUS), k38.join(' '));
ok('lid key present',          k38.includes(L38_LID), k38.join(' '));
ok('whatsapp.lead key present',k38.includes(L38_WA), k38.join(' '));
const shapes38 = new Set(k38.map(keyShape));
ok('all four shapes resolve together',
   [KEY_SHAPE.EMAIL, KEY_SHAPE.CUS, KEY_SHAPE.LID, KEY_SHAPE.WA_LEAD].every(s => shapes38.has(s)),
   [...shapes38].join(','));
ok('the lid is marked as coming from a link',
   id38.keyDetail.find(d => d.key === L38_LID).via === 'link');
ok('the whatsapp.lead key is marked synthetic',
   id38.keyDetail.find(d => d.key === L38_WA).synthetic === true);
ok('lead 38 is not ambiguous', !id38.ambiguous, JSON.stringify(id38.ambiguity));
ok('no group id is ever queried as a person',
   !expandIdentity({ email: L38_EMAIL },
     { links: [{ chat_id: '120363043211234567@g.us', lead_email: L38_EMAIL }] })
     .keys.some(k => keyShape(k) === KEY_SHAPE.GROUP));

/* ── 5. an email seed and a phone seed expand to the same set ────────────── */

const byEmail = expandIdentity({ email: L38_EMAIL }, { links: links38, leads: [lead38] });
const byPhone = expandIdentity({ phone: L38_PHONE }, { links: links38, leads: [lead38] });
const byChat  = expandIdentity({ chatId: L38_CUS },  { links: links38, leads: [lead38] });
const byLid   = expandIdentity({ key: L38_LID },     { links: links38, leads: [lead38] });

eq('email seed and phone seed give the same keys', byEmail.keys, byPhone.keys);
eq('email seed and chat seed give the same keys',  byEmail.keys, byChat.keys);
eq('email seed and LID seed give the same keys',   byEmail.keys, byLid.keys);
eq('and the same set the lead row gave',           byEmail.keys, id38.keys);
eq('every seed lands on the same personKey',
   [byEmail.personKey, byPhone.personKey, byChat.personKey, byLid.personKey],
   [L38_EMAIL, L38_EMAIL, L38_EMAIL, L38_EMAIL]);

/* A LID with nothing linking it to anybody expands to itself and no further —
   the digits cannot be turned into a phone number. */
const loneLid = expandIdentity({ key: L38_LID });
eq('an unlinked LID expands to itself only', loneLid.keys, [L38_LID]);
eq('an unlinked LID has no phone suffix', loneLid.suffix, '');

/* ── 6. two different people who share a phone suffix ────────────────────── */

const twin = { id: '99', name: 'Someone Else', email: 'other@example.com', phone: '+448517942172' };
eq('the two numbers really do share a suffix',
   [phoneSuffix(lead38.phone), phoneSuffix(twin.phone)], ['517942172', '517942172']);
ok('but they are not the same number', lead38.phone !== twin.phone);

const collided = expandIdentity(lead38, { links: links38, leads: [lead38, twin] });
ok('a shared suffix raises the ambiguity flag', collided.ambiguous);
ok('and names the collision', collided.ambiguityCodes.includes(AMBIGUITY.PHONE_SUFFIX_COLLISION));
ok('and lists both addresses',
   collided.ambiguity[0].keys.includes('other@example.com') && collided.ambiguity[0].keys.includes(L38_EMAIL),
   JSON.stringify(collided.ambiguity[0].keys));
ok('the other person is NOT merged in', !collided.keys.includes('other@example.com'));
ok('and no key is inferred from the shared number',
   !collided.keys.some(k => k.endsWith('@whatsapp.lead')),
   collided.keys.join(' '));

/* Seeded with the phone alone there is nothing to break the tie at all. */
const blind = expandIdentity({ phone: '+918517942172' }, { leads: [lead38, twin] });
ok('a phone-only seed over two owners is ambiguous', blind.ambiguous);
ok('and adopts neither email', !blind.email, blind.email);

/* A contact row filed under a different email, reached only by the last-9 rule. */
const crossLink = expandIdentity(lead38, {
  links: [{ chat_id: '448517942172@c.us', phone: '448517942172', lead_email: 'other@example.com' }],
});
ok('a phone-matched link with a foreign email is refused', crossLink.ambiguous);
ok('and the foreign email is not adopted', !crossLink.keys.includes('other@example.com'));

/* One handle, two owners: real, and different from a suffix collision. */
const shared = expandIdentity({ email: L38_EMAIL }, {
  links: [
    { chat_id: L38_CUS, lead_email: L38_EMAIL },
    { chat_id: L38_CUS, lead_email: 'spouse@example.com' },
  ],
});
ok('one handle under two emails is ambiguous', shared.ambiguous);
ok('and is reported as a second email, not a suffix collision',
   shared.ambiguityCodes.includes(AMBIGUITY.MULTIPLE_EMAILS), shared.ambiguityCodes.join(','));
ok('the shared handle is still read under', shared.keys.includes(L38_CUS), shared.keys.join(' '));
ok('but the second address is not adopted as a key',
   !shared.keys.includes('spouse@example.com'), shared.keys.join(' '));
ok('and the flag names it so a human can decide',
   (shared.ambiguity[0].keys || []).includes('spouse@example.com'));

/* The flag must stay off when nothing is actually ambiguous. */
const clean = expandIdentity({ email: 'buyer@example.com' },
  { leads: [{ id: '7', email: 'buyer@example.com', phone: '+971501234567' }] });
ok('a clean single owner is not flagged', !clean.ambiguous, JSON.stringify(clean.ambiguity));
ok('and the unrelated lead 38 is nowhere in it', !clean.keys.includes(L38_EMAIL));

/* ── 6b. a lead whose email is the empty string ──────────────────────────────
   Lead 35 is real and its `email` column holds '' — not null, not absent. The
   collision test above used to count DISTINCT EMAILS among the suffix-matching
   leads, so lead 35 counted as nobody: seeded with it against a second lead
   ending 505433953 the module returned leadIds ['35','99'], ambiguous:false and
   the OTHER lead's address adopted as lead 35's own, which is one customer's
   conversation filed under another customer's name with nothing on screen to
   say so. The rule now counts people: an email where there is one, a lead id
   where there is not.

   Every phone below really shares its last nine digits; the four cases differ
   only in what the leads' email columns hold. */

const L35_PHONE = '+971505433953';
const lead35    = { id: '35', name: 'Effco Contracting llc', email: '', phone: L35_PHONE };
const other35   = { id: '99', name: 'Someone Else', email: 'other@example.com', phone: '+44505433953' };
const nameless  = { id: '77', name: 'Walk-in', email: '', phone: '+44505433953' };

eq('lead 35 and the twin share a suffix',
   [phoneSuffix(lead35.phone), phoneSuffix(other35.phone)], ['505433953', '505433953']);

/* One empty email. The case that was silently adopting an address. */
const emptyOne = expandIdentity(lead35, { leads: [lead35, other35] });
ok('an email-less lead colliding with an addressed one is ambiguous', emptyOne.ambiguous,
   JSON.stringify(emptyOne.ambiguityCodes));
ok('and names it a suffix collision',
   emptyOne.ambiguityCodes.includes(AMBIGUITY.PHONE_SUFFIX_COLLISION));
eq('and the other lead is NOT merged in', emptyOne.leadIds, ['35']);
ok('and above all its address is not adopted', !emptyOne.email, emptyOne.email);
ok('and never becomes a query key', !emptyOne.keys.includes('other@example.com'),
   emptyOne.keys.join(' '));
ok('and the email-less lead is named in the flag so a human can tell them apart',
   ((emptyOne.ambiguity[0] || {}).keys || []).some(k => /lead 35/.test(k)),
   JSON.stringify((emptyOne.ambiguity[0] || {}).keys));
ok('a collided read is refused rather than issued',
   !personFilter(emptyOne).ok, personFilter(emptyOne).filter);

/* Both empty. Two rows with no email are still two different people — there is
   nothing in the database that says otherwise. */
const emptyBoth = expandIdentity(lead35, { leads: [lead35, nameless] });
ok('two email-less leads on one suffix are ambiguous', emptyBoth.ambiguous,
   JSON.stringify(emptyBoth.ambiguityCodes));
eq('and neither absorbs the other', emptyBoth.leadIds, ['35']);

/* Seeded with the number alone, with no lead id to say which row is ours. */
const emptyBlind = expandIdentity({ phone: L35_PHONE }, { leads: [lead35, other35] });
ok('a phone-only seed over an email-less lead and an addressed one is ambiguous',
   emptyBlind.ambiguous, JSON.stringify(emptyBlind.ambiguityCodes));
ok('and adopts no address', !emptyBlind.email, emptyBlind.email);

/* OVER-REFUSING IS ALSO A DEFECT. Two lead rows under one address are one human
   being — a duplicate row, which this database has — and refusing there would
   blank a legitimate customer's history just as surely as merging blanks the
   truth. Counting rows instead of people would fail here. */
const dupA = { id: '35', email: 'dup@example.com', phone: L35_PHONE };
const dupB = { id: '36', email: 'dup@example.com', phone: '+44505433953' };
const sameOwner = expandIdentity(dupA, { leads: [dupA, dupB] });
ok('two lead rows under one address are one person, not a collision',
   !sameOwner.ambiguous, JSON.stringify(sameOwner.ambiguity));
ok('and both rows are absorbed', sameOwner.leadIds.includes('35') && sameOwner.leadIds.includes('36'),
   sameOwner.leadIds.join(','));
ok('and the suffix rule is still applied to the read',
   personFilter(sameOwner).patterns.some(p => p.includes('505433953')),
   JSON.stringify(personFilter(sameOwner).patterns));

/* And the live shape: lead 35 alone on its suffix, which is the whole leads
   table today. An email-less lead that collides with nobody must still read. */
const lone35 = expandIdentity(lead35, { leads: [lead35] });
ok('an email-less lead alone on its suffix is not flagged', !lone35.ambiguous,
   JSON.stringify(lone35.ambiguity));
ok('and is still read under its WhatsApp keys',
   lone35.keys.includes('971505433953@c.us'), lone35.keys.join(' '));
ok('and its filter still applies the last-9 rule',
   personFilter(lone35).filter.includes('*505433953@c.us'), personFilter(lone35).filter);

/* The same blind spot from the link side: `emailCanon &&` guarded that refusal
   too, so an email-less person could be handed a foreign address by a contact
   row it had only ever matched on nine digits. */
const emptyCross = expandIdentity(lead35, {
  links: [{ chat_id: '44505433953@c.us', phone: '44505433953', lead_email: 'other@example.com' }],
});
ok('a phone-matched link may not name an email-less person either',
   emptyCross.ambiguous, JSON.stringify(emptyCross.ambiguityCodes));
ok('and its address is not adopted', !emptyCross.email, emptyCross.email);
ok('nor is its number', !emptyCross.keys.some(k => k.includes('44505433953')),
   emptyCross.keys.join(' '));

/* But a contact row carrying the SAME full number is how an email-less person
   legitimately learns their own address. Refusing that would be over-refusal. */
const sameNumberLink = expandIdentity(lead35, {
  links: [{ chat_id: '971505433953@c.us', phone: '971505433953', lead_email: 'effco@example.com' }],
});
ok('a contact row on the same full number is still absorbed', !sameNumberLink.ambiguous,
   JSON.stringify(sameNumberLink.ambiguity));
eq('and hands the email-less lead its address', sameNumberLink.email, 'effco@example.com');

/* ── 7. the query helper ─────────────────────────────────────────────────── */

const f = personFilter(id38);
ok('filter is usable', f.ok);
ok('filter is an or()', f.filter.startsWith('or=('), f.filter);
ok('filter matches case-insensitively', /ilike/.test(f.filter));
ok('filter carries the email', f.filter.includes(encodeURIComponent(L38_EMAIL)), f.filter);
ok('filter carries the LID', f.filter.includes(encodeURIComponent(L38_LID)), f.filter);
ok('filter applies the last-9 rule', f.filter.includes('*517942172@c.us'), f.filter);
ok('and to whatsapp.lead too', f.filter.includes('*517942172@whatsapp.lead'), f.filter);
ok('but NEVER as a lid pattern', !f.filter.includes('@lid') || !/\*517942172@lid/.test(f.filter));
ok('values are quoted for PostgREST', f.filter.includes('%22'), f.filter);

const q = personQuery('communication_logs', id38, {
  select: 'channel,direction,message,created_at', order: 'created_at.desc', limit: 50,
});
ok('query names the table', q.startsWith('communication_logs?'), q);
ok('query keeps select first', q.includes('select=channel,direction,message,created_at'), q);
ok('query keeps order and limit', q.includes('&order=created_at.desc&limit=50'), q);
ok('query is a single PostgREST path', !q.includes(' '), q);

/* A collision must not widen the read: exact keys only, and the reason said. */
const cf = personFilter(collided);
ok('a collision drops the suffix patterns', !cf.filter.includes('*517942172'), cf.filter);
ok('and says why', /shared by more than one lead/.test(cf.note), cf.note);

/* An address with PostgREST-structural characters in it must not break out. */
const nasty = personFilter({ keys: ['a,b(c)"d\\e@example.com'] });
ok('a comma in a key is encoded', !nasty.filter.includes(','), nasty.filter);
ok('a parenthesis in a key is encoded',
   nasty.filter.slice(3).replace(/\)$/, '').indexOf('(') === -1, nasty.filter);
/* `nasty` is a lone key, so it is a horizontal filter, and there a double quote
   is DATA to PostgREST rather than quoting — percent-encoding is what stops it
   ending the value. Inside an or=() the same quote has to be backslash-escaped
   for the logic parser instead. Both spellings are asserted, because the two
   contexts are the thing this module kept getting wrong. */
ok('a quote in a lone key is encoded, never left bare',
   nasty.filter.includes('%22') && !nasty.filter.includes('"'), nasty.filter);
ok('a quote inside an or() is escaped for the logic parser',
   personFilter({ keys: ['we"ird@example.com', 'other@example.com'] }).filter.includes('%5C%22'),
   personFilter({ keys: ['we"ird@example.com', 'other@example.com'] }).filter);

/* A single key still produces a valid horizontal filter, not a one-armed or().
   It is NOT %22-quoted, and that is the correction of 1 Sep 2026 rather than a
   loosening: verified against the live PostgREST, a horizontal filter takes its
   value verbatim — `col=eq."a_b"` reaches Postgres as `"a_b"`, quotes included —
   while `or=(col.eq."a_b")` reaches it as `a_b`. Quoting is only read as quoting
   inside in.() / or=() / and=(). The quotes this used to emit were therefore
   matched as two literal characters of the address, so a customer with exactly
   one key and no phone number read back an empty history. */
const one = personFilter({ email: 'nobody@example.com' }, { suffix: false });
eq('a single key uses a plain unquoted filter', one.filter, `lead_email=ilike.nobody%40example.com`);

/* The column is not hardcoded — kyc_documents has the same four-shape problem. */
ok('the column is configurable',
   personFilter(id38, { column: 'chat_id' }).filter.includes('chat_id.ilike.'));

/* ── 7b. `%` and `_` are wildcards to ILIKE, and an address may contain them ─

   The hole this section closes: quoteValue escaped `"` and `\` and neither `%`
   nor `_`, so `john_smith@x.com` went to PostgREST as a PATTERN and came back
   with `johnXsmith@x.com`'s messages inside it. Reported by the agent who fixed
   screens/customers.js, which defends its own call site with a row-level
   re-check; the escape belongs here so every consumer gets it.

   These assert on MATCHING rather than on spelling, because the spelling is
   exactly what nobody could check by eye. Each helper replays one stage of the
   real pipeline, in the order the live database applies them — the behaviour of
   every stage was confirmed against the live PostgREST and Postgres on
   1 Sep 2026, not assumed from the documentation. */

/* Stage 1, only inside a quoted or=() term: PostgREST's logic parser yields the
   character after a backslash, so `\_` arrives as a bare `_` and `\\_` as `\_`. */
const unquoteLogic = s => s.replace(/\\(.)/g, '$1');
/* Stage 2: for like/ilike PostgREST rewrites `*` to `%` before SQL sees it —
   which is why the suffix patterns below are written with `*`. */
const starToPct = s => s.replace(/\*/g, '%');

/* Every ilike value in a filter, decoded to the pattern SQL would receive. */
function sqlPatterns(res) {
  const valueOf = t => t.slice(t.indexOf('.ilike.') + '.ilike.'.length);
  const decode = v => (v.startsWith('%22')
    ? unquoteLogic(decodeURIComponent(v.slice(3, -3)))   /* an or=() term: quoted */
    : decodeURIComponent(v));                            /* a horizontal filter: verbatim */
  if (res.filter.startsWith('or=(')) {
    return res.filter.slice(4, -1).split(',').map(t => starToPct(decode(valueOf(t))));
  }
  return [starToPct(decodeURIComponent(res.filter.slice(res.filter.indexOf('=ilike.') + '=ilike.'.length)))];
}

/* Stage 3: SQL LIKE itself. `%` is any run, `_` is any one character, and a
   backslash makes the next character literal — the semantics proved on the live
   database with `select 'axb' ilike 'a\_b'` -> false. */
function likeMatches(pattern, value) {
  const lit = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { const n = pattern[++i]; re += n === undefined ? '\\\\' : lit(n); continue; }
    if (c === '%') { re += '.*'; continue; }
    if (c === '_') { re += '.'; continue; }
    re += lit(c);
  }
  return new RegExp('^' + re + '$', 'i').test(value);
}
/* Does the filter built for `key` match `candidate` under any of its terms? */
const filterMatches = (res, candidate) => sqlPatterns(res).some(p => likeMatches(p, candidate));

/* The helper is only trustworthy if it can still see a wildcard when there is
   one, so prove it fails open before relying on it to prove anything negative. */
ok('the LIKE simulator treats a bare _ as a wildcard', likeMatches('a_b', 'axb'));
ok('the LIKE simulator treats a bare % as a wildcard', likeMatches('a%b', 'axxxb'));
ok('the LIKE simulator honours a backslash escape', !likeMatches('a\\_b', 'axb'));
ok('and still matches the literal it escaped', likeMatches('a\\_b', 'a_b'));

/* The addresses. An underscore is ordinary in an email address; the others are
   rarer but all are legal, and `\` and `"` really do appear in the free-text
   `lead_email` column because three different systems write to it. */
const UND  = 'john_smith@example.com';
const NEAR = 'johnXsmith@example.com';          /* differs ONLY where the _ is */
const PCT  = 'jane%doe@example.com';
const PNEAR= 'janeQQQQdoe@example.com';         /* what a bare % would drag in */
const BOTH = 'a_b%c@example.com';
const QUO  = 'we"ird@example.com';
const BSL  = 'back\\slash@example.com';
const BNEAR= 'backXslash@example.com';

/* A lone key takes the horizontal-filter path; a second key forces the or=()
   path. Both are exercised for every address, because the two encode
   differently and only one of them was ever right. */
const lone = k => personFilter({ keys: [k] }, { suffix: false });
const ored = k => personFilter({ keys: [k, 'someone.else@example.com'] }, { suffix: false });

[['horizontal', lone], ['or()', ored]].forEach(([where, build]) => {
  ok(`an underscore address matches itself — ${where}`,
     filterMatches(build(UND), UND), sqlPatterns(build(UND)).join(' | '));
  ok(`and NOT the neighbour the wildcard would have caught — ${where}`,
     !filterMatches(build(UND), NEAR), sqlPatterns(build(UND)).join(' | '));

  ok(`a percent address matches itself — ${where}`,
     filterMatches(build(PCT), PCT), sqlPatterns(build(PCT)).join(' | '));
  ok(`and NOT an unrelated address the % would have spanned — ${where}`,
     !filterMatches(build(PCT), PNEAR), sqlPatterns(build(PCT)).join(' | '));

  ok(`an address with BOTH wildcards matches itself — ${where}`,
     filterMatches(build(BOTH), BOTH), sqlPatterns(build(BOTH)).join(' | '));
  ok(`and does not become a pattern — ${where}`,
     !filterMatches(build(BOTH), 'aXbYYYc@example.com'), sqlPatterns(build(BOTH)).join(' | '));

  ok(`a double quote in an address survives to SQL — ${where}`,
     filterMatches(build(QUO), QUO), sqlPatterns(build(QUO)).join(' | '));
  ok(`a backslash in an address survives to SQL — ${where}`,
     filterMatches(build(BSL), BSL), sqlPatterns(build(BSL)).join(' | '));
  ok(`and a backslash does not escape the character after it — ${where}`,
     !filterMatches(build(BSL), BNEAR), sqlPatterns(build(BSL)).join(' | '));
});

/* The whole point, stated as the two customers it protects: two people whose
   addresses differ only where one of them has a wildcard character must never
   match each other, in either direction. This is the assertion that would have
   failed before today's fix. */
ok('customer A does not match customer B', !filterMatches(lone(UND), NEAR));
ok('customer B does not match customer A', !filterMatches(lone(NEAR), UND));
ok('nor through the or() path, A to B', !filterMatches(ored(UND), NEAR));
ok('nor through the or() path, B to A', !filterMatches(ored(NEAR), UND));
ok('and each still finds itself, A', filterMatches(lone(UND), UND));
ok('and each still finds itself, B', filterMatches(lone(NEAR), NEAR));

/* The escape must not eat the suffix patterns, which are the one place a `*`
   is deliberate. They are appended raw, never run through likeEscape. */
const wild = personFilter(id38);
ok('the last-9 patterns keep their leading *', wild.filter.includes('*517942172@c.us'), wild.filter);
ok('and still match a real chat id', filterMatches(wild, '918517942172@c.us'),
   sqlPatterns(wild).join(' | '));
ok('while a foreign number is still refused', !filterMatches(wild, '971501234567@c.us'),
   sqlPatterns(wild).join(' | '));

/* OVER-ESCAPING IS THE SAME BUG POINTING THE OTHER WAY. `eq` compares literally,
   so `%` and `_` are ordinary characters there — escaping them would stop an
   address matching itself, and underscores are common in email addresses.
   resolveIdentity's reads are all `eq`, and they must stay unescaped. */
const eqPaths = [];
await resolveIdentity({ email: UND, chatId: 'a_b@c.us' },
  { db: async path => { eqPaths.push(path); return []; } });
ok('an eq read percent-encodes the address',
   eqPaths.some(p => p.includes('email=eq.' + encodeURIComponent(UND))), eqPaths.join('\n'));
ok('and does NOT backslash-escape the underscore',
   !eqPaths.some(p => /%5C/i.test(p)), eqPaths.join('\n'));
ok('an eq read on a chat id is left alone too',
   eqPaths.some(p => p.includes('chat_id=eq.a_b%40c.us')), eqPaths.join('\n'));

/* ── 8. fetchPersonRows goes through db() ────────────────────────────────── */

let issued = '';
const rows = await fetchPersonRows('communication_logs', id38, {
  select: 'id,message', order: 'created_at.desc', limit: 50,
  db: async path => { issued = path; return [{ id: 1 }, { id: 2 }]; },
});
eq('fetchPersonRows returns the rows', rows.length, 2);
ok('and issues one path through db()', issued.startsWith('communication_logs?select=id,message&or=('), issued);
await noThrowAsync('fetchPersonRows on an empty identity rejects rather than reading everything',
  async () => {
    let called = false;
    try {
      await fetchPersonRows('communication_logs', null, { db: async () => { called = true; return []; } });
      failures.push('fetchPersonRows(null) resolved instead of refusing');
    } catch (e) {
      ok('it refused with a reason', /No usable identity key/.test(e.message), e.message);
      ok('and never touched the database', !called);
    }
  });

/* ── 9. partial: what the view counts vs what we read ────────────────────── */

eq('counts start unknown', [id38.counts.expected, id38.counts.fetched, id38.partial], [null, null, false]);
const full  = withCounts(id38, { expected: 66, fetched: 66 });
const short2 = withCounts(id38, { expected: 66, fetched: 20 });
ok('a complete read is not partial', !full.partial);
ok('a short read IS partial', short2.partial);
ok('withCounts does not mutate', id38.counts.expected === null);
ok('an unknown expected count is never partial', !withCounts(id38, { fetched: 20 }).partial);

/* ── 10. resolveIdentity — the async form, against a stub db ─────────────── */

const stub = async path => {
  if (path.startsWith('leads?')) return [lead38];
  if (path.startsWith('v_conversations?')) return [{ ...links38[0], message_count: 66, identified: 'lead' }];
  if (path.startsWith('v_customer_directory?')) return [{ email: L38_EMAIL, name: 'Shabbir Ujjainwala', phone: L38_PHONE }];
  if (path.startsWith('whatsapp_contacts?')) throw new Error('503 — contacts unavailable');
  return [];
};
const resolved = await resolveIdentity({ email: L38_EMAIL }, { db: stub });
eq('resolveIdentity finds the person', resolved.personKey, L38_EMAIL);
ok('and reads under every shape', resolved.keys.includes(L38_CUS) && resolved.keys.includes(L38_WA),
   resolved.keys.join(' '));
eq('and carries the expected message count', resolved.counts.expected, 66);
eq('a failed source is err, not absent', resolved.sources.contacts, 'absent');
eq('a source that answered is ok', resolved.sources.leads, 'ok');
ok('a failed read records its message',
   !resolved.errors.contacts || /503/.test(resolved.errors.contacts));

const downed = await resolveIdentity({ email: L38_EMAIL }, {
  db: async () => { throw new Error('500 — PostgREST is down'); },
});
eq('every source failing is reported as err',
   [downed.sources.leads, downed.sources.conversations, downed.sources.directory],
   ['err', 'err', 'err']);
ok('and the seed email still produces a key', downed.keys.includes(L38_EMAIL));
ok('a total failure is never reported as an absence',
   /500/.test(downed.errors.leads || ''), JSON.stringify(downed.errors));

/* ── report ──────────────────────────────────────────────────────────────── */

console.log(`\nidentity.js — ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach(f2 => console.log('  FAIL  ' + f2));
  process.exitCode = 1;
} else {
  console.log('  all assertions passed\n');
}
