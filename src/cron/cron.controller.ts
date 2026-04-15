import { Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { FoldersHelpers } from '../folders/folders.helpers';

@Controller('cron')
export class CronController {
  private readonly logger = new Logger(CronController.name);
  constructor(private readonly helpers: FoldersHelpers) {}

  @Post('purge-trash')
  @HttpCode(200)
  @UseGuards(CronSecretGuard)
  async purge() {
    const result = await this.helpers.purgeExpiredTrash();
    this.logger.log(`Purge complete: ${result.files} files, ${result.folders} folders deleted`);
    return { success: true, ...result };
  }
}
