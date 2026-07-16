# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

This repo is the workspace for building **Fritlow V1 (MVP)** — an AI-powered Product Operating System that guides founders from a one-line idea to a build-ready "Living Blueprint." Differentiator is process (guided discovery interview, AI Challenge Mode, Product Health Score, one source of truth per project), not "better AI."

**This repo is the backend only** — an Express + TypeScript REST API (PEN stack). The Nuxt/Vue frontend lives in a separate repo owned by another developer; the OpenAPI contract is the handoff point, so keep it accurate and current.

## Commands

- `npm run dev` — start the API with hot reload (tsx watch) at http://localhost:4000
- `npm run typecheck` — TypeScript check without emitting
- `npm run build` / `npm start` — compile to `dist/` and run
- `npm run db:generate` — regenerate the Prisma client (into `src/generated/prisma`, gitignored) after schema changes
- `npm run db:migrate` — create + apply a migration after editing `prisma/schema.prisma`
- `npm run db:studio` — browse the database in Prisma Studio
- API docs (Swagger UI) at `/docs`, raw OpenAPI JSON at `/docs.json`

## Architecture

Request flow: **routes → controllers → services → Prisma models** (this layering is a hard rule):
- `src/modules/<feature>/<feature>.routes.ts` — URL wiring + `@openapi` JSDoc blocks (swagger-jsdoc scans these; every endpoint MUST have one)
- `<feature>.controller.ts` — thin HTTP layer: read validated input, call service, pick status code. No business logic.
- `<feature>.service.ts` — all business logic; the only layer that touches `prisma`
- `<feature>.schemas.ts` — zod input schemas, run by `validateBody` middleware before controllers; `z.infer` gives the input types
- Shared plumbing: `src/config/` (env validation via zod, swagger spec), `src/lib/prisma.ts` (single PrismaClient with `@prisma/adapter-pg` — Prisma 7 needs a driver adapter), `src/middleware/` (requireAuth, validateBody, errorHandler), `src/utils/` (ApiError, bcrypt password hashing, JWT + opaque tokens)
- Errors: throw `ApiError.<kind>()` in services; the error-handler middleware maps them to HTTP responses. Express 5 auto-forwards async rejections — no try/catch in controllers.
- Auth model: short-lived JWT access tokens (stateless) + opaque refresh tokens stored SHA-256-hashed in Postgres with rotation on refresh. Registration creates the user + their personal workspace (OWNER member) in one transaction.
- New feature modules get mounted with one `app.use('/api/v1/<feature>', router)` line in `src/app.ts`.

Notes: TypeScript 7 — use `moduleResolution: "nodenext"` (node10 is removed). Prisma 7 — config lives in `prisma.config.ts` (loads dotenv itself); datasource URL comes from there, not the schema.

**The user is new to Postgres and Prisma — explain database/Prisma code as you write it.**

## Context Folder — read this first

Persistent project memory lives in [context/](context/). **At the start of every session, read these three files:**

- [context/summary.md](context/summary.md) — product scope (MVP screens, backend domain), the agreed tech stack, and key architectural trade-offs.
- [context/feature.md](context/feature.md) — the feature currently in focus, its next steps, and the MVP backlog.
- [context/session.md](context/session.md) — log of what past sessions did and decided.

**Before ending a session or clearing context, update them:** append a new entry to `session.md` (done / decisions / next), and update `feature.md` if the active feature or its status changed. Update `summary.md` only when scope or stack decisions change.

## Planned Stack (see context/summary.md for details and trade-offs)

- Backend (this repo): **PEN stack — PostgreSQL + Express + Node with TypeScript** (confirmed 2026-07-16; NestJS rejected — the maintainer knows Express, not Nest). **All domain logic lives here**; the frontend's Nitro layer is rendering + thin BFF only. Structure: feature modules, a service layer (routes stay thin), and zod for request validation.
- Database: **PostgreSQL + Prisma** (confirmed 2026-07-16) — JSONB columns for document-shaped content like blueprint sections and discovery payloads.
- Redis + BullMQ for async jobs; DigitalOcean Spaces for exports; provider-agnostic AI layer (LiteLLM-style) with SSE streaming; JWT + refresh auth. Deploys to DigitalOcean.
- Frontend (separate repo, not here): Nuxt 4 + Vue 3, Tiptap editor — consumes this API via the OpenAPI contract.

## Working Rules

- **Schema first**: lock the data model before UI work.
- Guard MVP scope — the six-module vision is large; V1 backend covers only what the five core screens need (see `summary.md`).
- API changes must be reflected in the OpenAPI contract — it's what the frontend dev builds against.
- Once scaffolding lands, add the actual build/dev/test commands to this file.
