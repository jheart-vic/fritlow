import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as blueprintController from './blueprint.controller';
import { updateSectionSchema } from './blueprint.schemas';

export const blueprintRouter = Router({ mergeParams: true });

blueprintRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint:
 *   post:
 *     tags: [Blueprint]
 *     summary: Generate the blueprint from the completed discovery interview
 *     description: One AI call turns the full interview transcript (follow-ups included) into the eight-section Living Blueprint and moves the project to BLUEPRINT_COMPLETE. Requires a COMPLETED discovery session and an AI-configured server.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Blueprint generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 blueprint: { $ref: '#/components/schemas/Blueprint' }
 *       400:
 *         description: Discovery not completed yet
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Blueprint already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       502:
 *         description: AI provider error or unparseable output
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       503:
 *         description: AI not configured on this server
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Blueprint]
 *     summary: Get the blueprint with all sections
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The blueprint
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 blueprint: { $ref: '#/components/schemas/Blueprint' }
 *       404:
 *         description: No blueprint yet
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
blueprintRouter.post('/', blueprintController.generate);
blueprintRouter.get('/', blueprintController.get);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint/stream:
 *   post:
 *     tags: [Blueprint]
 *     summary: Generate the blueprint with live progress (Server-Sent Events)
 *     description: "Same behavior as POST /blueprint but the response is text/event-stream: `delta` events carry text chunks as the AI writes, then one `done` event with the persisted blueprint (or an `error` event). Consume with fetch + ReadableStream (EventSource can't send the Authorization header)."
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: SSE stream (delta* -> done | error)
 *         content:
 *           text/event-stream: { schema: { type: string } }
 */
blueprintRouter.post('/stream', blueprintController.generateStream);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}:
 *   patch:
 *     tags: [Blueprint]
 *     summary: Edit one blueprint section (the "Living" part)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: sectionKey
 *         required: true
 *         schema: { type: string, example: "mvp_scope" }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [markdown]
 *             properties:
 *               markdown: { type: string, maxLength: 50000 }
 *     responses:
 *       200:
 *         description: Updated section
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 section: { $ref: '#/components/schemas/BlueprintSection' }
 *       404:
 *         description: No blueprint, or unknown section key
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
blueprintRouter.patch(
  '/sections/:sectionKey',
  validateBody(updateSectionSchema),
  blueprintController.updateSection,
);
