# Session Log

> Append a new entry at the top after each working session (or before clearing context).
> Each entry: what was done, decisions made, and what's next. Keep entries short and factual.

---

## Session 13 — 2026-08-09

### Done — two deferred items pulled forward
**1. Recommendation proactive triggers** (were "wire later, fire-and-forget"). Extracted the generation guts of `recommendation.service` into internal `runGeneration(userId, projectId)`; added exported `triggerRecommendations(userId, projectId, reason)` — **fire-and-forget** (`void ...then/.catch`), never throws, silently skips when <3 answers. Wired at three sites: `discovery.completeSession` (`discovery.complete`), `blueprint.generateBlueprint` + `generateBlueprintStream` (`blueprint.generated`), and `health.computeHealthScore` **only when a dimension < `LOW_DIMENSION_THRESHOLD` (60)** (`health.low_dimension`). No new tables. No circular imports (recs already read discovery/blueprint/health via `prisma`, not their services). **E2E-verified against GPT-5:** 3 vague answers → health overall 2 → health response returned immediately, then the trigger fired async and generated 6 valid recs (log line `[recommendations] proactively refreshed … (health.low_dimension)`). Note: the trigger AI call takes ~15-25s, so the log line/recs appear well after the parent response — that's the point.

**2. Email-invite for NON-users** (was deferred to v1.1). New `WorkspaceInvitation` model + `InvitationStatus` enum (PENDING/ACCEPTED/REVOKED); migration `20260809040758_add_workspace_invitations`. `inviteMember` now returns a discriminated result: existing account → `{ pending:false, member }` (added + heads-up email, as before); unknown email → **upsert a PENDING invitation** (`@@unique([workspaceId, email])`, resend re-arms role/status) + signup email → `{ pending:true, invitation }`. Controller returns 201 `{member}` or 201 `{pending:true, invitation}`. **Auto-join on signup:** `auth.register` now calls new `consumePendingInvitations(userId, email)` fire-and-forget — turns matching PENDING invites into memberships (skips existing, marks ACCEPTED). Emails lowercased on both sides so matching works. Two new email templates (`sendWorkspaceInviteEmail` for existing users, `sendWorkspaceSignupInviteEmail` for new — links to `/register?email=`). **E2E-verified (deterministic, no AI):** non-user invite → `{pending:true}` PENDING(ADMIN); resend → 201 (role→MEMBER); register invitee → auto-joined as MEMBER; invitee login sees the workspace; re-invite of now-member → 409.

### Docs
- Swagger: new `WorkspaceInvitation` schema; invite route `@openapi` now documents the `oneOf` 201 (member | pending+invitation), 404 removed. Frontend-guide §12 invite row updated (dual response shape + auto-join note).

### Notes / gotchas
- `migrate dev` applied the migration but the generated client didn't pick up the new model until an explicit `npm run db:generate` — regen after migrate if `workspaceInvitation` types are missing.
- Test data cleaned (owner-/invitee-/trig- users + owned workspaces + invitations).

### Next
- P2 tier (Search → Comments → decide Notifications → AI Chat) + test harness (biggest DoD gap). Deploy to Render still unblocks the frontend dev. Deferred still: explicit accept-invite endpoint / invite revoke UI (auto-join-on-register covers V1), DB Template table (v1.1 Marketplace).

---

## Session 12 — 2026-08-09

### Done — #6: Workspace management (closes the last P0/P1 MVP gap)
- New `src/modules/workspaces/` over the EXISTING `Workspace`/`WorkspaceMember` tables (no migration). Endpoints (all requireAuth): `POST /workspaces` (creator→OWNER, one tx), `GET /workspaces` (my memberships flattened to workspace+role), `GET /:id/members` (any member), `POST /:id/members/invite` (OWNER/ADMIN; existing users only — 404 if no account, 409 if already member; role ADMIN|MEMBER), `PATCH /:id/members/:userId` (role change), `DELETE /:id/members/:userId`.
- **RBAC guards:** only an OWNER may grant the OWNER role or change/remove an existing owner; a workspace must always keep ≥1 owner (last-owner demote/remove → 400); MEMBERs can't manage (403). Matched the spec's paths exactly (incl. `/members/invite`).
- Swagger `WorkspaceMembership` + `WorkspaceMember` schemas; frontend-guide new §12 (Errors→13, Rate limiting→14).
- **E2E-verified (12 scenarios):** create, list-with-role, members, invite (404/201/409), B sees workspace as MEMBER, MEMBER-invite 403, non-member-view 403, promote to ADMIN 200, self-demote-last-owner 400, ADMIN-grant-owner 403, remove 204, remove-last-owner 400. Test users cleaned.
- Rename stays at `PATCH /settings/workspaces/:id`; email-invite for non-users deferred to v1.1 Team Collaboration.

