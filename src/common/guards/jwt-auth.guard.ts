import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { CryptoService } from '../../shared/crypto/crypto.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly crypto: CryptoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Unauthorized');
    const token = header.slice(7).trim();
    if (!token) throw new UnauthorizedException('Unauthorized');
    const payload = await this.crypto.verifyAccessToken(token);
    if (!payload) throw new UnauthorizedException('Unauthorized');
    req.user = payload;
    return true;
  }
}
