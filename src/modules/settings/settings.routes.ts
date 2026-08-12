import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { avatarUpload } from '../../middleware/upload';
import { validateBody } from '../../middleware/validate';
import * as settingsController from './settings.controller';
import {
  changePasswordSchema,
  deleteAccountSchema,
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
 * /api/v1/settings/avatar:
 *   post:
 *     tags: [Settings]
 *     summary: Upload / replace your profile photo
 *     description: Multipart upload (field name `avatar`, image only, ≤5 MB). Stored on Cloudinary; the user's `avatarUrl` is set to the hosted URL. Re-uploading replaces the previous image.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [avatar]
 *             properties:
 *               avatar: { type: string, format: binary, description: "Image file (jpg/png/webp/…), ≤5 MB" }
 *     responses:
 *       200:
 *         description: Avatar updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: No file, non-image, or file too large
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       503:
 *         description: Image uploads not configured on this server
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Settings]
 *     summary: Remove your profile photo (revert to initials)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Avatar removed (avatarUrl now null)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
settingsRouter.post('/avatar', avatarUpload, settingsController.updateAvatar);
settingsRouter.delete('/avatar', settingsController.removeAvatar);

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
 * /api/v1/settings/account:
 *   delete:
 *     tags: [Settings]
 *     summary: Permanently delete your own account
 *     description: >-
 *       Irreversible. Requires your password. Deletes your personal workspace(s) and everything in
 *       them (projects, blueprints, discovery, comments, decisions…). Content you authored in SHARED
 *       workspaces is kept but reassigned to a "Deleted User" placeholder so teammates' threads and
 *       history stay intact. If you are the SOLE owner of a shared workspace that still has other
 *       members, deletion is blocked (400) until you transfer ownership or remove them. All your
 *       sessions are revoked.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, description: "Your current password, to confirm" }
 *     responses:
 *       204: { description: "Account deleted" }
 *       400:
 *         description: Validation failed, or you are the sole owner of a shared workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Missing/invalid token, or wrong password
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
settingsRouter.delete('/account', validateBody(deleteAccountSchema), settingsController.deleteAccount);

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
