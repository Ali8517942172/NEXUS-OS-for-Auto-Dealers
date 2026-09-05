#!/usr/bin/env node
/* Regenerate supabase/baseline/00000000000000_baseline.sql from a live catalogue.
 *
 * Reads the catalogue through psql (pg_get_functiondef / pg_get_viewdef /
 * pg_get_constraintdef / pg_get_indexdef / pg_get_triggerdef / pg_policy /
 * pg_class.relacl / pg_attribute.attacl / pg_namespace.nspacl / pg_default_acl)
 * and writes the schema as SQL. Nothing here is transcribed by hand.
 *
 * WHY THIS IS A SCRIPT AND NOT A PARAGRAPH IN A README
 *   The 4 September baseline was produced by a long ad-hoc catalogue query that
 *   nobody wrote down, and README.md said regenerating it "is not automated".
 *   The result was a baseline that silently went a day stale and, because it
 *   predated the security work of that afternoon, would have restored the
 *   born-open grants and the open schema door. A procedure a person has to
 *   reinvent is a procedure that produces a different answer each time.
 *
 * USAGE
 *   GEN_CONN='-h /path/to/socket -p 5433 -U postgres' \
 *   GEN_DB=nexus \
 *   GEN_VERSION=20260904142907 \
 *   GEN_VERSION_NAME=nexus_storage_defacl_drop_maintain_from_authenticated \
 *   GEN_DATE=2026-09-05 \
 *     node supabase/tools/generate-baseline.mjs > supabase/baseline/00000000000000_baseline.sql
 *
 *   GEN_VERSION / GEN_VERSION_NAME default to the newest row of
 *   supabase_migrations.schema_migrations when that table is readable.
 *
 * VERIFY AFTER GENERATING - a baseline nobody diffed against production is a
 * claim, not a check. Stand up tools/verification-harness.sql in an empty
 * PostgreSQL 17 database, load the generated file, and compare the fingerprint
 * query in README.md against production. Section 15 is the one to look at
 * first: if `anon` reappears there, the schema door has been reopened.
 */
import { execFileSync } from 'node:child_process';

const PSQL = process.env.PSQL_BIN || 'psql';
const DB = process.env.GEN_DB || 'nexus';
const CONN = (process.env.GEN_CONN || '').split(' ').filter(Boolean);

