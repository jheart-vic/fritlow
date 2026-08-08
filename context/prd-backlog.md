# PRD ↔ Codebase Gap Analysis

> **Purpose:** capture everything the PRD (`Agmund_PRD_v1.0`, 7 Jul 2026 — "Agmund" = Fritlow's old
> name) specifies that the **backend codebase does not yet reflect**, so it survives context clears.
> Created 2026-08-07. This is a *record of intent + gaps*, not a commitment to build all of it — much is
> explicitly post-MVP. Re-check status against the code before acting on any line here.
>
> Legend: ✅ built · 🟡 partial · ❌ not built (but in scope / intended) · 🔮 deferred post-MVP (PRD §11.2 / §6).

---

## 1. MVP v1.0 in-scope items (PRD §11.1) — status

| PRD MVP item | Status | Notes / gap |
|---|---|---|
| User Authentication | ✅ | JWT + refresh rotation, email verification gate, RBAC via workspace roles. |
| Dashboard | ✅ | `/dashboard` next-action endpoint. |
| Project Management | ✅ | CRUD + status lifecycle. |
| Adaptive Discovery Interview | 🟡 | Engine + AI follow-up (Challenge Mode) built. **Missing depth:** confidence meter, several PRD modules (see §4). |
| Knowledge Engine (core) | ❌ | **Ambiguous & unbuilt.** PRD lists "core implementation" as MVP scope but the Discovery Intelligence Graph (`knowledge_nodes`, `relationships`) is called post-MVP in §14.4. **Decision needed: what does "core" mean for V1? Likely defer.** |
| Living Blueprint | 🟡 | 8 JSONB sections + living edits built. **Missing:** Dynamic Impact Analysis (signature — see §3), richer section set (§4). |
| Product Health (Agmund Score™) | ✅ | AI-graded, 5 dimensions. PRD also names Technical Complexity + Market Readiness dimensions (we ship 5, PRD lists 6 candidates). |
| **AI Product Strategist (baseline)** | ❌ | **In MVP scope, not built.** Maps to the `recommendations` entity — stored, durable insights ("reduce MVP features", "pricing needs work"), NOT chat. Dashboard `nextAction` is a thin stand-in only. See §2, §3. |
| PDF / DOCX Export | ✅ | Also Markdown. On-the-fly; object storage at deploy. |
| **Version History** | ❌ | **In MVP scope, not built.** No project/blueprint version history table; sections only carry `updatedAt`. |

---

## 2. Domain entities (PRD §14.4) — build status

Core tables PRD lists for MVP v1.0, vs. Prisma schema:

| Entity | Status | Notes |
|---|---|---|
| users, workspaces, members | ✅ | `User`, `Workspace`, `WorkspaceMember`. |
| projects | ✅ | `Project`. **But** `category` is a free String — PRD implies a category set (SaaS, Marketplace, Mobile App, FinTech, EdTech, HealthTech, Social Network) that also drives Templates. No `ARCHIVED` status (analytics expects a "Project Archived" event — §5/§6). |
| discovery_sessions, discovery_answers | ✅ | `DiscoverySession`, `DiscoveryAnswer`. |
| blueprints, blueprint_sections | ✅ | `Blueprint`, `BlueprintSection`. |
| **recommendations** | ❌ | Not modelled. The AI Product Strategist / Founder Copilot output. First-class, durable, has accept/reject (analytics tracks "Recommendation Accepted/Rejected"). |
| decision_logs | ✅ | `DecisionLog`. |
| **templates** | ❌ | Not modelled. "Starting points by product category." Marketplace is 🔮, but the entity itself is a core MVP table. |
| exports | ✅ | `Export`. |
| **notifications** | ❌ | Not modelled. Currently ACTIVE "challenge before building" — may be cut (dashboard nextAction may cover V1). |
| **subscriptions** | ❌ | Not modelled. Billing; post-deploy. |
| **audit_logs** | ❌ | Not modelled. Only `AiInteraction` logs AI calls. PRD §13.2 wants "audit logging for sensitive actions" (auth, role changes, deletes). |
| _(post-MVP)_ knowledge_nodes, relationships | 🔮 | Discovery Intelligence Graph / Dynamic Impact Analysis backing store. |

Extra tables we have that PRD didn't enumerate: `HealthScore`, `AiInteraction`, `RefreshToken`, `EmailVerificationToken`, `PasswordResetToken` (all justified).

---

## 3. Signature differentiating features (PRD §7) — status

- ✅ **Adaptive Discovery Interview** — structured + AI follow-ups.
- ✅ **AI Challenge Mode** — follow-up endpoint pushes back.
- ✅ **Agmund Score™ (Product Health Score)**.
- ✅ **Decision Log**.
- ❌ **The Living Blueprint's Dynamic Impact Analysis** — editing one section should surface what else is affected. Edits currently just save. *This is the feature that makes the blueprint "living" rather than a generated doc.*
- ❌ **AI Confidence Meter** in the discovery interview.
- ❌ **Founder Copilot / AI Product Strategist** — proactive advisor that flags issues unprompted ("your pricing doesn't fit your audience"). Backed by the missing `recommendations` entity.

