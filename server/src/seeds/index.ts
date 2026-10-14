import { connectDb, disconnectDb } from '../config/db';
import { getEnv } from '../config/env';
import { logger } from '../lib/logger';
import { seedAdmin } from './seedAdmin';
import { seedMasters } from './seedMasters';
import { seedRoles } from './seedRoles';
import { seedWorkflow } from './seedWorkflow';

/** `npm run seed` — safe to run any number of times. */
async function main(): Promise<void> {
  const env = getEnv();
  await connectDb({ uri: env.MONGODB_URI, requireReplicaSet: env.DB_REQUIRE_REPLICA_SET });
  const roles = await seedRoles();
  logger.info({ created: roles.created, existing: roles.existing }, 'Roles seeded');
  const masters = await seedMasters();
  logger.info(masters, 'Masters seeded');
  const workflow = await seedWorkflow();
  logger.info({ created: workflow.created, existing: workflow.existing }, 'Workflow seeded');
  const admin = await seedAdmin();
  logger.info({ result: admin }, 'Admin seed');
  if (admin === 'skipped-no-credentials') logger.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: no admin user created');
  await disconnectDb();
}

main().catch((err: unknown) => {
  process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
