import { app } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Fritlow API running at http://localhost:${env.PORT}`);
  console.log(`📚 API docs at http://localhost:${env.PORT}/docs`);
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
