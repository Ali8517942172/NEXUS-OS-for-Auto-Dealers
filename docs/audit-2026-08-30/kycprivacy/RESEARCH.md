# RESEARCH — where a customer's Emirates ID / passport actually goes
**Scope:** n8n workflow `KYC/AML Document Auditor + Re-upload Loop (Phase 5)` (id `qTnh3nwWheFJbFkU`), node `OpenRouter Vision (KYC Analysis)`.
**Date of research:** 30 August 2026. **Method:** vendor documentation + live reads of OpenRouter's public API (`/api/v1/models`, `/api/v1/endpoints/zdr`) + the exported workflow JSON in `/home/claude/audit/`.

Everything below is either quoted from a source with a URL, or marked **UNVERIFIED**. Nothing is inferred and then presented as fact.

---

## 0. What the workflow does today (verified from the file)

`/home/claude/audit/n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json`

- `Prepare Document` puts the uploaded document into `imageBase64`.
- `OpenRouter Vision (KYC Analysis)` POSTs to `https://openrouter.ai/api/v1/chat/completions` with
  `model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'` and
  `models: ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'minimax/minimax-m3:free', 'google/gemma-4-26b-a4b-it:free']`,
  the image inlined as `data:image/jpeg;base64,…`.
- Headers sent: `HTTP-Referer: https://nexuscorp.net`, `X-Title: NEXUS OS - KYC Auditor`.
- The system prompt asks the model to extract **Full Name, Date of Birth, Expiry Date, Document Type** and to return a free-text `remarks` field.
- Workflow settings: `saveDataSuccessExecution: "none"`, **`saveDataErrorExecution: "all"`**, `errorWorkflow: iYJkh1kztWxZXDbT`.
- `Prepare Archive` builds the storage key as `'kyc/' + who + '/' + yyyy + '/' + mm + '/' + uuid + '.' + ext` where `who` is the lowercased, punctuation-substituted **customer email or WhatsApp number**.
- `Decide: Re-ask or Escalate` sets `reason = parsed.remarks || …` and interpolates it into the WhatsApp message body; `Log KYC Re-ask` writes that same text into `communication_logs.message`.

### Confirmed propagation path for the model's free text (this is worse than the brief states)
`whatsapp_bdc_ai_agent.json` node **`Fetch Thread History`** runs
`select=direction,message,created_at … limit 12` against `communication_logs`, and that result is consumed by node **`AI BDC Sales Agent`** (`@n8n/n8n-nodes-langchain.agent`). So any PII the vision model echoes into `remarks` is (1) sent to the customer on WhatsApp, (2) stored in `communication_logs`, and (3) **re-sent to a third-party LLM as conversation history on every subsequent chat turn**, indefinitely.

`nexus_retention_purge.json` purges `kyc_documents` and the `kyc-documents` bucket. It does **not** touch `communication_logs`. PII that lands there is never purged.

### Second confirmed error-store path (not in the brief)
`whatsapp_bdc_ai_agent.json` (id `BiyHk9ZXxJUVGbf6`) node `Send to KYC Auditor` passes `document_base64` into the sub-workflow, and that workflow **also** has `saveDataErrorExecution: "all"`. Fixing only the KYC workflow leaves this second copy.

### The dealership's own published privacy policy contradicts the practice
`nexus_public_privacy.json` serves `/privacy`, last updated 24 August 2026. It states, under "What is never done": *"It is never used to train machine-learning models, ours or anyone else's."* and under "Where data lives": *"On infrastructure the dealership controls: a private virtual machine and a private Supabase database."* The second statement is unqualified and is not true of KYC images. (The first bullet sits in a section about Google account data, so its scope is arguable — but a customer reading the page will not make that distinction.)

---

## 1. OpenRouter: what `:free` variants do with prompt data

### 1a. OpenRouter's own logging (as distinct from the provider's)
> "We do zero logging of your prompts/completions, even if an error occurs, unless you opt-in to logging them."
> "We have an opt-in setting that lets users opt-in to log their prompts and completions in exchange for a 1% discount on usage costs."
— https://openrouter.ai/docs/faq

