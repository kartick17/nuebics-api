import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';
import { TrashPurgeScheduler } from './trash-purge.scheduler';
import { FoldersHelpers } from '../folders/folders.helpers';
import type { Env } from '../config/env.validation';

const purgeExpiredTrash = jest.fn();
const addCronJob = jest.fn();

const helpers = { purgeExpiredTrash } as unknown as FoldersHelpers;
const registry = { addCronJob } as unknown as SchedulerRegistry;

function configWith(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key]
  } as unknown as ConfigService<Env, true>;
}

function makeScheduler(values: Partial<Env>): TrashPurgeScheduler {
  return new TrashPurgeScheduler(helpers, configWith(values), registry);
}

describe('TrashPurgeScheduler', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('onModuleInit', () => {
    it('registers one cron job when enabled', () => {
      const scheduler = makeScheduler({
        TRASH_PURGE_ENABLED: true,
        TRASH_PURGE_CRON: '0 3 * * *'
      });

      scheduler.onModuleInit();

      expect(addCronJob).toHaveBeenCalledTimes(1);
      const [name, job] = addCronJob.mock.calls[0] as [string, CronJob];
      expect(name).toBe('trash-auto-purge');
      void job.stop(); // don't leave a live timer behind
    });

    it('registers no job when disabled', () => {
      const scheduler = makeScheduler({ TRASH_PURGE_ENABLED: false });

      scheduler.onModuleInit();

      expect(addCronJob).not.toHaveBeenCalled();
    });
  });

  describe('runPurge', () => {
    it('calls purgeExpiredTrash', async () => {
      purgeExpiredTrash.mockResolvedValueOnce({ files: 2, folders: 1 });
      const scheduler = makeScheduler({});

      await scheduler.runPurge();

      expect(purgeExpiredTrash).toHaveBeenCalledTimes(1);
    });

    it('swallows and does not rethrow a purge error', async () => {
      purgeExpiredTrash.mockRejectedValueOnce(new Error('boom'));
      const scheduler = makeScheduler({});

      await expect(scheduler.runPurge()).resolves.toBeUndefined();
    });
  });
});
