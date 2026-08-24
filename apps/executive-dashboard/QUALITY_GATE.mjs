/* Quality gate for the enhanced screens.
 *
 * This is NOT the earlier equivalence test — the screens are supposed to differ
 * now. This checks the things that must stay true no matter what an agent did:
 *   1. the bundle builds — ACTUALLY builds. This header claimed it for days
 *      while the file only ever served whatever was already in ./dist/, so a
 *      run against 20-minute-old output reported green on code nobody had
 *      tested. A gate that grades a stale artefact is worse than no gate: it
 *      is a green light with no lamp behind it, which is the same fault the
 *      schema stub had. It builds first now, and refuses to run if it cannot.
 *   2. the app boots and still registers all 14 screens
 *   3. every screen renders with zero page errors
 *   4. every screen produces real content, and none collapses into its error state
 *   5. nobody invented data or reached outside the helper contract
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const SCREEN_IDS = ['overview', 'leads', 'conversations', 'compliance', 'inventory',
                    'competitors', 'ask', 'finance', 'customers', 'campaigns',
                    'deals', 'automation', 'team', 'settings'];

// ---------- 5. static lint over the source, before we even build --------------
const BANNED = [
  [/Math\.random\s*\(/,                 'Math.random() — invented data'],
  [/\bfetch\s*\(/,                      'raw fetch() — must go through db/dbWrite/n8n'],
  [/<style[\s>]/i,                      'inline <style> block — styles.css owns styling'],
  [/localStorage\./,                    'direct localStorage — lib/prefs.js owns that'],
  [/from\s+['"]https?:/,                'remote import'],
];
const lint = [];
const dir = new URL('./screens/', import.meta.url).pathname;
for (const f of (await readdir(dir)).filter(f => f.endsWith('.js'))) {
  const src = await readFile(join(dir, f), 'utf8');
  // strip comments so a rule named in a comment is not a false positive
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  for (const [re, why] of BANNED) if (re.test(code)) lint.push(`${f}: ${why}`);
  if (!/SCREENS\.\w+\s*=/.test(code)) lint.push(`${f}: no SCREENS.<id> registration`);
}

function serve(root, port) {
  return new Promise(res => {
    const s = createServer(async (req, rq) => {
      const p = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      try {
        const b = await readFile(p);
        rq.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
        rq.end(b);
      } catch { rq.writeHead(404); rq.end('nope'); }
    });
    s.listen(port, () => res(s));
  });
}

/* ── The stub database ────────────────────────────────────────────────────

   This used to be one flat object served with a fixed 200 for every path, and
   that made the gate structurally incapable of catching the single most
   expensive class of bug in this app. PostgREST answers an unknown column with
   400 / 42703 and REJECTS THE WHOLE QUERY — not the field, the query — so one
   stale column name blanks an entire screen. The old stub answered 200 to
   anything, and its row literally carried `lead_score`, `stock_id`, `make`,
   `year`, `cost_price_aed` and `updated_at`, none of which exist in the real
   database. So `team.js` selecting `leads.lead_score` gated GREEN and shipped,
   and the roster screen was blank in production until a human noticed.

   A gate that passes the bug it exists to catch is worse than no gate: it is a
   green light with no lamp behind it. So the stub now knows the real column
   list of every table, read live off the database on 24 Aug 2026, and it fails
   a query exactly the way production does. Keeping this list current is the
   price of the gate being worth running — when the schema changes, change it
   here, and SCHEMA.md's CORRECTION section is the same list in prose. */
