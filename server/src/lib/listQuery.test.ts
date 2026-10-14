import { describe, expect, it } from 'vitest';
import { escapeRegex, pageQuerySchema, parseSort, toMeta, toWindow } from './listQuery';

describe('listQuery', () => {
  it('defaults and caps page size', () => {
    expect(pageQuerySchema.parse({})).toMatchObject({ page: 1, limit: 25 });
    expect(() => pageQuerySchema.parse({ limit: '1000' })).toThrow();
  });
  it('computes window and meta', () => {
    expect(toWindow({ page: 3, limit: 10 })).toEqual({ skip: 20, limit: 10 });
    expect(toMeta({ page: 3, limit: 10 }, 55)).toEqual({ page: 3, limit: 10, total: 55 });
  });
  it('whitelists sort fields', () => {
    expect(parseSort('-createdAt,name,evil', ['createdAt', 'name'])).toEqual({ createdAt: -1, name: 1 });
    expect(parseSort('evil', ['name'], { name: 1 })).toEqual({ name: 1 });
  });
  it('escapes regex input', () => {
    expect(new RegExp(escapeRegex('a.b(c')).test('a.b(c')).toBe(true);
    expect(new RegExp(escapeRegex('a.b')).test('axb')).toBe(false);
  });
});
