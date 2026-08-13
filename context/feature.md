# Current Feature

> Update this file whenever the active feature changes. One feature in focus at a time.

## Active: building PRD-MVP gaps in priority order (started 2026-08-08)

Working the highest-priority unbuilt MVP items first. Priority order **reconciled 2026-08-08 with the frontend dev's build spec** (full detail + the reconciled order in [prd-backlog.md](prd-backlog.md) §8–§9):

1. ✅ **AI Recommendations** — DONE; reshaped to the spec 2026-08-08 (type/body/severity INFO-WARNING-CRITICAL/status OPEN-ACK-DISMISSED-RESOLVED/sourceContext, `POST /generate`). GPT-5 verified.
2. ✅ **Health-score dimension fix** — DONE; now 7 dims (added `technical_complexity` + `market_readiness`, kept `differentiation`).
3. ✅ **Version History** — DONE 2026-08-08 (`BlueprintSectionVersion`; snapshot-on-PATCH; `GET …/versions` + non-destructive `POST …/restore`). GPT-5-free, E2E-verified.
4. ✅ **Impact Analysis + Confidence Meter** — DONE. → 5. ✅ **Template entity** — DONE. → 6. ✅ **Workspace CRUD + membership** — DONE 2026-08-09. **All P0/P1 MVP gaps closed.**
7. **P2 tier** (in progress): ✅ **Search** DONE 2026-08-09. ✅ **Comments** DONE 2026-08-09 (spec-exact: section-anchored, threaded `parentId`, flat DELETE `/api/v1/comments/{id}`, E2E-verified). → decide **Notifications** (challenge scope; spec item 8 gives a minimal contract) → **AI Chat** (SSE, spec item 11, largest).
8. **Test harness** — our biggest DoD gap (not on the spec's list); slot in early. Search/Comments are good deterministic first targets.

**~~Deferred from the Recommendation work:~~ DONE (Session 13):** the spec's **proactive triggers** (auto-generate after discovery-complete / blueprint-gen / low health dim <60) are now wired — `triggerRecommendations()`, fire-and-forget, GPT-5-verified.

**~~Also surfaced by the spec:~~ DONE:** workspace management (Session 12) + **non-user email invites** with auto-join-on-signup (Session 13, `WorkspaceInvitation` model).

### Just built — AI Recommendations / AI Product Strategist (2026-08-08)
`src/modules/recommendations/` + `Recommendation` model (migration `add_recommendations`). `POST /api/v1/projects/:id/recommendations` (AI generates 3–6 prioritized, accept/rejectable insights from discovery + blueprint + health score), `GET /` (optional `?status`, HIGH-severity first), `PATCH /:id` (ACCEPTED/REJECTED). Regeneration replaces the PENDING batch but keeps ACCEPTED/REJECTED as history. Fully E2E-verified against GPT-5. OpenAPI + frontend-guide §7 (Export→§8 … Rate limiting→§12).

Note on **Notifications** (P2 above) — still CHALLENGE BEFORE BUILDING: dashboard `nextAction` may already cover the V1 need.

### Done recently (2026-07-20, Session 5)

- **Settings module** — `src/modules/settings/`: `PATCH /profile` (name), `POST /password` (verify current, revoke all sessions), `PATCH /workspaces/:workspaceId` (OWNER/ADMIN only). OpenAPI + frontend-guide §9. E2E verified. `toPublicUser` now exported from auth.service; `Workspace` schema added to swagger.
- **Rate limiting** — `express-rate-limit` v8: `authLimiter` (10/15min on login/register/refresh/verify-email/reset-password) + `emailLimiter` (3/hour on resend-verification/forgot-password). 429 + `Retry-After` + draft-8 headers; env-configurable. **Deploy reminder: set `TRUST_PROXY_HOPS=1` behind Render's proxy; swap in-memory store for Redis once >1 instance.**

### Prioritized queue after Notifications (agreed 2026-07-18)

1. **Subscriptions/billing + audit logs** — nothing in the five core screens depends on them; after deploy.

> The full, cross-checked gap map + reconciled build order lives in [prd-backlog.md](prd-backlog.md) (§8 = cross-check deltas, §9 = build order). The priority list at the top of this file is the working queue.

### Non-feature items competing for attention (both currently blocked on the user)

- **Deploy to Render** — everything the frontend dev needs is built; a live URL unblocks THEM. Remember: new email env vars (BREVO_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, APP_URL) + Render's outbound IPs need authorizing in Brevo (or disable the IP restriction). Full env list in session.md Session 3.
- **Live AI tests** — NO LONGER FULLY BLOCKED: the AI layer now supports OpenAI GPT-5 (toggle `AI_PROVIDER=openai`) and the user's `.env` has a working `OPENAI_API_KEY` — the ai.service layer is confirmed working live (complete + stream). Still to do: run the actual feature ENDPOINTS end-to-end against the model — discovery follow-ups (Challenge Mode), blueprint generation (sync + SSE), health score. Delete the seeded test blueprint on the "Fritlow" project first (else 409 on generate). Anthropic path still unverified (needs Anthropic credits), but that's optional now.

### Feature backlog (MVP order — backend/API deliverables)
- [x] Auth module (JWT + refresh rotation, workspace tenancy foundation) — register/login/refresh/logout/me/forgot/reset + email verification (**gates login** — register issues no tokens, login 403s until verified) + Brevo email delivery (verification + reset emails, live sending confirmed working 2026-07-18)
- [x] Project CRUD + status states (Draft → Discovery → Blueprint Complete → Launched) — workspace-scoped with membership checks; delete = OWNER/ADMIN only; responses embed `createdBy {id, fullName, email}`
- [x] Discovery Interview engine — deterministic skeleton (sessions, JSONB answers, 10-question bank, progress/resume, lifecycle) + AI follow-up endpoint (Challenge Mode) — live AI untested pending credits
- [x] Blueprint module (8 JSONB sections, AI generation from discovery transcript, living edits) + Decision Log CRUD — AI generation untested pending credits
- [x] AI orchestration layer (provider-agnostic, full interaction logging via AiInteraction; Anthropic + OpenAI GPT-5 providers, toggle via AI_PROVIDER; SSE streaming for blueprint generation)
- [~] Async jobs — SSE streaming done; BullMQ deferred until Redis exists (Upstash at deploy)
- [x] Export service (PDF / DOCX / Markdown, on-the-fly; DO Spaces storage at deploy)
- [x] Dashboard/next-action endpoint + [x] Product Health Score (AI-graded, 5 dimensions; untested pending credits)
- [x] Email service (Brevo, `src/lib/email/` — best-effort sends, provider isolated in one file)
- [x] Rate limiting (express-rate-limit v8; authLimiter 10/15min + emailLimiter 3/hr; 429 + Retry-After + draft-8 headers; env-configurable; TRUST_PROXY_HOPS for prod)
- [x] Settings (profile name update, password change w/ session revocation, workspace rename — OWNER/ADMIN)
- [x] AI Recommendations / Product Strategist — spec-aligned shape (type/body/severity INFO-WARNING-CRITICAL/status OPEN-ACK-DISMISSED-RESOLVED/sourceContext; `POST /generate`); regen keeps decisions; GPT-5 verified. (Proactive triggers deferred.)
- [x] Health-score dimension fix — now 7 dims (technical_complexity + market_readiness added; differentiation kept)
- [x] Version History — `BlueprintSectionVersion`; PATCH snapshots pre-edit content; `GET …/versions` + non-destructive restore; E2E-verified
- [x] Blueprint Dynamic Impact Analysis (`POST …/impact-analysis`, on-demand) + Discovery Confidence Meter (AI grade on submit, best-effort, in answer JSONB) — GPT-5 verified
- [x] Template entity — static in-code catalogue (7 categories); `GET /templates` + `GET /templates/{id}` with prefillDiscoveryHints; E2E-verified
- [x] Workspace management — `POST/GET /workspaces`, `GET /:id/members`, invite/role/remove; RBAC guards (owner-only owner role, always ≥1 owner); E2E-verified (12 scenarios)
- [x] **P2: Search** — `GET /search` across projects/blueprint-sections/decisions/recommendations, tenancy-scoped; E2E-verified
- [x] **P2: Comments** — section-anchored, threaded `parentId`; POST/GET nested, DELETE flat `/api/v1/comments/{id}`; author-or-OWNER/ADMIN delete + cascade; E2E-verified
- [x] **Account deletion** — `DELETE /settings/account` (password re-auth); cascade personal + anonymize shared to "Deleted User" sentinel; blocks last-owner-of-shared-with-members; E2E+DB-verified
- [x] **Admin foundation (Phase 2)** — `platformRole` USER/SUPPORT/**SUPERADMIN** (renamed from ADMIN so it never collides with WorkspaceRole) + `requirePlatformRole` (DB-read, instant revoke) + `/admin/stats|users|users/:id`. **Admin is env-seeded (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), never registers** — logs in via normal `/auth/login`; `scripts/make-admin.ts` adds SUPPORT staff. E2E-verified. ⚠️ migration `add_platform_role` applied via pooled DDL — needs `migrate resolve --applied` when Neon direct endpoint recovers (see session.md S16).
- [x] **Support chat (Phase 3)** — `SupportConversation`/`SupportMessage`; user `/support/*` + staff `/admin/support/*`; unread via lastReadAt timestamps, staff-claim, reopen-on-user-reply; account-deletion reassigns staff msgs to sentinel; E2E-verified. (migration `add_support_chat`; platformRole migration reconciled via `migrate resolve`.)
- [x] **Notifications (Phase 4)** — `Notification` model; `GET /notifications` (+unreadCount, unread filter), `PATCH /:id/read`, `POST /read-all`, `DELETE /:id`; `notify()` fire-and-forget wired to 5 triggers (support reply both ways, workspace invite, comment reply, comment-added, recommendation-created); polling delivery; E2E-verified.
- [x] **P2: AI Chat** — SSE, personal per-project copilot; `POST /projects/:id/chat` (+conversations CRUD); GPT-5-verified.
- [x] **Group Chat (Socket.io)** — workspace named channels, real-time `message:new` broadcast, JWT socket auth, per-member unread, @mention notifications; Redis adapter guarded by `REDIS_URL` (in-memory fallback, crash-safe). E2E-verified. **New stack: socket.io + ioredis.**
- [~] **Test harness (unit + integration)** ← IN PROGRESS (Session 20) — Vitest + Supertest scaffolded; auth + projects suites written (13 + ~11 tests). **Blocked on user:** create a separate Neon test DB, fill `.env.test`, run `npm run db:test:deploy` then `npm test`. Wiring verified (env injects, suites discovered/run — fail only on placeholder DB host).
- [ ] Subscriptions/billing, audit logs (post-deploy)
- [x] **Adaptive discovery — hybrid generated plan + expanded banks** (DONE Session 21, client-approved). Discovery is now per-project adaptive while deterministic once generated:
  - **Hybrid plan:** `discovery.plan.ts` `generateQuestionPlan()` — at session start AI builds a tailored plan (seed = base plan for the project's category), persisted to new `DiscoverySession.questionPlan` JSONB, frozen after. Deterministic **fallback to `assembleBasePlan()`** on any AI failure/absence. Service refactored so start/get/answer/follow-up/complete run against the session plan; `total` is now per-project (dashboard fixed too).
  - **Expanded banks:** `questions.ts` now 7 core modules (added `go_to_market`, `risks`) + `categoryPacks` (7 packs, fuzzy category match).
  - **Health Score rubric stays FIXED** (comparability preserved) — health/blueprint/chat/recs read the transcript generically, needed no change.
  - **Frontend contract:** responses now include a `questions` array (render from it, don't hardcode); IDs per-session. OpenAPI + frontend-guide §3 updated.
- [x] **Blueprint SSE per-section events (Option B)** (DONE Session 21). The stream now emits `section` events `{key,title,status: writing|complete}` in section order (derived server-side by watching the streaming JSON keys — `createSectionTracker` in blueprint.service), so the frontend's section-progress checklist needs NO stream parsing. `delta`/`done`/`error` unchanged. Corrected the frontend on the real 8 fixed section keys (no "Technical Architecture"/"Go-to-Market" sections). Tracker unit-tested (4 tests). OpenAPI + guide §4 updated.

- [x] **Document upload → discovery pre-fill** (DONE 2026-08-12, client-requested). Founders upload an existing PRD/MVP (PDF, `.docx`, or an image/photo) and Fritlow drafts discovery answers from it — **into the normal interview, not around it**:
  - **New module** `src/modules/documents/` + `ProjectDocument` model (migration `add_project_documents`). `POST/GET /projects/:id/documents`, `GET/DELETE /:documentId`. Upload returns **202**; extraction runs fire-and-forget and the frontend polls `status` (UPLOADED → EXTRACTING → EXTRACTED | FAILED).
  - **Three extraction paths, cheapest first:** PDF text layer via `unpdf`, `.docx` via `mammoth` (HTML → markdown so headings survive), and **AI vision** for images + PDFs with no text layer. No OCR and no page-rasterising: both providers take the file directly. Scanned PDFs capped at **30 pages** on cost grounds.
  - **AI layer now carries attachments** — `AiCompletionRequest.attachments` (`{kind: 'image'|'pdf', mimeType, base64}`), implemented in **both** providers. The audit log records attachment metadata, never the base64.
  - **Pre-fill:** `POST /projects/:id/discovery/prefill` drafts answers for the questions the document genuinely answers (instructed to omit rather than guess). Drafts carry `source: 'document'` + `needsReview: true` in the answer JSONB; submitting the question clears the flag, and **`POST /complete` is blocked while any draft is unreviewed** — a document can never silently become a blueprint.
  - **Plan generation reads the document too**, so the interview probes what the PRD leaves open instead of re-asking it.
  - **Verified live against GPT-5**: text-layer PDF → `PDF_TEXT` (zero AI cost), no-text PDF → `VISION` round-trip OK. Anthropic attachment path is fully wired but **untested** (no credits) — same status as the rest of the AI layer.

- [x] **Frontend-reported gaps + workspace sharing model** (DONE 2026-08-12, second batch):
  - **Spec fixes the frontend flagged:** provenance fields (`source`/`sourceDocumentId`/`needsReview`) added to the `DiscoveryProgress` answer schema (they were live but undocumented — keys are **absent**, never null, on founder-typed answers); `/admin/stats` prose corrected `ADMIN` → `SUPERADMIN` (the rename shipped in S16; only the description was stale).
  - **`platformRole` now returned by `toPublicUser`** → login, register, verify-email, `GET /auth/me`. The frontend previously could not gate an Admin nav link at all. Rendering hint only — `requirePlatformRole` still re-reads from the DB per request.
  - **`GET /projects?workspaceId=`** — scopes the list to one workspace (403 if not a member, rather than a misleading empty list). Powers a workspace switcher; omitting it keeps the old flat behaviour.
  - **`Workspace.isPersonal`** (migrations `add_workspace_is_personal` + `fix_is_personal_shared_workspaces`, both applied). Set at registration. The first backfill used the old "earliest workspace you own" rule and **mislabelled two multi-member workspaces as personal** — the corrective migration applies the better rule: a workspace with more than one member is not private. Verified against live data (3 personal, all single-member).
  - **Invites into a personal workspace are refused (400)** — it accumulates every project a founder ever started, so one invite would have exposed the lot. **Breaking for the frontend invite flow**: it now needs a create/pick-workspace step. Every invite response also carries **`sharedProjectCount`** so the UI can say what the invitee will actually see.
  - **Project move**: `PATCH /projects/:id` accepts `workspaceId`, requiring OWNER/ADMIN on **both** sides (same bar as delete — the source's members lose access). Without this, blocking personal-workspace invites would have been a dead end for anyone whose work already lives there.
  - Still open, deliberately not built: an **accept step** for invites (existing users are still added instantly), and tightening MEMBER permissions (a MEMBER can change project status and delete uploaded documents).

### Docs to keep current with any API change
- OpenAPI `@openapi` blocks in `*.routes.ts` (the frontend contract, served at /docs)
- `docs/frontend-api-guide.md` (all endpoints + Postman walkthrough)
- `docs/auth-email-verification.md` (verification flow deep-dive)
