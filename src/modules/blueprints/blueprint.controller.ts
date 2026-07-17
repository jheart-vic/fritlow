import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error';
import * as blueprintService from './blueprint.service';

function projectId(req: Request): string {
  return req.params.projectId as string;
}

export async function generate(req: Request, res: Response) {
  const blueprint = await blueprintService.generateBlueprint(req.user!.id, projectId(req));
  res.status(201).json({ blueprint });
}

// SSE variant: streams the model's writing live, then a final `done` event
// with the persisted blueprint. Once headers are sent the normal error
// middleware can't help, so errors become SSE `error` events instead.
export async function generateStream(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const blueprint = await blueprintService.generateBlueprintStream(
      req.user!.id,
      projectId(req),
      (text) => send('delta', { text }),
    );
    send('done', { blueprint });
  } catch (err) {
    send('error', {
      error: err instanceof ApiError ? err.message : 'Blueprint generation failed',
    });
  } finally {
    res.end();
  }
}

export async function get(req: Request, res: Response) {
  const blueprint = await blueprintService.getBlueprint(req.user!.id, projectId(req));
  res.status(200).json({ blueprint });
}

export async function updateSection(req: Request, res: Response) {
  const section = await blueprintService.updateSection(
    req.user!.id,
    projectId(req),
    req.params.sectionKey as string,
    req.body,
  );
  res.status(200).json({ section });
}
