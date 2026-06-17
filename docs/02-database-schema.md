# 2. Database Schema

> **In plain terms:** This is the filing system. Every user, every generated post, every
> image, every email we send, and every time we publish to LinkedIn gets a record. Nothing
> is thrown away silently, and each user's data is walled off from every other user's.

**Engine:** PostgreSQL 15+. **Access:** via an ORM ([Drizzle](https://orm.drizzle.team) or
[Prisma](https://www.prisma.io); see [Tech Stack](05-tech-stack.md)). DDL below is the
source of truth; the ORM schema should mirror it.

The brief mentions Google Sheets / Airtable as a storage option. That is fine for a
**no-code prototype**, but for a real multi-user product with auth, encrypted tokens, and
concurrent edits, a relational database is the correct choice. See
[Assumptions](09-assumptions-open-questions.md#a3-storage-engine) for the trade-off.

---

## 2.1 Entity-relationship overview

```
users ─────1:1──── user_settings
  │ │
  │ └──1:1──────── expertise_profiles ───1:N─── user_skills
  │ │
  │ └──1:N──────── linkedin_accounts        (OAuth connection + encrypted tokens)
  │
  ├──1:N───────── topic_suggestions ───┐
  │                                    │ (a post may originate from a topic)
  ├──1:N───────── posts ◄──────────────┘
  │                 │
  │                 ├──1:N── post_images
  │                 ├──1:N── post_revisions
  │                 ├──1:N── publish_logs
  │                 ├──1:N── post_metrics
  │                 └──1:N── email_logs   (digest references the day's post)
  │
  ├──1:N───────── generation_jobs        (audit of daily runs)
  └──1:N───────── audit_logs
```

---

## 2.2 Full DDL

```sql
-- =====================================================================
-- EXTENSIONS & ENUMS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

CREATE TYPE account_status      AS ENUM ('active', 'paused', 'suspended', 'deleted');
CREATE TYPE oauth_status        AS ENUM ('connected', 'expired', 'revoked', 'error');
CREATE TYPE post_status         AS ENUM (
    'queued',            -- scheduled, not yet generated
    'generating',        -- generation in progress
    'in_review',         -- ready for the user (the normal "ready" state)
    'edited',            -- user modified it (still pre-publish)
    'approved',          -- user approved, publish in flight
    'published',         -- live on LinkedIn
    'generation_failed', -- generation errored
    'publish_failed',    -- publish errored
    'archived',          -- user discarded / skipped
    'expired'            -- never acted on within retention window
);
CREATE TYPE image_provider      AS ENUM ('stable_diffusion', 'pollinations', 'manual_upload', 'none');
CREATE TYPE image_status        AS ENUM ('pending', 'generating', 'ready', 'failed', 'uploaded_to_linkedin');
CREATE TYPE topic_source        AS ENUM ('expertise', 'past_posts', 'niche_pattern', 'manual', 'trending');
CREATE TYPE topic_status        AS ENUM ('suggested', 'selected', 'used', 'dismissed');
CREATE TYPE email_type          AS ENUM ('daily_digest', 'generation_failed', 'reconnect_linkedin', 'welcome', 'weekly_summary');
CREATE TYPE email_status        AS ENUM ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed');
CREATE TYPE job_type            AS ENUM ('daily_generation', 'email_digest', 'metrics_refresh', 'token_refresh');
CREATE TYPE job_status          AS ENUM ('scheduled', 'running', 'succeeded', 'failed', 'skipped');

-- =====================================================================
-- USERS & SETTINGS
-- =====================================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT NOT NULL UNIQUE,        -- login + notification address
    name            TEXT,
    avatar_url      TEXT,
    auth_provider   TEXT NOT NULL DEFAULT 'linkedin', -- how they sign in
    auth_subject    TEXT,                          -- OIDC 'sub' from sign-in provider
    status          account_status NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE TABLE user_settings (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    timezone                TEXT NOT NULL DEFAULT 'UTC',      -- IANA tz, e.g. 'Asia/Dubai'
    generation_time_local   TIME NOT NULL DEFAULT '07:00',    -- when the daily draft is prepared
    notification_email      CITEXT,                           -- defaults to users.email if null
    daily_generation_enabled BOOLEAN NOT NULL DEFAULT true,
    image_generation_enabled BOOLEAN NOT NULL DEFAULT true,
    default_image_provider  image_provider NOT NULL DEFAULT 'stable_diffusion',
    default_tone            TEXT DEFAULT 'professional, warm, concise',
    preferred_caption_model TEXT DEFAULT 'qwen2.5:14b',   -- Ollama model tag (local; RTX 5080 runs 14B easily)
    retention_days          INT NOT NULL DEFAULT 30,          -- how long unactioned drafts live
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- EXPERTISE / CONTENT-DISCOVERY INPUTS
-- =====================================================================
CREATE TABLE expertise_profiles (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    headline         TEXT,                 -- e.g. "Real-estate advisor, Dubai off-plan"
    bio              TEXT,                 -- pasted "about" / summary
    industry         TEXT,                 -- e.g. "Real Estate"
    niche            TEXT,                 -- e.g. "Dubai luxury off-plan investment"
    target_audience  TEXT,                 -- who they post for
    content_pillars  JSONB DEFAULT '[]',   -- ["market insights","client stories","how-to"]
    tone_preferences JSONB DEFAULT '{}',   -- {"formality":"medium","emoji":"sparing"}
    sample_posts     JSONB DEFAULT '[]',   -- user-pasted past posts (compliant input source)
    data_export_ref  TEXT,                 -- pointer to uploaded LinkedIn data archive, if any
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,             -- "negotiation", "PropTech", "mortgage structuring"
    proficiency TEXT,                      -- optional self-rating
    weight      NUMERIC(3,2) DEFAULT 1.0,  -- influence on topic selection
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

-- =====================================================================
-- LINKEDIN OAUTH CONNECTION  (encrypted at rest — see Security doc)
-- =====================================================================
CREATE TABLE linkedin_accounts (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linkedin_member_urn      TEXT NOT NULL,         -- 'urn:li:person:XXXX' (author URN)
    linkedin_sub             TEXT,                  -- OIDC 'sub' claim
    display_name             TEXT,
    -- Tokens are stored ENCRYPTED (AES-256-GCM). Columns hold ciphertext + nonce, never plaintext.
    access_token_ciphertext  BYTEA NOT NULL,
    access_token_nonce       BYTEA NOT NULL,
    refresh_token_ciphertext BYTEA,
    refresh_token_nonce      BYTEA,
    scopes                   TEXT[] NOT NULL DEFAULT '{}', -- {'openid','profile','email','w_member_social'}
    access_expires_at        TIMESTAMPTZ NOT NULL,
    refresh_expires_at       TIMESTAMPTZ,
    status                   oauth_status NOT NULL DEFAULT 'connected',
    connected_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_refreshed_at        TIMESTAMPTZ,
    UNIQUE (user_id, linkedin_member_urn)
);

-- =====================================================================
-- CONTENT DISCOVERY: TOPIC SUGGESTIONS
-- =====================================================================
CREATE TABLE topic_suggestions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,            -- the topic
    angle        TEXT,                     -- the specific take / POV
    format       TEXT,                     -- 'story','listicle','how-to','hot-take','case-study'
    rationale    TEXT,                     -- why this fits the user (shown for transparency)
    source       topic_source NOT NULL DEFAULT 'expertise',
    score        NUMERIC(5,2),             -- ranking score for selection
    status       topic_status NOT NULL DEFAULT 'suggested',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- POSTS (the core artifact)
-- =====================================================================
CREATE TABLE posts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id            UUID REFERENCES topic_suggestions(id) ON DELETE SET NULL,
    scheduled_date      DATE NOT NULL,        -- the "day" this post belongs to (user-local)
    status              post_status NOT NULL DEFAULT 'queued',

    -- Composed caption, stored both as parts (for editing/optimization) and as final text
    hook                TEXT,                 -- attention-grabbing first line(s)
    body                TEXT,                 -- the substantive insight / value
    cta                 TEXT,                 -- call to action
    hashtags            JSONB DEFAULT '[]',   -- ["#RealEstate","#Dubai"]
    caption_final       TEXT,                 -- assembled text actually published
    edited_caption      TEXT,                 -- user-overridden caption, if they edited

    format              TEXT,                 -- mirrors the chosen topic format
    char_count          INT,                  -- enforced against LinkedIn's 3000-char limit
    selected_image_id   UUID,                 -- FK set after image rows exist (see ALTER below)

    -- Generation provenance (audit + reproducibility)
    caption_model       TEXT,                 -- e.g. 'qwen2.5:14b' (Ollama tag)
    generation_meta     JSONB DEFAULT '{}',   -- prompt id, tokens, temperature, etc.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at         TIMESTAMPTZ,
    published_at        TIMESTAMPTZ,

    -- One post per user per day (idempotency for the daily job)
    UNIQUE (user_id, scheduled_date)
);

-- =====================================================================
-- IMAGES (1..N candidates per post; one selected)
-- =====================================================================
CREATE TABLE post_images (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    provider            image_provider NOT NULL,
    prompt              TEXT,                 -- the image prompt used
    storage_url         TEXT,                 -- our object-storage URL (source of truth)
    thumbnail_url       TEXT,
    width               INT,
    height              INT,
    aspect_ratio        TEXT,                 -- '1.91:1','1:1','4:5'
    alt_text            TEXT,                 -- accessibility + LinkedIn alt text
    status              image_status NOT NULL DEFAULT 'pending',
    linkedin_asset_urn  TEXT,                 -- 'urn:li:image:XXXX' after upload to LinkedIn
    is_selected         BOOLEAN NOT NULL DEFAULT false,
    generation_meta     JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Wire up the selected-image FK now that post_images exists
ALTER TABLE posts
    ADD CONSTRAINT fk_posts_selected_image
    FOREIGN KEY (selected_image_id) REFERENCES post_images(id) ON DELETE SET NULL;

-- =====================================================================
-- EDIT HISTORY (audit of human edits before publish)
-- =====================================================================
CREATE TABLE post_revisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    version_no      INT NOT NULL,
    caption_snapshot TEXT,
    image_id        UUID REFERENCES post_images(id) ON DELETE SET NULL,
    edited_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    note            TEXT,                     -- 'user edit', 'ai regenerate', etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (post_id, version_no)
);

-- =====================================================================
-- PUBLISH LOGS (every LinkedIn write attempt)
-- =====================================================================
CREATE TABLE publish_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linkedin_post_urn   TEXT,                 -- 'urn:li:share:XXXX' / 'urn:li:ugcPost:XXXX'
    request_payload     JSONB,                -- redacted copy of what we sent
    response_status     INT,                  -- HTTP status
    response_body       JSONB,                -- redacted response
    succeeded           BOOLEAN NOT NULL DEFAULT false,
    error_code          TEXT,
    error_message       TEXT,
    idempotency_key     TEXT,                 -- prevents double-post on retry
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- METRICS (Phase 2 — see Integrations doc for access caveats)
-- =====================================================================
CREATE TABLE post_metrics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    linkedin_post_urn   TEXT,
    impressions         INT,
    likes               INT,
    comments            INT,
    shares              INT,
    clicks              INT,
    engagement_rate     NUMERIC(6,4),
    source              TEXT DEFAULT 'linkedin_api', -- or 'manual_entry'
    collected_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- EMAIL NOTIFICATION LOGS
-- =====================================================================
CREATE TABLE email_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id             UUID REFERENCES posts(id) ON DELETE SET NULL,
    type                email_type NOT NULL,
    provider_message_id TEXT,                 -- SMTP Message-ID from Nodemailer send result
    to_address          CITEXT NOT NULL,
    subject             TEXT,
    status              email_status NOT NULL DEFAULT 'queued',
    payload             JSONB,                -- template + variables (no secrets)
    sent_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    opened_at           TIMESTAMPTZ,
    clicked_at          TIMESTAMPTZ,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- JOB RUN AUDIT (observability of the daily pipeline)
-- =====================================================================
CREATE TABLE generation_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            job_type NOT NULL,
    scheduled_for   TIMESTAMPTZ NOT NULL,
    status          job_status NOT NULL DEFAULT 'scheduled',
    attempts        INT NOT NULL DEFAULT 0,
    post_id         UUID REFERENCES posts(id) ON DELETE SET NULL,
    idempotency_key TEXT UNIQUE,              -- e.g. 'gen:{user_id}:{date}'
    last_error      TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- GENERAL AUDIT LOG (security + compliance)
-- =====================================================================
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,                -- 'post.published','linkedin.connected','data.exported'
    entity_type TEXT,
    entity_id   UUID,
    metadata    JSONB DEFAULT '{}',
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- INDEXES (hot paths)
-- =====================================================================
CREATE INDEX idx_posts_user_status        ON posts (user_id, status);
CREATE INDEX idx_posts_user_date          ON posts (user_id, scheduled_date DESC);
CREATE INDEX idx_post_images_post         ON post_images (post_id);
CREATE INDEX idx_topic_user_status        ON topic_suggestions (user_id, status);
CREATE INDEX idx_publish_logs_post        ON publish_logs (post_id);
CREATE INDEX idx_email_logs_user          ON email_logs (user_id, created_at DESC);
CREATE INDEX idx_email_provider_msg       ON email_logs (provider_message_id);
CREATE INDEX idx_gen_jobs_user            ON generation_jobs (user_id, scheduled_for DESC);
CREATE INDEX idx_linkedin_accounts_user   ON linkedin_accounts (user_id);
CREATE INDEX idx_audit_user_time          ON audit_logs (user_id, created_at DESC);
```

---

## 2.3 Field-mapping back to the brief's required tables

The brief asked for: user profiles, generated posts, images, email logs, and LinkedIn API
integration points. Mapping:

| Brief's requirement | Tables that satisfy it |
|---------------------|------------------------|
| User profiles | `users`, `user_settings`, `expertise_profiles`, `user_skills` |
| Generated posts | `posts`, `post_revisions`, `topic_suggestions` |
| Images | `post_images` (+ object storage for binaries) |
| Email logs | `email_logs` |
| LinkedIn API integration points | `linkedin_accounts` (auth + tokens), `publish_logs` (writes), `post_metrics` (reads), `post_images.linkedin_asset_urn` (image upload) |
| (Added) Observability/compliance | `generation_jobs`, `audit_logs` |

---

## 2.4 Data-integrity rules enforced in schema

- **One post per user per day** — `UNIQUE (user_id, scheduled_date)` makes the daily job
  idempotent.
- **No orphaned children** — `ON DELETE CASCADE` from `users`/`posts` removes all dependent
  rows on account deletion (supports GDPR erasure).
- **Tokens are bytea ciphertext** — the schema makes it structurally impossible to store a
  plaintext token in the intended columns (see [Security](07-security-privacy.md)).
- **Status enums** — illegal states (e.g. an unknown post status) are rejected at the DB
  level; valid transitions are enforced in the application state machine
  ([User Workflow §4.4](04-user-workflow.md#44-post-state-machine)).
