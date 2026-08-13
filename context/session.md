# Session Log

> Append a new entry at the top after each working session (or before clearing context).
> Each entry: what was done, decisions made, and what's next. Keep entries short and factual.

---

## Session 22 — 2026-08-12

### Done — Document upload (PRD/MVP) → discovery pre-fill
Client-requested: "we want users to be able to upload their projects prd or mvp in image, pdf, docx so fritlow reads that and works on it", then "pre-fill before building, just like fritlow's normal workflow", then "vision only", then "build both [providers] with openai as the real one now and anthropic there fully wired too".

- **New module `src/modules/documents/`** + `ProjectDocument` model (migration `add_project_documents`, applied). Upload/list/get/delete under `/api/v1/projects/:projectId/documents`. Upload returns **202** and extraction runs fire-and-forget; the frontend polls `status`.
- **Extraction, cheapest path first** (`document.extract.ts`): PDF text layer → `unpdf`; `.docx` → `mammoth` (converted HTML→markdown by hand so headings survive — this version of mammoth has no `convertToMarkdown`); images and text-layer-less PDFs → **AI vision**. Both providers accept a PDF directly, so there is **no OCR and no page-rasterising** anywhere in the codebase (this removed the canvas dependency the plan originally assumed). Scanned PDFs capped at 30 pages on cost grounds; a blank/illegible transcription fails rather than storing a useless doc.
- **AI layer carries attachments now**: `AiCompletionRequest.attachments` (`{kind:'image'|'pdf', mimeType, base64}`), implemented in **both** providers + threaded through `ai.service.run()`. The audit log records attachment *metadata* only — base64 in `AiInteraction.userPrompt` would have bloated the table fast.
- **Pre-fill**: `POST /projects/:id/discovery/prefill` (`discovery.prefill.ts`) drafts answers for questions the document genuinely answers, instructed to omit rather than guess. Drafts carry `source:'document'` + `needsReview:true`; submitting the question clears it; **`POST /complete` is blocked while any draft is unreviewed**. `generateQuestionPlan` also gets a document excerpt so the interview probes past what the PRD settles.
- **Account deletion** reassigns `ProjectDocument.uploadedById` to the sentinel (new FK would otherwise block the delete).
- **Verified live against GPT-5**: text-layer PDF → `PDF_TEXT` with correct text (zero AI cost); no-text PDF → `VISION`, full OpenAI round-trip, returned `[illegible]` for a blank page (correct). Typecheck clean; app wiring smoke-tested (no circular-import issue between discovery ↔ documents).

### Decisions
- **Vision over OCR** (client choice): tesseract is useless on whiteboard photos and messy scans, and both providers read images/PDFs natively — so no OCR dependency at all.
- **Pre-fill feeds the interview, never bypasses it.** The `needsReview` gate on `/complete` is the guardrail: a founder must look at every drafted answer before it can become a blueprint.
- **Both providers wired at parity**, OpenAI as the live one. Anthropic's attachment path is implemented but **untested** (no credits) — same standing as the rest of the AI layer.
- Cloudinary `resource_type: 'raw'` for the original files (DO Spaces still unwired); storage is best-effort — the extracted text is what Fritlow actually reads.

### Done — frontend-reported gaps + workspace sharing model (same session)
Frontend dev reported two spec problems; a third question ("why does an invited person see every project of the inviter?") turned out to be the real find.

- **Their reports, both valid:** the pre-fill provenance fields were live but missing from the Swagger `DiscoveryProgress` answer schema (added, with the absent-vs-null semantics spelled out); `/admin/stats`'s description still said `ADMIN` after the S16 rename to `SUPERADMIN` (prose-only bug — the guard was always correct).
- **Real gap:** `toPublicUser` never returned `platformRole`, so the frontend **could not gate staff UI at all** — it only appeared on `/admin` responses you must already be staff to fetch. Now returned by login/register/verify-email/`/auth/me`.
- **The visibility question:** working as designed — tenancy is workspace-level (closer to a GitHub org than a repo), and invite adds an existing user to the workspace immediately. But `createProject` defaults to the **personal** workspace, so the first collaborator invited there saw the founder's entire back catalogue. Also `GET /projects` had no `workspaceId` filter, so the list was a flat mix across workspaces with no way to scope it.
- **Fixes:** `Workspace.isPersonal` (+ backfill migration applying the old "earliest workspace you own" rule once); invites into a personal workspace **refused with a 400** pointing at the real path; `sharedProjectCount` on every invite response so the founder sees what they're exposing; `?workspaceId=` on `GET /projects`; and `PATCH /projects/:id` can now **move a project between workspaces** (OWNER/ADMIN on both sides — the source's members lose access, so it carries delete's bar).

