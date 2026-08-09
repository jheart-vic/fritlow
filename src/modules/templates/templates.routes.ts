import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as templateController from './templates.controller';

export const templateRouter = Router();

// Behind auth like the rest of the API — the create-project wizard is a
// logged-in surface.
templateRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/templates:
 *   get:
 *     tags: [Templates]
 *     summary: List project starting-point templates (fixed catalogue)
 *     description: The 7 category templates used by the create-project wizard. Read-only reference data; the user-submitted Templates Marketplace is a later version.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All templates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 templates:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Template' }
 */
templateRouter.get('/', templateController.list);

/**
 * @openapi
 * /api/v1/templates/{id}:
 *   get:
 *     tags: [Templates]
 *     summary: Get one template with its discovery hints
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, example: "saas" }
 *     responses:
 *       200:
 *         description: The template
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 template: { $ref: '#/components/schemas/Template' }
 *       404:
 *         description: Unknown template id
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
templateRouter.get('/:id', templateController.getOne);
