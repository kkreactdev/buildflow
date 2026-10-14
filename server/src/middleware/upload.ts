import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { getEnv } from '../config/env';
import { AppError } from '../lib/appError';

/**
 * Accepts ONE file in the `file` field, held in memory (never written to disk) and capped by
 * MEDIA_MAX_BYTES. Multer's own errors become normal API errors. Authorization must already
 * have run: this only parses the body.
 */
export function singleFileUpload(maxBytes: () => number = () => getEnv().MEDIA_MAX_BYTES) {
  const parser = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: maxBytes(), fields: 10 } }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    parser(req, res, (err?: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError('FILE_TOO_LARGE', 413, `The file is larger than the ${Math.floor(maxBytes() / 1024 / 1024)} MB limit`));
        return next(AppError.validation('Upload one file in the "file" field'));
      }
      next(err);
    });
  };
}
