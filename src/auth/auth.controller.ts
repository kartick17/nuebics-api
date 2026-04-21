import {
  Body, Controller, Get, HttpCode, Post, UnauthorizedException, UseGuards, UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { signupSchema } from './dto/signup.schema';
import type { SignupInput } from './dto/signup.schema';
import { loginSchema } from './dto/login.schema';
import type { LoginInput } from './dto/login.schema';
import { refreshSchema } from './dto/refresh.schema';
import type { RefreshInput } from './dto/refresh.schema';
import { toUserDetails } from './user-details';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  @Throttle({ signup: { limit: 10, ttl: 60 * 60 * 1000 } })
  @UsePipes(new ZodValidationPipe(signupSchema))
  async signup(@Body() dto: SignupInput) {
    await this.auth.signup(dto);
    return { ok: true, message: 'Account created successfully' };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ login: { limit: 10, ttl: 15 * 60 * 1000 } })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() dto: LoginInput) {
    const { user, accessToken, refreshToken } = await this.auth.login(dto);
    return {
      ok: true,
      message: 'Logged in successfully',
      user_details: toUserDetails(user),
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  async refresh(@Body() dto: RefreshInput) {
    const result = await this.auth.refresh(dto.refresh_token);
    if (!result) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    return {
      ok: true,
      message: 'Token refreshed',
      user_details: toUserDetails(result.user),
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() auth: TokenPayload) {
    const user = await this.auth.me(auth.userId);
    return { ok: true, user_details: toUserDetails(user) };
  }
}