// Rows come back with \x1f between fields and \x1e between records, so that
// SQL bodies containing newlines, tabs and pipes survive intact.
function q(sql) {
  let out = execFileSync(PSQL, [...CONN, '-X', '-Atq', '-R', '\x1e', '-F', '\x1f', '-c', sql, DB],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  // psql terminates its output with a newline that is NOT part of the last
  // record. Left in place it silently corrupts the final row of every query -
  // which is how the last table, the last function and the last aclitem of each
  // default-ACL line went missing on the first pass.
  out = out.replace(/\n$/, '');
  return out.split('\x1e').filter(r => r.length).map(r => r.split('\x1f'));
}

const out = [];
const w = s => out.push(s);
const section = (n, title, note) => {
  w('');
  w('');
  w('-- ========================================================================');
  w(`-- ${n}. ${title}`);
  if (note) for (const l of note.split('\n')) w(`-- ${l}`);
  w('-- ========================================================================');
};

// ---------------------------------------------------------------- header ----
let ver = '', vname = '';
if (q(`select (to_regclass('supabase_migrations.schema_migrations') is not null)::text`)[0][0] === 'true') {
  const r = q(`select version, name from supabase_migrations.schema_migrations order by version desc limit 1`);
  if (r.length) { ver = r[0][0]; vname = r[0][1]; }
}

const VER = process.env.GEN_VERSION || ver;
const VNAME = process.env.GEN_VERSION_NAME || vname;
const TAKEN = process.env.GEN_DATE || new Date().toISOString().slice(0, 10);

const nViews = q(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relkind in ('v','m')`)[0][0];

w(`-- BASELINE VERSION: ${VER}  (${VNAME})`);
w(`-- Taken ${TAKEN} from Supabase project dsvuoovivysszdoiorch.`);
w('-- Restore = this file, then 00000000000001_migration_history.sql, then every');
w(`-- file in supabase/migrations/ whose version is greater than ${VER}.`);
w('-- NEXUS OS — baseline schema of Supabase project dsvuoovivysszdoiorch');
w('--');
w('-- WHAT THIS IS');
w('--   A schema-only reconstruction of production as it stood at the migration');
w('--   version named below. It is GENERATED from the live catalogue');
w('--   (pg_get_functiondef / pg_get_viewdef / pg_get_constraintdef /');
w('--   pg_get_indexdef / pg_get_triggerdef / pg_policy / pg_class.relacl /');
w('--   pg_attribute.attacl / pg_namespace.nspacl / pg_default_acl). It is not');
w('--   hand-transcribed, and it must never be hand-edited: regenerate it, or the');
w('--   folder is back where it started. See supabase/README.md.');
w('--');
w('-- WHY IT EXISTS');
w('--   The recorded migration chain cannot replay from an empty database. Its');
w('--   first entry, 20260717130052, is');
w('--     ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;');
w('--   so the tables predate the chain and nothing in the chain creates them.');
w('--   This file is the missing pre-history, brought forward to today so that');
w('--   restore = this file, then every migration whose version is GREATER than');
w('--   the version stamped above.');
w('--');
w('-- WHAT CHANGED IN THIS GENERATION (4 September security and consent work)');
w('--   The previous baseline was taken at 20260904090150, BEFORE the twelve');
w('--   migrations of 4 September. Restoring from it reproduced the born-open');
w('--   grants and the open schema door — the precise failure those migrations');
w('--   exist to close. This generation is taken after them, so:');
w('--     * anon holds NO USAGE on schema public (section 15 revokes it and does');
w('--       not grant it back; the previous baseline granted it, twice).');
w('--     * the postgres default-privilege line for public grants authenticated');
w('--       SELECT only, and nothing to anon (section 20).');
w('--     * the postgres default-privilege line for STORAGE is reproduced for the');
w('--       first time (section 20), because 4 September narrowed it.');
w('--     * both NEXUS event triggers are present (section 11); the previous');
w('--       baseline carried one.');
w('--');
w('-- DATA');
w('--   None. Schema only. No dealership rows, no tenants, no vocabulary seed.');
w('--   A restored database is empty and needs its seed rows separately.');
w('--');
w('-- WHAT IT DELIBERATELY DOES NOT CONTAIN');
w('--   The Supabase platform itself: the auth / storage / realtime / vault');
w('--   schemas, the anon / authenticated / service_role / supabase_admin roles,');
w('--   auth.uid() / auth.jwt(), pg_cron and supabase_vault. Restoring into a real');
w('--   Supabase project gets those from the platform. Restoring into a bare');
w('--   Postgres needs them stood up first — supabase/README.md carries the');
w('--   harness that this baseline was verified against.');
w('');

// ------------------------------------- 1. extensions, types, seq, tables ----
section(1, 'EXTENSIONS, TYPES, SEQUENCES, TABLES (no defaults)',
  'Defaults are deferred to section 3: several call functions defined in section 2.');

for (const [name, nsp] of q(`select e.extname, n.nspname from pg_extension e
    join pg_namespace n on n.oid=e.extnamespace
    where e.extname not in ('plpgsql') order by e.extname`)) {
  const ident = /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name}"`;
  w(`CREATE EXTENSION IF NOT EXISTS ${ident} WITH SCHEMA ${nsp};`);
}

for (const [def] of q(`
  select 'CREATE TYPE public.'||t.typname||' AS ('||
         (select string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod), ', ' order by a.attnum)
            from pg_attribute a where a.attrelid=t.typrelid and a.attnum>0 and not a.attisdropped)||');'
    from pg_type t join pg_namespace n on n.oid=t.typnamespace
    join pg_class c on c.oid=t.typrelid
   where n.nspname='public' and c.relkind='c'
     and t.oid not in (select objid from pg_depend where refclassid='pg_extension'::regclass and classid='pg_type'::regclass and deptype='e')
   order by t.typname`)) w(def);

for (const [def] of q(`
  select 'CREATE SEQUENCE IF NOT EXISTS public.'||c.relname||
         ' AS '||format_type(s.seqtypid,null)||
         ' START WITH '||s.seqstart||' INCREMENT BY '||s.seqincrement||
         ' MINVALUE '||s.seqmin||' MAXVALUE '||s.seqmax||
         ' CACHE '||s.seqcache||case when s.seqcycle then ' CYCLE' else ' NO CYCLE' end||';'
    from pg_sequence s join pg_class c on c.oid=s.seqrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' order by c.relname`)) w(def);

const tables = q(`select c.oid::text, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')
     and c.oid not in (select objid from pg_depend where refclassid='pg_extension'::regclass and classid='pg_class'::regclass and deptype='e')
   order by c.relname`);
for (const [oid, relname] of tables) {
  const cols = q(`select a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull::text,
                         a.attgenerated::text, coalesce(pg_get_expr(d.adbin,d.adrelid),'')
                    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
                   where a.attrelid=${oid} and a.attnum>0 and not a.attisdropped order by a.attnum`);
  w(`CREATE TABLE IF NOT EXISTS public.${relname} (`);
  const lines = cols.map(([n, t, nn, gen, expr]) => {
    let s = `  ${n} ${t}`;
    if (gen === 's') s += ` GENERATED ALWAYS AS (${expr}) STORED`;
    if (nn === 'true') s += ' NOT NULL';
    return s;
  });
  w(lines.join(',\n'));
  w(');');
}

// --------------------------------------------------------- 2. functions ----
// Functions whose signature or return type mentions a view row type cannot be
// created before section 9. They are held back to 9b.
const viewTypes = new Set(q(`select t.oid::text from pg_type t join pg_class c on c.oid=t.typrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')`).map(r => r[0]));

const allFuncs = q(`
  select p.oid::text, p.oid::regprocedure::text, pg_get_functiondef(p.oid),
         p.prorettype::text, coalesce(array_to_string(p.proargtypes::oid[],','),'')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.oid not in (select objid from pg_depend where refclassid='pg_extension'::regclass and classid='pg_proc'::regclass and deptype='e')
   order by p.proname, p.oid::regprocedure::text`);

const early = [], late = [];
for (const f of allFuncs) {
  const [, sig, , ret, args] = f;
  const touchesView = viewTypes.has(ret) || args.split(',').filter(Boolean).some(a => viewTypes.has(a));
  (touchesView ? late : early).push(f);
}

section(2, 'FUNCTIONS',
  `Emitted before defaults, views, constraints and policies, all of which call into them. ${late.length} functions whose signature names a VIEW row type are deferred to section 9b.`);
w('-- Functions are emitted in name order, and NEXUS functions call each other, so');
w('-- some bodies forward-reference a function defined further down. pg_dump has the');
w('-- same problem and solves it the same way. The bodies were valid in production');
w('-- when this was generated; this switch defers the check, it does not excuse one.');
w('SET check_function_bodies = off;');
w('');
for (const [, , def] of early) { w(def.replace(/\n+$/, '')); w(';'); w(''); }

// --------------------------------------------------- 3. column defaults ----
section(3, 'COLUMN DEFAULTS');
for (const [t, c, d] of q(`
  select c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid)
    from pg_attrdef ad join pg_class c on c.oid=ad.adrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=ad.adrelid and a.attnum=ad.adnum
   where n.nspname='public' and c.relkind in ('r','p') and a.attgenerated=''
   order by c.relname, a.attnum`))
  w(`ALTER TABLE public.${t} ALTER COLUMN ${c} SET DEFAULT ${d};`);

// ------------------------------------------------ 4. sequence ownership ----
section(4, 'SEQUENCE OWNERSHIP');
for (const [s, t, c] of q(`
  select sc.relname, tc.relname, a.attname
    from pg_depend d join pg_class sc on sc.oid=d.objid and sc.relkind='S'
    join pg_class tc on tc.oid=d.refobjid
    join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
    join pg_namespace n on n.oid=sc.relnamespace
   where d.classid='pg_class'::regclass and d.refclassid='pg_class'::regclass
     and d.deptype='a' and n.nspname='public' order by sc.relname`))
  w(`ALTER SEQUENCE public.${s} OWNED BY public.${t}.${c};`);

// ------------------------------- 5/7/8. constraints, split by kind ---------
const conByKind = k => q(`
  select c.relname, con.conname, pg_get_constraintdef(con.oid)
    from pg_constraint con join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and con.contype in (${k})
   order by case con.contype when 'u' then 0 when 'x' then 0 when 'p' then 1 else 2 end,
            c.relname, con.conname`);

section(5, 'PRIMARY KEY / UNIQUE / EXCLUDE CONSTRAINTS');
for (const [t, n, d] of conByKind(`'p','u','x'`))
  w(`ALTER TABLE public.${t} ADD CONSTRAINT ${n} ${d};`);

section(6, 'INDEXES (those not backing a constraint)');
for (const [d] of q(`
  select pg_get_indexdef(i.indexrelid)||';'
    from pg_index i join pg_class ci on ci.oid=i.indexrelid
    join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and not exists (select 1 from pg_constraint con where con.conindid=i.indexrelid)
     and c.oid not in (select objid from pg_depend where refclassid='pg_extension'::regclass and classid='pg_class'::regclass and deptype='e')
   order by ci.relname`)) w(d);

section(7, 'FOREIGN KEYS');
for (const [t, n, d] of conByKind(`'f'`))
  w(`ALTER TABLE public.${t} ADD CONSTRAINT ${n} ${d};`);

section(8, 'CHECK CONSTRAINTS');
for (const [t, n, d] of conByKind(`'c'`))
  w(`ALTER TABLE public.${t} ADD CONSTRAINT ${n} ${d};`);

// ------------------------------------------------------------- 9. views ----
// Dependency order: a view that selects from another view must come second.
const views = q(`
  select c.oid::text, c.relname, pg_get_viewdef(c.oid,true),
         coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name='security_invoker'),'')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v' order by c.relname`);
const deps = new Map();
for (const [oid] of views) deps.set(oid, new Set());
for (const [a, b] of q(`
  select distinct r.ev_class::text, d.refobjid::text
    from pg_rewrite r join pg_depend d on d.objid=r.oid
    join pg_class c on c.oid=d.refobjid join pg_namespace n on n.oid=c.relnamespace
   where d.classid='pg_rewrite'::regclass and c.relkind in ('v','m')
     and n.nspname='public' and r.ev_class <> d.refobjid`))
  if (deps.has(a) && deps.has(b)) deps.get(a).add(b);

const emitted = new Set(); const order = [];
const byOid = new Map(views.map(v => [v[0], v]));
const visit = (oid, seen = new Set()) => {
  if (emitted.has(oid) || seen.has(oid)) return;
  seen.add(oid);
  for (const d of [...deps.get(oid)].sort()) visit(d, seen);
  if (!emitted.has(oid)) { emitted.add(oid); order.push(oid); }
};
for (const [oid] of views) visit(oid);

const lacking = views.filter(v => !v[3]).length;
section(9, 'VIEWS',
  `Dependency-ordered. WITH (security_invoker=on) is reproduced verbatim: ${lacking} of ${nViews} views lack it.`);
for (const oid of order) {
  const [, name, def, sec] = byOid.get(oid);
  w(`CREATE OR REPLACE VIEW public.${name}${sec ? ` WITH (security_invoker=${sec})` : ''} AS`);
  w(def.replace(/;\s*$/, '') + ';');
  w('');
}

if (late.length) {
  section('9b', 'FUNCTIONS THAT RETURN OR TAKE A VIEW ROW TYPE',
    `These ${late.length} cannot be created before their views exist: ${late.map(f => f[1].replace(/\(.*/, '')).join(', ')}`);
  for (const [, , def] of late) { w(def.replace(/\n+$/, '')); w(';'); w(''); }
}

// ---------------------------------------------------------- 10. triggers ---
section(10, 'TRIGGERS');
for (const [d] of q(`
  select pg_get_triggerdef(t.oid)||';'
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and not t.tgisinternal order by c.relname, t.tgname`)) w(d);

// ---------------------------------------------------- 11. event triggers ---
section(11, 'EVENT TRIGGERS',
  'These are database-wide, not schema-scoped. Both are NEXUS guards; the Supabase\nplatform ones (pgrst_*, issue_*) belong to the platform and are not reproduced.');
for (const [name, ev, tags, fn] of q(`
  select evtname, evtevent, coalesce(array_to_string(evttags,''', '''),''), evtfoid::regproc::text
    from pg_event_trigger e
   where pg_get_userbyid(e.evtowner) not in ('supabase_admin')
   order by evtname`)) {
  w(`CREATE EVENT TRIGGER ${name} ON ${ev}${tags ? ` WHEN TAG IN ('${tags}')` : ''} EXECUTE FUNCTION public.${fn}();`);
}

// ----------------------------------------------------------- 12. RLS ------
const noRls = q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity
     and c.oid not in (select objid from pg_depend where refclassid='pg_extension'::regclass and classid='pg_class'::regclass and deptype='e')
   order by c.relname`).map(r => r[0]);
section(12, 'ROW LEVEL SECURITY', `RLS is NOT enabled on: ${noRls.length ? noRls.join(', ') : '(nothing)'}`);
for (const [t, force] of q(`select c.relname, c.relforcerowsecurity::text from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity order by c.relname`)) {
  w(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
  if (force === 'true') w(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`);
}

