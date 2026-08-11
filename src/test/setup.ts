import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma';

// Wipe every table before each test so tests never see each other's rows and
// can run in any order. We discover table names from Postgres itself (rather
// than hard-coding them) so new Prisma models are covered automatically.
//
// TRUNCATE ... RESTART IDENTITY CASCADE empties the tables and follows foreign
// keys, so we don't have to delete in dependency order. `_prisma_migrations` is
// excluded — that's the migration ledger, not application data.
export async function resetDb(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;

  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await resetDb();
});

// Close the pooled DB connection once a file's tests finish, so Vitest can exit
// cleanly instead of hanging on an open handle.
afterAll(async () => {
  await prisma.$disconnect();
});
