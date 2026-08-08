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
 *     summary: Submit (or revise) an answer, or reply to a follow-up
 *     description: >
 *       Answering the same questionId again replaces the previous answer.
 *       To reply to an AI follow-up, send `followUpAnswer` on THIS same endpoint,
 *       alongside `answer` (which stays required — resend it). The reply is only
 *       stored if a follow-up was already generated for this question (via
 *       POST /answers/{questionId}/follow-up); otherwise `followUpAnswer` is ignored.
 *       Read the stored follow-up (question + reply) back from GET /discovery at
 *       `session.answers[].answer.followUp`.
 *       Returns progress only — NOT wrapped in `session` (unlike start/get).
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
 *               answer: { type: string, maxLength: 5000, description: "The main answer. Required even when only replying to a follow-up." }
 *               followUpAnswer: { type: string, maxLength: 5000, description: "Reply to the AI follow-up on this question. Requires a follow-up to have been generated first, else ignored." }
 *     responses:
 *       200:
 *         description: Updated progress (no `session` wrapper)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answered: { type: integer, example: 4 }
 *                 total: { type: integer, example: 10 }
 *                 nextQuestion:
 *                   type: object
 *                   nullable: true
 *                   description: null once every anchor question is answered
 *                   properties:
 *                     id: { type: string, example: "customer.who" }
 *                     module: { type: string, example: "customer" }
 *                     text: { type: string }
 *                     hint: { type: string }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
discoveryRouter.post('/answers', validateBody(submitAnswerSchema), discoveryController.answer);

/**
 * @openapi
 * /api/v1/projects/{projectId}/discovery/answers/{questionId}/follow-up:
 *   post:
 *     tags: [Discovery]
 *     summary: Generate an AI follow-up question for an answered question
 *     description: >
 *       The AI reads the founder's answer in the project's context and asks one sharper
 *       follow-up (gentle Challenge Mode). Full round-trip:
 *       (1) POST /answers to answer the question;
 *       (2) POST this endpoint to generate the follow-up — it returns `{ questionId, followUp }`
 *       and stores it on the answer as `followUp: { question, answer: null }`;
 *       (3) POST /answers again with `followUpAnswer` (and `answer`) to store the reply.
 *       Read it back from GET /discovery at `session.answers[].answer.followUp`.
 *       Generating again REPLACES any existing follow-up (and clears its stored reply).
 *       Requires the server to have an AI provider key configured.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: questionId
 *         required: true
 *         schema: { type: string, example: "customer.who" }
 *     responses:
 *       200:
 *         description: The generated follow-up question
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 questionId: { type: string }
 *                 followUp: { type: string, example: "You said your audience is 'founders' — which specific kind of founder would pay for this in month one?" }
 *       400:
 *         description: Question not answered yet, unknown questionId, or session closed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       503:
 *         description: AI not configured on this server
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
discoveryRouter.post('/answers/:questionId/follow-up', discoveryController.followUp);

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
