-- Turns a raw Meta WhatsApp Cloud API webhook body into canonical NEXUS events.
--
-- The tenant is resolved from Meta's own field --
-- entry[].changes[].value.metadata.phone_number_id -- through
-- nexus_resolve_channel_tenant('whatsapp_cloud_phone_number_id', …). A caller
-- never names the dealership; there is no session string to spoof and no
-- fallback clause.
--
-- One HTTP request may carry MANY events: entry[], changes[] and messages[] are
-- all arrays and Meta batches. This function fans them out, one row per message.
-- Statuses are deliberately NOT returned here -- they belong to
-- whatsapp_delivery_events, owned elsewhere.
create or replace function public.nexus_whatsapp_cloud_canonical_events(p_payload jsonb)
returns table (
  resolution             text,
  provider               text,
  channel_type           text,
  phone_number_id        text,
  business_display_phone text,
  provider_account_id    text,
  tenant_id              uuid,
  tenant_slug            text,
  integration_id         uuid,
  direction              text,
  external_message_id    text,
  customer_external_id   text,
  customer_phone         text,
  customer_display_name  text,
  conversation_id        text,
  message_kind           text,
  text_body              text,
  media                  jsonb,
  received_at            timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
with guard as (
  -- Same guard, same wording, as nexus_resolve_channel_tenant: a signed-in end
  -- user is never handed a tenant by a backend resolver. EXECUTE is revoked
  -- from anon and authenticated in chanadapt_05; this is defence in depth.
  select coalesce(current_setting('role', true), '') not in ('authenticated', 'anon') as ok
),
ent as (
  select e.value->>'id' as waba_id, e.value as entry
    from jsonb_array_elements(
           case when jsonb_typeof(p_payload->'entry') = 'array'
                then p_payload->'entry' else '[]'::jsonb end) e(value)
),
chg as (
  select ent.waba_id, c.value->'value' as val
    from ent,
         jsonb_array_elements(
           case when jsonb_typeof(ent.entry->'changes') = 'array'
                then ent.entry->'changes' else '[]'::jsonb end) c(value)
   where c.value->>'field' = 'messages'
),
val as (
  select chg.waba_id,
         chg.val,
         lower(btrim(coalesce(chg.val->'metadata'->>'phone_number_id', ''))) as pnid,
         chg.val->'metadata'->>'display_phone_number' as disp
    from chg
),
msg as (
  select val.*, m.value as m
    from val,
         jsonb_array_elements(
           case when jsonb_typeof(val.val->'messages') = 'array'
                then val.val->'messages' else '[]'::jsonb end) m(value)
),
res as (
  select msg.*,
         r.tenant_id     as r_tenant_id,
         r.tenant_slug   as r_tenant_slug,
         r.integration_id as r_integration_id,
         -- the media sub-object, whichever kind it is
         (case msg.m->>'type'
            when 'image'    then msg.m->'image'
            when 'audio'    then msg.m->'audio'
            when 'video'    then msg.m->'video'
            when 'document' then msg.m->'document'
            when 'sticker'  then msg.m->'sticker'
            else null end) as mo
    from msg
    left join lateral public.nexus_resolve_channel_tenant(
                        'whatsapp_cloud_phone_number_id', msg.pnid) r on true
)
select
  case when res.pnid = ''            then 'unresolved_missing_phone_number_id'
       when res.r_tenant_id is null  then 'unresolved_phone_number_id'
       else 'resolved' end                                             as resolution,
  'whatsapp_cloud'::text                                               as provider,
  'whatsapp_cloud_phone_number_id'::text                               as channel_type,
  nullif(res.pnid, '')                                                 as phone_number_id,
  res.disp                                                             as business_display_phone,
  res.waba_id                                                          as provider_account_id,
  res.r_tenant_id                                                      as tenant_id,
  res.r_tenant_slug                                                    as tenant_slug,
  res.r_integration_id                                                 as integration_id,
  'inbound'::text                                                      as direction,
  res.m->>'id'                                                         as external_message_id,
  res.m->>'from'                                                       as customer_external_id,
  -- Only a real phone number lands in customer_phone. Meta can address a user
  -- by a business-scoped user id instead, and that is not a phone number.
  case when res.m->>'from' ~ '^[0-9]{6,20}$' then res.m->>'from' end   as customer_phone,
  (select c.value->'profile'->>'name'
     from jsonb_array_elements(
            case when jsonb_typeof(res.val->'contacts') = 'array'
                 then res.val->'contacts' else '[]'::jsonb end) c(value)
    where c.value->>'wa_id' = res.m->>'from'
    limit 1)                                                           as customer_display_name,
  null::text                                                           as conversation_id,
  case when coalesce(res.m->>'type','') = '' then 'unsupported'
       when res.m->>'type' = any (array['text','image','audio','video','document',
                                        'sticker','location','contacts','interactive',
                                        'button','order','reaction','system'])
            then res.m->>'type'
       else 'unsupported' end                                          as message_kind,
  case when res.m->>'type' = 'text'        then res.m->'text'->>'body'
       when res.mo is not null             then res.mo->>'caption'
       when res.m->>'type' = 'button'      then res.m->'button'->>'text'
       when res.m->>'type' = 'interactive' then coalesce(
              res.m->'interactive'->'button_reply'->>'title',
              res.m->'interactive'->'list_reply'->>'title')
       else null end                                                   as text_body,
  case when res.mo is null then null
       else jsonb_build_object(
              'kind',          'media_id',
              'ref',           res.mo->>'id',
              'mime_type',     res.mo->>'mime_type',
              'sha256',        res.mo->>'sha256',
              'caption',       res.mo->>'caption',
              'filename',      res.mo->>'filename',
              'requires_auth', true)
  end                                                                  as media,
  case when (res.m->>'timestamp') ~ '^[0-9]+$'
       then to_timestamp((res.m->>'timestamp')::numeric) end           as received_at
from res
where (select ok from guard);
$function$;

comment on function public.nexus_whatsapp_cloud_canonical_events(jsonb) is
  'Meta Cloud API webhook body -> canonical NEXUS inbound events, one row per entry[].changes[].value.messages[]. Tenant comes from value.metadata.phone_number_id via nexus_resolve_channel_tenant, never from a caller-chosen field. resolution=''resolved'' means a tenant was found; the two unresolved values name why not, and carry a NULL tenant_id so nothing downstream can write. Statuses are not returned here.';