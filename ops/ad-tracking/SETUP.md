# Ad tracking: the 12 things only Ali can do

The code is in place and **inert**. Every tracking id lives in a `<meta>` tag in
`apps/marketing-site/index.html`, is regex-checked before anything loads, and an
empty or malformed value loads **nothing at all** — no script, no cookie, no
network call. Nothing below can be done by an agent: these are values that exist
only inside Ali's Meta and Google accounts.

Fill these five, redeploy, and the site starts reporting conversions:

```html
<meta name="nexus:meta-pixel-id"             content="">   <!-- step 1  -->
<meta name="nexus:google-ads-id"             content="">   <!-- step 8  -->
<meta name="nexus:google-ads-lead-label"     content="">   <!-- step 8  -->
<meta name="nexus:google-ads-whatsapp-label" content="">   <!-- step 9  -->
<meta name="nexus:ga4-id"                    content="">   <!-- step 11 -->
```

All five are **public identifiers** — they ship in the page source of every site
that uses them. None is a secret. No access token, App Secret or developer token
goes anywhere near this file, and none is needed for any step below.

---

## Meta first

**1. Get the Pixel ID.**
Meta Events Manager → **Data sources** → your pixel → **Settings**. The field is
labelled **Dataset ID** (Meta renamed Pixel ID to Dataset ID; it is the same
number). It is 15–16 digits. If no pixel exists: **Connect data sources → Web →
Meta Pixel → Connect**, name it `NEXUS site`, enter
`nexus-for-autodealers.vercel.app`, and choose **Install code manually** — do
not accept the Partner Integration or the automatic install, both of which
install a second pixel on top of this one.

**2. Switch OFF Automatic Advanced Matching.**
Same page → **Settings** → **Automatic advanced matching** → toggle **off**.
Left on, Meta reads the name and phone number out of the enquiry form and sends
them, hashed, to Meta. Hashed is still personal data, the privacy policy says it
does not happen, and no one consented to it. The page also disables it in code
(`fbq('set','autoConfig',false,…)`), but the account-side toggle is what Meta
actually honours over time.

**3. Paste the Pixel ID and deploy.**
Put the number from step 1 into `content=""` on
`<meta name="nexus:meta-pixel-id">` in `apps/marketing-site/index.html`. Deploy.
Nothing else in the file changes.

**4. Prove the Pixel fires.**
Events Manager → your pixel → **Test events** → paste
`https://nexus-for-autodealers.vercel.app/` into **Test browser events** and
open it. You must see **PageView**. Then submit a real test enquiry on the page
and you must see **Lead**. If you see PageView but never Lead: the form returned
an error, not a 200 — the Lead event deliberately fires only on a stored
enquiry.

**5. Put the UTM string on the ad.**
Ads Manager → **Ad level** → **Destination → Website URL**:
`https://nexus-for-autodealers.vercel.app/`
Then the **URL parameters** field directly underneath (not the Website URL
field) — paste exactly:

```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_id={{ad.id}}
```

Meta appends `fbclid` itself. Every one of these keys is on the allowlist in
`api/lead.js`; anything not on that list is dropped at the server and will not
appear in the database.

**6. Tell the campaign to buy Leads, not clicks.**
Ads Manager → Campaign → objective **Leads** → Ad set → **Conversion location:
Website** → **Performance goal: Maximise number of conversions** → **Pixel:**
your pixel → **Conversion event: Lead**. Until step 4 has actually recorded a
Lead, `Lead` will not be selectable in this dropdown — that is the ordering
constraint that makes this step last on the Meta side.

## Google second

**7. Create the enquiry conversion action.**
Google Ads → **Goals → Conversions → Summary** → **+ New conversion action** →
**Website** → enter `nexus-for-autodealers.vercel.app` → **Scan** →
**+ Add a conversion action manually**. Set: **Goal and action optimisation** =
`Submit lead form`; **Conversion name** = `NEXUS enquiry (form)`; **Value** =
*Don't use a value*; **Count** = *One*; **Click-through conversion window** = 30
days. Save.

