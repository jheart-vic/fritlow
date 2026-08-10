# Fritlow API — Frontend Guide

Everything the frontend needs to consume the V1 backend, plus a full Postman walkthrough at the end.

- Base URL (dev): `http://localhost:4000`
- Interactive spec (source of truth): `http://localhost:4000/docs` — raw OpenAPI JSON at `/docs.json`
- All request bodies: `Content-Type: application/json` (except where noted)
- Detailed email-verification guide: [auth-email-verification.md](auth-email-verification.md)

---

## 1. Auth — how sessions work

Two tokens, handled differently:

| Token | Where it lives | Lifetime | Frontend's job |
|---|---|---|---|
| **Access token** (JWT) | Response body → keep **in memory** (Pinia). NOT localStorage. | ~15 min | Send as `Authorization: Bearer <token>` on every `/api/v1/*` call except the public auth endpoints |
| **Refresh token** | httpOnly cookie `fritlow_rt`, set by the server. JS can never read it. | 30 days, rotated on every refresh | Nothing — just make auth calls **with credentials** (`credentials: 'include'` / axios `withCredentials: true`) so the browser sends the cookie |

When any API call returns **401**, call `POST /auth/refresh` (empty body, credentials included) to get a fresh access token, then retry. If refresh itself 401s, the session is dead — go to login.

CORS note: the dev frontend origin must be in the server's `CORS_ORIGIN` env allowlist, or credentialed requests will fail.

### Endpoints (all under `/api/v1/auth`)

| Method + path | Body | Success | Notes |
|---|---|---|---|
| `POST /register` | `{ fullName, email, password (min 8) }` | **201** `{ user, message }` — **no tokens, no cookie** | 409 if email taken. Creates the user + personal workspace and emails a verification link. The user must verify, then log in |
| `POST /login` | `{ email, password }` | **200** `{ user, accessToken }` + cookie | 401 on bad credentials (same error for wrong email vs wrong password). **403 if the email is not verified yet** — show a "verify first" screen with a resend button |
| `POST /refresh` | `{}` (cookie) or `{ refreshToken }` fallback | **200** `{ accessToken }` + new cookie | Old refresh token is revoked — a replayed one 401s |
| `POST /logout` | `{}` (cookie) | **204**, cookie cleared | |
| `GET /me` | — (Bearer required) | **200** `{ user }` | Call on app boot to restore the session |
| `POST /verify-email` | `{ token }` | **200** `{ message, user }` | 400 if invalid/expired/used. No Bearer needed |
| `POST /resend-verification` | `{ email }` | **200** always | Never reveals whether the email exists. Invalidates older tokens |
| `POST /forgot-password` | `{ email }` | **200** always | Dev-only: `resetToken` in response |
| `POST /reset-password` | `{ token, newPassword }` | **200** | 400 bad token. Revokes ALL sessions — user must log in again |

The `user` object everywhere:

```json
{ "id": "uuid", "email": "…", "fullName": "…", "emailVerified": false, "createdAt": "…" }
```

**Verification gates login**: register → "check your email" screen → user clicks the emailed link (frontend route `/verify-email?token=…` POSTs it to the API) → login. A 403 from login means unverified — offer the resend button. Tokens travel by email only; in dev the server console also logs them for testing.

---

## 2. Projects — `/api/v1/projects` (Bearer required from here on)

Project statuses: `DRAFT → DISCOVERY → BLUEPRINT_COMPLETE → LAUNCHED`. The backend moves the first three automatically (starting discovery sets DISCOVERY, generating a blueprint sets BLUEPRINT_COMPLETE); `LAUNCHED` is set by the frontend via PATCH when the founder declares launch.

| Method + path | Body / query | Success | Notes |
|---|---|---|---|
| `POST /` | `{ name, oneLineIdea, category?, workspaceId? }` | **201** `{ project }` | Omit `workspaceId` → personal workspace. This is the create-project wizard's final submit |
| `GET /` | `?status=DISCOVERY` optional | **200** `{ projects: [...] }` | Only projects in workspaces the user belongs to |
| `GET /:id` | — | **200** `{ project }` | 403 if not a member of its workspace, 404 if gone |
| `PATCH /:id` | any of `{ name, oneLineIdea, category, status }` | **200** `{ project }` | Partial — send only what changed |
| `DELETE /:id` | — | **204** | OWNER/ADMIN of the workspace only → else 403 |

