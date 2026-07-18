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
| `POST /answers` | `{ questionId, answer, followUpAnswer? }` | **200** `{ answered, total, nextQuestion }` | Upsert — re-answering the same question replaces it. Returns fresh progress so the UI can advance without a re-fetch. 400 if session closed |
| `POST /answers/:questionId/follow-up` | — | **200** `{ questionId, followUp }` | **AI Challenge Mode**: generates one probing follow-up question about this answer. 400 if question unanswered; 503 if server has no AI key. Reply by re-POSTing `/answers` with `followUpAnswer` |
| `POST /complete` | — | **200** | Only when all 10 answered — else 400 with a clear message |

`GET /` response shape:

```json
{
  "session": {
    "id": "…", "status": "ACTIVE", "startedAt": "…", "completedAt": null,
    "answers": [ { "questionId": "problem.core", "questionText": "…", "module": "problem",
                   "answer": { "text": "…", "followUp": { "question": "…", "answer": "…" } },
                   "answeredAt": "…" } ]
  },
  "answered": 3,
  "total": 10,
  "nextQuestion": { "id": "problem.evidence", "module": "problem", "text": "…", "hint": "…" }
}
```

UI flow: render `nextQuestion` (with its `hint`), POST the answer, optionally hit the follow-up endpoint to let the AI push back, re-fetch or advance locally, and show `answered/total` as the progress meter. `nextQuestion` is `null` when everything's answered — then show the "Complete interview" CTA.

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

AI grades the discovery answers across 5 dimensions (0–100 each + honest feedback); `overall` is the server-computed average.

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

Dimension keys: `problem_clarity`, `target_audience`, `business_model`, `differentiation`, `mvp_focus`. This powers the blueprint screen's health ribbon.

---

## 7. Export — `GET /api/v1/projects/:projectId/export?format=pdf|docx|markdown`

Returns the file itself (`Content-Disposition: attachment`), not JSON. Frontend: fetch with the Bearer header, read the response as a blob, trigger a download. 404 if no blueprint exists yet, 400 on a bad format value.

---

## 8. Dashboard — `GET /api/v1/dashboard`

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

## 9. Errors — one shape everywhere

```json
{ "error": "Human-readable message" }
```

Validation failures (400 from zod) add a `details` array of per-field messages. Status codes to handle globally:

- **401** → try refresh, then login screen
- **403** → from login: email not verified; elsewhere: "you don't have access to this project"
- **404** → resource gone / not created yet (often an expected state, e.g. no blueprint yet)
- **409** → already exists (duplicate email, session/blueprint already created)
- **503** → AI not configured on the server; **502** → AI provider failed. Show "AI is unavailable, try again later" — everything non-AI keeps working

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
