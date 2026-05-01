// Run the latest migrations against the database.
// Usage: npm run db:migrate

import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { migrate } from "drizzle-orm/vercel-postgres/migrator";
import { sql } from "@vercel/postgres";

// Read from .env.local first (Vercel CLI populates this), fall back to .env.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.error(
      "POSTGRES_URL is not set. Did you run `vercel env pull .env.local`?"
    );
    process.exit(1);
  }
  const db = drizzle(sql);
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
