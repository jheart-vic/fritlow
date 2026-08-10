import type { Request, Response } from 'express';
import { listMessagesQuerySchema } from './group-chat.schemas';
import * as groupChatService from './group-chat.service';

function workspaceId(req: Request): string {
  return req.params.workspaceId as string;
}

export async function createChannel(req: Request, res: Response) {
  const channel = await groupChatService.createChannel(req.user!.id, workspaceId(req), req.body);
  res.status(201).json({ channel });
}

export async function listChannels(req: Request, res: Response) {
  const channels = await groupChatService.listChannels(req.user!.id, workspaceId(req));
  res.status(200).json({ channels });
}

export async function updateChannel(req: Request, res: Response) {
  const channel = await groupChatService.updateChannel(
    req.user!.id,
    workspaceId(req),
    req.params.channelId as string,
    req.body,
  );
  res.status(200).json({ channel });
}

export async function deleteChannel(req: Request, res: Response) {
  await groupChatService.deleteChannel(req.user!.id, workspaceId(req), req.params.channelId as string);
  res.status(204).send();
}

export async function listMessages(req: Request, res: Response) {
  const parsed = listMessagesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const messages = await groupChatService.listMessages(
    req.user!.id,
    workspaceId(req),
    req.params.channelId as string,
    parsed.data,
  );
  res.status(200).json({ messages });
}

export async function postMessage(req: Request, res: Response) {
  const message = await groupChatService.postMessage(
    req.user!.id,
    workspaceId(req),
    req.params.channelId as string,
    req.body,
  );
  res.status(201).json({ message });
}

export async function markRead(req: Request, res: Response) {
  await groupChatService.markRead(req.user!.id, workspaceId(req), req.params.channelId as string);
  res.status(204).send();
}
