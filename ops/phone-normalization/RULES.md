# Phone normalisation rules

**Status: PROPOSED. Nothing here is applied.** No migration was written, no row
was changed, no workflow was edited. This file states what the rules should be,
what they would do to the data that is on production today, and what breaks.

**The instruction this exists to satisfy**, from Ali, 8 September 2026:

> *"Bad data ko confidently transform karna, missing data se worse hai."*

Confidently transforming bad data is worse than missing data. Specifically:
never guess a country code, never treat `@lid` as a phone number, never use
`push_name` as identity, strip the device suffix, refuse an implausible number.

**Why the stakes are what they are.** In NEXUS a phone number is not a display
field. It is the identity a customer is matched on — `nexus_lead_for_phone`, the
last-nine-digits rule in `Resolve Lead Identity`, and the proposed
`external_event_id = 'wa:' || <E.164>` in `ops/whatsapp-lead-capture/SPEC.md`
§5.2 all key on it — and it is the address `nexus_request_send` delivers an
automated message to. A number that is wrong by two digits is not a cosmetic
defect. It is a message to a stranger, filed under a customer's name.

**Multi-tenant, not UAE-only.** `CLAUDE.md`: NEXUS is sold to dealerships, UAE
first then worldwide. A rule that is right for `+971` and quietly wrong for
`+966`, `+91` or `+44` is not a rule, it is a configuration for tenant one. §3
is country-agnostic on purpose and §5.2 names the three files that are not.

**Masking convention.** In every shape table below, `#` is one digit and every
other character is literal. Where a query or a test vector needs a literal value,
that value is a **synthetic stand-in with the identical structure** — the same
length, the same country code, the same separators — never a value copied out of
production. **No complete real customer number, and no real LID, appears in this
file.** Counts and shapes are real; digits are not.

---

## 1. What is actually in the database

Measured on production `dsvuoovivysszdoiorch` as `postgres` (`rolbypassrls =
true`, so these are whole-table counts, not an RLS-filtered view), 8 September
2026. Production holds **one active dealership plus a quarantine tenant**, so
every count below is a one-tenant count and says nothing about what a second
dealership's data looks like.

### 1.1 Which columns hold something phone-shaped

The task named five places. There are eight.

```sql
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema='public'
   and (column_name ilike '%phone%' or column_name ilike '%chat_id%'
        or column_name ilike '%jid%'  or column_name ilike '%lid%'
        or column_name ilike '%msisdn%' or column_name ilike '%contact%')
 order by table_name, column_name;
```

| column | what it is | rows |
|---|---|---|
| `leads.phone` | the CRM card's number — what a salesperson dials | 5 |
| `whatsapp_contacts.phone` | the WhatsApp sender's number, from `Info.SenderAlt` | 14 |
| `whatsapp_contacts.chat_id` | the WhatsApp conversation handle | 14 |
| `processed_messages.chat_id` | the idempotency claim's conversation handle | 41 |
| `communication_logs.lead_email` | the key a message is filed under — four incompatible shapes in one text column | 142 |
| `channel_message_events.customer_phone` | the messaging layer's per-message sender | **0** |
| `customer_360_profiles.phone` | the nightly aggregation's copy | 4 |
| `purchase_history.phone` | the purchase record's copy | 1 |
| `kyc_documents.chat_id` | the KYC submission's conversation handle | 3 |
| `whatsapp_opt_in_event.customer_wa_id` | the consent ledger's customer address | **0** |

`channel_message_events` and `whatsapp_opt_in_event` are empty. That is
consistent with `ops/whatsapp-lead-capture/SPEC.md` §1.3 and it means the two
tables whose column names promise the most discipline have never been tested
against a real value.

### 1.2 Every distinct shape

```sql
with src as (
  select 'leads.phone' as col, phone as v from public.leads
  union all select 'whatsapp_contacts.phone',      phone      from public.whatsapp_contacts
  union all select 'whatsapp_contacts.chat_id',    chat_id    from public.whatsapp_contacts
  union all select 'whatsapp_contacts.lead_email', lead_email from public.whatsapp_contacts
  union all select 'processed_messages.chat_id',   chat_id    from public.processed_messages
  union all select 'communication_logs.lead_email',lead_email from public.communication_logs
  union all select 'channel_message_events.customer_phone', customer_phone from public.channel_message_events
  union all select 'customer_360_profiles.phone',  phone      from public.customer_360_profiles
  union all select 'purchase_history.phone',       phone      from public.purchase_history
  union all select 'kyc_documents.chat_id',        chat_id    from public.kyc_documents
)
select col,
       case when v is null then '(null)' when btrim(v)='' then '(empty)'
            else regexp_replace(v,'[0-9]','#','g') end as mask,
       count(*) as n, count(distinct v) as distinct_values
  from src group by 1,2 order by 1,3 desc;
```

| column | shape (masked) | rows | distinct | what it is |
|---|---|---|---|---|
| `leads.phone` | `+############` | 5 | 5 | E.164, `+` and 12 digits |
| `whatsapp_contacts.phone` | `############` | 13 | 13 | 12 bare digits, **no `+`** |
| `whatsapp_contacts.phone` | `############:##` | 1 | 1 | **12 bare digits and a device suffix** |
| `whatsapp_contacts.chat_id` | `###############@lid` | 8 | 8 | 15-digit LID |
| `whatsapp_contacts.chat_id` | `##############@lid` | 5 | 5 | 14-digit LID |
| `whatsapp_contacts.chat_id` | `#############@lid` | 1 | 1 | 13-digit LID |
| `whatsapp_contacts.lead_email` | `(null)` | 11 | 0 | never linked to a lead |
| `whatsapp_contacts.lead_email` | `+############@whatsapp.lead` | 2 | 2 | a key the router synthesises |
| `whatsapp_contacts.lead_email` | `<name>@<provider>.com` | 1 | 1 | a real email address |
| `processed_messages.chat_id` | `###############@lid` | 25 | 7 | 15-digit LID |
| `processed_messages.chat_id` | `##############@lid` | 12 | 3 | 14-digit LID |
| `processed_messages.chat_id` | `#############@lid` | 4 | 1 | 13-digit LID |
| `processed_messages.message_id` | `false_##############@lid_<hex>` | 41 | 41 | WAHA message id — carries a LID, never a number |
| `communication_logs.lead_email` | `###############@lid` | 46 | 8 | 15-digit LID as an identity key |
| `communication_logs.lead_email` | `##############@lid` | 45 | 5 | 14-digit LID as an identity key |
| `communication_logs.lead_email` | `+############@whatsapp.lead` | 25 | 3 | synthesised from a phone |
| `communication_logs.lead_email` | `<name>@<provider>.com` | 22 | 1 | a real email address |
| `communication_logs.lead_email` | `#############@lid` | 4 | 1 | 13-digit LID as an identity key |
| `customer_360_profiles.phone` | `+############` | 4 | 4 | E.164 |
| `purchase_history.phone` | `+############` | 1 | 1 | E.164 |
| `kyc_documents.chat_id` | `###############@lid` | 3 | 1 | 15-digit LID |
| `channel_message_events.customer_phone` | — | 0 | 0 | table is empty |

