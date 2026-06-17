# 5. Technology Stack — No-Paid-API, Self-Hosted

> **In plain terms:** The shopping list of technologies — chosen so there are **no paid
> external APIs and no per-use AI fees**. The AI runs on your own machine/server using
> free, open-source models. The whole thing ships as a single Docker Compose stack you
> host yourself. The only outside service is **LinkedIn's API, which is free to use**
> (it just needs a developer app). Email goes out over standard **SMTP**, which you can do
> for free.

---

## 5.1 At-a-glance (everything below is free / open-source / self-hosted)

| Layer | Recommended (default) | Open-source alternatives | Cost |
|-------|----------------------|--------------------------|------|
| Full-stack framework | **Next.js 15 (App Router)**, self-hosted (standalone/Docker) | — (required by brief) | Free |
| Language | **TypeScript** | — | Free |
| Auth | **Auth.js (NextAuth) v5** + LinkedIn OIDC | Lucia, custom | Free |
| Database | **PostgreSQL** (self-hosted, Docker) | — | Free |
| ORM | **Drizzle** | Prisma | Free |
| Object storage | **MinIO** (self-hosted, S3-compatible) or **local filesystem** | SeaweedFS | Free |
| Background jobs | **pg-boss** (job queue *on top of Postgres* — no extra infra) | BullMQ + self-hosted Redis | Free |
| Scheduling | **node-cron** in the worker process | pg-boss cron | Free |
| Email | **Nodemailer + SMTP** (your mailbox / self-hosted MTA) | — | Free |
| **Caption LLM** | **Ollama** running **Llama 3.1 8B** (or **Qwen2.5 7B/14B**) — local | Mistral, Gemma, Phi via Ollama; llama.cpp; vLLM | **Free, local** |
| **Image generation** | **Stable Diffusion (SDXL / SDXL-Turbo)** via **ComfyUI** (API mode) | AUTOMATIC1111 API, `diffusers` (Python), Fooocus | **Free, local** |
| Secrets/encryption | App-layer **AES-256-GCM**, key from env/host keystore | — | Free |
| Validation | **Zod** | — | Free |
| Observability | **Pino** logs + self-hosted **Sentry** (or GlitchTip) | OpenTelemetry + Grafana | Free |

> **The one non-negotiable dependency** is LinkedIn's own API (there is no other compliant
> way to publish to LinkedIn). It is free to call; you only need an approved developer app.

---

## 5.2 The "no API cost" principle — how AI runs locally

Instead of calling a paid cloud model per post, **you run the models once on your own
hardware** and every user's daily post is generated against that shared local inference.
Because this is a daily batch (≈1 caption + 1 image per user per day), modest hardware is
enough.

```
        ┌──────────────── your server / box (Docker Compose) ────────────────┐
        │                                                                     │
  Next.js app ──► pg-boss worker ──► Ollama (Qwen2.5 14B) → caption text       │
        │                        └─► ComfyUI (SDXL/Flux)  → image bytes        │
        │                                                                     │
  Postgres   MinIO/disk   SMTP relay                                          │
        └─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ (only paid-free external call)
                          LinkedIn Posts API  (free)
```

**Confirmed dev/operator hardware (see [Assumptions A11](09-assumptions-open-questions.md)):**
NVIDIA **RTX 5080 Laptop GPU (16 GB VRAM)**, Intel **Core Ultra 9 275HX (24 cores)**,
**32 GB RAM**, ~1.6 TB free. This is firmly on the comfortable path — no turbo/fallback
models are required, and the model choices below are upgraded accordingly.

| Component | This machine (16 GB VRAM) | Recommended model |
|-----------|---------------------------|-------------------|
| Caption LLM | Runs 8–14B on GPU at full speed | **Qwen2.5 14B Instruct** (`qwen2.5:14b`) — upgrade from 8B; Llama 3.1 8B is the lighter option |
| Image | Full **SDXL** in ~2–4 s/image; **Flux.1 dev (fp8/gguf)** fits in 16 GB for higher quality | **SDXL** default; **Flux.1** optional for premium visuals |

