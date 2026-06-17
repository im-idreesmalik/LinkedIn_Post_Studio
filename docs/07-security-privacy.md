# 7. Security & Data Privacy

> **In plain terms:** This tool holds the keys to someone's LinkedIn account and writes posts
> in their name. That makes security non-optional. This section covers how we protect the
> LinkedIn credentials, the user's content, and their personal data — and how we stay on the
> right side of privacy law.

---

## 7.1 What's sensitive here

| Asset | Sensitivity | Why |
|-------|-------------|-----|
| LinkedIn OAuth tokens | **Critical** | Can post as the user; theft = account abuse |
| User email | Medium (PII) | Login + notifications |
| Expertise profile / sample posts | Low–Medium | User's own content |
| Generated posts & images | Low–Medium | Pre-publish drafts |
| Publish logs | Medium | Contain post content + URNs |

The threat model centers on **token compromise** and **cross-tenant data leakage**.

---

## 7.2 Credential & token protection

**Encryption at rest (application-layer):**
- LinkedIn access/refresh tokens are encrypted with **AES-256-GCM** before they touch the
  database. The DB columns are `BYTEA` ciphertext + per-record nonce
  (`linkedin_accounts.access_token_ciphertext` / `_nonce`). Plaintext tokens never land in a
  text column, a log, or the client.
- The **encryption key** is supplied via an **environment variable / host keystore**
  (e.g. Docker secret, OS keyring, or a self-hosted Vault) — **not** in the database and
  **not** alongside the ciphertext. Compromising the DB alone does not yield usable tokens.
  (No paid KMS is required; a self-hosted secret store is fine.)
- **Key rotation:** support versioned keys (store key id with each record) so keys can be
  rotated without downtime; re-encrypt lazily or via a migration job.

**Encryption helper (shape):**
```ts
// lib/crypto/tokens.ts
encryptToken(plaintext): { ciphertext: Buffer; nonce: Buffer; keyId: string }
decryptToken({ ciphertext, nonce, keyId }): string
```

**Access discipline:**
- Tokens are decrypted **only** server-side, **only** at the moment of a LinkedIn API call,
  and never serialized into a response, Server Component payload, or log line.
- The browser never receives a token. All LinkedIn calls originate from the server / job
  runner.

**In transit:** TLS for the public app and outbound LinkedIn/SMTP. Local model calls
(Ollama/ComfyUI) stay on the private Docker network and never traverse the public internet.

---

## 7.3 Authentication & authorization

- **AuthN:** Auth.js sessions; secure, httpOnly, sameSite cookies; `NEXTAUTH_SECRET` from
  secrets. Optional MFA via the identity provider.
- **AuthZ (tenant isolation):** every query is scoped by `user_id` from the session. Defense
  in depth via **Postgres Row-Level Security** policies so even a query bug cannot cross
  tenants. The publish path additionally re-checks ownership before calling LinkedIn.
- **CSRF:** Server Actions carry built-in protections; webhooks verify provider signatures;
  OAuth uses a `state` parameter validated on callback.
- **Least privilege:** the app's DB role has only needed grants; storage credentials are
  scoped to the bucket; API keys are per-environment.

---

## 7.4 Application security baseline

| Control | Implementation |
|---------|----------------|
| Input validation | **Zod** on all Server Action inputs, webhook bodies, and external API responses |
| Output encoding | React escaping by default; sanitize any rendered user/AI HTML |
| Rate limiting | Per-user + per-IP limits on auth, publish, and generation endpoints |
| Secrets management | Env/secret-manager only; never committed; rotated; per-env |
| Dependency hygiene | Automated dependency + vulnerability scanning (e.g. Dependabot) in CI |
| Error handling | No stack traces / secrets in client responses; Sentry server-side |
| Webhook/callback security | OAuth `state` validation on the LinkedIn callback; signature verification on any inbound webhook + replay protection |
| Audit trail | `audit_logs` for connect, publish, export, delete, settings changes |
| Idempotency | Keys on publish + generation to prevent duplicate side effects |

---

## 7.5 Data privacy & compliance (GDPR / CCPA)

**Lawful basis & consent**
- Explicit consent at onboarding for: storing profile data, generating content, and posting
  to LinkedIn on the user's behalf. Consent is logged.
- Clear, plain-language **Privacy Policy** and **Terms** describing what's stored, why, for
  how long, and which third parties process data — which here is minimal: **LinkedIn** and
  your **SMTP relay** (the AI runs locally; storage is self-hosted).

**Data subject rights**
- **Right to access / export:** "Download my data" produces the user's profile, posts,
  images, and logs.
- **Right to erasure:** "Delete my account" cascades (`ON DELETE CASCADE`) to remove all
  user rows, purges images from object storage, and **revokes the LinkedIn token** with
  LinkedIn. Recorded in `audit_logs` (action `data.deleted`).
- **Right to rectification:** profile/settings editable anytime.

**Data minimization & retention**
- Store only what's needed; **do not** store LinkedIn data we aren't permitted to (e.g. no
  scraped feed). Sample posts are user-provided and deletable.
- Unactioned drafts expire after `user_settings.retention_days` (default 30) and are purged.
- Logs retain redacted payloads only; PII in logs is minimized and time-boxed.

**Third-party processors (minimal by design)**
- Because the AI runs **locally/self-hosted**, prompts and sample posts are **never sent to a
  third-party AI provider** — a meaningful privacy advantage of this stack. The processor
  list shrinks to: **LinkedIn** (publish), your **SMTP relay** (email delivery), and your own
  **hosting** (which you control). Disclose these in the privacy policy.
- If the optional no-GPU **keyless/free-tier fallback** is enabled, prompts *would* leave to
  that endpoint — treat it as a processor and disclose it, or keep it disabled for strict
  privacy.

**Token revocation on disconnect**
- "Disconnect LinkedIn" deletes stored tokens and calls LinkedIn's token revocation so no
  residual access remains.

---

## 7.6 Operational security

- **Backups:** encrypted, tested restores; backups also subject to deletion requests.
- **Monitoring/alerting:** alert on auth anomalies, spikes in publish failures, token-refresh
  failures, webhook signature failures.
- **Least-exposure infra:** DB not publicly reachable; access via the app/job runner only;
  IP allow-listing where the provider supports it.
- **Incident response:** documented runbook for token-compromise (mass-revoke + force
  reconnect), data breach notification obligations under GDPR/CCPA.

---

## 7.7 Security non-negotiables (the short list)

1. LinkedIn tokens **encrypted at rest**, key held outside the DB (env/host keystore),
   **never** sent to the browser.
2. **Mandatory human review** before publish — also a safety control, not just UX.
3. **Tenant isolation** enforced at the DB (RLS) *and* app layer.
4. **No scraping** of LinkedIn — compliant inputs only.
5. **Full account deletion** revokes tokens and purges all data.
6. Every publish is **audited**.
