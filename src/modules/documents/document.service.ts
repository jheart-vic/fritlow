import { prisma } from '../../lib/prisma';
import {
  deleteDocument as deleteFromStorage,
  isCloudinaryConfigured,
  uploadDocument as uploadToStorage,
} from '../../lib/cloudinary';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import { extractDocumentText } from './document.extract';

// A founder who already wrote a PRD shouldn't have to retype it through the
// discovery interview. They upload it here; we pull the text out and the
// discovery module uses it to PRE-FILL answers, which the founder then reviews
// in the normal interview. The document never bypasses discovery.

// getProject is the tenancy gate: it 404s unknown projects and 403s non-members
// before anything else runs.

// List/summary shape — deliberately omits extractedText, which can be tens of
// KB and is only needed when something is actually going to read the document.
const summarySelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  fileUrl: true,
  status: true,
  extractionMethod: true,
  pagesRead: true,
  error: true,
  createdAt: true,
  updatedAt: true,
  uploadedById: true,
} as const;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export async function uploadDocument(userId: string, projectId: string, file: UploadedFile) {
  await getProject(userId, projectId);

  const document = await prisma.projectDocument.create({
    data: {
      projectId,
      uploadedById: userId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      status: 'UPLOADED',
    },
    select: summarySelect,
  });

  // Storage + extraction run AFTER the response goes out: extraction can take
  // seconds (much longer when a scan goes through the vision model), and making
  // the founder's browser hold the upload open for that is a bad trade. The
  // frontend polls `status` instead.
  void processDocument(document.id, projectId, userId, file);

  return document;
}

// Fire-and-forget pipeline: store the original, extract the text, record the
// outcome. Never throws — a failure here becomes status FAILED on the row, not
// an unhandled rejection.
async function processDocument(
  documentId: string,
  projectId: string,
  userId: string,
  file: UploadedFile,
): Promise<void> {
  // Best-effort storage. The extracted text is what Fritlow actually reads, so
  // losing the original copy must not fail the upload.
  if (isCloudinaryConfigured()) {
    try {
      const stored = await uploadToStorage(file.buffer, documentId, file.originalname);
      await prisma.projectDocument.update({
        where: { id: documentId },
        data: { fileUrl: stored.url, publicId: stored.publicId },
      });
    } catch (err) {
      console.warn(`[documents] storing ${documentId} failed (continuing):`, err);
    }
  }

  try {
    await prisma.projectDocument.update({
      where: { id: documentId },
      data: { status: 'EXTRACTING' },
    });

    const result = await extractDocumentText(file.buffer, file.mimetype, { userId, projectId });

    await prisma.projectDocument.update({
      where: { id: documentId },
      data: {
        status: 'EXTRACTED',
        extractedText: result.text,
        extractionMethod: result.method,
        pagesRead: result.pagesRead ?? null,
        error: null,
      },
    });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'We could not read this document';
    console.error(`[documents] extraction failed for ${documentId}:`, err);
    await prisma.projectDocument
      .update({ where: { id: documentId }, data: { status: 'FAILED', error: message } })
      .catch(() => {}); // the row may have been deleted mid-flight
  }
}

export async function listDocuments(userId: string, projectId: string) {
  await getProject(userId, projectId);
  return prisma.projectDocument.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: summarySelect,
  });
}

// The full row, including the extracted text — this is the one endpoint that
// returns it, so the frontend can show the founder what we actually read.
export async function getDocument(userId: string, projectId: string, documentId: string) {
  await getProject(userId, projectId);

  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, projectId },
  });
  if (!document) {
    throw ApiError.notFound('Document not found');
  }
  return document;
}

export async function deleteDocument(userId: string, projectId: string, documentId: string) {
  await getProject(userId, projectId);

  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, projectId },
    select: { id: true, publicId: true },
  });
  if (!document) {
    throw ApiError.notFound('Document not found');
  }

  await prisma.projectDocument.delete({ where: { id: document.id } });
  if (document.publicId) {
    await deleteFromStorage(document.publicId); // best-effort
  }
}

// Every usable document's text for a project, newest first — the input to
// discovery pre-fill and to the tailored question plan. Returns [] when there
// is nothing extracted yet, so callers can simply skip the document path.
export async function getExtractedDocuments(projectId: string) {
  const documents = await prisma.projectDocument.findMany({
    where: { projectId, status: 'EXTRACTED', NOT: { extractedText: null } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, fileName: true, extractedText: true },
  });

  return documents.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    text: d.extractedText as string,
  }));
}
