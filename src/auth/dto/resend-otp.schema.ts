import { z } from 'zod';
export const resendOtpSchema = z.object({ channel: z.enum(['email', 'phone']) });
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
