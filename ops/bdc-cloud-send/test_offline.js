// NX1007-cloud offline test: runs the tenant-resolve + channel-pick Code
// nodes from the patched BDC candidate under stubbed n8n globals. No network,
// no n8n, no Supabase. Exercises exactly the logic that decides WHOSE
// dealership a message belongs to and WHICH channel a reply goes out on.
//
// Scenarios (per task spec):
//   1. WAHA Tenant A                  -> resolves via WAHA session, waha door
//   2. Cloud Tenant A                 -> resolves via Cloud receiver, cloud door
//   3. Cloud unregistered         -> refuses (no tenant_id from caller)
//   4. Cloud dealer B             -> resolves B, NOT Tenant A; sends from B's number
//   5. Outside 24h window         -> refuses the send (window closed)
"use strict";
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const WF_PATH = process.argv[2] || "ops/bdc-cloud-send/patched/LTBExI7QzFeANeFg.json";
const wf = JSON.parse(fs.readFileSync(WF_PATH, "utf8"));
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

function jsCode(nodeName) {
  const n = byName[nodeName];
  if (!n) throw new Error("no such node: " + nodeName);
  if (n.parameters.mode && n.parameters.mode !== "runOnceForAllItems") {
    throw new Error(nodeName + " is not runOnceForAllItems, harness assumes it is");
  }
  return n.parameters.jsCode;
}

// Runs one Code node's jsCode with a stubbed n8n runtime.
//   inputItem : the item $input.first().json returns
//   named     : { 'Node Name': jsonValueOrThrowFn, ... } for $('Node Name').first().json
//   env       : object backing $env
// Returns the single json object the code returns (n8n's `[{ json: {...} }]`
// convention), or throws whatever the code throws.
function runCodeNode(code, { inputItem = {}, named = {}, env = {} } = {}) {
  const sandbox = {
    console,
    $input: { first: () => ({ json: inputItem }), all: () => [{ json: inputItem }] },
    $env: env,
    $now: { toISO: () => "2026-09-21T12:00:00.000Z", toUTC: () => ({ toISO: () => "2026-09-21T12:00:00.000Z" }) },
    $: (name) => {
      if (!(name in named)) {
        const e = new Error(`node '${name}' did not run on this branch`);
        throw e;
      }
      const v = named[name];
      if (typeof v === "function") return { first: () => ({ json: v() }) };
      return { first: () => ({ json: v }) };
    },
    __result__: undefined,
  };
  vm.createContext(sandbox);
  // Wrap exactly like n8n does: the last expression's `return [...]` becomes
  // the node's output. We capture it via an IIFE assigned to __result__.
  const wrapped = `__result__ = (function(){\n${code}\n})();`;
  vm.runInContext(wrapped, sandbox, { timeout: 2000 });
  const out = sandbox.__result__;
  assert(Array.isArray(out) && out.length === 1, "expected exactly one output item");
  return out[0].json;
}

function expectThrow(fn, matchSubstr) {
  try {
    fn();
  } catch (e) {
    assert(String(e.message).includes(matchSubstr), `expected error containing "${matchSubstr}", got: ${e.message}`);
    return e;
  }
  throw new Error("expected a throw containing: " + matchSubstr);
}

let passed = 0;
function ok(label) {
  passed++;
  console.log("  ok -", label);
}

const Tenant A = "fff6a2b5-cfd5-4460-8383-875bc5826de0";
const ALBA_INTEGRATION = "9129126e-da78-4340-a89d-ca703b9fc169";
const ALBA_PNID = "1306545252542419";
const DEALER_B = "11111111-2222-3333-4444-555555555555";
const DEALER_B_INTEGRATION = "66666666-7777-8888-9999-000000000000";
const DEALER_B_PNID = "999888777000111";

