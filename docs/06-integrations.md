# 6. Integration Specifications

> **In plain terms:** This is the wiring diagram for what the tool talks to. Only **LinkedIn**
> is a true outside service (to publish — and it's free to call). Email goes out over your own
> **SMTP**, and the **AI image/caption models run locally** on your own machine — not a paid
> cloud service. It includes the exact rules, limits, and gotchas — especially LinkedIn's,
> which are the trickiest.

> ⚠️ **Verify against live docs before coding.** LinkedIn versions its API monthly and
> changes products/scopes/limits. Treat the specifics below as the *design intent and shape*;
> confirm exact endpoint versions, scopes, and throttles in LinkedIn's current developer
> documentation at implementation time. Items marked **[VERIFY]** are most likely to drift.

---

## 6.1 LinkedIn API

### 6.1.1 Developer setup (prerequisite)
1. Create a **LinkedIn Developer App** and associate it with a Company Page (LinkedIn
   requires this even for individual-use tools).
2. Request these **products**:
   - **Sign In with LinkedIn using OpenID Connect** → scopes `openid`, `profile`, `email`.
   - **Share on LinkedIn** → scope **`w_member_social`** (this is the one that allows posting
     to the member's own profile). **[VERIFY]** — approval may be self-serve or require a
     short review.
3. Configure the **OAuth redirect URL** (your `/api/linkedin/callback`).
4. Note the API base: `https://api.linkedin.com/rest/...` with a monthly
   `LinkedIn-Version` header (format `YYYYMM`, e.g. `202506`) **[VERIFY current value]**.

### 6.1.2 Authentication — OAuth 2.0 Authorization Code flow
```
GET https://www.linkedin.com/oauth/v2/authorization
    ?response_type=code
    &client_id={CLIENT_ID}
    &redirect_uri={REDIRECT}
    &state={CSRF_STATE}
    &scope=openid%20profile%20email%20w_member_social
```
Exchange the returned `code`:
```
POST https://www.linkedin.com/oauth/v2/accessToken
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={code}&client_id=...&client_secret=...&redirect_uri=...
```
**Response (shape):** `{ access_token, expires_in, refresh_token?, refresh_token_expires_in?,
scope, id_token }`.
- **Author URN:** decode the OIDC `id_token` (or call the userinfo endpoint) to get `sub`;
  the post author is `urn:li:person:{sub-derived-id}`. Store as
  `linkedin_accounts.linkedin_member_urn`.
- **Token lifetimes [VERIFY]:** access token ≈ **60 days**; refresh tokens (where enabled,
  "programmatic refresh tokens") ≈ up to **1 year**. Not all apps get refresh tokens by
  default — if absent, the user must periodically re-authorize (handled by the
  `reconnect_linkedin` email + Publish-blocking UX).

### 6.1.3 Token storage & refresh
- Store `access_token` / `refresh_token` **encrypted** (AES-256-GCM) in `linkedin_accounts`
  (see [Security §7.2](07-security-privacy.md#72-credential--token-protection)).
- A daily **`refresh_tokens` job** renews tokens nearing expiry (if refresh tokens are
  available); on failure → set `status='expired'`, send reconnect email, block Publish.

### 6.1.4 Publishing a post — Posts API (current)
Use the **Posts API** (the modern replacement for the legacy `ugcPosts` API).
```
POST https://api.linkedin.com/rest/posts
Authorization: Bearer {access_token}
LinkedIn-Version: {YYYYMM}
X-Restli-Protocol-Version: 2.0.0
Content-Type: application/json

{
  "author": "urn:li:person:{id}",
  "commentary": "the assembled caption text (hook + body + CTA + hashtags)",
  "visibility": "PUBLIC",
  "distribution": {
    "feedDistribution": "MAIN_FEED",
    "targetEntities": [],
    "thirdPartyDistributionChannels": []
  },
  "content": {
    "media": { "id": "urn:li:image:{ASSET_URN}", "altText": "..." }   // omit for text-only
  },
  "lifecycleState": "PUBLISHED",
  "isReshareDisabledByAuthor": false
}
```
- **Success:** the created post URN comes back (e.g. in the `x-restli-id`/`x-linkedin-id`
  response header or body) → store in `publish_logs.linkedin_post_urn`. **[VERIFY exact field]**
- **Character limit:** commentary max **3,000 characters** — enforced client-side before send.
- Legacy `POST /v2/ugcPosts` remains as a documented fallback shape but the Posts API is
  preferred. **[VERIFY which is current/available to your app]**

### 6.1.5 Publishing with an image — Images API (3 steps)
```
# Step 1 — initialize the upload
POST https://api.linkedin.com/rest/images?action=initializeUpload
LinkedIn-Version: {YYYYMM}
{ "initializeUploadRequest": { "owner": "urn:li:person:{id}" } }
# → returns { value: { uploadUrl, image: "urn:li:image:XXXX" } }

# Step 2 — upload the binary
PUT {uploadUrl}
(body = image bytes; Authorization: Bearer ...)

# Step 3 — reference the image URN in the Posts API call (content.media.id above)
```
Persist the returned `urn:li:image:...` to `post_images.linkedin_asset_urn`.

### 6.1.6 Rate limits & throttling **[VERIFY — numbers drift]**
- LinkedIn enforces **application-level** and **per-member-per-day** throttles. Exact ceilings
  are not always publicly fixed and change by product tier; historically member-level write
  limits have been on the order of low-hundreds/day per endpoint.
- For this product the real volume is tiny (≈1 publish/user/day), so limits are unlikely to
  bind — **but the client must still:**
  - Implement client-side rate limiting per user + per app.
  - Honor `429` responses and the `Retry-After` header.
  - Use exponential backoff with jitter on `429`/`5xx`.
  - Never silently retry into a loop; surface persistent failures to the user.

### 6.1.7 What you CANNOT do (compliance boundaries)
- ❌ **Read the member's feed or historical posts** — no self-serve scope for this. Do **not**
  scrape (violates the [LinkedIn API Terms](https://www.linkedin.com/legal/l/api-terms-of-use)
  and User Agreement). → Use **user-pasted samples** and **user-self-exported data** instead.
- ❌ **Auto-publish without consent** — our mandatory review gate satisfies this; keep it.
- ❌ **Automated engagement** (auto-like/comment/connect) — out of scope, prohibited.
- ❌ **Reading other members' data**.
- ✅ **Allowed:** sign-in (OIDC), and posting to the **member's own** profile via
  `w_member_social` after explicit in-app approval.

### 6.1.8 Metrics retrieval (Phase 2) **[VERIFY access tier]**
- Member-post analytics for individuals are **restricted**. Basic social-action counts on a
  share you own may be retrievable via the Social Actions API with elevated/`r_member_social`
  access, which is **not generally self-serve**.
- **MVP stance:** track publish success + post URN only. Offer **manual metric entry**.
- **Phase 2:** pursue elevated access *or* keep manual; the `post_metrics` table supports
  both via its `source` column.

### 6.1.9 LinkedIn adapter responsibilities (recap)
`getAuthUrl` · `exchangeCode` · `refresh` · `uploadImage` · `publish` · `getPostMetrics?` —
each wrapped with required headers, retry/backoff, redacted logging to `publish_logs`, and
typed errors mapped to user-facing messages.

---

## 6.2 Email service (Nodemailer + SMTP — no paid service)

### 6.2.1 Setup
- Send over **SMTP** with **Nodemailer** — no transactional-email vendor required.
- Use any free SMTP you control: your mailbox provider's SMTP (e.g. a Gmail/Workspace
  account with an **app password**), or a self-hosted MTA (Postfix), or any relay you
  already have. Store credentials as `SMTP_URL` (or host/port/user/pass) in secrets.
- Configure **SPF**, **DKIM**, **DMARC** on the sending domain for deliverability.
- Templates authored with **React Email** (compiles to plain HTML — no runtime service).

### 6.2.2 Sending
```ts
import nodemailer from 'nodemailer';
import { render } from '@react-email/render';

const transport = nodemailer.createTransport(process.env.SMTP_URL); // smtp://user:pass@host:587
const html = render(DailyDigest({ hook, snippet, imageThumbUrl, reviewUrl }));

const info = await transport.sendMail({
  from: 'LinkedIn Post Studio <daily@yourdomain.com>',
  to: user.notificationEmail,
  subject: "✅ Today's LinkedIn post is ready to review",
  html,
  headers: { 'List-Unsubscribe': '<...>' },
});
// → store info.messageId in email_logs; status from accepted/rejected
```

### 6.2.3 Delivery tracking
- SMTP gives a synchronous result only: record `sent` (accepted) or `failed` (rejected/throw)
  in `email_logs` from the `sendMail` response. There is no paid open/click webhook, so those
  analytics are dropped (best-effort). Bounces, if your relay forwards them, can be parsed
  later (Phase 2).

### 6.2.4 Requirements
- **Idempotent** per `user_id + scheduled_date + type` (no duplicate digests).
- **Transactional vs. marketing:** the daily digest is transactional (service the user opted
  into); the weekly summary should honor unsubscribe (`List-Unsubscribe`).
- **No secrets/tokens** in email bodies — preview + signed deep link only.
- **Image in email:** reference the thumbnail by URL served from your app/MinIO (or inline as
  a CID attachment) — no third-party image host needed.
- All sending sits behind the `EmailService` interface, so swapping SMTP relays is a config
  change.

---

## 6.3 AI image generation (self-hosted)

### 6.3.1 Provider comparison (free / open-source first)
| Provider | Cost | Strengths | Watch-outs |
|----------|------|-----------|-----------|
| **Stable Diffusion via ComfyUI** — default | **Free, local** | Full control, no per-image fee, private; SDXL-Turbo for speed | Needs a GPU for fast SDXL (CPU works with turbo models, slower) |
| **AUTOMATIC1111 (`--api`)** | Free, local | Familiar tooling, big ecosystem | Same hardware needs |
| **`diffusers` (Python service)** | Free, local | Lightweight, scriptable | You wire the HTTP service |
| **Pollinations.ai** (no-GPU fallback) | **Free, keyless** | Zero setup, no hardware | Rate-limited, third-party, not guaranteed long-term |
| ~~Midjourney~~ | — | Best aesthetics | ❌ No API (Discord-only) → unusable for automation |

### 6.3.2 Generation contract (provider-agnostic)
```ts
interface ImageGenerator {
  generate(input: {
    prompt: string;          // brand-safe, no real people/logos/copyrighted IP
    aspectRatio: '1.91:1' | '1:1' | '4:5';
    width: number; height: number;  // e.g. 1200x627, 1024x1024
  }): Promise<{ bytes: Buffer; width: number; height: number; meta: object }>;
}
```
**ComfyUI adapter (default, self-hosted):** POST a workflow graph (SDXL checkpoint, prompt,
steps, size) to ComfyUI's `/prompt` endpoint, poll `/history/{id}`, then fetch the image
bytes from `/view`. Wrap as the `ImageGenerator` above. Use **SDXL** for quality or
**SDXL-Turbo / SD-Turbo** (1–4 steps) when you need speed or have weak hardware.

**Keyless fallback (no GPU):**
```ts
// Pollinations.ai — free, no API key
const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1200&height=627`;
const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
```

### 6.3.3 Post-processing
- Normalize/crop to a LinkedIn-recommended ratio (**1.91:1 = 1200×627** default, or
  **1:1 = 1200×1200**, or **4:5 = 1080×1350** portrait for more feed real estate). SDXL
  natively does ~1024² — upscale/crop with `sharp` to the target.
- Generate a thumbnail; write original + thumb to **MinIO/local storage**; store URLs in
  `post_images`.
- Always set **alt text** (accessibility + LinkedIn requires it on upload).

### 6.3.4 Safety, license, throughput
- **Safety:** add a pre-prompt guard ("no real individuals, logos, trademarks, explicit
  content"); optionally run a local NSFW classifier on output; if blocked/failed → text-only
  post, mark image `failed`.
- **License:** choose a checkpoint whose license permits your use (most SDXL base checkpoints
  allow commercial use; some community fine-tunes don't).
- **Throughput:** generation is a daily batch (≈1 image/user); a single GPU serves many
  users. Cache by prompt hash to avoid regenerating identical prompts on retry. No per-image
  cost and no external rate limit when self-hosted (the local queue is your only limit).

---

## 6.4 Local caption model (Ollama)

### 6.4.1 Setup
- Run **Ollama** as a container/service on the host; pull a model (e.g.
  `ollama pull llama3.1:8b` or `qwen2.5:7b`). Expose `OLLAMA_BASE_URL` to the worker.
- No API key, no per-token cost; the model file lives on your disk.

### 6.4.2 Generation contract
```ts
interface CaptionGenerator {
  generate(input: {
    fingerprint: string;     // the user's expertise/voice summary
    topic: { title: string; angle: string; format: string };
    tone: object;
  }): Promise<{ hook: string; body: string; cta: string; hashtags: string[]; format: string }>;
}
```
**Ollama adapter (default):** POST to `${OLLAMA_BASE_URL}/api/chat` with the model tag, a
system prompt encoding the engagement rules ([Feature §3.1](03-feature-specifications.md)),
and `format: 'json'` (or a JSON schema) so the response parses directly into the caption
parts. Enforce the 3,000-char limit after generation.

### 6.4.3 Notes
- **Determinism/quality:** set a modest temperature; keep a fixed prompt template per format.
- **Throughput:** captions are cheap (seconds even on CPU); the same Ollama instance serves
  all users via the worker queue.
- **Free-tier fallback (optional, no GPU):** point the adapter at a free-tier chat endpoint
  (e.g. Google AI Studio / Groq) — zero-cost but rate-limited and third-party (treat as a
  data processor; see [Security §7.5](07-security-privacy.md#75-data-privacy--compliance-gdpr--ccpa)).

---

## 6.5 Cross-cutting integration rules

| Rule | Applies to |
|------|-----------|
| All outbound calls behind a typed **adapter** with retry + backoff + timeout | LinkedIn, email, AI |
| **Redacted** request/response logging (never log tokens or full PII) | All |
| **Idempotency keys** to prevent duplicate side-effects on retry | Generation, publish, email |
| **Circuit-breaker / graceful degradation** (image fails ⇒ text-only; email fails ⇒ dashboard still works) | All |
| **Secrets** from env/secret-manager only; rotated; least privilege | All |
| **`[VERIFY]` checklist** completed before launch | LinkedIn scopes, versions, limits, metrics access |
