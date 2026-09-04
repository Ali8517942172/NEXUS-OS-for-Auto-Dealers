-- COMMUNICATION EVENT TAXONOMY, part 2: the views own the answer.
-- =========================================================================
-- BUSINESS RULE (stated in full on nexus_is_message): communication_logs is an
-- event log. Only rows nexus_is_message() accepts are messages; the rest are
-- the dealership's own internal markers, written ABOUT a conversation rather
-- than inside it, and they may never be counted as messages, as replies, or as
-- a customer's last contact.
--
-- What changes here:
--
-- v_customer_360   message_count / last_contact_at were computed with
--                  `message !~~ '[SILENCE-%'`, which is only one of the three
--                  marks an internal row can carry. A channel='system' row
--                  without that prefix, or a '[system]…' body, was counted as a
--                  message and could date a last contact. They now use
--                  nexus_is_message(). Live figures are UNCHANGED by this
--                  (7/28 messages, same two timestamps) because today's only
--                  internal rows carry all three marks -- this closes the hole,
--                  it does not restate today's numbers.
--
-- v_conversations  counted EVERY row: message_count, inbound_count,
--                  outbound_count, last_message_at, last_message,
--                  last_direction and awaiting_reply were all computed over
--                  markers as well as messages, so Ali's thread reported 17
--                  messages and 9 sent when 16 and 8 were, and its
--                  last_message_at was the marker (31 Aug 17:00) rather than
--                  the last thing anybody said (31 Aug 04:37). The browser was
--                  subtracting one marker back out and calling the result a
--                  floor because the view exposed no per-row channel.
--                  The existing columns are LEFT EXACTLY AS THEY WERE -- other
--                  screens sort and alert on them -- and the message-only
--                  answers are appended alongside so a consumer can ask for the
--                  one it means. `awaiting_msg_reply` deliberately reproduces
--                  awaiting_reply's shape over messages only; on both live
--                  marker threads the last MESSAGE is outbound, so both stay
--                  false and the view's false was a true false.
--
-- v_lead_messages  resolves a row to a lead and refuses ambiguous phone
--                  matches, but says nothing about whether the row is a
--                  message; it returns the silence markers alongside the
--                  messages with no way to tell them apart. An `is_message`
--                  column is appended. No row is removed -- an n8n workflow may
--                  be reading this view and a disappearing row is a worse
--                  failure than an unread column.
-- =========================================================================

