import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../app';
import { prisma } from '../../lib/prisma';
import { registerAndLogin, waitFor, type TestUser } from '../../test/helpers';
import { generateOpaqueToken, hashToken } from '../../utils/tokens';

// Access control is the most security-sensitive surface in the product: these
// tests pin the invariants that decide who can see whose work. Every one of
// them describes a way the system could quietly hand a project to the wrong
// person, so they are written as "this must not happen" rather than "this API
// returns 200".

function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.accessToken}` };
}

function createWorkspace(user: TestUser, body: Record<string, unknown>) {
  return request(app).post('/api/v1/workspaces').set(auth(user)).send(body);
}

function invite(user: TestUser, workspaceId: string, email: string, role = 'MEMBER') {
  return request(app)
    .post(`/api/v1/workspaces/${workspaceId}/members/invite`)
    .set(auth(user))
    .send({ email, role });
}

function listWorkspaces(user: TestUser) {
  return request(app).get('/api/v1/workspaces').set(auth(user));
}

// Invite `invitee` into a workspace and have them accept it, returning the
// invitation id. The two-step dance is the point of Phase 3 — there is no
// longer any way to put someone in a workspace without their say-so.
async function inviteAndAccept(
  owner: TestUser,
  workspaceId: string,
  invitee: TestUser,
  role = 'MEMBER',
) {
  await invite(owner, workspaceId, invitee.email, role);
  const list = await request(app).get('/api/v1/invitations').set(auth(invitee));
  const invitation = list.body.invitations.find(
    (i: { workspace: { id: string } }) => i.workspace.id === workspaceId,
  );
  const accepted = await request(app)
    .post(`/api/v1/invitations/${invitation.id}/accept`)
    .set(auth(invitee));
  expect(accepted.status).toBe(200);
  return invitation.id as string;
}

describe('Workspace visibility', () => {
  it('gives every new account exactly one private workspace, set as their default', async () => {
    const user = await registerAndLogin('vis-reg');

    const res = await listWorkspaces(user);
    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].isPrivate).toBe(true);
    expect(res.body.workspaces[0].isDefault).toBe(true);
  });

  it('creates a SHARED workspace by default, with a general channel', async () => {
    const user = await registerAndLogin('vis-shared');
    const res = await createWorkspace(user, { name: 'Acme Team' });

    expect(res.status).toBe(201);
    expect(res.body.workspace.isPrivate).toBe(false);

    const channels = await prisma.groupChannel.findMany({
      where: { workspaceId: res.body.workspace.id },
    });
    expect(channels.map((c) => c.name)).toEqual(['general']);
  });

  it('creates a PRIVATE workspace with no chat channel when asked', async () => {
    const user = await registerAndLogin('vis-private');
    const res = await createWorkspace(user, { name: 'Skunkworks', visibility: 'PRIVATE' });

    expect(res.status).toBe(201);
    expect(res.body.workspace.isPrivate).toBe(true);

    // No team to chat with — a channel only appears if it is ever converted.
    const channels = await prisma.groupChannel.findMany({
      where: { workspaceId: res.body.workspace.id },
    });
    expect(channels).toHaveLength(0);
  });

  it('allows any number of private workspaces while keeping exactly one default', async () => {
    const user = await registerAndLogin('vis-many');
    await createWorkspace(user, { name: 'Second Private', visibility: 'PRIVATE' });
    await createWorkspace(user, { name: 'Third Private', visibility: 'PRIVATE' });

    const res = await listWorkspaces(user);
    const privates = res.body.workspaces.filter((w: { isPrivate: boolean }) => w.isPrivate);
    const defaults = res.body.workspaces.filter((w: { isDefault: boolean }) => w.isDefault);

    // Three private workspaces is fine; two defaults would not be — that is the
    // ambiguity the isPrivate/defaultWorkspaceId split exists to remove.
    expect(privates).toHaveLength(3);
    expect(defaults).toHaveLength(1);
  });
});

describe('Default workspace', () => {
  it('puts a project with no workspaceId into the default workspace', async () => {
    const user = await registerAndLogin('def-land');
    const created = await createWorkspace(user, { name: 'New Home', visibility: 'PRIVATE' });
    await request(app)
      .post(`/api/v1/workspaces/${created.body.workspace.id}/set-default`)
      .set(auth(user));

    const project = await request(app)
      .post('/api/v1/projects')
      .set(auth(user))
      .send({ name: 'Unrouted', oneLineIdea: 'no workspace named' });

    expect(project.status).toBe(201);
    expect(project.body.project.workspaceId).toBe(created.body.workspace.id);
  });

  it('refuses to default into a workspace you do not own', async () => {
    const owner = await registerAndLogin('def-owner');
    const member = await registerAndLogin('def-member');
    const ws = await createWorkspace(owner, { name: 'Shared Space' });
    await inviteAndAccept(owner, ws.body.workspace.id, member);

    // A MEMBER defaulting into a shared workspace would publish everything they
    // start to that whole team, with no way to undo it themselves.
    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.body.workspace.id}/set-default`)
      .set(auth(member));

    expect(res.status).toBe(403);
  });

  it('warns when the new default is a shared workspace', async () => {
    const user = await registerAndLogin('def-warn');
    const ws = await createWorkspace(user, { name: 'Team Space' });

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.body.workspace.id}/set-default`)
      .set(auth(user));

    expect(res.status).toBe(200);
    expect(res.body.workspace.warning).toBeTruthy();
  });
});

describe('Invitations', () => {
  it('refuses to invite anyone into a private workspace', async () => {
    const owner = await registerAndLogin('inv-private');
    const other = await registerAndLogin('inv-private-other');

    // The workspace created at registration is private.
    const res = await invite(owner, owner.workspaceId, other.email);

    expect(res.status).toBe(400);
    expect(await prisma.workspaceMember.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
  });

  it('does NOT add an existing user until they accept', async () => {
    const owner = await registerAndLogin('inv-consent');
    const invitee = await registerAndLogin('inv-consent-target');
    const ws = await createWorkspace(owner, { name: 'Consent Co' });
    const workspaceId = ws.body.workspace.id;

    const res = await invite(owner, workspaceId, invitee.email);
    expect(res.status).toBe(201);
    expect(res.body.pending).toBe(true);
    expect(res.body.hasAccount).toBe(true);

    // The whole point: no membership yet, and it is not in their list.
    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: invitee.id, workspaceId } },
    });
    expect(membership).toBeNull();

    const theirs = await listWorkspaces(invitee);
    expect(theirs.body.workspaces.map((w: { id: string }) => w.id)).not.toContain(workspaceId);
  });

  it('creates the membership on accept, and refuses a replay', async () => {
    const owner = await registerAndLogin('inv-accept');
    const invitee = await registerAndLogin('inv-accept-target');
    const ws = await createWorkspace(owner, { name: 'Accept Co' });
    const workspaceId = ws.body.workspace.id;

    const invitationId = await inviteAndAccept(owner, workspaceId, invitee);

    expect(
      await prisma.workspaceMember.count({ where: { workspaceId, userId: invitee.id } }),
    ).toBe(1);

    // Accepting twice must not produce a second membership row.
    const replay = await request(app)
      .post(`/api/v1/invitations/${invitationId}/accept`)
      .set(auth(invitee));
    expect(replay.status).toBe(400);
    expect(
      await prisma.workspaceMember.count({ where: { workspaceId, userId: invitee.id } }),
    ).toBe(1);
  });

  it('tells the invitee how many projects accepting would expose', async () => {
    const owner = await registerAndLogin('inv-count');
    const invitee = await registerAndLogin('inv-count-target');
    const ws = await createWorkspace(owner, { name: 'Busy Co' });
    const workspaceId = ws.body.workspace.id;

    for (const name of ['One', 'Two', 'Three']) {
      await request(app)
        .post('/api/v1/projects')
        .set(auth(owner))
        .send({ name, oneLineIdea: 'idea', workspaceId });
    }

    const sent = await invite(owner, workspaceId, invitee.email);
    expect(sent.body.sharedProjectCount).toBe(3);

    const list = await request(app).get('/api/v1/invitations').set(auth(invitee));
    expect(list.body.invitations[0].projectCount).toBe(3);
  });

  it('lets an invitee decline, which does not create a membership', async () => {
    const owner = await registerAndLogin('inv-decline');
    const invitee = await registerAndLogin('inv-decline-target');
    const ws = await createWorkspace(owner, { name: 'Declined Co' });
    const workspaceId = ws.body.workspace.id;

    await invite(owner, workspaceId, invitee.email);
    const list = await request(app).get('/api/v1/invitations').set(auth(invitee));
    const res = await request(app)
      .post(`/api/v1/invitations/${list.body.invitations[0].id}/decline`)
      .set(auth(invitee));

    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe('DECLINED');
    expect(await prisma.workspaceMember.count({ where: { workspaceId, userId: invitee.id } })).toBe(0);
  });

  it('does not let a third party accept an invitation addressed to someone else', async () => {
    const owner = await registerAndLogin('inv-steal');
    const invitee = await registerAndLogin('inv-steal-target');
    const stranger = await registerAndLogin('inv-steal-stranger');
    const ws = await createWorkspace(owner, { name: 'Private Deal' });

    await invite(owner, ws.body.workspace.id, invitee.email);
    const list = await request(app).get('/api/v1/invitations').set(auth(invitee));

    // Knowing the invitation id must not be enough — the email has to match.
    const res = await request(app)
      .post(`/api/v1/invitations/${list.body.invitations[0].id}/accept`)
      .set(auth(stranger));

    expect(res.status).toBe(404);
    expect(
      await prisma.workspaceMember.count({
        where: { workspaceId: ws.body.workspace.id, userId: stranger.id },
      }),
    ).toBe(0);
  });
});

describe('Invite link landing page', () => {
  // The raw token never appears in an API response — it only exists in the
  // emailed link — so tests read it the way the landing page's visitor does:
  // by holding the value that was generated at invite time. We recover it by
  // intercepting nothing and instead asserting on what lookup returns for a
  // token we mint through the real flow, via the DB's stored hash.
  async function inviteAndGetToken(owner: TestUser, workspaceId: string, email: string) {
    await invite(owner, workspaceId, email);
    // The service hashes the token before storing, so the raw value is gone.
    // For test purposes we re-issue a known one directly, mirroring what
    // inviteMember does — this is the only way to exercise the token path.
    const token = generateOpaqueToken();
    await prisma.workspaceInvitation.update({
      where: { workspaceId_email: { workspaceId, email } },
      data: { tokenHash: hashToken(token) },
    });
    return token;
  }

  it('renders an invitation to a logged-out visitor', async () => {
    const owner = await registerAndLogin('look-out');
    const ws = await createWorkspace(owner, { name: 'Landing Co' });
    const workspaceId = ws.body.workspace.id;
    await request(app)
      .post('/api/v1/projects')
      .set(auth(owner))
      .send({ name: 'A project', oneLineIdea: 'idea', workspaceId });

    const token = await inviteAndGetToken(owner, workspaceId, 'stranger@test.fritlow');

    // No Authorization header at all — this is the whole point of the endpoint.
    const res = await request(app).get(`/api/v1/invitations/lookup/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.invitation.workspace.name).toBe('Landing Co');
    expect(res.body.invitation.invitedBy.fullName).toBe(owner.fullName);
    expect(res.body.invitation.email).toBe('stranger@test.fritlow');
    expect(res.body.invitation.projectCount).toBe(1);
    expect(res.body.invitation.actionable).toBe(true);

    // Never leak the workspace id or its contents to a non-member.
    expect(res.body.invitation.workspace.id).toBeUndefined();
  });

  it('reports whether the invited address already has an account', async () => {
    const owner = await registerAndLogin('look-acct');
    const existing = await registerAndLogin('look-acct-existing');
    const ws = await createWorkspace(owner, { name: 'Routing Co' });

    const knownToken = await inviteAndGetToken(owner, ws.body.workspace.id, existing.email);
    const unknownToken = await inviteAndGetToken(
      owner,
      ws.body.workspace.id,
      'nobody@test.fritlow',
    );

    // Drives sign-in vs sign-up on the landing page.
    const known = await request(app).get(`/api/v1/invitations/lookup/${knownToken}`);
    expect(known.body.invitation.accountExists).toBe(true);

    const unknown = await request(app).get(`/api/v1/invitations/lookup/${unknownToken}`);
    expect(unknown.body.invitation.accountExists).toBe(false);
  });

  it('reports a revoked invitation as not actionable rather than 404', async () => {
    const owner = await registerAndLogin('look-revoked');
    const ws = await createWorkspace(owner, { name: 'Revoked Co' });
    const workspaceId = ws.body.workspace.id;
    const token = await inviteAndGetToken(owner, workspaceId, 'gone@test.fritlow');

    const list = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(auth(owner));
    await request(app)
      .delete(`/api/v1/workspaces/${workspaceId}/invitations/${list.body.invitations[0].id}`)
      .set(auth(owner));

    // The page needs a specific message, not a generic failure.
    const res = await request(app).get(`/api/v1/invitations/lookup/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe('REVOKED');
    expect(res.body.invitation.actionable).toBe(false);
  });

  it('404s on an unknown token', async () => {
    const res = await request(app).get('/api/v1/invitations/lookup/not-a-real-token');
    expect(res.status).toBe(404);
  });

  it('lets the invitee accept straight from the link token', async () => {
    const owner = await registerAndLogin('look-accept');
    const invitee = await registerAndLogin('look-accept-target');
    const ws = await createWorkspace(owner, { name: 'Clickthrough Co' });
    const workspaceId = ws.body.workspace.id;
    const token = await inviteAndGetToken(owner, workspaceId, invitee.email);

    const res = await request(app)
      .post('/api/v1/invitations/accept')
      .set(auth(invitee))
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.workspace.name).toBe('Clickthrough Co');
    expect(
      await prisma.workspaceMember.count({ where: { workspaceId, userId: invitee.id } }),
    ).toBe(1);
  });

  it('refuses a token accepted while signed in as somebody else', async () => {
    const owner = await registerAndLogin('look-wrong');
    const invitee = await registerAndLogin('look-wrong-target');
    const other = await registerAndLogin('look-wrong-other');
    const ws = await createWorkspace(owner, { name: 'Wrong Account Co' });
    const workspaceId = ws.body.workspace.id;
    const token = await inviteAndGetToken(owner, workspaceId, invitee.email);

    // The landing page catches this case first by comparing lookup.email to
    // the session; the API refuses it regardless.
    const res = await request(app)
      .post('/api/v1/invitations/accept')
      .set(auth(other))
      .send({ token });

    expect(res.status).toBe(404);
    expect(
      await prisma.workspaceMember.count({ where: { workspaceId, userId: other.id } }),
    ).toBe(0);
  });

  it('does NOT let a forwarded invite be redeemed by a different email at signup', async () => {
    const owner = await registerAndLogin('fwd-owner');
    const ws = await createWorkspace(owner, { name: 'Forwarded Co' });
    const workspaceId = ws.body.workspace.id;
    const token = await inviteAndGetToken(owner, workspaceId, 'intended@test.fritlow');

    // Someone forwards the email; the recipient registers with their own address.
    const res = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Opportunist Person',
      email: 'opportunist@test.fritlow',
      password: 'test-password-123',
      invitationToken: token,
    });
    expect(res.status).toBe(201);

    // Registration succeeds — a bad token must never cost someone their
    // account — but it buys no access to the workspace.
    const joined = await prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email: 'opportunist@test.fritlow' } },
    });
    expect(joined).toBeNull();

    // And the invitation is still waiting for the person it was addressed to.
    const invitation = await prisma.workspaceInvitation.findFirst({ where: { workspaceId } });
    expect(invitation?.status).toBe('PENDING');
  });

  it('joins the workspace when the invited address registers with the token', async () => {
    const owner = await registerAndLogin('fwd-ok-owner');
    const ws = await createWorkspace(owner, { name: 'Intended Co' });
    const workspaceId = ws.body.workspace.id;
    const token = await inviteAndGetToken(owner, workspaceId, 'intended2@test.fritlow');

    const res = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Intended Person',
      email: 'intended2@test.fritlow',
      password: 'test-password-123',
      invitationToken: token,
    });
    expect(res.status).toBe(201);

    const joined = await waitFor(() =>
      prisma.workspaceMember.findMany({
        where: { workspaceId, user: { email: 'intended2@test.fritlow' } },
      }),
    );
    expect(joined).toHaveLength(1);
  });
});

describe('Membership invariants', () => {
  it('never lets the last owner be demoted or removed', async () => {
    const owner = await registerAndLogin('own-last');
    const ws = await createWorkspace(owner, { name: 'Solo Owner Co' });
    const workspaceId = ws.body.workspace.id;

    const demote = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${owner.id}`)
      .set(auth(owner))
      .send({ role: 'MEMBER' });
    expect(demote.status).toBe(400);

    const remove = await request(app)
      .delete(`/api/v1/workspaces/${workspaceId}/members/${owner.id}`)
      .set(auth(owner));
    expect(remove.status).toBe(400);

    const leave = await request(app)
      .delete(`/api/v1/workspaces/${workspaceId}/members/me`)
      .set(auth(owner));
    expect(leave.status).toBe(400);
  });

  it('lets a member leave, and clears their default if it pointed there', async () => {
    const owner = await registerAndLogin('leave-owner');
    const member = await registerAndLogin('leave-member');
    const ws = await createWorkspace(owner, { name: 'Leavable Co' });
    const workspaceId = ws.body.workspace.id;
    await inviteAndAccept(owner, workspaceId, member);

    // Force the awkward case: their default points at the workspace they leave.
    await prisma.user.update({
      where: { id: member.id },
      data: { defaultWorkspaceId: workspaceId },
    });

    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspaceId}/members/me`)
      .set(auth(member));
    expect(res.status).toBe(204);

    // A dangling default would make their next project create fail obscurely.
    const after = await prisma.user.findUnique({ where: { id: member.id } });
    expect(after?.defaultWorkspaceId).toBeNull();
  });
});

describe('Deleting a workspace', () => {
  function deleteWorkspace(user: TestUser, workspaceId: string, body: Record<string, unknown>) {
    return request(app)
      .delete(`/api/v1/workspaces/${workspaceId}`)
      .set(auth(user))
      .send(body);
  }

  it('refuses unless the name is typed exactly', async () => {
    const user = await registerAndLogin('del-name');
    const ws = await createWorkspace(user, { name: 'Acme Product Team' });
    const workspaceId = ws.body.workspace.id;

    // Close but not exact — the realistic mistake is deleting the WRONG
    // workspace, so a near-miss must fail rather than be helpfully accepted.
    const res = await deleteWorkspace(user, workspaceId, { confirmName: 'acme product team' });
    expect(res.status).toBe(400);
    expect(await prisma.workspace.findUnique({ where: { id: workspaceId } })).not.toBeNull();
  });

  it('refuses to delete the only workspace you own', async () => {
    const user = await registerAndLogin('del-last');

    // The workspace created at registration is their only one. Its name comes
    // from the helper's fullName ("Test User") → "Test's Workspace".
    const res = await deleteWorkspace(user, user.workspaceId, {
      confirmName: "Test's Workspace",
    });
    expect(res.status).toBe(400);
    expect(await prisma.workspace.findUnique({ where: { id: user.workspaceId } })).not.toBeNull();
  });

  it('refuses to delete your default without a replacement', async () => {
    const user = await registerAndLogin('del-default');
    const ws = await createWorkspace(user, { name: 'Second Space' });

    // Make the new one their default, then try to delete it.
    await request(app)
      .post(`/api/v1/workspaces/${ws.body.workspace.id}/set-default`)
      .set(auth(user));

    const res = await deleteWorkspace(user, ws.body.workspace.id, { confirmName: 'Second Space' });
    expect(res.status).toBe(400);

    const withReplacement = await deleteWorkspace(user, ws.body.workspace.id, {
      confirmName: 'Second Space',
      newDefaultWorkspaceId: user.workspaceId,
    });
    expect(withReplacement.status).toBe(204);

    // The pointer must land on the nominated workspace, never be left null.
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.defaultWorkspaceId).toBe(user.workspaceId);
  });

  it('will not accept a replacement default you do not own', async () => {
    const user = await registerAndLogin('del-badreplace');
    const stranger = await registerAndLogin('del-badreplace-stranger');
    const ws = await createWorkspace(user, { name: 'Doomed Space' });
    await request(app)
      .post(`/api/v1/workspaces/${ws.body.workspace.id}/set-default`)
      .set(auth(user));

    const res = await deleteWorkspace(user, ws.body.workspace.id, {
      confirmName: 'Doomed Space',
      newDefaultWorkspaceId: stranger.workspaceId,
    });

    expect(res.status).toBe(400);
  });

  it('refuses when the caller is not the owner', async () => {
    const owner = await registerAndLogin('del-notowner');
    const admin = await registerAndLogin('del-notowner-admin');
    const ws = await createWorkspace(owner, { name: 'Guarded Co' });
    await inviteAndAccept(owner, ws.body.workspace.id, admin, 'ADMIN');

    // Even an ADMIN cannot destroy the workspace and everyone's projects.
    const res = await deleteWorkspace(admin, ws.body.workspace.id, { confirmName: 'Guarded Co' });
    expect(res.status).toBe(403);
    expect(
      await prisma.workspace.findUnique({ where: { id: ws.body.workspace.id } }),
    ).not.toBeNull();
  });

  it('destroys the workspace with its projects and notifies the other members', async () => {
    const owner = await registerAndLogin('del-ok');
    const member = await registerAndLogin('del-ok-member');
    const ws = await createWorkspace(owner, { name: 'Doomed Co' });
    const workspaceId = ws.body.workspace.id;
    await inviteAndAccept(owner, workspaceId, member);

    const project = await request(app)
      .post('/api/v1/projects')
      .set(auth(owner))
      .send({ name: 'Doomed Project', oneLineIdea: 'about to vanish', workspaceId });

    const res = await deleteWorkspace(owner, workspaceId, { confirmName: 'Doomed Co' });
    expect(res.status).toBe(204);

    // The cascade takes the projects with it — this is not "remove from list".
    expect(await prisma.workspace.findUnique({ where: { id: workspaceId } })).toBeNull();
    expect(
      await prisma.project.findUnique({ where: { id: project.body.project.id } }),
    ).toBeNull();

    // Their work is gone and nothing survives to link to, so the notification
    // is the only record the other member gets.
    const notifications = await waitFor(() =>
      prisma.notification.findMany({ where: { userId: member.id, type: 'WORKSPACE_DELETED' } }),
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toContain('Doomed Co');
  });

  it('previews what would be destroyed without destroying it', async () => {
    const owner = await registerAndLogin('del-preview');
    const member = await registerAndLogin('del-preview-member');
    const ws = await createWorkspace(owner, { name: 'Preview Co' });
    const workspaceId = ws.body.workspace.id;
    await inviteAndAccept(owner, workspaceId, member);

    for (const name of ['A', 'B']) {
      await request(app)
        .post('/api/v1/projects')
        .set(auth(owner))
        .send({ name, oneLineIdea: 'idea', workspaceId });
    }

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/delete-preview`)
      .set(auth(owner));

    expect(res.status).toBe(200);
    expect(res.body.projectCount).toBe(2);
    expect(res.body.otherMembers.count).toBe(1);
    expect(res.body.isLastOwnedWorkspace).toBe(false);
    expect(await prisma.workspace.findUnique({ where: { id: workspaceId } })).not.toBeNull();
  });
});

