import { z } from 'zod';
import { folderNameSchema } from './_shared';

export const updateFolderSchema = z.object({
  name: folderNameSchema.optional(),
  parentId: z.string().nullable().optional(),
});

export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
