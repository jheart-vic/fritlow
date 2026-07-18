# Email Verification — Frontend Guide

How the email-verification flow works, what the frontend should build, and how to test every path in Postman.

Base URL (dev): `http://localhost:4000` — full interactive spec at `http://localhost:4000/docs`.

---

## The concept

- Every user has an `emailVerified: boolean` field. It is `false` at registration and flips to `true` once they submit a valid verification token.
- **Verification does NOT gate login in V1.** Unverified users can log in and use the app normally. The frontend's job is to *nag*, not to block — show a banner until `emailVerified` is `true`.
- Tokens are single-use and expire after **24 hours**. Requesting a resend invalidates all older tokens — only the newest link works.
- **Dev-only behavior:** until email sending is wired up, the raw token is returned in API responses (`verificationToken` field) and logged to the server console. In production this field disappears and the token arrives only by email.

## The user object

Every endpoint that returns a user (`register`, `login`, `GET /me`, `verify-email`) now includes the flag:

```json
{
  "id": "5f4425d0-…",
  "email": "ada@example.com",
  "fullName": "Ada Lovelace",
  "emailVerified": false,
  "createdAt": "2026-07-18T00:05:27.577Z"
}
```

---

## Endpoints

### 1. Registration issues the token automatically

`POST /api/v1/auth/register`

```json
{ "fullName": "Ada Lovelace", "email": "ada@example.com", "password": "s3cret-pass" }
```

**201 response (dev):**

```json
{
  "user": { "…": "…", "emailVerified": false },
  "accessToken": "eyJ…",
  "verificationToken": "xLGdI8Bk…"   // DEV ONLY — comes by email in production
}
```

Nothing extra to call at registration time — the token already exists. In production the user gets an email containing a link to the **frontend**, e.g.:

```
https://app.fritlow.com/verify-email?token=<raw-token>
```

The frontend owns that route: read `token` from the query string and POST it to the API (next section). The email template/link is wired up later with the email provider — the frontend route contract above is what to build against.

### 2. Verify the email

`POST /api/v1/auth/verify-email` — no auth header required (the token itself is the proof; the user may not even be logged in on the device where they opened the email).

```json
{ "token": "xLGdI8Bk…" }
```

**200:**

```json
{ "message": "Email verified.", "user": { "…": "…", "emailVerified": true } }
```

**400** — token is wrong, expired (>24h), already used, or superseded by a resend:

```json
{ "error": "Invalid or expired verification token" }
```

On 400, show a "link expired" screen with a button that calls resend (below).

### 3. Resend the verification email

`POST /api/v1/auth/resend-verification` — no auth required.

```json
{ "email": "ada@example.com" }
```

**Always 200**, regardless of whether the email exists or is already verified (deliberate — prevents attackers probing which emails have accounts):

```json
{
  "message": "If an unverified account exists for that email, a verification link has been sent.",
  "verificationToken": "3fPq…"   // DEV ONLY, and only when the account exists and is unverified
}
```

Rules to remember:
- Resending **invalidates every older unused token** — if the user clicks an old email afterwards, it 400s.
- There is no error for "already verified" or "unknown email" — the UI should just say "check your inbox."

---

## Suggested frontend flow

1. **After register/login and on `GET /me`:** if `user.emailVerified === false`, show a persistent banner: *"Please verify your email — Resend link"*. The resend button POSTs `/resend-verification` with the user's email.
2. **Route `/verify-email?token=…`:** on mount, POST the token to `/api/v1/auth/verify-email`.
   - 200 → success screen; if the user is logged in, update the cached user object (the response includes the fresh user).
   - 400 → "link invalid or expired" screen with a resend button (needs the user's email — ask for it if they aren't logged in).
3. That's it — no other screen changes. Login is never blocked by verification in V1.

---

## Testing in Postman

Setup: server running (`npm run dev`), a Postman environment with `baseUrl = http://localhost:4000`. All requests: `Content-Type: application/json`, raw JSON body. None of these three endpoints need an `Authorization` header.

**Step 1 — Register a fresh user** (grab the token)

```
POST {{baseUrl}}/api/v1/auth/register
{ "fullName": "Postman Tester", "email": "pm-test-1@fritlow.dev", "password": "test-pass-123" }
```

Expect **201**, `user.emailVerified: false`, and a `verificationToken`. Save it — e.g. in the request's *Scripts → Post-response*:

```js
pm.environment.set("verifyToken", pm.response.json().verificationToken);
```

(Use a new email each run, or you'll get 409 — the email is already registered.)

**Step 2 — Bad token is rejected**

```
POST {{baseUrl}}/api/v1/auth/verify-email
{ "token": "not-a-real-token" }
```

Expect **400** `Invalid or expired verification token`.

**Step 3 — Real token verifies**

```
POST {{baseUrl}}/api/v1/auth/verify-email
{ "token": "{{verifyToken}}" }
```

Expect **200**, `user.emailVerified: true`.

**Step 4 — Token is single-use**

Send Step 3 again → **400**.

**Step 5 — Resend never leaks account existence**

```
POST {{baseUrl}}/api/v1/auth/resend-verification
{ "email": "pm-test-1@fritlow.dev" }      → 200, NO verificationToken (already verified)

{ "email": "nobody@fritlow.dev" }         → 200, NO verificationToken (no such account)
```

Identical responses — that's the point.

**Step 6 — Resend rotates the token**

1. Register another fresh user (Step 1 with a new email) — save its `verificationToken` as `oldToken`.
2. `POST /resend-verification` with that email → 200 **with** a new `verificationToken` (unverified account, dev mode). Save as `newToken`.
3. Verify with `oldToken` → **400** (superseded by the resend).
4. Verify with `newToken` → **200**.
