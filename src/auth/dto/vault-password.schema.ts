import { z } from 'zod';
export const setVaultPasswordSchema = z.object({ encryptedToken: z.string().min(1) });
export type SetVaultPasswordInput = z.infer<typeof setVaultPasswordSchema>;
