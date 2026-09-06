-- INV-002 · A message belongs to the customer who sent it, and an uncertain
-- match is refused rather than guessed.
--
-- v_lead_messages already refuses: its unique_tail CTE admits a 9-digit phone
-- tail only when exactly one person holds it. nexus_lead_for_comm_key(text) --
-- the function the first-response trigger (INV-003) resolves through -- had no
-- such guard: on a collision it took `order by created_at limit 1` and silently
-- attributed one customer's message to whichever of them was created first. So
-- the same message could be refused by the view and attributed by the trigger.
--
-- Business rule: when a 9-digit phone tail belongs to more than one person, it
-- identifies nobody. Return NULL. NULL means "not resolved", which the trigger
-- already handles by declining to measure -- an unmeasured response time is
-- honest; a response time stamped on the wrong customer is not.
--
-- "One person" is counted exactly as v_lead_messages counts it: distinct
-- lower(btrim(email)), falling back to 'lead:'||id for a lead with no email --
-- so two lead rows for one customer are one person and still resolve.
--
-- Both tail-matching branches are guarded: (b) the direct key tail and (c) the
-- tail bridged through whatsapp_contacts. Branch (a) (exact email) and the
-- whatsapp_contacts email bridge are unchanged -- an email IS the person key,
-- so those cannot be ambiguous between people.
--
-- Zero tails collide in today's data, so this is latent, not live: no live
-- resolution changes. It is being closed so the two paths agree by construction.

create or replace function public.nexus_lead_for_comm_key(p_key text)
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_raw    text := nullif(btrim(p_key), '');
  v_digits text;
  v_tail   text;
  v_id     integer;
  v_email  text;
  v_wcdig  text;
  v_people integer;
begin
  if v_raw is null then return null; end if;

  -- (a) Exact match on the email column. Covers a real address and the
  --     synthetic whatsapp.lead one when the router stored it AS the email.
  select id into v_id from public.leads
   where email = v_raw and coalesce(email, '') <> ''
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  -- (b) Any key CARRYING a phone number resolves by its last 9 digits, against
  --     both the phone column and digits embedded in the email. '<digits>@c.us'
  --     and '+<digits>@whatsapp.lead' both qualify. '<lid>@lid' does NOT -- a
  --     LID is an opaque WhatsApp id whose digits would collide with a real
  --     number -- so it is excluded here and bridged in (c).
  --     AMBIGUITY GUARD (INV-002): if the tail reaches more than one person the
  --     key identifies nobody, and this returns NULL rather than the oldest.
  if v_raw not like '%@lid' then
    v_digits := regexp_replace(split_part(v_raw, '@', 1), '[^0-9]', '', 'g');
    v_tail   := case when length(v_digits) >= 9 then right(v_digits, 9) end;
    if v_tail is not null then
      select count(distinct coalesce(nullif(lower(btrim(coalesce(l.email, ''))), ''),
                                     'lead:' || l.id::text))
        into v_people
        from public.leads l
       where right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
          or right(regexp_replace(split_part(coalesce(l.email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail;

      if coalesce(v_people, 0) > 1 then
        return null;   -- ambiguous tail: refuse, do not guess
      end if;

      if v_people = 1 then
        select id into v_id from public.leads
         where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
            or right(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail
         order by created_at limit 1;
        if v_id is not null then return v_id; end if;
      end if;
    end if;
  end if;

  -- (c) '<lid>@lid' resolves only through whatsapp_contacts.
  if to_regclass('public.whatsapp_contacts') is not null then
    select lead_email into v_email from public.whatsapp_contacts
     where chat_id = v_raw and nullif(btrim(lead_email), '') is not null limit 1;
    if v_email is not null then
      select id into v_id from public.leads where email = v_email order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;

    select regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
      into v_wcdig from public.whatsapp_contacts where chat_id = v_raw limit 1;
    if v_wcdig is not null and length(v_wcdig) >= 9 then
      v_tail := right(v_wcdig, 9);

      -- Same guard on the bridged tail.
      select count(distinct coalesce(nullif(lower(btrim(coalesce(l.email, ''))), ''),
                                     'lead:' || l.id::text))
        into v_people
        from public.leads l
       where right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
          or right(regexp_replace(split_part(coalesce(l.email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail;

      if coalesce(v_people, 0) > 1 then
        return null;   -- ambiguous tail: refuse, do not guess
      end if;

      if v_people = 1 then
        select id into v_id from public.leads
         where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
            or right(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail
         order by created_at limit 1;
        if v_id is not null then return v_id; end if;
      end if;
    end if;
  end if;

  return null;
end;
$function$;