### 1b. The provider is a separate question, and there are separate settings for free models
> "On your account settings page, you can set whether you would like to allow routing to providers that may train on your data"
> **"There are separate settings for paid and free models."**
> "You can restrict individual requests to only use providers with a certain data policy."
> "If you opt out of training in your account settings, OpenRouter will not route to providers that train."
— https://openrouter.ai/docs/features/privacy-and-logging

> "Providers that do log, or where we have been unable to confirm their policy, will not be routed to unless the model training toggle is switched on in the privacy settings tab."
— https://openrouter.ai/docs/faq

> "This setting has no bearing on OpenRouter's own policies and what we do with your prompts."
— https://openrouter.ai/docs/features/privacy-and-logging

### 1c. The decisive statement about free endpoints
OpenRouter's own support article, titled *"Why do all free models return a 404: 'No endpoints available matching your guardrail restrictions and data policy'?"*:

> **"Most free endpoints train on, or may publish, the prompts they receive."**

It names the two toggles on the Privacy page that gate them:
> **"Free endpoints that may train on request data"**
> **"Free endpoints that may publish prompts"**

and states that **"free endpoints generally require these permissions"** — i.e. if either toggle is off, the corresponding free endpoints are filtered out and free-model requests 404.
— https://openrouter.zendesk.com/hc/en-us/articles/51690904755227-Why-do-all-free-models-return-a-404-No-endpoints-available-matching-your-guardrail-restrictions-and-data-policy

**Plain reading:** the fact that this system's free-model calls are succeeding today is itself evidence that the account has those toggles switched **on**. Turning them off would break the calls. Note the second toggle: not merely *train on*, but *publish*.

### 1d. Is there a per-request switch that forbids training and logging? Yes — and it is documented.
> `data_collection`: `"allow" | "deny"`, default `"allow"`.
> "allow: (default) allow providers which store user data non-transiently and may train on it"
> "deny: use only providers which do not collect user data"
> "This is also available as an account-wide setting in your privacy settings… the list of ignored providers is merged with your account-wide ignored providers."
— https://openrouter.ai/docs/features/provider-routing

> "Zero Data Retention (ZDR) means that a provider will not store your data for any period of time."
> Per-request: `{"provider": {"zdr": true}}`. Account-level toggles exist per model group.
> "Providers with ZDR policies will not retain your data"; "These providers also cannot train on your data"; in-memory caching is not counted as retention.
> ZDR "applies only to inference routing — not to plugins or tools like web search".
— https://openrouter.ai/docs/guides/features/zdr

### 1e. Does that setting reach the `:free` variants in this workflow? **No. Measured, not guessed.**
Live reads on 30 Aug 2026:

- `GET https://openrouter.ai/api/v1/endpoints/zdr` → **817 ZDR endpoints**. Exactly **4** have slugs ending `:free`: `inclusionai/ling-3.0-flash-fin:free` (Novita), `z-ai/glm-5.2:free` (Decart), `fish-audio/s2.1-pro-free:free`, `deepgram/flux-tts:free`.
- Cross-referencing `GET https://openrouter.ai/api/v1/models`: the first two are **`input_modalities: ["text"]`** — text-only. The other two are audio/TTS models not in the chat-models list.
- Free models on OpenRouter that accept image input: **8** — `dots-studio/dots-3-note-preview:free`, `thinkingmachines/inkling-small:free`, `thinkingmachines/inkling:free`, `nvidia/nemotron-3.5-content-safety:free`, `minimax/minimax-m3:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free`.
- **None of those 8 appear on the ZDR endpoint list.**

> **Finding: as of 30 August 2026 there is no free vision-capable endpoint on OpenRouter that is ZDR. Setting `zdr: true` or `data_collection: "deny"` on this request does not make it private — it makes it return 404.**

### 1f. Which company actually receives the image today
`GET /api/v1/models/<slug>/endpoints` for each configured free slug returns a **single** serving provider each:

| Configured free slug | Sole provider of the free endpoint |
|---|---|
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | **Nvidia** |
| `minimax/minimax-m3:free` | **GMICloud** |
| `google/gemma-4-26b-a4b-it:free` | **Google AI Studio** |

For the Google AI Studio route, Google's own terms are explicit about the unpaid tier:
> "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
> "To help with quality and improve our products, human reviewers may read, annotate, and process your API input and output."
> "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services."
> (Paid tier, by contrast: "Google doesn't use your prompts … or responses to improve our products.")
— https://ai.google.dev/gemini-api/terms

