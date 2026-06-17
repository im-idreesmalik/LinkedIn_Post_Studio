# 9. Assumptions & Open Questions

> **In plain terms:** Before the team writes much code, a few decisions and reality-checks
> need a stakeholder's sign-off. This page lists every assumption baked into the spec and
> every question whose answer could change the build. **Read this first.**

---

## 9.1 Assumptions made (flag if any are wrong)

| # | Assumption | Impact if wrong |
|---|------------|-----------------|
| A1 | The target is a **single individual managing their own** account (not agencies posting for clients). | Multi-account/agency mode changes auth, data model, and LinkedIn product tier. |
| A2 | **One post per day** is the MVP cadence; more is Phase 2+. | Higher cadence raises rate-limit and cost considerations. |
| A3 | A **relational DB (Postgres)** is acceptable despite the brief mentioning Sheets/Airtable. See [§9.3](#93-storage-engine-decision). | Using Sheets/Airtable instead limits auth, encryption, concurrency. |
| A4 | Per the **no-paid-API** constraint, images use **self-hosted Stable Diffusion (SDXL via ComfyUI)**; Midjourney is excluded (no API). | If Midjourney aesthetics are required, only manual upload is possible. |
| A5 | Per the **no-paid-API** constraint, captions use a **local open-weight model via Ollama** (Llama 3.1 / Qwen2.5); a free-tier API is an optional fallback. | A mandated paid model (e.g. Claude/GPT) only changes the adapter — but reintroduces API cost. |
| A6 | The user will **paste sample posts / upload their own export** to satisfy "analyze historical posts," because API access doesn't allow reading them. See [§9.2](#92-the-historical-posts-problem-most-important). | If automated history reading is a hard requirement, **it is not compliantly achievable** — scope must change. |
| A7 | **Performance metrics** may be **manual or limited** at launch due to LinkedIn access restrictions. | If rich auto-analytics is required for MVP, timeline/LinkedIn-partnership needs change. |
| A8 | Everything is **self-hosted via Docker Compose** (Next.js + Postgres + MinIO + Ollama + ComfyUI + worker); no paid platform required. | Managed/serverless hosting would re-introduce cost and can't easily host the local models. |
| A9 | "Email notification" means a **transactional daily digest** over **free SMTP**, opt-in at onboarding. | Marketing-style emails would need different consent/unsubscribe handling. |
| A10 | A LinkedIn **Developer app + product approval** can be obtained for this use case. | Approval delays/denials directly gate the publish feature. |
| A11 | **CONFIRMED** — dev/operator hardware is an RTX 5080 Laptop (16 GB VRAM), Core Ultra 9 275HX, 32 GB RAM, ~1.6 TB free. Ample for full SDXL/Flux + a 14B caption model locally. | Resolved for dev + single-operator use. Production multi-user would add a dedicated GPU host (infra change only). |

---

## 9.2 The "historical posts" problem (most important)

**The brief asks the system to base discovery partly on "analysis of the user's existing
LinkedIn profile and historical posts."**

**Reality:** LinkedIn does **not** provide a self-serve API scope for an app to read a
member's feed, profile detail beyond basic OIDC fields, or post history. Programmatically
scraping that data **violates LinkedIn's Terms** and risks the developer app and the user's
account.

**Compliant ways we satisfy the *intent*:**
1. **User-pasted samples** (MVP) — the user provides 2–5 representative past posts at
   onboarding; we model their voice/topics from those.
2. **User self-export upload** (Phase 2) — LinkedIn lets any member download their own data
   archive; the user uploads it and we analyze their *own* exported posts. This is compliant
   because it's user-initiated handling of the user's own data.
3. **OIDC profile fields** — name/headline-level data available via sign-in scopes (limited).

**Decision needed:** confirm this compliant substitution is acceptable. If automated,
real-time reading of LinkedIn history is a non-negotiable requirement, **the feature as
literally described cannot be built within LinkedIn's rules** and scope must be revised.

---

## 9.3 Storage-engine decision

The brief lists "Google Sheets, Airtable, etc." as storage options. Recommendation:

| Option | Verdict |
|--------|---------|
| **PostgreSQL** (recommended) | Needed for real auth, **encrypted token storage**, concurrency, relational integrity, RLS tenant isolation. |
| Airtable / Google Sheets | Fine for a **no-code prototype or a personal single-user hack**, but cannot securely hold OAuth tokens, lacks proper access control, and won't scale to multi-user. |

**Recommendation:** Postgres for the product; a Sheet could optionally **mirror** published
posts for a user who wants a familiar view (nice-to-have, Phase 2). **Decision needed:**
confirm Postgres.

---

## 9.4 Open questions for stakeholders

| # | Question | Why it matters |
|---|----------|----------------|
| Q1 | Is the compliant "paste/upload your own posts" approach to history acceptable? (see §9.2) | Determines whether the discovery feature is buildable as-is. |
| Q2 | Is **manual/limited metrics** acceptable for launch, with richer analytics later? | Sets analytics scope and LinkedIn access strategy. |
| Q3 | Single-account individual only, or must we anticipate **agency/multi-account** soon? | Affects data model and LinkedIn product tier now. |
| Q4 | Confirm **local open models** (Ollama Llama 3.1 for captions, SDXL/ComfyUI for images)? Any preferred specific models/licenses? | Adapter + model-download config. |
| ~~Q5~~ | **RESOLVED** — inference hosts on an RTX 5080 (16 GB VRAM). Default to full **SDXL** (Flux.1 optional) + **Qwen2.5 14B**; no fallback needed for dev. | Image/caption model choice now locked. |
| Q6 | Brand/safety constraints on AI imagery (e.g., no faces, on-brand palette)? | Shapes image prompting + moderation rules. |
| Q7 | Required compliance posture (GDPR only, or CCPA/others; any SOC2 ambitions)? | Affects data handling, processor agreements, logging. |
| Q8 | Is "approve now, auto-post at a later chosen time" desired (Phase 2)? It stays review-gated. | Confirms the gate definition before we build scheduling. |
| Q9 | Hosting/infra constraints (must it be AWS-only, on-prem, EU data residency)? | Could change provider choices. |
| Q10 | Will the business obtain the LinkedIn Developer app, and who owns that relationship? | It's on the critical path for publishing. |

---

## 9.5 Risks register (top items)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| LinkedIn product approval slow/denied | Medium | High (blocks publish) | Apply day one; keep generation/review usable without publish during review |
| LinkedIn API version/scope changes | Medium | Medium | Adapter isolation; `[VERIFY]` checklist; monthly-version header config |
| Metrics access never granted | Medium | Low–Medium | Manual-entry fallback already designed |
| GPU/compute capacity at scale | Medium | Medium | Turbo models, image caching, batch scheduling, horizontal inference pool; keyless fallback as overflow |
| ~~No suitable hardware to self-host models~~ | Resolved | — | RTX 5080 (16 GB) confirmed — ample for local SDXL/Flux + 14B LLM |
| Token compromise | Low | High | Encryption (key outside DB), revocation runbook, audit logs |
| Users expect auto-posting | Low | Medium | The gate is the product; communicate clearly in onboarding |

---

## 9.6 Recommended pre-build sign-offs

Before Phase 0 work begins, get explicit stakeholder answers on **Q1, Q2, Q3, and Q10** —
these four can materially change scope, data model, or timeline. The rest can be resolved
during Phase 0/1 without rework.
