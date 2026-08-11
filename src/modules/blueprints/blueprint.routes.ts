import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as blueprintController from './blueprint.controller';
import { updateSectionSchema } from './blueprint.schemas';

export const blueprintRouter = Router({ mergeParams: true });

blueprintRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint:
 *   post:
 *     tags: [Blueprint]
 *     summary: Generate the blueprint from the completed discovery interview
 *     description: One AI call turns the full interview transcript (follow-ups included) into the eight-section Living Blueprint and moves the project to BLUEPRINT_COMPLETE. Requires a COMPLETED discovery session and an AI-configured server.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Blueprint generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 blueprint: { $ref: '#/components/schemas/Blueprint' }
 *       400:
 *         description: Discovery not completed yet
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Blueprint already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       502:
 *         description: AI provider error or unparseable output
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       503:
 *         description: AI not configured on this server
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Blueprint]
 *     summary: Get the blueprint with all sections
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The blueprint
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 blueprint: { $ref: '#/components/schemas/Blueprint' }
 *       404:
 *         description: No blueprint yet
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
blueprintRouter.post('/', blueprintController.generate);
blueprintRouter.get('/', blueprintController.get);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint/stream:
 *   post:
 *     tags: [Blueprint]
 *     summary: Generate the blueprint with live progress (Server-Sent Events)
 *     description: >
 *       Same behavior as POST /blueprint but the response is text/event-stream. Event types:
 *       `delta` — raw text chunks as the AI writes (the underlying model streams ONE JSON object,
 *       so these chunks are partial JSON, not headed markdown — do not parse them for structure);
 *       `section` — per-section progress `{ key, title, status }` where status is `writing` then
 *       `complete`, in section order, derived server-side so the UI can drive a section checklist
 *       WITHOUT parsing the stream; `done` — one final event with the persisted blueprint; `error`
 *       — on failure. The 8 section keys/titles are fixed (see the Blueprint response schema).
 *       Consume with fetch + ReadableStream (EventSource can't send the Authorization header).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: SSE stream (delta* -> done | error)
 *         content:
 *           text/event-stream: { schema: { type: string } }
 */
blueprintRouter.post('/stream', blueprintController.generateStream);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}:
 *   patch:
 *     tags: [Blueprint]
 *     summary: Edit one blueprint section (the "Living" part)
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
 *         schema: { type: string, example: "mvp_scope" }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [markdown]
 *             properties:
 *               markdown: { type: string, maxLength: 50000 }
 *     responses:
 *       200:
 *         description: Updated section
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 section: { $ref: '#/components/schemas/BlueprintSection' }
 *       404:
 *         description: No blueprint, or unknown section key
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
blueprintRouter.patch(
  '/sections/:sectionKey',
  validateBody(updateSectionSchema),
  blueprintController.updateSection,
);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}/versions:
 *   get:
 *     tags: [Blueprint]
 *     summary: List a section's edit history (newest first)
 *     description: Each entry is the section's content as it was BEFORE an edit (or restore) replaced it, with who made that edit and when. Empty until the section has been edited at least once.
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
 *         schema: { type: string, example: "mvp_scope" }
 *     responses:
 *       200:
 *         description: Version history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 versions:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/BlueprintSectionVersion' }
 *       404:
 *         description: No blueprint, or unknown section key
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
blueprintRouter.get('/sections/:sectionKey/versions', blueprintController.listSectionVersions);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}/versions/{versionId}/restore:
 *   post:
 *     tags: [Blueprint]
 *     summary: Restore a section to a prior version
 *     description: Rolls the section's content back to the chosen version. Non-destructive — the current content is first snapshotted as a new version, so forward history is never lost. Returns the updated section.
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
 *         schema: { type: string, example: "mvp_scope" }
 *       - in: path
 *         name: versionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The section after restore
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 section: { $ref: '#/components/schemas/BlueprintSection' }
 *       404:
 *         description: No blueprint, unknown section key, or version not found for this section
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
blueprintRouter.post(
  '/sections/:sectionKey/versions/:versionId/restore',
  blueprintController.restoreSectionVersion,
);

/**
 * @openapi
 * /api/v1/projects/{projectId}/blueprint/sections/{sectionKey}/impact-analysis:
 *   post:
 *     tags: [Blueprint]
 *     summary: Analyze which other sections an edit may have affected
 *     description: "Dynamic Impact Analysis — the AI compares this section's current content against the rest of the blueprint and returns the other sections that may now be inconsistent, with a one-line reason each. On-demand (call it after saving a section); not part of the PATCH response, so saves stay fast. An empty list means nothing else looks affected."
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
 *         schema: { type: string, example: "business_model" }
 *     responses:
 *       200:
 *         description: Impact analysis result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 impactAnalysis:
 *                   type: object
 *                   properties:
 *                     affectedSections:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           sectionKey: { type: string, example: "success_metrics" }
 *                           reason: { type: string, example: "Pricing changed, so the revenue target here no longer matches." }
 *                     generatedAt: { type: string, format: date-time }
 *       404:
 *         description: No blueprint, or unknown section key
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       502:
 *         description: AI provider error or unparseable output
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       503:
 *         description: AI not configured
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
blueprintRouter.post(
  '/sections/:sectionKey/impact-analysis',
  blueprintController.analyzeSectionImpact,
);
