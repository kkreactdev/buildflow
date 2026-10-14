import { Types, type PipelineStage } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../lib/appError';
import { withTransaction } from '../../lib/transaction';
import { useTestDb } from '../../test/db';
import { Gadget, Note, principal, Shared, Widget } from '../../test/scopeModels';
import { ScopeGrant, ScopeRequiredError, GRANT } from './grant';
import { scopedRepo } from './index';
import { onSystemScope, systemRepo } from './system';

useTestDb();

const A = new Types.ObjectId();
const B = new Types.ObjectId();
const C = new Types.ObjectId();
const [ALICE, BOB, CAROL] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
const hex = (o: Types.ObjectId) => o.toHexString();

const sys = () => systemRepo(Widget, 'test', 'fixtures');
let ids: Record<string, string>;

beforeEach(async () => {
  const docs = await sys().insertMany([
    { name: 'a-alice', branchId: A, assignedTo: ALICE, amount: 10 },
    { name: 'a-bob', branchId: A, assignedTo: BOB, amount: 20 },
    { name: 'b-carol', branchId: B, assignedTo: CAROL, amount: 30 },
    { name: 'b-alice', branchId: B, assignedTo: ALICE, amount: 40 },
    { name: 'c-bob', branchId: C, assignedTo: BOB, amount: 50 },
  ]);
  ids = Object.fromEntries((docs as { name: string; _id: Types.ObjectId }[]).map((d) => [d.name, hex(d._id)]));
  await systemRepo(Gadget, 'test', 'fixtures').insertMany([{ name: 'g-a', branchId: A }, { name: 'g-b', branchId: B }]);
  await Note.create({ text: 'global' });
});

const names = (rows: { name?: string | null }[]) => rows.map((r) => r.name).sort();
const all = () => scopedRepo(Widget, principal('ALL'));
const branchA = () => scopedRepo(Widget, principal('BRANCH', [hex(A)]));
const aliceInA = () => scopedRepo(Widget, principal('OWN', [hex(A)], hex(ALICE)));

describe('1. ALL scope', () => {
  it('sees every branch and may narrow to one', async () => {
    expect(names(await all().find().lean())).toEqual(['a-alice', 'a-bob', 'b-alice', 'b-carol', 'c-bob']);
    expect(names(await scopedRepo(Widget, principal('ALL'), { requestedBranchId: hex(B) }).find().lean())).toEqual(['b-alice', 'b-carol']);
    expect(await all().countDocuments()).toBe(5);
  });
  it('can write to any branch', async () => {
    const w = await all().create({ name: 'new', branchId: C });
    expect(String(w.branchId)).toBe(hex(C));
  });
});

describe('2. BRANCH scope', () => {
  it('sees only its own branch(es)', async () => {
    expect(names(await branchA().find().lean())).toEqual(['a-alice', 'a-bob']);
    const ab = scopedRepo(Widget, principal('BRANCH', [hex(A), hex(B)]));
    expect(names(await ab.find().lean())).toEqual(['a-alice', 'a-bob', 'b-alice', 'b-carol']);
  });
  it('a user with no branches sees nothing (fails closed, not open)', async () => {
    expect(await scopedRepo(Widget, principal('BRANCH', [])).find().lean()).toEqual([]);
  });
});

describe('3. OWN scope', () => {
  it('sees only records assigned to it, inside its branches', async () => {
    expect(names(await aliceInA().find().lean())).toEqual(['a-alice']); // not a-bob; not b-alice (other branch)
    const bobAll = scopedRepo(Widget, principal('OWN', [hex(A), hex(C)], hex(BOB)));
    expect(names(await bobAll.find().lean())).toEqual(['a-bob', 'c-bob']);
  });
  it('another employee\'s record is not found by id', async () => {
    expect(await aliceInA().findById(ids['a-bob']!).lean()).toBeNull();
    expect(await aliceInA().findById(ids['a-alice']!).lean()).not.toBeNull();
  });
});

