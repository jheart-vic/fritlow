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
- [ ] **P2: AI Chat** (SSE, spec item 11) — after the admin/support work
- [ ] Test harness (unit + integration) — biggest DoD gap
- [ ] Subscriptions/billing, audit logs (post-deploy)

### Docs to keep current with any API change
- OpenAPI `@openapi` blocks in `*.routes.ts` (the frontend contract, served at /docs)
- `docs/frontend-api-guide.md` (all endpoints + Postman walkthrough)
- `docs/auth-email-verification.md` (verification flow deep-dive)
