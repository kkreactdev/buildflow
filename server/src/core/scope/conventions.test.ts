import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
function sources(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.includes(`${join(SRC, 'test')}/`)) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(SRC, p);
// Comments are stripped so prose mentioning an API doesn't count as a use of it.
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const withText = sources().map((p) => ({ file: rel(p), text: stripComments(readFileSync(p, 'utf8')) }));
const filesMatching = (re: RegExp) => withText.filter((f) => re.test(f.text)).map((f) => f.file).sort();

describe('scope-layer conventions (a failing test here means a reviewed decision is needed)', () => {
  it('only these files may bypass the data scope via systemRepo()', () => {
    // Adding a file here is a security-relevant change: state the reason in the PR.
    expect(filesMatching(/\bsystemRepo\(/)).toEqual([
      'core/activity/activity.service.ts', // 'event': append-only activity recording
      'core/activity/activityTypes.ts', // 'integrity': does this ACTIVITY_TYPE exist?
      'core/audit/audit.service.ts', // 'event': append-only audit recording
      'core/notify/notification.service.ts', // 'notify': creating notifications (dedupe check + insert)
      'core/notify/recipients.ts', // 'notify': who should receive an event (ids only)
      'jobs/missedFollowups.ts', // 'job': the missed-follow-up sweep (+ 'notify' for display names)
      'jobs/siteVisitReminders.ts', // 'job': upcoming site visit reminders
      'jobs/upcomingFollowups.ts', // 'job': upcoming follow-up reminders
      'middleware/authenticate.ts', // 'auth': builds the principal
      'migrations/addMissingActivityTypes.ts', // 'integrity': backfills missing global ACTIVITY_TYPE masters — no principal exists, no user/branch row is written
      'modules/auth/auth.service.ts', // 'auth': login/refresh/session (no principal yet)
      'modules/branches/branch.service.ts', // 'integrity': branch code uniqueness
      'modules/clients/client.references.ts', // 'integrity': is a client category in use?
      'modules/documents/document.references.ts', // 'integrity': is a document type in use?
      'modules/enquiries/enquiry.references.ts', // 'integrity': is a master value used by any enquiry?
      'modules/followups/followup.masters.ts', // 'integrity': resolve a FOLLOWUP_STATUS by system key
      'modules/followups/followup.references.ts', // 'integrity': is a follow-up type/status in use?
      'modules/persons/person.service.ts', // 'identity': existence-only phone checks, audited linking, projection sync
      'modules/referrals/referral.masters.ts', // 'integrity': resolve a REFERRAL_TYPE by system key
      'modules/referrals/referral.references.ts', // 'integrity': is a referral type in use?
      'modules/roles/role.service.ts', // 'integrity': role-in-use check
      'modules/sellers/seller.eligibility.ts', // 'integrity': is a seller-origin unit withheld from buyers? (unit ids only; must not depend on the caller's OWN scope)
      'modules/sellers/seller.masters.ts', // 'integrity': resolve SELLER_STATUS / PROPERTY_STATUS values (branch-less global masters, read-only)
      'modules/sitevisits/sitevisit.masters.ts', // 'integrity': resolve a SITEVISIT_STATUS / the post-visit follow-up type
      'modules/sitevisits/sitevisit.references.ts', // 'integrity': is a visit status in use?
      'modules/units/unit.masters.ts', // 'integrity': resolve a UNIT_STATUS by system key
      'modules/units/unit.references.ts', // 'integrity': is a master value used by any unit?
      'modules/users/user.service.ts', // 'integrity': global email uniqueness
      'seeds/seedAdmin.ts', // 'seed'
      'seeds/seedMasters.ts', // 'seed'
    ]);
  });

  it('ScopeGrant is never imported outside the scope layer', () => {
    expect(filesMatching(/from '[^']*scope\/grant'|from '\.\/grant'/).filter((f) => !f.startsWith('core/scope/'))).toEqual([]);
  });

  it('no feature code touches a scoped model directly (bare Model.find/update/create/...)', () => {
    const scopedModels = ['User', 'Branch', 'Master', 'Activity', 'AuditLog', 'Person', 'Client', 'Enquiry', 'EnquiryStageHistory', 'EnquiryAssignment', 'FollowUp', 'Notification', 'Unit', 'UnitAssignment', 'SiteVisit', 'SiteVisitAssignment', 'Booking', 'BookingEvent', 'BookingConflict', 'Referral', 'ReferralAssignment', 'DocumentRecord', 'Seller', 'SellerProperty', 'SellerPropertyNegotiation', 'SellerPropertyVerification', 'SellerPropertyWork', 'SellerStatusHistory'];
    const call = new RegExp(`\\b(${scopedModels.join('|')})\\.(find|findOne|findById|create|insertMany|bulkWrite|update\\w*|delete\\w*|count\\w*|estimated\\w*|exists|aggregate|distinct|replaceOne|findOneAnd\\w*|findByIdAnd\\w*)\\(`);
    expect(filesMatching(call)).toEqual([]);
  });

  it('the raw driver escape hatches are not used (they bypass the scope plugin)', () => {
    expect(filesMatching(/\.collection\.(find|aggregate|update|delete|insert|bulkWrite|count)|connection\.db\.collection\(/).filter((f) => !f.startsWith('core/scope/'))).toEqual([]);
  });

  it('every model that stores a branch relationship declares its scope', () => {
    const models = withText.filter((f) => /\.model\.ts$/.test(f.file));
    const branchy = models.filter((f) => /\b(branchId|branchIds)\b/.test(f.text) && !/core\//.test(f.file));
    for (const m of branchy) expect(m.text, `${m.file} has a branch field but no scopePlugin`).toMatch(/scopePlugin/);
  });
});
