import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as recommendationController from './recommendation.controller';
import { updateRecommendationSchema } from './recommendation.schemas';

export const recommendationRouter = Router({ mergeParams: true });

recommendationRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/recommendations:
 *   post:
 *     tags: [Recommendations]
 *     summary: Generate AI Product Strategist recommendations
 *     description: The AI reads the project's discovery answers (plus the blueprint and health score when they exist) and produces 3–6 prioritized, actionable recommendations. Regenerating replaces the PENDING batch but keeps any you've already ACCEPTED/REJECTED. Needs at least 3 answered discovery questions and an AI-configured server.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Recommendations generated (returns the full current list)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recommendations:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Recommendation' }
 *       400:
 *         description: Fewer than 3 discovery answers
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       502:
 *         description: AI provider error or unparseable output
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       503:
 *         description: AI not configured
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Recommendations]
 *     summary: List recommendations (HIGH severity first)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, ACCEPTED, REJECTED] }
 *         description: Filter by lifecycle status
 *     responses:
 *       200:
 *         description: Recommendations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recommendations:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Recommendation' }
 */
recommendationRouter.post('/', recommendationController.generate);
recommendationRouter.get('/', recommendationController.list);

/**
 * @openapi
 * /api/v1/projects/{projectId}/recommendations/{id}:
 *   patch:
 *     tags: [Recommendations]
 *     summary: Accept or reject a recommendation
 *     description: Moves a recommendation out of PENDING. ACCEPTED = you agree / will act on it; REJECTED = not relevant. This is the accept/reject the product tracks.
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ACCEPTED, REJECTED] }
 *     responses:
 *       200:
 *         description: Updated recommendation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recommendation: { $ref: '#/components/schemas/Recommendation' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404:
 *         description: Recommendation not found in this project
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
recommendationRouter.patch('/:id', validateBody(updateRecommendationSchema), recommendationController.update);
