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
  /* where the enquiries came from. `phase` and `source` are deliberately NOT
     in this table: they are ordinary English words as well as column names, and
     an entry for either would have `plain()` rewriting the word "source" in
     any sentence that passed through it. The mapping is for identifiers a
     reader could only have got from our schema. */
  v_lead_origin: 'where your enquiries came from',
  lead_source_catalogue: 'the lead sources set up for this dealership',
  source_key: 'the source\u2019s own name for itself',
  channel_family: 'the kind of road the enquiry travelled',
  /* `integration_status` is the PROVIDER's half — whether a contract exists
     that could be implemented. `connection_state` is this dealership's half
     — whether anything is actually registered. They were confused for one
     fact until 7 Sep 2026; the two nouns are deliberately not alike. */
  integration_status: 'whether the provider publishes anything NEXUS could connect to',
  provider_route: 'whether the provider publishes anything NEXUS could connect to',
  connection_state: 'whether NEXUS is actually receiving from that source at this dealership',
  lead_ingest_endpoint: 'the connections registered for this dealership',
  active_endpoints: 'how many live connections are registered for that source',
  disposition_reason: 'the reason recorded for what happened to it',
  origin_strength: 'how much of the sender\u2019s claim about itself could be verified',
  origin_explanation: 'why the origin is attested as well or as poorly as it is',
  origin_cryptographically_verified: 'whether a signature over what was sent could be checked',
  is_test_traffic: 'whether this is simulator output rather than business',
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

/* ── 3b. Where a lead came from, and how well that origin is attested ───────
   Added 6 September 2026 for screens/lead-sources.js, and held HERE rather
   than in that screen for the reason this file exists: these are the words a
   dealership reads for facts NEXUS measures about its own lead flow, and the
   moment a second screen shows a source — Leads, Campaigns and Attribution
   each plausibly could — a second copy of these sentences is a second thing to
   keep true. The screen imports the words; it does not type them.

   THREE OF THE FOUR VOCABULARIES BELOW ARE CLOSED SETS THE DATABASE OWNS, and
   the lookups return NULL for a value outside them ON PURPOSE. `term()` above
   may fall back to a vague noun, because a noun nobody recognises is harmless.
   A STATE nobody recognises is not: it decides whether an arrival is a loss, a
   duplicate or a lead that made it through. A screen handed null here has to
   say it does not know, which is the only honest branch. */

/* What happened to an arrival after it landed. `kind` is what the screen
   counts on: ARRIVED and WORKED are arrivals still in play, DUPLICATE is one
   we already had, and LOST is a lead this dealership HAD and no longer has —
   which is never, on any screen, to be rendered as "nothing arrived". */
export const LEAD_PHASE = Object.freeze({
  RECEIVED:    { label: 'Arrived', tone: 'open', kind: 'ARRIVED',
    blurb: 'The enquiry reached NEXUS and was recorded. Nothing has been added to it yet.' },
  HYDRATED:    { label: 'Filled out', tone: 'open', kind: 'WORKED',
    blurb: 'The enquiry arrived and NEXUS was able to attach the customer detail that came with it.' },
  PROMOTED:    { label: 'Became an enquiry', tone: 'ok', kind: 'WORKED',
    blurb: 'The arrival became a lead record the floor can work. This is the outcome the other six are measured against.' },
  DUPLICATE:   { label: 'Already had it', tone: 'cold', kind: 'DUPLICATE',
    blurb: 'The same enquiry had already been recorded, so this arrival was not counted a second time. It is not a lost lead and it is not a new one.' },
  REJECTED:    { label: 'Refused at the door', tone: 'hot', kind: 'LOST',
    blurb: 'NEXUS refused this arrival rather than passing it to the floor. The reason recorded against it is the whole of the explanation, and it is shown.' },
  QUARANTINED: { label: 'Held back', tone: 'warm', kind: 'LOST',
    blurb: 'The arrival was held rather than passed on, so nobody at this dealership has seen it. It is recoverable — but only if somebody looks.' },
  EXPIRED:     { label: 'Ran out of time', tone: 'hot', kind: 'LOST',
    blurb: 'A real enquiry arrived and the time to do anything with it ran out. This is a customer this dealership had. It is a loss, not an absence.' },
});
export const leadPhase = v => LEAD_PHASE[String(v || '').trim().toUpperCase()] || null;
export const isLostPhase = v => (leadPhase(v) || {}).kind === 'LOST';

