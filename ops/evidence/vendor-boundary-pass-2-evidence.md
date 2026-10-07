# Vendor boundary — pass 2

Written 5 September 2026, against `apps/executive-dashboard` on branch
`wip/platform-truth-2026-09-01`. **Repo only.** No git command was run, the
production n8n box (35.224.126.225) was not touched, and the database was not
read or written. `QUALITY_GATE.mjs` was read and **not edited**.

Picks up the three items `/home/claude/out/control-plane-frontend-evidence.md`
§2d recorded as found-but-not-fixed, plus a sweep.

---

## 0. Method — measured, not read

The first pass found its worst leak (`compliance.js` printing the VM's public IP
out of `audit_log.summary`) by **rendering** rather than by reading. Its harness
was a throwaway and is gone, so this pass rebuilt one and extended it.

`vendor-probe.mjs` (scratchpad, **outside the repo**, deleted from nothing
because it was never in it) serves `dist/` to headless Chromium, stubs
PostgREST using **QUALITY_GATE.mjs's own embedded schema snapshot and `VALUE`
map** — extracted by the gate's own `NEXUS-SCHEMA-SNAPSHOT` markers so the two
cannot drift — walks all 20 screens plus the boot card, and captures:

- `innerText` of `#screen`, and
- **every rendered attribute a user can see**: `title`, `aria-label`,
  `placeholder`, `alt`, `data-tip`.

That second half is the extension, and it earned its place: four of the five
`WAHA` leaks in `conversations.js` were in `title=` tooltips, which an
`innerText`-only probe cannot see.

Two rows are seeded to be deliberately vendor-leaking so the redactors are
exercised rather than assumed:

    audit_log.summary  = "Scrape failed · Failed at node: Model Ladder · Execution 3213 ·
                          https://35.224.126.225.nip.io/workflow/BiyHk9ZXxJUVGbf6/executions/3213"
    campaign detail    = "Resend credential \"NEXUS Resend\" is not connected · node: Send Email ·
                          401 from api.resend.com"

### Measured, start and end

| | screens | page errors | rendered vendor findings |
|---|---|---|---|
| **Before** (same harness, unmodified tree) | 21 | 0 | **216** |
| **After** | 21 | 0 | **0** of the classes in scope |

Baseline by class: 164 table/view names · 14 SCREAMING tokens · 9 Bitrix ·
8 Resend · 6 n8n · 4 service-role · 3 `leads.<col>` · 3 Supabase · 2 WAHA ·
2 `crm.*` · 1 Postgres.

A **widened** final run (adding bare column names and the generic words
`table`, `view`, `column`, `webhook`, `credential`, `schema`, `endpoint`)
returns **148 findings, all of the generic-word class** — no identifier, no
supplier, no host, no execution id, no environment variable. That residue is
characterised honestly in §6; it is a different and smaller problem.

**The probe is not the gate.** Its stub answers 200 to everything and does not
validate columns, so it cannot see a broken query. `QUALITY_GATE.mjs` R3 can,
and did — see §5.

---

## 1. The vocabulary decision, and where it lives

**`apps/executive-dashboard/lib/vocabulary.js` (new file).** One place. It
holds:

| export | what it is |
|---|---|
| `SUPPLIER_NAMES` | every supplier NEXUS buys, rents or self-hosts — the names that must never render |
| `CHANNEL` / `channelName()` | what the dealership calls the road a message travelled |
| `TERM` | the map from **our identifier** to **their noun**, keyed on the real relation and column names so a reader can grep from a migration to here and back |
| `term(id)` | lookup; an unknown identifier returns a deliberately vague noun **rather than the identifier**, so the failure mode is vague-but-safe |
| `dealerText(text)` | the one redactor over free text we did not write |
| `plain(text)` | `dealerText` plus identifier mapping, for text that may quote a column or a constraint |
| `auditRendered(where, text)` | dev-only warning; folded out of production by `import.meta.env.DEV` |

### The rule it records

> Where a name genuinely helps the reader, use the **ordinary English word** for
> the thing: a screen about their leads says "leads", because that is a
> dealership's word too and happens also to be our table name. Where the
> identifier is a table name inside an error, a tooltip or a diagnostic, it
> should not be there at all.

