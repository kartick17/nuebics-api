import { ThrottlerModule, seconds } from '@nestjs/throttler';

export const throttlerConfig = ThrottlerModule.forRoot({
  throttlers: [
    { name: 'login', limit: 10, ttl: seconds(15 * 60) },
    { name: 'signup', limit: 10, ttl: seconds(60 * 60) },
    { name: 'resend', limit: 3, ttl: seconds(15 * 60) }
  ]
});