/* ── Whether NEXUS is actually receiving from a source ─────────────────────
   Rewritten 7 September 2026, because the vocabulary this replaces was the
   defect.

   WHAT WENT WRONG. `lead_source_catalogue.integration_status` was rendered as
   the answer to "is this dealership wired up?", with AVAILABLE labelled
   "Connected" in green. AVAILABLE does not mean that and never did: it is a
   fact about the PROVIDER — this marketplace publishes a contract somebody
   could implement. Eight of the nine seeded sources carry it, and on 7 Sep 2026
   not one of them was connected to anything: there is no receiver of any kind
   in this product and the endpoint register holds no rows on either database.
   A paying dealership was therefore shown eight green "Connected" pills and the
   sentence "anything counted under it below arrived that way", under a table
   whose whole purpose is to say which sources produced nothing. It answered a
   commercial question with an operational pill, and the two words happened to
   be the same word.

   HOW IT IS ANSWERED NOW. `nexus_lead_source_readiness()` computes
   `connection_state` in the database, per dealership, from the endpoints
   actually registered to it. The screen renders that value and infers nothing:
   there is no rule anywhere in the app that turns any other column into the
   word "connected", and the only vocabulary that carries a positive tone is
   CONNECTED below. That is deliberate — a second path to a green pill is how
   this comes back.

   `silence` is the sentence the "produced nothing" table prints under a source
   with no arrivals. It is per-state because the meaning of silence is entirely
   decided by this column: silence from a connected source is a quiet week, and
   silence from an unconnected one is not a measurement at all. */
export const CONNECTION_STATE = Object.freeze({
  CONNECTED: { label: 'Connected', tone: 'ok', receiving: true, roadmap: false,
    blurb: 'A live connection is registered to this dealership for this source, so an enquiry from it reaches NEXUS '
         + 'directly and anything counted under it arrived that way.',
    silence: 'This source is connected and produced nothing within the window read here. A source whose last enquiry '
           + 'falls outside that window looks identical to one that has never produced — this line cannot tell those '
           + 'apart and does not claim to.' },
  SIMULATION_ONLY: { label: 'Simulator attached — nothing real arrives', tone: 'warm', receiving: false, roadmap: true,
    blurb: 'The only thing attached to this source is a simulator. Nothing a real customer sends reaches NEXUS '
         + 'through it, and everything it does produce is test traffic that is counted nowhere as business. This is '
         + 'not a connection.',
    silence: 'Nothing from a real customer has arrived through this source and nothing could: only a simulator is '
           + 'attached to it. Its silence measures nothing about how many people enquired.' },
  /* Added 7 September 2026, and it exists because this screen's only green pill
     was being shown for the two sources a UAE showroom actually lives on while
     there was nowhere to enter one. Measured that day across the dashboard
     source AND the shipped bundle: the only write touching `leads` anywhere is
     a PATCH of the owner on a row that already exists. A walk-in endpoint was
     registered, active and production — and a salesperson had no form.

     A webhook source's deliverer is a provider, so the registered endpoint IS
     the path. A manual source's deliverer is a person, and the path is a
     screen. `lead_source_catalogue.manual_entry_surface` names that screen, and
     this state is what a registered endpoint with none behind it is.

     Tone is `warm`, not `unknown`. NOT_CONNECTED is neutral because nobody has
     done anything wrong by not connecting a source yet. This one is different:
     the dealership DID the setup, and what is missing is ours to build. */
  REGISTERED_NO_ENTRY_PATH: { label: 'Set up — but there is nowhere to enter one', tone: 'warm', receiving: false, roadmap: true,
    blurb: 'This source is registered to this dealership and ready to receive, and NEXUS has no screen for entering '
         + 'one by hand. A walk-in or a phone call arrives as a person, not as a message from another system, so '
         + 'somebody has to type it in — and until that screen exists nothing reaches NEXUS through this source. '
         + 'The setup is done; the missing half is ours.',
    silence: 'Nothing has arrived through this source and nothing could: it is registered, but there is no screen for '
           + 'entering one. Its silence measures how many walk-ins or calls NEXUS can currently record, which is none '
           + '— not how many the dealership had.' },
  NOT_CONNECTED: { label: 'Not connected', tone: 'unknown', receiving: false, roadmap: false,
    blurb: 'Nothing is registered for this source at this dealership, so NEXUS is not receiving from it. That is a '
         + 'connection nobody has made yet — it is not a fault, and nothing has gone wrong.',
    silence: 'NEXUS is not receiving from this source yet, so silence from it means nothing has been connected rather '
           + 'than that nobody enquired. Anyone who did enquire through it reached the dealership some other way and '
           + 'is not counted here.' },
  NOT_CONNECTABLE: { label: 'Roadmap — there is no feed to connect to', tone: 'unknown', receiving: false, roadmap: true,
    blurb: 'No lead feed exists for NEXUS to connect to, and no amount of engineering here produces one.',
    silence: 'Nothing has arrived because nothing can arrive. This is a connection that does not exist, not a source '
           + 'that had a quiet week, and it is counted nowhere above as a producing source.' },
});
export const connectionState = v => CONNECTION_STATE[String(v || '').trim().toUpperCase()] || null;

