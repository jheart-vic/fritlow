# Current Feature

> Update this file whenever the active feature changes. One feature in focus at a time.

## Active: building PRD-MVP gaps in priority order (started 2026-08-08)

Working the highest-priority unbuilt MVP items first (see [prd-backlog.md](prd-backlog.md)). Done: **AI Recommendations** (#1). **Next: Version History** (#2), then a **test harness** (#3).

### Just built — AI Recommendations / AI Product Strategist (2026-08-08)
`src/modules/recommendations/` + `Recommendation` model (migration `add_recommendations`). `POST /api/v1/projects/:id/recommendations` (AI generates 3–6 prioritized, accept/rejectable insights from discovery + blueprint + health score), `GET /` (optional `?status`, HIGH-severity first), `PATCH /:id` (ACCEPTED/REJECTED). Regeneration replaces the PENDING batch but keeps ACCEPTED/REJECTED as history. Fully E2E-verified against GPT-5. OpenAPI + frontend-guide §7 (Export→§8 … Rate limiting→§12).

### Still on the list before Notifications
- **Notifications** — CHALLENGE BEFORE BUILDING: dashboard `nextAction` may already cover the V1 need. Decide before coding.

### Done recently (2026-07-20, Session 5)

- **Settings module** — `src/modules/settings/`: `PATCH /profile` (name), `POST /password` (verify current, revoke all sessions), `PATCH /workspaces/:workspaceId` (OWNER/ADMIN only). OpenAPI + frontend-guide §9. E2E verified. `toPublicUser` now exported from auth.service; `Workspace` schema added to swagger.
- **Rate limiting** — `express-rate-limit` v8: `authLimiter` (10/15min on login/register/refresh/verify-email/reset-password) + `emailLimiter` (3/hour on resend-verification/forgot-password). 429 + `Retry-After` + draft-8 headers; env-configurable. **Deploy reminder: set `TRUST_PROXY_HOPS=1` behind Render's proxy; swap in-memory store for Redis once >1 instance.**

### Prioritized queue after Notifications (agreed 2026-07-18)

1. **Subscriptions/billing + audit logs** — nothing in the five core screens depends on them; after deploy.

### PRD items in MVP scope but NOT built (from [prd-backlog.md](prd-backlog.md) — full map there)

Surfaced 2026-08-07 by auditing the PRD against the code. These are *specified for V1* yet missing — candidates that may outrank the deferred items above:
- ~~**AI Recommendations / AI Product Strategist (baseline)**~~ — ✅ BUILT 2026-08-08 (see above).
- **Version History** — no project/blueprint version history table yet. ← NEXT
- **Automated tests** — none exist; PRD's Definition of Done requires unit + integration tests. Biggest process gap.
- Also unbuilt (see prd-backlog.md §3–5): Dynamic Impact Analysis, discovery confidence meter, richer blueprint sections/discovery modules, templates entity, audit logs, product-analytics events, CSRF review.

**Not yet re-prioritized with the user** — raise these against the deploy/notifications decisions before picking the next build.

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
- [x] AI Recommendations / Product Strategist (Recommendation model; generate/list/accept-reject; regen keeps decisions; GPT-5 verified)
- [ ] **Version History** ← NEXT
- [ ] Notifications (challenge scope first — may be cut for V1)
- [ ] Subscriptions/billing, audit logs

### Docs to keep current with any API change
- OpenAPI `@openapi` blocks in `*.routes.ts` (the frontend contract, served at /docs)
- `docs/frontend-api-guide.md` (all endpoints + Postman walkthrough)
- `docs/auth-email-verification.md` (verification flow deep-dive)
