# 3. Feature Specifications

> **In plain terms:** This breaks the product into four "machines" and specifies exactly what
> each one does, what it takes in, and what it produces. The four machines are: the
> **Content Engine** (finds topics and writes posts), the **Email System** (sends the daily
> heads-up), the **Review Dashboard** (where the human edits and approves), and the
> **LinkedIn Integration** (the only thing allowed to actually publish).

Each module is specified as: purpose → inputs → processing → outputs → interfaces → failure
modes.

---

## 3.1 Module A — Content Engine

### A.1 Purpose
Turn "who the user is" into a ready-to-review daily post: a topic, a substantive caption
(hook + value + CTA + hashtags), and a matching image.

### A.2 Sub-module A1 — Content Discovery

**Inputs**
- `expertise_profiles` (industry, niche, bio, content pillars, tone)
- `user_skills` (weighted)
- `expertise_profiles.sample_posts` — the user's own pasted past posts (compliant source)
- Optionally an uploaded LinkedIn data export (Phase 2)
- Recently used topics (`topic_suggestions` where `status='used'`) to avoid repetition

**Processing**
1. Build a **user content fingerprint**: a structured summary of expertise + voice derived
   once at onboarding and refreshed when the profile changes (stored in
   `generation_meta`/profile, not recomputed daily).
2. Generate a ranked batch of candidate topics via the LLM, each with `{title, angle,
   format, rationale, source}`. Prompt seeds: content pillars × formats × the user's niche.
3. **De-duplicate** against recently used topics (cosine similarity on embeddings or simple
   title/keyword overlap for MVP).
4. Persist candidates to `topic_suggestions`; select the top-ranked unused one for today.

**Outputs**
- N `topic_suggestions` rows; one marked `selected` for the day's post.

