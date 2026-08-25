/**
 * Environment validation (P0-002). Missing critical secrets fail fast at boot.
 * Mobile never receives any of these values.
 */
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8787),
    DATABASE_URL: z.string().min(1).optional(),
    // Optional provider keys stay server-side only; absent by default in V1.
    TICKETMASTER_API_KEY: z.string().optional(),
    SEATGEEK_API_KEY: z.string().optional(),
    PREDICTHQ_API_KEY: z.string().optional(),
    ROUTING_PROVIDER_KEY: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .transform((raw) => {
    const devDefault = "postgres://heat:heat@localhost:5433/heat";
    const databaseUrl = raw.DATABASE_URL ?? (raw.NODE_ENV === "production" ? undefined : devDefault);
    if (!databaseUrl) {
      throw new Error("SAFE_CONFIG_ERROR DATABASE_URL: Required");
    }
    return { ...raw, DATABASE_URL: databaseUrl };
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`SAFE_CONFIG_ERROR ${issues}`);
  }
  return parsed.data;
}