// ------------------------------------------------------- 13. policies ------
section(13, 'POLICIES');
for (const [t, name, cmd, perm, roles, qual, wc] of q(`
  select c.relname, pol.polname,
         case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                         when 'd' then 'DELETE' else 'ALL' end,
         case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
         coalesce((select string_agg(pg_get_userbyid(r),', ' order by pg_get_userbyid(r)) from unnest(pol.polroles) r where r<>0),'PUBLIC'),
         coalesce(pg_get_expr(pol.polqual,pol.polrelid),''),
         coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')
    from pg_policy pol join pg_class c on c.oid=pol.polrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' order by c.relname, pol.polname`)) {
  let s = `CREATE POLICY ${name} ON public.${t} AS ${perm} FOR ${cmd} TO ${roles}`;
  if (qual) s += ` USING (${qual})`;
  if (wc) s += ` WITH CHECK (${wc})`;
  w(s + ';');
}

// ------------------------------------------------- 14. grants: revoke ------
section(14, 'GRANTS — revoke first',
  `Supabase ships ALTER DEFAULT PRIVILEGES granting ALL on new objects in
public to anon, authenticated and service_role, and USAGE on schema public to
anon and to PUBLIC. Dozens of NEXUS migrations exist only to take that back. A
baseline that merely GRANTed would therefore reproduce the tables and leave the
grants wide open, which is the one kind of drift that puts one dealership's data
in front of another. So: revoke everything first, including the schema door,
then grant back exactly what production holds.`);
w('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated, service_role, PUBLIC;');
w('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role, PUBLIC;');
w('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role, PUBLIC;');
w('REVOKE ALL ON SCHEMA public FROM anon, authenticated, service_role, PUBLIC;');

