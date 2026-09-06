/* NEXUS OS — lib/vocabulary.js
   Written 5 September 2026.

   ── The one decision this file exists to hold ───────────────────────────────
   A dealership buys NEXUS. It does not buy our schema and it does not buy our
   suppliers. Two classes of name therefore must not reach a screen:

     1. SUPPLIER NAMES — whichever WhatsApp transport, CRM, host, model
        gateway or mail relay NEXUS happens to use this quarter. These are the
        vendor's implementation and they change. WAHA in particular is
        explicitly temporary: the WhatsApp Business Cloud API replaces it per
        dealership (CLAUDE.md, "the WhatsApp messaging layer"), so any screen
        that names the transport is wrong the day that happens, and wrong in
        the worst way — confidently, in prose, about a fact nobody will think
        to re-check. The dealership's half is the CHANNEL ("WhatsApp"), the
        STATE ("no address to send to") and the ACTION ("reply from WhatsApp
        itself"). None of those three needs a supplier's name to be said.

     2. SCHEMA IDENTIFIERS — `leads`, `inventory`, `v_revenue_recovery`,
        `channel_message_events` and the rest. They are our nouns. A rep
        reading "permission denied for table leads" learns nothing they can
        act on while learning the shape of the database — lib/errors.js
        already states that rule; this file is what makes it followable
        outside the error path.

   ── The rule, so the next pass does not have to re-derive it ────────────────
   Where a name genuinely helps the reader, use the ORDINARY ENGLISH WORD for
   the thing: a screen that is about their leads says "leads", because that is
   a dealership's word too and it happens to also be our table name. Where the
   identifier is a table name inside an error, a tooltip or a diagnostic, it
   should not be there at all — the reader cannot act on it, and it is the one
   part of the sentence that will be wrong after the next migration.

   So this module is NOT a censor over a fixed vocabulary. It is the mapping,
   held once, from what we call a thing to what THEY call it. Screens import
   `TERM`/`term()` instead of typing a noun, and free text that we did not
   write — a run summary out of the activity log, a workflow's own error —
   goes through `dealerText()` on its way to the DOM.

   ── What this file deliberately does not do ─────────────────────────────────
   It does not touch the values classifiers read. Redacting the evidence a
   verdict is computed from would change the verdict. Only the RENDERED string
   goes through here; every predicate keeps reading the raw column. That rule
   was already written three times over in screens/automation.js,
   screens/compliance.js and screens/campaigns.js, which each carried their own
   byte-similar copy of the redactor. Those three copies are now this one — a
   fourth divergent copy is how a leak comes back.

   It also does not rewrite source COMMENTS. A comment naming WAHA, a join or a
   column is the engineering record this repo is built on and it renders to
   nobody. */

/* ── 1. Suppliers ───────────────────────────────────────────────────────────
   Everything NEXUS buys, rents or self-hosts in order to do its job. Not one
   of these is a fact about the dealership's business. Ordered longest-first
   inside the regex so "Make.com" is not left as ".com" by a shorter match. */
export const SUPPLIER_NAMES = Object.freeze([
  'WAHA', 'Bitrix24', 'Bitrix', 'OpenRouter', 'PostgREST', 'Supabase',
  'Make.com', 'Zapier', 'Vercel', 'Postgres', 'PostgreSQL', 'Twilio',
  'Resend', 'Apify', 'Odoo', 'Groq', 'n8n',
  /* Mail and model suppliers. NEXUS chooses these and the dealership does not
     see them; a broken one is "email delivery" or "AI answers" to them. */
  'Gmail', 'SendGrid', 'Postmark', 'Mailgun', 'OpenAI', 'Anthropic',
]);

/* ── Two deliberate ABSENCES from that list ────────────────────────────────
   `Slack` and `Meta` are not suppliers from the dealership's side. The team
   reads the Slack channel NEXUS posts hot leads into, and the WhatsApp
   Business account whose rules the policy engine applies is Meta's and is
   theirs. Naming either is telling them about their own thing, which is the
   opposite of the harm this file exists to prevent — so they stay sayable. */
