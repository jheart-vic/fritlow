import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as notificationController from './notification.controller';

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List my notifications (newest first) with an unread count
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: unread, schema: { type: boolean }, description: "true → only unread" }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200:
 *         description: Notifications + unreadCount
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 total: { type: integer }
 *                 totalPages: { type: integer }
 *                 unreadCount: { type: integer }
 *                 notifications:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Notification' }
 */
notificationRouter.get('/', notificationController.list);

/**
 * @openapi
 * /api/v1/notifications/read-all:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark all my notifications read
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: How many were marked read
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { updated: { type: integer } } }
 */
notificationRouter.post('/read-all', notificationController.readAll);

/**
 * @openapi
 * /api/v1/notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark one notification read (idempotent)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: The notification
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { notification: { $ref: '#/components/schemas/Notification' } } }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
notificationRouter.patch('/:id/read', notificationController.markRead);

/**
 * @openapi
 * /api/v1/notifications/{id}:
 *   delete:
 *     tags: [Notifications]
 *     summary: Delete one notification
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
notificationRouter.delete('/:id', notificationController.remove);
