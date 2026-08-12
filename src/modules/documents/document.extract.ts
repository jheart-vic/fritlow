import mammoth from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import * as aiService from '../../lib/ai/ai.service';
import { ApiError } from '../../utils/api-error';

// Turning an uploaded file into plain text. Three paths, cheapest first:
//
//   PDF with a text layer  → unpdf          (no AI cost)
//   .docx                  → mammoth        (no AI cost)
//   image, or a PDF with   → AI vision      (costs tokens per page/image)
//   no text layer (a scan)
//
// The vision path exists because founders really do upload a photo of a
// whiteboard or a scanned printout. Both providers accept the file directly —
// a PDF goes over as a document attachment and the model reads the page images
// itself — so there is no OCR or page-rasterising step in this codebase.

export type ExtractionMethod = 'PDF_TEXT' | 'DOCX' | 'VISION';

export interface ExtractionResult {
  text: string;
  method: ExtractionMethod;
  pagesRead?: number;
}

// A PDF whose text layer yields less than this is almost certainly a scan:
// scanned pages often carry a stray character or two of junk, not real text.
const MIN_TEXT_LAYER_CHARS = 100;

// Cost ceiling for the vision path. Each page of a scanned PDF is an image to
// the model (thousands of input tokens), so a 200-page scan would be a very
// expensive single upload. We refuse past this rather than surprise the account
// with the bill — the founder can upload the relevant excerpt instead.
export const MAX_VISION_PAGES = 30;

const VISION_SYSTEM_PROMPT =
  'You transcribe product documents (PRDs, specs, pitch decks, notes) into plain markdown. ' +
  'Reproduce the document faithfully: keep headings as markdown headings, keep lists as lists, ' +
  'and keep tables readable. Transcribe what is actually written — do not summarise it, do not ' +
  'improve it, and do not invent content that is not there. If part of the document is illegible, ' +
  'write [illegible] in place of that part. Reply with ONLY the transcription — no preamble.';

export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  options: { userId?: string; projectId?: string } = {},
): Promise<ExtractionResult> {
  if (mimeType === 'application/pdf') {
    return extractFromPdf(buffer, options);
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { text: await extractFromDocx(buffer), method: 'DOCX' };
  }
  if (mimeType.startsWith('image/')) {
    return { text: await transcribeWithVision(buffer, mimeType, 'image', options), method: 'VISION' };
  }
  throw ApiError.badRequest(`Cannot extract text from file type: ${mimeType}`);
}

// Try the text layer first; fall back to vision when there isn't a usable one.
async function extractFromPdf(
  buffer: Buffer,
  options: { userId?: string; projectId?: string },
): Promise<ExtractionResult> {
  let totalPages = 0;
  let layerText = '';

  try {
    // unpdf is a pure-JS pdf.js build — no native modules, no canvas, which is
    // what makes it safe to run on Windows and on Render alike.
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    totalPages = pdf.numPages;
    const extracted = await extractPdfText(pdf, { mergePages: true });
    layerText = (extracted.text ?? '').trim();
  } catch (err) {
    // A malformed PDF still might be readable as images by the model, so fall
    // through to vision rather than failing outright.
    console.warn('[documents] PDF text-layer extraction failed:', err);
  }

  if (layerText.length >= MIN_TEXT_LAYER_CHARS) {
    return { text: layerText, method: 'PDF_TEXT', pagesRead: totalPages };
  }

  // No usable text layer — this is a scan.
  if (totalPages > MAX_VISION_PAGES) {
    throw ApiError.badRequest(
      `This looks like a scanned PDF with ${totalPages} pages, which is too large to read as images ` +
        `(limit ${MAX_VISION_PAGES}). Upload a text-based PDF, or just the relevant pages.`,
    );
  }

  const text = await transcribeWithVision(buffer, 'application/pdf', 'pdf', options);
  return { text, method: 'VISION', pagesRead: totalPages || undefined };
}

// We go .docx → HTML → markdown rather than straight to raw text, because raw
// text flattens headings away — and headings ("Target users", "Out of scope")
// are exactly what lets the model map a PRD's sections onto interview questions.
//
// mammoth emits a small, predictable subset of HTML, so this hand-rolled
// conversion is enough and avoids another dependency. Falls back to raw text if
// anything about the HTML path goes wrong.
async function extractFromDocx(buffer: Buffer): Promise<string> {
  try {
    const { value } = await mammoth.convertToHtml({ buffer });
    const markdown = htmlToMarkdown(value);
    if (markdown) return markdown;
  } catch (err) {
    console.warn('[documents] DOCX HTML conversion failed, falling back to raw text:', err);
  }
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim();
}

function htmlToMarkdown(html: string): string {
  return (
    html
      // Headings → #, ##, ### … (the whole reason we take the HTML route)
      .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_m, level: string, text: string) => {
        return `\n\n${'#'.repeat(Number(level))} ${text}\n`;
      })
      .replace(/<li[^>]*>(.*?)<\/li>/gis, '\n- $1')
      .replace(/<\/(p|div|tr|ul|ol|table)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<(strong|b)>(.*?)<\/\1>/gis, '**$2**')
      .replace(/<(em|i)>(.*?)<\/\1>/gis, '*$2*')
      // Anything left (spans, anchors, table wrappers) carries no meaning here.
      .replace(/<[^>]+>/g, '')
      // mammoth escapes these; the model should see the real characters.
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Collapse the blank-line pile-up the replacements above create.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

async function transcribeWithVision(
  buffer: Buffer,
  mimeType: string,
  kind: 'image' | 'pdf',
  options: { userId?: string; projectId?: string },
): Promise<string> {
  const text = await aiService.generateText({
    feature: 'documents.vision_extract',
    userId: options.userId,
    projectId: options.projectId,
    // Transcription is output-heavy — a dense multi-page document needs room,
    // and a truncated transcript silently loses the end of the founder's PRD.
    maxTokens: 8192,
    system: VISION_SYSTEM_PROMPT,
    prompt:
      'Transcribe this document into markdown. Reply with only the transcription.',
    attachments: [{ kind, mimeType, base64: buffer.toString('base64') }],
  });

  // A blank or unreadable page comes back as nothing, or as our own [illegible]
  // marker with no real content around it. Either way there is nothing to
  // pre-fill from, so fail here rather than storing a useless "extracted" doc.
  const trimmed = text.trim();
  if (!trimmed || trimmed.replace(/\[illegible\]/gi, '').trim().length === 0) {
    throw ApiError.badRequest(
      'We could not read any text from this file. Try a clearer photo, or upload the document itself.',
    );
  }
  return trimmed;
}
