import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../app';
import { prisma } from '../../lib/prisma';
import { registerAndLogin, type TestUser } from '../../test/helpers';

// Comments hang off a blueprint SECTION, and generating a real blueprint needs
// a live model — so the blueprint and its section are seeded through Prisma.
// Everything under test (posting, editing, permissions, the edit window) is
// pure application logic and runs against the real HTTP stack.

function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.accessToken}` };
}

const SECTION_KEY = 'business_model';

// A project with a blueprint and one section, ready to be commented on.
async function seedSection(user: TestUser, workspaceId?: string) {
  const project = await prisma.project.create({
    data: {
      name: 'Commentable',
      oneLineIdea: 'something worth discussing',
      createdById: user.id,
      workspaceId: workspaceId ?? user.workspaceId,
    },
  });
  const blueprint = await prisma.blueprint.create({ data: { projectId: project.id } });
  await prisma.blueprintSection.create({
    data: {
      blueprintId: blueprint.id,
      key: SECTION_KEY,
      title: 'Business Model',
      content: { markdown: 'How the money works.' },
      order: 1,
    },
  });
  return project.id;
}

function postComment(user: TestUser, projectId: string, body: string, parentId?: string) {
  return request(app)
    .post(`/api/v1/projects/${projectId}/blueprint/sections/${SECTION_KEY}/comments`)
    .set(auth(user))
    .send({ body, ...(parentId ? { parentId } : {}) });
}

describe('Comment author shape', () => {
  it('includes avatarUrl on the author, and on nested replies', async () => {
    const user = await registerAndLogin('cmt-avatar');
    const projectId = await seedSection(user);
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: 'https://cdn.example/avatar.jpg' },
    });

    const parent = await postComment(user, projectId, 'Top level');
    expect(parent.status).toBe(201);
    expect(parent.body.comment.author.avatarUrl).toBe('https://cdn.example/avatar.jpg');

    await postComment(user, projectId, 'A reply', parent.body.comment.id);

    const list = await request(app)
      .get(`/api/v1/projects/${projectId}/blueprint/sections/${SECTION_KEY}/comments`)
      .set(auth(user));

    expect(list.status).toBe(200);
    const [root] = list.body.comments;
    // The shape has to match at every depth — the UI renders the same avatar
    // component for a comment and for a reply.
    expect(root.author.avatarUrl).toBe('https://cdn.example/avatar.jpg');
    expect(root.replies[0].author.avatarUrl).toBe('https://cdn.example/avatar.jpg');
  });

  it('returns null avatarUrl rather than omitting the key', async () => {
    const user = await registerAndLogin('cmt-noavatar');
    const projectId = await seedSection(user);

    const res = await postComment(user, projectId, 'No photo here');
    expect(res.body.comment.author).toHaveProperty('avatarUrl');
    expect(res.body.comment.author.avatarUrl).toBeNull();
  });
});

describe('Editing a comment', () => {
  it('updates the body and stamps editedAt', async () => {
    const user = await registerAndLogin('cmt-edit');
    const projectId = await seedSection(user);
    const created = await postComment(user, projectId, 'Frist draft');

    // Posted comments start unedited — that is what drives the UI marker.
    expect(created.body.comment.editedAt).toBeNull();

    const res = await request(app)
      .patch(`/api/v1/comments/${created.body.comment.id}`)
      .set(auth(user))
      .send({ body: 'First draft' });

    expect(res.status).toBe(200);
    expect(res.body.comment.body).toBe('First draft');
    expect(res.body.comment.editedAt).not.toBeNull();
  });

  it('rejects an empty or overlong body', async () => {
    const user = await registerAndLogin('cmt-edit-invalid');
    const projectId = await seedSection(user);
    const created = await postComment(user, projectId, 'Valid');

    const blank = await request(app)
      .patch(`/api/v1/comments/${created.body.comment.id}`)
      .set(auth(user))
      .send({ body: '   ' });
    expect(blank.status).toBe(400);

    const tooLong = await request(app)
      .patch(`/api/v1/comments/${created.body.comment.id}`)
      .set(auth(user))
      .send({ body: 'x'.repeat(5001) });
    expect(tooLong.status).toBe(400);
  });

  it('refuses after the 15-minute window, measured from posting', async () => {
    const user = await registerAndLogin('cmt-window');
    const projectId = await seedSection(user);
    const created = await postComment(user, projectId, 'Said something');

    // Backdate past the window — the window runs from createdAt, so an edit
    // cannot be used to extend it indefinitely.
    await prisma.comment.update({
      where: { id: created.body.comment.id },
      data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });

    const res = await request(app)
      .patch(`/api/v1/comments/${created.body.comment.id}`)
      .set(auth(user))
      .send({ body: 'Rewriting history' });

    expect(res.status).toBe(400);
    const stored = await prisma.comment.findUnique({ where: { id: created.body.comment.id } });
    expect(stored?.body).toBe('Said something');
  });

  it('lets a teammate DELETE but never EDIT someone else comment', async () => {
    const owner = await registerAndLogin('cmt-owner');
    const teammate = await registerAndLogin('cmt-teammate');

    // A shared workspace so the teammate is a legitimate member — this is
    // about authorship, not access.
    const ws = await request(app)
      .post('/api/v1/workspaces')
      .set(auth(owner))
      .send({ name: 'Comment Co' });
    const workspaceId = ws.body.workspace.id;
    await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/members/invite`)
      .set(auth(owner))
      .send({ email: teammate.email, role: 'ADMIN' });
    const invites = await request(app).get('/api/v1/invitations').set(auth(teammate));
    await request(app)
      .post(`/api/v1/invitations/${invites.body.invitations[0].id}/accept`)
      .set(auth(teammate));

    const projectId = await seedSection(owner, workspaceId);
    const created = await postComment(owner, projectId, 'My words');

    // An ADMIN may moderate by removing content, but rewriting it would leave
    // the original author's name on text they never wrote.
    const edited = await request(app)
      .patch(`/api/v1/comments/${created.body.comment.id}`)
      .set(auth(teammate))
      .send({ body: 'Words I never said' });
    expect(edited.status).toBe(403);

    const stored = await prisma.comment.findUnique({ where: { id: created.body.comment.id } });
    expect(stored?.body).toBe('My words');

    const deleted = await request(app)
      .delete(`/api/v1/comments/${created.body.comment.id}`)
      .set(auth(teammate));
    expect(deleted.status).toBe(204);
  });
});