Every project object embeds its creator, so the UI can show "created by …" without a second request:

```json
{
  "id": "…", "name": "Beat Circle", "oneLineIdea": "…", "category": "SaaS",
  "status": "DRAFT", "workspaceId": "…", "createdById": "…",
  "createdBy": { "id": "…", "fullName": "Test Founder", "email": "test@agmund.dev" },
  "createdAt": "…", "updatedAt": "…"
}
```

---

## 3. Discovery Interview — `/api/v1/projects/:projectId/discovery`

The signature feature. V1 has a fixed bank of **10 questions across 5 modules** (`problem`, `customer`, `business_model`, `differentiation`, `mvp_focus`), 2 questions each. Question IDs are stable strings like `problem.core`, `customer.who`, `mvp_focus.success`.

| Method + path | Body | Success | Notes |
|---|---|---|---|
| `POST /` | — | **201** session + progress | Starts the interview, flips project to DISCOVERY. 409 if already started |
| `GET /` | — | **200** (below) | The resume screen: session + all answers + progress + next question |
| `POST /answers` | `{ questionId, answer, followUpAnswer? }` | **200** `{ answered, total, nextQuestion, confidence, confidenceLabel }` | Upsert — re-answering the same question replaces it. `confidence` (0–100) + `confidenceLabel` (LOW/MEDIUM/HIGH) are the **AI confidence meter** for the answer just submitted, or `null` if the server has no AI key. 400 if session closed |
| `POST /answers/:questionId/follow-up` | — | **200** `{ questionId, followUp }` | **AI Challenge Mode**: generates one probing follow-up question about this answer. 400 if question unanswered; 503 if server has no AI key. Reply by re-POSTing `/answers` with `followUpAnswer` |
| `POST /complete` | — | **200** | Only when all 10 answered — else 400 with a clear message |

`GET /` response shape:

```json
{
  "session": {
    "id": "…", "status": "ACTIVE", "startedAt": "…", "completedAt": null,
    "answers": [ { "questionId": "problem.core", "questionText": "…", "module": "problem",
                   "answer": { "text": "…", "confidence": 72, "confidenceLabel": "MEDIUM",
                               "followUp": { "question": "…", "answer": "…" } },
                   "answeredAt": "…" } ]
  },
  "answered": 3,
  "total": 10,
  "nextQuestion": { "id": "problem.evidence", "module": "problem", "text": "…", "hint": "…" }
}
```

UI flow: render `nextQuestion` (with its `hint`), POST the answer, optionally hit the follow-up endpoint to let the AI push back, re-fetch or advance locally, and show `answered/total` as the progress meter. `nextQuestion` is `null` when everything's answered — then show the "Complete interview" CTA.

### Follow-up (Challenge Mode) round-trip — order matters

`followUpAnswer` goes to the **same** `POST /answers` endpoint, **alongside** `answer` (which stays required — resend it; it does not replace `answer`). There is **no separate reply endpoint**. Crucially, the reply is only stored if a follow-up was **already generated** for that question — otherwise `followUpAnswer` is silently ignored. So the sequence is:

```
# 1. Answer the anchor question
POST /api/v1/projects/{id}/discovery/answers
  { "questionId": "problem.core", "answer": "Teams lose track of action items from meetings." }
→ 200 { "answered": 1, "total": 10, "nextQuestion": { "id": "problem.evidence", … } }

# 2. Generate the AI follow-up (Challenge Mode)
POST /api/v1/projects/{id}/discovery/answers/problem.core/follow-up
→ 200 { "questionId": "problem.core", "followUp": "Which specific team feels this most acutely, and how do you know?" }

# 3. Reply to the follow-up — SAME /answers endpoint, resend `answer` + add `followUpAnswer`
POST /api/v1/projects/{id}/discovery/answers
  { "questionId": "problem.core", "answer": "Teams lose track of action items from meetings.",
    "followUpAnswer": "B2B customer-success teams running QBRs — I interviewed 15 and 12 confirmed it." }
→ 200 { "answered": 1, "total": 10, "nextQuestion": { … } }

# 4. Read the stored follow-up back (question + reply) — it lives on the answer's JSONB
GET /api/v1/projects/{id}/discovery
→ session.answers[i].answer = {
      "text": "Teams lose track of action items from meetings.",
      "followUp": { "question": "Which specific team…", "answer": "B2B customer-success teams…" }
    }
```