const SUPPLIER_RE = new RegExp(
  '\\b(?:' + [...SUPPLIER_NAMES].sort((a, b) => b.length - a.length)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi');

/* ── 2. Channels ────────────────────────────────────────────────────────────
   What the dealership calls the road a message travelled. This is the honest
   replacement for a transport name: the customer's WhatsApp is WhatsApp
   whether it reached us through WAHA or through Meta's own Cloud API, and the
   dealership's decision never turns on which. */
export const CHANNEL = Object.freeze({
  whatsapp: 'WhatsApp', whatsapp_waha: 'WhatsApp', whatsapp_cloud: 'WhatsApp',
  email: 'email', sms: 'SMS', slack: 'the team channel', phone: 'phone',
});
export const channelName = v => CHANNEL[String(v || '').toLowerCase()] || 'this channel';

/* The one sentence that replaces a transport name wherever a screen has to
   explain that a message cannot leave. It says the state and the action and
   names nobody. */
export const NO_ADDRESS_TO_SEND_TO =
  'there is no WhatsApp address on file for this thread, so nothing can be sent to it from here';

/* ── 3. Schema identifiers → the dealership's noun ──────────────────────────
   Keys are the real relation and column names, so a reader can grep from a
   migration to this table and back. Values are what the reader of the screen
   would call the same thing. A term is a NOUN PHRASE, lower case, so it drops
   into a sentence; the screen decides the article and the capitalisation.

   Where the ordinary English word IS our identifier — leads, inventory,
   campaigns — the term is that word, unchanged. That is the point of the rule
   above, not an exception to it. */
export const TERM = Object.freeze({
  /* people and the pipeline */
  leads: 'leads',
  v_needs_attention: 'the attention list',
  v_customer_directory: 'the customer list',
  v_customer_360: 'the customer record',
  customer_360_profiles: 'the customer profiles',
  customers: 'customers',
  tenant_members: 'the account memberships',
  users: 'the accounts NEXUS holds for this dealership',
  v_team_performance: 'the team figures',
  /* stock and money */
  inventory: 'stock',
  inventory_actions: 'the recommended actions',
  v_inventory_action_queue: 'the recommended actions',
  v_inventory_profit_sentinel: 'the margin review',
  purchase_history: 'the recorded sales',
  v_revenue_recovery: 'the recovered-revenue figures',
  v_attribution_link_map: 'the links between actions and sales',
  finance_quotes: 'the finance quotes',
  deals_embeddings: 'the deal history',
  /* conversations */
  v_conversations: 'NEXUS',
  communication_logs: 'the message history',
  channel_message_events: 'the delivery record',
  channel_registry: 'the messaging setup',
  whatsapp_contacts: 'the saved contact details',
  processed_messages: 'the processed-message record',
  campaigns: 'campaigns',
  campaign_enrollments: 'the campaign enrolments',
  /* documents and compliance */
  kyc_documents: 'the ID documents',
  rag_documents: 'your documents',
  policy_rule: 'the messaging rules',
  /* the machinery — no dealership-facing noun on purpose */
  audit_log: 'the activity log',
  workflow_registry: 'the automation register',
  v_workflow_health: 'the automation health figures',
  v_competitor_latest: 'the competitor listings',
  competitors: 'the competitor listings',
  nexus_outcome_class: 'NEXUS\u2019s own rule for what a run achieved',
  nexus_is_message: 'NEXUS\u2019s own test for what counts as a message',
  /* columns and keys that reach prose */
  chat_id: 'WhatsApp address',
  thread_key: 'the thread\u2019s identifier',
  lead_email: 'the email on the lead record',
  msg_count: 'the message-only count',
  message_count: 'the count of every row filed under a contact',
  outbound_count: 'the count of messages sent out',
  awaiting_reply: 'whether the newest message is theirs',
  last_msg_at: 'the newest-message time',
  lead_status: 'the lead status',
  unanswered_chat: 'the unanswered-chat alert',
  writes_audit_log: 'whether it records its runs',
  success_rate_30d: 'the success rate it publishes',
  'leads.phone': 'the phone number on the lead record',
  'leads.status': 'the lead\u2019s status',
  'leads.email': 'the email on the lead record',
  'leads.name': 'the name on the lead record',
});

/* `v_conversations` maps to a SUBJECT rather than a noun, and deliberately.
   Nine screens said things like "v_conversations resolved no lead for this
   thread" — the view was the actor in the sentence, and the dealership's word
   for that actor is NEXUS. A noun ("the conversation record resolved no lead")
   would have been grammatical and wrong: it puts the agency in a record. */

/* Look a term up. An unknown identifier returns a deliberately vague noun
   rather than the identifier: a wrong-but-harmless word beats a correct
   internal one, and the vagueness is what sends the next reader here to add
   the mapping instead of typing a literal into a screen. */
export const term = id => TERM[String(id || '')] || 'the record behind this';

/* Every identifier this module knows, longest first so `v_customer_directory`
   is not matched as `customers` first. Word-boundary anchored, and the dotted
   `leads.phone` forms are matched before the bare `leads`. */
const IDENT_RE = new RegExp(
  '(?<![\\w.])(?:' + Object.keys(TERM).sort((a, b) => b.length - a.length)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\w])', 'g');

/* ── 4. dealerText — the net over free text we did not write ────────────────
   Two jobs, in this order:

     a. Strip where-inside-the-system detail: the execution's URL, the failing
        node's name, the execution id, a bare host or dotted quad. A run
        summary out of the activity log carries all four, and the dealership
        can act on none of them. Measured 5 Sep 2026: a failed KYC run rendered
        the VM's own public IP on the Compliance screen.
     b. Strip supplier names, which the previous copies did not. The workflow
        error a campaign shows names the mail relay's credential verbatim; the
        dealership learns which supplier we buy delivery from and still cannot
        fix it. "The connection" is the whole of their half.

   What the run was DOING survives both. That is their news. */
