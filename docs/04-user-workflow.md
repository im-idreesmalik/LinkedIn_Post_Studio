# 4. User Workflow

> **In plain terms:** This is the day-in-the-life of using the tool. First a one-time setup,
> then the same simple daily loop: get an email → open it → tweak the post → press Publish.
> If the user ignores a day, nothing bad happens and nothing posts.

---

## 4.1 One-time onboarding (first run)

```
Sign up ──► Connect LinkedIn ──► Enter expertise ──► Paste sample posts ──► Set schedule ──► Done
 (email)     (OAuth consent)     (skills, niche,      (2–5 of their own     (timezone +
                                  bio, pillars)        past posts)           daily time)
```

1. **Sign up / sign in** — via "Sign in with LinkedIn" (OIDC) or email. Creates `users`.
2. **Connect LinkedIn for posting** — OAuth consent granting `w_member_social`. Stores the
   author URN + encrypted tokens in `linkedin_accounts`. (Sign-in and posting consent can be
   combined into one authorization request.)
3. **Describe expertise** — skills (weighted), industry, niche, target audience, content
   pillars, tone. Writes `expertise_profiles` + `user_skills`.
4. **Provide voice samples** — user pastes 2–5 of their own representative LinkedIn posts.
   This is the **compliant substitute** for automated post-history reading. Stored in
   `expertise_profiles.sample_posts`.
5. **Set schedule** — timezone + daily generation-prep time + notification email. Writes
   `user_settings`.
6. **Welcome email** confirms setup and what to expect tomorrow.

> A user can use the tool the same day by requesting an immediate "Generate now" instead of
> waiting for the first scheduled run.

---

## 4.2 The daily cycle

```
        ┌─────────────────────────── runs without the user ───────────────────────────┐
        │                                                                              │
  [scheduler fires at user's local prep time]                                          │
        │                                                                              │
        ▼                                                                              │
  Discovery: pick today's topic ──► Caption generated ──► Image generated ──► Stored   │
        │                                                                       (post  │
        │                                                                    in_review)│
        ▼                                                                              │
  Daily email sent: "Today's post is ready" + preview + Review button ─────────────────┘
        │
        │  ===================  HUMAN GATE  ===================
        ▼
  User opens dashboard ──► reviews ──► (optionally) edits caption/image/format
        │
        ▼
  User clicks PUBLISH  ──►  post goes live on LinkedIn  ──►  publish logged
        │                                                         │
        └── or: user skips/discards (post archived, nothing posts)┘
                                                                  ▼
                                                   (Phase 2) metrics collected later
```

### Timing example (user in `Asia/Dubai`, prep time 07:00)
| Local time | Event |
|------------|-------|
| 07:00 | Scheduler fires; generation job runs (topic → caption → image → stored) |
| 07:01 | "Today's post is ready" email sent |
| 08:30 | User opens email over coffee, taps **Review & Publish** |
| 08:33 | User tightens the hook, regenerates the image once |
| 08:34 | User clicks **Publish** → live on LinkedIn |

---

## 4.3 Key behaviors & edge cases

| Situation | Behavior |
|-----------|----------|
| User does nothing today | Post stays `in_review`; **nothing is published**; it remains in the backlog until acted on or it `expires` after `retention_days` |
| User edits then publishes | Edits saved as `post_revisions`; `edited_caption` used; published normally |
| User discards | Post `archived`; no LinkedIn call |
| Generation failed | `generation_failed` email with a "Retry" action; no broken post shown |
| LinkedIn disconnected/expired | Generation still runs (draft is created); Publish is blocked with a "Reconnect LinkedIn" prompt; reconnect email sent |
| User wants 2 posts in a day | MVP = one/day; manual "Generate another" can create an additional same-day draft (still review-gated). True multi-per-day scheduling is Phase 2 |
| User pauses the service | `user_settings.daily_generation_enabled=false`; scheduler skips them |
| Double-click Publish | Publish lock + status check → exactly one LinkedIn post |

---

## 4.4 Post state machine

The only allowed transitions. Anything else is rejected by the application layer (and many
illegal *states* are impossible thanks to the DB enums).

```
                 generation
   queued ─────────────────────► generating
      │                              │
      │ (job skipped/disabled)       ├──► in_review ──► edited ──► approved ──► published
      ▼                              │        │           │          │
   archived/expired                  │        │           │          └──(API error)──► publish_failed ──► (retry) approved
                                     │        │           │
                                     │        └───────────┴──► archived   (user discards)
                                     │
                                     └──(error)──► generation_failed ──► (retry) generating
```

**Invariants**
- `published` is reachable **only** from `approved`, and `approved` is reachable **only** by
  the user's explicit Publish action in the dashboard.
- No background job transitions a post into `approved` or `published`.
- `publish_failed` retries re-enter `approved` (still user-initiated retry), never auto-loop.

---

## 4.5 What the user controls vs. what is automated

| Automated (no user needed) | User-controlled (gate) |
|----------------------------|------------------------|
| Topic discovery | Final topic acceptance (implicit via publish) |
| Caption drafting | Caption edits |
| Image generation | Image regenerate/replace/remove |
| Storing the draft | Approving the draft |
| Sending the daily email | **Publishing to LinkedIn** |
| (Phase 2) Pulling metrics | Scheduling, pausing, profile updates |

This table is the product's contract: **the machine prepares, the human decides.**