create or replace view public.v_customer_360 as
 WITH ids AS (
         SELECT lower(btrim(leads.email)) AS email
           FROM leads
          WHERE ((leads.email IS NOT NULL) AND (leads.email <> ''::text))
        UNION
         SELECT lower(btrim(purchase_history.email)) AS lower
           FROM purchase_history
          WHERE ((purchase_history.email IS NOT NULL) AND (purchase_history.email <> ''::text))
        ), ident AS (
         SELECT i_1.email,
            max(NULLIF(regexp_replace(COALESCE(l_1.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text)) AS digits
           FROM (ids i_1
             LEFT JOIN leads l_1 ON ((lower(btrim(l_1.email)) = i_1.email)))
          GROUP BY i_1.email
        ), keys AS (
         SELECT d.email,
            k.key
           FROM (ident d
             CROSS JOIN LATERAL ( SELECT d.email AS key
                UNION
                 SELECT (regexp_replace(d.email, '[^0-9]'::text, ''::text, 'g'::text) || '@c.us'::text)
                  WHERE ((d.email ~~ '+%@whatsapp.lead'::text) AND (regexp_replace(d.email, '[^0-9]'::text, ''::text, 'g'::text) <> ''::text))
                UNION
                 SELECT (('+'::text || d.digits) || '@whatsapp.lead'::text)
                  WHERE (d.digits IS NOT NULL)
                UNION
                 SELECT (d.digits || '@c.us'::text)
                  WHERE (d.digits IS NOT NULL)
                UNION
                 SELECT wc.chat_id
                   FROM whatsapp_contacts wc
                  WHERE ((wc.chat_id IS NOT NULL) AND ((lower(btrim(wc.lead_email)) = d.email) OR ((d.digits IS NOT NULL) AND (regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text) = d.digits))))) k)
          WHERE ((k.key IS NOT NULL) AND (btrim(k.key) <> ''::text))
        )
 SELECT i.email,
    COALESCE(max(p.customer_name), max(l.name)) AS name,
    COALESCE(max(p.phone), max(l.phone)) AS phone,
    count(DISTINCT l.id) AS lead_count,
    max(l.ai_score) AS best_ai_score,
    max(upper(l.status)) AS latest_status,
    count(DISTINCT p.id) AS purchase_count,
    ( SELECT sum(p2.amount_aed) AS sum
           FROM purchase_history p2
          WHERE (lower(btrim(p2.email)) = i.email)) AS lifetime_value_aed,
    max(p.purchase_date) AS last_purchase_date,
    (count(DISTINCT p.id) > 0) AS is_vip,
    -- MESSAGES ONLY. Was `c.message !~~ '[SILENCE-%'`; see the header.
    ( SELECT count(*) AS count
           FROM communication_logs c
          WHERE ((c.lead_email IN ( SELECT k.key
                   FROM keys k
                  WHERE (k.email = i.email)))
             AND public.nexus_is_message(c.direction, c.channel, c.message))) AS message_count,
    -- LAST CONTACT. A silence marker is written because nobody was in touch and
    -- can never be the moment somebody was.
    ( SELECT max(c.created_at) AS max
           FROM communication_logs c
          WHERE ((c.lead_email IN ( SELECT k.key
                   FROM keys k
                  WHERE (k.email = i.email)))
             AND public.nexus_is_message(c.direction, c.channel, c.message))) AS last_contact_at,
    max(c3.total_emails) AS total_emails,
    max(c3.total_slack_messages) AS total_slack_messages
   FROM (((ids i
     LEFT JOIN leads l ON ((lower(btrim(l.email)) = i.email)))
     LEFT JOIN purchase_history p ON ((lower(btrim(p.email)) = i.email)))
     LEFT JOIN customer_360_profiles c3 ON ((lower(btrim(c3.email)) = i.email)))
  GROUP BY i.email;


create or replace view public.v_conversations as
 WITH resolved AS (
         SELECT cl.id,
            cl.lead_email,
            cl.channel,
            cl.direction,
            cl.message,
            cl.created_at,
            public.nexus_is_message(cl.direction, cl.channel, cl.message) AS is_msg,
            COALESCE(lower(l_direct.email), lower(wc_direct.lead_email), lower(cl.lead_email)) AS person_key,
                CASE
                    WHEN ((cl.lead_email ~~ '%@lid'::text) OR (cl.lead_email ~~ '%@c.us'::text)) THEN cl.lead_email
                    ELSE wc_by_lead.chat_id
                END AS reply_chat_id
           FROM (((communication_logs cl
             LEFT JOIN leads l_direct ON ((lower(l_direct.email) = lower(cl.lead_email))))
             LEFT JOIN whatsapp_contacts wc_direct ON ((wc_direct.chat_id = cl.lead_email)))
             LEFT JOIN whatsapp_contacts wc_by_lead ON ((lower(wc_by_lead.lead_email) = lower(cl.lead_email))))
          WHERE ((cl.lead_email IS NOT NULL) AND (cl.lead_email <> ''::text))
        ), threads AS (
         SELECT resolved.person_key,
            (array_agg(resolved.reply_chat_id ORDER BY (resolved.reply_chat_id IS NULL), resolved.created_at DESC))[1] AS chat_id,
            count(*) AS message_count,
            count(*) FILTER (WHERE (resolved.direction = 'inbound'::text)) AS inbound_count,
            count(*) FILTER (WHERE (resolved.direction = 'outbound'::text)) AS outbound_count,
            max(resolved.created_at) AS last_message_at,
            (array_agg(resolved.message ORDER BY resolved.created_at DESC))[1] AS last_message,
            (array_agg(resolved.direction ORDER BY resolved.created_at DESC))[1] AS last_direction,
            -- Appended: the same questions asked of messages only.
            count(*) FILTER (WHERE resolved.is_msg) AS msg_count,
            count(*) FILTER (WHERE NOT resolved.is_msg) AS internal_count,
            count(*) FILTER (WHERE resolved.is_msg AND (resolved.direction = 'inbound'::text)) AS msg_inbound_count,
            count(*) FILTER (WHERE resolved.is_msg AND (resolved.direction = 'outbound'::text)) AS msg_outbound_count,
            max(resolved.created_at) FILTER (WHERE resolved.is_msg) AS last_msg_at,
            (array_agg(resolved.message ORDER BY resolved.created_at DESC) FILTER (WHERE resolved.is_msg))[1] AS last_msg,
            (array_agg(resolved.direction ORDER BY resolved.created_at DESC) FILTER (WHERE resolved.is_msg))[1] AS last_msg_direction
           FROM resolved
          GROUP BY resolved.person_key
        )
 SELECT t.person_key AS thread_key,
    t.chat_id,
    COALESCE(wc.phone, wc2.phone) AS phone,
    COALESCE(wc.push_name, wc2.push_name) AS push_name,
    COALESCE(l.email, wc.lead_email, wc2.lead_email) AS lead_email,
    l.name AS lead_name,
    l.status AS lead_status,
    COALESCE(l.name, NULLIF(wc.push_name, ''::text), NULLIF(wc2.push_name, ''::text), NULLIF(wc.phone, ''::text), NULLIF(wc2.phone, ''::text), t.person_key) AS display_name,
        CASE
            WHEN (l.name IS NOT NULL) THEN 'lead'::text
            WHEN (COALESCE(wc.push_name, wc2.push_name) IS NOT NULL) THEN 'whatsapp_profile'::text
            WHEN (COALESCE(wc.phone, wc2.phone) IS NOT NULL) THEN 'phone_only'::text
            ELSE 'unidentified'::text
        END AS identified,
    t.message_count,
    t.inbound_count,
    t.outbound_count,
    t.last_message_at,
    t.last_message,
    t.last_direction,
    (t.last_direction = 'inbound'::text) AS awaiting_reply,
    t.msg_count,
    t.internal_count,
    t.msg_inbound_count,
    t.msg_outbound_count,
    t.last_msg_at,
    t.last_msg,
    t.last_msg_direction,
    (t.last_msg_direction = 'inbound'::text) AS awaiting_msg_reply
   FROM (((threads t
     LEFT JOIN leads l ON ((lower(l.email) = t.person_key)))
     LEFT JOIN whatsapp_contacts wc ON ((wc.chat_id = t.chat_id)))
     LEFT JOIN whatsapp_contacts wc2 ON ((lower(wc2.lead_email) = t.person_key)));


create or replace view public.v_lead_messages as
 WITH person AS (
         SELECT leads.id,
            COALESCE(NULLIF(lower(btrim(COALESCE(leads.email, ''::text))), ''::text), ('lead:'::text || (leads.id)::text)) AS person_key,
            NULLIF("right"(regexp_replace(COALESCE(leads.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9), ''::text) AS tail9,
            length(regexp_replace(COALESCE(leads.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) AS plen
           FROM leads
        ), unique_tail AS (
         SELECT person.tail9
           FROM person
          WHERE ((person.tail9 IS NOT NULL) AND (person.plen >= 9))
          GROUP BY person.tail9
         HAVING (count(DISTINCT person.person_key) = 1)
        )
 SELECT l.id AS lead_id,
    c.id,
    c.created_at,
    c.channel,
    c.direction,
    c.message,
    c.lead_email,
    -- Appended: this view returns every event resolved to the lead, markers
    -- included. FALSE here means the row is the dealership's own internal note
    -- and is not part of the conversation.
    public.nexus_is_message(c.direction, c.channel, c.message) AS is_message
   FROM (communication_logs c
     JOIN leads l ON ((((COALESCE(btrim(l.email), ''::text) <> ''::text) AND (lower(btrim(c.lead_email)) = lower(btrim(l.email)))) OR ((c.lead_email !~~ '%@lid'::text) AND (length(regexp_replace(split_part(c.lead_email, '@'::text, 1), '[^0-9]'::text, ''::text, 'g'::text)) >= 9) AND ("right"(regexp_replace(split_part(c.lead_email, '@'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), 9) = "right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9)) AND (length(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9) AND ("right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) IN ( SELECT unique_tail.tail9
           FROM unique_tail))) OR ((c.lead_email ~~ '%@lid'::text) AND (EXISTS ( SELECT 1
           FROM whatsapp_contacts wc
          WHERE ((wc.chat_id = c.lead_email) AND (((COALESCE(btrim(l.email), ''::text) <> ''::text) AND (lower(btrim(wc.lead_email)) = lower(btrim(l.email)))) OR ((length(regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9) AND ("right"(regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) = "right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9)) AND (length(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9) AND ("right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) IN ( SELECT unique_tail.tail9
                   FROM unique_tail)))))))))));