### Decisions
- **Block rather than warn** on personal-workspace invites: a warning still makes over-sharing the default outcome of a normal action. Knowingly **breaking** for the frontend's invite flow (needs a create/pick-workspace step); done now because pre-deploy with no users is the cheapest this ever gets.
- **Project move requires OWNER/ADMIN on both sides**, since moving out is effectively removing the project from everyone in the source workspace.
- **Deliberately not built** (offered, not taken): an accept step for invites, and tightening MEMBER permissions — today a MEMBER can change project status and delete uploaded documents.

### Backfill caught a bug — worth remembering
Verifying the backfill against real data (rather than trusting it) found the "earliest workspace you own" rule had mislabelled **two multi-member workspaces as personal**: `D'Founders` (a genuine team workspace, 2 members) and `Zeus's Workspace` (personal by origin but already shared with a second user). Left alone, their owners could never have invited anyone else into them — a bug introduced by the fix itself. Corrective migration `fix_is_personal_shared_workspaces` applies the better rule: **a workspace with more than one member is not private.** Re-verified: 3 personal workspaces remain, all single-member.

Also note what that data revealed: someone had **already** invited a user into a personal workspace — the exact over-sharing this batch prevents.

Both migrations applied (Neon's DIRECT endpoint flapped with P1001 for ~20 min first — same failure mode as S16; a retry loop got through).

### Next
- Live-test the **Anthropic** attachment path when credits exist (and the still-pending blueprint/health-score Anthropic paths).
- Test coverage for the documents module + pre-fill is still blocked on the Neon test DB (`.env.test`) — same blocker as Session 20.
- New deps: `unpdf`, `mammoth`.

---

## Session 21 — 2026-08-11

### Done — Adaptive Discovery (hybrid plan + expanded banks) + Blueprint SSE per-section events
Both client-approved this session ("the hybrid is okay, the 2 new is good … build them"; then "build option B").

**1. Adaptive Discovery.** Discovery interview is now tailored per project instead of a fixed 5×2=10 skeleton.
- **Expanded library** ([questions.ts](../src/modules/discovery/questions.ts)): 7 core modules now — added `go_to_market` + `risks` (plus extra core questions in problem/customer/business_model/mvp_focus). New `categoryPacks` (saas, marketplace, mobile_app, fintech, edtech, healthtech, social_network) with `matchCategoryPack()` fuzzy alias matching; `assembleBasePlan(category)` = core + matched pack; `CORE_QUESTION_COUNT`; `getQuestion` now searches core+packs. `discoveryQuestions` kept as alias.
- **Hybrid generation** (new [discovery.plan.ts](../src/modules/discovery/discovery.plan.ts)): `generateQuestionPlan(userId, project)` — builds base plan, asks AI to tailor/reword/add (returns strict JSON array, defensively parsed, 6–20 clamp, unique ids), and **falls back to the base plan on ANY failure/absent AI** (so start never fails, tests need no AI). Logs source.
- **Persistence + refactor:** new `DiscoverySession.questionPlan` JSONB (migration `20260811092506_add_discovery_question_plan`, applied to dev + test DBs). `discovery.service.ts`: `resolvePlan(session, project)` (stored plan, else base plan for legacy null); `buildProgress(plan, answered)` returns `{answered, total, nextQuestion, questions}`. `startSession` generates+stores the plan (AWAITs the AI, ~seconds; tx `maxWait/timeout` bumped). submit/follow-up/complete all resolve the question from the SESSION PLAN, not the global bank. `total` is now the plan length.
- **Consumers unaffected:** health/blueprint/chat/recommendations read the answer transcript generically (module+questionText+text) — no change. **Dashboard** fixed: selects `questionPlan`, `total` = plan length (fallback `CORE_QUESTION_COUNT`). **Health Score rubric stays fixed** (comparability preserved) — the key constraint we agreed.
- **Docs:** swagger `DiscoveryProgress` (+`questions`, dynamic `total`) + discovery routes @openapi + frontend-guide §3 ("don't hardcode the list; render `questions`; start has AI latency; IDs per-session").

**2. Blueprint SSE per-section events (Option B).** Frontend mockup revealed two things: (a) their section list was WRONG (invented "Technical Architecture"/"Go-to-Market" sections; the real 8 are fixed in [blueprint.sections.ts](../src/modules/blueprints/blueprint.sections.ts): executive_summary, problem_statement, solution, target_audience, business_model, differentiation, mvp_scope, success_metrics); (b) the SSE stream sends only raw `delta` chunks — and those are **partial JSON** (model emits one JSON object), NOT headed markdown, so heading pattern-matching can't work.
- Built server-side `section` events: `createSectionTracker(onSection)` in blueprint.service watches the accumulating stream buffer for each section KEY appearing as a JSON key (`"<key>":`), derives writing→complete from key order, emits only on change. `generateBlueprintStream` now takes an `onSection` cb; controller sends `event: section {key,title,status}`. `delta`/`done`/`error` unchanged. Frontend can drive the checklist with ZERO stream parsing.
- **Tracker unit-tested** (`blueprint.test.ts`, 4 tests, pure/no-AI): writing→complete pairs in order; no duplicate transitions; finish() completes all even if stream cut off; prose mention of a key doesn't false-trigger. Passed 4/4.
- Docs: blueprint stream @openapi + frontend-guide §4 (event table + the fixed 8-section order + "build the checklist from `section`, not `delta`").

### Tests / infra note
- New `discovery.test.ts` (7 tests, deterministic via the no-AI fallback plan). typecheck clean throughout.
- **Neon test-DB latency is the pain point:** a full-suite run took 456s and 4 tests hit the 30s timeout (even a trivial project PATCH) — pure latency, not logic. Bumped `testTimeout`/`hookTimeout` to 60s in vitest.config.mts. (A local Postgres would make the suite ~100× faster — noted for later; no Docker on this machine.)

### Next
- Confirm the full suite is green at 60s, commit. Then broaden test coverage (workspaces RBAC, search, comments, settings) + decide mock-AI vs live-key for AI paths. Live end-to-end check of adaptive plan generation + section events against GPT-5 still worth doing (the fallback path is what's integration-tested; the AI path is unit-covered only for the parser/tracker).

---

## Session 20 — 2026-08-10

### Done — Test harness scaffolded (biggest DoD gap, first slice)
- **Stack: Vitest + Supertest** (integration-first — import the real exported `app`, drive it in-process, hit real Prisma → real Postgres, which is where this codebase's logic lives). New devDeps: `vitest`, `supertest`, `@types/supertest`, `dotenv-cli`.
- **DB isolation (the crux):** tests run against a **SEPARATE Neon test DB**, never dev/prod. Mechanism: [src/config/env.ts](../src/config/env.ts) now loads `.env.test` when `NODE_ENV=test` (was hardcoded `dotenv/config` → `.env`). `.env.test` is gitignored (template committed as the file with placeholder URLs + a real generated JWT secret). `setup.ts` TRUNCATEs every public table (discovered from `pg_tables`, excludes `_prisma_migrations`) `RESTART IDENTITY CASCADE` in `beforeEach` → every test starts clean; `afterAll` disconnects Prisma.
- **Config:** [vitest.config.mts](../vitest.config.mts) — `environment:node`, `env:{NODE_ENV:test}`, `setupFiles`, **`fileParallelism:false`** (single shared test DB → files must not run concurrently), `testTimeout/hookTimeout 30s` (Neon cold-start headroom). `.mts` extension to dodge the CJS/ESM config warning.
- **Helpers** ([src/test/helpers.ts](../src/test/helpers.ts)): `uniqueEmail()`, `registerAndLogin()` (registers via API → flips `emailVerifiedAt` directly in DB to skip the email token → logs in → returns `{accessToken, workspaceId, ...}`), `authHeader()`.
- **Suites written:** `src/modules/auth/auth.test.ts` (13 tests: register no-tokens + workspace created, dup 409, short-pw 400, unverified login 403, verified login 200 + rt cookie, wrong-pw 401, unknown-email 401, verify-email valid→200/reuse→400/unknown→400 [seeds a known-raw token via `hashToken`], refresh rotation invalidates old, /me 200/no-token 401/garbage 401). `src/modules/projects/project.test.ts` (~11: create DRAFT + createdBy embed, 401, 400, list+status filter, patch, delete→204 then 404, **tenancy 403 on read/update/delete by outsider**, outsider list empty, unknown id 404).
- **Scripts:** `test`, `test:watch`, `db:test:deploy` (`dotenv -e .env.test -- prisma migrate deploy`).
- **Verified:** typecheck clean; `npx vitest run` discovers both suites, injects `.env.test`, executes all tests — they fail ONLY at DB connect (placeholder host), proving the entire harness above the DB is correct.

### GREEN — user supplied a `test_db` (separate Neon database on the same project endpoint); all 16 migrations applied via `db:test:deploy`; **`npm test` → 22/22 passing** (~126s, dominated by Neon latency + bcrypt).
- **Fixed a real flake, not test-only:** register's `$transaction` hit `P2028: Unable to start a transaction in the given time` on Neon pooled cold-start (default maxWait 2s). Bumped to `{ maxWait: 10000, timeout: 15000 }` in [auth.service.ts](../src/modules/auth/auth.service.ts) `register` — same Neon-cold-start remedy Session 8 applied to the recommendations tx. Suite green after.
- Note: user's `.env.test` uses the SAME pooled host for both `DATABASE_URL` and `DIRECT_DATABASE_URL` (both `-pooler`); `migrate deploy` worked anyway this time. If migrations later P1001 against it, swap DIRECT to the non-pooler host.

### Decision — adaptive discovery (future work, NOT built this session)
- User asked whether the fixed 5-module / 10-question discovery skeleton (2 per module) could be made per-project flexible. Explained *why* it's fixed today (the guided process IS the product; fixed spine powers health-score comparability, progress/resume, stable answer IDs; deterministic = free/offline/testable). **Decision: keep current fixed design for now; do NOT build yet — logged as a backlog TODO** (feature.md + CLAUDE.md). Chosen direction when built: **hybrid generated plan + expanded fixed banks** (AI generates a persisted per-project question plan at session start, runs deterministically after; grow `questions.ts`; keep the Health Score rubric fixed; fall back to the bank on AI failure; frontend must render questions from the API). See feature.md backlog entry for the full spec.

### Next
- Once green: broaden coverage to the deterministic modules (workspaces RBAC, search, comments, settings, discovery skeleton). AI-dependent paths (blueprint gen, health, recs, chat) need a mock-AI strategy or a gated live-key run — decide later. Then deploy to Render.

---

## Session 19 — 2026-08-10

### Done — AI Chat (SSE) + Group Chat (Socket.io) — the last P2 + a new real-time feature
**AI Chat** (`src/modules/chat/`, migration `add_ai_chat`): personal per-project "founder copilot". Models `ChatConversation` (projectId + createdById, both Cascade → no sentinel needed) + `ChatMessage` (role USER/ASSISTANT). Endpoints under `/api/v1/projects/:projectId/chat`: `POST /` (**SSE** stream — delta*→done{conversationId,userMessage,assistantMessage}|error; reuses `generateTextStream` + blueprint SSE pattern; creates conversation when `conversationId` omitted, seeds title from first msg, feeds last 15 turns + project context), `GET /conversations`, `GET /conversations/:id`, `DELETE /conversations/:id`. **Live GPT-5-verified**: streamed a sharp context-aware answer; multi-turn context retained (4-msg thread); delete→404. Swagger + frontend-guide §19a.

**Group Chat** (`src/modules/group-chat/`, migration `add_group_chat`): workspace-scoped, Slack-style **named channels**, **Socket.io** real-time. Models `GroupChannel` (workspaceId, createdById SetNull, lastMessageAt) + `GroupMessage` (senderId) + `GroupChannelRead` (per-member last-read → unread). REST under `/api/v1/workspaces/:id/channels`: create/list(+hasUnread)/patch/delete (creator or OWNER/ADMIN for patch/delete), `GET|POST :cid/messages`, `POST :cid/read`. **Write path = REST**, then `emitToChannel()` broadcasts `message:new` over the socket. `@mentions` → `GROUP_MENTION` notification. A **"general" channel is auto-created** in `createWorkspace`. Swagger + frontend-guide §19b.

**Socket.io infra** (`src/realtime/io.ts`, `server.ts` now wraps Express in `http.Server`): JWT handshake auth (same access token via `handshake.auth.token`), rooms per channel (`channel:join`/`leave` with workspace-membership check, always-acks), `channel:typing` relay, `emitToChannel()` helper. **Redis adapter guarded by `REDIS_URL`** for multi-instance fan-out — but **only used for the Socket.io adapter** (no cache/sessions/queue on Redis). Single instance needs no Redis (in-memory adapter).

### ⚠️ Robustness fix (important)
- An unreachable `REDIS_URL` was **crashing the whole process** (ioredis unhandled 'error' + MaxRetries). Fixed in io.ts: `lazyConnect` + `connectTimeout` + `retryStrategy:()=>null` + `enableOfflineQueue:false` + `.on('error')` handlers + `await connect()` in try/catch → **falls back to in-memory adapter, never crashes**. (User's `.env` `REDIS_URL` is a Render-INTERNAL host, unreachable from local dev — server now boots fine anyway.)

### Account deletion + deps
- `deleteAccount` now also reassigns `GroupMessage.senderId` → sentinel (own customer/group data cascades; channel createdBy SetNull; reads cascade).
- New deps: `socket.io`, `@socket.io/redis-adapter`, `ioredis` (+ `socket.io-client` devDep for tests). New env `REDIS_URL` (optional) + `.env.example`.

### Redis usage decision (answered for user)
- Redis is used **only** for the Socket.io cross-instance broadcast adapter — NOT cache/sessions/queue. Durable chat history is in Postgres. So Render **free tier (no persistence, 25MB, 50 conns) is fine for prod** for this use: pub/sub is ephemeral, tiny memory, and connections are ~2 per *instance* (not per user). Upgrade only when adding BullMQ/queues (needs durability) or a Redis rate-limit store at scale.

### E2E verified
- AI chat: live SSE stream, multi-turn, CRUD, 404s. Group chat: auto general channel, non-member create→403, member→201; **socket** bad-token→rejected, join ack true, **A posts (REST) → B receives `message:new` live**, @mention→GROUP_MENTION notif. Test data cleaned; server stopped; typecheck clean.

### Status: ALL P2 + admin plan features DONE. Remaining for V1: **test harness** (biggest DoD gap) + **deploy**. Branch has Sessions 10–19 uncommitted (last commit was through S18-ish per user); 9 migrations total.

---

## Session 18 — 2026-08-10

### Done — Phase 4: Notifications (Core 4 + recommendation-created)
- New `NotificationType` enum (SUPPORT_REPLY, WORKSPACE_INVITE, COMMENT_REPLY, COMMENT_ADDED, RECOMMENDATION_CREATED) + `Notification` model (userId cascade, type, title, body?, `data` JSONB for click-through, readAt?, createdAt; indexes on userId+readAt / userId+createdAt). Migration `20260810043330_add_notifications`. Personal data → cascades on user delete, no sentinel needed.
- New `src/modules/notifications/` mounted `/api/v1/notifications`: `GET /` (list + `unreadCount`, `?unread=true`, pagination), `PATCH /:id/read` (idempotent), `POST /read-all` (`{updated}`), `DELETE /:id`. All scoped to req.user (others' → 404).
- **`notify(input)` helper** — fire-and-forget (`void ...catch`, never throws/blocks), the single entry point for triggers. Wired into 5 sites (all skip self-notify): support staff-reply→customer & user-reply→assigned admin (support.service); workspace invite existing-user→invitee (workspace.service); comment reply→parent author, top-level→project creator (comment.service); recommendations generated→project creator when actor≠creator (recommendation.service, covers proactive triggers). Skipped blueprint-ready per decision.
- Swagger `Notification` schema; frontend-guide new §19 (types→data table). Delivery = polling (same rationale as support; SSE upgrade path later w/ Redis).
- **E2E-verified:** all 4 deterministic triggers fired with correct type+recipient (invite→U2, comment-added→U1, comment-reply→U2, support-reply→U1); endpoints: unread filter, PATCH read (readAt+unreadCount drop), read-all `{updated}`→unreadCount 0, DELETE 204+total drop, cross-user→404, unknown→404, no-auth→401. (RECOMMENDATION_CREATED not live-run — needs AI; wiring mirrors the others.) Test data cleaned; server stopped; typecheck clean.

### Note (test flakiness, not bugs)
- Fire-and-forget notify is async → a notification row may not exist the instant after the parent request returns; tests need a tiny settle before asserting. Also the env staff token was captured empty once in a setup script (→ 401s); re-login fixed it. Both are harness issues, code verified correct.

### Status: P2 tier + admin plan nearly complete. Remaining: AI Chat (last P2), test harness (biggest DoD gap), deploy.

---

## Session 17 — 2026-08-10

### Reconciled the pending migration (Neon direct endpoint recovered)
- `npx prisma migrate resolve --applied 20260809132014_add_platform_role` → recorded; `migrate status` = "up to date". The S16 gotcha is CLEARED. All migrations now tracked normally.

### Done — Phase 3: Support chat (admin ↔ user)
- New enums `SupportStatus` (OPEN/CLOSED), `SupportSenderType` (USER/STAFF). Models `SupportConversation` (customer, optional subject, status, assignedAdmin [SetNull], `lastMessageAt` + `userLastReadAt`/`staffLastReadAt` for unread) + `SupportMessage` (senderType snapshot, senderId, body). Migration `20260810035153_add_support_chat` (clean `migrate dev`). Back-relations on User (SupportCustomer/SupportAssignee/SupportSender).
- New `src/modules/support/` — two routers: `supportRouter` `/api/v1/support` (requireAuth) + `supportAdminRouter` `/api/v1/admin/support` (requireAuth + requirePlatformRole SUPERADMIN/SUPPORT). Endpoints: user start/list/get/postMessage; staff inbox(list+status filter+pagination)/get/postMessage/PATCH status.
- **Unread model:** each side's `lastReadAt` bumped on send AND view, so `hasUnread = lastMessageAt > myLastReadAt` needs no per-message read rows and never flags your own messages. Staff's first reply **claims** the thread (assignedAdminId). User reply **reopens** a CLOSED thread.
- **Account-deletion updated:** `deleteAccount` now also reassigns `SupportMessage.senderId` → sentinel (staff messages in others' threads; own customer threads cascade via customerId; assignedAdmin is SetNull).
- Swagger `SupportConversation`/`SupportConversationDetail`/`SupportMessage`; frontend-guide new §18.
- **E2E-verified:** start (hasUnread false for creator); staff inbox shows customer + hasUnread true; staff open→read + reply→201 STAFF + claims (assignedAdminId set); U hasUnread true after staff reply → false after opening; staff CLOSE → U reply REOPENS (status OPEN); thread accumulates messages; U2→404, normal→/admin/support 403, no-auth 401, empty msg 400. (Neon dropped a few pooled connections mid-run → transient 500s; all passed on warm retry.) Test data cleaned (support msgs/convos deleted first due to senderId RESTRICT, then users).

### Next
- Phase 4: **Notifications** (`GET /notifications`, `PATCH /:id/read`, `POST /read-all`; fire-and-forget triggers: support reply, comment/reply, invite, blueprint complete). Then AI Chat. Test harness still biggest DoD gap.

---

## Session 16 — 2026-08-09

### Planning — user raised 3 new asks (account deletion, notifications need?, Fritlow-internal admin side)
Confirmed scope + laid out a 4-phase plan; user chose (via decision prompt): **anonymize-shared/cascade-personal** for deletion, **platformRole-on-User + seed script** for admin auth, **build account deletion first**.
- **My read on Notifications:** not worth it for solo V1, but now justified by Comments (multi-user) + the planned support chat → build lean/event-driven later (Phase 4).
- **Planned phases:** 1) Account deletion ✅ 2) Admin foundation (platformRole USER/SUPPORT/ADMIN + `requirePlatformAdmin` + `/admin/*` stats/users monitoring; note: NO analytics-events table yet, derive proxies from timestamps) 3) Support chat (admin↔user; `SupportConversation`/`SupportMessage`; polling for V1) 4) Notifications (`GET /notifications`, `PATCH /:id/read`, `POST /read-all`; fire-and-forget triggers). Sentinel excluded from admin stats later (by email).

### Done — #1 Account deletion (Phase 1)
- `DELETE /api/v1/settings/account`, body `{ password }` (re-auth). Added to settings module (schema/service/controller/route + OpenAPI).
- **Data strategy (chosen): anonymize shared, cascade personal.** A shared sentinel user `deleted-user@fritlow.internal` ("Deleted User", unusable password) inherits authorship of the deleted user's content in workspaces others still use.
- **Logic:** classify each membership — only-member workspace → `deleteMany` (cascades projects/blueprints/comments/decisions/etc.); shared workspace where user is the **sole OWNER with other members** → **block 400** (transfer/remove first). Then in one tx: delete sole-member workspaces, reassign surviving authored rows to sentinel (Project.createdById, DecisionLog.createdById, Comment.authorId, BlueprintSectionVersion.editedById, Export.createdById, WorkspaceInvitation.invitedById — the 6 RESTRICT FKs), then `user.delete` (memberships + RefreshToken/EmailVerification/PasswordReset cascade). `AiInteraction.userId` is relation-free → logs survive by design.
- **Sole owner + only member CAN delete** (their workspace cascades) — the block is ONLY when other members would be orphaned. (User asked; confirmed.)
- **E2E-verified + DB-verified:** wrong pw→401; sole-owner-of-shared-with-members→400; solo delete→204, login after→401; personal project cascade-deleted; shared project + decision survive with createdBy="Deleted User"; sentinel created. Test data + sentinel cleaned.
- frontend-guide §10 updated with the DELETE /account row. **Open question surfaced to user:** whether the blocked (last-owner) case should offer auto-transfer / opt-in workspace-delete instead of hard block.

### Done — #2 Admin foundation (Phase 2)
- **`platformRole` enum USER/SUPPORT/ADMIN** added to `User` (default USER) — platform-level, distinct from per-tenant WorkspaceRole. New `requirePlatformRole(...roles)` middleware ([src/middleware/platform-role.ts](../src/middleware/platform-role.ts)) — reads role from **DB not JWT** → instant revocation (verified: demote→403 on same token).
- New `src/modules/admin/` behind `requireAuth` + `requirePlatformRole('ADMIN','SUPPORT')`, mounted `/api/v1/admin`:
  - `GET /admin/stats` — platform-wide counts (users total/verified/new7/new30, workspaces, projects+byStatus+active7d, discovery sessions/completed/rate, blueprints, recommendations, exports). Sentinel excluded.
  - `GET /admin/users?page&limit&q` — paginated search (email+fullName), each with project/workspace counts.
  - `GET /admin/users/:id` — detail: workspaces(+role), projects, activity summary.
- **Seed:** [scripts/make-admin.ts](../scripts/make-admin.ts) — `npx tsx scripts/make-admin.ts <email> [ADMIN|SUPPORT|USER]`. Only way to grant staff.
- Swagger `AdminStats`/`AdminUserSummary`/`AdminUserDetail`; frontend-guide new §17.
- **E2E-verified:** normal→403, no-auth→401, promote→stats 200 (all metrics), users list paginated+search, detail w/ workspaces+projects+activity, unknown→404, SUPPORT→200, demote→instant 403. Test data cleaned; server stopped; typecheck clean.
- **Caveat (analytics):** engagement = timestamp proxies (projects touched in 7d); no product-analytics events table yet (known PRD gap).

### Refinement (same session, user asks) — platform roles renamed + admin is env-seeded, not registered
- **Naming de-collision:** platform role `ADMIN` → **`SUPERADMIN`** (enum now USER/SUPPORT/SUPERADMIN) so there is ZERO overlap with WorkspaceRole (OWNER/ADMIN/MEMBER) — the two axes were already separate columns; this removes the shared word. Renamed live enum via pooled `ALTER TYPE ... RENAME VALUE 'ADMIN' TO 'SUPERADMIN'`; edited the staged `add_platform_role` migration.sql to create the enum already-final; regen client. Updated middleware call, make-admin (default now SUPPORT), swagger, docs.
- **Admin never registers — logs in from env.** New `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` env (config/env.ts + .env.example). New `seedPlatformAdmin()` ([src/modules/admin/admin.seed.ts](../src/modules/admin/admin.seed.ts)) upserts the SUPERADMIN on boot (called in server.ts, fire-and-forget, idempotent); .env is source of truth (re-syncs password/role/verified each boot). Admin uses the **normal `POST /auth/login`** — no separate admin auth. Registering with the admin email → 409. make-admin.ts stays for adding SUPPORT staff.
- **E2E-verified:** boot seeds `[admin] platform SUPERADMIN ready`; login with env creds → token; `/admin/stats` 200 (after one transient Neon ConnectionClosed 500 → retry OK); `/admin/users?q` shows platformRole SUPERADMIN; register-as-admin → 409. Test admin (boss@fritlow.io) cleaned. typecheck clean.
- **Login endpoint** (user asked): single shared `POST /api/v1/auth/login` — admin is not special-cased, only its `platformRole` differs.

### ⚠️ MIGRATION GOTCHA — ✅ RESOLVED in Session 17 (see top). Original note below for history.
### ⚠️ MIGRATION GOTCHA — needs reconciliation when Neon direct endpoint recovers
Neon's **direct** endpoint was down (P1001) during this session; **pooled** was up. So `add_platform_role` migration file is staged at `prisma/migrations/20260809132014_add_platform_role/` but the **DDL was applied via the POOLED connection** (raw `CREATE TYPE`+`ALTER TABLE`), NOT through `prisma migrate` — so it is **NOT recorded in `_prisma_migrations`**. **TO DO when direct endpoint is reachable:** run `npx prisma migrate resolve --applied 20260809132014_add_platform_role` (marks it applied without re-running — re-running would fail on "type already exists"). Until then `migrate dev`/`deploy` will think it's pending. The DB column exists and works at runtime (pooled).

### Next
- Phase 3: **Support chat** (admin↔user; `SupportConversation`/`SupportMessage`; polling V1). Then Phase 4 Notifications. Test harness still biggest DoD gap.

---

## Session 15 — 2026-08-09

### Done — P2 tier: Comments (built exactly to the frontend build spec)
- User supplied the **full build spec** (`FRITLOW_Backend_Gap_Analysis_and_Build_Spec.md`) — item 10 Comments. Built to its exact paths:
  - `POST /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}/comments`
  - `GET  /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}/comments`
  - `DELETE /api/v1/comments/{id}` ← **flat/top-level per spec**, NOT nested. Threaded via optional `parentId`.
- New `Comment` model (migration `20260809061233_add_comments`): body, projectId, blueprintSectionId, sectionKey (denormalized), authorId, `parentId` self-relation (`CommentReplies`, onDelete Cascade → deleting a thread root removes replies). Back-relations on User/Project/BlueprintSection. **Comments anchor to a SECTION, not the project** (matching the spec — no project-level comments).
- New `src/modules/comments/` (schemas/service/controller/**two routers**: `commentSectionRouter` mergeParams for create/list at the deep path, `commentRouter` for the flat DELETE). Mounted both in app.ts.
- **Access:** any project member reads/posts (via `getProject` membership gate); a reply's parent must be on the SAME section (else 404). **Delete:** author OR workspace OWNER/ADMIN (resolves workspace from the comment since the DELETE path has no projectId). No edit endpoint — spec only lists POST/GET/DELETE.
- `GET` returns a **threaded tree**: top-level comments (oldest first), each with nested `replies[]` (built in-memory by parentId, any depth). Comment shape: `{ id, body, projectId, sectionKey, parentId, author{id,fullName}, createdAt, updatedAt, replies[] }`.
- Swagger `Comment` schema (recursive `replies`); frontend-guide new §14 (Errors→15, Rate limiting→16).
- **E2E-verified:** A posts top-level; B (member) replies w/ parentId → nested correctly; reply w/ parent from a different section → 404; unknown section → 404; empty body → 400; no auth → 401; **delete matrix:** B(member,non-author)→403, author→204, OWNER-deletes-member's→204, unknown→404; **cascade** (delete parent → replies gone, list empty); **tenancy** (outsider list/post → 403). Blueprint sections seeded directly (no AI); test data cleaned; server stopped; typecheck clean.

### Next (P2 remaining)
- **Decide Notifications** (spec item 8: `GET /notifications`, `PATCH /:id/read`, `POST /read-all`; triggers: discovery follow-up ready, blueprint complete, recommendation created) — still challenge scope, but the spec gives a concrete minimal contract. Then **AI Chat** (spec item 11: `POST /projects/{id}/chat`, SSE, `ChatConversation`/`ChatMessage`). Test harness still the biggest DoD gap.

---

## Session 14 — 2026-08-09

### Done — P2 tier started: Search (first P2 feature)
- New `src/modules/search/` (schemas/service/controller/routes). `GET /api/v1/search?q=&limit=` (requireAuth, no new tables). Case-insensitive substring search across **projects** (name/oneLineIdea/category), **blueprint sections** (title + JSONB `content->>'markdown'`), **decisions** (title/reasoning), and **recommendations** (title/body). **Tenancy-scoped** via `workspace.members.some.userId` nested filters (raw query for sections joins `WorkspaceMember` explicitly). `q` min 2 chars (400 otherwise); `limit` 1–50 default 10, applied **per type**.
- **Blueprint section body** search uses a parameterized `prisma.$queryRaw` with `ILIKE` on `content->>'markdown'` — Prisma's JSON filters are case-SENSITIVE, so raw SQL gets case-insensitive matching on the JSONB markdown. Injection-safe (tagged-template bind params).
- Response: `{ query, counts:{project,blueprint_section,decision,recommendation,total}, results:[] }`; each result `{ type, id, title, snippet, projectId, projectName, sectionKey? }`. `snippet` = ~90-char window around the first match. Flat list, grouped client-side.
- Swagger `SearchResult` + `SearchResults` schemas; frontend-guide new §13 (Errors→14, Rate limiting→15); fixed the stale §12 note (non-user invites now work).
- **E2E-verified:** q=flamingo → all 4 types hit with correct snippets + sectionKey; q=STRIPE (uppercase) → case-insensitive decision hit; q=zephyr → project only; q=x → 400; no-auth → 401; **cross-user outsider → 0 results (tenancy holds)**. Blueprint section + recommendation seeded directly (no AI cost); test data cleaned.

### Next (P2 remaining)
- **Comments** (next): new `Comment` model (project + optional blueprintSection target, author, body, resolved?), CRUD scoped to project members. Pairs with the workspace membership + feeds any future Notifications.
- Then **decide Notifications** (challenge scope — dashboard `nextAction` may cover V1), then **AI Chat** (SSE, largest). Test harness still the biggest DoD gap — slot in early; Search/Comments are good deterministic first targets.

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
