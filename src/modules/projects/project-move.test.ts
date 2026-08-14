import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../app';
import { prisma } from '../../lib/prisma';
import { registerAndLogin, waitFor, type TestUser } from '../../test/helpers';

// Moving a project is a transfer of AUDIENCE, not a field edit: it takes the
// project away from one set of people and hands it to another. These tests pin
// the permission bar on both sides and the notification that stops a move from
// being silent.

function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.accessToken}` };
}

function createWorkspace(user: TestUser, name: string, visibility = 'SHARED') {
  return request(app).post('/api/v1/workspaces').set(auth(user)).send({ name, visibility });
}

function createProject(user: TestUser, name: string, workspaceId: string) {
  return request(app)
    .post('/api/v1/projects')
    .set(auth(user))
    .send({ name, oneLineIdea: `idea for ${name}`, workspaceId });
}

async function joinWorkspace(owner: TestUser, workspaceId: string, invitee: TestUser, role = 'MEMBER') {
  await request(app)
    .post(`/api/v1/workspaces/${workspaceId}/members/invite`)
    .set(auth(owner))
    .send({ email: invitee.email, role });
  const list = await request(app).get('/api/v1/invitations').set(auth(invitee));
  const invitation = list.body.invitations.find(
    (i: { workspace: { id: string } }) => i.workspace.id === workspaceId,
  );
  await request(app).post(`/api/v1/invitations/${invitation.id}/accept`).set(auth(invitee));
}

describe('Moving a single project', () => {
  it('requires OWNER/ADMIN in the destination, not just the source', async () => {
    const owner = await registerAndLogin('mv-dest-owner');
    const mover = await registerAndLogin('mv-dest-mover');

    // mover is an ADMIN of the source but only a MEMBER of the destination.
    const source = await createWorkspace(mover, 'Source Co');
    const destination = await createWorkspace(owner, 'Destination Co');
    await joinWorkspace(owner, destination.body.workspace.id, mover, 'MEMBER');

    const project = await createProject(mover, 'Travelling', source.body.workspace.id);

    const res = await request(app)
      .patch(`/api/v1/projects/${project.body.project.id}`)
      .set(auth(mover))
      .send({ workspaceId: destination.body.workspace.id });

    // Destination members GAIN access, so consent is needed on that side too.
    expect(res.status).toBe(403);
  });

  it('refuses a move by a plain MEMBER of the source', async () => {
    const owner = await registerAndLogin('mv-src-owner');
    const member = await registerAndLogin('mv-src-member');
    const source = await createWorkspace(owner, 'Source Co');
    const destination = await createWorkspace(member, 'Their Own Co');
    await joinWorkspace(owner, source.body.workspace.id, member, 'MEMBER');

    const project = await createProject(owner, 'Coveted', source.body.workspace.id);

    const res = await request(app)
      .patch(`/api/v1/projects/${project.body.project.id}`)
      .set(auth(member))
      .send({ workspaceId: destination.body.workspace.id });

    expect(res.status).toBe(403);
  });

  it('moves the project and notifies everyone who lost access', async () => {
    const owner = await registerAndLogin('mv-notify-owner');
    const losing = await registerAndLogin('mv-notify-losing');
    const source = await createWorkspace(owner, 'Source Co');
    const destination = await createWorkspace(owner, 'Destination Co');
    await joinWorkspace(owner, source.body.workspace.id, losing, 'MEMBER');

    const project = await createProject(owner, 'Departing', source.body.workspace.id);

    const res = await request(app)
      .patch(`/api/v1/projects/${project.body.project.id}`)
      .set(auth(owner))
      .send({ workspaceId: destination.body.workspace.id });
    expect(res.status).toBe(200);

    // Without this the project just vanishes from their dashboard.
    // Dispatched fire-and-forget, so poll rather than assert immediately.
    const notifications = await waitFor(() =>
      prisma.notification.findMany({ where: { userId: losing.id, type: 'PROJECT_MOVED' } }),
    );
    expect(notifications).toHaveLength(1);

    // The destination is never named — they cannot see it, and naming a
    // workspace someone has no access to leaks its existence.
    expect(JSON.stringify(notifications[0])).not.toContain('Destination Co');

    // The person who did it already knows.
    expect(
      await prisma.notification.count({ where: { userId: owner.id, type: 'PROJECT_MOVED' } }),
    ).toBe(0);
  });

  it('does not notify people who are in BOTH workspaces', async () => {
    const owner = await registerAndLogin('mv-both-owner');
    const inBoth = await registerAndLogin('mv-both-member');
    const sourceOnly = await registerAndLogin('mv-both-sourceonly');
    const source = await createWorkspace(owner, 'Source Co');
    const destination = await createWorkspace(owner, 'Destination Co');
    await joinWorkspace(owner, source.body.workspace.id, inBoth, 'MEMBER');
    await joinWorkspace(owner, destination.body.workspace.id, inBoth, 'MEMBER');
    // Present so the test has a positive signal to wait on. Without someone who
    // SHOULD be notified, "no notification yet" and "no notification ever" look
    // identical and the assertion below would pass for the wrong reason.
    await joinWorkspace(owner, source.body.workspace.id, sourceOnly, 'MEMBER');

    const project = await createProject(owner, 'Staying Visible', source.body.workspace.id);
    await request(app)
      .patch(`/api/v1/projects/${project.body.project.id}`)
      .set(auth(owner))
      .send({ workspaceId: destination.body.workspace.id });

    await waitFor(() =>
      prisma.notification.findMany({ where: { userId: sourceOnly.id, type: 'PROJECT_MOVED' } }),
    );

    // They never lost sight of it, so telling them they did would be a lie.
    expect(
      await prisma.notification.count({ where: { userId: inBoth.id, type: 'PROJECT_MOVED' } }),
    ).toBe(0);
  });

  it('previews who would lose access without performing the move', async () => {
    const owner = await registerAndLogin('mv-prev-owner');
    const losing = await registerAndLogin('mv-prev-losing');
    const source = await createWorkspace(owner, 'Source Co');
    const destination = await createWorkspace(owner, 'Destination Co');
    await joinWorkspace(owner, source.body.workspace.id, losing, 'MEMBER');

    const project = await createProject(owner, 'Previewed', source.body.workspace.id);

    const res = await request(app)
      .get(`/api/v1/projects/${project.body.project.id}/move-preview`)
      .query({ workspaceId: destination.body.workspace.id })
      .set(auth(owner));

    expect(res.status).toBe(200);
    expect(res.body.losingAccess.count).toBe(1);
    expect(res.body.losingAccess.users[0].id).toBe(losing.id);

    // A preview must not be a move.
    const unchanged = await prisma.project.findUnique({
      where: { id: project.body.project.id },
    });
    expect(unchanged?.workspaceId).toBe(source.body.workspace.id);
  });
});

describe('Bulk move', () => {
  it('moves a batch and reports the count', async () => {
    const owner = await registerAndLogin('bulk-ok');
    const source = await createWorkspace(owner, 'Source Co');
    const destination = await createWorkspace(owner, 'Destination Co');

    const ids: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      const p = await createProject(owner, name, source.body.workspace.id);
      ids.push(p.body.project.id);
    }

    const res = await request(app)
      .post('/api/v1/projects/move')
      .set(auth(owner))
      .send({ projectIds: ids, targetWorkspaceId: destination.body.workspace.id });

    expect(res.status).toBe(200);
    expect(res.body.movedCount).toBe(3);
    expect(
      await prisma.project.count({ where: { workspaceId: destination.body.workspace.id } }),
    ).toBe(3);
  });

  it('moves nothing at all when one project in the batch is not permitted', async () => {
    const owner = await registerAndLogin('bulk-atomic');
    const stranger = await registerAndLogin('bulk-atomic-stranger');
    const source = await createWorkspace(owner, 'Source Co');
    const destination = await createWorkspace(owner, 'Destination Co');
    const foreign = await createWorkspace(stranger, 'Not Yours Co');

    const mine = await createProject(owner, 'Mine', source.body.workspace.id);
    const theirs = await createProject(stranger, 'Theirs', foreign.body.workspace.id);

    const res = await request(app)
      .post('/api/v1/projects/move')
      .set(auth(owner))
      .send({
        projectIds: [mine.body.project.id, theirs.body.project.id],
        targetWorkspaceId: destination.body.workspace.id,
      });

    expect(res.status).toBe(403);

    // All-or-nothing: a partial move would scatter projects with no way to
    // tell which ones made it.
    expect(
      await prisma.project.count({ where: { workspaceId: destination.body.workspace.id } }),
    ).toBe(0);
    expect(
      await prisma.project.findUnique({ where: { id: theirs.body.project.id } }),
    ).toMatchObject({ workspaceId: foreign.body.workspace.id });
  });

  it('sends one notification per person, not one per project', async () => {
    const owner = await registerAndLogin('bulk-notify');
    const losing = await registerAndLogin('bulk-notify-losing');
    const source = await createWorkspace(owner, 'Source Co');
    const destination = await createWorkspace(owner, 'Destination Co');
    await joinWorkspace(owner, source.body.workspace.id, losing, 'MEMBER');

    const ids: string[] = [];
    for (const name of ['A', 'B', 'C', 'D']) {
      const p = await createProject(owner, name, source.body.workspace.id);
      ids.push(p.body.project.id);
    }

    await request(app)
      .post('/api/v1/projects/move')
      .set(auth(owner))
      .send({ projectIds: ids, targetWorkspaceId: destination.body.workspace.id });

    // Four moved projects should be one "4 projects left Source Co", not four
    // separate alerts. Fire-and-forget, so poll for the first one to land.
    const notifications = await waitFor(() =>
      prisma.notification.findMany({ where: { userId: losing.id, type: 'PROJECT_MOVED' } }),
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toContain('4 projects');
  });

  it('rejects a batch containing an unknown project id', async () => {
    const owner = await registerAndLogin('bulk-missing');
    const source = await createWorkspace(owner, 'Source Co');
    const destination = await createWorkspace(owner, 'Destination Co');
    const p = await createProject(owner, 'Real', source.body.workspace.id);

    const res = await request(app)
      .post('/api/v1/projects/move')
      .set(auth(owner))
      .send({
        projectIds: [p.body.project.id, '00000000-0000-4000-8000-000000000000'],
        targetWorkspaceId: destination.body.workspace.id,
      });

    expect(res.status).toBe(404);
    expect(
      await prisma.project.count({ where: { workspaceId: destination.body.workspace.id } }),
    ).toBe(0);
  });
});
