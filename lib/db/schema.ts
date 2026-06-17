/**
 * Drizzle schema — mirrors docs/02-database-schema.md.
 * PostgreSQL. Tokens are stored as bytea ciphertext (see lib/crypto/tokens.ts).
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  time,
  jsonb,
  numeric,
  customType,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** Postgres BYTEA type for encrypted token storage (never plaintext). */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ---------------------------------------------------------------- enums
export const accountStatus = pgEnum("account_status", [
  "active",
  "paused",
  "suspended",
  "deleted",
]);
export const oauthStatus = pgEnum("oauth_status", [
  "connected",
  "expired",
  "revoked",
  "error",
]);
export const postStatus = pgEnum("post_status", [
  "queued",
  "generating",
  "in_review",
  "edited",
  "approved",
  "published",
  "generation_failed",
  "publish_failed",
  "archived",
  "expired",
]);
export const imageProvider = pgEnum("image_provider", [
  "stable_diffusion",
  "pollinations",
  "gemini",
  "manual_upload",
  "none",
]);
export const imageStatus = pgEnum("image_status", [
  "pending",
  "generating",
  "ready",
  "failed",
  "uploaded_to_linkedin",
]);
export const topicSource = pgEnum("topic_source", [
  "expertise",
  "past_posts",
  "niche_pattern",
  "manual",
  "trending",
]);
export const topicStatus = pgEnum("topic_status", [
  "suggested",
  "selected",
  "used",
  "dismissed",
]);
export const emailType = pgEnum("email_type", [
  "daily_digest",
  "generation_failed",
  "reconnect_linkedin",
  "welcome",
  "weekly_summary",
]);
export const emailStatus = pgEnum("email_status", [
  "queued",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "failed",
]);
export const jobType = pgEnum("job_type", [
  "daily_generation",
  "email_digest",
  "metrics_refresh",
  "token_refresh",
]);
export const jobStatus = pgEnum("job_status", [
  "scheduled",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

// ---------------------------------------------------------------- users
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  authProvider: text("auth_provider").notNull().default("linkedin"),
  authSubject: text("auth_subject"),
  status: accountStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  generationTimeLocal: time("generation_time_local").notNull().default("07:00"),
  notificationEmail: text("notification_email"),
  dailyGenerationEnabled: boolean("daily_generation_enabled").notNull().default(true),
  imageGenerationEnabled: boolean("image_generation_enabled").notNull().default(true),
  defaultImageProvider: imageProvider("default_image_provider")
    .notNull()
    .default("pollinations"),
  defaultTone: text("default_tone").default("professional, warm, concise"),
  preferredCaptionModel: text("preferred_caption_model").default("gemini-2.5-flash"),
  retentionDays: integer("retention_days").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------------- expertise inputs
export const expertiseProfiles = pgTable("expertise_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  headline: text("headline"),
  bio: text("bio"),
  industry: text("industry"),
  niche: text("niche"),
  targetAudience: text("target_audience"),
  contentPillars: jsonb("content_pillars").$type<string[]>().default([]),
  tonePreferences: jsonb("tone_preferences").$type<Record<string, unknown>>().default({}),
  samplePosts: jsonb("sample_posts").$type<string[]>().default([]),
  fingerprint: text("fingerprint"), // derived voice/expertise summary
  dataExportRef: text("data_export_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userSkills = pgTable(
  "user_skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    proficiency: text("proficiency"),
    weight: numeric("weight").default("1.0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userName: uniqueIndex("user_skills_user_name").on(t.userId, t.name),
  }),
);

// --------------------------------------------------- linkedin connection
export const linkedinAccounts = pgTable(
  "linkedin_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    linkedinMemberUrn: text("linkedin_member_urn").notNull(),
    linkedinSub: text("linkedin_sub"),
    displayName: text("display_name"),
    accessTokenCiphertext: bytea("access_token_ciphertext").notNull(),
    accessTokenNonce: bytea("access_token_nonce").notNull(),
    refreshTokenCiphertext: bytea("refresh_token_ciphertext"),
    refreshTokenNonce: bytea("refresh_token_nonce"),
    scopes: text("scopes").array().notNull().default([]),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    status: oauthStatus("status").notNull().default("connected"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
  },
  (t) => ({
    userUrn: uniqueIndex("linkedin_user_urn").on(t.userId, t.linkedinMemberUrn),
    userIdx: index("idx_linkedin_accounts_user").on(t.userId),
  }),
);

// ------------------------------------------------------- topic discovery
export const topicSuggestions = pgTable(
  "topic_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    angle: text("angle"),
    format: text("format"),
    rationale: text("rationale"),
    source: topicSource("source").notNull().default("expertise"),
    score: numeric("score"),
    status: topicStatus("status").notNull().default("suggested"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userStatus: index("idx_topic_user_status").on(t.userId, t.status),
  }),
);

// ---------------------------------------------------------------- posts
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id").references(() => topicSuggestions.id, {
      onDelete: "set null",
    }),
    scheduledDate: date("scheduled_date").notNull(),
    status: postStatus("status").notNull().default("queued"),

    hook: text("hook"),
    body: text("body"),
    cta: text("cta"),
    hashtags: jsonb("hashtags").$type<string[]>().default([]),
    captionFinal: text("caption_final"),
    editedCaption: text("edited_caption"),

    format: text("format"),
    charCount: integer("char_count"),
    selectedImageId: uuid("selected_image_id"),

    captionModel: text("caption_model"),
    generationMeta: jsonb("generation_meta").$type<Record<string, unknown>>().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => ({
    // Non-unique: multiple drafts per day are allowed (kept until discarded).
    userDate: index("idx_posts_user_date").on(t.userId, t.scheduledDate),
    userStatus: index("idx_posts_user_status").on(t.userId, t.status),
  }),
);

