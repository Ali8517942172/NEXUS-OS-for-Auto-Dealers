#!/usr/bin/env node
'use strict';

// ===========================================================================
// NEXUS Marketplace & Lead Simulator
//
// Emits synthetic lead-event scenarios against the ingestion contract, either
// as JSON fixtures or by POSTing to a simulation ingest endpoint.
//
// It writes nothing to any database itself. It has no dependencies. Default
// mode is --dry-run; posting requires an explicit flag.
//
// See README.md before using the output for anything.
// ===========================================================================

const fs = require('fs');
const path = require('path');

const C = require('./lib/constants');
const { SCENARIOS, byId } = require('./scenarios');
const { buildFixture } = require('./lib/emit');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    list: false, all: false, scenario: null, out: null, post: null,
    dryRun: true, allowRemote: false, publicKey: null, help: false, pretty: true
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = function () { return argv[++i]; };
    switch (a) {
      case '--list': args.list = true; break;
      case '--all': args.all = true; break;
      case '--scenario': case '-s': args.scenario = next(); break;
      case '--out': case '-o': args.out = next(); break;
      case '--post': args.post = next(); args.dryRun = false; break;
      case '--dry-run': args.dryRun = true; break;
      case '--allow-remote': args.allowRemote = true; break;
      case '--public-key': args.publicKey = next(); break;
      case '--compact': args.pretty = false; break;
      case '--help': case '-h': args.help = true; break;
      default:
        if (a.indexOf('--') === 0) {
          fail('unknown flag ' + a + '. Run with --help.');
        }
    }
  }
  return args;
}

function fail(msg) {
  process.stderr.write('nexus-lead-simulator: ' + msg + '\n');
  process.exit(1);
}

const HELP = [
  'NEXUS Marketplace & Lead Simulator - ' + C.ENVIRONMENT_LABEL,
  '',
  'Emits synthetic lead-event scenarios against the NEXUS ingestion contract.',
  'Nothing it produces is a real customer, a real lead, or real business.',
  '',
  'USAGE',
  '  node simulate.js --list',
  '  node simulate.js --scenario A',
  '  node simulate.js --all',
  '  node simulate.js --all --out fixtures/',
  '  node simulate.js --scenario C --post http://localhost:5678/webhook/sim-ingest',
  '',
  'FLAGS',
  '  --list                 List every scenario with its source, provenance and',
  '                         expected disposition. Emits nothing.',
  '  --scenario <id|slug>   Emit one scenario (e.g. A, or dubizzle-whatsapp-clean).',
  '  --all                  Emit every scenario.',
  '  --out <dir>            Write each fixture to <dir>/<id>-<slug>.json.',
  '  --post <url>           POST each fixture to an ingest URL. Implies not-dry-run.',
  '  --allow-remote         Required to --post to a non-local host. See README.',
  '  --public-key <key>     p_public_key for the simulation endpoint. Defaults to',
  '                         $NEXUS_SIM_PUBLIC_KEY, then to a placeholder.',
  '  --dry-run              Print to stdout, touch nothing. THIS IS THE DEFAULT.',
  '  --compact              One-line JSON instead of indented.',
  '  --help                 This text.',
  '',
  'SAFETY',
  '  Default mode is --dry-run: fixtures go to stdout and nothing is sent.',
  '  Every emitted event declares provenance "' + C.EMITTED_PROVENANCE + '" and environment',
  '  "' + C.ENVIRONMENT + '". A production endpoint refuses an unattestable provenance, so',
  '  this tool cannot write production-labelled rows even if pointed at one.'
].join('\n');

// ---------------------------------------------------------------------------
// --list
// ---------------------------------------------------------------------------

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function firstLine(desc) {
  return String(desc).split('\n')[0];
}