**Nine distinct shapes across ten columns.** Three of them (`@lid` at three
lengths) are the same non-shape wearing three lengths.

### 1.3 The country codes present, and the digit counts

```sql
with d as (
  select 'leads.phone' as col, regexp_replace(phone,'[^0-9]','','g') as digits,
         split_part(phone,':',1) as before_colon from public.leads
  union all select 'whatsapp_contacts.phone', regexp_replace(phone,'[^0-9]','','g'),
         split_part(phone,':',1) from public.whatsapp_contacts
  union all select 'customer_360_profiles.phone', regexp_replace(phone,'[^0-9]','','g'),
         split_part(phone,':',1) from public.customer_360_profiles
  union all select 'purchase_history.phone', regexp_replace(phone,'[^0-9]','','g'),
         split_part(phone,':',1) from public.purchase_history
)
select col, left(digits,3) as first3, length(digits) as digit_len,
       length(regexp_replace(before_colon,'[^0-9]','','g')) as digits_before_colon,
       count(*) from d group by 1,2,3,4 order by 1,5 desc;
```

| column | first 3 digits | digits | digits before the `:` | rows |
|---|---|---|---|---|
| `leads.phone` | `971` | 12 | 12 | 4 |
| `leads.phone` | `918` | 12 | 12 | 1 |
| `whatsapp_contacts.phone` | `971` | 12 | 12 | 12 |
| `whatsapp_contacts.phone` | `918` | 12 | 12 | 1 |
| `whatsapp_contacts.phone` | `971` | **14** | **12** | **1** |
| `customer_360_profiles.phone` | `971` | 12 | 12 | 3 |
| `customer_360_profiles.phone` | `918` | 12 | 12 | 1 |
| `purchase_history.phone` | `918` | 12 | 12 | 1 |

Two country codes on production: `971` (UAE) and `91` (India). Every value is 12
digits **except the one row that is 14 and 12 before the colon.** That one row is
the whole problem, and it is measured, not hypothetical.

### 1.4 Verifying the device-suffix trap

`ops/whatsapp-lead-capture/SPEC.md` §5.3 records that `whatsapp_contacts` holds
one `############:##` value and that `'+' || digits` turns it into a fourteen
digit number that the Lead Event contract accepts. Re-run against the live
function on 8 September, and extended to every other shape:

```sql
with cases(label, raw) as (values
 ('device suffix, wa_contacts real shape','971555000111:77'),
 ('device suffix, me.jid form','971520000000:12@s.whatsapp.net'),
 ('lid, 15 digit','199000000000999@lid'),
 ('lid, 13 digit','1990000000009@lid'),
 ('lid, 11 digit','12345678901@lid'),
 ('short legacy group jid','12345-67890@g.us'),
 ('long group jid','120363012345678901@g.us'),
 ('newsletter','120363011111111111@newsletter'),
 ('status broadcast','status@broadcast'),
 ('c.us jid','971501234567@c.us'),
 ('9 digit local','501234567'),
 ('13 digit numeric','1234567890123'),
 ('8 digit numeric','12345678'),
 ('15 digit numeric','123456789012345'),
 ('extension x123','+971 4 321 4321 x123'),
 ('leading 00','00971501234567'),
 ('local 05x','0501234567'),
 ('empty',''))
select label,
       '+' || regexp_replace(raw,'[^0-9]','','g') as naive_plus_digits,
       coalesce(public.nexus_lead_normalized_defect(
         jsonb_build_object('full_name','x','phone_e164',
           '+' || regexp_replace(raw,'[^0-9]','','g'))),
        'ACCEPTED-BY-CONTRACT') as contract_verdict
  from cases;
```

**Ten shapes that are not a phone number are accepted by
`nexus_lead_normalized_defect` when passed through `'+' || digits`:**

| shape | `'+' || digits` produces | contract says | what it really is |
|---|---|---|---|
| `############:##` (device suffix) | `+##############` (14) | **ACCEPTED** | a real number with two junk digits welded on |
| `############:##@s.whatsapp.net` | `+##############` (14) | **ACCEPTED** | same |
| `###############@lid` | `+###############` (15) | **ACCEPTED** | an opaque machine id; reads as a `+1` number |
| `#############@lid` | `+#############` (13) | **ACCEPTED** | same |
| `###########@lid` | `+###########` (11) | **ACCEPTED** | same |
| `#####-#####@g.us` (legacy group) | `+##########` (10) | **ACCEPTED** | a chat room |
| `############@c.us` | `+############` (12) | **ACCEPTED** | correct — this one is a real number |
| `#########` (9 bare digits) | `+#########` (9) | **ACCEPTED** | a national number missing its country code |
| `#############` (13 bare digits) | `+#############` | **ACCEPTED** | unknown |
| `+### # ### #### x###` | `+###############` (15) | **ACCEPTED** | a number with a switchboard extension glued to it |

Refused only by accident of length, not by anything that understands the value:
the 18-digit group jid and the 18-digit newsletter id exceed E.164's fifteen, and
`status@broadcast` and the empty string produce a bare `+`. **A shorter group id
would pass.** The contract is doing exactly what its own comment says it does —
checking E.164 shape and refusing to guess a country code — and it was never the
layer that could catch these. This is not a defect in
`nexus_lead_normalized_defect`. It is a missing layer in front of it.

### 1.5 The layer in front of it, as shipped today

Three files carry a `toE164` and all three are the same function:

- `apps/marketing-site/api/lead.js:78`
- `ops/n8n-meta-lead-ads/normalize-and-redact.node.js:133`
- `ops/n8n-google-lead-form/verify-and-redact.node.js:196`

Run against the shapes above (node, 8 September 2026):

| input | `toE164` returns | verdict |
|---|---|---|
| `+############:##` | `+##############` | **wrong number — the device suffix survives, because `[^\d+]` strips the colon and joins the digits** |
| `#########` (9 bare digits) | `+971#########` | **a guessed country code** |
| `0#########` (national 05x) | `+971#########` | **a guessed country code** |
| `# # # # # # # # #` (spaced) | `+971#########` | **a guessed country code** |
| `############` bare, `966…` | `null` | refused |
| `############` bare, `44…` | `null` | refused |
| `############` bare, `971…` | `+############` | accepted |
| `############@c.us` | `+############` | correct |
| `###############@lid` | `null` | refused |

Two findings, and the second is the one that matters for tenant two.

**One: the shipped normaliser produces a wrong number from a device-suffixed
input that arrives with a `+`.** A `+############:##` value becomes a
`+##############` — fourteen digits, the two device-index digits welded onto the
end of a real number.
It is not caught later; §1.4 shows the contract accepts it.

