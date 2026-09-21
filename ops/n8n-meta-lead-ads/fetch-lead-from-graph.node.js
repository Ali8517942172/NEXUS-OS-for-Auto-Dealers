/* The exact body of the "Fetch Lead From Graph" Code node in the n8n workflow
 * "Meta Lead Ads - Inbound Receiver" — hop two, the one that was never written.
 *
 * WHY THIS NODE HAS TO EXIST AT ALL
 *
 * Hop one (`verify-and-extract.node.js`) proves the delivery came from Meta and
 * pulls six identifiers out of it. None of them is a customer. Hop three
 * (`normalize-and-redact.node.js`) expects `$input.first().json` to already BE
 * the Graph API's answer for that lead. Between those two files there was a gap
 * the repository described in prose and never filled: the single HTTP call that
 * turns a leadgen_id into a person.
 *
 * GET https://graph.facebook.com/v<v>/<leadgen_id>?fields=...
 *
 * FOUR RULES THIS NODE EXISTS TO KEEP
 *
 * 1. THE TOKEN GOES IN A HEADER, NEVER IN THE QUERY STRING.
 *    Graph accepts `?access_token=EAA...`. Every guide uses it. It is also how
 *    a Page token ends up permanently readable in the n8n execution record, in
 *    the reverse proxy's access log, and in whatever sits between this box and
 *    Meta. `Authorization: Bearer` keeps it out of all three. The URL built
 *    below carries only the lead id and the field list, and that is on purpose.
 *
 * 2. THE TOKEN IS PER PAGE, RESOLVED FROM page_id, AND THERE IS NO OTHER.
 *    One n8n box serves many dealerships. Each connects its own Facebook Page
 *    and its Page access token is stored in the vault (NX980) against that
 *    Page's lead-ingest endpoint, kind 'meta_page_access_token'. The token is
 *    fetched per lead, keyed on the page_id that arrived inside the body whose
 *    HMAC verified (the HMAC is the one app-level secret, META_APP_SECRET:
 *    there is one NEXUS Meta app). There is NO box-wide token and no fallback
 *    to one: no box-level Page token env var is read. A fallback nobody turns
 *    off is how a system stays single-tenant forever while looking otherwise.
 *
 * 2b. THE TOKEN'S DEALERSHIP MUST BE THE ROW'S DEALERSHIP.
 *    Record Lead Event wrote the RECEIVED row under a tenant. The vault answers
 *    with the tenant that owns the Page token. If they differ, or either is
 *    missing, nothing is fetched: a Page of tenant X only ever produces leads
 *    for X, and a lead of X is never read with Y's credential.
 *
 * 3. GRAPH'S error.message NEVER LEAVES THIS NODE.
 *    Meta's OAuthException messages routinely echo the request back, and this
 *    request carried a Bearer token. `error.message` is read nowhere below.
 *    Only `error.code`, `error.error_subcode` and `error.type` are carried out,
 *    and the human-readable sentence attached to each is OURS — written here,
 *    from the code, so it says what the dealership must actually go and fix.
 *    (`fbtrace_id` is deliberately not carried either: harmless in isolation,
 *    but the moment it is carried somebody adds `message` beside it.)
 *
 * 4. EVERY PATH FAILS CLOSED, WITH A NAME.
 *    There is no branch that returns a half-lead, and none that invents one.
 *    A failure here leaves the lead_event row exactly where door one put it —
 *    phase RECEIVED, no `leads` row, nothing a salesperson can see — and says
 *    which of the six named things went wrong. That is the whole point of the
 *    phases: a broken token produces a row that stops, not a blank customer.
 *
 * ON THE HTTP STATUS THIS NODE ASKS THE WORKFLOW TO ANSWER META.
 *    `respond_status` is 500 when a retry of the SAME delivery could still
 *    succeed once a human fixes something (no token, wrong token, no Lead
 *    Access, rate limit, Graph down) and 200 when it never could (this lead id
 *    is not ours, the form collected nothing). Answering 4XX to something a
 *    human can fix throws away a real customer to make a graph look tidy.
 */
const ctx = $('Verify Or Refuse').item.json || {};
/* event_id exists only because Record Lead Event created the row. Reading it
   off the gate — where it does not exist — is the mistake hop three's header
   already warns about; the same trap is one node earlier here. */
const recorded = $('Record Lead Event').item.json || {};

const pageId = String(ctx.page_id || '');
const leadgenId = String(ctx.leadgen_id || '');
const eventId = recorded.event_id ? String(recorded.event_id) : '';

