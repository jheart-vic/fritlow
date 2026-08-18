import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../app';
import { prisma } from '../../lib/prisma';
import { registerAndLogin, type TestUser } from '../../test/helpers';

// Conversation management only — renaming, reading and deleting. Sending a
// message is deliberately out of scope here: it calls a live model, and the
// test env has no AI key precisely so the suite stays deterministic and free.
// Conversations are seeded straight through Prisma for the same reason.

function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.accessToken}` };
}

async function createProject(user: TestUser, name = 'Chat Project') {
  const res = await request(app)
    .post('/api/v1/projects')
    .set(auth(user))
    .send({ name, oneLineIdea: 'a project to chat about' });
  return res.body.project.id as string;
}

async function seedConversation(userId: string, projectId: string, title: string | null) {
  return prisma.chatConversation.create({
    data: { projectId, createdById: userId, title },
  });
}

describe('AI chat conversations', () => {
  it('renames a conversation', async () => {
    const user = await registerAndLogin('chat-rename');
    const projectId = await createProject(user);
    const conversation = await seedConversation(user.id, projectId, 'Untitled');

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/chat/conversations/${conversation.id}`)
      .set(auth(user))
      .send({ title: 'Pricing model options' });

    expect(res.status).toBe(200);
    expect(res.body.conversation.title).toBe('Pricing model options');

    const stored = await prisma.chatConversation.findUnique({ where: { id: conversation.id } });
    expect(stored?.title).toBe('Pricing model options');
  });

  it('clears a title with null — the way out of a bad rename', async () => {
    const user = await registerAndLogin('chat-clear');
    const projectId = await createProject(user);
    const conversation = await seedConversation(user.id, projectId, 'Typo McTypoface');

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/chat/conversations/${conversation.id}`)
      .set(auth(user))
      .send({ title: null });

    expect(res.status).toBe(200);
    expect(res.body.conversation.title).toBeNull();
  });

  it('rejects an empty or overlong title', async () => {
    const user = await registerAndLogin('chat-invalid');
    const projectId = await createProject(user);
    const conversation = await seedConversation(user.id, projectId, 'Fine');

    const blank = await request(app)
      .patch(`/api/v1/projects/${projectId}/chat/conversations/${conversation.id}`)
      .set(auth(user))
      .send({ title: '   ' });
    expect(blank.status).toBe(400);

    const tooLong = await request(app)
      .patch(`/api/v1/projects/${projectId}/chat/conversations/${conversation.id}`)
      .set(auth(user))
      .send({ title: 'x'.repeat(121) });
    expect(tooLong.status).toBe(400);
  });

  it('will not rename or delete someone else conversation', async () => {
    const owner = await registerAndLogin('chat-owner');
    const stranger = await registerAndLogin('chat-stranger');
    const projectId = await createProject(owner);
    const conversation = await seedConversation(owner.id, projectId, 'Private thoughts');

    // Conversations are per-user within a project, so another user's id is
    // not found rather than forbidden — it isn't theirs to know about.
    const renamed = await request(app)
      .patch(`/api/v1/projects/${projectId}/chat/conversations/${conversation.id}`)
      .set(auth(stranger))
      .send({ title: 'Hijacked' });
    expect([403, 404]).toContain(renamed.status);

    const deleted = await request(app)
      .delete(`/api/v1/projects/${projectId}/chat/conversations/${conversation.id}`)
      .set(auth(stranger));
    expect([403, 404]).toContain(deleted.status);

    const stored = await prisma.chatConversation.findUnique({ where: { id: conversation.id } });
    expect(stored?.title).toBe('Private thoughts');
  });

  it('deletes a conversation and its messages', async () => {
    const user = await registerAndLogin('chat-delete');
    const projectId = await createProject(user);
    const conversation = await seedConversation(user.id, projectId, 'Disposable');
    await prisma.chatMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: 'hello' },
    });

    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/chat/conversations/${conversation.id}`)
      .set(auth(user));

    expect(res.status).toBe(204);
    expect(await prisma.chatConversation.findUnique({ where: { id: conversation.id } })).toBeNull();
    // Messages cascade — no orphans left behind.
    expect(await prisma.chatMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
  });

  it('lists conversations newest-activity first', async () => {
    const user = await registerAndLogin('chat-list');
    const projectId = await createProject(user);
    const older = await seedConversation(user.id, projectId, 'Older');
    const newer = await seedConversation(user.id, projectId, 'Newer');
    await prisma.chatConversation.update({
      where: { id: older.id },
      data: { lastMessageAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/chat/conversations`)
      .set(auth(user));

    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([newer.id, older.id]);
  });
});
