import { z } from 'zod';
import { fileNameSchema } from '../../folders/dto/_shared';

export const updateFileSchema = z.object({
  name: fileNameSchema.optional(),
  folderId: z.string().nullable().optional()
});

export type UpdateFileInput = z.infer<typeof updateFileSchema>;
