import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as decisionController from './decision.controller';
import { createDecisionSchema, updateDecisionSchema } from './decision.schemas';

export const decisionRouter = Router({ mergeParams: true });

decisionRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/decisions:
 *   post:
 *     tags: [Decisions]
 *     summary: Record a product decision with its reasoning
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, reasoning]
 *             properties:
 *               title: { type: string, maxLength: 200, example: "Use Stripe for payments" }
 *               reasoning: { type: string, maxLength: 5000, example: "Fastest integration; fees acceptable at MVP volume." }
 *     responses:
 *       201:
 *         description: Decision recorded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 decision: { $ref: '#/components/schemas/Decision' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *   get:
 *     tags: [Decisions]
 *     summary: List the project's decision log (newest first)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Decisions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 decisions:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Decision' }
 */
decisionRouter.post('/', validateBody(createDecisionSchema), decisionController.create);
decisionRouter.get('/', decisionController.list);

/**
 * @openapi
 * /api/v1/projects/{projectId}/decisions/{id}:
 *   patch:
 *     tags: [Decisions]
 *     summary: Update a decision (title, reasoning, or status)
 *     description: Status lifecycle — ACTIVE (in force), REVISED (changed but descendant of this), REVERSED (no longer true).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string, maxLength: 200 }
 *               reasoning: { type: string, maxLength: 5000 }
 *               status: { type: string, enum: [ACTIVE, REVISED, REVERSED] }
 *     responses:
 *       200:
 *         description: Updated decision
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 decision: { $ref: '#/components/schemas/Decision' }
 *       404:
 *         description: Decision not found in this project
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Decisions]
 *     summary: Delete a decision
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: "Deleted" }
 *       404:
 *         description: Decision not found in this project
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
decisionRouter.patch('/:id', validateBody(updateDecisionSchema), decisionController.update);
decisionRouter.delete('/:id', decisionController.remove);
