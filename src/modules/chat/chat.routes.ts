import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as chatController from './chat.controller';
import { renameConversationSchema } from './chat.schemas';

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
 *   patch:
 *     tags: [AI Chat]
 *     summary: Rename a conversation
 *     description: >-
 *       Sets the conversation's title — for the "rename chat" action in the conversation
 *       list. Send `title: null` to clear it and fall back to whatever the UI shows for an
 *       untitled chat, which is the way out of a bad rename.
 *
 *
 *       Conversations are per-user within a project, so you can only rename your own.
 *       Someone else's conversation id reads as 404, not 403.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:
 *                 type: string
 *                 nullable: true
 *                 maxLength: 120
 *                 example: "Pricing model options"
 *                 description: New title, or null to clear it.
 *     responses:
 *       200: { description: "{ conversation } — the updated row, without its messages" }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *   delete:
 *     tags: [AI Chat]
 *     summary: Delete a conversation (and its messages)
 *     description: >-
 *       Removes the conversation and every message in it (cascade). Irreversible — there is
 *       no archive or restore, so confirm before calling. Your own conversations only.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
chatRouter.get('/conversations/:id', chatController.getConversation);
chatRouter.patch(
  '/conversations/:id',
  validateBody(renameConversationSchema),
  chatController.renameConversation,
);
chatRouter.delete('/conversations/:id', chatController.deleteConversation);
