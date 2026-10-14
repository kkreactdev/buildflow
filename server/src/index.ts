import { buildApp } from './app';
import { connectDb, disconnectDb } from './config/db';
import { EnvError, getEnv } from './config/env';
import { logger } from './lib/logger';

async function main(): Promise<void> {
  const env = getEnv();

  await connectDb({ uri: env.MONGODB_URI, requireReplicaSet: env.DB_REQUIRE_REPLICA_SET });

  const app = buildApp();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'BuildFlow API listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  const message = err instanceof EnvError || err instanceof Error ? err.message : String(err);
  process.stderr.write(`Failed to start BuildFlow API: ${message}\n`);
  process.exit(1);
});
