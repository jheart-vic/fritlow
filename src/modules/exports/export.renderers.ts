import { marked } from 'marked';
import PDFDocument from 'pdfkit';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

// Renders a blueprint into each export format. All three consume the same
// simple document model so formats can't drift apart.

export interface ExportableDoc {
  title: string;
  subtitle: string;
  sections: { title: string; markdown: string }[];
}

// V1 renders markdown structure (headings, paragraphs, bullets) and strips
// inline syntax (**bold** etc.) down to plain text for PDF/DOCX.
function plainText(inline: string): string {
  return inline
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

// ── Markdown ───────────────────────────────────────────────────────────

export function renderMarkdown(doc: ExportableDoc): Buffer {
  const parts = [
    `# ${doc.title}`,
    `> ${doc.subtitle}`,
    '',
    ...doc.sections.flatMap((s) => [`## ${s.title}`, '', s.markdown.trim(), '']),
    '---',
    `_Exported from Fritlow on ${new Date().toISOString().slice(0, 10)}_`,
  ];
  return Buffer.from(parts.join('\n'), 'utf-8');
}

// ── PDF (pdfkit) ───────────────────────────────────────────────────────

export function renderPdf(doc: ExportableDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    pdf.font('Helvetica-Bold').fontSize(24).text(doc.title);
    pdf.moveDown(0.3);
    pdf.font('Helvetica-Oblique').fontSize(11).fillColor('#555555').text(doc.subtitle);
    pdf.fillColor('#000000').moveDown(1.5);

    for (const section of doc.sections) {
      pdf.font('Helvetica-Bold').fontSize(16).text(section.title);
      pdf.moveDown(0.5);
      renderMarkdownIntoPdf(pdf, section.markdown);
      pdf.moveDown(1);
    }

    pdf.end();
  });
}

function renderMarkdownIntoPdf(pdf: PDFKit.PDFDocument, markdown: string) {
  for (const token of marked.lexer(markdown)) {
    switch (token.type) {
      case 'heading':
        pdf
          .font('Helvetica-Bold')
          .fontSize(Math.max(12, 15 - token.depth))
          .text(plainText(token.text));
        pdf.moveDown(0.3);
        break;
      case 'paragraph':
        pdf.font('Helvetica').fontSize(11).text(plainText(token.text), { lineGap: 3 });
        pdf.moveDown(0.5);
        break;
      case 'list':
        for (const item of token.items) {
          pdf
            .font('Helvetica')
            .fontSize(11)
            .text(`•  ${plainText(item.text)}`, { indent: 14, lineGap: 3 });
        }
        pdf.moveDown(0.5);
        break;
      case 'space':
        break;
      default:
        // Fallback for anything exotic (tables, code blocks): raw text.
        if ('raw' in token && token.raw.trim()) {
          pdf.font('Helvetica').fontSize(11).text(plainText(token.raw), { lineGap: 3 });
          pdf.moveDown(0.5);
        }
    }
  }
}

// ── DOCX (docx) ────────────────────────────────────────────────────────

export function renderDocx(doc: ExportableDoc): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: doc.subtitle, italics: true, color: '555555' })],
      spacing: { after: 400 },
    }),
  ];

  for (const section of doc.sections) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }));
    children.push(...markdownIntoDocxParagraphs(section.markdown));
  }

  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

function markdownIntoDocxParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const token of marked.lexer(markdown)) {
    switch (token.type) {
      case 'heading':
        paragraphs.push(
          new Paragraph({
            text: plainText(token.text),
            heading: token.depth <= 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          }),
        );
        break;
      case 'paragraph':
        paragraphs.push(new Paragraph({ text: plainText(token.text), spacing: { after: 160 } }));
        break;
      case 'list':
        for (const item of token.items) {
          paragraphs.push(
            new Paragraph({ text: plainText(item.text), bullet: { level: 0 } }),
          );
        }
        break;
      case 'space':
        break;
      default:
        if ('raw' in token && token.raw.trim()) {
          paragraphs.push(new Paragraph({ text: plainText(token.raw), spacing: { after: 160 } }));
        }
    }
  }
  return paragraphs;
}
