import { workflow, node, trigger, ifElse } from '@n8n/workflow-sdk';

const SUPABASE = 'https://dsvuoovivysszdoiorch.supabase.co';

const hook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Meta Cloud Webhook',
    parameters: {
      multipleMethods: true,
      httpMethod: ['GET', 'POST'],
      path: 'whatsapp-cloud-inbound',
      authentication: 'none',
      responseMode: 'responseNode',
      options: { rawBody: true },
    },
  },
});

const gate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Verify Or Refuse',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: [
        "/* The whole security decision lives here, and nothing before it writes.",
        " * Two rules this node exists to keep:",
        " *   1. Meta signs the EXACT BYTES it sent. Re-serialising the parsed JSON",
        " *      gives different bytes for any non-ASCII name and silently refuses a",
        " *      genuine delivery. So we hash the raw body, never a re-encode.",
        " *   2. With no app secret configured this receiver REFUSES. It does not",
        " *      pass traffic through the way the WAHA gate did when its env var was",
        " *      unset - a dormant gate is an open door. */",
        "const item    = $input.first();",
        "const j       = item.json || {};",
        "const headers = j.headers || {};",
        "const query   = j.query || {};",
        "",
        "const VERIFY_TOKEN = String($env.META_WEBHOOK_VERIFY_TOKEN || '');",
        "const APP_SECRET   = String($env.META_APP_SECRET || '');",
        "",
        "const refuse = (status, code, why) => [{ json: {",
        "  verdict: 'REFUSE', respond_status: status, respond_text: code,",
        "  reason_code: code, why, wrote_nothing: true,",
        "} }];",
        "",
        "const sameString = (a, b) => {",
        "  /* length first, then every position - never a short-circuit on the first",
        "     differing character, which leaks the prefix by timing. */",
        "  if (a.length !== b.length) return false;",
        "  let diff = 0;",
        "  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);",
        "  return diff === 0;",
        "};",
        "",
        "/* ---- Meta's GET subscription handshake ------------------------------ */",
        "if (query['hub.mode'] !== undefined || query['hub.challenge'] !== undefined) {",
        "  if (!VERIFY_TOKEN) {",
        "    return refuse(500, 'VERIFY_TOKEN_NOT_CONFIGURED',",
        "      'META_WEBHOOK_VERIFY_TOKEN is unset on this box. Confirming a subscription ' +",
        "      'we cannot authenticate would let anyone point Meta deliveries at us.');",
        "  }",
        "  if (String(query['hub.mode']) !== 'subscribe') {",
        "    return refuse(400, 'HUB_MODE_NOT_SUBSCRIBE', 'hub.mode was not \"subscribe\".');",
        "  }",
        "  if (!sameString(String(query['hub.verify_token'] || ''), VERIFY_TOKEN)) {",
        "    return refuse(403, 'HUB_VERIFY_TOKEN_MISMATCH', 'The verify token did not match.');",
        "  }",
        "  return [{ json: {",
        "    verdict: 'CHALLENGE', respond_status: 200,",
        "    respond_text: String(query['hub.challenge'] || ''),",
        "    reason_code: 'SUBSCRIPTION_CONFIRMED', wrote_nothing: true,",
        "  } }];",
        "}",
        "",
        "/* ---- Everything below is a POST delivery ---------------------------- */",
        "if (!APP_SECRET) {",
        "  /* 5XX, not 4XX. A 4XX tells Meta not to retry, and for a lead that means it",
        "     is gone. Our missing configuration is our failure, so we answer like one. */",
        "  return refuse(500, 'APP_SECRET_NOT_CONFIGURED',",
        "    'META_APP_SECRET is unset on this box, so no delivery can be verified. ' +",
        "    'Refusing every request until it is set - this gate is never dormant.');",
        "}",
        "",
        "let raw = null, raw_source = null;",
        "const bin = item.binary && (item.binary.data || item.binary.body);",
        "if (bin && bin.data) { raw = Buffer.from(bin.data, 'base64'); raw_source = 'binary'; }",
        "else if (typeof j.body === 'string') { raw = Buffer.from(j.body, 'utf8'); raw_source = 'string'; }",
        "if (!raw) {",
        "  return refuse(500, 'RAW_BODY_NOT_AVAILABLE',",
        "    'The webhook node did not hand this node the raw body, so the bytes Meta ' +",
        "    'signed are already gone and no amount of care downstream gets them back. ' +",
        "    'Turn on Raw Body on the webhook node.');",
        "}",
        "",
        "const sigHeader = String(headers['x-hub-signature-256'] || '');",
        "if (!sigHeader.startsWith('sha256=')) {",
        "  return refuse(401, 'SIGNATURE_HEADER_MISSING',",
        "    'No X-Hub-Signature-256 on the request. Meta always sends one.');",
        "}",
        "",
        "let expected = null;",
        "try {",
        "  const c = require('crypto');",
        "  expected = 'sha256=' + c.createHmac('sha256', APP_SECRET).update(raw).digest('hex');",
        "} catch (e) { expected = null; }",
        "if (expected === null) {",
        "  /* node:crypto is not requirable in this sandbox; WebCrypto is a global. */",
        "  const key = await crypto.subtle.importKey(",
        "    'raw', new TextEncoder().encode(APP_SECRET),",
        "    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);",
        "  const sig = await crypto.subtle.sign('HMAC', key, raw);",
        "  expected = 'sha256=' + Array.from(new Uint8Array(sig))",
        "    .map(b => b.toString(16).padStart(2, '0')).join('');",
        "}",
        "if (!sameString(sigHeader, expected)) {",
        "  return refuse(401, 'SIGNATURE_MISMATCH',",
        "    'X-Hub-Signature-256 did not match an HMAC-SHA256 of the raw body under ' +",
        "    'the app secret. Nothing was written.');",
        "}",
        "",
        "let payload;",
        "try { payload = JSON.parse(raw.toString('utf8')); }",
        "catch (e) { return refuse(400, 'BODY_NOT_JSON', 'Signature verified but the body is not JSON.'); }",
        "",
        "const out = [];",
        "for (const entry of (payload.entry || [])) {",
        "  for (const ch of (entry.changes || [])) {",
        "    const v        = ch.value || {};",
        "    const pnid     = String((v.metadata || {}).phone_number_id || '');",
        "    const contacts = v.contacts || [];",
        "    for (const m of (v.messages || [])) {",
        "      const wa      = String(m.from || '');",
        "      const contact = contacts.find(c => String(c.wa_id || '') === wa) || {};",
        "      const ts      = Number(m.timestamp || 0);",
        "      const id      = String(m.id || '');",
        "      /* An undated or unidentified message cannot open a window: there would be",
        "         nothing to deduplicate a redelivery against, and a replay would extend",
        "         Meta's 24-hour window for us. Accept the delivery, measure nothing. */",
        "      const measurable = ts > 0 && id !== '';",
        "      out.push({ json: {",
        "        verdict: measurable ? 'ACCEPT' : 'ACCEPT_UNMEASURABLE',",
        "        respond_status: 200,",
        "        respond_text: 'ok',",
        "        reason_code: measurable ? 'SIGNATURE_VERIFIED' : 'MESSAGE_NOT_MEASURABLE',",
        "        raw_source,",
        "        phone_number_id: pnid,",
        "        waba_id: String(entry.id || ''),",
        "        customer_wa_id: wa,",
        "        customer_name: String((contact.profile || {}).name || ''),",
        "        message_id: id,",
        "        message_kind: String(m.type || 'text'),",
        "        occurred_at: measurable ? new Date(ts * 1000).toISOString() : null,",
        "        text: m.text ? String(m.text.body || '') : '',",
        "        origin_verified: 'hmac_sha256_x_hub',",
        "      } });",
        "    }",
        "  }",
        "}",
        "",
        "if (!out.length) {",
        "  return [{ json: {",
        "    verdict: 'ACCEPT_NO_MESSAGE', respond_status: 200, respond_text: 'ok',",
        "    reason_code: 'NO_INBOUND_MESSAGE_IN_DELIVERY', wrote_nothing: true, raw_source,",
        "    note: 'Signature verified. This delivery carried no inbound message - a status ' +",
        "          'callback or a change we do not consume yet.',",
        "  } }];",
        "}",
        "return out;",
      ].join('\n'),
    },
  },
});

