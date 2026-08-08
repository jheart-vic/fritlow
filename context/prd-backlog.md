# PRD ↔ Codebase Gap Analysis

> **Purpose:** capture everything the PRD (`Agmund_PRD_v1.0`, 7 Jul 2026 — "Agmund" = Fritlow's old
> name) specifies that the **backend codebase does not yet reflect**, so it survives context clears.
> Created 2026-08-07. This is a *record of intent + gaps*, not a commitment to build all of it — much is
> explicitly post-MVP. Re-check status against the code before acting on any line here.
>
> Legend: ✅ built · 🟡 partial · ❌ not built (but in scope / intended) · 🔮 deferred post-MVP (PRD §11.2 / §6).
>
> **Cross-checked 2026-08-08 against the frontend dev's "FRITLOW Backend Gap Analysis & Build Spec"** — it independently reached the same gap list; deltas it added are merged below and summarized in §8.

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
| Product Health (Agmund Score™) | ✅ | **FIXED 2026-08-08 → 7 dimensions:** the PRD §7 six (`problem_clarity, target_audience, business_model, mvp_focus, technical_complexity, market_readiness`) PLUS our intentional `differentiation`. `overall` = average of the 7. |
| **AI Product Strategist (baseline)** | ✅ | **BUILT 2026-08-08** as `Recommendation` (`src/modules/recommendations/`). ⚠️ Shape diverges from the build spec — see §8 for the reconciliation decision. |
| PDF / DOCX Export | ✅ | Also Markdown. On-the-fly; object storage at deploy. |
| **Version History** | ❌ | **In MVP scope, not built. ← NEXT.** No version table; sections only carry `updatedAt`. Spec'd model: `BlueprintSectionVersion` (`blueprintSectionId, sectionKey, projectId, content, editedById, versionNumber, createdAt`); `PATCH /blueprint/sections/{key}` snapshots pre-edit content first; add `GET …/versions` + `POST …/versions/{id}/restore` (restore = new version, never destructive). Roadmap contradiction to flag: §11.1 puts this in MVP but §16 schedules "Versioning" for Sprint 5. |

---

## 2. Domain entities (PRD §14.4) — build status

Core tables PRD lists for MVP v1.0, vs. Prisma schema:

| Entity | Status | Notes |
|---|---|---|
| users, workspaces, members | 🟡 | Tables exist (`User`, `Workspace`, `WorkspaceMember`), but **workspace management is missing** (spec item 7): only `PATCH /settings/workspaces/{id}` (rename). No create additional workspaces, list-my-workspaces, or membership (invite / change-role / remove). P1 now, **P0 once Team Collaboration ships**. |
| projects | ✅ | `Project`. **But** `category` is a free String — PRD implies a category set (SaaS, Marketplace, Mobile App, FinTech, EdTech, HealthTech, Social Network) that also drives Templates. No `ARCHIVED` status (analytics expects a "Project Archived" event — §5/§6). |
| discovery_sessions, discovery_answers | ✅ | `DiscoverySession`, `DiscoveryAnswer`. |
| blueprints, blueprint_sections | ✅ | `Blueprint`, `BlueprintSection`. |
| **recommendations** | ✅ | Built as `Recommendation` (2026-08-08). Shape reconciliation pending — see §8. |
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
- ❌ **The Living Blueprint's Dynamic Impact Analysis** (P1) — editing one section should surface what else is affected. Edits currently just save. Spec approach: extend the `PATCH /blueprint/sections/{key}` response with `impactAnalysis: { affectedSections: [{ sectionKey, reason }], generatedAt }`; needs a cross-section AI call — make it async/SSE if it blows the 300ms P95 budget.
- ❌ **AI Confidence Meter** in the discovery interview (P1) — add `confidence` (0–100) + `confidenceLabel` (LOW/MEDIUM/HIGH) to the answer object, computed on submit, surfaced in `POST /discovery/answers` and `GET /discovery`.
- ✅ **Founder Copilot / AI Product Strategist** — BUILT 2026-08-08 (on-demand generation). Spec also wants **proactive trigger wiring** (auto-generate/refresh after `discovery/complete`, after blueprint generation, and after health-score compute when a dimension drops below a threshold) — not yet built; see §8.

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

## 8. Cross-check vs the frontend dev's build spec (2026-08-08)

The spec independently confirmed our whole gap list (same v1.0 P0/P1s, same v1.1/v2 deferrals). Three things it changed or added:

**A. Gap we under-flagged → now tracked:** Workspace management (create/list/invite/change-role/remove). See §2. Endpoints: `POST /workspaces`, `GET /workspaces` (+ role per workspace), `GET|POST|PATCH|DELETE /workspaces/{id}/members[...]`.

**B. Elevated to P0:** Health-score dimension mismatch (was a parenthetical note) — now an explicit spec fix. See §1.

**C. ✅ RESOLVED 2026-08-08 — Recommendation reshaped to the spec.** User chose "use the specs for a." The module now matches the build spec exactly (migration `reshape_recommendations`, E2E-verified against GPT-5):

| Aspect | Now (spec-aligned) |
|---|---|
| Generate route | `POST /projects/{id}/recommendations/generate` |
| Category | `type` enum: PRICING, SCOPE, AUDIENCE, ONBOARDING, GENERAL |
| Body | `body` (markdown) |
| `severity` | INFO / WARNING / CRITICAL |
| `status` | OPEN / ACKNOWLEDGED / DISMISSED / RESOLVED (PATCH sets the last three) |
| Provenance | `sourceContext` (e.g. `blueprint.business_model`), nullable |
| List order | newest first |

**Still NOT built (deferred):** the spec's **proactive triggers** — auto-generate/refresh after discovery-complete, after blueprint generation, and after health-score compute when a dimension is low. Generation is on-demand only for now. Wire these later (fire-and-forget so they don't slow the parent action).

**Enrichments folded into the sections above:** concrete `BlueprintSectionVersion` model + restore semantics (§1 Version History); `impactAnalysis` response shape (§3); `confidence`/`confidenceLabel` on answers (§3); Template endpoints scoped to 7 fixed categories (§2/§6); Comments (`parentId` threading) + AI Chat (`ChatConversation`/`ChatMessage`, SSE) data models for the P2 tier.

---

## 9. Reconciled build order (spec's order + what's already done)

1. ✅ ~~AI Recommendations~~ — DONE 2026-08-08, reshaped to the spec (§8C).
2. ✅ ~~Health-score dimension fix~~ — DONE 2026-08-08 (now 7 dims).
3. **Version History** ← NEXT — also unblocks Impact Analysis (shared section-edit history).
4. **Blueprint Impact Analysis** + **Discovery Confidence Meter** — polish on existing features.
5. **Template entity** (7 fixed categories) — precedes Templates Marketplace (v1.1).
6. **Workspace CRUD + membership** — precedes Team Collaboration (v1.1).
7. **P2:** Notifications, Search, Comments, AI Chat — interleave with frontend needs.
8. **Test harness** — not on the spec's list but our biggest Definition-of-Done gap (§5); slot in early to protect everything above.
9. v1.1 (§6), then v2+ (§6) once usage justifies.
