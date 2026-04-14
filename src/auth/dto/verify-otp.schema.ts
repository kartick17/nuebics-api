import { z } from 'zod';
export const verifyOtpSchema = z.object({ code: z.string().min(1) });
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
