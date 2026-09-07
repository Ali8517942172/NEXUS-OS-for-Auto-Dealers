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

const NOTIFY_TO = process.env.NEXUS_NOTIFY_EMAIL || 'aliasgher892@gmail.com';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.NEXUS_NOTIFY_FROM || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const INGEST_KEY = process.env.NEXUS_LEAD_ENDPOINT_KEY || '';

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
  const submission_id = clean(body.submission_id, 80)
    || 'web-' + Date.now() + '-' + Math.random().toString(16).slice(2);

  if (!full_name) return res.status(400).json({ error: 'name_required' });
  if (!phone && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'contact_required' });
  }

  const summary =
    'New NEXUS enquiry\n\n' +
    'Name:       ' + full_name + '\n' +
    'Dealership: ' + (dealership || '(not given)') + '\n' +
    'WhatsApp:   ' + (phone || '(unparseable: ' + clean(body.phone, 60) + ')') + '\n' +
    'Email:      ' + (email || '(not given)') + '\n' +
    'Stock:      ' + (stock_size || '(not given)') + '\n\n' +
    (message || '(no message)') + '\n\n' +
    '--\nsubmission ' + submission_id + ' · ' + new Date().toISOString() + ' · ' + ip;

  let notified = false, notifyError = null;
  if (RESEND_KEY && RESEND_FROM) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + RESEND_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [NOTIFY_TO],
          reply_to: email || undefined,
          subject: 'NEXUS enquiry — ' + full_name + (dealership ? ' · ' + dealership : ''),
          text: summary,
        }),
      });
      notified = r.ok;
      if (!r.ok) notifyError = 'resend_' + r.status;
    } catch (e) {
      notifyError = 'resend_unreachable';
    }
  } else {
    notifyError = 'resend_not_configured';
  }

  /* Optional second write, into the ingestion contract, under a SIMULATION
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

  if (!notified) {
    /* Nothing durable happened. Say so with a 5XX, so the browser shows the
       WhatsApp fallback rather than telling someone we have their details. */
    console.error('lead notify failed', { notifyError, recorded, submission_id });
    return res.status(503).json({ error: 'not_delivered', detail: notifyError });
  }

  return res.status(200).json({ ok: true, recorded });
}
