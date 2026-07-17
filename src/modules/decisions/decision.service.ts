import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import type { CreateDecisionInput, UpdateDecisionInput } from './decision.schemas';

export async function createDecision(userId: string, projectId: string, input: CreateDecisionInput) {
  await getProject(userId, projectId);

  return prisma.decisionLog.create({
    data: { ...input, projectId, createdById: userId },
  });
}

export async function listDecisions(userId: string, projectId: string) {
  await getProject(userId, projectId);

  return prisma.decisionLog.findMany({
    where: { projectId },
    orderBy: { decidedAt: 'desc' },
  });
}

async function getOwnedDecision(userId: string, projectId: string, decisionId: string) {
  await getProject(userId, projectId);

  const decision = await prisma.decisionLog.findUnique({ where: { id: decisionId } });
  if (!decision || decision.projectId !== projectId) {
    throw ApiError.notFound('Decision not found in this project');
  }
  return decision;
}

export async function updateDecision(
  userId: string,
  projectId: string,
  decisionId: string,
  input: UpdateDecisionInput,
) {
  const decision = await getOwnedDecision(userId, projectId, decisionId);
  return prisma.decisionLog.update({ where: { id: decision.id }, data: input });
}

export async function deleteDecision(userId: string, projectId: string, decisionId: string) {
  const decision = await getOwnedDecision(userId, projectId, decisionId);
  await prisma.decisionLog.delete({ where: { id: decision.id } });
}
