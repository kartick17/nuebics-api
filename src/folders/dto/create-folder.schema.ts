import { z } from 'zod';
import { folderNameSchema } from './_shared';

export const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: z.string().nullable().optional().default(null),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
