import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rate-limit';
import * as workspaceController from './workspace.controller';

// The INVITEE's side of workspace invitations, mounted at /api/v1/invitations.
//
// Deliberately not nested under /workspaces/{id}: someone who has been invited
// is not yet a member of that workspace, so they cannot pass the membership
// gate every /workspaces/{workspaceId}/... route sits behind. These routes are
// scoped by the caller's email instead.
//
// The inviter's side (send, list outstanding, revoke) stays on the workspace
// router, where the OWNER/ADMIN gate belongs.
export const invitationRouter = Router();

/**
 * @openapi
 * /api/v1/invitations/lookup/{token}:
 *   get:
 *     tags: [Workspaces]
 *     summary: Read an invitation from its link token (no login required)
 *     description: >-
 *       **The only unauthenticated invitation endpoint.** Every invite email links to
 *       `{APP_URL}/invitations/{token}`; call this from that landing page to render it
 *       *before* the visitor signs in.
 *
 *
 *       Without it a logged-out click could only show a bare login form — no workspace name,
 *       no inviter, no project count — which reads as a broken link. Everything returned here
 *       was already in the email the caller is holding, so it discloses nothing new to a
 *       legitimate recipient.
 *
 *
 *       **Build the landing page as a state machine** on `status`, `accountExists`, and
 *       whether the visitor is signed in as `email`:
 *
 *
 *       | Visitor state | Do |
 *       | --- | --- |
 *       | Signed out, `accountExists: true` | Show the invite → "Sign in to accept" → return to this token |
 *       | Signed out, `accountExists: false` | Show the invite → "Create your account" → `POST /auth/register` with `invitationToken` |
 *       | Signed in as `email` | Show Accept / Decline → `POST /invitations/accept` with `{ token }` |
 *       | Signed in as someone else | "This invitation is for {email} — you're signed in as X. Switch accounts." |
 *       | `actionable: false` | Message per `status` (expired / revoked / declined / already accepted) |
 *
 *
 *       Authorization is the token itself — high-entropy, stored SHA-256 hashed, matched
 *       exactly. There is no listing and nothing to enumerate. Rate-limited.
 *
 *
 *       Note `workspaceId` and project names are deliberately **not** returned: the visitor
 *       is not a member and may never accept.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *         description: The raw token from the invite link.
 *     responses:
 *       200:
 *         description: The invitation, safe to render to a logged-out visitor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invitation:
 *                   type: object
 *                   properties:
 *                     workspace:
 *                       type: object
 *                       description: Name and privacy only — no id, no project names.
 *                       properties:
 *                         name: { type: string, example: "Acme Product Team" }
 *                         isPrivate: { type: boolean }
 *                     invitedBy:
 *                       type: object
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         fullName: { type: string }
 *                         avatarUrl: { type: string, nullable: true }
 *                     email:
 *                       type: string
 *                       format: email
 *                       description: Who the invitation was addressed to. Compare against the session to detect a wrong-account click.
 *                     role: { type: string, enum: [OWNER, ADMIN, MEMBER] }
 *                     status:
 *                       type: string
 *                       enum: [PENDING, ACCEPTED, REVOKED, DECLINED, EXPIRED]
 *                       description: EXPIRED is derived on read, so no stale PENDING is ever returned.
 *                     expiresAt: { type: string, format: date-time, nullable: true }
 *                     projectCount:
 *                       type: integer
 *                       example: 12
 *                       description: Projects the visitor would gain access to by accepting.
 *                     accountExists:
 *                       type: boolean
 *                       description: Whether `email` already has a Fritlow account — route to sign-in vs sign-up.
 *                     actionable:
 *                       type: boolean
 *                       description: True only when status is PENDING. Show accept/decline affordances only then.
 *       404:
 *         description: No invitation matches that token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Rate limited
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// Registered BEFORE requireAuth below — the whole point is that a logged-out
// visitor can read it. Anything added after that line is authenticated.
invitationRouter.get('/lookup/:token', authLimiter, workspaceController.lookupInvitation);

invitationRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/invitations:
 *   get:
 *     tags: [Workspaces]
 *     summary: Workspace invitations waiting for you
 *     description: >-
 *       Every PENDING invitation addressed to your email address. Matched on email, not
 *       membership, so invitations sent before you had an account appear here too.
 *
 *
 *       Expired invitations are omitted rather than returned greyed out — an invitation
 *       you cannot act on is noise. Each row carries `projectCount`, the number of
 *       projects you would gain access to by accepting: workspace membership is
 *       all-or-nothing, so accepting is never about a single project.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your pending invitations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invitations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       email: { type: string, format: email }
 *                       role: { type: string, enum: [OWNER, ADMIN, MEMBER] }
 *                       status: { type: string, enum: [PENDING] }
 *                       expiresAt: { type: string, format: date-time, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                       projectCount:
 *                         type: integer
 *                         description: Projects you would gain access to by accepting.
 *                       workspace:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                           isPrivate: { type: boolean }
 *                       invitedBy:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           fullName: { type: string }
 *                           avatarUrl: { type: string, nullable: true }
 */
invitationRouter.get('/', workspaceController.listMyInvitations);

/**
 * @openapi
 * /api/v1/invitations/accept:
 *   post:
 *     tags: [Workspaces]
 *     summary: Accept an invitation using the token from its email link
 *     description: >-
 *       For the "I clicked the link in my email" path. The token identifies the
 *       invitation, so no id is needed — but the invitation's email must match the
 *       logged-in account, otherwise it reads as not found.
 *
 *
 *       Accepting is what creates the membership. Safe to call twice: the second call
 *       returns 409 rather than creating a duplicate membership.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, description: The raw token from the invitation link. }
 *     responses:
 *       200:
 *         description: Joined the workspace
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                     isPrivate: { type: boolean }
 *                 role: { type: string, enum: [OWNER, ADMIN, MEMBER] }
 *       400:
 *         description: Expired, or no longer open (revoked / declined / already accepted)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No invitation matches that token for your email address
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Already used (a concurrent accept won)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
invitationRouter.post('/accept', workspaceController.acceptInvitation);

/**
 * @openapi
 * /api/v1/invitations/{invitationId}/accept:
 *   post:
 *     tags: [Workspaces]
 *     summary: Accept an invitation from your in-app list
 *     description: >-
 *       Same effect as the token route, for the "I saw it in the app" path. No request
 *       body. The invitation's email must match the logged-in account.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Joined the workspace
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                     isPrivate: { type: boolean }
 *                 role: { type: string, enum: [OWNER, ADMIN, MEMBER] }
 *       400:
 *         description: Expired, or no longer open
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Not found, or not addressed to your email
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Already used
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
invitationRouter.post('/:invitationId/accept', workspaceController.acceptInvitation);

/**
 * @openapi
 * /api/v1/invitations/{invitationId}/decline:
 *   post:
 *     tags: [Workspaces]
 *     summary: Turn down an invitation
 *     description: >-
 *       Marks the invitation DECLINED. The row is kept rather than deleted so the inviter
 *       can see what happened — DECLINED (you said no) stays distinct from REVOKED (they
 *       cancelled). They can invite you again, which re-arms the same row.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Declined
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invitation: { type: object }
 *       400:
 *         description: Expired, or no longer open
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Not found, or not addressed to your email
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
invitationRouter.post('/:invitationId/decline', workspaceController.declineInvitation);
