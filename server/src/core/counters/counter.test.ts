import { describe, expect, it } from 'vitest';
import { useTestDb } from '../../test/db';
import { Counter } from './counter.model';
import { formatSequence, nextSequence } from './counter.service';

describe('sequences', () => {
  useTestDb();

  it('count up from 1 per key, independently', async () => {
    expect([await nextSequence('a'), await nextSequence('a'), await nextSequence('b'), await nextSequence('a')]).toEqual([1, 2, 1, 3]);
  });

  it('are unique under heavy concurrency, including the very first (upsert) call', async () => {
    const values = await Promise.all(Array.from({ length: 60 }, () => nextSequence('race')));
    expect(new Set(values).size).toBe(60);
    expect([...values].sort((x, y) => x - y)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(await Counter.countDocuments({ key: 'race' })).toBe(1);
  });

  it('format with a prefix and zero padding, growing past the width', () => {
    expect(formatSequence(42, { prefix: 'CL-', width: 6 })).toBe('CL-000042');
    expect(formatSequence(1234567, { prefix: 'CL-', width: 6 })).toBe('CL-1234567');
  });
});
