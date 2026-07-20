import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as settingsController from './settings.controller';
import {
  changePasswordSchema,
  renameWorkspaceSchema,
  updateProfileSchema,
} from './settings.schemas';

export const settingsRouter = Router();

// Every settings route requires a logged-in user.
settingsRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/settings/profile:
 *   patch:
 *     tags: [Settings]
 *     summary: Update your profile
 *     description: Updates the authenticated user's own profile. V1 supports the display name only — email changes are out of scope (they'd require re-verification).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName]
 *             properties:
 *               fullName: { type: string, minLength: 2, maxLength: 100, example: "Ada Lovelace" }
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
settingsRouter.patch('/profile', validateBody(updateProfileSchema), settingsController.updateProfile);

/**
 * @openapi
 * /api/v1/settings/password:
 *   post:
 *     tags: [Settings]
 *     summary: Change your password (while logged in)
 *     description: Requires the current password. On success every existing session is revoked (all refresh tokens), so the user — and anyone else holding a stolen token — must log in again.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, format: password }
 *               newPassword: { type: string, format: password, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password changed — all sessions revoked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401:
 *         description: Missing/invalid access token, or the current password was wrong
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
settingsRouter.post('/password', validateBody(changePasswordSchema), settingsController.changePassword);

/**
 * @openapi
 * /api/v1/settings/workspaces/{workspaceId}:
 *   patch:
 *     tags: [Settings]
 *     summary: Rename a workspace
 *     description: Renames a workspace you belong to. Only OWNER or ADMIN members may rename it.
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
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 100, example: "Acme Product Team" }
 *     responses:
 *       200:
 *         description: Workspace renamed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace: { $ref: '#/components/schemas/Workspace' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not a member, or not an owner/admin of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
settingsRouter.patch(
  '/workspaces/:workspaceId',
  validateBody(renameWorkspaceSchema),
  settingsController.renameWorkspace,
);