/* ── Where a lead actually came from ───────────────────────────────────────
   Added 7 September 2026, and it exists because the Leads screen was rendering
   `leads.source` under the heading "Source". For every real lead this
   dealership has, that column reads `nexus-master-router` — the NAME OF THE
   WORKFLOW THAT WROTE THE ROW. It has never held an origin. A salesperson
   reading that column has been reading the writer and calling it the source.

   The honest answer lives in nexus_lead_attribution(), which reads what the
   provider actually told us at the moment of arrival. Two vocabularies come
   back from it and NEITHER is re-derived here — the database owns both words
   and this file only puts them into English.

   ATTRIBUTION_CONFIDENCE answers "how do we know which platform?".
   ATTRIBUTION_COMPLETENESS answers "how much of the campaign spine survived?".

   The rule that matters more than either: UNKNOWN IS RENDERED AS UNKNOWN. There
   is no branch anywhere below that turns an absent platform into a likely one,
   and `nexus-master-router` is never mapped to Facebook, WhatsApp or anything
   else. A lead whose origin nobody recorded is a lead whose origin nobody
   recorded, and that is a fact a dealership can act on — it tells them their
   ad spend is unattributable, which is worth knowing and worth fixing. */
export const ATTRIBUTION_CONFIDENCE = Object.freeze({
  PROVIDER_REPORTED: { label: 'The platform told us', tone: 'ok',
    blurb: 'The advertising platform named itself in the delivery. This is the strongest form this system has: '
         + 'it is the provider\u2019s own statement, recorded at the moment the enquiry arrived.' },
  ENDPOINT_REGISTERED: { label: 'Known from where it arrived', tone: 'ok',
    blurb: 'The platform was not named in the delivery, and it did not need to be: this enquiry came in on a '
         + 'connection registered to exactly one platform, so arriving there is itself the evidence.' },
  UNKNOWN: { label: 'Not known', tone: 'unknown',
    blurb: 'Nothing in the delivery said which platform this came from, and it did not arrive on a connection '
         + 'that answers the question either. It is shown as unknown rather than guessed.' },
});
export const attributionConfidence = v =>
  ATTRIBUTION_CONFIDENCE[String(v || '').trim().toUpperCase()] || null;

export const ATTRIBUTION_COMPLETENESS = Object.freeze({
  FULL_SPINE: { label: 'Platform, campaign, ad set and ad', tone: 'ok',
    blurb: 'Every step from the platform down to the individual ad survived, so this enquiry can be priced against '
         + 'what was spent on that ad.' },
  PLATFORM_AND_CAMPAIGN: { label: 'Platform and campaign', tone: 'ok',
    blurb: 'The platform and the campaign are known; the ad set and the ad are not. Spend can be attributed to the '
         + 'campaign and no further.' },
  PLATFORM_ONLY: { label: 'Platform only', tone: 'warm',
    blurb: 'We know the platform and nothing below it. This enquiry counts towards that platform and cannot be '
         + 'attributed to any campaign, so it cannot be priced.' },
  PLATFORM_UNKNOWN: { label: 'Nothing recorded', tone: 'unknown',
    blurb: 'No part of the advertising spine arrived with this enquiry. It is counted under UNKNOWN, which is a real '
         + 'answer and not a missing one.' },
});
export const attributionCompleteness = v =>
  ATTRIBUTION_COMPLETENESS[String(v || '').trim().toUpperCase()] || null;

/* The sentence for a lead that has NO attribution row at all — which today is
   every lead this dealership actually has. It predates the lead-ingestion
   layer, so no arrival was ever recorded for it. Saying "unknown platform"
   would be wrong in a specific way: it implies we looked at an arrival and
   found no platform, when there is no arrival to look at. */
