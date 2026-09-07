# Moving WhatsApp off WAHA and onto the Cloud API — NOT DEPLOYED

Nothing in this directory is running. It is the receiver's hardest piece,
written and tested ahead of the rollout, plus the order the rollout has to
happen in and the one constraint that changes the plan.

## The constraint nobody had checked

Read from Meta Business Suite on 7 September 2026:

    WhatsApp account   "Ali Asgher"
    ID                 311007628770691
    Owned by           bharmalmarketing
    Type               WhatsApp Business app        <-- this is the finding
    Account status     Approved
    Payment method     none

**Type is "WhatsApp Business app", not Cloud API.** A phone number lives on one
or the other, never both. So `+971526647253` cannot be pointed at the Cloud API
while it is registered on the WhatsApp Business app — it has to be deleted from
that app first, which loses that app's chat history and is not a step you undo
in an afternoon. WAHA is driving the same number today, which makes it three
claims on one line.

That kills the obvious plan of "switch the number over and delete WAHA", and it
should be said out loud before anyone starts, because discovering it halfway
means the dealership's WhatsApp is down while it gets sorted.

**Do this instead.** Meta issues a free test number with every app. Build and
prove the entire pipeline on that number — it costs nothing, needs no
migration, needs no business verification, and `+971526647253` keeps working on
WAHA throughout. Decide the production number only once the pipeline is proven,
and then decide it deliberately: a new business line is usually the better
answer than migrating the number the owner answers personally.

Two limits of the test number, so nobody plans around a capability it lacks:
it will only message **recipients you have explicitly verified** (add
`+918517942172`), and its access token **expires in 24 hours**. A non-expiring
token needs a System User, which is a separate setup and is the owner's to
create.

## The signature verifier, and why it is here first

`verify-signature.mjs` is the single highest-risk piece of the receiver, so it
was written and tested before anything else.

Meta computes `X-Hub-Signature-256` over **the exact bytes it sent**, in an
escaped-unicode form. Parse the JSON and re-serialise it to hash it, and you
get different bytes — except, most of the time, for pure ASCII, where you get
the same bytes by luck.

`verify-signature.test.mjs` demonstrates that rather than asserting it:

| customer name | raw-bytes verifier | re-serialising verifier |
|---|---|---|
| `Ahmed` | accepts | **also accepts** |
| `محمد` | accepts | **rejects a genuine Meta delivery** |

So an ASCII-only test suite passes with the broken implementation and proves
nothing. In Dubai the Arabic name is not an edge case, it is Tuesday, and the
failure is silent: Meta's deliveries are refused, no error appears anywhere,
and the dealership simply stops receiving leads.

12 tests, all passing, including forgery, tampering, a `sha1=` prefix, a
truncated digest, uppercase hex, and passing a parsed object — which throws
rather than silently mis-verifying.

**The operational consequence for whatever hosts the receiver:** capture the
raw body as a Buffer *before* any JSON middleware. In n8n the webhook node must
be set to raw/binary body. A parsed body has already lost the bytes Meta
signed, and nothing downstream can recover them.

## Order of the rollout

Each step's precondition is the step before it, and none of the owner steps can
be done for him.

1. **Owner** — create a Meta app at `developers.facebook.com`, add the WhatsApp
   product. There is no app on that account today ("No apps yet", read 7 Sep).
2. **Owner** — note the test number's `phone_number_id`, and add
   `+918517942172` as a verified recipient.
3. **Build** — register the number in `channel_registry` under the
   `whatsapp_cloud_phone_number_id` namespace. That namespace exists and is
   empty. This is what makes the tenant come from **Meta's own
   `metadata.phone_number_id`** rather than from a caller-supplied string —
   the defect that makes the WAHA webhook dangerous.
4. **Build** — the receiver: verify the signature over raw bytes, and only
   then write anything.

   Nothing may be written before the signature verifies. The reason is not
   storage hygiene: claiming a `wamid` before verification is a **denial of
   service on a real customer**, because Meta's genuine delivery then looks
   like a duplicate and is dropped, and nothing appears broken.
5. **Owner** — the app secret and access token. Set as environment variables.
   Never in a workflow node, never in the repo.
6. **Prove** — a real message from `+918517942172` to the test number, end to
   end, with the signature verifying.
7. **Only then** decide the production number, and only then retire WAHA.

## What is not built

The receiver itself, the `channel_registry` row, the n8n workflow, and the
send path. Also unresolved and older than this work: every conversation in
production returns `TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED`, because the
24-hour window rule is seeded `NOT_VERIFIED` and only a named human with the
Meta account can attest it. Cloud API does not change that; the rule still has
to be checked and recorded.
