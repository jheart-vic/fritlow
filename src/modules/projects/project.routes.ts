import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as projectController from './project.controller';
import { createProjectSchema, updateProjectSchema } from './project.schemas';

export const projectRouter = Router();

// Every project route requires a logged-in user.
projectRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects:
 *   post:
 *     tags: [Projects]
 *     summary: Create a project (the create-project wizard)
 *     description: Creates the project in your personal workspace unless workspaceId is provided. New projects start in DRAFT status.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, oneLineIdea]
 *             properties:
 *               name: { type: string, maxLength: 100, example: "Fritlow" }
 *               oneLineIdea: { type: string, maxLength: 300, example: "An AI product OS that turns one-line ideas into build-ready blueprints" }
 *               category: { type: string, maxLength: 60, example: "SaaS" }
 *               workspaceId: { type: string, format: uuid, description: "Defaults to your personal workspace" }
 *     responses:
 *       201:
 *         description: Project created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project: { $ref: '#/components/schemas/Project' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403:
 *         description: Not a member of the target workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Projects]
 *     summary: List projects you can access
 *     description: Returns projects from every workspace you belong to, most recently updated first.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [DRAFT, DISCOVERY, BLUEPRINT_COMPLETE, LAUNCHED] }
 *         description: Filter by lifecycle status
 *     responses:
 *       200:
 *         description: Projects list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projects:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Project' }
 */
projectRouter.post('/', validateBody(createProjectSchema), projectController.create);
projectRouter.get('/', projectController.list);

/**
 * @openapi
 * /api/v1/projects/{id}:
 *   get:
 *     tags: [Projects]
 *     summary: Get one project
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The project
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project: { $ref: '#/components/schemas/Project' }
 *       403:
 *         description: Not a member of the project's workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   patch:
 *     tags: [Projects]
 *     summary: Update a project (name, idea, category, status)
 *     description: Partial update — send only the fields you want to change.
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *               name: { type: string, maxLength: 100 }
 *               oneLineIdea: { type: string, maxLength: 300 }
 *               category: { type: string, maxLength: 60, nullable: true }
 *               status: { type: string, enum: [DRAFT, DISCOVERY, BLUEPRINT_COMPLETE, LAUNCHED] }
 *     responses:
 *       200:
 *         description: Updated project
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project: { $ref: '#/components/schemas/Project' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403:
 *         description: Not a member of the project's workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Projects]
 *     summary: Delete a project (workspace OWNER/ADMIN only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: "Deleted" }
 *       403:
 *         description: Requires OWNER or ADMIN role
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
projectRouter.get('/:id', projectController.getOne);
projectRouter.patch('/:id', validateBody(updateProjectSchema), projectController.update);
projectRouter.delete('/:id', projectController.remove);
