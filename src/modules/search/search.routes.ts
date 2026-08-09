import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as searchController from './search.controller';

export const searchRouter = Router();

searchRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/search:
 *   get:
 *     tags: [Search]
 *     summary: Search across your projects, blueprints, decisions and recommendations
 *     description: >-
 *       Case-insensitive substring search over the caller's "source of truth" content,
 *       scoped to workspaces they belong to. Matches project name/idea/category, blueprint
 *       section titles and body, decision titles/reasoning, and recommendation titles/body.
 *       Returns a flat, typed result list plus per-type counts. `limit` caps results PER type.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 2, maxLength: 200 }
 *         description: Search term (min 2 characters)
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *         description: Max results per type
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SearchResults' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401:
 *         description: Missing/invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
searchRouter.get('/', searchController.search);
