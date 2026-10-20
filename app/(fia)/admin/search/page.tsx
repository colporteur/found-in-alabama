// /admin/search — site search (SEARCH-1): how the index is doing, the
// synonym list, and what shoppers searched for (and what found nothing).

import Link from "next/link";
import { searchReady, searchStatus, synonymText } from "@/lib/search/index";
import { searchLogSummary } from "@/lib/search/search";
import { SearchAdmin } from "./SearchAdmin";

export const dynamic = "force-dynamic";

const when = (v?: string | null) =>
  v ? new Date(v.endsWith("Z") || v.includes("+") ? v : `${v}Z`).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "never";

export default async function SearchAdminPage() {
  if (!(await searchReady())) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Site search</h1>
        <p className="text-brand-ink/80">
          Not set up yet: run the migration (<code>npm run db:migrate</code>). Until then both sites use the old title-only search.
        </p>
      </section>
    );
  }
  const [status, synonyms, log] = await Promise.all([searchStatus(), synonymText(), searchLogSummary(30)]);
  const meaningPct = status.indexed ? Math.round((100 * status.withMeaning) / status.indexed) : 0;
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Shop</p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Site search</h1>
      <p className="text-sm text-brand-ink/60 mb-6 max-w-3xl">
        Search on <Link href="/search" className="underline">foundinalabama.com</Link> and{" "}
        <a href="https://theephemeralstate.com/search" className="underline">theephemeralstate.com</a> looks at titles, shelves and descriptions,
        forgives typos, understands your synonyms below, and finds related items by meaning. The index refreshes every 15 minutes.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 max-w-4xl text-sm">
        <Stat label="Items searchable" value={`${status.indexed.toLocaleString()} / ${status.inStock.toLocaleString()}`} />
        <Stat label="Meaning search ready" value={`${status.withMeaning.toLocaleString()} (${meaningPct}%)`} />
        <Stat label="Searches, 30 days" value={log.totals.searches.toLocaleString()} />
        <Stat label="Found nothing" value={log.totals.zero.toLocaleString()} />
      </div>
      <p className="text-xs text-brand-ink/50 mb-2">
        Last refresh {when(status.lastRefreshAt)} ({status.changed ?? 0} updated, {status.removed ?? 0} removed) · last meaning pass{" "}
        {when(status.lastEmbedAt)} · {status.words.toLocaleString()} words known for &ldquo;Did you mean&rdquo;
      </p>
      {status.embedError && (
        <div className="mb-4 max-w-4xl rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          <b>Meaning search is paused:</b> {status.embedError} Word and typo search work regardless.
        </div>
      )}

      <SearchAdmin synonyms={synonyms} />

      <div className="grid gap-8 md:grid-cols-2 mt-10 max-w-5xl">
        <div>
          <h2 className="font-semibold mb-2">Found nothing (30 days)</h2>
          <p className="text-xs text-brand-ink/50 mb-2">Buying signals — and words to add as synonyms.</p>
          {log.zero.length === 0 ? (
            <p className="text-sm text-brand-ink/60">None yet.</p>
          ) : (
            <table className="text-sm w-full">
              <tbody>
                {log.zero.map((z) => (
                  <tr key={z.q} className="border-t border-brand-ink/10">
                    <td className="py-1 pr-3">{z.q}</td>
                    <td className="py-1 pr-3 text-brand-ink/60">{z.n}×</td>
                    <td className="py-1 text-xs text-brand-ink/50 uppercase">{z.sites}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h2 className="font-semibold mb-2">Most searched (30 days)</h2>
          {log.top.length === 0 ? (
            <p className="text-sm text-brand-ink/60">None yet.</p>
          ) : (
            <table className="text-sm w-full">
              <tbody>
                {log.top.map((t) => (
                  <tr key={t.q} className="border-t border-brand-ink/10">
                    <td className="py-1 pr-3">
                      <Link href={`/search?q=${encodeURIComponent(t.q)}`} className="hover:underline">
                        {t.q}
                      </Link>
                    </td>
                    <td className="py-1 pr-3 text-brand-ink/60">{t.n}×</td>
                    <td className="py-1 text-brand-ink/60">{t.results.toLocaleString()} results</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-brand-ink/15 p-3">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
