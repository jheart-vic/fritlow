import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as discoveryController from './discovery.controller';
import { submitAnswerSchema } from './discovery.schemas';

// mergeParams lets this router read :projectId from its mount path.
export const discoveryRouter = Router({ mergeParams: true });

discoveryRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/discovery:
 *   post:
 *     tags: [Discovery]
 *     summary: Start the discovery interview for a project
 *     description: Creates the session and moves the project to DISCOVERY status. One session per project.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Session started; includes the first question
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DiscoveryProgress' }
 *       409:
 *         description: Project already has a session
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Discovery]
 *     summary: Get the session, all answers so far, and the next question
 *     description: The "resume where you left off" endpoint — drives the interview screen and the dashboard.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Session with progress
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DiscoveryProgress' }
 *       404:
 *         description: No session yet
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
discoveryRouter.post('/', discoveryController.start);
discoveryRouter.get('/', discoveryController.get);

/**
 * @openapi
 * /api/v1/projects/{projectId}/discovery/answers:
 *   post:
 *     tags: [Discovery]
 *     summary: Submit (or revise) an answer
 *     description: Answering the same questionId again replaces the previous answer. Returns updated progress and the next unanswered question.
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
 *             required: [questionId, answer]
 *             properties:
 *               questionId: { type: string, example: "problem.core" }
 *               answer: { type: string, maxLength: 5000 }
 *     responses:
 *       200:
 *         description: Updated progress
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DiscoveryProgress' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
discoveryRouter.post('/answers', validateBody(submitAnswerSchema), discoveryController.answer);

/**
 * @openapi
 * /api/v1/projects/{projectId}/discovery/complete:
 *   post:
 *     tags: [Discovery]
 *     summary: Complete the interview
 *     description: Only allowed once every anchor question has an answer. Marks the session COMPLETED.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Session completed
 *       400:
 *         description: Unanswered questions remain (or session already closed)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
discoveryRouter.post('/complete', discoveryController.complete);