// --------------------------------------------------------------- images
export const postImages = pgTable(
  "post_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    provider: imageProvider("provider").notNull(),
    prompt: text("prompt"),
    storageUrl: text("storage_url"),
    thumbnailUrl: text("thumbnail_url"),
    width: integer("width"),
    height: integer("height"),
    aspectRatio: text("aspect_ratio"),
    altText: text("alt_text"),
    status: imageStatus("status").notNull().default("pending"),
    linkedinAssetUrn: text("linkedin_asset_urn"),
    isSelected: boolean("is_selected").notNull().default(false),
    generationMeta: jsonb("generation_meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    postIdx: index("idx_post_images_post").on(t.postId),
  }),
);

// ------------------------------------------------------- edit history
export const postRevisions = pgTable(
  "post_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    captionSnapshot: text("caption_snapshot"),
    imageId: uuid("image_id").references(() => postImages.id, { onDelete: "set null" }),
    editedBy: uuid("edited_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    postVersion: uniqueIndex("post_revisions_post_version").on(t.postId, t.versionNo),
  }),
);

// ------------------------------------------------------- publish logs
export const publishLogs = pgTable(
  "publish_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    linkedinPostUrn: text("linkedin_post_urn"),
    requestPayload: jsonb("request_payload"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    succeeded: boolean("succeeded").notNull().default(false),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    postIdx: index("idx_publish_logs_post").on(t.postId),
  }),
);

// ----------------------------------------------------- metrics (Phase 2)
export const postMetrics = pgTable("post_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  linkedinPostUrn: text("linkedin_post_urn"),
  impressions: integer("impressions"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  clicks: integer("clicks"),
  engagementRate: numeric("engagement_rate"),
  source: text("source").default("linkedin_api"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
});

// --------------------------------------------------------- email logs
export const emailLogs = pgTable(
  "email_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    type: emailType("type").notNull(),
    providerMessageId: text("provider_message_id"),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    status: emailStatus("status").notNull().default("queued"),
    payload: jsonb("payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_email_logs_user").on(t.userId, t.createdAt),
    providerMsg: index("idx_email_provider_msg").on(t.providerMessageId),
  }),
);

// --------------------------------------------------- job run audit
export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: jobType("type").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: jobStatus("status").notNull().default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").unique(),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_gen_jobs_user").on(t.userId, t.scheduledFor),
  }),
);

// ------------------------------------------------------- general audit
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTime: index("idx_audit_user_time").on(t.userId, t.createdAt),
  }),
);
