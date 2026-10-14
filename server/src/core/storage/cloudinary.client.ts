import { v2 as cloudinary } from 'cloudinary';
import type { AssetAccess, MediaProvider, UploadedAsset } from './mediaProvider';

/** The ONLY file that imports the Cloudinary SDK. Assets are public (property photos / brochures); secrets never leave the server. */
export class CloudinaryProvider implements MediaProvider {
  constructor(cfg: { cloudName: string; apiKey: string; apiSecret: string }) {
    cloudinary.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret, secure: true });
  }

  upload(buffer: Buffer, opts: { folder: string; format: string; access?: AssetAccess }): Promise<UploadedAsset> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: opts.folder, resource_type: 'image', overwrite: false, unique_filename: true, type: opts.access === 'private' ? 'authenticated' : 'upload' }, (err, res) => {
        if (err || !res) return reject(err ?? new Error('Cloudinary returned no result'));
        resolve({ publicId: res.public_id, url: res.secure_url, bytes: res.bytes, format: res.format ?? opts.format, width: res.width, height: res.height });
      });
      stream.end(buffer);
    });
  }

  async destroy(publicId: string, access: AssetAccess = 'public'): Promise<void> {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true, type: access === 'private' ? 'authenticated' : 'upload' });
  }

  /** An expiring, signed download link for an authenticated asset. Without a valid signature Cloudinary refuses the asset. */
  signedUrl(asset: { publicId: string; format: string }, ttlSeconds: number): string {
    return cloudinary.utils.private_download_url(asset.publicId, asset.format, { resource_type: 'image', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + ttlSeconds });
  }
}