Note the two shapes for the same data: step 2 returns the follow-up as a flat `{ questionId, followUp }` string; on read-back (step 4) it's nested at `answer.followUp.question` with the reply at `answer.followUp.answer` (`null` until step 3). Re-running step 2 replaces the follow-up and resets its stored reply to `null`.

---

## 4. Blueprint — `/api/v1/projects/:projectId/blueprint`

Eight canonical sections, generated by AI from the full discovery transcript, then hand-edited forever ("Living Blueprint"). Section keys are stable: `executive_summary`, `problem_statement`, `solution`, `target_audience`, `business_model`, `differentiation`, `mvp_scope`, `success_metrics`.

| Method + path | Body | Success | Notes |
|---|---|---|---|
| `POST /` | — | **201** blueprint + 8 sections | Synchronous generation (can take several seconds). 400 if discovery incomplete, 409 if blueprint exists, 503 no AI key. Flips project to BLUEPRINT_COMPLETE |
| `POST /stream` | — | **SSE stream** | Same generation, but with live progress — preferred for UX (below) |
| `GET /` | — | **200** `{ blueprint }` with `sections[]` | 404 until generated |
| `PATCH /sections/:sectionKey` | `{ markdown }` (≤50k chars) | **200** `{ section }` | The editor's save path. 404 for unknown key |

Each section: `{ id, key, title, order, content: { markdown }, updatedAt }`. Render/edit `content.markdown` (Tiptap ↔ markdown), save via PATCH per section.

### Version history (per section)

Every `PATCH` snapshots the section's previous content before overwriting, so edits are recoverable.

| Method + path | Success | Notes |
|---|---|---|
| `GET /sections/:sectionKey/versions` | **200** `{ versions }` | Newest first. Empty until the section has been edited at least once. |
| `POST /sections/:sectionKey/versions/:versionId/restore` | **200** `{ section }` | Rolls the section back to that version. **Non-destructive** — current content is snapshotted as a new version first, so forward history survives. 404 if the version isn't for this section. |

Each version: `{ id, versionNumber, sectionKey, content: { markdown }, editedBy: { id, fullName }, createdAt }`. `versionNumber` increments per section (1,2,3…); `editedBy` is the user whose edit replaced this content.

### Dynamic Impact Analysis (per section)

After saving a section, ask which *other* sections the edit may have made inconsistent. This is a **separate on-demand call** (not part of the PATCH response) so saves stay fast — call it when you want the analysis.

- **`POST /sections/:sectionKey/impact-analysis`** → **200** `{ impactAnalysis: { affectedSections: [{ sectionKey, reason }], generatedAt } }`
  - `affectedSections` is other sections that may now conflict, each with a one-line reason; an **empty array** means nothing else looks affected.
  - 404 unknown section · 502 AI unparseable · 503 no AI key. Not persisted — it reflects the section's content at call time.

### SSE streaming (`POST /stream`)