const accepted = ifElse({
  version: 2.2,
  config: {
    name: 'Signature Verified And Measurable?',
    parameters: {
      options: {},
      conditions: {
        options: { caseSensitive: true, leftValue: '', version: 2, typeValidation: 'strict' },
        combinator: 'and',
        conditions: [{
          id: 'accept-verdict',
          leftValue: '={{ $json.verdict }}',
          rightValue: 'ACCEPT',
          operator: { type: 'string', operation: 'equals' },
        }],
      },
    },
  },
});

const resolveTenant = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Resolve Tenant From Phone Number ID',
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    parameters: {
      method: 'POST',
      url: SUPABASE + '/rest/v1/rpc/nexus_resolve_channel_tenant',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ p_channel_type: 'whatsapp_cloud_phone_number_id', p_external_identifier: $json.phone_number_id }) }}",
      options: { timeout: 10000 },
    },
  },
});

const known = ifElse({
  version: 2.2,
  config: {
    name: 'Channel Registered To A Dealership?',
    parameters: {
      options: {},
      conditions: {
        options: { caseSensitive: true, leftValue: '', version: 2, typeValidation: 'loose' },
        combinator: 'and',
        conditions: [{
          id: 'has-tenant',
          leftValue: '={{ $json.tenant_id }}',
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty', singleValue: true },
        }],
      },
    },
  },
});