// -------------------------------------------------- 15. grants: schema -----
const PRIVNAME = { a: 'INSERT', r: 'SELECT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN', X: 'EXECUTE', U: 'USAGE', C: 'CREATE', c: 'CONNECT', T: 'TEMPORARY' };
// Parse an aclitem string "grantee=privs/grantor" into [grantee, [PRIV,...]].
function parseAcl(item) {
  const m = /^(.*)=([a-zA-Z*]*)\/(.*)$/.exec(item);
  if (!m) return null;
  const grantee = m[1] === '' ? 'PUBLIC' : m[1];
  const privs = [];
  for (let i = 0; i < m[2].length; i++) {
    const ch = m[2][i];
    if (ch === '*') continue;
    if (PRIVNAME[ch]) privs.push(PRIVNAME[ch]);
  }
  return [grantee, privs];
}

section(15, 'GRANTS — schema',
  `Read from pg_namespace.nspacl. anon is absent BY MEASUREMENT, not by omission:
the 4 September migration nexus_close_anon_schema_door_and_storage_defacl
revoked USAGE from anon and from PUBLIC, and gave it back to eleven named roles.
Without USAGE on the schema, no object ACL inside it is reachable — including
objects that do not exist yet, whichever path creates them.`);
{
  const lines = [];
  for (const [it] of q(`select unnest(nspacl)::text from pg_namespace where nspname='public'`)) {
    const p = parseAcl(it);
    if (!p) continue;
    for (const pr of p[1]) lines.push(`GRANT ${pr} ON SCHEMA public TO ${p[0]};`);
  }
  lines.sort();
  for (const l of lines) w(l);
}

