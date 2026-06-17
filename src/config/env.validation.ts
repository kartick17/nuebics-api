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

  MAX_FILES: z.coerce.number().int().positive().default(50),
  CRON_SECRET: z.string().min(1),

  // Scheduled trash purge. CRON is a standard cron expression (default daily
  // at 03:00). ENABLED defaults to true; set to "false" to turn the job off.
  TRASH_PURGE_CRON: z.string().min(1).default('0 3 * * *'),
  TRASH_PURGE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),

  // SMTP — optional so dev/test setups without mail still boot.
  // MailService warns and skips sending when host/user/pass are absent.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional()
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
