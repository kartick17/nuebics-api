import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class UserChannelThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.userId ?? 'anon';
    const channel = req.body?.channel ?? 'unknown';
    return `${userId}:${channel}`;
  }
}
