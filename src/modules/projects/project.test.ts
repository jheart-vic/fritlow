import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../app';
import { registerAndLogin } from '../../test/helpers';

// Helper: create a project as a given user and return the response.
function createProject(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/projects')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

describe('Projects', () => {
  it('creates a project in the user personal workspace, in DRAFT status', async () => {
    const user = await registerAndLogin('proj');
    const res = await createProject(user.accessToken, {
      name: 'Fritlow',
      oneLineIdea: 'Turn one-line ideas into build-ready blueprints',
    });

    expect(res.status).toBe(201);
    expect(res.body.project.name).toBe('Fritlow');
    expect(res.body.project.status).toBe('DRAFT');
    expect(res.body.project.workspaceId).toBe(user.workspaceId);
    // Every project response embeds who created it.
    expect(res.body.project.createdBy.email).toBe(user.email);
  });

  it('rejects creation without a token (401)', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .send({ name: 'X', oneLineIdea: 'y' });
    expect(res.status).toBe(401);
  });

  it('rejects creation with a missing required field (400)', async () => {
    const user = await registerAndLogin('proj-invalid');
    const res = await createProject(user.accessToken, { name: 'No idea given' });
    expect(res.status).toBe(400);
  });

  it('lists only the caller own projects and supports the status filter', async () => {
    const user = await registerAndLogin('proj-list');
    await createProject(user.accessToken, { name: 'A', oneLineIdea: 'idea a' });
    const b = await createProject(user.accessToken, { name: 'B', oneLineIdea: 'idea b' });

    // Move B to DISCOVERY so we can filter by status.
    await request(app)
      .patch(`/api/v1/projects/${b.body.project.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ status: 'DISCOVERY' });

    const all = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(all.status).toBe(200);
    expect(all.body.projects).toHaveLength(2);

    const discovery = await request(app)
      .get('/api/v1/projects?status=DISCOVERY')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(discovery.body.projects).toHaveLength(1);
    expect(discovery.body.projects[0].name).toBe('B');
  });

  it('updates a project (partial patch)', async () => {
    const user = await registerAndLogin('proj-update');
    const created = await createProject(user.accessToken, { name: 'Old', oneLineIdea: 'idea' });

    const res = await request(app)
      .patch(`/api/v1/projects/${created.body.project.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe('New Name');
    expect(res.body.project.oneLineIdea).toBe('idea'); // untouched
  });

  it('deletes a project as its owner (204), then it is gone (404)', async () => {
    const user = await registerAndLogin('proj-delete');
    const created = await createProject(user.accessToken, { name: 'Doomed', oneLineIdea: 'idea' });
    const id = created.body.project.id;

    const del = await request(app)
      .delete(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(del.status).toBe(204);

    const get = await request(app)
      .get(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(get.status).toBe(404);
  });

  describe('tenancy — a different user must not see or touch your projects', () => {
    it('returns 403 when a non-member reads, updates, or deletes another user project', async () => {
      const owner = await registerAndLogin('owner');
      const outsider = await registerAndLogin('outsider');

      const created = await createProject(owner.accessToken, {
        name: 'Private',
        oneLineIdea: 'secret idea',
      });
      const id = created.body.project.id;

      const read = await request(app)
        .get(`/api/v1/projects/${id}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(read.status).toBe(403);

      const update = await request(app)
        .patch(`/api/v1/projects/${id}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ name: 'Hijacked' });
      expect(update.status).toBe(403);

      const del = await request(app)
        .delete(`/api/v1/projects/${id}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(del.status).toBe(403);
    });

    it('does not include another user projects in the list', async () => {
      const owner = await registerAndLogin('list-owner');
      const outsider = await registerAndLogin('list-outsider');
      await createProject(owner.accessToken, { name: 'Owned', oneLineIdea: 'idea' });

      const list = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(list.status).toBe(200);
      expect(list.body.projects).toHaveLength(0);
    });

    it('returns 404 for a project id that does not exist', async () => {
      const user = await registerAndLogin('notfound');
      const res = await request(app)
        .get('/api/v1/projects/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(res.status).toBe(404);
    });
  });
});
