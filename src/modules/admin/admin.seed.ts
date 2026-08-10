import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { hashPassword } from '../../utils/password';

// Provision the platform SUPERADMIN from env on startup. This account NEVER
// registers — it just logs in with ADMIN_EMAIL / ADMIN_PASSWORD via the normal
// /auth/login. .env is the source of truth: each boot re-syncs the password,
// role, and verified state (so rotating the env password + restart rotates it),
// and a normal registration can never mint or promote to this role.
// Best-effort: a failure here is logged, never fatal to boot.
export async function seedPlatformAdmin(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.warn('[admin] ADMIN_EMAIL/ADMIN_PASSWORD not set — no platform admin seeded');
    return;
  }

  const email = env.ADMIN_EMAIL.toLowerCase();
  try {
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, platformRole: 'SUPERADMIN', emailVerifiedAt: new Date() },
      create: {
        email,
        fullName: env.ADMIN_NAME,
        passwordHash,
        platformRole: 'SUPERADMIN',
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`[admin] platform SUPERADMIN ready: ${email}`);
  } catch (err) {
    console.error('[admin] failed to seed platform admin:', err);
  }
}
