import { randomInt } from 'crypto';

/**
 * Generate a 6-digit numeric OTP using a cryptographically secure source.
 * randomInt's upper bound is exclusive, so this yields 100000–999999.
 */
export function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}
