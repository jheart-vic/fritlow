import type { Request, Response } from 'express';
import * as dashboardService from './dashboard.service';

export async function get(req: Request, res: Response) {
  const dashboard = await dashboardService.getDashboard(req.user!.id);
  res.status(200).json(dashboard);
}
