import { z } from 'zod';
// Phone is disabled until we have an SMS provider. Re-add 'phone' to the enum
// when SMS OTP delivery is wired up.
export const resendOtpSchema = z.object({
  channel: z.enum(['email'])
});
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
