/* eslint-disable @typescript-eslint/no-explicit-any -- Mongoose middleware typings are loose */
import type { Schema } from 'mongoose';
import { AppError } from '../../lib/appError';

const MUTATING_QUERY_OPS = [
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete',
] as const;

const refuse = (what: string, model: string): never => {
  throw new AppError('IMMUTABLE_RECORD', 409, `${model} records are append-only; ${what} is not permitted. Corrections are made by appending new records; retention is a separate operational process.`);
};

/**
 * Append-only enforcement for historical records (audit log, activity). It
 * applies to EVERY caller including system-scope repos: the application has no
 * way to edit or delete these records. Inserting is the only write allowed.
 * (Retention/purging, if ever needed, is an operational task performed outside
 * the application, not an API.)
 */
export function immutablePlugin(schema: Schema): void {
  schema.pre(MUTATING_QUERY_OPS as any, function (this: any) {
    refuse(this.op, this.model.modelName);
  });
  schema.pre('save', function (this: any) {
    if (!this.isNew) refuse('updating an existing record', this.constructor.modelName);
  });
  for (const op of ['deleteOne', 'updateOne'] as const) {
    schema.pre(op, { document: true, query: false }, function (this: any) {
      refuse(`document.${op}`, this.constructor.modelName);
    });
  }
  schema.pre('bulkWrite' as any, function (this: any, next: () => void, ops: any[]) {
    if (ops.some((o) => !('insertOne' in o))) refuse('bulkWrite of non-insert operations', this.modelName);
    next();
  });
}
