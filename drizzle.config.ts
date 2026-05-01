import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

// Read from .env.local first (Vercel CLI populates this), fall back to .env.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
} satisfies Config;
