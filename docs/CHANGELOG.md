# Fritlow API — Changelog

Backend changes that affect the frontend contract. Newest first.
The source of truth is always the live spec at `/docs` (raw JSON at `/docs.json`) — this file explains the *why* and what you need to change.

---

## 2026-08-15 — Invite links: one landing page, and a public lookup

Answers the "what URL does the invite email actually point to?" question, and fixes a hole found while checking. **One breaking change** (link shape), one new public endpoint, one security fix.

### The short answer

**Every invite email now links to the same place:**

```
{APP_URL}/invitations/<token>
```

Path param, not a query param. Same URL whether or not the recipient already has a Fritlow account. Build **one** landing page there.

### ⚠️ Breaking — the signup-invite link changed

Previously the backend sent two different URLs depending on whether the invited email had an account *at the moment the invite was sent*:

```diff
  # has an account
  {APP_URL}/invitations/<token>
- # no account
- {APP_URL}/register?email=<email>&invitation=<token>
+ # no account — now the same as above
+ {APP_URL}/invitations/<token>
```

**Why the old split was wrong:** the branch was decided at send time, but the fact can change before the click. Someone invited without an account may well have signed up by the time they open the email, and would land on a registration page while already authenticated. The reverse (invited with an account, clicks while logged out) had no context to show either.

`POST /auth/register` still accepts `invitationToken`, and **the old `/register?email=…&invitation=…` links still resolve** — invites already sitting in inboxes keep working. You just won't receive that shape for new invites.

### New — `GET /invitations/lookup/{token}` (no auth)

The only unauthenticated invitation endpoint. Call it from the landing page to render the invite *before* the visitor signs in.

```jsonc
{
  "invitation": {
    "workspace":   { "name": "Acme Product Team", "isPrivate": false },
    "invitedBy":   { "id": "…", "fullName": "Ada Lovelace", "avatarUrl": null },
    "email":       "invitee@example.com",
    "role":        "MEMBER",
    "status":      "PENDING",
    "expiresAt":   "2026-08-29T…",
    "projectCount": 12,
    "accountExists": true,
    "actionable":  true
  }
}
```

Note there is **no `workspaceId` and no project names** — the visitor isn't a member and may never accept. `status` has `EXPIRED` derived on read, so you'll never get a stale `PENDING`.

### The landing page state machine

Everything you need is in that one response:

| Visitor state | What to show |
|---|---|
| Signed out, `accountExists: true` | The invite + **"Sign in to accept"** → login → return to this token |
| Signed out, `accountExists: false` | The invite + **"Create your account"** → `POST /auth/register` with `invitationToken` |
| Signed in as `email` | The invite + **Accept / Decline** → `POST /invitations/accept` with `{ token }` |
| Signed in as a different address | *"This invitation is for `{email}` — you're signed in as X. Switch accounts."* |
| `actionable: false` | A message per `status` — expired / revoked / declined / already accepted |

