-- chanroute_01_send_form_and_provider_capability
--
-- Provider capability as DATA, not as code. Requirement: the absence of a row
-- must resolve to "this provider cannot carry this", never to "try it and see".
-- That is why the reader (chanroute_03) treats NOT FOUND as NOT_SUPPORTED and
-- says so, rather than defaulting to permissive.

create table if not exists public.channel_send_form (
  code                  text primary key,
  label                 text not null,
  description           text not null,
  requires_template_ref boolean not null,
  is_media              boolean not null,
  is_business_safe_outside_window boolean not null,
  sort                  integer not null default 100,
  created_at            timestamptz not null default now(),
  constraint channel_send_form_code_shape
    check (code = upper(code) and code ~ '^[A-Z][A-Z_]{2,39}$')
);

comment on table public.channel_send_form is
  'The shapes an outbound message can take on a messaging channel. This is the vocabulary the send interface accepts; it is deliberately finer than channel_message_events.message_kind, because "a text" and "a template whose body is text" are the same kind and completely different sends. is_business_safe_outside_window is descriptive only - the policy engine, not this column, decides what may leave.';

insert into public.channel_send_form (code,label,description,requires_template_ref,is_media,is_business_safe_outside_window,sort) values
  ('FREEFORM_TEXT','Free-form text','A plain text body composed at send time.',false,false,false,10),
  ('FREEFORM_IMAGE','Free-form image','An image, optionally with a caption, composed at send time.',false,true,false,20),
  ('FREEFORM_DOCUMENT','Free-form document','A document (PDF, spreadsheet) composed at send time.',false,true,false,30),
  ('FREEFORM_AUDIO','Free-form audio','An audio file or voice note composed at send time.',false,true,false,40),
  ('FREEFORM_VIDEO','Free-form video','A video composed at send time.',false,true,false,50),
  ('TEMPLATE_TEXT','Approved template','A message template pre-approved by the platform, with variable substitution.',true,false,true,60),
  ('TEMPLATE_MEDIA_HEADER','Approved template with media header','A pre-approved template whose header carries an image, video or document.',true,true,true,70),
  ('INTERACTIVE_BUTTONS','Interactive reply buttons','A message offering the customer tappable reply buttons.',false,false,false,80),
  ('INTERACTIVE_LIST','Interactive list','A message offering the customer a list to pick from.',false,false,false,90)
on conflict (code) do nothing;

create table if not exists public.channel_provider_capability (
  provider      text not null,
  send_form     text not null references public.channel_send_form(code) on delete restrict,
  support_state text not null,
  basis         text not null,
  evidence      text not null,
  verified_at   timestamptz,
  set_by        text not null,
  created_at    timestamptz not null default now(),
  primary key (provider, send_form),
  constraint channel_provider_capability_provider_check
    check (provider = any (array['waha','whatsapp_cloud'])),
  constraint channel_provider_capability_support_state_check
    check (support_state = any (array['SUPPORTED','NOT_SUPPORTED'])),
  constraint channel_provider_capability_basis_check
    check (basis = any (array['MEASURED_HERE','VENDOR_DOCUMENTED','STRUCTURAL'])),
  constraint channel_provider_capability_measured_is_dated
    check (basis <> 'MEASURED_HERE' or verified_at is not null)
);

comment on table public.channel_provider_capability is
  'Which provider can carry which send form. Read by nexus_route_message via nexus_channel_capability_state, which resolves a MISSING row to NOT_SUPPORTED with reason CAPABILITY_NOT_ON_FILE. basis records how strongly the claim is held: MEASURED_HERE means NEXUS has actually done it on this deployment; VENDOR_DOCUMENTED means the vendor says so and we have not; STRUCTURAL means the capability cannot exist for that provider by construction. THE SET IS DELIBERATELY ORDERED SO THAT whatsapp_cloud IS A SUPERSET OF waha. If anyone ever adds a send form that waha supports and whatsapp_cloud does not, the capability filter in nexus_route_message becomes able to move a send from the official platform down to the unofficial one, which is the exact bypass the golden rule in that function forbids. Do not add such a row without re-reading that comment.';

comment on column public.channel_provider_capability.support_state is
  'SUPPORTED or NOT_SUPPORTED. There is no third value and no NULL: a capability nobody has stated is not on file, and not-on-file is handled by the reader as NOT_SUPPORTED rather than being recorded here as an unknown that a later reader could mistake for permission.';

