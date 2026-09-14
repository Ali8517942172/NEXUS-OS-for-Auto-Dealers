# ADR-004 — How a dealer gets on WhatsApp before NEXUS has a trade licence

**Date:** 14 September 2026
**Status:** ACCEPTED
**Constraint it answers:** NEXUS has no UAE trade licence and will not buy one for
2–3 months, but must onboard pilot dealers onto Meta WhatsApp Cloud API now for
a one-month free trial that converts to subscription.

## The two ways onto Cloud API

| | **A. Tech Provider / Embedded Signup** | **B. Dealer brings their own app (BYO)** |
|---|---|---|
| Who owns the Meta app | NEXUS | the dealership |
| Who owns the WABA + number | the dealership, connected through NEXUS | the dealership |
| **Whose business must be verified** | **NEXUS's** | **the dealership's** |
| App Review needed | yes — Advanced access on `whatsapp_business_messaging` + `whatsapp_business_management`, with video evidence | **no** — every asset belongs to one business, so Standard access is enough |
| Dealer's onboarding effort | one click | ~45 minutes, guided |
| Available to NEXUS today | **NO** — requires a verified business | **YES** |

Meta's own Tech Provider guide is explicit: *"Your business must be verified
before you can start the app review process."* That sentence is the whole reason
path A is closed today, and it is also the whole reason path B exists.

**Decision: path B for the pilot. Path A becomes a migration, not a rewrite,
once the trade licence exists.**

## What the dealer needs — and already has

A UAE used-car dealership has a trade licence, a business address and a website.
Those are exactly what Meta Business Verification asks for. **The verification
NEXUS cannot do, the dealer can do easily, and they are the ones who should:
it is their number, their customers, and their brand on the message.**

Unverified, a dealer can still message **up to 250 unique customers in a rolling
24 hours** with full API functionality — templates, automation, campaigns. For a
pilot dealership that is not a constraint at all; it is more conversations than
a showroom has in a week. Verification raises the ceiling to 1K → 10K →
100K → unlimited. So a dealer can start **the same day** and verify in parallel.

## What this costs NEXUS, honestly

- **Onboarding is ~45 minutes of hand-holding per dealer, not one click.** At 5–10
  pilot dealers that is fine. At 50 it is a bottleneck, and that is the moment
  path A pays for itself.
- **NEXUS must hold each dealer's credentials.** That is a real responsibility and
  it is what NX930 is for.
- **No Meta asset belongs to NEXUS.** If a dealer leaves, they keep their number
  and their WABA and simply revoke the token. That is a fair deal and it is
  easier to sell than the alternative.

## The engineering blocker this exposed — and it was bigger than the licence

The Cloud receiver verified the X-Hub signature against a single
`$env.META_APP_SECRET` on the n8n box, and `channel_registry` could only point at
it (`credential_ref = 'env:META_APP_SECRET+META_WA_TOKEN'`). **One box, one app
secret.** Dealer #2 arrives with their own Meta app, their webhook is signed with
a different secret, and the receiver refuses it — correctly, and fatally.

So *as built, NEXUS could serve exactly one dealership on WhatsApp Cloud.* Not a
policy problem, not a licence problem. A per-tenant credential problem.

NX930 closes it: `channel_secret` holds one pointer and one fingerprint per
dealership per credential kind; the values live in Supabase Vault, encrypted at
rest, on the free tier. The receiver resolves them per webhook by
`phone_number_id`, which Meta puts in every payload and which
`channel_registry.external_identifier` already carries.

Three properties worth stating plainly:

1. **NEXUS stores no plaintext credential anywhere**, and nothing in the schema
   can print one. Only `nexus_channel_secret_reveal()` decrypts, it is
   `service_role`-only, and **it writes an audit row on every single call.**
2. **A fingerprint answers "is the right secret installed?" without showing the
   secret.** Eight hex characters — enough to tell two apart, not enough to be
   one.
3. **Unknown `phone_number_id` fails closed with a named reason**, not a silent
   null. "Refused with no reason" is what cost a week on this channel already.

## Commercial shape of the trial

The free trial is technically clean under path B: the dealer's own Meta account
carries their own Cloud API usage, so **NEXUS incurs no per-message cost and
needs no billing relationship to run the trial.** That is what makes a one-month
free trial affordable with zero revenue.

Subscription billing at the end of the trial is a different question and it does
need the licence — invoicing a UAE business without one is not something to
improvise. **Plan the trial to end after the licence lands, not before.** If a
dealer wants to pay earlier than that, take the conversation, not the money.

*Not legal advice — this records an engineering decision and the constraint it
was made under, not a view on UAE company law.*
