import { createServer } from 'node:http';
import { app } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { seedPlatformAdmin } from './modules/admin/admin.seed';
import { initIO } from './realtime/io';

// Wrap Express in an http.Server so Socket.io can share the same port.
const server = createServer(app);

// Attach the real-time layer (group chat). Async because the Redis adapter
// (when REDIS_URL is set) is imported + connected on the way up.
void initIO(server).then(() => console.log('💬 Socket.io ready')).catch((err) =>
  console.error('[socket] init failed:', err),
);

server.listen(env.PORT, () => {
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
