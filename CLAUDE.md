# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

This repo is the workspace for building **Agmund V1 (MVP)** — an AI-powered Product Operating System that guides founders from a one-line idea to a build-ready "Living Blueprint." Differentiator is process (guided discovery interview, AI Challenge Mode, Product Health Score, one source of truth per project), not "better AI."

**This repo is the backend only** — an Express + TypeScript REST API (PEN stack). The Nuxt/Vue frontend lives in a separate repo owned by another developer; the OpenAPI contract is the handoff point, so keep it accurate and current.

**No source code exists yet** — the project is in the pre-scaffold phase.

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
