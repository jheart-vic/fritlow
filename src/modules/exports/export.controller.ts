import type { Request, Response } from 'express';
import { z } from 'zod';
import * as exportService from './export.service';

const formatSchema = z.enum(['pdf', 'docx', 'markdown']);

export async function exportBlueprint(req: Request, res: Response) {
  const parsed = formatSchema.safeParse(req.query.format);
  if (!parsed.success) {
    return res.status(400).json({ error: 'format must be one of: pdf, docx, markdown' });
  }

  const result = await exportService.exportBlueprint(
    req.user!.id,
    req.params.projectId as string,
    parsed.data,
  );

  res
    .status(200)
    .setHeader('Content-Type', result.contentType)
    .setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
    .send(result.buffer);
}