**No-GPU fallback (not needed here, kept for portability):** on a machine without a GPU the
`ImageGenerator` can point at a free, keyless endpoint (**Pollinations.ai**) and the
`CaptionGenerator` at a free-tier model endpoint — zero-cost but rate-limited/third-party.
Disabled by default on this hardware. See
[Integrations §6.3](06-integrations.md#63-ai-image-generation-self-hosted).

---

## 5.3 Next.js as full-stack (self-hosted)

Same App Router structure as before; the only deployment change is **self-hosting** (Docker
`next start` / standalone output) instead of a paid platform, and a **long-running worker
process** alongside the web app for jobs.

| Concern | Next.js mechanism |
|---------|-------------------|
| Dashboard UI | React Server Components + Client Components |
| Reads | Server Components querying Postgres (auth-scoped) |
| Writes (save edit, approve, publish) | **Server Actions** (typed, CSRF-protected) |
| OAuth callback, email webhook (optional) | **Route Handlers** (`app/api/.../route.ts`) |
| Scheduled/long work | **pg-boss worker** process (not in the request path) |

```
app/
├─ (dashboard)/ ...            # Today/Inbox, posts/[id], history, settings
├─ onboarding/page.tsx
├─ api/
│  ├─ auth/[...nextauth]/route.ts
│  └─ linkedin/callback/route.ts
├─ actions/                    # Server Actions: save edit, approve, publish, regen image
└─ lib/
   ├─ linkedin/               # LinkedIn adapter (auth, posts, images, rate-limit)
   ├─ ai/                     # CaptionGenerator (Ollama) + ImageGenerator (ComfyUI)
   ├─ email/                  # Nodemailer + React Email templates
   ├─ crypto/                 # AES-256-GCM token encryption
   └─ db/                     # Drizzle schema + queries
worker/
   ├─ index.ts                # pg-boss + node-cron bootstrap
   ├─ daily-generation.ts     # per-user generation job
   ├─ send-digest.ts
   ├─ refresh-tokens.ts
   └─ refresh-metrics.ts      # Phase 2
docker-compose.yml            # next app, worker, postgres, minio, ollama, comfyui
```

---

## 5.4 Why pg-boss for jobs (instead of a paid job runner)

**The problem is unchanged:** generation = LLM call + image generation + storage write,
which is long-running and must retry; the daily run fans out per user across timezones.

**Self-hosted answer: [pg-boss](https://github.com/timgit/pg-boss).** A durable job queue
that lives **inside your existing Postgres** — no Redis, no SaaS, no extra cost.
- Durable jobs with retries/backoff and scheduling (cron).
- Idempotency via unique job keys (`gen:{user_id}:{date}`) → never two posts/day.
- Runs in the `worker/` process next to the app.
- **Alternative:** BullMQ + self-hosted Redis if you prefer Redis tooling (one more
  container). Both are free.

---

## 5.5 AI model choices (local, open-source)

**Captions — Ollama (default).** Run an open-weight instruct model locally:
- **Llama 3.1 8B Instruct** — strong, popular default for marketing/social copy.
- **Qwen2.5 7B/14B Instruct** — excellent writing, permissive Apache-2.0 license.
- **Mistral 7B / Gemma 2 9B** — solid alternatives.
- Selectable per user via `user_settings.preferred_caption_model` (stores the Ollama model
  tag, e.g. `llama3.1:8b`). Bigger models = better copy if you have the VRAM.
- **License note:** check each model's license for commercial redistribution (Qwen2.5 =
  Apache-2.0 is the most permissive; Llama = Meta community license, fine for this use).

**Images — Stable Diffusion via ComfyUI (default).**
- **SDXL** for quality; **SDXL-Turbo / SD-Turbo / SDXL-Lightning** for fast (1–4 step)
  generation, which matters on weaker hardware.
- Driven through ComfyUI's HTTP API (or AUTOMATIC1111's `--api`, or the `diffusers` lib).
- **License note:** verify the specific checkpoint's license permits your use (most SD/SDXL
  base checkpoints allow commercial use under OpenRAIL/Stability community terms; some
  community fine-tunes don't — pick a permissively-licensed checkpoint).
