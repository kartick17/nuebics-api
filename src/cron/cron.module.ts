import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { TrashPurgeScheduler } from './trash-purge.scheduler';
import { FoldersModule } from '../folders/folders.module';

@Module({
  imports: [FoldersModule],
  controllers: [CronController],
  providers: [TrashPurgeScheduler]
})
export class CronModule {}
