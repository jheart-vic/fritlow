import { ApiError } from '../../utils/api-error';
import { templates, type Template } from './templates.data';

// Read-only reference data — no Prisma here (see templates.data.ts for why).

export function listTemplates(): Template[] {
  return templates;
}

export function getTemplate(id: string): Template {
  const template = templates.find((t) => t.id === id);
  if (!template) {
    throw ApiError.notFound('Template not found');
  }
  return template;
}