So `leads → leads` and `inventory → stock` are not exceptions to the rule, they
are the rule. `v_revenue_recovery → the recovered-revenue figures` and
`channel_message_events → the delivery record` are the same rule pointing the
other way.

**One entry is a subject, not a noun, and deliberately.** `v_conversations →
NEXUS`. Nine screens said things like *"v_conversations resolved no lead for
this thread"* — the view was the **actor**. "The conversation record resolved no
lead" would be grammatical and wrong: it puts agency in a record.

**Two names are deliberately ABSENT from `SUPPLIER_NAMES`.** `Slack` and `Meta`
are not suppliers from the dealership's side — the team reads the Slack channel
NEXUS posts hot leads into, and the WhatsApp Business account whose rules the
policy engine applies is theirs. Naming either tells them about their own thing.
Recorded in the file so the next pass does not "fix" it.

### How the existing screens were brought onto it

~250 rendered occurrences across 20 screens, woven into prose whose whole style
is naming its own source. Migrated by a **one-off source transform** driven by
that same table (a scratchpad script, not shipped) that rewrote **prose string
literals only** — never comments, never code, never a PostgREST path — followed
by a hand pass over the grammar it could not get right and over the sentences
where the identifier was load-bearing. **Source comments were left alone on
purpose**: a comment naming a view, a join or a supplier is the engineering
record this repo runs on and renders to nobody.

The screens now carry the dealership's words **directly**. `lib/vocabulary.js`
is therefore the register of the decision plus the runtime helpers — not a
filter every string passes through at render time.

---

## 2. Item 1 — WAHA and Bitrix24

### 2a. `screens/conversations.js` — WAHA, 5 rendered sites (4 of them tooltips)

| line (now) | was | is |
|---|---|---|
| `531` `IDENT.phone_only.note` | *"The number itself is real: it came from **WAHA's own contact lookup**, not from parsing the chat id."* | *"The number itself is real: **WhatsApp returned it for this contact**, rather than it being read out of the chat address."* |
| `584` `noChatWhy()` | *"…no chat_id is stored for it in **v_conversations**, so **WAHA** has no WhatsApp address to send to. Replying needs a **chat_id**, which only arrives when…"* | *"This thread is identified by "…" and **no WhatsApp address is on file for it**, so there is nothing here to send to. A WhatsApp address only arrives when the contact messages the business number."* |
| `894` `phoneHtml()` tooltip | *"Not stored in **v_conversations.phone** — **whatsapp_contacts** has no row for this thread on either of the joins the view makes, **chat_id** or **lead_email**… Nobody has verified that number against **WAHA** the way a **whatsapp_contacts** row has been."* | *"These digits are not from this contact's saved details — nothing is saved for this thread. They are read out of the thread's own identifier…, which NEXUS built from the number it was handed. **WhatsApp has never confirmed this number for this contact**, the way it has for a contact whose details are saved."* |
| `907` `chatHtml()` tooltip | *"**v_conversations.chat_id** — the WhatsApp address **WAHA** sends to (…)"* | *"The WhatsApp address **a reply to this thread goes to** (…)"* |
| `1894` phone-source footnote | *"**v_conversations.phone** comes from **whatsapp_contacts**, joined twice — on **chat_id** and on **lead_email**… it has not been through **WAHA's** contact lookup…"* + visible text *"read out of the thread key, not from **whatsapp_contacts**"* | *"A contact's number is normally taken from their saved details. Some threads have none saved — but their own identifier carries the number inside it… WhatsApp has not confirmed it for this contact the way it has for a saved one."* + *"read out of the thread's own identifier, not from saved contact details"* |

The state and the action survive in every one; only the transport's name and the
join mechanics are gone. Six further `WAHA` mentions in that file are **source
comments** and were left.

### 2b. `screens/campaigns.js` — WAHA

| line | was | is |
|---|---|---|
| `1197` | *"The day-1 and day-5 WhatsApp steps go out over **WAHA** and are unaffected"* | *"…go out over **a different channel** and are unaffected"* |

### 2c. `screens/automation.js` — WAHA

| line | was | is |
|---|---|---|
| `315` | *"…the operator is told at that moment whether the message actually **left WAHA**."* | *"…whether the message actually **went out**."* |

### 2d. `screens/customers.js` — Bitrix24 (9 rendered occurrences, one constant)

