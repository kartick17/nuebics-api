import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { FoldersModule } from '../folders/folders.module';

@Module({
  imports: [FoldersModule],
  controllers: [CronController]
})
export class CronModule {}
