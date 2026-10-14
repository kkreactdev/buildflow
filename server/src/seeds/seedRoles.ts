import { Role } from '../modules/roles/role.model';
import { SYSTEM_ROLES } from './systemRoles';

export interface SeedRolesResult {
  created: string[];
  existing: string[];
}

/**
 * Idempotent. Creates missing system roles by key and never overwrites roles an
 * administrator has since customised, EXCEPT Super Admin, whose wildcard grant
 * and ALL scope are re-asserted every run (it is the root of trust).
 * Permissions live in code (the catalog), so there is no permissions collection
 * to seed.
 */
export async function seedRoles(): Promise<SeedRolesResult> {
  const result: SeedRolesResult = { created: [], existing: [] };
  for (const def of SYSTEM_ROLES) {
    const res = await Role.updateOne(
      { key: def.key },
      { $setOnInsert: { name: def.name, description: def.description, permissions: def.permissions, dataScope: def.dataScope, isSystem: true, isActive: true } },
      { upsert: true },
    );
    (res.upsertedCount ? result.created : result.existing).push(def.key);
  }
  await Role.updateOne({ key: 'SUPER_ADMIN' }, { $set: { permissions: ['*'], dataScope: 'ALL', isSystem: true, isActive: true } });
  return result;
}
