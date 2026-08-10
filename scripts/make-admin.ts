// Grant (or change) a user's platform role — the way to add Fritlow SUPPORT
// staff (the SUPERADMIN is seeded from .env, not here). Platform roles are never
// self-serve. Note: this is separate from workspace roles (OWNER/ADMIN/MEMBER).
//
//   npx tsx scripts/make-admin.ts <email> [SUPPORT|SUPERADMIN|USER]
//
// Defaults to SUPPORT. Use USER to demote someone back to a normal account.
import { prisma } from '../src/lib/prisma';

const VALID = ['SUPERADMIN', 'SUPPORT', 'USER'] as const;
type Role = (typeof VALID)[number];

async function main() {
  const email = process.argv[2]?.toLowerCase();
  const role = (process.argv[3] ?? 'SUPPORT').toUpperCase() as Role;

  if (!email) {
    console.error('Usage: npx tsx scripts/make-admin.ts <email> [SUPPORT|SUPERADMIN|USER]');
    process.exit(1);
  }
  if (!VALID.includes(role)) {
    console.error(`Invalid role "${role}". Must be one of: ${VALID.join(', ')}`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  await prisma.user.update({ where: { email }, data: { platformRole: role } });
  console.log(`✔ ${email} is now platformRole=${role}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
