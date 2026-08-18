import * as aiService from '../../lib/ai/ai.service';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import type { RenameConversationInput, SendMessageInput } from './chat.schemas';

// The project AI assistant ("founder copilot"). Personal, per-project chat that
// answers using the project's own context (discovery + blueprint + health) plus
// the conversation so far. Streamed over SSE, reusing the shared AI layer.

const HISTORY_LIMIT = 15; // recent turns fed back to the model (bounds tokens)

// Assemble what the assistant knows about the project into a system prompt.
async function buildProjectContext(projectId: string): Promise<string> {
  const [project, session, blueprint, health] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.discoverySession.findUnique({
      where: { projectId },
      include: { answers: { orderBy: { answeredAt: 'asc' } } },
    }),
    prisma.blueprint.findUnique({
      where: { projectId },
      include: { sections: { orderBy: { order: 'asc' } } },
    }),
    prisma.healthScore.findUnique({ where: { projectId } }),
  ]);

  const parts: string[] = [
    `Project: ${project?.name ?? ''}`,
    `One-line idea: ${project?.oneLineIdea ?? ''}`,
    project?.category ? `Category: ${project.category}` : '',
  ];

  const answers = session?.answers ?? [];
  if (answers.length > 0) {
    parts.push('', 'Discovery answers:');
    for (const a of answers) {
      const payload = a.answer as { text?: string };
      parts.push(`Q (${a.module}): ${a.questionText}\nA: ${payload.text ?? ''}`);
    }
  }

  if (blueprint && blueprint.sections.length > 0) {
    parts.push('', 'Blueprint sections:');
    for (const s of blueprint.sections) {
      const content = s.content as { markdown?: string };
      parts.push(`## ${s.title}\n${content.markdown ?? ''}`);
    }
  }

  if (health?.summary) {
    parts.push('', `Health score: ${health.overall}/100 — ${health.summary}`);
  }

  return parts.filter(Boolean).join('\n');
}

async function getOwnedConversation(userId: string, projectId: string, conversationId: string) {
  const c = await prisma.chatConversation.findUnique({ where: { id: conversationId } });
  if (!c || c.projectId !== projectId || c.createdById !== userId) {
    throw ApiError.notFound('Conversation not found');
  }
  return c;
}

// The streaming turn. Persists the user message first (so it survives an AI
// failure), streams the answer, then persists the assistant message.
export async function streamChat(
  userId: string,
  projectId: string,
  input: SendMessageInput,
  onDelta: (text: string) => void,
) {
  await getProject(userId, projectId); // membership gate + 404

  const conversation = input.conversationId
    ? await getOwnedConversation(userId, projectId, input.conversationId)
    : await prisma.chatConversation.create({
        data: {
          projectId,
          createdById: userId,
          // Seed the title from the first message (trimmed) for the sidebar.
          title: input.message.slice(0, 60),
        },
      });

  // Prior turns (oldest first) for context, before we add the new one.
  const history = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    take: HISTORY_LIMIT,
  });

  const userMessage = await prisma.chatMessage.create({
    data: { conversationId: conversation.id, role: 'USER', content: input.message },
  });

  const context = await buildProjectContext(projectId);
  const transcript = [...history, userMessage]
    .map((m) => `${m.role === 'USER' ? 'Founder' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const raw = await aiService.generateTextStream(
    {
      feature: 'chat.message',
      userId,
      projectId,
      // Reasoning shares this budget with the reply, so 2048 left some answers
      // with nothing to say — roughly 1 in 10 came back empty. The reply
      // itself is short; the headroom is for the thinking.
      maxTokens: 6144,
      // A founder is watching a cursor blink. Conversational replies grounded
      // in supplied context don't need deep deliberation, and every second of
      // it is a second before the first streamed token appears.
      reasoningEffort: 'low',
      system:
        'You are the Fritlow AI assistant, a product strategist helping a founder with THIS project. ' +
        'Answer their latest question using the project context and the conversation so far. Be concrete, ' +
        'honest, and concise; challenge weak assumptions rather than flatter. If the project context does ' +
        "not contain something, say so instead of inventing it.\n\n--- PROJECT CONTEXT ---\n" +
        context,
      prompt: `${transcript}\nAssistant:`,
    },
    onDelta,
  );

  const assistantMessage = await prisma.chatMessage.create({
    data: { conversationId: conversation.id, role: 'ASSISTANT', content: raw.trim() },
  });
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  return { conversationId: conversation.id, userMessage, assistantMessage };
}

export async function listConversations(userId: string, projectId: string) {
  await getProject(userId, projectId);
  return prisma.chatConversation.findMany({
    where: { projectId, createdById: userId },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, title: true, createdAt: true, updatedAt: true, lastMessageAt: true },
  });
}

export async function getConversation(userId: string, projectId: string, conversationId: string) {
  await getProject(userId, projectId);
  const conversation = await getOwnedConversation(userId, projectId, conversationId);
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return { ...conversation, messages };
}

// Rename a conversation. Goes through getOwnedConversation like every other
// conversation action, so you can only rename your own chats — conversations
// are per-user within a project, not shared with the workspace.
export async function renameConversation(
  userId: string,
  projectId: string,
  conversationId: string,
  input: RenameConversationInput,
) {
  await getProject(userId, projectId);
  const conversation = await getOwnedConversation(userId, projectId, conversationId);

  return prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { title: input.title },
    select: { id: true, title: true, createdAt: true, updatedAt: true, lastMessageAt: true },
  });
}

export async function deleteConversation(userId: string, projectId: string, conversationId: string) {
  await getProject(userId, projectId);
  const conversation = await getOwnedConversation(userId, projectId, conversationId);
  await prisma.chatConversation.delete({ where: { id: conversation.id } });
}
