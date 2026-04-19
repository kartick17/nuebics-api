import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { VaultPasswordService } from './vault-password.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { setVaultPasswordSchema } from './dto/vault-password.schema';
import type { SetVaultPasswordInput } from './dto/vault-password.schema';
import { toUserDetails } from './user-details';

@Controller('auth/vault-password')
@UseGuards(JwtAuthGuard)
export class VaultPasswordController {
  constructor(private readonly service: VaultPasswordService) {}

  @Get()
  async get(@CurrentUser() auth: TokenPayload) {
    const verifier = await this.service.getVerifier(auth.userId);
    return { ok: true, verifier };
  }

  @Post()
  @HttpCode(200)
  async set(
    @CurrentUser() auth: TokenPayload,
    @Body(new ZodValidationPipe(setVaultPasswordSchema)) dto: SetVaultPasswordInput,
  ) {
    const result = await this.service.setVerifier(auth.userId, dto.encryptedToken);
    if (result.alreadySet) {
      return { ok: true, credentialChecker: result.credentialChecker };
    }
    return {
      ok: true,
      message: 'Vault password set successfully.',
      user_details: toUserDetails(result.user),
    };
  }
}
