import { connectDb, disconnectDb } from './config/db';
import { getEnv } from './config/env';
import { jobs, registerJobs } from './jobs/registry';
import { logger } from './lib/logger';

/** Separate process: runs scheduled jobs so they never compete with API requests. */
async function main(): Promise<void> {
  const env = getEnv();

  await connectDb({ uri: env.MONGODB_URI, requireReplicaSet: env.DB_REQUIRE_REPLICA_SET });
  const tasks = registerJobs(jobs, env.APP_TIMEZONE);
  logger.info({ jobs: jobs.map((j) => j.name), timezone: env.APP_TIMEZONE }, 'BuildFlow worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker shutting down');
    await Promise.all(tasks.map((t) => t.destroy()));
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  process.stderr.write(`Failed to start BuildFlow worker: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