// ---------------------------------------------------------------------
// Scenario 1: WAHA Tenant A -- inbound via the WAHA door, unaffected by this
// patch. Tenant Context must still resolve via
// 'Resolve Tenant From WAHA Session' and mark inbound_channel whatsapp_waha.
// ---------------------------------------------------------------------
{
  console.log("Scenario 1: WAHA Tenant A");
  const tcCode = jsCode("Tenant Context");
  const out = runCodeNode(tcCode, {
    inputItem: { some: "waha-item" },
    named: {
      "Resolve Tenant From WAHA Session": {
        tenant_id: Tenant A, tenant_slug: "alba-cars", integration_id: ALBA_INTEGRATION,
        external_identifier: "default", credential_ref: "env:WAHA_API_KEY",
      },
    },
  });
  assert.strictEqual(out.tenant_id, Tenant A);
  assert.strictEqual(out.tenant_origin, "waha_session_channel_registry");
  assert.strictEqual(out.inbound_channel, "whatsapp_waha");
  assert.strictEqual(out.cloud_phone_number_id, null);
  assert.strictEqual(out.waha_session, "default");
  ok("Tenant Context resolves Tenant A via WAHA session, inbound_channel=whatsapp_waha, no cloud id leaks in");
}

// ---------------------------------------------------------------------
// Scenario 2: Cloud Tenant A -- inbound via the Cloud receiver's Execute
// Workflow handoff. Require Cloud Context From Receiver validates the
// shape, Tenant Context resolves via the third source, and the reply
// channel picked is Cloud, on the SAME phone_number_id it arrived on.
// ---------------------------------------------------------------------
{
  console.log("Scenario 2: Cloud Tenant A");
  const rcCode = jsCode("Require Cloud Context From Receiver");
  const rc = runCodeNode(rcCode, {
    inputItem: {
      tenant_id: Tenant A, tenant_slug: "alba-cars", integration_id: ALBA_INTEGRATION,
      phone_number_id: ALBA_PNID, customer_wa_id: "971501234567",
      message_id: "wamid.ALBA123", occurred_at: "2026-09-21T11:59:00.000Z",
      message_kind: "text", text: "Do you have the Land Cruiser in stock?",
      customer_display_name: "Khalid",
    },
  });
  assert.strictEqual(rc.tenant_id, Tenant A);
  assert.strictEqual(rc.cloud_phone_number_id, ALBA_PNID);
  assert.strictEqual(rc.cloud_customer_wa_id, "971501234567");
  assert.strictEqual(rc.cloud_message_text, "Do you have the Land Cruiser in stock?");
  ok("Require Cloud Context From Receiver accepts a well-formed handoff for Tenant A");

  const tcCode = jsCode("Tenant Context");
  const tc = runCodeNode(tcCode, {
    inputItem: {},
    named: { "Require Cloud Context From Receiver": rc },
  });
  assert.strictEqual(tc.tenant_id, Tenant A);
  assert.strictEqual(tc.tenant_origin, "cloud_receiver_verified");
  assert.strictEqual(tc.inbound_channel, "whatsapp_cloud");
  assert.strictEqual(tc.cloud_phone_number_id, ALBA_PNID, "reply must go out on the SAME number the message arrived on");
  ok("Tenant Context resolves Tenant A via the Cloud receiver, inbound_channel=whatsapp_cloud, same phone_number_id");

  // Reply Channel Is Cloud? (IF node logic, inlined here since it's declarative)
  const replyIsCloud = tc.inbound_channel === "whatsapp_cloud";
  assert.strictEqual(replyIsCloud, true);
  ok("Reply Channel Is Cloud? routes Tenant A's Cloud-origin reply into the Cloud send branch");
}

// ---------------------------------------------------------------------
// Scenario 3: Cloud unregistered -- the caller (Cloud receiver) did not
// pass a resolvable tenant (this is what happens upstream when
// 'Channel Registered To A Dealership?' is false and the receiver never
// calls this workflow at all -- simulated here directly as a malformed
// handoff to prove BDC ALSO refuses if it ever were called that way).
// ---------------------------------------------------------------------
{
  console.log("Scenario 3: Cloud unregistered (refuse)");
  const rcCode = jsCode("Require Cloud Context From Receiver");
  expectThrow(
    () => runCodeNode(rcCode, {
      inputItem: {
        tenant_id: "", tenant_slug: null, integration_id: "",
        phone_number_id: "15550009999", customer_wa_id: "971500000000",
        message_id: "wamid.UNKNOWN1", occurred_at: "2026-09-21T11:59:00.000Z",
        message_kind: "text", text: "hello",
      },
    }),
    "BDC_CLOUD_CONTEXT_INCOMPLETE"
  );
  ok("Require Cloud Context From Receiver refuses (throws) when no tenant_id/integration_id resolved -- no default tenant");

  // And Tenant Context itself refuses if NOTHING resolves at all (belt and
  // braces -- the second place that would have to fail for an unattributed
  // message to be answered).
  const tcCode = jsCode("Tenant Context");
  expectThrow(() => runCodeNode(tcCode, { inputItem: {}, named: {} }), "BDC_TENANT_UNRESOLVED");
  ok("Tenant Context refuses when no source (WAHA/outreach/Cloud) resolved a tenant at all");
}