`BITRIX_NOTE` → `CRM_NOTE`. It named the CRM product four times in four
sentences, plus its API method family (`crm.*`) and the HTTP status its plan
returns.

**was**

> Read from **Supabase**, never from **Bitrix24**. **Bitrix's crm.\* read
> methods answer 403** on the dealership's current plan, so no customer record
> on this screen came from **Bitrix** and none can. Writes into **Bitrix** do
> succeed — leads raised and updated by the workflows reach it — so this is a
> plan restriction on reading, not a broken integration, and nothing here
> reflects what **Bitrix** itself holds.

**is**

> Every customer on this screen is NEXUS's own record. Nothing here was read
> back from your CRM, and nothing here can be: the sync runs one way only.
> Leads and updates NEXUS raises do reach your CRM, so the outward direction is
> working — but a record created or edited in the CRM itself will not appear on
> this screen, and this screen is not a picture of what the CRM holds.
> Restoring the inward direction is NEXUS's to arrange.

Both halves of the original position survive — that is the point the old comment
made and it was worth keeping. The row above it changed too:

| line | was | is |
|---|---|---|
| `1726` | `<dt>Source system</dt><dd>Supabase · not Bitrix24` | `<dt>Source system</dt><dd>NEXUS · not your CRM` |

### 2e. `screens/settings.js` — Bitrix24 in the ERP/CRM fault line

| line | was | is |
|---|---|---|
| `363` | *"On the current **Bitrix24 plan** writing is the only direction that works at all — **crm.\* reads answer 403** whatever credential is presented"* | *"Writing is the only direction that works at all — nothing is ever read back from the CRM"* |

### 2f. Sprinkled string literals replaced by `term()`

`screens/customers.js` carried five relation names as **data values** that were
then rendered — the exact pattern the brief names.

| line | was | is |
|---|---|---|
| `465-471` `phoneOf().from` | `'v_customer_directory'`, `'v_customer_360'`, `'customer_360_profiles'`, `'purchase_history'`, `'whatsapp_contacts'` — rendered as *"found on v_customer_directory"* | `term('v_customer_directory')` … `term('whatsapp_contacts')` |
| `641` `spineSource` | `'v_customer_directory'` — rendered three times | `term('v_customer_directory')` |

---

## 3. Item 2 — internal table and view names across ~20 screens

Rendered occurrences before: **164** across 19 screens. After: **0**.

### 3a. The map that was applied

| identifier | dealership's word |
|---|---|
| `v_conversations` | NEXUS *(a subject — see §1)* |
| `v_needs_attention` | the attention list |
| `v_workflow_health` | the automation health figures |
| `workflow_registry` | the automation register |
| `audit_log` | the activity log |
| `communication_logs` | the message history |
| `whatsapp_contacts` | the saved contact details |
| `v_customer_directory` | the customer list |
| `v_customer_360` | the customer record |
| `customer_360_profiles` | the customer profiles |
| `purchase_history` | the recorded sales |
| `finance_quotes` | the finance quotes |
| `kyc_documents` | the ID documents |
| `rag_documents` | your documents |
| `deals_embeddings` | the deal history |
| `v_competitor_latest` / `competitors` | the competitor listings |
| `v_team_performance` | the team figures |
| `v_attribution_link_map` | the links between actions and sales |
| `channel_message_events` | the delivery record |
| `v_revenue_recovery` | the recovered-revenue figures |
| `inventory_actions` | the recommended actions |
| `policy_rule` | the messaging rules |
| `tenant_members` | the account memberships |
| `users` | the accounts NEXUS holds for this dealership |
| `nexus_outcome_class()` | NEXUS's own rule for what a run achieved |
| `nexus_is_message()` | NEXUS's own test for what counts as a message |
| `leads` | **leads** *(unchanged — the ordinary word)* |
| `inventory` | **stock** |
| `chat_id` / `thread_key` / `lead_email` | WhatsApp address / the thread's identifier / the email on the lead record |
| `msg_count` / `message_count` / `outbound_count` / `awaiting_reply` / `last_msg_at` / `success_rate_30d` / `writes_audit_log` / `unanswered_chat` | the message-only count / the count of every row filed under a contact / the count of messages sent out / whether the newest message is theirs / the newest-message time / the success rate it publishes / whether it records its runs / the unanswered-chat alert |

