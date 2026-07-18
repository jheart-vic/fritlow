# Session Log

> Append a new entry at the top after each working session (or before clearing context).
> Each entry: what was done, decisions made, and what's next. Keep entries short and factual.

---

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

### Next
- User authorizes their IP (+ verifies sender) in Brevo → live-test verification + reset emails end to end.
- Same as Session 3: API credits → live AI tests; deploy to Render (add the new email envs there too); rate limiting, notifications/settings/subscriptions/audit logs.

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