**Two: `toE164` guesses `+971` and guesses it only for the UAE.** The branch is
`if (/^0?5\d{8}$/.test(d)) return '+971' + d.replace(/^0/, '')`. Saudi Arabian
mobile numbers are `+966 5X XXX XXXX` — in national form, `05XXXXXXXX`, the
**identical ten-digit shape**. A Saudi customer who types their own number the
way they always write it gets a UAE number, silently, and NEXUS messages a
stranger in Dubai. The same branch fires on nine bare digits with no leading
zero, which is how a UAE *or* a Saudi customer often types it.

Meanwhile a Saudi or UK number typed in full but without a `+` (`966…`, `44…`)
returns `null` and is refused. So the current behaviour is: **guess for the UAE,
refuse for everyone else.** That is not a normaliser, it is tenant one's
configuration compiled into three files.

---

## 2. What each WhatsApp identifier actually is

Where the repo already records an answer it is cited. Where it does not, the row
says **asserted** and the claim is from WhatsApp's documented addressing
behaviour, not from a measurement of this database.

| identifier | is it a phone number | stable | globally unique | may be identity | may be messaged | source |
|---|---|---|---|---|---|---|
| `<digits>@c.us` | **yes** — the local part is the E.164 number without the `+` | yes, while the account exists | yes | **yes**, by the number it carries | yes | measured/repo: `apps/executive-dashboard/lib/identity.js` `PHONE_SHAPES` includes `c.us` |
| `<digits>@s.whatsapp.net` | **yes** — WAHA's raw form of the same address | yes | yes | **yes** | yes | repo: `identity.js`, *"`s.whatsapp.net` is the raw WAHA address form of `c.us`"* |
| `<digits>@g.us` | **no** — a chat room | the room is stable | unique as a room | **no** — it belongs to no person | it can be posted to; never as a customer | repo: `identity.js`, *"A group id is a room, not a person. Never query a person's history on it."* |
| `<digits>@lid` | **no** — an opaque machine id containing **no phone digits at all** | stable for a given (sender, our account) pairing | unique as a handle, not as a number | **as a handle only, never as a number** | yes, as a chat address | repo: `SPEC.md` §1.1 *"the chat id contains no phone digits at all"*; `identity.js` LID branch; `screens/ask.js:252` |
| `<digits>@newsletter` | **no** — a channel | — | — | **no** | no | repo: `ops/n8n-waha-gate/prefilter.assignments.md`, filtered before the claim |
| `status@broadcast` | **no** — the status feed, one literal for everyone | fixed literal | not per person | **no** | no | repo: `SPEC.md` §1.4 |
| `:NN` device suffix | **no** — an index of *which linked device* sent the message | **no** | not part of the address | **no — it must be stripped** | not addressable | repo: `SPEC.md` §5.3; and see below |
| `me.jid` | the **dealership's own** number, device-suffixed | the number is; the suffix is not | yes | it is the tenant's own line, never a customer | n/a | measured: `ops/n8n-waha-gate/README.md` |
| `me.lid` | **no** — the dealership's own LID | — | — | never | n/a | **asserted** |
| `push_name` | **no** — a display string the sender chooses | **no** | **no** | **never** | no | repo: `SPEC.md` §5.4; one contact in the window has `push_name = '._'` |

**The device suffix is measurably not stable, on this handset, this month.**
`ops/n8n-waha-gate/README.md` records `me.jid ############:12@s.whatsapp.net` on
29 of 29 executions on 7 September, and the same twelve digits with `:8` on
execution 11103 on 8 September — **the same number, two different device
indexes, one day apart**, because a second WAHA container was linked as a
different device. Anything that treats `:NN` as part of the address gets a
different answer depending on which linked device a message came from. That is
the definition of an unusable identity component, and it is why the suffix is
split off before anything else happens.

**On `@lid` specifically.** Its digits look like a phone number and are not one.
A 15-digit LID passed through `'+' || digits` becomes a `+1…` number that the
E.164 contract accepts (§1.4). Every single conversation handle on production —
**95 rows in `communication_logs`, 41 in `processed_messages`, 14 in
`whatsapp_contacts`, 3 in `kyc_documents`, and every WAHA `message_id`** — is a
`@lid`. There is not one `@c.us` handle in the database. So the failure mode is
not rare: it is the only shape the conversation tables contain.

---

## 3. The rules

### 3.1 What E.164 requires

ITU-T Recommendation E.164 defines an international public telecommunication
number as a country code followed by a national number, **at most 15 digits in
total**. The leading `+` is notation, not a digit. A country code never begins
with `0`.

NEXUS's existing contract, `nexus_lead_normalized_defect`, spells this
`^\+[1-9][0-9]{7,14}$` — that is, `+` then 8 to 15 digits, first digit 1–9.
**These rules keep that floor of 8 rather than E.164's true minimum**, so that
nothing this function emits is refused one layer later. That is a compatibility
decision, and it is stated rather than hidden: a genuine 7-digit international
number exists (some small territories) and NEXUS would refuse it. See Unknowns.

**What NEXUS does with a number it cannot prove is E.164: it does not emit one.**
There is no repair, no completion, no best guess. The value is returned with a
verdict of `REFUSED` or `HELD_FOR_REVIEW` and a reason code, and the caller
records that verdict. It is not written to `leads.phone`, it is not put in
`normalized.phone_e164`, and it is never handed to `nexus_request_send`.

### 3.2 The three properties these rules hold

**Deterministic and idempotent.** The function is a pure expression over its
inputs — `IMMUTABLE`, no clock, no table read, no tenant. Every output that is
`NORMALISED` has the form `+` followed by 8–15 digits with a non-zero first
digit, which is itself a `NORMALISED` input, so
`normalize(normalize(x)) = normalize(x)` for every `x`. Vector 42 in §4.2 checks
it directly.

**Country-agnostic, in both directions.** No country code is ever added. No
country code is ever removed. No country's national numbering plan is consulted.
There is no list of "our" countries and no default. A UAE number and a Saudi
number and a UK number take exactly the same path through this function, and the
only thing that distinguishes them is the digits the customer supplied.

**One deliberate exception, and it is not a country guess.** A value taken from a
WhatsApp jid local part, or from the WhatsApp Cloud API `from` field, has the
`+` restored. The country code is already in those digits — the transport's own
addressing format is defined to carry the full international number, which is how
the message reached us at all. **Adding a `+` is notation; adding a country code
is data.** These rules do the first and never the second. The exception is opened
by an explicit second argument naming the transport, and is closed by default.

### 3.3 The decision table

`nexus_normalize_phone(p_raw text, p_transport text default 'typed')`

Rules are evaluated **in this order**. The first match wins. `local part` means
what is left after removing any `@domain` suffix and then everything from the
first `:` onward. `digits` means the ASCII digits of the local part.

