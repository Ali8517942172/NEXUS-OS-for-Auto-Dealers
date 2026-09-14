# Onboarding a dealership onto WhatsApp Cloud — the 45-minute runbook

Who does what: **the dealer does every step inside their own Meta account.**
NEXUS never holds a Meta asset and never needs a trade licence for this.
Why this path: `ops/ADR-004-how-a-dealer-gets-on-whatsapp-without-our-licence.md`.

**Sit with them. Do not send this as a PDF.** The first three dealers should be
done over a screen-share, because every rejection Meta issues is worded badly and
you will learn more from watching them get stuck than from any doc.

---

## What the dealer must have before you start

- A trade licence (they have one — they sell cars)
- A phone number **not currently on WhatsApp**, or one they are willing to delete
  from the WhatsApp app first. A number already on consumer WhatsApp cannot be
  registered on Cloud API until it is removed from the app.
- Access to that number for an SMS or voice OTP
- A business email on their own domain (not gmail) — makes verification smoother

---

## Their steps, in their account

1. **business.facebook.com** → create a Business portfolio with the dealership's
   real legal name, exactly as it appears on the trade licence.
2. **developers.facebook.com** → Create App → type **Business** → link it to that
   portfolio → add the **WhatsApp** product.
3. WhatsApp → **Add phone number**, verify by OTP, set the display name to the
   dealership's trading name.
4. **System user token** — Business settings → Users → System users → add one
   with **Admin** role → Generate token on their app → tick
   `whatsapp_business_messaging` and `whatsapp_business_management` → choose
   **never expires**.
5. **App secret** — App settings → Basic → App Secret → Show.
6. **Business Verification** — Business settings → Security Centre → Start
   verification. Trade licence + address + a phone or domain check. **Start this
   on day one and carry on without it** — see the ceiling below.

## Your steps, in NEXUS

7. Register the channel:

```sql
insert into public.channel_registry
  (tenant_id, channel_type, external_identifier, credential_ref, status)
values (:dealer_tenant_id, 'whatsapp_cloud_phone_number_id',
        :their_phone_number_id, 'vault:channel_secret', 'active');
```

8. **Let the dealer paste their own values.** Turn the laptop round; do not read
   them out, do not put them in chat, do not keep a copy:

```sql
select * from public.nexus_channel_secret_put(
  :integration_id, 'meta_app_secret',        '<they paste>', 'onboarding');
select * from public.nexus_channel_secret_put(
  :integration_id, 'meta_system_user_token', '<they paste>', 'onboarding');
select * from public.nexus_channel_secret_put(
  :integration_id, 'meta_verify_token',      '<they paste>', 'onboarding');
```

Each call returns an 8-character fingerprint. **Write those three down** — they
are how you confirm later that the right credential is installed without anyone
looking at it again.

9. **Webhook** — in their app: Callback URL `https://35.224.126.225.nip.io/webhook/whatsapp-cloud`,
   Verify Token = the one from step 8, subscribe the **`messages`** field.
10. **Subscribe the WABA to their app.** This is the step that is easy to skip and
    it silently breaks everything — a week was lost to exactly this once, with a
    green tick showing on every screen. Confirm with:
    `GET /v23.0/<waba_id>/subscribed_apps` and check **their** app id is in the
    list.
11. Check readiness: `select * from public.nexus_meta_onboarding_status();` —
    all three kinds must read `INSTALLED` with the fingerprints from step 8.
12. **Send one real message from a real phone** and confirm a row lands in
    `channel_message_events` with `origin_verified = hmac_sha256_x_hub`.
    **Registered is not connected. Connected is not received.** Only that row
    means it works.

---

## The ceiling, stated honestly to the dealer

| | unique customers per rolling 24h |
|---|---|
| unverified | **250** |
| verified | 1,000 → 10,000 → 100,000 → unlimited, as quality allows |

Tell them this up front. 250 is far more than a showroom's daily conversation
volume, so it does not block the trial — but a dealer who finds out about a limit
from an error message instead of from you stops trusting the rest of what you say.

---

## Before you run this for real

**Step 8 does not work end to end yet.** The receiver still reads one global
`$env.META_APP_SECRET`; it does not call `nexus_channel_secret_reveal()` (FACT-169).
The storage is built and proven, the wiring is not. **Dealer #2 will be refused
until that change ships.** Do not book a second onboarding before it does.