const SUPABASE_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY  = String($env.SUPABASE_SERVICE_ROLE_KEY || $env.SUPABASE_KEY || '');
/* The vault kind registered in public.lead_ingest_secret_kind (FK). The
   dealer connect flow must store the Page token under exactly this kind. */
const PAGE_TOKEN_KIND = 'meta_page_access_token';
const recordedTenant = recorded.tenant_id ? String(recorded.tenant_id) : '';

/* Pinned, and validated rather than interpolated: a stray value here becomes a
   path segment on graph.facebook.com. v25.0 is what GO-LIVE.md measured. */
const GRAPH_VERSION =
  /^v\d+\.\d+$/.test(String($env.META_GRAPH_VERSION || '').trim())
    ? String($env.META_GRAPH_VERSION).trim() : 'v25.0';

/* Exactly the fields hop three allowlists, and not one more. Asking for less
   than hop three reads is a silently empty column; asking for more is data we
   have no stated purpose for holding about a person. */
const FIELDS = 'id,created_time,field_data,platform,form_id,ad_id,ad_name,' +
               'adset_id,adset_name,campaign_id,campaign_name,is_organic';

/* Never copied out of Graph's answer into an item, however Meta labels it. The
   database constraint and hop three's allowlist both cover the row that gets
   written; this covers the n8n execution record, which nothing else does. */
const NEVER_COPY = new Set([
  'access_token', 'app_secret', 'client_secret', 'api_key', 'apikey',
  'authorization', 'appsecret_proof', 'refresh_token', 'secret',
]);

const http = (typeof $helpers !== 'undefined' && $helpers && $helpers.httpRequest)
  ? $helpers.httpRequest.bind($helpers)
  : null;

let token = '';
let token_source = null;
let resolved_tenant_id = null, resolved_endpoint_id = null, resolved_source_key = null;

/* Everything the workflow needs to answer Meta and to leave a readable trace,
   with not one field that could carry a credential. `retryable` decides the
   status; `phase_remains` is the honest statement of what the row still is. */
const stop = (code, why, retryable, extra) => [{ json: Object.assign({
  verdict: 'NOT_FETCHED',
  reason_code: code,
  why,
  respond_status: retryable ? 500 : 200,
  respond_text: retryable ? code : 'ok',
  retryable: !!retryable,
  hydration_blocked: true,
  phase_remains: 'RECEIVED',
  event_id: eventId || null,
  page_id: pageId || null,
  leadgen_id: leadgenId || null,
  graph_version: GRAPH_VERSION,
  token_source,
  tenant_id: resolved_tenant_id,
  endpoint_id: resolved_endpoint_id,
  source_key: resolved_source_key,
}, extra || {}) }];

/* One place that talks to the database, so there is one place that can fail.
   Returns null on any failure rather than throwing: a vault that is unreachable
   must end in a refusal we can read, not an n8n exception with a stack trace
   that a dealership is then shown as "an error occurred". */
async function rpc(fn, body) {
  if (!http || !SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const res = await http({
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/' + fn,
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
                 'Content-Type': 'application/json' },
      body: body, json: true, timeout: 8000,
    });
    if (Array.isArray(res)) return res.length ? res[0] : null;
    return res || null;
  } catch (e) { return null; }
}

/* ---- Nothing can be fetched without the two ids and the row ---------------- */
if (!leadgenId) {
  return stop('NO_LEADGEN_ID_TO_FETCH',
    'Hop one accepted the delivery but carried no leadgen_id, so there is no ' +
    'lead to fetch. Nothing was written and nothing can be.', false);
}
if (!eventId) {
  /* Retryable on purpose: this means door one did not return an event_id, so
     there is no RECEIVED row to hydrate. A redelivery re-runs the whole chain
     and is deduplicated by nexus_record_lead_event, so a retry is safe and is
     the lead's only remaining chance. */
  return stop('NO_EVENT_ID_FROM_RECORD',
    'Record Lead Event returned no event_id, so there is no RECEIVED row to ' +
    'hydrate. Fetching the customer now would produce data with nowhere to go.',
    true);
}

/* ---- Which dealership's token, and only then the fetch -------------------- */
if (pageId) {
  const got = await rpc('nexus_lead_ingest_secret_reveal', {
    p_provider: 'meta',
    p_identity_kind: 'facebook_page_id',
    p_identity_value: pageId,
    p_kind: PAGE_TOKEN_KIND,
    p_reason: 'leadgen hydrate',
  });
  /* Named fields only. `got` is never spread, never logged and never returned:
     one of its columns is the token. */
  if (got && got.secret) {
    token = String(got.secret);
    token_source = 'vault_per_dealer';
    resolved_tenant_id = got.tenant_id || null;
    resolved_endpoint_id = got.endpoint_id || null;
    resolved_source_key = got.source_key || null;
  }
}