describe('4. client narrowing', () => {
  it('may narrow to an accessible branch', async () => {
    const r = scopedRepo(Widget, principal('BRANCH', [hex(A), hex(B)]), { requestedBranchId: hex(B) });
    expect(names(await r.find().lean())).toEqual(['b-alice', 'b-carol']);
  });
  it('cannot widen beyond accessible branches (403) — for BRANCH and OWN', () => {
    expect(() => scopedRepo(Widget, principal('BRANCH', [hex(A)]), { requestedBranchId: hex(B) })).toThrow(AppError);
    expect(() => scopedRepo(Widget, principal('OWN', [hex(A)]), { requestedBranchId: hex(C) })).toThrow(/access to that branch/);
  });
  it('a caller filter can never widen the scope', async () => {
    const r = branchA();
    expect(await r.find({ branchId: B }).lean()).toEqual([]);
    expect(names(await r.find({ branchId: { $in: [A, B, C] } }).lean())).toEqual(['a-alice', 'a-bob']);
    expect(names(await r.find({ $or: [{}, { branchId: B }] }).lean())).toEqual(['a-alice', 'a-bob']);
    expect(names(await r.find({ branchId: { $ne: null } }).lean())).toEqual(['a-alice', 'a-bob']);
    expect(await r.find({ _id: { $in: [ids['b-carol']] } }).lean()).toEqual([]);
  });
});

describe('5. direct id access', () => {
  it('findById / findOne by a foreign id returns nothing (also when the scope key collides with the filter key)', async () => {
    expect(await branchA().findById(ids['b-carol']!).lean()).toBeNull();
    expect(await branchA().findOne({ _id: new Types.ObjectId(ids['b-carol']) }).lean()).toBeNull();
    expect(await branchA().exists({ _id: new Types.ObjectId(ids['c-bob']) })).toBeNull();
    expect(await branchA().findById(ids['a-bob']!).lean()).not.toBeNull();
  });
});

describe('6. update', () => {
  it('cannot update another branch\'s record', async () => {
    const res = await branchA().updateOne({ _id: new Types.ObjectId(ids['b-carol']) }, { $set: { name: 'hacked' } });
    expect(res.matchedCount).toBe(0);
    expect((await sys().findById(ids['b-carol']!).lean())!.name).toBe('b-carol');
    expect(await branchA().findOneAndUpdate({ _id: new Types.ObjectId(ids['b-carol']) }, { $set: { name: 'x' } }, { new: true })).toBeNull();
  });
  it('updateMany({}) only touches in-scope records', async () => {
    const res = await branchA().updateMany({}, { $set: { amount: 1 } });
    expect(res.modifiedCount).toBe(2);
    expect((await sys().find({ branchId: B }).lean()).map((w) => w.amount).sort()).toEqual([30, 40]);
  });
  it('cannot move a record into (or out of reach via) another branch', async () => {
    const r = branchA();
    const id = new Types.ObjectId(ids['a-alice']);
    await expect(r.updateOne({ _id: id }, { $set: { branchId: B } })).rejects.toThrow(/access to that branch/);
    await expect(r.updateOne({ _id: id }, { branchId: B })).rejects.toThrow(AppError);
    await expect(r.updateOne({ _id: id }, { $unset: { branchId: 1 } })).rejects.toThrow(/not allowed/);
    await expect(r.updateOne({ _id: id }, [{ $set: { branchId: B } }])).rejects.toThrow(/pipeline/i);
    await expect(r.findOneAndUpdate({ _id: id }, { $set: { 'branchId': B } })).rejects.toThrow(AppError);
    expect(String((await sys().findById(ids['a-alice']!).lean())!.branchId)).toBe(hex(A));
  });
  it('moving within scope is fine; ALL may move across branches', async () => {
    const two = scopedRepo(Widget, principal('BRANCH', [hex(A), hex(B)]));
    await two.updateOne({ _id: new Types.ObjectId(ids['a-alice']) }, { $set: { branchId: B } });
    expect(String((await sys().findById(ids['a-alice']!).lean())!.branchId)).toBe(hex(B));
    await all().updateOne({ _id: new Types.ObjectId(ids['b-carol']) }, { $set: { branchId: C } });
    expect(String((await sys().findById(ids['b-carol']!).lean())!.branchId)).toBe(hex(C));
  });
  it('upsert is refused on scoped grants', async () => {
    await expect(branchA().updateOne({ name: 'ghost' }, { $set: { branchId: A } }, { upsert: true })).rejects.toThrow(/upsert/);
  });
  it('save(): re-checks scope and branch', async () => {
    const r = branchA();
    const doc = await r.findById(ids['a-alice']!);
    doc!.name = 'renamed';
    await r.save(doc!);
    expect((await sys().findById(ids['a-alice']!).lean())!.name).toBe('renamed');
    doc!.branchId = B;
    await expect(r.save(doc!)).rejects.toThrow(/access to that branch/);
    const foreign = (await sys().findById(ids['b-carol']!))!;
    await expect(r.save(foreign)).rejects.toThrow(AppError); // not in scope -> 404
  });
});