### Status: all P0/P1 MVP gaps from prd-backlog §9 are now CLOSED.
Next tier is P2 (Notifications/Search/Comments/AI Chat) + the test harness. Deferred: Recommendation proactive triggers, DB Template table (v1.1 Marketplace).

### Gotcha (recurring)
- Emails are lowercased on register/login — when scraping the dev-log verification token, grep the LOWERCASED email (`wsa-…` not `wsA-…`). And Neon cold-start still intermittently 500s `verify-email`'s transaction on first hit — retry.

---

## Session 11 — 2026-08-09

### Done — #5: Template entity
- New `src/modules/templates/` — **static in-code** catalogue of 7 category starting points (saas, marketplace, mobile_app, fintech, edtech, healthtech, social_network), each with `id, category, name, description, prefillDiscoveryHints` (map of discovery questionId → category-specific hint). `GET /api/v1/templates` + `GET /api/v1/templates/{id}` (404 unknown), behind requireAuth. Swagger `Template` schema; frontend-guide new §11 (Errors→12, Rate limiting→13).
- **Decision:** static in-code (like the discovery question bank / blueprint section defs), not a DB table — no migration/seed, dodges Neon flakiness, and the read contract is identical to a DB-backed one. The `Template` DB table earns its place with the v1.1 user-submitted Marketplace. Project `category` left as free-text on create (not tied to templates yet — possible follow-up; frontend can use `template.category` for the wizard dropdown).
- E2E-verified: 7 templates listed, `GET /templates/saas` full detail with hints, unknown id 404, no-auth 401. No AI/DB-write path, so fast.