| # | input shape | example (masked) | output | verdict | reason code |
|---|---|---|---|---|---|
| 1 | `p_transport` not one of `typed`, `whatsapp_jid`, `whatsapp_cloud_from` | any | null | `REFUSED` | `PHONE_TRANSPORT_UNKNOWN` |
| 2 | null, empty, or whitespace only | `''` | null | `REFUSED` | `PHONE_ABSENT` |
| 3 | `@lid` handle | `###############@lid` | null | `REFUSED` | `PHONE_IS_A_LID_NOT_A_NUMBER` |
| 4 | `@g.us` group jid | `##################@g.us`, `#####-#####@g.us` | null | `REFUSED` | `PHONE_IS_A_GROUP_NOT_A_PERSON` |
| 5 | `@newsletter` | `##################@newsletter` | null | `REFUSED` | `PHONE_IS_A_CHANNEL_NOT_A_PERSON` |
| 6 | `status@broadcast` | `status@broadcast` | null | `REFUSED` | `PHONE_IS_A_BROADCAST_NOT_A_PERSON` |
| 7 | any other `@domain` that parses as an email | `<name>@<provider>.com` | null | `REFUSED` | `PHONE_IS_AN_EMAIL_ADDRESS` |
| 8 | any other `@domain` | `x@unknown` | null | `REFUSED` | `PHONE_UNKNOWN_HANDLE_DOMAIN` |
| 9 | handle with nothing before the `@` | `@lid` | null | `REFUSED` | `PHONE_HANDLE_HAS_NO_LOCAL_PART` |
| 10 | no ASCII digits anywhere | `call the office`, Arabic-Indic digits | null | `REFUSED` | `PHONE_NO_DIGITS` |
| 11 | two numbers separated by `/ , ;` | `+############ / +############` | null | `HELD_FOR_REVIEW` | `PHONE_FIELD_HOLDS_MORE_THAN_ONE_NUMBER` |
| 12 | trailing extension marker | `+### # ### #### x###` | null | `HELD_FOR_REVIEW` | `PHONE_CARRIES_AN_EXTENSION` |
| 13 | a `+` anywhere but the front | `++############` | null | `REFUSED` | `PHONE_MALFORMED_PREFIX` |
| 14 | any character that is not a digit, space, `-`, `(`, `)` or `.` | `+#### abc` | null | `REFUSED` | `PHONE_CONTAINS_NON_NUMERIC_TEXT` |
| 15 | leading `+`, digits begin `0` | `+0###########` | null | `REFUSED` | `PHONE_E164_COUNTRY_CODE_CANNOT_START_ZERO` |
| 16 | leading `+`, fewer than 8 digits | `+#######` | null | `REFUSED` | `PHONE_TOO_SHORT_FOR_E164` |
| 17 | leading `+`, more than 15 digits | `+################` | null | `REFUSED` | `PHONE_TOO_LONG_FOR_E164` |
| 18 | all digits identical | `+############` | null | `REFUSED` | `PHONE_NOT_PLAUSIBLE_REPEATED_DIGIT` |
| 19 | **leading `+`, 8–15 digits, first 1–9** | `+############` | `+` + digits | **`NORMALISED`** | — |
| 20 | **no `+`, digits begin `00`, remainder passes 15–18** | `00###########` | `+` + digits after the `00` | **`NORMALISED`** | — |
| 21 | no `+`, digits begin with a single `0` | `0#########` | null | `HELD_FOR_REVIEW` | `PHONE_IS_NATIONAL_FORMAT_COUNTRY_UNKNOWN` |
| 22 | **`p_transport` is `whatsapp_jid` or `whatsapp_cloud_from`, bare digits, passes 15–18** | `############`, `############:##`, `############@c.us` | `+` + digits | **`NORMALISED`** | — |
| 23 | no `+`, bare digits, `p_transport = 'typed'` | `############`, `#########` | null | `HELD_FOR_REVIEW` | `PHONE_NO_INTERNATIONAL_PREFIX` |

The device suffix is not a row in this table because it is removed before any row
is evaluated: everything from the first `:` in the local part onward is
discarded, which is why row 22 accepts `############:##` and returns the twelve
digits in front of the colon. Row 13 in §4.2 shows the same for a `+`-prefixed
input, which is the case the shipped `toE164` gets wrong.

### 3.4 Why `HELD_FOR_REVIEW` exists and is not the same as `REFUSED`

`REFUSED` means *this value can never be a phone number*: a LID, a group, an
email, an empty string, a country code starting with zero. Nobody should ever ask
about it again.

`HELD_FOR_REVIEW` means *this could be a real customer's real number and nothing
in the data says which country it is in*. Twelve bare digits beginning `971` are
almost certainly a UAE number — and "almost certainly" is precisely the judgement
these rules exist to stop a machine making. It is recorded, it is visible, and a
human who knows where the lead came from can supply the missing fact. **The
outcome is the same as `REFUSED` for every automated path: no message is sent,
no identity match is made.** The difference is only that a person is asked.

Both are recorded. Neither is silently dropped, and neither is guessed.

### 3.5 What `p_transport` costs

The two-argument form is a real weakening and it should be read as one. Under
`whatsapp_jid`, thirteen bare digits normalise to a thirteen-digit E.164 number
(§4.2 vector 30) because a jid local part *is* the number by definition of the
protocol. **If a caller declares `whatsapp_jid` for a value that did not come out
of a jid, this function will confidently produce a wrong number** — the exact
failure the rules exist to prevent, moved one layer up.

So the transport argument is a claim about provenance, and only two callers may
make it: the WAHA receiver, for `Info.SenderAlt` and the jid local part; and the
WhatsApp Cloud receiver, for `payload.from`. Every other caller uses the
one-argument form, which never restores a `+`. There is no third value and an
unrecognised one is `REFUSED`, not defaulted (row 1).

---

## 4. The implementation

### 4.1 The function

**Not written as a migration.** If applied it would be
`supabase/migrations/<timestamp>_a_phone_number_is_an_address_not_a_display_field.sql`,
and it would need the same grant treatment as its siblings —
`revoke all … from public, anon, authenticated; grant execute … to service_role;`
— because a function that decides what may be messaged is not something the
browser role calls.

