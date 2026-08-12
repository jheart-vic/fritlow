import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ApiError } from '../utils/api-error';

// Multipart upload handling for images (avatars). We keep the file in memory
// (never on disk) and hand the buffer straight to Cloudinary. Limits guard
// against oversized or non-image uploads before anything touches the network.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const handler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new ApiError(400, 'Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
}).single('avatar');

// Wrap multer so its own errors (file too large, unexpected field) surface as
// clean 400s through our error handler instead of leaking as 500s.
export function avatarUpload(req: Request, res: Response, next: NextFunction) {
  handler(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : `Upload error: ${err.message}`;
      return next(new ApiError(400, message));
    }
    return next(err); // already an ApiError (from fileFilter) or unknown
  });
}