Representative before/after:

| file:line | was | is |
|---|---|---|
| `conversations.js:502` | *"**v_conversations** matched this thread to a row in **the leads table** on an exact address"* | *"**NEXUS** matched this thread to a row in **your leads** on an exact address"* |
| `conversations.js:1361` | *"**v_needs_attention** could not be read (…), so whether anybody is…"* | *"**The attention list** could not be read (…), so whether anybody is…"* |
| `conversations.js:1647` | *"Its absence from **workflow_registry** is itself worth fixing."* | *"Its absence from **the automation register** is itself worth fixing."* |
| `team.js:1249` | *"Who exists comes from `users`; what they did comes from `v_team_performance`."* | *"Who exists comes from the accounts NEXUS holds for this dealership; what they did is measured from their own leads and replies."* |
| `settings.js:1428` | *"Success is successes ÷ the runs that counted, computed by **v_workflow_health** against **nexus_outcome_class()**."* | *"…computed once by **NEXUS** rather than by this screen."* |
| `finance.js:1481` | *"the column named LTV is not it. **finance_quotes.loan_to_value_pct** is the payoff on the customer's TRADE-IN"* | *"the figure labelled LTV on this desk is not it. That figure is the payoff on the customer's TRADE-IN"* |
| `actions.js:563` | *"has a real row in `public.audit_log` … not registered in `workflow_registry`: these are decisions taken by people in this dashboard, not **n8n runs**"* | *"is a real entry in the activity log … kept out of the automation register: these are decisions people took in this dashboard, not **automation runs**"* |
| `settings.js:1900` | *"Columns available: `id, doc_title, section, content, source_file, page_number, search_vector, tenant_id`"* | *"What NEXUS is storing for them is not what this panel needs, and only NEXUS can change that."* |
| `deals.js:743` | *"The recorded sales carries none of the columns that would link a deal to a car (looked for unit_id, inventory_id, …); the columns it does carry are amount_aed, created_at, …, tenant_id, vehicle."* | *"A recorded sale holds nothing that points at a vehicle in stock — no stock number, no VIN, no unit reference of any kind."* |

### 3b. Files changed by this item, by changed-line count

`conversations.js` 107 · `customers.js` 113 · `campaigns.js` 83 ·
`finance.js` 74 · `deals.js` 59 · `settings.js` 57 · `automation.js` 51 ·
`compliance.js` 44 · `overview.js` 37 · `ask.js` 31 · `leads.js` 25 ·
`competitors.js` 21 · `policy.js` 18 · `team.js` 16 · `actions.js` 9 ·
`lead-drawer.js` 9 · `attribution.js` 3 · `identity.js` 3 · `data.js` 2 ·
`health.js` 1 · `nav.js` 1 · `pipeline.js` 1 · `inventory.js` 1 ·
`revenue.js` 1 · `lead-recovery.js` 1.

---

## 4. Item 3 — `app.js`'s "Fix these in Vercel" boot card

**`app.js:124-152`.** Three things were wrong, and only the third is about a
vendor name.

**was**

```
Configuration problem
  VITE_SUPABASE_URL is empty.
  VITE_SUPABASE_ANON_KEY is only 12 characters; expected at least 40.
Fix these environment variables in Vercel, then redeploy.
```

**is**

```
[NEXUS OS]
⚠ NEXUS cannot start on this installation.
A setting NEXUS needs in order to reach your data was not supplied when this
dashboard was installed, so no screen would be able to load anything and none
is offered. Nothing has happened to your data, and nothing has been lost.
This is not something that can be corrected from this screen, from this
browser, or by signing in. Contact NEXUS support — the details they need are
already recorded.
```

The `envErrors` strings — which begin with the build-time variable name — now go
to `console.error` under a `[NEXUS]` prefix, where a support call can retrieve
them. They are not painted.

Why the other two faults mattered as much as the vendor name: this card renders
**before the login form**, so the reader may not be signed in or be a customer
at all; and it issued an instruction the reader cannot carry out, which on a
dead screen reads as *"you have broken this"*.

Two more on the same file, both found while there:

