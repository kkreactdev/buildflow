export interface JobDefinition {
  name: string;
  /** Cron expression (evaluated in APP_TIMEZONE). */
  schedule: string;
  /** Must be idempotent: safe to run twice, concurrently, or after a restart. */
  run: () => Promise<void>;
}
