import { z } from "zod";

const hexKey32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be a 64-character hex string (32 bytes) — generate with `openssl rand -hex 32`");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  APP_BASE_URL: z.string().url(),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  API_TOKEN_HMAC_SECRET: z.string().min(32, "API_TOKEN_HMAC_SECRET must be at least 32 characters"),
  API_TOKEN_ENCRYPTION_KEY: hexKey32,
  GATEWAY_INTERNAL_SECRET: z.string().min(32, "GATEWAY_INTERNAL_SECRET must be at least 32 characters"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("HelixQL <no-reply@helixql.example.com>"),
  // Inbox that receives /contact form submissions. Falls back to SMTP_USER
  // (the sending account) so a single mailbox works for both by default.
  // Preprocessed so an empty string (unset in a .env file) is treated the
  // same as a genuinely absent variable, rather than failing `.email()`.
  SUPPORT_EMAIL: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Lazily validated, memoized environment. Throws with a readable message on
 * first access if required secrets are missing, instead of failing deep
 * inside a request handler.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