### Next
- **Workspace management** (#6) ← next: `POST /workspaces`, `GET /workspaces` (+ my role), `GET|POST(invite)|PATCH(role)|DELETE /workspaces/{id}/members`. Precedes Team Collaboration (v1.1). Then P2s; test harness early. Deferred: Recommendation proactive triggers.

---

## Session 10 — 2026-08-08

### Done — #4: Dynamic Impact Analysis + Confidence Meter (both GPT-5-verified)
- **Discovery Confidence Meter:** `discovery.service` now grades each answer's specificity on submit via AI (feature `discovery.confidence`, maxTokens 1024 for reasoning headroom, returns 0-100 → we derive LOW/MEDIUM/HIGH). **Best-effort**: null on failure/no-AI so answering never depends on AI. Stored in the answer JSONB (`{text, confidence, confidenceLabel, followUp?}` — no migration). Re-graded only when the answer text changes. `generateFollowUp` updated to preserve confidence. Surfaced in `POST /answers` response and `GET /discovery`. Verified: "Everyone who has meetings" → 2/LOW; a detailed ICP answer → 95/HIGH.
- **Blueprint Dynamic Impact Analysis:** new on-demand endpoint `POST /blueprint/sections/{key}/impact-analysis` → `{ impactAnalysis: { affectedSections:[{sectionKey,reason}], generatedAt } }`. Deliberately NOT coupled to PATCH (keeps saves under the 300ms budget the spec flagged). AI compares the edited section vs all others; output filtered to valid other-section keys only; not persisted. 503/502/404 handled. Verified: pivoting business_model to "free ad-supported" correctly flagged `success_metrics` + `target_audience` with accurate reasons; unknown section → 404.
- Swagger + frontend-guide §3 (confidence on POST/GET answer) and §4 (impact-analysis subsection) updated.

### Next
- **Template entity** (#5) ← next: 7 fixed categories (SaaS/Marketplace/Mobile App/FinTech/EdTech/HealthTech/Social Network), `GET /templates` + `GET /templates/{id}`, admin-managed list. Then Workspace CRUD (#6), P2s; test harness early. Deferred: Recommendation proactive triggers.

---

## Session 9 — 2026-08-08

### Done — Version History (#3) built + verified
- New `BlueprintSectionVersion` model (migration `20260808130000_add_blueprint_section_versions`): snapshot of a section's content taken BEFORE each edit; fields `blueprintSectionId, sectionKey, projectId, content(JSONB), versionNumber, editedById, createdAt`. Back-relations added to `BlueprintSection`, `Project`, `User`.
- `blueprint.service.ts`: added `getOwnedSection` helper; `updateSection` now snapshots the outgoing content (versionNumber = priorCount+1, editedById = actor) then overwrites, atomically in a `$transaction`. New `listSectionVersions` (newest first, includes `editedBy {id, fullName}`) and `restoreSectionVersion` (non-destructive: snapshots current content as a new version, then sets content to the chosen version).
- Routes: `GET /blueprint/sections/:sectionKey/versions`, `POST /blueprint/sections/:sectionKey/versions/:versionId/restore` (+ OpenAPI). Swagger `BlueprintSectionVersion` schema. Frontend-guide §4 "Version history" subsection.
- **E2E-verified** (seeded a blueprint+section to skip the slow AI gen): empty before edits → v1=ORIGINAL after edit1 → v2=EDIT ONE after edit2 (newest-first, editedBy present); restore v1 → content=ORIGINAL and a v3 snapshot of EDIT TWO created (forward history preserved); unknown version 404, unknown section 404. Test data cleaned.

### Infra note (recurring)
- Neon's **direct** endpoint (used by `migrate`) was unreachable (P1001) for a while even though the **pooled** endpoint (app runtime) worked fine — diagnosed via a pooled `SELECT 1`. Worked around by staging a hand-written migration and applying with `prisma migrate deploy` once the direct endpoint recovered. `prisma generate` works fully offline, so code + typecheck were done while the DB was down.

### Next
- **Impact Analysis + Confidence Meter** (#4). Then Template entity, Workspace CRUD, P2s; test harness slotted early. Deferred: Recommendation proactive triggers.

---

## Session 8 — 2026-08-08

### Done
- **Reconciled with the frontend dev's build spec** (they sent a full backend gap analysis). Cross-checked vs our `prd-backlog.md` — same gap list; merged their deltas (added §8 cross-check + §9 reconciled build order). Newly surfaced: workspace-management gap (only rename exists), health-score dimension mismatch elevated to P0.
- **(A) Reshaped the Recommendation module to the spec** (user: "use the specs for a"). New shape: `type` enum (PRICING/SCOPE/AUDIENCE/ONBOARDING/GENERAL), `body` (markdown), `severity` INFO/WARNING/CRITICAL, `status` OPEN/ACKNOWLEDGED/DISMISSED/RESOLVED, `sourceContext`; route `POST /recommendations/generate`; list newest-first. Migration `20260808120000_reshape_recommendations` (hand-written drop+recreate — table was empty; `migrate dev` refused non-interactively on the destructive enum change, applied via `migrate deploy`). Added `{maxWait,timeout:15000}` to the regen `$transaction` (Neon pooled conn goes cold during the ~15s AI call → "Unable to start a transaction" otherwise). Swagger + frontend-guide §7 updated. **Deferred:** the spec's proactive triggers (auto-gen after discovery/blueprint/low-health).
- **(B) Health score → 7 dimensions** (user: "carry out b as proposed"): added `technical_complexity` + `market_readiness` (PRD §7's missing two), kept `differentiation`. `overall` averages 7. Swagger/guide updated.
- **Both E2E-verified against GPT-5**: recs generate returned valid enum types/severities + sourceContext on all; PATCH ack/dismiss 200, bad-status 400, unknown 404, status filters + history-preservation correct; health score returned all 7 dim keys. Test data cleaned.

### Gotchas logged
- `prisma migrate dev` refuses destructive enum changes non-interactively → hand-write migration + `migrate deploy`.
- Regenerating the Prisma client while `tsx watch` runs hot-restarts the server mid-request (caused spurious 500/hangs). Do client regen with the dev server stopped.
- Neon auto-suspends; first call after idle can P1001 or time out a transaction — retry / bump `maxWait`.
- Dev log can trip `grep` binary-detection — use `grep -a` when scraping the verification token.

### Next
- **Version History** (#3) ← next build. Then Impact Analysis + Confidence Meter, Template entity, Workspace CRUD, P2s; test harness slotted early.

---

## Session 7 — 2026-08-08

### Done
- **Built AI Recommendations / AI Product Strategist** (#1 priority from prd-backlog.md). New `src/modules/recommendations/` + `Recommendation` Prisma model (enums `RecommendationSeverity`, `RecommendationStatus`; migration `20260807224927_add_recommendations`). Endpoints (all project-scoped, requireAuth): `POST /` generates 3–6 prioritized insights from discovery+blueprint+health via AI (feature `recommendations.generate`); `GET /` (optional `?status`, sorted HIGH→LOW then newest); `PATCH /:id` accept/reject. Regeneration deletes only PENDING and recreates, preserving ACCEPTED/REJECTED as history. Mounted in app.ts; `Recommendation` swagger schema; frontend-guide new §7 (renumbered Export→8 … Rate limiting→12). **E2E-verified against GPT-5**: 6 sharp recs (challenged "everyone"/"free later"), 400 <3 answers, 404 unknown id, 400 bad status, accept/reject, status filter, regen-preserves-history, HIGH-first ordering. Test data cleaned.
- **Discovery follow-up contract fixes** (frontend dev flagged the docs). Root cause: the `POST /discovery/answers` OpenAPI omitted `followUpAnswer` (the schema has it); the endpoint's 200 was wrongly documented as `DiscoveryProgress` (which has `session`) when it actually returns progress-only; and the JSONB `answer.followUp` read-back shape was undocumented. Fixed all in `discovery.routes.ts` @openapi + `swagger.ts` (added `answers[]` with `{text, followUp{question,answer}}` to `DiscoveryProgress.session`) + frontend-guide §3 (added the ordering-sensitive round-trip with real tested request/response bytes). **Behavior NOT changed** (left for user decision): (a) `followUpAnswer` is silently dropped if no follow-up was generated first — recommend 400; (b) `answer` is required even when only replying to a follow-up — consider making optional.
- Note: auth rate limiter (10/15min per IP) trips during heavy local E2E — boot with `RATE_LIMIT_ENABLED=false` for test runs.

### Next
- **Version History** (#2), then **test harness** (#3). Also pending user decision: the two discovery follow-up behavior fixes above; Notifications (may be cut); Render deploy.

---

## Session 6 — 2026-08-07

### Done
- **Full-stack live verification through GPT-5** (continuing Session 5): ran the real feature endpoints end-to-end with `AI_PROVIDER=openai` — Challenge Mode follow-up (sharp, contextual), blueprint generation over SSE (2173 deltas → 8 persisted sections, status READY, project → BLUEPRINT_COMPLETE), and AI health score (overall 70, 5 dimensions). All AI features confirmed working live. Test users/data cleaned from DB.
- **PRD → codebase gap analysis captured** so it survives context clears. Audited `Agmund_PRD_v1.0` against the code and wrote `context/prd-backlog.md` (full map: MVP-scoped gaps, deferred modules, non-functional gaps). Linked it from `summary.md` and `feature.md`. Seeded memory: `MEMORY.md` + `prd-gap-analysis` (reference), `mvp-scope-unbuilt` + `no-automated-tests` (project). **No code changed.**

### Key findings (see context/prd-backlog.md)
- MVP-scoped but UNBUILT: **AI Recommendations / AI Product Strategist baseline** (`recommendations` entity) and **Version History**. Also signature-but-unbuilt: Dynamic Impact Analysis, discovery confidence meter.
- **Zero automated tests** despite the PRD Definition of Done — largest process gap.
- Not modelled: recommendations, templates, notifications, subscriptions, audit_logs.
- Depth gaps: blueprint sections & discovery modules are deliberate subsets of the PRD's fuller lists; no product-analytics events; CSRF not explicitly handled.

### Next
- **Decision pending with user:** re-prioritize the unbuilt MVP-scope items (Recommendations, Version History, test harness) against the deferred queue (notifications/billing) and the deploy. My recommendation: Recommendations first (AI layer already exists), then a test harness.
- Still open from before: Render deploy (frontend dev waiting) and optional Anthropic-path verification.

---

## Session 5 — 2026-07-20

### Done
- **OpenAI GPT-5 provider added — AI layer is now multi-provider, toggle via `AI_PROVIDER`.** New `src/lib/ai/openai.provider.ts` (openai SDK v7, Responses API — `instructions`/`input`, `output_text`, `usage.input_tokens/output_tokens`; reasoning effort configurable). Registered alongside anthropic in `ai.service.ts`. Contract change: `AiProvider` now carries a `model` field, and the audit-log ERROR path logs `provider.model` (was hardcoded `env.AI_MODEL` — would have mislabeled OpenAI errors). Env: `AI_PROVIDER` enum gained `openai`; added `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5`), `OPENAI_REASONING_EFFORT` (default `medium`). `.env.example` updated. Nothing downstream (features) changed — the point of the provider layer.
  - **FIRST LIVE AI CALLS in the project succeeded** — the user's `.env` already has a working `OPENAI_API_KEY`. Verified end-to-end against real GPT-5: `complete()` returned text; `completeStream()` emitted 9 deltas → correct aggregate; fake-key path correctly surfaced as 502. So the AI features are no longer blocked on Anthropic credits — they can be exercised NOW via `AI_PROVIDER=openai` (discovery follow-ups, blueprint gen sync+SSE, health score still need a real end-to-end run through their endpoints). Probe rows cleaned from AiInteraction.
- **Settings module built** (feature complete) — new `src/modules/settings/` following routes → controller → service → Prisma. Three endpoints, all behind requireAuth under `/api/v1/settings`:
  - `PATCH /profile` — update own `fullName` (email deliberately excluded from V1: would need re-verification). Returns `{ user }` via the shared serializer.
  - `POST /password` — change password while logged in: verifies `currentPassword` (wrong → 401), hashes new, and revokes ALL sessions in a transaction (same rule as reset-password). Returns "Password updated. Please log in again."
  - `PATCH /workspaces/:workspaceId` — rename a workspace; reuses the projects tenancy gate (must be a member; only OWNER/ADMIN may rename → 403 otherwise). Returns `{ workspace }`.
- Exported `toPublicUser` from auth.service (was private) so settings serializes users identically — one source of truth for the user shape. Added a `Workspace` schema to swagger.ts components.
- Mounted `app.use('/api/v1/settings', settingsRouter)`. OpenAPI blocks on all 3 routes; frontend guide got new §9 Settings (Errors→§10, Rate limiting→§11).
- E2E verified against dev server (register→verify→login→settings): profile update 200 + name changed; profile 1-char name 400; no-auth 401; workspace rename (owner) 200; rename non-member workspace 403; password change wrong-current 401; correct 200; then login with OLD password 401 + NEW password 200 (proves session revocation + new hash). typecheck clean. (Left one test user `settings-test-*@example.com` + a "Temp" project in the dev DB.)
- **Rate limiting built** (feature complete) using `express-rate-limit` v8 (in-memory store). New `src/middleware/rate-limit.ts`: a `buildLimiter` factory + two limiters — `authLimiter` (10 / 15 min: login, register, refresh, verify-email, reset-password — brute-force/token-guessing) and `emailLimiter` (3 / hour: resend-verification, forgot-password — strictest, each spends real Brevo quota). Applied as the first middleware on each route (before validateBody, fails fast, no DB touched).
- **429 contract**: custom handler returns the standard `{ error }` JSON + `Retry-After` header (seconds to reset, computed from `req.rateLimit.resetTime`); `standardHeaders: 'draft-8'` emits `RateLimit`/`RateLimit-Policy`, `legacyHeaders: false`. Limiter is skipped when `NODE_ENV=test` or `RATE_LIMIT_ENABLED=false`.
- **Config**: new envs (all defaulted) — `RATE_LIMIT_ENABLED`, `AUTH_RATE_LIMIT_WINDOW_MIN/MAX`, `EMAIL_RATE_LIMIT_WINDOW_MIN/MAX`, `TRUST_PROXY_HOPS`. app.ts sets `trust proxy` to `TRUST_PROXY_HOPS` when >0 so `req.ip` (the limiter bucket key) is the real client behind a proxy.
- **DEPLOY NOTE**: set `TRUST_PROXY_HOPS=1` on Render (or wherever, behind their proxy) — otherwise every request shares one IP bucket and the whole site gets limited together. In-memory store is per-process; when we scale past one instance, swap to a Redis store (rate-limit-redis on the Upstash we add at deploy) or limits won't be shared across instances.
- Docs updated: OpenAPI (new reusable `#/components/responses/RateLimited` in swagger.ts + `429` on all 7 auth routes), `docs/frontend-api-guide.md` (new §10 + 429 in the global error list), `.env.example`.
- E2E verified against the running dev server: forgot-password 3× → 200, 4th/5th → 429 with `Retry-After: 3589` and `RateLimit: "3-in-1hr"; r=0; t=3589`. typecheck clean.

### Next (see feature.md)
1. **Notifications** (now ACTIVE next) — CHALLENGE BEFORE BUILDING: dashboard `nextAction` may already cover the V1 need; decide whether to cut.
2. Subscriptions/billing + audit logs — post-deploy.
- Still blocked on user, in parallel: Render deploy (remember `TRUST_PROXY_HOPS=1` + email envs + authorize Render IPs in Brevo) and Anthropic credits → live AI tests.

## Session 4 — 2026-07-18

### Done
- **Email verification added to auth** (migration `20260718000417_add_email_verification`): `User.emailVerifiedAt DateTime?` + `EmailVerificationToken` table (hashed, single-use, 24h TTL — same pattern as PasswordResetToken). Registration issues a token (dev: logged + returned in the register response as `verificationToken`). New endpoints: POST `/auth/verify-email` (burns token + sets emailVerifiedAt in one transaction), POST `/auth/resend-verification` (always 200 to hide account existence; invalidates older unused tokens so only the newest link works; skips already-verified accounts). `PublicUser` and the Swagger `User` schema gained `emailVerified: boolean`.
- **Decision: verification does NOT gate login in V1** — email delivery isn't wired up yet, so blocking login would lock everyone out. The frontend nags via the `emailVerified` flag; revisit gating once an email provider exists.
- E2E verified: register returns token + emailVerified=false → bad token 400 → verify 200 (emailVerified=true) → token reuse 400 → resend on verified/unknown email both 200 with no token → resend on unverified invalidates old token, new one works.
- Gotcha: `npm run db:migrate -- --name x` doesn't forward `--name` (script hangs on an interactive prompt); use `npx prisma migrate dev --name x` directly.
- **Frontend handoff docs written**: `docs/frontend-api-guide.md` (all endpoints, session model, SSE guidance, 16-step Postman walkthrough) + `docs/auth-email-verification.md`. Keep both current with API changes.
- **Project responses now embed `createdBy` `{id, fullName, email}`** (create/list/get/update — Prisma `include`, no migration needed) so the UI can show who created a project without a second request. Swagger + guide updated, e2e verified.

- **Email service built (Brevo)**: `src/lib/email/` — `brevo.provider.ts` (only file that knows Brevo's REST API; native fetch, no SDK) + `email.service.ts` (HTML templates + `sendSafely`: email is best-effort, a failed send is logged but NEVER thrown, so auth flows can't break). Wired into register + resend-verification (verification email) and forgot-password (reset email), fire-and-forget. Links point to `APP_URL` frontend routes `/verify-email?token=…` and `/reset-password?token=…`. New envs: BREVO_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, APP_URL (all optional/defaulted; without key sends are skipped + logged). Dev token-in-response behavior kept.
- **Live Brevo send BLOCKED on account settings**: API key present but Brevo 401s — "unrecognised IP address 105.112.124.69"; user must authorize the IP at https://app.brevo.com/security/authorised_ips (or disable authorised IPs). Sender is `no-reply@beatcircle.co` ("Beat Circle Mail") — that domain/sender must also be verified in Brevo. Fixed a var-name mismatch in the user's .env: `EMAIL_FROM_ADDR` → `EMAIL_FROM_ADDRESS`.

- **Verification now GATES login (user decision, reversing the earlier V1 stopgap)**: register returns `{user, message}` only — no tokens, no cookie; login 403s until verified ("Please verify your email before logging in", checked AFTER the password so it can't probe accounts). Raw verification/reset tokens REMOVED from all API responses (were dev-only) — they travel by email, dev console still logs them. All 7 pre-existing users backfilled as verified (one-off updateMany, no migration). Swagger + both docs rewritten. E2E: register(no tokens)→login 403→verify→login 200; grandfathered login 200.

- **Brevo live sending CONFIRMED WORKING** — user authorized the IP; probe send to their Gmail accepted (`[email] Sent`). Email delivery is now real in dev; dev console still logs tokens as a convenience.

### Next (priorities agreed with user 2026-07-18 — reasoning in feature.md)
1. **Rate limiting** (ACTIVE next feature) — urgent now that unauthenticated endpoints (resend-verification, forgot-password) trigger real Brevo emails; also brute-force protection on login/register.
2. Settings module (profile update, password change, workspace rename).
3. Notifications — challenge scope first; dashboard nextAction may already cover it, possibly cut for V1.
4. Subscriptions/billing + audit logs — post-deploy.
- In parallel, blocked on user: Render deploy (unblocks the frontend dev; add email envs + authorize Render IPs in Brevo) and Anthropic credits → live AI tests (follow-ups, blueprint sync+SSE, health score).

## Session 2 — 2026-07-16

### Done
- **Product renamed: Agmund → Fritlow** (user decision). Code, docs, and context updated; the source PDFs/PRD in `~/Downloads` keep their original Agmund filenames.
- Scaffolded the Express 5 + TypeScript 7 backend: tsconfig (nodenext), scripts (`dev`, `build`, `typecheck`, `db:*`), deps installed (express 5, zod 4, prisma 7, bcryptjs, jsonwebtoken, helmet, cors, swagger-jsdoc, swagger-ui-express, tsx).
- Wrote Prisma schema (`prisma/schema.prisma`): User, Workspace, WorkspaceMember (role enum OWNER/ADMIN/MEMBER, unique user+workspace), RefreshToken and PasswordResetToken (both stored SHA-256 hashed, revocable/single-use).
- Built full auth flow in `src/modules/auth/` following **routes → controllers → services → models**: register (creates user + personal workspace in a transaction), login, refresh (with token rotation), logout, me, forgot-password / reset-password (email delivery TODO — token logged/returned in dev only).
- Core plumbing: zod-validated env config, single PrismaClient via `@prisma/adapter-pg`, ApiError + error-handler middleware, `validateBody` zod middleware, `requireAuth` JWT middleware.
- Swagger UI at `/docs` (spec at `/docs.json`) — swagger-jsdoc scans `@openapi` blocks in `*.routes.ts`.
- Verified: typecheck clean, server boots, /health + /docs.json + validation + 401 guard all behave.
- `.env` created with a generated JWT secret; `.env.example` committed pattern.

### Decisions
- **Dev database: Neon cloud free tier** (user choice; no local Postgres/Docker on the machine).
- Refresh tokens are opaque random strings stored hashed with rotation — not JWTs — so they can be revoked.
- TypeScript 7 requires `moduleResolution: "nodenext"`; Prisma 7 uses `prisma.config.ts` + driver adapter (`@prisma/adapter-pg`), client generated into `src/generated/prisma` (gitignored).

- **Neon database live + first migration applied** (`20260716203115_init_auth`). Note: the user's first Neon project had a stray `products` sample table; they ended up on a fresh Neon project (`ep-empty-rain-…`) instead.
- **End-to-end verified against Neon**: register (and 409 on duplicate), login, GET /me with Bearer token, refresh rotation, and reuse-of-old-refresh-token correctly rejected. Registration transaction confirmed in DB: test user is OWNER of their personal workspace.
- Split tsconfig: `tsconfig.json` (typecheck, includes `prisma.config.ts` — fixes IDE "Cannot find name 'process'") + `tsconfig.build.json` (emits only `src` → `dist`).
- Test account exists in dev DB: `test@agmund.dev` / `test-password-123`.

- **Auth hardened to cookie-based refresh (user decision)**: refresh token now travels ONLY as an httpOnly cookie `fritlow_rt` (path=/api/v1/auth, 30d, Secure+SameSite=None when COOKIE_SECURE=true, Lax in dev); access token stays in the JSON body — frontend should keep it in memory (Pinia), NOT localStorage; sessionStorage acceptable per-tab compromise. Body `refreshToken` remains as a fallback for non-browser clients. CORS now uses an origin allowlist (`CORS_ORIGIN` env) with credentials. New envs: CORS_ORIGIN, COOKIE_SECURE. Fixed: validateBody treats missing body as `{}`. E2E verified with a cookie jar: login sets cookie → refresh with empty body works → logout clears cookie + revokes → replay fails.
- Production note: prefer serving app + api under one apex domain (e.g. app./api.fritlow.com) so the cookie can be SameSite=Lax.

- **Project module shipped** (`src/modules/projects/`, migration `20260716213150_add_projects`): Project model (name, oneLineIdea, category?, status enum DRAFT/DISCOVERY/BLUEPRINT_COMPLETE/LAUNCHED, workspace-scoped, createdBy). Endpoints: POST/GET `/api/v1/projects` (+ `?status=` filter), GET/PATCH/DELETE `/api/v1/projects/:id`. Tenancy enforced in the service via `assertMembership`; delete requires OWNER/ADMIN. Create defaults to the user's personal workspace when `workspaceId` omitted. E2E verified incl. cross-user 403s. Second test account: `second@fritlow.dev` / `another-pass-456`.

## Session 3 — 2026-07-17

### Done
- **Discovery Interview engine (deterministic skeleton) shipped** — migration `20260717130513_add_discovery`: DiscoverySession (1:1 with Project, status ACTIVE/COMPLETED/ABANDONED) + DiscoveryAnswer (JSONB `answer` column, unique per session+question, upsert = revise). Static 10-question bank in `src/modules/discovery/questions.ts` across 5 modules (problem, customer, business_model, differentiation, mvp_focus) — stable question ids, never reuse them.
- Endpoints under `/api/v1/projects/:projectId/discovery` (mergeParams router): POST start (flips project to DISCOVERY in same transaction), GET session+progress+nextQuestion (resume screen), POST /answers (upsert), POST /complete (only when all answered).
- E2E verified: start → early complete 400 → 10 answers → complete → answer-after-close 400.
- **AI decision recorded**: V1 needs an LLM for adaptive follow-ups, Challenge Mode, blueprint generation, health score — but the interview skeleton is deterministic by design. The AI layer (provider-agnostic, per summary.md) is a separate upcoming feature; question bank questions become "anchors" and AI generates follow-ups between them.

- **AI orchestration layer shipped** (provider: **Anthropic**, user decision): `src/lib/ai/` — `types.ts` (AiProvider interface), `anthropic.provider.ts` (only file allowed to import `@anthropic-ai/sdk`; model from `AI_MODEL` env, default `claude-opus-4-8`, adaptive thinking), `ai.service.ts` (`generateText()` — the single AI entry point; logs EVERY call, success and error, to the new `AiInteraction` table — migration `20260717150106_add_ai_interactions`). Returns 503 when `ANTHROPIC_API_KEY` is unset, 502 on provider errors.
- **First AI consumer**: `POST /projects/:id/discovery/answers/:questionId/follow-up` — generates one Challenge-Mode follow-up question from the founder's answer + project context; stored in the answer's JSONB (`followUp: {question, answer}`); reply via `followUpAnswer` on the answers endpoint. E2E verified: 400 before answering / unknown question, 503 without key. **Live AI call not yet tested — user must put an Anthropic API key (console.anthropic.com) into `.env` `ANTHROPIC_API_KEY`.**

- **API key added but account has no credits** — live AI test failed with "credit balance too low" (perfectly captured by the AiInteraction log). User will top up at console.anthropic.com → Plans & Billing ($5 min) later.
- **Neon migration fix**: `prisma migrate` started failing (P1001) through the pooled endpoint while the app connected fine. Fix: `DIRECT_DATABASE_URL` (pooled URL minus `-pooler`) in .env; `prisma.config.ts` now prefers it for CLI ops. Documented in .env.example.
- **Blueprint module shipped** (migration `20260717152828_add_blueprints_decisions`): Blueprint (1:1 project, status GENERATING/READY/FAILED) + BlueprintSection (JSONB `{markdown}`, stable keys, unique per blueprint). Eight canonical sections defined in `blueprint.sections.ts`. Endpoints: POST `/projects/:id/blueprint` (AI-generates all sections from the full discovery transcript incl. follow-ups, one transaction, flips project to BLUEPRINT_COMPLETE; 409 if exists, 400 if discovery incomplete), GET (with sections), PATCH `/blueprint/sections/:key` (the "Living" edit path).
- **Decision Log module shipped**: DecisionLog model (title, reasoning, status ACTIVE/REVISED/REVERSED, createdBy). Full CRUD under `/projects/:id/decisions`. E2E verified.
- Blueprint guard paths e2e-verified; **AI generation path untested pending credits** (same blocker as follow-ups).
- Gotcha hit twice this session: a stale `npm run dev`/tsx server holding port 4000 serves OLD routes — kill all fritlow node processes before e2e testing.

- **Exports shipped** (migration `add_exports_health_score`): GET `/projects/:id/export?format=pdf|docx|markdown` — on-the-fly generation via marked + pdfkit + docx (no storage yet; DO Spaces at deploy). Shared ExportableDoc model; inline markdown stripped to plain text in PDF/DOCX for V1. Export rows logged. All 3 formats e2e-verified (magic bytes checked).
- **Dashboard shipped**: GET `/api/v1/dashboard` — projects with discovery progress + ONE deterministic nextAction each (START/CONTINUE/COMPLETE_DISCOVERY → GENERATE/REVIEW_BLUEPRINT → CELEBRATE); top-level nextAction = most recently touched project. Pure logic, no AI.
- **Health Score shipped**: HealthScore model (1:1 project, JSONB dimensions). POST/GET `/projects/:id/health-score` — AI grades 5 dimensions (problem_clarity, target_audience, business_model, differentiation, mvp_focus) with feedback; overall = server-computed average. Needs ≥3 answers (400 otherwise). AI path pending credits.
- **SSE streaming shipped**: AiProvider gained `completeStream`; `generateTextStream` in ai.service (same logging); POST `/projects/:id/blueprint/stream` emits `delta` events live then `done` with the persisted blueprint (errors become SSE `error` events since headers are already sent). Blueprint generation refactored: prepareGeneration + persistGenerated shared by sync + stream paths.
- **BullMQ deliberately deferred**: needs a Redis server (none on this machine, no Docker). Decide at deploy time — Upstash free tier is the Neon-equivalent option. SSE covers the progress-feedback UX for now.
- **Render deploy fix**: build failed because gitignored `src/generated/prisma` doesn't exist on a fresh clone. Fixed: `postinstall: prisma generate` + `db:deploy` script (`prisma migrate deploy`) + engines.node>=22. Verified by deleting src/generated locally and re-running npm install + build. Render needs env vars: DATABASE_URL, DIRECT_DATABASE_URL, JWT_ACCESS_SECRET, COOKIE_SECURE=true, CORS_ORIGIN=<frontend origin>, ANTHROPIC_API_KEY; build `npm install && npm run build`, start `npm start`, pre-deploy `npm run db:deploy`.
- Test blueprint seeded on the "Fritlow" project (3 fake sections) for export testing — delete before real generation (regenerate returns 409 otherwise).

### Next
- User adds API credits → live-test follow-ups, blueprint generation (sync + SSE), health score.
- Deploy to Render (env vars above); decide Redis/BullMQ + DO Spaces then.
- Remaining backlog: notifications, settings, subscriptions, audit logs, rate limiting, password-reset email delivery.
- Wire up email delivery for the password-reset flow (currently dev-only console log).
- Consider rate limiting on auth endpoints before anything goes public.
## Session 1 — 2026-07-16

### Done
- Repo `fritlow` initialized (README + LICENSE only; single initial commit on `main`).
- Created initial `CLAUDE.md`.
- Received and digested project documents:
  - `~/Downloads/Agmund_PRD_v1.0.docx` — full PRD for Agmund (AI Product Operating System).
  - `~/Downloads/Agmund_V1_Honest_Summary.pdf` — independent technical assessment with stack verdict.
- Created `context/` folder with `summary.md` (product + stack), `feature.md` (current feature + backlog), and this `session.md`.
- Updated `CLAUDE.md` to point future sessions at the context folder.

### Decisions
- This repo is the workspace for building **Fritlow V1** (MVP) — named "Agmund" at the time of this session, renamed in Session 2.
- Recommended stack recorded in `summary.md`: Nuxt 4 + NestJS + TypeScript, Postgres + Prisma (JSONB), Redis + BullMQ, Tiptap, LiteLLM-style AI abstraction, DO Spaces, Vercel + DigitalOcean.
- **Database confirmed: PostgreSQL + Prisma** (user decision, 2026-07-16). JSONB for document-shaped content (blueprint sections, discovery payloads).
- **This repo is backend-only** (user decision, 2026-07-16). A separate frontend dev handles the Nuxt/Vue app in another repo — the OpenAPI contract is the handoff point between the two.
- **Framework confirmed: PEN stack — PostgreSQL + Express + Node with TypeScript** (user decision, 2026-07-16). NestJS was considered but rejected: the user doesn't know it and will be maintaining this backend; Express they can read and debug line by line. Compensate for Express's lack of built-in structure with a disciplined feature-module layout, a service layer, and zod validation.

### Next
- Scaffold the Express + TypeScript backend in this repo.
- Lock the data model (schema first, before UI) — see `feature.md` step list.
