import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CryptoService } from '../../shared/crypto/crypto.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly crypto: CryptoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return false;
    const token = header.slice(7).trim();
    if (!token) return false;
    const payload = await this.crypto.verifyAccessToken(token);
    if (!payload) return false;
    req.user = payload;
    return true;
  }
}
