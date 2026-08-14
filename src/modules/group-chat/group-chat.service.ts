import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { notify } from '../notifications/notification.service';
import { emitToChannel } from '../../realtime/io';
import type {
  CreateChannelInput,
  ListMessagesQuery,
  PostGroupMessageInput,
  UpdateChannelInput,
} from './group-chat.schemas';

// Workspace team chat. Public channels (all workspace members can see all
// channels). Durable history + unread live here; live delivery is via Socket.io
// (emitToChannel after each persisted message).

const messageSelect = {
  id: true,
  body: true,
  channelId: true,
  senderId: true,
  createdAt: true,
  sender: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

// Membership gate — you must belong to the workspace. Returns the member (role).
async function assertMember(userId: string, workspaceId: string) {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!member) throw ApiError.forbidden('You are not a member of this workspace');
  return member;
}

// Load a channel and confirm it belongs to the given workspace (else 404).
async function getChannelInWorkspace(workspaceId: string, channelId: string) {
  const channel = await prisma.groupChannel.findUnique({ where: { id: channelId } });
  if (!channel || channel.workspaceId !== workspaceId) {
    throw ApiError.notFound('Channel not found in this workspace');
  }
  return channel;
}

// Channel names are unique per workspace at the database level. Prisma reports
// that as P2002; without this it surfaces as an unhandled 500. Catching the
// database error rather than pre-checking with a findFirst is deliberate — a
// pre-check is a race (two concurrent creates both see the name free), while
// the unique index is the only thing that sees across concurrent writers.
function isDuplicateName(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

const DUPLICATE_NAME_MESSAGE = 'A channel with that name already exists in this workspace';

export async function createChannel(userId: string, workspaceId: string, input: CreateChannelInput) {
  await assertMember(userId, workspaceId);
  try {
    return await prisma.groupChannel.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description ?? null,
        createdById: userId,
      },
    });
  } catch (err) {
    if (isDuplicateName(err)) throw ApiError.conflict(DUPLICATE_NAME_MESSAGE);
    throw err;
  }
}

export async function listChannels(userId: string, workspaceId: string) {
  await assertMember(userId, workspaceId);
  const [channels, reads] = await Promise.all([
    prisma.groupChannel.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }),
    prisma.groupChannelRead.findMany({ where: { userId, channel: { workspaceId } } }),
  ]);
  const readByChannel = new Map(reads.map((r) => [r.channelId, r.lastReadAt]));
  return channels.map((c) => {
    const lastRead = readByChannel.get(c.id);
    return { ...c, hasUnread: !lastRead || c.lastMessageAt > lastRead };
  });
}

export async function updateChannel(
  userId: string,
  workspaceId: string,
  channelId: string,
  input: UpdateChannelInput,
) {
  const member = await assertMember(userId, workspaceId);
  const channel = await getChannelInWorkspace(workspaceId, channelId);
  assertCanManage(member.role, channel.createdById, userId);
  try {
    return await prisma.groupChannel.update({ where: { id: channel.id }, data: input });
  } catch (err) {
    // Renaming onto an existing name hits the same unique index as create.
    if (isDuplicateName(err)) throw ApiError.conflict(DUPLICATE_NAME_MESSAGE);
    throw err;
  }
}

export async function deleteChannel(userId: string, workspaceId: string, channelId: string) {
  const member = await assertMember(userId, workspaceId);
  const channel = await getChannelInWorkspace(workspaceId, channelId);
  assertCanManage(member.role, channel.createdById, userId);
  await prisma.groupChannel.delete({ where: { id: channel.id } });
}

// A channel may be managed by its creator or any workspace OWNER/ADMIN.
function assertCanManage(role: string, createdById: string | null, userId: string) {
  const isManager = role === 'OWNER' || role === 'ADMIN';
  if (createdById !== userId && !isManager) {
    throw ApiError.forbidden('Only the channel creator or a workspace owner/admin can do that');
  }
}

export async function listMessages(
  userId: string,
  workspaceId: string,
  channelId: string,
  query: ListMessagesQuery,
) {
  await assertMember(userId, workspaceId);
  await getChannelInWorkspace(workspaceId, channelId);

  // Newest `limit` (optionally older than `before`), then returned oldest→newest.
  const rows = await prisma.groupMessage.findMany({
    where: { channelId, ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    select: messageSelect,
  });
  // Viewing marks the channel read for this user.
  await markRead(userId, workspaceId, channelId);
  return rows.reverse();
}

export async function markRead(userId: string, workspaceId: string, channelId: string) {
  await getChannelInWorkspace(workspaceId, channelId);
  await prisma.groupChannelRead.upsert({
    where: { channelId_userId: { channelId, userId } },
    update: { lastReadAt: new Date() },
    create: { channelId, userId, lastReadAt: new Date() },
  });
}

export async function postMessage(
  userId: string,
  workspaceId: string,
  channelId: string,
  input: PostGroupMessageInput,
) {
  await assertMember(userId, workspaceId);
  const channel = await getChannelInWorkspace(workspaceId, channelId);
  const now = new Date();

  const message = await prisma.groupMessage.create({
    data: { channelId, senderId: userId, body: input.body },
    select: messageSelect,
  });
  await prisma.groupChannel.update({ where: { id: channelId }, data: { lastMessageAt: now } });
  // Sender has obviously read up to their own message.
  await prisma.groupChannelRead.upsert({
    where: { channelId_userId: { channelId, userId } },
    update: { lastReadAt: now },
    create: { channelId, userId, lastReadAt: now },
  });

  // Real-time push to everyone currently in the channel room.
  emitToChannel(channelId, 'message:new', message);

  // Notify @mentioned members (skip self; only real workspace members).
  if (input.mentions?.length) {
    const targets = [...new Set(input.mentions)].filter((id) => id !== userId);
    if (targets.length) {
      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId, userId: { in: targets } },
        select: { userId: true },
      });
      for (const m of members) {
        notify({
          userId: m.userId,
          type: 'GROUP_MENTION',
          title: `${message.sender.fullName} mentioned you in #${channel.name}`,
          body: input.body.slice(0, 120),
          data: { workspaceId, channelId, messageId: message.id },
        });
      }
    }
  }

  return message;
}