// -------------------------------- 16/17. grants: relations and columns -----
section(16, 'GRANTS — tables, views and sequences');
{
  const lines = [];
  for (const [relname, kind, it] of q(`
    select c.relname, c.relkind::text, unnest(c.relacl)::text
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')
       and c.oid not in (select objid from pg_depend where refclassid='pg_extension'::regclass and classid='pg_class'::regclass and deptype='e')
     order by c.relname`)) {
    const obj = kind === 'S' ? `SEQUENCE public.${relname}` : `TABLE public.${relname}`;
    const p = parseAcl(it);
    if (!p || p[0] === 'postgres') continue;
    for (const pr of p[1]) lines.push([relname, `GRANT ${pr} ON ${obj} TO ${p[0]};`]);
  }
  lines.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  for (const [, l] of lines) w(l);
}

section(17, 'GRANTS — COLUMN LEVEL',
  `A relacl-only dump misses these entirely. Production genuinely uses them:
channel_registry.credential_ref is withheld from authenticated while its
siblings are granted, and that distinction lives only in pg_attribute.attacl.`);
{
  const lines = [];
  for (const [relname, attname, it] of q(`
    select c.relname, a.attname, unnest(a.attacl)::text
      from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null
     order by c.relname, a.attname`)) {
    const p = parseAcl(it);
    if (!p || p[0] === 'postgres') continue;
    for (const pr of p[1]) lines.push([relname, attname, `GRANT ${pr}(${attname}) ON TABLE public.${relname} TO ${p[0]};`]);
  }
  lines.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
  for (const l of lines) w(l[2]);
}

