import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { CryptoModule } from './shared/crypto/crypto.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    CryptoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
