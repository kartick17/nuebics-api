import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { TokenPayload } from '../../shared/crypto/crypto.service';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TokenPayload =>
    ctx.switchToHttp().getRequest().user,
);
