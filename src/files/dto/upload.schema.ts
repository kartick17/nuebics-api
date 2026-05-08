import { z } from 'zod';

export const uploadSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().int().positive(),
  folderId: z.string().nullable().optional()
});

export type UploadInput = z.infer<typeof uploadSchema>;
