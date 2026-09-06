-- tenantcfg_02_defaults_and_capability_vocabulary
-- Shipped vocabulary only. Nothing here says anything about any dealership.

insert into public.tenant_configuration_default
  (setting_key, applies_to, value_kind, default_state, default_value, who_decides, provenance_required, rationale, engine_rule_when_absent)
values
  ('brand_name', 'tenant_configuration', 'TEXT', 'NO_DEFAULT', null, 'DEALERSHIP', false,
   'A trading name cannot be guessed, but it is also never truly unknown: public.tenants.name is on file for every dealership before anything else exists. So the honest fallback is inheritance, not invention, and the resolver reports it as INHERITED_FROM_TENANT rather than as the dealership having chosen it.',
   'Use public.tenants.name verbatim and label the state INHERITED_FROM_TENANT. Never construct a name from a slug, never abbreviate, never append a tagline.'),

  ('default_language', 'tenant_configuration', 'TEXT', 'NO_DEFAULT', null, 'DEALERSHIP', false,
   'There is no honest product default for language. Defaulting to English is a guess about a customer, made once in a migration, that lands in a message a real person reads. In a market where a large share of enquiries arrive in Arabic, the cost of that guess is the enquiry.',
   'Reply in the language of the inbound message. Do not translate, do not assume English, and do not offer a language switch the dealership has not staffed. If no inbound text exists (a form submission with no free text), send nothing in this channel and route to a human.'),

  ('timezone', 'tenant_configuration', 'TEXT', 'PRODUCT_DEFAULT', '"Asia/Dubai"'::jsonb, 'DEALERSHIP', false,
   'Asia/Dubai is what the product ALREADY does: every n8n workflow carries timezone Asia/Dubai and apps/executive-dashboard/lib/format.js pins TZ to it with the comment that a manager in London saw 16:20 printed as 12:20. Recording it as a PRODUCT_DEFAULT does not make it more true - it makes the existing assumption visible and overridable instead of invisible and hard-coded.',
   'Render and schedule in Asia/Dubai and label every bare time with its zone. This is the product assumption, not this dealership statement: any screen that would otherwise imply the dealership chose this clock must say so.'),

  ('currency', 'tenant_configuration', 'TEXT', 'PRODUCT_DEFAULT', '"AED"'::jsonb, 'DEALERSHIP', false,
   'AED is a PRODUCT_DEFAULT and very nearly a hard limit. Every monetary column in this schema is NAMED for the currency - amount_aed, price_aed, cost_aed, holding_cost_per_day_aed, recovered_value_aed - so a dealership on another currency is a schema change and an FX policy, not a settings change.',
   'Format money as AED. Changing this column today changes a LABEL and not a stored number, so a non-AED value here would MISLABEL every figure in the product. Treat a non-AED request as a blocked integration and say so.'),

  ('business_hours', 'tenant_configuration', 'JSON', 'NO_DEFAULT', null, 'DEALERSHIP', true,
   'Assuming hours is the quiet way to invent an SLA breach. The same 40-minute wait is a failure at 11:00 and is not one at 03:00; a product that assumes 09:00-18:00 will accuse a rep of missing a promise nobody made, and a product that assumes 24/7 will promise a customer a reply nobody is there to send.',
   'Report elapsed wall-clock minutes and NEVER claim the showroom was open or closed. Do not schedule an outbound message against opening hours. Any first-response judgement rendered in this state must carry the words that the clock was not adjusted for opening hours.'),

  ('ai_tone', 'tenant_configuration', 'TEXT', 'NO_DEFAULT', null, 'DEALERSHIP', true,
   'Tone reaches a customer verbatim and is the single cheapest way for software to embarrass a business. There is no neutral-by-accident default: an assistant that is chatty because nobody configured it is still chatty in this dealership name.',
   'Use the shipped neutral prompt. No persona, no nickname, no first-name familiarity, no exclamation marks, no emoji, no humour. State facts and offer a human.'),

  ('followup_policy', 'tenant_configuration', 'JSON', 'NO_DEFAULT', null, 'DEALERSHIP', true,
   'A follow-up cadence is unsolicited outbound messaging sent in the dealership name and, for WhatsApp, against their number and their template approvals. A default cadence is the product deciding to message somebody else customers.',
   'SEND NOTHING automatically. Surface the lead to a human queue instead. Absence of a policy is not a reason to fall back to a cadence; it is the reason there is no cadence.'),

  ('approval_rules', 'tenant_configuration', 'JSON', 'PRODUCT_DEFAULT', '{"default":{"requires_human":true}}'::jsonb, 'OPERATOR', true,
   'This is the only setting whose default must be the RESTRICTIVE one. Every other default here answers "what do we show"; this one answers "may software act alone in a business name". The safe answer when nobody has decided is no.',
   'Require a named human approver for every action kind. An action kind absent from the rules object falls through to "default", which the shape CHECK makes mandatory - so an action nobody anticipated is still gated rather than silently automatic.'),

  ('first_response_sla_minutes', 'lead_recovery_settings', 'INTEGER', 'PRODUCT_DEFAULT', '5'::jsonb, 'DEALERSHIP', true,
   'The figure lives in lead_recovery_settings.sla_first_response_minutes and is NOT duplicated into tenant_configuration - a fifth copy of "5 minutes" in the table built to end copies would be self-defeating. What was missing was never a column; it was a DEFAULT WITH A STATE, so that a dealership which has not set it is distinguishable from one that chose 5. That distinction is what this row provides, and the resolver reports it as CONFIGURED versus PRODUCT_DEFAULT.',
   'Judge against 5 minutes and label the judgement, on every screen and in every message that quotes it, as this product default and not this dealership policy - which is what the Lead Recovery screen already says. Do not put the number in a customer-facing promise while it is in this state.'),

  ('capabilities', 'tenant_capability', 'JSON', 'NO_DEFAULT', null, 'OPERATOR', true,
   'Capabilities are rows in public.tenant_capability, not a blob on tenant_configuration, and there is deliberately no default: a default capability set is a fabricated integration. The absence of a row IS the answer, and it is the answer that fails toward absence.',
   'Treat every capability with no AVAILABLE row as NOT_AVAILABLE. Render the catalogue absent_means sentence. Never render zero, never render an empty chart, never infer the capability from the presence of a table.')