| file:line | was | is |
|---|---|---|
| `app.js:97` (login card) | *"Accounts are managed in **Supabase Auth**."* — on the one card that renders to a reader who is not signed in | *"Accounts are created by NEXUS. Ask NEXUS support to add one, or to reset a password."* The explanatory note was moved from an **HTML comment inside the template** to a JS comment: an HTML comment there ships into the page and is readable with View Source. |
| `app.js:196` (connection pill) | `esc(String(e.message).slice(0,40))` — the first 40 characters of whatever the data layer said, painted permanently into the header on every screen | `No connection`, with the dealership's half in `title=` and the diagnostic to `console.error` |

---

## 5. The sweep — what pass 1 and CONTROL-PLANE.md both missed

### 5a. One redactor, not three — and it stripped the wrong half

`screens/automation.js` (`dealerSummary`), `screens/compliance.js` and
`screens/campaigns.js` (`dealerText`) each carried their own byte-similar copy.
All three stripped **where** a run stopped — the URL, the node, the execution
id, the host — and left **who we buy from** standing in the sentence.

Proved by rendering the seeded campaign error: the Automation, Compliance and
Settings screens all printed

    Resend credential "NEXUS Resend" is not connected · 401 from api.resend.com

verbatim. The dealership learns which supplier NEXUS buys mail delivery from and
can act on none of it.

All three now import `dealerText` from `lib/vocabulary.js`. `automation.js`
keeps `EXEC_URL_RE` as a first step because it also **classifies** on that
match. Same string through the shared function now:

    connection is not working

`dealerText` gained four rules for this, in this order and for stated reasons:
the whole `credential "…"` clause first (replacing the supplier token alone
yields `the supplier credential "NEXUS the supplier"`, worse than either
original or nothing); then bare hostnames, because `api.resend.com` has no
`https://` for the URL rule to catch; then the status code that hangs off one,
so `401 from api.resend.com` does not leave a dangling *"401 from"*; then a
cleanup so `connection is not connected` does not ship.

### 5b. Suppliers CONTROL-PLANE.md Part 4 does not list

`Gmail` was named to the dealership **12 times** across `customers.js`,
`campaigns.js`, `settings.js` and `leads.js` — *"the workflow's Gmail node"*,
*"the Gmail credential was re-authorised"*, *"A Gmail send leaves no event
behind"*, *"the nightly Gmail aggregation"*, *"the Gmail refresh token"*. It is
in neither the document's table nor pass 1's. All rewritten to *the mail
connection* / *mail sent this way*. `Gmail`, `SendGrid`, `Postmark`, `Mailgun`,
`OpenAI` and `Anthropic` were added to `SUPPLIER_NAMES`.

### 5c. Internal module paths rendered as prose

Not an identifier class anyone had named. Seven sites named a source file of
NEXUS's own bundle **to the dealership**:

| file:line | was | is |
|---|---|---|
| `customers.js:227` | *"**lib/data.js** exposes no webhook for that job"* | *"There is no way to start that job from here"* |
| `customers.js:1514` | *"read here under **lib/comm-events.js** — this browser's mirror of…"* | *"read here under this browser's mirror of…"* |
| `overview.js:2294` | *"mirrored in **lib/comm-events.js** and applied here unchanged"* | *"mirrored in this browser and applied here unchanged"* |
| `overview.js:3009`, `settings.js:1294`, `settings.js:1302` | *"Nav badges are painted by **lib/badges.js** from one read…"* | *"Nav badges are painted from one read…"* |
| `settings.js:103` | *"**lib/prefs.js** exports **applyDensity()**, which reads the saved preference, but no setter"* | *"NEXUS can read a saved preference but nothing here can save one yet"* |
| `deals.js:174` | *"**unitForm()** in **lib/unit-form.js** is the only writer in the product"* | *"Stock is edited in one place only — the Inventory screen"* |
| `overview.js:2568` | *"signing a private-bucket file is possible now (**signedUrl** in **lib/data.js** mints a 60-second link), but **storage_path** is null on every row"* | *"this dashboard can open a stored document, but no archived file was ever recorded for any row in this list"* |

### 5d. Internal state tokens rendered raw