So on at least one of the three configured routes, the vendor's own terms say in plain words: **do not send this.** A passport photo page is squarely "sensitive, confidential, or personal information", and human reviewers may read it.

**UNVERIFIED:** Nvidia's and GMICloud's specific data-handling terms for their OpenRouter free endpoints. I did not locate provider-specific published terms for those two free endpoints. OpenRouter's own statement — "most free endpoints train on, or may publish, the prompts they receive" — is the only source that covers them, and it is a general statement, not a per-provider commitment.

### 1g. Is there a documented per-provider log list?
Partly. OpenRouter maintains per-provider data policies surfaced through the routing filters, and states providers that log or whose policy is unconfirmed are excluded unless the training toggle is on (§1b). I did **not** find a single published human-readable table of "which providers log", and I am marking the existence of one **UNVERIFIED**. The machine-readable substitute that does exist and that I did read is `/api/v1/endpoints/zdr` (§1e).

### 1h. Two side facts that bear on cost
- The identifying headers are for a public leaderboard. OpenRouter documents `HTTP-Referer` as "Site URL for rankings on openrouter.ai" and `X-Title` as "Site title for rankings on openrouter.ai" — https://openrouter.ai/docs/api-reference/overview. `X-Title: NEXUS OS - KYC Auditor` therefore attaches a named, publicly-attributable KYC application to this traffic. It buys nothing operationally.
- Free-model rate limits: without purchased credits, free models are capped at **50 requests per day**; with at least **$10** in credits purchased, that becomes **1,000 per day**. Card top-ups carry a "5.5% ($0.80 minimum)" fee. — https://openrouter.ai/docs/faq. (This also means the whole NEXUS estate currently shares a 50/day ceiling.)

### 1i. What is configurable vs. inherent — the honest summary
| | Configurable? |
|---|---|
| OpenRouter's *own* prompt logging | Already off by default; opt-in only. Configurable. |
| Routing away from providers that train | Configurable — account toggle + per-request `data_collection: "deny"` / `zdr: true`. |
| **Free vision endpoints that neither train nor publish** | **Not available. Inherent to the free tier as it stands on 30 Aug 2026.** The permission to train/publish is the price of the free endpoint; withdraw it and the endpoint disappears. |

---

## 2. UAE obligations

### 2a. The federal law and its status
Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL). Issued 20 September 2021, effective 2 January 2022. Official landing page: https://uaelegislation.gov.ae/en/legislations/1972 (the article text itself is behind a download the fetch could not retrieve — see UNVERIFIED note below).

**Executive Regulations status — this matters and is genuinely unsettled:**
- DLA Piper's country guide, last modified 27 January 2025: *"However as of 6 January 2025, those have not yet been published."* and organisations get *"a further six months from their date of the issuance in which they can adjust operations to compliance."* — https://www.dlapiperdataprotection.com/countries/uae-general/law.html
- A 2026-dated compliance vendor page states plainly: *"The UAE PDPL Executive Regulations have not yet been issued."* and advises confirming timing "against the UAE's Official Gazette". — https://itsecnow.com/regulators/pdpl-executive-regulations-2026
- **UNVERIFIED:** I could not confirm from a primary/official source whether the Executive Regulations had been issued between January 2025 and 30 August 2026. Best available reading: the substantive duties in the Decree-Law are in force; the penalty schedule and detailed transfer mechanics await the Regulations, and a six-month grace period is expected to follow their issuance. **Do not treat "the Regulations aren't out yet" as a defence** — the Decree-Law's own obligations bind now, and civil exposure and reputational harm do not wait for a penalty schedule.

### 2b. Consent for processing identity documents
- The PDPL "prohibits the processing of personal data without the consent of the individual unless an exception applies"; consent must be "a specific, informed and unambiguous indication". Exceptions (Art. 4) include where processing is "necessary to execute a contract", to "comply with legal obligations", to "protect the public interest", where the data is already public, or for legal claims / judicial or security measures. — https://www.twobirds.com/en/insights/2021/uae/how-does-the-new-uae-federal-decree-law-on-personal-data-protection-compare-against-the-gdpr
- Article 6 conditions: the controller must be able to **prove** consent; it must be obtained "in a clear, simple, unambiguous, and accessible manner"; and the method must tell the data subject how to withdraw it. — https://securiti.ai/uae-personal-data-protection-law/

