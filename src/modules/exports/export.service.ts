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

export interface ExportOptions {
  includeTranscript?: boolean;
}

export async function exportBlueprint(
  userId: string,
  projectId: string,
  format: ExportFormatKey,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const project = await getProject(userId, projectId);

  const blueprint = await prisma.blueprint.findUnique({
    where: { projectId },
    include: { sections: { orderBy: { order: 'asc' } } },
  });
  if (!blueprint) {
    throw ApiError.notFound('Nothing to export — generate the blueprint first');
  }

  const sections = blueprint.sections.map((s) => ({
    title: s.title,
    markdown: (s.content as { markdown: string }).markdown,
  }));

  // Optionally append the full discovery interview as an appendix section.
  if (options.includeTranscript) {
    const transcript = await buildTranscriptMarkdown(projectId);
    if (transcript) {
      sections.push({ title: 'Appendix: Discovery Interview Transcript', markdown: transcript });
    }
  }

  const doc: ExportableDoc = {
    title: project.name,
    subtitle: project.oneLineIdea,
    sections,
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

// Builds a markdown transcript of the discovery interview (questions, answers,
// and any AI follow-ups) for the export appendix. Returns null if there's no
// session/answers to include.
async function buildTranscriptMarkdown(projectId: string): Promise<string | null> {
  const session = await prisma.discoverySession.findUnique({
    where: { projectId },
    include: { answers: { orderBy: { answeredAt: 'asc' } } },
  });
  if (!session || session.answers.length === 0) return null;

  return session.answers
    .map((a) => {
      const payload = a.answer as {
        text: string;
        followUp?: { question: string; answer: string | null };
      };
      const lines = [`**${a.questionText}**`, '', payload.text];
      if (payload.followUp) {
        lines.push('', `*Follow-up:* ${payload.followUp.question}`);
        if (payload.followUp.answer) lines.push('', payload.followUp.answer);
      }
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}