if (!token) {
  return stop('NO_PAGE_TOKEN_FOR_THIS_PAGE',
    (pageId
      ? ('No active ' + PAGE_TOKEN_KIND + ' is installed for Facebook Page ' + pageId +
         ' (Page not registered, endpoint or dealership not active, token not ' +
         'installed, or the vault was unreachable)')
      : 'This delivery named no page_id, so no dealership could be identified') +
    '. There is no box-wide fallback and there must not be. The dealership ' +
    'reconnects its Page, which stores the token with nexus_lead_ingest_secret_put.',
    true,
    { vault_reachable: !!(http && SUPABASE_URL && SERVICE_KEY) });
}

/* ---- Rule 2b: the token's dealership is the row's dealership ------------- */
if (!recordedTenant || !resolved_tenant_id ||
    String(resolved_tenant_id) !== recordedTenant) {
  const tokenTenant = resolved_tenant_id;
  token = '';
  return stop('PAGE_TOKEN_TENANT_MISMATCH',
    'The Page token the vault returned belongs to a different dealership than ' +
    'the one Record Lead Event wrote this row for (or one side named no ' +
    'dealership). Fetching would read one dealership\'s lead with another ' +
    'dealership\'s credential, or file it under the wrong one. Refusing. Fix ' +
    'the lead_ingest_provider_identity rows for this Page.', true,
    { recorded_tenant_id: recordedTenant || null, token_tenant_id: tokenTenant || null });
}

/* ---- The one call that turns an id into a person -------------------------- */
let status = null, body = null, reached = false;
try {
  const res = await http({
    method: 'GET',
    url: 'https://graph.facebook.com/' + GRAPH_VERSION + '/' +
         encodeURIComponent(leadgenId),
    qs: { fields: FIELDS },
    /* Header, not query string. See rule 1 in the header of this file. */
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    json: true,
    timeout: 15000,
    returnFullResponse: true,
  });
  reached = true;
  status = (res && typeof res.statusCode === 'number') ? res.statusCode : 200;
  body = (res && res.body !== undefined) ? res.body : res;
} catch (e) {
  /* e.message is NOT read. n8n puts the request line into it and Graph puts its
     own echo into the body; between them a token or a customer could ride out
     of here inside what looks like a diagnostic. Only the structured response
     is salvaged. */
  const r = (e && (e.response || (e.cause && e.cause.response))) || null;
  if (r) {
    reached = true;
    status = r.statusCode || r.status || null;
    body = (r.body !== undefined) ? r.body : r.data;
  }
}

if (!reached) {
  return stop('GRAPH_UNREACHABLE',
    'The call to graph.facebook.com did not complete at all — DNS, TLS, egress ' +
    'or timeout. No answer was received, so nothing is known about this lead ' +
    'either way.', true);
}

if (typeof body === 'string') {
  try { body = JSON.parse(body); } catch (e) { body = {}; }
}
if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