```sql
create or replace function public.nexus_normalize_phone(
  p_raw       text,
  p_transport text default 'typed'
)
returns table (phone_e164 text, verdict text, reason text, input_shape text)
language sql
immutable
security invoker
set search_path = public
as $$
  with raw as (
    select coalesce(p_raw, '')                                        as r,
           lower(coalesce(nullif(btrim(p_transport), ''), 'typed'))   as tr
  ),
  -- The @domain decides whether this is an address at all, before any digit is
  -- looked at. A LID's digits look exactly like a phone number, so anything that
  -- reaches the digits first has already lost.
  shaped as (
    select btrim(r) as t, tr,
           lower(coalesce(substring(btrim(r) from '@([A-Za-z0-9._-]+)$'), '')) as domain
      from raw
  ),
  -- The device suffix, split off here and never seen again. ':77' is which
  -- linked device sent the message; the same handset read ':12' on 7 Sep and
  -- ':8' on 8 Sep (ops/n8n-waha-gate/README.md). Keeping it produces a
  -- fourteen-digit number that E.164 accepts and no telephone answers.
  cut as (
    select t, tr, domain,
           regexp_replace(t, '@[A-Za-z0-9._-]+$', '') as before_at
      from shaped
  ),
  dev as (
    select t, tr, domain, before_at,
           split_part(before_at, ':', 1) as local_part,
           (before_at like '%:%')        as had_device_suffix
      from cut
  ),
  parts as (
    select t, tr, domain, local_part, had_device_suffix,
           (local_part ~ '^\+')                        as has_plus,
           regexp_replace(local_part, '^\+', '')       as body,
           regexp_replace(local_part, '[^0-9]', '', 'g') as digits
      from dev
  ),
  flags as (
    select p.*,
           -- what is left once digits and the ordinary separators are removed.
           -- Anything here means the value is not only a phone number.
           regexp_replace(p.body, '[-0-9 ().]', '', 'g')  as junk,
           (p.digits ~ '^00[0-9]+$')                      as intl_00,
           case when p.digits ~ '^00' then substring(p.digits from 3)
                else p.digits end                        as d2
      from parts p
  ),
  -- THE ONLY PLACE A '+' IS EVER ADDED, and the three ways it may be earned:
  -- the value already had one; the value carries the ITU '00' international
  -- prefix; or the caller has declared that these digits came out of a WhatsApp
  -- address, whose format is the full international number by construction.
  -- There is no fourth branch and there is no default country code.
  final as (
    select f.*,
           case
             when f.has_plus then f.digits
             when f.intl_00  then f.d2
             when f.tr in ('whatsapp_jid','whatsapp_cloud_from') then f.digits
             else null
           end as candidate
      from flags f
  )
  select
    case when z.verdict = 'NORMALISED' then '+' || z.candidate end,
    z.verdict, z.reason, z.input_shape
  from (
    select f.*,
      case
        when f.domain = 'lid'             then 'lid'
        when f.domain = 'g.us'            then 'group'
        when f.domain = 'newsletter'      then 'newsletter'
        when f.domain = 'broadcast'       then 'broadcast'
        when f.domain = 'c.us'            then 'whatsapp_c_us'
        when f.domain = 's.whatsapp.net'  then 'whatsapp_s_whatsapp_net'
        when f.domain = 'whatsapp.lead'   then 'whatsapp_lead_synthetic'
        when f.domain <> ''               then 'other_at_shape'
        when f.t = ''                     then 'empty'
        when f.has_plus                   then 'plus_prefixed'
        when f.intl_00                    then 'international_00'
        when f.digits ~ '^0'              then 'national_leading_zero'
        when f.digits <> ''               then 'bare_digits'
        else 'no_digits'
      end as input_shape,
      case
        when f.tr not in ('typed','whatsapp_jid','whatsapp_cloud_from') then 'REFUSED'
        when f.t = ''                                             then 'REFUSED'
        when f.domain in ('lid','g.us','newsletter','broadcast')  then 'REFUSED'
        when f.domain <> ''
         and f.domain not in ('c.us','s.whatsapp.net','whatsapp.lead') then 'REFUSED'
        when f.local_part = ''                                    then 'REFUSED'
        when f.digits = ''                                        then 'REFUSED'
        when f.body ~ '[0-9][^0-9]{0,3}[/,;][^0-9]{0,3}[0-9]'     then 'HELD_FOR_REVIEW'
        when f.body ~* '(x|ext|extn)\.? ?[0-9]+$'                 then 'HELD_FOR_REVIEW'
        when f.body ~ '\+'                                        then 'REFUSED'
        when f.junk <> ''                                         then 'REFUSED'
        when f.candidate is null and f.digits ~ '^0'              then 'HELD_FOR_REVIEW'
        when f.candidate is null                                  then 'HELD_FOR_REVIEW'
        when f.candidate ~ '^0'                                   then 'REFUSED'
        when length(f.candidate) < 8                              then 'REFUSED'
        when length(f.candidate) > 15                             then 'REFUSED'
        when f.candidate ~ ('^' || substr(f.candidate,1,1) || '+$') then 'REFUSED'
        else 'NORMALISED'
      end as verdict,
      case
        when f.tr not in ('typed','whatsapp_jid','whatsapp_cloud_from')
                                                    then 'PHONE_TRANSPORT_UNKNOWN'
        when f.t = ''                               then 'PHONE_ABSENT'
        when f.domain = 'lid'                       then 'PHONE_IS_A_LID_NOT_A_NUMBER'
        when f.domain = 'g.us'                      then 'PHONE_IS_A_GROUP_NOT_A_PERSON'
        when f.domain = 'newsletter'                then 'PHONE_IS_A_CHANNEL_NOT_A_PERSON'
        when f.domain = 'broadcast'                 then 'PHONE_IS_A_BROADCAST_NOT_A_PERSON'
        when f.domain <> ''
         and f.domain not in ('c.us','s.whatsapp.net','whatsapp.lead')
          then case when f.t ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                    then 'PHONE_IS_AN_EMAIL_ADDRESS'
                    else 'PHONE_UNKNOWN_HANDLE_DOMAIN' end
        when f.local_part = ''                      then 'PHONE_HANDLE_HAS_NO_LOCAL_PART'
        when f.digits = ''                          then 'PHONE_NO_DIGITS'
        when f.body ~ '[0-9][^0-9]{0,3}[/,;][^0-9]{0,3}[0-9]'
                                                    then 'PHONE_FIELD_HOLDS_MORE_THAN_ONE_NUMBER'
        when f.body ~* '(x|ext|extn)\.? ?[0-9]+$'   then 'PHONE_CARRIES_AN_EXTENSION'
        when f.body ~ '\+'                          then 'PHONE_MALFORMED_PREFIX'
        when f.junk <> ''                           then 'PHONE_CONTAINS_NON_NUMERIC_TEXT'
        when f.candidate is null and f.digits ~ '^0'
                                                    then 'PHONE_IS_NATIONAL_FORMAT_COUNTRY_UNKNOWN'
        when f.candidate is null                    then 'PHONE_NO_INTERNATIONAL_PREFIX'
        when f.candidate ~ '^0'                     then 'PHONE_E164_COUNTRY_CODE_CANNOT_START_ZERO'
        when length(f.candidate) < 8                then 'PHONE_TOO_SHORT_FOR_E164'
        when length(f.candidate) > 15               then 'PHONE_TOO_LONG_FOR_E164'
        when f.candidate ~ ('^' || substr(f.candidate,1,1) || '+$')
                                                    then 'PHONE_NOT_PLAUSIBLE_REPEATED_DIGIT'
        else null
      end as reason
      from final f
  ) z;
$$;

comment on function public.nexus_normalize_phone(text, text) is
  'Turns a phone-shaped value into E.164, or says why it will not. It never '
  'guesses a country code, in either direction, and it has no default country: '
  'a UAE, Saudi, Indian and UK number take the same path. It splits the WhatsApp '
  'device suffix off before anything else, because 971...:77 through a naive '
  '''+'' || digits is a fourteen-digit number that nexus_lead_normalized_defect '
  'accepts and no telephone answers. It refuses a @lid outright: a LID contains '
  'no phone digits and its 15 digits read as a +1 number. p_transport is a claim '
  'about provenance, not a hint -- only under whatsapp_jid or whatsapp_cloud_from '
  'is a bare digit string treated as E.164 without its +, because those transports '
  'address by full international number. An unrecognised transport is refused, '
  'never defaulted. REFUSED means this can never be a number; HELD_FOR_REVIEW '
  'means it might be one and nothing here can prove which country it is in. '
  'Neither is guessed and neither is silently dropped.';
```