const SCHEMA = {
  leads: ['id','name','email','phone','status','ai_score','source','vehicle_interest','budget_aed','assigned_to','assigned_to_id','response_time_minutes','escalated_at','created_at'],
  inventory: ['id','model','vin','status','acquired_at','cost_aed','price_aed','days_in_stock','holding_cost_accrued','gross_margin','net_margin','vat_amount','aging_alert','ai_recommendation','recommended_commission'],
  users: ['id','name','email','role','status','slack_user_id','created_at'],
  communication_logs: ['id','lead_email','direction','message','channel','created_at'],
  competitors: ['id','competitor','model','our_price_aed','price_aed','price_diff_aed','scraped_at','ai_recommendation'],
  finance_quotes: ['id','lead_email','lead_name','vehicle_value_aed','loan_payoff_aed','equity_aed','equity_status','loan_to_value_pct','indicative_apr_pct','finance_tier','credit_score','disclaimer','quoted_by','source','created_at'],
  rag_documents: ['id','doc_title','source_file','section','page_number','content','search_vector'],
  purchase_history: ['id','deal_id','customer_name','email','phone','vehicle','amount_aed','purchase_date','created_at'],
  deals_embeddings: ['id','deal_id','content','embedding','created_at'],
  audit_log: ['id','workflow','status','lead_name','lead_email','lead_score','intent','summary','logged_at'],
  kyc_documents: ['id','lead_email','lead_name','chat_id','document_type','full_name','date_of_birth','expiry_date','is_valid','tampering','confidence_score','remarks','attempt_number','max_attempts','verdict','reviewed_by','reviewed_at','storage_path','retain_until','purged_at','void_reason','voided_at','created_at'],
  customer_360_profiles: ['id','customer_id','name','email','phone','total_emails','total_slack_messages','last_synced_at'],
  workflow_registry: ['id','name','audit_name','audit_aliases','category','trigger_type','trigger_detail','description','is_active','writes_audit_log'],
  processed_messages: ['chat_id','message_id','source','processed_at'],
  whatsapp_contacts: ['chat_id','phone','push_name','lead_email','first_seen','last_seen','message_count'],
  v_needs_attention: ['kind','severity','ref','title','detail','at','screen'],
  v_workflow_health: ['id','name','category','trigger_type','trigger_detail','description','is_active','writes_audit_log','runs','failures','escalations','success_rate','last_run','runs_30d','failures_30d','last_failure','health'],
  v_team_performance: ['id','name','email','role','status','leads_assigned','hot_leads','pipeline_aed','avg_response_minutes','within_sla','breached_sla'],
  v_customer_360: ['name','email','phone','lead_count','best_ai_score','latest_status','is_vip','last_contact_at','message_count','total_emails','total_slack_messages','purchase_count','lifetime_value_aed','last_purchase_date'],
  v_customer_directory: ['id','name','email','phone','source_records','last_seen_at'],
  v_conversations: ['thread_key','chat_id','phone','push_name','lead_email','lead_name','lead_status','display_name','identified','message_count','inbound_count','outbound_count','last_message_at','last_message','last_direction','awaiting_reply'],
  /* Probed live 24 Aug. The first version of this entry was invented from the
     table's name -- id/leads_total/leads_hot/revenue_aed/created_at, none of
     which exist -- which would have made the gate reject overview.js's real,
     working delta reads. A guessed schema in the schema checker is the exact
     failure this file was rewritten to end, so it is worth saying plainly:
     every list here must come from the database, not from a plausible guess. */
  daily_metrics: ['snapshot_date','open_leads','hot_leads','warm_leads','cold_leads','avg_response_minutes','pipeline_aed','units_at_risk','holding_cost_aed','workflow_runs','workflow_failures','captured_at'],
};

/* Plausible values by column name, so a screen gets something it can format
   rather than a string in every numeric field. Anything unlisted falls back by
   suffix, then to a string — the point of this object is realism, not coverage. */
const VALUE = {
  id: '00000000-0000-4000-8000-000000000001', customer_id: '25',
  name: 'Test Row', lead_name: 'Test Row', full_name: 'Test Row', customer_name: 'Test Row',
  competitor: 'Al Futtaim Toyota', doc_title: 'Refund policy', title: 'Refund policy',
  email: 'ali@example.com', lead_email: 'ali@example.com',
  phone: '+971500000000', push_name: 'Ali', display_name: 'Test Row', identified: 'lead',
  chat_id: '971500000000@c.us', thread_key: '971500000000@c.us', message_id: 'ABC123',
  role: 'senior_rep', status: 'HOT', lead_status: 'HOT', latest_status: 'HOT',
  verdict: 'APPROVED', health: 'DEGRADED', severity: 'HOT', kind: 'unanswered_chat',
  screen: 'conversations', ref: 'NX-1010', detail: 'Waiting since 19 Aug',
  direction: 'inbound', last_direction: 'inbound', message: 'hello there',
  last_message: 'hello there', channel: 'whatsapp', source: 'whatsapp',
  model: 'Land Cruiser', vin: 'JTMHV05J104123456', vehicle: '2024 Toyota Land Cruiser',
  vehicle_interest: '2024 Toyota Land Cruiser', aging_alert: 'CRITICAL',
  category: 'Lead', trigger_type: 'webhook', trigger_detail: 'whatsapp-inbound',
  workflow: 'WhatsApp BDC Agent', audit_name: 'WhatsApp BDC Agent', audit_aliases: [],
  summary: 'Completed', intent: 'Buying', description: 'Handles inbound WhatsApp',
  content: 'Refunds are processed within 14 days.', section: 'Policy',
  source_file: 'policy.pdf', remarks: 'Looks clean', document_type: 'Passport',
  equity_status: 'POSITIVE', finance_tier: 'A', disclaimer: 'Indicative only',
  quoted_by: 'ali@example.com', ai_recommendation: 'Hold', assigned_to: 'Test Rep',
  slack_user_id: 'U123', void_reason: null, voided_at: null, purged_at: null,
  storage_path: 'kyc/x/2026/08/a.jpg', search_vector: null, embedding: null,
  is_valid: true, tampering: false, is_active: true, is_vip: true,
  writes_audit_log: true, awaiting_reply: true,
};
function fabricate(table) {
  const cols = SCHEMA[table] || [];
  const row = {};
  for (const c of cols) {
    if (c in VALUE) { row[c] = VALUE[c]; continue; }
    if (/(_at|_date|^at$)$/.test(c)) row[c] = '2026-08-01T00:00:00Z';
    else if (/^(is_|has_)/.test(c)) row[c] = true;
    else if (/(_aed|_pct|_score|_count|_minutes|_number|count|runs|failures|escalations|_margin|_commission|days_in_stock|holding_cost_accrued|success_rate|page_number|credit_score)/.test(c)) row[c] = 120000;
    else row[c] = 'Test Row';
  }
  return row;
}

