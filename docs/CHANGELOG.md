# Fritlow API — Changelog

Backend changes that affect the frontend contract. Newest first.
The source of truth is always the live spec at `/docs` (raw JSON at `/docs.json`) — this file explains the *why* and what you need to change.

---

## 2026-08-19 — Comment editing, author avatars, and what "Launched" means

Nothing breaking. One new endpoint, one contract correction, one new rule.

### `avatarUrl` on comment authors — it was already there

**The API has been returning it all along.** `Comment.author` is selected with `{ id, fullName, avatarUrl }`, on top-level comments *and* on nested `replies[]`, and a live check against the database confirms a real URL coming back.

What was wrong was the **documentation** — the OpenAPI `Comment.author` schema listed only `id` and `fullName`, so it looked absent to anyone reading the spec. Now corrected, along with the internal type that had the same gap.

**You can render avatars today without waiting for a deploy.** `avatarUrl` is `null` when the user has no photo (render initials); the key is always present.

### New — edit a comment

```
PATCH /api/v1/comments/{id}
{ "body": "the corrected text" }
```

Returns `{ comment }`. Sits alongside the existing `DELETE /api/v1/comments/{id}` at the same flat path.

Three rules worth building around:

**Author only.** Deliberately narrower than delete, which also allows workspace OWNER/ADMIN. Removing off-topic content is moderation; rewriting someone's words leaves their name on text they never wrote. A manager editing another person's comment gets a **403** — so show the edit affordance only on the reader's own comments, while delete can still appear on others' for OWNER/ADMIN.

**15-minute window**, measured from when the comment was **posted** — not from the last edit, so repeated edits can't extend it. After that the API returns **400**. Hide the edit affordance once `createdAt` is more than 15 minutes old rather than letting people discover the limit by hitting it; the remaining route is delete-and-repost.

**Only `body` is editable.** A comment can't be moved to another section or re-parented into a different thread, which would change what the replies beneath it appear to be answering.

### New field — `editedAt`

`Comment` now carries `editedAt` (nullable, null until first edited). **Use this for the "(edited)" marker.**

Don't infer it from `updatedAt != createdAt`. That happens to work right now only because nothing else ever writes a comment row — the first time that changes, every comment silently renders as edited.

### New rule — a project can only be LAUNCHED once it has a blueprint

To answer the question directly: **`LAUNCHED` means the founder said so.** The backend sets the first three statuses itself — `DRAFT` on creation, `DISCOVERY` when the interview starts, `BLUEPRINT_COMPLETE` when the blueprint is generated. `LAUNCHED` is the only one a human declares, via `PATCH /projects/{id}`.

Until now there was no check at all, so an empty `DRAFT` could be marked `LAUNCHED` — landing it in the library's Launched filter and giving it the dashboard's terminal `CELEBRATE` state with nothing in it. Now `PATCH … { status: "LAUNCHED" }` returns **400** unless the project has a blueprint.

Two implications for the UI:

- **Treat "mark as launched" as a deliberate action**, with confirmation — it's a claim the founder is making, not an idle dropdown in a list row.
- **Disable it until the project has a blueprint** rather than surfacing the 400. `hasBlueprint` is already on the dashboard payload; `GET /projects/{id}` tells you the same via `status`.

Other status transitions are unaffected — the guard is specific to `LAUNCHED`. Note the backend still doesn't enforce the full `DRAFT → DISCOVERY → BLUEPRINT_COMPLETE → LAUNCHED` order; only the launch claim is gated. Say if you'd like the rest locked down too.

---

## 2026-08-18 — Chat rename, and the AI latency / empty-response fix

Nothing breaking. One new endpoint, one clarification, and a real fix behind the scenes.

### New — rename a conversation

```
PATCH /api/v1/projects/{projectId}/chat/conversations/{id}
{ "title": "Pricing model options" }   // or  { "title": null }  to clear it
```

Returns `{ conversation }` (the row, without messages). `title` is capped at 120 chars; blank is a 400. **Send `null` to clear** — that's the way out of a bad rename, back to whatever you show for an untitled chat.

### Delete already existed

`DELETE /api/v1/projects/{projectId}/chat/conversations/{id}` → **204**. It's been there since the chat module shipped; it just wasn't called out clearly, so it was easy to miss. Messages cascade with it. Irreversible — no archive, no restore — so confirm before calling.

Both are **your own conversations only**. Chats are per-user within a project, not shared with the workspace, so someone else's conversation id reads as a **404** rather than a 403 — it isn't theirs to know exists. Don't render that as "permission denied"; treat it as gone.

### Fixed — "AI returned an unparseable impact analysis"

`POST /projects/{id}/blueprint/sections/{key}/impact-analysis` had **never once succeeded** — 8 of 8 recorded calls failed. The error message blamed JSON parsing, which was a red herring.

The real cause: GPT-5 is a reasoning model, and its internal reasoning is billed against the *same* token budget as the visible answer. That call ships the entire rest of the blueprint (~14k characters) into an analytical task, and the budget was 2048 — so the model spent every token thinking and returned **nothing at all**. The parser then choked on an empty string and reported it as malformed JSON.

Fixed by giving it room to think (2048 → 8192) and dropping its reasoning effort, which measured *identical* detection quality at ~30% lower latency. The endpoint works now.

Two things you may notice:

- **An empty result is a valid answer.** `{ "affectedSections": [] }` means the AI found nothing inconsistent — that's a real outcome, not a failure. It used to be possible for a legitimate "nothing is affected" to surface as a 502; it won't now.
- **Errors are honest.** If a model genuinely runs out of room you'll get a 502 that says so, instead of one blaming the parser.

### Faster AI responses

The same root cause was slowing things down generally, since a model that spends its whole budget reasoning is also a model you wait on. Tuned per feature:

| Feature | Change |
|---|---|
| Impact analysis | ~30s → **~12s** |
| Project chat | Lower reasoning effort; also fixes ~1 in 10 replies coming back empty |
| Discovery confidence | Raised off a cap it was hitting 81% of — a latent version of the same bug |

Chat is streamed over SSE, so what improves most is **time to first token**. If you're showing a spinner until the first chunk arrives, that wait should now be noticeably shorter.

Please still design for a slow response — these are 10–20 second calls, not 200ms ones. Keep the streaming UI, keep the skeleton states, and don't block the rest of the page on them.

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