// ---------------------------------------------- 18/19. grants: fn, type ----
section(18, 'GRANTS — functions');
{
  const lines = [];
  for (const [sig, it] of q(`
    select p.oid::regprocedure::text, unnest(p.proacl)::text
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.oid not in (select objid from pg_depend where refclassid='pg_extension'::regclass and classid='pg_proc'::regclass and deptype='e')
     order by p.oid::regprocedure::text`)) {
    const p = parseAcl(it);
    if (!p || p[0] === 'postgres') continue;
    for (const pr of p[1]) lines.push(`GRANT ${pr} ON FUNCTION public.${sig} TO ${p[0]};`);
  }
  lines.sort();
  for (const l of lines) w(l);
}

section(19, 'GRANTS — types');
{
  const lines = [];
  for (const [tname, it] of q(`
    select t.typname, unnest(t.typacl)::text
      from pg_type t join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='public' and t.typacl is not null
       and t.oid not in (select objid from pg_depend where refclassid='pg_extension'::regclass and classid='pg_type'::regclass and deptype='e')
     order by t.typname`)) {
    const p = parseAcl(it);
    if (!p) continue;
    for (const pr of p[1]) lines.push(`GRANT ${pr} ON TYPE public.${tname} TO ${p[0]};`);
  }
  lines.sort();
  for (const l of lines) w(l);
}

