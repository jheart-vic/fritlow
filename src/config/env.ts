import 'dotenv/config';
import { z } from 'zod';

// Validate environment variables once at startup. If anything is missing or
// malformed the server refuses to boot with a clear message, instead of
// failing mysteriously at 2am when the first request hits a bad config.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Comma-separated list of frontend origins allowed to call this API with
  // credentials (cookies). Must be exact origins, not '*', in cookie mode.
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // true in production (HTTPS): marks the refresh cookie Secure + SameSite=None
  // so it works across sites. false for local HTTP development.
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // AI layer. Key is optional so the rest of the API runs without it —
  // AI endpoints return 503 until it's configured.
  AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-4-8'),
  // Email delivery (Brevo). Key is optional so the API runs without it —
  // emails are skipped (and tokens logged in dev) until it's configured.
  BREVO_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.email().default('no-reply@beatcircle.co'),
  EMAIL_FROM_NAME: z.string().default('Beat Circle Mail'),
  // Frontend base URL used to build the links inside emails
  // (verify-email, reset-password pages live in the Nuxt app).
  APP_URL: z.url().default('http://localhost:3000'),
  // Rate limiting. Disabled automatically under NODE_ENV=test so the suite
  // isn't throttled; this flag lets you also turn it off in dev if it gets in
  // the way of manual testing. Windows are in minutes, limits are request
  // counts per window per client IP.
  RATE_LIMIT_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  // Login/register/token endpoints — brute-force + junk-account protection.
  AUTH_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // Email-sending endpoints (resend-verification, forgot-password) — strictest,
  // because these are unauthenticated and each hit spends real Brevo quota.
  EMAIL_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(60),
  EMAIL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  // How many proxy hops sit in front of the API (Render/Nginx = 1). Tells
  // Express to trust that many X-Forwarded-For entries so req.ip is the real
  // client, not the proxy — otherwise every request shares one bucket.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
