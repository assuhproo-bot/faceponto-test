import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url().refine((value) => value.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(value),
    'Use HTTPS except for local development'),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  /** Exact HTTPS origin of the hosted administration panel. */
  ADMIN_ORIGIN: z.url().optional(),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ENABLE_TEST_FAULTS: z.stringbool().default(false),
  ENABLE_ATTENDANCE_WORKER: z.stringbool().default(false),
});

export type ApiConfig = z.infer<typeof schema>;
export function loadConfig(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  return schema.parse(source);
}
