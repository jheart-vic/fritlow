# Email Verification — Frontend Guide

How the email-verification flow works, what the frontend should build, and how to test every path in Postman.

Base URL (dev): `http://localhost:4000` — full interactive spec at `http://localhost:4000/docs`.

---

## The concept

- Every user has an `emailVerified: boolean` field. It is `false` at registration and flips to `true` once they submit a valid verification token.
- **Verification gates login.** Registration returns no session tokens; logging in before verifying returns **403** `Please verify your email before logging in`. The flow is: register → check email → click link → verified → log in.
- Tokens are single-use and expire after **24 hours**. Requesting a resend invalidates all older tokens — only the newest link works.
- Tokens travel **by email only** (sent via Brevo) — they never appear in API responses. On dev servers the token is also logged to the server console (`[dev] Email verification token for …`) so flows can be tested without an inbox.

## The user object

Every endpoint that returns a user (`register`, `login`, `GET /me`, `verify-email`) includes the flag:

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

### 1. Registration sends the email automatically

`POST /api/v1/auth/register`

```json
{ "fullName": "Ada Lovelace", "email": "ada@example.com", "password": "s3cret-pass" }
```

**201 response — note: no access token, no cookie:**

```json
{
  "user": { "…": "…", "emailVerified": false },
  "message": "Account created. Check your email for a verification link."
}
```

After registering, route the user to a **"check your email"** screen — do not treat them as logged in. The verification email links to the **frontend**:

```
https://app.fritlow.com/verify-email?token=<raw-token>
```

The frontend owns that route: read `token` from the query string and POST it to the API (next section).

### 2. Verify the email

`POST /api/v1/auth/verify-email` — no auth header required (the token itself is the proof; the user may open the email on any device).

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

On 200 → success screen with a "Log in" button. On 400 → "link expired" screen with a resend button (below).

### 3. Resend the verification email

`POST /api/v1/auth/resend-verification` — no auth required.

```json
{ "email": "ada@example.com" }
```

**Always 200**, regardless of whether the email exists or is already verified (deliberate — prevents attackers probing which emails have accounts):

```json
{ "message": "If an unverified account exists for that email, a verification link has been sent." }
```

Rules to remember:
- Resending **invalidates every older unused token** — if the user clicks an old email afterwards, it 400s.
- There is no error for "already verified" or "unknown email" — the UI should just say "check your inbox."

---

## Suggested frontend flow

1. **Register** → "check your email" screen (offer a resend button there too).
2. **Route `/verify-email?token=…`:** on mount, POST the token to `/api/v1/auth/verify-email`.
   - 200 → success screen → "Log in" button.
   - 400 → "link invalid or expired" screen with a resend button (ask for the email — the user isn't logged in).
3. **Login** → on **403**, show "verify your email first" with a resend button. On 200 the user object is in the response; the session works exactly as before (access token in memory, refresh cookie handled by the browser).

---

## Testing in Postman

Setup: server running (`npm run dev`), a Postman environment with `baseUrl = http://localhost:4000`. All requests: `Content-Type: application/json`, raw JSON body. None of these endpoints need an `Authorization` header.

**Step 1 — Register a fresh user**

```
POST {{baseUrl}}/api/v1/auth/register
{ "fullName": "Postman Tester", "email": "pm-test-1@fritlow.dev", "password": "test-pass-123" }
```

Expect **201**, `user.emailVerified: false`, and NO `accessToken`. (Use a new email each run, or you'll get 409.)

**Step 2 — Login is blocked**

```
POST {{baseUrl}}/api/v1/auth/login
{ "email": "pm-test-1@fritlow.dev", "password": "test-pass-123" }
```

Expect **403** `Please verify your email before logging in`.

**Step 3 — Grab the token**

From the **terminal running `npm run dev`**, copy the line:

```
[dev] Email verification token for pm-test-1@fritlow.dev: <token>
```

(Or, if Brevo is configured and the address is real, click the link in the email and copy the `token` query param.)

**Step 4 — Bad token is rejected**

```
POST {{baseUrl}}/api/v1/auth/verify-email
{ "token": "not-a-real-token" }
```

Expect **400** `Invalid or expired verification token`.

**Step 5 — Real token verifies**

```
POST {{baseUrl}}/api/v1/auth/verify-email
{ "token": "<token from step 3>" }
```

Expect **200**, `user.emailVerified: true`. Send it again → **400** (single-use). Now repeat Step 2's login → **200** with an `accessToken`.

**Step 6 — Resend never leaks account existence**

```
POST {{baseUrl}}/api/v1/auth/resend-verification
{ "email": "pm-test-1@fritlow.dev" }      → 200 (already verified — nothing sent)
{ "email": "nobody@fritlow.dev" }         → 200 (no such account — nothing sent)
```

Identical responses — that's the point.

**Step 7 — Resend rotates the token**

1. Register another fresh user; note its console token as `oldToken`.
2. `POST /resend-verification` with that email → 200; a NEW token appears in the console.
3. Verify with `oldToken` → **400** (superseded).
4. Verify with the new token → **200** → login works.