function renderList() {
  const out = [];
  out.push('NEXUS Marketplace & Lead Simulator - ' + C.ENVIRONMENT_LABEL);
  out.push('Dealership: ' + C.DEALERSHIP_NAME + '   (fictional)');
  out.push('Environment: ' + C.ENVIRONMENT + '   Emitted provenance: ' + C.EMITTED_PROVENANCE);
  out.push('');
  out.push(pad('ID', 4) + pad('SOURCE KEY', 34) + pad('PROV. IN PRODUCTION', 24) +
    pad('EXPECTED', 18) + 'TITLE');
  out.push('-'.repeat(78 + 44));

  SCENARIOS.forEach(function (s) {
    out.push(
      pad(s.id, 4) +
      pad(s.source_key, 34) +
      pad(s.provenance_in_production || '-', 24) +
      pad(s.expect.disposition, 18) +
      s.title
    );
  });

  out.push('');
  out.push('EVIDENCE GRADE OF EACH PAYLOAD SHAPE');
  out.push('  published_provider_contract          = taken from the provider\'s own published docs');
  out.push('  first_party_contract_we_own          = our own form; we define this shape');
  out.push('  reconstruction_no_published_contract = our reconstruction; NO published contract exists');
  out.push('');
  SCENARIOS.forEach(function (s) {
    out.push('  ' + pad(s.id, 4) + pad(s.evidence_grade, 40) + firstLine(s.description));
  });

  out.push('');
  out.push('Dubizzle Motors publishes no leads-out API, no webhook and no developer portal.');
  out.push('Scenarios A and B are RECONSTRUCTIONS of what a dealer actually receives. The Meta');
  out.push('and Google shapes (C, D, E, H) come from those providers\' published documentation');
  out.push('and are a different grade of evidence. Do not blur the two.');
  out.push('');
  out.push('Run `node simulate.js --scenario A` to see one, or --all --out fixtures/ for all.');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function resolvePublicKey(args) {
  return args.publicKey ||
    process.env.NEXUS_SIM_PUBLIC_KEY ||
    'sim_pk_PLACEHOLDER_SET_NEXUS_SIM_PUBLIC_KEY';
}

function selectScenarios(args) {
  if (args.all) return SCENARIOS;
  if (args.scenario) {
    const s = byId(args.scenario);
    if (!s) {
      fail('no scenario ' + JSON.stringify(args.scenario) + '. Run --list to see the ids.');
    }
    return [s];
  }
  return null;
}

function isLocalHost(u) {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || /\.local$/.test(h);
  } catch (e) {
    return false;
  }
}

async function post(url, fixture) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // A receiving endpoint that cannot see these headers has no business
      // accepting the body.
      'x-nexus-simulation': '1',
      'x-nexus-environment': C.ENVIRONMENT,
      'x-nexus-provenance': C.EMITTED_PROVENANCE,
      'x-nexus-notice': C.ENVIRONMENT_LABEL
    },
    body: JSON.stringify(fixture)
  });
  let body;
  try { body = await res.text(); } catch (e) { body = '<unreadable>'; }
  return { status: res.status, body: body.slice(0, 2000) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { process.stdout.write(HELP + '\n'); return; }
  if (args.list) { process.stdout.write(renderList() + '\n'); return; }

  const chosen = selectScenarios(args);
  if (!chosen) {
    process.stdout.write(HELP + '\n');
    fail('nothing to do: pass --list, --scenario <id> or --all.');
  }

  const publicKey = resolvePublicKey(args);

  // lead_ingest_endpoint_public_key_shape. Failing here beats failing at the
  // write with a constraint name nobody recognises.
  if (!C.PUBLIC_KEY_SHAPE.test(publicKey)) {
    fail(
      'public key ' + JSON.stringify(publicKey) + ' does not match the shape the database\n' +
      '  requires of an ingest endpoint: ' + C.PUBLIC_KEY_SHAPE.source + '\n' +
      '  (constraint lead_ingest_endpoint_public_key_shape).'
    );
  }

  if (publicKey.indexOf('sim') === -1) {
    process.stderr.write(
      'WARNING: --public-key ' + JSON.stringify(publicKey) + ' does not look like a\n' +
      '         simulation endpoint key. The simulator will still declare provenance\n' +
      '         "' + C.EMITTED_PROVENANCE + '", which a production endpoint refuses.\n'
    );
  }

  if (args.post && !isLocalHost(args.post) && !args.allowRemote) {
    fail(
      '--post ' + args.post + ' is not a local host, and --allow-remote was not given.\n' +
      '  Posting simulated leads at a remote ingest is exactly the mistake this rail exists\n' +
      '  to prevent. If you mean it, add --allow-remote.'
    );
  }

  const fixtures = chosen.map(function (s) {
    return { scenario: s, fixture: buildFixture(s, { publicKey: publicKey }) };
  });

  // --out
  if (args.out) {
    const dir = path.resolve(process.cwd(), args.out);
    fs.mkdirSync(dir, { recursive: true });
    fixtures.forEach(function (f) {
      const file = path.join(dir, f.scenario.id + '-' + f.scenario.slug + '.json');
      fs.writeFileSync(file, JSON.stringify(f.fixture, null, args.pretty ? 2 : 0) + '\n', 'utf8');
      process.stdout.write('wrote ' + file + '\n');
    });
  }

  // --post
  if (args.post) {
    for (const f of fixtures) {
      const r = await post(args.post, f.fixture);
      process.stdout.write(
        'POST ' + f.scenario.id + ' -> ' + r.status + '  ' + r.body.replace(/\s+/g, ' ') + '\n'
      );
    }
    return;
  }

  // --dry-run (default): stdout, nothing touched
  if (!args.out) {
    const payload = fixtures.length === 1
      ? fixtures[0].fixture
      : fixtures.map(function (f) { return f.fixture; });
    process.stdout.write(JSON.stringify(payload, null, args.pretty ? 2 : 0) + '\n');
  }
}

main().catch(function (e) {
  fail(e && e.stack ? e.stack : String(e));
});
