import { z } from 'zod';

export const confirmSchema = z.object({
  key: z.string().min(1),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().int().positive(),
  folderId: z.string().nullable().optional(),
});

export type ConfirmInput = z.infer<typeof confirmSchema>;