export const ORIGIN_NOT_RECORDED =
  'No arrival was ever recorded for this lead, so where it came from cannot be answered. This is not a platform '
  + 'we failed to identify — it is an enquiry that reached the dealership before NEXUS was recording origins at all.';

/* And the label for the raw column, so it can be shown WITHOUT being called a
   source. It is genuinely useful — it says which part of the system created the
   row — and it is genuinely not an origin. */
export const WRITER_COLUMN_LABEL = 'Written by';
export const WRITER_COLUMN_NOTE =
  'The part of NEXUS that created this row. It is not where the customer came from, and it was labelled "Source" '
  + 'until 7 September 2026, which is why every lead appeared to come from a workflow.';


/* The banner sentence that says what the column means, once, at the top of the
   screen. It is here rather than in the screen because it is the correction
   itself: the reader has been shown the wrong answer to this question. */
export const CONNECTION_IS_ABOUT_THIS_DEALERSHIP =
  'Whether NEXUS is receiving from a source is measured from what is actually registered to THIS dealership, not '
  + 'from what the provider publishes. A source can be perfectly connectable and connected to nothing.';

/* What could not be said when the readiness read failed. It exists as a
   constant so the branch cannot quietly become a fallback: there is no second
   column anywhere that answers this question, and substituting one would be
   answering a different question with a green tick. */
export const CONNECTION_STATE_UNREAD =
  'Whether NEXUS is receiving from each source could not be read, so nothing could be checked. No source here is '
  + 'shown as connected and none is shown as unconnected, because neither was measured — and an unread check is '
  + 'never a clear one.';
export const CONNECTION_STATE_NOT_KNOWN =
  'This source records a connection state this screen has no wording for, so nothing is claimed about whether NEXUS '
  + 'is receiving from it. It is not being shown as connected and it is not being shown as unconnected.';
export const CONNECTION_STATE_MISSING =
  'This source is not in the readiness answer at all, so whether NEXUS is receiving from it was not measured. It is '
  + 'not being shown as connected and it is not being shown as unconnected.';

/* ── The provider's half, kept apart from the dealership's ─────────────────
   `provider_route` carries the old `integration_status`. It is a fact about
   the PROVIDER — whether a contract exists that somebody could implement — and
   it is the column that was misread as a connection. It therefore renders as a
   SENTENCE and never as a pill, carries no tone of any kind, and no branch on
   this screen reads it to decide anything. Each sentence ends by pointing back
   at the state, so the two can never be read as one fact. */
export const PROVIDER_ROUTE = Object.freeze({
  AVAILABLE:
    'The provider publishes a way to hand enquiries over, so a connection to it could be built. That says nothing '
  + 'about whether one exists for this dealership, which is the state shown beside it.',
  SIMULATED_ONLY:
    'No route to this provider has been built yet; what exists is a simulator standing in for one. That is a fact '
  + 'about the product rather than about this dealership.',
  COMMERCIAL_CONVERSATION_REQUIRED:
    'The provider publishes nothing to connect to. Obtaining a feed is a commercial conversation with the '
  + 'marketplace rather than a piece of work that can be done from this side.',
  NOT_ESTABLISHED:
    'No route to this provider has been established, so there is nothing for this dealership to be wired into yet.',
});
export const providerRoute = v => PROVIDER_ROUTE[String(v || '').trim().toUpperCase()] || null;
export const PROVIDER_ROUTE_IS_NOT_A_CONNECTION =
  'What a provider publishes is not whether this dealership is connected to it. Where both are shown, the state is '
  + 'about this dealership and the sentence under it is about the provider.';
/* The prefix that keeps the two apart at the point of reading, on the row
   itself, where a reader who never saw the banner is. */
export const PROVIDER_ROUTE_LABEL = 'About the provider, not about this dealership.';

/* The sentence for a marketplace that sells enquiries but publishes nothing to
   connect to. It names the SOURCE the view named and nothing else — no
   endpoint, no key, no workflow — because none of that is the dealership's
   half, and the view does not carry it in any case. */
export const noLeadFeedSentence = source =>
  `${source || 'This source'} publishes no lead feed NEXUS can connect to, so nothing arrives from it automatically. `
  + 'Its enquiries reach the dealership the way they always have — as WhatsApp messages, phone calls and emails — and '
  + 'none of those is counted here as having come from it. Changing that is a commercial conversation with the '
  + 'marketplace, not a piece of work that can be done from this side.';

