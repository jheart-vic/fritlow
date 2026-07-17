import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import { renderDocx, renderMarkdown, renderPdf, type ExportableDoc } from './export.renderers';

export type ExportFormatKey = 'pdf' | 'docx' | 'markdown';

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const FORMAT_META: Record<ExportFormatKey, { ext: string; contentType: string; db: 'PDF' | 'DOCX' | 'MARKDOWN' }> = {
  pdf: { ext: 'pdf', contentType: 'application/pdf', db: 'PDF' },
  docx: {
    ext: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    db: 'DOCX',
  },
  markdown: { ext: 'md', contentType: 'text/markdown; charset=utf-8', db: 'MARKDOWN' },
};

export async function exportBlueprint(
  userId: string,
  projectId: string,
  format: ExportFormatKey,
): Promise<ExportResult> {
  const project = await getProject(userId, projectId);

  const blueprint = await prisma.blueprint.findUnique({
    where: { projectId },
    include: { sections: { orderBy: { order: 'asc' } } },
  });
  if (!blueprint) {
    throw ApiError.notFound('Nothing to export — generate the blueprint first');
  }

  const doc: ExportableDoc = {
    title: project.name,
    subtitle: project.oneLineIdea,
    sections: blueprint.sections.map((s) => ({
      title: s.title,
      markdown: (s.content as { markdown: string }).markdown,
    })),
  };

  const meta = FORMAT_META[format];
  const buffer =
    format === 'pdf' ? await renderPdf(doc)
    : format === 'docx' ? await renderDocx(doc)
    : renderMarkdown(doc);

  // Audit trail; fire-and-forget would risk silent loss, so await it.
  await prisma.export.create({
    data: { format: meta.db, projectId, createdById: userId },
  });

  // Safe filename: keep letters/digits/dashes from the project name.
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'blueprint';

  return {
    buffer,
    filename: `${slug}-blueprint.${meta.ext}`,
    contentType: meta.contentType,
  };
}
