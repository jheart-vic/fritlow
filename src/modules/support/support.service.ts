import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { notify } from '../notifications/notification.service';
import type {
  ListConversationsQuery,
  PostMessageInput,
  StartConversationInput,
  UpdateConversationInput,
} from './support.schemas';

// Human support chat between an end user (the "customer") and Fritlow staff.
// Delivery is poll-based for V1 (no SSE). Read state is two timestamps on the
// conversation — each side's "last read" — which we keep current on send/view so
// an unread flag is a pure timestamp comparison (no per-message read rows).

const customerSelect = {
  customer: { select: { id: true, fullName: true, email: true } },
} as const;

const messageSelect = {
  id: true,
  body: true,
  senderType: true,
  senderId: true,
  createdAt: true,
  sender: { select: { id: true, fullName: true } },
} as const;

type ConversationRow = {
  id: string;
  subject: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  userLastReadAt: Date | null;
  staffLastReadAt: Date | null;
  assignedAdminId: string | null;
  customer?: { id: string; fullName: string; email: string };
};

// "Unread for me" = the latest message landed after I last read. Because we bump
// MY lastReadAt whenever I send, my own messages never show as unread.
function unreadFor(side: 'user' | 'staff', c: ConversationRow): boolean {
  const lastRead = side === 'user' ? c.userLastReadAt : c.staffLastReadAt;
  return !lastRead || c.lastMessageAt > lastRead;
}

function serialize(side: 'user' | 'staff', c: ConversationRow) {
  return {
    id: c.id,
    subject: c.subject,
    status: c.status,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    assignedAdminId: c.assignedAdminId,
    hasUnread: unreadFor(side, c),
    ...(side === 'staff' && c.customer ? { customer: c.customer } : {}),
  };
}

// ---- User side --------------------------------------------------------------

export async function startConversation(userId: string, input: StartConversationInput) {
  const now = new Date();
  const conversation = await prisma.supportConversation.create({
    data: {
      customerId: userId,
      subject: input.subject ?? null,
      lastMessageAt: now,
      userLastReadAt: now, // the creator has obviously read their own opener
      messages: { create: { body: input.message, senderType: 'USER', senderId: userId } },
    },
  });
  return serialize('user', conversation);
}

export async function listMyConversations(userId: string) {
  const rows = await prisma.supportConversation.findMany({
    where: { customerId: userId },
    orderBy: { lastMessageAt: 'desc' },
  });
  return rows.map((c) => serialize('user', c));
}

async function getOwnedConversation(userId: string, conversationId: string) {
  const c = await prisma.supportConversation.findUnique({ where: { id: conversationId } });
  if (!c || c.customerId !== userId) {
    throw ApiError.notFound('Conversation not found');
  }
  return c;
}

export async function getMyConversation(userId: string, conversationId: string) {
  await getOwnedConversation(userId, conversationId);
  // Viewing marks it read for the user.
  const c = await prisma.supportConversation.update({
    where: { id: conversationId },
    data: { userLastReadAt: new Date() },
    include: { messages: { orderBy: { createdAt: 'asc' }, select: messageSelect } },
  });
  return { ...serialize('user', c), messages: c.messages };
}

export async function postUserMessage(
  userId: string,
  conversationId: string,
  input: PostMessageInput,
) {
  const conversation = await getOwnedConversation(userId, conversationId);
  const now = new Date();
  const message = await prisma.supportMessage.create({
    data: { conversationId, body: input.body, senderType: 'USER', senderId: userId },
    select: messageSelect,
  });
  // A user reply reopens a closed thread and marks it read for them.
  await prisma.supportConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now, userLastReadAt: now, status: 'OPEN' },
  });
  // Notify the staff member who owns the thread, if one has claimed it.
  if (conversation.assignedAdminId && conversation.assignedAdminId !== userId) {
    notify({
      userId: conversation.assignedAdminId,
      type: 'SUPPORT_REPLY',
      title: 'New reply in a support conversation',
      body: input.body.slice(0, 120),
      data: { conversationId },
    });
  }
  return message;
}

// ---- Staff side -------------------------------------------------------------

export async function listAllConversations(query: ListConversationsQuery) {
  const { status, page, limit } = query;
  const where = status ? { status } : {};
  const [total, rows] = await Promise.all([
    prisma.supportConversation.count({ where }),
    prisma.supportConversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: customerSelect,
    }),
  ]);
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    conversations: rows.map((c) => serialize('staff', c)),
  };
}

export async function getConversationAsStaff(conversationId: string) {
  const existing = await prisma.supportConversation.findUnique({ where: { id: conversationId } });
  if (!existing) {
    throw ApiError.notFound('Conversation not found');
  }
  const c = await prisma.supportConversation.update({
    where: { id: conversationId },
    data: { staffLastReadAt: new Date() },
    include: {
      ...customerSelect,
      messages: { orderBy: { createdAt: 'asc' }, select: messageSelect },
    },
  });
  return { ...serialize('staff', c), messages: c.messages };
}

export async function postStaffMessage(
  adminId: string,
  conversationId: string,
  input: PostMessageInput,
) {
  const existing = await prisma.supportConversation.findUnique({ where: { id: conversationId } });
  if (!existing) {
    throw ApiError.notFound('Conversation not found');
  }
  const now = new Date();
  const message = await prisma.supportMessage.create({
    data: { conversationId, body: input.body, senderType: 'STAFF', senderId: adminId },
    select: messageSelect,
  });
  await prisma.supportConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: now,
      staffLastReadAt: now,
      // First staff reply claims the thread if nobody has yet.
      ...(existing.assignedAdminId ? {} : { assignedAdminId: adminId }),
    },
  });
  // Let the customer know support responded.
  notify({
    userId: existing.customerId,
    type: 'SUPPORT_REPLY',
    title: 'Support replied to your conversation',
    body: input.body.slice(0, 120),
    data: { conversationId },
  });
  return message;
}

export async function updateConversation(
  conversationId: string,
  input: UpdateConversationInput,
) {
  const existing = await prisma.supportConversation.findUnique({ where: { id: conversationId } });
  if (!existing) {
    throw ApiError.notFound('Conversation not found');
  }
  const c = await prisma.supportConversation.update({
    where: { id: conversationId },
    data: { status: input.status },
    include: customerSelect,
  });
  return serialize('staff', c);
}