> **Compliance note:** Discovery never scrapes LinkedIn. "Analysis of the user's existing
> LinkedIn profile and historical posts" is satisfied by **user-provided** sample posts and
> self-exported data only. See [Integrations §6.1.7](06-integrations.md#617-what-you-cannot-do).

### A.3 Sub-module A2 — Caption Generation

**Inputs**: selected topic + user content fingerprint + tone preferences.

**Processing**: a structured LLM call returns the caption as parts so the dashboard can edit
each independently and so we can run engagement optimization:
```json
{
  "hook": "string (<= 2 lines, stops the scroll)",
  "body": "string (the insight / value; scannable; short paragraphs)",
  "cta": "string (one clear ask: comment, follow, DM, save)",
  "hashtags": ["#3-to-5", "#relevant", "#tags"],
  "format": "story | listicle | how-to | hot-take | case-study"
}
```
**Engagement optimization rules** (applied/validated post-generation):
- Hook in the first ~140 characters (LinkedIn truncates with "…see more").
- Total length within **3,000 characters** (LinkedIn's hard cap) — enforced; flag if over.
- Line breaks for scannability; avoid wall-of-text.
- Exactly one primary CTA.
- 3–5 hashtags, niche-relevant, not stuffed.
- Tone matches `tone_preferences`.

**Outputs**: `posts` row populated (`hook`, `body`, `cta`, `hashtags`, `caption_final`,
`char_count`, `caption_model`, `generation_meta`).

### A.4 Sub-module A3 — Image Generation

**Inputs**: topic + caption summary → an image prompt; selected `image_provider`.

**Processing**
1. Derive an image prompt from the post concept (LLM-assisted; brand-safe, no real people /
   logos / copyrighted characters).
2. Call the provider adapter (self-hosted SDXL via ComfyUI default; keyless fallback optional).
3. Receive image, **normalize to a LinkedIn-friendly ratio** (default 1.91:1 = 1200×627, or
   1:1 = 1200×1200), generate a thumbnail, write to object storage.
4. Insert `post_images` row (`status='ready'`, `is_selected=true` for the first/best).

**Outputs**: one or more `post_images`; the post's `selected_image_id` set.

**Failure handling**: if image generation fails or is policy-blocked, the post is still
valid as text-only; `post_images.status='failed'`; the user can regenerate or publish without
an image.

### A.5 Provider interface (swappability)
```ts
interface CaptionGenerator {
  generate(input: CaptionInput): Promise<CaptionOutput>;
}
interface ImageGenerator {
  generate(input: ImagePrompt): Promise<GeneratedImage>; // returns binary/URL + meta
}
```
Concrete adapters (all free/self-hosted): `OllamaCaptionGenerator`,
`ComfyUiImageGenerator`, plus optional keyless fallbacks (`PollinationsImageGenerator`,
`FreeTierCaptionGenerator`). Business logic depends only on the interfaces, so a paid model
could be swapped in later without touching it.

### A.6 Module failure modes
| Failure | Handling |
|---------|----------|
| LLM timeout/error | Retry w/ backoff (job step); after N, `generation_failed` + failure email |
| Caption over 3000 chars | Auto-trim body, re-validate; flag in dashboard |
| Image policy block | Continue text-only; mark image failed |
| All topics recently used | Broaden generation (relax dedup) or use evergreen pillar |

---

## 3.2 Module B — Email Notification System

### B.1 Purpose
Once per day, tell the user "your post is ready," show a preview, and give a one-tap deep
link into the dashboard. Email is a **notification**, never a publish channel.

### B.2 Inputs
- The day's `posts` row (status `in_review`) + selected image thumbnail.
- `user_settings.notification_email` (or `users.email`).

### B.3 Processing
1. Triggered by the email-digest job step after generation succeeds.
2. Render a responsive HTML email (React Email template) containing: greeting, the hook,
   a caption snippet, the image thumbnail, and a **"Review & Publish"** button (signed deep
   link to `/posts/{id}`).
3. Send via SMTP (Nodemailer); record the SMTP Message-ID.
4. Record an `email_logs` row (`status='sent'` on SMTP accept, `status='failed'` on reject).
5. (Best-effort) parse bounces from the relay if available; open/click tracking is dropped
   without a paid provider.

### B.4 Email types
| Type | Trigger | Purpose |
|------|---------|---------|
| `welcome` | Onboarding complete | Confirm setup, what to expect |
| `daily_digest` | Post generated successfully | "Today's post is ready" + preview |
| `generation_failed` | Generation errored | "We couldn't generate today — tap to retry" |
| `reconnect_linkedin` | Token expired/revoked | "Reconnect LinkedIn to keep publishing" |
| `weekly_summary` | Weekly (Phase 2) | Posts published, performance recap |

### B.5 Outputs / interfaces
- `EmailService.send(template, to, vars) → { messageId, accepted }` (Nodemailer/SMTP)

### B.6 Requirements
- **Idempotent**: one digest per user per day (keyed on `user_id + scheduled_date + type`).
- **Deliverability**: SPF/DKIM/DMARC configured for the sending domain; List-Unsubscribe
  header; honor unsubscribe for non-transactional types.
- **Privacy**: email contains a preview + link only; no credentials, no tokens.

---

## 3.3 Module C — Review Dashboard (the mandatory human gate)

### C.1 Purpose
The interface where the user reviews, edits, approves, and triggers publish. **This is the
only place a post can move toward "published," and only by explicit user action.**

### C.2 Screens
| Screen | Route | Contents |
|--------|-------|----------|
| Today / Inbox | `/` | The day's ready post (status `in_review`/`edited`), plus any unactioned backlog |
| Post editor | `/posts/[id]` | Editable caption (hook/body/CTA/hashtags), image preview + regenerate/replace/upload, character counter, LinkedIn preview pane |
| History | `/history` | Published + archived posts; (Phase 2) metrics |
| Settings | `/settings` | Expertise profile, skills, schedule, timezone, image provider, LinkedIn connection status |
| Onboarding | `/onboarding` | Skills/expertise input, paste sample posts, connect LinkedIn |

### C.3 Editor capabilities
- Edit any caption part; live character count against the 3,000 limit.
- **LinkedIn preview**: renders the post as it will appear (truncation at "…see more",
  hashtag styling, image crop).
- Image actions: **Regenerate** (new prompt/seed), **Replace from candidates**,
  **Upload your own**, **Remove image** (publish text-only), edit **alt text**.
- Every save writes a `post_revisions` row (audit + undo).
- **Approve & Publish** button — disabled until the post is in an approvable state and
  LinkedIn is connected.

### C.4 The publish action (server-side enforcement)
Pseudocode for the only path to LinkedIn:
```ts
async function publishPost(userId, postId) {
  const post = await getPostOwnedBy(userId, postId);        // 1. ownership check
  assert(post.status in ['in_review','edited','approved']);  // 2. approvable state only
  assert(linkedInConnected(userId));                         // 3. valid token
  acquirePublishLock(postId);                                // 4. no double-post
  setStatus(post, 'approved');
  const result = await linkedIn.publish(post);               // 5. official Posts API
  await writePublishLog(post, result);                       // 6. always log
  setStatus(post, result.ok ? 'published' : 'publish_failed');
  await audit('post.published', userId, postId);
}
```
There is **no scheduler, job, or webhook** that calls `linkedIn.publish` on the user's
behalf. The constraint is structural, not configurable.

### C.5 Failure modes
| Failure | UX |
|---------|----|
| LinkedIn not connected | Publish disabled; "Connect LinkedIn" CTA |
| Token expired | Publish disabled; "Reconnect LinkedIn" |
| Rate limited (429) | Non-blocking toast: "LinkedIn is busy, try again shortly" |
| Publish API error | `publish_failed`; show error; allow retry; post not lost |

---

## 3.4 Module D — LinkedIn Integration

> Full protocol-level detail (endpoints, headers, payloads, scopes, rate limits) is in
> [Integrations §6.1](06-integrations.md#61-linkedin-api). This section is the functional spec.

### D.1 Responsibilities
1. **Connect**: OAuth 2.0 authorization-code flow → obtain `w_member_social` (+ OIDC
   sign-in scopes) → store encrypted tokens + author URN in `linkedin_accounts`.
2. **Publish text**: create a post via the **Posts API** as `urn:li:person:{id}`.
3. **Publish with image**: register image upload (**Images API**) → PUT binary → reference
   the returned image URN in the post.
4. **Token lifecycle**: proactive refresh job; mark `expired`/`revoked`; trigger reconnect
   email.
5. **Metrics** (Phase 2): best-effort retrieval where permitted, else manual entry.

### D.2 Interface
```ts
interface LinkedInClient {
  getAuthUrl(state): string;
  exchangeCode(code): Promise<TokenSet & { memberUrn: string }>;
  refresh(refreshToken): Promise<TokenSet>;
  uploadImage(userId, imageBytes): Promise<{ assetUrn: string }>;
  publish(post): Promise<{ ok: boolean; postUrn?: string; status: number; body: any }>;
}
```

### D.3 Compliance guarantees built into the module
- Posts are created **only** with `w_member_social` on the member's own behalf, after
  explicit in-app approval.
- Client-side rate limiting + `Retry-After` honoring; exponential backoff on 429/5xx.
- All requests carry the required `LinkedIn-Version` and `X-Restli-Protocol-Version` headers.
- No reading of other members' data; no scraping; no automated engagement.
- Every write is recorded in `publish_logs` with a redacted request/response for audit.
