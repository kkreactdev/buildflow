/**
 * Decides what a file REALLY is from its first bytes; the client-supplied name and mime type are
 * never trusted. Only these formats are accepted (SVG and anything scriptable are refused).
 */
export const ALLOWED_MEDIA_FORMATS = ['jpg', 'png', 'webp', 'pdf'] as const;
export type MediaFormat = (typeof ALLOWED_MEDIA_FORMATS)[number];

export function detectFormat(b: Buffer): MediaFormat | undefined {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return undefined;
}

const MIME: Record<MediaFormat, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
/** The MIME type for a format WE detected (never the browser's claim). */
export const mimeFor = (f: MediaFormat): string => MIME[f];

const EXTENSIONS: Record<MediaFormat, readonly string[]> = { jpg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'], pdf: ['pdf'] };
/** The lower-case extension of a file name, without the dot ('' if none). */
export const extensionOf = (name: string): string => /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())?.[1]?.toLowerCase() ?? '';
/** True when the file name's extension is one of those allowed for the detected format. */
export const extensionMatches = (name: string, f: MediaFormat): boolean => EXTENSIONS[f].includes(extensionOf(name));
