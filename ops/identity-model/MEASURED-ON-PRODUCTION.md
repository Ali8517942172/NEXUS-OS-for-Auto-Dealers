# Identity on production, measured — 9 September 2026

Read-only against `dsvuoovivysszdoiorch`. Every number below is a query and its
real result. Nothing was written to production. Where something was not measured
it says **NOT MEASURED**.

Method note, because it changes the answer: the question "how many humans do the
`leads` rows represent" is the wrong question on this database, and answering only
that question would have produced a reassuring and false result. `leads` is not
the only place a human is recorded. The measurement below therefore runs twice —
once inside `leads`, once across the whole set of tables that carry a human's
contact details.

---

## 1. Row counts

```sql
select 'leads', count(*) from public.leads
union all select 'lead_event', count(*) from public.lead_event
union all select 'communication_logs', count(*) from public.communication_logs
union all select 'whatsapp_contacts', count(*) from public.whatsapp_contacts
union all select 'customer_360_profiles', count(*) from public.customer_360_profiles
union all select 'purchase_history', count(*) from public.purchase_history
union all select 'channel_message_events', count(*) from public.channel_message_events
union all select 'processed_messages', count(*) from public.processed_messages;
```

| table | rows |
|---|---|
| `leads` | **5** (1 distinct tenant) |
| `lead_event` | 1 |
| `communication_logs` | **142** |
| `whatsapp_contacts` | **14** |
| `customer_360_profiles` | 4 |
| `purchase_history` | 1 |
| `channel_message_events` | **0** |
| `processed_messages` | 36 |

---

## 2. Dedup **inside** `leads` — the collision rate is zero

All five rows, with normalisation applied:

| id | name | email | email class | phone | digits | last 9 |
|---|---|---|---|---|---|---|
| 34 | Siva Thangavelu | `+971547484167@whatsapp.lead` | synthetic | +971547484167 | 971547484167 | 547484167 |
| 35 | Effco Contracting llc | `''` | empty string | +971505433953 | 971505433953 | 505433953 |
| 38 | Ali | `shabbir53ujjainwala@gmail.com` | **real** | +918517942172 | 918517942172 | 517942172 |
| 121 | Preflight Walk-In | `walkin-preflight-01@nexus-preflight.invalid` | synthetic | +971500000001 | 971500000001 | 500000001 |
| 122 | Hussain | `+971556382721@whatsapp.lead` | synthetic | +971556382721 | 971556382721 | 556382721 |

- 5 rows, **5 distinct phone numbers**, **5 distinct last-9 tails**.
- **Collision rate by phone: 0/5 = 0%.** No two lead rows are the same human.
- **Collision rate by email: 0%**, and the measure is meaningless — see §3.

```sql
select count(*) lead_rows,
  count(*) filter (where email is not null and email <> ''
      and email !~ '@(whatsapp\.lead|c\.us|lid)$' and email !~ '\.invalid$') leads_with_usable_email,
  count(*) filter (where email = '') email_empty_string,
  count(*) filter (where email is null) email_null,
  count(*) filter (where email ~ '@whatsapp\.lead$') email_synth_whatsapp,
  count(*) filter (where email ~ '\.invalid$') email_synth_invalid,
  count(*) filter (where phone is null or regexp_replace(phone,'[^0-9]','','g')='') no_phone,
  count(*) filter (where length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) not between 9 and 15)
      phone_fails_length_check,
  count(*) filter (where phone ~ ':') phone_has_device_suffix
from public.leads;
```

| measure | value |
|---|---|
| lead rows | 5 |
| **leads with a usable email address** | **1** |
| email = `''` (empty string, not NULL) | 1 |
| email NULL | 0 |
| email synthetic `@whatsapp.lead` | 2 |
| email synthetic `.invalid` | 1 |
| **rows with no phone** | **0** |
| **rows whose phone fails length normalisation** | **0** |
| rows whose phone carries a WAHA device suffix | 0 |

**Finding, stated plainly: within `leads`, leads are already 1:1 with humans.**
Nothing in the five production lead rows is a duplicate person. A model built
only to deduplicate `leads` would today have nothing to do. That is a real
finding and it is the honest answer to the question as it was asked.

It is also not the whole answer.

---

## 3. Dedup **across** the identity-bearing tables — 19 rows, 15 humans

`leads` is not the only table holding a human's contact details. `whatsapp_contacts`
holds 14 more, each with a real phone number and a push name.

```sql
with src as (
  select 'leads'::text tbl, id::text row_key, name label, phone raw_phone from public.leads
  union all select 'whatsapp_contacts', chat_id, push_name, phone from public.whatsapp_contacts),
n as (select *, right(nullif(regexp_replace(split_part(coalesce(raw_phone,''),':',1),'[^0-9]','','g'),''),9) tail9 from src)
select count(*) identity_bearing_rows, count(distinct tail9) distinct_humans_by_tail9,
       count(*) filter (where tail9 is null) rows_no_usable_phone,
       count(*) filter (where raw_phone ~ ':') rows_needing_suffix_strip from n;
```

