import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger';
import { missedFollowupsJob } from './missedFollowups';
import { siteVisitRemindersJob } from './siteVisitReminders';
import { upcomingFollowupsJob } from './upcomingFollowups';
import type { JobDefinition } from './types';

export type { JobDefinition } from './types';

/** Every scheduled job. Each one is idempotent and safe to run concurrently with itself. */
export const jobs: JobDefinition[] = [missedFollowupsJob, upcomingFollowupsJob, siteVisitRemindersJob];

export function registerJobs(defs: JobDefinition[], timezone: string): ScheduledTask[] {
  return defs.map((job) => {
    if (!cron.validate(job.schedule)) throw new Error(`Invalid cron expression for job "${job.name}"`);
    return cron.schedule(
      job.schedule,
      async () => {
        const started = Date.now();
        try {
          await job.run();
          logger.info({ job: job.name, ms: Date.now() - started }, 'Job completed');
        } catch (err) {
          logger.error({ err, job: job.name }, 'Job failed');
        }
      },
      { timezone, name: job.name },
    );
  });
}
