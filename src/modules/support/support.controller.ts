import type { Request, Response } from 'express';
import { listConversationsQuerySchema } from './support.schemas';
import * as supportService from './support.service';

// ---- User side (requireAuth) ----

export async function startConversation(req: Request, res: Response) {
  const conversation = await supportService.startConversation(req.user!.id, req.body);
  res.status(201).json({ conversation });
}

export async function listMine(req: Request, res: Response) {
  const conversations = await supportService.listMyConversations(req.user!.id);
  res.status(200).json({ conversations });
}

export async function getMine(req: Request, res: Response) {
  const conversation = await supportService.getMyConversation(req.user!.id, req.params.id as string);
  res.status(200).json({ conversation });
}

export async function postMyMessage(req: Request, res: Response) {
  const message = await supportService.postUserMessage(
    req.user!.id,
    req.params.id as string,
    req.body,
  );
  res.status(201).json({ message });
}

// ---- Staff side (requireAuth + requirePlatformRole) ----

export async function listAll(req: Request, res: Response) {
  const parsed = listConversationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  res.status(200).json(await supportService.listAllConversations(parsed.data));
}

export async function getAsStaff(req: Request, res: Response) {
  const conversation = await supportService.getConversationAsStaff(req.params.id as string);
  res.status(200).json({ conversation });
}

export async function postStaffMessage(req: Request, res: Response) {
  const message = await supportService.postStaffMessage(
    req.user!.id,
    req.params.id as string,
    req.body,
  );
  res.status(201).json({ message });
}

export async function updateConversation(req: Request, res: Response) {
  const conversation = await supportService.updateConversation(req.params.id as string, req.body);
  res.status(200).json({ conversation });
}
