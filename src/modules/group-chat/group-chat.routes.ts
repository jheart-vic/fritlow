import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as controller from './group-chat.controller';
import {
  createChannelSchema,
  postGroupMessageSchema,
  updateChannelSchema,
} from './group-chat.schemas';

// Mounted at /api/v1/workspaces/:workspaceId/channels (mergeParams).
export const groupChatRouter = Router({ mergeParams: true });

groupChatRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/channels:
 *   post:
 *     tags: [Group Chat]
 *     summary: Create a channel
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [name], properties: { name: { type: string, maxLength: 80 }, description: { type: string, maxLength: 500 } } }
 *     responses:
 *       201: { description: "{ channel }" }
 *       403: { description: Not a workspace member, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: A channel with that name already exists in this workspace, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *   get:
 *     tags: [Group Chat]
 *     summary: List channels in the workspace (with per-member hasUnread)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ channels }" }
 */
groupChatRouter.post('/', validateBody(createChannelSchema), controller.createChannel);
groupChatRouter.get('/', controller.listChannels);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/channels/{channelId}:
 *   patch:
 *     tags: [Group Chat]
 *     summary: Rename / edit a channel (creator or workspace OWNER/ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: channelId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { name: { type: string, maxLength: 80 }, description: { type: string, maxLength: 500 } } }
 *     responses:
 *       200: { description: "{ channel }" }
 *       403: { description: Not allowed, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: A channel with that name already exists in this workspace, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *   delete:
 *     tags: [Group Chat]
 *     summary: Delete a channel (creator or workspace OWNER/ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: channelId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 *       403: { description: Not allowed, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
groupChatRouter.patch('/:channelId', validateBody(updateChannelSchema), controller.updateChannel);
groupChatRouter.delete('/:channelId', controller.deleteChannel);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/channels/{channelId}/messages:
 *   get:
 *     tags: [Group Chat]
 *     summary: List channel messages (oldest→newest; marks the channel read)
 *     description: Paginate older messages with `before` (ISO timestamp of the oldest message you have).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: channelId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: before, schema: { type: string, format: date-time } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 30 } }
 *     responses:
 *       200: { description: "{ messages }" }
 *   post:
 *     tags: [Group Chat]
 *     summary: Post a message (broadcast over Socket.io; @mentions notify)
 *     description: >-
 *       Persists the message, pushes `message:new` to everyone in the channel's Socket.io room, and
 *       sends a GROUP_MENTION notification to each id in `mentions`. Clients receive live messages via
 *       the socket; this REST call is the write path.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: channelId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [body], properties: { body: { type: string, maxLength: 5000 }, mentions: { type: array, items: { type: string, format: uuid } } } }
 *     responses:
 *       201: { description: "{ message }" }
 *       403: { description: Not a member, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Channel not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
groupChatRouter.get('/:channelId/messages', controller.listMessages);
groupChatRouter.post('/:channelId/messages', validateBody(postGroupMessageSchema), controller.postMessage);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/channels/{channelId}/read:
 *   post:
 *     tags: [Group Chat]
 *     summary: Mark a channel read (clears its unread badge)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: channelId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Marked read }
 */
groupChatRouter.post('/:channelId/read', controller.markRead);