Applied here: a customer sending a passport over WhatsApp so a car can be sold to them plausibly engages the "necessary to execute a contract" basis **for the dealership holding the document**. It does not obviously extend to **transmitting that document to an overseas AI provider that may train on or publish it** — that is a distinct purpose the customer has not been told about, and the dealership cannot prove consent to it because it has never been described to anyone. The published `/privacy` page positively says the opposite (§0).

### 2c. Sensitive personal data
The PDPL's sensitive categories include biometric data, defined as "personal data resulting from processing, using a specific technique, relating to the physical, physiological or behavioral characteristics of a data subject, which allows or confirms the unique identification" (Bird & Bird, above); Securiti lists race, ethnicity, political/philosophical views, religious beliefs, criminal record, biometric, health, sexual state.

**UNVERIFIED / contested:** whether a *photograph of the photo page of a passport or Emirates ID* is itself "biometric data" under the PDPL. A facial image becomes biometric data under GDPR-style definitions when processed *through a specific technical means* for unique identification; a plain photo generally is not. Sending it to a vision model for document verification sits uncomfortably close to that line. **I will not assert either way.** It does not change the outcome: it is unquestionably personal data, the Article 22/23 transfer rules apply regardless, and if it *is* sensitive data the exposure is materially worse.

### 2d. Cross-border transfer — the sharpest point
- Article 22 permits transfer to states with an adequate level of protection (own legislation or a bilateral agreement). Article 23 permits transfer in the absence of adequacy where necessary for contract implementation, with the data subject's consent, for international judicial cooperation, or to protect the public interest, "with detailed requirements to be set by the Executive Regulations". — https://www.multilaw.com/Multilaw/Multilaw/Data_Protection_Laws_Guide/DataProtection_Guide_United_Arab_Emirates.aspx and https://securiti.ai/uae-personal-data-protection-law/
- Bird & Bird are blunter and their reading is the restrictive one: *"Transfers can only take place to approved countries (a list is not yet available) or in limited other circumstances (contractual necessity; public interest)"*, and there is *"no mechanism to use contracts to provide safeguards for data transfers to unapproved countries, so this has the potential to be restrictive."*
- **Conflict in the sources, stated honestly:** Multilaw refers to Cabinet Decision No. 83 of 2022 "outlining the mechanisms … including … adequacy lists issued by the UAE Data Office." Clifford Chance describe adequacy lists only generically and do **not** confirm the UAE has published one. Bird & Bird say a list "is not yet available". **UNVERIFIED: whether the UAE Data Office has published an operative adequacy list as at 30 August 2026, and whether the United States (where OpenRouter and these providers sit) is on it.** My working assumption for the design is the conservative one: **assume no adequacy for the US.**
- Note what that does to the derogations. If there is no adequacy and no functioning SCC mechanism, the realistic route for this transfer is **explicit consent** — which returns to §2b: nobody has been asked.

### 2e. Free zones
The PDPL "keeps intact existing data protection and privacy laws within the UAE's financial free zones, DIFC and ADGM" (DLA Piper, above). If the dealership is licensed in DIFC or ADGM, DIFC Data Protection Law No. 5 of 2020 or the ADGM Data Protection Regulations 2021 apply *instead of* the federal PDPL, and both are closer to the GDPR — including transfer restrictions and, in DIFC, specific rules on transfers to jurisdictions without an adequacy determination. Primary DIFC sources: https://www.difc.com/business/laws-and-regulations/legal-database/difc-laws/data-protection-law-difc-law-no-5-2020 ; ADGM consolidated regulations: https://en.adgm.thomsonreuters.com/sites/default/files/net_file_store/ADGM1547_23167_VER97921.pdf
**UNVERIFIED:** which jurisdiction this dealership is licensed in. Car showrooms in Dubai are ordinarily mainland (DED) licensed, which would put them under the federal PDPL — but I have no evidence either way and the DIFC/ADGM article numbers were not retrievable (the DIFC data-export page returned HTTP 403). **This must be confirmed by the owner, and it changes which rulebook applies.**

