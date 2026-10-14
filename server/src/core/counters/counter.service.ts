import { Counter } from './counter.model';

/**
 * Atomically increments and returns the next value of a named sequence.
 * Safe under concurrency: the increment is a single `findOneAndUpdate`. The very
 * first call for a key may race on the upsert (duplicate key), so it retries.
 *
 * Deliberately NOT part of the caller's transaction: that would make every
 * creator contend on one document. The trade-off is that a failed creation
 * leaves a gap in the sequence; numbers are unique and increasing, not gapless.
 */
export async function nextSequence(key: string): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
      return doc!.seq;
    } catch (err) {
      if ((err as { code?: number }).code === 11000 && attempt < 5) continue;
      throw err;
    }
  }
}

export interface IdFormat {
  prefix: string;
  width: number;
}

export const formatSequence = (n: number, { prefix, width }: IdFormat): string => `${prefix}${String(n).padStart(width, '0')}`;
