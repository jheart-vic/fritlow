# Current Feature

> Update this file whenever the active feature changes. One feature in focus at a time.

## Active: Project Bootstrap (pre-code)

**Status:** No code written yet. Repo contains only README, LICENSE, CLAUDE.md, and this context folder.

**Goal:** Scaffold the Agmund V1 workspace and lock the foundations before UI work.

### Next concrete steps (in order)
1. ~~Confirm database~~ — **DONE: PostgreSQL + Prisma** (2026-07-16).
2. ~~Repo layout~~ — **DONE: this repo is backend-only**; frontend lives in a separate repo owned by another dev (2026-07-16).
3. ~~Framework~~ — **DONE: PEN stack (Express + TypeScript + Prisma)**, not NestJS (2026-07-16).
4. Scaffold the Express + TypeScript backend (feature-module layout, service layer, zod validation).
5. **Lock the data model** — write the Prisma schema for the core domain: Users, Workspaces, Members, Projects, Discovery Sessions/Answers, Blueprints/Sections, Recommendations, Decision Logs, Templates, Exports, Notifications, Subscriptions, Audit Logs.
6. Draft the OpenAPI contract for core endpoints (auth, project CRUD, discovery, blueprint, recommendations, export) — **this is the handoff artifact for the frontend dev**, so keep it current.
7. Stand up the AI provider abstraction (LiteLLM-style) behind one interface.

### Feature backlog (MVP order, after bootstrap — backend/API deliverables)
- [ ] Auth module (JWT + refresh, RBAC, Workspace → Project tenancy)
- [ ] Project CRUD + status states (Draft → Discovery → Blueprint Complete → Launched)
- [ ] Discovery Interview engine (sessions, answers, adaptive follow-ups, Challenge Mode, confidence scoring) — the signature feature
- [ ] Blueprint module (sections as JSONB, health score, decision log, impact analysis)
- [ ] AI orchestration layer (provider-agnostic, SSE streaming, full interaction logging)
- [ ] Async jobs (Redis + BullMQ: blueprint generation, exports; <10s budget with progress feedback)
- [ ] Export service (PDF / DOCX / Markdown → DO Spaces)
- [ ] Dashboard/next-action endpoints, notifications, settings, subscriptions, audit logs

### Completed features
_(none yet)_
