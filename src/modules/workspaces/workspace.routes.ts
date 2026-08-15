import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as workspaceController from './workspace.controller';
import {
  createWorkspaceSchema,
  deleteWorkspaceSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
} from './workspace.schemas';

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/workspaces:
 *   post:
 *     tags: [Workspaces]
 *     summary: Create a workspace (private or shared)
 *     description: >-
 *       Creates a new workspace with you as its OWNER. Everyone also gets one PRIVATE
 *       workspace automatically at registration — this endpoint is for the ones they
 *       create themselves.
 *
 *
 *       `visibility` is the toggle to put in the create dialog. PRIVATE means nobody can
 *       ever be invited (the invite endpoint returns 400) and no team chat channel is
 *       created. SHARED means invite-only collaboration, with a `general` channel. There
 *       is no limit on how many private workspaces a user may own.
 *
 *
 *       `setAsDefault` moves "where new projects land" to this workspace. Setting it on a
 *       SHARED workspace is allowed but consequential — every project created without an
 *       explicit `workspaceId` becomes visible to that whole team — so confirm it in the UI.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 100, example: "Acme Product Team" }
 *               visibility:
 *                 type: string
 *                 enum: [PRIVATE, SHARED]
 *                 default: SHARED
 *                 description: PRIVATE = never invitable, no chat channel. SHARED = invite-only collaboration.
 *               setAsDefault:
 *                 type: boolean
 *                 default: false
 *                 description: Make this the workspace new projects land in when none is named.
 *     responses:
 *       201:
 *         description: Workspace created (you are OWNER)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace: { $ref: '#/components/schemas/WorkspaceMembership' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *   get:
 *     tags: [Workspaces]
 *     summary: List workspaces you belong to (with your role in each)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your workspaces
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspaces:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/WorkspaceMembership' }
 */
workspaceRouter.post('/', validateBody(createWorkspaceSchema), workspaceController.create);
workspaceRouter.get('/', workspaceController.list);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/set-default:
 *   post:
 *     tags: [Workspaces]
 *     summary: Make this the workspace new projects land in
 *     description: >-
 *       Every user has at most one default workspace — it is where `POST /projects` puts a
 *       project when the request names no `workspaceId`. This is a separate fact from
 *       `isPrivate`: a user may own several private workspaces, and exactly one of them
 *       (or a shared one) is the default.
 *
 *
 *       OWNER only. Being a member is not enough — defaulting into a workspace you merely
 *       belong to would publish everything you start to that team, and you would not be
 *       able to undo it yourself.
 *
 *
 *       Pointing the default at a SHARED workspace is permitted, and the response carries a
 *       `warning` string to show the user when that happens. No request body.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Default updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace:
 *                   allOf:
 *                     - $ref: '#/components/schemas/WorkspaceMembership'
 *                     - type: object
 *                       properties:
 *                         warning:
 *                           type: string
 *                           nullable: true
 *                           description: Non-null when the new default is SHARED — show it to the user.
 *       403:
 *         description: You are not the owner of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.post('/:workspaceId/set-default', workspaceController.setDefault);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/delete-preview:
 *   get:
 *     tags: [Workspaces]
 *     summary: What deleting this workspace would destroy
 *     description: >-
 *       Call this before showing the delete dialog so the confirmation can be specific.
 *       Deleting a workspace is **not** "remove it from my list" — it destroys every project
 *       inside it, and each project takes its blueprint, discovery interview, decisions,
 *       comments, exports and uploaded documents with it. There is no undo.
 *
 *
 *       `requiresNewDefault` tells you to collect a replacement default in the same dialog
 *       rather than letting the user discover the requirement in a 400.
 *       `isLastOwnedWorkspace` means the delete will be refused outright — disable the action.
 *
 *
 *       OWNER only, like the delete itself, so this cannot be used to enumerate the members
 *       of a workspace you merely belong to.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: What would be destroyed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                     isPrivate: { type: boolean }
 *                 projectCount:
 *                   type: integer
 *                   example: 12
 *                   description: Projects that would be permanently destroyed, with all their content.
 *                 otherMembers:
 *                   type: object
 *                   description: Everyone else who would lose this workspace and be notified.
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
 *                 isDefault:
 *                   type: boolean
 *                   description: This is where the caller's new projects currently land.
 *                 requiresNewDefault:
 *                   type: boolean
 *                   description: Collect `newDefaultWorkspaceId` in the dialog when true.
 *                 isLastOwnedWorkspace:
 *                   type: boolean
 *                   description: When true the delete is refused — disable the action.
 *       403:
 *         description: Not the owner of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.get('/:workspaceId/delete-preview', workspaceController.deletePreview);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}:
 *   delete:
 *     tags: [Workspaces]
 *     summary: Delete a workspace and everything in it
 *     description: >-
 *       **Irreversible.** Destroys the workspace, every project in it, and everything hanging
 *       off those projects — blueprints, discovery sessions and answers, decision logs,
 *       recommendations, health scores, comments, chat, uploaded documents and exports. There
 *       is no soft delete. Use `GET /workspaces/{id}/delete-preview` to show the user what
 *       they are about to lose.
 *
 *
 *       OWNER only. Three guards apply:
 *
 *
 *       1. **`confirmName` must exactly match the workspace's name.** Case-sensitive. A
 *       boolean confirm would not help — the realistic mistake is deleting the *wrong*
 *       workspace from a list, and only retyping the name proves which one is meant.
 *
 *       2. **You cannot delete the only workspace you own.** You would be left with nowhere
 *       for a new project to go.
 *
 *       3. **If it is your default workspace, `newDefaultWorkspaceId` is required** and must
 *       be another workspace you own. No replacement is chosen for you — silently rehoming
 *       someone's future projects is exactly what the explicit default pointer prevents.
 *
 *
 *       Other members are sent a `WORKSPACE_DELETED` notification after the delete commits;
 *       it is the only record they get, since nothing survives to link to. Any of them whose
 *       default pointed here has it cleared and will be asked to choose.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirmName]
 *             properties:
 *               confirmName:
 *                 type: string
 *                 description: Must exactly match the workspace's name.
 *                 example: "Acme Product Team"
 *               newDefaultWorkspaceId:
 *                 type: string
 *                 format: uuid
 *                 description: Required when deleting your default workspace. Must be another workspace you own.
 *     responses:
 *       204:
 *         description: Workspace and all its contents deleted
 *       400:
 *         description: Name mismatch, only workspace you own, or a missing/invalid replacement default
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not the owner of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.delete(
  '/:workspaceId',
  validateBody(deleteWorkspaceSchema),
  workspaceController.remove,
);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/convert-to-shared:
 *   post:
 *     tags: [Workspaces]
 *     summary: Convert a private workspace into a shared one
 *     description: >-
 *       The deliberate way to say "I want to collaborate on everything already in this
 *       private workspace". Flips `isPrivate` to false so people can be invited to it,
 *       and **creates a fresh, empty private workspace** in the same transaction. If the
 *       converted workspace was your default, the default is repointed at the new one, so
 *       projects you create from now on do not land somewhere your invitees can read.
 *       OWNER only; no request body.
 *
 *
 *       The projects in the converted workspace come with it — that is the point of the
 *       action, so confirm it in the UI first ("N projects will become visible to anyone
 *       you invite"). If you only want to share SOME of them, don't convert: create a
 *       shared workspace and move those projects with `PATCH /projects/{id}` instead.
 *
 *
 *       Also creates a `general` group-chat channel if the workspace has none, matching
 *       what `POST /workspaces` does.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Converted, plus the replacement personal workspace
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace:
 *                   allOf:
 *                     - $ref: '#/components/schemas/WorkspaceMembership'
 *                   description: The now-shared workspace (isPrivate false)
 *                 personalWorkspace:
 *                   allOf:
 *                     - $ref: '#/components/schemas/WorkspaceMembership'
 *                   description: The new empty private workspace — new projects default here
 *       400:
 *         description: The workspace is already shared
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not the owner of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.post('/:workspaceId/convert-to-shared', workspaceController.convertToShared);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/convert-to-private:
 *   post:
 *     tags: [Workspaces]
 *     summary: Close a shared workspace back up
 *     description: >-
 *       The return trip for `convert-to-shared`. Flips `isPrivate` back to true, so nobody can
 *       be invited any more. OWNER only; no request body.
 *
 *
 *       **Allowed only when you are the sole member.** "Private" means nobody else can be in
 *       here, so a private workspace with other members is a contradiction. If anyone else is
 *       still a member the call fails and names them — remove them first. Silently ejecting
 *       people would revoke their access to every project in the workspace with no warning,
 *       which is exactly what the move notifications exist to prevent.
 *
 *
 *       Any invitations still pending are REVOKED in the same transaction, since accepting one
 *       afterwards would put a member inside a private workspace.
 *
 *
 *       Projects stay exactly where they are, and the team chat channel is kept (not deleted) —
 *       its history is real, and converting back to shared later reuses it rather than creating
 *       a second one. Note this is a round trip, not an undo: it does not restore any
 *       membership that existed before.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The workspace is now private
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspace: { $ref: '#/components/schemas/WorkspaceMembership' }
 *       400:
 *         description: Already private, or other members remain (their names are listed)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not the owner of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.post('/:workspaceId/convert-to-private', workspaceController.convertToPrivate);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/members:
 *   get:
 *     tags: [Workspaces]
 *     summary: List a workspace's members
 *     description: Any member of the workspace can view the roster.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 members:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/WorkspaceMember' }
 *       403:
 *         description: Not a member of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.get('/:workspaceId/members', workspaceController.listMembers);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/members/invite:
 *   post:
 *     tags: [Workspaces]
 *     summary: Invite a user to the workspace
 *     description: >-
 *       OWNER/ADMIN only. **Nobody is added to a workspace without accepting.** Every call
 *       records a PENDING invitation and returns `{ pending: true, hasAccount, invitation }` —
 *       membership is created when the invitee accepts, never here.
 *
 *
 *       `hasAccount` says which email copy went out: `true` = an existing user (who will also
 *       see it in `GET /invitations` and get an in-app notification); `false` = an address with
 *       no account yet. OWNER is not grantable here — use the role endpoint.
 *
 *
 *       **Both emails link to the same place: `{APP_URL}/invitations/{token}`.** Build one
 *       landing page there and call `GET /invitations/lookup/{token}` (public, no auth) to
 *       render it — that endpoint documents the full sign-in / sign-up / accept / wrong-account
 *       state machine. The link is deliberately NOT branched on whether the recipient has an
 *       account, because that can change between sending and clicking.
 *
 *
 *       Re-inviting the same email re-arms the existing invitation: the role is updated, any
 *       DECLINED/REVOKED/EXPIRED state clears back to PENDING, and a **new token is issued**,
 *       which invalidates the link in the previous email. Invitations expire after 14 days.
 *
 *
 *       **Private workspaces cannot be invited into (400).** Membership is workspace-wide, so an
 *       invite there would hand over every project in it at once. Move the projects you want to
 *       collaborate on into a shared workspace with `PATCH /projects/{id}` (`workspaceId`) and
 *       invite there, or convert the workspace deliberately.
 *
 *
 *       The response includes **`sharedProjectCount`** — how many projects the invitee will be
 *       able to see, because membership is workspace-wide, not per project. Show it on the
 *       confirm step ("Ada will be able to see all 12 projects in this workspace").
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *               role: { type: string, enum: [ADMIN, MEMBER], default: MEMBER }
 *     responses:
 *       201:
 *         description: Invitation recorded and emailed. No membership exists until they accept.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pending:
 *                   type: boolean
 *                   example: true
 *                   description: Always true. Kept so existing clients keep parsing; use hasAccount to branch.
 *                 hasAccount:
 *                   type: boolean
 *                   description: >-
 *                     True = an existing user was sent an accept link ("Invitation sent").
 *                     False = an unregistered email was sent a signup link ("Signup invite sent").
 *                 invitation: { $ref: '#/components/schemas/WorkspaceInvitation' }
 *                 sharedProjectCount:
 *                   type: integer
 *                   example: 12
 *                   description: Projects in this workspace the invitee will see once they accept.
 *       400:
 *         description: Validation error, or the target is a personal workspace (which cannot be shared)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not an owner/admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Already a member
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.post(
  '/:workspaceId/members/invite',
  validateBody(inviteMemberSchema),
  workspaceController.inviteMember,
);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/invitations:
 *   get:
 *     tags: [Workspaces]
 *     summary: List outstanding (pending) invitations
 *     description: The "Invitation sent" rows on the members page. OWNER/ADMIN only. Returns PENDING invitations by default; pass `?all=true` to include ACCEPTED/REVOKED history.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: all
 *         schema: { type: boolean }
 *         description: Include ACCEPTED/REVOKED, not just PENDING
 *     responses:
 *       200:
 *         description: Invitations (newest first)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invitations:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/WorkspaceInvitation' }
 *       403:
 *         description: Not an owner/admin of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.get('/:workspaceId/invitations', workspaceController.listInvitations);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/invitations/{invitationId}:
 *   delete:
 *     tags: [Workspaces]
 *     summary: Revoke a pending invitation
 *     description: Cancels a PENDING invitation (sets it REVOKED). OWNER/ADMIN only. Already-accepted invites are memberships now — remove the member instead.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Invitation revoked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invitation: { $ref: '#/components/schemas/WorkspaceInvitation' }
 *       400:
 *         description: Invitation is not pending
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not an owner/admin of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Invitation not found in this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.delete('/:workspaceId/invitations/:invitationId', workspaceController.revokeInvitation);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/members/{userId}:
 *   patch:
 *     tags: [Workspaces]
 *     summary: Change a member's role
 *     description: OWNER/ADMIN only. Only an OWNER may grant the OWNER role or change an existing owner's role. A workspace must always keep at least one owner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [OWNER, ADMIN, MEMBER] }
 *     responses:
 *       200:
 *         description: Updated member
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 member: { $ref: '#/components/schemas/WorkspaceMember' }
 *       400:
 *         description: Validation error, or would remove the last owner
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not permitted (e.g. non-owner touching the owner role)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Target is not a member
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Workspaces]
 *     summary: Remove a member from the workspace
 *     description: OWNER/ADMIN only. Removing an owner is owner-only and never the last owner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: "Member removed" }
 *       400:
 *         description: Would remove the last owner
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Target is not a member
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
workspaceRouter.patch(
  '/:workspaceId/members/:userId',
  validateBody(updateMemberRoleSchema),
  workspaceController.updateMemberRole,
);

/**
 * @openapi
 * /api/v1/workspaces/{workspaceId}/members/me:
 *   delete:
 *     tags: [Workspaces]
 *     summary: Leave a workspace
 *     description: >-
 *       Removes you from the workspace and revokes your access to every project in it.
 *       The counterpart to invitations needing acceptance — if you can be invited, you can
 *       get out without asking an owner to remove you.
 *
 *
 *       Refused if you are the workspace's only OWNER: promote someone else first, or
 *       delete the workspace. If this workspace was where your new projects landed, your
 *       default is cleared and `POST /projects` will ask you to name a workspace until you
 *       set a new one.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: You have left the workspace
 *       400:
 *         description: You are the only owner
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: You are not a member of this workspace
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// Registered BEFORE the /:userId route — Express matches in order, so without
// this the literal "me" would bind to :userId and hit removeMember instead.
workspaceRouter.delete('/:workspaceId/members/me', workspaceController.leaveWorkspace);
workspaceRouter.delete('/:workspaceId/members/:userId', workspaceController.removeMember);
