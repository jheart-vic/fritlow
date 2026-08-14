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
 *     description: >-
 *       Projects ordered by recent activity, each with discovery progress and its own next
 *       action.
 *
 *
 *       This spans **every workspace the caller belongs to**, so label each card with its
 *       `workspace.name` — a collaborator in four workspaces otherwise sees their own drafts
 *       and four clients' projects in one undifferentiated list. Pass `workspaceId` to narrow
 *       to a single workspace.
 *
 *
 *       The top-level `nextAction` is the "continue where you left off" recommendation. It
 *       prefers the caller's most recently touched **own** project (`isMine`), falling back to
 *       plain recency when they have none — otherwise someone who just joined a busy workspace
 *       gets told to continue a teammate's interview.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: workspaceId
 *         required: false
 *         schema: { type: string, format: uuid }
 *         description: Narrow the dashboard to one workspace.
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
 *                       workspace:
 *                         type: object
 *                         description: Which workspace this project lives in — label the card with it.
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                           isPrivate: { type: boolean }
 *                       isMine:
 *                         type: boolean
 *                         description: The caller created this project (drives the headline nextAction).
 */
dashboardRouter.get('/', dashboardController.get);
