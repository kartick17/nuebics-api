import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VaultPasswordController } from './vault-password.controller';
import { VaultPasswordService } from './vault-password.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserChannelThrottlerGuard } from '../common/guards/user-channel-throttler.guard';
import { User, UserSchema } from '../shared/database/schemas/user.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [AuthController, VerificationController, VaultPasswordController],
  providers: [AuthService, VerificationService, VaultPasswordService, JwtAuthGuard, UserChannelThrottlerGuard],
})
export class AuthModule {}
