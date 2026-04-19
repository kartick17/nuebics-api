import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CryptoJS from 'crypto-js';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../../config/env.validation';

export interface TokenPayload {
  userId: string;
  sessionId: string;
}

export interface RefreshPayload {
  userId: string;
  sessionId: string;
  exp: number;
}

export const ACCESS_TOKEN_SECONDS = 10 * 60;
export const REFRESH_TOKEN_DAYS = 5;
export const REFRESH_TOKEN_SECONDS = REFRESH_TOKEN_DAYS * 24 * 60 * 60;

@Injectable()
export class CryptoService {
  private readonly cryptoSecret: string;
  private readonly accessSecret: Uint8Array;
  private readonly refreshSecret: Uint8Array;

  constructor(config: ConfigService<Env, true>) {
    this.cryptoSecret = config.get('CRYPTO_SECRET', { infer: true });
    this.accessSecret = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET', { infer: true }));
    this.refreshSecret = new TextEncoder().encode(config.get('JWT_REFRESH_SECRET', { infer: true }));
  }

  encryptToken(token: string): string {
    return CryptoJS.AES.encrypt(token, this.cryptoSecret).toString();
  }

  decryptToken(encrypted: string): string | null {
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, this.cryptoSecret);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return decrypted || null;
    } catch {
      return null;
    }
  }

  async signAccessToken(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ userId, sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
      .sign(this.accessSecret);
  }

  async verifyAccessToken(token: string): Promise<TokenPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.accessSecret);
      return payload as unknown as TokenPayload;
    } catch {
      return null;
    }
  }

  async signRefreshToken(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ userId, sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_SECONDS}s`)
      .sign(this.refreshSecret);
  }

  async verifyRefreshToken(token: string): Promise<RefreshPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.refreshSecret);
      return payload as unknown as RefreshPayload;
    } catch {
      return null;
    }
  }
}
