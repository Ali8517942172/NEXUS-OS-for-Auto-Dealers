import { workflow, node, trigger, ifElse } from '@n8n/workflow-sdk';
import { readFileSync } from 'node:fs';

/* The body of the Verify Or Refuse node is NOT written out again here. It used
 * to be, as an array of string literals, and a copy of a security decision is a
 * copy that drifts -- the same defect that let the repo and the box disagree
 * about the '+' fix for six days. There is one file, it is the one the test
 * suite runs, and this builder reads it. */
const VERIFY_OR_REFUSE = readFileSync(
  new URL('./verify-or-refuse.node.js', import.meta.url), 'utf8');


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
      jsCode: VERIFY_OR_REFUSE,
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
