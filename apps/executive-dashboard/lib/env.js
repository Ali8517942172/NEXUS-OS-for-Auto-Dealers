/* NEXUS OS — lib/env.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { $ } from './dom.js';

/* ── Environment ─────────────────────────────────────────────────────────── */
const envStr = v => (typeof v === 'string' ? v.trim() : v);

/* A whole .env file once got pasted into a single Vercel variable. The value
   carried interior newlines, which .trim() cannot fix, and Chrome rejected the
   fetch with an opaque "Invalid value". Measure the value; do not guess. */
function envProblem(name, value, { minLen = 0, prefix = '' } = {}) {
  if (!value) return `${name} is empty.`;
  if (/[\x00-\x1F\x7F]/.test(value))
    return `${name} contains a newline or tab (length ${value.length}). It probably holds a whole .env file rather than one value.`;
  if (minLen && value.length < minLen)
    return `${name} is only ${value.length} characters; expected at least ${minLen}.`;
  if (prefix && !value.startsWith(prefix))
    return `${name} should start with "${prefix}".`;
  return null;
}

/* Trailing slashes come off both base URLs, and for the same reason: every
   caller appends a path that already starts with one. `https://xxx.supabase.co/`
   pasted out of the Supabase dashboard — which is exactly how it is displayed
   there — made every request `…supabase.co//rest/v1/leads`, and PostgREST
   answers that with a 404. All fourteen screens then reported a data error,
   the connection pill went red, and nothing anywhere said the URL was the
   problem, because as far as envProblem() was concerned it was a perfectly
   well-formed https:// value. N8N_BASE has been stripped since the split; this
   one was simply missed. */
const trimUrl = v => (envStr(v) || '').replace(/\/+$/, '');

const SUPABASE_URL  = trimUrl(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_ANON = envStr(import.meta.env.VITE_SUPABASE_ANON_KEY);
const N8N_BASE      = trimUrl(import.meta.env.VITE_N8N_BASE_URL);

const envErrors = [
  envProblem('VITE_SUPABASE_URL', SUPABASE_URL, { prefix: 'https://' }),
  envProblem('VITE_SUPABASE_ANON_KEY', SUPABASE_ANON, { minLen: 40 }),
].filter(Boolean);

/* ── Small helpers ───────────────────────────────────────────────────────── */

export { envStr, envProblem, trimUrl, SUPABASE_URL, SUPABASE_ANON, N8N_BASE, envErrors };
