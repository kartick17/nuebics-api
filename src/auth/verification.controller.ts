import { Body, Controller, Get, Post, Res, UseGuards, UsePipes } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { VerificationService } from './verification.service';
import { CookieService } from './cookie.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserChannelThrottlerGuard } from '../common/guards/user-channel-throttler.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { verifyOtpSchema } from './dto/verify-otp.schema';
import type { VerifyOtpInput } from './dto/verify-otp.schema';
import { resendOtpSchema } from './dto/resend-otp.schema';
import type { ResendOtpInput } from './dto/resend-otp.schema';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly cookies: CookieService,
  ) {}

  @Get('verify-email')
  getEmail(@CurrentUser() auth: TokenPayload) {
    return this.verification.getEmailStatus(auth.userId);
  }

  @Post('verify-email')
  @UsePipes(new ZodValidationPipe(verifyOtpSchema))
  async verifyEmail(
    @CurrentUser() auth: TokenPayload,
    @Body() dto: VerifyOtpInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, already } = await this.verification.verifyEmail(auth.userId, dto.code);
    if (already) return { message: 'Email already verified.' };
    this.cookies.setUserCookie(res, user);
    return { message: 'Email verified successfully.' };
  }

  @Get('verify-phone')
  getPhone(@CurrentUser() auth: TokenPayload) {
    return this.verification.getPhoneStatus(auth.userId);
  }

  @Post('verify-phone')
  @UsePipes(new ZodValidationPipe(verifyOtpSchema))
  async verifyPhone(
    @CurrentUser() auth: TokenPayload,
    @Body() dto: VerifyOtpInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, already } = await this.verification.verifyPhone(auth.userId, dto.code);
    if (already) return { message: 'Phone already verified.' };
    this.cookies.setUserCookie(res, user);
    return { message: 'Phone verified successfully.' };
  }

  @Post('resend-otp')
  @UseGuards(JwtAuthGuard, UserChannelThrottlerGuard)
  @Throttle({ resend: { limit: 3, ttl: 15 * 60 * 1000 } })
  @UsePipes(new ZodValidationPipe(resendOtpSchema))
  async resend(@CurrentUser() auth: TokenPayload, @Body() dto: ResendOtpInput) {
    const { already } = await this.verification.resendOtp(auth.userId, dto.channel);
    return already
      ? { message: `${dto.channel === 'email' ? 'Email' : 'Phone'} already verified.` }
      : { message: 'Verification code sent.' };
  }
}