/* ── How much of "where this came from" NEXUS could actually verify ─────────
   `origin_strength` is 0–100 and it is NOT a quality score for the lead. It
   says how much of what the sender claimed about itself could be checked.

   The distance between the top two bands is the whole reason this is on a
   screen. An arrival authenticated by a secret sitting in the body of a
   request — anybody holding that secret could have composed it — and one
   carrying a signature computed over the exact bytes that were sent are not
   the same fact, and rendering them identically is how a dashboard turns a
   guess into evidence. Bands are read weakest-first by the screen, because a
   source is only as attested as its worst arrival. */
export const ORIGIN_STRENGTH_BANDS = Object.freeze([
  { min: 80, key: 'SIGNED', label: 'Signed at source', tone: 'ok',
    blurb: 'The arrival carried a signature computed over the exact bytes the sender sent. Nobody else could have composed it, and altering it in transit would have broken the signature.' },
  { min: 50, key: 'CHECKED', label: 'Checked, not signed', tone: 'warm',
    blurb: 'Something about this arrival could be checked against the sender, but not a signature over what was actually sent.' },
  { min: 1, key: 'ASSERTED', label: 'Asserted with a shared secret', tone: 'warm',
    blurb: 'The arrival carried a secret in the body of the request. Anybody holding that secret could have sent it, so the request proves that the secret is known and nothing about who used it.' },
  { min: 0, key: 'UNATTESTED', label: 'Nothing attests it', tone: 'hot',
    blurb: 'Nothing about this arrival attests where it came from beyond the name it gave itself.' },
]);
export const originBand = strength => {
  const n = strength == null || strength === '' || Number.isNaN(Number(strength)) ? null : Number(strength);
  if (n == null) return null;
  return ORIGIN_STRENGTH_BANDS.find(b => n >= b.min) || ORIGIN_STRENGTH_BANDS[ORIGIN_STRENGTH_BANDS.length - 1];
};
export const ORIGIN_STRENGTH_SCALE =
  'Origin strength runs 0–100 and is not a score for the lead. It says how much of what the sender claimed about '
  + 'itself NEXUS could verify, and it is shown wherever a source is shown so that two sources are never made to '
  + 'look equally attested when they are not.';
export const ORIGIN_STRENGTH_NOT_STATED =
  'This arrival records no origin strength, so how well it is attested is unknown — which is not the same as weak '
  + 'and not the same as strong. Nothing is claimed about it in either direction.';
export const SOURCE_IS_AS_ATTESTED_AS_ITS_WEAKEST =
  'A source is shown at its WEAKEST arrival, never at an average. Averaging attestation would invent a number no '
  + 'arrival carried and would hide the one that carried nothing.';

/* ── Test traffic ──────────────────────────────────────────────────────────
   The one rule on this subject that has no exceptions: simulator output is
   never added into a figure a dealership reads as business. It is shown —
   hiding it would be its own kind of lie — in a band of its own, labelled. */
export const TEST_TRAFFIC_EXCLUDED =
  'Arrivals marked as test traffic are excluded from every count on this screen and shown separately. They are '
  + 'simulator output, not business, and a dealership must never be shown one as the other.';
export const TEST_TRAFFIC_BAND =
  'Everything in this band is test traffic. It is here so that it is visible and accounted for, and it is counted '
  + 'nowhere else on this screen — not in the arrivals, not in the sources, and not in the losses.';
export const TEST_TRAFFIC_UNCLASSIFIED =
  'Some arrivals do not say whether they are test traffic. They are counted in neither figure: calling them business '
  + 'would inflate the real number, and calling them test would hide a real enquiry.';

/* ── Two refusals this screen makes in the dealership's own interest ───────*/
export const NO_MONEY_ON_LEAD_SOURCES =
  'No figure on this screen is money. What a lost enquiry would have been worth is recorded nowhere in this '
  + 'database, so putting a currency value on one would be inventing it.';
export const LOSS_IS_NOT_ABSENCE =
  'An arrival that was refused, held back or left to expire is an enquiry this dealership HAD. It is reported as a '
  + 'loss with the reason recorded against it, and never as "no enquiries arrived".';
export const NO_REASON_RECORDED =
  'No reason was recorded against this one, which is itself a gap — nobody can act on a refusal nobody explained.';

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
