import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../app';
import { registerAndLogin, type TestUser } from '../../test/helpers';
import { assembleBasePlan, coreQuestions } from './questions';

// In the test env there is no AI key, so generateQuestionPlan falls back to the
// deterministic base plan (assembleBasePlan). That makes the whole adaptive
// interview testable WITHOUT any AI call: we know exactly which questions a
// session will have from the project's category.

async function createProject(user: TestUser, category?: string) {
  const res = await request(app)
    .post('/api/v1/projects')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({ name: 'Test Idea', oneLineIdea: 'A tool that does a useful thing', category });
  expect(res.status).toBe(201);
  return res.body.project.id as string;
}

function bearer(user: TestUser) {
  return ['Authorization', `Bearer ${user.accessToken}`] as [string, string];
}

describe('Discovery (adaptive plan)', () => {
  it('start builds a per-project plan (fallback = base plan) and returns it', async () => {
    const user = await registerAndLogin('disc');
    const projectId = await createProject(user, 'SaaS');

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery`)
      .set(...bearer(user));

    expect(res.status).toBe(201);
    // SaaS project → core questions + the saas category pack.
    const expected = assembleBasePlan('SaaS');
    expect(res.body.total).toBe(expected.length);
    expect(res.body.questions).toHaveLength(expected.length);
    // The saas pack got pulled in.
    const ids = res.body.questions.map((q: { id: string }) => q.id);
    expect(ids).toContain('pack.saas.approver');
    // nextQuestion is the first plan question, nothing answered yet.
    expect(res.body.answered).toBe(0);
    expect(res.body.nextQuestion.id).toBe(expected[0]!.id);
  });

  it('a project with no category gets just the core questions', async () => {
    const user = await registerAndLogin('disc-nocat');
    const projectId = await createProject(user);

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery`)
      .set(...bearer(user));
    expect(res.body.total).toBe(coreQuestions.length);
  });

  it('rejects starting a second session with 409', async () => {
    const user = await registerAndLogin('disc-dup');
    const projectId = await createProject(user);
    await request(app).post(`/api/v1/projects/${projectId}/discovery`).set(...bearer(user));

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery`)
      .set(...bearer(user));
    expect(res.status).toBe(409);
  });

  it('accepts answers to plan questions and advances progress', async () => {
    const user = await registerAndLogin('disc-answer');
    const projectId = await createProject(user);
    const start = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery`)
      .set(...bearer(user));
    const firstId = start.body.questions[0].id as string;

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery/answers`)
      .set(...bearer(user))
      .send({ questionId: firstId, answer: 'A concrete, specific answer.' });
    expect(res.status).toBe(200);
    expect(res.body.answered).toBe(1);
    expect(res.body.total).toBe(start.body.total);
    // nextQuestion moved on to the second plan question.
    expect(res.body.nextQuestion.id).toBe(start.body.questions[1].id);
  });

  it('rejects an answer to a questionId not in the plan with 400', async () => {
    const user = await registerAndLogin('disc-badq');
    const projectId = await createProject(user);
    await request(app).post(`/api/v1/projects/${projectId}/discovery`).set(...bearer(user));

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery/answers`)
      .set(...bearer(user))
      .send({ questionId: 'not.a.real.question', answer: 'hello' });
    expect(res.status).toBe(400);
  });

  it('blocks completion until every plan question is answered, then completes', async () => {
    const user = await registerAndLogin('disc-complete');
    const projectId = await createProject(user);
    const start = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery`)
      .set(...bearer(user));
    const questions = start.body.questions as Array<{ id: string }>;

    // Too early: nothing answered.
    const early = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery/complete`)
      .set(...bearer(user));
    expect(early.status).toBe(400);

    // Answer every question in the plan.
    for (const q of questions) {
      const r = await request(app)
        .post(`/api/v1/projects/${projectId}/discovery/answers`)
        .set(...bearer(user))
        .send({ questionId: q.id, answer: `Answer for ${q.id}` });
      expect(r.status).toBe(200);
    }

    const done = await request(app)
      .post(`/api/v1/projects/${projectId}/discovery/complete`)
      .set(...bearer(user));
    expect(done.status).toBe(200);
    expect(done.body.session.status).toBe('COMPLETED');
  });
});
