import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';

// Shared test utilities. Kept tiny and explicit — a helper that hides too much
// makes failing tests hard to read.

export interface TestUser {
  id: string;
  email: string;
  password: string;
  fullName: string;
  accessToken: string;
  workspaceId: string; // the personal workspace created at registration
}

let counter = 0;

// A fresh, unique email per call so tests never collide on the unique(email).
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@test.fritlow`;
}

// Registers a user through the real API, then marks them verified DIRECTLY in
// the database (bypassing the emailed token) and logs in to get an access
// token. The verification *endpoint* is exercised separately in auth.test.ts;
// here we just need an authenticated user quickly.
export async function registerAndLogin(prefix = 'user'): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = 'test-password-123';
  const fullName = 'Test User';

  const registerRes = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, fullName });

  if (registerRes.status !== 201) {
    throw new Error(`registerAndLogin: register failed (${registerRes.status}): ${registerRes.text}`);
  }

  const userId: string = registerRes.body.user.id;

  // Skip the email round-trip: flip the verification flag straight in the DB.
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });

  if (loginRes.status !== 200) {
    throw new Error(`registerAndLogin: login failed (${loginRes.status}): ${loginRes.text}`);
  }

  // The user's personal workspace is the one they OWN.
  const membership = await prisma.workspaceMember.findFirstOrThrow({
    where: { userId, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
  });

  return {
    id: userId,
    email,
    password,
    fullName,
    accessToken: loginRes.body.accessToken,
    workspaceId: membership.workspaceId,
  };
}

// Convenience: the Authorization header for a test user.
export function authHeader(user: TestUser): [string, string] {
  return ['Authorization', `Bearer ${user.accessToken}`];
}