### 4.2 Test vectors

Run against production on 8 September 2026 with the body above inlined as a
lateral. All 45 pass.

| # | input | transport | output | verdict | reason |
|---|---|---|---|---|---|
| 01 | `+971501234567` | typed | `+971501234567` | NORMALISED | — |
| 02 | `971501234567` | typed | null | HELD_FOR_REVIEW | `PHONE_NO_INTERNATIONAL_PREFIX` |
| 03 | `971501234567` | whatsapp_jid | `+971501234567` | NORMALISED | — |
| 04 | `0501234567` (UAE national) | typed | null | HELD_FOR_REVIEW | `PHONE_IS_NATIONAL_FORMAT_COUNTRY_UNKNOWN` |
| 05 | `501234567` (bare 9) | typed | null | HELD_FOR_REVIEW | `PHONE_NO_INTERNATIONAL_PREFIX` |
| 06 | `+97143214321` (UAE landline) | typed | `+97143214321` | NORMALISED | — |
| 07 | `+919876543210` (India) | typed | `+919876543210` | NORMALISED | — |
| 08 | `+966512345678` (Saudi) | typed | `+966512345678` | NORMALISED | — |
| 09 | `0512345678` (Saudi national) | typed | null | HELD_FOR_REVIEW | `PHONE_IS_NATIONAL_FORMAT_COUNTRY_UNKNOWN` |
| 10 | `+447700900123` (UK) | typed | `+447700900123` | NORMALISED | — |
| 11 | `07700900123` (UK national) | typed | null | HELD_FOR_REVIEW | `PHONE_IS_NATIONAL_FORMAT_COUNTRY_UNKNOWN` |
| 12 | `971555000111:77` | whatsapp_jid | `+971555000111` | NORMALISED | — |
| 13 | `+971555000111:77` | typed | `+971555000111` | NORMALISED | — |
| 14 | `971520000000:12@s.whatsapp.net` | whatsapp_jid | `+971520000000` | NORMALISED | — |
| 15 | `199000000000999@lid` (15 digits) | whatsapp_jid | null | REFUSED | `PHONE_IS_A_LID_NOT_A_NUMBER` |
| 16 | `1990000000009@lid` (13 digits) | whatsapp_jid | null | REFUSED | `PHONE_IS_A_LID_NOT_A_NUMBER` |
| 17 | `120363012345678901@g.us` | whatsapp_jid | null | REFUSED | `PHONE_IS_A_GROUP_NOT_A_PERSON` |
| 18 | `12345-67890@g.us` (short legacy group) | whatsapp_jid | null | REFUSED | `PHONE_IS_A_GROUP_NOT_A_PERSON` |
| 19 | `status@broadcast` | whatsapp_jid | null | REFUSED | `PHONE_IS_A_BROADCAST_NOT_A_PERSON` |
| 20 | `120363011111111111@newsletter` | whatsapp_jid | null | REFUSED | `PHONE_IS_A_CHANNEL_NOT_A_PERSON` |
| 21 | `971501234567@c.us` | whatsapp_jid | `+971501234567` | NORMALISED | — |
| 22 | `+919000000000@whatsapp.lead` | typed | `+919000000000` | NORMALISED | — |
| 23 | `''` | typed | null | REFUSED | `PHONE_ABSENT` |
| 24 | `null` | typed | null | REFUSED | `PHONE_ABSENT` |
| 25 | `'   '` | typed | null | REFUSED | `PHONE_ABSENT` |
| 26 | `+971 50 - 123 4567` | typed | `+971501234567` | NORMALISED | — |
| 27 | `00971501234567` | typed | `+971501234567` | NORMALISED | — |
| 28 | `00971501234567` | whatsapp_jid | `+971501234567` | NORMALISED | — |
| 29 | `1234567890123` (13 digits) | typed | null | HELD_FOR_REVIEW | `PHONE_NO_INTERNATIONAL_PREFIX` |
| 30 | `1234567890123` (13 digits) | whatsapp_jid | `+1234567890123` | NORMALISED | — |
| 31 | `+1234567` (7 digits) | typed | null | REFUSED | `PHONE_TOO_SHORT_FOR_E164` |
| 32 | `+1234567890123456` (16) | typed | null | REFUSED | `PHONE_TOO_LONG_FOR_E164` |
| 33 | `+0971501234567` | typed | null | REFUSED | `PHONE_E164_COUNTRY_CODE_CANNOT_START_ZERO` |
| 34 | `++971501234567` | typed | null | REFUSED | `PHONE_MALFORMED_PREFIX` |
| 35 | `+971 4 321 4321 x123` | typed | null | HELD_FOR_REVIEW | `PHONE_CARRIES_AN_EXTENSION` |
| 36 | `+971501234567 / +971504444444` | typed | null | HELD_FOR_REVIEW | `PHONE_FIELD_HOLDS_MORE_THAN_ONE_NUMBER` |
| 37 | `+111111111111` | typed | null | REFUSED | `PHONE_NOT_PLAUSIBLE_REPEATED_DIGIT` |
| 38 | Arabic-Indic digits | typed | null | REFUSED | `PHONE_NO_DIGITS` |
| 39 | `call the office` | typed | null | REFUSED | `PHONE_NO_DIGITS` |
| 40 | `someone@example.com` | typed | null | REFUSED | `PHONE_IS_AN_EMAIL_ADDRESS` |
| 41 | `+971501234567` | `sms_gateway` | null | REFUSED | `PHONE_TRANSPORT_UNKNOWN` |
| 42 | `+971501234567` (vector 01's own output) | typed | `+971501234567` | NORMALISED | — |
| 43 | `971501234567` | whatsapp_cloud_from | `+971501234567` | NORMALISED | — |
| 44 | `0971501234567` | whatsapp_jid | null | REFUSED | `PHONE_E164_COUNTRY_CODE_CANNOT_START_ZERO` |
| 45 | `+123456789012345` (15, E.164 max) | typed | `+123456789012345` | NORMALISED | — |

Three of these are worth reading twice.

**Vectors 04, 09 and 11 are the point of the whole document.** UAE `0501234567`,
Saudi `0512345678` and UK `07700900123` are three different people in three
different countries, and all three are held, not guessed. The shipped `toE164`
turns the first two into UAE numbers and the third into `null`.

**Vectors 12, 13 and 14 are the device suffix,** in the three spellings it
actually appears in — a bare `whatsapp_contacts.phone` value, the same value with
a `+`, and a `me.jid`. All three yield the twelve digits in front of the colon.
The shipped `toE164` returns a fourteen-digit wrong number for vector 13.

**Vector 38 refuses Arabic-Indic digits, and that refusal is right for the wrong
reason.** The function sees no ASCII digits and says `PHONE_NO_DIGITS`. A UAE
customer typing their number in Arabic numerals gets refused rather than mangled,
which is the correct outcome — but it is refused as *empty*, not as *a number in
another script*. See Unknowns.

---

## 5. What this breaks

### 5.1 Existing rows these rules would now refuse

Measured 8 September 2026, applying §3.3 to every phone-shaped column on
production:

```sql
with src as (
  select 'leads.phone' as col, phone as v from public.leads
  union all select 'whatsapp_contacts.phone',      phone      from public.whatsapp_contacts
  union all select 'whatsapp_contacts.chat_id',    chat_id    from public.whatsapp_contacts
  union all select 'processed_messages.chat_id',   chat_id    from public.processed_messages
  union all select 'communication_logs.lead_email',lead_email from public.communication_logs
  union all select 'customer_360_profiles.phone',  phone      from public.customer_360_profiles
  union all select 'purchase_history.phone',       phone      from public.purchase_history
  union all select 'kyc_documents.chat_id',        chat_id    from public.kyc_documents
) select col, /* §3.3 applied inline */ ... from src group by 1,2;
```

| column | rows | `NORMALISED` | `HELD_FOR_REVIEW` | `REFUSED` |
|---|---|---|---|---|
| `leads.phone` | 5 | **5** | 0 | 0 |
| `customer_360_profiles.phone` | 4 | **4** | 0 | 0 |
| `purchase_history.phone` | 1 | **1** | 0 | 0 |
| `whatsapp_contacts.phone`, read as a WhatsApp jid | 14 | **14** | 0 | 0 |
| `whatsapp_contacts.phone`, read as typed input | 14 | 0 | **14** — `PHONE_NO_INTERNATIONAL_PREFIX` | 0 |
| `whatsapp_contacts.chat_id` | 14 | 0 | 0 | **14** — `PHONE_IS_A_LID_NOT_A_NUMBER` |
| `processed_messages.chat_id` | 41 | 0 | 0 | **41** — `PHONE_IS_A_LID_NOT_A_NUMBER` |
| `kyc_documents.chat_id` | 3 | 0 | 0 | **3** — `PHONE_IS_A_LID_NOT_A_NUMBER` |
| `communication_logs.lead_email` | 142 | 25 (`@whatsapp.lead`) | 0 | 95 LID + 22 email |
| `channel_message_events.customer_phone` | 0 | — | — | — |

**Not one row that is actually a phone number is refused.** All eleven rows of
`leads`, `customer_360_profiles` and `purchase_history` normalise unchanged, and
all fourteen `whatsapp_contacts.phone` rows normalise under the WhatsApp
transport — **including the device-suffixed one, which normalises to the twelve
digits in front of the colon rather than to the fourteen-digit number that is on
production today.**

**One row's stored value is wrong and the fix changes what it matches.** The
`############:##` row's last nine digits, as `identity.js` computes them today,
are the last nine of the fourteen — which is not the last nine of the customer's
number. So that contact matches nothing, or matches the wrong lead. After the
fix it matches on the correct nine. That is a change in dashboard behaviour, it
is correct, and it should be expected rather than treated as a regression.

**Every refusal is a conversation handle, not a number.** 153 `@lid` rows across
four columns, and 22 rows that are an email address in a column named
`lead_email`. Refusing them changes nothing that works today, because nothing
today derives a phone from them — `identity.js` already namespaces LIDs as
`lid:` precisely so they cannot collide with a phone. What changes is that
anything which tries to in future gets a reason code instead of a plausible
fourteen-digit number.

### 5.2 Code paths that would have to change

| file | what it does now | what breaks |
|---|---|---|
| `apps/marketing-site/api/lead.js:78-86` | `toE164` guesses `+971` on `0?5\d{8}`; passes a `+`-prefixed device-suffixed value through unchanged | **guesses a country code.** A Saudi visitor typing `05…` gets a UAE number. Must delegate to `nexus_normalize_phone` and return `contact_required` on a non-`NORMALISED` verdict, exactly as it already does for an absent phone |
| `ops/n8n-meta-lead-ads/normalize-and-redact.node.js:133-142` | same `toE164`, plus an India branch | same guess. Already emits `phone_unparseable` on failure (line 238) — that field becomes the reason code instead of the raw string |
| `ops/n8n-google-lead-form/verify-and-redact.node.js:196-205` | same `toE164` | same guess; same `phone_unparseable` field at line 259 |
| `apps/executive-dashboard/lib/identity.js:66-71` `phoneSuffix` | takes the last nine of `digitsOf(v)` with **no device-suffix split** | a `############:##` value yields the wrong nine digits. One production row is affected. `digitsOf` needs the `split_part(…, ':', 1)` step in front of it |
| `apps/executive-dashboard/lib/identity.js` `keyShape` | a bare value is `PHONE` at `digitsOf(raw).length >= 5` | five digits is not a phone number by any rule in §3.3. This is a *display* threshold, not an identity one, so it can stay — but it must not feed a send |
| `n8n-workflows/nexus_master_lead_router_ai_agent.json`, `Persist Lead (deterministic)` | mints `'+' + digits + '@whatsapp.lead'` | this is the exact `'+' || digits` construction §1.4 proves unsafe. It must build the key from the `NORMALISED` output or not build one at all |
| `public.nexus_request_send(p_tenant_id, p_customer_external_id, …)` | takes the send address as free text | **there is no CHECK on `channel_send_directive.customer_external_id`** — verified, zero constraints mention it. The send door will currently accept a fourteen-digit device-suffixed string as an address |
| `public.channel_message_events.customer_phone` | `CHECK (customer_phone ~ '^[0-9]{6,20}$')` | a **third** phone format in one database: bare digits, 6 to 20. It accepts 16–20 digits that E.164 forbids and 6–7 that `nexus_lead_normalized_defect` forbids, and it accepts the device-suffixed 14. Empty today, so this is cheap to fix now and expensive later |
| `public.whatsapp_opt_in_event.customer_wa_id` | `CHECK` only that it is lowercase, trimmed, 1–120 chars | a **fourth** spelling, with no shape rule at all. The consent ledger can hold a `@lid`, a device-suffixed number or free text. Empty today |

### 5.3 Code paths that assume a phone is always present

These are already correct and are listed so they are not "fixed" by mistake.

- `nexus_lead_normalized_defect` requires **email or phone**, not phone. A lead
  with a refused phone and a good email is still a lead.
- `apps/executive-dashboard/screens/automation.js:904-907` already renders three
  distinct "no phone" states in words rather than a dash.
- `apps/executive-dashboard/screens/campaigns.js:962-970` already distinguishes
  "the lead row carries no phone" from "no lead row matches this address".
- `apps/executive-dashboard/screens/ask.js:1743` renders `— no phone on the lead`.

**What none of them have is a fourth state: a phone is present and is not
usable.** That state does not exist today because nothing refuses anything.

### 5.4 What the dashboard should show

Where a number is unusable, the dashboard must say which of three things is true,
because they have different remedies:

| state | what the cell should say | who can fix it |
|---|---|---|
| no phone recorded | *No phone on the lead record* — the existing wording | whoever took the enquiry |
| `HELD_FOR_REVIEW` | *A number was given but no country. NEXUS will not guess one, so it cannot be dialled or messaged from here.* Show the digits as stored, in `mono`, marked unverified | a salesperson who knows where the lead came from |
| `REFUSED` | *This is a WhatsApp chat handle, not a phone number* (or the reason code's plain-language form) | nobody — the value was never a number |

**Never render a refused value as if it were dialable, and never render it as
blank.** A blank cell says "we do not have their number", which is a different
and less actionable statement than "we have something and it is not a number".
That distinction is the one the repo has already made seven times under the name
*unknown rendered as none*.

The count belongs on `v_lead_recovery_coverage`, next to
`unresolved_whatsapp_handles`, as `leads_with_an_unusable_phone` — so that a
dealership sees the size of the problem rather than discovering it one card at a
time.

---

## 6. The identity consequence

**If a phone cannot be normalised, the customer cannot be matched on it.** That
is not a limitation to work around. It is the true state of the data, and every
option for hiding it is worse.

**What NEXUS must not do.**

- **Never invent a number.** Not by adding a country code, not by padding, not by
  taking the last nine digits of something and calling the rest zero. §1.5 shows
  the current code inventing a UAE number from ten digits that a Saudi customer
  is just as likely to have typed.
- **Never fall back to `push_name`.** It is a display string the sender controls
  and changes; `SPEC.md` §5.4 records one contact in the window whose
  `push_name` is `._`. Matching on it merges strangers and splits one person into
  many, invisibly.
- **Never fall back to the `@lid`.** A LID identifies a conversation, which is a
  legitimate thing to file messages under, and it is not a person and not an
  address. Using it as a customer identity is how one person's nine messages ended
  up split across two keys in one week (`SPEC.md` §1.1).
- **Never silently drop the value.** A dropped phone becomes a lead that looks
  like it never had one, and nobody goes looking.

**What NEXUS does instead.**

1. The event is still recorded. A refused phone does not lose the enquiry —
   `nexus_record_lead_event` accepts an event with no normalised object at all,
   and that is the correct shape here.
2. The verdict and reason code are stored alongside the raw value, so the row
   says *what arrived* and *why it was not used*.
3. If the lead has a usable email, it is promoted on the email and the phone is
   marked unusable on the card. `nexus_lead_normalized_defect` requires one of
   the two, not both.
4. If it has neither, it is **not** promoted to `public.leads`. It is retained as
   a `RECEIVED` event with a stated reason, which is exactly the treatment
   `20260907190000` already gives an event that fails the contract.
5. No automated message is sent. No identity match is attempted. No CRM card is
   created that a salesperson will call and reach nobody.

**The human-visible outcome, stated plainly.** A salesperson opens the lead and
sees: *an enquiry arrived, here is what they said, here is what they typed where
a phone number goes, and NEXUS will not guess what country it is in.* They know
the source. They can ask. They fix it in one edit and the lead becomes reachable.

That is one extra click, on the small number of enquiries whose number is
genuinely ambiguous. The alternative — which is what production does today — is a
lead card carrying a confident, dialable, wrong number, which costs a real
customer who is never contacted **and** a stranger who is messaged by a car
dealership they have never heard of. In a UAE-first product being sold to a
second dealership in another country, that second cost is the one that ends a
subscription.

Missing data is a question. Wrong data is an answer nobody checked.

---

## Unknowns

1. **The 8-digit floor is inherited, not derived.** §3.1 keeps
   `nexus_lead_normalized_defect`'s `{7,14}` so that nothing this function emits
   is refused downstream. E.164 sets no global minimum and genuine 7-digit
   international numbers exist. Whether NEXUS should relax the floor, and where
   else that would have to change, is not decided here.
2. **Whether `HELD_FOR_REVIEW` needs a home.** These rules produce the verdict.
   No table on production has a column to store it, and no screen shows it.
   Adding a column to `public.leads` fires `nexus_guard_born_open_grants()` and
   strips the dashboard's write grants — `CLAUDE.md` has the worked route around
   it. Where the verdict lives is an open design question, not a detail.
3. **`00` is stripped; `011` and `0011` are not.** `00` is the ITU-T E.123
   recommended international prefix and is treated as notation. The USA dials
   `011`, Japan `010`, Australia `0011`. A number written `011971…` falls to
   `HELD_FOR_REVIEW` rather than normalising. That is deliberately conservative
   and it is **asserted**, not measured — no such value exists on production.
4. **Arabic-Indic and Eastern Arabic numerals are refused as `PHONE_NO_DIGITS`.**
   In a UAE-first product a customer typing `٠٥٠…` is entirely plausible. The
   refusal is safe; the reason code is misleading, and transliterating the digits
   is a transformation these rules would otherwise forbid. Not decided.
5. **`p_transport` is a claim nothing verifies.** §3.5. If a caller declares
   `whatsapp_jid` for a value that is not a jid, this function produces a
   confident wrong number. Whether the transport should instead be derived from
   the endpoint registration — which the caller cannot forge — is the safer shape
   and is not designed here.
6. **The repeated-digit refusal is a judgement, not a standard.**
   `+111111111111` is refused as implausible. Nothing in E.164 forbids it. It is
   in because placeholder numbers of that shape are common in forms, and it is
   flagged here because it is the one rule in §3.3 that is opinion.
7. **Three phone formats coexist and this document only fixes one.**
   `normalized.phone_e164` (`+` and 8–15 digits),
   `channel_message_events.customer_phone` (bare, 6–20 digits) and
   `whatsapp_opt_in_event.customer_wa_id` (no shape rule) are three different
   contracts for one fact. Both of the latter tables are empty, so reconciling
   them costs nothing today. It is not proposed here because it is a schema
   change and this file is a rules file.
8. **`nexus_request_send` has no address constraint.** Verified: zero CHECK
   constraints on `channel_send_directive.customer_external_id`. Whether the send
   door should refuse an address that is not a `NORMALISED` output is the single
   highest-value follow-on from this document, and it is a change to a shipped
   function, so it is named rather than made.
9. **Every measurement here is one tenant.** Production holds one active
   dealership. Two country codes appear. A dealership in Saudi Arabia, India or
   the UK will produce shapes this file has never seen, and the rules are written
   to refuse an unfamiliar shape rather than to assume it resembles the eleven
   numbers currently on production.
10. **`whatsapp_contacts.phone` has never been checked against the sender.** The
    normalisation is only as good as the value WAHA filed. `SPEC.md` §5.5 records
    that one chat in the window has no contact row at all, so the upsert is not
    reliably firing. A correctly normalised number taken from an unreliably
    populated column is still an unreliable number, and no rule in this file
    changes that.
