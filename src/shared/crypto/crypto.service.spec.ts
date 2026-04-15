import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import CryptoJS from 'crypto-js';
import { SignJWT, jwtVerify } from 'jose';
import { CryptoService } from './crypto.service';
import { validateEnv } from '../../config/env.validation';

describe('CryptoService — parity with Next.js source', () => {
  let service: CryptoService;

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
      providers: [CryptoService],
    }).compile();
    service = mod.get(CryptoService);
  });

  it('decrypts ciphertext produced by the Next.js implementation', () => {
    const plaintext = 'hello.world.jwt';
    const cipher = CryptoJS.AES.encrypt(plaintext, process.env.CRYPTO_SECRET!).toString();
    expect(service.decryptToken(cipher)).toBe(plaintext);
  });

  it('produces ciphertext decryptable by the Next.js implementation', () => {
    const plaintext = 'another.jwt.here';
    const cipher = service.encryptToken(plaintext);
    const bytes = CryptoJS.AES.decrypt(cipher, process.env.CRYPTO_SECRET!);
    expect(bytes.toString(CryptoJS.enc.Utf8)).toBe(plaintext);
  });

  it('returns null for garbage input (matches source)', () => {
    expect(service.decryptToken('not-valid-ciphertext')).toBeNull();
  });

  it('signs an access JWT that verifies with the same secret via jose', async () => {
    const token = await service.signAccessToken('userA', 'sessionA');
    const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    expect(payload.userId).toBe('userA');
    expect(payload.sessionId).toBe('sessionA');
  });

  it('round-trips access token through encrypt → verify', async () => {
    const token = await service.signAccessToken('u1', 's1');
    const encrypted = service.encryptToken(token);
    const verified = await service.verifyAccessToken(encrypted);
    expect(verified?.userId).toBe('u1');
    expect(verified?.sessionId).toBe('s1');
  });

  it('shouldRotate returns true when < 1 day left', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(service.shouldRotate(nowSec + 30 * 60)).toBe(true);
    expect(service.shouldRotate(nowSec + 3 * 24 * 60 * 60)).toBe(false);
  });

  it('verifies a token signed by the source SignJWT call (same params)', async () => {
    const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
    const sourceToken = await new SignJWT({ userId: 'x', sessionId: 'y' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('600s')
      .sign(secret);
    const encrypted = service.encryptToken(sourceToken);
    const verified = await service.verifyAccessToken(encrypted);
    expect(verified?.userId).toBe('x');
    expect(verified?.sessionId).toBe('y');
  });
});
