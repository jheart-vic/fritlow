import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { notify } from '../notifications/notification.service';
import { getProject } from '../projects/project.service';
import type { CreateCommentInput } from './comment.schemas';

// Comments are anchored to a blueprint SECTION (per the build spec), threaded
// via optional parentId. Access follows project membership: any member of the
// project's workspace can read and post; a comment can be deleted by its author
// or by a workspace OWNER/ADMIN.

// Tiny author shape embedded in every comment — never the full user row.
const authorSelect = {
  author: { select: { id: true, fullName: true } },
} as const;

// The public shape of a comment (with its nested replies).
export interface CommentNode {
  id: string;
  body: string;
  projectId: string;
  sectionKey: string;
  parentId: string | null;
  author: { id: string; fullName: string };
  createdAt: Date;
  updatedAt: Date;
  replies: CommentNode[];
}

// Resolve the BlueprintSection for {project, sectionKey}. Comments hang off a
// section, so we need its id, and a 404 if the project has no such section yet.
async function getSection(projectId: string, sectionKey: string) {
  const section = await prisma.blueprintSection.findFirst({
    where: { key: sectionKey, blueprint: { projectId } },
  });
  if (!section) {
    throw ApiError.notFound('No such blueprint section in this project');
  }
  return section;
}

export async function createComment(
  userId: string,
  projectId: string,
  sectionKey: string,
  input: CreateCommentInput,
) {
  const project = await getProject(userId, projectId); // membership gate + 404
  const section = await getSection(projectId, sectionKey);

  // A reply must point at a comment on the SAME section — you can't graft a
  // thread across sections/projects.
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: input.parentId } });
    if (!parent || parent.blueprintSectionId !== section.id) {
      throw ApiError.notFound('Parent comment not found on this section');
    }
    parentAuthorId = parent.authorId;
  }

  const comment = await prisma.comment.create({
    data: {
      body: input.body,
      projectId,
      blueprintSectionId: section.id,
      sectionKey,
      authorId: userId,
      parentId: input.parentId ?? null,
    },
    select: {
      id: true,
      body: true,
      projectId: true,
      sectionKey: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      ...authorSelect,
    },
  });

  // Notify the right person (never yourself): a reply pings the parent's author;
  // a top-level comment pings the project's creator.
  const data = { projectId, sectionKey, commentId: comment.id };
  if (parentAuthorId && parentAuthorId !== userId) {
    notify({ userId: parentAuthorId, type: 'COMMENT_REPLY', title: 'New reply to your comment', body: input.body.slice(0, 120), data });
  } else if (!input.parentId && project.createdById !== userId) {
    notify({ userId: project.createdById, type: 'COMMENT_ADDED', title: `New comment on ${project.name}`, body: input.body.slice(0, 120), data });
  }

  return comment;
}

export async function listComments(
  userId: string,
  projectId: string,
  sectionKey: string,
): Promise<CommentNode[]> {
  await getProject(userId, projectId);
  const section = await getSection(projectId, sectionKey);

  // Fetch the whole section's comments in chronological order, then assemble
  // the thread tree in memory (one query, any nesting depth).
  const rows = await prisma.comment.findMany({
    where: { blueprintSectionId: section.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      projectId: true,
      sectionKey: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      ...authorSelect,
    },
  });

  const byId = new Map<string, CommentNode>();
  for (const r of rows) byId.set(r.id, { ...r, replies: [] });

  const roots: CommentNode[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node); // top-level (or an orphan whose parent is gone)
  }
  return roots;
}

export async function deleteComment(userId: string, commentId: string) {
  // The DELETE route is top-level (/api/v1/comments/{id}) with no project in the
  // path, so we resolve the workspace from the comment itself to check access.
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!comment) {
    throw ApiError.notFound('Comment not found');
  }

  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: comment.project.workspaceId } },
  });
  if (!member) {
    throw ApiError.forbidden('You are not a member of this workspace');
  }

  // Author can always delete their own; otherwise it takes OWNER/ADMIN.
  const isAuthor = comment.authorId === userId;
  const isManager = member.role === 'OWNER' || member.role === 'ADMIN';
  if (!isAuthor && !isManager) {
    throw ApiError.forbidden('You can only delete your own comments');
  }

  // Cascade (schema onDelete) removes any replies to this comment.
  await prisma.comment.delete({ where: { id: comment.id } });
}
