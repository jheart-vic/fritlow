import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as commentController from './comment.controller';
import { createCommentSchema } from './comment.schemas';

// Two routers because the spec puts create/list under the section but DELETE at
// a flat top-level path:
//   POST/GET  /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}/comments
//   DELETE    /api/v1/comments/{id}
// mergeParams on the section router lets it read projectId + sectionKey from the
// mount path.
export const commentSectionRouter = Router({ mergeParams: true });
export const commentRouter = Router();

commentSectionRouter.use(requireAuth);
commentRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}/comments:
 *   post:
 *     tags: [Comments]
 *     summary: Add a comment to a blueprint section
 *     description: Any project member may comment. Pass `parentId` to reply within a thread (the parent must be on the same section).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: sectionKey
 *         required: true
 *         schema: { type: string, example: business_model }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string, maxLength: 5000, example: "This audience feels too broad — can we narrow it?" }
 *               parentId: { type: string, format: uuid, description: "Reply target; omit for a top-level comment" }
 *     responses:
 *       201:
 *         description: Comment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comment: { $ref: '#/components/schemas/Comment' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404:
 *         description: Section or parent comment not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Comments]
 *     summary: List a section's comments as threads (oldest first)
 *     description: Returns top-level comments, each with nested `replies` built from `parentId`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: sectionKey
 *         required: true
 *         schema: { type: string, example: business_model }
 *     responses:
 *       200:
 *         description: Threaded comments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comments:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Comment' }
 *       404:
 *         description: Section not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
commentSectionRouter.post('/', validateBody(createCommentSchema), commentController.create);
commentSectionRouter.get('/', commentController.list);

/**
 * @openapi
 * /api/v1/comments/{id}:
 *   delete:
 *     tags: [Comments]
 *     summary: Delete a comment (author, or workspace OWNER/ADMIN)
 *     description: Deleting a thread's parent cascades to its replies.
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
 *         description: Not allowed to delete this comment
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Comment not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
commentRouter.delete('/:id', commentController.remove);
