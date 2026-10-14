import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from './appError';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParams = z.object({ id: objectIdSchema });

export function toObjectId(value: string, what = 'id'): Types.ObjectId {
  if (!isValidObjectId(value)) throw AppError.validation(`Invalid ${what}`);
  return new Types.ObjectId(value);
}
