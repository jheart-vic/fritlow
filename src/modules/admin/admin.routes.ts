import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePlatformRole } from '../../middleware/platform-role';
import * as adminController from './admin.controller';

export const adminRouter = Router();

// Fritlow staff only: authenticated AND platformRole is SUPPORT or SUPERADMIN.
// (End users always have platformRole USER → 403 here. This is entirely
// separate from workspace OWNER/ADMIN/MEMBER, which grant no platform access.)
adminRouter.use(requireAuth);
adminRouter.use(requirePlatformRole('SUPERADMIN', 'SUPPORT'));

/**
 * @openapi
 * /api/v1/admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Platform-wide metrics (Fritlow staff only)
 *     description: Aggregate counts across ALL workspaces — users, projects by status, discovery completion, blueprints, recommendations, exports, plus a 7-day activity proxy. Requires platformRole SUPPORT or ADMIN.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Platform stats
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AdminStats' }
 *       403:
 *         description: Not staff
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminRouter.get('/stats', adminController.stats);

/**
 * @openapi
 * /api/v1/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List/search users (paginated, Fritlow staff only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Search email + full name
 *     responses:
 *       200:
 *         description: Paginated users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 total: { type: integer }
 *                 totalPages: { type: integer }
 *                 users:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AdminUserSummary' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403:
 *         description: Not staff
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminRouter.get('/users', adminController.listUsers);

/**
 * @openapi
 * /api/v1/admin/users/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: One user with their workspaces, projects, and activity (Fritlow staff only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/AdminUserDetail' }
 *       403:
 *         description: Not staff
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
adminRouter.get('/users/:id', adminController.getUser);
