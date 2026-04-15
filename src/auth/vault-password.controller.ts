import { Body, Controller, Get, Post, Res, UseGuards, UsePipes } from '@nestjs/common';
import type { Response } from 'express';
import { VaultPasswordService } from './vault-password.service';
import { CookieService } from './cookie.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { setVaultPasswordSchema } from './dto/vault-password.schema';
import type { SetVaultPasswordInput } from './dto/vault-password.schema';

@Controller('auth/vault-password')
@UseGuards(JwtAuthGuard)
export class VaultPasswordController {
  constructor(
    private readonly service: VaultPasswordService,
    private readonly cookies: CookieService,
  ) {}

  @Get()
  async get(@CurrentUser() auth: TokenPayload) {
    const verifier = await this.service.getVerifier(auth.userId);
    return { verifier };
  }

  @Post()
  @UsePipes(new ZodValidationPipe(setVaultPasswordSchema))
  async set(
    @CurrentUser() auth: TokenPayload,
    @Body() dto: SetVaultPasswordInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.setVerifier(auth.userId, dto.encryptedToken);
    if (result.alreadySet) return { credentialChecker: result.credentialChecker };
    this.cookies.setUserCookie(res, result.user);
    return { message: 'Vault password set successfully.' };
  }
}
