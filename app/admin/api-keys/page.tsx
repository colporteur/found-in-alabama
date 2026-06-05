import { db, apiKeys } from "@/db";
import { desc } from "drizzle-orm";
import ApiKeysManager from "./ApiKeysManager";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const keys = await db
    .select()
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        API keys
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Extension API keys
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        These authenticate the Chrome extension when it POSTs captured
        items from Nifty to the database. Create one named for each
        browser/profile you want to install the extension on. Plaintext
        keys are shown <em>once</em> at creation — copy and paste into
        the extension immediately.
      </p>

      <ApiKeysManager
        initialKeys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          createdAt:
            k.createdAt instanceof Date
              ? k.createdAt.toISOString()
              : String(k.createdAt),
          lastUsedAt:
            k.lastUsedAt instanceof Date
              ? k.lastUsedAt.toISOString()
              : k.lastUsedAt
              ? String(k.lastUsedAt)
              : null,
          revokedAt:
            k.revokedAt instanceof Date
              ? k.revokedAt.toISOString()
              : k.revokedAt
              ? String(k.revokedAt)
              : null,
        }))}
      />
    </section>
  );
}