- **Midjourney remains excluded** — Discord-only, no API, and not free for automation.

> Default to the **latest capable open models** available in Ollama/Stable Diffusion at build
> time; the adapters make upgrading a config change, not a rewrite.

---

## 5.6 Email without a paid service

- **Nodemailer** sending over **SMTP** — provider-agnostic and free:
  - Your own mailbox's SMTP (e.g. a Gmail/Workspace account with an app password) for low
    volume, **or**
  - A self-hosted MTA (Postfix), **or** any SMTP relay you already pay nothing extra for.
- Templates authored with **React Email** (compiles to plain HTML — no runtime service).
- Configure **SPF/DKIM/DMARC** on the sending domain for deliverability.
- Open/click tracking via paid webhooks is dropped; `email_logs` records `sent`/`failed`
  from the SMTP result (delivery analytics become best-effort).

---

## 5.7 Build vs. host summary

| Capability | Decision | Rationale |
|------------|----------|-----------|
| Auth/OAuth | Use Auth.js (free) | Don't hand-roll OAuth/session security |
| Job scheduling | pg-boss (free, in Postgres) | Durability + retries without extra infra |
| Email | Nodemailer + SMTP (free) | No transactional-email vendor needed |
| Caption + image AI | Self-host open models | Zero per-call cost, full privacy/control |
| Token encryption | Build thin AES-256-GCM layer | Small, must be in-house and auditable |
| LinkedIn adapter | Build | Must control compliance, rate limits, logging |
| Hosting | Self-host via Docker Compose | No platform fees; runs the local models too |

---

## 5.8 Environments & config

- **Environments:** local → staging → production, all the same Docker Compose stack.
- **Secrets** (env / host keystore, never in code): `DATABASE_URL`, `TOKEN_ENC_KEY`,
  `LINKEDIN_CLIENT_ID/SECRET`, `SMTP_URL` (or host/user/pass), `OLLAMA_BASE_URL`,
  `COMFYUI_BASE_URL`, `MINIO_*`, `NEXTAUTH_SECRET`.
- **No** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / paid-vendor keys are required.
- **Feature flags:** `metrics_enabled`, `image_provider` (`comfyui` | `pollinations`),
  `caption_provider` (`ollama` | `free_tier`), `multi_post_per_day`.

---

## 5.9 Deployment on the target machine (Windows 11 + RTX 5080)

A single Docker Compose file brings up: **next-app**, **worker**, **postgres**, **minio**,
and (optionally) **ollama** + **comfyui**. The only external calls leaving the box are to
**LinkedIn** (publish) and your **SMTP** relay (email) — both free.

**Windows GPU gotcha (important):** Docker Desktop on Windows reaches the NVIDIA GPU only
through the **WSL2 backend + NVIDIA Container Toolkit**. Two clean options:

1. **Recommended — hybrid (simplest, best GPU performance):** run **Ollama** and **ComfyUI**
   *natively on Windows* (both have native installers; Ollama auto-detects the RTX 5080).
   Run the **app, worker, Postgres, MinIO** in Docker Desktop, and point them at the native
   services via `OLLAMA_BASE_URL=http://host.docker.internal:11434` and
   `COMFYUI_BASE_URL=http://host.docker.internal:8188`. No GPU passthrough config needed.
2. **Full Docker:** run everything (incl. GPU containers) under WSL2 with the NVIDIA
   Container Toolkit and `deploy.resources.reservations.devices` / `--gpus all` on the
   ollama + comfyui services. More uniform, but more setup.

**One-time model pulls:** `ollama pull qwen2.5:14b` (and/or `llama3.1:8b`); download an SDXL
checkpoint (and optionally a quantized Flux.1 model) into ComfyUI's `models/` folder.

This single laptop comfortably runs the entire stack for development and for a single
operator's own account. **Scaling to many users in production** would move Postgres/MinIO/app
to a server and the GPU inference to a dedicated GPU host/pool — an infra change, not a code
change (the adapters stay the same).