**8. Copy the conversion ID and the label.**
On that conversion action → **Tag setup** → **Use Google tag** → **Install the
tag yourself**. The event snippet shown contains one line that looks like:
`'send_to': 'AW-123456789/AbC-dEfGhIjKl'`. The part **before** the slash
(`AW-…`) goes in `nexus:google-ads-id`. The part **after** the slash goes in
`nexus:google-ads-lead-label`. Copy nothing else from that snippet — the page
already contains the loader.

**9. Create the second conversion action, for WhatsApp clicks.**
Repeat step 7 with: **Goal** = `Contact`; **Name** = `NEXUS WhatsApp click`;
**Value** = *Don't use a value*; **Count** = *One*. Take its label from its own
Tag setup page into `nexus:google-ads-whatsapp-label`. Then set this one to
**Secondary** (Goals → Conversions → the action → **Use for optimisation:
off**). A WhatsApp click is intent to talk, not an enquiry; bidding must train
on step 7's action, and this one is there to be counted, not chased.

**10. Turn Enhanced conversions OFF, and auto-tagging ON.**
Same **Tag setup** page on *both* conversion actions → **Enhanced conversions
for leads** → **off**. Enhanced conversions works by sending the email and
phone the visitor typed, hashed, to Google — same objection as step 2. Then
**Admin → Account settings → Auto-tagging** → **on**. Auto-tagging is what puts
`gclid` on the landing URL; without it no Google click can ever be joined to a
row in the database. Finally, Campaign → **Settings → Campaign URL options →
Final URL suffix**, paste:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}
```

**11. (Optional, free) GA4 measurement ID.**
Google Analytics → **Admin → Data streams → Web → Add stream** → URL
`https://nexus-for-autodealers.vercel.app`, stream name `NEXUS site`. The
**Measurement ID** (`G-XXXXXXXXXX`) is on the stream's detail panel top-right.
Paste into `nexus:ga4-id`. It costs nothing, loads no extra script — the same
`gtag.js` already loaded for Google Ads carries it — and it is the only way to
see how far down the page people get before they leave. Skip it and everything
else still works.

**12. Paste, deploy, and verify all three before spending.**
Put the values from steps 8, 9 and 11 into the meta tags, deploy, then:
(a) install **Google Tag Assistant** and load the site — it must list the `AW-`
tag, and after a test enquiry it must show a `conversion` event;
(b) Meta **Events Manager → Test events** must show `Lead` for the same
submission;
(c) run the database check in `WHAT-IS-NOT-MEASURED.md` and confirm the test row
carries `gclid` and `fbclid`. Google Ads will show the conversion action as
*Unverified* / *No recent conversions* for up to 24 hours after the first real
conversion — that delay is Google's, not a fault.

---

## The UTM scheme, in one place

| key | Meta value | Google value | why |
|---|---|---|---|
| `utm_source` | `meta` | `google` | which platform |
| `utm_medium` | `paid_social` | `cpc` | paid vs organic, at a glance |
| `utm_campaign` | `{{campaign.name}}` | `{campaignid}` | which campaign |
| `utm_content` | `{{ad.name}}` | `{creative}` | which creative |
| `utm_term` | `{{adset.name}}` | `{keyword}` | which audience / keyword |
| `utm_id` | `{{ad.id}}` | — | stable ad id, survives renames |
| `fbclid` / `gclid` | added automatically | added by auto-tagging | click-level join |
| `wbraid` / `gbraid` | — | added automatically on iOS | iOS clicks where `gclid` is absent |

`utm_id`, `wbraid` and `gbraid` were added to the allowlist in **both**
`index.html` and `api/lead.js` as part of this work. `referrer` and
`landing_path` are added by the page itself. **Never put a name, phone number or
email in a URL parameter** — a query string is written into browser history,
into server logs, and into the referrer header sent to the next site.