| measure | value |
|---|---|
| identity-bearing rows (`leads` + `whatsapp_contacts`) | **19** |
| of which `leads` | 5 |
| of which `whatsapp_contacts` | 14 |
| **distinct humans by normalised phone (last 9)** | **15** |
| distinct humans by full normalised digits | 15 |
| rows with no usable phone | 0 |
| **rows whose phone needs a device-suffix strip before it normalises** | **1** |

**Cross-table duplication: 4 of 19 rows (21%) are a second record of a human the
system already knows.** The four collisions, by query:

| normalised tail | the two rows that are one human |
|---|---|
| 505433953 | `leads:35 (Effco Contracting llc)` + `whatsapp_contacts:111948809162873@lid (Effco Contracting llc)` |
| 517942172 | `leads:38 (Ali)` + `whatsapp_contacts:158510264357112@lid (Ali)` |
| 547484167 | `leads:34 (Siva Thangavelu)` + `whatsapp_contacts:155315328786434@lid (Siva Thangavelu)` |
| 556382721 | `leads:122 (Hussain)` + `whatsapp_contacts:150345548320909@lid (Hussain)` |

Three of those four carry a stored back-pointer (`whatsapp_contacts.lead_email`).
The fourth — **Effco, `111948809162873@lid`, has `lead_email` NULL**. That link
exists in production *only* as a phone-tail coincidence that nothing computes.

### The normalisation failure, named

One row, `204479249027311@lid` ("Syed"), holds `phone = '971556456535:77'` — a real
number with a WAHA device suffix. Naive digit-stripping yields `97155645653577`
(14 digits) and a last-9 of `645653577`, **a number that does not exist**. One row
in 19 (5.3%) is silently mis-normalised by the obvious implementation.

---

## 4. The number that actually justifies the model: message attribution

```sql
with k as (select lead_email, count(*) c from public.communication_logs group by 1),
resolved as (select k.lead_email, k.c,
  exists (select 1 from public.leads l where lower(l.email)=lower(k.lead_email)) direct_email_hit,
  exists (select 1 from public.whatsapp_contacts w where w.chat_id=k.lead_email and w.lead_email is not null) via_wa_pointer,
  exists (select 1 from public.whatsapp_contacts w join public.leads l
          on right(regexp_replace(split_part(w.phone,':',1),'[^0-9]','','g'),9)
           = right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),9)
          where w.chat_id=k.lead_email) via_wa_phone_tail
  from k)
select sum(c) total_messages,
  sum(c) filter (where direct_email_hit) msgs_direct_to_lead,
  sum(c) filter (where not direct_email_hit and via_wa_pointer) msgs_via_wa_pointer,
  sum(c) filter (where not direct_email_hit and not via_wa_pointer and via_wa_phone_tail) msgs_recoverable_by_phone_tail_only,
  sum(c) filter (where not direct_email_hit and not via_wa_pointer and not via_wa_phone_tail) msgs_unattributable,
  count(*) distinct_keys,
  count(*) filter (where not direct_email_hit and not via_wa_pointer and not via_wa_phone_tail) distinct_keys_unattributable
from resolved;
```

| measure | value |
|---|---|
| total messages in `communication_logs` | **142** |
| attach directly to a lead by `leads.email` | 35 |
| attach via `whatsapp_contacts.lead_email` | 14 |
| **recoverable only by phone-tail join** (nothing computes this today) | **10** |
| **attach to nothing at all** | **83 (58%)** |
| distinct message keys | 18 |
| **distinct keys that are a human with no lead row** | **11** |

Key shapes in that one text column:

| shape | rows | distinct keys |
|---|---|---|
| `<digits>@lid` | 95 | 14 |
| `+<digits>@whatsapp.lead` | 25 | 3 |
| real email address | 22 | 1 |

---

## 5. Verdict

1. **Inside `leads`, the dedup problem does not exist.** 5 rows, 5 humans, 0%
   collision. Anyone who justifies the Customer table by "leads double-count
   people" is wrong on this data, today.
2. **Across the system, it does exist and is measured at 21%** — 19 identity rows
   for 15 humans, with one of the four collisions linked by nothing at all.
3. **The strongest justification is neither.** The dealership has spoken to **15
   people**; `leads` knows **5**. **11 humans and 83 messages (58% of all message
   history) are held in `whatsapp_contacts` / `communication_logs` and attach to
   no customer record whatsoever.** The problem is not that one human becomes
   three rows. It is that eleven humans become zero rows.
4. **Email is not an identity key here.** 1 of 5 leads carries a usable address;
   the rest are `''`, `.invalid`, or minted from the phone. Any resolution rule
   that leads with email resolves 20% of production.
5. **Phone is the only usable key, and it needs real normalisation.** 0% of lead
   phones fail; 5.3% of the wider set (1 row in 19) is silently corrupted by the
   naive strip because of a WAHA `:77` device suffix.

### Not measured
- Whether the four cross-table pairs are genuinely the same human or a phone
  reused. **NOT MEASURED** — no human confirmation was sought.
- Any tenant other than the single production tenant. **NOT MEASURED** — there is
  only one tenant with leads.
- Whether the 11 orphan WhatsApp contacts are customers, suppliers or staff.
  **NOT MEASURED** — push names include "perfumer" and "KAWKAB AL NUJOOM
  COSMETIC", which suggests not all of them are car buyers. This materially
  affects the "15 humans" figure and must be confirmed before it is quoted.
