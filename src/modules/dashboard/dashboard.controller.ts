import type { Request, Response } from 'express';
import * as dashboardService from './dashboard.service';

export async function get(req: Request, res: Response) {
  const workspaceId =
    typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const dashboard = await dashboardService.getDashboard(req.user!.id, workspaceId);
  res.status(200).json(dashboard);
}
