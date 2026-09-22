/* NEXUS OS — lib/privacy.js
   Added 22 Sep 2026. Two things a dealership needs before it can put this app on
   a shared screen, owned in one place so no screen has to remember either.

   1. PRIVACY MODE. Off by default, remembered per browser (lib/prefs.js). When
      on, every customer's name is shown as a stable pseudonym ("Customer K42"),
      phone numbers keep only their last two digits and emails keep their first
      letter and domain. The pseudonym is a hash of the name, so the same person
      carries the same label on every screen and in every message preview.

      It works at two levels, on purpose:
        - displayName() / maskPhone() / maskEmail() / maskText() are the helpers
          a screen calls where it prints a customer's name or contact details;
        - installPrivacyGuard() is the safety net under them. Every name, phone
          and email this browser reads from a customer-bearing relation is
          registered by scrubRows() (called from lib/data.js db()), and a
          MutationObserver replaces any registered value, and any phone- or
          email-shaped string, in text and tooltips as it is painted. Form
          fields are never rewritten (that would save the pseudonym back to the
          record); a field holding a registered value is blurred instead.

   2. INTERNAL TEST RECORDS. Rows whose name marks them as a NEXUS test fixture
      are dropped from every read in scrubRows(), before any screen can list or
      count them, unless Settings > "Show internal test records" is on. The
      lead ids dropped are remembered, so a row that only carries a lead_id
      (a recovery action, a thread) is dropped with its lead. */
import { readFlag, writeFlag } from './prefs.js';

const PRIVACY_KEY = 'nexus.privacy';
const TESTS_KEY   = 'nexus.showTestRecords';