describe('Converting a workspace', () => {
  it('refuses to make a workspace private while others are still in it', async () => {
    const owner = await registerAndLogin('conv-blocked');
    const member = await registerAndLogin('conv-blocked-member');
    const ws = await createWorkspace(owner, { name: 'Populated Co' });
    const workspaceId = ws.body.workspace.id;
    await inviteAndAccept(owner, workspaceId, member);

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/convert-to-private`)
      .set(auth(owner));

    // Silently ejecting them would revoke access to every project in here.
    expect(res.status).toBe(400);
    expect(
      await prisma.workspaceMember.count({ where: { workspaceId, userId: member.id } }),
    ).toBe(1);
  });

  it('makes a sole-member workspace private and revokes its pending invites', async () => {
    const owner = await registerAndLogin('conv-ok');
    const pendingInvitee = await registerAndLogin('conv-ok-pending');
    const ws = await createWorkspace(owner, { name: 'Closing Co' });
    const workspaceId = ws.body.workspace.id;
    await invite(owner, workspaceId, pendingInvitee.email);

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/convert-to-private`)
      .set(auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.workspace.isPrivate).toBe(true);

    // An invite accepted after the change would put a member inside a private
    // workspace — a contradiction, so they are revoked with it.
    const invitation = await prisma.workspaceInvitation.findFirst({ where: { workspaceId } });
    expect(invitation?.status).toBe('REVOKED');
  });

  it('repoints the default when the converted workspace was the default', async () => {
    const user = await registerAndLogin('conv-default');

    const res = await request(app)
      .post(`/api/v1/workspaces/${user.workspaceId}/convert-to-shared`)
      .set(auth(user));
    expect(res.status).toBe(200);

    // Without the repoint, every new project would land in the workspace they
    // just opened up to invitees.
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.defaultWorkspaceId).not.toBe(user.workspaceId);
    expect(after?.defaultWorkspaceId).toBe(res.body.personalWorkspace.id);
  });
});
