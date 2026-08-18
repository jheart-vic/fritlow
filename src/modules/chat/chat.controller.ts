import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error';
import { sendMessageSchema } from './chat.schemas';
import * as chatService from './chat.service';

function projectId(req: Request): string {
  return req.params.projectId as string;
}

// SSE: streams the assistant's reply live, then a final `done` event with the
// persisted { conversationId, userMessage, assistantMessage }. Body is validated
// here (not via validateBody) because we own the response as a stream.
export async function sendMessage(req: Request, res: Response) {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await chatService.streamChat(
      req.user!.id,
      projectId(req),
      parsed.data,
      (text) => send('delta', { text }),
    );
    send('done', result);
  } catch (err) {
    send('error', { error: err instanceof ApiError ? err.message : 'Chat failed' });
  } finally {
    res.end();
  }
}

export async function listConversations(req: Request, res: Response) {
  const conversations = await chatService.listConversations(req.user!.id, projectId(req));
  res.status(200).json({ conversations });
}

export async function getConversation(req: Request, res: Response) {
  const conversation = await chatService.getConversation(
    req.user!.id,
    projectId(req),
    req.params.id as string,
  );
  res.status(200).json({ conversation });
}

export async function renameConversation(req: Request, res: Response) {
  const conversation = await chatService.renameConversation(
    req.user!.id,
    projectId(req),
    req.params.id as string,
    req.body,
  );
  res.status(200).json({ conversation });
}

export async function deleteConversation(req: Request, res: Response) {
  await chatService.deleteConversation(req.user!.id, projectId(req), req.params.id as string);
  res.status(204).send();
}
