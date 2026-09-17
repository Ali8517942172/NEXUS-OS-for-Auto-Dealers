/**
 * NEXUS marketing site — lead receiver.
 *
 * This is deliberately NOT a raw public webhook into n8n. It is a validated
 * endpoint: it checks the origin, a honeypot, submission timing and a shape,
 * and only then does anything with the payload.
 *
 * Two things it keeps straight, and they are different planes:
 *
 *  - A person filling in this form is a prospect for NEXUS, the vendor. They
 *    are NOT a car buyer belonging to a dealership. Filing them into a
 *    dealership's `leads` table would put the vendor's own sales pipeline
 *    inside a customer's data, which is the exact boundary this product is
 *    built to hold. So the notification path is primary and always runs.
 *
 *  - Recording into `lead_event` is OPTIONAL and, when configured, points at a
 *    SIMULATION endpoint under the test showroom tenant. That exercises the
 *    real ingestion contract with real traffic without a single row of it
 *    counting as a dealership's business. The database refuses the
 *    alternative: a production endpoint cannot carry simulated provenance.
 *
 * Never answer 4XX for a processing failure. A 4XX tells a caller "do not
 * retry, this was your fault", and for a lead that means it is gone.
 * Validation failures are 4XX; anything on our side is 5XX.
 */

/* THE NOTIFICATION GOES THROUGH n8n, NOT THROUGH A MAIL PROVIDER.

   This used to POST to api.resend.com with RESEND_API_KEY and a verified
   NEXUS_NOTIFY_FROM sending domain. Nothing else in NEXUS used Resend --
   measured 8 Sep 2026: one call site, this file, and zero across all
   twenty-odd n8n workflows, which send with a gmailOAuth2 credential that has
   been working since August. So the site was the only reason a Resend account
   had to exist at all.

   It now posts the enquiry to a guarded n8n webhook, which composes the mail
   and sends it from that same Gmail credential. Two environment variables and
   an external account become one environment variable we generate ourselves.

   NEXUS_NOTIFY_WEBHOOK_URL is NOT a secret and is not required -- it is here
   so the endpoint can be moved without a deploy. NEXUS_NOTIFY_WEBHOOK_SECRET
   is the whole guard: n8n refuses a request without the matching header
   before it starts an execution, which is one better than the eleven older
   business webhooks in this system, every one of which accepts the request
   first and refuses downstream. */
const NOTIFY_WEBHOOK_URL = process.env.NEXUS_NOTIFY_WEBHOOK_URL
  || 'https://35.224.126.225.nip.io/webhook/site-enquiry';
const NOTIFY_WEBHOOK_SECRET = process.env.NEXUS_NOTIFY_WEBHOOK_SECRET || '';
const NOTIFY_HEADER = 'x-nexus-notify-secret';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const INGEST_KEY = process.env.NEXUS_LEAD_ENDPOINT_KEY || '';

/* THE DURABLE WRITE USES THE PUBLISHABLE KEY, NOT service_role.

   Measured 16 Sep 2026: this endpoint answered 503 to every enquiry it has
   ever received, because NEXUS_NOTIFY_WEBHOOK_SECRET was never set on the
   Vercel project -- which held no environment variables at all. Durability
   therefore depended on three variables that were also absent, one of them a
   service_role key that can read every dealership's customers. A public
   marketing page is the last place that key belongs.

   NX974 replaced it with one function, nexus_sales_lead_submit, that anon may
   execute and nothing else: it inserts a single NEXUS sales prospect and
   returns only what it was handed. anon cannot select the table, cannot insert
   into it directly, and cannot reach a tenant from it. So the key below is the
   PUBLISHABLE key -- the one designed to ship in a browser -- and leaking it
   buys an attacker the ability to submit a contact form they can already
   submit.

   SUPABASE_URL + SUPABASE_KEY + INGEST_KEY above remain wired for the
   simulation lead_event write. They are optional and unset today. */
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY || '';

const ALLOWED_ORIGIN_SUFFIXES = ['.vercel.app', 'nexusforautodealers.com'];

/* Best-effort per-instance rate limit. Serverless means many instances, so
   this is a speed bump and not a control — said plainly rather than described
   as protection it does not provide. */
