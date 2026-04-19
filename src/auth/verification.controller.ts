import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VerificationService } from './verification.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserChannelThrottlerGuard } from '../common/guards/user-channel-throttler.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { verifyOtpSchema } from './dto/verify-otp.schema';
import type { VerifyOtpInput } from './dto/verify-otp.schema';
import { resendOtpSchema } from './dto/resend-otp.schema';
import type { ResendOtpInput } from './dto/resend-otp.schema';
import { toUserDetails } from './user-details';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('verify-email')
  getEmail(@CurrentUser() auth: TokenPayload) {
    return this.verification.getEmailStatus(auth.userId);
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @CurrentUser() auth: TokenPayload,
    @Body(new ZodValidationPipe(verifyOtpSchema)) dto: VerifyOtpInput,
  ) {
    const { user, already } = await this.verification.verifyEmail(auth.userId, dto.code);
    return {
      ok: true,
      message: already ? 'Email already verified.' : 'Email verified successfully.',
      user_details: toUserDetails(user),
    };
  }

  @Get('verify-phone')
  getPhone(@CurrentUser() auth: TokenPayload) {
    return this.verification.getPhoneStatus(auth.userId);
  }

  @Post('verify-phone')
  @HttpCode(200)
  async verifyPhone(
    @CurrentUser() auth: TokenPayload,
    @Body(new ZodValidationPipe(verifyOtpSchema)) dto: VerifyOtpInput,
  ) {
    const { user, already } = await this.verification.verifyPhone(auth.userId, dto.code);
    return {
      ok: true,
      message: already ? 'Phone already verified.' : 'Phone verified successfully.',
      user_details: toUserDetails(user),
    };
  }

  @Post('resend-otp')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, UserChannelThrottlerGuard)
  @Throttle({ resend: { limit: 3, ttl: 15 * 60 * 1000 } })
  async resend(
    @CurrentUser() auth: TokenPayload,
    @Body(new ZodValidationPipe(resendOtpSchema)) dto: ResendOtpInput,
  ) {
    const { already } = await this.verification.resendOtp(auth.userId, dto.channel);
    return already
      ? { ok: true, message: `${dto.channel === 'email' ? 'Email' : 'Phone'} already verified.` }
      : { ok: true, message: 'Verification code sent.' };
  }
}
