import { getEnv } from '../config/env';
import { systemRepo } from '../core/scope/system';
import { hashPassword } from '../modules/auth/auth.service';
import { Role } from '../modules/roles/role.model';
import { User } from '../modules/users/user.model';

export type SeedAdminResult = 'created' | 'exists' | 'skipped-no-credentials' | 'skipped-no-role';

/**
 * Bootstraps one Super Admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Idempotent and non-destructive: an existing user (matched by email) is never
 * modified, so re-running can never reset a password. Credentials come only
 * from the environment and are never logged.
 */
export async function seedAdmin(): Promise<SeedAdminResult> {
  const env = getEnv();
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) return 'skipped-no-credentials';
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const users = systemRepo(User, 'seed', 'bootstrap admin');
  if (await users.exists({ email })) return 'exists';
  const role = await Role.findOne({ key: 'SUPER_ADMIN' }).lean();
  if (!role) return 'skipped-no-role';
  await users.create({
    name: env.SEED_ADMIN_NAME,
    email,
    passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
    roleId: role._id,
    branchIds: [],
    isActive: true,
  });
  return 'created';
}
