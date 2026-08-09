import { app } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { seedPlatformAdmin } from './modules/admin/admin.seed';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Fritlow API running at http://localhost:${env.PORT}`);
  console.log(`📚 API docs at http://localhost:${env.PORT}/docs`);
  // Ensure the platform admin exists (from env). Fire-and-forget + idempotent —
  // it never blocks serving requests and logs its own result.
  void seedPlatformAdmin();
});

// Graceful shutdown: finish in-flight requests, close DB connections.
async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down…`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
