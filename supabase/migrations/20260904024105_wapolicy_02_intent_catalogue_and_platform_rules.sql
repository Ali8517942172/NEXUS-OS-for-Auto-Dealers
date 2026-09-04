create table if not exists public.whatsapp_message_intent (
  code                        text primary key,
  label                       text not null,
  description                 text not null,
  is_business_initiated       boolean not null,
  template_category_if_required text,
  created_at                  timestamptz not null default now(),
  constraint wa_intent_code_shape check (code = upper(code) and code ~ '^[A-Z][A-Z_]{2,39}$'),
  constraint wa_intent_template_category_check
    check (template_category_if_required is null
           or template_category_if_required in ('MARKETING','UTILITY','AUTHENTICATION'))
);

comment on table public.whatsapp_message_intent is
$c$Vocabulary only. What a caller says it is trying to send. This table
deliberately carries NO permission flags: whether an intent may be free-form,
must be a template, or must not be sent is decided by policy_rule rows through
whatsapp_policy_decision(), because those are Meta's rules and they change
outside this codebase. The one thing recorded here is whether the intent is
business-initiated, which is a property of the intent itself.$c$;

insert into public.whatsapp_message_intent (code, label, description, is_business_initiated, template_category_if_required)
select v.* from (values
  ('SERVICE_REPLY','Service reply',
   'A reply to something the customer just asked. Only meaningful while the customer service window is open; outside it, it is a business-initiated message however it is labelled.',
   false, 'UTILITY'),
  ('FOLLOW_UP','Follow-up',
   'The dealership re-opening a conversation that has gone quiet - silence detection, a promised call-back, a next-step nudge. Business-initiated.',
   true, 'UTILITY'),
  ('UTILITY','Utility',
   'A transactional message about something the customer already has with the dealership: an appointment, an order, a document, a payment.',
   true, 'UTILITY'),
  ('MARKETING','Marketing',
   'A promotional message: an offer, a new arrival, a price drop, a campaign. Business-initiated and, per the platform rules, gated on evidenced opt-in.',
   true, 'MARKETING')
) as v(code,label,description,is_business_initiated,template_category_if_required)
where not exists (select 1 from public.whatsapp_message_intent m where m.code = v.code);

alter table public.whatsapp_message_intent enable row level security;
drop policy if exists whatsapp_message_intent_service_role_all on public.whatsapp_message_intent;
create policy whatsapp_message_intent_service_role_all
  on public.whatsapp_message_intent for all to service_role using (true) with check (true);
drop policy if exists whatsapp_message_intent_deny_anon on public.whatsapp_message_intent;
create policy whatsapp_message_intent_deny_anon
  on public.whatsapp_message_intent as restrictive for all to anon using (false) with check (false);

insert into public.policy_rule
  (tenant_id, jurisdiction, rule_type, rule_name, value_numeric, value_text, unit, value_kind,
   source_name, source_url, effective_from, verification_status, status, confidence, added_by, notes)
select null, v.jurisdiction, 'MESSAGING', v.rule_name, v.value_numeric, v.value_text, v.unit, v.value_kind,
       v.source_name, v.source_url, date '2026-09-04', 'NOT_VERIFIED', 'ACTIVE', 'UNKNOWN',
       'NEXUS OS migration wapolicy_02 (WhatsApp Message Policy Engine)', v.notes
from (values
  ('PLATFORM_WHATSAPP','WA_CUSTOMER_SERVICE_WINDOW_HOURS', 24::numeric, null::text, 'HOURS','NUMERIC',
   'WhatsApp Business Platform - Cloud API public documentation, "Send Messages" / customer service window',
   'https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages',
   'An inbound customer message opens a window during which the business may send free-form messages. READ FROM PUBLIC DOCUMENTATION, NOT FROM A META CONTRACT. effective_from is the date NEXUS observed the rule, not a date Meta published - the rule long predates it. Verifying this rule means someone with the account checking it against Meta''s current terms and restating effective_from.'),

  ('PLATFORM_WHATSAPP','WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE', null, 'true', 'BOOLEAN','BOOLEAN',
   'WhatsApp Business Platform - Cloud API public documentation, message templates',
   'https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates',
   'Outside the customer service window a business-initiated message must use a template pre-approved by Meta. A free-form attempt is rejected by the API rather than delivered.'),

  ('PLATFORM_WHATSAPP','WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN', null, 'true', 'BOOLEAN','BOOLEAN',
   'WhatsApp Business Messaging Policy and Cloud API opt-in guidance (public)',
   'https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in',
   'Marketing messages additionally require the customer to have opted in. NEXUS treats an opt-in it cannot evidence as no opt-in at all.'),

  ('PLATFORM_WHATSAPP','WA_WINDOW_RESETS_ONLY_ON_CUSTOMER_MESSAGE', null, 'true', 'BOOLEAN','BOOLEAN',
   'WhatsApp Business Platform - Cloud API public documentation, customer service window',
   'https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages',
   'The window is extended only by a new inbound customer message. A business message never extends it. This is why whatsapp_conversation_state has no column an outbound event could write.'),

  ('PLATFORM_WHATSAPP','WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE', 131047::numeric, null, 'COUNT','NUMERIC',
   'WhatsApp Business Platform - Cloud API public error reference',
   'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes',
   'The error the Cloud API returns when a free-form message is attempted outside the window. Recorded so the engine can name the failure a workflow would otherwise have to discover by sending.'),

  ('NEXUS_HOUSE','WA_MARKETING_REQUIRES_OPT_IN_EVEN_INSIDE_WINDOW', null, 'true', 'BOOLEAN','BOOLEAN',
   'NEXUS OS house rule - NOT a Meta requirement and NOT a regulator',
   null,
   'STRICTER THAN THE PLATFORM. Meta gates marketing TEMPLATES on opt-in; inside an open window free-form content is not category-policed by the API. NEXUS still refuses to send marketing to a customer whose opt-in it cannot evidence. This is a deliberate house choice recorded as its own row so it is visible and can be switched off by withdrawing this rule, rather than hidden inside the decision code and mistaken for Meta''s rule.')
) as v(jurisdiction,rule_name,value_numeric,value_text,unit,value_kind,source_name,source_url,notes)
where not exists (
  select 1 from public.policy_rule r
   where r.jurisdiction = v.jurisdiction and r.rule_type = 'MESSAGING' and r.rule_name = v.rule_name
     and r.tenant_id is null);