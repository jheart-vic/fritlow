import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
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
