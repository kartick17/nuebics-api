import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { DatabaseModule } from './shared/database/database.module';
import { StratusModule } from './shared/stratus/stratus.module';
import { throttlerConfig } from './throttler/throttler.config';
import { FoldersModule } from './folders/folders.module';
import { FilesModule } from './files/files.module';
import { TrashModule } from './trash/trash.module';
import { FavouritesModule } from './favourites/favourites.module';
import { CronModule } from './cron/cron.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv
    }),
    DatabaseModule,
    HealthModule,
    CryptoModule,
    StratusModule,
    throttlerConfig,
    AuthModule,
    FoldersModule,
    FilesModule,
    TrashModule,
    FavouritesModule,
    CronModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
