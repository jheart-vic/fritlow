import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as projectController from './project.controller';
import { createProjectSchema, moveProjectsSchema, updateProjectSchema } from './project.schemas';

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
 *     description: >
 *       Returns projects from every workspace you belong to, most recently updated first.
 *       Pass `workspaceId` to scope the list to one workspace (for a workspace switcher) —
 *       each project also carries its own `workspaceId` if you'd rather group client-side.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [DRAFT, DISCOVERY, BLUEPRINT_COMPLETE, LAUNCHED] }
 *         description: Filter by lifecycle status
 *       - in: query
 *         name: workspaceId
 *         schema: { type: string, format: uuid }
 *         description: >
 *           Only projects in this workspace. Omit for all workspaces you belong to.
 *           403 if you are not a member of it (rather than an empty list, which would
 *           look like the workspace is empty).
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
 * /api/v1/projects/move:
 *   post:
 *     tags: [Projects]
 *     summary: Move several projects into one workspace
 *     description: >-
 *       The precise alternative to converting a whole private workspace to shared: pick the
 *       projects you actually want to collaborate on and move just those. Prefer this in the
 *       UI over `POST /workspaces/{id}/convert-to-shared`, which is all-or-nothing.
 *
 *
 *       Requires OWNER/ADMIN on the destination **and on every source workspace represented in
 *       the selection** — a multi-select naturally spans workspaces, since the dashboard lists
 *       them together, and each source is checked separately.
 *
 *
 *       All-or-nothing: the whole batch shares one transaction, because a half-finished move
 *       would scatter projects across two workspaces with no way to tell which made it. Max 50
 *       per call.
 *
 *
 *       Everyone who loses access is notified once per source workspace, naming the count —
 *       twelve moved projects produce one notification, not twelve. Call
 *       `POST /projects/move-preview` first for the confirmation dialog.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectIds, targetWorkspaceId]
 *             properties:
 *               projectIds:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 50
 *                 items: { type: string, format: uuid }
 *               targetWorkspaceId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Projects moved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 movedCount: { type: integer, example: 4 }
 *                 targetWorkspaceId: { type: string, format: uuid }
 *                 projectIds:
 *                   type: array
 *                   items: { type: string, format: uuid }
 *       400:
 *         description: Validation failed, or a project is already in the destination
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Requires OWNER or ADMIN on the destination and every source workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: One or more project ids do not exist (all missing ids are listed)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
projectRouter.post('/move', validateBody(moveProjectsSchema), projectController.moveMany);

/**
 * @openapi
 * /api/v1/projects/move-preview:
 *   post:
 *     tags: [Projects]
 *     summary: Who a bulk move would affect, before you make it
 *     description: >-
 *       The batch equivalent of `GET /projects/{id}/move-preview`, for the bulk confirmation
 *       dialog. POST rather than GET because the project id list is a body, not a query string.
 *
 *
 *       Counts are deduplicated across source workspaces: someone who belongs to two of them
 *       is one person losing access, not two. The caller is always excluded.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectIds, targetWorkspaceId]
 *             properties:
 *               projectIds:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 50
 *                 items: { type: string, format: uuid }
 *               targetWorkspaceId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: What the move would do
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projectCount: { type: integer }
 *                 from:
 *                   type: array
 *                   description: Every distinct source workspace in the selection.
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                 to:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                 losingAccess:
 *                   type: object
 *                   properties:
 *                     count: { type: integer }
 *                     users:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           fullName: { type: string }
 *                           avatarUrl: { type: string, nullable: true }
 *                 gainingAccess:
 *                   type: object
 *                   properties:
 *                     count: { type: integer }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403:
 *         description: Requires OWNER or ADMIN on the destination and every source workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: One or more project ids do not exist
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
projectRouter.post(
  '/move-preview',
  validateBody(moveProjectsSchema),
  projectController.moveManyPreview,
);

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
 *     summary: Update a project (name, idea, category, status, workspace)
 *     description: >
 *       Partial update — send only the fields you want to change.
 *       Sending `workspaceId` MOVES the project to another workspace, which changes who
 *       can see it: everyone in the destination workspace gains access and everyone in
 *       the source workspace loses it. That requires OWNER or ADMIN on **both** sides
 *       (the same bar as deleting) — 403 otherwise. This is the intended way to take a
 *       project out of your private personal workspace so you can collaborate on it.
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
 *               workspaceId:
 *                 type: string
 *                 format: uuid
 *                 description: >-
 *                   Move the project to this workspace. Requires OWNER/ADMIN on BOTH the
 *                   current and the destination workspace — the source's members lose access
 *                   and the destination's gain it, so it carries the same bar as deleting.
 *                   Everyone who loses access is sent a PROJECT_MOVED notification. Call
 *                   `GET /projects/{id}/move-preview` first to show who that will be.
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

/**
 * @openapi
 * /api/v1/projects/{id}/move-preview:
 *   get:
 *     tags: [Projects]
 *     summary: Who a move would affect, before you make it
 *     description: >-
 *       Answers "what happens if I move this project to that workspace?" so the confirmation
 *       dialog can be specific: **"3 people will lose access to this project."**
 *
 *
 *       Moving is a transfer of audience, not a field edit. Anyone in the source workspace who
 *       is not also in the destination loses sight of the project — people who belong to both
 *       notice nothing and are correctly excluded from the count, as is the caller.
 *
 *
 *       Computed server-side so the number shown and the number acted on cannot drift apart.
 *       `losingAccess.users` is named so the dialog can show faces rather than a bare integer.
 *       Requires the same OWNER/ADMIN-on-both-sides permission as the move itself, so a user
 *       who could not perform the move cannot use this to enumerate a workspace's members.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: The destination workspace.
 *     responses:
 *       200:
 *         description: What the move would do
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                 from:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                 to:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                 losingAccess:
 *                   type: object
 *                   description: People who can see the project now but would not afterwards.
 *                   properties:
 *                     count: { type: integer, example: 3 }
 *                     users:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           fullName: { type: string }
 *                           avatarUrl: { type: string, nullable: true }
 *                 gainingAccess:
 *                   type: object
 *                   properties:
 *                     count: { type: integer, example: 5 }
 *       400:
 *         description: The project is already in that workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Requires OWNER or ADMIN on both workspaces
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
projectRouter.get('/:id/move-preview', projectController.movePreview);
