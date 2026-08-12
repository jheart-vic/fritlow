import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env';
import { ApiError } from '../utils/api-error';

// The ONLY file that talks to Cloudinary — everything else goes through
// uploadAvatar/deleteAvatar, so swapping providers later touches one place.
let configured = false;
function ensureConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new ApiError(503, 'Image uploads are not configured on this server');
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
}

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  );
}

// Uploads an avatar image buffer and returns its secure URL. Uses a stable
// public_id per user (folder `fritlow/avatars`, id = userId) with overwrite, so
// re-uploading replaces the old image instead of piling up orphans.
export async function uploadAvatar(buffer: Buffer, userId: string): Promise<string> {
  ensureConfigured();
  return new Promise<string>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'fritlow/avatars',
          public_id: userId,
          overwrite: true,
          resource_type: 'image',
          // Normalize to a square, reasonably sized avatar.
          transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }],
        },
        (error, result) => {
          if (error || !result) {
            reject(new ApiError(502, 'Image upload failed — please try again'));
            return;
          }
          resolve(result.secure_url);
        },
      )
      .end(buffer);
  });
}

// Uploads an uploaded PRD/MVP document and returns its URL + public_id.
//
// resource_type: 'raw' is the key difference from avatars: it tells Cloudinary
// to store the bytes untouched rather than treating them as an image to
// transform. `documentId` gives each upload its own object (unlike avatars,
// which overwrite per user — a project can have several documents).
//
// This is provenance storage only: the extracted TEXT is what the rest of
// Fritlow reads, so a failure here must not lose the upload — callers treat it
// as best-effort and keep going with a null fileUrl.
export async function uploadDocument(
  buffer: Buffer,
  documentId: string,
  fileName: string,
): Promise<{ url: string; publicId: string }> {
  ensureConfigured();
  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'fritlow/documents',
          public_id: documentId,
          resource_type: 'raw',
          // Keeps the original name on the download URL so the founder gets
          // back "my-prd.pdf", not a uuid.
          filename_override: fileName,
          use_filename: false,
        },
        (error, result) => {
          if (error || !result) {
            reject(new ApiError(502, 'Document storage failed — please try again'));
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      )
      .end(buffer);
  });
}

// Removes a stored document (best-effort — the DB row is the source of truth).
export async function deleteDocument(publicId: string): Promise<void> {
  if (!isCloudinaryConfigured()) return;
  ensureConfigured();
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
  } catch {
    // ignore — deleting the row is what matters to the user
  }
}

// Removes a user's avatar from Cloudinary (best-effort — a failure here should
// not block clearing the DB field).
export async function deleteAvatar(userId: string): Promise<void> {
  if (!isCloudinaryConfigured()) return;
  ensureConfigured();
  try {
    await cloudinary.uploader.destroy(`fritlow/avatars/${userId}`, { resource_type: 'image' });
  } catch {
    // ignore — the DB field is the source of truth for whether an avatar shows
  }
}
