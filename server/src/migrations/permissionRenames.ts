import { WILDCARD } from '../core/permissions/catalog';
import { recordAudit } from '../core/audit/audit.service';
import { Role } from '../modules/roles/role.model';

/**
 * Permissions that were renamed after roles had already been stored. Seeds never overwrite roles an
 * administrator may have edited, so deployed roles keep the OLD key, which nothing checks any more:
 * their holders would silently lose the ability. This migration carries the grant over to the new key.
 */
export interface PermissionRename {
  from: string;
  to: string;
}

export const PERMISSION_RENAMES: readonly PermissionRename[] = [
  { from: 'enquiries.delete', to: 'enquiries.archive' }, // Phase 5: enquiries are archived, not deleted
  { from: 'clients.delete', to: 'clients.archive' }, // Phase 4: same change for clients
  { from: 'followups.delete', to: 'followups.archive' }, // Phase 6: follow-ups are archived, not deleted
  { from: 'units.delete', to: 'units.archive' }, // Phase 7: units are archived, not deleted
  { from: 'sitevisits.delete', to: 'sitevisits.archive' }, // Phase 8: site visits are archived, not deleted
  { from: 'referrals.delete', to: 'referrals.archive' }, // Phase 10: referrals are archived, not deleted
  { from: 'documents.delete', to: 'documents.archive' }, // Phase 11: documents are archived, not deleted
];

export interface MigratedRole {
  roleKey: string;
  from: string;
  to: string;
}

/**
 * Roles that hold `from` also get `to`, and `from` is removed (an unknown key would make the role
 * un-editable in the Roles UI). Properties:
 *  - additive: only `$addToSet` / `$pull` on the two keys, so every other (including custom) permission
 *    is left exactly as it is, and an existing `to` is never duplicated;
 *  - idempotent: after one run nothing holds `from`, so a second run finds nothing and writes nothing;
 *  - resumable: if interrupted between the add and the pull, a re-run finishes the job;
 *  - the Super Admin wildcard role (and any role holding `*`) is skipped: it already grants everything;
 *  - each changed role is audited (who: system, what: permissions before/after).
 */
export async function migratePermissionRenames(renames: readonly PermissionRename[] = PERMISSION_RENAMES): Promise<MigratedRole[]> {
  const changed: MigratedRole[] = [];
  for (const { from, to } of renames) {
    const roles = await Role.find({ permissions: { $all: [from], $ne: WILDCARD } }).lean(); // holds `from`, and is not a wildcard role
    for (const role of roles) {
      await Role.updateOne({ _id: role._id }, { $addToSet: { permissions: to } });
      await Role.updateOne({ _id: role._id }, { $pull: { permissions: from } });
      const after = await Role.findById(role._id).lean();
      await recordAudit({
        entityType: 'role',
        entityId: role._id,
        action: 'permissions_migrated',
        before: { permissions: [...role.permissions].sort() },
        after: { permissions: [...(after?.permissions ?? [])].sort() },
        reason: `Permission renamed: ${from} -> ${to}`,
      });
      changed.push({ roleKey: role.key, from, to });
    }
  }
  return changed;
}
