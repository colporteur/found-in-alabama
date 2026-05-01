import { db, apiKeys } from "@/db";
import { desc } from "drizzle-orm";

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
        These will authenticate the Chrome extension when it POSTs
        captured items to the database. Key creation UI lands with
        Phase 2C.
      </p>

      {keys.length === 0 ? (
        <div className="bg-white border border-dashed border-brand-ink/20 rounded-lg p-12 text-center">
          <p className="font-marker text-2xl text-brand-ink/40 mb-2">
            No keys yet.
          </p>
          <p className="text-brand-ink/60 max-w-md mx-auto">
            Generated when you install the Chrome extension in Phase 2C.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-brand-ink/15 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-paper border-b border-brand-ink/10">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Prefix</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Last used</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr
                  key={k.id}
                  className="border-b border-brand-ink/5 last:border-b-0"
                >
                  <td className="px-4 py-3">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-brand-ink/70">
                    {k.prefix}…
                  </td>
                  <td className="px-4 py-3 text-brand-ink/60">
                    {k.createdAt.toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-brand-ink/60">
                    {k.lastUsedAt?.toLocaleDateString() ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {k.revokedAt ? (
                      <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-brand-ink/10 text-brand-ink/60">
                        Revoked
                      </span>
                    ) : (
                      <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-brand-yellow/30 text-brand-ink">
                        Active
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
