import { generateOtp } from './otp.util';

describe('generateOtp', () => {
  it('returns a 6-digit numeric string', () => {
    for (let i = 0; i < 100; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      const n = Number(otp);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});
