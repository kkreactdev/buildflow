import { connectDb, disconnectDb } from '../config/db';
import { getEnv } from '../config/env';
import { logger } from '../lib/logger';
import { addMissingActivityTypes } from './addMissingActivityTypes';
import { migratePermissionRenames } from './permissionRenames';

/** `npm run migrate` — idempotent data migrations for already-deployed databases. Safe to run on every deploy. */
async function main(): Promise<void> {
  const env = getEnv();
  await connectDb({ uri: env.MONGODB_URI, requireReplicaSet: env.DB_REQUIRE_REPLICA_SET });
  const renamed = await migratePermissionRenames();
  logger.info({ roles: renamed.length, changes: renamed }, renamed.length ? 'Permission renames applied' : 'Permission renames: nothing to do');
  const added = await addMissingActivityTypes();
  logger.info({ added: added.map((a) => a.code) }, added.length ? `Activity types added: ${added.map((a) => a.code).join(', ')}` : 'Activity types: nothing to do');
  await disconnectDb();
}

main().catch((err: unknown) => {
  process.stderr.write(`Migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