const recordEvent = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Record Channel Event',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1500,
    parameters: {
      method: 'POST',
      url: SUPABASE + '/rest/v1/rpc/nexus_record_channel_event',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ p_integration_id: $json.integration_id, p_direction: 'inbound', p_external_message_id: $('Verify Or Refuse').item.json.message_id, p_origin_verified: 'hmac_sha256_x_hub', p_received_at: $('Verify Or Refuse').item.json.occurred_at, p_customer_external_id: $('Verify Or Refuse').item.json.customer_wa_id, p_customer_phone: (String($('Verify Or Refuse').item.json.customer_wa_id || '').replace(/[^0-9]/g, '') || null), p_message_kind: $('Verify Or Refuse').item.json.message_kind, p_provider_account_id: $('Verify Or Refuse').item.json.waba_id }) }}",
      options: { timeout: 10000 },
    },
  },
});

const openWindow = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Open Or Extend Customer Service Window',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1500,
    parameters: {
      method: 'POST',
      url: SUPABASE + '/rest/v1/rpc/whatsapp_record_customer_message',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ p_tenant_id: $('Resolve Tenant From Phone Number ID').item.json.tenant_id, p_integration_id: $('Resolve Tenant From Phone Number ID').item.json.integration_id, p_customer_wa_id: $('Verify Or Refuse').item.json.customer_wa_id, p_occurred_at: $('Verify Or Refuse').item.json.occurred_at, p_external_message_id: $('Verify Or Refuse').item.json.message_id, p_source: 'whatsapp_cloud_webhook_hmac_verified' }) }}",
      options: { timeout: 10000 },
    },
  },
});

const respondAccepted = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond 200 Recorded',
    parameters: {
      respondWith: 'text',
      responseBody: 'ok',
      options: { responseCode: 200 },
    },
  },
});

const respondUnknown = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond 200 Unknown Channel',
    parameters: {
      respondWith: 'text',
      responseBody: 'ok',
      options: { responseCode: 200 },
    },
  },
});

const raiseUnknown = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Raise Unregistered Channel',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: [
        "/* Meta signed this delivery, so it is genuine - but no channel_registry row",
        " * claims the phone number it arrived on, and NEXUS will not guess a",
        " * dealership. Meta already has its 200 (this node runs after the respond",
        " * node), so this throw does not cost a retry storm; it costs a FAILED row in",
        " * audit_log via the error workflow, which is how anyone finds out. */",
        "const pnid = $('Verify Or Refuse').first().json.phone_number_id;",
        "throw new Error(",
        "  'WHATSAPP_CLOUD_CHANNEL_NOT_REGISTERED: a signature-verified Meta delivery ' +",
        "  'arrived on phone_number_id ' + pnid + ', which is not in channel_registry ' +",
        "  'under whatsapp_cloud_phone_number_id. The message was NOT recorded. Register ' +",
        "  'the number with nexus_register_channel() and Meta will redeliver nothing - ' +",
        "  'this one is lost.');",
      ].join('\n'),
    },
  },
});

const respondRefused = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Without Writing',
    parameters: {
      respondWith: 'text',
      responseBody: '={{ $json.respond_text }}',
      options: { responseCode: '={{ $json.respond_status }}' },
    },
  },
});

export default workflow('whatsapp-cloud-inbound', 'WhatsApp Cloud - Inbound Receiver (Meta)')
  .add(hook)
  .to(gate)
  .to(accepted
    .onTrue(resolveTenant.to(known
      .onTrue(recordEvent.to(openWindow).to(respondAccepted))
      .onFalse(respondUnknown.to(raiseUnknown))))
    .onFalse(respondRefused));