---

## 4. Depth gaps inside built features

**Blueprint sections** — we ship 8 (`executive_summary, problem_statement, solution, target_audience, business_model, differentiation, mvp_scope, success_metrics`). PRD Module 2 is richer and lists additionally: Vision & Mission, Product goals, **User stories**, **Functional requirements**, **Non-functional requirements**, Acceptance criteria, **Version roadmap**, **Feature prioritization (MoSCoW/RICE)**, Personas. Decide which belong in V1 vs later.

**Discovery modules** — we have `problem, customer, business_model, differentiation, mvp_focus` (10 anchor questions). PRD Module 1 / §7 also expect: **Vision** module, Market analysis, Competitor overview, Customer segmentation, **User personas**, Value proposition canvas, SWOT, **Risk analysis**, Geography. The current bank is a deliberate subset — fine for MVP, but the fuller list is the target.

**Project category & status** — category should likely be an enum tied to Templates; add `ARCHIVED` status if the archive flow is wanted.

---

## 5. Non-functional & cross-cutting gaps (PRD §13, §15, performance table)

**Security checklist (§13.2):**
- ✅ JWT + refresh · ✅ Rate limiting · ✅ Input validation (zod) · ✅ SQLi protection (Prisma) · ✅ RBAC · ✅ secure session handling · ✅ CSP/security headers (helmet defaults — verify the CSP is what we want).
- ❌ **CSRF protection** — refresh token is an httpOnly SameSite cookie (mitigates a lot), but no explicit CSRF token/defense is documented. Review before public launch.
- ❌ **Audit logging for sensitive actions** (see `audit_logs`, §2).
- 🟡 **Encrypted secrets / sensitive data at rest** — tokens are SHA-256 hashed; confirm nothing else sensitive is stored plaintext.

**Definition of Done (§13.3) — biggest process gap:**
- ❌ **No automated tests exist** (no unit, no integration; no test runner in `package.json`). PRD says "nothing merges without" tests + a11y/perf/security review. All verification so far has been manual E2E. **This is the largest deviation from the PRD's quality bar.**

**Product analytics (§15) — none instrumented:** events expected — Project Created, Discovery Started, Discovery Completed, Blueprint Generated, Recommendation Accepted, Recommendation Rejected, Export Generated, Project Archived. (`AiInteraction` logs AI calls but is not product analytics.)

**Performance budget (§13.1):** API P95 < 300ms; **Blueprint generation < 10s with progress feedback** (SSE satisfies the "progress feedback" half). No measurement/monitoring in place.

---

## 6. Deferred / post-MVP (PRD §6 modules 3–6, §11.2, Future Features) — consolidated so it's not re-discovered

- **Module 3 Product Design**, **Module 4 Technical Planning**, **Module 5 Build**, **Module 6 Launch & Growth** — entire modules, all post-MVP.
- **§11.2 deferred:** real-time team collaboration, Templates Marketplace, Founder Simulator™, weekly/monthly AI reports, AI memory across projects, webhooks, public API.
- **Integrations (Future):** GitHub, Figma, Jira, Linear, Notion, Slack; voice brainstorming; whiteboard; AI meeting assistant.
- **Knowledge Engine expansion:** `knowledge_nodes` + `relationships` tables → Discovery Intelligence Graph + Dynamic Impact Analysis.
- **Export later:** JSON export + shareable links.
- **Infra at scale:** Redis + BullMQ (deferred to deploy — SSE covers V1), object storage (DO Spaces) for exports, Cloudflare, AWS/GCP at scale.

---

## 7. Success metrics the product must eventually measure (PRD §5)

Projects created · Blueprint completion rate · Avg time to complete a blueprint · 30-day return rate · Number of exports · Post-generation satisfaction · % who create a second project. → These are the *why* behind the §5 analytics events; MVP success is the guided process proving valuable, **not revenue**.

---

## Suggested priority read (my recommendation, not yet agreed)

If asked "what from the PRD should V1 actually add next?", the strongest candidates are the ones that are **both MVP-scoped and unbuilt**:
1. **AI Recommendations / Product Strategist baseline** (`recommendations` entity) — signature, MVP scope, and everything for it already exists in the AI layer.
2. **Version History** — MVP scope; cheap insurance for the "Living" blueprint.
3. **A test harness** — closes the single biggest Definition-of-Done gap; unblocks confident iteration.

Everything else (Dynamic Impact Analysis, richer sections/modules, templates, audit logs, analytics) is real but can be sequenced after those or after deploy.