const seen = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 60000, max = 5;
  const hits = (seen.get(ip) || []).filter(t => now - t < windowMs);
  hits.push(now);
  seen.set(ip, hits);
  if (seen.size > 500) seen.clear();
  return hits.length > max;
}

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const clean = (v, max = 400) =>
  typeof v === 'string' ? v.replace(CONTROL_CHARS, '').trim().slice(0, max) : '';

/* E.164 or nothing. We do not guess a country code blindly: pasting +971 onto
   a number that was never local is how you message a stranger. The two UAE
   forms below are recognised because this site is sold in the UAE and a local
   number typed as 05x is unambiguous here. */
function toE164(raw) {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (/^00[1-9]\d{7,14}$/.test(digits)) return '+' + digits.slice(2);
  if (/^971\d{9}$/.test(digits)) return '+' + digits;
  if (/^0?5\d{8}$/.test(digits)) return '+971' + digits.replace(/^0/, '');
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const origin = req.headers.origin || '';
  if (origin && !ALLOWED_ORIGIN_SUFFIXES.some(s => origin.endsWith(s))) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'too_many' });

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'bad_json' });
  }

  // Honeypot: a real person never fills a field they cannot see.
  if (clean(body.company_website)) return res.status(200).json({ ok: true });
  // A human cannot read six fields and submit in under a second and a half.
  if (Number(body.elapsed_ms) > 0 && Number(body.elapsed_ms) < 1500) {
    return res.status(200).json({ ok: true });
  }

  const full_name = clean(body.full_name, 120);
  const phone = toE164(body.phone);
  const email = clean(body.email, 160).toLowerCase();
  const dealership = clean(body.dealership, 160);
  const stock_size = clean(body.stock_size, 40);
  const message = clean(body.message, 1500);
  /* NO SERVER-SIDE FALLBACK ID, AND THAT IS THE POINT. This used to mint
     'web-' + Date.now() + a weak PRNG when the browser sent none. That value is
     unique per REQUEST, so a visitor retrying after the 503 below produced a
     second lead_event for one enquiry -- the `nokey:` + timestamp shape the
     database refuses by name, wearing a different prefix so the CHECK let it
     through. The browser now mints one id per page load and re-sends it; if it
     could not (no CSPRNG at all) it sends none, and an absent id is recorded as
     absent rather than faked into something that looks idempotent and is not. */
  const submission_id = clean(body.submission_id, 80);

  /* WHICH AD PRODUCED THIS. Without it the spend cannot be judged, and the
     first thing a paid campaign needs is the ability to be switched off for
     being bad. An allowlist, not a passthrough: an open jsonb column filled
     from the query string is a place to put anything. */
  const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                            'utm_term', 'utm_id', 'fbclid', 'gclid', 'wbraid', 'gbraid',
                            'ttclid', 'referrer', 'landing_path'];
  /* wbraid and gbraid are the click ids Google Ads sets INSTEAD of gclid on
     iOS app surfaces. utm_id is what Meta's dynamic URL parameters fill with
     the ad id. This list and the KEYS array in index.html are the same list in
     two places by necessity -- the browser decides what to send, this decides
     what to keep -- so a key added to one and not the other is silently lost.
     Both were changed together. */
  const attribution = {};
  const rawAttr = (body && typeof body.attribution === 'object' && body.attribution) || {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = clean(rawAttr[k], 200);
    if (v) attribution[k] = v;
  }

  if (!full_name) return res.status(400).json({ error: 'name_required' });
  if (!phone && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'contact_required' });
  }

  /* The mail body used to be composed here and handed to Resend. It is now
     composed inside the n8n workflow instead, from the allowlisted fields
     posted below. That is not tidying: a body built here and sent onward is a
     body the sender chooses, and the point of the guard is that they do not. */

  let notified = false, notifyError = null;
  if (NOTIFY_WEBHOOK_SECRET) {
    try {
      /* Only the seven fields the workflow allowlists. `summary` is
         deliberately NOT sent: the mail body is composed inside n8n from these
         fields, so a caller holding the header still cannot make the message
         arbitrary text. Sending a ready-made body would hand that away. */
      const r = await fetch(NOTIFY_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          [NOTIFY_HEADER]: NOTIFY_WEBHOOK_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          full_name,
          phone: phone || '',
          email,
          dealership,
          stock_size,
          message,
          submission_id,
        }),
      });
      notified = r.ok;
      if (!r.ok) notifyError = 'notify_' + r.status;
    } catch (e) {
      notifyError = 'notify_unreachable';
    }
  } else {
    notifyError = 'notify_secret_not_configured';
  }

  /* THE DURABLE WRITE. It happens whether or not anyone can be notified,
     because those are different failures: "nobody was told" is recoverable
     tomorrow morning, "we never had it" is not. Until 16 Sep 2026 this
     endpoint had only the notification, so a missing environment variable and
     a lost customer were the same event. */
  let stored = null, storeError = null;
  if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/submit_sales_lead', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
          /* The function lives in `nexus_intake`, not `public` -- anon has no
             USAGE on public and that is deliberate (NX975). PostgREST routes an
             RPC by this header, so without it the call resolves in `public` and
             answers 401 "permission denied for schema public". */
          'Content-Profile': 'nexus_intake',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_submission_id: submission_id || null,
          p_full_name: full_name,
          p_phone_e164: phone,
          p_email: email || null,
          p_dealership: dealership || null,
          p_stock_size: stock_size || null,
          p_message: message || null,
          p_attribution: attribution,
          p_ip_country: req.headers['x-vercel-ip-country'] || null,
        }),
      });
      if (r.ok) {
        const rows = await r.json().catch(() => null);
        const row = Array.isArray(rows) ? rows[0] : rows;
        stored = row && row.was_duplicate ? 'duplicate' : 'stored';
      } else {
        storeError = 'store_' + r.status;
      }
    } catch (e) {
      storeError = 'store_unreachable';
    }
  } else {
    storeError = 'store_not_configured';
  }

  /* Optional third write, into the ingestion contract, under a SIMULATION
     endpoint. A failure here never fails the request: this is instrumentation,
     and losing a real enquiry to prove a test path would be the wrong trade. */
  let recorded = null;
  if (SUPABASE_URL && SUPABASE_KEY && INGEST_KEY) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/nexus_record_lead_event', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_public_key: INGEST_KEY,
          p_external_event_id: submission_id,
          p_origin_verified: 'simulated',
          p_payload_raw: {
            source: 'nexus-marketing-site',
            stock_size: stock_size || null,
            dealership: dealership || null,
            ip_country: req.headers['x-vercel-ip-country'] || null,
          },
          p_occurred_at: new Date().toISOString(),
          p_normalized: Object.assign(
            { full_name },
            phone ? { phone_e164: phone } : {},
            email ? { email } : {},
            message ? { message } : {}
          ),
        }),
      });
      recorded = r.ok ? 'recorded' : 'refused_' + r.status;
    } catch (e) {
      recorded = 'unreachable';
    }
  }

  const durable = stored === 'stored' || stored === 'duplicate' || recorded === 'recorded';

  /* THE STATUS CODE NOW FOLLOWS DURABILITY, NOT NOTIFICATION, AND THAT IS A
     DELIBERATE REVERSAL.

     The previous rule was: if nobody was notified, answer 503 so the browser
     shows the WhatsApp fallback, because a stored enquiry nobody is told about
     still means no human calls this person back. That reasoning was sound when
     nothing was stored -- and for five months nothing was, so the two were the
     same thing and the 503 was simply "we lost it".

     They are not the same thing. Once the enquiry is in nexus_sales_lead it
     cannot be lost, only delayed, and answering 503 to a visitor whose details
     we are holding tells them a lie in the direction that costs the most: they
     retry, give up, or go to a competitor, and the row sits there unread. So a
     durable enquiry answers 200 and says plainly in `notified` whether a human
     has been paged yet. An enquiry nothing kept still answers 503, still shows
     the WhatsApp fallback, and now names which of the two paths failed. */
  if (!durable) {
    console.error('lead not stored', { storeError, notifyError, recorded, submission_id });
    return res.status(503).json({
      error: 'not_delivered',
      detail: storeError || notifyError,
      notify_detail: notifyError,
      /* Named so a later reader cannot mistake it for "we have your details and
         someone will call": stored is not contacted. */
      stored_for_replay: false,
    });
  }

  if (!notified) {
    /* Kept, not lost. Loud in the log so the queue is read in the morning. */
    console.error('lead stored but nobody notified', { notifyError, stored, submission_id });
  }

  return res.status(200).json({ ok: true, stored, notified, recorded });
}
