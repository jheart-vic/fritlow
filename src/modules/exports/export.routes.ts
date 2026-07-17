import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as exportController from './export.controller';

export const exportRouter = Router({ mergeParams: true });

exportRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/export:
 *   get:
 *     tags: [Export]
 *     summary: Download the blueprint as PDF, DOCX, or Markdown
 *     description: Generates the file on the fly and records the export. Requires an existing blueprint.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: format
 *         required: true
 *         schema: { type: string, enum: [pdf, docx, markdown] }
 *     responses:
 *       200:
 *         description: The file (Content-Disposition attachment)
 *         content:
 *           application/pdf: { schema: { type: string, format: binary } }
 *           application/vnd.openxmlformats-officedocument.wordprocessingml.document: { schema: { type: string, format: binary } }
 *           text/markdown: { schema: { type: string } }
 *       400:
 *         description: Invalid format
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No blueprint to export yet
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
exportRouter.get('/', exportController.exportBlueprint);
