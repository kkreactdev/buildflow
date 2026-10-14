import { randomUUID } from 'node:crypto';
import type { AssetAccess, MediaProvider, UploadedAsset } from './mediaProvider';

/** In-memory driver for tests. Exposes what was stored so tests can assert uploads and clean-up. */
export class MockMediaProvider implements MediaProvider {
  readonly assets = new Map<string, UploadedAsset & { access: AssetAccess }>();
  failNextUpload = false;
  failDestroy = false;

  async upload(buffer: Buffer, opts: { folder: string; format: string; access?: AssetAccess }): Promise<UploadedAsset> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error('mock upload failure');
    }
    const publicId = `${opts.folder}/${randomUUID()}`;
    const access = opts.access ?? 'public';
    // A private asset has NO plain URL: the link returned here is deliberately useless without a signed one.
    const asset = { publicId, url: access === 'private' ? '' : `https://media.test/${publicId}.${opts.format}`, bytes: buffer.length, format: opts.format };
    this.assets.set(publicId, { ...asset, access });
    return asset;
  }

  async destroy(publicId: string, access: AssetAccess = 'public'): Promise<void> {
    if (this.failDestroy) throw new Error('mock destroy failure');
    const a = this.assets.get(publicId);
    if (a && a.access !== access) throw new Error('mock: wrong delivery type for destroy'); // mirrors the real store, which cannot find it
    this.assets.delete(publicId);
  }

  signedUrl(asset: { publicId: string; format: string }, ttlSeconds: number): string {
    const a = this.assets.get(asset.publicId);
    if (!a || a.access !== 'private') throw new Error('mock: not a private asset');
    return `https://media.test/signed/${asset.publicId}.${asset.format}?exp=${Math.floor(Date.now() / 1000) + ttlSeconds}&sig=${randomUUID()}`;
  }
}