on conflict (setting_key) do nothing;

insert into public.tenant_capability_catalogue (capability_key, label, what_it_unlocks, requires, absent_means, sort)
values
  ('SERVICE_HISTORY', 'Service and repair-order history',
   'Service Retention: due-for-service outreach, declined-work recovery, and lifetime value that includes the workshop.',
   'A feed of repair orders or service visits keyed to a customer or a vehicle, with dates and line items.',
   'The Service Retention module reports NOT AVAILABLE - no service feed is connected - and shows nothing else. It must never display a zero, an empty trend, or a "no services due" message, because absence of data is not absence of services.', 10),

  ('APPOINTMENTS', 'Appointments and showroom diary',
   'The strongest in-flight signal a dealership has, no-show recovery, and Lead Recovery APPOINTMENT_PENDING.',
   'An appointments table or calendar feed with a lead or deal reference, a scheduled time, and an outcome (kept / no-show / cancelled).',
   'Any state or action that depends on an appointment is reported UNREACHABLE with the reason, not merely empty. Nothing may say a customer did not book.', 20),

  ('DEAL_RECORD', 'In-flight deal record',
   'Deal Rescue as a population rather than a screen: a deal that exists while it is still in flight, with customer, vehicle, agreed value and owner.',
   'A deal row created at first commitment rather than at sale, written by whatever the sales floor actually uses.',
   'Deal Rescue reports that there is no deal record to rescue and names the integration. It must not present closed sales as a rescue pipeline.', 30),

  ('FINANCE_DECISION', 'Lender decision on a finance application',
   'FINANCE_BLOCKED as a real state, and finance-led recovery actions.',
   'Lender, decision, decided_at and conditions recorded against a quote.',
   'No finance state is asserted. A quote without a decision is an unanswered quote, not a declined one.', 40),

  ('MARKET_COMPARABLES', 'Priced market comparables',
   'A market position on a unit: over, under or at market, and the reprice recommendation that follows.',
   'Competitor listings matched to our unit at exact or strong quality, scraped inside the freshness window.',
   'Market position is UNKNOWN and the underlying listings are shown as evidence. Never an average, never inferred, never a position derived from weak matches.', 50),

  ('UNIT_COST', 'Acquisition cost on every unit',
   'Gross margin, net margin and every profit figure the Inventory Profit Sentinel produces.',
   'cost_aed populated on the units in scope.',
   'Margin is NOT_COMPUTABLE and the inputs are shown instead. Never a margin computed against a list price alone.', 60),

  ('HOLDING_RATE', 'A stated cost of holding a unit for a day',
   'Holding cost accrued, and any recommendation that trades days in stock against money.',
   'A rate this dealership stated, with source, owner, date and basis - the four parts inventory_profit_settings already demands.',
   'Holding cost is NOT_COMPUTABLE. This is the exact fabrication that put AED 50 a day on twelve units nobody had been asked about; the absent state must stay visible.', 70),

  ('WHATSAPP_OUTBOUND', 'Outbound WhatsApp on the dealership number',
   'Automated replies, follow-up steps and recovery actions delivered on WhatsApp.',
   'A registered, active WhatsApp channel in public.channel_registry and approved message templates.',
   'No WhatsApp is sent and no WhatsApp action is offered. An action that cannot be delivered must not be proposed.', 80),

  ('EMAIL_OUTBOUND', 'Outbound email from the dealership domain',
   'Email follow-up steps and email recovery actions.',
   'A registered, active email channel with a verified sending domain.',
   'No email is sent and no email action is offered.', 90),

  ('CRM_SYNC', 'Two-way sync with the dealership CRM or DMS',
   'Ownership, stage and outcome that stay true when the sales floor works outside NEXUS.',
   'A CRM or DMS integration with a stable customer key.',
   'NEXUS reports only what it observed itself and does not claim to reflect the CRM. A lead absent here may exist there.', 100)
on conflict (capability_key) do nothing;