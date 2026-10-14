import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/appError';
import type { Principal } from '../permissions/principal';
import { assertBranchWritable, resolveScope, resolveWriteBranch } from './scopeResolver';

const A = new Types.ObjectId().toHexString();
const B = new Types.ObjectId().toHexString();
const C = new Types.ObjectId().toHexString();
const USER = new Types.ObjectId().toHexString();

const p = (dataScope: Principal['dataScope'], branchIds: string[]): Principal => ({
  userId: USER,
  permissions: new Set(),
  dataScope,
  branchIds,
});

describe('resolveScope', () => {
  it('ALL: no restriction, optionally narrowed', () => {
    expect(resolveScope(p('ALL', []))).toEqual({});
    expect(resolveScope(p('ALL', []), { requestedBranchId: B })).toEqual({ branchId: new Types.ObjectId(B) });
  });

  it('BRANCH: restricts to the principal branches', () => {
    const f = resolveScope(p('BRANCH', [A, B])) as { branchId: { $in: Types.ObjectId[] } };
    expect(f.branchId.$in.map(String)).toEqual([A, B]);
  });

  it('BRANCH: client may narrow within its branches but never widen', () => {
    expect(resolveScope(p('BRANCH', [A, B]), { requestedBranchId: B })).toEqual({ branchId: new Types.ObjectId(B) });
    expect(() => resolveScope(p('BRANCH', [A]), { requestedBranchId: C })).toThrow(AppError);
  });

  it('BRANCH with no branches matches nothing', () => {
    expect(resolveScope(p('BRANCH', []))).toEqual({ branchId: { $in: [] } });
  });

  it('OWN: branch + owner filter; falls back to branch-only without an owner field', () => {
    const f = resolveScope(p('OWN', [A]), { ownerField: 'assignedTo' });
    expect(String(f.assignedTo)).toBe(USER);
    expect(resolveScope(p('OWN', [A]))).not.toHaveProperty('assignedTo');
  });

  it('rejects malformed ids instead of building a bad filter', () => {
    expect(() => resolveScope(p('ALL', []), { requestedBranchId: 'not-an-id' })).toThrow(AppError);
  });

  it('supports custom field names', () => {
    expect(resolveScope(p('BRANCH', [A]), { branchField: 'branchIds' })).toHaveProperty('branchIds');
  });
});

describe('resolveScope with selfField (User-like collections)', () => {
  const spec = { branchField: 'branchIds', selfField: '_id' };
  it('BRANCH: shared branch OR self; OWN: self only; ALL: everything', () => {
    const b = resolveScope(p('BRANCH', [A]), spec) as { $or: Record<string, unknown>[] };
    expect(b.$or).toHaveLength(2);
    expect(String(b.$or[1]!._id)).toBe(USER);
    expect(Object.keys(resolveScope(p('OWN', [A]), spec))).toEqual(['_id']);
    expect(resolveScope(p('ALL', []), spec)).toEqual({});
  });
  it('narrowing to a branch drops the self-OR (strict), and still cannot widen', () => {
    expect(resolveScope(p('BRANCH', [A, B]), { ...spec, requestedBranchId: B })).toEqual({ branchIds: new Types.ObjectId(B) });
    expect(() => resolveScope(p('BRANCH', [A]), { ...spec, requestedBranchId: C })).toThrow(AppError);
  });
});

describe('resolveWriteBranch', () => {
  it('accepts a requested branch only if writable; derives the single branch otherwise', () => {
    expect(resolveWriteBranch(p('BRANCH', [A]))).toBe(A);
    expect(resolveWriteBranch(p('BRANCH', [A, B]), B)).toBe(B);
    expect(resolveWriteBranch(p('ALL', []), C)).toBe(C);
    expect(() => resolveWriteBranch(p('BRANCH', [A]), B)).toThrow(AppError);
  });
  it('never guesses when ambiguous', () => {
    expect(() => resolveWriteBranch(p('BRANCH', [A, B]))).toThrow(/branchId is required/);
    expect(() => resolveWriteBranch(p('ALL', []))).toThrow(/branchId is required/);
    expect(() => resolveWriteBranch(p('BRANCH', []))).toThrow(/branchId is required/);
    expect(() => resolveWriteBranch(p('ALL', []), 'nope')).toThrow(AppError);
  });
});

describe('assertBranchWritable', () => {
  it('allows ALL, allows own branches, refuses others', () => {
    expect(() => assertBranchWritable(p('ALL', []), C)).not.toThrow();
    expect(() => assertBranchWritable(p('BRANCH', [A]), A)).not.toThrow();
    expect(() => assertBranchWritable(p('OWN', [A]), B)).toThrow(AppError);
  });
});
