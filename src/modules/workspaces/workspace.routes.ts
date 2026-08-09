import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as workspaceController from './workspace.controller';
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
} from './workspace.schemas';

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/workspaces:
 *   post:
 *     tags: [Workspaces]
 *     summary: Create a workspace
 *     description: Creates a new workspace with you as its OWNER. (Everyone also gets a personal workspace automatically at registration.)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 100, example: "Acme Product Team" }
 *     responses:
 *       201:
 *         description: Workspace created (you are OWNER)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace: { $ref: '#/components/schemas/WorkspaceMembership' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *   get:
 *     tags: [Workspaces]
 *     summary: List workspaces you belong to (with your role in each)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your workspaces
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspaces:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/WorkspaceMembership' }
 */
workspaceRouter.post('/', validateBody(createWorkspaceSchema), workspaceController.create);
workspaceRouter.get('/', workspaceController.list);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/members:
 *   get:
 *     tags: [Workspaces]
 *     summary: List a workspace's members
 *     description: Any member of the workspace can view the roster.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 members:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/WorkspaceMember' }
 *       403:
 *         description: Not a member of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.get('/:workspaceId/members', workspaceController.listMembers);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/members/invite:
 *   post:
 *     tags: [Workspaces]
 *     summary: Invite a user to the workspace
 *     description: >-
 *       OWNER/ADMIN only. If the email already has a Fritlow account they are added immediately
 *       (response `{ member }`) and emailed a heads-up. If not, a PENDING invitation is recorded and
 *       a signup email is sent (response `{ pending: true, invitation }`); they auto-join the workspace
 *       when they register with that email. OWNER is not grantable here — use the role endpoint.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *               role: { type: string, enum: [ADMIN, MEMBER], default: MEMBER }
 *     responses:
 *       201:
 *         description: Member added (existing user) or invitation recorded (new email)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     member: { $ref: '#/components/schemas/WorkspaceMember' }
 *                 - type: object
 *                   properties:
 *                     pending: { type: boolean, example: true }
 *                     invitation: { $ref: '#/components/schemas/WorkspaceInvitation' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403:
 *         description: Not an owner/admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Already a member
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.post(
  '/:workspaceId/members/invite',
  validateBody(inviteMemberSchema),
  workspaceController.inviteMember,
);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/members/{userId}:
 *   patch:
 *     tags: [Workspaces]
 *     summary: Change a member's role
 *     description: OWNER/ADMIN only. Only an OWNER may grant the OWNER role or change an existing owner's role. A workspace must always keep at least one owner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [OWNER, ADMIN, MEMBER] }
 *     responses:
 *       200:
 *         description: Updated member
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 member: { $ref: '#/components/schemas/WorkspaceMember' }
 *       400:
 *         description: Validation error, or would remove the last owner
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not permitted (e.g. non-owner touching the owner role)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Target is not a member
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Workspaces]
 *     summary: Remove a member from the workspace
 *     description: OWNER/ADMIN only. Removing an owner is owner-only and never the last owner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: "Member removed" }
 *       400:
 *         description: Would remove the last owner
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Target is not a member
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.patch(
  '/:workspaceId/members/:userId',
  validateBody(updateMemberRoleSchema),
  workspaceController.updateMemberRole,
);
workspaceRouter.delete('/:workspaceId/members/:userId', workspaceController.removeMember);
