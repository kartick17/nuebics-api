import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { DatabaseModule } from './shared/database/database.module';
import { S3Module } from './shared/s3/s3.module';
import { throttlerConfig } from './throttler/throttler.config';
import { FoldersModule } from './folders/folders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    CryptoModule,
    S3Module,
    throttlerConfig,
    AuthModule,
    FoldersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