`Content-Type: text/event-stream` response. Use `fetch` with a stream reader (native `EventSource` can't POST or send a Bearer header — use `fetch` + `ReadableStream` or the `@microsoft/fetch-event-source` package). Events:

```
event: delta   data: {"text":"…chunk of generated markdown…"}   ← many of these; append to a live preview
event: done    data: {"blueprint":{ …full persisted blueprint with sections… }}
event: error   data: {"error":"…"}   ← generation failed mid-stream (HTTP status is already 200 by then)
```

---

## 5. Decision Log — `/api/v1/projects/:projectId/decisions`

First-class "why we chose X" records. Statuses: `ACTIVE`, `REVISED`, `REVERSED`.

| Method + path | Body | Success |
|---|---|---|
| `POST /` | `{ title, reasoning }` (both required) | **201** `{ decision }` |
| `GET /` | — | **200** `{ decisions: [...] }` |
| `PATCH /:id` | any of `{ title, reasoning, status }` | **200** `{ decision }` |
| `DELETE /:id` | — | **204** |

---

## 6. Health Score — `/api/v1/projects/:projectId/health-score`

AI grades the discovery answers across 7 dimensions (0–100 each + honest feedback); `overall` is the server-computed average.

| Method + path | Success | Notes |
|---|---|---|
| `POST /` | **200** `{ healthScore }` | Compute or refresh. 400 if fewer than 3 questions answered; 503 no AI key |
| `GET /` | **200** `{ healthScore }` | 404 until first computed |

```json
{
  "overall": 62,
  "dimensions": [ { "key": "problem_clarity", "label": "…", "score": 75, "feedback": "…" }, … ],
  "summary": "2-3 sentences naming the biggest risk",
  "updatedAt": "…"
}
```

Dimension keys (7): `problem_clarity`, `target_audience`, `business_model`, `differentiation`, `mvp_focus`, `technical_complexity`, `market_readiness`. This powers the blueprint screen's health ribbon.

---

## 7. Recommendations (AI Product Strategist) — `/api/v1/projects/:projectId/recommendations`

Durable, actionable insights the AI generates from the project's discovery answers (plus blueprint + health score when they exist). Each is a row the founder acknowledges / dismisses / resolves — not chat.

| Method + path | Success | Notes |
|---|---|---|
| `POST /generate` | **201** `{ recommendations }` | Generate a batch (3–6). 400 if fewer than 3 questions answered; 503 no AI key. Returns the full current list. |
| `GET /` | **200** `{ recommendations }` | Optional `?status=OPEN\|ACKNOWLEDGED\|DISMISSED\|RESOLVED`. Newest first. |
| `PATCH /:id` | **200** `{ recommendation }` | Body `{ "status": "ACKNOWLEDGED" \| "DISMISSED" \| "RESOLVED" }`. 404 if not in this project. |

```json
{
  "id": "…", "type": "PRICING",
  "title": "Pricing doesn't match target audience",
  "body": "markdown — why it matters + what to do",
  "severity": "WARNING", "status": "OPEN",
  "sourceContext": "blueprint.business_model", "updatedAt": "…"
}
```

`type` ∈ `PRICING|SCOPE|AUDIENCE|ONBOARDING|GENERAL`; `severity` ∈ `INFO|WARNING|CRITICAL`; `status` ∈ `OPEN|ACKNOWLEDGED|DISMISSED|RESOLVED`. `sourceContext` names what triggered it (a blueprint section key or health dimension), or `null`. **Regenerating (`POST /generate` again) replaces the OPEN batch but keeps anything you've already ACKNOWLEDGED/DISMISSED/RESOLVED** — those are the founder's decisions, kept as history.

---

## 8. Export — `GET /api/v1/projects/:projectId/export?format=pdf|docx|markdown`

Returns the file itself (`Content-Disposition: attachment`), not JSON. Frontend: fetch with the Bearer header, read the response as a blob, trigger a download. 404 if no blueprint exists yet, 400 on a bad format value.

---

## 9. Dashboard — `GET /api/v1/dashboard`

The "what should I do next?" screen in one call:

```json
{
  "projects": [
    {
      "id": "…", "name": "…", "oneLineIdea": "…", "status": "DISCOVERY", "updatedAt": "…",
      "discoveryProgress": { "answered": 4, "total": 10 },
      "hasBlueprint": false,
      "nextAction": { "type": "CONTINUE_DISCOVERY", "label": "Continue the interview (4/10 answered)", "projectId": "…" }
    }
  ],
  "nextAction": { …the top action — belongs to the most recently touched project… }
}
```

`nextAction.type` is one of: `START_DISCOVERY`, `CONTINUE_DISCOVERY`, `COMPLETE_DISCOVERY`, `GENERATE_BLUEPRINT`, `REVIEW_BLUEPRINT`, `CELEBRATE`. Map each to a route + button; the `label` is ready-made display copy. Top-level `nextAction` is `null` when the user has no projects → show the create-project CTA.

---

## 10. Settings — `/api/v1/settings` (Bearer required)

Backs the Settings screen. All act on the authenticated user.

- **`PATCH /profile`** — update your own display name. Body `{ "fullName": "Ada Lovelace" }` → `{ user }`. (Email changes are out of scope for V1 — they'd need re-verification.)
- **`POST /password`** — change your password while logged in. Body `{ "currentPassword": "…", "newPassword": "…" }`. Verifies the current password (wrong → **401**), then **revokes every session** (all refresh tokens). After this call the refresh cookie is dead, so route the user back to login — the success message is "Password updated. Please log in again."
- **`PATCH /workspaces/:workspaceId`** — rename a workspace you belong to. Body `{ "name": "Acme Product Team" }` → `{ workspace }`. Only **OWNER/ADMIN** may rename (others get **403**). You can read a `workspaceId` off any project (`project.workspaceId`).
- **`DELETE /account`** — permanently delete your own account. Body `{ "password": "…" }` (re-auth required) → **204**. **Irreversible.** Deletes your personal workspace(s) and everything in them; content you authored in *shared* workspaces is kept but reassigned to a "Deleted User" placeholder so teammates' threads/history survive. Wrong password → **401**. If you're the **sole owner of a shared workspace that still has other members**, you get **400** — transfer ownership (`PATCH /workspaces/:id/members/:userId` → OWNER) or remove the members first, then retry. All sessions are revoked; send the user to a signed-out state. Recommend a confirm dialog (type-to-confirm) before calling.

---

## 11. Templates — `/api/v1/templates` (Bearer required)

Fixed starting points by product category, for the create-project wizard's category step. Read-only reference data (the user-submitted marketplace is a later version).

| Method + path | Success | Notes |
|---|---|---|
| `GET /` | **200** `{ templates }` | All 7 templates |
| `GET /:id` | **200** `{ template }` | 404 for an unknown id |

```json
{
  "id": "saas", "category": "SaaS", "name": "SaaS Starter",
  "description": "…",
  "prefillDiscoveryHints": { "customer.who": "Name the role and company size…", "…": "…" }
}
```

Ids: `saas`, `marketplace`, `mobile_app`, `fintech`, `edtech`, `healthtech`, `social_network`. `prefillDiscoveryHints` maps a discovery question id → a category-specific hint you can show alongside that question during the interview. (Project `category` is still free-text on create — use `template.category` values to populate the wizard's dropdown.)

---

## 12. Workspaces — `/api/v1/workspaces` (Bearer required)

Tenancy management. Everyone gets a personal workspace at registration; these endpoints add more and manage membership. Roles: `OWNER`, `ADMIN`, `MEMBER`.

| Method + path | Body | Success | Notes |
|---|---|---|---|
| `POST /` | `{ name }` | **201** `{ workspace }` | You become OWNER. `workspace` includes your `role`. |
| `GET /` | — | **200** `{ workspaces }` | Every workspace you belong to, each with your `role`. |
| `GET /:workspaceId/members` | — | **200** `{ members }` | Any member may view. 403 if not a member. |
| `POST /:workspaceId/members/invite` | `{ email, role? }` | **201** `{ member }` _or_ `{ pending: true, invitation }` | OWNER/ADMIN only. `role` ∈ `ADMIN\|MEMBER` (default MEMBER). **Existing account** → added immediately (`{ member }`) + heads-up email. **Unknown email** → a PENDING invitation is recorded (`{ pending: true, invitation }`) and a signup email sent; they auto-join when they register with that email. `409` only if the existing user is already a member. All emails are best-effort/fire-and-forget. |
| `PATCH /:workspaceId/members/:userId` | `{ role }` | **200** `{ member }` | OWNER/ADMIN only. |
| `DELETE /:workspaceId/members/:userId` | — | **204** | OWNER/ADMIN only. |

Member: `{ userId, role, createdAt, user: { id, fullName, email } }`.

RBAC guardrails (all return a clear 4xx): only an **OWNER** may grant the OWNER role or change/remove an existing owner; a workspace must always keep **at least one owner** (last-owner demote/remove → 400); MEMBERs can't manage anyone (403).

Note: renaming a workspace still lives at `PATCH /settings/workspaces/:workspaceId` (§10). Inviting people who don't yet have an account now works (see the invite row above): a PENDING invitation is stored and consumed automatically when that email registers. There is no explicit accept/revoke endpoint yet.

---

## 13. Search — `GET /api/v1/search` (Bearer required)

Case-insensitive substring search across your **projects**, **blueprint sections**, **decisions**, and **recommendations** — scoped to the workspaces you belong to (you never see other tenants' content).

| Method + path | Query | Success | Notes |
|---|---|---|---|
| `GET /` | `q` (required, ≥2 chars), `limit?` (1–50, default 10) | **200** `SearchResults` | `limit` caps results **per type**. `q` under 2 chars → 400. |

`SearchResults`:
```json
{
  "query": "flamingo",
  "counts": { "project": 1, "blueprint_section": 1, "decision": 1, "recommendation": 1, "total": 4 },
  "results": [
    { "type": "project", "id": "...", "title": "Zephyr Analytics", "snippet": "…flamingo migration…", "projectId": "...", "projectName": "Zephyr Analytics" },
    { "type": "blueprint_section", "id": "...", "title": "Target Audience", "snippet": "…flamingo colonies…", "projectId": "...", "projectName": "Zephyr Analytics", "sectionKey": "target_audience" }
  ]
}
```

Every result carries `type`, `title`, a `snippet` (a text window around the match), and `projectId` + `projectName` so you can group by project and deep-link. `blueprint_section` results also include `sectionKey`. The list is flat (projects, then sections, then decisions, then recommendations) — group it client-side however the UI needs.

---

## 14. Comments — on blueprint sections

Discussion threads anchored to a **blueprint section**. Any project member can read and post; a comment is deletable by its author or by a workspace OWNER/ADMIN. Threaded via optional `parentId`.

| Method + path | Body | Success | Notes |
|---|---|---|---|
| `POST /api/v1/projects/:projectId/blueprint/sections/:sectionKey/comments` | `{ body, parentId? }` | **201** `{ comment }` | `parentId` = reply within a thread (must be a comment on the **same** section, else 404). Unknown section → 404. |
| `GET /api/v1/projects/:projectId/blueprint/sections/:sectionKey/comments` | — | **200** `{ comments }` | Threaded: top-level comments (oldest first), each with nested `replies`. |
| `DELETE /api/v1/comments/:id` | — | **204** | ⚠️ **Flat path — not nested under the project.** Author, or workspace OWNER/ADMIN. Deleting a parent **cascades** its replies. 403 otherwise, 404 if gone. |

`Comment`: `{ id, body, projectId, sectionKey, parentId (null for top-level), author: { id, fullName }, createdAt, updatedAt, replies: Comment[] }`. `replies` is populated on the GET (tree) response and empty (`[]`) on a freshly created comment.

Note the DELETE endpoint deliberately lives at the top-level `/api/v1/comments/:id` (per the backend spec), unlike create/list which are section-scoped.

---

## 15. Errors — one shape everywhere

```json
{ "error": "Human-readable message" }
```

Validation failures (400 from zod) add a `details` array of per-field messages. Status codes to handle globally:

- **401** → try refresh, then login screen
- **403** → from login: email not verified; elsewhere: "you don't have access to this project"
- **404** → resource gone / not created yet (often an expected state, e.g. no blueprint yet)
- **409** → already exists (duplicate email, session/blueprint already created)
- **429** → rate limited (see below) — show the message and disable retry until `Retry-After` elapses
- **503** → AI not configured on the server; **502** → AI provider failed. Show "AI is unavailable, try again later" — everything non-AI keeps working

---

## 16. Rate limiting (auth endpoints only)

The unauthenticated auth endpoints are rate limited per client IP. Over the limit, the API returns **429** with the standard error shape and these response headers:

- `Retry-After` — seconds to wait before retrying (use this to disable the submit button / show a countdown)
- `RateLimit` / `RateLimit-Policy` — [IETF draft-8](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) headers with remaining quota and window (`r=` remaining, `t=` seconds to reset)

```json
{ "error": "Too many email requests. Please wait before requesting another." }
```

Limits (defaults — configurable server-side):

| Endpoints | Limit |
|---|---|
| `login`, `register`, `refresh`, `verify-email`, `reset-password` | 10 per 15 min |
| `resend-verification`, `forgot-password` (each sends a real email) | 3 per hour |

Practical UX: the email-sending endpoints are the tight ones. After a user requests a verification/reset email, disable the "resend" button and show a "try again in X" countdown driven by `Retry-After` rather than letting them spam it into a 429.

---

## 17. Admin — `/api/v1/admin` (Fritlow staff only)

**Not part of the end-user product.** This is the Fritlow-internal admin surface, for a separate staff console. Every endpoint requires a normal Bearer token **plus** a platform role of `SUPPORT` or `SUPERADMIN`. This is a **completely separate axis** from workspace roles (`OWNER/ADMIN/MEMBER`) — a workspace ADMIN has no platform access, and there is no shared value between the two. Normal users always get **403** here. Role changes take effect immediately (the guard reads the DB, not the token).

**The SUPERADMIN doesn't register — it logs in.** The admin account is provisioned from the server's `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars on startup; the admin simply calls the normal `POST /auth/login` with those credentials to get a token, then uses the `/admin/*` endpoints. (Additional SUPPORT staff can be promoted from existing accounts server-side via `npx tsx scripts/make-admin.ts <email> SUPPORT`.)

| Method + path | Query | Success | Notes |
|---|---|---|---|
| `GET /admin/stats` | — | **200** `AdminStats` | Platform-wide counts across ALL workspaces: users (total/verified/new), projects by status, discovery completion rate, blueprints, recommendations, exports, plus a 7-day activity proxy. |
| `GET /admin/users` | `page?`, `limit?` (≤100), `q?` | **200** `{ page, limit, total, totalPages, users }` | Paginated. `q` searches email + full name. Each row has `projectCount` + `workspaceCount`. |
| `GET /admin/users/:id` | — | **200** `{ user }` | Detail: their workspaces (+ role), projects, and an activity summary. 404 if unknown. |

The `deleted-user@fritlow.internal` anonymization placeholder is excluded from all counts and listings. Engagement figures are timestamp-derived proxies for now (there's no product-analytics events table yet).

---

## 18. Support chat — users ↔ Fritlow staff

Human support threads. Two sides, same data. Delivery is **poll-based** for V1 (re-fetch to see new messages; no websockets/SSE). Each conversation carries a `hasUnread` boolean computed **for the side that's asking** (a user never sees their own message as unread).

**User side — `/api/v1/support` (any authenticated user):**

| Method + path | Body | Success | Notes |
|---|---|---|---|
| `POST /support/conversations` | `{ subject?, message }` | **201** `{ conversation }` | Opens a thread with a first message. |
| `GET /support/conversations` | — | **200** `{ conversations }` | My threads, newest activity first, each with `hasUnread`. |
| `GET /support/conversations/:id` | — | **200** `{ conversation }` (with `messages[]`) | Marks the thread read for me. 404 if not mine. |
| `POST /support/conversations/:id/messages` | `{ body }` | **201** `{ message }` | Posting **reopens** a CLOSED thread. |

**Staff side — `/api/v1/admin/support` (platformRole SUPPORT or SUPERADMIN; else 403):**

| Method + path | Body / query | Success | Notes |
|---|---|---|---|
| `GET /admin/support/conversations` | `?status`, `?page`, `?limit` | **200** paginated | The inbox. Each row includes the `customer` and staff-side `hasUnread`. |
| `GET /admin/support/conversations/:id` | — | **200** `{ conversation }` (with `messages[]`) | Marks read for staff. |
| `POST /admin/support/conversations/:id/messages` | `{ body }` | **201** `{ message }` | The first staff reply **claims** the thread (`assignedAdminId`). |
| `PATCH /admin/support/conversations/:id` | `{ status }` | **200** `{ conversation }` | Set `OPEN` / `CLOSED`. |

`SupportMessage`: `{ id, body, senderType: "USER"|"STAFF", senderId, sender:{id,fullName}, createdAt }`. `SupportConversation`: `{ id, subject, status, lastMessageAt, assignedAdminId, hasUnread, customer?(staff only), messages?(detail) }`. Poll `GET …/conversations` for the unread badge and the detail endpoint for new messages while a thread is open.

---

## Postman — full walkthrough

Setup: `npm run dev` running; environment with `baseUrl = http://localhost:4000`. Postman handles the `fritlow_rt` cookie automatically. After step 1, set every request's Authorization to **Bearer Token** = `{{accessToken}}` (or set it once on a collection and inherit).

Post-response script to reuse on auth calls:

```js
const j = pm.response.json();
if (j.accessToken) pm.environment.set("accessToken", j.accessToken);
if (j.verificationToken) pm.environment.set("verifyToken", j.verificationToken);
if (j.project) pm.environment.set("projectId", j.project.id);
```

**1. Register** — `POST {{baseUrl}}/api/v1/auth/register`
`{ "fullName": "PM Tester", "email": "pm-run1@fritlow.dev", "password": "test-pass-123" }`
→ 201 `{ user, message }` — **no tokens**. Use a fresh email per run (409 otherwise). Existing verified dev accounts: `test@agmund.dev` / `test-password-123`, `second@fritlow.dev` / `another-pass-456`.

**2. Login before verifying** → `POST …/auth/login` with the same credentials → **403** "Please verify your email before logging in".

**3. Verify email** — copy the token from the **server console** (`[dev] Email verification token for …`) or from the emailed link, then `POST …/auth/verify-email` `{ "token": "<paste>" }` → 200, `emailVerified: true`. Now login → 200, save `accessToken`. (Full edge-case matrix in [auth-email-verification.md](auth-email-verification.md).)

**3b. Session sanity** — `GET …/auth/me` with the Bearer token → 200. Without it → 401. `POST …/auth/refresh` with empty body → 200 new `accessToken` (cookie did the work).

**4. Create a project** — `POST …/api/v1/projects`
`{ "name": "Test Product", "oneLineIdea": "An app that tests other apps" }`
→ 201, status `DRAFT`, save `projectId`.

**5. Start discovery** — `POST …/projects/{{projectId}}/discovery` → 201. Send it again → 409. `GET` the same URL → progress `0/10` + `nextQuestion`.

**6. Try to complete early** — `POST …/discovery/complete` → 400 ("…questions still unanswered").

**7. Answer all 10** — `POST …/discovery/answers`, once per id:
`problem.core`, `problem.evidence`, `customer.who`, `customer.where`, `business_model.payer`, `business_model.pricing`, `differentiation.alternatives`, `differentiation.moat`, `mvp_focus.essential`, `mvp_focus.success`
`{ "questionId": "problem.core", "answer": "Manual QA is slow and error-prone…" }`
Re-send one with a different `answer` → 200, it replaces (upsert). Give real-ish answers if you plan to test the AI endpoints — the model grades what you write.

**8. AI follow-up (needs server AI key + credits)** — `POST …/discovery/answers/problem.core/follow-up` → 200 with a challenge question; without a key → 503. Reply: re-POST `/answers` for that question with a `followUpAnswer` field.

**9. Complete** — `POST …/discovery/complete` → 200. Answering again now → 400.

**10. Health score (AI)** — `POST …/projects/{{projectId}}/health-score` → 200 with 5 graded dimensions (503 without AI). `GET` returns the stored score.

**11. Blueprint (AI)** — `POST …/projects/{{projectId}}/blueprint` → 201 with 8 sections; project flips to BLUEPRINT_COMPLETE. Again → 409. (`/blueprint/stream` emits SSE — Postman shows the raw event stream.) Then `GET …/blueprint` → 200, and edit a section:
`PATCH …/blueprint/sections/mvp_scope` `{ "markdown": "## Revised scope\nOnly the core action." }` → 200.

**12. Decisions** — `POST …/projects/{{projectId}}/decisions` `{ "title": "Use Stripe", "reasoning": "Fastest to integrate, fine at our volume." }` → 201. `PATCH …/decisions/<id>` `{ "status": "REVISED" }` → 200.

**13. Export** — `GET …/projects/{{projectId}}/export?format=pdf` → 200 binary (use *Send and Download*). Repeat with `docx` and `markdown`. Requires the blueprint from step 11.

**14. Dashboard** — `GET …/api/v1/dashboard` → 200; check `nextAction` matches where you actually are in the flow.

**15. Tenancy check** — log in as the second account (`second@fritlow.dev` / `another-pass-456`), then `GET …/projects/{{projectId}}` with *that* token → **403**.

**16. Logout** — `POST …/auth/logout` → 204; then `POST …/auth/refresh` → 401 (revoked).
