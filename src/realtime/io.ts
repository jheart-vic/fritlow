import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../utils/tokens';

// The Socket.io layer for real-time group chat. Responsibilities:
//  - authenticate every socket with the same JWT access token as the REST API
//  - let a client join/leave a channel "room" (only if it's in the channel's
//    workspace) so broadcasts reach exactly the right members
//  - relay ephemeral typing indicators
// Message PERSISTENCE stays in the REST layer; after a message is saved, the
// group-chat service calls emitToChannel() to push it to everyone in the room.
//
// Scaling: with >1 server instance, an in-memory adapter can't broadcast across
// instances, so we attach the Redis adapter when REDIS_URL is set (add it at
// deploy). Single-instance dev works fine on the default in-memory adapter.

let io: SocketServer | null = null;

const channelRoom = (channelId: string) => `channel:${channelId}`;

export async function initIO(httpServer: HttpServer): Promise<SocketServer> {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    },
  });

  // Multi-instance fan-out via Redis (opt-in). Imported dynamically so the deps
  // aren't required at boot when REDIS_URL isn't set. Crucially, an unreachable
  // Redis must NEVER crash the API — we attach error handlers, fail the connect
  // fast, and fall back to the in-memory adapter (fine for a single instance).
  if (env.REDIS_URL?.trim()) {
    try {
      const [{ createAdapter }, { Redis }] = await Promise.all([
        import('@socket.io/redis-adapter'),
        import('ioredis'),
      ]);
      const opts = {
        lazyConnect: true, // don't connect until we call connect(), so we can catch failures
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
        retryStrategy: () => null, // don't retry forever; give up so we can fall back
      };
      const pub = new Redis(env.REDIS_URL.trim(), opts);
      const sub = pub.duplicate();
      // Without these, a later connection drop emits an unhandled 'error' → process exit.
      pub.on('error', (e: Error) => console.error('[socket] redis pub error:', e.message));
      sub.on('error', (e: Error) => console.error('[socket] redis sub error:', e.message));
      await Promise.all([pub.connect(), sub.connect()]); // throws quickly if unreachable
      io.adapter(createAdapter(pub, sub));
      console.log('[socket] Redis adapter attached (multi-instance broadcast)');
    } catch (err) {
      console.error(
        '[socket] Redis unreachable — using in-memory adapter (single-instance only):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Auth handshake: the client passes its access token as auth.token.
  io.use((socket, next) => {
    try {
      const token = (socket.handshake.auth?.token ?? '') as string;
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;

    // Join a channel room after verifying the user belongs to its workspace.
    // Always acks (even on error) so the client never hangs waiting.
    socket.on('channel:join', async (channelId: string, ack?: (ok: boolean) => void) => {
      try {
        const allowed = await canAccessChannel(userId, channelId);
        if (allowed) socket.join(channelRoom(channelId));
        ack?.(allowed);
      } catch (err) {
        console.error('[socket] channel:join failed:', err instanceof Error ? err.message : err);
        ack?.(false);
      }
    });

    socket.on('channel:leave', (channelId: string) => {
      socket.leave(channelRoom(channelId));
    });

    // Ephemeral typing indicator — relayed to others in the room, never stored.
    socket.on('channel:typing', (channelId: string) => {
      socket.to(channelRoom(channelId)).emit('channel:typing', { channelId, userId });
    });
  });

  return io;
}

// True if the user is a member of the workspace that owns the channel.
async function canAccessChannel(userId: string, channelId: string): Promise<boolean> {
  const channel = await prisma.groupChannel.findUnique({
    where: { id: channelId },
    select: { workspaceId: true },
  });
  if (!channel) return false;
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: channel.workspaceId } },
  });
  return !!member;
}

// Push an event to everyone currently in a channel's room. No-op if the socket
// server hasn't been initialised (e.g. during tests that import the app only).
export function emitToChannel(channelId: string, event: string, payload: unknown): void {
  io?.to(channelRoom(channelId)).emit(event, payload);
}

export function getIO(): SocketServer {
  if (!io) throw new Error('Socket.io not initialised');
  return io;
}
