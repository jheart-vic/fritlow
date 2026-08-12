import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { documentUpload } from '../../middleware/upload';
import * as documentController from './document.controller';

// mergeParams lets this router read :projectId from its mount path.
export const documentRouter = Router({ mergeParams: true });

documentRouter.use(requireAuth);

/**
 * @openapi
 * /api/v1/projects/{projectId}/documents:
 *   post:
 *     tags: [Documents]
 *     summary: Upload a PRD/MVP document for a project
 *     description: >
 *       Upload an existing product document (PDF, Word .docx, or an image/photo of one)
 *       so Fritlow can read it and PRE-FILL the discovery interview from it.
 *       Multipart field name is `document`; max 20 MB.
 *       Returns **202** immediately with the document row at status `UPLOADED` —
 *       text extraction runs in the background. Poll
 *       `GET /projects/{projectId}/documents/{documentId}` until `status` is
 *       `EXTRACTED` (or `FAILED`, where `error` explains why), then call
 *       `POST /projects/{projectId}/discovery/prefill`.
 *       PDFs and .docx are read locally; images and scanned PDFs (no text layer)
 *       are read by the AI vision model, which requires an AI provider to be
 *       configured and is capped at 30 pages.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: "PDF, .docx, or image (png/jpeg/webp/gif). Max 20 MB."
 *     responses:
 *       202:
 *         description: Accepted; extraction running in the background
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 document: { $ref: '#/components/schemas/ProjectDocument' }
 *       400:
 *         description: No file, unsupported type, or file too large
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     tags: [Documents]
 *     summary: List a project's uploaded documents
 *     description: Summary rows only — `extractedText` is omitted here (fetch a single document to read it).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The project's documents, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 documents:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ProjectDocument' }
 */
documentRouter.post('/', documentUpload, documentController.upload);
documentRouter.get('/', documentController.list);

/**
 * @openapi
 * /api/v1/projects/{projectId}/documents/{documentId}:
 *   get:
 *     tags: [Documents]
 *     summary: Get one document, including the extracted text
 *     description: >
 *       The polling endpoint for extraction status, and the only endpoint that returns
 *       `extractedText` — use it to show the founder what Fritlow actually read.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The document with its extracted text
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 document:
 *                   allOf:
 *                     - $ref: '#/components/schemas/ProjectDocument'
 *                     - type: object
 *                       properties:
 *                         extractedText: { type: string, nullable: true }
 *       404:
 *         description: Document not found on this project
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Documents]
 *     summary: Delete an uploaded document
 *     description: Removes the row and the stored file. Answers already pre-filled from it are left untouched — they belong to the founder now.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Document not found on this project
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
documentRouter.get('/:documentId', documentController.get);
documentRouter.delete('/:documentId', documentController.remove);