| file:line | was | is |
|---|---|---|
| `revenue.js:603` | `Lane health: PRODUCING_NOTHING` | `healthWords(H.health).label` → `Lane health: No output`. `lib/health.js` already held the reader's words for all eight states and every other screen used it; this one had a raw enum where the words were. An unrecognised value still falls through to `Unrecognised`, which is `healthWords`' own rule. |
| `lead-recovery.js:613` | `kpi('Desk health', 'PRODUCING_NOTHING')` | same fix |
| `attribution.js:265` | *"The link map returned no **CAMPAIGN_TO_LEAD** hop at all"* | *"Nothing at all is recorded about the step from a campaign to a lead"* |
| `policy.js` State column, Checked column, In force column | `NOT_VERIFIED`, `SUPERSEDED`, `DRAFT` … printed as the row label | new `VERIFICATION_LABEL` / `LIFECYCLE_LABEL` maps → `Not checked`, `Replaced`, `Draft`. **The verbatim principle that file is built on is intact**: a state nobody here has heard of still appears, still under its stored spelling, because a token with no entry falls through to itself. `pill(..., { verbatim })` — a claim about **provenance** — is now asserted only where the translation left the word unchanged. |
| `policy.js:678, :703, :315` | prose citing `VERIFIED`, `NOT_VERIFIED`, `ACTIVE`, `verification_status`, `status` | plain English (*"checked"*, *"in force"*) |

### 5e. Internal architecture described to the dealership

| file:line | was | is |
|---|---|---|
| `automation.js:1915` (Stop a run) | *"**HOOK in lib/data.js** is the complete list of endpoints… Stopping an execution is **POST /api/v1/executions/{id}/stop on n8n**, which needs an **N8N_API_KEY**"* | *"…stopping a run needs a credential that would have to be shipped into this browser to be used here, and anything shipped to a browser is public. Ask NEXUS support to stop a run."* |
| `automation.js:1938` (run confirm) | *"This posts to `/webhook/<hook>` with your **Supabase session token** attached."* | *"This starts `<workflow name>`, signed in as you."* |
| `competitors.js:1040` | *"No **webhook** exists for the price scrape. The **competitors table** is written by a scheduled workflow that has no manual trigger in the **HOOK map**"* | *"The competitor listings are collected on a schedule, and that job has no manual start… Ask NEXUS support if it needs running now."* |
| `automation.js:798` | *"moved off an **n8n** "every 24 hours" interval onto **cron 0 5 \* \* \***"* | *"moved off a rolling "every 24 hours" timer onto a fixed daily time — 05:00 UTC"* |
| `automation.js:649` `PARTIAL_NOTE` | *"A **Delivery Report node** writes **PARTIAL** … that correction is made in nexus_outcome_class() **in Postgres** … The activity log **has no dropped-steps column**"* | *"A run is recorded as partly landed when… that correction is made once, by NEXUS's own rule for what a run achieved… Which step it was is not recorded separately"* |
| `finance.js:1496,:1969,:2597,:2962,:1455` | five answers routing the reader to *"the n8n execution list"*, *"calculation_id and execution_id"* | *"NEXUS can trace one by hand from the time it was logged"* etc. |
| `compliance.js` ×5 | *"needs a **service-role job**"*, *"the private **kyc-documents bucket**"*, *"**Supabase Storage** confirmed the object was gone"*, *"files this row as **kyc_archive_gap**"* | *"is NEXUS's to do"*, *"NEXUS's private document store"*, *"the stored file was confirmed gone"*, *"files it as an archive gap"* |
| `overview.js` ×2, `campaigns.js`, `deals.js`, `settings.js` | *"service-role"*, *"service_role"* | *"NEXUS's to write"*, *"NEXUS's own closed-won automation"*, *"Keys, credentials and secrets"* |
| `leads.js:702,:1118` | *"written by a **Postgres trigger** on communication_logs"*, *"a clock-skew allowance between **n8n and Postgres**"* | *"measured by NEXUS at the moment a reply is recorded"*, *"an allowance for the two clocks involved disagreeing"* |
| `competitors.js:2342` | *"it orders **scraped_at DESC** and **Postgres sorts nulls first under DESC**"* | *"the newest-first ordering returned an undated one, because a row with no collection date sorts ahead of a dated one"* |
| `lib/data.js:331,:344` | *"**Supabase** is not configured in this build."*, *"**Storage** returned no URL for that path."* | *"This installation is not configured to reach your data. Only NEXUS can correct that."*, *"The stored file could not be opened."* |
| `conversations.js:1928` | *"**n8n host** not configured — sending is off"* | *"Sending is not available on this installation"* |
| `settings.js:535` | *"The **users table** has no **phone column**… that is a property of the **schema**"* | *"NEXUS holds no phone number for any member of staff — nowhere in the product is there a field for one"* |

