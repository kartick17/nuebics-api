import { z } from 'zod';

export const refreshSchema = z.object({
  refresh_token: z.string().trim().min(10, 'refresh_token is required')
});

export type RefreshInput = z.infer<typeof refreshSchema>;
