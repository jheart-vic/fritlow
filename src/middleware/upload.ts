import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { ApiError } from '../utils/api-error';

// Multipart upload handling. We keep files in memory (never on disk) and hand
// the buffer straight to Cloudinary / the extractor. Limits guard against
// oversized or wrong-typed uploads before anything touches the network.

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
// PRDs run long, and a scanned one is a stack of page images. 20 MB covers the
// realistic cases while staying well under Anthropic's 32 MB request ceiling
// once the file is base64-encoded (which inflates it by ~33%).
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

// The document formats a founder might have their PRD/MVP in. Images and
// text-layer-less PDFs go through the AI vision path; the rest are extracted
// locally at no AI cost.
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

// Wrap a multer handler so its own errors (file too large, unexpected field)
// surface as clean 400s through our error handler instead of leaking as 500s.
function wrap(handler: RequestHandler, tooLargeMessage: string) {
  return function uploadMiddleware(req: Request, res: Response, next: NextFunction) {
    handler(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE' ? tooLargeMessage : `Upload error: ${err.message}`;
        return next(new ApiError(400, message));
      }
      return next(err); // already an ApiError (from fileFilter) or unknown
    });
  };
}

const avatarHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new ApiError(400, 'Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
}).single('avatar');

const documentHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(new ApiError(400, 'Upload a PDF, Word document (.docx), or an image'));
      return;
    }
    cb(null, true);
  },
}).single('document');

export const avatarUpload = wrap(avatarHandler, 'Image must be 5 MB or smaller');
export const documentUpload = wrap(documentHandler, 'Document must be 20 MB or smaller');