/* ---- Graph said no ------------------------------------------------------- */
if ((typeof status === 'number' && status >= 400) || body.error) {
  const err = (body.error && typeof body.error === 'object') ? body.error : {};
  const code = (err.code === undefined || err.code === null) ? null : Number(err.code);
  const subcode = (err.error_subcode === undefined || err.error_subcode === null)
    ? null : Number(err.error_subcode);
  const type = err.type ? String(err.type) : null;

  /* Our sentences, from the code. Never Meta's, which echoes the request. */
  let reason, why, retryable = true;
  if (code === 190) {
    reason = 'GRAPH_TOKEN_REJECTED';
    why = 'Meta rejected the access token itself (code 190): it is expired, ' +
          'revoked, or was issued by a different Meta app than the one that ' +
          'owns this Page. A short-lived Page token dies in hours and a ' +
          'long-lived one in about two months, which is why the answer is a ' +
          'System User token. Re-issue it and reinstall it with ' +
          'nexus_lead_ingest_secret_put — the leads that arrive meanwhile stop ' +
          'at RECEIVED.';
  } else if (code === 10) {
    reason = 'GRAPH_LEADS_RETRIEVAL_PERMISSION_MISSING';
    why = 'Meta refused the permission (code 10): this token may not read lead ' +
          'data. The token is missing the leads_retrieval scope, or the app is ' +
          'in Development mode for this Page. This is a property of the TOKEN, ' +
          'not of the Page grant — check the scopes on the System User token ' +
          'before touching Lead Access Manager.';
  } else if (code === 200) {
    reason = 'GRAPH_LEAD_ACCESS_NOT_GRANTED';
    why = 'Meta refused the permission (code 200): the token is valid and ' +
          'carries the scope, but this System User has not been granted Lead ' +
          'Access on the Page. Business Settings → Integrations → Lead Access ' +
          'Manager → this Page → add the System User (and the app). THIS IS ' +
          'THE FAILURE THAT LOOKS LIKE SUCCESS: the webhook arrives, we answer ' +
          'Meta 200, the dealership sees a connected source, and no customer ' +
          'ever appears.';
  } else if (code === 4 || code === 17 || code === 32 || code === 613) {
    reason = 'GRAPH_RATE_LIMITED';
    why = 'Meta rate-limited this app or this Page (code ' + code + '). The ' +
          'lead still exists on Meta; the fetch must be repeated later.';
  } else if (code === 1 || code === 2) {
    reason = 'GRAPH_TRANSIENT';
    why = 'Meta returned an unknown or temporary server error (code ' + code +
          '). Nothing here is misconfigured as far as this answer shows.';
  } else if (code === 100) {
    reason = 'GRAPH_LEAD_NOT_READABLE';
    why = 'Meta could not read this object as a lead (code 100). Either the ' +
          'leadgen_id does not name a lead this app can see, or the field list ' +
          'was rejected. A retry of the same request returns the same answer.';
    retryable = false;
  } else if (code === 803) {
    reason = 'GRAPH_LEAD_NOT_VISIBLE';
    why = 'Meta says the object is not visible to this token (code 803). It is ' +
          'most often a lead belonging to a Page this token does not administer.';
    retryable = false;
  } else {
    reason = 'GRAPH_ERROR_UNCLASSIFIED';
    why = 'Meta refused the fetch with an error this node does not classify. ' +
          'The code and subcode are carried below; the message is deliberately ' +
          'not, because Meta echoes the request into it and the request carried ' +
          'a token. Read the full message in the Graph API Explorer, not here.';
  }

  return stop(reason, why, retryable, {
    graph_status: status,
    graph_error_code: code,
    graph_error_subcode: subcode,
    graph_error_type: type,
  });
}

/* ---- Graph said yes, and it has to be the lead we asked for --------------- */
const returnedId = String(body.id || '');
if (returnedId !== leadgenId) {
  /* Not paranoia about Meta: this is what a mis-paired n8n item looks like when
     two leads arrive in one delivery. Hydrating here would write one customer's
     details onto another customer's event row, permanently, and the dealership
     would have no way to know. */
  return stop('GRAPH_LEAD_ID_MISMATCH',
    'Graph answered 200 for a different lead than the one requested — asked ' +
    'for ' + leadgenId + ', got ' + (returnedId || '(no id)') + '. Hydrating ' +
    'this row would attach one customer\'s answers to another customer\'s ' +
    'event. Refusing.', false,
    { graph_status: status, graph_returned_id: returnedId || null });
}

if (!Array.isArray(body.field_data) || body.field_data.length === 0) {
  return stop('GRAPH_LEAD_HAS_NO_FIELD_DATA',
    'Graph returned the lead but with no field_data, so there are no answers ' +
    'and therefore no customer. hop three would produce a normalized shape the ' +
    'promoter refuses anyway; it is said here, where the cause is visible.',
    false, { graph_status: status });
}

/* hop three reads `$input.first().json` as the Graph response itself, so the
   response IS the item and our own fields ride alongside it. Credential-named
   top-level keys are dropped first: hop three allowlists what reaches the
   database, but nothing else protects the execution record. */
const lead = {};
for (const [k, v] of Object.entries(body)) {
  if (NEVER_COPY.has(String(k).toLowerCase())) continue;
  lead[k] = v;
}

return [{ json: Object.assign(lead, {
  verdict: 'FETCHED',
  reason_code: 'LEAD_FETCHED',
  respond_status: 200,
  respond_text: 'ok',
  retryable: false,
  hydration_blocked: false,
  event_id: eventId,
  page_id: pageId || null,
  leadgen_id: leadgenId,
  graph_status: status,
  graph_version: GRAPH_VERSION,
  /* Always 'vault_per_dealer': there is no other source. */
  token_source,
  tenant_id: resolved_tenant_id,
  endpoint_id: resolved_endpoint_id,
  source_key: resolved_source_key,
}) }];
