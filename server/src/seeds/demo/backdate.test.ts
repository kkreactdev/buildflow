import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { principalWith, seedAll } from '../../test/factories';
import { useTestDb } from '../../test/db';
import { Branch } from '../../modules/branches/branch.model';
import { Enquiry } from '../../modules/enquiries/enquiry.model';
import { FollowUp } from '../../modules/followups/followup.model';
import { systemRepo } from '../../core/scope/system';
import { backdate } from './backdate';

useTestDb();
beforeEach(seedAll);

describe('demo back-dating', () => {
  it('moves the immutable createdAt of a record the seed created, through the scoped repository, and nothing else', async () => {
    const branch = await systemRepo(Branch, 'test', 'fixtures').create({ name: 'B', code: 'B1' });
    const other = new Types.ObjectId();
    const rows = systemRepo(Enquiry, 'test', 'fixtures');
    const e = await rows.create({ enquiryNo: 'ENQ-000001', branchId: branch._id, personId: new Types.ObjectId(), personName: 'A', phoneE164: '+919000010201', stageCode: 'NEW', stageChangedAt: new Date(), sourceId: new Types.ObjectId(), assignedTo: other, createdBy: other });
    const f = await rows.create({ enquiryNo: 'ENQ-000002', branchId: branch._id, personId: new Types.ObjectId(), personName: 'B', phoneE164: '+919000010202', stageCode: 'NEW', stageChangedAt: new Date(), sourceId: new Types.ObjectId(), assignedTo: other, createdBy: other });
    const admin = principalWith('ALL', ['*'], []);
    const past = new Date('2026-01-05T04:30:00Z');
    await backdate(Enquiry, admin, new Set([String(e._id)]), String(e._id), { createdAt: past });
    expect((await rows.findById(String(e._id)).lean())!.createdAt).toEqual(past);
    expect((await rows.findById(String(f._id)).lean())!.createdAt.getTime()).toBeGreaterThan(past.getTime()); // the other record is untouched
    void FollowUp;
  });

  it('refuses a record that this run did not create', async () => {
    await expect(backdate(Enquiry, principalWith('ALL', ['*'], []), new Set(), String(new Types.ObjectId()), { createdAt: new Date() })).rejects.toThrow(/did not create/);
  });
});
