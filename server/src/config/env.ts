import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: z.string().default('http://localhost:3000'),

  DATABASE_PATH: z.string().default('./data/reunion.db'),
  STORAGE_PATH: z.string().default('./data/uploads'),

  STORAGE_PROVIDER: z.enum(['LOCAL', 'R2', 'R2_MIRRORED']).default('LOCAL'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('reunion-fund-stage-media'),
  R2_PUBLIC_BASE_URL: z.string().default('/media'),

  BANK_SYNC_PROVIDER: z.enum(['SEPAY', 'MOCK']).default('SEPAY'),
  SEPAY_ENVIRONMENT: z.enum(['sandbox', 'live']).default('sandbox'),
  SEPAY_BASE_URL: z.string().default('https://userapi-sandbox.sepay.vn/v2'),
  SEPAY_API_TOKEN: z.string().default('placeholder_api_token'),
  SEPAY_WEBHOOK_SECRET: z.string().default('placeholder_webhook_secret'),

  SEPAY_BANK_ACCOUNT: z.string().default('0123456789'),
  SEPAY_BANK_NAME: z.string().default('MBBank'),
  SEPAY_ACCOUNT_NAME: z.string().default('NGUYEN VAN THU QUY'),

  GEMINI_API_KEY: z.string().default('placeholder_gemini_key'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  ADMIN_USERNAME: z.string().default('thuquy'),
  ADMIN_PASSWORD_HASH: z.string().default('$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy'),
  SESSION_SECRET: z.string().default('default_insecure_secret_for_development_mode_only_replace_in_prod'),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  DEFAULT_CONTRIBUTION_AMOUNT: z.coerce.number().default(500000),
  REUNION_EVENT_TITLE: z.string().default('LỚP A1 — KHÓA 48'),

  RECONCILIATION_CRON: z.string().default('30 3 * * *'),
  AUTO_RECONCILE_ON_STARTUP: z.string().transform((v) => v === 'true').default('true'),
  ALLOW_LOTTERY_TEST_RESET: z.coerce.boolean().default(false),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadConfig(): EnvConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Configuration validation failed:', parsed.error.format());
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

export const config = loadConfig();