### 5f. A credential's own name was the headline of a Settings card

`screens/settings.js` credential groups rendered `g.display` / `g.subject` built
from `g.name` — the credential's name **as the failing run wrote it**:
*"NEXUS Resend"*, *"Gmail OAuth2"*. That is the supplier, on a card whose own
**Reconnect button is disabled by design**.

Now derived from `g.channels`, which is computed from the same evidence and was
already shown in the sentence underneath: *"Email — connection failing"*,
subject *"The email connection"*.

**The name is not discarded.** It still keys the grouping, so two faults on one
channel stay two rows; and the alert key was moved from `g.display` to `g.name`
in the same edit, because `display` is now shared by every fault on a channel
and keying on it would have collapsed two broken connections into one alert.

---

## 6. The honest remainder

A widened final probe (adding the generic words) returns **148 findings, none of
them an identifier**: `view` 42 · `column` 39 · `table` 36 · `credential` 13 ·
`webhook` 10 · `schema` 4 · `endpoint` 4.

They are **mixed**, and the mixture is why this is reported rather than swept:

- Many are ordinary English and correct — *"This table does not update on its
  own"*, *"the Why column below"*, *"no column links a lead to a unit"*.
- Some are genuinely internal — *"the view's kyc_archive_gap branch applies a
  recency cut-off"* (`overview.js`), *"none names the **ask-ai** webhook in its
  trigger detail"* (`ask.js`), *"this engine is blocked on **schema** and
  integrations rather than on code"* (`revenue.js`, `deal-rescue.js`).

Separating those needs a judgement per sentence, not a map, and it is a
different pass from this one. Recorded, not claimed as done.

Also deliberately left:

- **`lib/errors.js` and `lib/states.js`** — another agent owns them; the first
  pass records them as fixed on 5 Sep. Read, not changed.
- **`plain('permission denied for table leads')` returns unchanged**, because
  `leads → leads` is the vocabulary rule working as designed. The word "table"
  in that sentence belongs to the `lib/errors.js` path.
- **`screens/team.js:1652` `'Resend invite'`** — a legitimate English verb that
  collides with a mail supplier. It is a screen literal and does not pass
  through `dealerText`, so it is unaffected. The collision is documented in
  `lib/vocabulary.js`: a workflow error saying *"Resend the invitation"* would
  render as *"the supplier the invitation"*, which is clumsy and survivable, and
  is the right way round.

---

## 7. Verification

| what | command | result |
|---|---|---|
| syntax | `node --check` on all 27 touched files | **27/27 OK** |
| build | `npm run build` (in `apps/executive-dashboard`) | **exit 0**, `✓ built in 2.29s`, `dist/assets/main-*.js 1,371 kB`. The two warnings (`lib/data.js is dynamically imported…`, 500 kB chunk note) are pre-existing and appear on an unmodified tree. |
| gate | `node QUALITY_GATE.mjs` (read, **never edited**) | **PASS 18, FAIL 0, WARN 1, NOT RUN 16** — identical to the board pass 1 reported. `exit 2` because 14 LIVE checks could not run without `NEXUS_DB_URL`, which the brief forbids. |
| render | `vendor-probe.mjs` against `dist/` + a schema-shaped PostgREST stub | 21 surfaces, **0 page errors**, **0 in-scope vendor findings** (from 216) |

The single WARN is **S5b**, `screens/actions.js:637`
(`s + (Number(r.engine_impact_aed) || 0)`) — pre-existing, in a line this pass
did not touch, and warning before it.

### No gate assertion was broken by wording

Checked deliberately, because several checks match on exact prose:

- **R7** greps for `STUB_REFUSAL_REASON` — *"This account is neither an account
  owner nor a manager, so it may not decide inventory actions."* It contains no
  identifier and comes from the stub, not from a screen literal. Untouched.
