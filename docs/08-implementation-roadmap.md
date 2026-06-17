# 8. Implementation Roadmap

> **In plain terms:** This is the build order. We ship the smallest thing that delivers the
> core promise first (a daily, review-and-publish loop for one person), then layer on polish,
> analytics, and scale. Each phase ends with something usable.

---

## 8.1 Phasing principle

The core promise is the **daily generate → review → publish loop with a mandatory human
gate**. MVP must deliver that end-to-end for a single user before anything else. Everything
that makes it *smarter*, *prettier*, or *bigger* is later.

```
Phase 0  Foundations      ──►  Phase 1  MVP loop        ──►  Phase 2  Smarter & richer  ──►  Phase 3  Scale & growth
(infra, auth, schema)          (the core promise)             (analytics, better AI)         (multi-user polish, billing)
```

---

## 8.2 Phase 0 — Foundations (enabling work)

| Item | Detail |
|------|--------|
| Repo & Docker stack | Next.js 15 App Router + worker, Compose for Postgres/MinIO/Ollama/ComfyUI, CI, environments |
| Database | Postgres + Drizzle; apply schema from [Doc 2](02-database-schema.md) |
| Auth | Auth.js + Sign in with LinkedIn (OIDC) |
| Crypto | AES-256-GCM token helpers; encryption key from env/host keystore (not in DB) |
| Local models | Pull an Ollama model (e.g. `llama3.1:8b`) + an SDXL checkpoint into ComfyUI |
| Adapters scaffolding | Empty `CaptionGenerator` / `ImageGenerator` / `LinkedInClient` / `EmailService` interfaces |

**Exit criteria:** a user can sign up, sign in, and the schema/encryption are in place.

---

## 8.3 Phase 1 — MVP (the core loop)

**Goal:** one professional can go from onboarding to a published, human-reviewed post, daily.

### In scope
| Capability | Notes |
|------------|-------|
| Onboarding | Skills/expertise input, paste 2–5 sample posts, set schedule/timezone |
| Connect LinkedIn | OAuth `w_member_social`; encrypted token storage |
| Content discovery | Local LLM (Ollama) topic suggestion from expertise + samples (basic ranking/dedup) |
| Caption generation | Local LLM (Ollama); hook + body + CTA + hashtags; 3,000-char enforcement |
| Image generation | Self-hosted Stable Diffusion (SDXL/ComfyUI); normalize to LinkedIn ratio; store in MinIO/disk |
| Daily job | pg-boss worker + node-cron; one post/user/day; idempotent |
| Storage | Posts/images/logs in Postgres + MinIO/local disk |
| Daily email | SMTP (Nodemailer) digest: "today's post is ready" + preview + deep link |
| Review dashboard | Today/inbox, editor (caption + image regen/replace/remove), LinkedIn preview, char counter |
| **Publish (gated)** | Server-enforced ownership + state checks; Posts API + Images API; `publish_logs` |
| Failure UX | Generation-failed email/retry; reconnect-LinkedIn flow; rate-limit handling |
| Security baseline | Token encryption, tenant scoping, audit log, account delete + token revoke |

### Explicitly NOT in MVP
- Performance metrics/analytics (LinkedIn access is restricted — see
  [§6.1.8](06-integrations.md#618-metrics-retrieval-phase-2-verify-access-tier)).
- LinkedIn data-export upload & analysis.
- Multiple posts/day, complex scheduling.
- Multiple image checkpoints/models (one SDXL checkpoint at first).
- Billing.

**Exit criteria:** end-to-end daily loop works for a real user; nothing publishes without an
explicit click; all writes logged.

---

## 8.4 Phase 2 — Smarter & richer

| Theme | Capability |
|-------|------------|
| Analytics | `post_metrics` populated where API permits; **manual metric entry** fallback; history dashboard; weekly summary email |
| Better discovery | Embeddings-based dedup; LinkedIn **data-export upload** → richer voice modeling; content-pillar balancing; topic calendar |
| Better generation | Multiple caption variants to choose from; A/B hooks; multiple image candidates; swap/upgrade local models & checkpoints |
| Workflow | Approve-and-schedule-for-later (still pre-approved by the user, just queued to post at a chosen time); regenerate-with-feedback |
| Reliability | GPU/queue capacity tuning; proactive token refresh; alerting on worker/inference failures |

> **Note on "schedule for later":** even a scheduled publish must originate from a draft the
> user has explicitly approved — the system never composes-and-posts unattended. This keeps
> the mandatory-review constraint intact while adding convenience.

**Exit criteria:** users get feedback on what works and richer creative control; the gate is
preserved.

---

## 8.5 Phase 3 — Scale & growth

| Theme | Capability |
|-------|------------|
| Multi-user polish | Onboarding funnel, team-of-one billing/subscriptions, usage limits |
| Compute controls | Turbo/smaller models, image caching, batch scheduling to smooth GPU load, horizontal inference pool |
| Expanded scheduling | Multiple posts/day, weekly cadence presets, content series |
| Deeper analytics | Trend detection, best-time-to-post suggestions (from the user's own data) |
| Platform breadth (optional) | Abstract the publishing adapter to support other networks behind the same review gate |
| Compliance scale | Data-processing agreements, SOC2-style controls if selling to prosumers |

---

## 8.6 Rough sequencing & effort (indicative)

> Estimates assume a small team (1–2 full-stack engineers). Treat as planning aids, not
> commitments; the LinkedIn product-approval lead time is the main external dependency.

| Phase | Indicative effort | Key risk/dependency |
|-------|-------------------|---------------------|
| Phase 0 | ~1–2 weeks | Docker stack + encryption-key setup; Ollama/ComfyUI install + model pulls; Auth.js + LinkedIn app creation |
| Phase 1 (MVP) | ~4–6 weeks | **LinkedIn "Share on LinkedIn" approval**, local model prompt/quality tuning, GPU/inference throughput |
| Phase 2 | ~4–8 weeks | LinkedIn metrics access (may stay manual) |
| Phase 3 | ongoing | Scale, billing, multi-platform |

**Critical path:** LinkedIn Developer app + `w_member_social` product approval gates the
publish feature — start that paperwork on **day one** of Phase 0, in parallel with build.

---

## 8.7 Definition of done for the MVP (checklist)

- [ ] User completes onboarding incl. sample-post input and LinkedIn connect.
- [ ] A scheduled daily job creates exactly one reviewable post (caption + image) per user.
- [ ] Daily email arrives with preview + working deep link.
- [ ] Dashboard lets the user edit caption, regenerate/replace/remove image, see live preview.
- [ ] Publish works against the real LinkedIn Posts API and is logged.
- [ ] **No code path publishes without an explicit user click on an approvable, owned post.**
- [ ] Tokens encrypted at rest; account deletion purges data and revokes the LinkedIn token.
- [ ] Failures (generation, image, email, publish, token) degrade gracefully with clear UX.