// ---------------------------------------------------------------------
// Scenario 4: Cloud dealer B -- a SECOND tenant's Cloud channel. Proves
// tenant resolution is not hardcoded to Tenant A and the reply is pinned to
// dealer B's OWN phone_number_id, never Tenant A's.
// ---------------------------------------------------------------------
{
  console.log("Scenario 4: Cloud dealer B (not Tenant A)");
  const rcCode = jsCode("Require Cloud Context From Receiver");
  const rc = runCodeNode(rcCode, {
    inputItem: {
      tenant_id: DEALER_B, tenant_slug: "dealer-b", integration_id: DEALER_B_INTEGRATION,
      phone_number_id: DEALER_B_PNID, customer_wa_id: "971509998877",
      message_id: "wamid.DEALERB1", occurred_at: "2026-09-21T11:59:00.000Z",
      message_kind: "text", text: "What is the price of the Camry?",
      customer_display_name: "Sara",
    },
  });
  const tcCode = jsCode("Tenant Context");
  const tc = runCodeNode(tcCode, { inputItem: {}, named: { "Require Cloud Context From Receiver": rc } });
  assert.strictEqual(tc.tenant_id, DEALER_B);
  assert.notStrictEqual(tc.tenant_id, Tenant A);
  assert.strictEqual(tc.cloud_phone_number_id, DEALER_B_PNID);
  assert.notStrictEqual(tc.cloud_phone_number_id, ALBA_PNID);
  ok("Tenant Context resolves dealer B independently of Tenant A, and pins the reply to B's own phone_number_id");
}

// ---------------------------------------------------------------------
// Scenario 5: Outside 24h window -- whatsapp_policy_decision() (stubbed,
// not reimplemented) returns TEMPLATE_REQUIRED. Cloud Window Decision
// must surface that faithfully, and the IF gate must refuse the send
// (this harness checks the same boolean 'Cloud Window Open?' evaluates).
// ---------------------------------------------------------------------
{
  console.log("Scenario 5: outside 24h window (refuse)");
  const wdCode = jsCode("Cloud Window Decision");
  const decision = runCodeNode(wdCode, {
    inputItem: {}, // Cloud Window Decision reads $input.all(), not $input.first()
  });
  // whatsapp_policy_decision returned NO row at all (e.g. RPC hiccup) -> BLOCKED default
  assert.strictEqual(decision.window_decision, "BLOCKED");
  ok("Cloud Window Decision defaults to BLOCKED (fail closed) when no decision row comes back");

  // Now the real "outside window" case: the SQL function said TEMPLATE_REQUIRED.
  const sandbox = {
    $input: {
      all: () => [{ json: {
        decision: "TEMPLATE_REQUIRED", reason_code: "WINDOW_RULE_VERIFIED",
        reason: "The last inbound message from this customer was outside the 24h customer service window.",
        window_state: "CLOSED",
      } }],
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`__result__ = (function(){\n${wdCode}\n})();`, sandbox, { timeout: 2000 });
  const outsideWindow = sandbox.__result__[0].json;
  assert.strictEqual(outsideWindow.window_decision, "TEMPLATE_REQUIRED");
  const windowOpen = outsideWindow.window_decision === "FREEFORM_ALLOWED";
  assert.strictEqual(windowOpen, false, "Cloud Window Open? must evaluate false outside the window");
  ok("Cloud Window Decision reports TEMPLATE_REQUIRED and Cloud Window Open? refuses the send (templates out of scope -> no send)");

  const nwCode = jsCode("Note: Cloud Window Closed");
  const note = runCodeNode(nwCode, { inputItem: outsideWindow });
  assert.strictEqual(note.status, "BLOCKED");
  assert(note.summary.includes("TEMPLATE_REQUIRED"), "audit summary must name the decision");
  ok("Note: Cloud Window Closed produces a BLOCKED audit row naming the decision, ready for Audit Log (Cloud BDC Send)");
}

console.log(`\n${passed} assertions passed. All 5 required scenarios OK.`);