/* Reproduce PostgREST's two rejections that actually bite this app:
   42703 for a column that does not exist, and PGRST100 for a select it cannot
   parse. Everything else answers 200 with rows shaped like the real table —
   which is itself a check, because a screen reading a field the table does not
   have now gets `undefined` here exactly as it would in production, instead of
   the old stub's helpful lie. */
function stubRest(url) {
  const u = new URL(url);
  const table = u.pathname.split('/rest/v1/')[1]?.split('?')[0]?.replace(/\/$/, '');
  if (!table) return { status: 404, body: { message: 'no table in path' } };
  if (!SCHEMA[table]) {
    return { status: 404, body: { code: '42P01', message: `relation "public.${table}" does not exist`,
      hint: 'Add it to SCHEMA in QUALITY_GATE.mjs if it is real.' } };
  }
  const sel = u.searchParams.get('select');
  if (sel != null) {
    if (/,\s*$/.test(sel) || sel.trim() === '') {
      return { status: 400, body: { code: 'PGRST100',
        message: `"failed to parse select parameter (${sel})"` } };
    }
    /* Strip embedded resources — `leads?select=*,users(id,name)` — and check
       only the columns asked of THIS table. The embed's own columns belong to
       the embedded table and are not this table's problem. */
    const flat = sel.replace(/\w+\s*\([^()]*\)/g, '');
    for (const raw of flat.split(',')) {
      const c = raw.trim().split(':').pop().split('::')[0].trim();
      if (!c || c === '*') continue;
      if (!SCHEMA[table].includes(c)) {
        return { status: 400, body: { code: '42703', details: null, hint: null,
          message: `column ${table}.${c} does not exist` } };
      }
    }
  }
  const row = fabricate(table);
  /* Two rows, deliberately NOT identical for the tables where the interesting
     branch is a per-row flag. The stub used to return [row, row] with
     void_reason and purged_at hardcoded null, which meant the compliance
     screen's voided partition -- the whole reason that screen was rewritten --
     was never exercised by the gate. A screen that counted voided rows into its
     approval rate would still have gated green. Same for a purged file, whose
     "do not offer a link" branch is a real compliance obligation. */
  if (table === 'kyc_documents') {
    return { status: 200, body: [
      row,
      { ...row, id: '00000000-0000-4000-8000-000000000002',
        void_reason: 'not a document — greeting image auto-routed to the auditor',
        voided_at: '2026-08-24T00:00:00Z', document_type: 'Religious Banner',
        verdict: 'APPROVED', confidence_score: 100 },
      { ...row, id: '00000000-0000-4000-8000-000000000003',
        purged_at: '2026-08-20T00:00:00Z' },
      { ...row, id: '00000000-0000-4000-8000-000000000004',
        storage_path: null },              // archive gap
    ] };
  }
  if (table === 'competitors') {
    /* The scraper really did store `"null"` (the string) and
       `"Pardon Our Interruption"` — a bot-detection interstitial — as competitor
       names, with no price at all. A screen that counts those as rival
       dealerships, or builds an undercut claim on a null price, must fail here
       rather than in front of the owner. */
    return { status: 200, body: [
      row,
      { ...row, id: 98, competitor: 'null', price_aed: null, price_diff_aed: null },
      { ...row, id: 99, competitor: 'Pardon Our Interruption', price_aed: null, price_diff_aed: null },
    ] };
  }
  return { status: 200, body: [row, row] };
}