describe('create / branch ownership convention', () => {
  it('rejects creating in a branch outside scope; accepts own', async () => {
    await expect(branchA().create({ name: 'x', branchId: B })).rejects.toThrow(/access to that branch/);
    expect(await branchA().create({ name: 'x', branchId: A })).toBeTruthy();
    expect(await sys().countDocuments({ name: 'x' })).toBe(1);
  });
  it('branchId is required by the model convention', async () => {
    await expect(all().create({ name: 'no-branch' })).rejects.toThrow(/at least one|required/i);
  });
  it('insertMany / bulkWrite inserts are validated before anything is written', async () => {
    await expect(branchA().insertMany([{ name: 'ok', branchId: A }, { name: 'bad', branchId: B }])).rejects.toThrow(/access to that branch/);
    await expect(branchA().bulkWrite([{ insertOne: { document: { name: 'bad', branchId: B } } }])).rejects.toThrow(AppError);
    expect(await sys().countDocuments({ name: { $in: ['ok', 'bad'] } })).toBe(0);
  });
  it('bulkWrite updates/deletes are scoped and cannot upsert', async () => {
    await branchA().bulkWrite([
      { updateMany: { filter: {}, update: { $set: { amount: 99 } } } },
      { deleteOne: { filter: { _id: new Types.ObjectId(ids['b-carol']) } } },
    ]);
    expect((await sys().find({ amount: 99 }).lean()).map((w) => w.name).sort()).toEqual(['a-alice', 'a-bob']);
    expect(await sys().findById(ids['b-carol']!)).not.toBeNull();
    await expect(branchA().bulkWrite([{ updateOne: { filter: { name: 'n' }, update: { $set: { branchId: A } }, upsert: true } }])).rejects.toThrow(/upsert/);
  });
  it('writes join transactions through the session', async () => {
    await expect(
      withTransaction(async (session) => {
        await branchA().create({ name: 'tx', branchId: A }, { session });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await sys().countDocuments({ name: 'tx' })).toBe(0);
  });
});

describe('7. delete / archive', () => {
  it('cannot delete another branch\'s record', async () => {
    const r = branchA();
    expect((await r.deleteOne({ _id: new Types.ObjectId(ids['b-carol']) })).deletedCount).toBe(0);
    expect(await r.findOneAndDelete({ _id: new Types.ObjectId(ids['c-bob']) })).toBeNull();
    expect((await r.deleteMany({})).deletedCount).toBe(2); // only A's
    expect(await sys().countDocuments()).toBe(3);
  });
  it('cannot archive another branch\'s record; archiving own hides it by default', async () => {
    const r = branchA();
    expect(await r.archiveOne({ _id: new Types.ObjectId(ids['b-carol']) }, hex(ALICE))).toBe(false);
    expect((await sys().findById(ids['b-carol']!).lean())!.isArchived).toBe(false);
    expect(await r.archiveOne({ _id: new Types.ObjectId(ids['a-bob']) }, hex(ALICE))).toBe(true);
    expect(names(await r.find().lean())).toEqual(['a-alice']);
    expect(await r.countDocuments()).toBe(1);
    expect(await r.findById(ids['a-bob']!).lean()).toBeNull();
    const withArchived = scopedRepo(Widget, principal('BRANCH', [hex(A)]), { includeArchived: true });
    expect(names(await withArchived.find().lean())).toEqual(['a-alice', 'a-bob']);
    const row = await sys().findById(ids['a-bob']!).lean();
    expect(row).toMatchObject({ isArchived: true });
    expect(String(row!.archivedBy)).toBe(hex(ALICE));
  });
});

describe('8. count / list / search', () => {
  it('counts, distinct, regex search and projections cannot leak other branches', async () => {
    const r = branchA();
    expect(await r.countDocuments()).toBe(2);
    expect(await r.countDocuments({ name: /^b-/ })).toBe(0);
    expect(names(await r.find({ name: /alice/i }).lean())).toEqual(['a-alice']);
    expect((await r.distinct('name') as string[]).sort()).toEqual(['a-alice', 'a-bob']);
    expect(await r.exists({ name: 'c-bob' })).toBeNull();
    expect(await r.find().sort({ amount: -1 }).skip(0).limit(100).select('name').lean()).toHaveLength(2);
  });
  it('OWN counts only own records', async () => {
    expect(await aliceInA().countDocuments()).toBe(1);
  });
});

describe('9. aggregation', () => {
  const byBranch: PipelineStage[] = [{ $group: { _id: '$branchId', total: { $sum: '$amount' } } }, { $sort: { _id: 1 } }];
  it('prepends the scope $match', async () => {
    expect(await branchA().aggregate(byBranch)).toEqual([{ _id: A, total: 30 }]);
    expect(((await all().aggregate(byBranch)) as { total: number }[]).map((g) => g.total)).toEqual([30, 70, 50]);
    expect(await aliceInA().aggregate([{ $count: 'n' }])).toEqual([{ n: 1 }]);
    expect(await scopedRepo(Widget, principal('ALL'), { requestedBranchId: hex(B) }).aggregate([{ $count: 'n' }])).toEqual([{ n: 2 }]);
  });
  it('respects archive default and $facet', async () => {
    await branchA().archiveOne({ _id: new Types.ObjectId(ids['a-bob']) }, hex(ALICE));
    const [res] = await branchA().aggregate([{ $facet: { n: [{ $count: 'c' }] } }]);
    expect(res.n).toEqual([{ c: 1 }]);
  });
  it('refuses stages that escape the scope, and estimatedDocumentCount cannot be scoped', async () => {
    await expect(branchA().estimatedDocumentCount()).rejects.toThrow(/cannot be scoped/);
    const r = branchA();
    await expect(r.aggregate([{ $lookup: { from: 'gadgets', localField: 'branchId', foreignField: 'branchId', as: 'g' } }])).rejects.toThrow(/scoped collection/);
    await expect(r.aggregate([{ $facet: { x: [{ $lookup: { from: 'gadgets', pipeline: [], as: 'g' } }] } }])).rejects.toThrow(/scoped collection/);
    await expect(r.aggregate([{ $unionWith: 'widgets' }])).rejects.toThrow(/scoped collection/);
    await expect(r.aggregate([{ $out: 'stolen' }])).rejects.toThrow(/not allowed/);
    await expect(r.aggregate([{ $merge: { into: 'stolen' } }])).rejects.toThrow(/not allowed/);
    await expect(r.aggregate([{ $geoNear: { near: [0, 0], distanceField: 'd' } }])).rejects.toThrow(/first stage/);
  });
  it('allows joins into unscoped (global) collections', async () => {
    const res = await branchA().aggregate([{ $limit: 1 }, { $lookup: { from: 'notes', pipeline: [], as: 'notes' } }]);
    expect(res[0].notes).toHaveLength(1);
  });
});

describe('10. missing scope fails closed', () => {
  const required = (p: Promise<unknown> | PromiseLike<unknown>) => expect(Promise.resolve(p)).rejects.toMatchObject({ code: 'SCOPE_REQUIRED', httpStatus: 500 });

  it('bare model queries throw instead of returning the whole collection', async () => {
    await required(Widget.find().lean().exec());
    await required(Widget.find({}).exec());
    await required(Widget.findOne({}).exec());
    await required(Widget.findById(ids['a-alice']).exec());
    await required(Widget.countDocuments({}).exec());
    await required(Widget.exists({}).exec());
    await required(Widget.distinct('name').exec());
    await required(Widget.estimatedDocumentCount().exec());
    await required(Widget.aggregate([{ $match: {} }]).exec());
    await required(Widget.updateOne({}, { name: 'x' }).exec());
    await required(Widget.updateMany({}, { name: 'x' }).exec());
    await required(Widget.replaceOne({}, { name: 'x' }).exec());
    await required(Widget.findOneAndUpdate({}, { name: 'x' }).exec());
    await required(Widget.findOneAndReplace({}, { name: 'x' }).exec());
    await required(Widget.deleteOne({}).exec());
    await required(Widget.deleteMany({}).exec());
    await required(Widget.findOneAndDelete({}).exec());
    await required(Widget.create({ name: 'x', branchId: A }));
    await required(new Widget({ name: 'x', branchId: A }).save());
    await required(Widget.insertMany([{ name: 'x', branchId: A }]));
    await required(Widget.bulkWrite([{ deleteMany: { filter: {} } }]));
    await required((await sys().findById(ids['a-alice']!))!.deleteOne());
    await required((await sys().findById(ids['a-alice']!))!.updateOne({ name: 'x' }));
    expect(await sys().countDocuments()).toBe(5); // nothing was touched
    expect(await sys().countDocuments({ name: 'x' })).toBe(0);
  });

  it('the error names the model and operation and points at the fix', async () => {
    const err = await Widget.find().exec().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScopeRequiredError);
    expect((err as Error).message).toMatch(/find on scoped model "Widget".*scopedRepo/s);
  });

  it('a forged or malformed grant is not accepted', async () => {
    expect(() => new ScopeGrant(Symbol('x'), 'system', {}, {}, null, 'forged')).toThrow(/only be created by the scope layer/);
    const q = Widget.find({});
    (q as unknown as Record<symbol, unknown>)[GRANT] = { kind: 'system', filter: {}, allowedBranches: null };
    await required(q.exec());
  });

  it('a scoped repo cannot be pointed at an unscoped model', () => {
    expect(() => scopedRepo(Note, principal('ALL'))).toThrow(/not branch-scoped/);
  });

  it('unscoped (global) models are unaffected', async () => {
    expect(await Note.countDocuments()).toBe(1);
  });
});

describe('11. approved system operations', () => {
  it('work without a data scope, across every branch', async () => {
    const r = systemRepo(Widget, 'seed', 'bootstrap');
    expect(await r.countDocuments()).toBe(5);
    await r.updateMany({ branchId: B }, { $set: { amount: 0 } });
    expect(await r.countDocuments({ amount: 0 })).toBe(2);
    expect(await r.aggregate([{ $count: 'n' }])).toEqual([{ n: 5 }]);
    expect(await r.create({ name: 'sys', branchId: C })).toBeTruthy();
    expect(await r.deleteOne({ name: 'sys' })).toMatchObject({ deletedCount: 1 });
    expect(await systemRepo(Widget, 'job', 'sweep').estimatedDocumentCount()).toBe(5);
  });

  it('every use is reported with its reason, detail and model', () => {
    const seen: unknown[] = [];
    const off = onSystemScope((e) => seen.push(e));
    systemRepo(Widget, 'migration', 'backfill widgets');
    off();
    systemRepo(Widget, 'migration', 'after unsubscribe');
    expect(seen).toEqual([{ reason: 'migration', detail: 'backfill widgets', model: 'Widget', requestId: undefined }]);
  });

  it('system includes archived records; the test reason is refused outside NODE_ENV=test', async () => {
    await branchA().archiveOne({ _id: new Types.ObjectId(ids['a-bob']) }, hex(ALICE));
    expect(await sys().countDocuments()).toBe(5);
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => systemRepo(Widget, 'test', 'nope')).toThrow(/only available in NODE_ENV=test/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('a scoped grant cannot be used as system (no flag to disable scope)', async () => {
    const r = branchA() as unknown as { grant: unknown; opts: Record<string, unknown> };
    expect(Object.keys(r.opts)).not.toContain('skipScope');
    expect(names(await branchA().find({}, undefined, { skipScope: true } as never).lean())).toEqual(['a-alice', 'a-bob']);
  });
});

describe('shared (global + branch-owned) models', () => {
  const S = () => systemRepo(Shared, 'test', 'fixtures');
  beforeEach(async () => {
    await S().insertMany([{ name: 'global' }, { name: 'a-own', branchId: A }, { name: 'b-own', branchId: B }]);
  });
  const sh = (p: ReturnType<typeof principal>, branchId?: string) => scopedRepo(Shared, p, { requestedBranchId: branchId });

  it('everyone in scope can READ global records plus their branches\' records', async () => {
    expect(names(await sh(principal('BRANCH', [hex(A)])).find().lean())).toEqual(['a-own', 'global']);
    expect(names(await sh(principal('OWN', [hex(B)])).find().lean())).toEqual(['b-own', 'global']);
    expect(names(await sh(principal('BRANCH', [])).find().lean())).toEqual(['global']);
    expect(names(await sh(principal('ALL')).find().lean())).toEqual(['a-own', 'b-own', 'global']);
  });
  it('narrowing to a branch still includes global records', async () => {
    expect(names(await sh(principal('ALL'), hex(B)).find().lean())).toEqual(['b-own', 'global']);
    expect(names(await sh(principal('BRANCH', [hex(A), hex(B)]), hex(A)).find().lean())).toEqual(['a-own', 'global']);
  });
  it('non-ALL actors can edit/delete only their branch records, never global ones', async () => {
    const r = sh(principal('BRANCH', [hex(A)]));
    expect((await r.updateOne({ name: 'global' }, { $set: { name: 'hacked' } })).matchedCount).toBe(0);
    expect((await r.updateOne({ name: 'a-own' }, { $set: { name: 'a-edited' } })).matchedCount).toBe(1);
    expect((await r.deleteMany({})).deletedCount).toBe(1);
    expect(await S().countDocuments({ name: 'global' })).toBe(1);
    await expect(r.create({ name: 'new-global' })).rejects.toThrow(/at least one of your branches/);
    await expect(r.create({ name: 'b', branchId: B })).rejects.toThrow(AppError);
  });
  it('ALL can write global records', async () => {
    const r = sh(principal('ALL'));
    expect((await r.updateOne({ name: 'global' }, { $set: { name: 'g2' } })).matchedCount).toBe(1);
    expect(await r.create({ name: 'g3' })).toBeTruthy();
    await r.bulkWrite([{ updateOne: { filter: { name: 'g3' }, update: { $set: { name: 'g4' } } } }]);
    expect(await S().countDocuments({ name: 'g4' })).toBe(1);
  });
  it('bulkWrite by a non-ALL actor cannot touch global records', async () => {
    await sh(principal('BRANCH', [hex(A)])).bulkWrite([{ updateMany: { filter: {}, update: { $set: { name: 'x' } } } }]);
    expect(await S().countDocuments({ name: 'x' })).toBe(1); // only a-own
    expect(await S().countDocuments({ name: 'global' })).toBe(1);
  });
});