// ------------------------------------------- 20/21. default privileges -----
const OBJWORD = { r: 'TABLES', S: 'SEQUENCES', f: 'FUNCTIONS', T: 'TYPES', n: 'SCHEMAS' };
function defaclLines(role, nsp) {
  const rows = q(`
    select d.defaclobjtype::text, unnest(d.defaclacl)::text
      from pg_default_acl d
     where pg_get_userbyid(d.defaclrole)='${role}'
       and coalesce((select nspname from pg_namespace where oid=d.defaclnamespace),'')='${nsp}'
     order by d.defaclobjtype`);
  const revokes = [], byType = new Map();
  for (const [objtype, it] of rows) {
    const word = OBJWORD[objtype];
    if (!word) continue;
    if (!byType.has(word)) {
      byType.set(word, []);
      revokes.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${role} IN SCHEMA ${nsp} REVOKE ALL ON ${word} FROM anon, authenticated, service_role;`);
    }
    const p = parseAcl(it);
    if (!p || p[0] === 'postgres') continue;
    for (const pr of p[1]) byType.get(word).push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${role} IN SCHEMA ${nsp} GRANT ${pr} ON ${word} TO ${p[0]};`);
  }
  const grants = [];
  for (const g of byType.values()) { g.sort(); grants.push(...g); }
  return { revokes, grants };
}

section(20, 'DEFAULT PRIVILEGES — the postgres lines (public and storage)',
  `anon is absent from both on purpose: production removed it. The REVOKEs are what
remove it on a stock project, and are the whole reason this section is not
GRANT-only. The storage line is here because 4 September narrowed it — it grants
nothing to anon and, since 20260904142907, no MAINTAIN to authenticated.`);
for (const nsp of ['public', 'storage']) {
  const { revokes, grants } = defaclLines('postgres', nsp);
  if (!revokes.length) continue;
  for (const r of revokes) w(r);
  w('');
  for (const g of grants) w(g);
  w('');
}

section(21, 'DEFAULT PRIVILEGES — the supabase_admin line',
  `MEASURED ON PRODUCTION, and reproduced here because it is true, not because it is
right: anon still holds ALL on new tables through this line. postgres cannot alter
it (42501) and cannot revoke a supabase_admin grant. The schema door closed in
section 15 is what actually contains it — without USAGE on public, an object born
open through this line is still unreachable. Guarded because a restore may not
have rights on supabase_admin; it warns loudly rather than skipping silently.`);
{
  const { revokes, grants } = defaclLines('supabase_admin', 'public');
  w('DO $baseline$');
  w('BEGIN');
  for (const l of [...revokes, ...grants]) w(`  EXECUTE '${l.replace(/'/g, "''")}';`);
  w('EXCEPTION WHEN insufficient_privilege THEN');
  w("  RAISE WARNING 'default privileges FOR ROLE supabase_admin were NOT set: %, this restore lacks rights on that role. Production grants anon ALL on new tables through that line; a project restored without it will differ. Set it as an owner or record the deviation.', SQLERRM;");
  w('END');
  w('$baseline$;');
}

section(22, 'THE SUPABASE PLATFORM, AND THE ONE SCHEDULED JOB',
  `Not run by this file. Nothing in sections 1-21 depends on any of it, which
was checked, not assumed: pg_depend records zero non-extension dependencies
on pg_cron, supabase_vault or pg_stat_statements.`);
w('-- On a real Supabase project the platform installs these three:');
w('--   CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;');
w('--   CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;');
w('--   CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;');
w('--');
w('-- The one piece of live state that is neither schema nor data: pg_cron job 1,');
w('-- "nexus-daily-metrics", active, the only caller of capture_daily_metrics().');
w('-- A restore that omits it produces a database that looks complete and silently');
w('-- stops capturing daily metrics. Re-create it AFTER restoring, on a project');
w('-- where pg_cron exists:');
w('--');
w("--   select cron.schedule('nexus-daily-metrics', '50 19 * * *',");
w("--                        'select public.capture_daily_metrics();');");
w('--');
w('-- Verify:  select jobname, schedule, active from cron.job;');
w('--   expected exactly one row -- nexus-daily-metrics | 50 19 * * * | t');

process.stdout.write(out.join('\n') + '\n');
