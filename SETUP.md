# Setup & Run — LinkedIn Post Studio

Local-first, **no paid APIs**. Captions use Gemini's free tier (Ollama as offline fallback),
images use Pollinations (free, keyless), email goes over free SMTP, jobs run in Postgres
(pg-boss), images live in MinIO. The only external call is LinkedIn's (free) API.

This guide targets the confirmed dev machine: **Windows 11 + RTX 5080 (16 GB)**.

---

## 0. Prerequisites

| Tool | Why | Notes |
|------|-----|-------|
| **Node.js 20+** | app + worker | https://nodejs.org |
| **Docker Desktop** | Postgres + MinIO (+ optional app/worker) | WSL2 backend |
| **Ollama** (native Windows) | local caption fallback | https://ollama.com — auto-uses the RTX 5080 |
| **A LinkedIn Developer app** | publishing | see §5 |
| **An SMTP account** | daily email | your mailbox + app password is fine |

> **Why native Ollama?** On Windows, Docker reaches the GPU only via WSL2 + the NVIDIA
> Container Toolkit. Running Ollama natively is simpler and faster; the app/worker reach it
> through `host.docker.internal`. Captions use Gemini (free-tier) by default, with Ollama as
> the offline fallback. Images use Pollinations (free, keyless) — nothing to install.

---

## 1. Install local models

Captions/topics use **Gemini 2.5 Flash** (free-tier) by default. Ollama is only the offline
fallback — pull a model if you want it:
```powershell
# Optional offline caption fallback (14B is great on a 16 GB GPU)
ollama pull qwen2.5:14b      # or: ollama pull llama3.1:8b
```
Images are generated via **Pollinations** (free, keyless) — nothing to install.

## 2. Configure environment

```powershell
Copy-Item .env.example .env
Copy-Item .env.example .env.local
```
Fill in both files. Generate the two secrets:
```powershell
# AUTH_SECRET and TOKEN_ENC_KEY each need a base64 32-byte value
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Set `LINKEDIN_CLIENT_ID/SECRET` (from §5) and `SMTP_URL` / `EMAIL_FROM`.

> `.env.local` is read by Next.js (the app). `.env` is read by the worker and drizzle-kit.

## 3. Start infrastructure (Postgres + MinIO)

```powershell
docker compose up -d postgres minio minio-setup
```
This also creates the `post-images` bucket. MinIO console: http://localhost:9001
(minioadmin / minioadmin).

## 4. Install deps & create the database schema

```powershell
npm install
npm run db:push        # creates all tables from lib/db/schema.ts
```

## 5. LinkedIn Developer app (one-time)

1. Create an app at https://www.linkedin.com/developers/ (associate a Company Page).
2. Request products: **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
3. Add the OAuth **redirect URL**: `http://localhost:3000/api/auth/callback/linkedin`
4. Put the client id/secret in `.env` and `.env.local`.
5. `LINKEDIN_API_VERSION` is monthly (`YYYYMM`) — **[VERIFY]** the current value in LinkedIn's docs.

## 6. Run the app + worker

Two terminals (or use Docker for these too — see §7):
```powershell
# Terminal A — the web app
npm run dev            # http://localhost:3000

# Terminal B — the background worker (generation, email, token refresh)
npm run worker
```

### First run
1. Open http://localhost:3000 → **Sign in with LinkedIn** (grants posting scope too).
2. Go to **Settings** → fill in expertise, paste 2–5 of your own past posts, set timezone/hour.
3. Click **Generate now** on the home page. The worker drafts a post (topic → caption → image).
4. Open the draft, edit, and click **Publish to LinkedIn**. (Nothing posts until you click.)
5. The daily schedule fires automatically at your local prep hour via the worker's hourly tick.

---

## 7. (Optional) Run everything in Docker

```powershell
docker compose up -d --build      # postgres, minio, app, worker
```
The `app` and `worker` services reach native Ollama via `host.docker.internal`
(already wired in docker-compose.yml). For **full-Docker GPU inference**, add an `ollama`
service with the NVIDIA Container Toolkit under WSL2 and point `OLLAMA_BASE_URL` at it —
not required for the default setup.

---

## 8. How the mandatory review gate is enforced (for reviewers)

- The ONLY path to LinkedIn is `approveAndPublish` in [app/actions/posts.ts](app/actions/posts.ts),
  a Server Action triggered by the **Publish** button.
- It (1) verifies the session owns the post, (2) atomically claims it only from a reviewable
  state (so a double-click can't double-post), (3) requires a live LinkedIn connection,
  then calls the Posts API and logs the result.
- **No** worker job, cron, or webhook ever calls the publish function. Generation and email
  are fully automated; publishing is not.

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `TOKEN_ENC_KEY must be a base64-encoded 32-byte key` | Regenerate with the node one-liner in §2 |
| Image generation fails | Pollinations' free endpoint is occasionally flaky; the app retries 3×. Regenerate from the editor if needed |
| Captions fail | Set `GEMINI_API_KEY` (free-tier), or run Ollama with `OLLAMA_CAPTION_MODEL` pulled for the offline fallback |
| Publish says "reconnect" | Token expired/no refresh token — click Connect LinkedIn in Settings |
| App can't reach DB from Docker | Use the in-container `DATABASE_URL` (postgres host), already set in compose |
| Images 404 in the app | Confirm the `post-images` bucket exists and is download-public (the `minio-setup` service does this) |

## 10. What maps to the spec

| Spec doc | Code |
|----------|------|
| [02 — schema](docs/02-database-schema.md) | [lib/db/schema.ts](lib/db/schema.ts) |
| [03 — content engine / dashboard / LinkedIn](docs/03-feature-specifications.md) | `lib/ai/*`, `lib/content/*`, `app/*`, `lib/linkedin/*` |
| [04 — workflow / state machine](docs/04-user-workflow.md) | `app/actions/posts.ts`, `app/page.tsx` |
| [06 — integrations](docs/06-integrations.md) | `lib/linkedin/client.ts`, `lib/email/service.ts`, `lib/ai/image.ts` |
| [07 — security](docs/07-security-privacy.md) | `lib/crypto/tokens.ts`, encrypted columns, redacted `lib/logger.ts` |
| [08 — roadmap (this is the MVP)](docs/08-implementation-roadmap.md) | the whole scaffold |
