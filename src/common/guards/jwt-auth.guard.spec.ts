import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { validateEnv } from '../../config/env.validation';

const makeCtx = (authHeader?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: authHeader ? { authorization: authHeader } : {} }),
    }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let crypto: CryptoService;

  beforeAll(async () => {
    process.env.CRYPTO_SECRET ||= 'a'.repeat(64);
    process.env.JWT_ACCESS_SECRET ||= 'b'.repeat(64);
    process.env.JWT_REFRESH_SECRET ||= 'c'.repeat(64);
    process.env.MONGODB_URI ||= 'mongodb://localhost/test';
    process.env.AWS_ACCESS_KEY_ID ||= 'x';
    process.env.AWS_SECRET_ACCESS_KEY ||= 'x';
    process.env.AWS_REGION ||= 'x';
    process.env.AWS_S3_BUCKET_NAME ||= 'x';
    process.env.CRON_SECRET ||= 'x';

    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
      providers: [JwtAuthGuard, CryptoService],
    }).compile();

    guard = mod.get(JwtAuthGuard);
    crypto = mod.get(CryptoService);
  });

  it('rejects missing Authorization', async () => {
    await expect(guard.canActivate(makeCtx())).rejects.toThrow('Unauthorized');
  });

  it('rejects non-Bearer', async () => {
    await expect(guard.canActivate(makeCtx('Basic abc'))).rejects.toThrow('Unauthorized');
  });

  it('rejects invalid token', async () => {
    await expect(guard.canActivate(makeCtx('Bearer garbage'))).rejects.toThrow('Unauthorized');
  });

  it('accepts valid encrypted token and attaches req.user', async () => {
    const raw = await crypto.signAccessToken('u', 's');
    const encrypted = crypto.encryptToken(raw);
    const req: any = { headers: { authorization: `Bearer ${encrypted}` } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);
    expect(req.user).toMatchObject({ userId: 'u', sessionId: 's' });
  });
});