export const dealerText = text => String(text || '')
  /* where it stopped */
  .replace(/https?:\/\/[^\s·"'<>]+/g, '')
  .replace(/\bexecution\s*(?:id\s*)?[#:]?\s*\d+/gi, '')
  .replace(/\bfailed at node\s*:\s*[^·|\n]+/gi, 'failed inside the automation')
  .replace(/\bnode\s*:\s*[^·|\n]+/gi, '')
  .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?:\.nip\.io)?\b/g, '')
  /* who we buy from. The credential clause goes FIRST and whole: a workflow
     writes `Resend credential "NEXUS Resend" is not connected`, and replacing
     the supplier token alone leaves `the supplier credential "NEXUS the
     supplier"`, which is worse than either the original or nothing. Then bare
     hostnames — `api.resend.com` carries the supplier name without an https://
     prefix for the URL rule to catch — and then the status code that hangs off
     them, so `401 from api.resend.com` does not leave a dangling "401 from". */
  .replace(/\b[A-Za-z0-9_.-]*\s*credentials?\s*["“][^"”]*["”]/g, 'connection')
  .replace(new RegExp('\\b(?:' + SUPPLIER_NAMES.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    + ')(?:\\s+[A-Za-z0-9_-]+)?\\s+credentials?\\b', 'gi'), 'connection')
  .replace(/\b(?:[a-z0-9-]+\.)+(?:com|io|net|org|co|ai|dev|app|cloud)\b/gi, '')
  .replace(/(?:^|[\s:])\/[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+/gi, ' ')
  .replace(/\b[45]\d{2}(\s+from)?\s*/g, '')
  /* The clause above can leave "connection is not connected", which is the
     kind of sentence that makes a reader distrust the whole panel. */
  .replace(/\bconnection is not connected\b/gi, 'connection is not working')
  .replace(SUPPLIER_RE, 'the supplier')
  .replace(/\bthe supplier(?:\s+the supplier)+\b/gi, 'the supplier')
  .replace(/\s+/g, ' ')
  .replace(/[ \t]*·[ \t]*(?=·|$)/g, '')
  .replace(/(^[\s·|]+)|([\s·|]+$)/g, '')
  /* Stripping a clause can leave the punctuation that introduced it. */
  .replace(/[\s:;,·|—-]+$/, '');

/* `plain` additionally maps any schema identifier that survived into the
   dealership's noun. Use it on free text that may quote a column or a
   constraint — a PostgREST message, a CHECK violation — where dealerText
   alone would leave `communication_logs` sitting in the sentence. */
export const plain = text => dealerText(text).replace(IDENT_RE, m => TERM[m]);

/* ── 4b. How the existing screens were brought onto this vocabulary ─────────
   5 Sep 2026. Roughly 250 rendered occurrences of these identifiers existed
   across 20 screens, woven into prose whose whole style is naming its own
   source. They were migrated by a one-off source transform driven by the table
   above (a scratchpad script, not shipped) which rewrote PROSE STRING LITERALS
   only — never comments, never code, never a PostgREST path — followed by a
   hand pass over the grammar it could not get right on its own and over the
   sentences where the identifier was load-bearing rather than incidental.

   Two things about that are worth knowing before the next pass:

     · SOURCE COMMENTS WERE LEFT ALONE, ON PURPOSE. A comment naming a view, a
       join, a column or a supplier is the engineering record this repo runs
       on, it renders to nobody, and stripping it would cost more than it
       saves. Judge a leak by what reaches the DOM.
     · The screens now carry the dealership's words directly, so this table is
       the REGISTER of that decision plus the runtime helpers — not a filter
       every string passes through at render time. If you add a screen, take
       the noun from here rather than typing the identifier; `auditRendered`
       below will tell you in development if you forget.

   ── One known false positive, accepted ─────────────────────────────────────
   `Resend` is both a mail supplier and an ordinary English verb. `dealerText`
   will turn "Resend the invitation" in a workflow's error text into "the
   supplier the invitation", which is clumsy. It is the right way round: the
   clumsy sentence is survivable, and naming the supplier we buy delivery from
   to a dealership who cannot act on it is not. Screen literals that legitimately
   say "Resend invite" do not pass through this function and are unaffected. */

/* ── 5. The dev-time guard ──────────────────────────────────────────────────
   Not a runtime cost in production: Vite folds `import.meta.env.DEV` to false
   and drops the block. In development it makes a leak audible at the moment it
   is rendered rather than at the next audit. It deliberately does NOT throw —
   a vocabulary slip must never be the reason a dealership's screen goes
   blank. */
export const auditRendered = (where, text) => {
  if (!import.meta.env.DEV) return text;
  const s = String(text || '');
  const bad = [...new Set([...(s.match(SUPPLIER_RE) || []), ...(s.match(IDENT_RE) || [])])];
  if (bad.length) console.warn(`[vocabulary] ${where} renders vendor vocabulary: ${bad.join(', ')}`);
  return text;
};
