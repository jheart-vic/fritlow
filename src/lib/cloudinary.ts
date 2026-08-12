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
