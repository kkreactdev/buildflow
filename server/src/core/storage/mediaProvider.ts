import { AppError } from '../../lib/appError';
import { getEnv } from '../../config/env';
import { CloudinaryProvider } from './cloudinary.client';
import { MockMediaProvider } from './mockProvider';

export interface UploadedAsset {
  publicId: string;
  url: string;
  bytes: number;
  format: string;
  width?: number;
  height?: number;
}

/** What the rest of the server may ask of a file store. Only `cloudinary.client.ts` knows the vendor SDK. */
export type AssetAccess = 'public' | 'private';

export interface MediaProvider {
  /** `public` assets (unit photos) have a plain URL; `private` ones (documents) can only be reached through `signedUrl`. */
  upload(buffer: Buffer, opts: { folder: string; format: string; access?: AssetAccess }): Promise<UploadedAsset>;
  destroy(publicId: string, access?: AssetAccess): Promise<void>;
  /** A short-lived link to a PRIVATE asset. Never stored; generated per request after an access check. */
  signedUrl(asset: { publicId: string; format: string }, ttlSeconds: number): string;
}

let provider: MediaProvider | undefined;

/** Real Cloudinary when configured; the in-memory driver under test; otherwise a clear 503 (never a silent no-op). */
export function getMediaProvider(): MediaProvider {
  if (provider) return provider;
  const env = getEnv();
  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    provider = new CloudinaryProvider({ cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET });
  } else if (env.NODE_ENV === 'test') {
    provider = new MockMediaProvider();
  } else {
    throw new AppError('MEDIA_NOT_CONFIGURED', 503, 'Media storage is not configured. Set the CLOUDINARY_* variables.');
  }
  return provider;
}

/** Test hook. */
export function setMediaProvider(p: MediaProvider | undefined): void {
  provider = p;
}

/** Removes an asset without ever failing the caller; a leftover asset is logged for later clean-up, not surfaced to the user. */
export async function destroyQuietly(publicId: string, log: (obj: object, msg: string) => void, access: AssetAccess = 'public'): Promise<void> {
  try {
    await getMediaProvider().destroy(publicId, access);
  } catch (err) {
    log({ err, publicId }, 'Failed to delete media asset (orphaned; clean up manually)');
  }
}