const TEST_RECORD_RE = /^NEXUS TEST|\[NXTEST-|\[step4-|^Preflight /i;
/* The same markers anywhere in a string: a title, label or journey note that a
   view composed server-side around a test fixture's name. */
const TEST_TOKEN_RE = /NEXUS TEST|NXTEST-|\[step4-|\bPreflight\b/i;
const isTestName = v => typeof v === 'string' && TEST_RECORD_RE.test(v.trim());
const hasTestToken = v => typeof v === 'string' && TEST_TOKEN_RE.test(v);

let privacy = readFlag(PRIVACY_KEY, false);
let showTests = readFlag(TESTS_KEY, false);
const listeners = new Set();

const privacyOn = () => privacy;
const showTestRecords = () => showTests;
function setPrivacy(on) {
  privacy = !!on; writeFlag(PRIVACY_KEY, privacy);
  document.body.classList.toggle('privacy-on', privacy);
  listeners.forEach(fn => { try { fn(privacy); } catch { /* a listener must not stop the toggle */ } });
}
function setShowTestRecords(on) {
  showTests = !!on; writeFlag(TESTS_KEY, showTests);
  listeners.forEach(fn => { try { fn(privacy); } catch { /* as above */ } });
}
const onPrivacyChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/* ── Pseudonyms ────────────────────────────────────────────────────────── */
const norm = v => String(v == null ? '' : v).normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
function hash(s) {                       // FNV-1a, 32 bit. Stable, not secret.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const pseudonym = key => {
  const h = hash(norm(key) || String(key));
  return `Customer ${String.fromCharCode(65 + (h % 26))}${(h >>> 5) % 100}`;
};

/* ── The registry of values seen on customer-bearing rows ──────────────── */
const NAMES  = new Map();   // lower-cased surface form -> pseudonym
const TOKENS = new Map();   // lower-cased word of a multi-word name -> that name's pseudonym
/* Words that are also this app's own vocabulary, or too common to be a person,
   are never masked on their own (the full name still is). */
const STOP = new Set(('customer customers lead leads test sales service motors motor cars auto autos trading '
  + 'general company group llc fze fzco est establishment the and new used walk unknown contact dealer '
  + 'dealership showroom team manager admin owner support info office store shop centre center '
  /* 22 Sep 2026: channel and product names. A WhatsApp contact saved as
     "WhatsApp customer 2172" made the word WhatsApp itself a masked token,
     so the Integrations screen read "Your own Customer X21 Business number". */
  + 'whatsapp facebook instagram messenger google website web email mail phone call calls sms slack '
  + 'bitrix bitrix24 zoho hubspot salesforce odoo business form forms ads api nexus uae dubai sharjah').split(' '));
/* Staff (the signed-in user and the team roster) are never masked: Privacy mode
   hides customers, not the people using the app. */
const STAFF = new Set();   // lower-cased full names and their words
const PHONES = new Set();   // digit strings, 7+ digits
const EMAILS = new Set();   // lower-cased
let pattern = null;         // rebuilt lazily when the registry grows

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function registerName(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s.length < 3 || isTestName(s) || hasTestToken(s) || STAFF.has(s.toLowerCase())) return;
  const label = pseudonym(s);
  const add = form => {
    const k = form.trim().toLowerCase();
    if (k.length >= 3 && !NAMES.has(k)) { NAMES.set(k, label); pattern = null; }
  };
  add(s);
  const plain = s.replace(/[^\p{L}\p{N}\s'.-]+/gu, ' ').replace(/\s+/g, ' ').trim();   // "HaMza💫" -> "HaMza"
  if (plain !== s) add(plain);
  /* Every distinctive word of a multi-word name, so a preview that names only
     part of it ("Hi Ammar", "Mustafa Fefco …") is masked whole: a run of these
     words becomes ONE pseudonym, never "Customer A7 Fefco". */
  const words = plain.split(' ').filter(w => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w.toLowerCase()) && !STAFF.has(w.toLowerCase()));
  if (plain.includes(' ')) for (const w of words) { const k = w.toLowerCase(); if (!TOKENS.has(k) && !NAMES.has(k)) { TOKENS.set(k, label); pattern = null; } }
}
function registerStaffName(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s.length < 2) return;
  const forms = [s, ...s.split(/\s+/).filter(w => w.length >= 3)];
  for (const f of forms) { if (!STAFF.has(f)) STAFF.add(f); if (NAMES.delete(f) | TOKENS.delete(f)) pattern = null; }
}
function registerPhone(raw) {
  const d = String(raw || '').replace(/\D+/g, '');
  if (d.length >= 7 && !PHONES.has(d)) { PHONES.add(d); pattern = null; }
}
function registerEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s.includes('@') && !EMAILS.has(s)) { EMAILS.add(s); pattern = null; }
}
const isKnownPerson = name => typeof name === 'string' && NAMES.has(name.trim().toLowerCase());

/* ── The helpers screens call ──────────────────────────────────────────── */
function displayName(name, id) {
  if (!privacy) return name == null ? '' : String(name);
  const key = (typeof name === 'string' && name.trim()) ? name : id;
  if (key == null || key === '') return name == null ? '' : String(name);
  return (typeof name === 'string' && NAMES.get(name.trim().toLowerCase())) || pseudonym(key);
}
function maskPhone(v) {
  if (!privacy || v == null || v === '') return v == null ? '' : String(v);
  const d = String(v).replace(/\D+/g, '');
  return d.length < 3 ? '••' : `•••• ••${d.slice(-2)}`;
}
function maskEmail(v) {
  if (!privacy || v == null || v === '') return v == null ? '' : String(v);
  const s = String(v); const at = s.indexOf('@');
  if (at < 1) return '•••';
  return `${s[0]}***${s.slice(at)}`;
}
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/* International (+…), 00971/971, and UAE mobiles written locally: 05X XXX XXXX
   and the bare nine digits 5X XXX XXXX. Separators are spaces or hyphens only,
   so amounts (commas), dates and ids (letters) are never touched. */