### 2f. Is a car dealership a regulated KYC entity in the UAE?
The UAE Ministry of Economy's own DNFBP page lists **four** categories subject to AML obligations: real estate firms; auditing/accounting firms; dealers in precious metals and stones; and trust/company service providers. **Motor vehicle dealers are not listed.** — https://www.moet.gov.ae/en/-/does-your-company-fall-under-the-dnfbp

So, carefully:
- On the face of the Ministry's list, a car dealership is **not** a DNFBP and does **not** carry statutory AML customer-due-diligence duties in its own right. The "KYC/AML" framing in this system appears to be self-imposed, or driven by a finance partner.
- **UNVERIFIED, and worth the owner asking his bank:** whether a *finance or leasing partner* contractually requires this identity check, in which case the **bank** is the regulated entity (CBUAE-licensed) and the dealership is handling documents on its behalf — which typically brings contractual security obligations at least as strict as anything in the PDPL. See CBUAE guidance on digital identification for CDD: https://rulebook.centralbank.ae/en/rulebook/guidance-licensed-financial-institutions-digital-identification-customer-due-diligence
- **The uncomfortable implication:** if there is no statutory duty to collect Emirates IDs and passports at all, then the strongest privacy fix is not a better model — it is collecting less. That question belongs to the owner.

---

## 3. Realistic alternatives under the stated constraint (free tier only, no new infrastructure, GCP e2-micro)

| # | Option | Does the image still leave for a third party that may train on / publish it? | Capability cost | Verdict |
|---|---|---|---|---|
| **A** | Status quo | **Yes** | none | Not defensible. Contradicts the dealership's own published policy. |
| **B** | Add `provider: {data_collection: "deny", zdr: true}`, keep free models | No — because **the request 404s**. Measured in §1e: 0 of 8 free vision models are ZDR. | KYC verdicts stop entirely | Not a privacy fix; it is option D with a broken error path. Only useful as a deliberate fail-closed. |
| **C** | A different free vision provider with better documented terms | **UNVERIFIED that one exists.** I checked the whole OpenRouter free vision set (8 models) — none ZDR. Google's own terms for the unpaid tier say do not send personal data (§1f). I did not find a free, documented no-train, no-publish vision API elsewhere and I am not going to claim one exists. | — | Rejected on evidence, not on preference. |
| **D** | Do less with the image: ask only "is this a legible ID, yes/no, expired y/n", drop name/DOB extraction | **Yes — unchanged.** Shrinks what comes *back*; the passport still goes *out*. | loses auto-fill of name/DOB into `kyc_documents` | Fixes the free-text leak only. Does not fix the transfer. Half a fix mistaken for a whole one. |
| **E** | Don't send the image. Route the document to a named human on Slack for a verdict; keep the archive, keep the re-ask loop, drive it from the human's answer. | **No.** | loses the instant automated verdict; adds ~30 seconds of a person's time per document; the "3 second" response promise becomes "within the hour" | **The only option that fully satisfies "free tier only" and stops the transfer.** Requires a build (new nodes + rewire), not a settings change. |
| **F** | Pay. Same model family, ZDR endpoint, `data_collection: "deny"` + `zdr: true`. | **No** — provider contractually retains nothing and cannot train. | **none — capability is identical or better** | Breaks the "free only" constraint, but by a rounding error. See cost below. |

### Option F's actual cost, computed from live prices
`google/gemma-4-26b-a4b-it` — the *same model already in the fallback list* — is on the ZDR endpoint list at **$0.07 per million input tokens / $0.34 per million output tokens** (DeepInfra). At roughly 1,500 input + 250 output tokens per document (**estimate — token cost of an image varies by model and resolution**), that is **≈ $0.00019 per document**: about **$0.19 for a thousand documents**, well under one dirham a month at any volume this dealership will see. A $10 credit top-up (5.5% card fee, $0.80 minimum) would last years — and, per §1h, would also raise the free-model ceiling elsewhere in NEXUS from 50 to 1,000 requests/day.

There are 128 ZDR endpoints that accept image input, from $0.05/M input tokens. Capability is not the constraint here. Ten dollars is.
