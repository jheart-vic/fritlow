import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as healthController from './health.controller';

export const healthScoreRouter = Router({ mergeParams: true });

healthScoreRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/health-score:
 *   post:
 *     tags: [Health Score]
 *     summary: Compute (or refresh) the Product Health Score
 *     description: The AI grades the discovery answers across five dimensions (problem clarity, target audience, business model, differentiation, MVP focus) with honest feedback. Overall = average of dimension scores. Needs at least 3 answered questions and an AI-configured server.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The computed score (stored — re-POST to refresh)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 healthScore: { $ref: '#/components/schemas/HealthScore' }
 *       400:
 *         description: Fewer than 3 discovery answers
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       502:
 *         description: AI provider error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       503:
 *         description: AI not configured
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Health Score]
 *     summary: Get the stored health score
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The score
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 healthScore: { $ref: '#/components/schemas/HealthScore' }
 *       404:
 *         description: Not computed yet
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
healthScoreRouter.post('/', healthController.compute);
healthScoreRouter.get('/', healthController.get);