const PHONE_RE = /(?<![\p{L}\p{N}+])(?:\+\d[\d\s-]{6,17}\d|(?:00)?971[\d\s-]{7,11}\d|0?5\d(?:[\s-]?\d){7})(?![\p{N}])/gu;
function buildPattern() {
  const safe = list => list.sort((a, b) => b.length - a.length).map(escRe).filter(x => {
    try { new RegExp(x, 'u'); return true; } catch { return false; }
  });
  const names = safe([...NAMES.keys()]), toks = safe([...TOKENS.keys()]);
  const unit = [...names, ...toks].join('|');
  /* A run of registered names/words, separated by spaces or light punctuation,
     is one match and one pseudonym. */
  pattern = unit ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${unit})(?:[\\s.'-]+(?:\\p{L}{1,3}[\\s.'-]+)?(?:${unit}))*(?![\\p{L}\\p{N}])`, 'giu') : /(?!)/g;
  return pattern;
}
const labelFor = m => {
  const words = m.toLowerCase().split(/[\s.'-]+/).filter(Boolean);
  for (let n = words.length; n > 0; n--) {          // the longest registered prefix names the person
    const k = words.slice(0, n).join(' ');
    if (NAMES.has(k)) return NAMES.get(k);
  }
  const k = m.toLowerCase();
  if (NAMES.has(k)) return NAMES.get(k);
  for (const w of words) if (TOKENS.has(w)) return TOKENS.get(w);
  return pseudonym(m);
};
/* Free text: a message preview, a tooltip, a sentence naming the customer.
   Every registered name is replaced by its pseudonym; phone- and email-shaped
   substrings are masked whether or not they were registered. */
function maskText(v) {
  if (!privacy || v == null) return v == null ? '' : String(v);
  let s = String(v);
  if (!s.trim()) return s;
  s = s.replace(EMAIL_RE, m => maskEmail(m));
  s = s.replace(PHONE_RE, m => maskPhone(m));
  if (PHONES.size) s = s.replace(/\d[\d\s-]{5,}\d/g, m => (PHONES.has(m.replace(/\D+/g, '')) ? maskPhone(m) : m));
  s = s.replace(pattern || buildPattern(), labelFor);
  return s;
}
/* Test-fixture markers in rendered text, while test records are hidden: the
   row filter drops what it can recognise, and this catches a fixture's name
   that a view folded into some other sentence. */
function maskTests(v) {
  if (showTests || v == null) return v == null ? '' : String(v);
  const s = String(v);
  if (!TEST_TOKEN_RE.test(s)) return s;
  return s
    .replace(/NEXUS TEST[^\[\]\n]{0,48}?\[[^\]\n]*\]/gi, 'Test record')
    .replace(/NEXUS TEST(?:[ \t]+[\p{L}\p{N}]+){0,2}/giu, 'Test record')
    .replace(/\[?(?:NXTEST|step4)-[^\]\s]*\]?/gi, '')
    .replace(/\bPreflight(?:[ \t]+[\p{L}\p{N}-]+)?/giu, 'Test record');
}
const scrubText = v => maskTests(maskText(v));
const maskPII = maskText;

/* ── The data-layer hook ───────────────────────────────────────────────── */
const NAME_FIELDS  = ['lead_name', 'customer_name', 'contact_name', 'display_name', 'full_name', 'push_name', 'sender_name', 'profile_name', 'customer_display_name',
  'customer_label', 'lead_label', 'contact_label', 'first_touch_name', 'person_name', 'who'];
/* Keys whose value may be a sentence built around a customer's name. A test
   marker in any of them marks the row as a test record. */
const TEXT_FIELD_RE = /name|label|title|subject|ref|summary|detail|note|display|customer|lead|who|person|chain|evidence/;
const PHONE_FIELDS = ['phone', 'phone_e164', 'phone_number', 'phone_digits', 'customer_phone', 'contact_phone', 'wa_id', 'customer_wa_id', 'recipient_wa_id', 'chat_id', 'from_number'];
const EMAIL_FIELDS = ['email', 'lead_email', 'customer_email', 'contact_email'];
/* `name` is a person only on these; elsewhere it is a unit, a workflow, a
   source or a member of staff, and masking those would hide the wrong thing. */
const PERSON_REL = /^(leads|customers?|customer_360_profiles|contacts?|nexus_sales_lead|v_(lead|customer|conversation|contact)[a-z0-9_]*)$/;
const NOT_PERSON_REL = /source|users|staff|team|member|tenant|integration|workflow|campaign|inventory|competitor/;
const HIDDEN_LEADS = new Set();
const HIDDEN_KEYS = new Set();

const relationOf = path => String(path || '').split('?')[0].replace(/^rpc\//, '').trim();

function rowIsTest(row, rel) {
  if (!row || typeof row !== 'object') return false;
  if (PERSON_REL.test(rel) && isTestName(row.name)) return true;
  for (const f of NAME_FIELDS) if (isTestName(row[f]) || hasTestToken(row[f])) return true;
  if (!NOT_PERSON_REL.test(rel)) for (const [k, v] of Object.entries(row)) {
    if (!TEXT_FIELD_RE.test(k)) continue;
    if (hasTestToken(v)) return true;
    if (v && typeof v === 'object' && hasTestToken(JSON.stringify(v).slice(0, 4000))) return true;
  }
  if (row.lead_id != null && HIDDEN_LEADS.has(String(row.lead_id))) return true;
  if (rel === 'leads' && row.id != null && HIDDEN_LEADS.has(String(row.id))) return true;
  return false;
}

function scrubRows(path, rows) {
  if (!Array.isArray(rows)) return rows;
  const rel = relationOf(path);
  const personRel = PERSON_REL.test(rel) && !NOT_PERSON_REL.test(rel);
  const leadRel = rel === 'leads' || /^v_lead/.test(rel);
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') { out.push(row); continue; }
    if (rowIsTest(row, rel)) {
      const lid = rel === 'leads' ? row.id : row.lead_id;
      if (lid != null && (leadRel || rel === 'leads')) HIDDEN_LEADS.add(String(lid));
      HIDDEN_KEYS.add(String(lid ?? row.id ?? row.thread_key ?? row.name ?? row.lead_name ?? row.display_name ?? JSON.stringify(row).slice(0, 80)));
      if (!showTests) continue;
    }
    if (/^(users|v_team[a-z0-9_]*|team[a-z0-9_]*|tenant_members?|nexus_team[a-z0-9_]*)$/.test(rel) || /roster|staff/.test(rel))
      for (const f of ['full_name', 'name', 'display_name', 'user_name', 'member_name']) registerStaffName(row[f]);
    if (row.users && typeof row.users === 'object') registerStaffName(row.users.full_name || row.users.name);
    if (!NOT_PERSON_REL.test(rel)) {
      if (personRel) registerName(row.name);
      registerFrom(row, 0);
    }
    out.push(row);
  }
  return out;
}
/* Name, phone and email keys at any depth: journey chains and evidence arrays
   carry the customer inside nested JSON. `users` (the assigned rep) is staff. */
function registerFrom(o, depth) {
  if (!o || typeof o !== 'object' || depth > 4) return;
  if (Array.isArray(o)) { for (const x of o.slice(0, 200)) registerFrom(x, depth + 1); return; }
  for (const f of NAME_FIELDS) if (typeof o[f] === 'string') registerName(o[f]);
  for (const f of PHONE_FIELDS) if (o[f] != null && typeof o[f] !== 'object') registerPhone(o[f]);
  for (const f of EMAIL_FIELDS) if (typeof o[f] === 'string') registerEmail(o[f]);
  for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && k !== 'users') registerFrom(v, depth + 1);
}
const isHiddenLead = id => !showTests && id != null && HIDDEN_LEADS.has(String(id));
const hiddenTestCount = () => HIDDEN_KEYS.size;

/* ── The safety net ────────────────────────────────────────────────────── */
const ORIGINAL = new Map();   // Text node / Element -> original text or title
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'NOSCRIPT']);
const ATTRS = ['title', 'aria-label', 'alt'];
/* An <option>'s label is what a closed <select> shows, so it is masked too. Its
   value is pinned first: an option with no value attribute submits its label,
   and the pseudonym must never be what a form sends. */
function maskOption(o) {
  const t = o.textContent; const m = scrubText(t);
  if (m === t) return;
  if (!o.hasAttribute('value')) o.setAttribute('value', o.value);
  const rec = ORIGINAL.get(o) || {}; if (rec.option == null) rec.option = t; ORIGINAL.set(o, rec);
  o.textContent = m;
}
const guardActive = () => privacy || !showTests;
function maskNode(root) {
  if (!guardActive() || !root) return;
  if (root.nodeType === 3) { maskTextNode(root); return; }
  if (root.nodeType !== 1 || root.closest?.('[data-privacy-exempt]')) return;
  if (root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
  const els = [root, ...root.querySelectorAll('*')];
  for (const e of els) {
    for (const a of ATTRS) {
      if (!e.hasAttribute || !e.hasAttribute(a)) continue;
      const t = e.getAttribute(a); const m = scrubText(t);
      if (m !== t) { const o = ORIGINAL.get(e) || {}; if (!(a in o)) o[a] = t; ORIGINAL.set(e, o); e.setAttribute(a, m); }
    }
    if (e.tagName === 'OPTION') maskOption(e);
    if (privacy && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && e.value && maskText(e.value) !== e.value) e.classList.add('pii-blur');
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement && (SKIP.has(n.parentElement.tagName) || n.parentElement.closest('[data-privacy-exempt]'))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach(maskTextNode);
}
function maskTextNode(n) {
  const t = n.nodeValue; if (!t || !t.trim()) return;
  const m = scrubText(t);
  if (m !== t) { if (!ORIGINAL.has(n)) ORIGINAL.set(n, { text: t }); n.nodeValue = m; }
}
function restoreAll() {
  for (const [n, o] of ORIGINAL) {
    if (!n.isConnected) continue;
    if (o.text != null) n.nodeValue = o.text;
    if (o.option != null) n.textContent = o.option;
    for (const a of ATTRS) if (o[a] != null) n.setAttribute(a, o[a]);
  }
  ORIGINAL.clear();
  document.querySelectorAll('.pii-blur').forEach(e => e.classList.remove('pii-blur'));
}

let observer = null;
function installPrivacyGuard(root = document.body) {
  document.body.classList.toggle('privacy-on', privacy);
  if (observer) return;
  observer = new MutationObserver(muts => {
    if (!guardActive()) return;
    for (const m of muts) try {
      if (m.type === 'characterData') {
        const o = m.target.parentElement;
        if (o && o.tagName === 'OPTION') maskOption(o); else maskTextNode(m.target);
      }
      else if (m.type === 'attributes') maskNode(m.target);
      else m.addedNodes.forEach(maskNode);
    } catch (e) { console.error('[NEXUS] privacy guard skipped a node:', e && e.message); }
    for (const n of ORIGINAL.keys()) if (!n.isConnected) ORIGINAL.delete(n);
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  onPrivacyChange(() => { restoreAll(); maskNode(root); });
  maskNode(root);
}

export {
  TEST_RECORD_RE, isTestName, privacyOn, setPrivacy, onPrivacyChange, showTestRecords, setShowTestRecords,
  pseudonym, displayName, registerStaffName, maskPhone, maskEmail, maskText, maskPII, maskTests, scrubText, hasTestToken, isKnownPerson, scrubRows, isHiddenLead,
  hiddenTestCount, installPrivacyGuard,
};
