import { describe, expect, it } from 'vitest';
import { registerJobs } from './registry';

describe('job registry', () => {
  it('registers valid jobs and can destroy them', async () => {
    const tasks = registerJobs([{ name: 'noop', schedule: '*/5 * * * *', run: async () => {} }], 'Asia/Kolkata');
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks.map((t) => t.destroy()));
  });
  it('rejects an invalid cron expression', () => {
    expect(() => registerJobs([{ name: 'bad', schedule: 'not a cron', run: async () => {} }], 'UTC')).toThrow(/bad/);
  });
});
