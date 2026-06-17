import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { FoldersHelpers } from '../folders/folders.helpers';
import type { Env } from '../config/env.validation';

const JOB_NAME = 'trash-auto-purge';

/**
 * Runs the expired-trash purge on a schedule, inside the API process.
 * The schedule and an on/off switch come from validated env config.
 */
@Injectable()
export class TrashPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(TrashPurgeScheduler.name);

  constructor(
    private readonly helpers: FoldersHelpers,
    private readonly config: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry
  ) {}

  onModuleInit(): void {
    if (!this.config.get('TRASH_PURGE_ENABLED', { infer: true })) {
      this.logger.log('Trash auto-purge is disabled (TRASH_PURGE_ENABLED).');
      return;
    }

    const cronTime = this.config.get('TRASH_PURGE_CRON', { infer: true });
    // Single instance: this job fires in-process. If the API ever runs on
    // multiple replicas, add a leader lock here so it runs once per cycle.
    const job = CronJob.from({
      cronTime,
      onTick: () => void this.runPurge(),
      start: false
    });
    this.registry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Trash auto-purge scheduled (${cronTime}).`);
  }

  /** Purge expired trash. Errors are logged, never thrown, so the timer lives. */
  async runPurge(): Promise<void> {
    try {
      const result = await this.helpers.purgeExpiredTrash();
      this.logger.log(
        `Auto-purge complete: ${result.files} files, ${result.folders} folders deleted`
      );
    } catch (err) {
      this.logger.error(
        'Auto-purge failed',
        err instanceof Error ? err.stack : String(err)
      );
    }
  }
}