insert into public.channel_provider_capability (provider,send_form,support_state,basis,evidence,verified_at,set_by) values
  ('whatsapp_cloud','FREEFORM_TEXT','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API /messages accepts type=text inside the customer service window. Not yet exercised on this deployment - no whatsapp_cloud integration is registered.',null,'chanroute_01'),
  ('whatsapp_cloud','FREEFORM_IMAGE','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API /messages type=image with a media id or link. Not yet exercised here.',null,'chanroute_01'),
  ('whatsapp_cloud','FREEFORM_DOCUMENT','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API /messages type=document. Not yet exercised here.',null,'chanroute_01'),
  ('whatsapp_cloud','FREEFORM_AUDIO','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API /messages type=audio. Not yet exercised here.',null,'chanroute_01'),
  ('whatsapp_cloud','FREEFORM_VIDEO','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API /messages type=video. Not yet exercised here.',null,'chanroute_01'),
  ('whatsapp_cloud','TEMPLATE_TEXT','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API /messages type=template against a template approved on the WABA. This is the only sanctioned way to open a conversation outside the service window. Not yet exercised here.',null,'chanroute_01'),
  ('whatsapp_cloud','TEMPLATE_MEDIA_HEADER','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API template with a header component of type image/video/document. Not yet exercised here.',null,'chanroute_01'),
  ('whatsapp_cloud','INTERACTIVE_BUTTONS','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API /messages type=interactive, interactive.type=button. Not yet exercised here.',null,'chanroute_01'),
  ('whatsapp_cloud','INTERACTIVE_LIST','SUPPORTED','VENDOR_DOCUMENTED','Meta Cloud API /messages type=interactive, interactive.type=list. Not yet exercised here.',null,'chanroute_01'),

  ('waha','FREEFORM_TEXT','SUPPORTED','MEASURED_HERE','Proven live 2 Sep 2026: a real inbound WhatsApp message on the alba-cars WAHA session "default" was answered with an inventory-grounded free-form reply in 17.8 seconds, with a SUCCESS audit row. This is the one send this deployment has actually performed.','2026-09-02T00:00:00Z','chanroute_01'),
  ('waha','FREEFORM_IMAGE','SUPPORTED','VENDOR_DOCUMENTED','WAHA sendImage / sendFile against a session. Documented by WAHA; not exercised on this deployment.',null,'chanroute_01'),
  ('waha','FREEFORM_DOCUMENT','SUPPORTED','VENDOR_DOCUMENTED','WAHA sendFile against a session. Documented by WAHA; not exercised on this deployment.',null,'chanroute_01'),
  ('waha','FREEFORM_AUDIO','SUPPORTED','VENDOR_DOCUMENTED','WAHA sendVoice / sendFile against a session. Documented by WAHA; not exercised on this deployment.',null,'chanroute_01'),
  ('waha','FREEFORM_VIDEO','SUPPORTED','VENDOR_DOCUMENTED','WAHA sendVideo against a session. Documented by WAHA; not exercised on this deployment.',null,'chanroute_01'),

  ('waha','TEMPLATE_TEXT','NOT_SUPPORTED','STRUCTURAL','A WhatsApp message template is a WABA object: it is submitted to Meta, reviewed, approved, and then referenced by name and language on a Cloud API send. WAHA drives a WhatsApp client on the dealership own handset identity; there is no WABA behind it and therefore no approved template for it to reference. A "template" sent through WAHA would be an ordinary free-form message with the template text pasted into it - which is precisely a business-initiated message outside the service window, sent without the platform charge and without the platform review. That is a policy bypass, not a workaround, and it is the fastest way to get the dealership own number banned.',null,'chanroute_01'),
  ('waha','TEMPLATE_MEDIA_HEADER','NOT_SUPPORTED','STRUCTURAL','Same reason as TEMPLATE_TEXT: there is no approved template object behind a WAHA session, so there is no header component to populate.',null,'chanroute_01'),
  ('waha','INTERACTIVE_BUTTONS','NOT_SUPPORTED','VENDOR_DOCUMENTED','Interactive reply buttons are a Business API construct. WAHA exposure of them against a personal client is unreliable and has been withdrawn and reinstated across releases; NEXUS will not route a customer-facing message onto a surface whose behaviour changes between provider builds. This deployment has already been shown to be running two different WAHA builds (2026.7.1 and 2026.7.2) against the same account.',null,'chanroute_01'),
  ('waha','INTERACTIVE_LIST','NOT_SUPPORTED','VENDOR_DOCUMENTED','As INTERACTIVE_BUTTONS.',null,'chanroute_01')
on conflict (provider, send_form) do nothing;

alter table public.channel_send_form            enable row level security;
alter table public.channel_provider_capability  enable row level security;

drop policy if exists channel_send_form_service_role on public.channel_send_form;
create policy channel_send_form_service_role on public.channel_send_form
  for all to service_role using (true) with check (true);

drop policy if exists channel_provider_capability_service_role on public.channel_provider_capability;
create policy channel_provider_capability_service_role on public.channel_provider_capability
  for all to service_role using (true) with check (true);

-- CLAUDE.md, "the default-grant check": Supabase default privileges grant
-- arwdDxtm DIRECTLY to anon and authenticated on every new table. D is
-- TRUNCATE and RLS does not filter it. Revoke from both roles AND from public,
-- because a direct grant and a PUBLIC grant are separate ACL rows.
revoke all on public.channel_send_form           from anon, authenticated, public;
revoke all on public.channel_provider_capability from anon, authenticated, public;
grant  select, insert, update, delete on public.channel_send_form           to service_role;
grant  select, insert, update, delete on public.channel_provider_capability to service_role;