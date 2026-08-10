import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as chatController from './chat.controller';

// Mounted at /api/v1/projects/:projectId/chat (mergeParams for projectId).
export const chatRouter = Router({ mergeParams: true });

chatRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/chat:
 *   post:
 *     tags: [AI Chat]
 *     summary: Send a message to the project AI assistant (SSE stream)
 *     description: >-
 *       Streams the reply as Server-Sent Events: `delta` events carry text chunks, then one `done`
 *       event with `{ conversationId, userMessage, assistantMessage }`, or an `error` event. Omit
 *       `conversationId` to start a new conversation. Consume with fetch + ReadableStream (EventSource
 *       can't send the Authorization header).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 5000 }
 *               conversationId: { type: string, format: uuid, description: "Omit to start a new conversation" }
 *     responses:
 *       200: { description: "text/event-stream of delta* then done|error" }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
chatRouter.post('/', chatController.sendMessage);

/**
 * @openapi
 * /api/v1/projects/{projectId}/chat/conversations:
 *   get:
 *     tags: [AI Chat]
 *     summary: List my chat conversations for this project (newest first)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ conversations }" }
 */
chatRouter.get('/conversations', chatController.listConversations);

/**
 * @openapi
 * /api/v1/projects/{projectId}/chat/conversations/{id}:
 *   get:
 *     tags: [AI Chat]
 *     summary: Get one conversation with its messages
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ conversation }" }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *   delete:
 *     tags: [AI Chat]
 *     summary: Delete a conversation (and its messages)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
chatRouter.get('/conversations/:id', chatController.getConversation);
chatRouter.delete('/conversations/:id', chatController.deleteConversation);