async function run(port) {
  /* This container ships a prebuilt Chromium at a fixed path; a normal checkout
     uses whatever `npx playwright install chromium` put where Playwright expects
     it. Honour an explicit override, fall back to the container's copy when it
     is there, otherwise let Playwright resolve its own. */
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH
    || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
  const browser = await chromium.launch(explicit ? { executablePath: explicit } : {});
  const page = await browser.newPage();
  const errs = [];
  const schemaRejections = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text());
  });
  await page.route('https://fonts.googleapis.com/**', r =>
    r.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.route('https://example.supabase.co/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'u1', email: 'ali@example.com', role: 'authenticated' }) }));
  await page.route('https://example.supabase.co/rest/v1/**', r => {
    const out = stubRest(r.request().url());
    if (out.status !== 200) schemaRejections.push(`${out.status} ${out.body.code || ''} ${out.body.message}`);
    r.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
  });
  await page.route('https://example.invalid/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ output: 'stubbed answer', sources: [] }) }));
  await page.addInitScript(() => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify({
      access_token: 'stub.jwt.token', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
      user: { id: 'u1', email: 'ali@example.com', aud: 'authenticated',
              app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const loggedIn = await page.evaluate(() =>
    !document.getElementById('app').classList.contains('hide'));
  const nav = await page.evaluate(() => document.querySelectorAll('.nav-item').length);

  const screens = {};
  for (const id of SCREEN_IDS) {
    const before = errs.length;
    await page.evaluate(i => { location.hash = i; window.dispatchEvent(new HashChangeEvent('hashchange')); }, id);
    await page.waitForTimeout(700);
    screens[id] = await page.evaluate(() => {
      const h = document.getElementById('screen').innerHTML;
      return {
        len: h.length,
        cards: document.querySelectorAll('#screen .card').length,
        buttons: document.querySelectorAll('#screen button').length,
        stuckLoading: document.querySelectorAll('#screen .skeleton').length > 0,
        errored: /Couldn.t load/.test(h),
      };
    });
    screens[id].newErrors = errs.length - before;
  }
  await browser.close();
  return { loggedIn, nav, screens, errs, schemaRejections };
}

/* Build before serving. `--outDir dist` with no --emptyOutDir, because on the
   Cowork device mount unlink is denied and emptying the directory fails the
   whole build; vite overwrites the files it produces either way, and the hashed
   filenames in index.html are what the page actually loads. */
console.log('=== build ===');
try {
  execFileSync('node_modules/.bin/vite', ['build', '--outDir', 'dist', '--logLevel', 'warn'],
    { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });
  console.log('  built');
} catch (e) {
  console.log('  BUILD FAILED — not gating a stale bundle.');
  process.exit(1);
}

const srv = await serve(new URL('./dist/', import.meta.url).pathname, 8071);
const r = await run(8071);
srv.close();

console.log('=== static lint ===');
console.log(lint.length ? lint.map(l => '  FAIL ' + l).join('\n') : '  clean');
console.log(`\n=== boot ===\n  loggedIn=${r.loggedIn}  navItems=${r.nav}  totalPageErrors=${r.errs.length}`);
if (r.errs.length) console.log(r.errs.slice(0, 12).map(e => '  ' + e.slice(0, 160)).join('\n'));

console.log('\nscreen           chars  cards  btns  stuck  errState  newErrs');
let bad = 0;
for (const id of SCREEN_IDS) {
  const s = r.screens[id];
  const fail = s.len < 200 || s.errored || s.newErrors > 0 || s.stuckLoading;
  if (fail) bad++;
  console.log(
    `${id.padEnd(15)} ${String(s.len).padStart(6)} ${String(s.cards).padStart(6)}` +
    ` ${String(s.buttons).padStart(5)} ${String(s.stuckLoading).padStart(6)}` +
    ` ${String(s.errored).padStart(9)} ${String(s.newErrors).padStart(8)}` +
    (fail ? '   <-- FAIL' : ''));
}
/* A rejected query is reported separately from a page error because it does not
   necessarily produce one: a screen that catches its own fetch failure renders a
   tidy "Couldn't load ..." and looks fine here, while in production that whole
   panel is empty for a reason nobody can see. These are the bugs the old stub
   could not express, so they get their own section and they fail the gate. */
const rejects = [...new Set(r.schemaRejections)];
console.log('\n=== queries the database would reject ===');
console.log(rejects.length ? rejects.map(x => '  FAIL ' + x).join('\n')
  : '  none — every select names columns that exist');

console.log(`\nscreens failing: ${bad}/${SCREEN_IDS.length}   lint failures: ${lint.length}   rejected queries: ${rejects.length}`);
process.exit(bad === 0 && lint.length === 0 && rejects.length === 0 && r.loggedIn && r.nav === 14 ? 0 : 1);