- **R2** greps `/Couldn.t load/`, produced by `lib/states.js`. Not touched.
- **R4** greps `AED 0` / `0.0%` — arithmetic, not wording.
- **S6** names five state columns (`holding_cost_state`, `net_margin_state`,
  `market_position`, `demand_signal`, `enquiry_coverage`). **None of the state
  tokens changed in §5d are in that set** — `health`, `verification_status` and
  the attribution hop kinds are outside it. S6 still passes with the same eight
  evidence lines.
- **S2/S3/S5/S9** match on constructs, PostgREST paths and column names, not on
  prose.

### The gate caught damage the render probe could not

This is worth recording because it decided the method. The source transform's
"is this a query?" test recognised `select=…` and bare single-word relation
names, but **not a column list held as its own constant** — `VIEW_COLS`,
`CONV_COLS`, `CONTACT_COLS`, `EV_COLS`, and continuation fragments of a
concatenated `select=`. Eight PostgREST paths were rewritten into prose.

The render probe reported **0 page errors** on that tree, because its stub
answers 200 to everything and never validates a column. `QUALITY_GATE.mjs`
**R3 failed with eight `400 42703` rejections** and **R2 failed on five
screens**. Restored from the pre-transform copies and verified by extracting
every `select=`/`COLS` string from both trees and diffing: **7/7 files match the
originals exactly**. R3 now passes, S3 validates 137 distinct PostgREST paths.

Two further self-inflicted faults, both caught and both worth naming:

- The transform's first tokeniser was not regex- or nested-template-aware. A
  regex like `/won't/` contains an apostrophe, and `` `${esc(`…endpoint's…`)}` ``
  closes the outer template early — either shifts every span after it by one
  quote. `screens/finance.js` stopped parsing with an object key `lead_email:`
  rewritten as prose. Fixed with a stack-based tokeniser plus a self-check that
  **refuses a file** when a `'`- or `"`-quoted span spans a newline (JavaScript
  forbids that, so it is proof of misalignment). `screens/ask.js` was refused by
  that check on the next run, which is how the nested-template bug was found.
- A **reporting** script built on the same function passed identity rules
  (`[t, t]`) to list occurrences — and the sentence-start capitaliser rewrote
  `n8n` to `N8n` and `v_customer_360` to `V_customer_360` in ~20 places,
  including inside `lib/vocabulary.js`'s own `SUPPLIER_NAMES` list. All restored;
  the function now takes `dryRun` and the reporting path uses it.

---

## 8. What I could NOT verify

**No browser was available against the live site.** Everything above is measured
against a hand-written stub. Stated plainly:

- **Nothing here is evidence about what a real signed-in Tenant A session
  renders today.** The stub's rows are fabricated from the gate's schema
  snapshot; live rows may carry vendor strings in shapes neither the redactors
  nor my probe's patterns match.
- **`dealerText` is a pattern match at the render site, not a fix at the
  writer.** A workflow that writes a supplier detail in some other shape will
  still print it. The right fix is upstream, in what the workflows log.
- **Visual layout was not checked at all.** Several replacements are
  substantially longer than what they replaced — the Settings credential card
  headline, the Compliance archive-gap sentences, the `CRM_NOTE` block. Nothing
  verified how they wrap, whether a card grew a scrollbar, or whether a tooltip
  now overflows.
- **Interaction states were not exercised.** The probe renders each screen's
  default state only: no drawer opened, no tab switched, no row clicked, no
  modal. Prose that renders only after an interaction — the run-confirm modal,
  the lead drawer, the KYC document drawer — was rewritten by reading, not by
  rendering. The `automation.js` run/stop tooltips and the confirm banner in §5e
  are in that category.
- **The live n8n box, the workflow definitions on it, and the database were not
  consulted.** In particular I did not check whether `workflow_registry` on
  production still holds the columns the Settings and Automation screens read,
  nor what real `audit_log.summary` text looks like today.
- **The 16 NOT RUN gate checks** are the LIVE lane and need `NEXUS_DB_URL`. A
  check that could not run is not a check that passed.
- **`npm run build` alone produces a bundle that cannot boot.** Without
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` the app paints the §4 boot card
  and returns before any screen renders. Two of my probe runs did this and
  reported a misleading "0 findings" until I noticed. The gate builds with the
  env contract satisfied (R0) and so must any render probe. Worth knowing before
  the next agent trusts a clean probe.