That fourth row is worth building properly: `POST /invitations/accept` returns **404** on an email mismatch (deliberately — it won't confirm whether a token exists for someone else). Compare `invitation.email` against the session yourself and show the friendly message; don't rely on the API error to explain it.

The fifth row replaces what used to be four different situations collapsing into one unhelpful failure.

### ⚠️ Security fix — a forwarded invite can no longer be redeemed by someone else

`POST /auth/register` with an `invitationToken` previously joined the workspace based on the **token alone**. Forwarding the invite email let the recipient register with *their own* address and land in every project inside.

Now the token only applies when the registering `email` matches the address the invitation was sent to. Mismatches are ignored silently — registration still succeeds (a bad link must never cost someone their account), they just don't join the workspace, and the invitation stays PENDING for the person it was addressed to.

**Frontend impact:** if you prefill the email field from the invite, don't let it be edited while a token is attached — or the user will silently not join and won't know why. Better: keep it read-only and offer "use a different email" as an explicit action that drops the token.

### Rate limiting

`GET /invitations/lookup/{token}` is rate-limited like the auth endpoints — a **429** with `Retry-After` is possible. Handle it the same way you handle login throttling.

---

## 2026-08-14 — Workspace access model

A client-driven rework of who can see what. **Three breaking changes**, several new endpoints, and one behaviour change you'll notice immediately in testing.

Read the three breaking items first — they'll fail loudly. Everything else is additive.

### ⚠️ Breaking 1 — `isPersonal` is now `isPrivate`

Every workspace object. Straight rename in every response that carries a workspace.

```diff
- { "id": "…", "name": "Acme", "isPersonal": false }
+ { "id": "…", "name": "Acme", "isPrivate": false }
```

**Why it isn't just a rename.** The old field was doing two jobs at once: *"invites are refused here"* **and** *"projects land here when none is named"*. Those are now two separate facts, because the second one has to be unique per user and the first one doesn't:

| Fact | Where it lives now | How many |
|---|---|---|
| Invites are refused here | `workspace.isPrivate` | Any number per user, or none |
| New projects land here | `workspace.isDefault` (per-caller) | Exactly one per user |

So `isPrivate` no longer implies "this is *the* personal workspace" — a user can own five private workspaces. If you were using `isPersonal` to find someone's home workspace, use **`isDefault`** instead.

### ⚠️ Breaking 2 — invites never return a `member` any more

`POST /workspaces/:id/members/invite` used to add existing users immediately. **It doesn't. Nobody joins a workspace without accepting.**

```diff
- // existing user  → { member, sharedProjectCount }
- // unknown email  → { pending: true, invitation, sharedProjectCount }
+ // always         → { pending: true, hasAccount, invitation, sharedProjectCount }
```

`pending` is now always `true` — it's kept only so existing parsing doesn't crash. **Branch on `hasAccount`:**

- `hasAccount: true` → an existing user was emailed an accept link. Say *"Invitation sent"*.
- `hasAccount: false` → an unregistered email was emailed a signup link. Say *"Signup invite sent"*.

Either way **the member list does not change yet.** If you optimistically append the invitee to the members table, that's now wrong — they belong in a separate "Pending invitations" section until they accept.

**Why:** being added to a workspace without consent put a stranger's projects in your sidebar on their say-so. Since membership is workspace-wide, that's never one project — it's everything in there.

### ⚠️ Breaking 3 — dashboard projects gained two fields

Additive to the shape, but it changes what you should *render*, so treat it as breaking for design purposes.

```diff
  {
    "id": "…", "name": "…", "status": "DISCOVERY",
    "discoveryProgress": { "answered": 4, "total": 12 },
    "hasBlueprint": false,
    "nextAction": { … },
+   "workspace": { "id": "…", "name": "Acme Team", "isPrivate": false },
+   "isMine": true
  }
```

**Please label every dashboard card with `workspace.name`.** `GET /dashboard` spans *every* workspace the caller belongs to. A freelancer in four client workspaces currently sees their own drafts and four clients' projects in one undifferentiated list — and a project appearing there the moment they accept an invite reads as a leak rather than as the access they were just granted. Grouping by workspace also works.

`GET /dashboard?workspaceId=…` now narrows to one workspace, matching what `GET /projects` already accepted.

The top-level `nextAction` also changed: it now prefers the caller's **own** most recently touched project rather than pure recency. Previously, someone who joined a busy workspace would open Fritlow and be told to continue *a teammate's* discovery interview.

---

### New — users choose private or shared when creating a workspace

`POST /workspaces` takes two new optional fields:

```jsonc
{
  "name": "Acme Product Team",
  "visibility": "SHARED",     // or "PRIVATE" — defaults to SHARED
  "setAsDefault": false        // make new projects land here
}
```

- **PRIVATE** — nobody can ever be invited (invite returns 400). No team chat channel is created.
- **SHARED** — invite-only collaboration, with a `general` channel.

The word is **SHARED, never "Public"** in the UI. These workspaces are invite-only and never discoverable, so "Public" would read as *published to the internet* — the opposite of what happens. (Agreed with you before this shipped; flagging so the copy doesn't drift.)

There's no limit on how many private workspaces someone can own.

### New — the default workspace is explicit

| Endpoint | Notes |
|---|---|
| `POST /workspaces/:id/set-default` | **OWNER only.** No body. |

`GET /workspaces` now returns `isDefault` on each row — badge it.

Being a *member* isn't enough to default into a workspace: doing so would publish everything you start to that team, and you couldn't undo it yourself. Pointing your default at a **shared** workspace is allowed, and the response carries a non-null **`warning`** string — show it.

### New — the invitee's side of invitations

All under `/api/v1/invitations` (top level, *not* nested under a workspace — an invitee isn't a member yet, so they can't pass that gate).

| Method + path | Body | Success |
|---|---|---|
| `GET /invitations` | — | `{ invitations }` — everything pending for your email |
| `POST /invitations/accept` | `{ token }` | `{ workspace, role }` — for the emailed link |
| `POST /invitations/:id/accept` | — | `{ workspace, role }` — for the in-app list |
| `POST /invitations/:id/decline` | — | `{ invitation }` |

Each row in `GET /invitations` carries **`projectCount`** — how many projects accepting would expose. Put it in the accept prompt: *"Joining Acme Team gives you access to 12 projects."*

Statuses are now `PENDING | ACCEPTED | REVOKED | DECLINED | EXPIRED`. Invitations expire after **14 days**; expired ones are omitted from the list rather than returned greyed out.

Re-inviting the same email re-arms the existing invitation and **issues a new token**, which invalidates the link in the previous email.

**Two screens you'll need that didn't exist before:** a pending-invitations list (badge it on app load — it's the first thing a new collaborator sees), and a "Pending" section in the workspace members view for invites that haven't been accepted.

### New — registration can carry an invitation

`POST /auth/register` accepts an optional `invitationToken`.

The signup link in an invite email looks like `…/register?email=…&invitation=<token>`. **Pass that `invitation` query param through as `invitationToken`.** Registering through the link counts as accepting, so the user lands in the workspace on first login.

If you don't pass it, the invitation stays pending and they'll have to accept it in-app — signing up isn't by itself consent to join a workspace you never clicked on. An invalid or expired token is ignored rather than failing registration.

### New — leave a workspace

| Endpoint | Notes |
|---|---|
| `DELETE /workspaces/:id/members/me` | 204. Refused (400) if you're the only OWNER. |

The necessary counterpart to invitations needing acceptance: if you can be invited, you can get out without asking an owner.

### New — moves tell people who lost access

Moving a project (`PATCH /projects/:id` with `workspaceId`) is a transfer of *audience*: the source workspace's members lose it, the destination's gain it. It used to be completely silent.

| Endpoint | Notes |
|---|---|
| `GET /projects/:id/move-preview?workspaceId=…` | Who would lose/gain access |

```jsonc
{
  "project": { "id": "…", "name": "Fitpad" },
  "from": { "id": "…", "name": "Acme Team" },
  "to":   { "id": "…", "name": "Skunkworks" },
  "losingAccess": { "count": 3, "users": [ { "id": "…", "fullName": "Ada Lovelace", "avatarUrl": null } ] },
  "gainingAccess": { "count": 5 }
}
```

**Show this before the move:** *"3 people will lose access to this project."* `losingAccess.users` is named so you can show faces. People who belong to *both* workspaces are correctly excluded — they notice nothing.

Everyone who loses access gets a `PROJECT_MOVED` notification. The destination workspace is deliberately never named in it (they can't see it), so don't try to build a link to it.

### New — bulk move

| Method + path | Body |
|---|---|
| `POST /projects/move` | `{ projectIds[], targetWorkspaceId }` |
| `POST /projects/move-preview` | same body |

All-or-nothing, max 50 per call. Requires OWNER/ADMIN on the destination *and* every source workspace in the selection (a multi-select naturally spans workspaces since the dashboard lists them together).

**Please make this the primary action in the UI**, above "convert this workspace to shared" — it's the precise option, and much harder to regret. Notifications are batched: four moved projects produce one *"4 projects left Acme Team"*, not four alerts.

### New — convert a workspace in both directions

| Endpoint | Notes |
|---|---|
| `POST /workspaces/:id/convert-to-shared` | Existing. Now also repoints your default if it pointed here. |
| `POST /workspaces/:id/convert-to-private` | **New.** Only when you're the sole member. |

`convert-to-private` fails with a 400 naming who's still a member — remove them first. Silently ejecting people would revoke their access to everything with no warning, which is what the move notifications exist to prevent. Pending invites are revoked with it.

This is a round trip, not an undo: converting back doesn't restore anyone's old membership. Projects never move during a conversion, and the team chat channel and its history survive.

### New — delete a workspace

| Method + path | Body | Notes |
|---|---|---|
| `GET /workspaces/:id/delete-preview` | — | Call this first |
| `DELETE /workspaces/:id` | `{ confirmName, newDefaultWorkspaceId? }` | **OWNER only** — 403 for ADMIN |

**This is irreversible and it destroys every project in the workspace** — blueprints, discovery interviews, decisions, comments, exports, uploaded documents, all of it. It is not "remove from my list". Build the dialog accordingly.

`delete-preview` gives you everything the confirmation needs:

```jsonc
{
  "workspace": { "id": "…", "name": "Acme Team", "isPrivate": false },
  "projectCount": 12,
  "otherMembers": { "count": 3, "users": [ … ] },
  "isDefault": true,
  "requiresNewDefault": true,      // collect newDefaultWorkspaceId in the same dialog
  "isLastOwnedWorkspace": false    // when true, disable the action entirely
}
```

Three guards, all 400s:

1. **`confirmName` must exactly match the workspace name** (case-sensitive). Use the type-the-name pattern — a checkbox won't do, because the realistic mistake is deleting the *wrong* workspace from a list of six, and only retyping the name proves which one is meant.
2. **You can't delete the only workspace you own.** Use `isLastOwnedWorkspace` to disable the button rather than letting them hit the error.
3. **Deleting your default requires `newDefaultWorkspaceId`** (another workspace you own). Use `requiresNewDefault` to put that picker in the dialog up front.

Other members get a `WORKSPACE_DELETED` notification. It carries the workspace *name* only — no id, since the row is gone and a click-through would 404.

---

### New notification types

Add icons/copy for `PROJECT_MOVED` and `WORKSPACE_DELETED`. Neither has a safe click-through target — `PROJECT_MOVED` deliberately omits the project (the reader has lost access, so it would 403) and `WORKSPACE_DELETED` omits the workspace (it no longer exists). Render them as read-only informational rows.

### One thing that did NOT change

Access is still **workspace-wide, never per project**. There is no way to share a single project with a single person, and none of the above adds one. Everything here is about making the workspace boundary easier to see and safer to cross.

### Testing note

If you have seed data or Postman flows that invite an existing user and then immediately assert they're a member, those will now fail — you need the accept call in between. `GET /invitations` as the invitee gives you the id.

---

## Earlier

Changes before 2026-08-14 aren't logged here. See [frontend-api-guide.md](frontend-api-guide.md) for the current reference and `/docs` for the live spec.
