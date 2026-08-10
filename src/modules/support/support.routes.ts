import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePlatformRole } from '../../middleware/platform-role';
import { validateBody } from '../../middleware/validate';
import * as supportController from './support.controller';
import {
  postMessageSchema,
  startConversationSchema,
  updateConversationSchema,
} from './support.schemas';

// User-facing: /api/v1/support  (any authenticated user)
export const supportRouter = Router();
// Staff-facing: /api/v1/admin/support  (SUPPORT or SUPERADMIN)
export const supportAdminRouter = Router();

supportRouter.use(requireAuth);
supportAdminRouter.use(requireAuth);
supportAdminRouter.use(requirePlatformRole('SUPERADMIN', 'SUPPORT'));

/**
 * @openapi
 * /api/v1/support/conversations:
 *   post:
 *     tags: [Support]
 *     summary: Start a support conversation
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               subject: { type: string, maxLength: 200 }
 *               message: { type: string, maxLength: 5000 }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { conversation: { $ref: '#/components/schemas/SupportConversation' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *   get:
 *     tags: [Support]
 *     summary: List my support conversations (newest activity first)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: My conversations
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { conversations: { type: array, items: { $ref: '#/components/schemas/SupportConversation' } } } }
 */
supportRouter.post(
  '/conversations',
  validateBody(startConversationSchema),
  supportController.startConversation,
);
supportRouter.get('/conversations', supportController.listMine);

/**
 * @openapi
 * /api/v1/support/conversations/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Get my conversation with its messages (marks it read)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Conversation + messages
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { conversation: { $ref: '#/components/schemas/SupportConversationDetail' } } }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
supportRouter.get('/conversations/:id', supportController.getMine);

/**
 * @openapi
 * /api/v1/support/conversations/{id}/messages:
 *   post:
 *     tags: [Support]
 *     summary: Reply in my conversation (reopens it if closed)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [body], properties: { body: { type: string, maxLength: 5000 } } }
 *     responses:
 *       201:
 *         description: Message posted
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { message: { $ref: '#/components/schemas/SupportMessage' } } }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
supportRouter.post(
  '/conversations/:id/messages',
  validateBody(postMessageSchema),
  supportController.postMyMessage,
);

/**
 * @openapi
 * /api/v1/admin/support/conversations:
 *   get:
 *     tags: [Support]
 *     summary: Staff inbox — all conversations (paginated)
 *     description: Requires platformRole SUPPORT or SUPERADMIN.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [OPEN, CLOSED] } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200:
 *         description: Conversations (each includes the customer)
 *       403: { description: Not staff, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
supportAdminRouter.get('/conversations', supportController.listAll);

/**
 * @openapi
 * /api/v1/admin/support/conversations/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Staff view of a conversation + messages (marks it read for staff)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Conversation + messages }
 *       403: { description: Not staff, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *   patch:
 *     tags: [Support]
 *     summary: Staff updates conversation status (OPEN/CLOSED)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [status], properties: { status: { type: string, enum: [OPEN, CLOSED] } } }
 *     responses:
 *       200: { description: Updated conversation }
 *       403: { description: Not staff, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
supportAdminRouter.get('/conversations/:id', supportController.getAsStaff);
supportAdminRouter.patch(
  '/conversations/:id',
  validateBody(updateConversationSchema),
  supportController.updateConversation,
);

/**
 * @openapi
 * /api/v1/admin/support/conversations/{id}/messages:
 *   post:
 *     tags: [Support]
 *     summary: Staff replies in a conversation (claims it if unassigned)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [body], properties: { body: { type: string, maxLength: 5000 } } }
 *     responses:
 *       201: { description: Message posted }
 *       403: { description: Not staff, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
supportAdminRouter.post(
  '/conversations/:id/messages',
  validateBody(postMessageSchema),
  supportController.postStaffMessage,
);
