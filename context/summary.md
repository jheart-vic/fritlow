# Agmund — Project Summary

> Source documents: `~/Downloads/Agmund_PRD_v1.0.docx` (PRD v1.0, 7 July 2026) and
> `~/Downloads/Agmund_V1_Honest_Summary.pdf` (independent technical assessment, 14 July 2026).
> This repo (`fritlow`) holds the **Agmund V1 backend only** (Express + TypeScript API). The Nuxt/Vue frontend
> is built in a separate repo by another developer; the OpenAPI contract is the handoff point.

## What Agmund Is

Agmund is an **AI-powered Product Operating System** (agmund.com) that takes a founder from a
one-line idea to a build-ready **Living Blueprint**. Its differentiator is deliberately **process,
not "better AI"**: a guided discovery interview, AI Challenge Mode (pushes back on weak
assumptions), a Product Health Score (Agmund Score™), and one source of truth per project.

- Tagline: *"From idea to launch. One workspace. One source of truth."*
- Owner: Lhuj (Agbassi Edmund Obinna)
- Full vision: six modules — Discovery → Blueprint → Design → Technical Planning → Build → Launch & Growth.
- **V1 is intentionally narrowed** to prove founders find value in the guided process. Scope discipline is the #1 risk and the #1 asset.

## MVP V1 Scope

### Frontend (five load-bearing screens + thin public surface)
1. **Dashboard** — "continue where you left off" control center; surfaces the one recommended next action.
2. **Projects** — list with status: Draft → Discovery → Blueprint Complete → Launched.
3. **Create-Project Wizard** — 4 steps: name → one-line idea → category → generate discovery session.
4. **Adaptive Discovery Interview** — the signature feature: module-based interview, adaptive follow-ups, confidence meter, Challenge-Mode prompts.
5. **Living Blueprint editor** — editable rich document with health ribbon, decision log, dynamic impact analysis.

Supporting: Auth (login/register/reset), Export center (PDF/DOCX/Markdown), Settings, public Landing/Pricing/About.
Design system: calm, 12-column grid, 8-point spacing, motion only for state changes. Organized by feature, not component type.
Design north star: every screen answers "What should I do next?" within ~3 seconds.

### Backend (modular API; AI is one service among several)
- **Auth & tenancy** — JWT + refresh, RBAC, Workspace → Project hierarchy (nothing exists outside a project).
- **Core domain** — Users, Workspaces, Members, Projects, Discovery Sessions/Answers, Blueprints/Sections, Recommendations, Decision Logs, Templates, Exports, Notifications, Subscriptions, Audit Logs.
- **AI orchestration** — provider-agnostic layer (OpenAI / Claude / Gemini), every interaction logged end to end.
- **Async work** — Redis + BullMQ for heavy jobs (blueprint generation, exports); <10s generation budget with progress feedback.
- **Exports** — PDF/DOCX/Markdown persisted to object storage.
- **API** — REST for V1; GraphQL only if needed later.

## Recommended Stack (from the independent assessment)

| Layer | Choice |
|---|---|
| Frontend | Nuxt 4 + Vue 3 + TypeScript, Tailwind, Pinia (global state only), TanStack Query (server state), **Tiptap** for the blueprint editor |
| Backend | **PEN: PostgreSQL + Express + Node (TypeScript)** — chosen over NestJS 2026-07-16 because the maintainer knows Express. Discipline via feature modules + service layer + zod validation. |
| Database | **PostgreSQL + Prisma** with JSONB for document-shaped content — **confirmed 2026-07-16** |
| AI layer | Thin provider abstraction via **LiteLLM** or Vercel AI SDK provider layer; SSE for streaming |
| Cache/Queues | Redis + BullMQ |
| Storage | DigitalOcean Spaces (S3-compatible) for exports |
| Auth | Self-hosted JWT + refresh (managed layer like Better Auth/Clerk worth a cost/benefit check) |
| Deployment | Vercel (Nuxt frontend) + DigitalOcean (this Express API) |

### Key trade-offs to remember
- **Postgres over Mongo**: the data is mostly relational (workspaces, members, RBAC, billing, audit logs). If Mongo is chosen instead: enforce referential integrity in services (centralized, not scattered), wrap money/audit paths in explicit multi-document transactions, and know `$graphLookup` is Mongo's weak spot for the Discovery Intelligence Graph.
- **Nuxt + Express = two server runtimes**: Nuxt/Nitro (frontend repo) is rendering + thin BFF/proxy only; **all domain logic lives in this Express API**. The boundary is decided — don't let it erode.
- **Express over NestJS** (2026-07-16): maintainer knows Express, not Nest. Express has no built-in structure, so the repo must impose its own: feature-module folders, thin routes → service layer, zod validation at the edges, and OpenAPI kept current by hand/tooling (no Nest auto-Swagger).
- **Tiptap** is the strongest single choice — ProseMirror-based, Yjs support means no editor swap when real-time collaboration lands.

## Agreed Next Steps (from assessment §7)
1. **Lock the data model first** — write the schema (Prisma models) before UI work; decide reference-vs-embed and transaction paths up front.
2. **Draft the OpenAPI contract** for core endpoints so frontend and backend move in parallel.
3. **Stand up the AI abstraction early** behind a single interface so provider swaps are config, not refactors.
4. Optional name check: "Agmund" is fine (founder-brand equity); *Groundwork*/*Keystone* were suggested alternates.
