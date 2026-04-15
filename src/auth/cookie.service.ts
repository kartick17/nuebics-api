import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import {
  CryptoService,
  ACCESS_TOKEN_SECONDS,
  REFRESH_TOKEN_SECONDS,
} from '../shared/crypto/crypto.service';
import type { UserDocument } from '../shared/database/schemas/user.schema';
import type { Env } from '../config/env.validation';

@Injectable()
export class CookieService {
  private readonly isProd: boolean;
  constructor(private readonly crypto: CryptoService, config: ConfigService<Env, true>) {
    this.isProd = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  setAccessCookie(res: Response, token: string) {
    res.cookie('access_token', this.crypto.encryptToken(token), {
      secure: this.isProd,
      sameSite: 'lax',
      maxAge: ACCESS_TOKEN_SECONDS * 1000,
      path: '/',
    });
  }

  setRefreshCookie(res: Response, token: string) {
    res.cookie('refresh_token', this.crypto.encryptToken(token), {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_SECONDS * 1000,
      path: '/',
    });
  }

  setUserCookie(res: Response, user: UserDocument) {
    const safe = {
      name: user.name,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      vaultCredentialVerifier: !!user.vaultCredentialVerifier,
    };
    res.cookie('user_details', JSON.stringify(safe), {
      secure: this.isProd,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_SECONDS * 1000,
      path: '/',
    });
    res.cookie('encrypted_user_details', JSON.stringify(user), {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_SECONDS * 1000,
      path: '/',
    });
  }

  clearAll(res: Response) {
    for (const name of ['access_token', 'refresh_token', 'user_details', 'encrypted_user_details']) {
      res.cookie(name, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax' });
    }
  }
}
