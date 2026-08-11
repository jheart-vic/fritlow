import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../app';
import { prisma } from '../../lib/prisma';
import { hashToken } from '../../utils/tokens';
import { registerAndLogin, uniqueEmail } from '../../test/helpers';

describe('Auth', () => {
  describe('POST /register', () => {
    it('creates the user + a personal workspace, and issues NO session tokens', async () => {
      const email = uniqueEmail('reg');
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password: 'test-password-123', fullName: 'Ada Lovelace' });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.emailVerified).toBe(false);
      // The login gate depends on registration NOT logging you in.
      expect(res.body.accessToken).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();

      // Registration creates the user as OWNER of a fresh personal workspace.
      const membership = await prisma.workspaceMember.findFirst({
        where: { user: { email }, role: 'OWNER' },
      });
      expect(membership).not.toBeNull();
    });

    it('rejects a duplicate email with 409', async () => {
      const email = uniqueEmail('dup');
      const body = { email, password: 'test-password-123', fullName: 'First' };
      await request(app).post('/api/v1/auth/register').send(body);

      const res = await request(app).post('/api/v1/auth/register').send(body);
      expect(res.status).toBe(409);
    });

    it('rejects a too-short password with 400 (zod validation)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail('short'), password: 'x', fullName: 'Nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /login', () => {
    it('blocks an unverified account with 403', async () => {
      const email = uniqueEmail('unverified');
      await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password: 'test-password-123', fullName: 'Unverified' });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'test-password-123' });
      expect(res.status).toBe(403);
    });

    it('logs in a verified user: 200 + access token + refresh cookie', async () => {
      const user = await registerAndLogin('login');
      expect(user.accessToken).toBeTruthy();

      // Re-login directly to inspect the cookie the helper doesn't surface.
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('fritlow_rt='))).toBe(true);
    });

    it('rejects a wrong password with 401', async () => {
      const user = await registerAndLogin('wrongpw');
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'not-the-password' });
      expect(res.status).toBe(401);
    });

    it('returns the same 401 for an unknown email (no account enumeration)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('ghost'), password: 'whatever-123' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /verify-email', () => {
    it('verifies with a valid token, then rejects the same token on reuse', async () => {
      const email = uniqueEmail('verify');
      const reg = await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password: 'test-password-123', fullName: 'Verify Me' });
      const userId: string = reg.body.user.id;

      // Seed a verification token with a raw value we control (the API never
      // reveals the real one — it goes out by email only).
      const rawToken = 'known-raw-verification-token';
      await prisma.emailVerificationToken.create({
        data: {
          tokenHash: hashToken(rawToken),
          userId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const ok = await request(app).post('/api/v1/auth/verify-email').send({ token: rawToken });
      expect(ok.status).toBe(200);
      expect(ok.body.user.emailVerified).toBe(true);

      const reuse = await request(app).post('/api/v1/auth/verify-email').send({ token: rawToken });
      expect(reuse.status).toBe(400);
    });

    it('rejects an unknown token with 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: 'this-token-does-not-exist' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /refresh', () => {
    it('rotates the refresh token — the old one stops working', async () => {
      const user = await registerAndLogin('refresh');
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password });
      const firstCookie = (login.headers['set-cookie'] as unknown as string[])[0];

      // First refresh succeeds and issues a NEW cookie.
      const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstCookie);
      expect(first.status).toBe(200);
      expect(first.body.accessToken).toBeTruthy();

      // Replaying the ORIGINAL (now-rotated) cookie must fail.
      const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstCookie);
      expect(replay.status).toBe(401);
    });
  });

  describe('GET /me', () => {
    it('returns the current user with a valid token', async () => {
      const user = await registerAndLogin('me');
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(user.email);
    });

    it('rejects a missing token with 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects a garbage token with 401', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-real-jwt');
      expect(res.status).toBe(401);
    });
  });
});
