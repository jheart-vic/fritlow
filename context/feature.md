# Current Feature

> Update this file whenever the active feature changes. One feature in focus at a time.

## Active: Settings module (next up — agreed 2026-07-18)

Scope: profile update (name), password change while logged in, workspace rename. Small; backs the Settings screen (a supporting surface in MVP scope). Follows the routes → controllers → services → Prisma layering; add OpenAPI blocks + frontend-guide entries. Password change should verify the current password and (like reset-password) revoke existing sessions.

### Done last session — Rate limiting (2026-07-20)

`express-rate-limit` v8 on the auth routes: `authLimiter` (10/15min on login/register/refresh/verify-email/reset-password) and `emailLimiter` (3/hour on resend-verification/forgot-password — each spends real Brevo quota). 429 + `Retry-After` + draft-8 `RateLimit-*` headers. Config via env (`*_RATE_LIMIT_*`, `RATE_LIMIT_ENABLED`, `TRUST_PROXY_HOPS`). **Deploy reminder: set `TRUST_PROXY_HOPS=1` behind Render's proxy; swap the in-memory store for Redis once >1 instance.** See session.md Session 5.

### Prioritized queue after Settings (agreed 2026-07-18)

1. **Notifications** — CHALLENGE BEFORE BUILDING: dashboard `nextAction` may already cover the V1 need; possibly cut.
2. **Subscriptions/billing + audit logs** — nothing in the five core screens depends on them; after deploy.

### Non-feature items competing for attention (both currently blocked on the user)

- **Deploy to Render** — everything the frontend dev needs is built; a live URL unblocks THEM. Remember: new email env vars (BREVO_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, APP_URL) + Render's outbound IPs need authorizing in Brevo (or disable the IP restriction). Full env list in session.md Session 3.
- **Live AI tests** — blocked on Anthropic credits (console.anthropic.com, $5 min). Follow-ups, blueprint generation (sync + SSE), health score have NEVER run against the real model. Delete the seeded test blueprint on the "Fritlow" project first (else 409 on generate).

### Feature backlog (MVP order — backend/API deliverables)
- [x] Auth module (JWT + refresh rotation, workspace tenancy foundation) — register/login/refresh/logout/me/forgot/reset + email verification (**gates login** — register issues no tokens, login 403s until verified) + Brevo email delivery (verification + reset emails, live sending confirmed working 2026-07-18)
- [x] Project CRUD + status states (Draft → Discovery → Blueprint Complete → Launched) — workspace-scoped with membership checks; delete = OWNER/ADMIN only; responses embed `createdBy {id, fullName, email}`
- [x] Discovery Interview engine — deterministic skeleton (sessions, JSONB answers, 10-question bank, progress/resume, lifecycle) + AI follow-up endpoint (Challenge Mode) — live AI untested pending credits
- [x] Blueprint module (8 JSONB sections, AI generation from discovery transcript, living edits) + Decision Log CRUD — AI generation untested pending credits
- [x] AI orchestration layer (provider-agnostic, full interaction logging via AiInteraction; Anthropic first provider; SSE streaming for blueprint generation)
- [~] Async jobs — SSE streaming done; BullMQ deferred until Redis exists (Upstash at deploy)
- [x] Export service (PDF / DOCX / Markdown, on-the-fly; DO Spaces storage at deploy)
- [x] Dashboard/next-action endpoint + [x] Product Health Score (AI-graded, 5 dimensions; untested pending credits)
- [x] Email service (Brevo, `src/lib/email/` — best-effort sends, provider isolated in one file)
- [x] Rate limiting (express-rate-limit v8; authLimiter 10/15min + emailLimiter 3/hr; 429 + Retry-After + draft-8 headers; env-configurable; TRUST_PROXY_HOPS for prod)
- [ ] **Settings (profile update, password change, workspace rename)** ← ACTIVE
- [ ] Notifications (challenge scope first — may be cut for V1)
- [ ] Subscriptions/billing, audit logs

### Docs to keep current with any API change
- OpenAPI `@openapi` blocks in `*.routes.ts` (the frontend contract, served at /docs)
- `docs/frontend-api-guide.md` (all endpoints + Postman walkthrough)
- `docs/auth-email-verification.md` (verification flow deep-dive)
