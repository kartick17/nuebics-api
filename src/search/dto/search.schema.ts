import { z } from 'zod';

export const searchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, 'q must be at least 2 characters')
    .max(100, 'q must be at most 100 characters'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  includeTrashed: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'true')
    .default(false)
});

export type SearchInput = z.infer<typeof searchSchema>;
