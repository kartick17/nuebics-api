import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  MONGODB_URI: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CRYPTO_SECRET: z.string().min(32),

  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  AWS_S3_BUCKET_NAME: z.string().min(1),

  ZOHO_CLIENT_ID: z.string().min(1),
  ZOHO_CLIENT_SECRET: z.string().min(1),
  ZOHO_REFRESH_TOKEN: z.string().min(1),
  ZOHO_PROJECT_ID: z.string().min(1),
  ZOHO_PROJECT_KEY: z.string().min(1),
  ZOHO_ENVIRONMENT: z.enum(['Development', 'Production']),
  ZOHO_BUCKET_NAME: z.string().min(1),

  MAX_FILES: z.coerce.number().int().positive().default(50),
  CRON_SECRET: z.string().min(1)
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('❌ Invalid environment:', parsed.error.format());
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}
