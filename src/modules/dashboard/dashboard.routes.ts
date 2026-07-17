import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as dashboardController from './dashboard.controller';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: The control center — projects with progress and one recommended next action
 *     description: Projects ordered by recent activity, each with discovery progress and its own next action. Top-level nextAction is the "continue where you left off" recommendation (from the most recently touched project).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nextAction: { $ref: '#/components/schemas/NextAction' }
 *                 projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                       oneLineIdea: { type: string }
 *                       status: { type: string, enum: [DRAFT, DISCOVERY, BLUEPRINT_COMPLETE, LAUNCHED] }
 *                       updatedAt: { type: string, format: date-time }
 *                       discoveryProgress:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           answered: { type: integer }
 *                           total: { type: integer }
 *                       hasBlueprint: { type: boolean }
 *                       nextAction: { $ref: '#/components/schemas/NextAction' }
 */
dashboardRouter.get('/', dashboardController.get);