describe('Launching a project', () => {
  it('refuses to launch a project with no blueprint', async () => {
    const user = await registerAndLogin('launch-empty');
    const created = await request(app)
      .post('/api/v1/projects')
      .set(auth(user))
      .send({ name: 'Nothing here', oneLineIdea: 'an empty shell' });

    const res = await request(app)
      .patch(`/api/v1/projects/${created.body.project.id}`)
      .set(auth(user))
      .send({ status: 'LAUNCHED' });

    // Otherwise an empty project lands in the library's Launched filter and
    // reaches the dashboard's terminal CELEBRATE state.
    expect(res.status).toBe(400);
    const stored = await prisma.project.findUnique({ where: { id: created.body.project.id } });
    expect(stored?.status).toBe('DRAFT');
  });

  it('allows launching once a blueprint exists', async () => {
    const user = await registerAndLogin('launch-ok');
    const projectId = await seedSection(user); // seeds a blueprint too

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth(user))
      .send({ status: 'LAUNCHED' });

    expect(res.status).toBe(200);
    expect(res.body.project.status).toBe('LAUNCHED');
  });

  it('still allows other status changes without a blueprint', async () => {
    const user = await registerAndLogin('launch-other');
    const created = await request(app)
      .post('/api/v1/projects')
      .set(auth(user))
      .send({ name: 'In progress', oneLineIdea: 'still working' });

    // The guard is specific to LAUNCHED — it must not block ordinary edits.
    const res = await request(app)
      .patch(`/api/v1/projects/${created.body.project.id}`)
      .set(auth(user))
      .send({ status: 'DISCOVERY' });

    expect(res.status).toBe(200);
    expect(res.body.project.status).toBe('DISCOVERY');
  });
});
